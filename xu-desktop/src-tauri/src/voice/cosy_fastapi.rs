//! CosyVoice FastAPI sidecar：用户自配路径启动/停止 + 音色库扫描 + PCM 合成代理。
//!
//! @author qiuye <yjk150@qq.com>
//! @date 2026-09-01
//! @updated 2026-09-03
//! @version 1.3.0
//! @category Stream
//! @algo user-path-sidecar-multipart-pcm-stream

use super::cosy_discover::{self, is_cosyvoice2_model};
use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::fs::OpenOptions;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[cfg(windows)]
fn set_below_normal_priority(pid: u32) {
    use std::os::windows::process::CommandExt;
    // 用 PowerShell 降优先级，避免额外 winapi 依赖
    let _ = Command::new("powershell")
        .args([
            "-NoProfile",
            "-Command",
            &format!(
                "try {{ (Get-Process -Id {pid}).PriorityClass = 'BelowNormal' }} catch {{}}"
            ),
        ])
        .creation_flags(CREATE_NO_WINDOW)
        .output();
}

static SIDECAR: Lazy<Mutex<SidecarInner>> = Lazy::new(|| {
    Mutex::new(SidecarInner {
        child: None,
        last_error: String::new(),
    })
});

struct SidecarInner {
    child: Option<Child>,
    last_error: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CosySidecarStatus {
    pub running: bool,
    pub pid: Option<u32>,
    pub last_error: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CosyVoicePresetDto {
    pub id: String,
    pub name: String,
    pub sample_wav: String,
    pub prompt_text: String,
    pub missing_prompt: bool,
}

fn status_locked(inner: &mut SidecarInner) -> CosySidecarStatus {
    if let Some(child) = inner.child.as_mut() {
        match child.try_wait() {
            Ok(Some(_)) => {
                inner.child = None;
            }
            Ok(None) => {
                return CosySidecarStatus {
                    running: true,
                    pid: Some(child.id()),
                    last_error: inner.last_error.clone(),
                };
            }
            Err(e) => {
                inner.last_error = e.to_string();
                inner.child = None;
            }
        }
    }
    CosySidecarStatus {
        running: false,
        pid: None,
        last_error: inner.last_error.clone(),
    }
}

const SERVER_XU_PY: &str = include_str!("../../resources/cosyvoice/server_xu.py");
const SERVER_XU_VERSION: &str = "1.2.0";

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FastapiHealth {
    pub ok: bool,
    pub script_version: String,
    pub instance_id: String,
    pub model_dir: String,
    pub model_family: String,
    pub streaming: bool,
    pub sample_rate: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FastapiHealthProbe {
    pub ready: bool,
    pub reason: String,
    pub health: Option<FastapiHealth>,
}

/// 以 lossy UTF-8 读 sidecar 日志等文本文件（Windows 可能混 GBK）。
pub fn read_log_file_lossy(path: &Path) -> String {
    std::fs::read(path)
        .map(|bytes| String::from_utf8_lossy(&bytes).into_owned())
        .unwrap_or_default()
}

fn read_text_lossy(path: &Path) -> String {
    read_log_file_lossy(path)
}

/// 释放端口上的监听进程（应用重启后旧 server.py 孤儿进程仍占端口时必需）。
pub fn free_port(port: u16) {
    if port == 0 {
        return;
    }
    #[cfg(windows)]
    {
        use std::collections::HashSet;
        use std::os::windows::process::CommandExt;
        let needle = format!(":{port}");
        let Ok(out) = Command::new("netstat")
            .args(["-ano"])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
        else {
            return;
        };
        let text = String::from_utf8_lossy(&out.stdout);
        let mut pids = HashSet::new();
        for line in text.lines() {
            if !line.contains("LISTENING") || !line.contains(&needle) {
                continue;
            }
            if let Some(pid_str) = line.split_whitespace().last() {
                if let Ok(pid) = pid_str.parse::<u32>() {
                    if pid > 0 {
                        pids.insert(pid);
                    }
                }
            }
        }
        for pid in &pids {
            // 绝不杀本进程（误匹配端口时保命）
            if *pid == std::process::id() {
                continue;
            }
            let _ = Command::new("taskkill")
                .args(["/F", "/T", "/PID", &pid.to_string()])
                .creation_flags(CREATE_NO_WINDOW)
                .output();
        }
        if !pids.is_empty() {
            std::thread::sleep(std::time::Duration::from_millis(600));
        }
    }
    #[cfg(not(windows))]
    {
        let _ = Command::new("sh")
            .arg("-c")
            .arg(format!(
                "lsof -ti tcp:{port} 2>/dev/null | xargs -r kill -9 2>/dev/null; true"
            ))
            .status();
    }
}

/// 写入 Xu 补丁版 FastAPI（修复 CV2/CV3 上传 wav 被预 load 成 tensor 的 upstream bug）。
fn ensure_server_xu_script(work_dir: &Path) -> Result<PathBuf, String> {
    let dest = work_dir.join("server_xu.py");
    let stamp = crate::xu_paths::xu_home()
        .map(|h| h.join("cosyvoice").join("server_xu.version"))
        .ok();
    // 版本戳只用于诊断；内容才是部署真源，避免忘记升戳后永远运行旧脚本。
    let needs_write = std::fs::read(&dest)
        .map(|bytes| bytes != SERVER_XU_PY.as_bytes())
        .unwrap_or(true);
    if needs_write {
        let tmp = work_dir.join("server_xu.py.tmp");
        std::fs::write(&tmp, SERVER_XU_PY)
            .map_err(|e| format!("写入 server_xu.py 临时文件失败：{e}"))?;
        if dest.exists() {
            std::fs::remove_file(&dest)
                .map_err(|e| format!("替换旧 server_xu.py 失败：{e}"))?;
        }
        std::fs::rename(&tmp, &dest)
            .map_err(|e| format!("部署 server_xu.py 失败：{e}"))?;
    }
    if needs_write
        || stamp
            .as_ref()
            .and_then(|p| std::fs::read_to_string(p).ok())
            .as_deref()
            != Some(SERVER_XU_VERSION)
    {
        if let Some(p) = stamp {
            let _ = std::fs::create_dir_all(p.parent().unwrap_or(Path::new(".")));
            let _ = std::fs::write(p, SERVER_XU_VERSION);
        }
    }
    Ok(dest)
}

/// 用用户填写的绝对路径启动 server_xu.py（同目录 server.py 作安装标记）。
pub fn sidecar_start(
    python: &str,
    server_script: &str,
    model_dir: &str,
    extra_args: &str,
    port: u16,
) -> Result<CosySidecarStatus, String> {
    let python = python.trim();
    let script = server_script.trim();
    let model_raw = model_dir.trim();
    if python.is_empty() || script.is_empty() {
        return Err("请填写 Python 可执行文件与 server.py 绝对路径（因人而异，不写死）。".into());
    }
    let script_path = Path::new(script);
    if !script_path.is_file() {
        return Err(format!("找不到 server.py：{script}"));
    }
    let work_dir = script_path
        .parent()
        .ok_or_else(|| "server.py 路径无效".to_string())?;
    let model_abs = if model_raw.is_empty() {
        String::new()
    } else {
        let mp = Path::new(model_raw);
        let resolved = if mp.is_absolute() {
            mp.to_path_buf()
        } else {
            work_dir.join(mp)
        };
        if !resolved.exists() {
            return Err(format!("model_dir 不存在：{}", resolved.display()));
        }
        resolved.to_string_lossy().into_owned()
    };
    let mut guard = SIDECAR.lock().map_err(|_| "sidecar 锁异常".to_string())?;
    let st = status_locked(&mut guard);
    if st.running {
        return Ok(st);
    }
    free_port(port);
    let xu_script = ensure_server_xu_script(work_dir)?;
    let log_path = crate::xu_paths::xu_home()
        .map(|h| h.join("cosyvoice").join("sidecar.log"))
        .unwrap_or_else(|_| PathBuf::from("sidecar.log"));
    let _ = std::fs::create_dir_all(log_path.parent().unwrap_or(Path::new(".")));
    let log_file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .ok();
    let mut cmd = Command::new(python);
    cmd.current_dir(work_dir);
    cmd.arg(&xu_script);
    cmd.env("PYTHONUTF8", "1");
    cmd.env("PYTHONIOENCODING", "utf-8");
    // 与 WebView2 共存：默认可选强制 CPU，避免 CUDA 占满显卡导致桌面黑屏
    if std::env::var("XU_COSY_FORCE_CPU")
        .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
        .unwrap_or(false)
    {
        cmd.env("CUDA_VISIBLE_DEVICES", "");
    }
    // 限制碎片化抢显存，降低与 WebView 抢 GPU 概率
    if std::env::var_os("PYTORCH_CUDA_ALLOC_CONF").is_none() {
        cmd.env("PYTORCH_CUDA_ALLOC_CONF", "max_split_size_mb:64");
    }
    if port > 0 {
        cmd.arg("--port").arg(port.to_string());
    }
    if !model_abs.is_empty() {
        cmd.arg("--model_dir").arg(&model_abs);
    } else if !model_raw.is_empty() {
        cmd.arg("--model_dir").arg(model_raw);
    }
    for part in extra_args.split_whitespace() {
        if !part.is_empty() {
            cmd.arg(part);
        }
    }
    cmd.stdin(Stdio::null());
    if let Some(f) = log_file {
        cmd.stdout(Stdio::from(f.try_clone().map_err(|e| e.to_string())?))
            .stderr(Stdio::from(f));
    } else {
        cmd.stdout(Stdio::null()).stderr(Stdio::null());
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    match cmd.spawn() {
        Ok(child) => {
            let pid = child.id();
            #[cfg(windows)]
            {
                set_below_normal_priority(pid);
            }
            guard.child = Some(child);
            guard.last_error.clear();
            Ok(CosySidecarStatus {
                running: true,
                pid: Some(pid),
                last_error: String::new(),
            })
        }
        Err(e) => {
            guard.last_error = e.to_string();
            Err(format!("启动 CosyVoice FastAPI 失败：{e}"))
        }
    }
}

pub fn sidecar_stop() -> Result<CosySidecarStatus, String> {
    let mut guard = SIDECAR.lock().map_err(|_| "sidecar 锁异常".to_string())?;
    if let Some(mut child) = guard.child.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
    guard.last_error.clear();
    drop(guard);
    // 设置页停止也释放端口，避免孤儿/子进程占 50000
    free_port(50000);
    let mut guard = SIDECAR.lock().map_err(|_| "sidecar 锁异常".to_string())?;
    Ok(status_locked(&mut guard))
}

pub fn sidecar_status() -> Result<CosySidecarStatus, String> {
    let mut guard = SIDECAR.lock().map_err(|_| "sidecar 锁异常".to_string())?;
    Ok(status_locked(&mut guard))
}

/// 扫描 voicesRoot 下一层子目录中的 sample.wav / ref.wav + prompt.txt。
pub fn scan_voices(voices_root: &str) -> Result<Vec<CosyVoicePresetDto>, String> {
    let root = PathBuf::from(voices_root.trim());
    if voices_root.trim().is_empty() {
        return Ok(vec![]);
    }
    if !root.is_dir() {
        return Err(format!("音色库目录不存在：{}", root.display()));
    }
    let mut out = Vec::new();
    let rd = std::fs::read_dir(&root).map_err(|e| format!("无法读取音色库：{e}"))?;
    for ent in rd.flatten() {
        let path = ent.path();
        if !path.is_dir() {
            continue;
        }
        let id = path
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_string();
        if id.is_empty() || id.starts_with('.') {
            continue;
        }
        let sample = ["sample.wav", "ref.wav", "prompt.wav"]
            .iter()
            .map(|n| path.join(n))
            .find(|p| p.is_file());
        let Some(sample_wav) = sample else {
            continue;
        };
        let prompt_path = path.join("prompt.txt");
        let (prompt_text, missing_prompt) = if prompt_path.is_file() {
            (
                std::fs::read_to_string(&prompt_path)
                    .unwrap_or_default()
                    .trim()
                    .to_string(),
                false,
            )
        } else {
            (String::new(), true)
        };
        let name = path
            .join("name.txt")
            .is_file()
            .then(|| std::fs::read_to_string(path.join("name.txt")).ok())
            .flatten()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| id.clone());
        out.push(CosyVoicePresetDto {
            id: id.clone(),
            name,
            sample_wav: sample_wav.to_string_lossy().into_owned(),
            prompt_text,
            missing_prompt,
        });
    }
    out.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(out)
}

/// 探测 Xu FastAPI 身份、流式能力和实际模型；普通 FastAPI 不能冒充就绪。
pub fn probe_fastapi_health(base_url: &str) -> Result<FastapiHealthProbe, String> {
    let base = base_url.trim().trim_end_matches('/');
    if base.is_empty() || !(base.starts_with("http://") || base.starts_with("https://")) {
        return Ok(FastapiHealthProbe {
            ready: false,
            reason: "本机语音服务地址无效，请恢复默认地址后重试。".into(),
            health: None,
        });
    }
    let client = reqwest::blocking::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(1))
        .timeout(std::time::Duration::from_secs(2))
        .build()
        .map_err(|e| e.to_string())?;
    let url = format!("{base}/xu/health");
    match client.get(&url).send() {
        Ok(resp) if resp.status().is_success() => {
            let health = resp
                .json::<FastapiHealth>()
                .map_err(|e| format!("本机语音服务身份响应无效：{e}"))?;
            let ready = health.ok && health.streaming && !health.instance_id.trim().is_empty();
            Ok(FastapiHealthProbe {
                ready,
                reason: if ready {
                    format!(
                        "本机 CosyVoice 已就绪（{}，脚本 {}）。",
                        health.model_family, health.script_version
                    )
                } else {
                    "本机语音服务未启用流式合成，请停止后重新启动。".into()
                },
                health: Some(health),
            })
        }
        Ok(_) => Ok(FastapiHealthProbe {
            ready: false,
            reason: "当前端口不是虚募阁启动的 CosyVoice 服务，请停止占用进程后重启。".into(),
            health: None,
        }),
        Err(_) => Ok(FastapiHealthProbe {
            ready: false,
            reason: "无法连接本机 CosyVoice，请先启动服务。".into(),
            health: None,
        }),
    }
}

/// 兼容通用后端状态接口，只暴露 ready 与用户向原因。
pub fn probe_fastapi(base_url: &str) -> Result<(bool, String), String> {
    let probe = probe_fastapi_health(base_url)?;
    Ok((probe.ready, probe.reason))
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FastapiPcmResult {
    pub pcm_base64: String,
    pub sample_rate: u32,
}

/// 流式 PCM 事件名（前端 listen）。
pub const COSY_PCM_EVENT: &str = "xu:cosy-pcm";

/// FastAPI 流式 PCM 分片事件（边合成边推）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FastapiPcmStreamEvt {
    pub job_id: String,
    /// `chunk` | `done` | `error`
    pub kind: String,
    pub pcm_base64: Option<String>,
    pub sample_rate: u32,
    pub message: Option<String>,
}

const DEFAULT_PCM_SAMPLE_RATE: u32 = 22050;

/// sys 种子或与默认女声同一文件：CV1 不应走 instruct2 克隆。
fn is_shared_or_sys_seed_wav(prompt_wav: &str, fallback_prompt_wav: &str) -> bool {
    let norm = prompt_wav.replace('\\', "/").to_ascii_lowercase();
    if norm.contains("/sys-") {
        return true;
    }
    let fb = fallback_prompt_wav.trim();
    if fb.is_empty() {
        return false;
    }
    if Path::new(prompt_wav) == Path::new(fb) {
        return true;
    }
    match (std::fs::canonicalize(prompt_wav), std::fs::canonicalize(fb)) {
        (Ok(a), Ok(b)) => a == b,
        _ => {
            let a = prompt_wav.replace('\\', "/").to_ascii_lowercase();
            let b = fb.replace('\\', "/").to_ascii_lowercase();
            a == b
        }
    }
}

fn sidecar_log_tail(max_lines: usize) -> String {
    let path = crate::xu_paths::xu_home()
        .ok()
        .map(|h| h.join("cosyvoice").join("sidecar.log"));
    let Some(path) = path.filter(|p| p.is_file()) else {
        return String::new();
    };
    read_text_lossy(&path)
        .lines()
        .rev()
        .take(max_lines)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect::<Vec<_>>()
        .join("\n")
}

fn read_http_body(resp: reqwest::blocking::Response) -> Result<Vec<u8>, String> {
    use std::io::Read;
    let mut body = resp;
    let mut buf = Vec::new();
    body.read_to_end(&mut buf).map_err(|e| {
        let tail = sidecar_log_tail(15);
        if tail.is_empty() {
            format!("读取 PCM 失败：{e}（请停止后重新启动 sidecar 以加载 server_xu.py 补丁）")
        } else {
            format!(
                "读取 PCM 失败：{e}\n\n请停止后重新启动 sidecar（server_xu.py）。sidecar 日志尾部：\n{tail}"
            )
        }
    })?;
    Ok(buf)
}

fn sample_rate_from_headers(headers: &reqwest::header::HeaderMap) -> u32 {
    headers
        .get("x-sample-rate")
        .or_else(|| headers.get("X-Sample-Rate"))
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.trim().parse::<u32>().ok())
        .filter(|&r| r >= 8000 && r <= 48000)
        .unwrap_or(DEFAULT_PCM_SAMPLE_RATE)
}

/// 若服务端返回 WAV 容器则拆出 PCM16 与采样率。
fn normalize_pcm_bytes(bytes: Vec<u8>, header_rate: u32) -> Result<(Vec<u8>, u32), String> {
    if bytes.len() < 44 || &bytes[0..4] != b"RIFF" || &bytes[8..12] != b"WAVE" {
        return Ok((bytes, header_rate));
    }
    let mut rate = header_rate;
    let mut offset = 12usize;
    let mut pcm = Vec::new();
    while offset + 8 <= bytes.len() {
        let chunk = &bytes[offset..offset + 4];
        let size = u32::from_le_bytes(bytes[offset + 4..offset + 8].try_into().unwrap()) as usize;
        offset += 8;
        if offset + size > bytes.len() {
            break;
        }
        if chunk == b"fmt " && size >= 16 {
            rate = u32::from_le_bytes(bytes[offset + 4..offset + 8].try_into().unwrap());
        } else if chunk == b"data" {
            pcm.extend_from_slice(&bytes[offset..offset + size]);
        }
        offset += size + (size & 1);
    }
    if pcm.is_empty() {
        return Err("FastAPI 返回 WAV 但无法解析 data 块".into());
    }
    Ok((pcm, rate))
}

/// 组装 FastAPI 推理 multipart（与整包/流式共用）。
fn build_fastapi_multipart(
    base_url: &str,
    text: &str,
    prompt_wav_path: Option<&str>,
    prompt_text: Option<&str>,
    instruct: Option<&str>,
    spk_id: Option<&str>,
    model_dir: Option<&str>,
    fallback_prompt_wav: Option<&str>,
    fallback_prompt_text: Option<&str>,
) -> Result<(String, reqwest::blocking::multipart::Form), String> {
    let base = base_url.trim().trim_end_matches('/');
    if base.is_empty() {
        return Err("未配置 CosyVoice FastAPI Base URL".into());
    }
    let text = text.trim();
    if text.is_empty() || text.chars().count() > 20_000 {
        return Err("合成文本为空或过长".into());
    }

    let cv2 = is_cosyvoice2_model(model_dir);
    let instruct = instruct.unwrap_or("").trim();
    let mut prompt_wav = prompt_wav_path.unwrap_or("").trim().to_string();
    let mut prompt_txt = prompt_text.unwrap_or("").trim().to_string();
    let spk = spk_id.unwrap_or("中文女").trim();
    let fallback_wav = fallback_prompt_wav.unwrap_or("").trim();

    if prompt_wav.is_empty() {
        if !fallback_wav.is_empty() && Path::new(fallback_wav).is_file() {
            // CV1：默认女声 fallback 不当作「用户自有」参考音（避免全员克隆同一女声）
            if cv2 {
                prompt_wav = fallback_wav.to_string();
            }
        }
    } else if !cv2 && is_shared_or_sys_seed_wav(&prompt_wav, fallback_wav) {
        // CV1 sys 种子 / 与默认同一文件 → 改走 spk + instruct
        prompt_wav.clear();
        prompt_txt.clear();
    }
    if prompt_txt.is_empty() && !prompt_wav.is_empty() {
        if let Some(t) = fallback_prompt_text.map(str::trim).filter(|s| !s.is_empty()) {
            prompt_txt = t.to_string();
        } else {
            prompt_txt = if cv2 {
                cosy_discover::default_prompt_text_cv2().to_string()
            } else {
                cosy_discover::default_prompt_text_v1().to_string()
            };
        }
    }

    let wav_part = |wav_path: &str| -> Result<reqwest::blocking::multipart::Part, String> {
        let path = Path::new(wav_path);
        if !path.is_file() {
            return Err(format!("参考音频不存在：{wav_path}"));
        }
        let file_name = path
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("ref.wav");
        let bytes = std::fs::read(path).map_err(|e| format!("读取参考音频失败：{e}"))?;
        reqwest::blocking::multipart::Part::bytes(bytes)
            .file_name(file_name.to_string())
            .mime_str("audio/wav")
            .map_err(|e| e.to_string())
    };

    if !prompt_wav.is_empty() {
        let part = wav_part(&prompt_wav)?;
        if !instruct.is_empty() {
            let url = format!("{base}/inference_instruct2");
            let form = reqwest::blocking::multipart::Form::new()
                .text("tts_text", text.to_string())
                .text("instruct_text", instruct.to_string())
                .part("prompt_wav", part);
            return Ok((url, form));
        }
        let url = format!("{base}/inference_zero_shot");
        let form = reqwest::blocking::multipart::Form::new()
            .text("tts_text", text.to_string())
            .text("prompt_text", prompt_txt)
            .part("prompt_wav", part);
        return Ok((url, form));
    }
    if !instruct.is_empty() && !cv2 {
        let url = format!("{base}/inference_instruct");
        let form = reqwest::blocking::multipart::Form::new()
            .text("tts_text", text.to_string())
            .text("spk_id", spk.to_string())
            .text("instruct_text", instruct.to_string());
        return Ok((url, form));
    }
    if cv2 {
        return Err(
            "CosyVoice2/3 需要与当前性别匹配的参考音频。请到 Cosy 页选择音色库中的参考音，或重跑自动检测。"
                .into(),
        );
    }
    let url = format!("{base}/inference_sft");
    let form = reqwest::blocking::multipart::Form::new()
        .text("tts_text", text.to_string())
        .text("spk_id", spk.to_string());
    Ok((url, form))
}

fn fastapi_http_client() -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(5))
        .timeout(std::time::Duration::from_secs(120))
        .no_gzip()
        .no_deflate()
        .no_brotli()
        .build()
        .map_err(|e| e.to_string())
}

/// 调 inference_instruct2 / zero_shot / instruct，返回裸 PCM16 base64 + 采样率。
pub fn fastapi_pcm(
    base_url: &str,
    text: &str,
    prompt_wav_path: Option<&str>,
    prompt_text: Option<&str>,
    instruct: Option<&str>,
    spk_id: Option<&str>,
    model_dir: Option<&str>,
    fallback_prompt_wav: Option<&str>,
    fallback_prompt_text: Option<&str>,
) -> Result<FastapiPcmResult, String> {
    let client = fastapi_http_client()?;
    let (url, form) = build_fastapi_multipart(
        base_url,
        text,
        prompt_wav_path,
        prompt_text,
        instruct,
        spk_id,
        model_dir,
        fallback_prompt_wav,
        fallback_prompt_text,
    )?;

    let resp = client
        .post(&url)
        .multipart(form)
        .send()
        .map_err(|e| format!("FastAPI 请求失败：{e}"))?;
    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().unwrap_or_default();
        return Err(format!(
            "FastAPI {}：{}",
            status,
            body.chars().take(200).collect::<String>()
        ));
    }
    let header_rate = sample_rate_from_headers(resp.headers());
    let raw = read_http_body(resp)?;
    if raw.is_empty() {
        let tail = sidecar_log_tail(15);
        let mut msg = "FastAPI 返回空音频。CosyVoice2/3 需 zero_shot 参考音；请确认 sidecar 已用 server_xu.py 重启。".to_string();
        if !tail.is_empty() {
            msg.push_str("\n\nsidecar 日志尾部：\n");
            msg.push_str(&tail);
        }
        return Err(msg);
    }
    let (pcm, sample_rate) = normalize_pcm_bytes(raw, header_rate)?;
    if pcm.is_empty() {
        return Err("FastAPI 返回空 PCM".into());
    }
    Ok(FastapiPcmResult {
        pcm_base64: B64.encode(&pcm),
        sample_rate,
    })
}

/// 流式读取 FastAPI PCM：每收到一块偶数字节就回调（裸 PCM16；若整包是 WAV 则等齐后整段回调一次）。
///
/// 职责：边合成边推首包，降低开口延迟。失败返回 Err（调用方再发 error 事件）。
pub fn fastapi_pcm_stream(
    base_url: &str,
    text: &str,
    prompt_wav_path: Option<&str>,
    prompt_text: Option<&str>,
    instruct: Option<&str>,
    spk_id: Option<&str>,
    model_dir: Option<&str>,
    fallback_prompt_wav: Option<&str>,
    fallback_prompt_text: Option<&str>,
    mut on_pcm: impl FnMut(&[u8], u32),
) -> Result<u32, String> {
    let client = fastapi_http_client()?;
    let (url, form) = build_fastapi_multipart(
        base_url,
        text,
        prompt_wav_path,
        prompt_text,
        instruct,
        spk_id,
        model_dir,
        fallback_prompt_wav,
        fallback_prompt_text,
    )?;

    let resp = client
        .post(&url)
        .multipart(form)
        .send()
        .map_err(|e| format!("FastAPI 请求失败：{e}"))?;
    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().unwrap_or_default();
        return Err(format!(
            "FastAPI {}：{}",
            status,
            body.chars().take(200).collect::<String>()
        ));
    }
    let sample_rate = sample_rate_from_headers(resp.headers());
    let mut body = resp;
    let mut probe: Vec<u8> = Vec::with_capacity(64 * 1024);
    let mut buf = [0u8; 16 * 1024];
    let mut total_pcm = 0usize;

    // 先攒一点判断是否 WAV；server_xu 通常直接吐裸 PCM。
    while probe.len() < 44 {
        let n = body.read(&mut buf).map_err(|e| format!("读取 PCM 失败：{e}"))?;
        if n == 0 {
            break;
        }
        probe.extend_from_slice(&buf[..n]);
    }
    if probe.is_empty() {
        let tail = sidecar_log_tail(15);
        let mut msg = "FastAPI 返回空音频。CosyVoice2/3 需 zero_shot 参考音；请确认 sidecar 已用 server_xu.py 重启。".to_string();
        if !tail.is_empty() {
            msg.push_str("\n\nsidecar 日志尾部：\n");
            msg.push_str(&tail);
        }
        return Err(msg);
    }

    let is_wav = probe.len() >= 12 && &probe[0..4] == b"RIFF" && &probe[8..12] == b"WAVE";
    if is_wav {
        // WAV：继续读完再拆（少见路径；避免半截 header）
        loop {
            let n = body.read(&mut buf).map_err(|e| format!("读取 PCM 失败：{e}"))?;
            if n == 0 {
                break;
            }
            probe.extend_from_slice(&buf[..n]);
        }
        let (pcm, rate) = normalize_pcm_bytes(probe, sample_rate)?;
        if pcm.is_empty() {
            return Err("FastAPI 返回空 PCM".into());
        }
        on_pcm(&pcm, rate);
        return Ok(rate);
    }

    // 裸 PCM16：奇数末字节滚到下一包
    let mut carry: Option<u8> = None;
    let mut emit_aligned = |chunk: &[u8]| {
        let mut work = Vec::with_capacity(chunk.len() + 1);
        if let Some(c) = carry.take() {
            work.push(c);
        }
        work.extend_from_slice(chunk);
        if work.len() % 2 == 1 {
            carry = work.pop();
        }
        if !work.is_empty() {
            total_pcm += work.len();
            on_pcm(&work, sample_rate);
        }
    };
    emit_aligned(&probe);
    loop {
        let n = body.read(&mut buf).map_err(|e| format!("读取 PCM 失败：{e}"))?;
        if n == 0 {
            break;
        }
        emit_aligned(&buf[..n]);
    }
    if total_pcm == 0 {
        return Err("FastAPI 返回空 PCM".into());
    }
    Ok(sample_rate)
}

