//! 离线关键词唤醒 Tauri 命令。
//!
//! @author qiuye <yjk150@qq.com>
//! @date 2026-09-05
//! @version 1.0.0
//! @category Stream
//! @algo none

use serde::Deserialize;
use tauri::AppHandle;

use crate::voice::wake::{feed_kws, probe_kws, start_kws, stop_kws, KwsProbe};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WakeStartInput {
    #[serde(default)]
    pub keywords: Vec<String>,
}

/// 探测离线唤醒模型是否可用。
#[tauri::command]
pub fn xu_voice_wake_probe() -> KwsProbe {
    probe_kws()
}

/// 启动 KeywordSpotter；无模型时返回错误。
#[tauri::command]
pub fn xu_voice_wake_start(input: WakeStartInput) -> Result<(), String> {
    start_kws(&input.keywords)
}

/// 停止离线唤醒。
#[tauri::command]
pub fn xu_voice_wake_stop() {
    stop_kws();
}

/// 喂入麦克风 PCM（前端采集）。
#[tauri::command]
pub fn xu_voice_wake_feed(
    app: AppHandle,
    samples: Vec<f32>,
    sample_rate: i32,
) -> Result<(), String> {
    feed_kws(&app, &samples, sample_rate)
}
