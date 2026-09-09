//! Xu (Virmoor) app data paths and shell helpers.

use std::path::PathBuf;
use std::process::Command;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

pub fn hide_command_window(cmd: &mut Command) -> &mut Command {
    #[cfg(target_os = "windows")]
    {
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

pub fn xu_home() -> Result<PathBuf, String> {
    if let Ok(env) = std::env::var("XU_HOME") {
        let trimmed = env.trim();
        if !trimmed.is_empty() {
            let p = PathBuf::from(trimmed);
            std::fs::create_dir_all(&p).map_err(|e| format!("mkdir XU_HOME: {e}"))?;
            return Ok(p);
        }
    }
    let p = default_xu_home()?;
    std::fs::create_dir_all(&p).map_err(|e| format!("mkdir xu home: {e}"))?;
    Ok(p)
}

fn default_xu_home() -> Result<PathBuf, String> {
    #[cfg(target_os = "windows")]
    {
        return dirs::data_local_dir()
            .map(|d| d.join("xu"))
            .ok_or_else(|| "Cannot resolve LOCALAPPDATA".into());
    }
    #[cfg(target_os = "macos")]
    {
        return dirs::home_dir()
            .map(|h| h.join("Library").join("Application Support").join("xu"))
            .ok_or_else(|| "Cannot resolve home directory".into());
    }
    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    {
        if let Some(d) = dirs::data_local_dir() {
            return Ok(d.join("xu"));
        }
        return dirs::home_dir()
            .map(|h| h.join(".local").join("share").join("xu"))
            .ok_or_else(|| "Cannot resolve home directory".into());
    }
}

/// No-op: hard cut to xu.db; no legacy Hermes migration.
pub fn migrate_db_if_needed(new_path: &PathBuf) -> Result<(), String> {
    if let Some(parent) = new_path.parent() {
        std::fs::create_dir_all(parent).ok();
    }
    Ok(())
}
