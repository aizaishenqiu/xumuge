//! 本地文件操作、系统打开、语音朗读与端口查询命令。
//!
//! @author qiuye <yjk150@qq.com>
//! @updated 2026-09-02
//! @version 1.1.1
//! @category ToolPolicy
//! @algo path-validation-and-isolated-child-env

use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Serialize, Clone)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
}

#[tauri::command]
pub async fn list_dir(
    path: String,
    include_hidden: Option<bool>,
) -> Result<Vec<FileEntry>, String> {
    let dir = Path::new(&path);
    if !dir.is_dir() {
        return Err(format!("Not a directory: {path}"));
    }
    let show_hidden = include_hidden.unwrap_or(false);

    let mut entries: Vec<FileEntry> = std::fs::read_dir(dir)
        .map_err(|e| format!("Cannot read directory: {e}"))?
        .filter_map(|res| res.ok())
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().to_string();
            if !show_hidden && name.starts_with('.') {
                return None;
            }
            let meta = entry.metadata().ok()?;
            Some(FileEntry {
                path: entry.path().to_string_lossy().to_string(),
                name,
                is_dir: meta.is_dir(),
                size: meta.len(),
            })
        })
        .collect();

    // directories first, then files, both sorted alphabetically
    entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then(a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    Ok(entries)
}

#[tauri::command]
pub async fn get_home_dir() -> String {
    dirs::home_dir()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|| "/".to_string())
}

#[tauri::command]
pub fn xu_get_home() -> Result<String, String> {
    crate::xu_paths::xu_home().map(|p| p.to_string_lossy().to_string())
}

/// User Documents folder (not XU_HOME). User skills live here so uninstall does not delete them.
#[tauri::command]
pub fn xu_get_documents_dir() -> Result<String, String> {
    dirs::document_dir()
        .or_else(|| dirs::home_dir().map(|h| h.join("Documents")))
        .or_else(dirs::home_dir)
        .map(|p| p.to_string_lossy().into_owned())
        .ok_or_else(|| "无法解析文档目录".into())
}

/// Duty: 规范化 Windows 路径供 explorer 打开（/ → \，剥 \\?\）。
#[cfg(target_os = "windows")]
fn normalize_windows_explorer_path(path: &str) -> String {
    let mut s = path.replace('/', "\\");
    if let Some(rest) = s.strip_prefix(r"\\?\") {
        s = rest.to_string();
    }
    while s.ends_with('\\') && s.len() > 3 {
        s.pop();
    }
    s
}

#[tauri::command]
pub async fn open_path(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    let path = normalize_windows_explorer_path(&path);
    let p = Path::new(&path);
    let exists = p.exists();
    if !exists {
        return Err(format!("路径不存在: {path}"));
    }

    #[cfg(target_os = "macos")]
    {
        if p.is_file() {
            std::process::Command::new("open")
                .args(["-R", &path])
                .spawn()
                .map_err(|e| format!("在访达中显示失败: {e}"))?;
        } else {
            std::process::Command::new("open")
                .arg(&path)
                .spawn()
                .map_err(|e| format!("打开失败: {e}"))?;
        }
    }

    #[cfg(target_os = "windows")]
    {
        // `explorer <file>` opens with default app; use /select for files.
        // Directories must also use backslash paths or Explorer often no-ops.
        if p.is_file() {
            std::process::Command::new("explorer")
                .arg(format!("/select,{path}"))
                .spawn()
                .map_err(|e| format!("在资源管理器中显示失败: {e}"))?;
        } else {
            std::process::Command::new("explorer")
                .arg(&path)
                .spawn()
                .map_err(|e| format!("打开文件夹失败: {e}"))?;
        }
    }

    #[cfg(target_os = "linux")]
    {
        if p.is_file() {
            if let Some(parent) = p.parent() {
                std::process::Command::new("xdg-open")
                    .arg(parent)
                    .spawn()
                    .map_err(|e| format!("打开文件夹失败: {e}"))?;
            } else {
                return Err("无法解析父目录".into());
            }
        } else {
            std::process::Command::new("xdg-open")
                .arg(&path)
                .spawn()
                .map_err(|e| format!("打开失败: {e}"))?;
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn open_with_editor(path: String, editor: String) -> Result<(), String> {
    let cmd = if editor.trim().is_empty() {
        "code".to_string()
    } else {
        editor.trim().to_string()
    };

    #[cfg(target_os = "macos")]
    {
        // Map known editor CLI names to macOS .app bundle names.
        // `open -a` uses the system app database — no PATH dependency.
        let app_name = match cmd.as_str() {
            "code" => Some("Visual Studio Code"),
            "cursor" => Some("Cursor"),
            "zed" => Some("Zed"),
            "windsurf" => Some("Windsurf"),
            "webstorm" => Some("WebStorm"),
            "idea" => Some("IntelliJ IDEA"),
            _ => None,
        };
        if let Some(app) = app_name {
            return std::process::Command::new("open")
                .args(["-a", app, &path])
                .spawn()
                .map_err(|e| format!("无法打开 {app}：{e}（确认已安装该应用）"))
                .map(|_| ());
        }
        // Fallback: try via login shell (picks up /usr/local/bin etc.)
        let shell_cmd = format!("{} \"{}\"", cmd, path.replace('"', "\\\""));
        std::process::Command::new("/bin/zsh")
            .args(["-l", "-c", &shell_cmd])
            .spawn()
            .map_err(|e| format!("命令 '{cmd}' 未找到：{e}"))?;
    }

    #[cfg(not(target_os = "macos"))]
    {
        std::process::Command::new(&cmd)
            .arg(&path)
            .spawn()
            .map_err(|e| {
                format!("Cannot open editor '{cmd}': {e}. Is it installed and in PATH?")
            })?;
    }

    Ok(())
}

#[tauri::command]
pub async fn speak_text(
    text: String,
    state: tauri::State<'_, crate::AppState>,
) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        // Kill any running say process first
        if let Ok(mut guard) = state.say_process.lock() {
            if let Some(mut child) = guard.take() {
                child.kill().ok();
            }
        }
        let truncated: String = text.chars().take(500).collect();
        let mut command = std::process::Command::new("/usr/bin/say");
        command.args(["-v", "Tingting", &truncated]);
        crate::agent::process_control::configure_isolated_environment(&mut command);
        let child = command.spawn().map_err(|e| format!("say failed: {e}"))?;
        if let Ok(mut guard) = state.say_process.lock() {
            *guard = Some(child);
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (text, state);
    }
    Ok(())
}

#[tauri::command]
pub async fn stop_speak(state: tauri::State<'_, crate::AppState>) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        if let Ok(mut guard) = state.say_process.lock() {
            if let Some(mut child) = guard.take() {
                child.kill().ok();
            }
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = state;
    }
    Ok(())
}

const MAX_PREVIEW_BYTES: u64 = 2 * 1024 * 1024; // 2 MB

#[tauri::command]
pub async fn read_text_file(path: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        let p = Path::new(&path);
        let size = p
            .metadata()
            .map_err(|e| format!("Cannot read file metadata: {e}"))?
            .len();
        if size > MAX_PREVIEW_BYTES {
            return Err(format!(
                "File too large to preview ({} KB, limit {} KB)",
                size / 1024,
                MAX_PREVIEW_BYTES / 1024
            ));
        }
        std::fs::read_to_string(p).map_err(|e| format!("Cannot read file: {e}"))
    })
    .await
    .map_err(|e| format!("Read task failed: {e}"))?
}

/// Overwrite a text file under workspace (preview editor save).
#[tauri::command]
pub async fn write_text_file(
    workspace: String,
    path: String,
    content: String,
) -> Result<(), String> {
    assert_under_workspace(&workspace, &path)?;
    if content.len() as u64 > MAX_PREVIEW_BYTES {
        return Err(format!(
            "File too large to save ({} KB)",
            content.len() / 1024
        ));
    }
    let abs = resolve_workspace_path(&workspace, &path);
    let p = abs.as_path();
    if let Some(parent) = p.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("Cannot create parent dir: {e}"))?;
    }
    std::fs::write(p, content.as_bytes()).map_err(|e| format!("Cannot write file: {e}"))
}

/// Append a single line to a text file (creates parent dirs). Used for chat write fallback.
#[tauri::command]
pub async fn append_text_line(path: String, line: String) -> Result<(), String> {
    let p = Path::new(&path);
    if let Some(parent) = p.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("Cannot create parent dir: {e}"))?;
    }
    use std::io::Write;
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(p)
        .map_err(|e| format!("Cannot open file for append: {e}"))?;
    if file.metadata().map(|m| m.len()).unwrap_or(0) > 0 {
        writeln!(file, "{line}").map_err(|e| format!("Cannot append line: {e}"))?;
    } else {
        write!(file, "{line}").map_err(|e| format!("Cannot write line: {e}"))?;
    }
    file.flush()
        .map_err(|e| format!("Cannot flush file: {e}"))?;
    Ok(())
}

/// Check whether 虚募阁 memories table has any rows.
#[tauri::command]
pub fn check_memory_loaded(
    state: tauri::State<'_, crate::desktop_db::FouDb>,
) -> Result<bool, String> {
    let conn = state.0.lock().map_err(|e| format!("DB lock: {e}"))?;
    conn.query_row("SELECT COUNT(1) FROM memories", [], |r| r.get::<_, i64>(0))
        .map(|n| n > 0)
        .map_err(|e| format!("memories count: {e}"))
}

/// Copy a user-selected file into {XU_HOME}/uploads/YYYY-MM-DD/ and return the destination path.
#[tauri::command]
pub async fn save_upload(src_path: String) -> Result<String, String> {
    let home = crate::xu_paths::xu_home()?;
    let date = chrono::Local::now().format("%Y-%m-%d").to_string();
    let upload_dir = home.join("uploads").join(&date);
    std::fs::create_dir_all(&upload_dir).map_err(|e| format!("Cannot create upload dir: {e}"))?;
    let filename = Path::new(&src_path)
        .file_name()
        .ok_or("Invalid source path")?
        .to_string_lossy()
        .to_string();
    let dest = upload_dir.join(&filename);
    std::fs::copy(&src_path, &dest).map_err(|e| format!("Cannot copy file: {e}"))?;
    Ok(dest.to_string_lossy().to_string())
}

/// 相对路径相对工作区解析为绝对路径；绝对路径原样返回。
fn resolve_workspace_path(workspace: &str, path: &str) -> PathBuf {
    let p = Path::new(path);
    if p.is_absolute() {
        p.to_path_buf()
    } else {
        Path::new(workspace).join(p)
    }
}

fn assert_under_workspace(workspace: &str, target: &str) -> Result<(), String> {
    let ws_raw = Path::new(workspace);
    if !ws_raw.exists() {
        std::fs::create_dir_all(ws_raw).map_err(|e| format!("创建工作区失败: {e}"))?;
    }
    let ws = ws_raw
        .canonicalize()
        .map_err(|e| format!("工作区无效: {e}"))?;
    let abs = resolve_workspace_path(workspace, target);
    let t = if abs.exists() {
        abs.canonicalize()
            .map_err(|e| format!("路径无效: {e}"))?
    } else if let Some(parent) = abs.parent() {
        if !parent.exists() {
            std::fs::create_dir_all(parent).map_err(|e| format!("创建父目录失败: {e}"))?;
        }
        let parent_canon = parent
            .canonicalize()
            .map_err(|e| format!("父目录无效: {e}"))?;
        let file_name = abs
            .file_name()
            .ok_or_else(|| "路径无效".to_string())?;
        parent_canon.join(file_name)
    } else {
        return Err("路径无效".into());
    };
    if !t.starts_with(&ws) {
        return Err("路径超出工作区范围".into());
    }
    Ok(())
}

#[tauri::command]
pub async fn rename_path(workspace: String, from: String, to: String) -> Result<(), String> {
    assert_under_workspace(&workspace, &from)?;
    assert_under_workspace(&workspace, &to)?;
    std::fs::rename(&from, &to).map_err(|e| format!("重命名失败: {e}"))
}

#[tauri::command]
pub async fn remove_path(workspace: String, path: String) -> Result<(), String> {
    assert_under_workspace(&workspace, &path)?;
    let p = Path::new(&path);
    if p.is_dir() {
        std::fs::remove_dir_all(p).map_err(|e| format!("删除目录失败: {e}"))
    } else {
        std::fs::remove_file(p).map_err(|e| format!("删除文件失败: {e}"))
    }
}

fn copy_path_recursive(src: &Path, dst: &Path) -> Result<(), String> {
    if src.is_dir() {
        std::fs::create_dir_all(dst).map_err(|e| format!("创建目录失败: {e}"))?;
        for entry in std::fs::read_dir(src).map_err(|e| format!("读取目录失败: {e}"))? {
            let entry = entry.map_err(|e| format!("读取目录项失败: {e}"))?;
            let child_src = entry.path();
            let child_dst = dst.join(entry.file_name());
            copy_path_recursive(&child_src, &child_dst)?;
        }
        Ok(())
    } else {
        if let Some(parent) = dst.parent() {
            std::fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {e}"))?;
        }
        std::fs::copy(src, dst).map_err(|e| format!("复制失败: {e}"))?;
        Ok(())
    }
}

#[tauri::command]
pub async fn copy_path(workspace: String, from: String, to: String) -> Result<(), String> {
    assert_under_workspace(&workspace, &from)?;
    assert_under_workspace(&workspace, &to)?;
    let src = Path::new(&from);
    let dst = Path::new(&to);
    if dst.exists() {
        return Err("目标已存在".into());
    }
    copy_path_recursive(src, dst)
}

/// Copy any readable local file into the workspace (overwrite). Dest must be under workspace.
#[tauri::command]
pub async fn import_file_into_workspace(
    workspace: String,
    src_path: String,
    dest_path: String,
) -> Result<String, String> {
    let ws = Path::new(&workspace)
        .canonicalize()
        .map_err(|e| format!("工作区无效: {e}"))?;
    let src = Path::new(&src_path);
    if !src.is_file() {
        return Err(format!("源文件不存在: {src_path}"));
    }
    let dest = {
        let p = Path::new(&dest_path);
        if p.is_absolute() {
            p.to_path_buf()
        } else {
            ws.join(p)
        }
    };
    let dest_str = dest.to_string_lossy().to_string();
    assert_under_workspace(&workspace, &dest_str)?;
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {e}"))?;
    }
    if dest.exists() {
        if dest.is_dir() {
            return Err("目标是目录，无法覆盖为文件".into());
        }
        std::fs::remove_file(&dest).map_err(|e| format!("无法覆盖目标: {e}"))?;
    }
    std::fs::copy(src, &dest).map_err(|e| format!("导入失败: {e}"))?;
    Ok(dest.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn create_workspace_path(
    workspace: String,
    path: String,
    is_dir: bool,
) -> Result<(), String> {
    let abs = resolve_workspace_path(&workspace, &path);
    let abs_str = abs.to_string_lossy().to_string();
    assert_under_workspace(&workspace, &abs_str)?;
    let p = Path::new(&abs_str);
    if is_dir {
        std::fs::create_dir_all(p).map_err(|e| format!("创建目录失败: {e}"))
    } else {
        if let Some(parent) = p.parent() {
            std::fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {e}"))?;
        }
        std::fs::File::create(p).map_err(|e| format!("创建文件失败: {e}"))?;
        Ok(())
    }
}

#[tauri::command]
pub async fn grep_workspace(
    workspace: String,
    pattern: String,
    max_hits: Option<usize>,
) -> Result<String, String> {
    let root = Path::new(&workspace);
    if !root.is_dir() {
        return Err(format!("Not a directory: {workspace}"));
    }
    let query = pattern.trim();
    if query.is_empty() {
        return Err("搜索内容不能为空".into());
    }
    let max = max_hits.unwrap_or(50).min(200);
    let opts = crate::agent::rg_util::RgGrepOpts {
        query,
        root,
        workspace: root,
        glob: None,
        fixed_strings: true,
        max_hits: max,
    };
    Ok(crate::agent::rg_util::grep_search(&opts).unwrap_or_else(|| "grep 失败".into()))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListeningPortInfo {
    pub protocol: String,
    pub local: String,
    pub pid: String,
    pub state: String,
}

/// List TCP listening ports (for IDE Ports panel).
#[tauri::command]
pub async fn xu_list_listening_ports() -> Result<Vec<ListeningPortInfo>, String> {
    tokio::task::spawn_blocking(|| {
        #[cfg(windows)]
        {
            let output = std::process::Command::new("netstat")
                .args(["-ano", "-p", "tcp"])
                .output()
                .map_err(|e| format!("netstat 失败: {e}"))?;
            let text = String::from_utf8_lossy(&output.stdout);
            let mut out = Vec::new();
            for line in text.lines() {
                let line = line.trim();
                if !line.starts_with("TCP") {
                    continue;
                }
                let parts: Vec<&str> = line.split_whitespace().collect();
                // TCP  0.0.0.0:1420  0.0.0.0:0  LISTENING  1234
                if parts.len() < 5 {
                    continue;
                }
                let state = parts[3];
                if !state.eq_ignore_ascii_case("LISTENING") {
                    continue;
                }
                out.push(ListeningPortInfo {
                    protocol: parts[0].to_string(),
                    local: parts[1].to_string(),
                    state: state.to_string(),
                    pid: parts[4].to_string(),
                });
            }
            out.sort_by(|a, b| a.local.cmp(&b.local));
            out.dedup_by(|a, b| a.local == b.local && a.pid == b.pid);
            Ok(out)
        }
        #[cfg(not(windows))]
        {
            let output = std::process::Command::new("sh")
                .args(["-c", "ss -ltnp 2>/dev/null || netstat -ltnp 2>/dev/null"])
                .output()
                .map_err(|e| format!("列出端口失败: {e}"))?;
            let text = String::from_utf8_lossy(&output.stdout);
            let mut out = Vec::new();
            for line in text.lines().skip(1) {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() < 4 {
                    continue;
                }
                let local = parts.get(3).or_else(|| parts.get(4)).copied().unwrap_or("");
                if local.is_empty() {
                    continue;
                }
                out.push(ListeningPortInfo {
                    protocol: parts[0].to_string(),
                    local: local.to_string(),
                    state: "LISTEN".into(),
                    pid: parts.last().copied().unwrap_or("-").to_string(),
                });
            }
            Ok(out)
        }
    })
    .await
    .map_err(|e| format!("端口任务失败: {e}"))?
}
