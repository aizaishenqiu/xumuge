//! Project generate-path wipe + cleanup audit log.

use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use tauri::Manager;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WipeGeneratePathResult {
    pub deleted_files: u64,
    pub deleted_dirs: u64,
    pub bytes: u64,
    pub errors: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CleanupAuditEntry {
    pub ts: i64,
    pub project_id: Option<String>,
    pub project_name: Option<String>,
    pub generate_path: String,
    pub channel: String,
    pub command_text: String,
    pub operator_hint: Option<String>,
    pub wipe_result: Option<WipeGeneratePathResult>,
    pub dispatched_employees: Option<u32>,
    pub outcome: String,
}

fn audit_log_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("audit");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("cleanup-replan.jsonl"))
}

fn is_forbidden_wipe_root(path: &Path) -> bool {
    let s = path.to_string_lossy().to_lowercase();
    if s.len() <= 3 {
        return true;
    }
    let bad = [
        "c:\\windows",
        "c:\\program files",
        "/usr",
        "/bin",
        "/etc",
        "/var",
        "/system",
    ];
    bad.iter()
        .any(|b| s == *b || s.starts_with(&format!("{b}\\")) || s.starts_with(&format!("{b}/")))
}

fn validate_generate_path(path: &str) -> Result<PathBuf, String> {
    let raw = path.trim();
    if raw.is_empty() {
        return Err("生成路径为空".into());
    }
    let p = PathBuf::from(raw);
    if !p.is_absolute() {
        return Err("生成路径必须是绝对路径".into());
    }
    if is_forbidden_wipe_root(&p) {
        return Err("禁止擦除系统目录".into());
    }
    let canon = p.canonicalize().unwrap_or(p.clone());
    if is_forbidden_wipe_root(&canon) {
        return Err("禁止擦除系统目录".into());
    }
    Ok(canon)
}

fn wipe_dir_contents(root: &Path, result: &mut WipeGeneratePathResult) {
    let read_dir = match fs::read_dir(root) {
        Ok(d) => d,
        Err(e) => {
            result
                .errors
                .push(format!("read_dir {}: {e}", root.display()));
            return;
        }
    };
    for entry in read_dir.flatten() {
        let path = entry.path();
        if path.is_dir() {
            match fs::remove_dir_all(&path) {
                Ok(()) => {
                    result.deleted_dirs += 1;
                }
                Err(e) => result
                    .errors
                    .push(format!("remove_dir_all {}: {e}", path.display())),
            }
        } else if path.is_file() {
            if let Ok(meta) = entry.metadata() {
                result.bytes += meta.len();
            }
            match fs::remove_file(&path) {
                Ok(()) => {
                    result.deleted_files += 1;
                }
                Err(e) => result
                    .errors
                    .push(format!("remove_file {}: {e}", path.display())),
            }
        }
    }
}

#[tauri::command]
pub async fn xu_wipe_project_generate_path(
    generate_path: String,
    mode: Option<String>,
) -> Result<WipeGeneratePathResult, String> {
    let m = mode.unwrap_or_else(|| "full".into());
    if m != "full" {
        return Err(format!("不支持的擦除模式: {m}"));
    }
    let root = validate_generate_path(&generate_path)?;
    if !root.exists() {
        fs::create_dir_all(&root).map_err(|e| e.to_string())?;
        return Ok(WipeGeneratePathResult {
            deleted_files: 0,
            deleted_dirs: 0,
            bytes: 0,
            errors: vec![],
        });
    }
    if !root.is_dir() {
        return Err("生成路径不是目录".into());
    }
    // refuse if path has only root component (e.g. C:\)
    if root
        .components()
        .filter(|c| matches!(c, Component::Normal(_)))
        .count()
        < 1
    {
        return Err("生成路径过浅，拒绝擦除".into());
    }
    let mut result = WipeGeneratePathResult {
        deleted_files: 0,
        deleted_dirs: 0,
        bytes: 0,
        errors: vec![],
    };
    wipe_dir_contents(&root, &mut result);
    Ok(result)
}

#[tauri::command]
pub async fn xu_append_cleanup_audit(
    app: tauri::AppHandle,
    entry: CleanupAuditEntry,
) -> Result<(), String> {
    let path = audit_log_path(&app)?;
    let line = serde_json::to_string(&entry).map_err(|e| e.to_string())?;
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| e.to_string())?;
    writeln!(file, "{line}").map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn xu_list_cleanup_audit(
    app: tauri::AppHandle,
    limit: Option<u32>,
) -> Result<Vec<CleanupAuditEntry>, String> {
    let path = audit_log_path(&app)?;
    if !path.exists() {
        return Ok(vec![]);
    }
    let cap = limit.unwrap_or(50).max(1) as usize;
    let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let mut out: Vec<CleanupAuditEntry> = Vec::new();
    for line in raw.lines().rev() {
        if line.trim().is_empty() {
            continue;
        }
        if let Ok(e) = serde_json::from_str::<CleanupAuditEntry>(line) {
            out.push(e);
            if out.len() >= cap {
                break;
            }
        }
    }
    Ok(out)
}
