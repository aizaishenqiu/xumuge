//! 工程双工 spike Tauri 命令。
//!
//! @author qiuye <yjk150@qq.com>
//! @date 2026-09-07
//! @version 1.0.0
//! @category Stream
//! @algo none

use serde::Deserialize;
use tauri::AppHandle;

use crate::voice::duplex_aec::{
    feed_duplex, probe_duplex, start_duplex, stop_duplex, DuplexFeedResult, DuplexProbe,
};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplexFeedInput {
    pub mic: Vec<f32>,
    #[serde(default)]
    pub reference: Vec<f32>,
    pub sample_rate: i32,
}

/// Duty: 探测双工 spike 是否可用。
#[tauri::command]
pub fn xu_voice_duplex_probe() -> DuplexProbe {
    probe_duplex()
}

/// Duty: 启动 NLMS 运行时。
#[tauri::command]
pub fn xu_voice_duplex_start() -> Result<(), String> {
    start_duplex()
}

/// Duty: 停止双工运行时。
#[tauri::command]
pub fn xu_voice_duplex_stop() {
    stop_duplex();
}

/// Duty: 喂入 mic + TTS 参考；可能 emit xu:voice-duplex-barge。
#[tauri::command]
pub fn xu_voice_duplex_feed(app: AppHandle, input: DuplexFeedInput) -> Result<DuplexFeedResult, String> {
    feed_duplex(&app, &input.mic, &input.reference, input.sample_rate)
}
