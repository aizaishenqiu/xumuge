//! Unified security audit log ({XU_HOME}/audit/security.jsonl).

use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::PathBuf;

use crate::commands::activity_log::mirror_security_audit_to_activity;
use crate::xu_paths;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SecurityAuditEntry {
    pub ts: i64,
    pub kind: String,
    pub tool_name: Option<String>,
    pub session_id: Option<String>,
    pub project_id: Option<String>,
    pub employee_id: Option<String>,
    pub detail: String,
    pub outcome: String,
}

pub fn security_audit_path() -> Result<PathBuf, String> {
    let dir = xu_paths::xu_home()?.join("audit");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("security.jsonl"))
}

pub fn append_security_audit(entry: &SecurityAuditEntry) -> Result<(), String> {
    let path = security_audit_path()?;
    let line = serde_json::to_string(entry).map_err(|e| e.to_string())?;
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| e.to_string())?;
    writeln!(file, "{line}").map_err(|e| e.to_string())?;
    Ok(())
}

pub fn list_security_audit(limit: usize) -> Result<Vec<SecurityAuditEntry>, String> {
    let path = security_audit_path()?;
    if !path.exists() {
        return Ok(vec![]);
    }
    let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let mut out: Vec<SecurityAuditEntry> = Vec::new();
    for line in raw.lines().rev() {
        if line.trim().is_empty() {
            continue;
        }
        if let Ok(e) = serde_json::from_str::<SecurityAuditEntry>(line) {
            out.push(e);
            if out.len() >= limit {
                break;
            }
        }
    }
    Ok(out)
}

#[tauri::command]
pub async fn xu_append_security_audit(entry: SecurityAuditEntry) -> Result<(), String> {
    append_security_audit(&entry)
}

#[tauri::command]
pub async fn xu_list_security_audit(
    limit: Option<u32>,
) -> Result<Vec<SecurityAuditEntry>, String> {
    let cap = limit.unwrap_or(80).max(1) as usize;
    list_security_audit(cap)
}

pub fn audit_tool_event(
    kind: &str,
    tool_name: &str,
    session_id: Option<&str>,
    project_id: Option<&str>,
    employee_id: Option<&str>,
    detail: &str,
    outcome: &str,
) {
    let entry = SecurityAuditEntry {
        ts: chrono::Utc::now().timestamp_millis(),
        kind: kind.into(),
        tool_name: Some(tool_name.into()),
        session_id: session_id.map(|s| s.to_string()),
        project_id: project_id.map(|s| s.to_string()),
        employee_id: employee_id.map(|s| s.to_string()),
        detail: detail.into(),
        outcome: outcome.into(),
    };
    let _ = append_security_audit(&entry);
    mirror_security_audit_to_activity(
        kind,
        tool_name,
        session_id,
        project_id,
        employee_id,
        detail,
        outcome,
    );
}
