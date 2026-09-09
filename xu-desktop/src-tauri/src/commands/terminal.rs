//! 内嵌系统终端 PTY 的原子会话生命周期与隔离环境。
//!
//! @author qiuye <yjk150@qq.com>
//! @date 2026-08-31
//! @version 1.0.0
//! @category ToolPolicy
//! @algo generation-guarded-pty-session

use crate::{AppState, PtySession};
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::io::{Read, Write};
use std::sync::atomic::Ordering;
use tauri::{AppHandle, Emitter, Manager, State};

fn build_shell_command(workspace_root: Option<&str>) -> Result<CommandBuilder, String> {
    #[cfg(target_os = "windows")]
    {
        let mut cmd = CommandBuilder::new("cmd.exe");
        cmd.arg("/K");
        if let Some(dir) = workspace_root.filter(|s| !s.is_empty()) {
            if std::path::Path::new(dir).is_dir() {
                cmd.cwd(dir);
            }
        }
        return Ok(cmd);
    }

    #[cfg(not(target_os = "windows"))]
    {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".into());
        let mut cmd = CommandBuilder::new(&shell);
        if let Some(dir) = workspace_root.filter(|s| !s.is_empty()) {
            if std::path::Path::new(dir).is_dir() {
                cmd.cwd(dir);
            }
        }
        Ok(cmd)
    }
}

fn isolate_shell_environment(command: &mut CommandBuilder) {
    command.env_clear();
    for (name, value) in crate::agent::process_control::isolated_child_environment() {
        command.env(name, value);
    }
    command.env("TERM", "xterm-256color");
    command.env("COLORTERM", "truecolor");
}

fn generation_allows_cleanup(active: u64, expected: Option<u64>) -> bool {
    expected.map(|value| value == active).unwrap_or(true)
}

fn close_pty_handles(
    state: &AppState,
    pty_id: &str,
    expected_generation: Option<u64>,
    terminate: bool,
) -> Result<bool, String> {
    let session = {
        let mut sessions = state
            .pty_sessions
            .lock()
            .map_err(|_| "PTY 会话锁已损坏".to_string())?;
        if !sessions
            .get(pty_id)
            .map(|session| generation_allows_cleanup(session.generation, expected_generation))
            .unwrap_or(false)
        {
            return Ok(false);
        }
        sessions.remove(pty_id)
    };
    if let Some(mut session) = session {
        if terminate {
            let _ = session.child.kill();
        }
        return Ok(true);
    }
    Ok(false)
}

fn insert_pty_session(state: &AppState, pty_id: String, session: PtySession) -> Result<(), String> {
    let mut sessions = match state.pty_sessions.lock() {
        Ok(sessions) => sessions,
        Err(_) => {
            terminate_session(session);
            return Err("PTY 会话锁已损坏".into());
        }
    };
    let replaced = sessions.insert(pty_id, session);
    drop(sessions);
    if let Some(mut replaced) = replaced {
        // A concurrent open won the race; terminate the now-replaced owned shell.
        let _ = replaced.child.kill();
    }
    Ok(())
}

fn next_generation(state: &AppState) -> u64 {
    state.next_pty_generation.fetch_add(1, Ordering::Relaxed)
}

fn terminate_session(mut session: PtySession) {
    let _ = session.child.kill();
}

fn clear_all_pty_sessions(state: &AppState) -> Result<(), String> {
    let sessions = {
        let mut sessions = state
            .pty_sessions
            .lock()
            .map_err(|_| "PTY 会话锁已损坏".to_string())?;
        sessions
            .drain()
            .map(|(_, session)| session)
            .collect::<Vec<_>>()
    };
    for session in sessions {
        terminate_session(session);
    }
    Ok(())
}

pub(crate) fn shutdown_all(state: &AppState) -> Result<(), String> {
    clear_all_pty_sessions(state)
}

fn cleanup_natural_exit(state: &AppState, pty_id: &str, generation: u64) {
    let _ = close_pty_handles(state, pty_id, Some(generation), false);
}

fn close_existing_pty(state: &AppState, pty_id: &str) -> Result<(), String> {
    if let Some(mut child) = state
        .pty_sessions
        .lock()
        .map_err(|_| "PTY 会话锁已损坏".to_string())?
        .remove(pty_id)
        .map(|session| session.child)
    {
        let _ = child.kill();
    }
    Ok(())
}

#[tauri::command]
pub fn pty_open(
    app: AppHandle,
    state: State<'_, AppState>,
    pty_id: String,
    workspace_root: Option<String>,
    rows: u16,
    cols: u16,
) -> Result<(), String> {
    close_existing_pty(&state, &pty_id)?;

    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("PTY open failed: {e}"))?;

    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
    let mut cmd = build_shell_command(workspace_root.as_deref())?;
    isolate_shell_environment(&mut cmd);
    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("Failed to start shell: {e}"))?;
    let generation = next_generation(&state);
    let session = PtySession {
        generation,
        writer,
        master: pair.master,
        child,
    };
    if let Err(error) = insert_pty_session(&state, pty_id.clone(), session) {
        return Err(error);
    }

    let event_name = format!("pty:{}", pty_id);
    std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    let data = String::from_utf8_lossy(&buf[..n]).to_string();
                    app.emit(&event_name, data).ok();
                }
            }
        }
        cleanup_natural_exit(&app.state::<AppState>(), &pty_id, generation);
    });

    Ok(())
}

#[tauri::command]
pub fn pty_write(state: State<'_, AppState>, pty_id: String, data: String) -> Result<(), String> {
    let mut sessions = state
        .pty_sessions
        .lock()
        .map_err(|_| "PTY 会话锁已损坏".to_string())?;
    if let Some(session) = sessions.get_mut(&pty_id) {
        session
            .writer
            .write_all(data.as_bytes())
            .map_err(|e| e.to_string())?;
        return Ok(());
    }
    Err("终端未就绪，请稍候再试".into())
}

#[tauri::command]
pub fn pty_resize(
    state: State<'_, AppState>,
    pty_id: String,
    rows: u16,
    cols: u16,
) -> Result<(), String> {
    let sessions = state
        .pty_sessions
        .lock()
        .map_err(|_| "PTY 会话锁已损坏".to_string())?;
    if let Some(session) = sessions.get(&pty_id) {
        session
            .master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn pty_close(state: State<'_, AppState>, pty_id: String) -> Result<(), String> {
    close_pty_handles(&state, &pty_id, None, true)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shell_command_accepts_workspace() {
        let mut cmd = build_shell_command(Some(".")).expect("shell");
        isolate_shell_environment(&mut cmd);
        let argv = cmd.get_argv();
        assert!(!argv.is_empty());
    }

    #[test]
    fn stale_reader_cannot_clean_reopened_session() {
        assert!(generation_allows_cleanup(2, Some(2)));
        assert!(!generation_allows_cleanup(2, Some(1)));
        assert!(generation_allows_cleanup(2, None));
    }

    #[test]
    fn concurrent_generations_are_unique() {
        let state = std::sync::Arc::new(AppState::new());
        let mut workers = Vec::new();
        for _ in 0..8 {
            let state = state.clone();
            workers.push(std::thread::spawn(move || {
                (0..100)
                    .map(|_| next_generation(&state))
                    .collect::<Vec<_>>()
            }));
        }
        let generations = workers
            .into_iter()
            .flat_map(|worker| worker.join().unwrap())
            .collect::<std::collections::HashSet<_>>();
        assert_eq!(generations.len(), 800);
    }

    #[test]
    fn poisoned_pty_lock_returns_error() {
        let state = std::sync::Arc::new(AppState::new());
        let poison = state.clone();
        let _ = std::thread::spawn(move || {
            let _guard = poison.pty_sessions.lock().unwrap();
            panic!("poison for audit test");
        })
        .join();
        assert!(close_pty_handles(&state, "missing", None, true).is_err());
    }
}
