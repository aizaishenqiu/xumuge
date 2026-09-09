//! 一键安装离线 ASR/TTS（与 MCP 同契约）：下载到 XU_HOME/voice-engines/native。
//!
//! 权重不走清华/腾讯/阿里/华为「软件包镜像」（那些不托管 HF/GitHub Release 模型文件）。
//! 默认按序自动切换国内加速源（ghfast / gh-proxy 等）+ hf-mirror 兜底；失败立即换源。
//!
//! @author qiuye <yjk150@qq.com>
//! @date 2026-08-31
//! @updated 2026-09-01
//! @version 1.3.0
//! @category Stream
//! @algo voice-native-mcp-install

use serde::{Deserialize, Serialize};
use std::fs::File;
use std::path::Path;
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use once_cell::sync::Lazy;
use tauri::{AppHandle, Emitter};

use super::kokoro::kokoro_models_ready;
use super::paths::{
    asr_ctc_ready, find_kokoro_model_dir, native_asr_dir, native_engine_root, native_tts_dir,
    resolve_kokoro_paths, ASR_CTC_DIR_NAME,
};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

static CANCEL: AtomicBool = AtomicBool::new(false);
static STATUS: Lazy<Mutex<VoiceNativeStatus>> =
    Lazy::new(|| Mutex::new(VoiceNativeStatus::default()));

const ASR_ARCHIVE: &str =
    "sherpa-onnx-streaming-zipformer-ctc-zh-int8-2025-06-30.tar.bz2";
const ASR_ONNX: &str = "model.int8.onnx";
const ASR_TOKENS: &str = "tokens.txt";
const ASR_HF_REPO: &str = "csukuangfj/sherpa-onnx-streaming-zipformer-ctc-zh-int8-2025-06-30";
const TTS_ONNX: &str = "kokoro-v1.0.int8.onnx";
const TTS_VOICES: &str = "voices-v1.0.bin";
const TTS_HF_REPO: &str = "xybrid-ai/Kokoro-82M-v1.0-ONNX";
const TTS_VOICES_REMOTE: &str = "voices.bin";

const GH_ASR: &str = "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-streaming-zipformer-ctc-zh-int8-2025-06-30.tar.bz2";
const GH_TTS_ONNX: &str = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.int8.onnx";
const GH_TTS_VOICES: &str = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin";

#[derive(Clone)]
pub(crate) struct MirrorCand {
    /// 用户可见短名（不含 URL）
    pub(crate) label: &'static str,
    pub(crate) url: String,
}

fn allow_overseas() -> bool {
    matches!(
        std::env::var("XU_ALLOW_OVERSEAS_HF")
            .or_else(|_| std::env::var("XU_ALLOW_GITHUB_DOWNLOAD"))
            .unwrap_or_default()
            .to_ascii_lowercase()
            .as_str(),
        "1" | "true" | "yes" | "on"
    )
}

fn intern(s: String) -> &'static str {
    Box::leak(s.into_boxed_str())
}

fn gh_asr() -> String {
    crate::xu_env::env_or("XU_NATIVE_ASR_URL", GH_ASR)
}

fn gh_tts_onnx() -> String {
    crate::xu_env::env_or("XU_NATIVE_TTS_ONNX_URL", GH_TTS_ONNX)
}

fn gh_tts_voices() -> String {
    crate::xu_env::env_or("XU_NATIVE_TTS_VOICES_URL", GH_TTS_VOICES)
}

/// 国内 GitHub Release 加速前缀（按序失败自动切换）。
fn cn_gh_prefixes() -> Vec<(&'static str, String)> {
    if let Some(raw) = crate::xu_env::nonempty("XU_GH_PROXY_PREFIXES") {
        let parts: Vec<String> = raw
            .split(',')
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .map(|p| {
                if p.ends_with('/') {
                    p.to_string()
                } else {
                    format!("{p}/")
                }
            })
            .collect();
        if !parts.is_empty() {
            return parts
                .into_iter()
                .enumerate()
                .map(|(i, prefix)| (intern(format!("加速源·{}", i + 1)), prefix))
                .collect();
        }
    }
    vec![
        ("加速源·快线", "https://ghfast.top/".into()),
        ("加速源·代理", "https://gh-proxy.com/".into()),
        ("加速源·备用", "https://ghproxy.net/".into()),
    ]
}

fn with_custom_gh_mirror(github_https_url: &str) -> Vec<MirrorCand> {
    let mut cands = Vec::new();
    if let Ok(m) = std::env::var("XU_GH_MIRROR").or_else(|_| std::env::var("XU_SHERPA_MIRROR")) {
        let base = m.trim().trim_end_matches('/');
        if !base.is_empty() {
            if base.contains("github.com") || github_https_url.starts_with("https://github.com/") {
                // 若自定义是 releases 根：拼接相对路径；若是代理前缀：拼完整 github URL
                let url = if base.ends_with("/download") || base.contains("/releases/download") {
                    let leaf = github_https_url
                        .split("/download/")
                        .nth(1)
                        .unwrap_or_default();
                    format!("{base}/{leaf}")
                } else {
                    format!("{base}/{github_https_url}")
                };
                cands.push(MirrorCand {
                    label: "自定义加速",
                    url,
                });
            }
        }
    }
    for (label, prefix) in cn_gh_prefixes() {
        cands.push(MirrorCand {
            label,
            url: format!("{prefix}{github_https_url}"),
        });
    }
    cands
}

fn hf_bases() -> Vec<(&'static str, String)> {
    let mut out = Vec::new();
    if let Ok(m) = std::env::var("HF_ENDPOINT") {
        let t = m.trim().trim_end_matches('/').to_string();
        if !t.is_empty() {
            out.push(("自定义HF", t));
        }
    }
    let hf = crate::xu_env::env_or("XU_HF_MIRROR", "https://hf-mirror.com")
        .trim_end_matches('/')
        .to_string();
    if !out.iter().any(|(_, x)| x == &hf) {
        out.push(("HF镜像", hf));
    }
    out
}

fn hf_file_cands(repo: &str, remote_file: &str) -> Vec<MirrorCand> {
    hf_bases()
        .into_iter()
        .map(|(label, base)| MirrorCand {
            label,
            url: format!("{base}/{repo}/resolve/main/{remote_file}"),
        })
        .collect()
}

fn asr_archive_cands() -> Vec<MirrorCand> {
    let url = gh_asr();
    let mut cands = with_custom_gh_mirror(&url);
    if allow_overseas() {
        cands.push(MirrorCand {
            label: "海外直连",
            url,
        });
    }
    cands
}

fn tts_onnx_cands() -> Vec<MirrorCand> {
    let url = gh_tts_onnx();
    let mut cands = with_custom_gh_mirror(&url);
    cands.extend(hf_file_cands(TTS_HF_REPO, TTS_ONNX));
    if allow_overseas() {
        cands.push(MirrorCand {
            label: "海外直连",
            url,
        });
    }
    cands
}

fn tts_voices_cands() -> Vec<MirrorCand> {
    let url = gh_tts_voices();
    let mut cands = with_custom_gh_mirror(&url);
    cands.extend(hf_file_cands(TTS_HF_REPO, TTS_VOICES_REMOTE));
    if allow_overseas() {
        cands.push(MirrorCand {
            label: "海外直连",
            url,
        });
    }
    cands
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct VoiceNativeStatus {
    pub phase: String,
    pub percent: u32,
    pub message: String,
    pub last_error: String,
    pub asr_ready: bool,
    pub tts_ready: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceNativeProbe {
    pub native_root: String,
    pub asr_ready: bool,
    pub tts_ready: bool,
    pub asr_path: Option<String>,
    pub tts_path: Option<String>,
    pub approx_bytes: u64,
    pub free_hint: String,
    pub warnings: Vec<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProgressEvt {
    stage: String,
    percent: u32,
    message: String,
}

fn set_status(phase: &str, percent: u32, message: &str, last_error: &str) {
    if let Ok(mut s) = STATUS.lock() {
        s.phase = phase.into();
        s.percent = percent;
        s.message = message.into();
        s.last_error = last_error.into();
        let tts = find_kokoro_model_dir(&[native_tts_dir().unwrap_or_default()]).is_some()
            || kokoro_models_ready(None);
        let asr = native_asr_dir()
            .ok()
            .and_then(|d| {
                let nested = d.join(ASR_CTC_DIR_NAME);
                if asr_ctc_ready(&nested) {
                    Some(nested)
                } else if asr_ctc_ready(&d) {
                    Some(d)
                } else {
                    None
                }
            })
            .is_some();
        s.tts_ready = tts;
        s.asr_ready = asr;
    }
}

/// 供 espeak 安装等其它模块写进度。
pub(crate) fn emit_public(app: Option<&AppHandle>, stage: &str, percent: u32, message: &str) {
    emit(app, stage, percent, message);
}

/// 按候选源依次下载；成功返回命中的 label。
pub(crate) fn download_first_public(
    app: Option<&AppHandle>,
    stage: &str,
    percent: u32,
    cands: &[MirrorCand],
    dest: &Path,
    min_ok: u64,
) -> Result<&'static str, String> {
    download_first(app, stage, percent, cands, dest, min_ok)
}

/// GitHub Release URL → 国内加速候选。
pub(crate) fn gh_release_cands_public(github_https_url: &str) -> Vec<MirrorCand> {
    let mut cands = with_custom_gh_mirror(github_https_url);
    for (label, prefix) in cn_gh_prefixes() {
        cands.push(MirrorCand {
            label,
            url: format!("{prefix}{github_https_url}"),
        });
    }
    if allow_overseas() {
        cands.push(MirrorCand {
            label: "GitHub 直连",
            url: github_https_url.to_string(),
        });
    }
    cands
}

fn emit(app: Option<&AppHandle>, stage: &str, percent: u32, message: &str) {
    set_status(stage, percent, message, "");
    if let Some(app) = app {
        let _ = app.emit(
            "xu:voice-native-progress",
            ProgressEvt {
                stage: stage.into(),
                percent,
                message: message.into(),
            },
        );
    }
}

/// 探测本机离线引擎文件。
pub fn probe() -> Result<VoiceNativeProbe, String> {
    let root = native_engine_root()?;
    let tts_dir = native_tts_dir()?;
    let asr_base = native_asr_dir()?;
    let tts_ready = find_kokoro_model_dir(&[tts_dir.clone()]).is_some();
    let asr_path = {
        let nested = asr_base.join(ASR_CTC_DIR_NAME);
        if asr_ctc_ready(&nested) {
            Some(nested)
        } else if asr_ctc_ready(&asr_base) {
            Some(asr_base.clone())
        } else {
            None
        }
    };
    let mut warnings = Vec::new();
    if !crate::voice::espeak::espeak_ready() {
        warnings.push(
            "未检测到 espeak-ng（Kokoro 音素引擎）。一键安装会自动补装；也可安装系统 espeak-ng。"
                .into(),
        );
    }
    Ok(VoiceNativeProbe {
        native_root: root.to_string_lossy().into_owned(),
        asr_ready: asr_path.is_some(),
        tts_ready,
        asr_path: asr_path.map(|p| p.to_string_lossy().into_owned()),
        tts_path: if tts_ready {
            Some(tts_dir.to_string_lossy().into_owned())
        } else {
            None
        },
        approx_bytes: 250 * 1024 * 1024,
        free_hint: "建议安装盘剩余 ≥ 1GB".into(),
        warnings,
    })
}

pub fn status() -> VoiceNativeStatus {
    let mut s = STATUS.lock().map(|x| x.clone()).unwrap_or_default();
    if let Ok(p) = probe() {
        s.asr_ready = p.asr_ready;
        s.tts_ready = p.tts_ready;
    }
    s
}

pub fn cancel() {
    CANCEL.store(true, Ordering::Relaxed);
    set_status("cancelled", 0, "已取消", "");
}

/// 下载并安装 ASR + TTS。
pub fn install(app: Option<AppHandle>) -> Result<VoiceNativeStatus, String> {
    CANCEL.store(false, Ordering::Relaxed);
    emit(app.as_ref(), "probing", 5, "检查本机…");
    let _ = probe()?;
    let cache = native_engine_root()?.join(".cache");
    std::fs::create_dir_all(&cache).map_err(|e| e.to_string())?;

    // ASR：国内加速拉 GitHub Release tar，失败自动换源；再尝试 HF 单文件兜底
    emit(
        app.as_ref(),
        "downloading_asr",
        15,
        "下载 ASR（国内加速自动切换）…",
    );
    let asr_dest = native_asr_dir()?;
    let asr_model = asr_dest.join(ASR_CTC_DIR_NAME);
    if !asr_ctc_ready(&asr_model) {
        let archive = cache.join(ASR_ARCHIVE);
        match download_first(
            app.as_ref(),
            "downloading_asr",
            15,
            &asr_archive_cands(),
            &archive,
            1_000_000,
        ) {
            Ok(src) => {
                emit(
                    app.as_ref(),
                    "extracting_asr",
                    40,
                    &format!("解压 ASR（来自{src}）…"),
                );
                extract_tar_bz2(&archive, &asr_dest)?;
            }
            Err(tar_err) => {
                // 兜底：HF 镜像单文件（可能仍因 LFS 跳海外失败）
                emit(
                    app.as_ref(),
                    "downloading_asr",
                    20,
                    "Release 加速均失败，改试 HF 镜像单文件…",
                );
                std::fs::create_dir_all(&asr_model).map_err(|e| e.to_string())?;
                let onnx_cands = hf_file_cands(ASR_HF_REPO, ASR_ONNX);
                let tok_cands = hf_file_cands(ASR_HF_REPO, ASR_TOKENS);
                download_first(
                    app.as_ref(),
                    "downloading_asr",
                    22,
                    &onnx_cands,
                    &asr_model.join(ASR_ONNX),
                    1_000_000,
                )
                .map_err(|e| format!("ASR 下载失败。Release：{}；HF：{}", tar_err, e))?;
                download_first(
                    app.as_ref(),
                    "downloading_asr_tokens",
                    35,
                    &tok_cands,
                    &asr_model.join(ASR_TOKENS),
                    100,
                )?;
            }
        }
        if !asr_ctc_ready(&asr_model) && !asr_ctc_ready(&asr_dest) {
            return Err("ASR 安装后未找到 model.int8.onnx / tokens.txt".into());
        }
    }

    emit(
        app.as_ref(),
        "downloading_tts",
        55,
        "下载 Kokoro（国内加速自动切换）…",
    );
    let tts_dir = native_tts_dir()?;
    let onnx = tts_dir.join(TTS_ONNX);
    download_first(
        app.as_ref(),
        "downloading_tts",
        55,
        &tts_onnx_cands(),
        &onnx,
        10 * 1024 * 1024,
    )?;
    if CANCEL.load(Ordering::Relaxed) {
        return Err("已取消".into());
    }
    emit(
        app.as_ref(),
        "downloading_voices",
        75,
        "下载音色向量（国内加速自动切换）…",
    );
    let voices = tts_dir.join(TTS_VOICES);
    download_first(
        app.as_ref(),
        "downloading_voices",
        75,
        &tts_voices_cands(),
        &voices,
        1 * 1024 * 1024,
    )?;

    if std::fs::metadata(&onnx).map(|m| m.len()).unwrap_or(0) < 10 * 1024 * 1024 {
        return Err("Kokoro onnx 文件过小，下载可能不完整".into());
    }
    if std::fs::metadata(&voices).map(|m| m.len()).unwrap_or(0) < 1 * 1024 * 1024 {
        return Err("voices.bin 过小，下载可能不完整".into());
    }
    let _ = resolve_kokoro_paths(&tts_dir)?;

    // Kokoro 音素依赖 espeak-ng：捆绑到 XU_HOME，避免用户手装
    if !crate::voice::espeak::espeak_ready() {
        crate::voice::espeak::ensure_espeak(app.as_ref())?;
    }

    let manifest = serde_json::json!({
        "schemaVersion": 1,
        "asr": ASR_CTC_DIR_NAME,
        "tts": [TTS_ONNX, TTS_VOICES],
        "espeak": crate::voice::espeak::espeak_ready(),
        "source": "cn-accelerate-chain",
        "updatedAt": chrono::Utc::now().to_rfc3339(),
    });
    let _ = std::fs::write(
        native_engine_root()?.join("install-manifest.json"),
        serde_json::to_vec_pretty(&manifest).unwrap_or_default(),
    );

    emit(app.as_ref(), "ready", 100, "离线 ASR/TTS 已安装");
    Ok(status())
}

/// 按候选源依次下载；成功返回命中的 label。
fn download_first(
    app: Option<&AppHandle>,
    stage: &str,
    percent: u32,
    cands: &[MirrorCand],
    dest: &Path,
    min_ok: u64,
) -> Result<&'static str, String> {
    if dest.is_file() && std::fs::metadata(dest).map(|m| m.len()).unwrap_or(0) >= min_ok {
        return Ok("本地缓存");
    }
    if cands.is_empty() {
        return Err("无可用下载源".into());
    }
    let mut last = String::new();
    let total = cands.len();
    for (i, cand) in cands.iter().enumerate() {
        if CANCEL.load(Ordering::Relaxed) {
            return Err("已取消".into());
        }
        emit(
            app,
            stage,
            percent,
            &format!("尝试{}（{}/{}）…", cand.label, i + 1, total),
        );
        match download_file(&cand.url, dest) {
            Ok(()) => {
                if std::fs::metadata(dest).map(|m| m.len()).unwrap_or(0) < min_ok {
                    let _ = std::fs::remove_file(dest);
                    last = format!("{} 返回文件过小", cand.label);
                    continue;
                }
                return Ok(cand.label);
            }
            Err(e) => {
                let _ = std::fs::remove_file(dest.with_extension("part"));
                last = format!("{}: {}", cand.label, e);
            }
        }
    }
    Err(if last.is_empty() {
        "国内加速源均不可用，请稍后重试".into()
    } else {
        format!("已切换全部国内加速源仍失败：{}", summarize_err(&last))
    })
}

fn summarize_err(e: &str) -> String {
    let scrubbed = e
        .split_whitespace()
        .map(|tok| {
            if tok.contains("://")
                || tok.contains("github.com")
                || tok.contains("hf-mirror")
                || tok.contains("ghproxy")
                || tok.contains("ghfast")
                || tok.contains("gh-proxy")
            {
                "[源]"
            } else {
                tok
            }
        })
        .collect::<Vec<_>>()
        .join(" ");
    scrubbed.chars().take(180).collect()
}

fn download_file(url: &str, dest: &Path) -> Result<(), String> {
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let client = reqwest::blocking::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(20))
        .timeout(std::time::Duration::from_secs(60 * 20))
        .user_agent("xumuge-desktop/1.0 (voice-native; cn-accelerate)")
        .redirect(reqwest::redirect::Policy::limited(8))
        .build()
        .map_err(|e| e.to_string())?;
    let mut resp = client
        .get(url)
        .send()
        .map_err(|e| format!("网络错误: {}", summarize_err(&e.to_string())))?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    // 若最终落到海外 HF LFS CDN，国内常失败——提前拒绝以便换源
    let final_url = resp.url().as_str().to_ascii_lowercase();
    if final_url.contains("amazonaws.com")
        || final_url.contains("aws.cdn.hf.co")
        || final_url.contains("cdn-lfs.huggingface")
    {
        return Err("镜像跳转到海外 CDN，换下一源".into());
    }
    let tmp = dest.with_extension("part");
    let mut file = File::create(&tmp).map_err(|e| e.to_string())?;
    std::io::copy(&mut resp, &mut file).map_err(|e| format!("写盘失败: {e}"))?;
    drop(file);
    std::fs::rename(&tmp, dest).map_err(|e| e.to_string())?;
    Ok(())
}

fn extract_tar_bz2(archive: &Path, dest_dir: &Path) -> Result<(), String> {
    std::fs::create_dir_all(dest_dir).map_err(|e| e.to_string())?;
    let mut cmd = Command::new("tar");
    cmd.args([
        "-xjf",
        &archive.to_string_lossy(),
        "-C",
        &dest_dir.to_string_lossy(),
    ]);
    #[cfg(windows)]
    {
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let out = cmd.output().map_err(|e| format!("无法运行 tar: {e}"))?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        return Err(format!("解压失败: {}", summarize_err(&err)));
    }
    Ok(())
}
