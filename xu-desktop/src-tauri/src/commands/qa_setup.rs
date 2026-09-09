//! Playwright / QA browser: install under `{XU_HOME}/qa/` (MSI-safe).

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use serde_json::{json, Value};
use tauri::AppHandle;

use crate::xu_paths::{hide_command_window, xu_home};

const QA_BROWSER_MJS: &str = include_str!("../../../scripts/qa-browser.mjs");
const QA_PACKAGE_JSON: &str = r#"{
  "name": "xu-qa-runtime",
  "private": true,
  "type": "module",
  "dependencies": {
    "playwright": "^1.49.0"
  }
}
"#;

fn run_cmd(cmd: &str, args: &[&str], cwd: Option<&Path>, envs: &[(&str, &str)]) -> (bool, String) {
    let mut c = Command::new(cmd);
    c.args(args);
    if let Some(d) = cwd {
        c.current_dir(d);
    }
    for (k, v) in envs {
        c.env(k, v);
    }
    hide_command_window(&mut c);
    match c.output() {
        Ok(o) => {
            let out = String::from_utf8_lossy(&o.stdout).to_string()
                + &String::from_utf8_lossy(&o.stderr);
            (o.status.success(), out.trim().to_string())
        }
        Err(e) => (false, e.to_string()),
    }
}

/// Prefer real `node.exe` on Windows (CREATE_NO_WINDOW cannot spawn `.cmd`).
#[cfg(target_os = "windows")]
fn resolve_node_exe() -> Option<PathBuf> {
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
    if let Ok(pf86) = std::env::var("ProgramFiles(x86)") {
        candidates.push(PathBuf::from(pf86).join("nodejs").join("node.exe"));
    }
    for c in &candidates {
        if c.extension().and_then(|e| e.to_str()) == Some("exe") && c.is_file() {
            return Some(c.clone());
        }
        if c.file_name().and_then(|n| n.to_str()) == Some("node") && c.is_file() {
            return Some(c.clone());
        }
        // where often returns node.cmd — try sibling node.exe
        if let Some(parent) = c.parent() {
            let exe = parent.join("node.exe");
            if exe.is_file() {
                return Some(exe);
            }
        }
    }
    None
}

#[cfg(not(target_os = "windows"))]
fn resolve_node_exe() -> Option<PathBuf> {
    for shell in &["/bin/zsh", "/bin/bash"] {
        let mut cmd = Command::new(shell);
        hide_command_window(cmd.args(["-l", "-c", "command -v node 2>/dev/null"]));
        if let Ok(out) = cmd.output() {
            if out.status.success() {
                let p = PathBuf::from(String::from_utf8_lossy(&out.stdout).trim());
                if p.is_file() {
                    return Some(p);
                }
            }
        }
    }
    None
}

#[cfg(target_os = "windows")]
fn resolve_npm_cli(node_exe: &Path) -> Option<PathBuf> {
    if let Some(parent) = node_exe.parent() {
        let cand = parent.join("node_modules").join("npm").join("bin").join("npm-cli.js");
        if cand.is_file() {
            return Some(cand);
        }
    }
    None
}

#[cfg(not(target_os = "windows"))]
fn resolve_npm_cli(_node_exe: &Path) -> Option<PathBuf> {
    None
}

/// Duty: `{XU_HOME}/qa` root for scripts, node_modules, browsers.
pub fn qa_home_dir() -> Result<PathBuf, String> {
    let home = xu_home()?;
    let qa = home.join("qa");
    fs::create_dir_all(&qa).map_err(|e| format!("mkdir qa home: {e}"))?;
    fs::create_dir_all(qa.join("browsers")).map_err(|e| format!("mkdir qa browsers: {e}"))?;
    Ok(qa)
}

fn ensure_qa_runtime_files(qa: &Path) -> Result<(), String> {
    let script = qa.join("qa-browser.mjs");
    fs::write(&script, QA_BROWSER_MJS).map_err(|e| format!("write qa-browser.mjs: {e}"))?;
    let pkg = qa.join("package.json");
    if !pkg.is_file() {
        fs::write(&pkg, QA_PACKAGE_JSON).map_err(|e| format!("write package.json: {e}"))?;
    }
    Ok(())
}

fn browsers_path(qa: &Path) -> PathBuf {
    qa.join("browsers")
}

fn playwright_pkg_ok(qa: &Path) -> bool {
    qa.join("node_modules")
        .join("playwright")
        .join("package.json")
        .is_file()
}

fn playwright_cli(qa: &Path) -> PathBuf {
    qa.join("node_modules").join("playwright").join("cli.js")
}

/// Kept for callers; now returns `{XU_HOME}/qa` (not MSI repo root).
pub fn find_repo_root() -> PathBuf {
    qa_home_dir().unwrap_or_else(|_| PathBuf::from("."))
}

#[tauri::command]
pub fn xu_app_repo_root() -> String {
    find_repo_root().to_string_lossy().to_string()
}

#[tauri::command]
pub fn xu_qa_playwright_status(_project_root: Option<String>) -> Value {
    let qa = match qa_home_dir() {
        Ok(p) => p,
        Err(e) => {
            return json!({
                "nodeOk": false,
                "nodeVersion": "",
                "npmOk": false,
                "playwrightInstalled": false,
                "qaScriptOk": false,
                "ready": false,
                "projectRoot": "",
                "qaHome": "",
                "error": e,
            });
        }
    };
    let _ = ensure_qa_runtime_files(&qa);
    let script_ok = qa.join("qa-browser.mjs").is_file();
    let node = resolve_node_exe();
    let node_bin = node
        .as_ref()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|| "node".into());
    let (node_ok, node_ver) = run_cmd(&node_bin, &["--version"], Some(&qa), &[]);
    let npm_ok = resolve_npm_cli(Path::new(&node_bin)).is_some()
        || run_cmd(&node_bin, &["-e", "process.exit(0)"], Some(&qa), &[]).0;
    let pw_installed = playwright_pkg_ok(&qa);
    let browsers = browsers_path(&qa);
    let browsers_hint = browsers.is_dir();
    json!({
        "nodeOk": node_ok,
        "nodeVersion": if node_ok { node_ver } else { String::new() },
        "npmOk": npm_ok,
        "playwrightInstalled": pw_installed,
        "qaScriptOk": script_ok,
        "ready": node_ok && pw_installed && script_ok,
        "projectRoot": qa.to_string_lossy(),
        "qaHome": qa.to_string_lossy(),
        "browsersPath": browsers.to_string_lossy(),
        "browsersReady": browsers_hint,
    })
}

#[tauri::command]
pub fn xu_qa_playwright_install(
    _app: AppHandle,
    _project_root: Option<String>,
) -> Result<String, String> {
    let qa = qa_home_dir()?;
    ensure_qa_runtime_files(&qa)?;
    let node = resolve_node_exe().ok_or_else(|| {
        "未检测到 Node.js。请安装 Node LTS（https://nodejs.org），安装后重启虚募阁再点「安装」。"
            .to_string()
    })?;
    let node_bin = node.to_string_lossy().to_string();
    let (ok_ver, ver) = run_cmd(&node_bin, &["--version"], Some(&qa), &[]);
    if !ok_ver {
        return Err(format!(
            "无法启动 Node（{}）。请安装 Node LTS 后重试。详情：{}",
            node_bin,
            ver.chars().take(200).collect::<String>()
        ));
    }

    if !playwright_pkg_ok(&qa) {
        let (ok_inst, out_inst) = if let Some(npm_cli) = resolve_npm_cli(&node) {
            let npm_cli_s = npm_cli.to_string_lossy().to_string();
            run_cmd(
                &node_bin,
                &[
                    npm_cli_s.as_str(),
                    "install",
                    "playwright@^1.49.0",
                    "--no-fund",
                    "--no-audit",
                ],
                Some(&qa),
                &[],
            )
        } else {
            // Fallback: node can still fetch via corepack-less npm if on PATH as .js
            #[cfg(target_os = "windows")]
            {
                // Use cmd /C without relying on CREATE_NO_WINDOW for .cmd — spawn cmd.exe is OK
                let mut c = Command::new("cmd");
                c.args(["/C", "npm", "install", "playwright@^1.49.0", "--no-fund", "--no-audit"])
                    .current_dir(&qa);
                // Do NOT set CREATE_NO_WINDOW on cmd+npm.cmd (program not found).
                match c.output() {
                    Ok(o) => {
                        let out = String::from_utf8_lossy(&o.stdout).to_string()
                            + &String::from_utf8_lossy(&o.stderr);
                        (o.status.success(), out.trim().to_string())
                    }
                    Err(e) => (false, e.to_string()),
                }
            }
            #[cfg(not(target_os = "windows"))]
            {
                run_cmd(
                    "npm",
                    &["install", "playwright@^1.49.0", "--no-fund", "--no-audit"],
                    Some(&qa),
                    &[],
                )
            }
        };
        if !ok_inst || !playwright_pkg_ok(&qa) {
            return Err(format!(
                "在 {{XU_HOME}}/qa 安装 playwright 失败: {}",
                out_inst.chars().take(400).collect::<String>()
            ));
        }
    }

    let cli = playwright_cli(&qa);
    if !cli.is_file() {
        return Err("playwright 已安装但找不到 cli.js，请删除 {XU_HOME}/qa/node_modules 后重试。".into());
    }
    let browsers = browsers_path(&qa);
    let browsers_s = browsers.to_string_lossy().to_string();
    let cli_s = cli.to_string_lossy().to_string();
    let (ok2, out2) = run_cmd(
        &node_bin,
        &[cli_s.as_str(), "install", "chromium"],
        Some(&qa),
        &[("PLAYWRIGHT_BROWSERS_PATH", browsers_s.as_str())],
    );
    if !ok2 {
        return Err(format!(
            "playwright install chromium 失败: {}",
            out2.chars().take(400).collect::<String>()
        ));
    }
    Ok(format!(
        "Playwright 已安装到 {}（Chromium → {}，Node {}）",
        qa.to_string_lossy(),
        browsers.to_string_lossy(),
        ver
    ))
}

#[tauri::command]
pub fn xu_run_qa_browser(workspace: String, payload: Value) -> Result<String, String> {
    let ws = workspace.trim();
    if ws.is_empty() {
        return Err("workspace 为空".into());
    }
    let sandbox = crate::agent::tools::PathSandbox {
        workspace: PathBuf::from(ws),
        read_extra: Vec::new(),
        ide_cli: "cursor".into(),
        gui_consent: false,
        gui_experimental: false,
        gui_window_allowlist: Vec::new(),
        snapshot_batch: None,
    };
    Ok(crate::agent::qa_tools::run_qa_browser(&sandbox, payload))
}
