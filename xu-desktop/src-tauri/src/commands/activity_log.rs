//! User-facing activity log ({XU_HOME}/audit/activity.jsonl).

use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::PathBuf;

use crate::xu_paths;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ActivityLogEntry {
    pub ts: i64,
    pub kind: String,
    pub title: String,
    pub detail: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub employee_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub paths: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bytes: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stopped: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub outcome: Option<String>,
}

pub fn activity_log_path() -> Result<PathBuf, String> {
    let dir = xu_paths::xu_home()?.join("audit");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("activity.jsonl"))
}

fn sanitize_activity_text(s: &str) -> String {
    let mut out = s.to_string();
    for prefix in ["https://", "http://"] {
        while let Some(i) = out.find(prefix) {
            let rest = &out[i..];
            let end = rest
                .find(|c: char| c.is_whitespace() || c == ')' || c == ']' || c == '"')
                .unwrap_or(rest.len());
            out.replace_range(i..i + end, "[链接已隐藏]");
        }
    }
    out
}

pub fn append_activity_log(entry: &ActivityLogEntry) -> Result<(), String> {
    let path = activity_log_path()?;
    let mut safe = entry.clone();
    safe.title = sanitize_activity_text(&safe.title);
    safe.detail = sanitize_activity_text(&safe.detail);
    let line = serde_json::to_string(&safe).map_err(|e| e.to_string())?;
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| e.to_string())?;
    writeln!(file, "{line}").map_err(|e| e.to_string())?;
    Ok(())
}

pub fn list_activity_log(limit: usize) -> Result<Vec<ActivityLogEntry>, String> {
    let path = activity_log_path()?;
    if !path.exists() {
        return Ok(vec![]);
    }
    let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let mut out: Vec<ActivityLogEntry> = Vec::new();
    for line in raw.lines().rev() {
        if line.trim().is_empty() {
            continue;
        }
        if let Ok(e) = serde_json::from_str::<ActivityLogEntry>(line) {
            out.push(e);
            if out.len() >= limit {
                break;
            }
        }
    }
    Ok(out)
}

pub fn log_activity_simple(
    kind: &str,
    title: &str,
    detail: &str,
    session_id: Option<&str>,
    project_id: Option<&str>,
    employee_id: Option<&str>,
    paths: Option<Vec<String>>,
    bytes: Option<usize>,
    stopped: Option<bool>,
    outcome: Option<&str>,
) {
    let entry = ActivityLogEntry {
        ts: chrono::Utc::now().timestamp_millis(),
        kind: kind.into(),
        title: title.into(),
        detail: detail.into(),
        project_id: project_id.map(|s| s.to_string()),
        session_id: session_id.map(|s| s.to_string()),
        employee_id: employee_id.map(|s| s.to_string()),
        paths,
        bytes,
        stopped,
        outcome: outcome.map(|s| s.to_string()),
    };
    let _ = append_activity_log(&entry);
}

pub fn mirror_security_audit_to_activity(
    kind: &str,
    tool_name: &str,
    session_id: Option<&str>,
    project_id: Option<&str>,
    employee_id: Option<&str>,
    detail: &str,
    outcome: &str,
) {
    let activity_kind = match kind {
        "tool_approval" => "approval",
        "tool_denied" => "tool",
        "shell_exec" => "tool",
        _ => "tool",
    };
    let title = match kind {
        "tool_denied" => format!("项目策略拒绝：{tool_name}"),
        "tool_approval" => format!("工具审批：{tool_name}"),
        "shell_exec" => "Shell 命令已执行".to_string(),
        _ if tool_name.starts_with("write_")
            || tool_name.contains("patch")
            || tool_name == "delete_file" =>
        {
            "本机文件已修改".to_string()
        }
        _ => format!("Agent 工具：{tool_name}"),
    };
    log_activity_simple(
        activity_kind,
        &title,
        detail,
        session_id,
        project_id,
        employee_id,
        None,
        None,
        None,
        Some(outcome),
    );
}

pub fn log_bulk_read_decision(
    session_id: &str,
    project_id: Option<&str>,
    employee_id: Option<&str>,
    reason: &str,
    tool_name: &str,
    granted: bool,
    paths: Option<Vec<String>>,
    bytes: Option<usize>,
) {
    let title = if granted {
        "整仓读取警告：用户选择继续".to_string()
    } else {
        "整仓读取警告：用户选择停止".to_string()
    };
    let detail = format!("工具 {tool_name}\n{reason}",);
    log_activity_simple(
        "bulk_read",
        &title,
        &detail,
        Some(session_id),
        project_id,
        employee_id,
        paths,
        bytes,
        Some(!granted),
        Some(if granted { "ok" } else { "denied" }),
    );
}

pub fn log_file_change(
    session_id: &str,
    project_id: Option<&str>,
    employee_id: Option<&str>,
    tool_name: &str,
    path: &str,
) {
    log_activity_simple(
        "file_change",
        "本机文件已修改",
        &format!("{tool_name} → {path}"),
        Some(session_id),
        project_id,
        employee_id,
        Some(vec![path.to_string()]),
        None,
        None,
        Some("ok"),
    );
}

pub fn log_halt(session_id: Option<&str>, project_id: Option<&str>, title: &str, detail: &str) {
    log_activity_simple(
        "halt",
        title,
        detail,
        session_id,
        project_id,
        None,
        None,
        None,
        Some(true),
        Some("blocked"),
    );
}

#[tauri::command]
pub async fn xu_append_activity_log(entry: ActivityLogEntry) -> Result<(), String> {
    append_activity_log(&entry)
}

#[tauri::command]
pub async fn xu_list_activity_log(limit: Option<u32>) -> Result<Vec<ActivityLogEntry>, String> {
    let cap = limit.unwrap_or(200).max(1) as usize;
    list_activity_log(cap)
}
