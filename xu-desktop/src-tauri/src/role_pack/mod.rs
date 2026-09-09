//! Encrypted `.xupack` role catalog loader (decrypt in Rust only).

mod codec;
pub(crate) mod endpoint;
mod license;
mod session_vault;
mod state;

pub use state::RolePackState;

use endpoint::{
    join_v1, load_prefs, resolve_endpoint, save_prefs, EditionPrefs, FouEdition, ResolvedEndpoint,
};
use license::{
    get_or_create_machine_id, list_subscriptions, save_subscription, subscription_valid,
    LicenseSubscription,
};
use serde::{Deserialize, Serialize};
use session_vault::SessionKeyEntry;
use state::{InstalledPackRecord, RoleMeta};
use tauri::{AppHandle, State};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RolePackActivateResult {
    pub ok: bool,
    pub message: String,
    pub pack_id: Option<String>,
    pub expires_at: Option<String>,
    pub content_version: Option<String>,
    pub download_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub endpoint_source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub revoked_other: Option<bool>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct InstalledPackInfo {
    pub pack_id: String,
    pub locale: String,
    pub role_count: usize,
    pub path: String,
    pub demo: bool,
    pub built_at: Option<String>,
    pub content_version: Option<String>,
    pub expires_at: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LicenseStatusInfo {
    pub machine_id: String,
    pub subscriptions: Vec<LicenseSubscription>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RolePackUpdateInfo {
    pub pack_id: String,
    pub locale: String,
    pub content_version: String,
    pub download_url: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RolePackCheckUpdatesResult {
    pub updates: Vec<RolePackUpdateInfo>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RolePackCatalogStatus {
    pub role_count: usize,
    pub is_demo_catalog: bool,
    pub demo_role_cap: usize,
}

#[tauri::command]
pub fn role_pack_catalog_status(
    state: State<'_, RolePackState>,
) -> Result<RolePackCatalogStatus, String> {
    let guard = state.inner.lock().map_err(|e| e.to_string())?;
    let role_count = guard.list_role_meta().len();
    let has_commercial = guard
        .installed_packs()
        .iter()
        .any(|p| !p.demo || p.pack_id.contains("hermes-roles-zh-CN"));
    let is_demo_catalog = !has_commercial && role_count <= 12;
    Ok(RolePackCatalogStatus {
        role_count,
        is_demo_catalog,
        demo_role_cap: 5,
    })
}

#[tauri::command]
pub fn role_pack_list_installed(
    state: State<'_, RolePackState>,
) -> Result<Vec<InstalledPackInfo>, String> {
    let guard = state.inner.lock().map_err(|e| e.to_string())?;
    Ok(guard
        .installed_packs()
        .into_iter()
        .map(|p| pack_info_from_record(&p))
        .collect())
}

#[tauri::command]
pub fn role_pack_list_roles(state: State<'_, RolePackState>) -> Result<Vec<RoleMeta>, String> {
    let guard = state.inner.lock().map_err(|e| e.to_string())?;
    let prefs = load_prefs(guard.user_pack_dir());
    let mut roles = guard.list_role_meta();
    if prefs.edition == FouEdition::Enterprise && !prefs.active_role_ids.is_empty() {
        let set: std::collections::HashSet<_> = prefs.active_role_ids.iter().cloned().collect();
        roles.retain(|r| set.contains(&r.id) || set.contains(&r.slug));
    }
    Ok(roles)
}

#[tauri::command]
pub fn role_pack_list_roles_all(state: State<'_, RolePackState>) -> Result<Vec<RoleMeta>, String> {
    let guard = state.inner.lock().map_err(|e| e.to_string())?;
    Ok(guard.list_role_meta())
}

#[tauri::command]
pub fn role_pack_get_prompt(
    state: State<'_, RolePackState>,
    role_id: String,
) -> Result<Option<String>, String> {
    let guard = state.inner.lock().map_err(|e| e.to_string())?;
    let prefs = load_prefs(guard.user_pack_dir());
    if prefs.edition == FouEdition::Enterprise && !prefs.active_role_ids.is_empty() {
        let allowed = prefs.active_role_ids.iter().any(|id| {
            id == &role_id
                || guard
                    .list_role_meta()
                    .iter()
                    .any(|r| r.id == role_id && (id == &r.slug || id == &r.id))
        });
        if !allowed {
            return Ok(None);
        }
    }
    Ok(guard.get_prompt(&role_id))
}

#[tauri::command]
pub fn role_pack_machine_id(state: State<'_, RolePackState>) -> Result<String, String> {
    let guard = state.inner.lock().map_err(|e| e.to_string())?;
    get_or_create_machine_id(guard.user_pack_dir())
}

#[tauri::command]
pub fn role_pack_license_status(
    state: State<'_, RolePackState>,
) -> Result<LicenseStatusInfo, String> {
    let guard = state.inner.lock().map_err(|e| e.to_string())?;
    let machine_id = get_or_create_machine_id(guard.user_pack_dir())?;
    let subscriptions = list_subscriptions(guard.user_pack_dir())
        .into_iter()
        .filter(subscription_valid)
        .collect();
    Ok(LicenseStatusInfo {
        machine_id,
        subscriptions,
    })
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FouLicenseEntitlementsInfo {
    pub machine_id: String,
    pub entitlements: Vec<String>,
}

#[tauri::command]
pub fn xu_license_entitlements(
    state: State<'_, RolePackState>,
) -> Result<FouLicenseEntitlementsInfo, String> {
    let guard = state.inner.lock().map_err(|e| e.to_string())?;
    let machine_id = get_or_create_machine_id(guard.user_pack_dir())?;
    let mut set = std::collections::BTreeSet::<String>::new();
    for sub in list_subscriptions(guard.user_pack_dir())
        .into_iter()
        .filter(subscription_valid)
    {
        for e in sub.entitlements {
            let t = e.trim().to_string();
            if !t.is_empty() {
                set.insert(t);
            }
        }
        let pid = sub.pack_id.trim();
        if pid == "canvas.studio" || pid == "training.ingest" || pid == "workflow.studio" {
            set.insert(pid.to_string());
        }
    }
    if cfg!(debug_assertions) {
        if let Ok(env) = std::env::var("XU_DEV_ENTITLEMENTS") {
            for part in env.split(|c: char| c == ',' || c == ';' || c.is_whitespace()) {
                let t = part.trim();
                if !t.is_empty() {
                    set.insert(t.to_string());
                }
            }
        }
    }
    Ok(FouLicenseEntitlementsInfo {
        machine_id,
        entitlements: set.into_iter().collect(),
    })
}

#[tauri::command]
pub fn role_pack_import(
    app: AppHandle,
    state: State<'_, RolePackState>,
    path: String,
    key_hex: Option<String>,
) -> Result<InstalledPackInfo, String> {
    let mut guard = state.inner.lock().map_err(|e| e.to_string())?;
    let record = guard.import_pack_file(&app, &path, key_hex.as_deref(), None)?;
    Ok(pack_info_from_record(&record))
}

/// 从临时下载链拉取 .xupack 到本机用户岗位目录（语音包等大文件勿走此路径）。
/// 依赖: http(s) URL；失败返回可读错误。
#[tauri::command]
pub async fn role_pack_download_url(
    state: State<'_, RolePackState>,
    url: String,
    pack_id: Option<String>,
) -> Result<String, String> {
    let url = url.trim().to_string();
    if url.is_empty() {
        return Err("下载地址为空".into());
    }
    if !(url.starts_with("https://") || url.starts_with("http://") || url.starts_with("file://")) {
        return Err("仅支持 http(s)/file 下载".into());
    }
    let pid = pack_id
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "downloaded-role-pack".into());
    let user_dir = {
        let guard = state.inner.lock().map_err(|e| e.to_string())?;
        guard.user_pack_dir().to_path_buf()
    };
    download_xupack_to_user_dir(&user_dir, &pid, &url).await
}

#[tauri::command]
pub async fn role_pack_activate(
    app: AppHandle,
    state: State<'_, RolePackState>,
    license: String,
    path: String,
    server_url: Option<String>,
) -> Result<RolePackActivateResult, String> {
    // Legacy path: prefer session login when edition prefs exist; still support activate.
    role_pack_session_login(
        app,
        state,
        license,
        Some(path),
        server_url,
        None,
        None,
        None,
    )
    .await
}

/// Account/license session login → temp unwrap key in memory → optional one-shot pack pull.
#[tauri::command]
pub async fn role_pack_session_login(
    app: AppHandle,
    state: State<'_, RolePackState>,
    license: String,
    path: Option<String>,
    server_url: Option<String>,
    account: Option<String>,
    password: Option<String>,
    access_token: Option<String>,
) -> Result<RolePackActivateResult, String> {
    let license = license.trim();
    let has_bearer = access_token
        .as_ref()
        .map(|s| !s.trim().is_empty())
        .unwrap_or(false);
    let has_account = account
        .as_ref()
        .map(|s| !s.trim().is_empty())
        .unwrap_or(false);
    if license.is_empty() && !has_account && !has_bearer {
        return Err("请输入许可证、账号，或先完成云端登录（Bearer）".into());
    }

    let (machine_id, prefs, user_dir) = {
        let guard = state.inner.lock().map_err(|e| e.to_string())?;
        let dir = guard.user_pack_dir().to_path_buf();
        let mid = get_or_create_machine_id(&dir)?;
        let prefs = load_prefs(&dir);
        (mid, prefs, dir)
    };

    let resolved = if let Some(url) = server_url.filter(|s| !s.trim().is_empty()) {
        ResolvedEndpoint {
            base_url: endpoint::strip_to_v1_root(&url),
            source: "override".into(),
            local_tried: false,
            local_ok: false,
        }
    } else {
        resolve_endpoint(&prefs).await
    };

    let edition_str = match prefs.edition {
        FouEdition::Solo => "solo",
        FouEdition::Enterprise => "enterprise",
    };

    let client = reqwest::Client::new();
    let login_url = join_v1(&resolved.base_url, "session/login");
    let mut req = client.post(&login_url).json(&serde_json::json!({
        "license": license,
        "account": account,
        "password": password,
        "product": "hermes-role-pack",
        "machine_id": machine_id,
        "edition": edition_str,
    }));
    if let Some(tok) = access_token.as_ref().filter(|s| !s.trim().is_empty()) {
        req = req.header("Authorization", format!("Bearer {tok}"));
    }
    let resp = req.send().await;

    // Fallback to classic /activate if session/login missing
    let (status, body_val) = match resp {
        Ok(r) if r.status().as_u16() == 404 => {
            let activate_url = join_v1(&resolved.base_url, "activate");
            let r2 = client
                .post(&activate_url)
                .json(&serde_json::json!({
                    "license": license,
                    "product": "hermes-role-pack",
                    "machine_id": machine_id,
                    "edition": edition_str,
                }))
                .send()
                .await
                .map_err(|e| format!("激活请求失败: {e}"))?;
            let st = r2.status();
            let v: serde_json::Value = r2.json().await.unwrap_or(serde_json::json!({}));
            (st, v)
        }
        Ok(r) => {
            let st = r.status();
            let v: serde_json::Value = r.json().await.unwrap_or(serde_json::json!({}));
            (st, v)
        }
        Err(e) => return Err(format!("会话登录失败: {e}")),
    };

    if status.as_u16() == 409 {
        return Ok(RolePackActivateResult {
            ok: false,
            message: body_val
                .get("error")
                .and_then(|x| x.as_str())
                .unwrap_or("单独版：该账号已在其他设备登录")
                .to_string(),
            pack_id: None,
            expires_at: None,
            content_version: None,
            download_url: None,
            endpoint_source: Some(resolved.source),
            session_id: None,
            revoked_other: Some(false),
        });
    }

    if !status.is_success() {
        let msg = body_val
            .get("error")
            .or_else(|| body_val.get("message"))
            .and_then(|x| x.as_str())
            .unwrap_or("许可证无效或服务不可用")
            .to_string();
        return Ok(RolePackActivateResult {
            ok: false,
            message: msg,
            pack_id: None,
            expires_at: None,
            content_version: None,
            download_url: None,
            endpoint_source: Some(resolved.source),
            session_id: None,
            revoked_other: None,
        });
    }

    let pack_key = body_val
        .get("unwrap_key_hex")
        .or_else(|| body_val.get("pack_key_hex"))
        .and_then(|x| x.as_str())
        .ok_or_else(|| "响应缺少临时密钥".to_string())?
        .to_string();
    let pack_id = body_val
        .get("pack_id")
        .and_then(|x| x.as_str())
        .unwrap_or("hermes-roles-zh-CN")
        .to_string();
    let session_id = body_val
        .get("session_id")
        .and_then(|x| x.as_str())
        .unwrap_or("sess")
        .to_string();
    let expires_at = body_val
        .get("expires_at")
        .and_then(|x| x.as_str())
        .map(|s| s.to_string())
        .unwrap_or_else(session_vault::default_expires_at);
    let seats = body_val.get("seats").and_then(|x| x.as_u64()).unwrap_or(1) as u32;
    let download_url = body_val
        .get("download_url")
        .and_then(|x| x.as_str())
        .map(|s| s.to_string());
    let content_version = body_val
        .get("content_version")
        .and_then(|x| x.as_str())
        .map(|s| s.to_string());
    let revoked_other = body_val
        .get("revoked_other")
        .and_then(|x| x.as_bool())
        .unwrap_or(false);
    let refresh = body_val
        .get("refresh_token")
        .and_then(|x| x.as_str())
        .map(|s| s.to_string());
    let entitlements: Vec<String> = body_val
        .get("entitlements")
        .and_then(|x| x.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default();

    session_vault::set_account_session(session_id.clone(), refresh.clone());
    session_vault::put_key(SessionKeyEntry {
        pack_id: pack_id.clone(),
        unwrap_key_hex: pack_key.clone(),
        session_id: session_id.clone(),
        expires_at: expires_at.clone(),
        edition: edition_str.to_string(),
        seats,
        refresh_token: refresh,
    });

    // One-shot pull encrypted pack if no local path and download_url present
    let mut import_path = path.filter(|p| !p.trim().is_empty());
    if import_path.is_none() {
        if let Some(ref url) = download_url {
            match download_xupack_to_user_dir(&user_dir, &pack_id, url).await {
                Ok(p) => import_path = Some(p),
                Err(e) => eprintln!("[role-pack] download pack failed: {e}"),
            }
        }
    }

    let record = if let Some(ref p) = import_path {
        let mut guard = state.inner.lock().map_err(|e| e.to_string())?;
        let rec = guard.import_pack_file(&app, p, Some(&pack_key), Some(expires_at.clone()))?;
        let dir = guard.user_pack_dir().to_path_buf();
        drop(guard);
        save_subscription(
            &dir,
            LicenseSubscription {
                license: if license.is_empty() {
                    account.clone().unwrap_or_default()
                } else {
                    license.to_string()
                },
                pack_id: pack_id.clone(),
                machine_id: machine_id.clone(),
                expires_at: Some(expires_at.clone()),
                seats,
                content_version: content_version.clone(),
                activated_at: chrono::Utc::now().to_rfc3339(),
                entitlements,
            },
        )?;
        Some(rec)
    } else {
        // Key in vault only — reload commercial if pack already on disk
        let mut guard = state.inner.lock().map_err(|e| e.to_string())?;
        let n = guard.reload_commercial_with_vault().unwrap_or(0);
        drop(guard);
        save_subscription(
            &user_dir,
            LicenseSubscription {
                license: if license.is_empty() {
                    account.unwrap_or_default()
                } else {
                    license.to_string()
                },
                pack_id: pack_id.clone(),
                machine_id,
                expires_at: Some(expires_at.clone()),
                seats,
                content_version: content_version.clone(),
                activated_at: chrono::Utc::now().to_rfc3339(),
                entitlements,
            },
        )?;
        let _ = n;
        None
    };

    let mut msg = body_val
        .get("message")
        .and_then(|x| x.as_str())
        .unwrap_or("会话登录成功，临时密钥已载入内存")
        .to_string();
    if resolved.source == "cloud_fallback" {
        msg.push_str("（本地服不可达，已使用云端）");
    }

    Ok(RolePackActivateResult {
        ok: true,
        message: msg,
        pack_id: Some(record.map(|r| r.pack_id).unwrap_or(pack_id)),
        expires_at: Some(expires_at),
        content_version,
        download_url,
        endpoint_source: Some(resolved.source),
        session_id: Some(session_id),
        revoked_other: Some(revoked_other),
    })
}

async fn download_xupack_to_user_dir(
    user_dir: &std::path::Path,
    pack_id: &str,
    url: &str,
) -> Result<String, String> {
    // Support file:// and http(s)
    if url.starts_with("file://") || std::path::Path::new(url).is_file() {
        let path = url.trim_start_matches("file://");
        return Ok(path.to_string());
    }
    let client = reqwest::Client::new();
    let bytes = client
        .get(url)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .bytes()
        .await
        .map_err(|e| e.to_string())?;
    std::fs::create_dir_all(user_dir).map_err(|e| e.to_string())?;
    let dest = user_dir.join(format!("{pack_id}-download.xupack"));
    std::fs::write(&dest, &bytes).map_err(|e| e.to_string())?;
    Ok(dest.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn role_pack_session_renew(
    state: State<'_, RolePackState>,
    pack_id: Option<String>,
) -> Result<RolePackActivateResult, String> {
    let prefs = {
        let guard = state.inner.lock().map_err(|e| e.to_string())?;
        load_prefs(guard.user_pack_dir())
    };
    let resolved = resolve_endpoint(&prefs).await;
    let pid = pack_id.unwrap_or_else(|| "hermes-roles-zh-CN".into());
    let entry =
        session_vault::get_entry(&pid).ok_or_else(|| "无会话密钥，请重新登录".to_string())?;
    let machine_id = {
        let guard = state.inner.lock().map_err(|e| e.to_string())?;
        get_or_create_machine_id(guard.user_pack_dir())?
    };

    let client = reqwest::Client::new();
    let url = join_v1(&resolved.base_url, "session/renew");
    let resp = client
        .post(&url)
        .json(&serde_json::json!({
            "session_id": entry.session_id,
            "refresh_token": entry.refresh_token,
            "machine_id": machine_id,
            "pack_id": pid,
        }))
        .send()
        .await
        .map_err(|e| format!("续期失败: {e}"))?;

    if !resp.status().is_success() {
        session_vault::clear_all_keys();
        let mut guard = state.inner.lock().map_err(|e| e.to_string())?;
        guard.unload_commercial_roles();
        return Ok(RolePackActivateResult {
            ok: false,
            message: "会话已失效，请重新登录".into(),
            pack_id: Some(pid),
            expires_at: None,
            content_version: None,
            download_url: None,
            endpoint_source: Some(resolved.source),
            session_id: None,
            revoked_other: None,
        });
    }

    let body: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    let key = body
        .get("unwrap_key_hex")
        .or_else(|| body.get("pack_key_hex"))
        .and_then(|x| x.as_str())
        .unwrap_or(&entry.unwrap_key_hex)
        .to_string();
    let expires = body
        .get("expires_at")
        .and_then(|x| x.as_str())
        .map(|s| s.to_string())
        .unwrap_or_else(session_vault::default_expires_at);
    let sid = body
        .get("session_id")
        .and_then(|x| x.as_str())
        .unwrap_or(&entry.session_id)
        .to_string();

    session_vault::put_key(SessionKeyEntry {
        pack_id: pid.clone(),
        unwrap_key_hex: key,
        session_id: sid.clone(),
        expires_at: expires.clone(),
        edition: entry.edition,
        seats: entry.seats,
        refresh_token: body
            .get("refresh_token")
            .and_then(|x| x.as_str())
            .map(|s| s.to_string())
            .or(entry.refresh_token),
    });

    let mut guard = state.inner.lock().map_err(|e| e.to_string())?;
    let _ = guard.reload_commercial_with_vault();

    Ok(RolePackActivateResult {
        ok: true,
        message: "临时密钥已续期".into(),
        pack_id: Some(pid),
        expires_at: Some(expires),
        content_version: None,
        download_url: None,
        endpoint_source: Some(resolved.source),
        session_id: Some(sid),
        revoked_other: None,
    })
}

#[tauri::command]
pub fn role_pack_session_logout(
    app: AppHandle,
    state: State<'_, RolePackState>,
) -> Result<(), String> {
    session_vault::clear_account_session();
    session_vault::clear_all_keys();
    let mut guard = state.inner.lock().map_err(|e| e.to_string())?;
    guard.clear_roles();
    guard.reload_all(&app)?;
    Ok(())
}

#[tauri::command]
pub fn role_pack_session_status() -> Result<serde_json::Value, String> {
    let entries = session_vault::list_entries();
    Ok(serde_json::json!({
        "accountSessionId": session_vault::account_session_id(),
        "keys": entries,
    }))
}

#[tauri::command]
pub fn role_pack_get_edition_prefs(
    state: State<'_, RolePackState>,
) -> Result<EditionPrefs, String> {
    let guard = state.inner.lock().map_err(|e| e.to_string())?;
    Ok(load_prefs(guard.user_pack_dir()))
}

#[tauri::command]
pub fn role_pack_set_edition_prefs(
    state: State<'_, RolePackState>,
    prefs: EditionPrefs,
) -> Result<EditionPrefs, String> {
    let guard = state.inner.lock().map_err(|e| e.to_string())?;
    save_prefs(guard.user_pack_dir(), &prefs)?;
    Ok(prefs)
}

#[tauri::command]
pub async fn role_pack_resolve_endpoint(
    state: State<'_, RolePackState>,
) -> Result<ResolvedEndpoint, String> {
    let prefs = {
        let guard = state.inner.lock().map_err(|e| e.to_string())?;
        load_prefs(guard.user_pack_dir())
    };
    Ok(resolve_endpoint(&prefs).await)
}

#[tauri::command]
pub async fn role_pack_check_updates(
    state: State<'_, RolePackState>,
    server_url: Option<String>,
) -> Result<RolePackCheckUpdatesResult, String> {
    let installed: Vec<serde_json::Value> = {
        let guard = state.inner.lock().map_err(|e| e.to_string())?;
        guard
            .installed_packs()
            .into_iter()
            .filter(|p| !p.demo)
            .map(|p| {
                serde_json::json!({
                    "packId": p.pack_id,
                    "contentVersion": p.content_version.clone().unwrap_or_default(),
                })
            })
            .collect()
    };

    if installed.is_empty() {
        return Ok(RolePackCheckUpdatesResult { updates: vec![] });
    }

    let url = if let Some(u) = server_url.filter(|s| !s.trim().is_empty()) {
        if u.contains("check-updates") {
            u
        } else {
            join_v1(&endpoint::strip_to_v1_root(&u), "check-updates")
        }
    } else {
        let prefs = {
            let guard = state.inner.lock().map_err(|e| e.to_string())?;
            load_prefs(guard.user_pack_dir())
        };
        let resolved = resolve_endpoint(&prefs).await;
        join_v1(&resolved.base_url, "check-updates")
    };

    let client = reqwest::Client::new();
    let resp = client
        .post(&url)
        .json(&serde_json::json!({ "installed": installed }))
        .send()
        .await
        .map_err(|e| format!("检查更新失败: {e}"))?;

    if !resp.status().is_success() {
        return Err("许可证服务不可用".into());
    }

    #[derive(Deserialize)]
    struct RemoteUpdate {
        pack_id: String,
        locale: String,
        content_version: String,
        download_url: Option<String>,
    }

    #[derive(Deserialize)]
    struct RemoteBody {
        updates: Vec<RemoteUpdate>,
    }

    let body: RemoteBody = resp
        .json()
        .await
        .map_err(|e| format!("解析更新响应失败: {e}"))?;
    Ok(RolePackCheckUpdatesResult {
        updates: body
            .updates
            .into_iter()
            .map(|u| RolePackUpdateInfo {
                pack_id: u.pack_id,
                locale: u.locale,
                content_version: u.content_version,
                download_url: u.download_url,
            })
            .collect(),
    })
}

#[tauri::command]
pub fn role_pack_reload(app: AppHandle, state: State<'_, RolePackState>) -> Result<usize, String> {
    let mut guard = state.inner.lock().map_err(|e| e.to_string())?;
    guard.reload_all(&app)?;
    let _ = guard.reload_commercial_with_vault();
    Ok(guard.role_count())
}

fn pack_info_from_record(record: &InstalledPackRecord) -> InstalledPackInfo {
    InstalledPackInfo {
        pack_id: record.pack_id.clone(),
        locale: record.locale.clone(),
        role_count: record.role_count,
        path: record.path.clone(),
        demo: record.demo,
        built_at: record.built_at.clone(),
        content_version: record.content_version.clone(),
        expires_at: record.expires_at.clone(),
    }
}

pub fn init_managed(app: &AppHandle) -> Result<RolePackState, String> {
    let state = RolePackState::new();
    {
        let mut guard = state.inner.lock().map_err(|e| e.to_string())?;
        guard.reload_all(app)?;
    }
    Ok(state)
}
