//! File snapshots before mutating tools — supports undo_last_changes.

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize)]
struct SnapshotBatch {
    id: String,
    created_at: u64,
    entries: Vec<SnapshotEntry>,
}

#[derive(Serialize, Deserialize)]
struct SnapshotEntry {
    rel: String,
    existed: bool,
    backup: Option<String>,
}

fn snapshots_root(workspace: &Path) -> PathBuf {
    workspace.join(".xu").join("snapshots")
}

fn manifest_path(workspace: &Path) -> PathBuf {
    snapshots_root(workspace).join("manifest.json")
}

fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn rel_path(workspace: &Path, abs: &Path) -> String {
    abs.strip_prefix(workspace)
        .unwrap_or(abs)
        .to_string_lossy()
        .replace('\\', "/")
}

/// Copy file before write/patch/delete if under workspace.
pub fn snapshot_before_mutate(workspace: &Path, abs: &Path, batch_id: &str) {
    let root = snapshots_root(workspace);
    let batch_dir = root.join(batch_id);
    let _ = fs::create_dir_all(&batch_dir);
    let rel = rel_path(workspace, abs);
    let backup_name = rel.replace('/', "__");
    let backup_path = batch_dir.join(&backup_name);
    let existed = abs.is_file();
    let backup = if existed {
        if fs::copy(abs, &backup_path).is_ok() {
            Some(backup_name)
        } else {
            None
        }
    } else {
        None
    };
    let mut manifest: Vec<SnapshotBatch> = load_manifest(workspace);
    let entry = SnapshotEntry {
        rel: rel.clone(),
        existed,
        backup,
    };
    if let Some(batch) = manifest.iter_mut().find(|b| b.id == batch_id) {
        if !batch.entries.iter().any(|e| e.rel == rel) {
            batch.entries.push(entry);
        }
    } else {
        manifest.push(SnapshotBatch {
            id: batch_id.to_string(),
            created_at: now_secs(),
            entries: vec![entry],
        });
    }
    while manifest.len() > 8 {
        if let Some(old) = manifest.first() {
            let _ = fs::remove_dir_all(root.join(&old.id));
        }
        manifest.remove(0);
    }
    save_manifest(workspace, &manifest);
}

fn load_manifest(workspace: &Path) -> Vec<SnapshotBatch> {
    let p = manifest_path(workspace);
    if !p.is_file() {
        return Vec::new();
    }
    fs::read_to_string(&p)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_manifest(workspace: &Path, batches: &[SnapshotBatch]) {
    let p = manifest_path(workspace);
    if let Some(parent) = p.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if let Ok(s) = serde_json::to_string_pretty(batches) {
        let _ = fs::write(p, s);
    }
}

pub fn undo_last_batch(workspace: &Path) -> Result<String, String> {
    let root = snapshots_root(workspace);
    let mut manifest = load_manifest(workspace);
    let Some(batch) = manifest.pop() else {
        return Err("没有可撤销的工具改动快照".into());
    };
    let batch_dir = root.join(&batch.id);
    let mut restored = 0usize;
    let mut removed = 0usize;
    for e in batch.entries.iter().rev() {
        let target = workspace.join(&e.rel);
        if e.existed {
            if let Some(ref b) = e.backup {
                let src = batch_dir.join(b);
                if src.is_file() {
                    if let Some(parent) = target.parent() {
                        let _ = fs::create_dir_all(parent);
                    }
                    fs::copy(&src, &target).map_err(|err| format!("恢复 {} 失败: {err}", e.rel))?;
                    restored += 1;
                }
            }
        } else if target.exists() {
            if target.is_file() {
                fs::remove_file(&target).map_err(|err| format!("删除 {} 失败: {err}", e.rel))?;
                removed += 1;
            } else if target.is_dir() {
                fs::remove_dir_all(&target)
                    .map_err(|err| format!("删除目录 {} 失败: {err}", e.rel))?;
                removed += 1;
            }
        }
    }
    let _ = fs::remove_dir_all(&batch_dir);
    save_manifest(workspace, &manifest);
    Ok(format!(
        "已撤销上一批工具改动：恢复 {restored} 个文件，删除新建 {removed} 个路径"
    ))
}

pub fn new_batch_id(session_hint: &str) -> String {
    format!(
        "{}-{}",
        session_hint.chars().take(12).collect::<String>(),
        now_secs()
    )
}
