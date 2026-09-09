//! 系统剪贴板与截图 PNG 二进制落盘，编码工作不阻塞命令线程。
//!
//! @author qiuye <yjk150@qq.com>
//! @date 2026-08-30
//! @version 1.1.0
//! @category Stream
//! @algo spawn_blocking-png

use arboard::{Clipboard, ImageData};
use base64::Engine;
use image::ImageFormat;
use tauri::Manager;

/// Write a base64 PNG into the system clipboard.
/// Dependency: OS clipboard; malformed PNG or clipboard contention returns an error.
#[tauri::command]
pub fn xu_clipboard_set_image(png_base64: String) -> Result<(), String> {
    let raw = png_base64.trim();
    let b64 = raw.strip_prefix("data:image/png;base64,").unwrap_or(raw);
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(b64)
        .map_err(|e| format!("Base64 解码失败: {e}"))?;
    let img = image::load_from_memory(&bytes).map_err(|e| format!("PNG 解析失败: {e}"))?;
    let rgba = img.to_rgba8();
    let (w, h) = rgba.dimensions();
    let data = ImageData {
        width: w as usize,
        height: h as usize,
        bytes: rgba.into_raw().into(),
    };
    let mut cb = Clipboard::new().map_err(|e| format!("打开剪贴板失败: {e}"))?;
    cb.set_image(data)
        .map_err(|e| format!("写入剪贴板失败: {e}"))?;
    Ok(())
}

/// Write PNG bytes into the system clipboard without a base64/data-URL round trip.
/// Dependency: OS clipboard and image decoder; decoding runs off the async runtime worker.
#[tauri::command]
pub async fn xu_clipboard_set_image_bytes(png_bytes: Vec<u8>) -> Result<(), String> {
    tokio::task::spawn_blocking(move || set_clipboard_png_bytes(png_bytes))
        .await
        .map_err(|e| format!("剪贴板任务失败: {e}"))?
}

fn set_clipboard_png_bytes(bytes: Vec<u8>) -> Result<(), String> {
    let img = image::load_from_memory_with_format(&bytes, ImageFormat::Png)
        .map_err(|e| format!("PNG 解析失败: {e}"))?;
    let rgba = img.to_rgba8();
    let (w, h) = rgba.dimensions();
    let data = ImageData {
        width: w as usize,
        height: h as usize,
        bytes: rgba.into_raw().into(),
    };
    let mut cb = Clipboard::new().map_err(|e| format!("打开剪贴板失败: {e}"))?;
    cb.set_image(data)
        .map_err(|e| format!("写入剪贴板失败: {e}"))
}

/// Write text into the system clipboard.
/// Dependency: OS clipboard; clipboard contention returns an error.
#[tauri::command]
pub fn xu_clipboard_set_text(text: String) -> Result<(), String> {
    let mut cb = Clipboard::new().map_err(|e| format!("打开剪贴板失败: {e}"))?;
    cb.set_text(&text)
        .map_err(|e| format!("写入剪贴板失败: {e}"))?;
    Ok(())
}

/// Read a PNG file from disk and return as data URL (for screenshot plugin temp files).
#[tauri::command]
pub async fn xu_read_png_data_url(path: String) -> Result<String, String> {
    xu_read_image_data_url(path).await
}

/// Read a screenshot file (PNG/JPEG/WebP) and return as data URL.
#[tauri::command]
pub async fn xu_read_image_data_url(path: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        let bytes = std::fs::read(&path).map_err(|e| format!("读取截图文件失败: {e}"))?;
        if bytes.is_empty() {
            return Err("截图文件为空".into());
        }
        let mime = if path.ends_with(".jpg") || path.ends_with(".jpeg") {
            "image/jpeg"
        } else if path.ends_with(".webp") {
            "image/webp"
        } else {
            "image/png"
        };
        let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
        Ok(format!("data:{mime};base64,{b64}"))
    })
    .await
    .map_err(|e| format!("读取任务失败: {e}"))?
}

/// Save raw bytes to a user-selected or workspace path.
/// Duty: 画板 PNG/PDF/DXF 另存为；失败返回可读错误。
#[tauri::command]
pub async fn xu_write_bytes_file(path: String, bytes: Vec<u8>) -> Result<(), String> {
    if path.trim().is_empty() {
        return Err("路径为空".into());
    }
    if bytes.len() > 20_000_000 {
        return Err("文件过大".into());
    }
    tokio::task::spawn_blocking(move || {
        if let Some(parent) = std::path::Path::new(&path).parent() {
            std::fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {e}"))?;
        }
        std::fs::write(&path, bytes).map_err(|e| format!("保存失败: {e}"))
    })
    .await
    .map_err(|e| format!("保存任务失败: {e}"))?
}
#[tauri::command]
pub async fn xu_write_png_file(path: String, png_base64: String) -> Result<(), String> {
    let raw = png_base64.trim();
    let b64 = raw.strip_prefix("data:image/png;base64,").unwrap_or(raw);
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(b64)
        .map_err(|e| format!("Base64 解码失败: {e}"))?;
    let img = image::load_from_memory(&bytes).map_err(|e| format!("PNG 解析失败: {e}"))?;
    img.save_with_format(&path, ImageFormat::Png)
        .map_err(|e| format!("保存失败: {e}"))?;
    Ok(())
}

/// Save validated PNG bytes to a user-selected path on a blocking worker.
/// Dependency: writable destination; invalid PNG or filesystem failure returns an error.
#[tauri::command]
pub async fn xu_write_png_file_bytes(path: String, png_bytes: Vec<u8>) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        image::load_from_memory_with_format(&png_bytes, ImageFormat::Png)
            .map_err(|e| format!("PNG 解析失败: {e}"))?;
        std::fs::write(path, png_bytes).map_err(|e| format!("保存失败: {e}"))
    })
    .await
    .map_err(|e| format!("保存任务失败: {e}"))?
}

/// Persist an edited screenshot as a bounded app-data attachment and return its file path.
/// Dependency: app data directory; keeps at most 24 recent files and reports write failures.
#[tauri::command]
pub async fn xu_write_screenshot_temp(
    app: tauri::AppHandle,
    png_bytes: Vec<u8>,
) -> Result<String, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("tauri-plugin-screenshots");
    tokio::task::spawn_blocking(move || {
        image::load_from_memory_with_format(&png_bytes, ImageFormat::Png)
            .map_err(|e| format!("PNG 解析失败: {e}"))?;
        std::fs::create_dir_all(&dir).map_err(|e| format!("创建截图目录失败: {e}"))?;
        let path = dir.join(format!(
            "edited-{}.png",
            chrono::Utc::now().timestamp_millis()
        ));
        std::fs::write(&path, png_bytes).map_err(|e| format!("写入截图附件失败: {e}"))?;

        let mut files = std::fs::read_dir(&dir)
            .map_err(|e| format!("读取截图目录失败: {e}"))?
            .filter_map(Result::ok)
            .filter_map(|entry| {
                let meta = entry.metadata().ok()?;
                Some((
                    entry.path(),
                    meta.modified().unwrap_or(std::time::UNIX_EPOCH),
                ))
            })
            .collect::<Vec<_>>();
        files.sort_by(|a, b| b.1.cmp(&a.1));
        for (index, (old, _)) in files.into_iter().enumerate() {
            if index >= 24 {
                let _ = std::fs::remove_file(old);
            }
        }
        Ok(path.to_string_lossy().into_owned())
    })
    .await
    .map_err(|e| format!("截图附件任务失败: {e}"))?
}
