//! Xu Native Agent 工作区工具、路径沙箱与进程执行。
//!
//! @author qiuye <yjk150@qq.com>
//! @date 2026-08-31
//! @updated 2026-09-06
//! @version 1.2.0
//! @category ToolPolicy
//! @algo path-sandbox-and-process-tree-timeout

use std::fs;
use std::path::{Component, Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde_json::{json, Value};

use crate::agent::process_control::{configure_background, wait_with_output_timeout};
use crate::agent::rg_util::{self, RgGrepOpts};
use crate::agent::snapshots;

const MAX_READ_BYTES: u64 = 200_000;
const MAX_WRITE_BYTES: usize = 500_000;
const MAX_LIST_ENTRIES: usize = 200;
const SHELL_TIMEOUT_SECS: u64 = 60;
const MAX_VIEW_IMAGE_BYTES: u64 = 3_500_000;

#[derive(Clone, Debug)]
pub struct PathSandbox {
    pub workspace: PathBuf,
    pub read_extra: Vec<PathBuf>,
    /// CLI binary for ide_open / vscode_* (e.g. cursor, code, trae).
    pub ide_cli: String,
    /// Desktop GUI tools allowed when true (`.xu/gui-consent` or XU_GUI_CONSENT=1).
    pub gui_consent: bool,
    /// Experimental GUI provider rollout; independent from consent and default off.
    pub gui_experimental: bool,
    pub gui_window_allowlist: Vec<String>,
    /// When set, mutating tools snapshot files for undo.
    pub snapshot_batch: Option<String>,
}

impl PathSandbox {
    pub fn new(workspace: impl Into<PathBuf>, read_extra: Vec<PathBuf>) -> Result<Self, String> {
        Self::with_ide_cli(workspace, read_extra, None)
    }

    pub fn with_ide_cli(
        workspace: impl Into<PathBuf>,
        read_extra: Vec<PathBuf>,
        ide_cli: Option<String>,
    ) -> Result<Self, String> {
        let workspace = canonicalize_existing_or_create(workspace.into())?;
        let mut extras = Vec::new();
        for p in read_extra {
            if let Ok(c) = fs::canonicalize(&p) {
                extras.push(c);
            }
        }
        Ok(Self {
            workspace,
            read_extra: extras,
            ide_cli: resolve_ide_cli_name(ide_cli.as_deref()),
            gui_consent: false,
            gui_experimental: false,
            gui_window_allowlist: vec!["Cursor".into(), "Visual Studio Code".into(), "Code".into()],
            snapshot_batch: None,
        })
    }

    pub fn detect_gui_consent(workspace: &std::path::Path) -> bool {
        if std::env::var("XU_GUI_CONSENT").ok().as_deref() == Some("1") {
            return true;
        }
        let marker = workspace.join(".xu").join("gui-consent");
        match std::fs::read_to_string(&marker) {
            Ok(s) => {
                let t = s.trim();
                t == "1" || t.eq_ignore_ascii_case("true") || t == "yes"
            }
            Err(_) => false,
        }
    }

    pub fn detect_gui_experimental(workspace: &std::path::Path) -> bool {
        if std::env::var("XU_GUI_EXPERIMENTAL").ok().as_deref() == Some("1") {
            return true;
        }
        workspace.join(".xu").join("gui-experimental").is_file()
    }

    /// Loads the workspace GUI title allowlist; malformed or empty policy falls back to Cursor only.
    pub fn detect_gui_allowlist(workspace: &std::path::Path) -> Vec<String> {
        let path = workspace.join(".xu").join("gui-policy.json");
        let parsed = fs::read_to_string(path)
            .ok()
            .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
            .and_then(|value| {
                value
                    .get("windowAllowlist")
                    .and_then(Value::as_array)
                    .cloned()
            })
            .unwrap_or_default()
            .into_iter()
            .filter_map(|value| value.as_str().map(str::trim).map(str::to_owned))
            .filter(|value| !value.is_empty())
            .take(32)
            .collect::<Vec<_>>();
        if parsed.is_empty() {
            vec!["Cursor".into(), "Visual Studio Code".into(), "Code".into()]
        } else {
            parsed
        }
    }

    pub fn resolve_read(&self, raw: &str) -> Result<PathBuf, String> {
        let path = resolve_user_path(&self.workspace, raw)?;
        if is_under(&path, &self.workspace) {
            return Ok(path);
        }
        for root in &self.read_extra {
            if is_under(&path, root) {
                return Ok(path);
            }
        }
        Err(format!(
            "路径不在可读范围（工作区或额外只读路径）：{}",
            path.display()
        ))
    }

    pub fn resolve_write(&self, raw: &str) -> Result<PathBuf, String> {
        resolve_write_candidate(&self.workspace, raw)
    }

    /// Re-checks a write target after parent/target creation to catch reparse-point escapes.
    pub fn verify_write_path(&self, path: &Path) -> Result<(), String> {
        let checked = resolve_write_candidate(&self.workspace, &path.to_string_lossy())?;
        if checked != path && fs::canonicalize(path).is_ok() {
            return Err(format!("写入路径创建后发生重定向：{}", path.display()));
        }
        Ok(())
    }
}

fn resolve_write_candidate(workspace: &Path, raw: &str) -> Result<PathBuf, String> {
    let raw = raw.trim();
    if raw.is_empty() {
        return Err("路径为空".into());
    }
    let input = PathBuf::from(raw);
    let joined = if input.is_absolute() {
        input
    } else {
        workspace.join(input)
    };
    let candidate = normalize_path(&joined);
    if !is_under(&candidate, workspace) {
        return Err(format!("写入仅允许工作区内：{}", candidate.display()));
    }

    let mut ancestor = candidate.as_path();
    while !ancestor.exists() {
        ancestor = ancestor
            .parent()
            .ok_or_else(|| format!("无法找到写入路径的存在祖先：{}", candidate.display()))?;
    }
    let canonical_ancestor = fs::canonicalize(ancestor)
        .map_err(|e| format!("解析写入路径祖先失败 {}: {e}", ancestor.display()))?;
    if !is_under(&canonical_ancestor, workspace) {
        return Err(format!(
            "写入路径经符号链接或重解析点越界：{}",
            candidate.display()
        ));
    }
    let suffix = candidate
        .strip_prefix(ancestor)
        .map_err(|_| format!("无法解析写入路径：{}", candidate.display()))?;
    let resolved = canonical_ancestor.join(suffix);
    if resolved.exists() {
        let canonical_target = fs::canonicalize(&resolved)
            .map_err(|e| format!("解析写入目标失败 {}: {e}", resolved.display()))?;
        if !is_under(&canonical_target, workspace) {
            return Err(format!(
                "写入目标经符号链接或重解析点越界：{}",
                candidate.display()
            ));
        }
        return Ok(canonical_target);
    }
    Ok(resolved)
}

fn canonicalize_existing_or_create(path: PathBuf) -> Result<PathBuf, String> {
    if !path.exists() {
        fs::create_dir_all(&path).map_err(|e| format!("创建工作区失败: {e}"))?;
    }
    fs::canonicalize(&path).map_err(|e| format!("解析工作区失败 {}: {e}", path.display()))
}

fn resolve_user_path(workspace: &Path, raw: &str) -> Result<PathBuf, String> {
    let raw = raw.trim();
    if raw.is_empty() {
        return Err("路径为空".into());
    }
    let p = PathBuf::from(raw);
    let joined = if p.is_absolute() {
        p
    } else {
        workspace.join(p)
    };
    if let Ok(canon) = fs::canonicalize(&joined) {
        return Ok(canon);
    }
    if let Some(parent) = joined.parent() {
        if parent.as_os_str().is_empty() {
            return Ok(joined);
        }
        let parent_canon = if parent.exists() {
            fs::canonicalize(parent).map_err(|e| e.to_string())?
        } else {
            normalize_path(parent)
        };
        let name = joined.file_name().ok_or_else(|| "无效文件名".to_string())?;
        return Ok(parent_canon.join(name));
    }
    Ok(joined)
}

fn normalize_path(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for c in path.components() {
        match c {
            Component::ParentDir => {
                out.pop();
            }
            Component::CurDir => {}
            other => out.push(other.as_os_str()),
        }
    }
    out
}

fn is_under(path: &Path, root: &Path) -> bool {
    let path = strip_verbatim(path);
    let root = strip_verbatim(root);
    path.starts_with(&root)
}

fn resolve_ide_cli_name(explicit: Option<&str>) -> String {
    if let Some(s) = explicit.map(str::trim).filter(|s| !s.is_empty()) {
        return map_ide_alias(s);
    }
    if let Ok(env) = std::env::var("XU_IDE_CLI") {
        let t = env.trim();
        if !t.is_empty() {
            return map_ide_alias(t);
        }
    }
    "cursor".into()
}

fn map_ide_alias(raw: &str) -> String {
    match raw.to_ascii_lowercase().as_str() {
        "vscode" | "code" | "vs-code" => "code".into(),
        "cursor" => "cursor".into(),
        "trae" => "trae".into(),
        "qoder" => "qoder".into(),
        "jetbrains" => "idea".into(),
        "windsurf" => "windsurf".into(),
        "zed" => "zed".into(),
        "idea" | "webstorm" | "pycharm" | "goland" | "rider" | "clion" | "phpstorm" => {
            raw.to_string()
        }
        other => other.to_string(),
    }
}

pub fn map_ide_alias_pub(raw: &str) -> String {
    map_ide_alias(raw)
}

fn strip_verbatim(path: &Path) -> PathBuf {
    let s = path.to_string_lossy();
    if let Some(rest) = s.strip_prefix(r"\\?\") {
        PathBuf::from(rest)
    } else {
        path.to_path_buf()
    }
}

pub fn openai_tool_defs() -> Value {
    openai_tool_defs_mode(ToolMode::Full, false)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ToolMode {
    /// Analysis phase: list/read only — no write_file.
    ReadOnly,
    Full,
}

pub fn openai_tool_defs_mode(mode: ToolMode, include_cursor_sdk: bool) -> Value {
    let mut tools = vec![
        json!({
            "type": "function",
            "function": {
                "name": "list_dir",
                "description": "列出路径下的文件与目录（工作区相对路径或允许根内的绝对路径）。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "path": { "type": "string", "description": "目录路径，默认 '.'" }
                    }
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "read_file",
                "description": "读取工作区或额外只读路径内的 UTF-8 文本文件。默认带行号；offset/limit 为 1 起始行号。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "path": { "type": "string", "description": "文件路径" },
                        "offset": { "type": "integer", "description": "起始行（从 1 开始）" },
                        "limit": { "type": "integer", "description": "最多返回行数" },
                        "numbered": { "type": "boolean", "description": "是否带行号，默认 true" }
                    },
                    "required": ["path"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "glob_file_search",
                "description": "按 glob 模式在工作区内找文件（如 **/*.ts、*.md）。优先于 shell find。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "pattern": { "type": "string", "description": "glob 模式" },
                        "path": { "type": "string", "description": "子目录，默认 '.'" }
                    },
                    "required": ["pattern"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "grep_search",
                "description": "在工作区内搜索文件内容（优先 ripgrep，否则内置遍历）。支持正则；fixed_strings 为字面量匹配。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": { "type": "string", "description": "搜索词或正则" },
                        "path": { "type": "string", "description": "文件或目录，默认工作区根" },
                        "glob": { "type": "string", "description": "可选文件过滤，如 *.ts" },
                        "max_hits": { "type": "integer", "description": "最多命中条数" },
                        "fixed_strings": { "type": "boolean", "description": "字面量匹配（不用正则）" }
                    },
                    "required": ["query"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "undo_last_changes",
                "description": "撤销上一批工具写盘改动（使用工作区快照）。需审批。",
                "parameters": { "type": "object", "properties": {} }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "clipboard_get",
                "description": "读取系统剪贴板文本。",
                "parameters": { "type": "object", "properties": {} }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "update_plan",
                "description": "记录执行计划，步骤可带状态 pending|in_progress|completed。不写文件。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "steps": {
                            "type": "array",
                            "items": { "type": "string" },
                            "description": "有序步骤列表（默认 pending）"
                        },
                        "items": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "step": { "type": "string" },
                                    "status": {
                                        "type": "string",
                                        "description": "pending | in_progress | completed"
                                    }
                                },
                                "required": ["step"]
                            }
                        },
                        "summary": { "type": "string", "description": "计划摘要" }
                    }
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "view_image",
                "description": "加载工作区图片（png/jpg/webp/gif）供下一轮视觉模型使用。优先于 shell。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "path": { "type": "string", "description": "图片路径" }
                    },
                    "required": ["path"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "canvas_list",
                "description": "列出项目画板文件（.xu/canvas 下的草图/流程/甘特/UI 选稿）。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "kind": {
                            "type": "string",
                            "description": "可选：sketch | flow | gantt | ui；省略则列出全部"
                        }
                    }
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "canvas_read",
                "description": "读取 .xu/canvas/ 内的画板文件（JSON / Mermaid / 文本）。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "path": { "type": "string", "description": "相对工作区路径，须在 .xu/canvas/ 下" }
                    },
                    "required": ["path"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "git",
                "description": "工作区内安全 git。action=status|diff|log|branch|add|commit|push|merge。缓解评审 fail/pending 时禁止 merge。push 推已有 remote（默认 origin），需审批。优先于 shell_exec。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "action": { "type": "string", "description": "git 子命令" },
                        "path": { "type": "string", "description": "diff/add 可选路径" },
                        "paths": {
                            "type": "array",
                            "items": { "type": "string" },
                            "description": "add 的路径列表"
                        },
                        "message": { "type": "string", "description": "commit 说明" },
                        "limit": { "type": "integer", "description": "log 条数上限（默认 15）" },
                        "remote": { "type": "string", "description": "push 的 remote 名，默认 origin" },
                        "branch": { "type": "string", "description": "push 或 merge 的分支；push 省略则推 HEAD" }
                    },
                    "required": ["action"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "office_read_xlsx",
                "description": "只读预览已有 .xlsx/.xls，以 TSV 形式返回。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "path": { "type": "string" },
                        "sheet": { "type": "string", "description": "工作表名" },
                        "max_rows": { "type": "integer", "description": "最多行数" }
                    },
                    "required": ["path"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "office_read_xlsx_range",
                "description": "按 A1 范围只读 .xlsx（如 A1:D20），返回 TSV。改表前先读再 office_edit_xlsx_cells。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "path": { "type": "string" },
                        "sheet": { "type": "string" },
                        "range": { "type": "string", "description": "如 A1:D20" }
                    },
                    "required": ["path", "range"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "office_read_docx",
                "description": "只读预览已有 .docx，返回段落纯文本列表。改前先读，再 office_docx_replace 或 office_write_docx。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "path": { "type": "string" },
                        "max_paragraphs": { "type": "integer" }
                    },
                    "required": ["path"]
                }
            }
        }),
    ];
    if mode == ToolMode::Full {
        tools.extend([
            json!({
                "type": "function",
                "function": {
                    "name": "write_file",
                    "description": "向工作区内写入 UTF-8 文本。改已有文件请优先 apply_patch/patch_file。",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "path": { "type": "string", "description": "文件路径" },
                            "content": { "type": "string", "description": "文件内容" }
                        },
                        "required": ["path", "content"]
                    }
                }
            }),
            json!({
                "type": "function",
                "function": {
                    "name": "canvas_write_mermaid",
                    "description": "将 Mermaid 源写入项目画板：.xu/canvas/flow/{name}.mmd 或 gantt/{name}.mmd。交互式节点流程图请改用 canvas_write_flow。用户要手绘户型请改用 canvas_write_sketch。",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "kind": { "type": "string", "description": "flow 或 gantt" },
                            "name": { "type": "string", "description": "文件名（不含扩展名）" },
                            "content": { "type": "string", "description": "Mermaid 源码" }
                        },
                        "required": ["kind", "name", "content"]
                    }
                }
            }),
            json!({
                "type": "function",
                "function": {
                    "name": "canvas_write_flow",
                    "description": "写入交互流程图 JSON 到 .xu/canvas/flow/{name}.flow.json。软件开发/业务流程图必须用本工具（不要只交 Mermaid 或口头描述）。content 为 JSON：{ nodes, edges }；节点 type=process|terminal|decision|arrow|doubleArrow|frame，data.label 必填；边须含 source/target，建议 markerEnd=arrowclosed。",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "name": { "type": "string", "description": "文件名（不含扩展名），如 software-dev" },
                            "content": { "type": "string", "description": "完整 JSON 字符串，必须含 nodes 与 edges 数组" }
                        },
                        "required": ["name", "content"]
                    }
                }
            }),
            json!({
                "type": "function",
                "function": {
                    "name": "canvas_clear_flow",
                    "description": "清空指定交互流程图（nodes/edges 置空并写回 .flow.json）。",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "name": { "type": "string", "description": "文件名（不含扩展名），默认 board" }
                        }
                    }
                }
            }),
            json!({
                "type": "function",
                "function": {
                    "name": "canvas_write_sketch",
                    "description": "整板覆盖写入 .xu/canvas/sketch/board.json（少用）。优先用 canvas_add_strokes / canvas_update_stroke / canvas_delete_strokes / canvas_clear_sketch 小步改图。content 为完整 version5 JSON，须含非空 strokes。",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "content": {
                                "type": "string",
                                "description": "完整 JSON 字符串，必须含 strokes 数组"
                            }
                        },
                        "required": ["content"]
                    }
                }
            }),
            json!({
                "type": "function",
                "function": {
                    "name": "canvas_clear_sketch",
                    "description": "清空草图 strokes（默认可保留 paper/layers）。新图开始前先调用。",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "keep_paper": {
                                "type": "boolean",
                                "description": "true=只清 strokes（默认）；false=恢复默认纸面"
                            }
                        }
                    }
                }
            }),
            json!({
                "type": "function",
                "function": {
                    "name": "canvas_add_strokes",
                    "description": "向现有草图追加图元（读改写合并，不冲掉已有笔迹）。strokes 为图元数组：kind=line|rect|ellipse|text|polygon|curve|arrow|path|dim；可省略 id（自动生成）。可先 canvas_clear_sketch 再多次 add。",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "strokes": {
                                "description": "图元数组，或 JSON 数组字符串"
                            },
                            "clear_first": {
                                "type": "boolean",
                                "description": "true 时先清空再追加（默认 false）"
                            }
                        },
                        "required": ["strokes"]
                    }
                }
            }),
            json!({
                "type": "function",
                "function": {
                    "name": "canvas_update_stroke",
                    "description": "按 id 更新单个图元（浅合并 patch）。先 canvas_read 或根据上次工具结果中的 id。",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "id": { "type": "string", "description": "图元 id" },
                            "patch": {
                                "type": "object",
                                "description": "要合并的字段（如 x,y,w,h,text,style）"
                            }
                        },
                        "required": ["id", "patch"]
                    }
                }
            }),
            json!({
                "type": "function",
                "function": {
                    "name": "canvas_delete_strokes",
                    "description": "按 id 删除一个或多个图元。",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "ids": {
                                "type": "array",
                                "items": { "type": "string" },
                                "description": "要删除的图元 id 列表"
                            }
                        },
                        "required": ["ids"]
                    }
                }
            }),
            json!({
                "type": "function",
                "function": {
                    "name": "canvas_export",
                    "description": "把 .xu/canvas/ 内的画板文件复制到工作区另一路径。",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "from": { "type": "string", "description": "源路径（须在 .xu/canvas/）" },
                            "to": { "type": "string", "description": "目标路径（工作区内）" }
                        },
                        "required": ["from", "to"]
                    }
                }
            }),
            json!({
                "type": "function",
                "function": {
                    "name": "mkdir",
                    "description": "在工作区内创建目录（含父级）。",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "path": { "type": "string", "description": "目录路径" }
                        },
                        "required": ["path"]
                    }
                }
            }),
            json!({
                "type": "function",
                "function": {
                    "name": "preview_patch",
                    "description": "只读预演已有文件补丁，返回 unified diff；不会写盘。release gate 要求先预览。",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "path": { "type": "string" },
                            "diff": { "type": "string", "description": "unified diff" },
                            "old_text": { "type": "string" },
                            "new_text": { "type": "string" }
                        },
                        "required": ["path"]
                    }
                }
            }),
            json!({
                "type": "function",
                "function": {
                    "name": "patch_file",
                    "description": "修改已有文件。优先 old_text+new_text，或 unified diff。",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "path": { "type": "string" },
                            "diff": { "type": "string", "description": "unified diff" },
                            "old_text": { "type": "string" },
                            "new_text": { "type": "string" }
                        },
                        "required": ["path"]
                    }
                }
            }),
            json!({
                "type": "function",
                "function": {
                    "name": "apply_patch",
                    "description": "Codex 风格补丁：*** Begin Patch … *** End Patch（Add/Update/Delete File）。或 path+old_text+new_text。",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "patch": { "type": "string" },
                            "path": { "type": "string" },
                            "old_text": { "type": "string" },
                            "new_text": { "type": "string" }
                        }
                    }
                }
            }),
            json!({
                "type": "function",
                "function": {
                    "name": "delete_file",
                    "description": "删除工作区内文件。需审批。",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "path": { "type": "string" }
                        },
                        "required": ["path"]
                    }
                }
            }),
            json!({
                "type": "function",
                "function": {
                    "name": "office_write_docx",
                    "description": "创建真实 .docx（OOXML）。勿用 write_file 伪造 Word。参数：path、title?、body? 或 paragraphs[]。",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "path": { "type": "string" },
                            "title": { "type": "string" },
                            "body": { "type": "string" },
                            "paragraphs": { "type": "array", "items": { "type": "string" } }
                        },
                        "required": ["path"]
                    }
                }
            }),
            json!({
                "type": "function",
                "function": {
                    "name": "office_write_xlsx",
                    "description": "创建真实 .xlsx（整表覆盖）。增量改格请用 office_edit_xlsx_cells。rows 为二维数组。",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "path": { "type": "string" },
                            "sheet": { "type": "string", "description": "工作表名" },
                            "rows": { "type": "array", "items": { "type": "array" } }
                        },
                        "required": ["path", "rows"]
                    }
                }
            }),
            json!({
                "type": "function",
                "function": {
                    "name": "office_edit_xlsx_cells",
                    "description": "增量改已有 .xlsx 单元格（A1）。cells: [{ref,value}|{ref,formula}]。create_if_missing 可新建。注意会重建工作簿，原格式可能丢。",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "path": { "type": "string" },
                            "sheet": { "type": "string" },
                            "cells": {
                                "type": "array",
                                "items": { "type": "object" },
                                "description": "[{\"ref\":\"A1\",\"value\":\"x\"}] 或 formula"
                            },
                            "create_if_missing": { "type": "boolean" }
                        },
                        "required": ["path", "cells"]
                    }
                }
            }),
            json!({
                "type": "function",
                "function": {
                    "name": "office_write_pptx",
                    "description": "创建简单 .pptx（标题 + 要点）。勿空口声称已创建 pptx。",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "path": { "type": "string" },
                            "title": { "type": "string" },
                            "bullets": { "type": "array", "items": { "type": "string" } },
                            "body": { "type": "string" }
                        },
                        "required": ["path"]
                    }
                }
            }),
            json!({
                "type": "function",
                "function": {
                    "name": "office_docx_replace",
                    "description": "在已有 .docx 内查找替换纯文本（尽力而为）。run 被拆分时请用 office_write_docx 重写。",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "path": { "type": "string" },
                            "find": { "type": "string" },
                            "replace": { "type": "string" }
                        },
                        "required": ["path", "find"]
                    }
                }
            }),
            json!({
                "type": "function",
                "function": {
                    "name": "office_apply_template",
                    "description": "复制工作区模板 .docx/.xlsx，按 vars 占位符替换后写出（保留版式）。vars 如 {\"{{公司名}}\":\"虚募阁\"}。复杂排版靠模板，勿整文件瞎编 OOXML。",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "template": { "type": "string", "description": "模板路径" },
                            "out": { "type": "string", "description": "输出路径" },
                            "vars": {
                                "type": "object",
                                "description": "占位符 → 替换值"
                            }
                        },
                        "required": ["template", "out", "vars"]
                    }
                }
            }),
            json!({
                "type": "function",
                "function": {
                    "name": "office_open",
                    "description": "用系统默认 Office/WPS 打开工作区内的 .docx/.xlsx/.pptx。需审批。",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "path": { "type": "string" }
                        },
                        "required": ["path"]
                    }
                }
            }),
            json!({
                "type": "function",
                "function": {
                    "name": "shell_exec",
                    "description": "执行 shell/PowerShell。默认 cwd=工作区。可选 workdir、timeout_ms(1s–300s)、argv。需审批。",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "command": { "type": "string", "description": "PowerShell 命令" },
                            "argv": {
                                "type": "array",
                                "items": { "type": "string" },
                                "description": "若设置则直接运行 argv[0]（Windows 下优先用于二进制）"
                            },
                            "workdir": { "type": "string", "description": "工作目录（相对工作区）" },
                            "timeout_ms": { "type": "integer", "description": "超时毫秒" }
                        }
                    }
                }
            }),
            json!({
                "type": "function",
                "function": {
                    "name": "clipboard_set",
                    "description": "写入系统剪贴板文本。需审批。",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "text": { "type": "string" }
                        },
                        "required": ["text"]
                    }
                }
            }),
            json!({
                "type": "function",
                "function": {
                    "name": "open_program",
                    "description": "启动本地程序。绝对路径须在工作区内。需审批。",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "program": { "type": "string" },
                            "args": { "type": "array", "items": { "type": "string" } }
                        },
                        "required": ["program"]
                    }
                }
            }),
            json!({
                "type": "function",
                "function": {
                    "name": "ide_open",
                    "description": "用 IDE CLI 打开工作区文件（cursor/code/trae/qoder）。改代码优先此工具。需审批。",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "path": { "type": "string" },
                            "line": { "type": "integer", "description": "行号" },
                            "ide": { "type": "string", "description": "cursor|vscode|trae|qoder" }
                        },
                        "required": ["path"]
                    }
                }
            }),
            json!({
                "type": "function",
                "function": {
                    "name": "vscode_save",
                    "description": "尽力通过 IDE CLI 保存/重载（-r）。需审批。",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "ide": { "type": "string" }
                        }
                    }
                }
            }),
            json!({
                "type": "function",
                "function": {
                    "name": "vscode_reload_window",
                    "description": "尽力用 IDE CLI 重新打开工作区文件夹。需审批。",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "ide": { "type": "string" }
                        }
                    }
                }
            }),
        ]);
        tools.extend(crate::agent::qa_tools::openai_qa_tool_defs());
        tools.extend(crate::agent::gui_tools::openai_gui_tool_defs());
        tools.extend(openai_delivery_review_tool_defs());
        tools.extend(openai_voice_route_tool_defs());
        if include_cursor_sdk {
            tools.push(json!({
                "type": "function",
                "function": {
                    "name": "cursor_sdk_prompt",
                    "description": "通过 Cursor SDK 在本机工作区委托一次 Agent 任务（不占用键鼠）。需已配置 CURSOR_API_KEY。",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "prompt": { "type": "string", "description": "交给 Cursor Agent 的任务说明" },
                            "model": { "type": "string", "description": "可选模型 id，默认 composer-2.5" }
                        },
                        "required": ["prompt"]
                    }
                }
            }));
        }
    }
    Value::Array(tools)
}

fn openai_voice_route_tool_defs() -> Vec<Value> {
    vec![
        json!({
            "type": "function",
            "function": {
                "name": "voice_route_probe",
                "description": "探测当前语音路由：Sherpa/Cosy 是否就绪、临时语气与 Cosy instruct。夹子音等戏剧语气须 CosyVoice。",
                "parameters": { "type": "object", "properties": {} }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "voice_set_tone",
                "description": "一键切换产品音色预设。tone_id 必须是目录 id：女声 female-loli/jiazi/girl/sweet/gentle/soft/mature/crisp/announce/story/news；男声 male-youth/sunny/gentle/steady/deep/biz/teacher/announce/radio/story。戏剧向（萝莉/夹子/软糯）须 CosyVoice。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "tone_id": { "type": "string" }
                    },
                    "required": ["tone_id"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "voice_set_cosy_instruct",
                "description": "设置临时 CosyVoice instruct / 角色音色描述（会话覆盖）。空字符串可清除。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "instruct": { "type": "string" }
                    },
                    "required": ["instruct"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "voice_clear_override",
                "description": "清除临时语气与 Cosy instruct，回到设置页默认。",
                "parameters": { "type": "object", "properties": {} }
            }
        }),
    ]
}

fn openai_delivery_review_tool_defs() -> Vec<Value> {
    vec![
        json!({
            "type": "function",
            "function": {
                "name": "delivery_review_status",
                "description": "查询派活完成后自动检测产生的交付争议（可筛某员工）。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "employee_id": { "type": "string", "description": "可选，员工 id" }
                    }
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "escalate_delivery_to_boss",
                "description": "将指定交付争议标记为已升级老板处理。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "dispute_id": { "type": "string" }
                    },
                    "required": ["dispute_id"]
                }
            }
        }),
    ]
}

pub fn openai_tool_defs_with_mcp(
    mode: ToolMode,
    mcp_db: Option<&crate::desktop_db::FouDb>,
    employee_role: Option<&str>,
    include_cursor_sdk: bool,
) -> Value {
    let Value::Array(mut tools) = openai_tool_defs_mode(mode, include_cursor_sdk) else {
        return openai_tool_defs_mode(mode, include_cursor_sdk);
    };
    if let Some(db) = mcp_db {
        for t in crate::mcp::list_mcp_tools(db, employee_role) {
            tools.push(json!({
                "type": "function",
                "function": {
                    "name": crate::mcp::mcp_tool_openai_name(&t.server_id, &t.name),
                    "description": t.description,
                    "parameters": t.input_schema
                }
            }));
        }
    }
    Value::Array(tools)
}

pub fn execute_tool(sandbox: &PathSandbox, name: &str, args: &Value) -> String {
    execute_tool_mode(sandbox, ToolMode::Full, name, args, None, None)
}

pub fn execute_tool_mode(
    sandbox: &PathSandbox,
    mode: ToolMode,
    name: &str,
    args: &Value,
    usage_source: Option<&str>,
    mcp_db: Option<&crate::desktop_db::FouDb>,
) -> String {
    if let Some((srv, tool)) = crate::mcp::parse_mcp_tool_name(name) {
        if let Some(db) = mcp_db {
            return match crate::mcp::call_mcp_tool(
                db,
                &srv,
                &tool,
                args,
                Some(sandbox.workspace.as_path()),
            ) {
                Ok(s) => s,
                Err(e) => format!("MCP 调用失败: {e}"),
            };
        }
        return "MCP 未配置".into();
    }
    let write_like = matches!(
        name,
        "write_file"
            | "canvas_write_mermaid"
            | "canvas_write_flow"
            | "canvas_clear_flow"
            | "canvas_write_sketch"
            | "canvas_clear_sketch"
            | "canvas_add_strokes"
            | "canvas_update_stroke"
            | "canvas_delete_strokes"
            | "canvas_export"
            | "mkdir"
            | "patch_file"
            | "apply_patch"
            | "delete_file"
            | "office_write_docx"
            | "office_write_xlsx"
            | "office_write_pptx"
            | "office_docx_replace"
            | "office_edit_xlsx_cells"
            | "office_apply_template"
            | "office_open"
            | "shell_exec"
            | "clipboard_set"
            | "open_program"
            | "ide_open"
            | "vscode_open"
            | "vscode_save"
            | "vscode_reload_window"
            | "browser_open"
            | "browser_goto"
            | "browser_click"
            | "browser_type"
            | "browser_assert"
            | "browser_screenshot"
            | "defect_write"
            | "app_launch"
            | "screenshot_window"
            | "input_click"
            | "input_type"
            | "ui_focus_window"
            | "ui_list_elements"
            | "ui_click_element"
            | "gui_record_start"
            | "gui_record_stop"
            | "gui_replay"
    );
    let plan_mkdir = mode == ToolMode::ReadOnly
        && name == "mkdir"
        && usage_source.map(|s| s.contains("analyze")).unwrap_or(false);
    if mode == ToolMode::ReadOnly && write_like && !plan_mkdir {
        return "当前为分析阶段：禁止写业务文件/shell/IDE/Office 落盘。规划目录可用 mkdir。请用 XU_NEED_CONFIRM 列出待确认项。可用 list_dir/read_file/glob_file_search/grep_search/mkdir/update_plan/view_image/git(status|diff|log|branch)。".into();
    }
    // git write actions blocked in read-only
    if mode == ToolMode::ReadOnly && name == "git" {
        let action = args
            .get("action")
            .and_then(|v| v.as_str())
            .unwrap_or("status")
            .to_ascii_lowercase();
        if matches!(
            action.as_str(),
            "add" | "commit" | "checkout" | "reset" | "push" | "pull"
        ) {
            return "分析阶段禁止会改仓库的 git 操作（add/commit/…）".into();
        }
    }
    if name == "delivery_review_status" {
        return tool_delivery_review_status(mcp_db, args);
    }
    if name == "escalate_delivery_to_boss" {
        return tool_escalate_delivery_to_boss(mcp_db, args);
    }
    if name == "voice_route_probe" {
        let sherpa = crate::voice::kokoro_models_ready(None);
        let cosy = crate::voice::cosyvoice::status().phase == "ready";
        let s = crate::commands::voice_route::snapshot();
        return serde_json::json!({
            "toneId": s.tone_id,
            "cosyInstruct": s.cosy_instruct,
            "sherpaReady": sherpa,
            "cosyLocalReady": cosy,
            "message": "夹子音等须 Cosy；安装请用 voice_native_install / cosyvoice_*，勿闲聊代替下载。"
        })
        .to_string();
    }
    if name == "voice_set_tone" {
        let tone = args
            .get("tone_id")
            .or_else(|| args.get("toneId"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim();
        return match crate::commands::voice_route::set_tone_internal(tone) {
            Ok(s) => format!("已设置语气 {}（戏剧向将走 CosyVoice）", s.tone_id),
            Err(e) => e,
        };
    }
    if name == "voice_set_cosy_instruct" {
        let instruct = args
            .get("instruct")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim();
        return match crate::commands::voice_route::set_instruct_internal(instruct) {
            Ok(_) => {
                if instruct.is_empty() {
                    "已清除临时 Cosy instruct".into()
                } else {
                    format!("已设置临时 Cosy instruct（{} 字）", instruct.chars().count())
                }
            }
            Err(e) => e,
        };
    }
    if name == "voice_clear_override" {
        let _ = crate::commands::voice_route::clear_override_internal();
        return "已清除语音会话覆盖".into();
    }
    match name {
        "list_dir" => tool_list_dir(sandbox, args),
        "read_file" => tool_read_file(sandbox, args),
        "glob_file_search" => tool_glob_file_search(sandbox, args),
        "grep_search" => tool_grep_search(sandbox, args),
        "undo_last_changes" => tool_undo_last_changes(sandbox, args),
        "update_plan" => tool_update_plan(args),
        "view_image" => tool_view_image(sandbox, args),
        "canvas_list" => tool_canvas_list(sandbox, args),
        "canvas_read" => tool_canvas_read(sandbox, args),
        "canvas_write_mermaid" => tool_canvas_write_mermaid(sandbox, args),
        "canvas_write_flow" => tool_canvas_write_flow(sandbox, args),
        "canvas_clear_flow" => tool_canvas_clear_flow(sandbox, args),
        "canvas_write_sketch" => tool_canvas_write_sketch(sandbox, args),
        "canvas_clear_sketch" => tool_canvas_clear_sketch(sandbox, args),
        "canvas_add_strokes" => tool_canvas_add_strokes(sandbox, args),
        "canvas_update_stroke" => tool_canvas_update_stroke(sandbox, args),
        "canvas_delete_strokes" => tool_canvas_delete_strokes(sandbox, args),
        "canvas_export" => tool_canvas_export(sandbox, args),
        "git" => tool_git(sandbox, args),
        "office_read_xlsx" => crate::agent::office_tools::tool_office_read_xlsx(sandbox, args),
        "office_read_xlsx_range" => {
            crate::agent::office_tools::tool_office_read_xlsx_range(sandbox, args)
        }
        "office_read_docx" => crate::agent::office_tools::tool_office_read_docx(sandbox, args),
        "write_file" => tool_write_file(sandbox, args),
        "mkdir" => tool_mkdir(sandbox, args),
        "preview_patch" => tool_preview_patch(sandbox, args),
        "patch_file" => tool_patch_file(sandbox, args),
        "apply_patch" => tool_apply_patch(sandbox, args),
        "delete_file" => tool_delete_file(sandbox, args),
        "office_write_docx" => crate::agent::office_tools::tool_office_write_docx(sandbox, args),
        "office_write_xlsx" => crate::agent::office_tools::tool_office_write_xlsx(sandbox, args),
        "office_edit_xlsx_cells" => {
            crate::agent::office_tools::tool_office_edit_xlsx_cells(sandbox, args)
        }
        "office_write_pptx" => crate::agent::office_tools::tool_office_write_pptx(sandbox, args),
        "office_docx_replace" => {
            crate::agent::office_tools::tool_office_docx_replace(sandbox, args)
        }
        "office_apply_template" => {
            crate::agent::office_tools::tool_office_apply_template(sandbox, args)
        }
        "office_open" => crate::agent::office_tools::tool_office_open(sandbox, args),
        "shell_exec" => tool_shell_exec(sandbox, args),
        "clipboard_get" => tool_clipboard_get(),
        "clipboard_set" => tool_clipboard_set(args),
        "open_program" => tool_open_program(sandbox, args),
        "ide_open" | "vscode_open" => tool_ide_open(sandbox, args),
        "cursor_sdk_prompt" => tool_cursor_sdk_prompt(sandbox, args, mcp_db),
        "vscode_save" => tool_ide_cmd(sandbox, args, &["-r"]),
        "vscode_reload_window" => {
            let root = sandbox.workspace.display().to_string();
            tool_ide_cmd(sandbox, args, &[&root])
        }
        "browser_open" => crate::agent::qa_tools::tool_browser_open(sandbox, args),
        "browser_goto" => crate::agent::qa_tools::tool_browser_goto(sandbox, args),
        "browser_click" => crate::agent::qa_tools::tool_browser_click(sandbox, args),
        "browser_type" => crate::agent::qa_tools::tool_browser_type(sandbox, args),
        "browser_assert" => crate::agent::qa_tools::tool_browser_assert(sandbox, args),
        "browser_screenshot" => crate::agent::qa_tools::tool_browser_screenshot(sandbox, args),
        "defect_write" => crate::agent::qa_tools::tool_defect_write(sandbox, args),
        "defect_assign_fix" => crate::agent::qa_tools::tool_defect_assign_fix(args),
        "run_ui_acceptance" => crate::agent::qa_tools::tool_run_ui_acceptance(sandbox, args),
        "dispatch_defect_fix" => crate::agent::qa_tools::tool_dispatch_defect_fix(sandbox, args),
        "app_launch" => crate::agent::gui_tools::tool_app_launch(sandbox, args),
        "screenshot_window" => crate::agent::gui_tools::tool_screenshot_window(sandbox, args),
        "gui_bind_target" => crate::agent::gui_tools::tool_gui_bind_target(sandbox, args),
        "input_click" => crate::agent::gui_tools::tool_input_click(sandbox, args),
        "input_type" => crate::agent::gui_tools::tool_input_type(sandbox, args),
        "ui_focus_window" => crate::agent::gui_tools::tool_ui_focus_window(sandbox, args),
        "ui_list_elements" => crate::agent::gui_tools::tool_ui_list_elements(sandbox, args),
        "ui_click_element" => crate::agent::gui_tools::tool_ui_click_element(sandbox, args),
        "gui_record_start" => crate::agent::gui_tools::tool_gui_record_start(sandbox, args),
        "gui_record_stop" => crate::agent::gui_tools::tool_gui_record_stop(sandbox, args),
        "gui_replay" => crate::agent::gui_tools::tool_gui_replay(sandbox, args),
        other => format!("未知工具: {other}"),
    }
}

fn with_xu_db<T>(
    db: &crate::desktop_db::FouDb,
    f: impl FnOnce(&rusqlite::Connection) -> Result<T, String>,
) -> Result<T, String> {
    let guard = db.0.lock().map_err(|e| e.to_string())?;
    f(&guard)
}

fn tool_delivery_review_status(mcp_db: Option<&crate::desktop_db::FouDb>, args: &Value) -> String {
    let Some(db) = mcp_db else {
        return "交付争议数据不可用（无本地库）".into();
    };
    let employee_id = args
        .get("employee_id")
        .and_then(|v| v.as_str())
        .map(|s| s.trim())
        .filter(|s| !s.is_empty());
    let raw = match with_xu_db(db, crate::desktop_db::get_delivery_disputes) {
        Ok(Some(s)) => s,
        Ok(None) => return "暂无交付争议".into(),
        Err(e) => return format!("读取失败: {e}"),
    };
    let Ok(mut list) = serde_json::from_str::<Vec<Value>>(&raw) else {
        return "争议数据格式错误".into();
    };
    if let Some(eid) = employee_id {
        list.retain(|d| d.get("employeeId").and_then(|v| v.as_str()) == Some(eid));
    }
    if list.is_empty() {
        return "暂无匹配的交付争议".into();
    }
    serde_json::to_string_pretty(&list).unwrap_or_else(|_| raw)
}

fn tool_escalate_delivery_to_boss(
    mcp_db: Option<&crate::desktop_db::FouDb>,
    args: &Value,
) -> String {
    let Some(db) = mcp_db else {
        return "交付争议数据不可用（无本地库）".into();
    };
    let dispute_id = args
        .get("dispute_id")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim();
    if dispute_id.is_empty() {
        return "缺少 dispute_id".into();
    }
    let raw = match with_xu_db(db, crate::desktop_db::get_delivery_disputes) {
        Ok(Some(s)) => s,
        Ok(None) => return "暂无交付争议".into(),
        Err(e) => return format!("读取失败: {e}"),
    };
    let Ok(mut list) = serde_json::from_str::<Vec<Value>>(&raw) else {
        return "争议数据格式错误".into();
    };
    let mut found = false;
    for item in list.iter_mut() {
        if item.get("id").and_then(|v| v.as_str()) == Some(dispute_id) {
            item["status"] = json!("escalated");
            item["updatedAt"] = json!(chrono_lite_now_ms());
            found = true;
            break;
        }
    }
    if !found {
        return format!("未找到争议: {dispute_id}");
    }
    let next = serde_json::to_string(&list).unwrap_or_default();
    if let Err(e) = with_xu_db(db, |c| crate::desktop_db::set_delivery_disputes(c, &next)) {
        return format!("写入失败: {e}");
    }
    format!("已升级争议 {dispute_id}，请通知老板拍板或重新派活。")
}

fn chrono_lite_now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn tool_list_dir(sandbox: &PathSandbox, args: &Value) -> String {
    let raw = args.get("path").and_then(|v| v.as_str()).unwrap_or(".");
    let path = match sandbox.resolve_read(raw) {
        Ok(p) => p,
        Err(e) => return e,
    };
    if !path.is_dir() {
        return format!("不是目录: {}", path.display());
    }
    let rd = match fs::read_dir(&path) {
        Ok(r) => r,
        Err(e) => return format!("列出失败: {e}"),
    };
    let mut lines = Vec::new();
    for (i, ent) in rd.enumerate() {
        if i >= MAX_LIST_ENTRIES {
            lines.push("…(已截断)".into());
            break;
        }
        match ent {
            Ok(e) => {
                let name = e.file_name().to_string_lossy().to_string();
                let tag = if e.path().is_dir() { "dir" } else { "file" };
                lines.push(format!("{tag}\t{name}"));
            }
            Err(e) => lines.push(format!("err\t{e}")),
        }
    }
    if lines.is_empty() {
        "(空目录)".into()
    } else {
        lines.join("\n")
    }
}

fn format_numbered_lines(lines: &[&str], start_line: usize, total: usize) -> String {
    if lines.is_empty() {
        return format!("【第 {start_line}–{start_line} 行 / 共 {total} 行】\n");
    }
    let end_line = start_line + lines.len() - 1;
    let width = total.to_string().len().max(4);
    let body: String = lines
        .iter()
        .enumerate()
        .map(|(i, line)| format!("{:width$}|{line}", i + start_line, width = width))
        .collect::<Vec<_>>()
        .join("\n");
    format!("【第 {start_line}–{end_line} 行 / 共 {total} 行】\n{body}")
}

fn tool_read_file(sandbox: &PathSandbox, args: &Value) -> String {
    let Some(raw) = args.get("path").and_then(|v| v.as_str()) else {
        return "缺少 path".into();
    };
    let path = match sandbox.resolve_read(raw) {
        Ok(p) => p,
        Err(e) => return e,
    };
    if !path.is_file() {
        return format!("不是文件: {}", path.display());
    }
    let meta = match fs::metadata(&path) {
        Ok(m) => m,
        Err(e) => return format!("读元数据失败: {e}"),
    };
    if meta.len() > MAX_READ_BYTES {
        return format!(
            "文件过大（{} bytes > {}），请换更小文件或分段",
            meta.len(),
            MAX_READ_BYTES
        );
    }
    let text = match fs::read_to_string(&path) {
        Ok(s) => s,
        Err(e) => return format!("读取失败（可能非 UTF-8）: {e}"),
    };
    let offset = args
        .get("offset")
        .and_then(|v| v.as_u64())
        .unwrap_or(1)
        .max(1) as usize;
    let limit = args
        .get("limit")
        .and_then(|v| v.as_u64())
        .map(|n| n as usize);
    let numbered = args
        .get("numbered")
        .and_then(|v| v.as_bool())
        .unwrap_or(true);
    let lines: Vec<&str> = text.lines().collect();
    let total = lines.len();
    let start = offset.saturating_sub(1).min(total);
    let end = match limit {
        Some(n) => (start + n).min(total),
        None => total,
    };
    let slice = &lines[start..end];
    if numbered {
        format_numbered_lines(slice, start + 1, total)
    } else {
        slice.join("\n")
    }
}

fn tool_update_plan(args: &Value) -> String {
    let summary = args
        .get("summary")
        .and_then(|v| v.as_str())
        .unwrap_or("计划已记录");

    let mut lines: Vec<String> = Vec::new();
    if let Some(items) = args.get("items").and_then(|v| v.as_array()) {
        for (i, it) in items.iter().enumerate() {
            let step = it
                .get("step")
                .and_then(|v| v.as_str())
                .or_else(|| it.as_str())
                .unwrap_or("(空步骤)");
            let status = it
                .get("status")
                .and_then(|v| v.as_str())
                .unwrap_or("pending")
                .to_ascii_lowercase();
            let mark = match status.as_str() {
                "completed" | "done" | "complete" => "✅",
                "in_progress" | "doing" | "active" => "🔄",
                _ => "⬜",
            };
            lines.push(format!("{}. {mark} [{status}] {step}", i + 1));
        }
    }
    if lines.is_empty() {
        if let Some(steps) = args.get("steps").and_then(|v| v.as_array()) {
            for (i, s) in steps.iter().enumerate() {
                if let Some(t) = s.as_str() {
                    lines.push(format!("{}. ⬜ [pending] {t}", i + 1));
                }
            }
        }
    }
    if lines.is_empty() {
        return "update_plan: 需要 steps[] 或 items[{step,status}]".into();
    }
    format!("✅ {summary}\n{}", lines.join("\n"))
}

/// Marker line for stream.rs to attach a vision data-URL (kept short in tool role).
pub fn parse_view_image_marker(output: &str) -> Option<(String, String, PathBuf)> {
    for line in output.lines() {
        let line = line.trim();
        if let Some(rest) = line.strip_prefix("XU_VIEW_IMAGE\t") {
            let mut parts = rest.splitn(3, '\t');
            let rel = parts.next()?.to_string();
            let mime = parts.next()?.to_string();
            let abs = parts.next()?.to_string();
            return Some((rel, mime, PathBuf::from(abs)));
        }
    }
    None
}

fn tool_view_image(sandbox: &PathSandbox, args: &Value) -> String {
    let Some(raw) = args.get("path").and_then(|v| v.as_str()) else {
        return "缺少 path".into();
    };
    let path = match sandbox.resolve_read(raw) {
        Ok(p) => p,
        Err(e) => return e,
    };
    if !path.is_file() {
        return format!("不是文件: {}", path.display());
    }
    let meta = match fs::metadata(&path) {
        Ok(m) => m,
        Err(e) => return format!("读元数据失败: {e}"),
    };
    if meta.len() > MAX_VIEW_IMAGE_BYTES {
        return format!(
            "图片过大（> {} bytes），请压缩后再 view_image",
            MAX_VIEW_IMAGE_BYTES
        );
    }
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let mime = match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "bmp" => "image/bmp",
        _ => {
            return format!("不支持的图片类型 .{ext}（支持 png/jpg/webp/gif/bmp）");
        }
    };
    format!(
        "✅ 已准备加载图片 {raw} ({mime}, {} bytes)\nXU_VIEW_IMAGE\t{raw}\t{mime}\t{}",
        meta.len(),
        path.display()
    )
}

fn block_direct_main_commit(workspace: &Path) -> Option<String> {
    let out = Command::new("git")
        .args(["rev-parse", "--abbrev-ref", "HEAD"])
        .current_dir(workspace)
        .output()
        .ok()?;
    let b = String::from_utf8_lossy(&out.stdout)
        .trim()
        .to_ascii_lowercase();
    if (b == "main" || b == "master") && !b.starts_with("hotfix/") {
        return Some("main 禁止直接提交或推送，请在 feature/* 开发，Review 通过后合入 dev".into());
    }
    None
}

fn code_review_blocks_merge(workspace: &Path) -> Option<String> {
    let p = workspace.join(".xu").join("code-review.json");
    let raw = fs::read_to_string(p).ok()?;
    let v: Value = serde_json::from_str(&raw).ok()?;
    let status = v.get("status").and_then(|x| x.as_str()).unwrap_or("");
    let summary = v
        .get("summary")
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .trim();
    match status {
        "fail" => Some(format!(
            "缓解评审未通过，禁止合并{}",
            if summary.is_empty() {
                String::new()
            } else {
                format!("：{summary}")
            }
        )),
        "pending" => Some("缓解评审进行中，禁止合并".into()),
        _ => None,
    }
}

fn tool_git(sandbox: &PathSandbox, args: &Value) -> String {
    let action = args
        .get("action")
        .and_then(|v| v.as_str())
        .unwrap_or("status")
        .to_ascii_lowercase();
    let cwd = &sandbox.workspace;
    let run = |git_args: &[&str]| -> String {
        let out = Command::new("git")
            .args(git_args)
            .current_dir(cwd)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output();
        match out {
            Ok(o) => {
                let mut s = String::from_utf8_lossy(&o.stdout).to_string();
                let err = String::from_utf8_lossy(&o.stderr);
                if !err.trim().is_empty() {
                    if !s.is_empty() {
                        s.push('\n');
                    }
                    s.push_str(err.trim());
                }
                if !o.status.success() && s.is_empty() {
                    format!("git 失败 exit={}", o.status)
                } else if s.trim().is_empty() {
                    "(无输出)".into()
                } else {
                    s.chars().take(12_000).collect()
                }
            }
            Err(e) => format!("无法运行 git: {e}"),
        }
    };

    match action.as_str() {
        "status" => run(&["status", "--short", "--branch"]),
        "diff" => {
            if let Some(p) = args.get("path").and_then(|v| v.as_str()) {
                let _ = match sandbox.resolve_read(p) {
                    Ok(_) => {}
                    Err(e) => return e,
                };
                run(&["diff", "--", p])
            } else {
                run(&["diff"])
            }
        }
        "log" => {
            let n = args
                .get("limit")
                .and_then(|v| v.as_u64())
                .unwrap_or(15)
                .clamp(1, 50);
            let n = n.to_string();
            run(&["log", &format!("-{n}"), "--oneline", "--decorate"])
        }
        "branch" => run(&["branch", "-vv"]),
        "add" => {
            if let Some(reason) = block_direct_main_commit(&sandbox.workspace) {
                return reason;
            }
            let mut paths: Vec<String> = Vec::new();
            if let Some(arr) = args.get("paths").and_then(|v| v.as_array()) {
                for p in arr {
                    if let Some(s) = p.as_str() {
                        paths.push(s.to_string());
                    }
                }
            }
            if let Some(p) = args.get("path").and_then(|v| v.as_str()) {
                paths.push(p.to_string());
            }
            if paths.is_empty() {
                return "git add 需要 path 或 paths[]".into();
            }
            for p in &paths {
                if let Err(e) = sandbox.resolve_write(p) {
                    return e;
                }
            }
            let mut ga: Vec<String> = vec!["add".into(), "--".into()];
            ga.extend(paths);
            let refs: Vec<&str> = ga.iter().map(|s| s.as_str()).collect();
            run(&refs)
        }
        "commit" => {
            if let Some(reason) = block_direct_main_commit(&sandbox.workspace) {
                return reason;
            }
            let Some(msg) = args.get("message").and_then(|v| v.as_str()) else {
                return "git commit 需要 message".into();
            };
            if msg.trim().is_empty() {
                return "commit message 为空".into();
            }
            run(&["commit", "-m", msg])
        }
        "merge" => {
            if let Some(reason) = code_review_blocks_merge(&sandbox.workspace) {
                return reason;
            }
            let Some(b) = args.get("branch").and_then(|v| v.as_str()) else {
                return "git merge 需要 branch".into();
            };
            let b = b.trim();
            if b.is_empty() || b.contains("..") || b.contains(' ') || b.starts_with('-') {
                return "git merge 的 branch 无效".into();
            }
            run(&["merge", "--no-ff", b])
        }
        "push" => {
            if let Some(reason) = block_direct_main_commit(&sandbox.workspace) {
                return reason;
            }
            let remote = args
                .get("remote")
                .and_then(|v| v.as_str())
                .unwrap_or("origin");
            let remote = remote.trim();
            if remote.is_empty()
                || !remote
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-')
            {
                return "git push 的 remote 只能是已配置名称（如 origin），禁止填 URL".into();
            }
            if let Some(b) = args.get("branch").and_then(|v| v.as_str()) {
                let b = b.trim();
                if b.is_empty() || b.contains("..") || b.contains(' ') || b.starts_with('-') {
                    return "git push 的 branch 无效".into();
                }
                run(&["push", "-u", remote, b])
            } else {
                run(&["push", "-u", remote, "HEAD"])
            }
        }
        "checkout" | "reset" | "pull" => {
            format!("出于安全，git {action} 未开放；请用 status/diff/log/add/commit/push/merge")
        }
        other => {
            format!("未知 git action: {other}（支持 status|diff|log|branch|add|commit|push|merge）")
        }
    }
}

fn tool_glob_file_search(sandbox: &PathSandbox, args: &Value) -> String {
    let Some(pattern) = args.get("pattern").and_then(|v| v.as_str()) else {
        return "缺少 pattern".into();
    };
    let raw = args.get("path").and_then(|v| v.as_str()).unwrap_or(".");
    let root = match sandbox.resolve_read(raw) {
        Ok(p) => p,
        Err(e) => return e,
    };
    if !root.is_dir() {
        return format!("不是目录: {}", root.display());
    }
    let hits = rg_util::glob_files(&root, pattern, 400).unwrap_or_default();
    if hits.is_empty() {
        format!("无匹配：{pattern}")
    } else {
        hits.join("\n")
    }
}

/// Snapshot before mutating a workspace file (write/patch/delete/office).
pub fn snapshot_write_path(sandbox: &PathSandbox, abs: &Path) {
    maybe_snapshot(sandbox, abs);
}

fn maybe_snapshot(sandbox: &PathSandbox, abs: &Path) {
    if let Some(ref batch) = sandbox.snapshot_batch {
        if is_under(abs, &sandbox.workspace) {
            snapshots::snapshot_before_mutate(&sandbox.workspace, abs, batch);
        }
    }
}

fn tool_undo_last_changes(sandbox: &PathSandbox, _args: &Value) -> String {
    match snapshots::undo_last_batch(&sandbox.workspace) {
        Ok(msg) => msg,
        Err(e) => e,
    }
}

fn tool_grep_search(sandbox: &PathSandbox, args: &Value) -> String {
    let Some(query) = args.get("query").and_then(|v| v.as_str()) else {
        return "缺少 query".into();
    };
    if query.is_empty() {
        return "query 为空".into();
    }
    let raw = args.get("path").and_then(|v| v.as_str()).unwrap_or(".");
    let root = match sandbox.resolve_read(raw) {
        Ok(p) => p,
        Err(e) => return e,
    };
    let glob = args.get("glob").and_then(|v| v.as_str());
    let fixed = args
        .get("fixed_strings")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let max_hits = args
        .get("max_hits")
        .and_then(|v| v.as_u64())
        .unwrap_or(40)
        .clamp(1, 120) as usize;
    let opts = RgGrepOpts {
        query,
        root: &root,
        workspace: &sandbox.workspace,
        glob,
        fixed_strings: fixed,
        max_hits,
    };
    if root.is_file() {
        return rg_util::grep_search(&opts).unwrap_or_else(|| {
            let mut hits = Vec::new();
            grep_file(&root, &sandbox.workspace, query, &mut hits, max_hits);
            if hits.is_empty() {
                format!("无命中：{query}")
            } else {
                hits.join("\n")
            }
        });
    }
    rg_util::grep_search(&opts).unwrap_or_else(|| "grep 失败".into())
}

fn grep_file(path: &Path, workspace: &Path, query: &str, out: &mut Vec<String>, cap: usize) {
    if out.len() >= cap {
        return;
    }
    let Ok(meta) = fs::metadata(path) else {
        return;
    };
    if meta.len() > 400_000 {
        return;
    }
    let Ok(text) = fs::read_to_string(path) else {
        return;
    };
    let rel = path
        .strip_prefix(workspace)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/");
    for (i, line) in text.lines().enumerate() {
        if out.len() >= cap {
            out.push("…(已截断)".into());
            return;
        }
        if line.contains(query) {
            let clipped: String = line.chars().take(160).collect();
            out.push(format!("{rel}:{}:{clipped}", i + 1));
        }
    }
}

fn tool_delete_file(sandbox: &PathSandbox, args: &Value) -> String {
    let Some(raw) = args.get("path").and_then(|v| v.as_str()) else {
        return "缺少 path".into();
    };
    let path = match sandbox.resolve_write(raw) {
        Ok(p) => p,
        Err(e) => return e,
    };
    if !path.is_file() {
        return format!("不是文件或不存在: {}", path.display());
    }
    maybe_snapshot(sandbox, &path);
    match fs::remove_file(&path) {
        Ok(()) => format!("已删除 {}", path.display()),
        Err(e) => format!("删除失败: {e}"),
    }
}

fn tool_apply_patch(sandbox: &PathSandbox, args: &Value) -> String {
    // Path + old/new shortcut (same as patch_file)
    if args.get("path").and_then(|v| v.as_str()).is_some()
        && (args.get("old_text").is_some() || args.get("diff").is_some())
    {
        return tool_patch_file(sandbox, args);
    }
    let Some(patch) = args.get("patch").and_then(|v| v.as_str()) else {
        return "apply_patch 需要 patch 字符串，或 path+old_text/new_text".into();
    };
    apply_begin_end_patch(sandbox, patch)
}

/// Minimal Codex-like *** Begin Patch *** grammar (Add/Update/Delete/Move File).
fn apply_begin_end_patch(sandbox: &PathSandbox, patch: &str) -> String {
    let mut results = Vec::new();
    let mut lines = patch.lines().peekable();
    while let Some(line) = lines.next() {
        let t = line.trim();
        if t.eq_ignore_ascii_case("*** Begin Patch") || t.is_empty() {
            continue;
        }
        if t.eq_ignore_ascii_case("*** End Patch") {
            break;
        }
        if let Some(rest) = t
            .strip_prefix("*** Delete File:")
            .or_else(|| t.strip_prefix("*** Delete File："))
        {
            let path_raw = rest.trim();
            let mut args = serde_json::Map::new();
            args.insert("path".into(), json!(path_raw));
            results.push(tool_delete_file(sandbox, &Value::Object(args)));
            continue;
        }
        if let Some(rest) = t
            .strip_prefix("*** Move File:")
            .or_else(|| t.strip_prefix("*** Move File："))
        {
            let rest = rest.trim();
            if let Some((from_raw, to_raw)) = rest
                .split_once("->")
                .or_else(|| rest.split_once('→'))
                .map(|(a, b)| (a.trim(), b.trim()))
            {
                results.push(tool_move_file(sandbox, from_raw, to_raw));
            } else {
                let from_raw = rest;
                let mut to_raw = String::new();
                while let Some(l) = lines.peek() {
                    let lt = l.trim();
                    if lt.starts_with("*** ") {
                        break;
                    }
                    let l = lines.next().unwrap();
                    if let Some(dest) = lt
                        .strip_prefix("*** to:")
                        .or_else(|| lt.strip_prefix("*** to："))
                        .or_else(|| lt.strip_prefix("*** To:"))
                        .or_else(|| lt.strip_prefix("*** To："))
                    {
                        to_raw = dest.trim().to_string();
                        break;
                    }
                    let _ = l;
                }
                if to_raw.is_empty() {
                    results.push(
                        "Move File 缺少目标路径（使用 `from -> to` 或下一行 `*** to:`）".into(),
                    );
                } else {
                    results.push(tool_move_file(sandbox, from_raw, &to_raw));
                }
            }
            continue;
        }
        if let Some(rest) = t
            .strip_prefix("*** Add File:")
            .or_else(|| t.strip_prefix("*** Add File："))
        {
            let path_raw = rest.trim();
            let mut body = String::new();
            while let Some(l) = lines.peek() {
                let lt = l.trim_start();
                if lt.starts_with("*** ") {
                    break;
                }
                let l = lines.next().unwrap();
                if let Some(s) = l.strip_prefix('+') {
                    body.push_str(s);
                } else {
                    body.push_str(l);
                }
                body.push('\n');
            }
            let mut args = serde_json::Map::new();
            args.insert("path".into(), json!(path_raw));
            args.insert("content".into(), json!(body));
            results.push(tool_write_file(sandbox, &Value::Object(args)));
            continue;
        }
        if let Some(rest) = t
            .strip_prefix("*** Update File:")
            .or_else(|| t.strip_prefix("*** Update File："))
        {
            let path_raw = rest.trim();
            let mut hunks: Vec<(String, String)> = Vec::new();
            let mut old = String::new();
            let mut new = String::new();
            let mut in_hunk = false;
            let flush_hunk =
                |hunks: &mut Vec<(String, String)>, old: &mut String, new: &mut String| {
                    if !old.is_empty() || !new.is_empty() {
                        hunks.push((
                            old.trim_end_matches('\n').to_string(),
                            new.trim_end_matches('\n').to_string(),
                        ));
                        old.clear();
                        new.clear();
                    }
                };
            while let Some(l) = lines.peek() {
                let lt = l.trim_start();
                if lt.starts_with("*** ") {
                    break;
                }
                let l = lines.next().unwrap();
                if l.starts_with("@@") {
                    flush_hunk(&mut hunks, &mut old, &mut new);
                    in_hunk = true;
                    continue;
                }
                if !in_hunk && (l.starts_with('-') || l.starts_with('+') || l.starts_with(' ')) {
                    in_hunk = true;
                }
                if !in_hunk {
                    continue;
                }
                if let Some(x) = l.strip_prefix('-') {
                    old.push_str(x);
                    old.push('\n');
                } else if let Some(x) = l.strip_prefix('+') {
                    new.push_str(x);
                    new.push('\n');
                } else if let Some(x) = l.strip_prefix(' ') {
                    old.push_str(x);
                    old.push('\n');
                    new.push_str(x);
                    new.push('\n');
                }
            }
            flush_hunk(&mut hunks, &mut old, &mut new);
            if hunks.is_empty() {
                results.push(format!("Update File 无有效 hunk: {path_raw}"));
            } else if hunks.len() == 1 && hunks[0].0.is_empty() && !hunks[0].1.is_empty() {
                let mut args = serde_json::Map::new();
                args.insert("path".into(), json!(path_raw));
                args.insert("content".into(), json!(hunks[0].1.clone()));
                results.push(tool_write_file(sandbox, &Value::Object(args)));
            } else {
                results.push(tool_apply_update_hunks(sandbox, path_raw, &hunks));
            }
            continue;
        }
    }
    if results.is_empty() {
        "apply_patch: 未解析到 Add/Update/Delete/Move File 段（需要 *** Begin Patch）".into()
    } else {
        results.join("\n")
    }
}

fn tool_move_file(sandbox: &PathSandbox, from_raw: &str, to_raw: &str) -> String {
    let from = match sandbox.resolve_write(from_raw) {
        Ok(p) => p,
        Err(e) => return e,
    };
    let to = match sandbox.resolve_write(to_raw) {
        Ok(p) => p,
        Err(e) => return e,
    };
    if !from.is_file() {
        return format!("Move File 源不是文件: {}", from.display());
    }
    maybe_snapshot(sandbox, &from);
    if to.exists() {
        maybe_snapshot(sandbox, &to);
    }
    if let Some(parent) = to.parent() {
        if let Err(e) = fs::create_dir_all(parent) {
            return format!("创建目标目录失败: {e}");
        }
    }
    match fs::rename(&from, &to) {
        Ok(()) => format!("已移动 {} → {}", from.display(), to.display()),
        Err(e) => format!("移动失败: {e}"),
    }
}

fn tool_apply_update_hunks(
    sandbox: &PathSandbox,
    path_raw: &str,
    hunks: &[(String, String)],
) -> String {
    let path = match sandbox.resolve_write(path_raw) {
        Ok(p) => p,
        Err(e) => return e,
    };
    if !path.is_file() {
        return format!("Update File 要求已有文件: {}", path.display());
    }
    maybe_snapshot(sandbox, &path);
    let mut content = match fs::read_to_string(&path) {
        Ok(s) => s,
        Err(e) => return format!("读取失败: {e}"),
    };
    for (i, (old, new)) in hunks.iter().enumerate() {
        if old.is_empty() {
            return format!("Update File hunk #{} old 为空", i + 1);
        }
        match replace_once_tolerant(&content, old, new) {
            Ok(next) => content = next,
            Err(msg) => {
                return format!("Update File hunk #{} {}: {}", i + 1, msg, path.display());
            }
        }
    }
    if content.len() > MAX_WRITE_BYTES {
        return "patch 后内容过大".into();
    }
    match fs::write(&path, &content) {
        Ok(()) => format!("已 patch {}（{} 个 hunk）", path.display(), hunks.len()),
        Err(e) => format!("写入失败: {e}"),
    }
}

/// Duty: 精确匹配；失败则忽略 CRLF 与行尾空白再匹配一次。
fn replace_once_tolerant(content: &str, old: &str, new: &str) -> Result<String, &'static str> {
    if old.is_empty() {
        return Err("old 为空");
    }
    if content.contains(old) {
        return Ok(content.replacen(old, new, 1));
    }
    let crlf = content.contains("\r\n");
    let c = content.replace("\r\n", "\n").replace('\r', "\n");
    let o = old.replace("\r\n", "\n").replace('\r', "\n");
    let n = new.replace("\r\n", "\n").replace('\r', "\n");
    if c.contains(&o) {
        let p = c.replacen(&o, &n, 1);
        return Ok(if crlf { p.replace('\n', "\r\n") } else { p });
    }
    let c2: String = c.lines().map(|l| l.trim_end()).collect::<Vec<_>>().join("\n");
    let o2: String = o.lines().map(|l| l.trim_end()).collect::<Vec<_>>().join("\n");
    let n2: String = n.lines().map(|l| l.trim_end()).collect::<Vec<_>>().join("\n");
    if !o2.is_empty() && c2.contains(&o2) {
        let p = c2.replacen(&o2, &n2, 1);
        return Ok(if crlf { p.replace('\n', "\r\n") } else { p });
    }
    Err("未匹配（已尝试忽略 CRLF/行尾空白；请缩小 hunk 或先 read_file）")
}

fn canvas_root(sandbox: &PathSandbox) -> PathBuf {
    sandbox.workspace.join(".xu").join("canvas")
}

fn resolve_canvas_read(sandbox: &PathSandbox, raw: &str) -> Result<PathBuf, String> {
    let path = sandbox.resolve_read(raw)?;
    if !is_under(&path, &canvas_root(sandbox)) {
        return Err("画板读取仅允许 .xu/canvas/ 下的文件".into());
    }
    Ok(path)
}

fn resolve_canvas_write(sandbox: &PathSandbox, raw: &str) -> Result<PathBuf, String> {
    let path = sandbox.resolve_write(raw)?;
    if !is_under(&path, &canvas_root(sandbox)) {
        return Err("画板写入仅允许 .xu/canvas/ 下的文件".into());
    }
    Ok(path)
}

fn sanitize_canvas_name(raw: &str) -> String {
    let s: String = raw
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '-'
            }
        })
        .collect();
    let t = s.trim_matches('-');
    if t.is_empty() {
        "untitled".into()
    } else {
        t.chars().take(64).collect()
    }
}

fn tool_canvas_list(sandbox: &PathSandbox, args: &Value) -> String {
    let kind = args
        .get("kind")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase();
    let root = canvas_root(sandbox);
    let dirs: Vec<&str> = match kind.as_str() {
        "sketch" | "flow" | "gantt" | "ui" => vec![kind.as_str()],
        "" => vec!["sketch", "flow", "gantt", "ui", "export"],
        other => return format!("未知 kind：{other}（sketch|flow|gantt|ui|export）"),
    };
    let mut lines = Vec::new();
    for d in dirs {
        let dir = root.join(d);
        if !dir.is_dir() {
            lines.push(format!("{d}/ （空）"));
            continue;
        }
        let mut names: Vec<String> = fs::read_dir(&dir)
            .ok()
            .into_iter()
            .flatten()
            .filter_map(|e| e.ok())
            .filter_map(|e| e.file_name().to_str().map(|s| s.to_string()))
            .take(MAX_LIST_ENTRIES)
            .collect();
        names.sort();
        if names.is_empty() {
            lines.push(format!("{d}/ （空）"));
        } else {
            lines.push(format!("{d}/"));
            for n in names {
                lines.push(format!("  .xu/canvas/{d}/{n}"));
            }
        }
    }
    if lines.is_empty() {
        "画板目录为空".into()
    } else {
        lines.join("\n")
    }
}

fn tool_canvas_read(sandbox: &PathSandbox, args: &Value) -> String {
    let Some(raw) = args.get("path").and_then(|v| v.as_str()) else {
        return "缺少 path".into();
    };
    match resolve_canvas_read(sandbox, raw) {
        Ok(_) => tool_read_file(sandbox, args),
        Err(e) => e,
    }
}

fn tool_canvas_write_mermaid(sandbox: &PathSandbox, args: &Value) -> String {
    let kind = args
        .get("kind")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase();
    let sub = match kind.as_str() {
        "flow" => "flow",
        "gantt" => "gantt",
        _ => return "kind 须为 flow 或 gantt".into(),
    };
    let Some(name_raw) = args.get("name").and_then(|v| v.as_str()) else {
        return "缺少 name".into();
    };
    let Some(content) = args.get("content").and_then(|v| v.as_str()) else {
        return "缺少 content".into();
    };
    if content.len() > MAX_WRITE_BYTES {
        return format!("内容过大（> {} bytes）", MAX_WRITE_BYTES);
    }
    let name = sanitize_canvas_name(name_raw);
    let rel = format!(".xu/canvas/{sub}/{name}.mmd");
    let path = match resolve_canvas_write(sandbox, &rel) {
        Ok(p) => p,
        Err(e) => return e,
    };
    maybe_snapshot(sandbox, &path);
    if let Some(parent) = path.parent() {
        if let Err(e) = fs::create_dir_all(parent) {
            return format!("创建目录失败: {e}");
        }
    }
    match fs::write(&path, content) {
        Ok(()) => format!("已写入 {}（{} bytes）", path.display(), content.len()),
        Err(e) => format!("写入失败: {e}"),
    }
}

/// Duty: 写入交互流程图 {name}.flow.json；须含 nodes/edges。
fn tool_canvas_write_flow(sandbox: &PathSandbox, args: &Value) -> String {
    let Some(name_raw) = args.get("name").and_then(|v| v.as_str()) else {
        return "缺少 name".into();
    };
    let Some(content) = args.get("content").and_then(|v| v.as_str()) else {
        return "缺少 content（JSON：含 nodes / edges）".into();
    };
    if content.len() > MAX_WRITE_BYTES {
        return format!("内容过大（> {} bytes）", MAX_WRITE_BYTES);
    }
    let parsed: Value = match serde_json::from_str(content) {
        Ok(v) => v,
        Err(e) => return format!("JSON 无效: {e}"),
    };
    let Some(nodes) = parsed.get("nodes").and_then(|v| v.as_array()) else {
        return "content 须含 nodes 数组".into();
    };
    let Some(edges) = parsed.get("edges").and_then(|v| v.as_array()) else {
        return "content 须含 edges 数组".into();
    };
    if nodes.is_empty() {
        return "nodes 不能为空，须含至少 1 个节点".into();
    }
    let name = sanitize_canvas_name(name_raw);
    let rel = format!(".xu/canvas/flow/{name}.flow.json");
    let path = match resolve_canvas_write(sandbox, &rel) {
        Ok(p) => p,
        Err(e) => return e,
    };
    maybe_snapshot(sandbox, &path);
    if let Some(parent) = path.parent() {
        if let Err(e) = fs::create_dir_all(parent) {
            return format!("创建目录失败: {e}");
        }
    }
    let pretty = serde_json::to_string_pretty(&parsed).unwrap_or_else(|_| content.to_string());
    match fs::write(&path, &pretty) {
        Ok(()) => format!(
            "已写入流程图 {}（{} 节点 / {} 连线）",
            path.display(),
            nodes.len(),
            edges.len()
        ),
        Err(e) => format!("写入失败: {e}"),
    }
}

/// Duty: 清空指定交互流程图。
fn tool_canvas_clear_flow(sandbox: &PathSandbox, args: &Value) -> String {
    let name_raw = args
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or("board");
    let name = sanitize_canvas_name(name_raw);
    let rel = format!(".xu/canvas/flow/{name}.flow.json");
    let path = match resolve_canvas_write(sandbox, &rel) {
        Ok(p) => p,
        Err(e) => return e,
    };
    maybe_snapshot(sandbox, &path);
    if let Some(parent) = path.parent() {
        if let Err(e) = fs::create_dir_all(parent) {
            return format!("创建目录失败: {e}");
        }
    }
    let empty = json!({ "nodes": [], "edges": [] });
    let pretty = serde_json::to_string_pretty(&empty).unwrap_or_else(|_| "{\"nodes\":[],\"edges\":[]}".into());
    match fs::write(&path, pretty) {
        Ok(()) => format!("已清空流程图 {}", path.display()),
        Err(e) => format!("写入失败: {e}"),
    }
}

/// Duty: 写入草图 board.json；JSON 须含 strokes 数组。
fn tool_canvas_write_sketch(sandbox: &PathSandbox, args: &Value) -> String {
    let Some(content) = args.get("content").and_then(|v| v.as_str()) else {
        return "缺少 content（JSON：含 strokes 数组）".into();
    };
    if content.len() > MAX_WRITE_BYTES {
        return format!("内容过大（> {} bytes）", MAX_WRITE_BYTES);
    }
    let parsed: Value = match serde_json::from_str(content) {
        Ok(v) => v,
        Err(e) => return format!("JSON 无效: {e}"),
    };
    let Some(strokes) = parsed.get("strokes").and_then(|v| v.as_array()) else {
        return "content 须含 strokes 数组".into();
    };
    if strokes.is_empty() {
        return "strokes 不能为空，须含至少 1 个图元（rect/line/text 等）".into();
    }
    let path = match sketch_board_path(sandbox) {
        Ok(p) => p,
        Err(e) => return e,
    };
    maybe_snapshot(sandbox, &path);
    match save_sketch_board(&path, &parsed) {
        Ok(()) => format!(
            "已写入草图 {}（整板覆盖，{} 个图元）。{}",
            path.display(),
            strokes.len(),
            board_summary(&parsed)
        ),
        Err(e) => e,
    }
}

const SKETCH_BOARD_REL: &str = ".xu/canvas/sketch/board.json";

fn default_sketch_board() -> Value {
    json!({
        "version": 5,
        "paper": {
            "w": 420,
            "h": 297,
            "unit": "mm",
            "dpi": 96,
            "scale": 100,
            "bg": "#ffffff"
        },
        "deskBg": "#64748b",
        "layers": [{
            "id": "ly1",
            "name": "图层 1",
            "hidden": false,
            "locked": false
        }],
        "strokes": []
    })
}

fn sketch_board_path(sandbox: &PathSandbox) -> Result<PathBuf, String> {
    resolve_canvas_write(sandbox, SKETCH_BOARD_REL)
}

fn load_sketch_board(sandbox: &PathSandbox) -> Result<(PathBuf, Value), String> {
    let path = sketch_board_path(sandbox)?;
    if path.is_file() {
        let raw = fs::read_to_string(&path).map_err(|e| format!("读取草图失败: {e}"))?;
        let v: Value = serde_json::from_str(&raw).unwrap_or_else(|_| default_sketch_board());
        Ok((path, v))
    } else {
        Ok((path, default_sketch_board()))
    }
}

fn save_sketch_board(path: &Path, board: &Value) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {e}"))?;
    }
    let content = serde_json::to_string_pretty(board).map_err(|e| format!("序列化失败: {e}"))?;
    if content.len() > MAX_WRITE_BYTES {
        return Err(format!("内容过大（> {} bytes）", MAX_WRITE_BYTES));
    }
    fs::write(path, content).map_err(|e| format!("写入失败: {e}"))
}

fn stroke_array_mut(board: &mut Value) -> Result<&mut Vec<Value>, String> {
    if !board.get("strokes").map(|v| v.is_array()).unwrap_or(false) {
        board["strokes"] = json!([]);
    }
    board
        .get_mut("strokes")
        .and_then(|v| v.as_array_mut())
        .ok_or_else(|| "strokes 不是数组".to_string())
}

fn new_stroke_id(seq: usize) -> String {
    let ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    format!("s_{ms}_{seq}")
}

fn ensure_stroke_id(stroke: &mut Value, seq: usize) {
    let empty = stroke
        .get("id")
        .and_then(|v| v.as_str())
        .map(|s| s.trim().is_empty())
        .unwrap_or(true);
    if empty {
        if let Some(obj) = stroke.as_object_mut() {
            obj.insert("id".into(), json!(new_stroke_id(seq)));
        }
    }
    if stroke.get("layerId").is_none() {
        if let Some(obj) = stroke.as_object_mut() {
            obj.insert("layerId".into(), json!("ly1"));
        }
    }
}

fn board_summary(board: &Value) -> String {
    let strokes = board.get("strokes").and_then(|v| v.as_array());
    let Some(list) = strokes else {
        return "当前草图 0 个图元。".into();
    };
    let n = list.len();
    let mut min_x = f64::INFINITY;
    let mut min_y = f64::INFINITY;
    let mut max_x = f64::NEG_INFINITY;
    let mut max_y = f64::NEG_INFINITY;
    let mut kinds: Vec<&str> = Vec::new();
    for s in list.iter().take(12) {
        if let Some(k) = s.get("kind").and_then(|v| v.as_str()) {
            kinds.push(k);
        }
        let nums = |keys: &[&str]| {
            keys.iter()
                .filter_map(|k| s.get(*k).and_then(|v| v.as_f64()))
                .collect::<Vec<_>>()
        };
        match s.get("kind").and_then(|v| v.as_str()).unwrap_or("") {
            "rect" | "image" => {
                let x = s.get("x").and_then(|v| v.as_f64()).unwrap_or(0.0);
                let y = s.get("y").and_then(|v| v.as_f64()).unwrap_or(0.0);
                let w = s.get("w").and_then(|v| v.as_f64()).unwrap_or(0.0);
                let h = s.get("h").and_then(|v| v.as_f64()).unwrap_or(0.0);
                min_x = min_x.min(x);
                min_y = min_y.min(y);
                max_x = max_x.max(x + w);
                max_y = max_y.max(y + h);
            }
            "ellipse" => {
                let cx = s.get("cx").and_then(|v| v.as_f64()).unwrap_or(0.0);
                let cy = s.get("cy").and_then(|v| v.as_f64()).unwrap_or(0.0);
                let rx = s.get("rx").and_then(|v| v.as_f64()).unwrap_or(0.0);
                let ry = s.get("ry").and_then(|v| v.as_f64()).unwrap_or(0.0);
                min_x = min_x.min(cx - rx);
                min_y = min_y.min(cy - ry);
                max_x = max_x.max(cx + rx);
                max_y = max_y.max(cy + ry);
            }
            "line" | "arrow" | "dim" => {
                for v in nums(&["x1", "x2"]) {
                    min_x = min_x.min(v);
                    max_x = max_x.max(v);
                }
                for v in nums(&["y1", "y2"]) {
                    min_y = min_y.min(v);
                    max_y = max_y.max(v);
                }
            }
            "text" => {
                let x = s.get("x").and_then(|v| v.as_f64()).unwrap_or(0.0);
                let y = s.get("y").and_then(|v| v.as_f64()).unwrap_or(0.0);
                min_x = min_x.min(x);
                min_y = min_y.min(y);
                max_x = max_x.max(x + 40.0);
                max_y = max_y.max(y + 16.0);
            }
            _ => {}
        }
    }
    let ids: Vec<String> = list
        .iter()
        .take(8)
        .filter_map(|s| s.get("id").and_then(|v| v.as_str()).map(|s| s.to_string()))
        .collect();
    let bbox = if min_x.is_finite() {
        format!(
            "包围约 ({:.0},{:.0})-({:.0},{:.0})",
            min_x, min_y, max_x, max_y
        )
    } else {
        "无包围盒".into()
    };
    let kind_s = if kinds.is_empty() {
        String::new()
    } else {
        format!("；样例 kind: {}", kinds.join(","))
    };
    let id_s = if ids.is_empty() {
        String::new()
    } else {
        format!("；id: {}", ids.join(","))
    };
    format!("当前草图 {n} 个图元；{bbox}{kind_s}{id_s}。请打开 Canvas 草图页查看。")
}

fn parse_strokes_arg(args: &Value) -> Result<Vec<Value>, String> {
    let Some(raw) = args.get("strokes") else {
        return Err("缺少 strokes".into());
    };
    if let Some(arr) = raw.as_array() {
        return Ok(arr.clone());
    }
    if let Some(s) = raw.as_str() {
        let v: Value = serde_json::from_str(s).map_err(|e| format!("strokes JSON 无效: {e}"))?;
        if let Some(arr) = v.as_array() {
            return Ok(arr.clone());
        }
        return Err("strokes 须为数组".into());
    }
    Err("strokes 须为数组或 JSON 数组字符串".into())
}

/// Duty: 清空草图图元（可选重置纸面）。
fn tool_canvas_clear_sketch(sandbox: &PathSandbox, args: &Value) -> String {
    let keep_paper = args
        .get("keep_paper")
        .and_then(|v| v.as_bool())
        .unwrap_or(true);
    let (path, mut board) = match load_sketch_board(sandbox) {
        Ok(v) => v,
        Err(e) => return e,
    };
    maybe_snapshot(sandbox, &path);
    if keep_paper {
        match stroke_array_mut(&mut board) {
            Ok(s) => s.clear(),
            Err(e) => return e,
        }
    } else {
        board = default_sketch_board();
    }
    match save_sketch_board(&path, &board) {
        Ok(()) => format!(
            "已清空草图 {}。{}",
            path.display(),
            board_summary(&board)
        ),
        Err(e) => e,
    }
}

/// Duty: 追加图元到现有 board（读改写合并）。
fn tool_canvas_add_strokes(sandbox: &PathSandbox, args: &Value) -> String {
    let mut incoming = match parse_strokes_arg(args) {
        Ok(v) => v,
        Err(e) => return e,
    };
    if incoming.is_empty() {
        return "strokes 不能为空".into();
    }
    let clear_first = args
        .get("clear_first")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let (path, mut board) = match load_sketch_board(sandbox) {
        Ok(v) => v,
        Err(e) => return e,
    };
    maybe_snapshot(sandbox, &path);
    let strokes = match stroke_array_mut(&mut board) {
        Ok(s) => s,
        Err(e) => return e,
    };
    if clear_first {
        strokes.clear();
    }
    let base = strokes.len();
    for (i, s) in incoming.iter_mut().enumerate() {
        if !s.is_object() {
            return format!("strokes[{i}] 须为对象");
        }
        if s.get("kind").and_then(|v| v.as_str()).unwrap_or("").is_empty() {
            return format!("strokes[{i}] 缺少 kind");
        }
        ensure_stroke_id(s, base + i);
        strokes.push(s.clone());
    }
    let added = incoming.len();
    let ids: Vec<String> = incoming
        .iter()
        .filter_map(|s| s.get("id").and_then(|v| v.as_str()).map(|s| s.to_string()))
        .collect();
    match save_sketch_board(&path, &board) {
        Ok(()) => format!(
            "已追加草图 {} 个图元（id: {}）。{}",
            added,
            ids.join(","),
            board_summary(&board)
        ),
        Err(e) => e,
    }
}

/// Duty: 按 id 浅合并更新单个图元。
fn tool_canvas_update_stroke(sandbox: &PathSandbox, args: &Value) -> String {
    let Some(id) = args.get("id").and_then(|v| v.as_str()).map(|s| s.trim()) else {
        return "缺少 id".into();
    };
    if id.is_empty() {
        return "id 不能为空".into();
    }
    let Some(patch) = args.get("patch").and_then(|v| v.as_object()) else {
        return "缺少 patch 对象".into();
    };
    let (path, mut board) = match load_sketch_board(sandbox) {
        Ok(v) => v,
        Err(e) => return e,
    };
    maybe_snapshot(sandbox, &path);
    let strokes = match stroke_array_mut(&mut board) {
        Ok(s) => s,
        Err(e) => return e,
    };
    let mut found = false;
    for s in strokes.iter_mut() {
        if s.get("id").and_then(|v| v.as_str()) == Some(id) {
            if let Some(obj) = s.as_object_mut() {
                for (k, v) in patch {
                    if k == "id" {
                        continue;
                    }
                    obj.insert(k.clone(), v.clone());
                }
            }
            found = true;
            break;
        }
    }
    if !found {
        return format!("未找到图元 id={id}");
    }
    match save_sketch_board(&path, &board) {
        Ok(()) => format!("已更新草图图元 {id}。{}", board_summary(&board)),
        Err(e) => e,
    }
}

/// Duty: 按 id 删除图元。
fn tool_canvas_delete_strokes(sandbox: &PathSandbox, args: &Value) -> String {
    let ids: Vec<String> = match args.get("ids") {
        Some(Value::Array(arr)) => arr
            .iter()
            .filter_map(|v| v.as_str().map(|s| s.trim().to_string()))
            .filter(|s| !s.is_empty())
            .collect(),
        Some(Value::String(s)) => {
            match serde_json::from_str::<Vec<String>>(s) {
                Ok(v) => v,
                Err(_) => s
                    .split(',')
                    .map(|x| x.trim().to_string())
                    .filter(|x| !x.is_empty())
                    .collect(),
            }
        }
        _ => return "缺少 ids 数组".into(),
    };
    if ids.is_empty() {
        return "ids 不能为空".into();
    }
    let id_set: std::collections::HashSet<&str> = ids.iter().map(|s| s.as_str()).collect();
    let (path, mut board) = match load_sketch_board(sandbox) {
        Ok(v) => v,
        Err(e) => return e,
    };
    maybe_snapshot(sandbox, &path);
    let strokes = match stroke_array_mut(&mut board) {
        Ok(s) => s,
        Err(e) => return e,
    };
    let before = strokes.len();
    strokes.retain(|s| {
        s.get("id")
            .and_then(|v| v.as_str())
            .map(|id| !id_set.contains(id))
            .unwrap_or(true)
    });
    let removed = before.saturating_sub(strokes.len());
    if removed == 0 {
        return format!("未删除任何图元（ids={}）", ids.join(","));
    }
    match save_sketch_board(&path, &board) {
        Ok(()) => format!(
            "已删除草图 {removed} 个图元。{}",
            board_summary(&board)
        ),
        Err(e) => e,
    }
}

fn tool_canvas_export(sandbox: &PathSandbox, args: &Value) -> String {
    let Some(from_raw) = args.get("from").and_then(|v| v.as_str()) else {
        return "缺少 from".into();
    };
    let Some(to_raw) = args.get("to").and_then(|v| v.as_str()) else {
        return "缺少 to".into();
    };
    let from = match resolve_canvas_read(sandbox, from_raw) {
        Ok(p) => p,
        Err(e) => return e,
    };
    let to = match sandbox.resolve_write(to_raw) {
        Ok(p) => p,
        Err(e) => return e,
    };
    if !from.is_file() {
        return format!("源文件不存在：{}", from.display());
    }
    maybe_snapshot(sandbox, &to);
    if let Some(parent) = to.parent() {
        if let Err(e) = fs::create_dir_all(parent) {
            return format!("创建目录失败: {e}");
        }
    }
    match fs::copy(&from, &to) {
        Ok(n) => format!(
            "已导出 {} → {}（{} bytes）",
            from.display(),
            to.display(),
            n
        ),
        Err(e) => format!("导出失败: {e}"),
    }
}

fn tool_write_file(sandbox: &PathSandbox, args: &Value) -> String {
    let Some(raw) = args.get("path").and_then(|v| v.as_str()) else {
        return "缺少 path".into();
    };
    let Some(content) = args.get("content").and_then(|v| v.as_str()) else {
        return "缺少 content".into();
    };
    if content.len() > MAX_WRITE_BYTES {
        return format!("内容过大（> {} bytes）", MAX_WRITE_BYTES);
    }
    let path = match sandbox.resolve_write(raw) {
        Ok(p) => p,
        Err(e) => return e,
    };
    maybe_snapshot(sandbox, &path);
    if let Some(parent) = path.parent() {
        if let Err(e) = fs::create_dir_all(parent) {
            return format!("创建目录失败: {e}");
        }
    }
    if let Err(e) = sandbox.verify_write_path(&path) {
        return e;
    }
    match fs::write(&path, content) {
        Ok(()) => format!("已写入 {}（{} bytes）", path.display(), content.len()),
        Err(e) => format!("写入失败: {e}"),
    }
}

fn tool_mkdir(sandbox: &PathSandbox, args: &Value) -> String {
    let Some(raw) = args.get("path").and_then(|v| v.as_str()) else {
        return "缺少 path".into();
    };
    let path = match sandbox.resolve_write(raw) {
        Ok(p) => p,
        Err(e) => return e,
    };
    match fs::create_dir_all(&path) {
        Ok(()) => match sandbox.verify_write_path(&path) {
            Ok(()) => format!("已创建目录 {}", path.display()),
            Err(e) => e,
        },
        Err(e) => format!("创建目录失败: {e}"),
    }
}

#[cfg(test)]
mod path_sandbox_tests {
    use super::*;
    use uuid::Uuid;

    fn temp_root(label: &str) -> PathBuf {
        std::env::temp_dir().join(format!("xu-sandbox-{label}-{}", Uuid::new_v4()))
    }

    #[test]
    fn allows_nested_nonexistent_write_and_post_create_verification() {
        let root = temp_root("inside");
        let sandbox = PathSandbox::new(&root, vec![]).unwrap();
        let target = sandbox.resolve_write("nested/deeper/file.txt").unwrap();
        fs::create_dir_all(target.parent().unwrap()).unwrap();
        assert!(sandbox.verify_write_path(&target).is_ok());
        let _ = fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlink_escape_through_existing_ancestor() {
        use std::os::unix::fs::symlink;
        let root = temp_root("root");
        let outside = temp_root("outside");
        fs::create_dir_all(&root).unwrap();
        fs::create_dir_all(&outside).unwrap();
        symlink(&outside, root.join("escape")).unwrap();
        let sandbox = PathSandbox::new(&root, vec![]).unwrap();
        assert!(sandbox.resolve_write("escape/new/file.txt").is_err());
        let _ = fs::remove_dir_all(root);
        let _ = fs::remove_dir_all(outside);
    }

    #[cfg(windows)]
    #[test]
    fn rejects_windows_junction_escape_when_junction_creation_is_available() {
        let root = temp_root("root");
        let outside = temp_root("outside");
        fs::create_dir_all(&root).unwrap();
        fs::create_dir_all(&outside).unwrap();
        let link = root.join("escape");
        let status = Command::new("cmd")
            .args([
                "/C",
                "mklink",
                "/J",
                &link.to_string_lossy(),
                &outside.to_string_lossy(),
            ])
            .status();
        if status.as_ref().map(|s| !s.success()).unwrap_or(true) {
            let _ = fs::remove_dir_all(root);
            let _ = fs::remove_dir_all(outside);
            return;
        }
        let sandbox = PathSandbox::new(&root, vec![]).unwrap();
        assert!(sandbox.resolve_write("escape/new/file.txt").is_err());
        let _ = fs::remove_dir_all(link);
        let _ = fs::remove_dir_all(root);
        let _ = fs::remove_dir_all(outside);
    }
}

fn tool_preview_patch(sandbox: &PathSandbox, args: &Value) -> String {
    let Some(raw) = args.get("path").and_then(Value::as_str) else {
        return "缺少 path".into();
    };
    let path = match sandbox.resolve_write(raw) {
        Ok(path) => path,
        Err(error) => return error,
    };
    let original = match fs::read_to_string(&path) {
        Ok(content) => content,
        Err(error) => return format!("读取待预览文件失败: {error}"),
    };
    let patched = if let (Some(old), Some(new)) = (
        args.get("old_text").and_then(Value::as_str),
        args.get("new_text").and_then(Value::as_str),
    ) {
        match replace_once_tolerant(&original, old, new) {
            Ok(p) => p,
            Err(_) => {
                return "patch 预览失败：old_text 为空或未匹配（已尝试忽略 CRLF/行尾空白）".into();
            }
        }
    } else if let Some(diff) = args.get("diff").and_then(Value::as_str) {
        let patch = match diffy::Patch::from_str(diff) {
            Ok(patch) => patch,
            Err(error) => return format!("patch 预览解析失败: {error}"),
        };
        match diffy::apply(&original, &patch) {
            Ok(content) => content,
            Err(error) => return format!("patch 预览应用失败: {error}"),
        }
    } else {
        return "patch 预览需要 diff 或 old_text+new_text".into();
    };
    let diff = diffy::create_patch(&original, &patched).to_string();
    format!(
        "patch 预览成功（未写盘）\n{}",
        diff.chars().take(12_000).collect::<String>()
    )
}

fn tool_patch_file(sandbox: &PathSandbox, args: &Value) -> String {
    let Some(raw) = args.get("path").and_then(|v| v.as_str()) else {
        return "缺少 path".into();
    };
    let path = match sandbox.resolve_write(raw) {
        Ok(p) => p,
        Err(e) => return e,
    };
    if !path.is_file() {
        return format!("patch_file 要求已有文件: {}", path.display());
    }
    maybe_snapshot(sandbox, &path);
    let original = match fs::read_to_string(&path) {
        Ok(s) => s,
        Err(e) => return format!("读取失败: {e}"),
    };

    if let (Some(old), Some(new)) = (
        args.get("old_text").and_then(|v| v.as_str()),
        args.get("new_text").and_then(|v| v.as_str()),
    ) {
        let patched = match replace_once_tolerant(&original, old, new) {
            Ok(p) => p,
            Err(msg) => return format!("old_text {}: {}", msg, path.display()),
        };
        if patched.len() > MAX_WRITE_BYTES {
            return "patch 后内容过大".into();
        }
        return match fs::write(&path, &patched) {
            Ok(()) => format!("已 patch（片段替换）{}", path.display()),
            Err(e) => format!("写入失败: {e}"),
        };
    }

    let Some(diff) = args.get("diff").and_then(|v| v.as_str()) else {
        return "需要 diff 或 old_text+new_text".into();
    };
    match diffy::Patch::from_str(diff) {
        Ok(patch) => match diffy::apply(&original, &patch) {
            Ok(patched) => {
                if patched.len() > MAX_WRITE_BYTES {
                    return "patch 后内容过大".into();
                }
                match fs::write(&path, &patched) {
                    Ok(()) => format!("已 patch（unified diff）{}", path.display()),
                    Err(e) => format!("写入失败: {e}"),
                }
            }
            Err(e) => format!("应用 diff 失败: {e}"),
        },
        Err(e) => format!("解析 diff 失败: {e}"),
    }
}

fn tool_shell_exec(sandbox: &PathSandbox, args: &Value) -> String {
    let timeout_ms = args
        .get("timeout_ms")
        .and_then(|v| v.as_u64())
        .unwrap_or(SHELL_TIMEOUT_SECS * 1000)
        .clamp(1_000, 300_000);
    let timeout = Duration::from_millis(timeout_ms);

    let workdir_raw = args.get("workdir").and_then(|v| v.as_str()).unwrap_or(".");
    let cwd = if workdir_raw.trim().is_empty() || workdir_raw.trim() == "." {
        sandbox.workspace.clone()
    } else {
        match sandbox.resolve_write(workdir_raw) {
            Ok(p) if p.is_dir() => p,
            Ok(p) => return format!("workdir 不是目录: {}", p.display()),
            Err(e) => return e,
        }
    };

    let argv: Option<Vec<String>> = args.get("argv").and_then(|v| v.as_array()).map(|arr| {
        arr.iter()
            .filter_map(|x| x.as_str().map(|s| s.to_string()))
            .collect()
    });

    let child_result = if let Some(argv) = argv {
        if argv.is_empty() {
            return "argv 为空".into();
        }
        let program = &argv[0];
        let rest: Vec<&str> = argv[1..].iter().map(|s| s.as_str()).collect();
        let mut command = Command::new(program);
        command
            .args(&rest)
            .current_dir(&cwd)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        configure_background(&mut command);
        command.spawn()
    } else {
        let Some(cmd) = args.get("command").and_then(|v| v.as_str()) else {
            return "缺少 command 或 argv".into();
        };
        let cmd = cmd.trim();
        if cmd.is_empty() {
            return "command 为空".into();
        }
        #[cfg(windows)]
        let mut command = {
            let mut command = Command::new("powershell");
            command.args(["-NoProfile", "-NonInteractive", "-Command", cmd]);
            command
        };
        #[cfg(not(windows))]
        let mut command = {
            let mut command = Command::new("sh");
            command.args(["-c", cmd]);
            command
        };
        command
            .current_dir(&cwd)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        configure_background(&mut command);
        command.spawn()
    };

    let mut child = match child_result {
        Ok(c) => c,
        Err(e) => {
            return format!(
                "【shell 失败 · 可恢复】启动失败: {e}\n请换命令或检查 PATH 后重试，不要声称已成功。"
            );
        }
    };
    match wait_with_output_timeout(&mut child, timeout) {
        Ok(out) => {
            let mut s = String::from_utf8_lossy(&out.stdout).to_string();
            let err = String::from_utf8_lossy(&out.stderr);
            if !err.trim().is_empty() {
                if !s.is_empty() {
                    s.push('\n');
                }
                s.push_str("--- stderr ---\n");
                s.push_str(&err);
            }
            if !out.status.success() {
                s = format!(
                    "【shell 失败 · 可恢复】exit={}\n请根据 stdout/stderr 修正命令或代码后重试，不要声称已成功。\n{s}",
                    out.status
                );
            }
            s.chars().take(12_000).collect()
        }
        Err(e) if e.contains("超时") => format!(
            "【shell 失败 · 可恢复】超时（{timeout_ms} ms）：{e}\n可缩小命令范围或加大 timeout 后重试。"
        ),
        Err(e) => format!(
            "【shell 失败 · 可恢复】执行失败: {e}\n请根据原因修正后重试，不要声称已成功。"
        ),
    }
}

fn tool_clipboard_get() -> String {
    match arboard::Clipboard::new() {
        Ok(mut cb) => match cb.get_text() {
            Ok(t) => t.chars().take(8_000).collect(),
            Err(e) => format!("读取剪贴板失败: {e}"),
        },
        Err(e) => format!("打开剪贴板失败: {e}"),
    }
}

fn tool_clipboard_set(args: &Value) -> String {
    let Some(text) = args.get("text").and_then(|v| v.as_str()) else {
        return "缺少 text".into();
    };
    match arboard::Clipboard::new() {
        Ok(mut cb) => match cb.set_text(text) {
            Ok(()) => format!("已写入剪贴板（{} chars）", text.chars().count()),
            Err(e) => format!("写入剪贴板失败: {e}"),
        },
        Err(e) => format!("打开剪贴板失败: {e}"),
    }
}

fn tool_open_program(sandbox: &PathSandbox, args: &Value) -> String {
    let Some(program) = args.get("program").and_then(|v| v.as_str()) else {
        return "缺少 program".into();
    };
    let prog_args: Vec<String> = args
        .get("args")
        .and_then(|v| v.as_array())
        .map(|a| {
            a.iter()
                .filter_map(|x| x.as_str().map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default();

    let exe = if program.contains('/')
        || program.contains('\\')
        || PathBuf::from(program).is_absolute()
    {
        match sandbox
            .resolve_write(program)
            .or_else(|_| sandbox.resolve_read(program))
        {
            Ok(p) => p,
            Err(e) => return e,
        }
    } else {
        PathBuf::from(program)
    };

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        match Command::new(&exe)
            .args(&prog_args)
            .current_dir(&sandbox.workspace)
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
        {
            Ok(_) => format!("已启动 {}", exe.display()),
            Err(e) => format!("启动失败: {e}"),
        }
    }
    #[cfg(not(windows))]
    {
        match Command::new(&exe)
            .args(&prog_args)
            .current_dir(&sandbox.workspace)
            .spawn()
        {
            Ok(_) => format!("已启动 {}", exe.display()),
            Err(e) => format!("启动失败: {e}"),
        }
    }
}

fn tool_cursor_sdk_prompt(
    sandbox: &PathSandbox,
    args: &Value,
    mcp_db: Option<&crate::desktop_db::FouDb>,
) -> String {
    let Some(db) = mcp_db else {
        return "Cursor SDK 未配置".into();
    };
    let prompt = args
        .get("prompt")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim();
    if prompt.is_empty() {
        return "缺少 prompt".into();
    }
    let model = args.get("model").and_then(|v| v.as_str());
    match crate::commands::cursor_sdk::run_sdk_prompt(
        None,
        db,
        &sandbox.workspace.display().to_string(),
        prompt,
        model,
    ) {
        Ok(text) => {
            if text.len() > 8000 {
                format!("{}…（已截断）", &text[..8000])
            } else {
                text
            }
        }
        Err(e) => format!("Cursor SDK 失败: {e}"),
    }
}

fn tool_ide_open(sandbox: &PathSandbox, args: &Value) -> String {
    let Some(raw) = args.get("path").and_then(|v| v.as_str()) else {
        return "缺少 path".into();
    };
    let path = match sandbox.resolve_read(raw) {
        Ok(p) => p,
        Err(e) => return e,
    };
    let line = args.get("line").and_then(|v| v.as_u64()).unwrap_or(1);
    let target = format!("{}:{}", path.display(), line);
    tool_ide_cmd(sandbox, args, &["--goto", &target])
}

fn tool_ide_cmd(sandbox: &PathSandbox, args: &Value, cli_args: &[&str]) -> String {
    let cli = args
        .get("ide")
        .and_then(|v| v.as_str())
        .map(|s| map_ide_alias(s))
        .unwrap_or_else(|| sandbox.ide_cli.clone());

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        match Command::new(&cli)
            .args(cli_args)
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
        {
            Ok(_) => format!("已调用 {cli} {}", cli_args.join(" ")),
            Err(e) => format!(
                "调用 {cli} 失败（请确认已安装并将 CLI 加入 PATH；可用 XU_IDE_CLI 覆盖）: {e}"
            ),
        }
    }
    #[cfg(not(windows))]
    {
        match Command::new(&cli).args(cli_args).spawn() {
            Ok(_) => format!("已调用 {cli} {}", cli_args.join(" ")),
            Err(e) => format!(
                "调用 {cli} 失败（请确认已安装并将 CLI 加入 PATH；可用 XU_IDE_CLI 覆盖）: {e}"
            ),
        }
    }
}
