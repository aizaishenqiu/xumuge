//! Cursor SDK / CLI 探测与 sidecar 派活桥接。
//!
//! @file cursor_sdk.rs
//! @author qiuye <yjk150@qq.com>
//! @date 2026-09-02
//! @updated 2026-09-03
//! @version 0.2.1
//! @category Network
//! @algo cursor-sdk-sidecar-ndjson

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::io::{BufRead, Write};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::time::Duration;

use tauri::{AppHandle, Manager, State};

use crate::desktop_db::FouDb;
use crate::xu_paths::hide_command_window;

pub const CURSOR_API_KEY_ENV: &str = "CURSOR_API_KEY";
const DRIVE_USE_SDK_KEY: &str = "xu.drive.use_sdk";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CursorSdkProbe {
    pub cli_available: bool,
    pub api_key_configured: bool,
    pub sdk_agent_ready: bool,
    /// 编码驾驶 SDK 开关是否可用（CLI 或 SDK Agent 任一就绪）
    pub sdk_ready: bool,
    pub cli_path: String,
    pub detail: String,
}

#[derive(Debug, Deserialize)]
struct SidecarLine {
    #[serde(rename = "type")]
    kind: String,
    #[serde(default)]
    ok: bool,
    #[serde(default)]
    detail: String,
    #[serde(default)]
    message: String,
    #[serde(default)]
    text: String,
    /// sidecar 偶发带 status，反序列化保留；业务暂不读。
    #[serde(default)]
    #[allow(dead_code)]
    status: String,
}

#[cfg(target_os = "windows")]
fn resolve_cli(name: &str) -> Option<String> {
    let mut cmd = Command::new("where");
    hide_command_window(cmd.arg(name));
    if let Ok(out) = cmd.output() {
        if out.status.success() {
            let first = String::from_utf8_lossy(&out.stdout)
                .lines()
                .next()
                .unwrap_or("")
                .trim()
                .to_string();
            if !first.is_empty() {
                return Some(first);
            }
        }
    }
    None
}

#[cfg(not(target_os = "windows"))]
fn resolve_cli(name: &str) -> Option<String> {
    for shell in &["/bin/zsh", "/bin/bash"] {
        let mut cmd = Command::new(shell);
        hide_command_window(cmd.args(["-l", "-c", &format!("command -v {name} 2>/dev/null")]));
        if let Ok(out) = cmd.output() {
            if out.status.success() {
                let p = String::from_utf8_lossy(&out.stdout).trim().to_string();
                if !p.is_empty() {
                    return Some(p);
                }
            }
        }
    }
    None
}

fn which_node() -> &'static str {
    if cfg!(windows) {
        "node.exe"
    } else {
        "node"
    }
}

pub fn sidecar_script(app: Option<&AppHandle>, folder: &str) -> Option<PathBuf> {
    if let Some(app) = app {
        if let Ok(resource) = app.path().resource_dir() {
            let p = resource.join(folder).join("index.mjs");
            if p.exists() {
                return Some(p);
            }
        }
    }
    if let Ok(p) = std::env::var("XU_RESOURCE_DIR") {
        let s = PathBuf::from(p).join(folder).join("index.mjs");
        if s.exists() {
            return Some(s);
        }
    }
    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("tools")
        .join(folder)
        .join("index.mjs");
    if dev.exists() {
        Some(dev)
    } else {
        None
    }
}

#[tauri::command]
pub fn xu_bundled_tool_script(app: AppHandle, folder: String) -> Result<String, String> {
    let f = folder.trim();
    if f.is_empty() {
        return Err("folder 为空".into());
    }
    sidecar_script(Some(&app), f)
        .ok_or_else(|| format!("未找到 {f}/index.mjs"))
        .map(|p| p.display().to_string())
}

fn resolve_api_key(db: &FouDb) -> Option<String> {
    let conn = db.0.lock().ok()?;
    crate::desktop_db::resolve_api_key(CURSOR_API_KEY_ENV, Some(&conn)).ok()
}

pub fn api_key_configured(db: &FouDb) -> bool {
    let conn = match db.0.lock() {
        Ok(c) => c,
        Err(_) => return false,
    };
    crate::desktop_db::api_key_configured(&conn, CURSOR_API_KEY_ENV).unwrap_or(false)
}

pub fn drive_use_sdk_enabled(db: &FouDb) -> bool {
    let conn = match db.0.lock() {
        Ok(c) => c,
        Err(_) => return false,
    };
    crate::desktop_db::setting_get(&conn, DRIVE_USE_SDK_KEY)
        .ok()
        .flatten()
        .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
        .unwrap_or(false)
}

fn run_sidecar_once(
    app: Option<&AppHandle>,
    db: &FouDb,
    cmd: &Value,
    timeout: Duration,
) -> Result<SidecarLine, String> {
    let script = sidecar_script(app, "cursor-sdk-bridge").ok_or("cursor-sdk-bridge 脚本未找到")?;
    let api_key = resolve_api_key(db).ok_or("CURSOR_API_KEY 未配置")?;
    let mut child = Command::new(which_node());
    hide_command_window(child.arg(&script).arg("--oneshot"));
    child
        .env(CURSOR_API_KEY_ENV, api_key)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    let mut child = child.spawn().map_err(|e| format!("启动 sidecar 失败：{e}"))?;
    if let Some(mut stdin) = child.stdin.take() {
        let line = cmd.to_string();
        writeln!(stdin, "{line}").map_err(|e| format!("写入 sidecar 失败：{e}"))?;
    }
    let stdout = child.stdout.take().ok_or("sidecar stdout 不可用")?;
    let reader = std::io::BufReader::new(stdout);
    let started = std::time::Instant::now();
    let mut last: Option<SidecarLine> = None;
    for line in reader.lines().map_while(Result::ok) {
        if started.elapsed() > timeout {
            let _ = child.kill();
            return Err("Cursor SDK sidecar 超时".into());
        }
        if let Ok(parsed) = serde_json::from_str::<SidecarLine>(&line) {
            if parsed.kind == "result" || parsed.kind == "error" {
                last = Some(parsed);
                break;
            }
        }
    }
    let _ = child.wait();
    last.ok_or_else(|| "sidecar 无响应".into())
}

pub fn probe_sdk_agent(app: Option<&AppHandle>, db: &FouDb) -> bool {
    let cmd = serde_json::json!({ "type": "probe" });
    match run_sidecar_once(app, db, &cmd, Duration::from_secs(45)) {
        Ok(line) => line.kind == "result" && line.ok,
        Err(_) => false,
    }
}

pub fn run_sdk_prompt(
    app: Option<&AppHandle>,
    db: &FouDb,
    cwd: &str,
    prompt: &str,
    model: Option<&str>,
) -> Result<String, String> {
    let mut cmd = serde_json::json!({
        "type": "prompt",
        "cwd": cwd,
        "text": prompt,
    });
    if let Some(m) = model.filter(|s| !s.trim().is_empty()) {
        cmd["model"] = Value::String(m.trim().to_string());
    }
    let line = run_sidecar_once(app, db, &cmd, Duration::from_secs(600))?;
    if line.kind == "error" {
        return Err(if line.message.is_empty() {
            "Cursor SDK 调用失败".into()
        } else {
            line.message
        });
    }
    if !line.ok {
        return Err(if line.detail.is_empty() {
            "Cursor SDK 未就绪".into()
        } else {
            line.detail
        });
    }
    Ok(if line.text.is_empty() {
        line.detail
    } else {
        line.text
    })
}

pub fn cursor_sdk_tool_allowed(db: &FouDb, policy_allows_ide: bool) -> bool {
    policy_allows_ide && drive_use_sdk_enabled(db) && api_key_configured(db)
}

/// 探测 Cursor CLI 与 SDK sidecar。
#[tauri::command]
pub fn xu_probe_cursor_sdk(app: AppHandle, db: State<'_, FouDb>) -> CursorSdkProbe {
    let path = resolve_cli("cursor").unwrap_or_default();
    let cli_available = !path.is_empty();
    let api_key_configured = api_key_configured(&db);
    let sdk_agent_ready = if api_key_configured {
        probe_sdk_agent(Some(&app), &db)
    } else {
        false
    };
    let sdk_ready = cli_available || sdk_agent_ready;
    let detail = if sdk_agent_ready {
        "已接入 Cursor SDK（@cursor/sdk sidecar）；可委托 Agent 派活。CLI 仍可用于打开工作区。".into()
    } else if api_key_configured {
        "已保存 Cursor API Key，但 SDK sidecar 探测未通过。请确认已安装 cursor-sdk-bridge 依赖。".into()
    } else if cli_available {
        "已检测到 Cursor CLI，可打开工作区。填写 Cursor API Key 后可启用 SDK 派活。".into()
    } else {
        "未检测到 Cursor CLI。请在 Cursor 安装 Shell 命令，或改用内置虚募阁 IDE。".into()
    };
    CursorSdkProbe {
        cli_available,
        api_key_configured,
        sdk_agent_ready,
        sdk_ready,
        cli_path: path,
        detail,
    }
}

/// 单次 Cursor SDK prompt（编码驾驶旁路）。
#[tauri::command]
pub fn xu_cursor_sdk_run_prompt(
    app: AppHandle,
    db: State<'_, FouDb>,
    cwd: String,
    prompt: String,
    model: Option<String>,
) -> Result<String, String> {
    let c = cwd.trim();
    if c.is_empty() {
        return Err("工作区路径为空".into());
    }
    if prompt.trim().is_empty() {
        return Err("prompt 为空".into());
    }
    run_sdk_prompt(Some(&app), &db, c, prompt.trim(), model.as_deref())
}

/// 打开 Cursor 工作区（优先 CLI）。
#[tauri::command]
pub fn xu_cursor_sdk_open_workspace(path: String) -> Result<String, String> {
    let p = path.trim();
    if p.is_empty() {
        return Err("路径为空".into());
    }
    let cli = resolve_cli("cursor").ok_or("未检测到 Cursor CLI")?;
    let mut cmd = Command::new(&cli);
    hide_command_window(cmd.arg(p));
    let out = cmd
        .spawn()
        .map_err(|e| format!("启动 Cursor 失败：{e}"))?;
    Ok(format!("已请求打开（pid={})", out.id()))
}

#[tauri::command]
pub fn xu_set_drive_use_sdk(db: State<'_, FouDb>, enabled: bool) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    crate::desktop_db::setting_set(
        &conn,
        DRIVE_USE_SDK_KEY,
        if enabled { "1" } else { "0" },
    )
}

#[tauri::command]
pub fn xu_probe_ide_clis_map() -> HashMap<String, String> {
    let mut m = HashMap::new();
    if let Some(p) = resolve_cli("cursor") {
        m.insert("cursor".into(), p);
    }
    m
}
