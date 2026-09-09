/**
 * @file office_window.rs 办公室沉浸：系统全屏 + Windows 直角窗口
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-30
 * @version 1.0.0
 * @category UI
 * @algo tauri-window-fullscreen-dwm
 */
use tauri::WebviewWindow;

const BG_NORMAL: tauri::window::Color = tauri::window::Color(0x12, 0x16, 0x1a, 255);
const BG_IMMERSIVE: tauri::window::Color = tauri::window::Color(0x07, 0x08, 0x0c, 255);

/// 进入/退出办公室沉浸：系统全屏并同步窗口背景与 Windows 直角偏好。
#[tauri::command]
pub async fn xu_office_set_immersive(window: WebviewWindow, on: bool) -> Result<(), String> {
    window
        .set_fullscreen(on)
        .map_err(|e| format!("set_fullscreen({on}): {e}"))?;
    window
        .set_background_color(Some(if on { BG_IMMERSIVE } else { BG_NORMAL }))
        .map_err(|e| e.to_string())?;
    #[cfg(windows)]
    set_win_corner_preference(&window, !on)?;
    Ok(())
}

#[cfg(windows)]
fn set_win_corner_preference(window: &WebviewWindow, round: bool) -> Result<(), String> {
    use std::os::raw::c_void;

    let hwnd = window.hwnd().map_err(|e| e.to_string())?;
    let hwnd_raw = hwnd.0 as isize;

    const DWMWA_WINDOW_CORNER_PREFERENCE: u32 = 33;
    const DWMWCP_DEFAULT: u32 = 0;
    const DWMWCP_DONOTROUND: u32 = 1;
    let pref = if round {
        DWMWCP_DEFAULT
    } else {
        DWMWCP_DONOTROUND
    };

    #[link(name = "dwmapi")]
    extern "system" {
        fn DwmSetWindowAttribute(
            hwnd: isize,
            dw_attribute: u32,
            pv_attribute: *const c_void,
            cb_attribute: u32,
        ) -> i32;
    }

    let hr = unsafe {
        DwmSetWindowAttribute(
            hwnd_raw,
            DWMWA_WINDOW_CORNER_PREFERENCE,
            &pref as *const u32 as *const c_void,
            std::mem::size_of::<u32>() as u32,
        )
    };
    if hr != 0 {
        return Err(format!("DwmSetWindowAttribute failed: {hr}"));
    }
    Ok(())
}
