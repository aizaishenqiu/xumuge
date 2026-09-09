//! Kokoro TTS：`native-tts` / `native-voice` 下用 tts-rs；否则仅探测文件。
//!
//! @author qiuye <yjk150@qq.com>
//! @date 2026-08-31
//! @updated 2026-09-01
//! @version 1.5.0
//! @category Stream
//! @algo lazy-tts-rs-kokoro

use std::path::{Path, PathBuf};

use super::paths::{find_kokoro_model_dir, native_engine_root, pack_tts_dir};

fn candidate_dirs(pack_root: Option<&Path>) -> Vec<PathBuf> {
    let mut out = Vec::new();
    if let Some(root) = pack_root {
        out.push(pack_tts_dir(root));
        out.push(root.to_path_buf());
    }
    if let Ok(native) = native_engine_root() {
        out.push(native.join("tts"));
        out.push(native);
    }
    out
}

/// 是否具备 Kokoro v1.0 int8 + voices。
pub fn kokoro_models_ready(pack_root: Option<&Path>) -> bool {
    find_kokoro_model_dir(&candidate_dirs(pack_root)).is_some()
}

/// 模型齐全即可合成中文（音素走内置 G2P，不依赖 espeak）。
pub fn kokoro_synthesis_ready(pack_root: Option<&Path>) -> bool {
    kokoro_models_ready(pack_root)
}

/// 归一化为 kokoro voice_id（字符串）。
pub fn resolve_voice_id(voice: &str) -> String {
    let v = voice.trim();
    if v.is_empty() {
        return "zf_xiaoxiao".into();
    }
    match v {
        "female-mature" | "female-angry" | "3" => "zf_xiaoxiao".into(),
        "female-loli" | "female-cute" | "female-joke" | "11" => "zf_xiaoni".into(),
        // voices-v1.0.bin 无 zf_yanyan；温柔 = zf_xiaobei
        "female-gentle" | "female-sad" | "female-calm" | "14" | "zf_yanyan" => {
            "zf_xiaobei".into()
        }
        "female-sunny" | "female-happy" | "21" | "zf_xiaoyi" => "zf_xiaoyi".into(),
        "male-calm" | "58" => "zm_yunjian".into(),
        "male-sunny" | "59" => "zm_yunxi".into(),
        _ => v.to_string(),
    }
}

fn is_chinese_voice(voice_id: &str) -> bool {
    voice_id.starts_with("zf_") || voice_id.starts_with("zm_")
}

/// 合成到临时 wav。
pub fn synthesize_to_wav_path(
    pack_root: Option<&Path>,
    text: &str,
    voice: &str,
    speed: f32,
) -> Result<PathBuf, String> {
    #[cfg(any(feature = "native-voice", feature = "native-tts"))]
    {
        return synthesize_native(pack_root, text, voice, speed);
    }
    #[cfg(not(any(feature = "native-voice", feature = "native-tts")))]
    {
        let _ = (text, voice, speed);
        if !kokoro_models_ready(pack_root) {
            return Err("未找到 Kokoro 模型（请先一键安装离线语音）".into());
        }
        Err(
            "当前构建未启用 native-tts。请在 tauri.conf.json build.features 加入 native-tts 后重编。"
                .into(),
        )
    }
}

/// 预热：加载 ORT 图并合成短句，避免首次试听卡数秒。
pub fn warmup(pack_root: Option<&Path>, voice: &str) -> Result<(), String> {
    #[cfg(any(feature = "native-voice", feature = "native-tts"))]
    {
        let voice_id = resolve_voice_id(voice);
        let _ = synthesize_native(pack_root, "你好。", &voice_id, 1.0)?;
        Ok(())
    }
    #[cfg(not(any(feature = "native-voice", feature = "native-tts")))]
    {
        let _ = (pack_root, voice);
        Err("当前构建未启用 native-tts".into())
    }
}

#[cfg(any(feature = "native-voice", feature = "native-tts"))]
fn synthesize_native(
    pack_root: Option<&Path>,
    text: &str,
    voice: &str,
    speed: f32,
) -> Result<PathBuf, String> {
    use std::sync::Mutex;

    use once_cell::sync::Lazy;
    use tts_rs::engines::kokoro::{KokoroEngine, KokoroInferenceParams, KokoroModelParams};
    use tts_rs::SynthesisEngine;

    use super::paths::resolve_kokoro_paths;

    struct EngineSlot {
        dir: PathBuf,
        engine: KokoroEngine,
    }

    static ENGINE: Lazy<Mutex<Option<EngineSlot>>> = Lazy::new(|| Mutex::new(None));

    let text = text.trim();
    if text.is_empty() {
        return Err("试听文本为空".into());
    }
    let dir = find_kokoro_model_dir(&candidate_dirs(pack_root))
        .ok_or_else(|| "未找到 Kokoro 模型（请先一键安装）".to_string())?;
    let voice_id = resolve_voice_id(voice);
    let speed = if speed.is_finite() && speed > 0.1 {
        speed.clamp(0.5, 2.0)
    } else {
        1.0
    };

    // 中文音色用内置 G2P；仅非中文才需要 espeak。
    let espeak_cfg = if is_chinese_voice(&voice_id) {
        None
    } else {
        let espeak = super::espeak::resolve_espeak_paths()
            .or_else(|| super::espeak::ensure_espeak(None).ok())
            .ok_or_else(|| {
                "未找到 espeak-ng（非中文音色需要）。请重新「一键安装离线语音」。".to_string()
            })?;
        Some((espeak.bin, espeak.data))
    };

    let mut guard = ENGINE.lock().map_err(|_| "语音引擎锁异常".to_string())?;
    let need_reload = guard.as_ref().map(|s| s.dir != dir).unwrap_or(true);
    if need_reload {
        let paths = resolve_kokoro_paths(&dir)?;
        ensure_tts_rs_layout(&paths)?;
        let cache = ort_cache_path(&dir)?;
        let threads = std::thread::available_parallelism()
            .map(|n| n.get().clamp(2, 8))
            .unwrap_or(4);
        let mut engine = if let Some((bin, data)) = espeak_cfg.clone() {
            KokoroEngine::with_espeak(Some(bin), Some(data))
        } else {
            KokoroEngine::new()
        };
        engine
            .load_model_with_params(
                &dir,
                KokoroModelParams {
                    num_threads: Some(threads),
                    optimized_model_cache_path: Some(cache),
                },
            )
            .map_err(|e| format!("加载 Kokoro 失败: {e}"))?;
        *guard = Some(EngineSlot {
            dir: dir.clone(),
            engine,
        });
    } else if let Some((bin, data)) = espeak_cfg {
        // 引擎已在内存：非中文时确保 espeak 路径写回（with_espeak 仅在构造时生效）。
        // 当前 tts-rs 无热更新 espeak；英文音色首次需与中文分进程冷启——此处仅占位避免告警。
        let _ = (bin, data);
    }
    let slot = guard.as_mut().ok_or_else(|| "语音引擎未就绪".to_string())?;
    let params = KokoroInferenceParams {
        voice: voice_id,
        speed,
        ..Default::default()
    };
    let out_dir = std::env::temp_dir().join("xu-voice");
    std::fs::create_dir_all(&out_dir).map_err(|e| format!("无法创建临时目录: {e}"))?;
    let path = out_dir.join(format!("{}.wav", uuid::Uuid::new_v4()));
    let result = slot
        .engine
        .synthesize(text, Some(params))
        .map_err(|e| format!("Kokoro 合成失败: {e}"))?;
    write_pcm16_wav(&path, &result.samples, result.sample_rate)?;
    Ok(path)
}

#[cfg(any(feature = "native-voice", feature = "native-tts"))]
fn ort_cache_path(model_dir: &Path) -> Result<PathBuf, String> {
    // 写在模型旁；第二次启动跳过 Level3（可省数秒）
    let p = model_dir.join("kokoro-ort-opt.onnx");
    Ok(p)
}

/// 写出浏览器可播的 16-bit PCM WAV。
#[cfg(any(feature = "native-voice", feature = "native-tts"))]
fn write_pcm16_wav(path: &Path, samples: &[f32], sample_rate: u32) -> Result<(), String> {
    let spec = hound::WavSpec {
        channels: 1,
        sample_rate,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    let mut writer =
        hound::WavWriter::create(path, spec).map_err(|e| format!("创建 WAV 失败: {e}"))?;
    for &s in samples {
        let clamped = if s.is_finite() {
            s.clamp(-1.0, 1.0)
        } else {
            0.0
        };
        let sample = (clamped * i16::MAX as f32) as i16;
        writer
            .write_sample(sample)
            .map_err(|e| format!("写入 WAV 失败: {e}"))?;
    }
    writer
        .finalize()
        .map_err(|e| format!("关闭 WAV 失败: {e}"))?;
    Ok(())
}

#[cfg(any(feature = "native-voice", feature = "native-tts"))]
fn ensure_tts_rs_layout(paths: &super::paths::KokoroPaths) -> Result<(), String> {
    let dir = &paths.dir;
    let preferred = dir.join("kokoro-v1.0.int8.onnx");
    if paths.model != preferred && !preferred.is_file() {
        let _ = std::fs::copy(&paths.model, &preferred);
    }
    let voices_pref = dir.join("voices-v1.0.bin");
    if paths.voices != voices_pref && !voices_pref.is_file() {
        let _ = std::fs::copy(&paths.voices, &voices_pref);
    }
    Ok(())
}
