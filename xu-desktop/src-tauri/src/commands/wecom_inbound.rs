//! 企微客服入站轮询与人工确认发送。
//!
//! @file wecom_inbound.rs
//! @author qiuye <yjk150@qq.com>
//! @date 2026-09-02
//! @version 0.1.0
//! @category Network
//! @algo wecom-kf-sidecar-poll

use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Command, Stdio};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::commands::channels::{
    show_os_notification, wecom_kf_credentials, wecom_kf_sync_enabled, wecom_set_kf_sync,
};
use crate::commands::feishu_inbound::resolve_endpoint_for_employee;
use crate::employee::dispatch::xu_emp_dispatch_task;
use crate::agent::stream::AgentRuntime;
use crate::desktop_db::{self, FouDb, MessageRow};
use crate::xu_paths::hide_command_window;
use crate::AppState;

const WS_STATUS_KEY: &str = "wecom.kf.status";
const DRAFT_PREFIX: &str = "wecom.kf.draft.";
const OFFICE_SESSION: &str = "office-floor";
const KF_DEFAULT_EMP_KEY: &str = "wecom.kf.default_employee_id";

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct WecomKfStatus {
    pub state: String,
    pub last_error: String,
    pub kf_sync: bool,
    pub open_kfid: String,
    pub last_inbound_ms: i64,
    pub pid: Option<u32>,
    pub pending_drafts: usize,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SidecarLine {
    #[serde(rename = "type")]
    kind: String,
    #[serde(default)]
    message: String,
    #[serde(default)]
    msg_id: String,
    #[serde(default)]
    external_userid: String,
    #[serde(default)]
    open_kfid: String,
    #[serde(default)]
    text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KfDraft {
    pub msg_id: String,
    pub external_userid: String,
    pub open_kfid: String,
    pub customer_text: String,
    pub draft_reply: String,
    pub updated_at: i64,
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn sidecar_script(app: &AppHandle) -> Option<PathBuf> {
    let resource = app.path().resource_dir().ok()?;
    let p = resource.join("wecom-kf").join("index.mjs");
    if p.exists() {
        return Some(p);
    }
    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("tools")
        .join("wecom-kf")
        .join("index.mjs");
    if dev.exists() {
        Some(dev)
    } else {
        None
    }
}

fn load_status(db: &FouDb) -> WecomKfStatus {
    let conn = match db.0.lock() {
        Ok(c) => c,
        Err(_) => return WecomKfStatus::default(),
    };
    let raw = desktop_db::setting_get(&conn, WS_STATUS_KEY)
        .ok()
        .flatten()
        .unwrap_or_default();
    serde_json::from_str(&raw).unwrap_or_default()
}

fn save_status(db: &FouDb, st: &WecomKfStatus) {
    if let Ok(conn) = db.0.lock() {
        let _ = desktop_db::setting_set(
            &conn,
            WS_STATUS_KEY,
            &serde_json::to_string(st).unwrap_or_default(),
        );
    }
}

fn draft_key(msg_id: &str) -> String {
    format!("{DRAFT_PREFIX}{msg_id}")
}

fn list_draft_count(db: &FouDb) -> usize {
    let conn = match db.0.lock() {
        Ok(c) => c,
        Err(_) => return 0,
    };
    desktop_db::list_settings_prefixed(&conn, DRAFT_PREFIX)
        .map(|rows| rows.iter().filter(|(_, v)| !v.trim().is_empty()).count())
        .unwrap_or(0)
}

fn store_draft(db: &FouDb, draft: &KfDraft) {
    if let Ok(conn) = db.0.lock() {
        let key = draft_key(&draft.msg_id);
        let _ = desktop_db::setting_set(
            &conn,
            &key,
            &serde_json::to_string(draft).unwrap_or_default(),
        );
    }
}

fn load_draft(db: &FouDb, msg_id: &str) -> Option<KfDraft> {
    let conn = db.0.lock().ok()?;
    let raw = desktop_db::setting_get(&conn, &draft_key(msg_id)).ok()??;
    serde_json::from_str(&raw).ok()
}

fn clear_draft(db: &FouDb, msg_id: &str) {
    if let Ok(conn) = db.0.lock() {
        let _ = desktop_db::setting_set(&conn, &draft_key(msg_id), "");
    }
}

fn append_office_system(db: &FouDb, content: &str) {
    if let Ok(conn) = db.0.lock() {
        let _ = desktop_db::append_message(
            &conn,
            &MessageRow {
                id: format!("om_wc_{}", now_ms()),
                session_tag: OFFICE_SESSION.into(),
                employee_id: None,
                role: "system".into(),
                content: content.into(),
                image_path: None,
                created_at: now_ms(),
            },
        );
    }
}

fn handle_inbound(db: &FouDb, app: &AppHandle, line: &SidecarLine) {
    let customer = line.text.trim();
    if customer.is_empty() {
        return;
    }
    let msg_id = if line.msg_id.is_empty() {
        format!("wc_{}", now_ms())
    } else {
        line.msg_id.clone()
    };
    let draft = KfDraft {
        msg_id: msg_id.clone(),
        external_userid: line.external_userid.clone(),
        open_kfid: line.open_kfid.clone(),
        customer_text: customer.to_string(),
        draft_reply: String::new(),
        updated_at: now_ms(),
    };
    store_draft(db, &draft);
    let preview: String = customer.chars().take(80).collect();
    append_office_system(
        db,
        &format!(
            "【企微客服】客户：{preview}\n请在「连接 → 企业微信」填写回复并确认发送（编号 {msg_id}）。"
        ),
    );
    let _ = app.emit(
        "xu-wecom-kf-inbound",
        serde_json::json!({
            "msgId": msg_id,
            "text": customer,
            "externalUserid": line.external_userid,
        }),
    );
    let _ = show_os_notification(app, "企微客服", &format!("新客户消息：{preview}"));
    let mut st = load_status(db);
    st.last_inbound_ms = now_ms();
    st.pending_drafts = list_draft_count(db);
    save_status(db, &st);
    spawn_kf_draft_dispatch(app.clone(), db.clone(), msg_id.clone(), customer.to_string());
}

fn kf_role_matches(role: &str) -> bool {
    let r = role.to_ascii_lowercase();
    ["support", "customer", "wecom", "客服", "scrm", "service"]
        .iter()
        .any(|k| r.contains(k))
}

fn resolve_kf_employee(db: &FouDb) -> Option<desktop_db::EmployeeRow> {
    let conn = db.0.lock().ok()?;
    if let Ok(Some(id)) = desktop_db::setting_get(&conn, KF_DEFAULT_EMP_KEY) {
        let id = id.trim();
        if !id.is_empty() {
            let employees = desktop_db::list_employees(&conn).ok()?;
            if let Some(emp) = employees.into_iter().find(|e| e.id == id) {
                return Some(emp);
            }
        }
    }
    let employees = desktop_db::list_employees(&conn).ok()?;
    employees
        .iter()
        .find(|e| kf_role_matches(&e.role))
        .cloned()
        .or_else(|| employees.first().cloned())
}

/// QA 完成后把员工回复写入企微客服草稿。
pub fn apply_kf_draft_from_qa(db: &FouDb, user_text: &str, body: &str) {
    let Some(marker) = user_text.split("msg_id=").nth(1) else {
        return;
    };
    let msg_id: String = marker
        .chars()
        .take_while(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-')
        .collect();
    if msg_id.is_empty() {
        return;
    }
    let reply = body
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .take(12)
        .collect::<Vec<_>>()
        .join("\n");
    if reply.is_empty() {
        return;
    }
    if let Some(mut d) = load_draft(db, &msg_id) {
        d.draft_reply = reply;
        d.updated_at = now_ms();
        store_draft(db, &d);
    }
}

fn spawn_kf_draft_dispatch(app: AppHandle, db: FouDb, msg_id: String, customer: String) {
    let Some(emp) = resolve_kf_employee(&db) else {
        return;
    };
    let workspace = emp
        .workspace_root
        .clone()
        .filter(|w| !w.trim().is_empty())
        .unwrap_or_else(|| {
            std::env::var("USERPROFILE")
                .or_else(|_| std::env::var("HOME"))
                .unwrap_or_else(|_| ".".into())
        });
    let endpoint = match resolve_endpoint_for_employee(&emp, &db) {
        Ok(e) => e,
        Err(e) => {
            eprintln!("[xu] wecom kf dispatch endpoint: {e}");
            return;
        }
    };
    let task = format!(
        "【企微客服草稿 msg_id={msg_id}】客户说：{customer}\n请起草 200 字以内客服回复，语气专业友好。只输出回复正文，不要发送、不要 JSON。"
    );
    let composed = format!(
        "【企微客服草稿 msg_id={msg_id}】\n【企微客服 · 起草回复】\n客户原文：{customer}\n\n请直接给出可发送的回复正文（200 字内）。"
    );
    let emp_id = emp.id.clone();
    std::thread::spawn(move || {
        let db_state = app.state::<FouDb>();
        let runtime = app.state::<AgentRuntime>();
        if let Err(e) = xu_emp_dispatch_task(
            app.clone(),
            db_state,
            runtime,
            emp_id,
            task,
            Some(true),
            None,
            Some(true),
            None,
            endpoint,
            workspace,
            composed,
            None,
            None,
            Some(crate::agent::tool_policy::ProjectToolPolicy::conservative()),
            None,
        ) {
            eprintln!("[xu] wecom kf draft dispatch failed: {e}");
        }
    });
}

fn which_node() -> &'static str {
    if cfg!(windows) {
        "node.exe"
    } else {
        "node"
    }
}

fn build_status(db: &FouDb) -> WecomKfStatus {
    let mut st = load_status(db);
    st.kf_sync = wecom_kf_sync_enabled(db);
    st.pending_drafts = list_draft_count(db);
    st
}

fn spawn_sidecar(app: &AppHandle, db: &FouDb) -> Result<(), String> {
    let (corp, secret, kf) = wecom_kf_credentials(db).ok_or("企微客服凭证未配置或未启用")?;
    let script = sidecar_script(app).ok_or("wecom-kf sidecar 脚本未找到")?;
    let mut child = Command::new(which_node());
    hide_command_window(child.arg(&script));
    child
        .env("WECOM_CORP_ID", &corp)
        .env("WECOM_KF_SECRET", &secret)
        .env("WECOM_OPEN_KFID", &kf)
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .stdin(Stdio::piped());
    let mut child = child.spawn().map_err(|e| format!("启动 wecom-kf 失败：{e}"))?;
    let stdout = child.stdout.take().ok_or("wecom-kf stdout 不可用")?;
    let app2 = app.clone();
    let db2 = db.clone();
    std::thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines().map_while(Result::ok) {
            let parsed: SidecarLine = match serde_json::from_str(&line) {
                Ok(v) => v,
                Err(_) => continue,
            };
            match parsed.kind.as_str() {
                "inbound" => handle_inbound(&db2, &app2, &parsed),
                "error" => {
                    let mut st = load_status(&db2);
                    st.state = "error".into();
                    st.last_error = parsed.message.clone();
                    save_status(&db2, &st);
                }
                "ready" => {
                    let mut st = load_status(&db2);
                    st.state = "ready".into();
                    st.last_error.clear();
                    save_status(&db2, &st);
                }
                _ => {}
            }
        }
    });
    let pid = child.id();
    if let Ok(mut g) = app.state::<AppState>().wecom_kf_child.lock() {
        if let Some(mut old) = g.take() {
            let _ = old.kill();
        }
        *g = Some(child);
    }
    let mut st = load_status(db);
    st.state = "starting".into();
    st.kf_sync = true;
    st.open_kfid = kf;
    st.pid = Some(pid);
    st.pending_drafts = list_draft_count(db);
    save_status(db, &st);
    Ok(())
}

pub fn start_wecom_kf_if_needed(app: &AppHandle) {
    let db = match app.try_state::<FouDb>() {
        Some(s) => s,
        None => return,
    };
    if !wecom_kf_sync_enabled(&db) {
        return;
    }
    let _ = spawn_sidecar(app, &db);
}

#[tauri::command]
pub fn xu_wecom_kf_status(db: State<'_, FouDb>) -> WecomKfStatus {
    build_status(&db)
}

#[tauri::command]
pub fn xu_wecom_kf_set_enabled(
    app: AppHandle,
    db: State<'_, FouDb>,
    enabled: bool,
) -> Result<WecomKfStatus, String> {
    wecom_set_kf_sync(&db, enabled)?;
    if enabled {
        spawn_sidecar(&app, &db)?;
    } else if let Ok(mut g) = app.state::<AppState>().wecom_kf_child.lock() {
        if let Some(mut child) = g.take() {
            let _ = child.kill();
        }
        let mut st = load_status(&db);
        st.state = "off".into();
        st.kf_sync = false;
        st.pid = None;
        save_status(&db, &st);
    }
    Ok(build_status(&db))
}

#[tauri::command]
pub fn xu_wecom_kf_list_drafts(db: State<'_, FouDb>) -> Vec<KfDraft> {
    let conn = match db.0.lock() {
        Ok(c) => c,
        Err(_) => return vec![],
    };
    let rows = desktop_db::list_settings_prefixed(&conn, DRAFT_PREFIX).unwrap_or_default();
    let mut out = vec![];
    for (_, raw) in rows {
        if raw.trim().is_empty() {
            continue;
        }
        if let Ok(d) = serde_json::from_str::<KfDraft>(&raw) {
            out.push(d);
        }
    }
    out.sort_by_key(|d| -d.updated_at);
    out
}

#[tauri::command]
pub fn xu_wecom_kf_save_draft(
    db: State<'_, FouDb>,
    msg_id: String,
    draft_reply: String,
) -> Result<KfDraft, String> {
    let mut d = load_draft(&db, &msg_id).ok_or("草稿不存在")?;
    d.draft_reply = draft_reply.trim().to_string();
    d.updated_at = now_ms();
    store_draft(&db, &d);
    Ok(d)
}

#[tauri::command]
pub fn xu_wecom_kf_approve_send(
    app: AppHandle,
    db: State<'_, FouDb>,
    msg_id: String,
) -> Result<(), String> {
    let d = load_draft(&db, &msg_id).ok_or("草稿不存在")?;
    if d.draft_reply.trim().is_empty() {
        return Err("请先填写回复内容".into());
    }
    let app_state = app.state::<AppState>();
    let mut child_guard = app_state
        .wecom_kf_child
        .lock()
        .map_err(|e| e.to_string())?;
    let child = child_guard.as_mut().ok_or("客服 sidecar 未运行")?;
    let cmd = serde_json::json!({
        "type": "send",
        "msgId": d.msg_id,
        "externalUserid": d.external_userid,
        "openKfid": d.open_kfid,
        "text": d.draft_reply,
    });
    if let Some(stdin) = child.stdin.as_mut() {
        writeln!(stdin, "{cmd}").map_err(|e| format!("写入 sidecar 失败：{e}"))?;
        let _ = stdin.flush();
    } else {
        return Err("sidecar stdin 不可用".into());
    }
    clear_draft(&db, &msg_id);
    append_office_system(
        &db,
        &format!("【企微客服】已发送回复（编号 {}）", msg_id),
    );
    Ok(())
}

#[tauri::command]
pub fn xu_wecom_kf_get_default_employee(db: State<'_, FouDb>) -> Option<String> {
    let conn = db.0.lock().ok()?;
    desktop_db::setting_get(&conn, KF_DEFAULT_EMP_KEY)
        .ok()
        .flatten()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

#[tauri::command]
pub fn xu_wecom_kf_set_default_employee(
    db: State<'_, FouDb>,
    employee_id: Option<String>,
) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let val = employee_id.unwrap_or_default().trim().to_string();
    desktop_db::setting_set(&conn, KF_DEFAULT_EMP_KEY, &val)
}
