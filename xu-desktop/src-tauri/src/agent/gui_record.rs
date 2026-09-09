//! Windows 低级 Hook：GUI 录制与真实键鼠抢占检测。
//!
//! @author qiuye <yjk150@qq.com>
//! @date 2026-08-31
//! @version 1.1.0
//! @category ToolPolicy
//! @algo injected-input-discrimination

use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant};

use serde_json::{json, Value};

static RECORDING: AtomicBool = AtomicBool::new(false);
static MONITORING_REAL_INPUT: AtomicBool = AtomicBool::new(false);
static HOOK_RUNNING: AtomicBool = AtomicBool::new(false);
static HOOK_HEALTHY: AtomicBool = AtomicBool::new(false);

struct RecordState {
    actions: Vec<Value>,
    last_at: Instant,
    pending_text: String,
}

fn state() -> &'static Mutex<Option<RecordState>> {
    static STATE: OnceLock<Mutex<Option<RecordState>>> = OnceLock::new();
    STATE.get_or_init(|| Mutex::new(None))
}

fn push_wait(st: &mut RecordState, now: Instant) {
    let wait = now.duration_since(st.last_at).as_millis() as u64;
    if wait >= 80 {
        st.actions
            .push(json!({ "type": "wait", "ms": wait.min(10_000) }));
        st.last_at = now;
    }
}

fn flush_pending_text(st: &mut RecordState, now: Instant) {
    if st.pending_text.is_empty() {
        return;
    }
    push_wait(st, now);
    st.actions
        .push(json!({ "type": "type", "text": st.pending_text.clone() }));
    st.pending_text.clear();
    st.last_at = now;
}

#[cfg(windows)]
mod win {
    use super::*;
    use std::ffi::c_void;
    use std::ptr::null_mut;
    use std::sync::atomic::{AtomicUsize, Ordering as AtomicOrdering};
    use std::sync::OnceLock;

    type LRESULT = isize;
    type WPARAM = usize;
    type LPARAM = isize;
    type HHOOK = *mut c_void;
    type HWND = *mut c_void;

    const WH_MOUSE_LL: i32 = 14;
    const WH_KEYBOARD_LL: i32 = 13;
    const WM_LBUTTONDOWN: u32 = 0x0201;
    const WM_KEYDOWN: u32 = 0x0100;
    const HC_ACTION: i32 = 0;
    const WM_USER_STOP: u32 = 0x0400 + 1;

    const VK_BACK: u32 = 0x08;
    const VK_TAB: u32 = 0x09;
    const VK_RETURN: u32 = 0x0D;
    const VK_ESCAPE: u32 = 0x1B;
    const VK_SHIFT: u32 = 0x10;
    const VK_CONTROL: u32 = 0x11;
    const VK_MENU: u32 = 0x12;
    const VK_LWIN: u32 = 0x5B;
    const VK_RWIN: u32 = 0x5C;

    #[repr(C)]
    struct MSLLHOOKSTRUCT {
        pt_x: i32,
        pt_y: i32,
        mouse_data: u32,
        flags: u32,
        time: u32,
        extra_info: usize,
    }

    #[repr(C)]
    struct KBDLLHOOKSTRUCT {
        vk_code: u32,
        scan_code: u32,
        flags: u32,
        time: u32,
        extra_info: usize,
    }

    #[repr(C)]
    struct MSG {
        hwnd: HWND,
        message: u32,
        w_param: WPARAM,
        l_param: LPARAM,
        time: u32,
        pt_x: i32,
        pt_y: i32,
    }

    extern "system" {
        fn SetWindowsHookExW(
            id_hook: i32,
            lpfn: Option<unsafe extern "system" fn(i32, WPARAM, LPARAM) -> LRESULT>,
            hmod: *mut c_void,
            dw_thread_id: u32,
        ) -> HHOOK;
        fn UnhookWindowsHookEx(hhook: HHOOK) -> i32;
        fn CallNextHookEx(hhook: HHOOK, n_code: i32, w_param: WPARAM, l_param: LPARAM) -> LRESULT;
        fn GetMessageW(lpmsg: *mut MSG, hwnd: HWND, w_filter_min: u32, w_filter_max: u32) -> i32;
        fn TranslateMessage(lpmsg: *mut MSG) -> i32;
        fn DispatchMessageW(lpmsg: *mut MSG) -> LRESULT;
        fn PostThreadMessageW(id_thread: u32, msg: u32, w_param: WPARAM, l_param: LPARAM) -> i32;
        fn GetCurrentThreadId() -> u32;
        fn GetKeyboardState(lp_key_state: *mut [u8; 256]) -> i32;
        fn MapVirtualKeyW(u_code: u32, u_map_type: u32) -> u32;
        fn ToUnicode(
            w_virt_key: u32,
            w_scan_code: u32,
            lp_key_state: *const [u8; 256],
            pwsz_buff: *mut u16,
            cch_buff: i32,
            w_flags: u32,
        ) -> i32;
    }

    static MOUSE_HOOK: AtomicUsize = AtomicUsize::new(0);
    static KEYBOARD_HOOK: AtomicUsize = AtomicUsize::new(0);
    static THREAD_ID: OnceLock<u32> = OnceLock::new();

    fn vk_to_char(vk: u32) -> Option<char> {
        unsafe {
            let mut key_state = [0u8; 256];
            if GetKeyboardState(&mut key_state) == 0 {
                return None;
            }
            let scan = MapVirtualKeyW(vk, 0);
            let mut buf = [0u16; 4];
            let n = ToUnicode(vk, scan, &key_state, buf.as_mut_ptr(), buf.len() as i32, 0);
            if n == 1 {
                char::from_u32(buf[0] as u32)
            } else {
                None
            }
        }
    }

    fn record_key_action(vk: u32, now: Instant) {
        if let Ok(mut guard) = state().lock() {
            if let Some(st) = guard.as_mut() {
                flush_pending_text(st, now);
                push_wait(st, now);
                st.actions.push(json!({ "type": "key", "vk": vk }));
                st.last_at = now;
            }
        }
    }

    unsafe extern "system" fn mouse_proc(n_code: i32, w_param: WPARAM, l_param: LPARAM) -> LRESULT {
        if n_code == HC_ACTION && w_param as u32 == WM_LBUTTONDOWN {
            let info = &*(l_param as *const MSLLHOOKSTRUCT);
            if MONITORING_REAL_INPUT.load(Ordering::SeqCst) && info.flags & 0x0000_0001 == 0 {
                crate::agent::gui_safety::note_real_input();
            }
            let now = Instant::now();
            if let Ok(mut guard) = state().lock() {
                if let Some(st) = guard.as_mut() {
                    flush_pending_text(st, now);
                    push_wait(st, now);
                    st.actions
                        .push(json!({ "type": "click", "x": info.pt_x, "y": info.pt_y }));
                    st.last_at = now;
                }
            }
        }
        let hook = MOUSE_HOOK.load(AtomicOrdering::SeqCst) as HHOOK;
        CallNextHookEx(hook, n_code, w_param, l_param)
    }

    unsafe extern "system" fn keyboard_proc(
        n_code: i32,
        w_param: WPARAM,
        l_param: LPARAM,
    ) -> LRESULT {
        if n_code == HC_ACTION && w_param as u32 == WM_KEYDOWN {
            let info = &*(l_param as *const KBDLLHOOKSTRUCT);
            if MONITORING_REAL_INPUT.load(Ordering::SeqCst) && info.flags & 0x0000_0010 == 0 {
                crate::agent::gui_safety::note_real_input();
            }
            let vk = info.vk_code;
            if matches!(vk, VK_SHIFT | VK_CONTROL | VK_MENU | VK_LWIN | VK_RWIN) {
                let hook = KEYBOARD_HOOK.load(AtomicOrdering::SeqCst) as HHOOK;
                return CallNextHookEx(hook, n_code, w_param, l_param);
            }
            let now = Instant::now();
            match vk {
                VK_BACK | VK_TAB | VK_RETURN | VK_ESCAPE => record_key_action(vk, now),
                _ => {
                    if let Some(ch) = vk_to_char(vk) {
                        if !ch.is_control() {
                            if let Ok(mut guard) = state().lock() {
                                if let Some(st) = guard.as_mut() {
                                    st.pending_text.push(ch);
                                }
                            }
                        }
                    }
                }
            }
        }
        let hook = KEYBOARD_HOOK.load(AtomicOrdering::SeqCst) as HHOOK;
        CallNextHookEx(hook, n_code, w_param, l_param)
    }

    pub fn start_hook_thread() -> Result<(), String> {
        if HOOK_RUNNING.swap(true, Ordering::SeqCst) {
            return if HOOK_HEALTHY.load(Ordering::SeqCst) {
                Ok(())
            } else {
                Err("Windows 真实输入 Hook 尚未就绪".into())
            };
        }
        HOOK_HEALTHY.store(false, Ordering::SeqCst);
        thread::spawn(|| {
            unsafe {
                let mouse_hook = SetWindowsHookExW(WH_MOUSE_LL, Some(mouse_proc), null_mut(), 0);
                let keyboard_hook =
                    SetWindowsHookExW(WH_KEYBOARD_LL, Some(keyboard_proc), null_mut(), 0);
                if mouse_hook.is_null() || keyboard_hook.is_null() {
                    if !mouse_hook.is_null() {
                        UnhookWindowsHookEx(mouse_hook);
                    }
                    if !keyboard_hook.is_null() {
                        UnhookWindowsHookEx(keyboard_hook);
                    }
                    HOOK_RUNNING.store(false, Ordering::SeqCst);
                    HOOK_HEALTHY.store(false, Ordering::SeqCst);
                    return;
                }
                MOUSE_HOOK.store(mouse_hook as usize, AtomicOrdering::SeqCst);
                KEYBOARD_HOOK.store(keyboard_hook as usize, AtomicOrdering::SeqCst);
                let _ = THREAD_ID.set(GetCurrentThreadId());
                HOOK_HEALTHY.store(true, Ordering::SeqCst);
                let mut msg = MSG {
                    hwnd: null_mut(),
                    message: 0,
                    w_param: 0,
                    l_param: 0,
                    time: 0,
                    pt_x: 0,
                    pt_y: 0,
                };
                while GetMessageW(&mut msg, null_mut(), 0, 0) > 0 {
                    if msg.message == WM_USER_STOP {
                        break;
                    }
                    TranslateMessage(&mut msg);
                    DispatchMessageW(&mut msg);
                }
                UnhookWindowsHookEx(mouse_hook);
                UnhookWindowsHookEx(keyboard_hook);
            }
            HOOK_HEALTHY.store(false, Ordering::SeqCst);
            HOOK_RUNNING.store(false, Ordering::SeqCst);
            RECORDING.store(false, Ordering::SeqCst);
        });
        for _ in 0..20 {
            if HOOK_HEALTHY.load(Ordering::SeqCst) {
                return Ok(());
            }
            if !HOOK_RUNNING.load(Ordering::SeqCst) {
                break;
            }
            thread::sleep(Duration::from_millis(10));
        }
        Err("Windows 真实输入 Hook 启动失败或未在期限内就绪".into())
    }

    pub fn stop_hook() {
        if let Some(tid) = THREAD_ID.get().copied() {
            unsafe {
                PostThreadMessageW(tid, WM_USER_STOP, 0, 0);
            }
        }
        RECORDING.store(false, Ordering::SeqCst);
        HOOK_HEALTHY.store(false, Ordering::SeqCst);
        HOOK_RUNNING.store(false, Ordering::SeqCst);
        thread::sleep(Duration::from_millis(150));
    }
}

#[cfg(not(windows))]
mod win {
    pub fn start_hook_thread() -> Result<(), String> {
        Err("GUI Hook 录制仅支持 Windows".into())
    }
    pub fn stop_hook() {}
}

pub fn start_recording() -> Result<(), String> {
    {
        let mut guard = state().lock().map_err(|e| e.to_string())?;
        *guard = Some(RecordState {
            actions: Vec::new(),
            last_at: Instant::now(),
            pending_text: String::new(),
        });
    }
    RECORDING.store(true, Ordering::SeqCst);
    if let Err(error) = win::start_hook_thread() {
        RECORDING.store(false, Ordering::SeqCst);
        return Err(error);
    }
    Ok(())
}

/// Arms a Windows low-level hook that latches GUI emergency stop on non-injected input.
/// Dependency: WH_MOUSE_LL/WH_KEYBOARD_LL; failure keeps GUI actions fail-closed.
pub fn start_real_input_monitor() -> Result<(), String> {
    win::start_hook_thread()?;
    MONITORING_REAL_INPUT.store(true, Ordering::SeqCst);
    if real_input_monitor_healthy() {
        Ok(())
    } else {
        MONITORING_REAL_INPUT.store(false, Ordering::SeqCst);
        Err("真实输入监控未进入 healthy 状态".into())
    }
}

/// Reports whether the physical-input monitor is armed and its platform hook is live.
/// Dependency: the Windows low-level hook thread; false keeps all injection fail-closed.
pub fn real_input_monitor_healthy() -> bool {
    MONITORING_REAL_INPUT.load(Ordering::SeqCst)
        && HOOK_RUNNING.load(Ordering::SeqCst)
        && HOOK_HEALTHY.load(Ordering::SeqCst)
}

pub fn stop_recording_and_save(out_path: &Path) -> Result<(usize, String), String> {
    RECORDING.store(false, Ordering::SeqCst);
    if !MONITORING_REAL_INPUT.load(Ordering::SeqCst) {
        win::stop_hook();
    }
    let actions = {
        let mut guard = state().lock().map_err(|e| e.to_string())?;
        if let Some(st) = guard.as_mut() {
            flush_pending_text(st, Instant::now());
        }
        guard.take().map(|s| s.actions).unwrap_or_default()
    };
    let count = actions.len();
    let doc = json!({
        "version": 1,
        "status": "recorded",
        "source": "win_hook",
        "actions": actions,
    });
    if let Some(parent) = out_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let raw = serde_json::to_string_pretty(&doc).map_err(|e| e.to_string())?;
    std::fs::write(out_path, &raw).map_err(|e| e.to_string())?;
    Ok((count, out_path.display().to_string()))
}

pub fn is_recording() -> bool {
    RECORDING.load(Ordering::SeqCst)
}
