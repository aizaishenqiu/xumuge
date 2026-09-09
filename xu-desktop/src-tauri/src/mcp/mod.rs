//! 用户自配 MCP stdio 客户端：超时、进程复用与逐工具风险元数据。
//!
//! @author qiuye <yjk150@qq.com>
//! @date 2026-08-31
//! @updated 2026-09-06
//! @version 1.1.1
//! @category ToolPolicy
//! @algo per-server-lock-fixed-deadline-jsonrpc

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{mpsc, Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use crate::agent::process_control::{configure_background, terminate_process_tree};
use crate::desktop_db::FouDb;

pub const MCP_SERVERS_KEY: &str = "xu.mcp.servers";
const MAX_MCP_MESSAGE_BYTES: usize = 4 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct McpServerConfig {
    pub id: String,
    pub name: String,
    pub command: String,
    pub args: Vec<String>,
    pub enabled: bool,
    #[serde(default = "default_timeout_ms")]
    pub timeout_ms: u64,
    #[serde(default)]
    pub tool_risk: HashMap<String, String>,
    /// 空 = 全员；非空时仅匹配岗位 slug（支持 design-* 前缀通配）
    #[serde(default, rename = "allowedRoleIds")]
    pub allowed_role_ids: Vec<String>,
}

fn default_timeout_ms() -> u64 {
    30_000
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpToolDef {
    pub server_id: String,
    pub name: String,
    pub description: String,
    pub input_schema: serde_json::Value,
    pub risk: String,
}

struct McpProcess {
    config: McpServerConfig,
    child: Child,
    stdin: ChildStdin,
    responses: mpsc::Receiver<McpInbound>,
    next_id: u64,
}

enum McpInbound {
    Message(serde_json::Value),
    Oversize,
}

struct McpClientEntry {
    config: McpServerConfig,
    process: Mutex<Option<McpProcess>>,
}

impl Drop for McpProcess {
    fn drop(&mut self) {
        let _ = terminate_process_tree(&mut self.child);
    }
}

fn registry() -> &'static Mutex<HashMap<String, Arc<McpClientEntry>>> {
    static REGISTRY: OnceLock<Mutex<HashMap<String, Arc<McpClientEntry>>>> = OnceLock::new();
    REGISTRY.get_or_init(|| Mutex::new(HashMap::new()))
}

fn discard_until_newline(reader: &mut impl BufRead) -> std::io::Result<()> {
    loop {
        let buffered = reader.fill_buf()?;
        if buffered.is_empty() {
            return Ok(());
        }
        if let Some(index) = buffered.iter().position(|byte| *byte == b'\n') {
            reader.consume(index + 1);
            return Ok(());
        }
        let count = buffered.len();
        reader.consume(count);
    }
}

/// Loads MCP server configs from xu.db; malformed data fails closed as an empty list.
pub fn load_servers(db: &FouDb) -> Vec<McpServerConfig> {
    let conn = match db.0.lock() {
        Ok(c) => c,
        Err(_) => return vec![],
    };
    let raw = match crate::desktop_db::setting_get(&conn, MCP_SERVERS_KEY) {
        Ok(Some(r)) => r,
        _ => return vec![],
    };
    serde_json::from_str::<Vec<McpServerConfig>>(&raw).unwrap_or_default()
}

/// Persists configs and terminates reused children whose config was removed or changed.
pub fn save_servers(db: &FouDb, servers: &[McpServerConfig]) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let raw = serde_json::to_string(servers).map_err(|e| e.to_string())?;
    crate::desktop_db::setting_set(&conn, MCP_SERVERS_KEY, &raw)?;
    drop(conn);
    if let Ok(mut clients) = registry().lock() {
        clients.retain(|id, client| {
            servers
                .iter()
                .any(|server| server.enabled && server.id == *id && *server == client.config)
        });
    }
    Ok(())
}

fn spawn_client(config: &McpServerConfig) -> Result<McpProcess, String> {
    let mut command = Command::new(&config.command);
    command
        .args(&config.args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    if !config.allowed_role_ids.is_empty() {
        command.env(
            "XU_ALLOWED_ROLES",
            config.allowed_role_ids.join(","),
        );
    }
    configure_background(&mut command);
    let mut child = command.spawn().map_err(|e| format!("MCP 启动失败: {e}"))?;
    let stdin = child.stdin.take().ok_or("MCP stdin 不可用")?;
    let stdout = child.stdout.take().ok_or("MCP stdout 不可用")?;
    let (tx, rx) = mpsc::sync_channel(256);
    std::thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        loop {
            let mut limited = reader.by_ref().take((MAX_MCP_MESSAGE_BYTES + 1) as u64);
            let mut bytes = Vec::new();
            let read = match limited.read_until(b'\n', &mut bytes) {
                Ok(read) => read,
                Err(_) => break,
            };
            if read == 0 {
                break;
            }
            if bytes.len() > MAX_MCP_MESSAGE_BYTES {
                let _ = tx.send(McpInbound::Oversize);
                if !bytes.ends_with(b"\n") {
                    if discard_until_newline(&mut reader).is_err() {
                        break;
                    }
                }
                continue;
            }
            while matches!(bytes.last(), Some(b'\n' | b'\r')) {
                bytes.pop();
            }
            if let Ok(value) = serde_json::from_slice::<serde_json::Value>(&bytes) {
                if tx.send(McpInbound::Message(value)).is_err() {
                    break;
                }
            }
        }
    });
    Ok(McpProcess {
        config: config.clone(),
        child,
        stdin,
        responses: rx,
        next_id: 1,
    })
}

/// Sends one JSON-RPC request over a reusable MCP process.
/// Dependency: newline-delimited stdio; timeout drops and terminates the whole MCP process tree.
fn rpc_call(
    client: &mut McpProcess,
    method: &str,
    params: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let id = client.next_id;
    client.next_id = client.next_id.saturating_add(1);
    let req = serde_json::json!({
        "jsonrpc": "2.0",
        "id": id,
        "method": method,
        "params": params,
    });
    let line = serde_json::to_string(&req).map_err(|e| e.to_string())?;
    if line.len() > MAX_MCP_MESSAGE_BYTES {
        return Err(format!(
            "MCP {method} 请求超过 {} 字节上限",
            MAX_MCP_MESSAGE_BYTES
        ));
    }
    writeln!(client.stdin, "{line}").map_err(|e| e.to_string())?;
    client.stdin.flush().map_err(|e| e.to_string())?;
    let timeout = Duration::from_millis(client.config.timeout_ms.clamp(1_000, 300_000));
    recv_rpc_result(&client.responses, id, method, timeout)
}

fn recv_rpc_result(
    responses: &mpsc::Receiver<McpInbound>,
    id: u64,
    method: &str,
    timeout: Duration,
) -> Result<serde_json::Value, String> {
    let deadline = Instant::now() + timeout;
    loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return Err(format!("MCP {method} 超时（{} ms）", timeout.as_millis()));
        }
        let inbound = responses
            .recv_timeout(remaining)
            .map_err(|_| format!("MCP {method} 超时（{} ms）", timeout.as_millis()))?;
        let value = match inbound {
            McpInbound::Message(value) => value,
            McpInbound::Oversize => {
                return Err(format!(
                    "MCP {method} 响应超过 {} 字节上限",
                    MAX_MCP_MESSAGE_BYTES
                ))
            }
        };
        if value.get("id").and_then(|v| v.as_u64()) != Some(id) {
            continue;
        }
        if let Some(err) = value.get("error") {
            return Err(err.to_string());
        }
        return Ok(value
            .get("result")
            .cloned()
            .unwrap_or(serde_json::Value::Null));
    }
}

fn notification_value(method: &str, params: serde_json::Value) -> serde_json::Value {
    serde_json::json!({
        "jsonrpc": "2.0",
        "method": method,
        "params": params,
    })
}

fn send_notification(
    client: &mut McpProcess,
    method: &str,
    params: serde_json::Value,
) -> Result<(), String> {
    let notification = notification_value(method, params);
    let line = serde_json::to_string(&notification).map_err(|e| e.to_string())?;
    if line.len() > MAX_MCP_MESSAGE_BYTES {
        return Err(format!("MCP {method} 通知超过消息大小上限"));
    }
    writeln!(client.stdin, "{line}").map_err(|e| e.to_string())?;
    client.stdin.flush().map_err(|e| e.to_string())
}

fn client_entry(config: &McpServerConfig) -> Result<Arc<McpClientEntry>, String> {
    let mut clients = registry().lock().map_err(|e| e.to_string())?;
    if clients
        .get(&config.id)
        .is_some_and(|entry| entry.config != *config)
    {
        clients.remove(&config.id);
    }
    Ok(Arc::clone(clients.entry(config.id.clone()).or_insert_with(
        || {
            Arc::new(McpClientEntry {
                config: config.clone(),
                process: Mutex::new(None),
            })
        },
    )))
}

fn with_client<T>(
    config: &McpServerConfig,
    f: impl FnOnce(&mut McpProcess) -> Result<T, String>,
) -> Result<T, String> {
    let entry = client_entry(config)?;
    let mut process = entry.process.lock().map_err(|e| e.to_string())?;
    let dead = process
        .as_mut()
        .is_some_and(|client| client.child.try_wait().ok().flatten().is_some());
    if dead {
        *process = None;
    }
    if process.is_none() {
        let mut client = spawn_client(config)?;
        rpc_call(
            &mut client,
            "initialize",
            serde_json::json!({
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": { "name": "xu", "version": "1.0.0" }
            }),
        )?;
        send_notification(
            &mut client,
            "notifications/initialized",
            serde_json::json!({}),
        )?;
        *process = Some(client);
    }
    let result = f(process.as_mut().expect("MCP process initialized"));
    if result.is_err() {
        *process = None;
    }
    result
}

/// Lists tools from enabled MCP servers; filters by employee role when configured.
pub fn list_mcp_tools(db: &FouDb, employee_role: Option<&str>) -> Vec<McpToolDef> {
    let servers: Vec<McpServerConfig> = load_servers(db)
        .into_iter()
        .filter(|s| s.enabled && !s.command.trim().is_empty())
        .filter(|s| server_allowed_for_role(s, employee_role))
        .collect();
    let mut out = Vec::new();
    for srv in servers {
        let res = match with_client(&srv, |client| {
            rpc_call(client, "tools/list", serde_json::json!({}))
        }) {
            Ok(r) => r,
            Err(_) => continue,
        };
        if let Some(tools) = res.get("tools").and_then(|t| t.as_array()) {
            for t in tools {
                let name = t
                    .get("name")
                    .and_then(|n| n.as_str())
                    .unwrap_or("")
                    .to_string();
                if name.is_empty() {
                    continue;
                }
                out.push(McpToolDef {
                    server_id: srv.id.clone(),
                    name: name.clone(),
                    description: t
                        .get("description")
                        .and_then(|d| d.as_str())
                        .unwrap_or("")
                        .to_string(),
                    input_schema: t
                        .get("inputSchema")
                        .cloned()
                        .unwrap_or(serde_json::json!({"type":"object"})),
                    risk: srv
                        .tool_risk
                        .get(&name)
                        .cloned()
                        .unwrap_or_else(|| "high".into()),
                });
            }
        }
    }
    out
}

fn server_allowed_for_role(server: &McpServerConfig, employee_role: Option<&str>) -> bool {
    if server.allowed_role_ids.is_empty() {
        return true;
    }
    // Settings / training refresh passes None: list all enabled servers so UI is not empty.
    // Agent dispatch passes a concrete role and keeps the filter.
    let Some(role) = employee_role.map(str::trim).filter(|s| !s.is_empty()) else {
        return true;
    };
    server
        .allowed_role_ids
        .iter()
        .any(|pattern| role_matches_slug(role, pattern))
}

fn role_matches_slug(role: &str, pattern: &str) -> bool {
    let p = pattern.trim();
    if p.is_empty() {
        return true;
    }
    if p.ends_with('*') {
        let prefix = p.trim_end_matches('*');
        role.starts_with(prefix)
    } else {
        role == p || role.contains(p)
    }
}

/// Encodes an MCP server/tool pair as an OpenAI-safe function name.
pub fn mcp_tool_openai_name(server_id: &str, tool: &str) -> String {
    format!("mcp__{server_id}__{tool}")
}

/// Decodes an MCP OpenAI function name into server and tool ids.
pub fn parse_mcp_tool_name(full: &str) -> Option<(String, String)> {
    let rest = full.strip_prefix("mcp__")?;
    let (srv, tool) = rest.split_once("__")?;
    Some((srv.to_string(), tool.to_string()))
}

/// Resolves configured per-tool risk; unknown MCP tools fail closed as high risk.
pub fn configured_tool_risk(db: &FouDb, full_name: &str) -> String {
    let Some((server_id, tool)) = parse_mcp_tool_name(full_name) else {
        return "high".into();
    };
    load_servers(db)
        .into_iter()
        .find(|server| server.id == server_id)
        .and_then(|server| server.tool_risk.get(&tool).cloned())
        .filter(|risk| matches!(risk.as_str(), "low" | "medium" | "high"))
        .unwrap_or_else(|| "high".into())
}

/// Calls one MCP tool with configured timeout and reusable process lifecycle.
/// When `workspace` is set, injects `workspaceRoot` into arguments for path-sandbox hosts.
pub fn call_mcp_tool(
    db: &FouDb,
    server_id: &str,
    tool: &str,
    args: &serde_json::Value,
    workspace: Option<&std::path::Path>,
) -> Result<String, String> {
    let servers = load_servers(db);
    let srv = servers
        .iter()
        .find(|s| s.id == server_id && s.enabled)
        .ok_or("MCP server not found")?;
    let mut call_args = args.clone();
    if let Some(ws) = workspace {
        if let Some(obj) = call_args.as_object_mut() {
            obj.entry("workspaceRoot".to_string()).or_insert_with(|| {
                serde_json::Value::String(ws.display().to_string())
            });
        }
    }
    let res = with_client(srv, |client| {
        rpc_call(
            client,
            "tools/call",
            serde_json::json!({
                "name": tool,
                "arguments": call_args,
            }),
        )
    })?;
    if let Some(content) = res.get("content").and_then(|c| c.as_array()) {
        let text: String = content
            .iter()
            .filter_map(|b| b.get("text").and_then(|t| t.as_str()))
            .collect::<Vec<_>>()
            .join("\n");
        return Ok(text);
    }
    Ok(res.to_string())
}

#[tauri::command]
/// Lists configured MCP servers for Settings; failures return for fouAlert.
pub fn xu_mcp_list_servers(db: tauri::State<'_, FouDb>) -> Result<Vec<McpServerConfig>, String> {
    Ok(load_servers(&db))
}

#[tauri::command]
/// Saves Settings MCP servers and reconciles child lifecycles.
pub fn xu_mcp_save_servers(
    db: tauri::State<'_, FouDb>,
    servers: Vec<McpServerConfig>,
) -> Result<(), String> {
    save_servers(&db, &servers)
}

#[tauri::command]
/// Lists discovered MCP tools with per-tool risk metadata.
pub fn xu_mcp_list_tools(db: tauri::State<'_, FouDb>) -> Result<Vec<McpToolDef>, String> {
    Ok(list_mcp_tools(&db, None))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config(id: &str) -> McpServerConfig {
        McpServerConfig {
            id: id.into(),
            name: id.into(),
            command: "unused".into(),
            args: vec![],
            enabled: true,
            timeout_ms: 1_000,
            tool_risk: HashMap::new(),
            allowed_role_ids: vec![],
        }
    }

    #[test]
    fn separate_servers_do_not_share_rpc_lock() {
        let slow = client_entry(&config("test-slow-lock")).unwrap();
        let fast = client_entry(&config("test-fast-lock")).unwrap();
        let (locked_tx, locked_rx) = mpsc::channel();
        let slow_thread = Arc::clone(&slow);
        let handle = std::thread::spawn(move || {
            let _guard = slow_thread.process.lock().unwrap();
            locked_tx.send(()).unwrap();
            std::thread::sleep(Duration::from_millis(150));
        });
        locked_rx.recv().unwrap();
        let started = Instant::now();
        let _fast_guard = fast.process.lock().unwrap();
        assert!(started.elapsed() < Duration::from_millis(50));
        handle.join().unwrap();
    }

    #[test]
    fn notification_flood_does_not_extend_rpc_deadline() {
        let (tx, rx) = mpsc::channel();
        let sender = std::thread::spawn(move || {
            for _ in 0..500 {
                if tx
                    .send(McpInbound::Message(serde_json::json!({
                        "jsonrpc": "2.0",
                        "method": "notifications/progress"
                    })))
                    .is_err()
                {
                    break;
                }
                std::thread::sleep(Duration::from_millis(1));
            }
        });
        let started = Instant::now();
        let error = recv_rpc_result(&rx, 7, "tools/list", Duration::from_millis(60)).unwrap_err();
        assert!(error.contains("超时"));
        assert!(started.elapsed() < Duration::from_millis(200));
        drop(rx);
        sender.join().unwrap();
    }

    #[test]
    fn oversized_message_fails_closed() {
        let (tx, rx) = mpsc::channel();
        tx.send(McpInbound::Oversize).unwrap();
        let error = recv_rpc_result(&rx, 1, "tools/list", Duration::from_secs(1)).unwrap_err();
        assert!(error.contains("响应超过"));
    }

    #[test]
    fn initialized_notification_has_no_request_id() {
        let value = notification_value("notifications/initialized", serde_json::json!({}));
        assert_eq!(value["method"], "notifications/initialized");
        assert!(value.get("id").is_none());
        assert_eq!(value["jsonrpc"], "2.0");
    }
}
