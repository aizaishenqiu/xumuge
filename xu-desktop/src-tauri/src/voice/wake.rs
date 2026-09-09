//! 本机 Sherpa 关键词唤醒（缺模型时前端回退 Web Speech）。
//!
//! @author qiuye <yjk150@qq.com>
//! @date 2026-09-05
//! @version 1.0.0
//! @category Stream
//! @algo sherpa-keyword-spotter-pcm-feed

use once_cell::sync::Lazy;
use serde::Serialize;
use std::sync::Mutex;
use tauri::AppHandle;
#[cfg(feature = "native-voice")]
use tauri::Emitter;

#[cfg(feature = "native-voice")]
use super::paths::{find_kws_model_dir, native_engine_root, native_kws_dir, resolve_kws_paths};

pub const WAKE_EVENT: &str = "xu:voice-wake";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KwsProbe {
    pub ready: bool,
    pub reason: String,
}

struct KwsRuntime {
    #[cfg(feature = "native-voice")]
    spotter: sherpa_onnx::KeywordSpotter,
    #[cfg(feature = "native-voice")]
    stream: sherpa_onnx::OnlineStream,
    #[cfg(not(feature = "native-voice"))]
    _marker: (),
}

static RUNTIME: Lazy<Mutex<Option<KwsRuntime>>> = Lazy::new(|| Mutex::new(None));

#[cfg(feature = "native-voice")]
fn kws_candidates() -> Vec<std::path::PathBuf> {
    let mut c = Vec::new();
    if let Ok(d) = native_kws_dir() {
        c.push(d);
    }
    if let Ok(root) = native_engine_root() {
        c.push(root.join("kws"));
        c.push(root);
    }
    c
}

/// Duty: 探测本机是否有可加载的 KWS 模型。失败不抛，ready=false。
pub fn probe_kws() -> KwsProbe {
    #[cfg(not(feature = "native-voice"))]
    {
        return KwsProbe {
            ready: false,
            reason: "当前安装包未包含离线唤醒引擎，将使用在线识别。".into(),
        };
    }
    #[cfg(feature = "native-voice")]
    {
        match find_kws_model_dir(&kws_candidates()) {
            Some(dir) => match resolve_kws_paths(&dir) {
                Ok(_) => KwsProbe {
                    ready: true,
                    reason: "已找到离线唤醒模型。".into(),
                },
                Err(e) => KwsProbe {
                    ready: false,
                    reason: e,
                },
            },
            None => KwsProbe {
                ready: false,
                reason: "未安装离线唤醒模型，将使用在线识别听唤醒词。".into(),
            },
        }
    }
}

/// Duty: 加载 KeywordSpotter；无模型返回错误供前端回退。
pub fn start_kws(keywords: &[String]) -> Result<(), String> {
    stop_kws();
    #[cfg(not(feature = "native-voice"))]
    {
        let _ = keywords;
        return Err("当前安装包未包含离线唤醒。".into());
    }
    #[cfg(feature = "native-voice")]
    {
        use sherpa_onnx::{KeywordSpotter, KeywordSpotterConfig};
        let dir = find_kws_model_dir(&kws_candidates())
            .ok_or_else(|| "未找到离线唤醒模型".to_string())?;
        let paths = resolve_kws_paths(&dir)?;
        let mut config = KeywordSpotterConfig::default();
        config.model_config.transducer.encoder =
            Some(paths.encoder.to_string_lossy().into_owned());
        config.model_config.transducer.decoder =
            Some(paths.decoder.to_string_lossy().into_owned());
        config.model_config.transducer.joiner =
            Some(paths.joiner.to_string_lossy().into_owned());
        config.model_config.tokens = Some(paths.tokens.to_string_lossy().into_owned());
        config.model_config.num_threads = 1;
        let joined = keywords
            .iter()
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .collect::<Vec<_>>()
            .join("\n");
        if let Some(file) = paths.keywords {
            config.keywords_file = Some(file.to_string_lossy().into_owned());
        } else if !joined.is_empty() {
            config.keywords_buf = Some(joined);
        }
        let spotter =
            KeywordSpotter::create(&config).ok_or_else(|| "无法创建离线唤醒引擎".to_string())?;
        let stream = spotter.create_stream();
        let mut guard = RUNTIME
            .lock()
            .map_err(|_| "唤醒引擎忙，请稍后重试".to_string())?;
        *guard = Some(KwsRuntime { spotter, stream });
        Ok(())
    }
}

pub fn stop_kws() {
    if let Ok(mut g) = RUNTIME.lock() {
        *g = None;
    }
}

/// Duty: 喂入 16k 单声道 PCM；命中则 emit xu:voice-wake。
pub fn feed_kws(app: &AppHandle, samples: &[f32], sample_rate: i32) -> Result<(), String> {
    #[cfg(not(feature = "native-voice"))]
    {
        let _ = (app, samples, sample_rate);
        return Ok(());
    }
    #[cfg(feature = "native-voice")]
    {
        if samples.is_empty() {
            return Ok(());
        }
        let mut guard = RUNTIME
            .lock()
            .map_err(|_| "唤醒引擎忙，请稍后重试".to_string())?;
        let Some(rt) = guard.as_mut() else {
            return Ok(());
        };
        rt.stream.accept_waveform(sample_rate, samples);
        while rt.spotter.is_ready(&rt.stream) {
            rt.spotter.decode(&rt.stream);
        }
        if let Some(result) = rt.spotter.get_result(&rt.stream) {
            let keyword = result.keyword.trim();
            if !keyword.is_empty() {
                let _ = app.emit(
                    WAKE_EVENT,
                    serde_json::json!({ "phrase": keyword }),
                );
                rt.spotter.reset(&rt.stream);
            }
        }
        Ok(())
    }
}
