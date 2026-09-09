//! 工程双工 spike：NLMS AEC + 残差能量插话检测（不接 ASR/LLM）。
//!
//! @author qiuye <yjk150@qq.com>
//! @date 2026-09-07
//! @version 1.0.0
//! @category Stream
//! @algo nlms-aec-energy-barge

use once_cell::sync::Lazy;
use serde::Serialize;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter};

pub const DUPLEX_BARGE_EVENT: &str = "xu:voice-duplex-barge";

const FILTER_LEN: usize = 256;
const MU: f32 = 0.15;
const EPS: f32 = 1e-6;
const BARGE_RESIDUAL_RMS: f32 = 0.018;
const BARGE_RATIO: f32 = 0.35;
const BARGE_HIT_FRAMES: u32 = 4;
const COOLDOWN_FRAMES: u32 = 20;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplexProbe {
    pub ready: bool,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplexFeedResult {
    pub residual_rms: f32,
    pub mic_rms: f32,
    pub barge: bool,
}

struct DuplexRuntime {
    w: Vec<f32>,
    ref_hist: Vec<f32>,
    hit: u32,
    cooldown: u32,
}

impl DuplexRuntime {
    fn new() -> Self {
        Self {
            w: vec![0.0; FILTER_LEN],
            ref_hist: vec![0.0; FILTER_LEN],
            hit: 0,
            cooldown: 0,
        }
    }
}

static RUNTIME: Lazy<Mutex<Option<DuplexRuntime>>> = Lazy::new(|| Mutex::new(None));

/// Duty: spike 始终可用（纯 Rust，不依赖 native-voice）。
pub fn probe_duplex() -> DuplexProbe {
    DuplexProbe {
        ready: true,
        reason: "NLMS AEC spike 可用（需 TTS 参考抽头）。".into(),
    }
}

pub fn start_duplex() -> Result<(), String> {
    let mut g = RUNTIME
        .lock()
        .map_err(|_| "双工引擎忙，请稍后重试".to_string())?;
    *g = Some(DuplexRuntime::new());
    Ok(())
}

pub fn stop_duplex() {
    if let Ok(mut g) = RUNTIME.lock() {
        *g = None;
    }
}

/// Duty: 喂入对齐的 mic/ref PCM；残差超阈连续若干帧则 emit barge。
pub fn feed_duplex(
    app: &AppHandle,
    mic: &[f32],
    reference: &[f32],
    _sample_rate: i32,
) -> Result<DuplexFeedResult, String> {
    if mic.is_empty() {
        return Ok(DuplexFeedResult {
            residual_rms: 0.0,
            mic_rms: 0.0,
            barge: false,
        });
    }
    let mut g = RUNTIME
        .lock()
        .map_err(|_| "双工引擎忙，请稍后重试".to_string())?;
    let Some(rt) = g.as_mut() else {
        return Ok(DuplexFeedResult {
            residual_rms: 0.0,
            mic_rms: 0.0,
            barge: false,
        });
    };

    let n = mic.len();
    let mut residual = vec![0.0f32; n];
    let mut mic_energy = 0.0f32;
    let mut res_energy = 0.0f32;

    for i in 0..n {
        let x = if i < reference.len() {
            reference[i]
        } else {
            0.0
        };
        // shift ref history
        rt.ref_hist.rotate_right(1);
        rt.ref_hist[0] = x;

        let mut y = 0.0f32;
        let mut x_pow = 0.0f32;
        for k in 0..FILTER_LEN {
            let rk = rt.ref_hist[k];
            y += rt.w[k] * rk;
            x_pow += rk * rk;
        }
        let e = mic[i] - y;
        residual[i] = e;
        mic_energy += mic[i] * mic[i];
        res_energy += e * e;

        let norm = x_pow + EPS;
        let step = MU * e / norm;
        for k in 0..FILTER_LEN {
            rt.w[k] += step * rt.ref_hist[k];
        }
    }

    let mic_rms = (mic_energy / n as f32).sqrt();
    let residual_rms = (res_energy / n as f32).sqrt();
    let ratio = if mic_rms > 1e-4 {
        residual_rms / mic_rms
    } else {
        0.0
    };

    let mut barge = false;
    if rt.cooldown > 0 {
        rt.cooldown -= 1;
        rt.hit = 0;
    } else if residual_rms >= BARGE_RESIDUAL_RMS && ratio >= BARGE_RATIO {
        rt.hit += 1;
        if rt.hit >= BARGE_HIT_FRAMES {
            barge = true;
            rt.hit = 0;
            rt.cooldown = COOLDOWN_FRAMES;
            let _ = app.emit(
                DUPLEX_BARGE_EVENT,
                DuplexFeedResult {
                    residual_rms,
                    mic_rms,
                    barge: true,
                },
            );
        }
    } else {
        rt.hit = 0;
    }

    Ok(DuplexFeedResult {
        residual_rms,
        mic_rms,
        barge,
    })
}
