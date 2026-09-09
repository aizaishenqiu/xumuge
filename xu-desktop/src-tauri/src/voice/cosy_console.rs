//! CosyVoice 控制台独立窗口：加载 Vue 原生页 `#/cosy-console`（无 iframe / 无 manager.py）。
//!
//! @author qiuye <yjk150@qq.com>
//! @date 2026-09-01
//! @version 2.0.0
//! @category Config
//! @algo native-vue-console-window

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

const CONSOLE_LABEL: &str = "cosy-console";

fn console_app_url(app: &AppHandle) -> Result<tauri::Url, String> {
    let config = app.config();
    let base = config
        .build
        .dev_url
        .as_ref()
        .map(|u| u.as_str())
        .filter(|u| !u.is_empty())
        .unwrap_or("http://tauri.localhost");
    format!("{}/#/cosy-console", base.trim_end_matches('/'))
        .parse()
        .map_err(|e| format!("控制台 URL 无效：{e}"))
}

fn strip_app_menu(win: &WebviewWindow) {
    let _ = win.remove_menu();
}

fn show_console_window(app: &AppHandle, win: &WebviewWindow) -> Result<(), String> {
    strip_app_menu(win);
    win.navigate(console_app_url(app)?)
        .map_err(|e| format!("控制台加载失败：{e}"))?;
    win.show().map_err(|e| e.to_string())?;
    win.set_focus().map_err(|e| e.to_string())?;
    Ok(())
}

/// 打开原生 CosyVoice 控制台（Vue + Rust invoke，非 iframe）。
pub fn open_console_window(app: &AppHandle) -> Result<String, String> {
    let url = console_app_url(app)?;
    if let Some(win) = app.get_webview_window(CONSOLE_LABEL) {
        show_console_window(app, &win)?;
        return Ok(url.to_string());
    }
    #[allow(unused_mut)]
    let mut builder = WebviewWindowBuilder::new(app, CONSOLE_LABEL, WebviewUrl::External(url.clone()))
        .title("CosyVoice 控制台")
        .inner_size(1280.0, 860.0)
        .min_inner_size(960.0, 640.0)
        .center();
    #[cfg(feature = "devtools")]
    {
        builder = builder.devtools(true);
    }
    let win = builder
        .build()
        .map_err(|e| format!("打开控制台窗口失败：{e}"))?;
    strip_app_menu(&win);
    Ok(url.to_string())
}
