//! 一键安装离线 ASR/TTS（与 MCP `xu-voice-native` 同契约）。
//!
//! @author qiuye <yjk150@qq.com>
//! @date 2026-08-31
//! @updated 2026-09-01
//! @version 1.1.0
//! @category Config
//! @algo none

use tauri::AppHandle;

use crate::voice::{
    cancel_native_install, install_native_voice, native_voice_status, probe_native_voice,
    VoiceNativeProbe, VoiceNativeStatus,
};

/// 探测本机 `{XU_HOME}/voice-engines/native` 是否已有 ASR/TTS。
#[tauri::command]
pub fn xu_voice_native_probe() -> Result<VoiceNativeProbe, String> {
    probe_native_voice()
}

/// 下载 Zipformer CTC ASR + Kokoro int8 TTS 到 XU_HOME（进度事件 `xu:voice-native-progress`）。
#[tauri::command]
pub async fn xu_voice_native_install(app: AppHandle) -> Result<VoiceNativeStatus, String> {
    tokio::task::spawn_blocking(move || install_native_voice(Some(app)))
        .await
        .map_err(|e| format!("安装任务中断: {e}"))?
}

/// 仅补装 Kokoro 所需的 espeak-ng（模型已有时用）。
#[tauri::command]
pub async fn xu_voice_ensure_espeak(app: AppHandle) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        let paths = crate::voice::espeak::ensure_espeak(Some(&app))?;
        Ok(format!(
            "espeak-ng 就绪：{}",
            paths.bin.to_string_lossy()
        ))
    })
    .await
    .map_err(|e| format!("补装任务中断: {e}"))?
}

/// 安装进度 / 就绪态。
#[tauri::command]
pub fn xu_voice_native_status() -> Result<VoiceNativeStatus, String> {
    Ok(native_voice_status())
}

/// 取消进行中的一键安装。
#[tauri::command]
pub fn xu_voice_native_cancel() -> Result<(), String> {
    cancel_native_install();
    Ok(())
}
