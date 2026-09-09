//! Windows Explorer integration and OS-atomic single-instance ownership.
//!
//! @author qiuye <yjk150@qq.com>
//! @date 2026-08-31
//! @version 1.0.0
//! @category ToolPolicy
//! @algo windows-named-mutex

use serde::Serialize;
use std::path::PathBuf;
use tauri::Emitter;

const MENU_KEY: &str = r"Software\Classes\*\shell\FouIDE";
const DIR_MENU_KEY: &str = r"Software\Classes\Directory\shell\FouIDE";
const MENU_LABEL: &str = "用 虚募阁 IDE 打开";

#[derive(Serialize)]
pub struct IdeMenuStatus {
    pub registered: bool,
    pub exe_path: Option<String>,
}

fn current_exe() -> Result<PathBuf, String> {
    std::env::current_exe().map_err(|e| e.to_string())
}

fn quote_exe(path: &PathBuf) -> String {
    format!("\"{}\"", path.to_string_lossy())
}

#[cfg(windows)]
fn menu_registered() -> bool {
    let hkcu = winreg::RegKey::predef(winreg::enums::HKEY_CURRENT_USER);
    hkcu.open_subkey(MENU_KEY).is_ok() && hkcu.open_subkey(DIR_MENU_KEY).is_ok()
}

#[cfg(not(windows))]
fn menu_registered() -> bool {
    false
}

#[tauri::command]
pub fn xu_shell_is_ide_menu_registered() -> IdeMenuStatus {
    let exe = current_exe().ok().map(|p| p.to_string_lossy().into_owned());
    IdeMenuStatus {
        registered: menu_registered(),
        exe_path: exe,
    }
}

#[tauri::command]
pub fn xu_shell_register_ide_menu() -> Result<(), String> {
    #[cfg(not(windows))]
    return Err("仅支持 Windows 资源管理器右键菜单".into());

    #[cfg(windows)]
    {
        let exe = current_exe()?;
        let cmd = format!("{} --open-ide \"%1\"", quote_exe(&exe));
        let hkcu = winreg::RegKey::predef(winreg::enums::HKEY_CURRENT_USER);

        for key_path in [MENU_KEY, DIR_MENU_KEY] {
            let (key, _) = hkcu
                .create_subkey(key_path)
                .map_err(|e| format!("create {key_path}: {e}"))?;
            key.set_value("", &MENU_LABEL)
                .map_err(|e| format!("set label: {e}"))?;
            let (cmd_key, _) = key
                .create_subkey("command")
                .map_err(|e| format!("create command: {e}"))?;
            cmd_key
                .set_value("", &cmd)
                .map_err(|e| format!("set command: {e}"))?;
        }
        Ok(())
    }
}

#[tauri::command]
pub fn xu_shell_unregister_ide_menu() -> Result<(), String> {
    #[cfg(not(windows))]
    return Err("仅支持 Windows".into());

    #[cfg(windows)]
    {
        let hkcu = winreg::RegKey::predef(winreg::enums::HKEY_CURRENT_USER);
        for key_path in [MENU_KEY, DIR_MENU_KEY] {
            let _ = hkcu.delete_subkey_all(key_path);
        }
        Ok(())
    }
}

pub fn parse_open_ide_args() -> Option<String> {
    let args: Vec<String> = std::env::args().collect();
    for (i, arg) in args.iter().enumerate() {
        if arg == "--open-ide" {
            return args.get(i + 1).cloned().filter(|s| !s.trim().is_empty());
        }
    }
    None
}

fn ipc_open_ide_path() -> Result<PathBuf, String> {
    let home = crate::xu_paths::xu_home()?;
    Ok(home.join(".ipc").join("open-ide"))
}

#[cfg(windows)]
struct InstanceMutex(*mut std::ffi::c_void);

#[cfg(windows)]
unsafe impl Send for InstanceMutex {}
#[cfg(windows)]
unsafe impl Sync for InstanceMutex {}

#[cfg(windows)]
impl Drop for InstanceMutex {
    fn drop(&mut self) {
        extern "system" {
            fn CloseHandle(object: *mut std::ffi::c_void) -> i32;
        }
        unsafe {
            CloseHandle(self.0);
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum InstanceLockState {
    Acquired,
    AlreadyExists,
    Unavailable,
}

fn should_continue_startup(state: InstanceLockState) -> bool {
    !matches!(state, InstanceLockState::AlreadyExists)
}

#[cfg(windows)]
fn acquire_instance_lock() -> InstanceLockState {
    use std::ffi::c_void;
    extern "system" {
        fn CreateMutexW(
            mutex_attributes: *mut c_void,
            initial_owner: i32,
            name: *const u16,
        ) -> *mut c_void;
        fn GetLastError() -> u32;
        fn SetLastError(error: u32);
        fn CloseHandle(object: *mut c_void) -> i32;
    }
    const ERROR_ALREADY_EXISTS: u32 = 183;
    static INSTANCE_MUTEX: std::sync::OnceLock<InstanceMutex> = std::sync::OnceLock::new();

    if INSTANCE_MUTEX.get().is_some() {
        return InstanceLockState::Acquired;
    }
    let name = "Local\\VirmoorFouDesktop.SingleInstance.v1"
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    unsafe {
        SetLastError(0);
        let handle = CreateMutexW(std::ptr::null_mut(), 1, name.as_ptr());
        if handle.is_null() {
            return InstanceLockState::Unavailable;
        }
        if GetLastError() == ERROR_ALREADY_EXISTS {
            CloseHandle(handle);
            return InstanceLockState::AlreadyExists;
        }
        if INSTANCE_MUTEX.set(InstanceMutex(handle)).is_err() {
            CloseHandle(handle);
        }
        InstanceLockState::Acquired
    }
}

#[cfg(not(windows))]
fn acquire_instance_lock() -> InstanceLockState {
    InstanceLockState::Acquired
}

/// Acquires the process-wide OS lock and reports whether startup may continue.
/// Dependency: Windows named mutex; other platforms keep their existing single-process behavior.
/// Failure: lock API errors fail open, but an existing owner always causes a clean exit.
pub fn ensure_primary_instance() -> bool {
    should_continue_startup(acquire_instance_lock())
}

pub fn forward_open_ide_to_running_instance(path: &str) -> Result<(), String> {
    let ipc = ipc_open_ide_path()?;
    if let Some(parent) = ipc.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&ipc, path).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn start_open_ide_ipc_watcher(app: tauri::AppHandle) {
    std::thread::spawn(move || {
        let ipc = match ipc_open_ide_path() {
            Ok(p) => p,
            Err(_) => return,
        };
        loop {
            std::thread::sleep(std::time::Duration::from_millis(300));
            let Ok(content) = std::fs::read_to_string(&ipc) else {
                continue;
            };
            let path = content.trim().to_string();
            let _ = std::fs::remove_file(&ipc);
            if path.is_empty() {
                continue;
            }
            use tauri::Manager;
            if let Some(win) = app
                .get_webview_window("main")
                .or_else(|| app.get_webview_window("chat"))
            {
                let _ = win.show();
                let _ = win.set_focus();
                let _ = win.emit("xu:open-in-ide", serde_json::json!({ "path": path }));
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn single_instance_decision_is_pure_and_never_targets_a_pid() {
        assert!(should_continue_startup(InstanceLockState::Acquired));
        assert!(!should_continue_startup(InstanceLockState::AlreadyExists));
        assert!(should_continue_startup(InstanceLockState::Unavailable));
    }
}
