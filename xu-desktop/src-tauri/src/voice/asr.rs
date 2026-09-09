//! Sherpa‑ONNX 离线 ASR（优先 CTC Zipformer zh int8）。
//!
//! @author qiuye <yjk150@qq.com>
//! @date 2026-08-31
//! @updated 2026-08-31
//! @version 1.1.0
//! @category Stream
//! @algo sherpa-offline-asr-ctc

use std::path::Path;

#[cfg(feature = "native-voice")]
use std::path::PathBuf;

#[cfg(feature = "native-voice")]
use super::paths::{find_asr_model_dir, native_engine_root, pack_asr_dir};

/// 识别 wav 文件，返回文本。
pub fn recognize_wav_file(pack_root: Option<&Path>, wav_path: &Path) -> Result<String, String> {
    #[cfg(feature = "native-voice")]
    {
        return recognize_native(pack_root, wav_path);
    }
    #[cfg(not(feature = "native-voice"))]
    {
        let _ = (pack_root, wav_path);
        Err("当前构建未启用 native-voice，无法离线 ASR。".into())
    }
}

#[cfg(feature = "native-voice")]
fn recognize_native(pack_root: Option<&Path>, wav_path: &Path) -> Result<String, String> {
    use sherpa_onnx::Wave;

    if !wav_path.is_file() {
        return Err("音频文件不存在".into());
    }
    let model_dir = {
        let mut c = Vec::new();
        if let Some(root) = pack_root {
            c.push(pack_asr_dir(root));
            c.push(root.to_path_buf());
        }
        if let Ok(native) = native_engine_root() {
            c.push(native.join("asr"));
            c.push(native);
        }
        find_asr_model_dir(&c).ok_or_else(|| "未找到 ASR 模型目录".to_string())?
    };
    let recognizer = create_recognizer(&model_dir)?;
    let wave =
        Wave::read(&wav_path.to_string_lossy()).ok_or_else(|| "无法读取 WAV".to_string())?;
    let stream = recognizer.create_stream();
    stream.accept_waveform(wave.sample_rate(), wave.samples());
    recognizer.decode(&stream);
    let result = stream
        .get_result()
        .ok_or_else(|| "识别无结果".to_string())?;
    Ok(result.text.trim().to_string())
}

#[cfg(feature = "native-voice")]
fn create_recognizer(dir: &Path) -> Result<sherpa_onnx::OfflineRecognizer, String> {
    use sherpa_onnx::{
        OfflineRecognizer, OfflineRecognizerConfig, OfflineTransducerModelConfig,
        OfflineZipformerCtcModelConfig,
    };

    let tokens = dir.join("tokens.txt");
    if !tokens.is_file() {
        return Err("缺少 tokens.txt".into());
    }

    // CTC Zipformer（一键安装默认）
    if let Some(model) = first_file(dir, &["model.int8.onnx", "model.onnx"]) {
        let mut config = OfflineRecognizerConfig::default();
        config.model_config.zipformer_ctc = OfflineZipformerCtcModelConfig {
            model: Some(model.to_string_lossy().into_owned()),
        };
        config.model_config.tokens = Some(tokens.to_string_lossy().into_owned());
        config.model_config.num_threads = 2;
        return OfflineRecognizer::create(&config)
            .ok_or_else(|| "加载 Zipformer CTC 失败".to_string());
    }

    // 兼容 transducer 三件套
    let encoder = first_file(dir, &["encoder.int8.onnx", "encoder.onnx"])
        .ok_or_else(|| "缺少 ASR model.onnx / encoder".to_string())?;
    let decoder = first_file(dir, &["decoder.int8.onnx", "decoder.onnx"]);
    let joiner = first_file(dir, &["joiner.int8.onnx", "joiner.onnx"]);
    let mut config = OfflineRecognizerConfig::default();
    config.model_config.transducer = OfflineTransducerModelConfig {
        encoder: Some(encoder.to_string_lossy().into_owned()),
        decoder: decoder.map(|p| p.to_string_lossy().into_owned()),
        joiner: joiner.map(|p| p.to_string_lossy().into_owned()),
    };
    config.model_config.tokens = Some(tokens.to_string_lossy().into_owned());
    config.model_config.num_threads = 2;
    OfflineRecognizer::create(&config).ok_or_else(|| "加载 Zipformer transducer 失败".to_string())
}

#[cfg(feature = "native-voice")]
fn first_file(dir: &Path, names: &[&str]) -> Option<PathBuf> {
    names.iter().map(|n| dir.join(n)).find(|p| p.is_file())
}
