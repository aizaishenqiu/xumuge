//! Cloud account login (AI-server / license-server contract).
//! Bridges remote JWT into a local app_sessions row so existing xu_auth_* gates keep working.

use serde::Deserialize;
use tauri::State;
use uuid::Uuid;

use super::auth::{
    create_session_for_user, ensure_user_with_role, perms_for_role_pub, AuthSessionView,
    AuthUserView,
};
use crate::desktop_db::FouDb;
use crate::role_pack::endpoint::{load_prefs, strip_to_v1_root};
use crate::role_pack::RolePackState;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudAuthCreds {
    pub email: String,
    pub password: String,
    /// Override account API root (…/v1 or …/api/v1)
    pub server_url: Option<String>,
}

fn default_account_base() -> String {
    normalize_account_base(&crate::xu_env::default_account_base())
}

/// Accept `…/v1`, `…/v1/activate`, `…/api/v1`.
fn normalize_account_base(url: &str) -> String {
    let t = url.trim().trim_end_matches('/');
    if t.contains("/api/v1") {
        if let Some(idx) = t.find("/api/v1") {
            return format!("{}{}", &t[..idx], "/api/v1");
        }
    }
    strip_to_v1_root(t)
}

fn auth_login_urls(base: &str) -> Vec<String> {
    let b = base.trim_end_matches('/');
    vec![format!("{b}/auth/login"), format!("{b}/auth/register")]
}

fn extract_tokens(body: &serde_json::Value) -> Result<(String, Option<String>, u64), String> {
    // Envelope { code, data: { access_token… } }
    if let Some(code) = body.get("code").and_then(|c| c.as_i64()) {
        if code != 0 {
            let msg = body
                .get("msg")
                .or_else(|| body.get("error"))
                .and_then(|m| m.as_str())
                .unwrap_or("登录失败");
            return Err(humanize_account_error(msg));
        }
        if let Some(data) = body.get("data") {
            let access = data
                .get("access_token")
                .and_then(|x| x.as_str())
                .ok_or_else(|| "响应缺少 access_token".to_string())?;
            let refresh = data
                .get("refresh_token")
                .and_then(|x| x.as_str())
                .map(|s| s.to_string());
            let exp = data
                .get("expires_in")
                .and_then(|x| x.as_u64())
                .unwrap_or(900);
            return Ok((access.to_string(), refresh, exp));
        }
    }
    // Flat
    let access = body
        .get("access_token")
        .and_then(|x| x.as_str())
        .ok_or_else(|| "响应缺少 access_token".to_string())?;
    let refresh = body
        .get("refresh_token")
        .and_then(|x| x.as_str())
        .map(|s| s.to_string());
    let exp = body
        .get("expires_in")
        .and_then(|x| x.as_u64())
        .unwrap_or(900);
    Ok((access.to_string(), refresh, exp))
}

async fn post_json(
    url: &str,
    body: &serde_json::Value,
) -> Result<(reqwest::StatusCode, serde_json::Value), String> {
    let client = reqwest::Client::new();
    let resp = client
        .post(url)
        .json(body)
        .send()
        .await
        .map_err(|e| humanize_account_error(&format!("账号服务不可达: {e}")))?;
    let status = resp.status();
    let v: serde_json::Value = resp.json().await.unwrap_or(serde_json::json!({}));
    Ok((status, v))
}

async fn get_json_auth(
    url: &str,
    access: &str,
) -> Result<(reqwest::StatusCode, serde_json::Value), String> {
    let client = reqwest::Client::new();
    let resp = client
        .get(url)
        .header("Authorization", format!("Bearer {access}"))
        .send()
        .await
        .map_err(|e| humanize_account_error(&format!("账号服务不可达: {e}")))?;
    let status = resp.status();
    let v: serde_json::Value = resp.json().await.unwrap_or(serde_json::json!({}));
    Ok((status, v))
}

fn me_response_ok(status: reqwest::StatusCode, body: &serde_json::Value) -> bool {
    if !status.is_success() {
        return false;
    }
    if let Some(code) = body.get("code").and_then(|c| c.as_i64()) {
        return code == 0;
    }
    body.get("email").is_some() || body.get("data").is_some()
}

fn extract_edition(body: &serde_json::Value) -> Option<String> {
    let data = body.get("data").unwrap_or(body);
    let from_root = data
        .get("edition")
        .and_then(|x| x.as_str())
        .map(|s| s.trim().to_lowercase());
    if let Some(ref e) = from_root {
        if !e.is_empty() {
            return Some(e.clone());
        }
    }
    let user = data.get("user")?;
    let from_user = user
        .get("edition")
        .and_then(|x| x.as_str())
        .map(|s| s.trim().to_lowercase());
    if let Some(ref e) = from_user {
        if !e.is_empty() {
            return Some(e.clone());
        }
    }
    let role = user
        .get("role")
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .to_lowercase();
    if matches!(role.as_str(), "enterprise" | "org" | "company") {
        Some("enterprise".into())
    } else {
        Some("solo".into())
    }
}

fn extract_product_expires_at(body: &serde_json::Value) -> Option<String> {
    let data = body.get("data").unwrap_or(body);
    data.get("product_expires_at")
        .or_else(|| data.get("productExpiresAt"))
        .and_then(|x| x.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

fn account_error_from_body(body: &serde_json::Value, fallback: &str) -> String {
    let msg = body
        .get("msg")
        .or_else(|| body.get("error"))
        .and_then(|m| m.as_str())
        .unwrap_or(fallback);
    humanize_account_error(msg)
}

fn extract_cloud_user(
    body: &serde_json::Value,
) -> (Option<String>, Option<String>, Option<String>) {
    let data = body.get("data").unwrap_or(body);
    let user = match data.get("user") {
        Some(u) => u,
        None => return (None, None, None),
    };
    let cloud_id = user
        .get("id")
        .and_then(|x| x.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    let nickname = user
        .get("nickname")
        .and_then(|x| x.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    let public_id = user
        .get("publicId")
        .or_else(|| user.get("public_id"))
        .and_then(|x| x.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    (cloud_id, nickname, public_id)
}

fn bridge_local_session(
    db: &FouDb,
    email: &str,
    edition: Option<String>,
    cloud_user_id: Option<String>,
    nickname: Option<String>,
    public_id: Option<String>,
) -> Result<AuthSessionView, String> {
    let username = email.trim().to_lowercase();
    if username.len() < 3 {
        return Err("邮箱/账号过短".into());
    }
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    // Ensure local mirror user (password is random; cloud is source of truth).
    let random_pw = format!("cloud-{}", Uuid::new_v4());
    ensure_user_with_role(&conn, &username, &random_pw, "user")?;
    let (id, role): (String, String) = conn
        .query_row(
            "SELECT id, role FROM app_users WHERE username = ?1",
            rusqlite::params![username],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(|e| e.to_string())?;
    // Upgrade trial → user on successful cloud login
    if role == "trial" {
        let _ = conn.execute(
            "UPDATE app_users SET role = 'user' WHERE id = ?1",
            rusqlite::params![id],
        );
    }
    let role = if role == "trial" {
        "user".to_string()
    } else {
        role
    };
    let token = create_session_for_user(&conn, &id)?;
    Ok(AuthSessionView {
        token,
        user: AuthUserView {
            id,
            username,
            role: role.clone(),
            edition,
            cloud_user_id,
            nickname,
            public_id,
        },
        permissions: perms_for_role_pub(&role),
        is_dev_build: cfg!(debug_assertions),
        cleared_storage: false,
        auth_source: Some("cloud".into()),
        cloud_access_token: None,
        cloud_refresh_token: None,
        product_expires_at: None,
    })
}

fn resolve_base(state: &RolePackState, override_url: Option<&str>) -> String {
    if let Some(u) = override_url.filter(|s| !s.trim().is_empty()) {
        return normalize_account_base(u);
    }
    if let Ok(env) = std::env::var("XU_ACCOUNT_URL") {
        let t = env.trim();
        if !t.is_empty() {
            return normalize_account_base(t);
        }
    }
    if let Ok(guard) = state.inner.lock() {
        let prefs = load_prefs(guard.user_pack_dir());
        if !prefs.cloud_base_url.trim().is_empty() {
            return normalize_account_base(&prefs.cloud_base_url);
        }
    }
    default_account_base()
}

fn is_login_credential_error(msg: &str) -> bool {
    let t = msg.trim();
    if t.is_empty() {
        return true;
    }
    if t.contains("账号或密码错误") || t.contains("密码错误") || t.contains("invalid credentials") {
        return true;
    }
    // UTF-8 中文被按字节当 Latin-1 显示时的典型乱码（账号或密码错误）
    t.contains('è')
        && (t.contains('å') || t.contains('æ'))
        && (t.contains('é') || t.contains('è'))
}

fn humanize_account_error(msg: &str) -> String {
    let lower = msg.to_lowercase();
    if is_login_credential_error(msg) {
        return "账号或密码错误".into();
    }
    // 绝不可把完整请求 URL 直接返回给前端弹窗/控制台文案
    let stripped = regex_lite_strip_urls(msg).trim().to_string();

    if lower.contains("invalid connection") || lower.contains("bad connection") {
        return "账号服务数据库连接异常，请稍后重试；若持续失败请确认 AI-server 与 MySQL 已启动"
            .into();
    }
    if lower.contains("connection refused")
        || lower.contains("actively refused")
        || lower.contains("timed out")
        || lower.contains("账号服务不可达")
        || lower.contains("error sending request")
    {
        return "无法连接账号服务。开发环境请确认 AI-server 已运行在 http://127.0.0.1:8080".into();
    }
    if stripped.is_empty() || stripped.starts_with("http://") || stripped.starts_with("https://") {
        return "账号或密码错误".into();
    }
    if is_login_credential_error(&stripped) {
        return "账号或密码错误".into();
    }
    stripped
}

/// 去掉 `error sending request for url (…)` / 裸 URL，避免弹给用户。
fn regex_lite_strip_urls(msg: &str) -> String {
    if !msg.contains("http://") && !msg.contains("https://") {
        return msg.trim().to_string();
    }
    let mut out = msg.to_string();
    // reqwest: error sending request for url (http://…): …
    if let Some(start) = out.find("error sending request for url (") {
        if let Some(end_rel) = out[start..].find(')') {
            let end = start + end_rel + 1;
            let mut rest = out[end..].trim_start_matches([':', ' ']).to_string();
            if rest.is_empty() {
                rest = "账号服务不可达".into();
            }
            out = rest;
        }
    }
    // 剥离残余 http(s)://…（按空白分词，保留 UTF-8）
    out.split_whitespace()
        .filter(|w| !w.starts_with("http://") && !w.starts_with("https://"))
        .collect::<Vec<_>>()
        .join(" ")
}

#[tauri::command]
pub async fn xu_cloud_auth_login(
    db: State<'_, FouDb>,
    pack_state: State<'_, RolePackState>,
    payload: CloudAuthCreds,
) -> Result<AuthSessionView, String> {
    let email = payload.email.trim().to_lowercase();
    let password = payload.password;
    if email.len() < 3 || password.len() < 6 {
        return Err("请输入有效邮箱/账号与密码（至少 6 位）".into());
    }
    let base = resolve_base(&pack_state, payload.server_url.as_deref());
    let url = format!("{}/auth/login", base.trim_end_matches('/'));
    let (status, body) = post_json(
        &url,
        &serde_json::json!({ "email": email, "password": password }),
    )
    .await?;
    if !status.is_success() {
        return Err(account_error_from_body(&body, "账号或密码错误"));
    }
    let (access, refresh, _exp) = extract_tokens(&body)?;
    let edition = extract_edition(&body);
    let (cloud_user_id, nickname, public_id) = extract_cloud_user(&body);
    let mut session =
        bridge_local_session(&db, &email, edition, cloud_user_id, nickname, public_id)?;
    session.cloud_access_token = Some(access);
    session.cloud_refresh_token = refresh;
    session.auth_source = Some("cloud".into());
    session.product_expires_at = extract_product_expires_at(&body);
    Ok(session)
}

#[tauri::command]
pub async fn xu_cloud_auth_register(
    db: State<'_, FouDb>,
    pack_state: State<'_, RolePackState>,
    payload: CloudAuthCreds,
) -> Result<AuthSessionView, String> {
    let email = payload.email.trim().to_lowercase();
    let password = payload.password;
    if email.len() < 3 || password.len() < 6 {
        return Err("请输入有效邮箱/账号与密码（至少 6 位）".into());
    }
    let base = resolve_base(&pack_state, payload.server_url.as_deref());
    let url = format!("{}/auth/register", base.trim_end_matches('/'));
    let (status, body) = post_json(
        &url,
        &serde_json::json!({ "email": email, "password": password }),
    )
    .await?;
    if !status.is_success() {
        let msg = body
            .get("msg")
            .or_else(|| body.get("error"))
            .and_then(|m| m.as_str())
            .unwrap_or("注册失败");
        return Err(humanize_account_error(msg));
    }
    // Some servers return tokens on register; else login
    if body.get("access_token").is_some()
        || body
            .get("data")
            .and_then(|d| d.get("access_token"))
            .is_some()
    {
        let (access, refresh, _) = extract_tokens(&body)?;
        let edition = extract_edition(&body);
        let (cloud_user_id, nickname, public_id) = extract_cloud_user(&body);
        let mut session =
            bridge_local_session(&db, &email, edition, cloud_user_id, nickname, public_id)?;
        session.cloud_access_token = Some(access);
        session.cloud_refresh_token = refresh;
        session.auth_source = Some("cloud".into());
        session.product_expires_at = extract_product_expires_at(&body);
        return Ok(session);
    }
    xu_cloud_auth_login(
        db,
        pack_state,
        CloudAuthCreds {
            email,
            password,
            server_url: payload.server_url,
        },
    )
    .await
}

#[tauri::command]
pub async fn xu_cloud_auth_refresh(
    pack_state: State<'_, RolePackState>,
    refresh_token: String,
    server_url: Option<String>,
) -> Result<serde_json::Value, String> {
    let base = resolve_base(&pack_state, server_url.as_deref());
    let url = format!("{}/auth/refresh", base.trim_end_matches('/'));
    let (status, body) = post_json(
        &url,
        &serde_json::json!({ "refresh_token": refresh_token.trim() }),
    )
    .await?;
    if !status.is_success() {
        return Err("刷新令牌失败，请重新登录".into());
    }
    let (access, refresh, exp) = extract_tokens(&body)?;
    Ok(serde_json::json!({
        "accessToken": access,
        "refreshToken": refresh,
        "expiresIn": exp,
    }))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudRevalidatePayload {
    pub access_token: Option<String>,
    pub refresh_token: Option<String>,
    pub server_url: Option<String>,
}

/// Refresh tokens if needed, then GET /auth/me — used for 7-day permission lease.
#[tauri::command]
pub async fn xu_cloud_auth_revalidate(
    pack_state: State<'_, RolePackState>,
    payload: CloudRevalidatePayload,
) -> Result<serde_json::Value, String> {
    let base = resolve_base(&pack_state, payload.server_url.as_deref());
    let me_url = format!("{}/auth/me", base.trim_end_matches('/'));
    let refresh = payload
        .refresh_token
        .as_deref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string());
    let access = payload
        .access_token
        .as_deref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string());

    if let Some(ref tok) = access {
        let (status, body) = get_json_auth(&me_url, tok).await?;
        if me_response_ok(status, &body) {
            return Ok(serde_json::json!({
                "accessToken": tok,
                "refreshToken": refresh,
            }));
        }
    }

    let rt = refresh.ok_or_else(|| "云端会话已失效，请重新登录".to_string())?;
    let refresh_url = format!("{}/auth/refresh", base.trim_end_matches('/'));
    let (status, body) =
        post_json(&refresh_url, &serde_json::json!({ "refresh_token": rt })).await?;
    if !status.is_success() {
        return Err("云端权限认证失败，请重新登录".into());
    }
    let (access_new, refresh_new, _) = extract_tokens(&body)?;
    let (me_status, me_body) = get_json_auth(&me_url, &access_new).await?;
    if !me_response_ok(me_status, &me_body) {
        return Err("云端权限认证失败，请重新登录".into());
    }
    Ok(serde_json::json!({
        "accessToken": access_new,
        "refreshToken": refresh_new.or(Some(rt)),
    }))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudChangePasswordPayload {
    pub old_password: String,
    pub new_password: String,
    pub access_token: String,
    pub server_url: Option<String>,
}

#[tauri::command]
pub async fn xu_cloud_auth_change_password(
    pack_state: State<'_, RolePackState>,
    payload: CloudChangePasswordPayload,
) -> Result<(), String> {
    let new_password = payload.new_password.trim();
    if new_password.len() < 6 {
        return Err("新密码至少 6 位".into());
    }
    let access = payload.access_token.trim();
    if access.is_empty() {
        return Err("云端会话已失效，请重新登录".into());
    }
    let base = resolve_base(&pack_state, payload.server_url.as_deref());
    let url = format!("{}/auth/change-password", base.trim_end_matches('/'));
    let client = reqwest::Client::new();
    let resp = client
        .post(&url)
        .header("Authorization", format!("Bearer {access}"))
        .json(&serde_json::json!({
            "old_password": payload.old_password,
            "new_password": new_password,
        }))
        .send()
        .await
        .map_err(|e| humanize_account_error(&format!("账号服务不可达: {e}")))?;
    let status = resp.status();
    let body: serde_json::Value = resp.json().await.unwrap_or(serde_json::json!({}));
    if !status.is_success() {
        let msg = body
            .get("msg")
            .or_else(|| body.get("error"))
            .and_then(|m| m.as_str())
            .unwrap_or("修改密码失败");
        return Err(humanize_account_error(msg));
    }
    if let Some(code) = body.get("code").and_then(|c| c.as_i64()) {
        if code != 0 {
            let msg = body
                .get("msg")
                .or_else(|| body.get("error"))
                .and_then(|m| m.as_str())
                .unwrap_or("修改密码失败");
            return Err(humanize_account_error(msg));
        }
    }
    Ok(())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudVerifyPasswordPayload {
    pub email: String,
    pub password: String,
    pub server_url: Option<String>,
}

/// Re-check cloud credentials for destructive local actions (does not replace session).
#[tauri::command]
pub async fn xu_cloud_auth_verify_password(
    pack_state: State<'_, RolePackState>,
    payload: CloudVerifyPasswordPayload,
) -> Result<(), String> {
    let email = payload.email.trim();
    let password = payload.password.trim();
    if email.is_empty() || password.is_empty() {
        return Err("请输入账号与密码".into());
    }
    let base = resolve_base(&pack_state, payload.server_url.as_deref());
    let url = format!("{}/auth/login", base.trim_end_matches('/'));
    let client = reqwest::Client::new();
    let resp = client
        .post(&url)
        .json(&serde_json::json!({
            "email": email,
            "password": password,
        }))
        .send()
        .await
        .map_err(|e| humanize_account_error(&format!("账号服务不可达: {e}")))?;
    let status = resp.status();
    let body: serde_json::Value = resp.json().await.unwrap_or(serde_json::json!({}));
    if !status.is_success() {
        let msg = body
            .get("msg")
            .or_else(|| body.get("error"))
            .and_then(|m| m.as_str())
            .unwrap_or("密码错误");
        return Err(if msg.contains("密码") || msg.contains("账号") {
            msg.to_string()
        } else {
            "密码错误".into()
        });
    }
    if let Some(code) = body.get("code").and_then(|c| c.as_i64()) {
        if code != 0 {
            let msg = body
                .get("msg")
                .or_else(|| body.get("error"))
                .and_then(|m| m.as_str())
                .unwrap_or("密码错误");
            return Err(humanize_account_error(msg));
        }
    }
    Ok(())
}

// silence unused import helper list
#[allow(dead_code)]
fn _urls(base: &str) -> Vec<String> {
    auth_login_urls(base)
}
