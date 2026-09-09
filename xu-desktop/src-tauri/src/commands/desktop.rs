//! 桌面数据、会话、记忆与账单 Tauri 命令。
//!
//! @author qiuye <yjk150@qq.com>
//! @date 2026-08-30
//! @updated 2026-08-31
//! @version 1.1.0
//! @category DB
//! @algo mutex-serialized-sqlite-transaction

use crate::desktop_db::{self, EmployeeRow, FouDb, MessageRow, OpsBrains};
use serde::Deserialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, State};

fn with_db<T>(
    db: &State<'_, FouDb>,
    f: impl FnOnce(&rusqlite::Connection) -> Result<T, String>,
) -> Result<T, String> {
    let guard = db.0.lock().map_err(|e| e.to_string())?;
    f(&guard)
}

#[tauri::command]
pub fn xu_list_employees(db: State<'_, FouDb>) -> Result<Vec<EmployeeRow>, String> {
    with_db(&db, desktop_db::list_employees)
}

#[tauri::command]
pub fn xu_upsert_employee(db: State<'_, FouDb>, employee: EmployeeRow) -> Result<(), String> {
    with_db(&db, |c| desktop_db::upsert_employee(c, &employee))
}

#[tauri::command]
pub fn xu_upsert_employees_batch(
    db: State<'_, FouDb>,
    employees: Vec<EmployeeRow>,
) -> Result<(), String> {
    with_db(&db, |c| desktop_db::upsert_employees_batch(c, &employees))
}

/// Cold start only (frontend guards with sessionStorage): no Rust agents survive a process exit.
#[tauri::command]
pub fn xu_reset_busy_employees(db: State<'_, FouDb>) -> Result<u32, String> {
    with_db(&db, desktop_db::reset_busy_employees)
}

#[tauri::command]
pub fn xu_delete_employee(db: State<'_, FouDb>, id: String) -> Result<(), String> {
    with_db(&db, |c| desktop_db::delete_employee(c, &id))
}

#[tauri::command]
pub fn xu_remap_employee_id(
    db: State<'_, FouDb>,
    old_id: String,
    new_id: String,
) -> Result<(), String> {
    with_db(&db, |c| desktop_db::remap_employee_id(c, &old_id, &new_id))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrateEmployeesPayload {
    pub employees: Vec<EmployeeRow>,
    pub seed_if_empty: bool,
}

#[tauri::command]
pub fn xu_bootstrap_employees(
    db: State<'_, FouDb>,
    payload: MigrateEmployeesPayload,
) -> Result<Vec<EmployeeRow>, String> {
    with_db(&db, |c| {
        let count = desktop_db::employee_count(c)?;
        if count == 0 {
            if !payload.employees.is_empty() {
                for emp in &payload.employees {
                    desktop_db::upsert_employee(c, emp)?;
                }
            } else if payload.seed_if_empty {
                let now = chrono::Utc::now().timestamp_millis();
                let seeds = seed_employees(now);
                for emp in &seeds {
                    desktop_db::upsert_employee(c, emp)?;
                }
            }
        }
        desktop_db::list_employees(c)
    })
}

fn seed_employees(now: i64) -> Vec<EmployeeRow> {
    // Align with PersonalityPicker templates (engineer / mentor) + reviewer role.
    vec![
        EmployeeRow {
            id: "seed_assistant".into(),
            name: "助手".into(),
            role: "助手".into(),
            avatar_id: "sky".into(),
            desk_index: Some(0),
            status: "idle".into(),
            created_at: now,
            workspace_root: None,
            read_extra_paths: "[]".into(),
            allow_network_exfil: false,
            drive_mode: "off".into(),
            gender: "female".into(),
            role_kind: "worker".into(),
            brain_slot: "work".into(),
            outfit: "dress".into(),
            hair_style: "bob".into(),
            agent_role_id: "ux-researcher".into(),
            ai_model: String::new(),
            ai_base_url: String::new(),
            employee_no: "F0001".into(),
            api_source: "inherit".into(),
            ai_vision_model: String::new(),
            remote_preset_id: String::new(),
            age: 26,
            code_editor_surface: "inherit".into(),
        },
        EmployeeRow {
            id: "seed_engineer".into(),
            name: "工程师".into(),
            role: "前端工程师".into(),
            avatar_id: "classic".into(),
            desk_index: Some(1),
            status: "idle".into(),
            created_at: now + 1,
            workspace_root: None,
            read_extra_paths: "[]".into(),
            allow_network_exfil: false,
            drive_mode: "off".into(),
            gender: "male".into(),
            role_kind: "worker".into(),
            brain_slot: "code".into(),
            outfit: "hoodie".into(),
            hair_style: "spiky".into(),
            agent_role_id: "frontend-developer".into(),
            ai_model: String::new(),
            ai_base_url: String::new(),
            employee_no: "F0002".into(),
            api_source: "inherit".into(),
            ai_vision_model: String::new(),
            remote_preset_id: String::new(),
            age: 26,
            code_editor_surface: "inherit".into(),
        },
        EmployeeRow {
            id: "seed_mentor".into(),
            name: "导师".into(),
            role: "产品经理".into(),
            avatar_id: "mint".into(),
            desk_index: Some(2),
            status: "idle".into(),
            created_at: now + 2,
            workspace_root: None,
            read_extra_paths: "[]".into(),
            allow_network_exfil: false,
            drive_mode: "off".into(),
            gender: "female".into(),
            role_kind: "worker".into(),
            brain_slot: "work".into(),
            outfit: "formal".into(),
            hair_style: "pony".into(),
            agent_role_id: "product-manager".into(),
            ai_model: String::new(),
            ai_base_url: String::new(),
            employee_no: "F0003".into(),
            api_source: "inherit".into(),
            ai_vision_model: String::new(),
            remote_preset_id: String::new(),
            age: 26,
            code_editor_surface: "inherit".into(),
        },
        EmployeeRow {
            id: "seed_reviewer".into(),
            name: "审码".into(),
            role: "代码审核员".into(),
            avatar_id: "ink".into(),
            desk_index: Some(3),
            status: "idle".into(),
            created_at: now + 3,
            workspace_root: None,
            read_extra_paths: "[]".into(),
            allow_network_exfil: false,
            drive_mode: "off".into(),
            gender: "male".into(),
            role_kind: "reviewer".into(),
            brain_slot: "command".into(),
            outfit: "suit".into(),
            hair_style: "side".into(),
            agent_role_id: "code-reviewer".into(),
            ai_model: String::new(),
            ai_base_url: String::new(),
            employee_no: "F0004".into(),
            api_source: "inherit".into(),
            ai_vision_model: String::new(),
            remote_preset_id: String::new(),
            age: 26,
            code_editor_surface: "inherit".into(),
        },
    ]
}

#[tauri::command]
pub fn xu_append_message(
    app: AppHandle,
    db: State<'_, FouDb>,
    message: MessageRow,
) -> Result<(), String> {
    let session_tag = message.session_tag.clone();
    with_db(&db, |c| desktop_db::append_message(c, &message))?;
    if session_tag == "office-floor" {
        let _ = app.emit("xu-office-notify", ());
    }
    Ok(())
}

#[tauri::command]
pub fn xu_list_messages(
    db: State<'_, FouDb>,
    session_tag: Option<String>,
    limit: Option<i64>,
) -> Result<Vec<MessageRow>, String> {
    with_db(&db, |c| {
        desktop_db::list_messages(c, session_tag, limit.unwrap_or(100))
    })
}

#[tauri::command]
pub fn xu_get_retention_days(db: State<'_, FouDb>) -> Result<i64, String> {
    with_db(&db, desktop_db::get_retention_days)
}

#[tauri::command]
pub fn xu_get_setting(db: State<'_, FouDb>, key: String) -> Result<Option<String>, String> {
    with_db(&db, |c| desktop_db::setting_get(c, &key))
}

#[tauri::command]
pub fn xu_set_setting(db: State<'_, FouDb>, key: String, value: String) -> Result<(), String> {
    with_db(&db, |c| desktop_db::setting_set(c, &key, &value))
}

#[tauri::command]
pub fn xu_set_retention_days(db: State<'_, FouDb>, days: i64) -> Result<(), String> {
    with_db(&db, |c| desktop_db::set_retention_days(c, days))
}

#[tauri::command]
pub fn xu_purge_old_messages(db: State<'_, FouDb>) -> Result<u64, String> {
    with_db(&db, desktop_db::purge_old_messages)
}

#[tauri::command]
pub fn xu_get_ops_brains(db: State<'_, FouDb>) -> Result<OpsBrains, String> {
    with_db(&db, desktop_db::get_ops_brains)
}

#[tauri::command]
pub fn xu_set_ops_brains(db: State<'_, FouDb>, brains: OpsBrains) -> Result<(), String> {
    with_db(&db, |c| desktop_db::set_ops_brains(c, &brains))
}

#[tauri::command]
pub fn xu_get_default_reviewer_id(db: State<'_, FouDb>) -> Result<Option<String>, String> {
    with_db(&db, desktop_db::get_default_reviewer_id)
}

#[tauri::command]
pub fn xu_set_default_reviewer_id(db: State<'_, FouDb>, id: Option<String>) -> Result<(), String> {
    with_db(&db, |c| desktop_db::set_default_reviewer_id(c, id))
}

#[tauri::command]
pub fn xu_get_office_layout(db: State<'_, FouDb>) -> Result<Option<String>, String> {
    with_db(&db, desktop_db::get_office_layout)
}

#[tauri::command]
pub fn xu_set_office_layout(db: State<'_, FouDb>, layout_json: String) -> Result<(), String> {
    with_db(&db, |c| desktop_db::set_office_layout(c, &layout_json))
}

#[tauri::command]
pub fn xu_reset_office_layout(db: State<'_, FouDb>) -> Result<(), String> {
    with_db(&db, desktop_db::reset_office_layout)
}

#[tauri::command]
pub fn xu_get_project_theme(db: State<'_, FouDb>) -> Result<Option<String>, String> {
    with_db(&db, desktop_db::get_project_theme)
}

#[tauri::command]
pub fn xu_set_project_theme(db: State<'_, FouDb>, theme_json: String) -> Result<(), String> {
    with_db(&db, |c| desktop_db::set_project_theme(c, &theme_json))
}

#[tauri::command]
pub fn xu_clear_project_theme(db: State<'_, FouDb>) -> Result<(), String> {
    with_db(&db, desktop_db::clear_project_theme)
}

#[tauri::command]
pub fn xu_get_delivery_disputes(db: State<'_, FouDb>) -> Result<Option<String>, String> {
    with_db(&db, desktop_db::get_delivery_disputes)
}

#[tauri::command]
pub fn xu_set_delivery_disputes(
    db: State<'_, FouDb>,
    disputes_json: String,
) -> Result<(), String> {
    with_db(&db, |c| {
        desktop_db::set_delivery_disputes(c, &disputes_json)
    })
}

#[tauri::command]
pub async fn xu_list_local_models(base_url: Option<String>) -> Result<Vec<String>, String> {
    let raw = base_url
        .unwrap_or_default()
        .trim()
        .trim_end_matches('/')
        .to_string();
    let origin = if raw.is_empty() {
        "http://127.0.0.1:11434".to_string()
    } else {
        // Accept ??v1 ??strip to host root for Ollama /api/tags
        let without_v1 = raw.trim_end_matches("/v1");
        if without_v1.starts_with("http://") || without_v1.starts_with("https://") {
            without_v1.to_string()
        } else {
            format!("http://{without_v1}")
        }
    };
    let url = format!("{origin}/api/tags");
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("???? Ollama?{url}?? {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("Ollama HTTP {}", resp.status()));
    }
    let v: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    if let Some(arr) = v.get("models").and_then(|m| m.as_array()) {
        for m in arr {
            if let Some(name) = m.get("name").and_then(|n| n.as_str()) {
                out.push(name.to_string());
            } else if let Some(name) = m.get("model").and_then(|n| n.as_str()) {
                out.push(name.to_string());
            }
        }
    }
    out.sort();
    out.dedup();
    Ok(out)
}

async fn probe_chat_completion(
    client: &reqwest::Client,
    base_url: &str,
    api_key: &str,
    model: Option<&str>,
) -> Result<String, String> {
    let b = base_url.trim().trim_end_matches('/');
    let url = if b.ends_with("/chat/completions") {
        b.to_string()
    } else if b.ends_with("/v1") {
        format!("{b}/chat/completions")
    } else {
        format!("{b}/v1/chat/completions")
    };
    let model_id = model
        .filter(|s| !s.trim().is_empty())
        .unwrap_or("deepseek-chat");
    let body = serde_json::json!({
        "model": model_id,
        "messages": [{ "role": "user", "content": "ping" }],
        "max_tokens": 1
    });
    let mut req = client.post(&url).json(&body);
    if !api_key.is_empty() {
        req = req.bearer_auth(api_key);
    }
    let resp = req.send().await.map_err(|e| format!("连接失败: {e}"))?;
    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    if status.is_success() {
        return Ok(format!(
            "OK HTTP {status} · chat/completions 测通（模型 {model_id}）"
        ));
    }
    if status.as_u16() == 401 {
        return Err(format!(
            "HTTP 401 认证失败：API Key 无效或未配置。{}",
            text.chars().take(120).collect::<String>()
        ));
    }
    Err(format!(
        "HTTP {status}: {}",
        text.chars().take(160).collect::<String>()
    ))
}

#[tauri::command]
pub fn xu_set_stored_api_key(
    db: State<'_, FouDb>,
    api_key_env: String,
    api_key: String,
) -> Result<(), String> {
    with_db(&db, |c| {
        desktop_db::set_stored_api_key(c, &api_key_env, &api_key)
    })
}

#[tauri::command]
pub fn xu_api_key_configured(db: State<'_, FouDb>, api_key_env: String) -> Result<bool, String> {
    with_db(&db, |c| desktop_db::api_key_configured(c, &api_key_env))
}

#[tauri::command]
pub async fn xu_probe_brain(
    db: State<'_, FouDb>,
    base_url: String,
    api_key_env: Option<String>,
    model: Option<String>,
) -> Result<String, String> {
    let raw = base_url.trim().trim_end_matches('/');
    if raw.is_empty() {
        return Err("baseUrl 为空".into());
    }

    let is_ollama = raw.contains("11434") || raw.contains("ollama");
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(8))
        .build()
        .map_err(|e| e.to_string())?;

    if is_ollama {
        let origin = raw.trim_end_matches("/v1");
        let url = format!("{origin}/api/tags");
        let resp = client
            .get(&url)
            .send()
            .await
            .map_err(|e| format!("Ollama 连接失败: {e}"))?;
        if !resp.status().is_success() {
            return Err(format!("Ollama HTTP {}", resp.status()));
        }
        let v: serde_json::Value = resp.json().await.unwrap_or_default();
        let n = v
            .get("models")
            .and_then(|m| m.as_array())
            .map(|a| a.len())
            .unwrap_or(0);
        let want = model.unwrap_or_default();
        if !want.trim().is_empty() {
            let names: Vec<String> = v
                .get("models")
                .and_then(|m| m.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|m| {
                            m.get("name")
                                .or_else(|| m.get("model"))
                                .and_then(|n| n.as_str())
                                .map(|s| s.to_string())
                        })
                        .collect()
                })
                .unwrap_or_default();
            if !names
                .iter()
                .any(|n| n == &want || n.starts_with(&format!("{want}:")))
            {
                return Err(format!("Ollama 已连接（{n} 个模型），未找到模型 {want}"));
            }
            return Ok(format!("OK Ollama 已找到模型 {want}（共 {n} 个）"));
        }
        return Ok(format!("OK Ollama 已连接（{n} 个模型）"));
    }

    let key_env = api_key_env.unwrap_or_default();
    let api_key = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        if key_env.trim().is_empty() {
            String::new()
        } else {
            match desktop_db::resolve_api_key(&key_env, Some(&conn)) {
                Ok(k) => k,
                Err(e) => return Err(e),
            }
        }
    };

    let models_url = if raw.ends_with("/models") {
        raw.to_string()
    } else if raw.contains("/v1") {
        format!("{raw}/models")
    } else {
        format!("{raw}/v1/models")
    };

    let mut req = client.get(&models_url);
    if !api_key.is_empty() {
        req = req.bearer_auth(&api_key);
    }
    match req.send().await {
        Ok(resp) => {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            if status.is_success() {
                let hint = if api_key.is_empty() {
                    "（未配置 API Key）"
                } else {
                    "（已带 API Key）"
                };
                let model_hint = model.unwrap_or_default();
                if !model_hint.is_empty() && text.contains(&model_hint) {
                    return Ok(format!("OK HTTP {status} · 列表含模型 {model_hint} {hint}"));
                }
                Ok(format!("OK HTTP {status} {hint}"))
            } else if status.as_u16() == 401 {
                Err(format!(
                    "HTTP 401 认证失败：请检查 API Key 是否正确。若未填写，请在预设中粘贴 Key 后保存再测通。{}",
                    text.chars().take(120).collect::<String>()
                ))
            } else if status.as_u16() == 404 || status.as_u16() == 405 {
                probe_chat_completion(&client, raw, &api_key, model.as_deref()).await
            } else {
                Err(format!(
                    "HTTP {status}: {}",
                    text.chars().take(160).collect::<String>()
                ))
            }
        }
        Err(e) => {
            // Fallback TCP message
            let use_tls = raw.starts_with("https://");
            let stripped = raw
                .trim_start_matches("https://")
                .trim_start_matches("http://");
            let hostport = stripped.split('/').next().unwrap_or(stripped);
            Err(format!("连接失败 {hostport} tls={use_tls}: {e}"))
        }
    }
}

#[tauri::command]
pub fn xu_get_employee_session(
    db: State<'_, FouDb>,
    employee_id: String,
) -> Result<Option<String>, String> {
    with_db(&db, |c| desktop_db::get_employee_session(c, &employee_id))
}

#[tauri::command]
pub fn xu_set_employee_session(
    db: State<'_, FouDb>,
    employee_id: String,
    session_id: String,
) -> Result<(), String> {
    with_db(&db, |c| {
        desktop_db::set_employee_session(c, &employee_id, &session_id)
    })
}

#[tauri::command]
pub fn xu_clear_employee_session(db: State<'_, FouDb>, employee_id: String) -> Result<(), String> {
    with_db(&db, |c| desktop_db::clear_employee_session(c, &employee_id))
}

#[tauri::command]
/// 列出指定作用域的未过期记忆；依赖 xu.db，查询失败返回给调用页弹窗。
pub fn xu_list_memories(
    db: State<'_, FouDb>,
    scope: Option<String>,
    scope_id: Option<String>,
    limit: Option<i64>,
) -> Result<Vec<desktop_db::MemoryRow>, String> {
    with_db(&db, |c| {
        desktop_db::list_memories(
            c,
            scope.as_deref(),
            scope_id.as_deref(),
            limit.unwrap_or(50),
        )
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertMemoryPayload {
    pub id: Option<String>,
    pub scope: String,
    pub scope_id: Option<String>,
    pub title: Option<String>,
    pub body: String,
    pub tags: Option<String>,
    pub source: Option<String>,
    pub version: Option<i64>,
    pub confidence: Option<f64>,
    pub expires_at: Option<i64>,
    pub conflict_key: Option<String>,
    pub citation: Option<String>,
    pub reason: Option<String>,
    pub pinned: Option<bool>,
}

#[tauri::command]
/// 新增或更新带来源、版本、置信度、过期和引用元数据的记忆。
/// 依赖 xu.db 容量限制；冲突或写入失败返回给记忆页弹窗。
pub fn xu_upsert_memory(
    db: State<'_, FouDb>,
    payload: UpsertMemoryPayload,
) -> Result<desktop_db::MemoryRow, String> {
    let now = chrono::Utc::now().timestamp_millis();
    let id = payload
        .id
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| format!("mem_{now}"));
    let source_provided = payload.source.is_some();
    let row = desktop_db::MemoryRow {
        id: id.clone(),
        scope: payload.scope,
        scope_id: payload.scope_id,
        title: payload.title.unwrap_or_default(),
        body: payload.body,
        tags: payload.tags.unwrap_or_else(|| "[]".into()),
        source: payload.source.unwrap_or_else(|| "manual".into()),
        version: payload.version.unwrap_or(1).max(1),
        confidence: payload.confidence.unwrap_or(0.7).clamp(0.0, 1.0),
        expires_at: payload.expires_at,
        conflict_key: payload.conflict_key,
        citation: payload.citation.unwrap_or_default(),
        reason: payload.reason.unwrap_or_else(|| "用户手动保存".into()),
        pinned: payload.pinned.unwrap_or(false),
        created_at: now,
        updated_at: now,
    };
    with_db(&db, |c| {
        // preserve created_at / source on update
        let existing = desktop_db::list_memories(c, None, None, 500)?
            .into_iter()
            .find(|m| m.id == id);
        let mut row = row;
        if let Some(old) = existing {
            row.created_at = old.created_at;
            if !source_provided {
                row.source = old.source;
            }
        }
        desktop_db::upsert_memory(c, &row)?;
        Ok(row)
    })
}

#[tauri::command]
pub fn xu_delete_memory(db: State<'_, FouDb>, id: String) -> Result<(), String> {
    with_db(&db, |c| desktop_db::delete_memory(c, &id))
}

#[tauri::command]
pub fn xu_build_memory_preamble(
    db: State<'_, FouDb>,
    employee_id: Option<String>,
    employee_name: Option<String>,
    project_id: Option<String>,
    task_hint: Option<String>,
) -> Result<String, String> {
    with_db(&db, |c| {
        desktop_db::build_memory_preamble(
            c,
            employee_id.as_deref(),
            employee_name.as_deref(),
            project_id.as_deref(),
            task_hint.as_deref(),
        )
    })
}

#[tauri::command]
pub fn xu_memory_corpus_stats(
    db: State<'_, FouDb>,
) -> Result<desktop_db::MemoryCorpusStats, String> {
    with_db(&db, desktop_db::memory_corpus_stats)
}

#[tauri::command]
pub fn xu_token_package_status(
    db: State<'_, FouDb>,
) -> Result<desktop_db::TokenPackageStatus, String> {
    with_db(&db, desktop_db::token_package_status)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetTokenPackagePayload {
    pub hard_limit: u64,
    pub soft_ratio: Option<f64>,
    pub reset_usage: Option<bool>,
}

#[tauri::command]
pub fn xu_set_token_package(
    db: State<'_, FouDb>,
    payload: SetTokenPackagePayload,
) -> Result<desktop_db::TokenPackageStatus, String> {
    with_db(&db, |c| {
        desktop_db::set_token_package(
            c,
            payload.hard_limit,
            payload.soft_ratio,
            payload.reset_usage.unwrap_or(false),
        )
    })
}

#[tauri::command]
pub fn xu_list_chat_sessions(
    db: State<'_, FouDb>,
) -> Result<Vec<desktop_db::FouChatSessionView>, String> {
    with_db(&db, desktop_db::list_chat_sessions)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnsureChatSessionPayload {
    pub id: String,
    pub title: Option<String>,
    pub employee_id: Option<String>,
    pub brain_slot: Option<String>,
    pub model: Option<String>,
}

#[tauri::command]
pub fn xu_ensure_chat_session(
    db: State<'_, FouDb>,
    payload: EnsureChatSessionPayload,
) -> Result<(), String> {
    with_db(&db, |c| {
        desktop_db::ensure_chat_session(
            c,
            &payload.id,
            payload.title.as_deref().unwrap_or("新对话"),
            payload.employee_id.as_deref(),
            payload.brain_slot.as_deref().unwrap_or("command"),
            payload.model.as_deref().unwrap_or(""),
        )
    })
}

#[tauri::command]
pub fn xu_append_chat_message(
    db: State<'_, FouDb>,
    session_id: String,
    role: String,
    content: String,
) -> Result<String, String> {
    with_db(&db, |c| {
        desktop_db::append_chat_message(c, &session_id, &role, &content)
    })
}

/// 返回会话消息及其已绑定附件，供前端恢复完整消息块。
/// 依赖: xu.db 会话/附件表；失败时返回友好错误且不泄露本机路径。
#[tauri::command]
pub fn xu_get_chat_history(
    db: State<'_, FouDb>,
    session_id: String,
    limit: Option<i64>,
) -> Result<Vec<desktop_db::ChatMessageRow>, String> {
    with_db(&db, |c| {
        desktop_db::list_chat_messages(c, &session_id, limit.unwrap_or(200))
    })
    .map_err(|_| "无法读取对话历史，请稍后重试".to_string())
}

#[tauri::command]
pub fn xu_rename_chat_session(
    db: State<'_, FouDb>,
    session_id: String,
    title: String,
) -> Result<(), String> {
    with_db(&db, |c| {
        desktop_db::rename_chat_session(c, &session_id, title.trim())
    })
}

/// 事务删除会话数据，并仅在提交成功后清理 `{XU_HOME}/attachments` 副本。
/// 依赖: SQLite 外键与安全路径校验；文件清理失败不回滚已提交的会话删除。
#[tauri::command]
pub fn xu_delete_chat_session(db: State<'_, FouDb>, session_id: String) -> Result<(), String> {
    let paths = {
        let mut guard = db.0.lock().map_err(|_| "本地数据暂时不可用".to_string())?;
        desktop_db::delete_chat_session(&mut guard, &session_id)?
    };
    for path in paths {
        crate::commands::attachments::remove_stored_attachment_dir(&path);
    }
    Ok(())
}

#[tauri::command]
pub fn xu_token_billing_summary(
    db: State<'_, FouDb>,
    preset_id: Option<String>,
) -> Result<Vec<desktop_db::TokenBillingSummary>, String> {
    with_db(&db, |c| {
        desktop_db::token_billing_summary(c, preset_id.as_deref())
    })
}

/// 按用户选择的时间区间汇总模型账单（表格与图表区间一致）
#[tauri::command]
pub fn xu_token_billing_summary_range(
    db: State<'_, FouDb>,
    from_ms: i64,
    to_ms: i64,
    preset_id: Option<String>,
) -> Result<Vec<desktop_db::TokenBillingSummary>, String> {
    with_db(&db, |c| {
        desktop_db::token_billing_summary_range(c, from_ms, to_ms, preset_id.as_deref())
    })
}

#[tauri::command]
pub fn xu_list_token_bills(
    db: State<'_, FouDb>,
    preset_id: Option<String>,
    limit: Option<usize>,
) -> Result<Vec<desktop_db::TokenBillRow>, String> {
    with_db(&db, |c| {
        desktop_db::list_token_bills(c, preset_id.as_deref(), limit.unwrap_or(50))
    })
}

#[tauri::command]
pub fn xu_list_token_bills_range(
    db: State<'_, FouDb>,
    from_ms: i64,
    to_ms: i64,
    preset_id: Option<String>,
    limit: Option<usize>,
) -> Result<Vec<desktop_db::TokenBillRow>, String> {
    with_db(&db, |c| {
        desktop_db::list_token_bills_range(
            c,
            from_ms,
            to_ms,
            preset_id.as_deref(),
            limit.unwrap_or(500),
        )
    })
}

#[tauri::command]
pub fn xu_session_billing_summary(
    db: State<'_, FouDb>,
    session_id: String,
) -> Result<desktop_db::SessionBillingSummary, String> {
    with_db(&db, |c| desktop_db::session_billing_summary(c, &session_id))
}

#[tauri::command]
pub fn xu_session_billing_rounds(
    db: State<'_, FouDb>,
    session_id: String,
) -> Result<Vec<desktop_db::SessionBillingRound>, String> {
    with_db(&db, |c| desktop_db::session_billing_rounds(c, &session_id))
}

#[tauri::command]
pub fn xu_session_context_usage(
    db: State<'_, FouDb>,
    session_id: String,
) -> Result<Value, String> {
    with_db(&db, |c| {
        let sid = session_id.trim();
        if sid.is_empty() {
            return Ok(crate::agent::stream::context_usage_for_session_messages(&[]));
        }
        let key = format!("ctx_stat:{sid}");
        if let Ok(Some(raw)) = desktop_db::setting_get(c, &key) {
            if let Ok(v) = serde_json::from_str::<Value>(&raw) {
                if v.get("used").is_some() {
                    return Ok(v);
                }
            }
        }
        let rows = desktop_db::list_chat_messages(c, sid, 200)?;
        let messages: Vec<Value> = rows
            .into_iter()
            .rev()
            .map(|r| json!({ "role": r.role, "content": r.content }))
            .collect();
        Ok(crate::agent::stream::context_usage_for_session_messages(
            &messages,
        ))
    })
}

#[tauri::command]
pub fn xu_token_billing_model_series(
    db: State<'_, FouDb>,
    from_ms: i64,
    to_ms: i64,
    granularity: Option<String>,
) -> Result<Vec<desktop_db::ModelBillingSeriesPoint>, String> {
    let g = granularity.unwrap_or_else(|| "day".into());
    with_db(&db, |c| {
        desktop_db::token_billing_model_series(c, from_ms, to_ms, &g)
    })
}

#[tauri::command]
pub fn xu_token_billing_series(
    db: State<'_, FouDb>,
    preset_id: Option<String>,
    from_ms: i64,
    to_ms: i64,
    granularity: Option<String>,
) -> Result<Vec<desktop_db::TokenBillingBucket>, String> {
    let g = granularity.unwrap_or_else(|| "day".into());
    with_db(&db, |c| {
        desktop_db::token_billing_series(c, preset_id.as_deref(), from_ms, to_ms, &g)
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetPresetQuotaPayload {
    pub preset_id: String,
    pub hard_limit_cny_micros: i64,
    pub soft_ratio: Option<f64>,
}

#[tauri::command]
pub fn xu_set_preset_quota(
    db: State<'_, FouDb>,
    payload: SetPresetQuotaPayload,
) -> Result<desktop_db::PresetQuotaStatus, String> {
    with_db(&db, |c| {
        desktop_db::set_preset_quota(
            c,
            &payload.preset_id,
            payload.hard_limit_cny_micros,
            payload.soft_ratio,
        )
    })
}

#[tauri::command]
pub fn xu_get_preset_quota(
    db: State<'_, FouDb>,
    preset_id: String,
) -> Result<desktop_db::PresetQuotaStatus, String> {
    with_db(&db, |c| desktop_db::get_preset_quota(c, &preset_id))
}

#[tauri::command]
pub async fn xu_sync_model_pricing(
    db: State<'_, FouDb>,
    url: Option<String>,
) -> Result<crate::pricing::PricingManifest, String> {
    let fetch_url = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let configured =
            desktop_db::setting_get(&conn, crate::pricing::PRICING_MANIFEST_URL_SETTING)?
                .filter(|u| !u.trim().is_empty());
        url.filter(|u| !u.trim().is_empty()).or(configured)
    };
    let Some(fetch_url) = fetch_url else {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        return crate::pricing::load_pricing_manifest(&conn);
    };
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|e| e.to_string())?;
    let text = client
        .get(fetch_url.trim())
        .send()
        .await
        .map_err(|e| format!("拉取价格失败: {e}"))?
        .error_for_status()
        .map_err(|e| format!("价格服务 HTTP 错误: {e}"))?
        .text()
        .await
        .map_err(|e| e.to_string())?;
    let manifest = crate::pricing::parse_pricing_manifest_json(&text)?;
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    crate::pricing::save_pricing_manifest(&conn, &manifest)?;
    Ok(manifest)
}

#[tauri::command]
pub fn xu_pricing_sync_due(db: State<'_, FouDb>) -> Result<bool, String> {
    with_db(&db, |c| Ok(crate::pricing::pricing_sync_due(c)))
}
