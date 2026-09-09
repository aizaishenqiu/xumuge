//! Boss notify / chat via Feishu · WeCom · DingTalk · Slack · Telegram + OS.
//! Config model: API + Key only (official webhook / Bot API docs). No Hermes Gateway.

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_notification::NotificationExt;

use crate::desktop_db::{self, ChannelEndpointRow, FouDb};

type HmacSha256 = Hmac<Sha256>;

const THROTTLE_SECS: u64 = 120;
const SETTING_PREF_CHANNEL: &str = "boss_notify_channel";
const SETTING_THROTTLE_PREFIX: &str = "notify_throttle:";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelPlatformStatus {
    pub id: String,
    pub label: String,
    pub notify_target: String,
    pub listed: bool,
    pub desktop_ready: bool,
    pub note: String,
    pub webhook_configured: bool,
    pub enabled: bool,
    pub supports_notify: bool,
    pub supports_chat: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelHubStatus {
    pub notify_ready: bool,
    pub gateway_running: bool,
    pub gateway_detail: String,
    pub token_hint: bool,
    pub preferred_channel: String,
    pub platforms: Vec<ChannelPlatformStatus>,
    pub send_list_raw: String,
    pub runtime: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotifyBossResult {
    pub ok: bool,
    pub throttled: bool,
    pub channel: String,
    pub os_notified: bool,
    pub gateway_sent: bool,
    pub webhook_sent: bool,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FeishuDocResult {
    pub ok: bool,
    pub local_path: String,
    pub summary: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelEndpointView {
    pub id: String,
    pub enabled: bool,
    pub kind: String,
    /// Unified "API" field (Webhook URL / access_token / chat_id / channel id / App ID).
    pub api: String,
    /// Unified "Key" field (加签 Secret / Bot Token / App Secret).
    pub key: String,
    pub webhook_url: String,
    pub secret_ref: String,
    pub has_url: bool,
    pub env_fallback: String,
    pub api_hint: String,
    pub key_hint: String,
    pub docs_hint: String,
    /// feishu: webhook | app
    #[serde(default)]
    pub mode: String,
    /// 开放平台发消息接收方（群 chat_id / open_id 等）
    #[serde(default)]
    pub receive_id: String,
    /// 开会双向同步
    #[serde(default)]
    pub meeting_sync: bool,
    /// 企微客服同步（实验）
    #[serde(default)]
    pub kf_sync: bool,
    /// 企微客服 open_kfid
    #[serde(default)]
    pub kf_open_kfid: String,
    /// 企微客服企业 ID
    #[serde(default)]
    pub kf_corp_id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelProbeResult {
    pub ok: bool,
    pub message: String,
    pub bot_name: Option<String>,
}

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExtraCreds {
    #[serde(default)]
    key: String,
    #[serde(default)]
    chat_id: String,
    /// webhook | app （飞书：群机器人 vs 开放平台自建应用）
    #[serde(default)]
    mode: String,
    /// 开会双向同步（长连接入站 + 派活回写）
    #[serde(default)]
    meeting_sync: bool,
    /// 企微客服同步
    #[serde(default)]
    kf_sync: bool,
    /// 企微客服账号 open_kfid
    #[serde(default)]
    kf_open_kfid: String,
    /// 企微客服企业 ID（与群机器人 Webhook 分开存）
    #[serde(default)]
    kf_corp_id: String,
}

/// App ID / Secret / bound chat / mode for Feishu open-platform.
pub fn resolve_feishu_app_creds(db: &FouDb) -> (String, String, String, String) {
    resolve_channel_creds(db, "feishu")
}

pub fn feishu_meeting_sync_enabled(db: &FouDb) -> bool {
    let conn = match db.0.lock() {
        Ok(c) => c,
        Err(_) => return false,
    };
    let ep = desktop_db::get_channel_endpoint(&conn, "feishu")
        .ok()
        .flatten();
    let Some(ep) = ep else {
        return false;
    };
    if !ep.enabled {
        return false;
    }
    let is_app = {
        let extra = parse_extra(&ep.extra_json);
        extra.mode == "app" || ep.webhook_url.as_deref().unwrap_or("").starts_with("cli_")
    };
    if !is_app {
        return false;
    }
    // 旧数据未写 meetingSync 字段：开放平台默认开启开会同步（否则长连接永远不起）
    if !ep.extra_json.contains("meetingSync") {
        return true;
    }
    parse_extra(&ep.extra_json).meeting_sync
}

pub fn wecom_kf_sync_enabled(db: &FouDb) -> bool {
    let conn = match db.0.lock() {
        Ok(c) => c,
        Err(_) => return false,
    };
    let ep = match desktop_db::get_channel_endpoint(&conn, "wecom").ok().flatten() {
        Some(e) => e,
        None => return false,
    };
    if !ep.enabled {
        return false;
    }
    let extra = parse_extra(&ep.extra_json);
    if !extra.kf_sync {
        return false;
    }
    let corp = if !extra.kf_corp_id.trim().is_empty() {
        extra.kf_corp_id.trim().to_string()
    } else {
        let api = ep.webhook_url.as_deref().unwrap_or("").trim();
        if api.starts_with("ww") {
            api.to_string()
        } else {
            return false;
        }
    };
    let secret = extra.key.trim();
    let kf = extra.kf_open_kfid.trim();
    !corp.is_empty() && !secret.is_empty() && !kf.is_empty()
}

pub fn wecom_kf_credentials(db: &FouDb) -> Option<(String, String, String)> {
    if !wecom_kf_sync_enabled(db) {
        return None;
    }
    let conn = db.0.lock().ok()?;
    let ep = desktop_db::get_channel_endpoint(&conn, "wecom").ok()??;
    let extra = parse_extra(&ep.extra_json);
    Some((
        if !extra.kf_corp_id.trim().is_empty() {
            extra.kf_corp_id.clone()
        } else {
            ep.webhook_url.clone().unwrap_or_default()
        },
        extra.key.clone(),
        extra.kf_open_kfid.clone(),
    ))
}

pub fn wecom_set_kf_sync(db: &FouDb, enabled: bool) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut row = desktop_db::get_channel_endpoint(&conn, "wecom")?
        .ok_or_else(|| "请先配置企业微信".to_string())?;
    let mut extra = parse_extra(&row.extra_json);
    if enabled {
        let corp = if !extra.kf_corp_id.trim().is_empty() {
            extra.kf_corp_id.trim().to_string()
        } else {
            row.webhook_url.as_deref().unwrap_or("").trim().to_string()
        };
        if !corp.starts_with("ww") || extra.key.trim().is_empty() || extra.kf_open_kfid.trim().is_empty()
        {
            return Err("请先填写企业 ID（ww 开头）、客服 Secret 与 open_kfid".into());
        }
    }
    extra.kf_sync = enabled;
    row.extra_json = dump_extra(&extra);
    desktop_db::upsert_channel_endpoint(&conn, &row).map_err(|e| e.to_string())
}

pub fn feishu_set_meeting_sync(db: &FouDb, enabled: bool) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut row = desktop_db::get_channel_endpoint(&conn, "feishu")?
        .ok_or_else(|| "请先配置飞书开放平台 App ID + Secret".to_string())?;
    let mut extra = parse_extra(&row.extra_json);
    if enabled {
        let api = row.webhook_url.clone().unwrap_or_default();
        if extra.mode != "app" && !api.starts_with("cli_") {
            return Err("开会同步仅支持开放平台模式（App ID + Secret）".into());
        }
        if !api.starts_with("cli_") || extra.key.trim().is_empty() {
            return Err("请先保存有效的 App ID + App Secret".into());
        }
        extra.mode = "app".into();
    }
    extra.meeting_sync = enabled;
    row.extra_json = dump_extra(&extra);
    row.updated_at = now_ms();
    desktop_db::upsert_channel_endpoint(&conn, &row)
}

pub fn feishu_set_bound_chat_id(db: &FouDb, chat_id: &str) -> Result<(), String> {
    let chat_id = chat_id.trim();
    if chat_id.is_empty() {
        return Ok(());
    }
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut row = match desktop_db::get_channel_endpoint(&conn, "feishu")? {
        Some(r) => r,
        None => return Ok(()),
    };
    let mut extra = parse_extra(&row.extra_json);
    if extra.chat_id == chat_id {
        return Ok(());
    }
    extra.chat_id = chat_id.to_string();
    row.extra_json = dump_extra(&extra);
    row.updated_at = now_ms();
    desktop_db::upsert_channel_endpoint(&conn, &row)
}

const SETTING_FEISHU_NAME_CACHE: &str = "feishu.user_name_cache";
const SETTING_FEISHU_BOSS_IDS: &str = "feishu.boss_open_ids";
const SETTING_FEISHU_RECENT: &str = "feishu.recent_senders";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeishuRecentSender {
    pub open_id: String,
    pub name: String,
    pub last_at: i64,
    pub is_boss: bool,
}

fn read_json_setting<T: for<'de> Deserialize<'de> + Default>(db: &FouDb, key: &str) -> T {
    let conn = match db.0.lock() {
        Ok(c) => c,
        Err(_) => return T::default(),
    };
    desktop_db::setting_get(&conn, key)
        .ok()
        .flatten()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn write_json_setting<T: Serialize>(db: &FouDb, key: &str, val: &T) {
    if let Ok(conn) = db.0.lock() {
        if let Ok(raw) = serde_json::to_string(val) {
            let _ = desktop_db::setting_set(&conn, key, &raw);
        }
    }
}

pub fn feishu_is_boss_open_id(db: &FouDb, open_id: &str) -> bool {
    if open_id.is_empty() {
        return false;
    }
    let ids: Vec<String> = read_json_setting(db, SETTING_FEISHU_BOSS_IDS);
    ids.iter().any(|x| x == open_id)
}

pub fn feishu_cache_get_name(db: &FouDb, open_id: &str) -> Option<String> {
    if open_id.is_empty() {
        return None;
    }
    let map: std::collections::HashMap<String, String> =
        read_json_setting(db, SETTING_FEISHU_NAME_CACHE);
    map.get(open_id).cloned().filter(|s| !s.trim().is_empty())
}

pub fn feishu_cache_set_name(db: &FouDb, open_id: &str, name: &str) {
    if open_id.is_empty() || name.trim().is_empty() {
        return;
    }
    let mut map: std::collections::HashMap<String, String> =
        read_json_setting(db, SETTING_FEISHU_NAME_CACHE);
    map.insert(open_id.to_string(), name.trim().to_string());
    write_json_setting(db, SETTING_FEISHU_NAME_CACHE, &map);
}

pub fn feishu_remember_sender(db: &FouDb, open_id: &str, name: &str) {
    if open_id.is_empty() {
        return;
    }
    let mut list: Vec<FeishuRecentSender> = read_json_setting(db, SETTING_FEISHU_RECENT);
    list.retain(|x| x.open_id != open_id);
    list.insert(
        0,
        FeishuRecentSender {
            open_id: open_id.to_string(),
            name: name.trim().to_string(),
            last_at: now_ms(),
            is_boss: feishu_is_boss_open_id(db, open_id),
        },
    );
    list.truncate(20);
    for x in &mut list {
        x.is_boss = feishu_is_boss_open_id(db, &x.open_id);
    }
    write_json_setting(db, SETTING_FEISHU_RECENT, &list);
}

async fn feishu_fetch_user_name(token: &str, open_id: &str) -> Result<String, String> {
    let open_id = open_id.trim();
    if !open_id.starts_with("ou_") {
        return Err("open_id 无效".into());
    }
    let client = http_client()?;
    let url =
        format!("https://open.feishu.cn/open-apis/contact/v3/users/{open_id}?user_id_type=open_id");
    let resp = client
        .get(&url)
        .bearer_auth(token)
        .send()
        .await
        .map_err(|e| format!("查询飞书用户失败: {e}"))?;
    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(format!(
            "contact/v3/users HTTP {status}: {}",
            text.chars().take(160).collect::<String>()
        ));
    }
    let v: serde_json::Value =
        serde_json::from_str(&text).map_err(|e| format!("用户信息解析失败: {e}"))?;
    if let Some(code) = v.get("code").and_then(|c| c.as_i64()) {
        if code != 0 {
            return Err(format!(
                "查询用户失败 code={code}: {}（需开通通讯录读权限 contact:user.base:readonly）",
                v.get("msg").and_then(|m| m.as_str()).unwrap_or("")
            ));
        }
    }
    let user = v
        .get("data")
        .and_then(|d| d.get("user"))
        .ok_or_else(|| "响应无 user".to_string())?;
    let name = user
        .get("name")
        .and_then(|n| n.as_str())
        .or_else(|| user.get("nickname").and_then(|n| n.as_str()))
        .unwrap_or("")
        .trim()
        .to_string();
    if name.is_empty() {
        Err("用户名为空".into())
    } else {
        Ok(name)
    }
}

/// Resolve sender label without network I/O (inbound path must stay non-blocking).
pub fn feishu_resolve_sender_label_fast(db: &FouDb, open_id: &str, hint_name: &str) -> String {
    let mut name = hint_name.trim().to_string();
    if name.is_empty() {
        name = feishu_cache_get_name(db, open_id).unwrap_or_default();
    }
    if !open_id.is_empty() {
        feishu_remember_sender(db, open_id, &name);
    }
    let is_boss = feishu_is_boss_open_id(db, open_id);
    if is_boss {
        if name.is_empty() {
            "Boss".into()
        } else {
            format!("Boss·{name}")
        }
    } else if !name.is_empty() {
        name
    } else if open_id.len() > 10 {
        format!("成员…{}", &open_id[open_id.len() - 6..])
    } else if open_id.is_empty() {
        "群成员".into()
    } else {
        open_id.to_string()
    }
}

/// Resolve + cache Feishu user name; return Boss-aware label for office strip.
/// May perform network I/O — do not call from the feishu-ws reader hot path.
pub fn feishu_resolve_sender_label(db: &FouDb, open_id: &str, hint_name: &str) -> String {
    let mut name = hint_name.trim().to_string();
    if name.is_empty() {
        name = feishu_cache_get_name(db, open_id).unwrap_or_default();
    }
    if name.is_empty() && open_id.starts_with("ou_") {
        let (app_id, app_secret, _, mode) = resolve_channel_creds(db, "feishu");
        if (mode == "app" || app_id.starts_with("cli_")) && !app_secret.is_empty() {
            let fetched = tauri::async_runtime::block_on(async {
                let tok = feishu_tenant_access_token(&app_id, &app_secret).await?;
                feishu_fetch_user_name(&tok, open_id).await
            });
            if let Ok(n) = fetched {
                feishu_cache_set_name(db, open_id, &n);
                name = n;
            }
        }
    }
    feishu_resolve_sender_label_fast(db, open_id, &name)
}

#[tauri::command]
pub fn xu_feishu_list_recent_senders(
    db: State<'_, FouDb>,
) -> Result<Vec<FeishuRecentSender>, String> {
    let mut list: Vec<FeishuRecentSender> = read_json_setting(&db, SETTING_FEISHU_RECENT);
    for x in &mut list {
        x.is_boss = feishu_is_boss_open_id(&db, &x.open_id);
        if x.name.is_empty() {
            x.name = feishu_cache_get_name(&db, &x.open_id).unwrap_or_default();
        }
    }
    Ok(list)
}

#[tauri::command]
pub fn xu_feishu_set_boss_open_id(
    db: State<'_, FouDb>,
    open_id: String,
    enabled: bool,
) -> Result<Vec<FeishuRecentSender>, String> {
    let open_id = open_id.trim().to_string();
    if open_id.is_empty() {
        return Err("open_id 为空".into());
    }
    let mut ids: Vec<String> = read_json_setting(&db, SETTING_FEISHU_BOSS_IDS);
    ids.retain(|x| x != &open_id);
    if enabled {
        ids.insert(0, open_id.clone());
    }
    ids.truncate(10);
    write_json_setting(&db, SETTING_FEISHU_BOSS_IDS, &ids);
    // refresh recent flags
    let mut list: Vec<FeishuRecentSender> = read_json_setting(&db, SETTING_FEISHU_RECENT);
    for x in &mut list {
        x.is_boss = feishu_is_boss_open_id(&db, &x.open_id);
    }
    write_json_setting(&db, SETTING_FEISHU_RECENT, &list);
    xu_feishu_list_recent_senders(db)
}

/// Mirror assistant / meeting text back to the bound Feishu group (best-effort).
pub async fn mirror_text_to_feishu_meeting(db: &FouDb, text: &str) -> Result<(), String> {
    if !feishu_meeting_sync_enabled(db) {
        return Ok(());
    }
    let text = text.trim();
    if text.is_empty() {
        return Ok(());
    }
    let (app_id, app_secret, chat_id, mode) = resolve_channel_creds(db, "feishu");
    if mode != "app" && !app_id.starts_with("cli_") {
        return Ok(());
    }
    deliver_feishu_app(&app_id, &app_secret, &chat_id, text).await
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn get_pref_channel(db: &FouDb) -> String {
    let conn = db.0.lock().unwrap();
    conn.query_row(
        "SELECT value FROM settings WHERE key = ?1",
        rusqlite::params![SETTING_PREF_CHANNEL],
        |r| r.get::<_, String>(0),
    )
    .unwrap_or_else(|_| "feishu".into())
}

fn set_pref_channel(db: &FouDb, channel: &str) -> Result<(), String> {
    let conn = db.0.lock().unwrap();
    conn.execute(
        "INSERT INTO settings(key, value) VALUES(?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        rusqlite::params![SETTING_PREF_CHANNEL, channel],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn throttle_hit(db: &FouDb, kind: &str) -> bool {
    let key = format!("{SETTING_THROTTLE_PREFIX}{kind}");
    let conn = db.0.lock().unwrap();
    let last: Option<String> = conn
        .query_row(
            "SELECT value FROM settings WHERE key = ?1",
            rusqlite::params![key],
            |r| r.get(0),
        )
        .ok();
    let Some(last) = last else {
        return false;
    };
    let Ok(ts) = last.parse::<i64>() else {
        return false;
    };
    now_ms() - ts < (THROTTLE_SECS as i64) * 1000
}

fn throttle_mark(db: &FouDb, kind: &str) {
    let key = format!("{SETTING_THROTTLE_PREFIX}{kind}");
    let conn = db.0.lock().unwrap();
    let _ = conn.execute(
        "INSERT INTO settings(key, value) VALUES(?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        rusqlite::params![key, now_ms().to_string()],
    );
}

fn default_env_for(channel: &str) -> &'static str {
    match channel {
        "feishu" => "FEISHU_WEBHOOK",
        "wecom" => "WECOM_WEBHOOK",
        "dingtalk" => "DINGTALK_WEBHOOK",
        "slack" => "SLACK_WEBHOOK",
        "telegram" => "TELEGRAM_BOT_TOKEN",
        _ => "",
    }
}

/// Trim quotes/BOM; add https://; expand bare Feishu hook tokens.
fn normalize_webhook_url(channel: &str, raw: &str) -> String {
    let mut s = raw
        .trim()
        .trim_matches(|c| c == '"' || c == '\'' || c == '`' || c == '“' || c == '”')
        .to_string();
    if let Some(stripped) = s.strip_prefix('\u{feff}') {
        s = stripped.to_string();
    }
    s = s.trim().to_string();
    if s.is_empty() {
        return s;
    }
    // Accidental whitespace / newlines from paste
    s = s.split_whitespace().collect::<Vec<_>>().join("");

    if channel == "feishu" {
        // Bare hook token (UUID-like) → full custom bot URL
        let looks_like_token = !s.contains('/')
            && !s.contains(':')
            && s.len() >= 16
            && s.chars().all(|c| c.is_ascii_hexdigit() || c == '-');
        if looks_like_token {
            return format!("https://open.feishu.cn/open-apis/bot/v2/hook/{s}");
        }
        if s.starts_with("open.feishu.cn/")
            || s.starts_with("open.larksuite.com/")
            || s.starts_with("www.feishu.cn/")
        {
            s = format!("https://{s}");
        }
    }

    if !(s.starts_with("https://") || s.starts_with("http://")) {
        if s.starts_with("//") {
            s = format!("https:{s}");
        } else if s.contains('.') && s.contains('/') {
            s = format!("https://{s}");
        }
    }
    s
}

fn validate_webhook_url(channel: &str, api: &str) -> Result<(), String> {
    let api = normalize_webhook_url(channel, api);
    if api.is_empty() {
        return Err(format!("请填写 {channel} Webhook URL"));
    }
    if !(api.starts_with("https://") || api.starts_with("http://")) {
        return Err(format!(
            "{channel} Webhook 须以 https:// 开头。请粘贴完整地址，例如 https://open.feishu.cn/open-apis/bot/v2/hook/…"
        ));
    }
    let lower = api.to_lowercase();
    match channel {
        "feishu" => {
            if !(lower.contains("feishu") || lower.contains("lark")) {
                return Err(
                    "飞书 Webhook 主机应含 feishu / lark（例如 open.feishu.cn/.../hook/...）"
                        .into(),
                );
            }
            // Must be .../hook/<token> — bare .../hook/ returns HTTP 404
            let Some(idx) = lower.rfind("/hook/") else {
                return Err(
                    "飞书自定义机器人 URL 须含 /hook/，请从群设置 → 群机器人完整复制 Webhook"
                        .into(),
                );
            };
            let mut token = api[idx + "/hook/".len()..].trim_matches('/');
            // Drop query/fragment if any slipped in
            if let Some(q) = token.find(|c| c == '?' || c == '#') {
                token = &token[..q];
            }
            let token_ok = token.len() >= 20
                && token.contains('-')
                && token.chars().all(|c| c.is_ascii_hexdigit() || c == '-');
            if !token_ok {
                return Err(
                    "Webhook token 无效：/hook/ 后应是一串带横线的 UUID。不要填 App Secret。错误 19001 即 token 不对或机器人已重置"
                        .into(),
                );
            }
        }
        "wecom" => {
            if !lower.contains("webhook") && !lower.contains("key=") {
                return Err("企业微信 Webhook 通常含 webhook 或 key=，请核对".into());
            }
        }
        _ => {}
    }
    Ok(())
}

fn platform_hints(id: &str) -> (&'static str, &'static str, &'static str) {
    match id {
        "feishu" => (
            "Webhook 完整 URL，或 App ID（cli_…）",
            "开放平台模式填 App Secret；Webhook 模式留空",
            "两种方式：①群自定义机器人 Webhook；②开放平台自建应用 App ID + App Secret + 接收方 ID（类似 Hermes）",
        ),
        "wecom" => (
            "Webhook URL（企微群机器人）",
            "可选：环境变量名，如 WECOM_WEBHOOK",
            "企业微信 · 群机器人；msgtype=text",
        ),
        "dingtalk" => (
            "Webhook URL 或 access_token",
            "加签 Secret（SEC…，安全设置勾选加签时必填）",
            "钉钉开放平台 · 自定义机器人；加签 HMAC-SHA256",
        ),
        "slack" => (
            "Incoming Webhook URL，或频道 ID（配合 Bot Token）",
            "可选 Bot Token（xoxb-…）；仅 Webhook 时可留空",
            "Slack Incoming Webhooks / chat.postMessage",
        ),
        "telegram" => (
            "Chat ID（个人或群，如 -100…）",
            "BotFather 下发的 Bot Token",
            "Telegram Bot API · sendMessage / getMe",
        ),
        _ => ("", "", ""),
    }
}

fn parse_extra(raw: &str) -> ExtraCreds {
    serde_json::from_str(raw).unwrap_or_default()
}

fn dump_extra(extra: &ExtraCreds) -> String {
    serde_json::to_string(extra).unwrap_or_else(|_| "{}".into())
}

fn http_client() -> Result<reqwest::Client, String> {
    match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .user_agent(concat!("FouDesktop/", env!("CARGO_PKG_VERSION")))
        .pool_max_idle_per_host(2)
        .build()
    {
        Ok(c) => Ok(c),
        Err(e) => {
            // Builder failures are rare; fall back to defaults and keep a readable chain.
            eprintln!("[xu] reqwest Client::builder failed: {e:?}");
            Ok(reqwest::Client::new())
        }
    }
}

fn dingtalk_signed_url(base: &str, secret: &str) -> Result<String, String> {
    if secret.trim().is_empty() {
        return Ok(base.to_string());
    }
    let ts = now_ms();
    let string_to_sign = format!("{ts}\n{secret}");
    let mut mac =
        HmacSha256::new_from_slice(secret.as_bytes()).map_err(|e| format!("钉钉加签失败: {e}"))?;
    mac.update(string_to_sign.as_bytes());
    let sign = urlencoding::encode(&B64.encode(mac.finalize().into_bytes())).into_owned();
    let sep = if base.contains('?') { "&" } else { "?" };
    Ok(format!("{base}{sep}timestamp={ts}&sign={sign}"))
}

fn normalize_dingtalk_api(api: &str) -> String {
    let api = api.trim();
    if api.is_empty() {
        return String::new();
    }
    if api.starts_with("http://") || api.starts_with("https://") {
        return api.to_string();
    }
    format!("https://oapi.dingtalk.com/robot/send?access_token={api}")
}

fn resolve_channel_creds(db: &FouDb, channel: &str) -> (String, String, String, String) {
    let conn = match db.0.lock() {
        Ok(c) => c,
        Err(_) => return (String::new(), String::new(), String::new(), String::new()),
    };
    let ep = desktop_db::get_channel_endpoint(&conn, channel)
        .ok()
        .flatten();
    drop(conn);

    let mut api = String::new();
    let mut key = String::new();
    let mut chat_id = String::new();
    let mut mode = String::new();
    if let Some(ep) = ep {
        api = ep.webhook_url.unwrap_or_default().trim().to_string();
        let extra = parse_extra(&ep.extra_json);
        key = extra.key.trim().to_string();
        chat_id = extra.chat_id.trim().to_string();
        mode = extra.mode.trim().to_string();
        if key.is_empty() {
            if let Some(sr) = ep.secret_ref.as_ref().map(|s| s.trim().to_string()) {
                if !sr.is_empty() {
                    if let Ok(v) = std::env::var(&sr) {
                        if !v.trim().is_empty() && api.is_empty() {
                            api = v.trim().to_string();
                        } else if sr.starts_with("SEC")
                            || !sr.chars().all(|c| c.is_ascii_uppercase() || c == '_')
                        {
                            key = sr;
                        }
                    } else if sr.starts_with("SEC") {
                        key = sr;
                    }
                }
            }
        }
        if channel == "telegram" && !extra.chat_id.is_empty() && api.is_empty() {
            api = extra.chat_id;
        }
    }

    if api.is_empty() {
        let env = default_env_for(channel);
        if !env.is_empty() {
            if let Ok(v) = std::env::var(env) {
                if !v.trim().is_empty() {
                    api = v.trim().to_string();
                }
            }
        }
    }
    if channel == "telegram" && key.is_empty() {
        if let Ok(v) = std::env::var("TELEGRAM_BOT_TOKEN") {
            key = v.trim().to_string();
        }
    }
    if channel == "dingtalk" && key.is_empty() {
        if let Ok(v) = std::env::var("DINGTALK_SECRET") {
            key = v.trim().to_string();
        }
    }
    if mode.is_empty() && channel == "feishu" {
        mode = if api.starts_with("cli_") {
            "app".into()
        } else {
            "webhook".into()
        };
    }
    (api, key, chat_id, mode)
}

fn endpoint_configured(db: &FouDb, channel: &str) -> (bool, bool) {
    if channel == "os" {
        return (true, true);
    }
    let (api, key, _chat_id, mode) = resolve_channel_creds(db, channel);
    let configured = match channel {
        "telegram" => !api.is_empty() && !key.is_empty(),
        "slack" => {
            !api.is_empty()
                && (api.contains("hooks.slack.com")
                    || key.starts_with("xoxb-")
                    || key.starts_with("xoxp-"))
        }
        "dingtalk" => !api.is_empty(),
        "feishu" => {
            if mode == "app" || api.starts_with("cli_") {
                api.starts_with("cli_") && !key.is_empty()
            } else {
                validate_webhook_url(channel, &api).is_ok()
            }
        }
        "wecom" => validate_webhook_url(channel, &api).is_ok(),
        _ => !api.is_empty(),
    };
    let conn = match db.0.lock() {
        Ok(c) => c,
        Err(_) => return (configured, configured),
    };
    let ep = desktop_db::get_channel_endpoint(&conn, channel)
        .ok()
        .flatten();
    let enabled = ep.as_ref().map(|e| e.enabled).unwrap_or(false);
    (configured, enabled || configured)
}

fn platform_catalog(db: &FouDb) -> Vec<ChannelPlatformStatus> {
    let defs = [
        (
            "feishu",
            "飞书",
            "开放平台 App ID+Secret+接收方，或群自定义机器人 Webhook。",
        ),
        (
            "wecom",
            "企业微信",
            "填群机器人 Webhook URL；可选环境变量名。msgtype=text。",
        ),
        (
            "dingtalk",
            "钉钉",
            "API=Webhook/access_token，Key=加签 SEC…。按官方文档 HMAC 加签后发送。",
        ),
        (
            "slack",
            "Slack",
            "API=Incoming Webhook；或 API=频道 ID + Key=xoxb Bot Token（chat.postMessage）。",
        ),
        (
            "telegram",
            "Telegram",
            "API=Chat ID，Key=Bot Token。对接 Bot API sendMessage / getMe。",
        ),
        ("os", "本机通知", "始终可用；Webhook 失败时的兜底。"),
    ];
    defs.iter()
        .map(|(id, label, note)| {
            let (configured, ready) = endpoint_configured(db, id);
            ChannelPlatformStatus {
                id: (*id).into(),
                label: (*label).into(),
                notify_target: (*id).into(),
                listed: configured,
                desktop_ready: true,
                note: (*note).into(),
                webhook_configured: configured,
                enabled: if *id == "os" {
                    true
                } else {
                    ready && configured
                },
                supports_notify: true,
                supports_chat: *id != "os",
            }
        })
        .collect()
}

fn format_text(title: &str, body: &str) -> String {
    if body.is_empty() {
        format!("[虚募阁] {title}")
    } else {
        format!("[虚募阁] {title}\n{body}")
    }
}

async fn check_json_biz(channel: &str, resp_text: &str) -> Result<(), String> {
    if channel == "slack" {
        let t = resp_text.trim();
        if t == "ok" || t.is_empty() {
            return Ok(());
        }
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(resp_text) {
            if v.get("ok").and_then(|o| o.as_bool()) == Some(true) {
                return Ok(());
            }
            return Err(format!(
                "Slack 错误: {}",
                v.get("error").and_then(|e| e.as_str()).unwrap_or(resp_text)
            ));
        }
        return Err(format!("Slack 响应异常: {t}"));
    }

    if let Ok(v) = serde_json::from_str::<serde_json::Value>(resp_text) {
        if let Some(ok) = v.get("ok").and_then(|c| c.as_bool()) {
            if !ok {
                return Err(format!(
                    "业务失败: {}",
                    v.get("description")
                        .or_else(|| v.get("errmsg"))
                        .or_else(|| v.get("msg"))
                        .and_then(|m| m.as_str())
                        .unwrap_or(resp_text)
                ));
            }
        }
        if let Some(code) = v.get("code").and_then(|c| c.as_i64()) {
            if code != 0 {
                let msg = v.get("msg").and_then(|m| m.as_str()).unwrap_or(resp_text);
                if code == 19001 {
                    return Err(
                        "飞书 19001：Webhook token 无效。请到群机器人重新复制完整地址（勿用 App Secret），点「清空重填」后再保存"
                            .into(),
                    );
                }
                return Err(format!("业务错误 code={code}: {msg}"));
            }
        }
        if let Some(errcode) = v.get("errcode").and_then(|c| c.as_i64()) {
            if errcode != 0 {
                return Err(format!(
                    "业务错误 errcode={errcode}: {}",
                    v.get("errmsg")
                        .and_then(|m| m.as_str())
                        .unwrap_or(resp_text)
                ));
            }
        }
        // Feishu custom bot often returns StatusCode / StatusMessage
        if let Some(sc) = v
            .get("StatusCode")
            .or_else(|| v.get("statusCode"))
            .and_then(|c| c.as_i64())
        {
            if sc != 0 {
                return Err(format!(
                    "飞书业务错误 StatusCode={sc}: {}",
                    v.get("StatusMessage")
                        .or_else(|| v.get("msg"))
                        .and_then(|m| m.as_str())
                        .unwrap_or(resp_text)
                ));
            }
        }
    }
    Ok(())
}

async fn post_json(url: &str, payload: serde_json::Value) -> Result<String, String> {
    let client = http_client().map_err(|e| format!("HTTP 客户端不可用: {e}"))?;
    let resp = client
        .post(url)
        .header("Content-Type", "application/json")
        .json(&payload)
        .send()
        .await
        .map_err(|e| {
            let mut msg = format!("请求失败: {e}");
            if e.is_timeout() {
                msg = format!("请求超时（20s）: {e}");
            } else if e.is_connect() {
                msg = format!("无法连接服务器（检查网络/代理/TLS）: {e}");
            } else if e.is_builder() {
                msg = format!("请求构建失败（检查 URL）: {e}");
            }
            msg
        })?;
    let status = resp.status();
    let resp_text = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(format!(
            "HTTP {status}: {}",
            resp_text.chars().take(240).collect::<String>()
        ));
    }
    Ok(resp_text)
}

async fn slack_post_message(token: &str, channel: &str, text: &str) -> Result<(), String> {
    let client = http_client()?;
    let resp = client
        .post("https://slack.com/api/chat.postMessage")
        .bearer_auth(token)
        .json(&serde_json::json!({ "channel": channel, "text": text }))
        .send()
        .await
        .map_err(|e| format!("Slack API 失败: {e}"))?;
    let status = resp.status();
    let resp_text = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(format!("Slack HTTP {status}: {resp_text}"));
    }
    check_json_biz("slack", &resp_text).await
}

async fn slack_auth_test(token: &str) -> Result<String, String> {
    let client = http_client()?;
    let resp = client
        .post("https://slack.com/api/auth.test")
        .bearer_auth(token)
        .send()
        .await
        .map_err(|e| format!("Slack auth.test 失败: {e}"))?;
    let text = resp.text().await.unwrap_or_default();
    check_json_biz("slack", &text).await?;
    let v: serde_json::Value = serde_json::from_str(&text).unwrap_or_default();
    Ok(v.get("user")
        .and_then(|u| u.as_str())
        .or_else(|| v.get("team").and_then(|t| t.as_str()))
        .unwrap_or("slack-bot")
        .to_string())
}

async fn telegram_send(token: &str, chat_id: &str, text: &str) -> Result<(), String> {
    let url = format!("https://api.telegram.org/bot{token}/sendMessage");
    let resp_text = post_json(
        &url,
        serde_json::json!({ "chat_id": chat_id, "text": text }),
    )
    .await?;
    check_json_biz("telegram", &resp_text).await
}

async fn telegram_get_me(token: &str) -> Result<String, String> {
    let client = http_client()?;
    let url = format!("https://api.telegram.org/bot{token}/getMe");
    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Telegram getMe 失败: {e}"))?;
    let resp_text = resp.text().await.unwrap_or_default();
    check_json_biz("telegram", &resp_text).await?;
    let v: serde_json::Value =
        serde_json::from_str(&resp_text).map_err(|e| format!("Telegram 响应解析失败: {e}"))?;
    let name = v
        .pointer("/result/username")
        .and_then(|u| u.as_str())
        .or_else(|| v.pointer("/result/first_name").and_then(|u| u.as_str()))
        .unwrap_or("bot");
    Ok(name.to_string())
}

async fn feishu_tenant_access_token(app_id: &str, app_secret: &str) -> Result<String, String> {
    let client = http_client()?;
    let resp = client
        .post("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal")
        .json(&serde_json::json!({
            "app_id": app_id,
            "app_secret": app_secret,
        }))
        .send()
        .await
        .map_err(|e| format!("获取 tenant_access_token 失败: {e}"))?;
    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(format!(
            "token HTTP {status}: {}",
            text.chars().take(200).collect::<String>()
        ));
    }
    let v: serde_json::Value =
        serde_json::from_str(&text).map_err(|e| format!("token 响应解析失败: {e}"))?;
    if let Some(code) = v.get("code").and_then(|c| c.as_i64()) {
        if code != 0 {
            return Err(format!(
                "获取 token 失败 code={code}: {}",
                v.get("msg").and_then(|m| m.as_str()).unwrap_or(&text)
            ));
        }
    }
    v.get("tenant_access_token")
        .and_then(|t| t.as_str())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .ok_or_else(|| "响应无 tenant_access_token".into())
}

fn feishu_receive_id_type(receive_id: &str) -> &'static str {
    let id = receive_id.trim();
    if id.starts_with("ou_") {
        "open_id"
    } else if id.starts_with("on_") {
        "union_id"
    } else if id.starts_with("cli_") {
        "app_id"
    } else if id.contains('@') {
        "email"
    } else {
        // oc_… 群聊；纯数字多为 user_id
        "chat_id"
    }
}

async fn feishu_first_chat_id(token: &str) -> Result<Option<(String, String)>, String> {
    let client = http_client()?;
    let resp = client
        .get("https://open.feishu.cn/open-apis/im/v1/chats")
        .query(&[("page_size", "50")])
        .bearer_auth(token)
        .send()
        .await
        .map_err(|e| format!("拉取飞书群列表失败: {e}"))?;
    let text = resp.text().await.unwrap_or_default();
    let v: serde_json::Value =
        serde_json::from_str(&text).map_err(|e| format!("群列表解析失败: {e} · {text}"))?;
    if let Some(code) = v.get("code").and_then(|c| c.as_i64()) {
        if code != 0 {
            return Err(format!(
                "群列表失败 code={code}: {}（请确认已开通「获取群组信息」等权限）",
                v.get("msg").and_then(|m| m.as_str()).unwrap_or(&text)
            ));
        }
    }
    let items = v
        .pointer("/data/items")
        .and_then(|i| i.as_array())
        .cloned()
        .unwrap_or_default();
    for item in items {
        let cid = item
            .get("chat_id")
            .and_then(|c| c.as_str())
            .unwrap_or("")
            .trim();
        if !cid.is_empty() {
            let name = item
                .get("name")
                .and_then(|n| n.as_str())
                .unwrap_or(cid)
                .to_string();
            return Ok(Some((cid.to_string(), name)));
        }
    }
    Ok(None)
}

/// GET https://open.feishu.cn/open-apis/bot/v3/info — 校验凭证并返回机器人名称
async fn feishu_bot_info(token: &str) -> Result<(String, i64, String), String> {
    let client = http_client()?;
    let resp = client
        .get("https://open.feishu.cn/open-apis/bot/v3/info")
        .bearer_auth(token)
        .send()
        .await
        .map_err(|e| format!("获取机器人信息失败: {e}"))?;
    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(format!(
            "bot/v3/info HTTP {status}: {}",
            text.chars().take(200).collect::<String>()
        ));
    }
    let v: serde_json::Value =
        serde_json::from_str(&text).map_err(|e| format!("bot/v3/info 解析失败: {e}"))?;
    if let Some(code) = v.get("code").and_then(|c| c.as_i64()) {
        if code != 0 {
            return Err(format!(
                "获取机器人信息失败 code={code}: {}（请在开放平台启用「机器人」能力并发布）",
                v.get("msg").and_then(|m| m.as_str()).unwrap_or(&text)
            ));
        }
    }
    let bot = v.get("bot").ok_or_else(|| "响应无 bot 字段".to_string())?;
    let name = bot
        .get("app_name")
        .and_then(|n| n.as_str())
        .unwrap_or("飞书机器人")
        .to_string();
    let status_code = bot
        .get("activate_status")
        .and_then(|s| s.as_i64())
        .unwrap_or(-1);
    let open_id = bot
        .get("open_id")
        .and_then(|o| o.as_str())
        .unwrap_or("")
        .to_string();
    Ok((name, status_code, open_id))
}

fn feishu_activate_label(status: i64) -> &'static str {
    match status {
        0 => "初始化（租户待安装）",
        1 => "租户停用",
        2 => "已启用",
        3 => "安装后待启用",
        4 => "升级待启用",
        5 => "license 过期停用",
        6 => "套餐到期/降级停用",
        _ => "未知状态",
    }
}

async fn deliver_feishu_app(
    app_id: &str,
    app_secret: &str,
    receive_id: &str,
    text: &str,
) -> Result<(), String> {
    let app_id = app_id.trim();
    let app_secret = app_secret.trim();
    let mut receive_id = receive_id.trim().to_string();
    if !app_id.starts_with("cli_") {
        return Err("App ID 应以 cli_ 开头（开放平台 · 凭证与基础信息）".into());
    }
    if app_secret.is_empty() {
        return Err("请填写 App Secret".into());
    }
    let token = feishu_tenant_access_token(app_id, app_secret).await?;
    if receive_id.is_empty() {
        match feishu_first_chat_id(&token).await? {
            Some((cid, name)) => {
                receive_id = cid;
                eprintln!("[xu] feishu auto receive_id={receive_id} ({name})");
            }
            None => {
                return Err(
                    "凭证有效，但应用还不在任何群里。请把应用机器人拉进目标群后再试发（接收方可留空，会自动选用所在群）"
                        .into(),
                );
            }
        }
    }
    let id_type = feishu_receive_id_type(&receive_id);
    let content = serde_json::json!({ "text": text }).to_string();
    let client = http_client()?;
    let url = format!("https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type={id_type}");
    let resp = client
        .post(&url)
        .bearer_auth(&token)
        .json(&serde_json::json!({
            "receive_id": receive_id,
            "msg_type": "text",
            "content": content,
        }))
        .send()
        .await
        .map_err(|e| format!("飞书发消息失败: {e}"))?;
    let status = resp.status();
    let resp_text = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(format!(
            "飞书发消息 HTTP {status}: {}",
            resp_text.chars().take(240).collect::<String>()
        ));
    }
    check_json_biz("feishu", &resp_text).await
}

async fn deliver_channel(
    channel: &str,
    api: &str,
    key: &str,
    title: &str,
    body: &str,
    receive_id: &str,
    mode: &str,
) -> Result<(), String> {
    let text = format_text(title, body);
    match channel {
        "telegram" => {
            if api.trim().is_empty() || key.trim().is_empty() {
                return Err("Telegram 需要 Chat ID（API）与 Bot Token（Key）".into());
            }
            telegram_send(key.trim(), api.trim(), &text).await
        }
        "slack" => {
            if api.contains("hooks.slack.com") {
                let resp = post_json(api, serde_json::json!({ "text": text })).await?;
                check_json_biz("slack", &resp).await
            } else if key.starts_with("xoxb-") || key.starts_with("xoxp-") {
                if api.trim().is_empty() {
                    return Err("Slack Bot 模式需要频道 ID（API）与 Bot Token（Key）".into());
                }
                slack_post_message(key.trim(), api.trim(), &text).await
            } else if !api.is_empty() {
                let resp = post_json(api, serde_json::json!({ "text": text })).await?;
                check_json_biz("slack", &resp).await
            } else {
                Err("请填写 Slack Incoming Webhook URL，或 频道ID + Bot Token".into())
            }
        }
        "dingtalk" => {
            let base = normalize_dingtalk_api(api);
            if base.is_empty() {
                return Err("请填写钉钉 Webhook 或 access_token".into());
            }
            let url = dingtalk_signed_url(&base, key.trim())?;
            let resp = post_json(
                &url,
                serde_json::json!({
                    "msgtype": "text",
                    "text": { "content": text }
                }),
            )
            .await?;
            check_json_biz("dingtalk", &resp).await
        }
        "wecom" => {
            let api = normalize_webhook_url("wecom", api);
            validate_webhook_url("wecom", &api)?;
            let resp = post_json(
                api.trim(),
                serde_json::json!({
                    "msgtype": "text",
                    "text": { "content": text }
                }),
            )
            .await?;
            check_json_biz("wecom", &resp).await
        }
        // feishu / lark / default
        _ => {
            let use_app = mode == "app" || api.trim().starts_with("cli_");
            if use_app {
                deliver_feishu_app(api, key, receive_id, &text).await
            } else {
                let api = normalize_webhook_url("feishu", api);
                validate_webhook_url("feishu", &api)?;
                let resp = post_json(
                    api.trim(),
                    serde_json::json!({
                        "msg_type": "text",
                        "content": { "text": text }
                    }),
                )
                .await?;
                check_json_biz("feishu", &resp).await
            }
        }
    }
}

fn branded_notify_title(title: &str) -> String {
    const PREFIX: &str = "虚募阁AI公司通知您：";
    let t = title.trim();
    if t.is_empty() {
        format!("{PREFIX}通知")
    } else if t.starts_with(PREFIX) {
        t.to_string()
    } else {
        format!("{PREFIX}{t}")
    }
}

pub(crate) fn show_os_notification(app: &AppHandle, title: &str, body: &str) -> bool {
    let titled = branded_notify_title(title);
    let body = body.trim();

    #[cfg(windows)]
    {
        // Bypass tauri-plugin-notification's debug/release skip of app_id (which forces PowerShell branding).
        use std::path::PathBuf;
        use tauri_winrt_notification::{IconCrop, Toast};

        let icon = {
            let mut found: Option<PathBuf> = None;
            if let Ok(res) = app.path().resource_dir() {
                let ico = res.join("icons").join("icon.ico");
                if ico.is_file() {
                    found = Some(ico);
                }
            }
            if found.is_none() {
                let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                    .join("icons")
                    .join("icon.ico");
                if dev.is_file() {
                    found = Some(dev);
                }
            }
            found
        };

        let mut toast = Toast::new("com.xu.desktop").title(&titled).text1(body);
        if let Some(ico) = icon.as_ref() {
            toast = toast.icon(ico, IconCrop::Square, "虚募阁");
        }
        return match toast.show() {
            Ok(()) => true,
            Err(e) => {
                eprintln!("[xu] winrt toast failed: {e}; fallback plugin");
                let mut builder = app.notification().builder().title(&titled).body(body);
                if let Some(ico) = icon {
                    builder = builder.icon(ico.to_string_lossy());
                }
                builder.show().is_ok()
            }
        };
    }

    #[cfg(not(windows))]
    {
        let mut builder = app.notification().builder().title(titled).body(body);
        if let Ok(res) = app.path().resource_dir() {
            let ico = res.join("icons").join("icon.ico");
            let png = res.join("icons").join("128x128.png");
            if ico.is_file() {
                builder = builder.icon(ico.to_string_lossy());
            } else if png.is_file() {
                builder = builder.icon(png.to_string_lossy());
            }
        }
        builder.show().is_ok()
    }
}

#[tauri::command]
pub async fn xu_channel_status(db: State<'_, FouDb>) -> Result<ChannelHubStatus, String> {
    Ok(ChannelHubStatus {
        notify_ready: true,
        gateway_running: false,
        gateway_detail: "已改用虚募阁官方 Webhook / Bot API（Native Agent，无外部 Gateway）".into(),
        token_hint: false,
        preferred_channel: get_pref_channel(&db),
        platforms: platform_catalog(&db),
        send_list_raw: String::new(),
        runtime: "native-api-key".into(),
    })
}

#[tauri::command]
pub async fn xu_set_notify_channel(db: State<'_, FouDb>, channel: String) -> Result<(), String> {
    let ch = channel.trim().to_lowercase();
    if !["feishu", "wecom", "os", "dingtalk", "slack", "telegram"].contains(&ch.as_str()) {
        return Err("不支持的通道".into());
    }
    set_pref_channel(&db, &ch)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetChannelEndpointPayload {
    pub id: String,
    pub enabled: Option<bool>,
    pub api: Option<String>,
    pub key: Option<String>,
    pub webhook_url: Option<String>,
    pub secret_ref: Option<String>,
    /// feishu: webhook | app
    pub mode: Option<String>,
    /// 开放平台接收方 chat_id / open_id
    pub receive_id: Option<String>,
    /// 开会双向同步开关
    pub meeting_sync: Option<bool>,
    /// 企微客服同步
    pub kf_sync: Option<bool>,
    /// 企微客服 open_kfid（可与 receive_id 同填）
    pub kf_open_kfid: Option<String>,
    /// 企微客服企业 ID
    pub kf_corp_id: Option<String>,
}

#[tauri::command]
pub fn xu_get_channel_endpoint(
    db: State<'_, FouDb>,
    id: String,
) -> Result<ChannelEndpointView, String> {
    let id = id.trim().to_lowercase();
    let env_fallback = default_env_for(&id).to_string();
    let (api_hint, key_hint, docs_hint) = platform_hints(&id);
    let (api, key, chat_id, mode) = resolve_channel_creds(&db, &id);
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let ep = desktop_db::get_channel_endpoint(&conn, &id)?;
    let enabled = ep.as_ref().map(|e| e.enabled).unwrap_or(false);
    let meeting_sync = {
        let raw = ep.as_ref().map(|e| e.extra_json.as_str()).unwrap_or("");
        let parsed = ep
            .as_ref()
            .map(|e| parse_extra(&e.extra_json))
            .unwrap_or_default();
        if id == "feishu" && (mode == "app" || api.starts_with("cli_")) {
            if !raw.contains("meetingSync") {
                true
            } else {
                parsed.meeting_sync
            }
        } else {
            parsed.meeting_sync
        }
    };
    let secret_ref = ep
        .as_ref()
        .and_then(|e| e.secret_ref.clone())
        .unwrap_or_else(|| env_fallback.clone());
    let has_url = match id.as_str() {
        "telegram" => !api.is_empty() && !key.is_empty(),
        "feishu" if mode == "app" || api.starts_with("cli_") => {
            api.starts_with("cli_") && !key.is_empty()
        }
        _ => !api.is_empty(),
    };
    Ok(ChannelEndpointView {
        id,
        enabled,
        kind: if mode == "app" {
            "app".into()
        } else {
            "api_key".into()
        },
        api: api.clone(),
        key,
        webhook_url: api,
        secret_ref,
        has_url,
        env_fallback,
        api_hint: api_hint.into(),
        key_hint: key_hint.into(),
        docs_hint: docs_hint.into(),
        mode: if mode.is_empty() {
            "webhook".into()
        } else {
            mode
        },
        receive_id: chat_id,
        meeting_sync,
        kf_sync: {
            let parsed = ep
                .as_ref()
                .map(|e| parse_extra(&e.extra_json))
                .unwrap_or_default();
            parsed.kf_sync
        },
        kf_open_kfid: ep
            .as_ref()
            .map(|e| parse_extra(&e.extra_json).kf_open_kfid)
            .unwrap_or_default(),
        kf_corp_id: ep
            .as_ref()
            .map(|e| parse_extra(&e.extra_json).kf_corp_id)
            .unwrap_or_default(),
    })
}

#[tauri::command]
pub fn xu_set_channel_endpoint(
    db: State<'_, FouDb>,
    payload: SetChannelEndpointPayload,
) -> Result<(), String> {
    let id = payload.id.trim().to_lowercase();
    if !["feishu", "wecom", "dingtalk", "slack", "telegram"].contains(&id.as_str()) {
        return Err("该通道不支持桌面配置".into());
    }
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let prev = desktop_db::get_channel_endpoint(&conn, &id)?;
    let prev_extra = prev
        .as_ref()
        .map(|p| parse_extra(&p.extra_json))
        .unwrap_or_default();
    let prev_api = prev
        .as_ref()
        .and_then(|p| p.webhook_url.clone())
        .unwrap_or_default();
    let prev_enabled = prev.as_ref().map(|p| p.enabled).unwrap_or(true);

    let mut api = payload
        .api
        .or(payload.webhook_url)
        .unwrap_or(prev_api)
        .trim()
        .to_string();
    let mut key = payload
        .key
        .or(payload.secret_ref.clone())
        .unwrap_or(prev_extra.key)
        .trim()
        .to_string();
    let receive_id = payload
        .receive_id
        .clone()
        .unwrap_or_else(|| prev_extra.chat_id.clone())
        .trim()
        .to_string();
    let mut mode = payload
        .mode
        .unwrap_or(prev_extra.mode)
        .trim()
        .to_lowercase();
    if mode.is_empty() {
        mode = if api.starts_with("cli_") {
            "app".into()
        } else {
            "webhook".into()
        };
    }

    // Common mistake: webhook pasted into Key
    if matches!(id.as_str(), "feishu" | "wecom") && mode != "app" {
        let key_n = normalize_webhook_url(&id, &key);
        let api_n = normalize_webhook_url(&id, &api);
        let key_is_hook = key_n.contains("/hook/")
            && (key_n.contains("feishu") || key_n.contains("lark") || key_n.contains("webhook"));
        let api_is_hook = api_n.contains("/hook/");
        if key_is_hook && !api_is_hook {
            api = key.clone();
            key.clear();
        }
    }

    if id == "feishu" && mode == "webhook" {
        key.clear();
        api = normalize_webhook_url("feishu", &api);
        validate_webhook_url("feishu", &api)?;
    } else if id == "feishu" && mode == "app" {
        if !api.starts_with("cli_") {
            return Err("开放平台模式：API 请填 App ID（cli_ 开头）".into());
        }
        if key.is_empty() {
            return Err("开放平台模式：Key 请填 App Secret".into());
        }
        // receive_id 可选：未填时发消息会自动选用机器人所在的第一个群
    } else if id == "wecom" {
        api = normalize_webhook_url("wecom", &api);
        validate_webhook_url("wecom", &api)?;
    } else if matches!(id.as_str(), "dingtalk" | "slack") {
        api = normalize_webhook_url(&id, &api);
    }

    let mut secret_ref = default_env_for(&id).to_string();
    if matches!(id.as_str(), "wecom" | "slack" | "dingtalk")
        && key
            .chars()
            .all(|c| c.is_ascii_uppercase() || c == '_' || c.is_ascii_digit())
        && key.contains('_')
        && !key.starts_with("SEC")
        && !key.starts_with("xox")
    {
        secret_ref = key.clone();
        key.clear();
    }

    if id == "dingtalk" {
        api = normalize_dingtalk_api(&api);
    }

    let mut extra = ExtraCreds {
        key: key.clone(),
        chat_id: if id == "telegram" {
            api.clone()
        } else if id == "feishu" && mode == "app" {
            if receive_id.is_empty() {
                prev_extra.chat_id.clone()
            } else {
                receive_id.clone()
            }
        } else {
            String::new()
        },
        mode: if id == "feishu" {
            mode.clone()
        } else {
            String::new()
        },
        meeting_sync: if id == "feishu" && mode == "app" {
            // 开放平台默认开启开会同步；payload 显式传入时以传入为准
            payload.meeting_sync.unwrap_or(true)
        } else {
            payload.meeting_sync.unwrap_or(prev_extra.meeting_sync)
        },
        kf_sync: if id == "wecom" {
            payload.kf_sync.unwrap_or(prev_extra.kf_sync)
        } else {
            false
        },
        kf_open_kfid: if id == "wecom" {
            payload
                .kf_open_kfid
                .clone()
                .filter(|s| !s.trim().is_empty())
                .or_else(|| {
                    payload
                        .receive_id
                        .clone()
                        .filter(|s| !s.trim().is_empty())
                })
                .unwrap_or(prev_extra.kf_open_kfid.clone())
        } else {
            String::new()
        },
        kf_corp_id: if id == "wecom" {
            payload
                .kf_corp_id
                .clone()
                .filter(|s| !s.trim().is_empty())
                .unwrap_or(prev_extra.kf_corp_id.clone())
        } else {
            String::new()
        },
    };
    if id == "telegram" {
        extra.chat_id = api.clone();
    }
    if id == "feishu" && mode != "app" {
        extra.meeting_sync = false;
    }

    let has_creds = match id.as_str() {
        "telegram" => !api.is_empty() && !key.is_empty(),
        "feishu" if mode == "app" => api.starts_with("cli_") && !key.is_empty(),
        _ => !api.is_empty(),
    };

    let enabled = if has_creds {
        payload.enabled.unwrap_or(true)
    } else {
        payload.enabled.unwrap_or(prev_enabled)
    };

    let row = ChannelEndpointRow {
        id: id.clone(),
        enabled,
        kind: if mode == "app" {
            "app".into()
        } else {
            "api_key".into()
        },
        webhook_url: Some(api),
        secret_ref: Some(secret_ref),
        extra_json: dump_extra(&extra),
        updated_at: now_ms(),
    };
    desktop_db::upsert_channel_endpoint(&conn, &row)
}

#[tauri::command]
pub async fn xu_channel_probe(
    db: State<'_, FouDb>,
    id: String,
) -> Result<ChannelProbeResult, String> {
    let id = id.trim().to_lowercase();
    if id == "os" {
        return Ok(ChannelProbeResult {
            ok: true,
            message: "本机通知始终可用".into(),
            bot_name: None,
        });
    }
    let (api, key, receive_id, mode) = resolve_channel_creds(&db, &id);
    match id.as_str() {
        "telegram" => {
            if key.is_empty() {
                return Ok(ChannelProbeResult {
                    ok: false,
                    message: "请先填写 Bot Token（Key）并保存".into(),
                    bot_name: None,
                });
            }
            match telegram_get_me(&key).await {
                Ok(name) => {
                    let chat_note = if api.is_empty() {
                        "；尚缺 Chat ID（API），保存后即可发消息"
                    } else {
                        "；Chat ID 已填，可试发"
                    };
                    Ok(ChannelProbeResult {
                        ok: true,
                        message: format!("Telegram Bot 已识别：{name}{chat_note}"),
                        bot_name: Some(name),
                    })
                }
                Err(e) => Ok(ChannelProbeResult {
                    ok: false,
                    message: e,
                    bot_name: None,
                }),
            }
        }
        "slack" => {
            if key.starts_with("xoxb-") || key.starts_with("xoxp-") {
                match slack_auth_test(&key).await {
                    Ok(name) => Ok(ChannelProbeResult {
                        ok: true,
                        message: format!(
                            "Slack Bot 已识别：{name}{}",
                            if api.trim().is_empty() {
                                "；请再填频道 ID"
                            } else {
                                "；可试发"
                            }
                        ),
                        bot_name: Some(name),
                    }),
                    Err(e) => Ok(ChannelProbeResult {
                        ok: false,
                        message: e,
                        bot_name: None,
                    }),
                }
            } else if api.contains("hooks.slack.com") {
                match deliver_channel(
                    "slack",
                    &api,
                    &key,
                    "虚募阁连通测试",
                    "API+Key 已保存，连接成功。",
                    "",
                    "",
                )
                .await
                {
                    Ok(()) => Ok(ChannelProbeResult {
                        ok: true,
                        message: "Slack Incoming Webhook 连通成功".into(),
                        bot_name: None,
                    }),
                    Err(e) => Ok(ChannelProbeResult {
                        ok: false,
                        message: e,
                        bot_name: None,
                    }),
                }
            } else {
                Ok(ChannelProbeResult {
                    ok: false,
                    message: "请填写 Incoming Webhook URL，或 Bot Token + 频道 ID".into(),
                    bot_name: None,
                })
            }
        }
        "feishu" => {
            let use_app = mode == "app" || api.starts_with("cli_");
            if use_app {
                if !api.starts_with("cli_") || key.is_empty() {
                    return Ok(ChannelProbeResult {
                        ok: false,
                        message: "请填写 App ID（cli_…）与 App Secret 并保存".into(),
                        bot_name: None,
                    });
                }
                match feishu_tenant_access_token(&api, &key).await {
                    Ok(token) => match feishu_bot_info(&token).await {
                        Ok((name, act, open_id)) => {
                            let act_label = feishu_activate_label(act);
                            let chat_hint = if receive_id.is_empty() {
                                "；接收方可留空（将自动选用所在群）"
                            } else {
                                "；已指定接收方"
                            };
                            let oid = if open_id.is_empty() {
                                String::new()
                            } else {
                                format!("；open_id={open_id}")
                            };
                            let ok = act == 2;
                            Ok(ChannelProbeResult {
                                ok,
                                message: if ok {
                                    format!(
                                        "飞书机器人「{name}」已识别（{act_label}）{chat_hint}{oid}"
                                    )
                                } else {
                                    format!(
                                        "飞书机器人「{name}」状态异常：{act_label}。请到开放平台启用机器人并发布企业安装{oid}"
                                    )
                                },
                                bot_name: Some(name),
                            })
                        }
                        Err(e) => Ok(ChannelProbeResult {
                            ok: false,
                            message: e,
                            bot_name: None,
                        }),
                    },
                    Err(e) => Ok(ChannelProbeResult {
                        ok: false,
                        message: e,
                        bot_name: None,
                    }),
                }
            } else {
                match deliver_channel(
                    "feishu",
                    &api,
                    &key,
                    "虚募阁连通测试",
                    "Webhook 已保存，连接成功。",
                    &receive_id,
                    "webhook",
                )
                .await
                {
                    Ok(()) => Ok(ChannelProbeResult {
                        ok: true,
                        message: "飞书 Webhook 连通成功（已投递测试消息）".into(),
                        bot_name: None,
                    }),
                    Err(e) => Ok(ChannelProbeResult {
                        ok: false,
                        message: e,
                        bot_name: None,
                    }),
                }
            }
        }
        other => match deliver_channel(
            other,
            &api,
            &key,
            "虚募阁连通测试",
            "API+Key 已保存，连接成功。",
            &receive_id,
            &mode,
        )
        .await
        {
            Ok(()) => Ok(ChannelProbeResult {
                ok: true,
                message: format!("{other} 连通成功（已按官方格式投递测试消息）"),
                bot_name: None,
            }),
            Err(e) => Ok(ChannelProbeResult {
                ok: false,
                message: e,
                bot_name: None,
            }),
        },
    }
}

#[tauri::command]
pub async fn xu_channel_send_chat(
    db: State<'_, FouDb>,
    channel: String,
    text: String,
) -> Result<NotifyBossResult, String> {
    let channel = channel.trim().to_lowercase();
    let text = text.trim().to_string();
    if text.is_empty() {
        return Err("对话内容不能为空".into());
    }
    if channel == "os" {
        return Err("本机通知不支持对话通道".into());
    }
    let (api, key, receive_id, mode) = resolve_channel_creds(&db, &channel);
    match deliver_channel(&channel, &api, &key, "对话", &text, &receive_id, &mode).await {
        Ok(()) => Ok(NotifyBossResult {
            ok: true,
            throttled: false,
            channel,
            os_notified: false,
            gateway_sent: true,
            webhook_sent: true,
            message: "对话消息已发送".into(),
        }),
        Err(e) => Ok(NotifyBossResult {
            ok: false,
            throttled: false,
            channel,
            os_notified: false,
            gateway_sent: false,
            webhook_sent: false,
            message: e,
        }),
    }
}

#[tauri::command]
pub async fn xu_os_notify(app: AppHandle, title: String, body: String) -> Result<bool, String> {
    Ok(show_os_notification(&app, title.trim(), body.trim()))
}

#[tauri::command]
pub async fn xu_notify_boss(
    app: AppHandle,
    db: State<'_, FouDb>,
    kind: String,
    title: String,
    body: String,
    channel: Option<String>,
    force: Option<bool>,
) -> Result<NotifyBossResult, String> {
    let force = force.unwrap_or(false);
    let kind = if kind.trim().is_empty() {
        "general"
    } else {
        kind.trim()
    };
    if !force && throttle_hit(&db, kind) {
        return Ok(NotifyBossResult {
            ok: true,
            throttled: true,
            channel: get_pref_channel(&db),
            os_notified: false,
            gateway_sent: false,
            webhook_sent: false,
            message: format!("同类通知已合并（{THROTTLE_SECS}s 内不重复发送）"),
        });
    }

    let mut channel = channel.unwrap_or_default().trim().to_lowercase();
    if channel.is_empty() {
        channel = get_pref_channel(&db);
    }
    if channel.is_empty() {
        channel = "feishu".into();
    }

    let title = if title.trim().is_empty() {
        "虚募阁通知".to_string()
    } else {
        title.trim().to_string()
    };
    let body = body.trim().to_string();

    let os_notified =
        show_os_notification(&app, &title, if body.is_empty() { &title } else { &body });

    let mut webhook_sent = false;
    let message;

    if channel == "os" {
        message = if os_notified {
            "已发送本机通知".into()
        } else {
            "本机通知失败，请检查系统通知权限".into()
        };
    } else {
        let (api, key, receive_id, mode) = resolve_channel_creds(&db, &channel);
        if api.is_empty() && !(channel == "telegram" && !key.is_empty()) {
            message = format!(
                "未配置 {channel}（已发本机通知）。请在多端连接填写 API 与 Key，或设置 {}",
                default_env_for(&channel)
            );
        } else {
            match deliver_channel(&channel, &api, &key, &title, &body, &receive_id, &mode).await {
                Ok(()) => {
                    webhook_sent = true;
                    message = format!("已投递到 {channel}");
                }
                Err(e) => {
                    message = format!(
                        "投递失败（已发本机通知）。请到多端连接检查 {channel} 的 API/Key。{e}"
                    );
                }
            }
        }
    }

    if webhook_sent || os_notified {
        throttle_mark(&db, kind);
    }

    Ok(NotifyBossResult {
        ok: webhook_sent || os_notified,
        throttled: false,
        channel,
        os_notified,
        gateway_sent: webhook_sent,
        webhook_sent,
        message,
    })
}

#[tauri::command]
pub async fn xu_gateway_health_tick(
    _db: State<'_, FouDb>,
    _app: AppHandle,
) -> Result<Option<NotifyBossResult>, String> {
    Ok(None)
}

fn sanitize_filename(s: &str) -> String {
    s.chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .take(48)
        .collect()
}

#[tauri::command]
pub async fn xu_feishu_doc_analyze(url: String) -> Result<FeishuDocResult, String> {
    let url = url.trim().to_string();
    if url.is_empty() {
        return Err("请粘贴飞书文档链接".into());
    }
    let lower = url.to_lowercase();
    if !(lower.contains("feishu.cn")
        || lower.contains("larksuite.com")
        || lower.contains("feishu.com"))
    {
        return Err("链接不像飞书文档，请使用 feishu.cn / larksuite.com 链接".into());
    }

    let base = dirs::data_local_dir()
        .or_else(dirs::home_dir)
        .ok_or_else(|| "找不到本地数据目录".to_string())?;
    let dir = base.join("xu").join("feishu-docs");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let stamp = now_ms();
    let path = dir.join(format!("{}_{}.md", stamp, sanitize_filename(&url)));

    let body = format!(
        "# 飞书文档（占位）\n\n- 来源：{url}\n- 说明：方案 A 下不再经 Hermes Gateway 读析。\n\
         - 请导出/粘贴正文到 虚募阁记忆，或后续配置飞书开放平台凭证后再读析。\n"
    );
    let md = format!("---\nsource: {url}\ncreatedAt: {stamp}\nvia: fou-desktop\n---\n\n{body}\n");
    std::fs::write(&path, &md).map_err(|e| e.to_string())?;

    Ok(FeishuDocResult {
        ok: false,
        local_path: path.to_string_lossy().to_string(),
        summary: body.chars().take(400).collect(),
        message: "已保存链接占位 Markdown（未调用 Hermes）".into(),
    })
}
