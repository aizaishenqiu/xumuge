//! CosyVoice 协助安装 + 三后端合成 + FastAPI sidecar Tauri commands。
//!
//! @author qiuye <yjk150@qq.com>
//! @date 2026-08-31
//! @updated 2026-09-03
//! @version 1.5.0
//! @category Config
//! @algo none

use serde::Deserialize;
use tauri::{AppHandle, Emitter, State};

use crate::desktop_db::FouDb;
use crate::voice::cosy_discover::{self, CosyDiscoverReport};
use crate::voice::cosy_fastapi::{
    self, CosySidecarStatus, CosyVoicePresetDto, FastapiHealthProbe, FastapiPcmResult,
    FastapiPcmStreamEvt, COSY_PCM_EVENT,
};
use crate::voice::cosyvoice::{
    self, CosyInstallPlan, CosyInstallRead, CosyLaunchHints, CosyMode, CosyProbeReport, CosyStatus,
};
use crate::voice::{
    probe_cosy_backend, probe_custom_url, synthesize_cosy, CosyBackendProbe, CosySynthRequest,
};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CosyPlanInput {
    pub install_root: String,
    pub model_source: String,
    pub local_model_path: Option<String>,
    pub mode_ids: Vec<String>,
}

/// 探测本机 GPU/磁盘/依赖；只读。
#[tauri::command]
pub fn xu_cosyvoice_probe() -> Result<CosyProbeReport, String> {
    cosyvoice::probe_host()
}

/// 生成安装计划与 disclosure（磁盘/耗时/依赖清单）。
#[tauri::command]
pub fn xu_cosyvoice_plan(input: CosyPlanInput) -> Result<CosyInstallPlan, String> {
    cosyvoice::plan_install(
        &input.install_root,
        &input.model_source,
        input.local_model_path.as_deref(),
        input.mode_ids,
    )
}

/// 仅安装缺失依赖。
#[tauri::command]
pub fn xu_cosyvoice_ensure_deps(install_root: String) -> Result<(), String> {
    cosyvoice::ensure_deps(&install_root)
}

/// 依赖齐后进入安装流水线。
#[tauri::command]
pub fn xu_cosyvoice_install(plan: CosyInstallPlan) -> Result<(), String> {
    cosyvoice::install_engine(&plan)
}

#[tauri::command]
pub fn xu_cosyvoice_status() -> Result<CosyStatus, String> {
    Ok(cosyvoice::status())
}

#[tauri::command]
pub fn xu_cosyvoice_cancel() -> Result<(), String> {
    cosyvoice::cancel_install();
    Ok(())
}

#[tauri::command]
pub fn xu_cosyvoice_modes_load() -> Result<Vec<CosyMode>, String> {
    cosyvoice::load_modes()
}

#[tauri::command]
pub fn xu_cosyvoice_modes_save(modes: Vec<CosyMode>) -> Result<(), String> {
    cosyvoice::save_modes(modes)
}

/// 探测 Cosy 后端就绪（local / dashscope / customHttp / fastapi）。
#[tauri::command]
pub fn xu_cosyvoice_backend_probe(
    db: State<'_, FouDb>,
    backend: String,
    custom_base_url: Option<String>,
) -> Result<CosyBackendProbe, String> {
    let b = backend.trim();
    let url = custom_base_url.unwrap_or_default();
    if b == "customHttp" {
        let key = {
            let conn = db.0.lock().map_err(|_| "数据库锁异常".to_string())?;
            crate::desktop_db::resolve_api_key("XU_COSYVOICE_CUSTOM_HTTP_API_KEY", Some(&conn))
                .unwrap_or_default()
        };
        return probe_custom_url(&url, &key);
    }
    if b == "fastapi" {
        let (ready, reason) = cosy_fastapi::probe_fastapi(&url)?;
        return Ok(CosyBackendProbe {
            backend: "fastapi".into(),
            ready,
            reason,
        });
    }
    probe_cosy_backend(&db, b)
}

/// CosyVoice 合成 WAV（三后端 JSON 契约）。
#[tauri::command]
pub async fn xu_cosyvoice_synthesize(
    db: State<'_, FouDb>,
    request: CosySynthRequest,
) -> Result<String, String> {
    let db = FouDb(std::sync::Arc::clone(&db.0));
    let path = tokio::task::spawn_blocking(move || synthesize_cosy(&db, request))
        .await
        .map_err(|e| format!("合成任务中断: {e}"))??;
    Ok(path.to_string_lossy().into_owned())
}

/// FastAPI 合成裸 PCM（base64），供前端按句播放。
#[tauri::command]
pub async fn xu_cosyvoice_fastapi_pcm(
    base_url: String,
    text: String,
    prompt_wav_path: Option<String>,
    prompt_text: Option<String>,
    instruct: Option<String>,
    spk_id: Option<String>,
    model_dir: Option<String>,
    fallback_prompt_wav: Option<String>,
    fallback_prompt_text: Option<String>,
) -> Result<FastapiPcmResult, String> {
    tokio::task::spawn_blocking(move || {
        cosy_fastapi::fastapi_pcm(
            &base_url,
            &text,
            prompt_wav_path.as_deref(),
            prompt_text.as_deref(),
            instruct.as_deref(),
            spk_id.as_deref(),
            model_dir.as_deref(),
            fallback_prompt_wav.as_deref(),
            fallback_prompt_text.as_deref(),
        )
    })
    .await
    .map_err(|e| format!("FastAPI 合成中断: {e}"))?
}

/// FastAPI 流式 PCM：经 `xu:cosy-pcm` 推分片，invoke 在整段结束后返回。
///
/// 职责：边合成边推首包，降低 Cosy 开口延迟。依赖 sidecar StreamingResponse。
/// 失败：emit kind=error 且 Result Err。
#[tauri::command]
pub async fn xu_cosyvoice_fastapi_pcm_stream(
    app: AppHandle,
    job_id: String,
    base_url: String,
    text: String,
    prompt_wav_path: Option<String>,
    prompt_text: Option<String>,
    instruct: Option<String>,
    spk_id: Option<String>,
    model_dir: Option<String>,
    fallback_prompt_wav: Option<String>,
    fallback_prompt_text: Option<String>,
) -> Result<(), String> {
    let job = job_id.clone();
    let app_cb = app.clone();
    let result = tokio::task::spawn_blocking(move || {
        use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
        let emit = |evt: FastapiPcmStreamEvt| {
            let _ = app_cb.emit(COSY_PCM_EVENT, evt);
        };
        match cosy_fastapi::fastapi_pcm_stream(
            &base_url,
            &text,
            prompt_wav_path.as_deref(),
            prompt_text.as_deref(),
            instruct.as_deref(),
            spk_id.as_deref(),
            model_dir.as_deref(),
            fallback_prompt_wav.as_deref(),
            fallback_prompt_text.as_deref(),
            |pcm, rate| {
                emit(FastapiPcmStreamEvt {
                    job_id: job.clone(),
                    kind: "chunk".into(),
                    pcm_base64: Some(B64.encode(pcm)),
                    sample_rate: rate,
                    message: None,
                });
            },
        ) {
            Ok(rate) => {
                emit(FastapiPcmStreamEvt {
                    job_id: job,
                    kind: "done".into(),
                    pcm_base64: None,
                    sample_rate: rate,
                    message: None,
                });
                Ok(())
            }
            Err(e) => {
                emit(FastapiPcmStreamEvt {
                    job_id: job,
                    kind: "error".into(),
                    pcm_base64: None,
                    sample_rate: 0,
                    message: Some(e.clone()),
                });
                Err(e)
            }
        }
    })
    .await
    .map_err(|e| format!("FastAPI 流式合成中断: {e}"))?;
    result
}

#[tauri::command]
pub fn xu_cosyvoice_fastapi_probe(base_url: String) -> Result<FastapiHealthProbe, String> {
    cosy_fastapi::probe_fastapi_health(&base_url)
}

#[tauri::command]
pub fn xu_cosyvoice_scan_voices(voices_root: String) -> Result<Vec<CosyVoicePresetDto>, String> {
    cosy_fastapi::scan_voices(&voices_root)
}

#[tauri::command]
pub fn xu_cosyvoice_sidecar_start(
    python: String,
    server_script: String,
    model_dir: String,
    extra_args: String,
    port: Option<u16>,
) -> Result<CosySidecarStatus, String> {
    // 与控制台统一：写 state + free_port，避免双路径不一致
    crate::voice::cosy_manager::console_start(
        &python,
        &server_script,
        &model_dir,
        port.unwrap_or(50000),
        &extra_args,
    )
}

#[tauri::command]
pub fn xu_cosyvoice_sidecar_stop() -> Result<CosySidecarStatus, String> {
    crate::voice::cosy_manager::console_stop()
}

#[tauri::command]
pub fn xu_cosyvoice_sidecar_status() -> Result<CosySidecarStatus, String> {
    cosy_fastapi::sidecar_status()
}

/// 写入/清除「下次自动启」标记（want + 启动路径）。
#[tauri::command]
pub fn xu_cosyvoice_set_want_running(
    want: bool,
    python: Option<String>,
    server_script: Option<String>,
    model: Option<String>,
    port: Option<u16>,
    extra_args: Option<String>,
) -> Result<(), String> {
    if !want {
        return crate::voice::cosy_manager::clear_want_flag();
    }
    let prev = crate::voice::cosy_manager::read_want_running();
    let file = crate::voice::cosy_manager::WantRunningFile {
        want: true,
        port: port
            .or_else(|| prev.as_ref().map(|p| p.port))
            .unwrap_or(50000),
        model: model
            .unwrap_or_else(|| prev.as_ref().map(|p| p.model.clone()).unwrap_or_default()),
        python: python
            .unwrap_or_else(|| prev.as_ref().map(|p| p.python.clone()).unwrap_or_default()),
        server_script: server_script.unwrap_or_else(|| {
            prev.as_ref()
                .map(|p| p.server_script.clone())
                .unwrap_or_default()
        }),
        extra_args: extra_args.unwrap_or_else(|| {
            prev.as_ref()
                .map(|p| p.extra_args.clone())
                .unwrap_or_default()
        }),
    };
    crate::voice::cosy_manager::write_want_running(&file)
}

/// 读取 want-running 标记。
#[tauri::command]
pub fn xu_cosyvoice_get_want_running(
) -> Result<Option<crate::voice::cosy_manager::WantRunningFile>, String> {
    Ok(crate::voice::cosy_manager::read_want_running())
}

/// 登录自检：free_port + 若 want 则自动 console_start（可选路径覆盖）。
/// 放到 blocking 线程，避免 sync free_port/启进程卡住 WebView。
#[tauri::command]
pub async fn xu_cosyvoice_bootstrap(
    want: Option<bool>,
    python: Option<String>,
    server_script: Option<String>,
    model: Option<String>,
    port: Option<u16>,
    extra_args: Option<String>,
) -> Result<crate::voice::cosy_manager::CosyBootstrapResult, String> {
    let overrides = if want.is_some()
        || python.as_ref().is_some_and(|s| !s.trim().is_empty())
        || server_script.as_ref().is_some_and(|s| !s.trim().is_empty())
        || model.as_ref().is_some_and(|s| !s.trim().is_empty())
    {
        Some(crate::voice::cosy_manager::WantRunningFile {
            want: want.unwrap_or(true),
            port: port.unwrap_or(50000),
            model: model.unwrap_or_default(),
            python: python.unwrap_or_default(),
            server_script: server_script.unwrap_or_default(),
            extra_args: extra_args.unwrap_or_default(),
        })
    } else {
        None
    };
    tokio::task::spawn_blocking(move || {
        crate::voice::cosy_manager::bootstrap(overrides.as_ref())
    })
    .await
    .map_err(|e| format!("bootstrap join: {e}"))
}

/// 自动探测 CosyVoice FastAPI 路径（Python / server / model / voices）。
#[tauri::command]
pub async fn xu_cosyvoice_discover(
    optional_root: Option<String>,
    hint_python: Option<String>,
    hint_server: Option<String>,
    preferred_model: Option<String>,
    use_cache: Option<bool>,
) -> Result<CosyDiscoverReport, String> {
    tokio::task::spawn_blocking(move || {
        cosy_discover::discover(
            optional_root.as_deref(),
            hint_python.as_deref(),
            hint_server.as_deref(),
            preferred_model.as_deref(),
            use_cache.unwrap_or(true),
        )
    })
    .await
    .map_err(|e| format!("路径探测任务中断: {e}"))
}

/// 打开 CosyVoice 原生控制台（Vue + Rust，非 iframe）。
#[tauri::command]
pub async fn xu_cosyvoice_open_console(app: tauri::AppHandle) -> Result<String, String> {
    tokio::task::spawn_blocking(move || crate::voice::cosy_console::open_console_window(&app))
        .await
        .map_err(|e| format!("打开控制台任务中断: {e}"))?
}

/// 控制台：环境路径。
#[tauri::command]
pub fn xu_cosyvoice_console_env() -> Result<crate::voice::cosy_manager::ConsoleEnv, String> {
    Ok(crate::voice::cosy_manager::console_env())
}

/// 控制台：综合状态。
#[tauri::command]
pub fn xu_cosyvoice_console_status(
    base_url: String,
    port: Option<u16>,
) -> Result<crate::voice::cosy_manager::ConsoleStatus, String> {
    Ok(crate::voice::cosy_manager::console_status(
        &base_url,
        port.unwrap_or(50000),
    ))
}

/// 控制台：探测 FastAPI。
#[tauri::command]
pub fn xu_cosyvoice_console_probe(base_url: String) -> Result<crate::voice::cosy_manager::ConsoleProbe, String> {
    Ok(crate::voice::cosy_manager::probe_base(&base_url))
}

/// 控制台：模型列表。
#[tauri::command]
pub fn xu_cosyvoice_console_models() -> Result<Vec<String>, String> {
    Ok(crate::voice::cosy_manager::list_models())
}

/// 控制台：日志尾部。
#[tauri::command]
pub fn xu_cosyvoice_console_log(lines: Option<usize>) -> Result<Vec<String>, String> {
    crate::voice::cosy_manager::tail_log(lines.unwrap_or(60))
}

/// 控制台：启动 sidecar。
#[tauri::command]
pub fn xu_cosyvoice_console_start(
    python: String,
    server_script: String,
    model: String,
    port: Option<u16>,
    extra_args: Option<String>,
) -> Result<CosySidecarStatus, String> {
    crate::voice::cosy_manager::console_start(
        &python,
        &server_script,
        &model,
        port.unwrap_or(50000),
        extra_args.as_deref().unwrap_or(""),
    )
}

/// 控制台：停止 sidecar。
#[tauri::command]
pub fn xu_cosyvoice_console_stop() -> Result<CosySidecarStatus, String> {
    crate::voice::cosy_manager::console_stop()
}

/// 控制台：重启 sidecar。
#[tauri::command]
pub fn xu_cosyvoice_console_restart(
    python: String,
    server_script: String,
    model: String,
    port: Option<u16>,
    extra_args: Option<String>,
) -> Result<CosySidecarStatus, String> {
    crate::voice::cosy_manager::console_restart(
        &python,
        &server_script,
        &model,
        port.unwrap_or(50000),
        extra_args.as_deref().unwrap_or(""),
    )
}

/// 控制台：保存音色到 voices_root。
#[tauri::command]
pub fn xu_cosyvoice_console_save_voice(
    input: crate::voice::cosy_manager::SaveVoicePresetInput,
) -> Result<(), String> {
    crate::voice::cosy_manager::save_voice_preset(&input)
}

/// 控制台：删除音色。
#[tauri::command]
pub fn xu_cosyvoice_console_delete_voice(voices_root: String, id: String) -> Result<(), String> {
    crate::voice::cosy_manager::delete_voice_preset(&voices_root, &id)
}

/// 系统音色自动入库：默认参考音 + 各音色 instruct → sys-<id>/
/// voices_root / wav 可空：空则用 `{XU_HOME}/cosyvoice/voices` 与 discover 默认参考音。
#[tauri::command]
pub fn xu_cosyvoice_ensure_system_voices(
    voices_root: String,
    default_prompt_wav: String,
    default_prompt_text: String,
    seeds: Vec<crate::voice::cosy_manager::SystemVoiceSeed>,
) -> Result<crate::voice::cosy_manager::EnsureSystemVoicesResult, String> {
    let (root, wav) =
        crate::voice::cosy_manager::resolve_seed_paths(&voices_root, &default_prompt_wav)?;
    crate::voice::cosy_manager::ensure_system_voices(&root, &wav, &default_prompt_text, &seeds)
}

/// 返回（并创建）默认系统音色库路径。
#[tauri::command]
pub fn xu_cosyvoice_default_voices_root() -> Result<String, String> {
    crate::voice::cosy_manager::default_voices_root()
}

/// 根据协助安装目录推导 FastAPI 启动项。
#[tauri::command]
pub fn xu_cosyvoice_launch_hints() -> Result<CosyLaunchHints, String> {
    cosyvoice::launch_hints()
}

/// 读取 install.json 与安装日志尾部。
#[tauri::command]
pub fn xu_cosyvoice_install_read() -> Result<CosyInstallRead, String> {
    cosyvoice::install_read()
}

/// 从 install.json 断点续装。
#[tauri::command]
pub fn xu_cosyvoice_install_resume(install_root: String) -> Result<(), String> {
    cosyvoice::resume_install(&install_root)
}
