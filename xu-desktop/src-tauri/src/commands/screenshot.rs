//! 截图会话互斥、显示器采集与有界临时文件清理。
//!
//! @author qiuye <yjk150@qq.com>
//! @date 2026-08-30
//! @updated 2026-08-31
//! @version 1.2.0
//! @category Stream
//! @algo owner-token-ttl-lease + spawn_blocking-jpeg

use image::codecs::jpeg::JpegEncoder;
use image::ExtendedColorType;
use serde::Serialize;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager, State};
use xcap::{Monitor, Window};

const MAX_CAPTURE_FILES: usize = 24;
const MAX_CAPTURE_AGE_SECS: u64 = 24 * 60 * 60;
const CAPTURE_LEASE_TTL: Duration = Duration::from_secs(30);

#[derive(Default)]
struct CaptureLease {
    owner: Option<String>,
    token: Option<String>,
    expires_at: Option<Instant>,
}

impl CaptureLease {
    fn acquire_at(&mut self, owner: String, now: Instant) -> Option<String> {
        if self.expires_at.is_some_and(|expires| expires <= now) {
            self.clear();
        }
        if self.owner.is_some() {
            return None;
        }
        let token = uuid::Uuid::new_v4().to_string();
        self.owner = Some(owner);
        self.token = Some(token.clone());
        self.expires_at = Some(now + CAPTURE_LEASE_TTL);
        Some(token)
    }

    fn validate_at(&mut self, owner: &str, token: &str, now: Instant) -> bool {
        if self.expires_at.is_none_or(|expires| expires <= now) {
            self.clear();
            return false;
        }
        if self.owner.as_deref() != Some(owner) || self.token.as_deref() != Some(token) {
            return false;
        }
        self.expires_at = Some(now + CAPTURE_LEASE_TTL);
        true
    }

    fn release(&mut self, owner: &str, token: &str) -> bool {
        if self.owner.as_deref() != Some(owner) || self.token.as_deref() != Some(token) {
            return false;
        }
        self.clear();
        true
    }

    fn release_owner(&mut self, owner: &str) {
        if self.owner.as_deref() == Some(owner) {
            self.clear();
        }
    }

    fn clear(&mut self) {
        self.owner = None;
        self.token = None;
        self.expires_at = None;
    }
}

/// Process-wide screenshot session owner; managed by Tauri and shared by every WebView.
pub struct ScreenshotCaptureState(Mutex<CaptureLease>);

impl ScreenshotCaptureState {
    pub fn new() -> Self {
        Self(Mutex::new(CaptureLease::default()))
    }

    /// Releases a lease owned by a WebView that has been destroyed.
    pub fn release_window(&self, owner: &str) {
        if let Ok(mut lease) = self.0.lock() {
            lease.release_owner(owner);
        }
    }
}

static CAPTURE_ENCODER_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitorCaptureAtPoint {
    pub path: String,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub scale_factor: f32,
    pub monitor_id: u32,
    pub name: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureWindowInfo {
    pub id: u32,
    pub title: String,
    pub app_name: String,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub z: i32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenshotLeaseGrant {
    pub token: String,
    pub ttl_ms: u64,
}

fn capture_save_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("tauri-plugin-screenshots");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn cleanup_capture_files(dir: &std::path::Path) {
    let now = std::time::SystemTime::now();
    let mut files = match std::fs::read_dir(dir) {
        Ok(entries) => entries
            .filter_map(Result::ok)
            .filter_map(|entry| {
                let meta = entry.metadata().ok()?;
                if !meta.is_file() {
                    return None;
                }
                Some((
                    entry.path(),
                    meta.modified().unwrap_or(std::time::UNIX_EPOCH),
                ))
            })
            .collect::<Vec<_>>(),
        Err(_) => return,
    };
    files.sort_by(|a, b| b.1.cmp(&a.1));
    for (index, (path, modified)) in files.into_iter().enumerate() {
        let expired = now
            .duration_since(modified)
            .map(|age| age.as_secs() > MAX_CAPTURE_AGE_SECS)
            .unwrap_or(false);
        if expired || index >= MAX_CAPTURE_FILES {
            let _ = std::fs::remove_file(path);
        }
    }
}

/// Acquire the single screenshot session for one WebView owner.
/// Dependency: Tauri managed `ScreenshotCaptureState`; failure returns false without replacing owner.
#[tauri::command]
pub fn xu_screenshot_acquire(
    state: State<'_, ScreenshotCaptureState>,
    owner: String,
) -> Result<Option<ScreenshotLeaseGrant>, String> {
    let owner = owner.trim();
    if owner.is_empty() {
        return Err("截图窗口标识为空".into());
    }
    let mut lease = state.0.lock().map_err(|_| "截图互斥锁不可用")?;
    Ok(lease
        .acquire_at(owner.to_string(), Instant::now())
        .map(|token| ScreenshotLeaseGrant {
            token,
            ttl_ms: CAPTURE_LEASE_TTL.as_millis() as u64,
        }))
}

/// Release a screenshot session only when the caller matches its owner.
/// Dependency: owner propagated with the overlay session; stale/mismatched releases are ignored.
#[tauri::command]
pub fn xu_screenshot_release(
    state: State<'_, ScreenshotCaptureState>,
    owner: String,
    token: String,
) -> Result<bool, String> {
    let mut lease = state.0.lock().map_err(|_| "截图互斥锁不可用")?;
    Ok(lease.release(owner.trim(), token.trim()))
}

fn is_our_app_window(app_name: &str, title: &str) -> bool {
    let a = app_name.to_lowercase();
    let t = title.to_lowercase();
    a.contains("foucui")
        || a.contains("虚募阁")
        || a.contains("hermes")
        || a.contains("fou")
        || t.contains("xu-screenshot")
        || t.contains("固定截图")
        || t.contains("虚募阁")
}

/// List capturable windows (screen coords), excluding minimized and our own UI.
#[tauri::command]
pub async fn xu_list_capture_windows() -> Result<Vec<CaptureWindowInfo>, String> {
    tokio::task::spawn_blocking(|| {
        let windows = Window::all().map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        for w in windows {
            if w.is_minimized() {
                continue;
            }
            let width = w.width();
            let height = w.height();
            if width < 8 || height < 8 {
                continue;
            }
            let app_name = w.app_name().to_string();
            let title = w.title().to_string();
            if is_our_app_window(&app_name, &title) {
                continue;
            }
            out.push(CaptureWindowInfo {
                id: w.id(),
                title,
                app_name,
                x: w.x(),
                y: w.y(),
                width,
                height,
                z: w.z(),
            });
        }
        out.sort_by(|a, b| b.z.cmp(&a.z));
        Ok(out)
    })
    .await
    .map_err(|e| format!("列举窗口失败: {e}"))?
}

/// Monitor metadata at cursor (no capture — fast).
#[tauri::command]
pub async fn xu_monitor_bounds_at_point(x: i32, y: i32) -> Result<MonitorCaptureAtPoint, String> {
    tokio::task::spawn_blocking(move || {
        let monitor =
            Monitor::from_point(x, y).map_err(|e| format!("未找到光标所在显示器: {e}"))?;
        Ok(MonitorCaptureAtPoint {
            path: String::new(),
            x: monitor.x(),
            y: monitor.y(),
            width: monitor.width(),
            height: monitor.height(),
            scale_factor: monitor.scale_factor(),
            monitor_id: monitor.id(),
            name: monitor.name().to_string(),
        })
    })
    .await
    .map_err(|e| format!("读取显示器失败: {e}"))?
}

/// Topmost window under physical point (for hover pick).
#[tauri::command]
pub async fn xu_window_rect_at_point(x: i32, y: i32) -> Result<Option<CaptureWindowInfo>, String> {
    tokio::task::spawn_blocking(move || {
        let windows = Window::all().map_err(|e| e.to_string())?;
        let mut hits: Vec<&Window> = windows
            .iter()
            .filter(|w| {
                if w.is_minimized() {
                    return false;
                }
                let app_name = w.app_name();
                let title = w.title();
                if is_our_app_window(app_name, title) {
                    return false;
                }
                let ww = w.width();
                let wh = w.height();
                if ww < 8 || wh < 8 {
                    return false;
                }
                let wx = w.x();
                let wy = w.y();
                x >= wx && x < wx + ww as i32 && y >= wy && y < wy + wh as i32
            })
            .collect();
        hits.sort_by(|a, b| b.z().cmp(&a.z()));
        Ok(hits.first().map(|w| CaptureWindowInfo {
            id: w.id(),
            title: w.title().to_string(),
            app_name: w.app_name().to_string(),
            x: w.x(),
            y: w.y(),
            width: w.width(),
            height: w.height(),
            z: w.z(),
        }))
    })
    .await
    .map_err(|e| format!("窗口探测失败: {e}"))?
}

/// Capture the monitor containing physical point (x, y). Uses xcap::Monitor::from_point.
#[tauri::command]
pub async fn xu_capture_monitor_at_point(
    app: AppHandle,
    state: State<'_, ScreenshotCaptureState>,
    owner: String,
    token: String,
    x: i32,
    y: i32,
) -> Result<MonitorCaptureAtPoint, String> {
    {
        let mut lease = state.0.lock().map_err(|_| "截图互斥锁不可用")?;
        if !lease.validate_at(owner.trim(), token.trim(), Instant::now()) {
            return Err("截图会话已过期或无权访问，请重新开始截图".into());
        }
    }
    tokio::task::spawn_blocking(move || {
        let _capture_guard = CAPTURE_ENCODER_LOCK
            .get_or_init(|| Mutex::new(()))
            .lock()
            .map_err(|_| "截图编码互斥锁不可用")?;
        let monitor =
            Monitor::from_point(x, y).map_err(|e| format!("未找到光标所在显示器: {e}"))?;
        let rgba = monitor
            .capture_image()
            .map_err(|e| format!("截屏失败: {e}"))?;
        let rgb = image::DynamicImage::ImageRgba8(rgba).into_rgb8();
        let (img_w, img_h) = rgb.dimensions();

        let save_dir = capture_save_dir(&app)?;
        cleanup_capture_files(&save_dir);
        let file_name = format!(
            "monitor-{}-{}.jpg",
            monitor.id(),
            chrono::Utc::now().timestamp_millis()
        );
        let save_path = save_dir.join(&file_name);
        {
            let file =
                std::fs::File::create(&save_path).map_err(|e| format!("保存截图失败: {e}"))?;
            let writer = std::io::BufWriter::new(file);
            let mut encoder = JpegEncoder::new_with_quality(writer, 88);
            encoder
                .encode(rgb.as_raw(), img_w, img_h, ExtendedColorType::Rgb8)
                .map_err(|e| format!("保存截图失败: {e}"))?;
        }
        cleanup_capture_files(&save_dir);

        Ok(MonitorCaptureAtPoint {
            path: save_path.to_string_lossy().into_owned(),
            x: monitor.x(),
            y: monitor.y(),
            width: monitor.width(),
            height: monitor.height(),
            scale_factor: monitor.scale_factor(),
            monitor_id: monitor.id(),
            name: monitor.name().to_string(),
        })
    })
    .await
    .map_err(|e| format!("截屏任务失败: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::CaptureLease;
    use std::time::{Duration, Instant};

    #[test]
    fn capture_lease_has_one_owner_and_rejects_stale_release() {
        let mut lease = CaptureLease::default();
        let now = Instant::now();
        let token = lease.acquire_at("main".into(), now).unwrap();
        assert!(lease.acquire_at("ide".into(), now).is_none());
        assert!(!lease.release("main", "wrong-token"));
        assert!(!lease.validate_at("ide", &token, now));
        assert!(lease.release("main", &token));
        assert!(lease.acquire_at("ide".into(), now).is_some());
    }

    #[test]
    fn capture_lease_expires_and_requires_token() {
        let mut lease = CaptureLease::default();
        let now = Instant::now();
        let token = lease.acquire_at("main".into(), now).unwrap();
        assert!(!lease.validate_at("main", "", now));
        assert!(!lease.validate_at("main", &token, now + Duration::from_secs(31)));
        assert!(lease
            .acquire_at("ide".into(), now + Duration::from_secs(31))
            .is_some());
    }
}
