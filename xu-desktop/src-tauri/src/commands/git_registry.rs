//! 本机 xu.db 多仓远程登记：账号令牌、云端列表与按仓上传。
//!
//! @file git_registry.rs
//! @author qiuye <yjk150@qq.com>
//! @date 2026-09-05
//! @updated 2026-09-05
//! @version 1.4.0
//! @category ToolPolicy
//! @algo sqlite-git-remote-registry
//!
//! 职责：Gitee/GitHub/自建 Git 凭证（加密）与本地仓路径存在 sqlite；绑定同步写 `.git/config`；push 用库地址+http.extraHeader。
//! 失败：无令牌、主分支直推、平台与 URL 不符、网络/git 错误返回中文；令牌不返回前端。

use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::State;
use uuid::Uuid;

use crate::desktop_db::{setting_get, setting_set, FouDb};

use super::git::{block_direct_main, configure_git_command, is_main_branch, run_git};
use super::git_token_crypto::{decrypt_token, encrypt_token, is_encrypted};

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn bucket(xu_user: Option<&str>) -> String {
    let t = xu_user.unwrap_or("").trim();
    if t.is_empty() {
        "local".into()
    } else {
        t.to_string()
    }
}

fn provider_ok(p: &str) -> Result<&str, String> {
    match p.trim().to_ascii_lowercase().as_str() {
        "gitee" => Ok("gitee"),
        "github" => Ok("github"),
        "custom" => Ok("custom"),
        other if other.is_empty() => Ok(""),
        _ => Err("仅支持 Gitee、GitHub 或自建 Git".into()),
    }
}

fn provider_from_url(url: &str) -> Option<&'static str> {
    let u = url.to_ascii_lowercase();
    if u.contains("gitee.com") {
        Some("gitee")
    } else if u.contains("github.com") {
        Some("github")
    } else if u.starts_with("http://")
        || u.starts_with("https://")
        || u.contains("git@")
        || u.starts_with("ssh://")
    {
        Some("custom")
    } else {
        None
    }
}

fn provider_label(provider: &str) -> &'static str {
    match provider {
        "gitee" => "Gitee",
        "github" => "GitHub",
        "custom" => "自建 Git",
        _ => "托管平台",
    }
}

/// 校验 clone URL 与所选平台一致；不匹配返回中文错误（无裸 URL）。
fn assert_provider_matches_url(provider: &str, url: &str) -> Result<(), String> {
    let Some(from_url) = provider_from_url(url) else {
        return Err("请填写有效的 Git 远程地址（HTTPS 或 SSH）".into());
    };
    if provider == "custom" {
        if from_url == "gitee" || from_url == "github" {
            return Err(format!(
                "当前选择的是自建 Git，但地址属于 {}。请切换平台或改用自建服务器地址。",
                provider_label(from_url)
            ));
        }
        return Ok(());
    }
    if from_url != provider {
        return Err(format!(
            "当前选择的是 {}，但地址属于 {}。请切换平台或改用对应地址。",
            provider_label(provider),
            provider_label(from_url)
        ));
    }
    Ok(())
}

/// 将远程写入真实 `.git/config`（有则改 URL，无则 add）。
fn git_remote_set_url(workspace: &str, remote_name: &str, url: &str) -> Result<(), String> {
    let name = remote_name.trim();
    let url = url.trim();
    if name.is_empty() || url.is_empty() {
        return Err("远程名和地址不能为空".into());
    }
    match run_git(workspace, &["remote", "get-url", name]) {
        Ok(_) => {
            run_git(workspace, &["remote", "set-url", name, url])?;
        }
        Err(_) => {
            run_git(workspace, &["remote", "add", name, url])?;
        }
    }
    Ok(())
}

fn scrub(msg: &str) -> String {
    let mut s = msg.to_string();
    for needle in ["Bearer ", "bearer ", "access_token=", "Authorization:"] {
        if let Some(i) = s.find(needle) {
            let rest = &s[i + needle.len()..];
            let cut = rest
                .find(|c: char| c.is_whitespace() || c == '&' || c == '"')
                .unwrap_or(rest.len().min(12));
            s.replace_range(i + needle.len()..i + needle.len() + cut, "***");
        }
    }
    s
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitAccountView {
    pub provider: String,
    pub username: String,
    pub has_token: bool,
    pub base_url: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GitRemoteRow {
    pub id: String,
    pub name: String,
    pub url: String,
    pub provider: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitRepoRow {
    pub id: String,
    pub local_path: String,
    pub display_name: String,
    pub default_branch: String,
    pub last_branch: String,
    pub cloud_full_name: String,
    pub remotes: Vec<GitRemoteRow>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCloudRepo {
    pub full_name: String,
    pub clone_url: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitRemoteInput {
    pub name: String,
    pub url: String,
    pub provider: Option<String>,
}

fn unique_id() -> String {
    Uuid::new_v4().to_string()
}

/// 保存或更新托管账户凭证。令牌为空且已有凭证时仅更新用户名/服务器地址。
#[tauri::command]
pub fn git_account_upsert(
    db: State<'_, FouDb>,
    xu_user: Option<String>,
    provider: String,
    username: String,
    token: String,
    base_url: Option<String>,
) -> Result<(), String> {
    let provider = provider_ok(&provider)?.to_string();
    if provider.is_empty() {
        return Err("请选择 Gitee、GitHub 或自建 Git".into());
    }
    let token = token.trim().to_string();
    let username = username.trim().to_string();
    let base = base_url
        .unwrap_or_default()
        .trim()
        .trim_end_matches('/')
        .to_string();
    if provider == "gitee" && username.is_empty() {
        return Err("Gitee 请填写登录用户名（与私人令牌一起作为账户凭证）".into());
    }
    if provider == "custom" {
        if username.is_empty() {
            return Err("自建 Git 请填写用户名".into());
        }
        if base.is_empty() {
            return Err("自建 Git 请填写服务器地址（例如 https://git.example.com）".into());
        }
        if !(base.starts_with("http://") || base.starts_with("https://")) {
            return Err("自建 Git 服务器地址请使用 http:// 或 https:// 开头".into());
        }
    }
    let user = bucket(xu_user.as_deref());
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let existing: Option<(String, String)> = conn
        .query_row(
            "SELECT token, COALESCE(base_url,'') FROM git_accounts WHERE xu_user=?1 AND provider=?2",
            params![user, provider],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let stored = if token.is_empty() {
        let Some((old_token, _)) = existing.as_ref() else {
            return Err("请填写私人令牌".into());
        };
        if old_token.trim().is_empty() {
            return Err("请填写私人令牌".into());
        }
        old_token.clone()
    } else {
        encrypt_token(&token)?
    };
    let id = unique_id();
    let now = now_ms();
    conn.execute(
        "INSERT INTO git_accounts(id, xu_user, provider, username, token, base_url, updated_at)
         VALUES(?1,?2,?3,?4,?5,?6,?7)
         ON CONFLICT(xu_user, provider) DO UPDATE SET
           username=excluded.username,
           token=excluded.token,
           base_url=excluded.base_url,
           updated_at=excluded.updated_at",
        params![id, user, provider, username, stored, base, now],
    )
    .map_err(|e| format!("保存凭证失败：{e}"))?;
    Ok(())
}

/// 列出已配置账号（不含令牌正文）。
#[tauri::command]
pub fn git_account_list(
    db: State<'_, FouDb>,
    xu_user: Option<String>,
) -> Result<Vec<GitAccountView>, String> {
    let user = bucket(xu_user.as_deref());
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT provider, username, LENGTH(token), COALESCE(base_url,'') FROM git_accounts WHERE xu_user=?1 ORDER BY provider",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![user], |r| {
            Ok(GitAccountView {
                provider: r.get(0)?,
                username: r.get(1)?,
                has_token: r.get::<_, i64>(2).unwrap_or(0) > 0,
                base_url: r.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

fn account_token(
    conn: &rusqlite::Connection,
    user: &str,
    provider: &str,
) -> Result<(String, String), String> {
    let (username, stored): (String, String) = conn
        .query_row(
            "SELECT username, token FROM git_accounts WHERE xu_user=?1 AND provider=?2",
            params![user, provider],
            |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)),
        )
        .map_err(|_| "尚未保存该平台的令牌".to_string())?;
    let plain = decrypt_token(&stored)?;
    if plain.trim().is_empty() {
        return Err("尚未保存该平台的令牌".into());
    }
    if !is_encrypted(&stored) {
        if let Ok(enc) = encrypt_token(&plain) {
            let _ = conn.execute(
                "UPDATE git_accounts SET token=?1, updated_at=?2 WHERE xu_user=?3 AND provider=?4",
                params![enc, now_ms(), user, provider],
            );
        }
    }
    Ok((username, plain))
}

fn import_flag_key(user: &str) -> String {
    format!("git.import_prompted:{user}")
}

/// 是否已提示过「导入本机已有仓库」。
#[tauri::command]
pub fn git_import_prompt_done(
    db: State<'_, FouDb>,
    xu_user: Option<String>,
) -> Result<bool, String> {
    let user = bucket(xu_user.as_deref());
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    Ok(setting_get(&conn, &import_flag_key(&user))?
        .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
        .unwrap_or(false))
}

/// 标记已提示（用户确认导入或选择暂不）。
#[tauri::command]
pub fn git_import_prompt_mark(
    db: State<'_, FouDb>,
    xu_user: Option<String>,
) -> Result<(), String> {
    let user = bucket(xu_user.as_deref());
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    setting_set(&conn, &import_flag_key(&user), "1")
}

/// 清除导入提示标记，允许再次弹出「发现本机仓库」。
#[tauri::command]
pub fn git_import_prompt_clear(
    db: State<'_, FouDb>,
    xu_user: Option<String>,
) -> Result<(), String> {
    let user = bucket(xu_user.as_deref());
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    setting_set(&conn, &import_flag_key(&user), "0")
}

/// 用库中令牌列出当前账号名下云端仓。
#[tauri::command]
pub async fn git_cloud_repos(
    db: State<'_, FouDb>,
    xu_user: Option<String>,
    provider: String,
) -> Result<Vec<GitCloudRepo>, String> {
    let provider = provider_ok(&provider)?.to_string();
    if provider.is_empty() {
        return Err("请选择 Gitee、GitHub 或自建 Git".into());
    }
    if provider == "custom" {
        return Ok(Vec::new());
    }
    let user = bucket(xu_user.as_deref());
    let (username, token) = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        account_token(&conn, &user, &provider)?
    };
    let _ = username;
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|e| format!("无法请求云端：{e}"))?;
    let resp = if provider == "github" {
        client
            .get("https://api.github.com/user/repos")
            .query(&[("per_page", "100"), ("affiliation", "owner,collaborator")])
            .header("Accept", "application/vnd.github+json")
            .header("User-Agent", "Virmoor")
            .bearer_auth(&token)
            .send()
            .await
    } else {
        client
            .get("https://gitee.com/api/v5/user/repos")
            .query(&[
                ("per_page", "100"),
                ("sort", "updated"),
                ("access_token", token.as_str()),
            ])
            .header("User-Agent", "Virmoor")
            .send()
            .await
    }
    .map_err(|e| format!("无法连接代码托管：{}", scrub(&e.to_string())))?;
    if !resp.status().is_success() {
        return Err("云端拒绝访问，请检查令牌权限后重试".into());
    }
    let v: serde_json::Value = resp.json().await.map_err(|_| "云端返回无法解析".to_string())?;
    let arr = v.as_array().ok_or("云端返回无法解析")?;
    let mut out = Vec::new();
    for item in arr {
        let full_name = item
            .get("full_name")
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .trim()
            .to_string();
        let clone_url = item
            .get("clone_url")
            .or_else(|| item.get("html_url"))
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .trim()
            .to_string();
        if full_name.is_empty() || clone_url.is_empty() {
            continue;
        }
        out.push(GitCloudRepo { full_name, clone_url });
    }
    Ok(out)
}

fn load_remotes(conn: &rusqlite::Connection, repo_id: &str) -> Result<Vec<GitRemoteRow>, String> {
    let mut stmt = conn
        .prepare("SELECT id, name, url, provider FROM git_remotes WHERE repo_id=?1 ORDER BY name")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![repo_id], |r| {
            Ok(GitRemoteRow {
                id: r.get(0)?,
                name: r.get(1)?,
                url: r.get(2)?,
                provider: r.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

/// 列出当前用户已登记的本地仓与远程。
#[tauri::command]
pub fn git_registry_list(
    db: State<'_, FouDb>,
    xu_user: Option<String>,
) -> Result<Vec<GitRepoRow>, String> {
    let user = bucket(xu_user.as_deref());
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, local_path, display_name, default_branch, last_branch, cloud_full_name
             FROM git_repos WHERE xu_user=?1 ORDER BY display_name, local_path",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![user], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, String>(4)?,
                r.get::<_, String>(5)?,
            ))
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows {
        let (id, local_path, display_name, default_branch, last_branch, cloud_full_name) =
            r.map_err(|e| e.to_string())?;
        let remotes = load_remotes(&conn, &id)?;
        out.push(GitRepoRow {
            id,
            local_path,
            display_name,
            default_branch,
            last_branch,
            cloud_full_name,
            remotes,
        });
    }
    Ok(out)
}

/// 登记或更新本地仓。失败：路径为空。
#[tauri::command]
pub fn git_registry_upsert(
    db: State<'_, FouDb>,
    xu_user: Option<String>,
    local_path: String,
    display_name: Option<String>,
    default_branch: Option<String>,
    remotes: Option<Vec<GitRemoteInput>>,
) -> Result<GitRepoRow, String> {
    let path = local_path.trim();
    if path.is_empty() {
        return Err("本地路径为空".into());
    }
    let user = bucket(xu_user.as_deref());
    let name = display_name
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .unwrap_or_else(|| {
            std::path::Path::new(path)
                .file_name()
                .map(|s| s.to_string_lossy().into_owned())
                .unwrap_or_else(|| path.to_string())
        });
    let branch = default_branch.unwrap_or_default();
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let existing: Option<String> = conn
        .query_row(
            "SELECT id FROM git_repos WHERE xu_user=?1 AND local_path=?2",
            params![user, path],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let id = existing.unwrap_or_else(unique_id);
    let now = now_ms();
    conn.execute(
        "INSERT INTO git_repos(id, xu_user, local_path, display_name, default_branch, last_branch, cloud_full_name, updated_at)
         VALUES(?1,?2,?3,?4,?5,COALESCE((SELECT last_branch FROM git_repos WHERE id=?1), ''),COALESCE((SELECT cloud_full_name FROM git_repos WHERE id=?1), ''),?6)
         ON CONFLICT(id) DO UPDATE SET
           display_name=excluded.display_name,
           default_branch=excluded.default_branch,
           updated_at=excluded.updated_at",
        params![id, user, path, name, branch.trim(), now],
    )
    .map_err(|e| format!("登记仓库失败：{e}"))?;
    if let Some(list) = remotes {
        for remote in list {
            upsert_remote(&conn, &id, &remote.name, &remote.url, remote.provider.as_deref())?;
        }
    }
    let remotes = load_remotes(&conn, &id)?;
    Ok(GitRepoRow {
        id: id.clone(),
        local_path: path.to_string(),
        display_name: name,
        default_branch: branch,
        last_branch: String::new(),
        cloud_full_name: String::new(),
        remotes,
    })
}

fn upsert_remote(
    conn: &rusqlite::Connection,
    repo_id: &str,
    name: &str,
    url: &str,
    provider: Option<&str>,
) -> Result<(), String> {
    let name = name.trim();
    let url = url.trim();
    if name.is_empty() || url.is_empty() {
        return Err("远程名和地址不能为空".into());
    }
    let provider = provider_ok(provider.unwrap_or(""))
        .unwrap_or("")
        .to_string();
    let provider = if provider.is_empty() {
        provider_from_url(url).unwrap_or("").to_string()
    } else {
        provider
    };
    let existing: Option<String> = conn
        .query_row(
            "SELECT id FROM git_remotes WHERE repo_id=?1 AND name=?2",
            params![repo_id, name],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let id = existing.unwrap_or_else(unique_id);
    conn.execute(
        "INSERT INTO git_remotes(id, repo_id, name, url, provider) VALUES(?1,?2,?3,?4,?5)
         ON CONFLICT(id) DO UPDATE SET url=excluded.url, provider=excluded.provider",
        params![id, repo_id, name, url, provider],
    )
    .map_err(|e| format!("保存远程失败：{e}"))?;
    Ok(())
}

/// 绑定云端仓 URL 到已登记本地仓，并同步写入真实 git remote。
#[tauri::command]
pub fn git_registry_bind_cloud(
    db: State<'_, FouDb>,
    xu_user: Option<String>,
    repo_id: String,
    remote_name: Option<String>,
    url: String,
    provider: String,
    cloud_full_name: Option<String>,
) -> Result<GitRepoRow, String> {
    let user = bucket(xu_user.as_deref());
    let provider = provider_ok(&provider)?.to_string();
    if provider.is_empty() {
        return Err("请选择 Gitee 或 GitHub".into());
    }
    let url = url.trim().to_string();
    assert_provider_matches_url(&provider, &url)?;
    let name = remote_name.unwrap_or_else(|| "origin".into());
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let local_path: String = conn
        .query_row(
            "SELECT local_path FROM git_repos WHERE id=?1 AND xu_user=?2",
            params![repo_id, user],
            |r| r.get(0),
        )
        .map_err(|_| "未找到该登记仓库".to_string())?;
    drop(conn);
    git_remote_set_url(&local_path, &name, &url).map_err(|e| scrub(&e))?;
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    upsert_remote(&conn, &repo_id, &name, &url, Some(&provider))?;
    if let Some(full) = cloud_full_name.filter(|s| !s.trim().is_empty()) {
        conn.execute(
            "UPDATE git_repos SET cloud_full_name=?1, updated_at=?2 WHERE id=?3",
            params![full.trim(), now_ms(), repo_id],
        )
        .map_err(|e| e.to_string())?;
    }
    let list = git_registry_list_locked(&conn, &user)?;
    list.into_iter()
        .find(|r| r.id == repo_id)
        .ok_or_else(|| "未找到该登记仓库".into())
}

fn git_registry_list_locked(
    conn: &rusqlite::Connection,
    user: &str,
) -> Result<Vec<GitRepoRow>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, local_path, display_name, default_branch, last_branch, cloud_full_name
             FROM git_repos WHERE xu_user=?1 ORDER BY display_name, local_path",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![user], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, String>(4)?,
                r.get::<_, String>(5)?,
            ))
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows {
        let (id, local_path, display_name, default_branch, last_branch, cloud_full_name) =
            r.map_err(|e| e.to_string())?;
        let remotes = load_remotes(conn, &id)?;
        out.push(GitRepoRow {
            id,
            local_path,
            display_name,
            default_branch,
            last_branch,
            cloud_full_name,
            remotes,
        });
    }
    Ok(out)
}

/// 移出登记（不删磁盘）。
#[tauri::command]
pub fn git_registry_remove(
    db: State<'_, FouDb>,
    xu_user: Option<String>,
    repo_id: String,
) -> Result<(), String> {
    let user = bucket(xu_user.as_deref());
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM git_remotes WHERE repo_id IN (SELECT id FROM git_repos WHERE id=?1 AND xu_user=?2)",
        params![repo_id, user],
    )
    .map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM git_repos WHERE id=?1 AND xu_user=?2",
        params![repo_id, user],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn extra_header(provider: &str, username: &str, token: &str) -> String {
    if provider == "github" {
        format!("Authorization: Bearer {token}")
    } else {
        // gitee / custom：Basic 用户名:令牌（或密码）
        let user = if username.trim().is_empty() {
            "oauth2"
        } else {
            username.trim()
        };
        let b64 = STANDARD.encode(format!("{user}:{token}"));
        format!("Authorization: Basic {b64}")
    }
}

/// 按 sqlite 登记的远程 URL + 令牌 push。不写 .git/config。
#[tauri::command]
pub fn git_registry_push(
    db: State<'_, FouDb>,
    xu_user: Option<String>,
    repo_id: String,
    remote_name: String,
    branch: String,
) -> Result<String, String> {
    let user = bucket(xu_user.as_deref());
    let branch = branch.trim();
    if branch.is_empty() {
        return Err("请选择分支".into());
    }
    if is_main_branch(branch) {
        return Err("禁止直接推送 main，请合入 dev 后再走发布合并".into());
    }
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let (local_path,): (String,) = conn
        .query_row(
            "SELECT local_path FROM git_repos WHERE id=?1 AND xu_user=?2",
            params![repo_id, user],
            |r| Ok((r.get(0)?,)),
        )
        .map_err(|_| "未找到该登记仓库".to_string())?;
    block_direct_main(&local_path)?;
    let (url, provider): (String, String) = conn
        .query_row(
            "SELECT url, provider FROM git_remotes WHERE repo_id=?1 AND name=?2",
            params![repo_id, remote_name.trim()],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(|_| "未找到该远程，请先绑定云端仓或填写远程地址".to_string())?;
    let provider = if provider.is_empty() {
        if url.contains("github.com") {
            "github".into()
        } else if url.contains("gitee.com") {
            "gitee".into()
        } else {
            "custom".into()
        }
    } else {
        provider
    };
    let header = if provider == "gitee" || provider == "github" || provider == "custom" {
        let (username, token) = account_token(&conn, &user, &provider)?;
        if token.trim().is_empty() {
            return Err("尚未保存该平台的令牌".into());
        }
        Some(extra_header(&provider, &username, &token))
    } else {
        None
    };
    drop(conn);
    let mut command = Command::new("git");
    command.current_dir(&local_path);
    if let Some(h) = header.as_ref() {
        command.args(["-c", &format!("http.extraHeader={h}")]);
    }
    command.args(["push", "-u", url.trim(), branch]);
    configure_git_command(&mut command);
    let output = command.output().map_err(|e| format!("无法执行 git: {e}"))?;
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if !output.status.success() {
        return Err(scrub(if stderr.is_empty() { &stdout } else { &stderr }));
    }
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE git_repos SET last_branch=?1, updated_at=?2 WHERE id=?3",
        params![branch, now_ms(), repo_id],
    )
    .ok();
    let _ = run_git(&local_path, &["status", "-sb"]);
    Ok(if stdout.is_empty() { "已上传".into() } else { scrub(&stdout) })
}
