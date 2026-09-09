//! Track employee file/folder mutations and emit aggregated office-floor summaries.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use tauri::{AppHandle, Manager};

use crate::desktop_db::{self, FouDb};

#[derive(Default)]
struct EmployeeDeliverables {
    dirs: Vec<String>,
    files_created: Vec<String>,
    files_modified: Vec<String>,
    flushed_total: usize,
}

fn ledger() -> &'static Mutex<HashMap<String, EmployeeDeliverables>> {
    static LEDGER: OnceLock<Mutex<HashMap<String, EmployeeDeliverables>>> = OnceLock::new();
    LEDGER.get_or_init(|| Mutex::new(HashMap::new()))
}

fn basename(path: &str) -> String {
    Path::new(path)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or(path)
        .to_string()
}

fn normalize_path(raw: &str) -> String {
    let p = raw.trim().replace('\\', "/");
    if p.is_empty() {
        return p;
    }
    PathBuf::from(&p).to_string_lossy().replace('\\', "/")
}

fn extract_path(tool_name: &str, tool_args: Option<&str>) -> Option<String> {
    let raw = tool_args?;
    let v: serde_json::Value = serde_json::from_str(raw).ok()?;
    for key in ["path", "file", "dir", "directory", "target"] {
        if let Some(s) = v.get(key).and_then(|x| x.as_str()) {
            let p = normalize_path(s);
            if !p.is_empty() {
                return Some(p);
            }
        }
    }
    if tool_name == "apply_patch" || tool_name == "patch_file" {
        if let Some(s) = v.get("patch").and_then(|x| x.as_str()) {
            for line in s.lines() {
                let t = line.trim();
                if let Some(rest) = t.strip_prefix("*** Update File:") {
                    return Some(normalize_path(rest.trim()));
                }
                if let Some(rest) = t.strip_prefix("*** Add File:") {
                    return Some(normalize_path(rest.trim()));
                }
            }
        }
    }
    None
}

fn is_mutating_tool(tool_name: &str) -> bool {
    matches!(
        tool_name,
        "mkdir"
            | "write_file"
            | "patch_file"
            | "apply_patch"
            | "search_replace"
            | "delete_file"
            | "office_write_docx"
            | "office_write_xlsx"
            | "office_write_pptx"
            | "office_docx_replace"
    )
}

fn push_unique(list: &mut Vec<String>, path: String) {
    if path.is_empty() {
        return;
    }
    if !list.iter().any(|p| p == &path) {
        list.push(path);
    }
}

fn format_sample(paths: &[String], max: usize) -> String {
    paths
        .iter()
        .take(max)
        .map(|p| basename(p))
        .collect::<Vec<_>>()
        .join("、")
}

fn format_summary(ledger: &EmployeeDeliverables) -> String {
    let mut parts: Vec<String> = Vec::new();

    let dir_n = ledger.dirs.len();
    if dir_n > 0 {
        let sample = format_sample(&ledger.dirs, 2);
        parts.push(if dir_n == 1 {
            format!("创建了文件夹 {sample}")
        } else {
            format!("创建了 {dir_n} 个文件夹：{sample} 等")
        });
    }

    let file_n = ledger.files_created.len();
    if file_n > 0 {
        let sample = format_sample(&ledger.files_created, 2);
        parts.push(if file_n == 1 {
            format!("写入了文件 {sample}")
        } else {
            format!("写入了 {file_n} 个文件：{sample} 等")
        });
    }

    let mod_n = ledger.files_modified.len();
    if mod_n > 0 {
        let sample = format_sample(&ledger.files_modified, 2);
        parts.push(if mod_n == 1 {
            format!("修改了文件 {sample}")
        } else {
            format!("修改了 {mod_n} 个文件：{sample} 等")
        });
    }

    parts.join("；")
}

fn total_items(ledger: &EmployeeDeliverables) -> usize {
    ledger.dirs.len() + ledger.files_created.len() + ledger.files_modified.len()
}

fn write_deliverable_line(app: &AppHandle, employee_id: &str, body: &str) {
    if body.trim().is_empty() {
        return;
    }
    let emp_name = {
        let db = match app.try_state::<FouDb>() {
            Some(d) => d,
            None => return,
        };
        let conn = match db.0.lock() {
            Ok(c) => c,
            Err(e) => e.into_inner(),
        };
        desktop_db::get_employee_name(&conn, employee_id)
            .ok()
            .flatten()
            .unwrap_or_else(|| employee_id.to_string())
    };
    crate::employee::office_publish::publish_office_message(
        app,
        Some(employee_id),
        &emp_name,
        "交付",
        body,
        true,
    );
}

/// Record a mutating tool call; flush milestone summaries to office-floor.
pub fn record_deliverable_tool(
    app: &AppHandle,
    employee_id: &str,
    tool_name: &str,
    tool_args: Option<&str>,
) {
    if !is_mutating_tool(tool_name) {
        return;
    }
    let path = match extract_path(tool_name, tool_args) {
        Some(p) => p,
        None => return,
    };

    let should_flush = {
        let mut map = match ledger().lock() {
            Ok(m) => m,
            Err(e) => e.into_inner(),
        };
        let entry = map.entry(employee_id.to_string()).or_default();
        match tool_name {
            "mkdir" => push_unique(&mut entry.dirs, path),
            "write_file" | "office_write_docx" | "office_write_xlsx" | "office_write_pptx" => {
                push_unique(&mut entry.files_created, path)
            }
            "patch_file" | "apply_patch" | "search_replace" | "office_docx_replace" => {
                push_unique(&mut entry.files_modified, path);
            }
            "delete_file" => push_unique(&mut entry.files_modified, path),
            _ => {}
        }
        let total = total_items(entry);
        tool_name == "mkdir" || total == 1 || total % 5 == 0
    };

    if should_flush {
        flush_deliverable_summary(app, employee_id, false);
    }
}

/// Flush aggregated deliverable line; `final_flush` always writes if anything pending.
pub fn flush_deliverable_summary(app: &AppHandle, employee_id: &str, final_flush: bool) {
    let summary = {
        let mut map = match ledger().lock() {
            Ok(m) => m,
            Err(e) => e.into_inner(),
        };
        let entry = match map.get_mut(employee_id) {
            Some(e) => e,
            None => return,
        };
        let total = total_items(entry);
        if total == 0 {
            return;
        }
        if !final_flush && total <= entry.flushed_total {
            return;
        }
        let summary = format_summary(entry);
        entry.flushed_total = total;
        summary
    };
    if summary.is_empty() {
        return;
    }
    write_deliverable_line(app, employee_id, &summary);
}

/// Final summary at end of agent run; clears ledger.
pub fn finish_deliverable_summary(app: &AppHandle, employee_id: &str) {
    flush_deliverable_summary(app, employee_id, true);
    if let Ok(mut map) = ledger().lock() {
        map.remove(employee_id);
    }
}

/// Snapshot for prepending to 落地/实现/回复 body.
pub fn deliverable_summary_text(employee_id: &str) -> Option<String> {
    let map = ledger().lock().ok()?;
    let entry = map.get(employee_id)?;
    let s = format_summary(entry);
    if s.is_empty() {
        None
    } else {
        Some(s)
    }
}

/// Prefix assistant body with deliverable summary when present.
pub fn enrich_body_with_deliverables(employee_id: &str, body: &str) -> String {
    match deliverable_summary_text(employee_id) {
        Some(summary) => format!("📦 实际交付：{summary}\n\n{}", body.trim()),
        None => body.to_string(),
    }
}
