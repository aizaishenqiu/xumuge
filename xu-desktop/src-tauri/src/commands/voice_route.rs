//! 语音路由 MCP 工具：切语气 / 临时 Cosy instruct（会话覆盖由前端持久化）。
//!
//! @author qiuye <yjk150@qq.com>
//! @date 2026-08-31
//! @updated 2026-09-07
//! @version 1.1.0
//! @category Config
//! @algo none

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};

use crate::desktop_db::FouDb;
use crate::voice::{any_backend_ready, kokoro_models_ready};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct VoiceRouteState {
    pub tone_id: String,
    pub cosy_instruct: String,
    pub provider_hint: String,
}

static ROUTE: once_cell::sync::Lazy<std::sync::Mutex<VoiceRouteState>> =
    once_cell::sync::Lazy::new(|| std::sync::Mutex::new(VoiceRouteState::default()));

/// Agent 工具路径无 AppHandle 时用于广播覆盖。
static APP_EMIT: once_cell::sync::OnceCell<AppHandle> = once_cell::sync::OnceCell::new();

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceRouteProbe {
    pub tone_id: String,
    pub cosy_instruct: String,
    pub sherpa_ready: bool,
    pub cosy_local_ready: bool,
    pub message: String,
}

/// 启动时绑定，供 Agent voice_set_* 广播到前端。
pub fn bind_app(app: AppHandle) {
    let _ = APP_EMIT.set(app);
}

fn emit_override(app: Option<&AppHandle>, state: &VoiceRouteState) {
    let handle = app.or_else(|| APP_EMIT.get());
    if let Some(app) = handle {
        let _ = app.emit("xu:voice-route-override", state.clone());
    }
}

/// Agent / 内部读取当前覆盖快照。
pub fn snapshot() -> VoiceRouteState {
    ROUTE
        .lock()
        .map(|s| s.clone())
        .unwrap_or_default()
}

/// 内部：设语气；尽量广播给前端（含 Agent 工具路径）。
pub fn set_tone_internal(tone_id: &str) -> Result<VoiceRouteState, String> {
    let tone = tone_id.trim().to_string();
    if tone.is_empty() || tone.len() > 64 {
        return Err("语气 id 不合法".into());
    }
    let mut s = ROUTE.lock().map_err(|_| "锁异常".to_string())?;
    s.tone_id = tone;
    let out = s.clone();
    drop(s);
    emit_override(None, &out);
    Ok(out)
}

/// 内部：设临时 instruct。
pub fn set_instruct_internal(instruct: &str) -> Result<VoiceRouteState, String> {
    let text = instruct.trim().to_string();
    if text.chars().count() > 2000 {
        return Err("instruct 过长".into());
    }
    let mut s = ROUTE.lock().map_err(|_| "锁异常".to_string())?;
    s.cosy_instruct = text;
    let out = s.clone();
    drop(s);
    emit_override(None, &out);
    Ok(out)
}

/// 内部：清除覆盖。
pub fn clear_override_internal() -> Result<VoiceRouteState, String> {
    let mut s = ROUTE.lock().map_err(|_| "锁异常".to_string())?;
    *s = VoiceRouteState::default();
    let out = s.clone();
    drop(s);
    emit_override(None, &out);
    Ok(out)
}

/// 探测当前路由相关就绪态。
#[tauri::command]
pub fn xu_voice_route_probe(db: State<'_, FouDb>) -> Result<VoiceRouteProbe, String> {
    let s = snapshot();
    let sherpa = kokoro_models_ready(None);
    let cosy_local = any_backend_ready(&db, "local", "");
    Ok(VoiceRouteProbe {
        tone_id: s.tone_id,
        cosy_instruct: s.cosy_instruct,
        sherpa_ready: sherpa,
        cosy_local_ready: cosy_local,
        message: "用 voice_set_tone / voice_set_cosy_instruct 切换；夹子音等须 Cosy。".into(),
    })
}

/// 设置产品语气 id（如 female-jiazi）；广播给前端写入 session。
#[tauri::command]
pub fn xu_voice_set_tone(app: AppHandle, tone_id: String) -> Result<VoiceRouteState, String> {
    let s = set_tone_internal(&tone_id)?;
    emit_override(Some(&app), &s);
    Ok(s)
}

/// 设置临时 Cosy instruct / 角色音色描述。
#[tauri::command]
pub fn xu_voice_set_cosy_instruct(
    app: AppHandle,
    instruct: String,
) -> Result<VoiceRouteState, String> {
    let s = set_instruct_internal(&instruct)?;
    emit_override(Some(&app), &s);
    Ok(s)
}

/// 清除临时语气与 instruct。
#[tauri::command]
pub fn xu_voice_clear_override(app: AppHandle) -> Result<VoiceRouteState, String> {
    let s = clear_override_internal()?;
    emit_override(Some(&app), &s);
    Ok(s)
}
