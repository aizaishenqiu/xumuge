//! TypeScript tsserver 会话：诊断 / 悬停 / 跳转定义（工作区 typescript）。
//!
//! @author qiuye <yjk150@qq.com>
//! @date 2026-09-07
//! @updated 2026-09-07
//! @version 1.0.0
//! @category ToolPolicy
//! @algo tsserver-content-length-session

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{mpsc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use crate::agent::process_control::{configure_background, terminate_process_tree};
use crate::commands::lint::LintDiagnostic;

const MAX_MSG: usize = 8 * 1024 * 1024;
const DEFAULT_TIMEOUT: Duration = Duration::from_secs(20);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TsLocation {
    pub file: String,
    pub line: u32,
    pub column: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TsQuickInfo {
    pub display_string: String,
    pub documentation: String,
}

struct TsProcess {
    workspace: PathBuf,
    child: Child,
    stdin: ChildStdin,
    inbound: mpsc::Receiver<Value>,
    next_seq: u64,
    open_files: HashMap<String, u32>,
}

impl Drop for TsProcess {
    fn drop(&mut self) {
        let _ = terminate_process_tree(&mut self.child);
    }
}

fn sessions() -> &'static Mutex<HashMap<String, TsProcess>> {
    static S: OnceLock<Mutex<HashMap<String, TsProcess>>> = OnceLock::new();
    S.get_or_init(|| Mutex::new(HashMap::new()))
}

fn assert_under_workspace(workspace: &str, target: &str) -> Result<PathBuf, String> {
    let root = Path::new(workspace)
        .canonicalize()
        .map_err(|e| format!("无效工作区: {e}"))?;
    let file = Path::new(target)
        .canonicalize()
        .map_err(|e| format!("无效文件路径: {e}"))?;
    if !file.starts_with(&root) {
        return Err("路径不在工作区内".into());
    }
    Ok(file)
}

fn resolve_node() -> PathBuf {
    #[cfg(windows)]
    {
        which("node.exe").or_else(|| which("node")).unwrap_or_else(|| PathBuf::from("node"))
    }
    #[cfg(not(windows))]
    {
        which("node").unwrap_or_else(|| PathBuf::from("node"))
    }
}

fn which(name: &str) -> Option<PathBuf> {
    std::env::var_os("PATH").and_then(|paths| {
        for dir in std::env::split_paths(&paths) {
            let p = dir.join(name);
            if p.is_file() {
                return Some(p);
            }
        }
        None
    })
}

fn resolve_tsserver_js(workspace: &Path) -> Option<PathBuf> {
    let p = workspace
        .join("node_modules")
        .join("typescript")
        .join("lib")
        .join("tsserver.js");
    if p.is_file() {
        Some(p)
    } else {
        None
    }
}

fn script_kind(path: &Path) -> &'static str {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    match ext.as_str() {
        "tsx" => "TSX",
        "jsx" => "JSX",
        "js" | "mjs" | "cjs" => "JS",
        "mts" | "cts" => "TS",
        _ => "TS",
    }
}

fn is_ts_js_path(path: &Path) -> bool {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    matches!(
        ext.as_str(),
        "ts" | "tsx" | "mts" | "cts" | "js" | "jsx" | "mjs" | "cjs"
    )
}

fn norm_key(p: &Path) -> String {
    p.to_string_lossy().replace('\\', "/").to_ascii_lowercase()
}

fn write_framed(stdin: &mut ChildStdin, body: &str) -> Result<(), String> {
    let header = format!("Content-Length: {}\r\n\r\n", body.len());
    stdin
        .write_all(header.as_bytes())
        .map_err(|e| format!("写入 tsserver 失败: {e}"))?;
    stdin
        .write_all(body.as_bytes())
        .map_err(|e| format!("写入 tsserver 失败: {e}"))?;
    stdin.flush().map_err(|e| format!("刷新 tsserver 失败: {e}"))
}

fn read_framed(reader: &mut impl BufRead) -> Result<Option<Value>, String> {
    let mut content_length: Option<usize> = None;
    loop {
        let mut line = String::new();
        let n = reader
            .read_line(&mut line)
            .map_err(|e| format!("读取 tsserver 失败: {e}"))?;
        if n == 0 {
            return Ok(None);
        }
        let trimmed = line.trim_end_matches(['\r', '\n']);
        if trimmed.is_empty() {
            break;
        }
        if let Some(rest) = trimmed.strip_prefix("Content-Length:") {
            content_length = Some(
                rest.trim()
                    .parse()
                    .map_err(|_| "tsserver Content-Length 无效".to_string())?,
            );
        }
    }
    let len = content_length.ok_or_else(|| "tsserver 缺少 Content-Length".to_string())?;
    if len > MAX_MSG {
        return Err("tsserver 消息过大".into());
    }
    let mut buf = vec![0u8; len];
    Read::read_exact(reader, &mut buf)
        .map_err(|e| format!("读取 tsserver 正文失败: {e}"))?;
    let v: Value =
        serde_json::from_slice(&buf).map_err(|e| format!("解析 tsserver JSON 失败: {e}"))?;
    Ok(Some(v))
}

fn spawn_tsserver(workspace: &Path) -> Result<TsProcess, String> {
    let ts_js = resolve_tsserver_js(workspace).ok_or_else(|| {
        "工作区未安装 TypeScript。请在终端运行：pnpm add -D typescript".to_string()
    })?;
    let node = resolve_node();
    let mut command = Command::new(&node);
    command
        .arg(&ts_js)
        .arg("--disableAutomaticTypingAcquisition")
        .current_dir(workspace)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    configure_background(&mut command);
    let mut child = command
        .spawn()
        .map_err(|e| format!("无法启动 tsserver（请确认已安装 Node.js）: {e}"))?;
    let stdin = child.stdin.take().ok_or("tsserver stdin 不可用")?;
    let stdout = child.stdout.take().ok_or("tsserver stdout 不可用")?;
    let (tx, rx) = mpsc::sync_channel(512);
    std::thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        loop {
            match read_framed(&mut reader) {
                Ok(Some(v)) => {
                    if tx.send(v).is_err() {
                        break;
                    }
                }
                Ok(None) | Err(_) => break,
            }
        }
    });

    let mut proc = TsProcess {
        workspace: workspace.to_path_buf(),
        child,
        stdin,
        inbound: rx,
        next_seq: 1,
        open_files: HashMap::new(),
    };
    // Configure host for inferred projects (files without tsconfig).
    let _ = proc.request(
        "configure",
        serde_json::json!({
            "hostInfo": "xu-desktop",
            "preferences": {
                "includePackageJsonAutoImports": "off"
            }
        }),
        DEFAULT_TIMEOUT,
    );
    let _ = proc.request(
        "compilerOptionsForInferredProjects",
        serde_json::json!({
            "options": {
                "allowJs": true,
                "checkJs": true,
                "jsx": "react-jsx",
                "module": "esnext",
                "moduleResolution": "bundler",
                "target": "es2022",
                "strict": true,
                "skipLibCheck": true
            }
        }),
        DEFAULT_TIMEOUT,
    );
    Ok(proc)
}

impl TsProcess {
    fn next_seq(&mut self) -> u64 {
        let s = self.next_seq;
        self.next_seq = self.next_seq.saturating_add(1);
        s
    }

    fn request(&mut self, command: &str, arguments: Value, timeout: Duration) -> Result<Value, String> {
        let seq = self.next_seq();
        let body = serde_json::json!({
            "seq": seq,
            "type": "request",
            "command": command,
            "arguments": arguments,
        });
        let text = serde_json::to_string(&body).map_err(|e| e.to_string())?;
        write_framed(&mut self.stdin, &text)?;
        let deadline = Instant::now() + timeout;
        loop {
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return Err(format!("tsserver {command} 超时"));
            }
            let msg = self
                .inbound
                .recv_timeout(remaining)
                .map_err(|_| format!("tsserver {command} 超时"))?;
            let ty = msg.get("type").and_then(|t| t.as_str()).unwrap_or("");
            if ty == "response" && msg.get("request_seq").and_then(|s| s.as_u64()) == Some(seq) {
                if msg.get("success").and_then(|s| s.as_bool()) == Some(false) {
                    let m = msg
                        .get("message")
                        .and_then(|m| m.as_str())
                        .unwrap_or("tsserver 请求失败");
                    return Err(m.to_string());
                }
                return Ok(msg.get("body").cloned().unwrap_or(Value::Null));
            }
            // Discard unrelated events while waiting for this response.
        }
    }

    fn ensure_open(&mut self, file: &Path, content: &str) -> Result<(), String> {
        let key = norm_key(file);
        let file_str = file.to_string_lossy().to_string();
        if self.open_files.contains_key(&key) {
            let _ = self.request(
                "close",
                serde_json::json!({ "file": file_str }),
                DEFAULT_TIMEOUT,
            );
            self.open_files.remove(&key);
        }
        let _ = self.request(
            "open",
            serde_json::json!({
                "file": file_str,
                "fileContent": content,
                "scriptKindName": script_kind(file),
                "projectRootPath": self.workspace.to_string_lossy(),
            }),
            DEFAULT_TIMEOUT,
        )?;
        self.open_files.insert(key, 1);
        Ok(())
    }

    fn get_diagnostics(&mut self, file: &Path) -> Result<Vec<LintDiagnostic>, String> {
        let file_str = file.to_string_lossy().to_string();
        let seq = self.next_seq();
        let body = serde_json::json!({
            "seq": seq,
            "type": "request",
            "command": "geterr",
            "arguments": {
                "delay": 0,
                "files": [file_str]
            }
        });
        let text = serde_json::to_string(&body).map_err(|e| e.to_string())?;
        write_framed(&mut self.stdin, &text)?;

        let mut out: Vec<LintDiagnostic> = Vec::new();
        let deadline = Instant::now() + DEFAULT_TIMEOUT;
        loop {
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                break;
            }
            let msg = match self.inbound.recv_timeout(remaining) {
                Ok(m) => m,
                Err(_) => break,
            };
            let ty = msg.get("type").and_then(|t| t.as_str()).unwrap_or("");
            if ty == "event" {
                let event = msg.get("event").and_then(|e| e.as_str()).unwrap_or("");
                if event == "syntaxDiag" || event == "semanticDiag" {
                    if let Some(body) = msg.get("body") {
                        let file_path = body
                            .get("file")
                            .and_then(|f| f.as_str())
                            .unwrap_or(&file_str)
                            .to_string();
                        if let Some(diags) = body.get("diagnostics").and_then(|d| d.as_array()) {
                            for d in diags {
                                out.push(map_ts_diag(&file_path, d));
                            }
                        }
                    }
                } else if event == "requestCompleted" {
                    let done = msg
                        .get("body")
                        .and_then(|b| b.get("request_seq"))
                        .and_then(|s| s.as_u64());
                    if done == Some(seq) {
                        break;
                    }
                }
            }
        }
        Ok(out)
    }
}

fn map_ts_diag(file: &str, d: &Value) -> LintDiagnostic {
    let start = d.get("start").cloned().unwrap_or(Value::Null);
    let end = d.get("end").cloned().unwrap_or(start.clone());
    let line = start.get("line").and_then(|v| v.as_u64()).unwrap_or(1) as u32;
    let column = start.get("offset").and_then(|v| v.as_u64()).unwrap_or(1) as u32;
    let end_line = end.get("line").and_then(|v| v.as_u64()).unwrap_or(line as u64) as u32;
    let end_column = end
        .get("offset")
        .and_then(|v| v.as_u64())
        .unwrap_or(column as u64) as u32;
    let category = d.get("category").and_then(|c| c.as_str()).unwrap_or("error");
    let severity = match category {
        "warning" | "suggestion" | "message" => "warning",
        _ => "error",
    }
    .to_string();
    let message = flatten_message(d.get("text").or_else(|| d.get("messageText")));
    let code = d.get("code").and_then(|c| c.as_u64()).map(|c| format!("TS{c}"));
    LintDiagnostic {
        file: file.to_string(),
        line: line.max(1),
        column: column.max(1),
        end_line: end_line.max(line),
        end_column: end_column.max(1),
        severity,
        message,
        rule_id: code,
        source: Some("typescript".into()),
    }
}

fn flatten_message(v: Option<&Value>) -> String {
    match v {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Object(o)) => {
            let msg = o
                .get("messageText")
                .and_then(|m| m.as_str())
                .unwrap_or("TypeScript 诊断");
            msg.to_string()
        }
        _ => "TypeScript 诊断".into(),
    }
}

fn with_session<R>(
    workspace: &str,
    f: impl FnOnce(&mut TsProcess) -> Result<R, String>,
) -> Result<R, String> {
    let ws = workspace.trim();
    if ws.is_empty() {
        return Err("请先选择工作目录".into());
    }
    let ws_path = Path::new(ws);
    if !ws_path.is_dir() {
        return Err(format!("工作区不是目录: {ws}"));
    }
    let key = norm_key(ws_path);
    let mut map = sessions().lock().map_err(|e| e.to_string())?;
    if !map.contains_key(&key) {
        let proc = spawn_tsserver(ws_path)?;
        map.insert(key.clone(), proc);
    }
    let proc = map.get_mut(&key).ok_or("tsserver 会话丢失")?;
    match f(proc) {
        Ok(r) => Ok(r),
        Err(e) => {
            // Drop broken session so next call respawns.
            map.remove(&key);
            Err(e)
        }
    }
}

/// Duty: 检测工作区是否安装 typescript（供扩展面板）。
#[tauri::command]
pub async fn detect_typescript_info(workspace: String) -> Result<serde_json::Value, String> {
    let ws = workspace.trim();
    if ws.is_empty() {
        return Ok(serde_json::json!({ "installed": false, "version": null }));
    }
    let ws_path = Path::new(ws);
    let installed = resolve_tsserver_js(ws_path).is_some();
    let mut version: Option<String> = None;
    let pkg = ws_path
        .join("node_modules")
        .join("typescript")
        .join("package.json");
    if pkg.is_file() {
        if let Ok(text) = std::fs::read_to_string(&pkg) {
            if let Ok(val) = serde_json::from_str::<Value>(&text) {
                version = val
                    .get("version")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
            }
        }
    }
    Ok(serde_json::json!({
        "installed": installed,
        "version": version,
    }))
}

/// Duty: 打开/更新文件并拉取 TypeScript 语法+语义诊断。
#[tauri::command]
pub async fn ts_get_diagnostics(
    workspace: String,
    path: String,
    content: String,
) -> Result<Vec<LintDiagnostic>, String> {
    let file = assert_under_workspace(&workspace, &path)?;
    if !is_ts_js_path(&file) {
        return Ok(vec![]);
    }
    with_session(&workspace, |proc| {
        proc.ensure_open(&file, &content)?;
        proc.get_diagnostics(&file)
    })
}

/// Duty: 悬停 quickinfo（类型与文档摘要）。
#[tauri::command]
pub async fn ts_quick_info(
    workspace: String,
    path: String,
    content: String,
    line: u32,
    column: u32,
) -> Result<Option<TsQuickInfo>, String> {
    let file = assert_under_workspace(&workspace, &path)?;
    if !is_ts_js_path(&file) {
        return Ok(None);
    }
    with_session(&workspace, |proc| {
        proc.ensure_open(&file, &content)?;
        let body = proc.request(
            "quickinfo",
            serde_json::json!({
                "file": file.to_string_lossy(),
                "line": line.max(1),
                "offset": column.max(1),
            }),
            DEFAULT_TIMEOUT,
        )?;
        if body.is_null() {
            return Ok(None);
        }
        let display = body
            .get("displayString")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let docs = body
            .get("documentation")
            .map(|d| {
                if let Some(s) = d.as_str() {
                    s.to_string()
                } else if let Some(arr) = d.as_array() {
                    arr.iter()
                        .filter_map(|x| x.get("text").and_then(|t| t.as_str()))
                        .collect::<Vec<_>>()
                        .join("")
                } else {
                    String::new()
                }
            })
            .unwrap_or_default();
        if display.is_empty() && docs.is_empty() {
            return Ok(None);
        }
        Ok(Some(TsQuickInfo {
            display_string: display,
            documentation: docs,
        }))
    })
}

/// Duty: 跳转到定义（取第一条）。
#[tauri::command]
pub async fn ts_definition(
    workspace: String,
    path: String,
    content: String,
    line: u32,
    column: u32,
) -> Result<Option<TsLocation>, String> {
    let file = assert_under_workspace(&workspace, &path)?;
    if !is_ts_js_path(&file) {
        return Ok(None);
    }
    with_session(&workspace, |proc| {
        proc.ensure_open(&file, &content)?;
        let body = proc.request(
            "definition",
            serde_json::json!({
                "file": file.to_string_lossy(),
                "line": line.max(1),
                "offset": column.max(1),
            }),
            DEFAULT_TIMEOUT,
        )?;
        let arr = body.as_array().cloned().unwrap_or_default();
        let first = match arr.first() {
            Some(v) => v,
            None => return Ok(None),
        };
        let file = first
            .get("file")
            .and_then(|f| f.as_str())
            .unwrap_or("")
            .to_string();
        if file.is_empty() {
            return Ok(None);
        }
        let start = first.get("start").cloned().unwrap_or(Value::Null);
        Ok(Some(TsLocation {
            file,
            line: start.get("line").and_then(|v| v.as_u64()).unwrap_or(1) as u32,
            column: start.get("offset").and_then(|v| v.as_u64()).unwrap_or(1) as u32,
        }))
    })
}
