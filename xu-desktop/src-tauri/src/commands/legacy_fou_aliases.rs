//! 兼容旧前端（stale dist / MSI）仍调用的 `fou_*` 鉴权命令，转发到 `xu_*`。
//!
//! @author qiuye <yjk150@qq.com>
//! @date 2026-09-01
//! @version 1.0.0
//! @category Auth
//! @algo none

use tauri::State;

use crate::desktop_db::FouDb;
use crate::RolePackState;

use super::auth::{
    AuthCreds, AuthPermissions, AuthSessionView, xu_auth_bootstrap, xu_auth_change_password,
    xu_auth_dev_login, xu_auth_login, xu_auth_logout, xu_auth_me, xu_auth_register, xu_auth_require,
    xu_auth_verify_password,
};
use super::cloud_auth::{
    CloudAuthCreds, CloudChangePasswordPayload, CloudRevalidatePayload, CloudVerifyPasswordPayload,
    xu_cloud_auth_change_password, xu_cloud_auth_login, xu_cloud_auth_refresh,
    xu_cloud_auth_register, xu_cloud_auth_revalidate, xu_cloud_auth_verify_password,
};

/// Duty: 旧名登录 → 新命令。失败同 `xu_cloud_auth_login`。
#[tauri::command]
pub async fn fou_cloud_auth_login(
    db: State<'_, FouDb>,
    pack_state: State<'_, RolePackState>,
    payload: CloudAuthCreds,
) -> Result<AuthSessionView, String> {
    xu_cloud_auth_login(db, pack_state, payload).await
}

#[tauri::command]
pub async fn fou_cloud_auth_register(
    db: State<'_, FouDb>,
    pack_state: State<'_, RolePackState>,
    payload: CloudAuthCreds,
) -> Result<AuthSessionView, String> {
    xu_cloud_auth_register(db, pack_state, payload).await
}

#[tauri::command]
pub async fn fou_cloud_auth_refresh(
    pack_state: State<'_, RolePackState>,
    refresh_token: String,
    server_url: Option<String>,
) -> Result<serde_json::Value, String> {
    xu_cloud_auth_refresh(pack_state, refresh_token, server_url).await
}

#[tauri::command]
pub async fn fou_cloud_auth_revalidate(
    pack_state: State<'_, RolePackState>,
    payload: CloudRevalidatePayload,
) -> Result<serde_json::Value, String> {
    xu_cloud_auth_revalidate(pack_state, payload).await
}

#[tauri::command]
pub async fn fou_cloud_auth_change_password(
    pack_state: State<'_, RolePackState>,
    payload: CloudChangePasswordPayload,
) -> Result<(), String> {
    xu_cloud_auth_change_password(pack_state, payload).await
}

#[tauri::command]
pub async fn fou_cloud_auth_verify_password(
    pack_state: State<'_, RolePackState>,
    payload: CloudVerifyPasswordPayload,
) -> Result<(), String> {
    xu_cloud_auth_verify_password(pack_state, payload).await
}

#[tauri::command]
pub fn fou_auth_bootstrap(db: State<'_, FouDb>) -> Result<serde_json::Value, String> {
    xu_auth_bootstrap(db)
}

#[tauri::command]
pub fn fou_auth_register(
    db: State<'_, FouDb>,
    payload: AuthCreds,
) -> Result<AuthSessionView, String> {
    xu_auth_register(db, payload)
}

#[tauri::command]
pub fn fou_auth_login(db: State<'_, FouDb>, payload: AuthCreds) -> Result<AuthSessionView, String> {
    xu_auth_login(db, payload)
}

#[tauri::command]
pub fn fou_auth_dev_login(db: State<'_, FouDb>) -> Result<AuthSessionView, String> {
    xu_auth_dev_login(db)
}

#[tauri::command]
pub fn fou_auth_logout(db: State<'_, FouDb>, token: String) -> Result<(), String> {
    xu_auth_logout(db, token)
}

#[tauri::command]
pub fn fou_auth_me(db: State<'_, FouDb>, token: String) -> Result<Option<AuthSessionView>, String> {
    xu_auth_me(db, token)
}

#[tauri::command]
pub fn fou_auth_require(
    db: State<'_, FouDb>,
    token: String,
    capability: String,
) -> Result<AuthPermissions, String> {
    xu_auth_require(db, token, capability)
}

#[tauri::command]
pub fn fou_auth_verify_password(
    db: State<'_, FouDb>,
    token: String,
    password: String,
) -> Result<(), String> {
    xu_auth_verify_password(db, token, password)
}

#[tauri::command]
pub fn fou_auth_change_password(
    db: State<'_, FouDb>,
    token: String,
    old_password: String,
    new_password: String,
) -> Result<(), String> {
    xu_auth_change_password(db, token, old_password, new_password)
}
