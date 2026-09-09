//! 离线语音模型路径约定（XU_HOME / 语音包内）。
//!
//! @author qiuye <yjk150@qq.com>
//! @date 2026-08-31
//! @updated 2026-08-31
//! @version 1.1.0
//! @category Config
//! @algo none

use std::path::{Path, PathBuf};

/// `{XU_HOME}/voice-engines/native` — MCP/一键安装根。
pub fn native_engine_root() -> Result<PathBuf, String> {
    let root = crate::xu_paths::xu_home()?.join("voice-engines").join("native");
    std::fs::create_dir_all(&root).map_err(|e| format!("无法创建离线语音目录: {e}"))?;
    Ok(root)
}

pub fn native_tts_dir() -> Result<PathBuf, String> {
    let d = native_engine_root()?.join("tts");
    std::fs::create_dir_all(&d).map_err(|e| e.to_string())?;
    Ok(d)
}

pub fn native_asr_dir() -> Result<PathBuf, String> {
    let d = native_engine_root()?.join("asr");
    std::fs::create_dir_all(&d).map_err(|e| e.to_string())?;
    Ok(d)
}

pub fn native_kws_dir() -> Result<PathBuf, String> {
    let d = native_engine_root()?.join("kws");
    std::fs::create_dir_all(&d).map_err(|e| e.to_string())?;
    Ok(d)
}

/// 关键词模型：encoder/decoder/joiner + tokens.txt
pub fn kws_dir_ready(dir: &Path) -> bool {
    first_existing(dir, &["tokens.txt", "tokens"]).is_some()
        && first_kws_encoder(dir).is_some()
        && first_kws_decoder(dir).is_some()
        && first_kws_joiner(dir).is_some()
}

fn first_kws_encoder(dir: &Path) -> Option<PathBuf> {
    first_existing(
        dir,
        &[
            "encoder.onnx",
            "encoder.int8.onnx",
            "encoder-epoch-12-avg-2-chunk-16-left-64.onnx",
        ],
    )
    .or_else(|| first_file_prefix(dir, "encoder"))
}

fn first_kws_decoder(dir: &Path) -> Option<PathBuf> {
    first_existing(dir, &["decoder.onnx", "decoder.int8.onnx"]).or_else(|| first_file_prefix(dir, "decoder"))
}

fn first_kws_joiner(dir: &Path) -> Option<PathBuf> {
    first_existing(dir, &["joiner.onnx", "joiner.int8.onnx"]).or_else(|| first_file_prefix(dir, "joiner"))
}

fn first_file_prefix(dir: &Path, prefix: &str) -> Option<PathBuf> {
    let rd = std::fs::read_dir(dir).ok()?;
    let mut found = None;
    for e in rd.flatten() {
        let name = e.file_name().to_string_lossy().to_lowercase();
        if name.starts_with(prefix) && name.ends_with(".onnx") {
            found = Some(e.path());
            break;
        }
    }
    found
}

pub fn find_kws_model_dir(candidates: &[PathBuf]) -> Option<PathBuf> {
    for dir in candidates {
        if kws_dir_ready(dir) {
            return Some(dir.clone());
        }
        if let Ok(rd) = std::fs::read_dir(dir) {
            for e in rd.flatten() {
                let p = e.path();
                if p.is_dir() && kws_dir_ready(&p) {
                    return Some(p);
                }
            }
        }
    }
    None
}

pub struct KwsModelPaths {
    pub encoder: PathBuf,
    pub decoder: PathBuf,
    pub joiner: PathBuf,
    pub tokens: PathBuf,
    pub keywords: Option<PathBuf>,
}

pub fn resolve_kws_paths(dir: &Path) -> Result<KwsModelPaths, String> {
    let encoder = first_kws_encoder(dir).ok_or_else(|| "缺少 KWS encoder.onnx".to_string())?;
    let decoder = first_kws_decoder(dir).ok_or_else(|| "缺少 KWS decoder.onnx".to_string())?;
    let joiner = first_kws_joiner(dir).ok_or_else(|| "缺少 KWS joiner.onnx".to_string())?;
    let tokens = first_existing(dir, &["tokens.txt", "tokens"]).ok_or_else(|| "缺少 tokens.txt".to_string())?;
    let keywords = first_existing(dir, &["keywords.txt", "keywords"]);
    Ok(KwsModelPaths {
        encoder,
        decoder,
        joiner,
        tokens,
        keywords,
    })
}

/// 语音包内 TTS 目录：优先 `tts/`。
pub fn pack_tts_dir(pack_root: &Path) -> PathBuf {
    let nested = pack_root.join("tts");
    if nested.is_dir() {
        nested
    } else {
        pack_root.to_path_buf()
    }
}

/// 语音包内 ASR 目录：优先 `asr/`。
pub fn pack_asr_dir(pack_root: &Path) -> PathBuf {
    let nested = pack_root.join("asr");
    if nested.is_dir() {
        nested
    } else {
        pack_root.to_path_buf()
    }
}

/// 在候选目录中查找 Kokoro v1.0 int8 文件是否齐全（tts-rs：onnx + voices）。
pub fn find_kokoro_model_dir(candidates: &[PathBuf]) -> Option<PathBuf> {
    for dir in candidates {
        if kokoro_dir_ready(dir) {
            return Some(dir.clone());
        }
    }
    None
}

fn kokoro_dir_ready(dir: &Path) -> bool {
    let model = first_existing(
        dir,
        &[
            "kokoro-v1.0.int8.onnx",
            "kokoro-quant-convinteger.onnx",
            "model.onnx",
            "kokoro.onnx",
        ],
    );
    let voices = first_existing(dir, &["voices-v1.0.bin", "voices.bin"]);
    model.is_some() && voices.is_some()
}

fn first_existing(dir: &Path, names: &[&str]) -> Option<PathBuf> {
    names.iter().map(|n| dir.join(n)).find(|p| p.is_file())
}

/// tts-rs / 兼容：模型与音色向量路径。
pub fn resolve_kokoro_paths(dir: &Path) -> Result<KokoroPaths, String> {
    let model = first_existing(
        dir,
        &[
            "kokoro-v1.0.int8.onnx",
            "kokoro-quant-convinteger.onnx",
            "model.onnx",
            "kokoro.onnx",
        ],
    )
    .ok_or_else(|| "缺少 kokoro-v1.0.int8.onnx".to_string())?;
    let voices = first_existing(dir, &["voices-v1.0.bin", "voices.bin"])
        .ok_or_else(|| "缺少 voices-v1.0.bin".to_string())?;
    Ok(KokoroPaths { model, voices, dir: dir.to_path_buf() })
}

#[derive(Debug, Clone)]
pub struct KokoroPaths {
    pub model: PathBuf,
    pub voices: PathBuf,
    pub dir: PathBuf,
}

/// ASR 推荐子目录名（CTC zipformer zh int8）。
pub const ASR_CTC_DIR_NAME: &str = "sherpa-onnx-streaming-zipformer-ctc-zh-int8-2025-06-30";

pub fn find_asr_model_dir(candidates: &[PathBuf]) -> Option<PathBuf> {
    for dir in candidates {
        let nested = dir.join(ASR_CTC_DIR_NAME);
        if asr_ctc_ready(&nested) {
            return Some(nested);
        }
        if asr_ctc_ready(dir) {
            return Some(dir.clone());
        }
        // 子目录扫描一层
        if let Ok(rd) = std::fs::read_dir(dir) {
            for ent in rd.flatten() {
                let p = ent.path();
                if p.is_dir() && asr_ctc_ready(&p) {
                    return Some(p);
                }
            }
        }
    }
    None
}

pub fn asr_ctc_ready(dir: &Path) -> bool {
    dir.join("tokens.txt").is_file()
        && (dir.join("model.int8.onnx").is_file() || dir.join("model.onnx").is_file())
}
