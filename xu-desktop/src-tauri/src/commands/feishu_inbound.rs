//! Feishu open-platform long-connection sidecar (meeting sync inbound).
//!
//! @author qiuye <yjk150@qq.com>
//! @date 2026-08-30
//! @version 1.0.0
//! @category Network
//! @algo websocket-singleton

use std::collections::VecDeque;
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::agent::stream::AgentRuntime;
use crate::agent::tool_policy::ProjectToolPolicy;
use crate::commands::channels::{
    feishu_meeting_sync_enabled, feishu_resolve_sender_label_fast, feishu_set_bound_chat_id,
    resolve_feishu_app_creds, show_os_notification,
};
use crate::desktop_db::{self, FouDb, MessageRow};
use crate::employee::dispatch::{xu_emp_dispatch_task, EmpEndpoint};
use crate::xu_paths::hide_command_window;
use crate::AppState;
use crate::StreamChunk;

const DEDUPE_KEY: &str = "feishu.inbound.dedupe";
const WS_STATUS_KEY: &str = "feishu.ws.status";
const OFFICE_SESSION: &str = "office-floor";
const DEDUPE_CAP: usize = 200;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct FeishuWsStatus {
    pub state: String,
    pub last_error: String,
    pub bound_chat_id: String,
    pub last_heartbeat_ms: i64,
    /// Last successfully handled inbound message (0 = never)
    #[serde(default)]
    pub last_inbound_ms: i64,
    pub meeting_sync: bool,
    pub pid: Option<u32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SidecarLine {
    #[serde(rename = "type")]
    kind: String,
    #[serde(default)]
    chat_id: String,
    #[serde(default)]
    message_id: String,
    #[serde(default)]
    sender_open_id: String,
    #[serde(default)]
    sender_type: String,
    #[serde(default)]
    sender_name: String,
    #[serde(default)]
    text: String,
    #[serde(default)]
    mention_names: Vec<String>,
    #[serde(default)]
    state: String,
    #[serde(default)]
    message: String,
    #[serde(default)]
    ts: i64,
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn write_status(db: &FouDb, status: &FeishuWsStatus) {
    if let Ok(conn) = db.0.lock() {
        if let Ok(raw) = serde_json::to_string(status) {
            let _ = desktop_db::setting_set(&conn, WS_STATUS_KEY, &raw);
        }
    }
}

fn read_status(db: &FouDb) -> FeishuWsStatus {
    let (mut s, meeting_sync, bound) = {
        let conn = match db.0.lock() {
            Ok(c) => c,
            Err(_) => return FeishuWsStatus::default(),
        };
        let s: FeishuWsStatus = desktop_db::setting_get(&conn, WS_STATUS_KEY)
            .ok()
            .flatten()
            .and_then(|r| serde_json::from_str(&r).ok())
            .unwrap_or_default();
        let ep = desktop_db::get_channel_endpoint(&conn, "feishu")
            .ok()
            .flatten();
        let mut meeting_sync = false;
        let mut bound = String::new();
        if let Some(ep) = ep {
            let extra =
                serde_json::from_str::<serde_json::Value>(&ep.extra_json).unwrap_or_default();
            meeting_sync = extra
                .get("meetingSync")
                .and_then(|v| v.as_bool())
                .unwrap_or(false)
                && ep.enabled;
            if let Some(cid) = extra.get("chatId").and_then(|v| v.as_str()) {
                bound = cid.to_string();
            }
        }
        (s, meeting_sync, bound)
    };
    s.meeting_sync = meeting_sync;
    if s.bound_chat_id.is_empty() {
        s.bound_chat_id = bound;
    }
    let _ = db; // silence if unused in some paths
    s
}

fn emit_ws(app: &AppHandle, status: &FeishuWsStatus) {
    let _ = app.emit("xu-feishu-ws", status);
}

fn emit_office_refresh(app: &AppHandle) {
    let _ = app.emit(
        "xu:chunk",
        StreamChunk {
            kind: "status".into(),
            content: "office:feishu-inbound".into(),
            session_id: OFFICE_SESSION.into(),
            run_id: "feishu-inbound".into(),
        },
    );
    let _ = app.emit("xu-office-notify", ());
}

fn seen_message(db: &FouDb, message_id: &str) -> bool {
    if message_id.is_empty() {
        return false;
    }
    let conn = match db.0.lock() {
        Ok(c) => c,
        Err(_) => return false,
    };
    let mut ids: VecDeque<String> = desktop_db::setting_get(&conn, DEDUPE_KEY)
        .ok()
        .flatten()
        .and_then(|r| serde_json::from_str(&r).ok())
        .unwrap_or_default();
    if ids.iter().any(|x| x == message_id) {
        return true;
    }
    ids.push_back(message_id.to_string());
    while ids.len() > DEDUPE_CAP {
        ids.pop_front();
    }
    if let Ok(raw) = serde_json::to_string(&ids) {
        let _ = desktop_db::setting_set(&conn, DEDUPE_KEY, &raw);
    }
    false
}

fn strip_verbatim_prefix(p: PathBuf) -> PathBuf {
    let s = p.to_string_lossy();
    // Tauri resource_dir on Windows often returns \\?\E:\... which Node realpathSync breaks (EISDIR on 'E:')
    if let Some(rest) = s.strip_prefix(r"\\?\") {
        PathBuf::from(rest)
    } else {
        p
    }
}

fn resolve_sidecar_dir(app: &AppHandle) -> Result<PathBuf, String> {
    // Prefer repo tools/ first in dev — stable path without \\?\ verbatim prefix
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let dev = manifest.join("..").join("tools").join("feishu-ws");
    if dev.join("index.mjs").is_file() {
        let cleaned = std::fs::canonicalize(&dev)
            .map(strip_verbatim_prefix)
            .unwrap_or_else(|_| strip_verbatim_prefix(dev));
        return Ok(cleaned);
    }
    if let Ok(res) = app.path().resource_dir() {
        let p = res.join("feishu-ws");
        if p.join("index.mjs").is_file() {
            return Ok(strip_verbatim_prefix(p));
        }
    }
    Err("找不到 tools/feishu-ws/index.mjs（请 npm install 并确保资源已打包）".into())
}

fn ensure_node_modules(dir: &PathBuf) -> Result<(), String> {
    if dir.join("node_modules").join("@larksuiteoapi").is_dir() {
        return Ok(());
    }
    let mut cmd = Command::new("npm");
    hide_command_window(cmd.args(["install", "--omit=dev"]).current_dir(dir));
    let out = cmd
        .output()
        .map_err(|e| format!("npm install 失败（需本机 Node）: {e}"))?;
    if !out.status.success() {
        return Err(format!(
            "npm install 退出码 {:?}: {}",
            out.status.code(),
            String::from_utf8_lossy(&out.stderr)
                .chars()
                .take(200)
                .collect::<String>()
        ));
    }
    Ok(())
}

fn find_employee_by_mention(
    employees: &[desktop_db::EmployeeRow],
    mentions: &[String],
    text: &str,
) -> Option<desktop_db::EmployeeRow> {
    let mut candidates: Vec<String> = mentions
        .iter()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();
    // Fallback: @Name in body
    let re = regex::Regex::new(r"@([^\s@，,。.!！？?：:]{1,32})").ok();
    if let Some(re) = re {
        for cap in re.captures_iter(text) {
            if let Some(m) = cap.get(1) {
                let n = m.as_str().trim().to_string();
                if !n.is_empty() && !candidates.iter().any(|c| c == &n) {
                    candidates.push(n);
                }
            }
        }
    }
    for name in &candidates {
        if let Some(emp) = employees.iter().find(|e| e.name == *name) {
            return Some(emp.clone());
        }
    }
    for name in &candidates {
        if let Some(emp) = employees
            .iter()
            .find(|e| e.name.contains(name) || name.contains(&e.name))
        {
            return Some(emp.clone());
        }
    }
    None
}

fn strip_at_mentions(text: &str, emp_name: &str) -> String {
    let mut t = text.to_string();
    for pat in [format!("@{emp_name}"), format!("@ {emp_name}")] {
        t = t.replace(&pat, "");
    }
    // Drop @_user_N placeholders
    if let Ok(re) = regex::Regex::new(r"@_user_\d+") {
        t = re.replace_all(&t, "").to_string();
    }
    t.split_whitespace().collect::<Vec<_>>().join(" ")
}

pub(crate) fn resolve_endpoint_for_employee(
    emp: &desktop_db::EmployeeRow,
    db: &FouDb,
) -> Result<EmpEndpoint, String> {
    #[derive(Debug, Deserialize, Default)]
    #[serde(rename_all = "camelCase")]
    struct LocalModelProfile {
        #[serde(default)]
        text_model: String,
        #[serde(default)]
        base_url: String,
    }

    #[derive(Debug, Deserialize, Default)]
    #[serde(rename_all = "camelCase")]
    struct RemoteModelPreset {
        #[serde(default)]
        text_model: String,
        #[serde(default)]
        base_url: String,
        #[serde(default)]
        api_key_env: String,
        #[serde(default)]
        provider: String,
        #[serde(default)]
        is_default: bool,
    }

    #[derive(Debug, Deserialize, Default)]
    #[serde(rename_all = "camelCase")]
    struct GlobalModelProfiles {
        #[serde(default)]
        default_source: String,
        #[serde(default)]
        local: LocalModelProfile,
        #[serde(default)]
        remote_presets: Vec<RemoteModelPreset>,
    }

    fn pick_remote<'a>(presets: &'a [RemoteModelPreset]) -> Option<&'a RemoteModelPreset> {
        presets
            .iter()
            .find(|p| p.is_default)
            .or_else(|| presets.first())
    }

    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let profiles_raw = desktop_db::setting_get(&conn, "xu.global_model_profiles")?;
    let brains = desktop_db::get_ops_brains(&conn)?;
    drop(conn);

    let (source, profile_model, profile_base_url, profile_api_key_env, provider) =
        if let Some(raw) = profiles_raw {
            let profiles: GlobalModelProfiles = serde_json::from_str(&raw).unwrap_or_default();
            let use_local = profiles.default_source.trim() == "local";
            if use_local {
                let model = profiles.local.text_model.trim().to_string();
                let url = if profiles.local.base_url.trim().is_empty() {
                    "http://127.0.0.1:11434/v1".into()
                } else {
                    profiles.local.base_url.trim().to_string()
                };
                (
                    "local".to_string(),
                    model,
                    url,
                    String::new(),
                    "custom".into(),
                )
            } else if let Some(preset) = pick_remote(&profiles.remote_presets) {
                (
                    "remote".to_string(),
                    preset.text_model.trim().to_string(),
                    preset.base_url.trim().to_string(),
                    preset.api_key_env.trim().to_string(),
                    if preset.provider.trim().is_empty() {
                        "custom".into()
                    } else {
                        preset.provider.trim().to_string()
                    },
                )
            } else {
                let slot = emp.brain_slot.trim();
                let slot_cfg = match slot {
                    "command" => &brains.command,
                    "code" => &brains.code,
                    _ => &brains.work,
                };
                (
                    slot_cfg.source.clone(),
                    slot_cfg.model.trim().to_string(),
                    if slot_cfg.source == "local" {
                        "http://127.0.0.1:11434/v1".into()
                    } else {
                        slot_cfg.base_url.trim().to_string()
                    },
                    if slot_cfg.source == "local" {
                        String::new()
                    } else {
                        slot_cfg.api_key_env.trim().to_string()
                    },
                    if slot_cfg.provider.trim().is_empty() {
                        "custom".into()
                    } else {
                        slot_cfg.provider.trim().to_string()
                    },
                )
            }
        } else {
            let slot = emp.brain_slot.trim();
            let slot_cfg = match slot {
                "command" => &brains.command,
                "code" => &brains.code,
                _ => &brains.work,
            };
            (
                slot_cfg.source.clone(),
                slot_cfg.model.trim().to_string(),
                if slot_cfg.source == "local" {
                    "http://127.0.0.1:11434/v1".into()
                } else {
                    slot_cfg.base_url.trim().to_string()
                },
                if slot_cfg.source == "local" {
                    String::new()
                } else {
                    slot_cfg.api_key_env.trim().to_string()
                },
                if slot_cfg.provider.trim().is_empty() {
                    "custom".into()
                } else {
                    slot_cfg.provider.trim().to_string()
                },
            )
        };

    let model = if !emp.ai_model.trim().is_empty() {
        emp.ai_model.trim().to_string()
    } else {
        profile_model
    };
    let base_url = if !emp.ai_base_url.trim().is_empty() {
        emp.ai_base_url.trim().to_string()
    } else if source == "local" {
        if profile_base_url.trim().is_empty() {
            "http://127.0.0.1:11434/v1".into()
        } else {
            profile_base_url
        }
    } else {
        profile_base_url
    };
    let api_key_env = if source == "local" {
        String::new()
    } else {
        profile_api_key_env
    };
    if model.is_empty() || base_url.is_empty() {
        return Err(format!(
            "员工「{}」未配置模型/baseUrl，请先在设置 → 模型中完成配置",
            emp.name
        ));
    }
    let slot = emp.brain_slot.trim();
    Ok(EmpEndpoint {
        provider,
        model,
        base_url,
        api_key_env,
        brain_slot: if slot.is_empty() {
            "work".into()
        } else {
            slot.into()
        },
    })
}

fn im_write_confirmed(task: &str) -> bool {
    let t: String = task.chars().filter(|c| !c.is_whitespace()).collect();
    t.contains("确认写盘")
        || t.contains("可以改文件")
        || t.contains("确认开工")
        || t.contains("允许写入")
        || t.contains("确认开写")
}

fn is_broadcast_text(text: &str, mention_names: &[String]) -> bool {
    let t = text.to_lowercase();
    if t.contains("@_all") || t.contains("@所有人") || t.contains("@全部") {
        return true;
    }
    // Explicit human @names take priority over broadcast
    if !mention_names.is_empty() {
        return false;
    }
    false
}

fn normalize_inbound_text(raw: &str) -> String {
    let mut text = raw.trim().to_string();
    if let Ok(re) = regex::Regex::new(r"@_(?:user|bot)_\d+") {
        text = re.replace_all(&text, "").to_string();
    }
    text = text.replace("@_all", "@所有人");
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn broadcast_feishu_to_employees(
    app: &AppHandle,
    db: &FouDb,
    text: &str,
    employees: &[desktop_db::EmployeeRow],
) {
    let workers: Vec<_> = employees
        .iter()
        .filter(|e| e.role_kind != "boss")
        .cloned()
        .collect();
    if workers.is_empty() {
        eprintln!("[xu] feishu broadcast: no workers on roster");
        return;
    }
    let preview: String = text.chars().take(60).collect();
    // One summary line only — never N× ack messages (that freezes the office strip / WebGL)
    let sample: String = workers
        .iter()
        .take(4)
        .map(|e| e.name.as_str())
        .collect::<Vec<_>>()
        .join("、");
    let more = if workers.len() > 4 {
        format!("等 {} 人", workers.len())
    } else {
        format!("{} 人", workers.len())
    };
    {
        let conn = match db.0.lock() {
            Ok(c) => c,
            Err(_) => return,
        };
        let _ = desktop_db::append_message(
            &conn,
            &MessageRow {
                id: format!("om_fs_bc_{}", now_ms()),
                session_tag: OFFICE_SESSION.into(),
                employee_id: None,
                role: "system".into(),
                content: format!(
                    "📢 飞书广播已送达 {more}（{sample}）：{preview}。具体派活请 @员工花名。",
                ),
                image_path: None,
                created_at: now_ms(),
            },
        );
    }
    emit_office_refresh(app);
    eprintln!(
        "[xu] feishu broadcast summary for {} workers",
        workers.len()
    );
}

fn handle_inbound_message(app: &AppHandle, db: &FouDb, line: SidecarLine) {
    if seen_message(db, &line.message_id) {
        return;
    }
    // Skip our own bot echoes (avoid mirror loop); still accept human / other bots
    if line.sender_type.eq_ignore_ascii_case("app") {
        eprintln!(
            "[xu] feishu inbound skip app/bot message id={}",
            line.message_id
        );
        return;
    }
    let mut text = normalize_inbound_text(&line.text);
    if text.is_empty() {
        // 仍写入办公室，方便看到「有人说话了」
        text = "（一条群消息）".into();
    }

    // 1) 本机提示：先通知老板有消息到了
    let preview: String = text.chars().take(80).collect();
    let _ = show_os_notification(app, "飞书有消息到了！", &preview);
    eprintln!("[xu] feishu inbound notify: {preview}");

    if !line.chat_id.is_empty() {
        let _ = feishu_set_bound_chat_id(db, &line.chat_id);
    }

    // Prefer cached/hint name first so UI gets the message immediately;
    // full open-api name fetch can be slow and must not block append.
    let sender_label =
        feishu_resolve_sender_label_fast(db, &line.sender_open_id, &line.sender_name);
    let is_boss = sender_label.starts_with("Boss");
    let role = if is_boss { "boss" } else { "feishu" };

    let content = format!("飞书｜{sender_label}：{text}");

    {
        let conn = match db.0.lock() {
            Ok(c) => c,
            Err(_) => return,
        };
        match desktop_db::append_message(
            &conn,
            &MessageRow {
                id: format!(
                    "om_fs_{}",
                    if line.message_id.is_empty() {
                        now_ms().to_string()
                    } else {
                        line.message_id.clone()
                    }
                ),
                session_tag: OFFICE_SESSION.into(),
                employee_id: None,
                role: role.into(),
                content: content.clone(),
                image_path: None,
                created_at: now_ms(),
            },
        ) {
            Ok(()) => eprintln!("[xu] feishu inbound saved office-floor: {content}"),
            Err(e) => eprintln!("[xu] feishu inbound append FAILED: {e}"),
        }
    }
    emit_office_refresh(app);

    if is_boss {
        let _ = app.emit(
            "xu-boss-inbound",
            serde_json::json!({ "text": text, "source": "feishu" }),
        );
    }

    // Record inbound for Connections diagnostics
    {
        let mut st = read_status(db);
        st.last_inbound_ms = now_ms();
        st.state = "connected".into();
        st.last_error = String::new();
        write_status(db, &st);
        emit_ws(app, &st);
    }

    let employees = {
        let conn = match db.0.lock() {
            Ok(c) => c,
            Err(_) => return,
        };
        desktop_db::list_employees(&conn).unwrap_or_default()
    };

    if is_broadcast_text(&text, &line.mention_names) {
        broadcast_feishu_to_employees(app, db, &text, &employees);
        return;
    }

    let Some(emp) = find_employee_by_mention(&employees, &line.mention_names, &text) else {
        eprintln!(
            "[xu] feishu inbound office-only (no @employee match) — already on office strip"
        );
        return;
    };
    let workspace = emp.workspace_root.clone().unwrap_or_default();
    if workspace.trim().is_empty() {
        let conn = match db.0.lock() {
            Ok(c) => c,
            Err(_) => return,
        };
        let _ = desktop_db::append_message(
            &conn,
            &MessageRow {
                id: format!("om_fs_err_{}", now_ms()),
                session_tag: OFFICE_SESSION.into(),
                employee_id: Some(emp.id.clone()),
                role: "assistant".into(),
                content: format!("【{}】未设置工作区，无法派活", emp.name),
                image_path: None,
                created_at: now_ms(),
            },
        );
        emit_office_refresh(app);
        let _ = show_os_notification(app, "飞书派活失败", &format!("{} 未设置工作区", emp.name));
        return;
    }
    let endpoint = match resolve_endpoint_for_employee(&emp, db) {
        Ok(e) => e,
        Err(err) => {
            let conn = match db.0.lock() {
                Ok(c) => c,
                Err(_) => return,
            };
            let _ = desktop_db::append_message(
                &conn,
                &MessageRow {
                    id: format!("om_fs_err_{}", now_ms()),
                    session_tag: OFFICE_SESSION.into(),
                    employee_id: Some(emp.id.clone()),
                    role: "assistant".into(),
                    content: format!("【{}】{err}", emp.name),
                    image_path: None,
                    created_at: now_ms(),
                },
            );
            emit_office_refresh(app);
            let _ = show_os_notification(app, "飞书派活失败", &err);
            return;
        }
    };
    let task = strip_at_mentions(&text, &emp.name);
    if task.is_empty() {
        return;
    }
    let allow_write = im_write_confirmed(&task);
    let policy = if allow_write {
        None
    } else {
        Some(ProjectToolPolicy::conservative())
    };
    let _ = show_os_notification(
        app,
        "正在分发给员工",
        &format!(
            "{} ← {}",
            emp.name,
            task.chars().take(60).collect::<String>()
        ),
    );
    let write_note = if allow_write {
        String::new()
    } else {
        "\n【通道策略】来自飞书，未口令确认写盘，本轮只读。老板再说「确认写盘」或「确认开工」后才可改文件。"
            .into()
    };
    let composed = format!("【工作区边界】可写根：{workspace}\n【飞书群派活】\n{task}{write_note}");
    let app2 = app.clone();
    let emp_id = emp.id.clone();
    let emp_name = emp.name.clone();
    let ws = workspace.trim().to_string();
    std::thread::spawn(move || {
        let db = app2.state::<FouDb>();
        let runtime = app2.state::<AgentRuntime>();
        if let Err(e) = xu_emp_dispatch_task(
            app2.clone(),
            db,
            runtime,
            emp_id,
            task,
            Some(false),
            None,
            Some(false),
            None,
            endpoint,
            ws,
            composed,
            None,
            None,
            policy,
            None,
        ) {
            eprintln!("[xu] feishu inbound dispatch failed: {e}");
            let _ = show_os_notification(&app2, "飞书派活失败", &format!("{emp_name}: {e}"));
        }
    });
}

fn spawn_reader(app: AppHandle, mut child: Child) {
    let stdout = match child.stdout.take() {
        Some(s) => s,
        None => {
            let _ = child.kill();
            return;
        }
    };
    let stderr = child.stderr.take();
    {
        let state = app.state::<AppState>();
        let mut slot = state.feishu_ws_child.lock().unwrap();
        if let Some(mut old) = slot.take() {
            let _ = old.kill();
        }
        *slot = Some(child);
    }
    if let Some(err) = stderr {
        let app_err = app.clone();
        std::thread::spawn(move || {
            let reader = BufReader::new(err);
            let mut buf = String::new();
            for line in reader.lines().flatten() {
                let t = line.trim();
                if t.is_empty() {
                    continue;
                }
                eprintln!("[xu] feishu-ws stderr: {t}");
                buf.push_str(t);
                buf.push('\n');
                if buf.len() > 4000 {
                    buf = buf[buf.len() - 2000..].to_string();
                }
                let lower = t.to_lowercase();
                if lower.contains("persistent connection")
                    || t.contains("长连接")
                    || t.contains("Receive events/callbacks through persistent connection")
                {
                    let db = app_err.state::<FouDb>();
                    let mut st = read_status(&db);
                    st.state = "need_console_config".into();
                    st.last_error = "开放平台须选「使用长连接接收事件」，保存时虚募阁要开着".into();
                    write_status(&db, &st);
                    emit_ws(&app_err, &st);
                    let _ = show_os_notification(
                        &app_err,
                        "飞书长连接未在开放平台配置",
                        "开发者后台 → 事件与回调 → 订阅方式 → 使用长连接接收事件（保存时虚募阁须开着）",
                    );
                }
            }
        });
    }
    std::thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines() {
            let Ok(line) = line else { break };
            let line = line.trim();
            if line.is_empty() {
                continue;
            }
            let parsed: SidecarLine = match serde_json::from_str(line) {
                Ok(v) => v,
                Err(e) => {
                    eprintln!("[xu] feishu-ws NDJSON parse error: {e}");
                    continue;
                }
            };
            // Heartbeats are silent — logging + DB write + emit every tick freezes the app over time
            if parsed.kind == "heartbeat" {
                static LAST_HB_FLUSH: std::sync::atomic::AtomicI64 =
                    std::sync::atomic::AtomicI64::new(0);
                let now = now_ms();
                let prev = LAST_HB_FLUSH.load(std::sync::atomic::Ordering::Relaxed);
                if now - prev < 60_000 {
                    continue;
                }
                LAST_HB_FLUSH.store(now, std::sync::atomic::Ordering::Relaxed);
                let db = app.state::<FouDb>();
                let mut st = read_status(&db);
                st.state = if st.state.is_empty() || st.state == "starting" {
                    "connected".into()
                } else {
                    st.state
                };
                st.last_heartbeat_ms = if parsed.ts > 0 { parsed.ts } else { now };
                if let Ok(guard) = app.state::<AppState>().feishu_ws_child.lock() {
                    st.pid = guard.as_ref().map(|c| c.id());
                }
                st.meeting_sync = true;
                write_status(&db, &st);
                emit_ws(&app, &st);
                continue;
            }
            eprintln!(
                "[xu] feishu-ws << {}",
                line.chars().take(240).collect::<String>()
            );
            let db = app.state::<FouDb>();
            match parsed.kind.as_str() {
                "message" => {
                    if feishu_meeting_sync_enabled(&db) {
                        handle_inbound_message(&app, &db, parsed);
                    } else {
                        eprintln!("[xu] feishu inbound ignored (开会同步未开启)");
                        let _ = show_os_notification(
                            &app,
                            "飞书消息未处理",
                            "请在连接页打开「开会同步」",
                        );
                    }
                }
                "hint" | "debug" => {
                    if !parsed.message.is_empty() {
                        eprintln!("[xu] feishu-ws {}: {}", parsed.kind, parsed.message);
                    }
                    if parsed.kind == "hint" {
                        let mut st = read_status(&db);
                        st.last_error = parsed.message.clone();
                        write_status(&db, &st);
                        emit_ws(&app, &st);
                    }
                }
                "status" | "error" => {
                    let mut st = read_status(&db);
                    if parsed.kind == "status" && !parsed.state.is_empty() {
                        st.state = parsed.state.clone();
                        if parsed.state == "connected" {
                            let _ = show_os_notification(
                                &app,
                                "飞书长连接已就绪",
                                "群消息会先本机提示，再进办公室",
                            );
                        }
                    }
                    if parsed.kind == "error" {
                        st.state = "error".into();
                        st.last_error = parsed.message.clone();
                        let _ = show_os_notification(&app, "飞书长连接错误", &parsed.message);
                    }
                    if let Ok(guard) = app.state::<AppState>().feishu_ws_child.lock() {
                        st.pid = guard.as_ref().map(|c| c.id());
                    }
                    st.meeting_sync = true;
                    write_status(&db, &st);
                    emit_ws(&app, &st);
                }
                _ => {}
            }
        }
        // Process ended
        {
            let state = app.state::<AppState>();
            let mut slot = state.feishu_ws_child.lock().unwrap();
            *slot = None;
        }
        let db = app.state::<FouDb>();
        let mut st = read_status(&db);
        st.state = "stopped".into();
        st.pid = None;
        write_status(&db, &st);
        emit_ws(&app, &st);
        eprintln!("[xu] feishu-ws sidecar exited");
        // Auto-restart while meeting sync is on (e.g. after tools/feishu-ws hot edit)
        let app_restart = app.clone();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(600));
            match start_feishu_ws_if_needed(&app_restart) {
                Ok(()) => eprintln!("[xu] feishu-ws auto-restart ok"),
                Err(e) => eprintln!("[xu] feishu-ws auto-restart: {e}"),
            }
        });
    });
}

fn kill_orphan_feishu_ws_nodes(keep_pid: Option<u32>) {
    // Best-effort: cargo/HMR restarts leave node holding Feishu's single long-connection slot
    #[cfg(windows)]
    {
        let keep = keep_pid.unwrap_or(0);
        let script = format!(
            "Get-CimInstance Win32_Process -Filter \"name='node.exe'\" | Where-Object {{ $_.CommandLine -match 'feishu-ws' -and $_.ProcessId -ne {keep} }} | ForEach-Object {{ Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }}"
        );
        let mut cmd = Command::new("powershell");
        hide_command_window(cmd.args(["-NoProfile", "-Command", &script]));
        let _ = cmd.output();
    }
    #[cfg(not(windows))]
    {
        let _ = keep_pid;
        let mut cmd = Command::new("pkill");
        let _ = cmd.args(["-f", "feishu-ws/index.mjs"]).output();
    }
}

/// Public hook for app shutdown / Ctrl+C — wipe every feishu-ws node.
pub fn reap_orphan_feishu_ws() {
    kill_orphan_feishu_ws_nodes(None);
}

pub fn stop_feishu_ws(app: &AppHandle) {
    let state = app.state::<AppState>();
    if let Some(mut child) = state.feishu_ws_child.lock().unwrap().take() {
        let _ = child.kill();
        let _ = child.wait();
    }
    kill_orphan_feishu_ws_nodes(None);
    if let Some(db) = app.try_state::<FouDb>() {
        let mut st = read_status(&db);
        st.state = "stopped".into();
        st.pid = None;
        st.meeting_sync = feishu_meeting_sync_enabled(&db);
        write_status(&db, &st);
        emit_ws(app, &st);
    }
}

/// Kill tracked + orphan sidecars, then start fresh (recovers stolen long-connection slot).
pub fn restart_feishu_ws(app: &AppHandle) -> Result<(), String> {
    eprintln!("[xu] feishu-ws force restart…");
    stop_feishu_ws(app);
    std::thread::sleep(Duration::from_millis(700));
    start_feishu_ws_if_needed(app)
}

pub fn start_feishu_ws_if_needed(app: &AppHandle) -> Result<(), String> {
    let db = app.state::<FouDb>();
    if !feishu_meeting_sync_enabled(&db) {
        eprintln!(
            "[xu] feishu-ws skip: 开会同步未开启（连接页打开「开会同步」或重新保存开放平台凭证）"
        );
        stop_feishu_ws(app);
        return Ok(());
    }
    let (app_id, app_secret, _chat, mode) = resolve_feishu_app_creds(&db);
    if mode != "app" || !app_id.starts_with("cli_") || app_secret.is_empty() {
        let msg = "开会同步需要飞书开放平台 App ID + App Secret".to_string();
        eprintln!("[xu] feishu-ws skip: {msg}");
        return Err(msg);
    }

    let keep_pid = {
        let state = app.state::<AppState>();
        let mut guard = state.feishu_ws_child.lock().unwrap();
        if let Some(child) = guard.as_mut() {
            match child.try_wait() {
                Ok(None) => Some(child.id()),
                Ok(Some(_)) | Err(_) => {
                    *guard = None;
                    None
                }
            }
        } else {
            None
        }
    };
    // Always reap orphans from prior cargo/HMR crashes (Feishu allows only ONE long connection)
    kill_orphan_feishu_ws_nodes(keep_pid);
    if let Some(pid) = keep_pid {
        eprintln!("[xu] feishu-ws already running pid={pid}");
        return Ok(());
    }

    let dir = resolve_sidecar_dir(app)?;
    eprintln!("[xu] feishu-ws sidecar dir={}", dir.display());
    ensure_node_modules(&dir)?;
    let entry = strip_verbatim_prefix(dir.join("index.mjs"));
    let entry_arg = entry.to_string_lossy().to_string();
    if !entry.is_file() {
        return Err(format!("sidecar 入口不存在: {entry_arg}"));
    }

    let mut cmd = Command::new("node");
    hide_command_window(
        cmd.arg(&entry_arg)
            .env("FEISHU_APP_ID", &app_id)
            .env("FEISHU_APP_SECRET", &app_secret)
            .current_dir(&dir)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .stdin(Stdio::null()),
    );
    let child = cmd
        .spawn()
        .map_err(|e| format!("启动飞书长连接失败（需本机安装 Node）: {e}"))?;
    eprintln!("[xu] feishu-ws spawned pid={}", child.id());

    let mut st = FeishuWsStatus {
        state: "starting".into(),
        last_error: String::new(),
        bound_chat_id: String::new(),
        last_heartbeat_ms: now_ms(),
        last_inbound_ms: read_status(&db).last_inbound_ms,
        meeting_sync: true,
        pid: Some(child.id()),
    };
    {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        if let Ok(Some(ep)) = desktop_db::get_channel_endpoint(&conn, "feishu") {
            let extra: serde_json::Value = serde_json::from_str(&ep.extra_json).unwrap_or_default();
            if let Some(cid) = extra.get("chatId").and_then(|v| v.as_str()) {
                st.bound_chat_id = cid.to_string();
            }
        }
    }
    write_status(&db, &st);
    emit_ws(app, &st);
    spawn_reader(app.clone(), child);
    Ok(())
}

#[tauri::command]
pub fn xu_feishu_ws_status(
    db: State<'_, FouDb>,
    app: AppHandle,
) -> Result<FeishuWsStatus, String> {
    let mut st = read_status(&db);
    if let Ok(guard) = app.state::<AppState>().feishu_ws_child.lock() {
        st.pid = guard.as_ref().map(|c| c.id());
        if guard.is_some() && (st.state.is_empty() || st.state == "stopped") {
            st.state = "running".into();
        }
    }
    st.meeting_sync = feishu_meeting_sync_enabled(&db);
    Ok(st)
}

#[tauri::command]
pub fn xu_feishu_meeting_sync_set(
    app: AppHandle,
    db: State<'_, FouDb>,
    enabled: bool,
) -> Result<FeishuWsStatus, String> {
    crate::commands::channels::feishu_set_meeting_sync(&db, enabled)?;
    if enabled {
        start_feishu_ws_if_needed(&app)?;
    } else {
        stop_feishu_ws(&app);
    }
    // brief settle
    std::thread::sleep(Duration::from_millis(80));
    xu_feishu_ws_status(db, app)
}

#[tauri::command]
pub fn xu_feishu_ws_ensure(app: AppHandle) -> Result<FeishuWsStatus, String> {
    start_feishu_ws_if_needed(&app)?;
    let db = app.state::<FouDb>();
    xu_feishu_ws_status(db, app.clone())
}

#[tauri::command]
pub fn xu_feishu_ws_restart(app: AppHandle) -> Result<FeishuWsStatus, String> {
    restart_feishu_ws(&app)?;
    std::thread::sleep(Duration::from_millis(200));
    xu_feishu_ws_status(app.state::<FouDb>(), app.clone())
}
