//! App login / register / trial permissions. No Hermes dependency.

use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::State;
use uuid::Uuid;

use crate::desktop_db::FouDb;

const SETTING_FRESH: &str = "xu.fresh_install_v1";
const SESSION_HOURS: i64 = 24 * 14;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthUserView {
    pub id: String,
    pub username: String,
    pub role: String,
    /// `solo` | `enterprise` — from cloud account attribute when available
    #[serde(skip_serializing_if = "Option::is_none")]
    pub edition: Option<String>,
    /// Cloud xu_users.id (when auth_source = cloud)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cloud_user_id: Option<String>,
    /// Human-readable id e.g. VM1A2B3C4D5
    #[serde(skip_serializing_if = "Option::is_none")]
    pub public_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub nickname: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthSessionView {
    pub token: String,
    pub user: AuthUserView,
    pub permissions: AuthPermissions,
    pub is_dev_build: bool,
    pub cleared_storage: bool,
    /// `local` | `cloud`
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auth_source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cloud_access_token: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cloud_refresh_token: Option<String>,
    /// Server product hard-deadline (RFC3339); dual-check with VITE_PRODUCT_EXPIRES_AT
    #[serde(skip_serializing_if = "Option::is_none")]
    pub product_expires_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthPermissions {
    pub full: bool,
    pub max_employees: i64,
    pub token_hard_limit: i64,
    pub allow_drive: bool,
    pub allow_dispatch: bool,
    pub allow_channel_save: bool,
    pub allow_memory_write: bool,
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn hash_password(password: &str) -> Result<String, String> {
    bcrypt::hash(password, bcrypt::DEFAULT_COST).map_err(|e| e.to_string())
}

fn verify_password(password: &str, hash: &str) -> bool {
    bcrypt::verify(password, hash).unwrap_or(false)
}

fn perms_for_role(role: &str) -> AuthPermissions {
    match role {
        "admin" | "user" => AuthPermissions {
            full: true,
            max_employees: 999,
            token_hard_limit: 2_000_000,
            allow_drive: true,
            allow_dispatch: true,
            allow_channel_save: true,
            allow_memory_write: true,
        },
        _ => AuthPermissions {
            // trial
            full: false,
            max_employees: 3,
            token_hard_limit: 100_000,
            allow_drive: false,
            allow_dispatch: false,
            allow_channel_save: false,
            allow_memory_write: false,
        },
    }
}

pub(crate) fn perms_for_role_pub(role: &str) -> AuthPermissions {
    perms_for_role(role)
}

fn ensure_user(
    conn: &rusqlite::Connection,
    username: &str,
    password: &str,
    role: &str,
) -> Result<(), String> {
    let exists: bool = conn
        .query_row(
            "SELECT 1 FROM app_users WHERE username = ?1",
            rusqlite::params![username],
            |_| Ok(true),
        )
        .unwrap_or(false);
    if exists {
        return Ok(());
    }
    let hash = hash_password(password)?;
    conn.execute(
        "INSERT INTO app_users(id, username, password_hash, role, created_at) VALUES(?1,?2,?3,?4,?5)",
        rusqlite::params![Uuid::new_v4().to_string(), username, hash, role, now_ms()],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub(crate) fn ensure_user_with_role(
    conn: &rusqlite::Connection,
    username: &str,
    password: &str,
    role: &str,
) -> Result<(), String> {
    ensure_user(conn, username, password, role)
}

fn apply_trial_limits(conn: &rusqlite::Connection) -> Result<(), String> {
    conn.execute(
        "INSERT INTO settings(key, value) VALUES('token.package.hard_limit', '100000')
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn create_session(conn: &rusqlite::Connection, user_id: &str) -> Result<String, String> {
    let token = Uuid::new_v4().to_string();
    let now = now_ms();
    let expires = now + SESSION_HOURS * 3600 * 1000;
    conn.execute(
        "INSERT INTO app_sessions(token, user_id, created_at, expires_at) VALUES(?1,?2,?3,?4)",
        rusqlite::params![token, user_id, now, expires],
    )
    .map_err(|e| e.to_string())?;
    Ok(token)
}

pub(crate) fn create_session_for_user(
    conn: &rusqlite::Connection,
    user_id: &str,
) -> Result<String, String> {
    create_session(conn, user_id)
}

fn user_by_token(conn: &rusqlite::Connection, token: &str) -> Result<Option<AuthUserView>, String> {
    let now = now_ms();
    let row = conn.query_row(
        "SELECT u.id, u.username, u.role FROM app_sessions s
         JOIN app_users u ON u.id = s.user_id
         WHERE s.token = ?1 AND s.expires_at > ?2",
        rusqlite::params![token, now],
        |r| {
            Ok(AuthUserView {
                id: r.get(0)?,
                username: r.get(1)?,
                role: r.get(2)?,
                edition: None,
                cloud_user_id: None,
                nickname: None,
                public_id: None,
            })
        },
    );
    match row {
        Ok(u) => Ok(Some(u)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn xu_auth_bootstrap(db: State<'_, FouDb>) -> Result<serde_json::Value, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut cleared_storage = false;
    let is_dev = cfg!(debug_assertions);

    if is_dev {
        ensure_user(&conn, "admin", "123456", "admin")?;
    } else {
        let fresh: Option<String> = conn
            .query_row(
                "SELECT value FROM settings WHERE key = ?1",
                rusqlite::params![SETTING_FRESH],
                |r| r.get(0),
            )
            .ok();
        if fresh.as_deref() != Some("done") {
            // Wipe sensitive settings for packaged first launch
            let _ = conn.execute("DELETE FROM settings WHERE key LIKE 'ops_%'", []);
            let _ = conn.execute("DELETE FROM channel_endpoints", []);
            let _ = conn.execute(
                "INSERT INTO settings(key, value) VALUES(?1, 'done')
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                rusqlite::params![SETTING_FRESH],
            );
            cleared_storage = true;
        }
        ensure_user(&conn, "trial", "trial123", "trial")?;
        apply_trial_limits(&conn)?;
    }

    Ok(serde_json::json!({
        "isDevBuild": is_dev,
        "clearedStorage": cleared_storage,
        "hint": if is_dev { "admin / 123456" } else { "trial / trial123（受限试用）" },
    }))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthCreds {
    pub username: String,
    pub password: String,
}

#[tauri::command]
pub fn xu_auth_register(
    db: State<'_, FouDb>,
    payload: AuthCreds,
) -> Result<AuthSessionView, String> {
    let username = payload.username.trim().to_lowercase();
    let password = payload.password;
    if username.len() < 3 {
        return Err("用户名至少 3 个字符".into());
    }
    if password.len() < 6 {
        return Err("密码至少 6 位".into());
    }
    if username == "admin" && !cfg!(debug_assertions) {
        return Err("不能注册保留用户名".into());
    }
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let exists: bool = conn
        .query_row(
            "SELECT 1 FROM app_users WHERE username = ?1",
            rusqlite::params![username],
            |_| Ok(true),
        )
        .unwrap_or(false);
    if exists {
        return Err("用户名已存在".into());
    }
    let id = Uuid::new_v4().to_string();
    let hash = hash_password(&password)?;
    conn.execute(
        "INSERT INTO app_users(id, username, password_hash, role, created_at) VALUES(?1,?2,?3,'user',?4)",
        rusqlite::params![id, username, hash, now_ms()],
    )
    .map_err(|e| e.to_string())?;
    let token = create_session(&conn, &id)?;
    let user = AuthUserView {
        id,
        username,
        role: "user".into(),
        edition: None,
        cloud_user_id: None,
        nickname: None,
        public_id: None,
    };
    Ok(AuthSessionView {
        token,
        permissions: perms_for_role("user"),
        user,
        is_dev_build: cfg!(debug_assertions),
        cleared_storage: false,
        auth_source: Some("local".into()),
        cloud_access_token: None,
        cloud_refresh_token: None,
        product_expires_at: None,
    })
}

#[tauri::command]
pub fn xu_auth_login(db: State<'_, FouDb>, payload: AuthCreds) -> Result<AuthSessionView, String> {
    let username = payload.username.trim().to_lowercase();
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let row: Result<(String, String, String), _> = conn.query_row(
        "SELECT id, password_hash, role FROM app_users WHERE username = ?1",
        rusqlite::params![username],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
    );
    let (id, hash, role) = row.map_err(|_| "用户名或密码错误".to_string())?;
    if !verify_password(&payload.password, &hash) {
        return Err("用户名或密码错误".into());
    }
    if role == "trial" {
        apply_trial_limits(&conn)?;
    }
    let token = create_session(&conn, &id)?;
    Ok(AuthSessionView {
        token,
        user: AuthUserView {
            id,
            username,
            role: role.clone(),
            edition: None,
            cloud_user_id: None,
            nickname: None,
            public_id: None,
        },
        permissions: perms_for_role(&role),
        is_dev_build: cfg!(debug_assertions),
        cleared_storage: false,
        auth_source: Some("local".into()),
        cloud_access_token: None,
        cloud_refresh_token: None,
        product_expires_at: None,
    })
}

/// Dev-only: one-click login as admin (debug builds only).
#[tauri::command]
pub fn xu_auth_dev_login(db: State<'_, FouDb>) -> Result<AuthSessionView, String> {
    if !cfg!(debug_assertions) {
        return Err("正式版不可使用一键登录".into());
    }
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    ensure_user(&conn, "admin", "123456", "admin")?;
    let (id, role): (String, String) = conn
        .query_row(
            "SELECT id, role FROM app_users WHERE username = 'admin'",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(|e| e.to_string())?;
    let token = create_session(&conn, &id)?;
    Ok(AuthSessionView {
        token,
        user: AuthUserView {
            id,
            username: "admin".into(),
            role: role.clone(),
            edition: None,
            cloud_user_id: None,
            nickname: None,
            public_id: None,
        },
        permissions: perms_for_role(&role),
        is_dev_build: true,
        cleared_storage: false,
        auth_source: Some("local".into()),
        cloud_access_token: None,
        cloud_refresh_token: None,
        product_expires_at: None,
    })
}

#[tauri::command]
pub fn xu_auth_logout(db: State<'_, FouDb>, token: String) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM app_sessions WHERE token = ?1",
        rusqlite::params![token],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Local session view. Cloud tokens / product_expires_at are merged on the Vue side
/// from `xu.cloud.*` / `xu.product.expires_at` after this command (see restoreSession).
#[tauri::command]
pub fn xu_auth_me(db: State<'_, FouDb>, token: String) -> Result<Option<AuthSessionView>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let Some(user) = user_by_token(&conn, token.trim())? else {
        return Ok(None);
    };
    Ok(Some(AuthSessionView {
        token: token.trim().to_string(),
        permissions: perms_for_role(&user.role),
        user,
        is_dev_build: cfg!(debug_assertions),
        cleared_storage: false,
        auth_source: Some("local".into()),
        cloud_access_token: None,
        cloud_refresh_token: None,
        product_expires_at: None,
    }))
}

#[tauri::command]
pub fn xu_auth_require(
    db: State<'_, FouDb>,
    token: String,
    capability: String,
) -> Result<AuthPermissions, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let user =
        user_by_token(&conn, token.trim())?.ok_or_else(|| "未登录或会话已过期".to_string())?;
    let perms = perms_for_role(&user.role);
    let cap = capability.trim();
    let ok = match cap {
        "dispatch" => perms.allow_dispatch,
        "drive" => perms.allow_drive,
        "channel_save" => perms.allow_channel_save,
        "memory_write" => perms.allow_memory_write,
        "full" => perms.full,
        "role_pack_download" => perms.full,
        _ => true,
    };
    if !ok {
        return Err(format!(
            "试用账号无权限：{cap}（请注册正式账号后再保存通道配置）"
        ));
    }
    Ok(perms)
}

#[tauri::command]
pub fn xu_auth_verify_password(
    db: State<'_, FouDb>,
    token: String,
    password: String,
) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let user =
        user_by_token(&conn, token.trim())?.ok_or_else(|| "未登录或会话已过期".to_string())?;
    let hash: String = conn
        .query_row(
            "SELECT password_hash FROM app_users WHERE id = ?1",
            rusqlite::params![user.id],
            |r| r.get(0),
        )
        .map_err(|_| "用户不存在".to_string())?;
    if !verify_password(password.trim(), &hash) {
        return Err("密码错误".into());
    }
    Ok(())
}

#[tauri::command]
pub fn xu_auth_change_password(
    db: State<'_, FouDb>,
    token: String,
    old_password: String,
    new_password: String,
) -> Result<(), String> {
    let new_password = new_password.trim().to_string();
    if new_password.len() < 6 {
        return Err("新密码至少 6 位".into());
    }
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let user =
        user_by_token(&conn, token.trim())?.ok_or_else(|| "未登录或会话已过期".to_string())?;
    let hash: String = conn
        .query_row(
            "SELECT password_hash FROM app_users WHERE id = ?1",
            rusqlite::params![user.id],
            |r| r.get(0),
        )
        .map_err(|_| "用户不存在".to_string())?;
    if !verify_password(old_password.trim(), &hash) {
        return Err("旧密码错误".into());
    }
    let new_hash = hash_password(&new_password)?;
    conn.execute(
        "UPDATE app_users SET password_hash = ?1 WHERE id = ?2",
        rusqlite::params![new_hash, user.id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudAdoptPayload {
    pub email: String,
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub cloud_user_id: Option<String>,
    pub role: Option<String>,
}

/// After successful cloud account login: upsert local user and issue app session.
#[tauri::command]
pub fn xu_auth_adopt_cloud(
    db: State<'_, FouDb>,
    payload: CloudAdoptPayload,
) -> Result<AuthSessionView, String> {
    let email = payload.email.trim().to_lowercase();
    if email.is_empty() {
        return Err("邮箱为空".into());
    }
    let role = match payload.role.as_deref().unwrap_or("user") {
        "admin" => "admin",
        "trial" => "trial",
        _ => "user",
    };
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let existing: Option<(String, String)> = conn
        .query_row(
            "SELECT id, role FROM app_users WHERE username = ?1",
            rusqlite::params![email],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .ok();
    let (id, role_final) = if let Some((id, r)) = existing {
        (id, r)
    } else {
        let id = payload
            .cloud_user_id
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| Uuid::new_v4().to_string());
        // Placeholder hash — cloud users authenticate remotely; local password verify may fail.
        let hash = hash_password(&Uuid::new_v4().to_string())?;
        conn.execute(
            "INSERT INTO app_users(id, username, password_hash, role, created_at) VALUES(?1,?2,?3,?4,?5)",
            rusqlite::params![id, email, hash, role, now_ms()],
        )
        .map_err(|e| e.to_string())?;
        (id, role.to_string())
    };
    let _ = conn.execute(
        "INSERT INTO settings(key, value) VALUES('xu.cloud.access_token', ?1)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        rusqlite::params![payload.access_token],
    );
    if let Some(rt) = payload.refresh_token.as_ref().filter(|s| !s.is_empty()) {
        let _ = conn.execute(
            "INSERT INTO settings(key, value) VALUES('xu.cloud.refresh_token', ?1)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            rusqlite::params![rt],
        );
    }
    let _ = conn.execute(
        "INSERT INTO settings(key, value) VALUES('xu.cloud.email', ?1)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        rusqlite::params![email],
    );
    let token = create_session(&conn, &id)?;
    Ok(AuthSessionView {
        token,
        user: AuthUserView {
            id,
            username: email,
            role: role_final.clone(),
            edition: None,
            cloud_user_id: None,
            nickname: None,
            public_id: None,
        },
        permissions: perms_for_role(&role_final),
        is_dev_build: cfg!(debug_assertions),
        cleared_storage: false,
        auth_source: Some("cloud".into()),
        cloud_access_token: Some(payload.access_token.clone()),
        cloud_refresh_token: payload.refresh_token.clone(),
        product_expires_at: None,
    })
}
