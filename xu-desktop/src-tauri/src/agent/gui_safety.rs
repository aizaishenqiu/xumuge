//! 实验性 GUI 驾驶的目标绑定、白名单、真实输入中止与急停状态机。
//!
//! @author qiuye <yjk150@qq.com>
//! @date 2026-08-31
//! @version 1.1.0
//! @category ToolPolicy
//! @algo fail-closed-target-binding

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::gui_uia;

static EMERGENCY_STOP: AtomicBool = AtomicBool::new(false);
static REAL_INPUT_EPOCH: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GuiTargetBinding {
    pub window_id: String,
    pub process_id: u32,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub client_rect: Option<gui_uia::RectI32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub screen_origin: Option<gui_uia::PointI32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dpi_scale: Option<f64>,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum GuiProviderKind {
    WindowsUiaExperimental,
    CoordinateExperimental,
}

impl GuiProviderKind {
    pub fn parse(raw: &str) -> Option<Self> {
        match raw.trim().to_ascii_lowercase().as_str() {
            "windows_uia_experimental" => Some(Self::WindowsUiaExperimental),
            "coordinate_experimental" => Some(Self::CoordinateExperimental),
            _ => None,
        }
    }
}

/// Marks physical keyboard/mouse activity and immediately latches emergency stop.
/// Dependency: platform input monitor/provider; no automatic resume is allowed.
pub fn note_real_input() {
    REAL_INPUT_EPOCH.fetch_add(1, Ordering::SeqCst);
    EMERGENCY_STOP.store(true, Ordering::SeqCst);
}

/// Latches GUI emergency stop without injecting input.
pub fn emergency_stop() {
    EMERGENCY_STOP.store(true, Ordering::SeqCst);
}

/// Clears the stop latch only after an explicit user action.
pub fn reset_emergency_stop() {
    EMERGENCY_STOP.store(false, Ordering::SeqCst);
}

/// Returns the monotonic physical-input generation used by target bindings.
pub fn real_input_epoch() -> u64 {
    REAL_INPUT_EPOCH.load(Ordering::SeqCst)
}

fn enrich_binding(mut binding: GuiTargetBinding) -> GuiTargetBinding {
    if let Ok(hwnd) = gui_uia::parse_hwnd(&binding.window_id) {
        if let Ok(geo) = gui_uia::window_geometry(hwnd) {
            binding.client_rect = Some(geo.client_rect);
            binding.screen_origin = Some(geo.screen_origin);
            binding.dpi_scale = Some(geo.dpi_scale);
        }
    }
    binding
}

/// Captures the current foreground window for a later exact action binding.
/// Dependency: Windows user32; non-Windows providers remain unavailable.
pub fn capture_target() -> Result<GuiTargetBinding, String> {
    platform_foreground_target().map(enrich_binding)
}

#[cfg_attr(test, allow(dead_code))]
fn same_window_binding(expected: &GuiTargetBinding, current: &GuiTargetBinding) -> bool {
    expected.window_id == current.window_id && expected.process_id == current.process_id
}

/// Validates one GUI action against the latched stop, exact target and title allowlist.
/// Dependency: a previously captured target binding; coordinate-only calls are rejected.
/// Failure: returns a user-safe reason and performs no input.
pub fn validate_action(
    args: &Value,
    allowlist: &[String],
    expected_input_epoch: u64,
) -> Result<(GuiTargetBinding, GuiProviderKind), String> {
    if EMERGENCY_STOP.load(Ordering::SeqCst) {
        return Err("GUI 急停已触发；禁止继续注入，须人工重新启用".into());
    }
    if REAL_INPUT_EPOCH.load(Ordering::SeqCst) != expected_input_epoch {
        emergency_stop();
        return Err("检测到真实键鼠输入，已立即停止 GUI 注入".into());
    }
    let target: GuiTargetBinding = serde_json::from_value(
        args.get("target")
            .cloned()
            .ok_or("GUI 动作缺少 target window binding")?,
    )
    .map_err(|_| "GUI target window binding 格式无效".to_string())?;
    if target.window_id.trim().is_empty()
        || target.process_id == 0
        || target.title.trim().is_empty()
    {
        return Err("GUI target binding 必须包含 windowId/processId/title".into());
    }
    if !allowlist
        .iter()
        .any(|allowed| !allowed.trim().is_empty() && target.title.contains(allowed.trim()))
    {
        return Err(format!("目标窗口不在 GUI 白名单：{}", target.title));
    }
    let provider = args
        .get("provider")
        .and_then(Value::as_str)
        .and_then(GuiProviderKind::parse)
        .unwrap_or(GuiProviderKind::CoordinateExperimental);
    #[cfg(not(test))]
    {
        let current = platform_foreground_target()?;
        if !same_window_binding(&target, &current) {
            emergency_stop();
            return Err("目标窗口绑定已变化，已急停；请重新绑定并审批".into());
        }
    }
    Ok((target, provider))
}

#[cfg(windows)]
fn platform_foreground_target() -> Result<GuiTargetBinding, String> {
    use std::ffi::c_void;
    type Hwnd = *mut c_void;
    #[link(name = "user32")]
    extern "system" {
        fn GetForegroundWindow() -> Hwnd;
        fn GetWindowTextLengthW(hwnd: Hwnd) -> i32;
        fn GetWindowTextW(hwnd: Hwnd, text: *mut u16, max_count: i32) -> i32;
        fn GetWindowThreadProcessId(hwnd: Hwnd, process_id: *mut u32) -> u32;
    }
    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.is_null() {
            return Err("无法绑定前台窗口".into());
        }
        let len = GetWindowTextLengthW(hwnd).max(0) as usize;
        let mut buffer = vec![0u16; len.saturating_add(1)];
        let read = GetWindowTextW(hwnd, buffer.as_mut_ptr(), buffer.len() as i32).max(0) as usize;
        let title = String::from_utf16_lossy(&buffer[..read]);
        let mut process_id = 0u32;
        GetWindowThreadProcessId(hwnd, &mut process_id);
        if title.trim().is_empty() || process_id == 0 {
            return Err("前台窗口缺少可验证标题或进程 id".into());
        }
        Ok(GuiTargetBinding {
            window_id: format!("{}", hwnd as usize),
            process_id,
            title,
            client_rect: None,
            screen_origin: None,
            dpi_scale: None,
        })
    }
}

#[cfg(not(windows))]
fn platform_foreground_target() -> Result<GuiTargetBinding, String> {
    Err("GUI target binding 当前仅有 Windows experimental provider".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::sync::{Mutex, OnceLock};

    fn test_lock() -> std::sync::MutexGuard<'static, ()> {
        static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        LOCK.get_or_init(|| Mutex::new(())).lock().unwrap()
    }

    fn target() -> Value {
        json!({
            "target": { "windowId": "42", "processId": 7, "title": "Cursor — demo" },
            "provider": "coordinate_experimental"
        })
    }

    #[test]
    fn target_binding_and_allowlist_are_fail_closed() {
        let _guard = test_lock();
        reset_emergency_stop();
        let epoch = real_input_epoch();
        assert!(validate_action(&target(), &["Cursor".into()], epoch).is_ok());
        assert!(validate_action(&target(), &["Notepad".into()], epoch)
            .unwrap_err()
            .contains("白名单"));
        assert!(validate_action(&json!({}), &["Cursor".into()], epoch).is_err());
        reset_emergency_stop();
    }

    #[test]
    fn uia_provider_is_accepted() {
        let _guard = test_lock();
        reset_emergency_stop();
        let epoch = real_input_epoch();
        let mut args = target();
        args["provider"] = json!("windows_uia_experimental");
        assert!(validate_action(&args, &["Cursor".into()], epoch).is_ok());
        reset_emergency_stop();
    }

    #[test]
    fn real_input_latches_abort_until_manual_reset() {
        let _guard = test_lock();
        reset_emergency_stop();
        let epoch = real_input_epoch();
        note_real_input();
        assert!(validate_action(&target(), &["Cursor".into()], epoch)
            .unwrap_err()
            .contains("急停"));
        reset_emergency_stop();
    }
}
