//! Playwright browser QA tools via Node helper script under `{XU_HOME}/qa/`.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::{json, Value};

use super::tools::PathSandbox;
use crate::commands::qa_setup::qa_home_dir;
use crate::xu_paths::hide_command_window;

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn find_qa_script(workspace: &Path) -> PathBuf {
    if let Ok(qa) = qa_home_dir() {
        let cand = qa.join("qa-browser.mjs");
        if cand.is_file() {
            return cand;
        }
    }
    let candidates = [
        PathBuf::from("scripts/qa-browser.mjs"),
        PathBuf::from("../scripts/qa-browser.mjs"),
        workspace.join("scripts").join("qa-browser.mjs"),
    ];
    for c in &candidates {
        if c.is_file() {
            return c.clone();
        }
    }
    let mut cur = workspace.to_path_buf();
    for _ in 0..8 {
        let cand = cur.join("scripts").join("qa-browser.mjs");
        if cand.is_file() {
            return cand;
        }
        if let Some(p) = cur.parent() {
            cur = p.to_path_buf();
        } else {
            break;
        }
    }
    PathBuf::from("scripts/qa-browser.mjs")
}

#[cfg(target_os = "windows")]
fn resolve_node_bin() -> PathBuf {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(out) = {
        let mut cmd = Command::new("where");
        hide_command_window(cmd.arg("node"));
        cmd.output()
    } {
        if out.status.success() {
            for line in String::from_utf8_lossy(&out.stdout).lines() {
                let p = PathBuf::from(line.trim());
                if p.is_file() {
                    candidates.push(p);
                }
            }
        }
    }
    if let Ok(pf) = std::env::var("ProgramFiles") {
        candidates.push(PathBuf::from(pf).join("nodejs").join("node.exe"));
    }
    for c in &candidates {
        if c.extension().and_then(|e| e.to_str()) == Some("exe") && c.is_file() {
            return c.clone();
        }
        if let Some(parent) = c.parent() {
            let exe = parent.join("node.exe");
            if exe.is_file() {
                return exe;
            }
        }
    }
    PathBuf::from("node")
}

#[cfg(not(target_os = "windows"))]
fn resolve_node_bin() -> PathBuf {
    PathBuf::from("node")
}

pub fn run_qa_browser(sandbox: &PathSandbox, payload: Value) -> String {
    let script = find_qa_script(&sandbox.workspace);
    if !script.is_file() {
        return json!({
            "ok": false,
            "error": format!(
                "找不到 qa-browser.mjs（tried {}）。请到设置 → Agent → Playwright 安装。",
                script.display()
            )
        })
        .to_string();
    }
    let _ = fs::create_dir_all(sandbox.workspace.join("qa").join("runs"));
    let qa_cwd = qa_home_dir().unwrap_or_else(|_| {
        script
            .parent()
            .map(|p| p.to_path_buf())
            .unwrap_or_else(|| PathBuf::from("."))
    });
    let browsers = qa_cwd.join("browsers");
    let node_modules = qa_cwd.join("node_modules");
    let node_path = node_modules.to_string_lossy().to_string();
    let node = resolve_node_bin();
    let mut cmd = Command::new(&node);
    cmd.arg(&script)
        .arg(payload.to_string())
        .current_dir(&qa_cwd)
        .env("PLAYWRIGHT_BROWSERS_PATH", &browsers)
        .env("NODE_PATH", &node_path);
    hide_command_window(&mut cmd);
    let output = cmd.output();
    match output {
        Ok(o) => {
            let stdout = String::from_utf8_lossy(&o.stdout).trim().to_string();
            let stderr = String::from_utf8_lossy(&o.stderr).trim().to_string();
            if !stdout.is_empty() {
                stdout
            } else if !o.status.success() {
                json!({
                    "ok": false,
                    "error": if stderr.is_empty() {
                        format!("qa-browser exit {}", o.status)
                    } else {
                        stderr.chars().take(800).collect::<String>()
                    }
                })
                .to_string()
            } else {
                json!({ "ok": true, "note": "empty stdout" }).to_string()
            }
        }
        Err(e) => json!({
            "ok": false,
            "error": format!("无法启动 node qa-browser.mjs: {e}。请安装 Node LTS 并在设置中安装 Playwright。")
        })
        .to_string(),
    }
}

pub fn tool_browser_open(sandbox: &PathSandbox, args: &Value) -> String {
    let url = args
        .get("url")
        .and_then(|v| v.as_str())
        .unwrap_or("about:blank");
    run_qa_browser(
        sandbox,
        json!({
            "action": "open",
            "url": url,
            "workspace": sandbox.workspace.display().to_string()
        }),
    )
}

pub fn tool_browser_goto(sandbox: &PathSandbox, args: &Value) -> String {
    let url = args.get("url").and_then(|v| v.as_str()).unwrap_or("");
    if url.is_empty() {
        return "browser_goto 需要 url".into();
    }
    run_qa_browser(
        sandbox,
        json!({
            "action": "goto",
            "url": url,
            "workspace": sandbox.workspace.display().to_string()
        }),
    )
}

pub fn tool_browser_click(sandbox: &PathSandbox, args: &Value) -> String {
    let selector = args.get("selector").and_then(|v| v.as_str()).unwrap_or("");
    if selector.is_empty() {
        return "browser_click 需要 selector".into();
    }
    run_qa_browser(
        sandbox,
        json!({
            "action": "click",
            "selector": selector,
            "workspace": sandbox.workspace.display().to_string()
        }),
    )
}

pub fn tool_browser_type(sandbox: &PathSandbox, args: &Value) -> String {
    let selector = args.get("selector").and_then(|v| v.as_str()).unwrap_or("");
    let text = args.get("text").and_then(|v| v.as_str()).unwrap_or("");
    if selector.is_empty() {
        return "browser_type 需要 selector".into();
    }
    run_qa_browser(
        sandbox,
        json!({
            "action": "type",
            "selector": selector,
            "text": text,
            "workspace": sandbox.workspace.display().to_string()
        }),
    )
}

pub fn tool_browser_assert(sandbox: &PathSandbox, args: &Value) -> String {
    run_qa_browser(
        sandbox,
        json!({
            "action": "assert",
            "selector": args.get("selector").and_then(|v| v.as_str()).unwrap_or(""),
            "text": args.get("text").and_then(|v| v.as_str()),
            "workspace": sandbox.workspace.display().to_string()
        }),
    )
}

pub fn tool_browser_screenshot(sandbox: &PathSandbox, args: &Value) -> String {
    let name = args
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or("shot.png");
    run_qa_browser(
        sandbox,
        json!({
            "action": "screenshot",
            "name": name,
            "workspace": sandbox.workspace.display().to_string()
        }),
    )
}

pub fn tool_defect_write(sandbox: &PathSandbox, args: &Value) -> String {
    let ts = now_secs();
    let run_dir = sandbox
        .workspace
        .join("qa")
        .join("runs")
        .join(ts.to_string());
    if let Err(e) = fs::create_dir_all(&run_dir) {
        return format!("创建缺陷目录失败: {e}");
    }
    let path = run_dir.join("defects.jsonl");
    let id = args
        .get("id")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| format!("def_{ts}"));
    let row = json!({
        "id": id,
        "title": args.get("title").and_then(|v| v.as_str()).unwrap_or(""),
        "severity": args.get("severity").and_then(|v| v.as_str()).unwrap_or("major"),
        "type": args.get("type").and_then(|v| v.as_str()).unwrap_or("functional"),
        "steps": args.get("steps").cloned().unwrap_or(json!([])),
        "expected": args.get("expected").and_then(|v| v.as_str()).unwrap_or(""),
        "actual": args.get("actual").and_then(|v| v.as_str()).unwrap_or(""),
        "screenshotPath": args.get("screenshotPath").and_then(|v| v.as_str()).unwrap_or(""),
        "targetPath": args.get("targetPath").and_then(|v| v.as_str()).unwrap_or(""),
        "status": args.get("status").and_then(|v| v.as_str()).unwrap_or("open"),
    });
    match fs::OpenOptions::new().create(true).append(true).open(&path) {
        Ok(mut f) => {
            if let Err(e) = writeln!(f, "{row}") {
                return format!("写入缺陷失败: {e}");
            }
            format!("已写入缺陷 → {}", path.display())
        }
        Err(e) => format!("打开缺陷文件失败: {e}"),
    }
}

pub fn tool_defect_assign_fix(args: &Value) -> String {
    let target = args
        .get("targetPath")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let title = args.get("title").and_then(|v| v.as_str()).unwrap_or("缺陷");
    let defect_id = args.get("id").and_then(|v| v.as_str()).unwrap_or("");
    format!(
        "请用 ide_open 打开 `{target}`，一次只修一个缺陷（{defect_id} · {title}）。修完后更新 defects.jsonl 的 status。"
    )
}

fn read_xu_defects(workspace: &Path) -> Vec<Value> {
    let path = workspace.join(".xu").join("defects.jsonl");
    let Ok(raw) = fs::read_to_string(&path) else {
        return Vec::new();
    };
    raw.lines()
        .filter_map(|line| {
            let t = line.trim();
            if t.is_empty() {
                return None;
            }
            serde_json::from_str(t).ok()
        })
        .collect()
}

fn write_xu_defects(workspace: &Path, rows: &[Value]) -> Result<(), String> {
    let dir = workspace.join(".xu");
    fs::create_dir_all(&dir).map_err(|e| format!("创建 .xu 失败: {e}"))?;
    let path = dir.join("defects.jsonl");
    let mut body = String::new();
    for row in rows {
        body.push_str(&row.to_string());
        body.push('\n');
    }
    fs::write(&path, body).map_err(|e| format!("写入 defects.jsonl 失败: {e}"))
}

fn format_defect_fix_task(defect: &Value, project_hint: &str) -> String {
    let id = defect
        .get("id")
        .and_then(|v| v.as_str())
        .unwrap_or("defect");
    let title = defect
        .get("title")
        .and_then(|v| v.as_str())
        .unwrap_or("缺陷");
    let severity = defect
        .get("severity")
        .and_then(|v| v.as_str())
        .unwrap_or("major");
    let dtype = defect
        .get("type")
        .and_then(|v| v.as_str())
        .unwrap_or("bug");
    let steps = defect
        .get("steps")
        .map(|v| {
            if let Some(s) = v.as_str() {
                s.to_string()
            } else {
                v.to_string()
            }
        })
        .unwrap_or_default();
    let expected = defect
        .get("expected")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let actual = defect
        .get("actual")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let screenshot = defect
        .get("screenshotPath")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let target = defect
        .get("targetPath")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let mut lines = vec![
        if project_hint.is_empty() {
            String::new()
        } else {
            format!("【项目】{project_hint}")
        },
        format!("【修缺陷】一次只修这一条：{id}"),
        format!("标题：{title}"),
        format!("类型：{dtype} · 严重度：{severity}"),
        format!("步骤：{steps}"),
        format!("期望：{expected}"),
        format!("实际：{actual}"),
    ];
    if !screenshot.is_empty() {
        lines.push(format!("截图：{screenshot}"));
    }
    if !target.is_empty() {
        lines.push(format!(
            "请用 ide_open 打开：{target}，修复后把缺陷 status 标为 fixed 并简要说明改动。"
        ));
    } else {
        lines.push(
            "请定位相关代码，用 ide_open 打开后修复；修完汇报真实路径。".to_string(),
        );
    }
    lines.push("禁止同时接下一条缺陷。".to_string());
    lines.into_iter().filter(|s| !s.is_empty()).collect::<Vec<_>>().join("\n")
}

pub fn tool_run_ui_acceptance(sandbox: &PathSandbox, _args: &Value) -> String {
    let run_id = now_secs();
    run_qa_browser(
        sandbox,
        json!({
            "action": "run-scenario",
            "workspace": sandbox.workspace.display().to_string(),
            "runId": run_id.to_string(),
            "scenariosFile": ".xu/qa/ui-scenarios.json"
        }),
    )
}

pub fn tool_dispatch_defect_fix(sandbox: &PathSandbox, args: &Value) -> String {
    let mut rows = read_xu_defects(&sandbox.workspace);
    if rows.is_empty() {
        return json!({ "ok": false, "error": "未找到 .xu/defects.jsonl 或尚无缺陷" }).to_string();
    }
    let defect_id = args.get("defectId").and_then(|v| v.as_str()).map(str::trim);
    let assignee_role = args
        .get("assigneeRole")
        .and_then(|v| v.as_str())
        .unwrap_or("engineering");
    let pick_idx = if let Some(id) = defect_id.filter(|s| !s.is_empty()) {
        rows.iter().position(|d| d.get("id").and_then(|v| v.as_str()) == Some(id))
    } else {
        rows.iter().position(|d| {
            let status = d.get("status").and_then(|v| v.as_str()).unwrap_or("");
            (status == "open" || status == "retest")
                && matches!(
                    d.get("severity").and_then(|v| v.as_str()),
                    Some("critical") | Some("major")
                )
        }).or_else(|| {
            rows.iter().position(|d| {
                let status = d.get("status").and_then(|v| v.as_str()).unwrap_or("");
                status == "open" || status == "retest"
            })
        })
    };
    let Some(idx) = pick_idx else {
        return json!({ "ok": false, "error": "未找到可派修的 open/retest 缺陷" }).to_string();
    };
    let defect = rows[idx].clone();
    let id = defect
        .get("id")
        .and_then(|v| v.as_str())
        .unwrap_or("defect")
        .to_string();
    let title = defect
        .get("title")
        .and_then(|v| v.as_str())
        .unwrap_or("缺陷")
        .to_string();
    if let Some(obj) = rows[idx].as_object_mut() {
        obj.insert("status".into(), json!("fixing"));
    }
    if let Err(e) = write_xu_defects(&sandbox.workspace, &rows) {
        return json!({ "ok": false, "error": e }).to_string();
    }
    let task = format_defect_fix_task(&defect, "");
    json!({
        "ok": true,
        "dispatch": true,
        "defectId": id,
        "title": title,
        "assigneeRole": assignee_role,
        "task": task,
        "officeHint": format!("QA 已派 @开发岗 修复 {id}：{title}")
    })
    .to_string()
}

fn tool_def(name: &str, description: &str, properties: Value, required: &[&str]) -> Value {
    json!({
        "type": "function",
        "function": {
            "name": name,
            "description": description,
            "parameters": {
                "type": "object",
                "properties": properties,
                "required": required
            }
        }
    })
}

pub fn openai_qa_tool_defs() -> Vec<Value> {
    vec![
        tool_def(
            "browser_open",
            "通过 Playwright QA 助手打开 Chromium。需审批。",
            json!({ "url": { "type": "string", "description": "起始 URL" } }),
            &[],
        ),
        tool_def(
            "browser_goto",
            "让 QA 浏览器导航到指定 URL。",
            json!({ "url": { "type": "string", "description": "目标 URL" } }),
            &["url"],
        ),
        tool_def(
            "browser_click",
            "在 QA 浏览器中点击 CSS 选择器。需审批。",
            json!({ "selector": { "type": "string", "description": "CSS 选择器" } }),
            &["selector"],
        ),
        tool_def(
            "browser_type",
            "在 QA 浏览器内向 CSS 选择器输入文本。需审批。",
            json!({
                "selector": { "type": "string", "description": "CSS 选择器" },
                "text": { "type": "string", "description": "输入内容" }
            }),
            &["selector", "text"],
        ),
        tool_def(
            "browser_assert",
            "断言选择器可见，并可检查文本子串。",
            json!({
                "selector": { "type": "string", "description": "CSS 选择器" },
                "text": { "type": "string", "description": "期望包含的文本" }
            }),
            &[],
        ),
        tool_def(
            "browser_screenshot",
            "截图保存到 qa/runs/ 目录。",
            json!({ "name": { "type": "string", "description": "截图文件名" } }),
            &[],
        ),
        tool_def(
            "defect_write",
            "向 qa/runs/{时间戳}/defects.jsonl 追加一条缺陷记录。",
            json!({
                "id": { "type": "string" },
                "title": { "type": "string", "description": "缺陷标题" },
                "severity": { "type": "string", "description": "严重程度" },
                "type": { "type": "string", "description": "缺陷类型" },
                "steps": { "type": "array", "items": { "type": "string" }, "description": "复现步骤" },
                "expected": { "type": "string", "description": "期望结果" },
                "actual": { "type": "string", "description": "实际结果" },
                "screenshotPath": { "type": "string", "description": "截图路径" },
                "targetPath": { "type": "string", "description": "待修文件路径" },
                "status": { "type": "string", "description": "状态" }
            }),
            &["title"],
        ),
        tool_def(
            "defect_assign_fix",
            "返回指引文本：用 ide_open 打开 targetPath 并一次只修一个缺陷。",
            json!({
                "id": { "type": "string" },
                "title": { "type": "string" },
                "targetPath": { "type": "string" }
            }),
            &[],
        ),
        tool_def(
            "run_ui_acceptance",
            "批跑 .xu/qa/ui-scenarios.json（Playwright）；失败写入 qa/runs 截图。需审批。",
            json!({}),
            &[],
        ),
        tool_def(
            "dispatch_defect_fix",
            "读取 open 缺陷并标记 fixing，返回可派修任务（系统将派给开发岗）。需审批。",
            json!({
                "defectId": { "type": "string", "description": "缺陷 ID；空则取首条 P0/P1" },
                "assigneeRole": { "type": "string", "description": "默认 engineering" }
            }),
            &[],
        ),
    ]
}
