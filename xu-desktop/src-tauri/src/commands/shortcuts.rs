//! 全局快捷键注册；截图事件只定向发送给一个拥有者窗口。
//!
//! @author qiuye <yjk150@qq.com>
//! @date 2026-08-30
//! @version 1.1.0
//! @category Config
//! @algo single-owner-event-routing

use crate::xu_paths;
use serde::{Deserialize, Serialize};
use std::fs;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ShortcutSpec {
    pub modifiers: Vec<String>,
    pub code: String,
    #[serde(default)]
    pub label: String,
}

impl Default for ShortcutSpec {
    fn default() -> Self {
        Self {
            modifiers: vec!["Alt".into()],
            code: "KeyA".into(),
            label: "Alt+A".into(),
        }
    }
}

pub struct ScreenshotShortcutState(pub Mutex<Option<Shortcut>>);

fn screenshot_event_owner(app: &AppHandle) -> Option<tauri::WebviewWindow> {
    app.get_webview_window("main")
        .or_else(|| app.get_webview_window("chat"))
        .or_else(|| app.get_webview_window("ide"))
}

fn shortcuts_file() -> Result<std::path::PathBuf, String> {
    Ok(xu_paths::xu_home()?.join("shortcuts.json"))
}

fn read_persisted_screenshot() -> ShortcutSpec {
    let path = match shortcuts_file() {
        Ok(p) => p,
        Err(_) => return ShortcutSpec::default(),
    };
    let raw = match fs::read_to_string(&path) {
        Ok(s) => s,
        Err(_) => return ShortcutSpec::default(),
    };
    let doc: serde_json::Value = match serde_json::from_str(&raw) {
        Ok(v) => v,
        Err(_) => return ShortcutSpec::default(),
    };
    doc.get("screenshot")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default()
}

fn write_persisted_screenshot(spec: &ShortcutSpec) -> Result<(), String> {
    let path = shortcuts_file()?;
    let mut doc: serde_json::Value = fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_else(|| serde_json::json!({}));
    if let serde_json::Value::Object(ref mut map) = doc {
        map.insert(
            "screenshot".into(),
            serde_json::to_value(spec).map_err(|e| e.to_string())?,
        );
    }
    fs::write(
        &path,
        serde_json::to_string_pretty(&doc).unwrap_or_default(),
    )
    .map_err(|e| format!("写入快捷键配置失败: {e}"))
}

fn modifiers_from_spec(modifiers: &[String]) -> Modifiers {
    let mut m = Modifiers::empty();
    for s in modifiers {
        match s.as_str() {
            "Alt" => m |= Modifiers::ALT,
            "Control" => m |= Modifiers::CONTROL,
            "Shift" => m |= Modifiers::SHIFT,
            "Super" => m |= Modifiers::SUPER,
            _ => {}
        }
    }
    m
}

fn code_from_str(code: &str) -> Result<Code, String> {
    match code {
        "KeyA" => Ok(Code::KeyA),
        "KeyB" => Ok(Code::KeyB),
        "KeyC" => Ok(Code::KeyC),
        "KeyD" => Ok(Code::KeyD),
        "KeyE" => Ok(Code::KeyE),
        "KeyF" => Ok(Code::KeyF),
        "KeyG" => Ok(Code::KeyG),
        "KeyH" => Ok(Code::KeyH),
        "KeyI" => Ok(Code::KeyI),
        "KeyJ" => Ok(Code::KeyJ),
        "KeyK" => Ok(Code::KeyK),
        "KeyL" => Ok(Code::KeyL),
        "KeyM" => Ok(Code::KeyM),
        "KeyN" => Ok(Code::KeyN),
        "KeyO" => Ok(Code::KeyO),
        "KeyP" => Ok(Code::KeyP),
        "KeyQ" => Ok(Code::KeyQ),
        "KeyR" => Ok(Code::KeyR),
        "KeyS" => Ok(Code::KeyS),
        "KeyT" => Ok(Code::KeyT),
        "KeyU" => Ok(Code::KeyU),
        "KeyV" => Ok(Code::KeyV),
        "KeyW" => Ok(Code::KeyW),
        "KeyX" => Ok(Code::KeyX),
        "KeyY" => Ok(Code::KeyY),
        "KeyZ" => Ok(Code::KeyZ),
        "Digit0" => Ok(Code::Digit0),
        "Digit1" => Ok(Code::Digit1),
        "Digit2" => Ok(Code::Digit2),
        "Digit3" => Ok(Code::Digit3),
        "Digit4" => Ok(Code::Digit4),
        "Digit5" => Ok(Code::Digit5),
        "Digit6" => Ok(Code::Digit6),
        "Digit7" => Ok(Code::Digit7),
        "Digit8" => Ok(Code::Digit8),
        "Digit9" => Ok(Code::Digit9),
        "F1" => Ok(Code::F1),
        "F2" => Ok(Code::F2),
        "F3" => Ok(Code::F3),
        "F4" => Ok(Code::F4),
        "F5" => Ok(Code::F5),
        "F6" => Ok(Code::F6),
        "F7" => Ok(Code::F7),
        "F8" => Ok(Code::F8),
        "F9" => Ok(Code::F9),
        "F10" => Ok(Code::F10),
        "F11" => Ok(Code::F11),
        "F12" => Ok(Code::F12),
        other => Err(format!("不支持的按键: {other}")),
    }
}

pub fn register_screenshot_shortcut(app: &AppHandle, spec: &ShortcutSpec) -> Result<(), String> {
    let mods = modifiers_from_spec(&spec.modifiers);
    let code = code_from_str(&spec.code)?;
    let shortcut = Shortcut::new(Some(mods), code);

    if let Some(state) = app.try_state::<ScreenshotShortcutState>() {
        if let Ok(mut guard) = state.0.lock() {
            if let Some(old) = guard.take() {
                let _ = app.global_shortcut().unregister(old);
            }
        }
    }

    let _ = app.global_shortcut().unregister(shortcut);

    app.global_shortcut()
        .on_shortcut(shortcut, |app, _shortcut, event| {
            if event.state() == ShortcutState::Pressed {
                if let Some(owner) = screenshot_event_owner(app) {
                    let _ = owner.emit("xu-screenshot-start", ());
                } else {
                    eprintln!("[xu] screenshot shortcut ignored: no owner window");
                }
            }
        })
        .map_err(|e| format!("快捷键注册失败（可能已被其他程序占用）: {e}"))?;

    if let Some(state) = app.try_state::<ScreenshotShortcutState>() {
        if let Ok(mut guard) = state.0.lock() {
            *guard = Some(shortcut);
        }
    }

    Ok(())
}

pub fn setup_screenshot_shortcut(app: &AppHandle) -> Result<(), String> {
    let spec = read_persisted_screenshot();
    if let Err(e) = register_screenshot_shortcut(app, &spec) {
        eprintln!("[xu] screenshot shortcut skipped: {e}");
    }
    Ok(())
}

#[tauri::command]
pub fn xu_get_screenshot_shortcut() -> ShortcutSpec {
    read_persisted_screenshot()
}

#[tauri::command]
pub fn xu_set_screenshot_shortcut(app: AppHandle, spec: ShortcutSpec) -> Result<(), String> {
    register_screenshot_shortcut(&app, &spec)?;
    write_persisted_screenshot(&spec)?;
    Ok(())
}
