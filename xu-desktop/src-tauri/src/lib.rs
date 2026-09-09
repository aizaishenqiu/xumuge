//! 虚募阁桌面端 Tauri 入口与跨模块流事件类型。
//!
//! @author qiuye <yjk150@qq.com>
//! @date 2026-08-30
//! @updated 2026-08-31
//! @version 1.1.0
//! @category Stream
//! @algo atomic-pty-session-lifecycle

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};

use role_pack::RolePackState;

fn primary_webview(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window("main")
        .or_else(|| app.get_webview_window("chat"))
        .or_else(|| app.get_webview_window("ide"))
}

pub mod agent;
pub mod brand;
pub mod commands;
pub mod context_memory;
pub mod desktop_db;
pub mod employee;
pub mod xu_paths;
pub mod xu_env;
pub mod mcp;
pub mod pricing;
pub mod role_pack;
pub mod training_pack;
pub mod voice;

// ─── Shared Data Types ────────────────────────────────────────────────────────

#[derive(Serialize, Clone, Debug)]
pub struct StreamChunk {
    /// "text" | "think" | "think_start" | "think_end"
    /// "tool_name" | "tool_input" | "tool_output" | "tool_output_end"
    /// "status" | "session_stat" | "new_session_id" | "done" | "error"
    pub kind: String,
    pub content: String,
    pub session_id: String,
    pub run_id: String,
}

#[derive(Serialize, Clone, Debug)]
pub struct StatusInfo {
    pub model: String,
    pub tokens_used: String,
    pub tokens_max: String,
    pub cost: String,
    pub duration: String,
}

// ─── Shared App State ─────────────────────────────────────────────────────────

pub(crate) struct PtySession {
    pub(crate) generation: u64,
    pub(crate) writer: Box<dyn std::io::Write + Send>,
    pub(crate) master: Box<dyn portable_pty::MasterPty + Send>,
    pub(crate) child: Box<dyn portable_pty::Child + Send + Sync>,
}

pub struct AppState {
    pub(crate) pty_sessions: std::sync::Mutex<std::collections::HashMap<String, PtySession>>,
    pub(crate) next_pty_generation: std::sync::atomic::AtomicU64,
    pub say_process: std::sync::Mutex<Option<std::process::Child>>,
    pub feishu_ws_child: std::sync::Mutex<Option<std::process::Child>>,
    pub wecom_kf_child: std::sync::Mutex<Option<std::process::Child>>,
}

impl AppState {
    pub fn new() -> Self {
        AppState {
            pty_sessions: std::sync::Mutex::new(std::collections::HashMap::new()),
            next_pty_generation: std::sync::atomic::AtomicU64::new(1),
            say_process: std::sync::Mutex::new(None),
            feishu_ws_child: std::sync::Mutex::new(None),
            wecom_kf_child: std::sync::Mutex::new(None),
        }
    }
}

fn shutdown_children(app: &AppHandle) {
    let state = app.state::<AppState>();
    let _ = commands::terminal::shutdown_all(&state);
    {
        let mut guard = state.feishu_ws_child.lock().unwrap();
        if let Some(mut child) = guard.take() {
            child.kill().ok();
        }
    }
    {
        let mut guard = state.wecom_kf_child.lock().unwrap();
        if let Some(mut child) = guard.take() {
            child.kill().ok();
        }
    }
    commands::feishu_inbound::reap_orphan_feishu_ws();
    // 退出时杀掉 Cosy FastAPI，避免重启端口占用；want-running 标记保留供下次自检自动启
    let _ = crate::voice::cosy_manager::console_stop();
}

#[tauri::command]
fn quit_app(app: AppHandle) {
    shutdown_children(&app);
    app.exit(0);
}

#[tauri::command]
fn hide_to_tray(app: AppHandle) -> Result<(), String> {
    if let Some(win) = primary_webview(&app) {
        win.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// 打开当前桌面 WebView 的开发者工具。
/// 正式包无 Cargo `devtools` feature 时为空操作；开发用 `pnpm tauri:dev` 才真正打开。
/// 前端生产构建另有 `import.meta.env.DEV` 闸，不响应 F12。
#[tauri::command]
fn xu_open_devtools(window: WebviewWindow) {
    #[cfg(feature = "devtools")]
    {
        window.open_devtools();
    }
    #[cfg(not(feature = "devtools"))]
    {
        let _ = window;
    }
}

// ─── Shortcuts Setup ─────────────────────────────────────────────────────────

fn setup_shortcuts(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    use tauri_plugin_global_shortcut::{
        Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState,
    };

    #[cfg(target_os = "macos")]
    let modifiers = Modifiers::SUPER | Modifiers::SHIFT;
    #[cfg(not(target_os = "macos"))]
    let modifiers = Modifiers::CONTROL | Modifiers::SHIFT;

    let shortcut = Shortcut::new(Some(modifiers), Code::KeyH);
    // Previous crashed/HMR instance may still hold the OS hotkey — never fail app startup
    let _ = app.global_shortcut().unregister(shortcut);
    if let Err(e) = app
        .global_shortcut()
        .on_shortcut(shortcut, |app, _shortcut, event| {
            if event.state() == ShortcutState::Pressed {
                if let Some(win) = primary_webview(&app) {
                    if win.is_visible().unwrap_or(false) {
                        let _ = win.hide();
                    } else {
                        let _ = win.show();
                        let _ = win.set_focus();
                    }
                }
            }
        })
    {
        eprintln!("[xu] global shortcut Ctrl+Shift+H skipped: {e}");
    }

    // Screenshot shortcut — loaded from ~/.xu/shortcuts.json (default Alt+A)
    if let Err(e) = commands::shortcuts::setup_screenshot_shortcut(app.handle()) {
        eprintln!("[xu] screenshot shortcut setup: {e}");
    }

    Ok(())
}

// ─── Tray Setup ───────────────────────────────────────────────────────────────

fn setup_tray(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    use tauri::{
        menu::{Menu, MenuItem, PredefinedMenuItem},
        tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    };

    let open = MenuItem::with_id(
        app,
        "open",
        &format!("打开 {}", crate::brand::BRAND_NAME_ZH),
        true,
        None::<&str>,
    )?;
    let new_session = MenuItem::with_id(app, "new_session", "新建会话", true, None::<&str>)?;
    let check_update = MenuItem::with_id(app, "check_update", "检查更新", true, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;

    let menu = Menu::with_items(app, &[&open, &new_session, &check_update, &sep, &quit])?;

    TrayIconBuilder::with_id("xumuge-ai-tray")
        .icon(app.default_window_icon().unwrap().clone())
        .tooltip(crate::brand::BRAND_NAME_ZH)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                if let Some(win) = primary_webview(&app) {
                    if win.is_visible().unwrap_or(false) {
                        let _ = win.hide();
                    } else {
                        let _ = win.show();
                        let _ = win.set_focus();
                    }
                }
            }
        })
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => {
                if let Some(win) = primary_webview(&app) {
                    let _ = win.show();
                    let _ = win.set_focus();
                }
            }
            "new_session" => {
                if let Some(win) = primary_webview(&app) {
                    let _ = win.show();
                    let _ = win.set_focus();
                    let _ = win.emit("new-session-from-tray", ());
                }
            }
            "check_update" => {
                if let Some(win) = primary_webview(&app) {
                    let _ = win.show();
                    let _ = win.set_focus();
                    let _ = win.emit("check-app-update", ());
                }
            }
            "quit" => {
                shutdown_children(app);
                app.exit(0);
            }
            _ => {}
        })
        .build(app)?;

    Ok(())
}

fn setup_app_menu(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};

    let new_session = MenuItem::with_id(app, "new-session", "新建会话", true, Some("CmdOrCtrl+N"))?;
    let snapshot = MenuItem::with_id(app, "toggle-snapshot", "截屏快照", true, None::<&str>)?;
    let quit = MenuItem::with_id(
        app,
        "quit",
        &format!("退出 {}", crate::brand::BRAND_NAME_ZH),
        true,
        Some("CmdOrCtrl+Q"),
    )?;
    let file_sep = PredefinedMenuItem::separator(app)?;
    let file = Submenu::with_items(
        app,
        "文件",
        true,
        &[&new_session, &snapshot, &file_sep, &quit],
    )?;

    let undo = PredefinedMenuItem::undo(app, Some("撤销"))?;
    let redo = PredefinedMenuItem::redo(app, Some("重做"))?;
    let edit_sep1 = PredefinedMenuItem::separator(app)?;
    let cut = PredefinedMenuItem::cut(app, Some("剪切"))?;
    let copy = PredefinedMenuItem::copy(app, Some("复制"))?;
    let paste = PredefinedMenuItem::paste(app, Some("粘贴"))?;
    let select_all = PredefinedMenuItem::select_all(app, Some("全选"))?;
    let edit_sep2 = PredefinedMenuItem::separator(app)?;
    let stop_agent = MenuItem::with_id(app, "stop-agent", "停止运行", true, None::<&str>)?;
    let shortcuts = MenuItem::with_id(app, "show-shortcuts", "快捷键", true, Some("CmdOrCtrl+/"))?;
    let edit = Submenu::with_items(
        app,
        "编辑",
        true,
        &[
            &undo,
            &redo,
            &edit_sep1,
            &cut,
            &copy,
            &paste,
            &select_all,
            &edit_sep2,
            &stop_agent,
            &shortcuts,
        ],
    )?;

    let chat = MenuItem::with_id(app, "open-chat", "对话", true, None::<&str>)?;
    let memory = MenuItem::with_id(app, "open-memory", "记忆", true, None::<&str>)?;
    let files = MenuItem::with_id(app, "open-files", "文件树", true, None::<&str>)?;
    let connections = MenuItem::with_id(app, "open-connections", "多端连接", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "open-settings", "设置", true, None::<&str>)?;
    let terminal = MenuItem::with_id(app, "toggle-terminal", "终端", true, None::<&str>)?;
    let view = Submenu::with_items(
        app,
        "查看",
        true,
        &[&chat, &memory, &files, &connections, &settings, &terminal],
    )?;

    let compress = MenuItem::with_id(app, "agent-compress", "压缩上下文", true, None::<&str>)?;
    let agent = Submenu::with_items(app, "Agent", true, &[&compress])?;

    let hide = MenuItem::with_id(app, "hide-window", "隐藏到托盘", true, None::<&str>)?;
    let window_snapshot =
        MenuItem::with_id(app, "window-snapshot", "截屏快照", true, None::<&str>)?;
    let window = Submenu::with_items(app, "窗口", true, &[&hide, &window_snapshot])?;

    let setup = MenuItem::with_id(app, "help-setup", "设置与引导", true, None::<&str>)?;
    let about = MenuItem::with_id(
        app,
        "help-about",
        &format!("关于 {}", crate::brand::BRAND_NAME_ZH),
        true,
        None::<&str>,
    )?;
    let help = Submenu::with_items(app, "帮助", true, &[&setup, &about])?;

    let menu = Menu::with_items(app, &[&file, &edit, &view, &agent, &window, &help])?;
    // Windows：app.set_menu 会让所有窗口（含 cosy-console）继承菜单栏；仅主窗口挂菜单。
    #[cfg(target_os = "macos")]
    app.set_menu(menu)?;
    #[cfg(not(target_os = "macos"))]
    {
        for label in ["main", "chat", "ide"] {
            if let Some(win) = app.get_webview_window(label) {
                win.set_menu(menu.clone())?;
            }
        }
    }
    Ok(())
}

fn setup_platform_window(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    for label in ["chat", "ide", "main"] {
        if let Some(win) = app.get_webview_window(label) {
            #[cfg(not(target_os = "macos"))]
            win.set_decorations(false)?;
            let _ = win.set_background_color(Some(tauri::window::Color(0x12, 0x16, 0x1a, 255)));
        }
    }
    Ok(())
}

#[cfg(windows)]
fn set_windows_aumid() {
    use std::os::windows::ffi::OsStrExt;
    #[link(name = "shell32")]
    extern "system" {
        fn SetCurrentProcessExplicitAppUserModelID(app_id: *const u16) -> i32;
    }
    let wide: Vec<u16> = std::ffi::OsStr::new("com.xu.desktop")
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    unsafe {
        let _ = SetCurrentProcessExplicitAppUserModelID(wide.as_ptr());
    }
    if let Ok(hkcu) = winreg::RegKey::predef(winreg::enums::HKEY_CURRENT_USER)
        .create_subkey(r"Software\Classes\AppUserModelId\com.xu.desktop")
    {
        let (key, _) = hkcu;
        let _ = key.set_value("DisplayName", &crate::brand::BRAND_NAME_ZH);
        let candidates = [
            // Prefer source icons (always current during `tauri dev`)
            Some(
                std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                    .join("icons")
                    .join("icon.ico"),
            ),
            std::env::current_exe()
                .ok()
                .and_then(|p| p.parent().map(|d| d.join("icons").join("icon.ico"))),
        ];
        for c in candidates.into_iter().flatten() {
            if c.is_file() {
                let uri = format!("file:///{}", c.to_string_lossy().replace('\\', "/"));
                let _ = key.set_value("IconUri", &uri);
                let _ = key.set_value("IconBackgroundColor", &"FF2B6CB0");
                break;
            }
        }
    }
}

// ─── App Entry Point ──────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    crate::xu_env::load_desktop_env();
    if let Some(path) = commands::shell_integration::parse_open_ide_args() {
        if !commands::shell_integration::ensure_primary_instance() {
            let _ = commands::shell_integration::forward_open_ide_to_running_instance(&path);
            std::process::exit(0);
        }
    } else if !commands::shell_integration::ensure_primary_instance() {
        eprintln!("[xu] startup aborted: another instance is already running.");
        std::process::exit(1);
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_screenshots::init())
        .manage(AppState::new())
        .manage(agent::stream::AgentRuntime::new())
        .manage(agent::prefs::AgentPrefsState::new())
        .manage(RolePackState::new())
        .manage(commands::shortcuts::ScreenshotShortcutState(
            std::sync::Mutex::new(None),
        ))
        .manage(commands::screenshot::ScreenshotCaptureState::new())
        .manage(commands::voice_packs::VoicePackState::default())
        .manage(desktop_db::init_managed().expect("xu.db must initialize"))
        .setup(|app| {
            #[cfg(windows)]
            set_windows_aumid();
            commands::voice_route::bind_app(app.handle().clone());
            setup_platform_window(app)?;
            setup_app_menu(app)?;
            setup_tray(app)?;
            setup_shortcuts(app)?;
            if let Some(db) = app.try_state::<desktop_db::FouDb>() {
                if let Ok(guard) = db.0.lock() {
                    let _ = desktop_db::purge_old_messages(&guard);
                    if let Some(prefs) = app.try_state::<agent::prefs::AgentPrefsState>() {
                        prefs.set(agent::prefs::load_from_conn(&guard));
                    }
                }
            }
            if let Ok(res) = app.path().resource_dir() {
                std::env::set_var("XU_RESOURCE_DIR", &res);
                #[cfg(windows)]
                let rg = res.join("bin").join("rg.exe");
                #[cfg(not(windows))]
                let rg = res.join("bin").join("rg");
                if rg.is_file() {
                    std::env::set_var("XU_RG_PATH", &rg);
                }
            }
            if let Some(rp) = app.try_state::<RolePackState>() {
                if let Ok(mut guard) = rp.inner.lock() {
                    if let Err(e) = guard.reload_all(app.handle()) {
                        eprintln!("[role-pack] startup reload failed: {e}");
                    } else {
                        eprintln!("[role-pack] loaded {} roles on startup", guard.role_count());
                    }
                }
            }
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                let _ = commands::feishu_inbound::start_feishu_ws_if_needed(&handle);
                let _ = commands::wecom_inbound::start_wecom_kf_if_needed(&handle);
            });
            commands::shell_integration::start_open_ide_ipc_watcher(app.handle().clone());
            if let Some(path) = commands::shell_integration::parse_open_ide_args() {
                let h = app.handle().clone();
                let path = path.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_millis(900));
                    if let Some(win) = primary_webview(&h) {
                        let _ = win.show();
                        let _ = win.set_focus();
                        let _ = win.emit("xu:open-in-ide", serde_json::json!({ "path": path }));
                    }
                });
            }
            Ok(())
        })
        .on_menu_event(|app, event| match event.id().as_ref() {
            "quit" => {
                shutdown_children(app);
                app.exit(0);
            }
            "hide-window" => {
                if let Some(win) = primary_webview(&app) {
                    let _ = win.hide();
                }
            }
            "agent-compress" => {
                if let Some(win) = primary_webview(&app) {
                    let _ = win.emit("app-menu-action", "agent-compress");
                }
            }
            "toggle-snapshot" | "window-snapshot" => {
                if let Some(win) = primary_webview(&app) {
                    let _ = win.emit("app-menu-action", "toggle-snapshot");
                }
            }
            "help-setup" => {
                if let Some(win) = primary_webview(&app) {
                    let _ = win.emit("app-menu-action", "open-settings");
                }
            }
            "help-about" => {
                if let Some(win) = primary_webview(&app) {
                    let _ = win.emit("app-menu-action", "open-settings");
                }
            }
            id => {
                if let Some(win) = primary_webview(&app) {
                    let _ = win.emit("app-menu-action", id.to_string());
                }
            }
        })
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                window
                    .app_handle()
                    .state::<commands::screenshot::ScreenshotCaptureState>()
                    .release_window(window.label());
                return;
            }
            if window.label() == "cosy-console" {
                if matches!(event, tauri::WindowEvent::Focused(true)) {
                    let _ = window.remove_menu();
                }
                if let tauri::WindowEvent::CloseRequested { .. } = event {
                    return;
                }
            }
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label().starts_with("xu-screenshot")
                    || window.label() == "ide"
                    || window.label().starts_with("ide-")
                {
                    return;
                }
                window.hide().unwrap();
                api.prevent_close();
            }
        })
        .invoke_handler(tauri::generate_handler![
            hide_to_tray,
            quit_app,
            xu_open_devtools,
            brand::xu_app_identity,
            commands::app_update::xu_app_update_download,
            commands::app_update::xu_app_update_launch,
            commands::terminal::pty_open,
            commands::terminal::pty_write,
            commands::terminal::pty_resize,
            commands::terminal::pty_close,
            commands::files::list_dir,
            commands::files::read_text_file,
            commands::files::write_text_file,
            commands::files::append_text_line,
            commands::files::save_upload,
            commands::files::get_home_dir,
            commands::files::xu_get_home,
            commands::files::xu_get_documents_dir,
            commands::files::open_path,
            commands::files::open_with_editor,
            commands::files::speak_text,
            commands::files::stop_speak,
            commands::files::check_memory_loaded,
            commands::files::rename_path,
            commands::files::remove_path,
            commands::files::copy_path,
            commands::files::import_file_into_workspace,
            commands::files::grep_workspace,
            commands::embeddings::xu_embed_texts,
            commands::files::create_workspace_path,
            commands::files::xu_list_listening_ports,
            commands::attachments::xu_ingest_chat_attachments,
            commands::attachments::xu_list_pending_chat_attachments,
            commands::attachments::xu_remove_pending_chat_attachment,
            commands::attachments::xu_bind_chat_attachments,
            commands::attachments::xu_append_chat_message_with_attachments,
            commands::attachments::xu_read_chat_attachment_preview,
            commands::voice_packs::xu_voice_engine_status,
            commands::voice_packs::xu_voice_pack_fetch_url_text,
            commands::voice_packs::xu_voice_pack_list,
            commands::voice_packs::xu_voice_pack_stage_local,
            commands::voice_packs::xu_voice_pack_install,
            commands::voice_packs::xu_voice_pack_uninstall,
            commands::voice_packs::xu_voice_task_cancel,
            commands::voice_packs::xu_voice_synthesize,
            commands::voice_packs::xu_voice_warmup_kokoro,
            commands::voice_packs::xu_voice_temp_wav_data_url,
            commands::voice_packs::xu_voice_asr_file,
            commands::cosyvoice_install::xu_cosyvoice_probe,
            commands::cosyvoice_install::xu_cosyvoice_plan,
            commands::cosyvoice_install::xu_cosyvoice_ensure_deps,
            commands::cosyvoice_install::xu_cosyvoice_install,
            commands::cosyvoice_install::xu_cosyvoice_status,
            commands::cosyvoice_install::xu_cosyvoice_cancel,
            commands::cosyvoice_install::xu_cosyvoice_modes_load,
            commands::cosyvoice_install::xu_cosyvoice_modes_save,
            commands::cosyvoice_install::xu_cosyvoice_backend_probe,
            commands::cosyvoice_install::xu_cosyvoice_synthesize,
            commands::cosyvoice_install::xu_cosyvoice_fastapi_pcm,
            commands::cosyvoice_install::xu_cosyvoice_fastapi_pcm_stream,
            commands::cosyvoice_install::xu_cosyvoice_fastapi_probe,
            commands::cosyvoice_install::xu_cosyvoice_scan_voices,
            commands::cosyvoice_install::xu_cosyvoice_sidecar_start,
            commands::cosyvoice_install::xu_cosyvoice_sidecar_stop,
            commands::cosyvoice_install::xu_cosyvoice_sidecar_status,
            commands::cosyvoice_install::xu_cosyvoice_set_want_running,
            commands::cosyvoice_install::xu_cosyvoice_get_want_running,
            commands::cosyvoice_install::xu_cosyvoice_bootstrap,
            commands::cosyvoice_install::xu_cosyvoice_launch_hints,
            commands::cosyvoice_install::xu_cosyvoice_install_read,
            commands::cosyvoice_install::xu_cosyvoice_install_resume,
            commands::cosyvoice_install::xu_cosyvoice_discover,
            commands::cosyvoice_install::xu_cosyvoice_open_console,
            commands::cosyvoice_install::xu_cosyvoice_console_env,
            commands::cosyvoice_install::xu_cosyvoice_console_status,
            commands::cosyvoice_install::xu_cosyvoice_console_probe,
            commands::cosyvoice_install::xu_cosyvoice_console_models,
            commands::cosyvoice_install::xu_cosyvoice_console_log,
            commands::cosyvoice_install::xu_cosyvoice_console_start,
            commands::cosyvoice_install::xu_cosyvoice_console_stop,
            commands::cosyvoice_install::xu_cosyvoice_console_restart,
            commands::cosyvoice_install::xu_cosyvoice_console_save_voice,
            commands::cosyvoice_install::xu_cosyvoice_console_delete_voice,
            commands::cosyvoice_install::xu_cosyvoice_ensure_system_voices,
            commands::cosyvoice_install::xu_cosyvoice_default_voices_root,
            commands::voice_native_install::xu_voice_native_probe,
            commands::voice_native_install::xu_voice_native_install,
            commands::voice_native_install::xu_voice_ensure_espeak,
            commands::voice_native_install::xu_voice_native_status,
            commands::voice_native_install::xu_voice_native_cancel,
            commands::voice_route::xu_voice_route_probe,
            commands::voice_route::xu_voice_set_tone,
            commands::voice_route::xu_voice_set_cosy_instruct,
            commands::voice_route::xu_voice_clear_override,
            commands::voice_wake::xu_voice_wake_probe,
            commands::voice_wake::xu_voice_wake_start,
            commands::voice_wake::xu_voice_wake_stop,
            commands::voice_wake::xu_voice_wake_feed,
            commands::voice_duplex::xu_voice_duplex_probe,
            commands::voice_duplex::xu_voice_duplex_start,
            commands::voice_duplex::xu_voice_duplex_stop,
            commands::voice_duplex::xu_voice_duplex_feed,
            commands::lint::run_eslint,
            commands::lint::detect_eslint_info,
            commands::tsserver::detect_typescript_info,
            commands::tsserver::ts_get_diagnostics,
            commands::tsserver::ts_quick_info,
            commands::tsserver::ts_definition,
            commands::git::git_workspace,
            commands::git::git_discover_repos,
            commands::git::git_resolve_path,
            commands::git_registry::git_account_upsert,
            commands::git_registry::git_account_list,
            commands::git_registry::git_cloud_repos,
            commands::git_registry::git_registry_list,
            commands::git_registry::git_registry_upsert,
            commands::git_registry::git_registry_remove,
            commands::git_registry::git_registry_bind_cloud,
            commands::git_registry::git_registry_push,
            commands::git_registry::git_import_prompt_done,
            commands::git_registry::git_import_prompt_mark,
            commands::git_registry::git_import_prompt_clear,
            commands::tray::update_tray_status,
            commands::auth::xu_auth_bootstrap,
            commands::auth::xu_auth_register,
            commands::auth::xu_auth_login,
            commands::auth::xu_auth_dev_login,
            commands::auth::xu_auth_logout,
            commands::auth::xu_auth_me,
            commands::auth::xu_auth_require,
            commands::auth::xu_auth_verify_password,
            commands::auth::xu_auth_change_password,
            commands::auth::xu_auth_adopt_cloud,
            commands::cloud_auth::xu_cloud_auth_login,
            commands::cloud_auth::xu_cloud_auth_register,
            commands::cloud_auth::xu_cloud_auth_refresh,
            commands::cloud_auth::xu_cloud_auth_revalidate,
            commands::cloud_auth::xu_cloud_auth_change_password,
            commands::cloud_auth::xu_cloud_auth_verify_password,
            commands::legacy_fou_aliases::fou_cloud_auth_login,
            commands::legacy_fou_aliases::fou_cloud_auth_register,
            commands::legacy_fou_aliases::fou_cloud_auth_refresh,
            commands::legacy_fou_aliases::fou_cloud_auth_revalidate,
            commands::legacy_fou_aliases::fou_cloud_auth_change_password,
            commands::legacy_fou_aliases::fou_cloud_auth_verify_password,
            commands::legacy_fou_aliases::fou_auth_bootstrap,
            commands::legacy_fou_aliases::fou_auth_register,
            commands::legacy_fou_aliases::fou_auth_login,
            commands::legacy_fou_aliases::fou_auth_dev_login,
            commands::legacy_fou_aliases::fou_auth_logout,
            commands::legacy_fou_aliases::fou_auth_me,
            commands::legacy_fou_aliases::fou_auth_require,
            commands::legacy_fou_aliases::fou_auth_verify_password,
            commands::legacy_fou_aliases::fou_auth_change_password,
            commands::desktop::xu_list_employees,
            commands::desktop::xu_upsert_employee,
            commands::desktop::xu_upsert_employees_batch,
            commands::desktop::xu_reset_busy_employees,
            commands::desktop::xu_delete_employee,
            commands::desktop::xu_remap_employee_id,
            commands::desktop::xu_bootstrap_employees,
            commands::desktop::xu_append_message,
            commands::desktop::xu_list_messages,
            commands::desktop::xu_get_retention_days,
            commands::desktop::xu_get_setting,
            commands::desktop::xu_set_setting,
            commands::desktop::xu_set_retention_days,
            commands::desktop::xu_purge_old_messages,
            commands::desktop::xu_get_ops_brains,
            commands::desktop::xu_set_ops_brains,
            commands::desktop::xu_get_default_reviewer_id,
            commands::desktop::xu_set_default_reviewer_id,
            commands::desktop::xu_get_office_layout,
            commands::desktop::xu_set_office_layout,
            commands::desktop::xu_reset_office_layout,
            commands::office_window::xu_office_set_immersive,
            commands::desktop::xu_get_project_theme,
            commands::desktop::xu_set_project_theme,
            commands::desktop::xu_clear_project_theme,
            commands::desktop::xu_get_delivery_disputes,
            commands::desktop::xu_set_delivery_disputes,
            commands::desktop::xu_list_local_models,
            commands::desktop::xu_probe_brain,
            commands::desktop::xu_set_stored_api_key,
            commands::desktop::xu_api_key_configured,
            commands::desktop::xu_get_employee_session,
            commands::desktop::xu_set_employee_session,
            commands::desktop::xu_clear_employee_session,
            commands::desktop::xu_list_memories,
            commands::desktop::xu_upsert_memory,
            commands::desktop::xu_delete_memory,
            commands::desktop::xu_build_memory_preamble,
            commands::desktop::xu_memory_corpus_stats,
            commands::desktop::xu_token_package_status,
            commands::desktop::xu_set_token_package,
            commands::desktop::xu_list_chat_sessions,
            commands::desktop::xu_ensure_chat_session,
            commands::desktop::xu_append_chat_message,
            commands::desktop::xu_get_chat_history,
            commands::desktop::xu_rename_chat_session,
            commands::desktop::xu_delete_chat_session,
            commands::desktop::xu_token_billing_summary,
            commands::desktop::xu_token_billing_summary_range,
            commands::desktop::xu_list_token_bills,
            commands::desktop::xu_list_token_bills_range,
            commands::desktop::xu_session_billing_summary,
            commands::desktop::xu_session_billing_rounds,
            commands::desktop::xu_session_context_usage,
            commands::desktop::xu_token_billing_series,
            commands::desktop::xu_token_billing_model_series,
            commands::desktop::xu_set_preset_quota,
            commands::desktop::xu_get_preset_quota,
            commands::desktop::xu_sync_model_pricing,
            commands::desktop::xu_pricing_sync_due,
            commands::clipboard::xu_clipboard_set_image,
            commands::clipboard::xu_clipboard_set_image_bytes,
            commands::clipboard::xu_clipboard_set_text,
            commands::clipboard::xu_write_png_file,
            commands::clipboard::xu_write_png_file_bytes,
            commands::clipboard::xu_write_bytes_file,
            commands::clipboard::xu_write_screenshot_temp,
            commands::clipboard::xu_read_png_data_url,
            commands::clipboard::xu_read_image_data_url,
            commands::screenshot::xu_screenshot_acquire,
            commands::screenshot::xu_screenshot_release,
            commands::screenshot::xu_capture_monitor_at_point,
            commands::screenshot::xu_monitor_bounds_at_point,
            commands::screenshot::xu_window_rect_at_point,
            commands::screenshot::xu_list_capture_windows,
            commands::shortcuts::xu_get_screenshot_shortcut,
            commands::shortcuts::xu_set_screenshot_shortcut,
            commands::channels::xu_feishu_list_recent_senders,
            commands::channels::xu_feishu_set_boss_open_id,
            commands::channels::xu_channel_status,
            commands::channels::xu_set_notify_channel,
            commands::channels::xu_get_channel_endpoint,
            commands::channels::xu_set_channel_endpoint,
            commands::channels::xu_channel_probe,
            commands::channels::xu_channel_send_chat,
            commands::channels::xu_os_notify,
            commands::channels::xu_notify_boss,
            commands::channels::xu_gateway_health_tick,
            commands::channels::xu_feishu_doc_analyze,
            commands::feishu_inbound::xu_feishu_ws_status,
            commands::feishu_inbound::xu_feishu_meeting_sync_set,
            commands::feishu_inbound::xu_feishu_ws_ensure,
            commands::feishu_inbound::xu_feishu_ws_restart,
            commands::cursor_sdk::xu_probe_cursor_sdk,
            commands::cursor_sdk::xu_cursor_sdk_open_workspace,
            commands::cursor_sdk::xu_cursor_sdk_run_prompt,
            commands::cursor_sdk::xu_set_drive_use_sdk,
            commands::cursor_sdk::xu_bundled_tool_script,
            commands::wecom_inbound::xu_wecom_kf_status,
            commands::wecom_inbound::xu_wecom_kf_set_enabled,
            commands::wecom_inbound::xu_wecom_kf_list_drafts,
            commands::wecom_inbound::xu_wecom_kf_save_draft,
            commands::wecom_inbound::xu_wecom_kf_approve_send,
            commands::wecom_inbound::xu_wecom_kf_get_default_employee,
            commands::wecom_inbound::xu_wecom_kf_set_default_employee,
            commands::qa_setup::xu_app_repo_root,
            commands::qa_setup::xu_qa_playwright_status,
            commands::qa_setup::xu_qa_playwright_install,
            commands::qa_setup::xu_run_qa_browser,
            commands::ide::xu_probe_ide_clis,
            commands::ide::xu_open_ide_workspace,
            commands::project_cleanup::xu_wipe_project_generate_path,
            commands::project_cleanup::xu_append_cleanup_audit,
            commands::project_cleanup::xu_list_cleanup_audit,
            commands::security_audit::xu_append_security_audit,
            commands::security_audit::xu_list_security_audit,
            commands::activity_log::xu_append_activity_log,
            commands::activity_log::xu_list_activity_log,
            commands::bug_reports::xu_bug_report_list,
            commands::bug_reports::xu_bug_report_save,
            commands::bug_reports::xu_bug_report_update_status,
            commands::bug_reports::xu_bug_report_delete,
            commands::bug_reports::xu_bug_report_save_asset,
            commands::bug_reports::xu_bug_report_asset_path,
            commands::bug_reports::xu_bug_report_asset_exists,
            commands::bug_reports::xu_bug_report_asset_data_url,
            commands::bug_reports::xu_bug_report_fetch_url_data_url,
            commands::bug_reports::xu_bug_report_export_markdown,
            mcp::xu_mcp_list_servers,
            mcp::xu_mcp_save_servers,
            mcp::xu_mcp_list_tools,
            agent::stream::xu_agent_stream,
            agent::stream::xu_agent_approve_tool,
            agent::stream::xu_agent_cancel,
            agent::stream::xu_set_ide_cli,
            agent::stream::xu_set_coding_surface,
            agent::stream::xu_set_employee_slots,
            agent::stream::xu_set_boss_granted_session,
            agent::stream::xu_agent_compact_messages,
            agent::stream::xu_agent_context_usage,
            agent::gui_tools::xu_gui_emergency_stop,
            agent::gui_tools::xu_gui_reset_emergency_stop,
            agent::gui_tools::xu_gui_input_epoch,
            agent::gui_tools::xu_gui_arm_input_monitor,
            context_memory::xu_search_chat_messages,
            context_memory::xu_assemble_context,
            context_memory::xu_index_workspace_context,
            context_memory::xu_list_agent_runs,
            context_memory::xu_get_agent_run_recovery,
            agent::prefs::xu_agent_get_prefs,
            agent::prefs::xu_agent_set_prefs,
            agent::prefs::xu_agent_undo_workspace,
            agent::host_capacity::xu_probe_host_capacity,
            agent::host_capacity::xu_apply_auto_employee_slots,
            agent::host_capacity::xu_apply_cached_employee_slots,
            agent::host_capacity::xu_set_remote_unlimited,
            employee::dispatch::xu_emp_dispatch_task,
            employee::dispatch::xu_emp_resume_after_confirm,
            employee::dispatch::xu_emp_dispatch_status,
            employee::dispatch::xu_resume_interrupted_dispatches,
            employee::dispatch::xu_stop_all_employee_dispatches,
            employee::dispatch::xu_stop_employee_dispatch,
            training_pack::xu_training_write_pack,
            training_pack::xu_training_read_pack,
            employee::session::xu_emp_get_session,
            employee::session::xu_emp_set_session,
            employee::session::xu_emp_clear_session,
            role_pack::role_pack_catalog_status,
            role_pack::role_pack_list_installed,
            role_pack::role_pack_list_roles,
            role_pack::role_pack_list_roles_all,
            role_pack::role_pack_get_prompt,
            role_pack::role_pack_machine_id,
            role_pack::role_pack_license_status,
            role_pack::xu_license_entitlements,
            role_pack::role_pack_import,
            role_pack::role_pack_download_url,
            role_pack::role_pack_activate,
            role_pack::role_pack_session_login,
            role_pack::role_pack_session_renew,
            role_pack::role_pack_session_logout,
            role_pack::role_pack_session_status,
            role_pack::role_pack_get_edition_prefs,
            role_pack::role_pack_set_edition_prefs,
            role_pack::role_pack_resolve_endpoint,
            role_pack::role_pack_check_updates,
            role_pack::role_pack_reload,
            commands::shell_integration::xu_shell_register_ide_menu,
            commands::shell_integration::xu_shell_unregister_ide_menu,
            commands::shell_integration::xu_shell_is_ide_menu_registered,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
