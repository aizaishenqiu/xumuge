//! 本机问题反馈：`{XU_HOME}/bug-reports/*.json` + `assets/`。
//!
//! @author qiuye <yjk150@qq.com>
//! @date 2026-09-01
//! @updated 2026-09-02
//! @version 1.1.0
//! @category DB
//! @algo none

use base64::Engine;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::xu_paths;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BugReport {
    pub id: String,
    pub section_id: String,
    pub title: String,
    pub severity: String,
    pub html: String,
    pub status: String,
    pub created_at: String,
    pub updated_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cloud_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub synced_at: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BugReportInput {
    pub id: Option<String>,
    pub section_id: String,
    pub title: String,
    pub severity: String,
    pub html: String,
    pub status: Option<String>,
    pub cloud_id: Option<String>,
    pub synced_at: Option<String>,
}

fn bug_reports_dir() -> Result<PathBuf, String> {
    let dir = xu_paths::xu_home()?.join("bug-reports");
    fs::create_dir_all(&dir).map_err(|e| format!("创建反馈目录失败: {e}"))?;
    Ok(dir)
}

fn bug_assets_dir() -> Result<PathBuf, String> {
    let dir = bug_reports_dir()?.join("assets");
    fs::create_dir_all(&dir).map_err(|e| format!("创建反馈资源目录失败: {e}"))?;
    Ok(dir)
}

fn report_path(id: &str) -> Result<PathBuf, String> {
    let safe = sanitize_id(id)?;
    Ok(bug_reports_dir()?.join(format!("{safe}.json")))
}

fn sanitize_id(id: &str) -> Result<String, String> {
    let s = id.trim();
    if s.is_empty() || s.len() > 80 {
        return Err("无效反馈 id".into());
    }
    if !s
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    {
        return Err("反馈 id 含非法字符".into());
    }
    Ok(s.to_string())
}

fn sanitize_asset_name(name: &str) -> Result<String, String> {
    let s = name.trim();
    if s.is_empty() || s.len() > 120 || s.contains("..") || s.contains('/') || s.contains('\\')
    {
        return Err("无效资源文件名".into());
    }
    Ok(s.to_string())
}

fn now_iso() -> String {
    chrono::Local::now().to_rfc3339()
}

fn new_id() -> String {
    let ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    format!("bug_{ms}_{:x}", (ms as u32).wrapping_mul(2654435761))
}

fn read_report(path: &Path) -> Result<BugReport, String> {
    let raw = fs::read_to_string(path).map_err(|e| e.to_string())?;
    serde_json::from_str(&raw).map_err(|e| format!("解析反馈失败: {e}"))
}

fn write_report(path: &Path, report: &BugReport) -> Result<(), String> {
    let raw = serde_json::to_string_pretty(report).map_err(|e| e.to_string())?;
    fs::write(path, raw).map_err(|e| format!("写入反馈失败: {e}"))
}

fn strip_data_url_prefix(data: &str) -> &str {
    if let Some(i) = data.find("base64,") {
        &data[i + "base64,".len()..]
    } else {
        data.trim()
    }
}

fn section_label(id: &str) -> &str {
    match id {
        "home_chat" => "首页 / 对话",
        "voice_call" => "语音通话",
        "voice_settings" => "设置 · 语音与朗读",
        "settings_model" => "设置 · 模型",
        "settings_other" => "设置 · 其它",
        "office" => "办公室",
        "projects" => "项目",
        "team" => "团队 / 专家",
        "memory" => "记忆",
        "connections" => "连接",
        "account" => "个人中心 / 授权",
        "packaging" => "安装包 / 启动",
        "other" => "其它",
        _ => id,
    }
}

fn severity_label(id: &str) -> &str {
    match id {
        "blocker" => "阻塞",
        "major" => "影响使用",
        "minor" => "体验",
        _ => id,
    }
}

fn status_label(id: &str) -> &str {
    match id {
        "open" => "待整理",
        "triaged" => "已整理",
        "fixed" => "已修复",
        _ => id,
    }
}

fn html_to_plain(html: &str) -> String {
    let mut s = html.to_string();
    // drop tags roughly
    while let Some(start) = s.find('<') {
        if let Some(end) = s[start..].find('>') {
            s.replace_range(start..start + end + 1, " ");
        } else {
            break;
        }
    }
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Duty: 列出 `{XU_HOME}/bug-reports` 下全部反馈 JSON。
/// 依赖: xu_home；失败返回可读错误。
#[tauri::command]
pub fn xu_bug_report_list() -> Result<Vec<BugReport>, String> {
    let dir = bug_reports_dir()?;
    let mut out = Vec::new();
    let entries = fs::read_dir(&dir).map_err(|e| e.to_string())?;
    for ent in entries.flatten() {
        let path = ent.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        if let Ok(r) = read_report(&path) {
            out.push(r);
        }
    }
    out.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Ok(out)
}

/// Duty: 新建或覆盖保存一条反馈。
/// 依赖: bug-reports 目录可写；失败返回错误串。
#[tauri::command]
pub fn xu_bug_report_save(report: BugReportInput) -> Result<BugReport, String> {
    let title = report.title.trim();
    if title.is_empty() {
        return Err("请填写标题".into());
    }
    if report.section_id.trim().is_empty() {
        return Err("请选择出问题的栏目".into());
    }
    let now = now_iso();
    let (id, created_at, prev_cloud, prev_synced) =
        if let Some(existing) = report.id.as_ref().filter(|s| !s.trim().is_empty()) {
            let path = report_path(existing)?;
            if path.exists() {
                let old = read_report(&path)?;
                (sanitize_id(existing)?, old.created_at, old.cloud_id, old.synced_at)
            } else {
                (sanitize_id(existing)?, now.clone(), None, None)
            }
        } else {
            (new_id(), now.clone(), None, None)
        };
    let status = report
        .status
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("open")
        .to_string();
    let cloud_id = report
        .cloud_id
        .as_ref()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .or(prev_cloud);
    let synced_at = report
        .synced_at
        .as_ref()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .or(prev_synced);
    let saved = BugReport {
        id: id.clone(),
        section_id: report.section_id.trim().to_string(),
        title: title.to_string(),
        severity: report.severity.trim().to_string(),
        html: report.html,
        status,
        created_at,
        updated_at: now,
        cloud_id,
        synced_at,
    };
    write_report(&report_path(&id)?, &saved)?;
    Ok(saved)
}

/// Duty: 更新反馈状态（open/triaged/fixed）。
/// 依赖: 已存在的 json；失败：不存在或写盘错误。
#[tauri::command]
pub fn xu_bug_report_update_status(id: String, status: String) -> Result<BugReport, String> {
    let st = status.trim();
    if !matches!(st, "open" | "triaged" | "fixed") {
        return Err("无效状态".into());
    }
    let path = report_path(&id)?;
    if !path.exists() {
        return Err("反馈不存在".into());
    }
    let mut r = read_report(&path)?;
    r.status = st.to_string();
    r.updated_at = now_iso();
    write_report(&path, &r)?;
    Ok(r)
}

/// Duty: 删除反馈 json（不强制删 assets，避免误伤共用图）。
/// 依赖: id；不存在则视为成功。
#[tauri::command]
pub fn xu_bug_report_delete(id: String) -> Result<(), String> {
    let path = report_path(&id)?;
    if path.exists() {
        fs::remove_file(&path).map_err(|e| format!("删除失败: {e}"))?;
    }
    Ok(())
}

/// Duty: 保存截图/插图到 assets，返回文件名。
/// 依赖: base64（可含 dataURL 头）；失败：解码或写盘。
#[tauri::command]
pub fn xu_bug_report_save_asset(data_base64: String, ext: String) -> Result<String, String> {
    let raw = strip_data_url_prefix(&data_base64);
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(raw.trim())
        .map_err(|e| format!("图片解码失败: {e}"))?;
    if bytes.is_empty() {
        return Err("图片为空".into());
    }
    if bytes.len() > 12 * 1024 * 1024 {
        return Err("图片过大（上限 12MB）".into());
    }
    let mut e = ext.trim().trim_start_matches('.').to_ascii_lowercase();
    e.retain(|c| c.is_ascii_alphanumeric());
    if e.is_empty() {
        e = "png".into();
    }
    let name = format!("{}.{}", new_id().replace("bug_", "img_"), e);
    let path = bug_assets_dir()?.join(&name);
    fs::write(&path, bytes).map_err(|e| format!("保存图片失败: {e}"))?;
    Ok(name)
}

/// Duty: 返回 assets 下文件的绝对路径。
/// 依赖: 合法文件名且文件存在。
#[tauri::command]
pub fn xu_bug_report_asset_path(filename: String) -> Result<String, String> {
    let name = sanitize_asset_name(&filename)?;
    let path = bug_assets_dir()?.join(&name);
    if !path.is_file() {
        return Err("资源不存在".into());
    }
    Ok(path.to_string_lossy().to_string())
}

/// Duty: 本机 asset 是否存在（查看/编辑前本地优先）。
#[tauri::command]
pub fn xu_bug_report_asset_exists(filename: String) -> Result<bool, String> {
    let name = match sanitize_asset_name(&filename) {
        Ok(n) => n,
        Err(_) => return Ok(false),
    };
    let path = bug_assets_dir()?.join(&name);
    Ok(path.is_file())
}

/// Duty: 读本机 asset 为 dataURL（保存/回显用，避免 convertFileSrc fetch 失败）。
/// 依赖: 文件存在；失败: 不存在或读盘。
#[tauri::command]
pub fn xu_bug_report_asset_data_url(filename: String) -> Result<String, String> {
    let name = sanitize_asset_name(&filename)?;
    let path = bug_assets_dir()?.join(&name);
    if !path.is_file() {
        return Err("本机截图不存在".into());
    }
    let bytes = fs::read(&path).map_err(|_| "读取截图失败".to_string())?;
    if bytes.is_empty() {
        return Err("截图文件为空".into());
    }
    let mime = match path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("png")
        .to_ascii_lowercase()
        .as_str()
    {
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        _ => "image/png",
    };
    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok(format!("data:{mime};base64,{b64}"))
}

/// Duty: 拉取外链/本站图为 dataURL（绕过 WebView CORS/防盗链）。
/// 依赖: http(s) URL；reqwest；失败返回可读错误（前端静默回退）。
#[tauri::command]
pub async fn xu_bug_report_fetch_url_data_url(url: String) -> Result<String, String> {
    let mut u = url.trim().to_string();
    if u.is_empty() {
        return Err("图片地址为空".into());
    }
    // 富文本常把 & 存成 &amp;，须还原后再请求
    u = u
        .replace("&amp;", "&")
        .replace("&#38;", "&")
        .replace("&quot;", "\"")
        .replace("&#39;", "'");
    if !(u.starts_with("http://") || u.starts_with("https://")) {
        return Err("仅支持网络图片地址".into());
    }
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()
        .map_err(|_| "无法创建下载客户端".to_string())?;
    let res = client
        .get(&u)
        .header(
            reqwest::header::USER_AGENT,
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 VirmoorDesktop/1.0",
        )
        .header(reqwest::header::ACCEPT, "image/avif,image/webp,image/apng,image/*,*/*;q=0.8")
        .send()
        .await
        .map_err(|_| "图片下载失败".to_string())?;
    if !res.status().is_success() {
        return Err("图片下载失败".into());
    }
    let ctype = res
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_ascii_lowercase();
    let bytes = res
        .bytes()
        .await
        .map_err(|_| "读取图片内容失败".to_string())?;
    if bytes.is_empty() {
        return Err("图片为空".into());
    }
    if bytes.len() > 12 * 1024 * 1024 {
        return Err("图片过大（上限 12MB）".into());
    }
    let mime = if ctype.starts_with("image/") {
        ctype
            .split(';')
            .next()
            .unwrap_or("image/png")
            .trim()
            .to_string()
    } else if u.to_ascii_lowercase().contains(".jpg") || u.to_ascii_lowercase().contains(".jpeg") || u.to_ascii_lowercase().contains("f=jpeg") {
        "image/jpeg".into()
    } else if u.to_ascii_lowercase().contains(".webp") {
        "image/webp".into()
    } else if u.to_ascii_lowercase().contains(".gif") {
        "image/gif".into()
    } else {
        "image/png".into()
    };
    if !mime.starts_with("image/") {
        return Err("不是图片".into());
    }
    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok(format!("data:{mime};base64,{b64}"))
}

/// Duty: 按栏目分组导出 Markdown 到指定路径。
/// 依赖: path 可写；可选 status_filter。
#[tauri::command]
pub fn xu_bug_report_export_markdown(
    path: String,
    status_filter: Option<String>,
) -> Result<String, String> {
    let dest = PathBuf::from(path.trim());
    if dest.as_os_str().is_empty() {
        return Err("请选择导出路径".into());
    }
    let mut rows = xu_bug_report_list()?;
    if let Some(f) = status_filter.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        rows.retain(|r| r.status == f);
    }
    let mut md = String::new();
    md.push_str("# 虚募阁问题反馈待修清单\n\n");
    md.push_str(&format!("条目：{}\n\n", rows.len()));

    let mut sections: Vec<String> = Vec::new();
    for r in &rows {
        if !sections.contains(&r.section_id) {
            sections.push(r.section_id.clone());
        }
    }
    for sec in sections {
        md.push_str(&format!("## {}\n\n", section_label(&sec)));
        for r in rows.iter().filter(|x| x.section_id == sec) {
            md.push_str(&format!("### {}\n\n", r.title));
            md.push_str(&format!("- 状态：{}\n", status_label(&r.status)));
            md.push_str(&format!("- 严重度：{}\n", severity_label(&r.severity)));
            md.push_str(&format!("- 创建：{}\n", r.created_at));
            md.push_str(&format!("- 更新：{}\n\n", r.updated_at));
            md.push_str(&html_to_plain(&r.html));
            md.push_str("\n\n---\n\n");
        }
    }
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&dest, &md).map_err(|e| format!("导出失败: {e}"))?;
    Ok(dest.to_string_lossy().to_string())
}

