//! CosyVoice 三后端合成：local / DashScope / customHttp。
//!
//! @author qiuye <yjk150@qq.com>
//! @date 2026-08-31
//! @updated 2026-09-03
//! @version 1.1.0
//! @category Stream
//! @algo cosyvoice-triple-backend-synth

use serde::{Deserialize, Serialize};
use std::fs::File;
use std::io::Write;
use std::path::PathBuf;

use crate::desktop_db::{self, FouDb};

/// 合成请求（与 MCP / 前端契约一致）。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CosySynthRequest {
    pub text: String,
    #[serde(default)]
    pub instruct: String,
    #[serde(default)]
    pub emotion: String,
    #[serde(default)]
    pub voice: String,
    /// local | dashscope | customHttp
    pub backend: String,
    #[serde(default)]
    pub dashscope_model: String,
    #[serde(default)]
    pub dashscope_voice: String,
    #[serde(default)]
    pub custom_base_url: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CosyBackendProbe {
    pub backend: String,
    pub ready: bool,
    pub reason: String,
}

const DASHSCOPE_KEY_ENV: &str = "XU_COSYVOICE_DASHSCOPE_API_KEY";
const CUSTOM_KEY_ENV: &str = "XU_COSYVOICE_CUSTOM_HTTP_API_KEY";
const DASHSCOPE_URL: &str =
    "https://dashscope.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer";

fn cosy_home() -> Result<PathBuf, String> {
    let p = crate::xu_paths::xu_home()?.join("cosyvoice");
    std::fs::create_dir_all(&p).map_err(|e| format!("无法创建 cosyvoice 目录: {e}"))?;
    Ok(p)
}

fn install_json() -> Result<serde_json::Value, String> {
    let path = cosy_home()?.join("install.json");
    if !path.is_file() {
        return Ok(serde_json::json!({}));
    }
    let raw = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&raw).map_err(|e| format!("install.json 损坏: {e}"))
}

fn local_phase_ready() -> bool {
    install_json()
        .ok()
        .and_then(|v| v.get("phase").and_then(|p| p.as_str()).map(|s| s == "ready"))
        .unwrap_or(false)
}

fn local_endpoint() -> Option<String> {
    install_json()
        .ok()
        .and_then(|v| {
            v.get("endpoint")
                .and_then(|e| e.as_str())
                .map(|s| s.trim().to_string())
        })
        .filter(|s| !s.is_empty())
}

fn resolve_key(db: &FouDb, env: &str) -> Result<String, String> {
    let conn = db.0.lock().map_err(|_| "数据库锁异常".to_string())?;
    Ok(desktop_db::resolve_api_key(env, Some(&conn)).unwrap_or_default())
}

fn probe_dashscope_live(db: &FouDb) -> Result<CosyBackendProbe, String> {
    let key = resolve_key(db, DASHSCOPE_KEY_ENV)?;
    if key.trim().is_empty() {
        return Ok(CosyBackendProbe {
            backend: "dashscope".into(),
            ready: false,
            reason: "未配置阿里云语音密钥。".into(),
        });
    }
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(6))
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client
        .get("https://dashscope.aliyuncs.com/compatible-mode/v1/models")
        .bearer_auth(key.trim())
        .send();
    match resp {
        Ok(r) if r.status().is_success() => Ok(CosyBackendProbe {
            backend: "dashscope".into(),
            ready: true,
            reason: "阿里云密钥可用。云端合成整段后再播，不是边合边播。".into(),
        }),
        Ok(r) if r.status().as_u16() == 401 || r.status().as_u16() == 403 => {
            Ok(CosyBackendProbe {
                backend: "dashscope".into(),
                ready: false,
                reason: "阿里云密钥无效或无权限。".into(),
            })
        }
        Ok(r) => Ok(CosyBackendProbe {
            backend: "dashscope".into(),
            ready: false,
            reason: format!("阿里云探测失败（HTTP {}）。", r.status().as_u16()),
        }),
        Err(_) => Ok(CosyBackendProbe {
            backend: "dashscope".into(),
            ready: false,
            reason: "无法连接阿里云语音服务，请检查网络后重试。".into(),
        }),
    }
}

/// 探测所选后端是否可合成。
pub fn probe_backend(db: &FouDb, backend: &str) -> Result<CosyBackendProbe, String> {
    let backend = backend.trim();
    match backend {
        "local" => {
            if local_phase_ready() {
                Ok(CosyBackendProbe {
                    backend: "local".into(),
                    ready: true,
                    reason: if local_endpoint().is_some() {
                        "本地 CosyVoice 已安装且配置了合成端点。".into()
                    } else {
                        "本地 CosyVoice phase=ready（将走本机 conda 短合成）。".into()
                    },
                })
            } else {
                Ok(CosyBackendProbe {
                    backend: "local".into(),
                    ready: false,
                    reason: "尚未完成本地协助安装（phase 非 ready）。".into(),
                })
            }
        }
        "dashscope" => probe_dashscope_live(db),
        "customHttp" => Ok(CosyBackendProbe {
            backend: "customHttp".into(),
            ready: false,
            reason: "请填写自建 Base URL 并点「探测」。".into(),
        }),
        "fastapi" => {
            let (ready, reason) =
                crate::voice::cosy_fastapi::probe_fastapi(DEFAULT_FASTAPI_BASE_URL)?;
            Ok(CosyBackendProbe {
                backend: "fastapi".into(),
                ready,
                reason,
            })
        }
        _ => Ok(CosyBackendProbe {
            backend: backend.into(),
            ready: false,
            reason: "未知 Cosy 后端。".into(),
        }),
    }
}

/// 探测自建 URL（HEAD/GET /health 或 POST 空校验）。
pub fn probe_custom_url(base_url: &str, api_key: &str) -> Result<CosyBackendProbe, String> {
    let base = base_url.trim().trim_end_matches('/');
    if base.is_empty() || !(base.starts_with("http://") || base.starts_with("https://")) {
        return Ok(CosyBackendProbe {
            backend: "customHttp".into(),
            ready: false,
            reason: "请填写合法的 http(s) Base URL。".into(),
        });
    }
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(8))
        .build()
        .map_err(|e| e.to_string())?;
    let health = format!("{base}/health");
    let mut req = client.get(&health);
    if !api_key.is_empty() {
        req = req.bearer_auth(api_key);
    }
    match req.send() {
        Ok(resp) if resp.status().is_success() || resp.status().as_u16() == 404 => {
            Ok(CosyBackendProbe {
                backend: "customHttp".into(),
                ready: true,
                reason: "自建端点可连通。".into(),
            })
        }
        Ok(resp) => Ok(CosyBackendProbe {
            backend: "customHttp".into(),
            ready: resp.status().as_u16() < 500,
            reason: format!("探测返回 HTTP {}", resp.status().as_u16()),
        }),
        Err(e) => Ok(CosyBackendProbe {
            backend: "customHttp".into(),
            ready: false,
            reason: format!("无法连接自建端点：{}", summarize(&e.to_string())),
        }),
    }
}

/// 合成到临时 WAV，返回路径。
pub fn synthesize(db: &FouDb, req: CosySynthRequest) -> Result<PathBuf, String> {
    let text = req.text.trim();
    if text.is_empty() || text.chars().count() > 20_000 {
        return Err("合成文本为空或过长".into());
    }
    match req.backend.as_str() {
        "dashscope" => synth_dashscope(db, &req),
        "customHttp" => {
            let key = resolve_key(db, CUSTOM_KEY_ENV).unwrap_or_default();
            synth_http_contract(req.custom_base_url.trim(), &key, &req)
        }
        "local" => {
            if let Some(ep) = local_endpoint() {
                synth_http_contract(&ep, "", &req)
            } else if local_phase_ready() {
                synth_local_conda(&req)
            } else {
                Err("本地 CosyVoice 未就绪，请协助安装或改用 DashScope / 自建 URL".into())
            }
        }
        _ => Err("未知 Cosy 后端".into()),
    }
}

fn synth_dashscope(db: &FouDb, req: &CosySynthRequest) -> Result<PathBuf, String> {
    let key = resolve_key(db, DASHSCOPE_KEY_ENV)?;
    if key.trim().is_empty() {
        return Err("未配置 DashScope API Key".into());
    }
    let model = if req.dashscope_model.trim().is_empty() {
        "cosyvoice-v3-flash"
    } else {
        req.dashscope_model.trim()
    };
    let voice = if req.dashscope_voice.trim().is_empty() {
        "longanyang"
    } else {
        req.dashscope_voice.trim()
    };
    let mut input = serde_json::json!({
        "text": req.text,
        "voice": voice,
        "format": "wav",
        "sample_rate": 24000,
    });
    if !req.instruct.trim().is_empty() {
        input["instruction"] = serde_json::Value::String(req.instruct.clone());
    }
    let body = serde_json::json!({
        "model": model,
        "input": input,
    });
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client
        .post(DASHSCOPE_URL)
        .bearer_auth(key.trim())
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .map_err(|e| format!("DashScope 网络错误：{}", summarize(&e.to_string())))?;
    if !resp.status().is_success() {
        let status = resp.status();
        let t = resp.text().unwrap_or_default();
        return Err(format!(
            "DashScope 合成失败（HTTP {}）：{}",
            status.as_u16(),
            summarize(&t)
        ));
    }
    let bytes = resp.bytes().map_err(|e| e.to_string())?;
    // 若返回 JSON 含 audio url / base64
    if bytes.starts_with(b"{") {
        let v: serde_json::Value =
            serde_json::from_slice(&bytes).map_err(|e| format!("DashScope 响应解析失败: {e}"))?;
        if let Some(b64) = v
            .pointer("/output/audio/data")
            .or_else(|| v.pointer("/output/audio"))
            .and_then(|x| x.as_str())
        {
            return write_b64_wav(b64);
        }
        if let Some(url) = v
            .pointer("/output/audio/url")
            .or_else(|| v.pointer("/output/url"))
            .and_then(|x| x.as_str())
        {
            return download_to_temp(url);
        }
        return Err(format!(
            "DashScope 响应无音频字段：{}",
            summarize(&String::from_utf8_lossy(&bytes))
        ));
    }
    write_bytes_wav(&bytes)
}

/// 自建 / 本地 sidecar 统一契约：POST {base}/synthesize
fn synth_http_contract(base: &str, api_key: &str, req: &CosySynthRequest) -> Result<PathBuf, String> {
    let base = base.trim().trim_end_matches('/');
    if base.is_empty() {
        return Err("合成端点为空".into());
    }
    let url = format!("{base}/synthesize");
    let body = serde_json::json!({
        "text": req.text,
        "instruct": req.instruct,
        "emotion": req.emotion,
        "voice": req.voice,
    });
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(180))
        .build()
        .map_err(|e| e.to_string())?;
    let mut builder = client.post(&url).json(&body);
    if !api_key.is_empty() {
        builder = builder.bearer_auth(api_key);
    }
    let resp = builder
        .send()
        .map_err(|e| format!("合成请求失败：{}", summarize(&e.to_string())))?;
    if !resp.status().is_success() {
        let status = resp.status();
        let t = resp.text().unwrap_or_default();
        return Err(format!(
            "合成失败（HTTP {}）：{}",
            status.as_u16(),
            summarize(&t)
        ));
    }
    let ctype = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    let bytes = resp.bytes().map_err(|e| e.to_string())?;
    if ctype.contains("json") || bytes.starts_with(b"{") {
        let v: serde_json::Value =
            serde_json::from_slice(&bytes).map_err(|e| format!("合成 JSON 解析失败: {e}"))?;
        if let Some(path) = v.get("wavPath").or_else(|| v.get("path")).and_then(|x| x.as_str()) {
            let p = PathBuf::from(path);
            if p.is_file() {
                return Ok(p);
            }
        }
        if let Some(b64) = v.get("audioBase64").or_else(|| v.get("base64")).and_then(|x| x.as_str())
        {
            return write_b64_wav(b64);
        }
        return Err("合成 JSON 缺少 wavPath / audioBase64".into());
    }
    write_bytes_wav(&bytes)
}

fn synth_local_conda(req: &CosySynthRequest) -> Result<PathBuf, String> {
    use super::cosy_runner::{python_exe, run_cmd};
    use std::sync::atomic::AtomicBool;

    let _ = req;
    let root = install_json()?
        .get("installRoot")
        .and_then(|x| x.as_str())
        .map(PathBuf::from)
        .filter(|p| p.is_dir())
        .ok_or_else(|| "install.json 缺少 installRoot".to_string())?;
    let log = cosy_home()?.join("synth.log");
    let cancel = AtomicBool::new(false);
    let py = python_exe(&root);
    match run_cmd(
        &py.to_string_lossy(),
        &["-c", "import sys; print('local-cosy-env-ok'); sys.exit(0)"],
        None,
        &cancel,
        &log,
    ) {
        Ok(_) => Err(
            "本地 CosyVoice 已安装，但尚未配置合成端点。请在 install.json 写入 endpoint（本机 HTTP /synthesize），或改用 DashScope / 自建 URL。"
                .into(),
        ),
        Err(e) => Err(format!("本地 Cosy 环境不可用：{}", summarize(&e))),
    }
}

fn write_b64_wav(b64: &str) -> Result<PathBuf, String> {
    use base64::Engine;
    let raw = b64.split(',').last().unwrap_or(b64).trim();
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(raw)
        .map_err(|e| format!("音频 base64 无效: {e}"))?;
    write_bytes_wav(&bytes)
}

fn write_bytes_wav(bytes: &[u8]) -> Result<PathBuf, String> {
    let dir = std::env::temp_dir().join("xu-voice");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(format!("{}.wav", uuid::Uuid::new_v4()));
    let mut f = File::create(&path).map_err(|e| e.to_string())?;
    f.write_all(bytes).map_err(|e| e.to_string())?;
    Ok(path)
}

fn download_to_temp(url: &str) -> Result<PathBuf, String> {
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| e.to_string())?;
    let bytes = client
        .get(url)
        .send()
        .map_err(|e| format!("下载音频失败：{}", summarize(&e.to_string())))?
        .bytes()
        .map_err(|e| e.to_string())?;
    write_bytes_wav(&bytes)
}

fn summarize(s: &str) -> String {
    s.chars().take(180).collect()
}

const DEFAULT_FASTAPI_BASE_URL: &str = "http://127.0.0.1:50000";

/// 任一后端是否可能可用（供 engine_status）。
pub fn any_backend_ready(db: &FouDb, preferred: &str, custom_url: &str) -> bool {
    match preferred {
        "dashscope" => probe_backend(db, "dashscope")
            .map(|p| p.ready)
            .unwrap_or(false),
        "customHttp" => {
            let key = resolve_key(db, CUSTOM_KEY_ENV).unwrap_or_default();
            probe_custom_url(custom_url, &key)
                .map(|p| p.ready)
                .unwrap_or(false)
        }
        "fastapi" => {
            let url = custom_url.trim();
            let url = if url.is_empty() {
                DEFAULT_FASTAPI_BASE_URL
            } else {
                url
            };
            crate::voice::cosy_fastapi::probe_fastapi(url)
                .map(|(ok, _)| ok)
                .unwrap_or(false)
        }
        _ => local_phase_ready(),
    }
}
