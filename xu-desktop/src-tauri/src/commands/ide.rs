//! Probe installed IDE CLIs and open a workspace in the chosen editor.

use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Command;

use serde::Serialize;

use crate::agent::tools::map_ide_alias_pub;
use crate::xu_paths::hide_command_window;

#[derive(Serialize)]
pub struct IdeProbeResult {
    pub cursor: bool,
    pub vscode: bool,
    pub trae: bool,
    pub qoder: bool,
    pub jetbrains: bool,
    pub windsurf: bool,
    pub zed: bool,
    pub paths: HashMap<String, String>,
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

fn probe_first(paths: &mut HashMap<String, String>, key: &str, cli_names: &[&str]) -> bool {
    for name in cli_names {
        if let Some(p) = resolve_cli(name) {
            paths.insert(key.to_string(), p);
            return true;
        }
    }
    false
}

/// Scan PATH for IDE CLIs. Does not search install folders.
#[tauri::command]
pub fn xu_probe_ide_clis() -> IdeProbeResult {
    let mut paths = HashMap::new();
    let jetbrains = probe_first(
        &mut paths,
        "jetbrains",
        &[
            "idea", "webstorm", "pycharm", "goland", "rider", "clion", "phpstorm",
        ],
    );
    IdeProbeResult {
        cursor: probe_first(&mut paths, "cursor", &["cursor"]),
        vscode: probe_first(&mut paths, "vscode", &["code"]),
        trae: probe_first(&mut paths, "trae", &["trae"]),
        qoder: probe_first(&mut paths, "qoder", &["qoder"]),
        jetbrains,
        windsurf: probe_first(&mut paths, "windsurf", &["windsurf"]),
        zed: probe_first(&mut paths, "zed", &["zed"]),
        paths,
    }
}

/// Open the workspace folder in the given IDE CLI (e.g. `cursor <dir>`).
#[tauri::command]
pub fn xu_open_ide_workspace(workspace: String, cli: String) -> Result<String, String> {
    let ws = PathBuf::from(workspace.trim());
    if !ws.is_dir() {
        return Err("工作区不是有效目录".into());
    }
    let trimmed = cli.trim();
    let mapped = if trimmed.contains('/') || trimmed.contains('\\') {
        trimmed.to_string()
    } else {
        map_ide_alias_pub(trimmed)
    };
    if mapped.is_empty() {
        return Err("未指定 IDE CLI".into());
    }
    let mut cmd = Command::new(&mapped);
    cmd.arg(&ws);
    hide_command_window(&mut cmd);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd.spawn()
        .map(|_| format!("已用 {mapped} 打开工作区"))
        .map_err(|e| format!("打开 IDE 失败（请确认已安装并将 CLI 加入 PATH）：{e}"))
}
