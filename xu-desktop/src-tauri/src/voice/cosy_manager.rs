//! CosyVoice 本地控制台后端（替代 tools/console/manager.py）：启停 sidecar、日志、模型列表、want-running。
//!
//! @author qiuye <yjk150@qq.com>
//! @date 2026-09-01
//! @updated 2026-09-01
//! @version 1.1.0
//! @category Config
//! @algo sidecar-state-log-tail

use serde::{Deserialize, Serialize};
use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::process::Command;
use std::time::Instant;

use super::cosy_discover;
use super::cosy_fastapi::{self, CosySidecarStatus};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SidecarStateFile {
    pid: u32,
    port: u16,
    model: String,
    started_at: f64,
}

fn cosyvoice_home() -> Result<PathBuf, String> {
    let p = crate::xu_paths::xu_home()?.join("cosyvoice");
    std::fs::create_dir_all(&p).map_err(|e| format!("无法创建 cosyvoice 目录: {e}"))?;
    Ok(p)
}

fn state_path() -> Result<PathBuf, String> {
    Ok(cosyvoice_home()?.join("sidecar-state.json"))
}

fn want_running_path() -> Result<PathBuf, String> {
    Ok(cosyvoice_home()?.join("want-running.json"))
}

fn log_path() -> Result<PathBuf, String> {
    Ok(cosyvoice_home()?.join("sidecar.log"))
}

/// 用户希望 Cosy FastAPI 自动拉起的标记（退出杀进程后下次自检用）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WantRunningFile {
    pub want: bool,
    pub port: u16,
    pub model: String,
    pub python: String,
    pub server_script: String,
    pub extra_args: String,
}

/// 登录自检 bootstrap 结果。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CosyBootstrapResult {
    pub attempted: bool,
    pub running: bool,
    pub pid: Option<u32>,
    pub message: String,
}

/// 读取 want-running 标记。
pub fn read_want_running() -> Option<WantRunningFile> {
    let path = want_running_path().ok()?;
    let text = std::fs::read_to_string(&path).ok()?;
    serde_json::from_str(&text).ok()
}

/// 写入或更新 want-running（启动成功 want=true；用户停止 want=false）。
pub fn write_want_running(file: &WantRunningFile) -> Result<(), String> {
    let path = want_running_path()?;
    let text = serde_json::to_string_pretty(file).map_err(|e| e.to_string())?;
    std::fs::write(&path, text).map_err(|e| format!("无法写入 want-running：{e}"))
}

/// 仅将 want 置为 false，保留上次路径便于下次手动启。
pub fn clear_want_flag() -> Result<(), String> {
    let mut cur = read_want_running().unwrap_or(WantRunningFile {
        want: false,
        port: 50000,
        model: String::new(),
        python: String::new(),
        server_script: String::new(),
        extra_args: String::new(),
    });
    cur.want = false;
    write_want_running(&cur)
}

/// 自检：释放端口；若 want 且路径齐则 console_start。
/// `overrides` 可补齐/覆盖 want-running 中的路径（前端 localStorage 兜底）。
pub fn bootstrap(overrides: Option<&WantRunningFile>) -> CosyBootstrapResult {
    let mut want = read_want_running();
    if let Some(o) = overrides {
        match &mut want {
            Some(w) => {
                if o.want {
                    w.want = true;
                }
                if o.port > 0 {
                    w.port = o.port;
                }
                if !o.python.trim().is_empty() {
                    w.python = o.python.clone();
                }
                if !o.server_script.trim().is_empty() {
                    w.server_script = o.server_script.clone();
                }
                if !o.model.trim().is_empty() {
                    w.model = o.model.clone();
                }
                if !o.extra_args.trim().is_empty() {
                    w.extra_args = o.extra_args.clone();
                }
            }
            None if o.want => {
                want = Some(o.clone());
            }
            None => {}
        }
    }
    let port = want.as_ref().map(|w| w.port).filter(|p| *p > 0).unwrap_or(50000);
    cosy_fastapi::free_port(port);
    let Some(w) = want else {
        return CosyBootstrapResult {
            attempted: false,
            running: false,
            pid: None,
            message: "未配置自动启动".into(),
        };
    };
    if !w.want {
        return CosyBootstrapResult {
            attempted: false,
            running: false,
            pid: None,
            message: "已跳过（用户曾停止）".into(),
        };
    }
    if w.python.trim().is_empty() || w.server_script.trim().is_empty() || w.model.trim().is_empty() {
        return CosyBootstrapResult {
            attempted: false,
            running: false,
            pid: None,
            message: "未配置路径（Python / server / model）".into(),
        };
    }
    // 持久化合并后的路径，供下次冷启动
    let _ = write_want_running(&WantRunningFile {
        want: true,
        port,
        model: w.model.clone(),
        python: w.python.clone(),
        server_script: w.server_script.clone(),
        extra_args: w.extra_args.clone(),
    });
    match console_start(
        &w.python,
        &w.server_script,
        &w.model,
        port,
        &w.extra_args,
    ) {
        Ok(st) => CosyBootstrapResult {
            attempted: true,
            running: st.running,
            pid: st.pid,
            message: if st.running {
                format!("已自动启动（pid {}）", st.pid.unwrap_or(0))
            } else if !st.last_error.is_empty() {
                st.last_error
            } else {
                "启动未进入运行态".into()
            },
        },
        Err(e) => CosyBootstrapResult {
            attempted: true,
            running: false,
            pid: None,
            message: e,
        },
    }
}

fn read_state() -> Option<SidecarStateFile> {
    let path = state_path().ok()?;
    let text = std::fs::read_to_string(&path).ok()?;
    serde_json::from_str(&text).ok()
}

fn write_state(st: &SidecarStateFile) -> Result<(), String> {
    let path = state_path()?;
    let text = serde_json::to_string_pretty(st).map_err(|e| e.to_string())?;
    std::fs::write(path, text).map_err(|e| format!("写 sidecar 状态失败: {e}"))
}

fn clear_state() {
    if let Ok(p) = state_path() {
        let _ = std::fs::remove_file(p);
    }
}

#[cfg(windows)]
fn pid_alive(pid: u32) -> bool {
    if pid == 0 {
        return false;
    }
    let Ok(out) = Command::new("tasklist")
        .args(["/FI", &format!("PID eq {pid}")])
        .output()
    else {
        return false;
    };
    let data = String::from_utf8_lossy(&out.stdout);
    data.contains(&pid.to_string())
}

#[cfg(not(windows))]
fn pid_alive(pid: u32) -> bool {
    if pid == 0 {
        return false;
    }
    Command::new("kill")
        .args(["-0", &pid.to_string()])
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

fn models_root_from_discover() -> Option<PathBuf> {
    let cache = cosy_discover::discover_from_cache()?;
    if let Some(model) = cache.model_dir.as_ref() {
        let p = PathBuf::from(model);
        if let Some(parent) = p.parent() {
            if parent.is_dir() {
                return Some(parent.to_path_buf());
            }
        }
    }
    if !cache.scan_root.is_empty() {
        let root = PathBuf::from(&cache.scan_root);
        for rel in [
            "CosyVoice/pretrained_models",
            "pretrained_models",
            "models",
        ] {
            let p = root.join(rel);
            if p.is_dir() {
                return Some(p);
            }
        }
    }
    None
}

/// 列出 scan_root 下可选 model 目录名。
pub fn list_models() -> Vec<String> {
    let Some(root) = models_root_from_discover() else {
        return Vec::new();
    };
    let Ok(rd) = std::fs::read_dir(&root) else {
        return Vec::new();
    };
    let mut names: Vec<String> = rd
        .flatten()
        .filter_map(|e| {
            let p = e.path();
            if p.is_dir() {
                p.file_name()?.to_str().map(String::from)
            } else {
                None
            }
        })
        .collect();
    names.sort();
    names
}

fn resolve_model_dir(model: &str) -> Result<PathBuf, String> {
    let model = model.trim();
    if model.is_empty() {
        return Err("请选择模型".into());
    }
    let p = PathBuf::from(model);
    if p.is_absolute() && p.is_dir() {
        return Ok(p);
    }
    let root = models_root_from_discover().ok_or_else(|| "未找到 pretrained_models 目录".to_string())?;
    let hit = root.join(model);
    if hit.is_dir() {
        Ok(hit)
    } else {
        Err(format!("找不到模型目录：{}", hit.display()))
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConsoleEnv {
    pub scan_root: String,
    pub python: Option<String>,
    pub server_script: Option<String>,
    pub model_root: Option<String>,
    pub log_file: String,
    pub voices_root: Option<String>,
    pub default_prompt_wav: Option<String>,
    pub default_prompt_text: Option<String>,
    pub cosy_voice2: bool,
}

/// 控制台环境路径（来自 discover 缓存）。
pub fn console_env() -> ConsoleEnv {
    let cache = cosy_discover::discover_from_cache();
    let log = log_path().unwrap_or_default();
    let cv2 = cache
        .as_ref()
        .and_then(|c| c.model_dir.as_deref())
        .map(|m| cosy_discover::is_cosyvoice2_model(Some(m)))
        .unwrap_or(false);
    ConsoleEnv {
        scan_root: cache
            .as_ref()
            .map(|c| c.scan_root.clone())
            .unwrap_or_default(),
        python: cache.as_ref().and_then(|c| c.python.clone()),
        server_script: cache.as_ref().and_then(|c| c.server_script.clone()),
        model_root: models_root_from_discover().map(|p| p.to_string_lossy().into_owned()),
        log_file: log.to_string_lossy().into_owned(),
        voices_root: cache.as_ref().and_then(|c| c.voices_root.clone()),
        default_prompt_wav: cache.as_ref().and_then(|c| c.default_prompt_wav.clone()),
        default_prompt_text: cache.as_ref().and_then(|c| c.default_prompt_text.clone()),
        cosy_voice2: cv2,
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConsoleProbe {
    pub ok: bool,
    pub latency_ms: Option<u64>,
    pub message: String,
}

/// 探测 FastAPI 连通与延迟。
pub fn probe_base(base_url: &str) -> ConsoleProbe {
    let base = base_url.trim().trim_end_matches('/');
    if base.is_empty() {
        return ConsoleProbe {
            ok: false,
            latency_ms: None,
            message: "请填写服务地址".into(),
        };
    }
    let client = match reqwest::blocking::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(2))
        .timeout(std::time::Duration::from_secs(5))
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            return ConsoleProbe {
                ok: false,
                latency_ms: None,
                message: e.to_string(),
            };
        }
    };
    let url = format!("{base}/openapi.json");
    let t0 = Instant::now();
    match client.get(&url).send() {
        Ok(r) if r.status().is_success() => ConsoleProbe {
            ok: true,
            latency_ms: Some(t0.elapsed().as_millis() as u64),
            message: "FastAPI sidecar 可访问".into(),
        },
        Ok(r) => ConsoleProbe {
            ok: false,
            latency_ms: Some(t0.elapsed().as_millis() as u64),
            message: format!("HTTP {}", r.status()),
        },
        Err(e) => ConsoleProbe {
            ok: false,
            latency_ms: None,
            message: format!("无法连接：{e}"),
        },
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConsoleStatus {
    pub running: bool,
    pub healthy: bool,
    pub pid: Option<u32>,
    pub port: u16,
    pub model: String,
    pub models: Vec<String>,
    pub probe: ConsoleProbe,
}

/// 综合 sidecar 进程状态 + FastAPI 健康探测。
pub fn console_status(base_url: &str, port: u16) -> ConsoleStatus {
    let st = cosy_fastapi::sidecar_status().unwrap_or(CosySidecarStatus {
        running: false,
        pid: None,
        last_error: String::new(),
    });
    let file = read_state();
    let pid = st.pid.or_else(|| file.as_ref().map(|f| f.pid));
    let running = st.running
        || pid.map(pid_alive).unwrap_or(false)
        || probe_base(base_url).ok;
    let probe = probe_base(base_url);
    let healthy = probe.ok;
    ConsoleStatus {
        running,
        healthy,
        pid,
        port: file.as_ref().map(|f| f.port).unwrap_or(port),
        model: file
            .as_ref()
            .map(|f| f.model.clone())
            .unwrap_or_default(),
        models: list_models(),
        probe,
    }
}

fn open_log_append() -> Result<File, String> {
    let path = log_path()?;
    OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| format!("无法打开日志：{e}"))
}

/// 启动 FastAPI sidecar 并写日志/状态（替代 manager /api/start）。
pub fn console_start(
    python: &str,
    server_script: &str,
    model: &str,
    port: u16,
    extra_args: &str,
) -> Result<CosySidecarStatus, String> {
    let model_dir = resolve_model_dir(model)?;
    let st = cosy_fastapi::sidecar_status()?;
    if st.running {
        return Ok(st);
    }
    let _ = open_log_append()?;
    // 清掉占用端口的旧 server.py（Rust 重启后 Child 丢失、孤儿进程仍监听时常见）
    cosy_fastapi::free_port(port);
    if let Some(file) = read_state() {
        if pid_alive(file.pid) {
            kill_pid_tree(file.pid);
        }
    }
    clear_state();
    let model_str = model_dir.to_string_lossy().into_owned();
    let out = sidecar_start_with_log(python, server_script, &model_str, extra_args, port)?;
    write_state(&SidecarStateFile {
        pid: out.pid.unwrap_or(0),
        port,
        model: model.to_string(),
        started_at: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs_f64())
            .unwrap_or(0.0),
    })?;
    Ok(out)
}

fn sidecar_start_with_log(
    python: &str,
    server_script: &str,
    model_dir: &str,
    extra_args: &str,
    port: u16,
) -> Result<CosySidecarStatus, String> {
    use super::cosy_fastapi;
    // 复用 sidecar_start；日志由 Python 进程 stderr 写入 sidecar.log 需改 cosy_fastapi — 此处先启动再追加一行
    let st = cosy_fastapi::sidecar_start(python, server_script, model_dir, extra_args, port)?;
    if let Ok(mut f) = open_log_append() {
        let _ = writeln!(
            f,
            "[xu] sidecar started pid={:?} port={port} model={model_dir}",
            st.pid
        );
    }
    Ok(st)
}

#[cfg(not(windows))]
fn kill_pid_tree(pid: u32) {
    let _ = Command::new("kill")
        .args(["-9", &pid.to_string()])
        .status();
}

#[cfg(windows)]
fn kill_pid_tree(pid: u32) {
    let _ = Command::new("taskkill")
        .args(["/F", "/T", "/PID", &pid.to_string()])
        .output();
}

/// 停止 sidecar（替代 manager /api/stop）。
pub fn console_stop() -> Result<CosySidecarStatus, String> {
    let file = read_state();
    let port = file.as_ref().map(|f| f.port).unwrap_or(50000);
    let st = cosy_fastapi::sidecar_stop()?;
    if let Some(f) = file {
        if pid_alive(f.pid) {
            kill_pid_tree(f.pid);
        }
    }
    cosy_fastapi::free_port(port);
    clear_state();
    if let Ok(mut f) = open_log_append() {
        let _ = writeln!(f, "[xu] sidecar stopped");
    }
    Ok(st)
}

/// 重启 sidecar。
pub fn console_restart(
    python: &str,
    server_script: &str,
    model: &str,
    port: u16,
    extra_args: &str,
) -> Result<CosySidecarStatus, String> {
    let _ = console_stop();
    std::thread::sleep(std::time::Duration::from_millis(800));
    console_start(python, server_script, model, port, extra_args)
}

/// 读取 sidecar 日志尾部。
pub fn tail_log(lines: usize) -> Result<Vec<String>, String> {
    let path = log_path()?;
    if !path.is_file() {
        return Ok(Vec::new());
    }
    let text = cosy_fastapi::read_log_file_lossy(&path);
    let all: Vec<&str> = text.lines().collect();
    let n = lines.min(all.len());
    Ok(all[all.len().saturating_sub(n)..]
        .iter()
        .map(|s| s.to_string())
        .collect())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveVoicePresetInput {
    pub voices_root: String,
    pub id: String,
    pub name: String,
    pub prompt_text: String,
    pub instruct: String,
    pub wav_path: String,
}

/// 将参考音频复制到音色库目录（sample.wav + prompt.txt）。
pub fn save_voice_preset(input: &SaveVoicePresetInput) -> Result<(), String> {
    let root = PathBuf::from(input.voices_root.trim());
    if !root.is_dir() {
        return Err("音色库根目录不存在".into());
    }
    let id = input.id.trim();
    if id.is_empty() || id.contains("..") || id.contains('/') || id.contains('\\') {
        return Err("音色 ID 不合法".into());
    }
    let dir = root.join(id);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let src = PathBuf::from(input.wav_path.trim());
    if !src.is_file() {
        return Err("参考音频不存在".into());
    }
    std::fs::copy(&src, dir.join("sample.wav")).map_err(|e| format!("复制 wav 失败: {e}"))?;
    std::fs::write(dir.join("prompt.txt"), input.prompt_text.trim())
        .map_err(|e| e.to_string())?;
    if !input.instruct.trim().is_empty() {
        std::fs::write(dir.join("instruct.txt"), input.instruct.trim())
            .map_err(|e| e.to_string())?;
    }
    let _ = input.name.trim();
    Ok(())
}

/// 删除音色库子目录。
pub fn delete_voice_preset(voices_root: &str, id: &str) -> Result<(), String> {
    let root = PathBuf::from(voices_root.trim());
    let id = id.trim();
    if id.is_empty() || id.contains("..") || id.contains('/') || id.contains('\\') {
        return Err("音色 ID 不合法".into());
    }
    let dir = root.join(id);
    if dir.is_dir() {
        std::fs::remove_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemVoiceSeed {
    pub id: String,
    pub name: String,
    pub prompt_text: String,
    pub instruct: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnsureSystemVoicesResult {
    pub created: Vec<String>,
    pub skipped: Vec<String>,
}

/// 用默认参考音为系统音色目录补齐 sample.wav / prompt.txt / instruct.txt（不覆盖已有）。
pub fn ensure_system_voices(
    voices_root: &str,
    default_prompt_wav: &str,
    default_prompt_text: &str,
    seeds: &[SystemVoiceSeed],
) -> Result<EnsureSystemVoicesResult, String> {
    let root = PathBuf::from(voices_root.trim());
    if voices_root.trim().is_empty() {
        return Err("音色库根目录未配置".into());
    }
    std::fs::create_dir_all(&root).map_err(|e| format!("创建音色库失败: {e}"))?;
    let wav = PathBuf::from(default_prompt_wav.trim());
    if !wav.is_file() {
        return Err("默认参考音不存在，请先完成 Cosy 探测".into());
    }
    let fallback_prompt = if default_prompt_text.trim().is_empty() {
        "希望你以后能够做的比我还好呦。"
    } else {
        default_prompt_text.trim()
    };
    let mut created = Vec::new();
    let mut skipped = Vec::new();
    for seed in seeds {
        let id = seed.id.trim();
        if id.is_empty() || id.contains("..") || id.contains('/') || id.contains('\\') {
            continue;
        }
        let dir = root.join(id);
        let sample = dir.join("sample.wav");
        if sample.is_file() {
            skipped.push(id.to_string());
            continue;
        }
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        std::fs::copy(&wav, &sample).map_err(|e| format!("复制 wav 失败 ({id}): {e}"))?;
        let prompt = if seed.prompt_text.trim().is_empty() {
            fallback_prompt
        } else {
            seed.prompt_text.trim()
        };
        std::fs::write(dir.join("prompt.txt"), prompt).map_err(|e| e.to_string())?;
        if !seed.instruct.trim().is_empty() {
            std::fs::write(dir.join("instruct.txt"), seed.instruct.trim())
                .map_err(|e| e.to_string())?;
        }
        let name = seed.name.trim();
        if !name.is_empty() {
            let _ = std::fs::write(dir.join("name.txt"), name);
        }
        created.push(id.to_string());
    }
    Ok(EnsureSystemVoicesResult { created, skipped })
}

/// 默认系统音色库：`{XU_HOME}/cosyvoice/voices`（不存在则创建）。
pub fn default_voices_root() -> Result<String, String> {
    let p = crate::xu_paths::xu_home()?.join("cosyvoice").join("voices");
    std::fs::create_dir_all(&p).map_err(|e| format!("创建音色库失败: {e}"))?;
    Ok(p.to_string_lossy().into_owned())
}

/// 解析入库用路径：空 voices_root → XU_HOME 默认库；空 wav → discover 缓存。
pub fn resolve_seed_paths(
    voices_root: &str,
    default_prompt_wav: &str,
) -> Result<(String, String), String> {
    let root = if voices_root.trim().is_empty() {
        default_voices_root()?
    } else {
        let p = PathBuf::from(voices_root.trim());
        std::fs::create_dir_all(&p).map_err(|e| format!("创建音色库失败: {e}"))?;
        p.to_string_lossy().into_owned()
    };
    let wav = if default_prompt_wav.trim().is_empty() {
        cosy_discover::discover_from_cache()
            .and_then(|c| c.default_prompt_wav)
            .filter(|p| PathBuf::from(p).is_file())
            .ok_or_else(|| {
                "默认参考音未找到：请先在设置里「自动检测」CosyVoice，或指定 zero_shot_prompt.wav"
                    .to_string()
            })?
    } else {
        let p = default_prompt_wav.trim().to_string();
        if !PathBuf::from(&p).is_file() {
            return Err(format!("默认参考音不存在：{p}"));
        }
        p
    };
    Ok((root, wav))
}
