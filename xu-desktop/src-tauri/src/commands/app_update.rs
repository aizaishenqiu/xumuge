//! 桌面客户端自更新：下载官方安装包，静默安装后删包并重启。
//!
//! @author qiuye <yjk150@qq.com>
//! @date 2026-09-04
//! @updated 2026-09-05
//! @version 1.1.0
//! @category Stream
//! @algo none

use futures_util::StreamExt;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::fs::File;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

const DOWNLOAD_TIMEOUT_SECS: u64 = 60 * 60;
const MAX_INSTALLER_BYTES: u64 = 2 * 1024 * 1024 * 1024;
const PROGRESS_EVENT: &str = "xu:app-update-progress";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AppUpdateProgress {
    stage: String,
    received: u64,
    total: Option<u64>,
    message: String,
    path: Option<String>,
}

fn emit_progress(
    app: &AppHandle,
    stage: &str,
    received: u64,
    total: Option<u64>,
    message: &str,
    path: Option<&str>,
) {
    let _ = app.emit(
        PROGRESS_EVENT,
        AppUpdateProgress {
            stage: stage.to_string(),
            received,
            total,
            message: message.to_string(),
            path: path.map(|s| s.to_string()),
        },
    );
}

fn updates_dir() -> Result<PathBuf, String> {
    let base = std::env::temp_dir().join("xu-updates");
    std::fs::create_dir_all(&base).map_err(|_| "无法创建更新临时目录".to_string())?;
    Ok(base)
}

fn sanitize_version_token(version: &str) -> String {
    let s: String = version
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_') {
                c
            } else {
                '_'
            }
        })
        .collect();
    if s.is_empty() {
        "latest".into()
    } else {
        s.chars().take(64).collect()
    }
}

fn assert_http_url(url: &str) -> Result<(), String> {
    let u = url.trim();
    if !(u.starts_with("https://") || u.starts_with("http://")) {
        return Err("安装包地址无效".into());
    }
    if u.contains('\n') || u.contains('\r') || u.contains(' ') {
        return Err("安装包地址无效".into());
    }
    Ok(())
}

fn path_under_updates(path: &Path) -> Result<PathBuf, String> {
    let updates = updates_dir()?;
    let canon_updates = updates
        .canonicalize()
        .unwrap_or_else(|_| updates.clone());
    if !path.is_absolute() {
        return Err("安装包路径无效".into());
    }
    let canon = path
        .canonicalize()
        .map_err(|_| "安装包不存在或路径无效".to_string())?;
    if !canon.starts_with(&canon_updates) {
        return Err("安装包路径不在更新目录内".into());
    }
    if !canon.is_file() {
        return Err("安装包文件不存在".into());
    }
    Ok(canon)
}

fn hex_sha256_file(path: &Path) -> Result<String, String> {
    let mut file = File::open(path).map_err(|_| "无法读取安装包以校验".to_string())?;
    let mut hasher = Sha256::new();
    let mut buf = [0_u8; 64 * 1024];
    loop {
        let n = file
            .read(&mut buf)
            .map_err(|_| "读取安装包失败".to_string())?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

/// 退出本进程后：静默安装 → 删包 → 重启应用（避免占用安装目录文件锁）。
#[cfg(windows)]
fn schedule_silent_install_relaunch(installer: &Path, app_exe: &Path) -> Result<(), String> {
    let pid = std::process::id();
    let script = updates_dir()?.join("xu-update-run.cmd");
    let installer_s = installer.to_string_lossy().replace('"', "");
    let exe_s = app_exe.to_string_lossy().replace('"', "");
    let script_s = script.to_string_lossy().replace('"', "");
    let body = format!(
        "@echo off\r\n\
setlocal\r\n\
:wait\r\n\
tasklist /FI \"PID eq {pid}\" 2>NUL | find \"{pid}\" >NUL\r\n\
if not errorlevel 1 (\r\n\
  timeout /t 1 /nobreak >NUL\r\n\
  goto wait\r\n\
)\r\n\
\"{installer_s}\" /S\r\n\
del /f /q \"{installer_s}\" >NUL 2>&1\r\n\
start \"\" \"{exe_s}\"\r\n\
del /f /q \"{script_s}\" >NUL 2>&1\r\n"
    );
    {
        let mut f = File::create(&script).map_err(|_| "无法写入更新脚本".to_string())?;
        f.write_all(body.as_bytes())
            .map_err(|_| "无法写入更新脚本".to_string())?;
    }
    Command::new("cmd")
        .args(["/C", "start", "", "/MIN", &script_s])
        .spawn()
        .map_err(|_| "无法启动更新脚本".to_string())?;
    Ok(())
}

#[cfg(not(windows))]
fn schedule_silent_install_relaunch(installer: &Path, app_exe: &Path) -> Result<(), String> {
    let pid = std::process::id();
    let script = updates_dir()?.join("xu-update-run.sh");
    let installer_s = installer.to_string_lossy();
    let exe_s = app_exe.to_string_lossy();
    let body = format!(
        "#!/bin/sh\n\
while kill -0 {pid} 2>/dev/null; do sleep 1; done\n\
chmod +x \"{installer_s}\" 2>/dev/null || true\n\
\"{installer_s}\" || open \"{installer_s}\"\n\
rm -f \"{installer_s}\"\n\
\"{exe_s}\" &\n\
rm -f \"$0\"\n"
    );
    std::fs::write(&script, body).map_err(|_| "无法写入更新脚本".to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = std::fs::metadata(&script)
            .map_err(|_| "无法设置更新脚本权限".to_string())?
            .permissions();
        perms.set_mode(0o755);
        let _ = std::fs::set_permissions(&script, perms);
    }
    Command::new("sh")
        .arg(&script)
        .spawn()
        .map_err(|_| "无法启动更新脚本".to_string())?;
    Ok(())
}

/// Duty: 流式下载安装包到临时更新目录；进度事件 xu:app-update-progress。
/// 失败: 网络/写盘/体积超限/校验失败。
#[tauri::command]
pub async fn xu_app_update_download(
    app: AppHandle,
    url: String,
    version: Option<String>,
    expected_sha256: Option<String>,
) -> Result<String, String> {
    assert_http_url(&url)?;
    let ver = sanitize_version_token(version.as_deref().unwrap_or("latest"));
    let dest = updates_dir()?.join(format!("virmoor-setup-{ver}.exe"));
    let part = dest.with_extension("exe.part");

    emit_progress(&app, "starting", 0, None, "准备下载安装包", None);

    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(20))
        .timeout(Duration::from_secs(DOWNLOAD_TIMEOUT_SECS))
        .redirect(reqwest::redirect::Policy::limited(8))
        .build()
        .map_err(|_| "无法初始化下载器".to_string())?;

    let response = client
        .get(url.trim())
        .send()
        .await
        .map_err(|_| "下载安装包失败，请检查网络后重试".to_string())?;
    if !response.status().is_success() {
        return Err(format!(
            "下载安装包失败（HTTP {}）",
            response.status().as_u16()
        ));
    }
    let total = response.content_length();
    if total.is_some_and(|v| v > MAX_INSTALLER_BYTES) {
        return Err("安装包过大，已取消下载".into());
    }

    if let Some(parent) = part.parent() {
        std::fs::create_dir_all(parent).map_err(|_| "无法创建更新临时目录".to_string())?;
    }
    let mut output = tokio::fs::File::create(&part)
        .await
        .map_err(|_| "无法写入更新临时文件".to_string())?;

    let mut received: u64 = 0;
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let bytes = chunk.map_err(|_| "下载中断，请重试".to_string())?;
        received = received.saturating_add(bytes.len() as u64);
        if received > MAX_INSTALLER_BYTES {
            let _ = tokio::fs::remove_file(&part).await;
            return Err("安装包过大，已取消下载".into());
        }
        tokio::io::AsyncWriteExt::write_all(&mut output, &bytes)
            .await
            .map_err(|_| "保存安装包失败".to_string())?;
        emit_progress(
            &app,
            "downloading",
            received,
            total,
            "正在下载安装包",
            None,
        );
    }
    drop(output);

    if dest.exists() {
        let _ = std::fs::remove_file(&dest);
    }
    std::fs::rename(&part, &dest).map_err(|_| "保存安装包失败".to_string())?;

    if let Some(expect) = expected_sha256 {
        let expect = expect.trim().to_ascii_lowercase();
        if !expect.is_empty() {
            let got = hex_sha256_file(&dest)?;
            if got != expect {
                let _ = std::fs::remove_file(&dest);
                return Err("安装包校验失败，请重试".into());
            }
        }
    }

    let path_str = dest.to_string_lossy().to_string();
    emit_progress(
        &app,
        "done",
        received,
        total.or(Some(received)),
        "下载完成",
        Some(&path_str),
    );
    Ok(path_str)
}

/// Duty: 安排静默安装、删包、重启后退出本进程；路径须在更新临时目录内。
/// 失败: 路径非法或无法启动更新脚本。
#[tauri::command]
pub async fn xu_app_update_launch(app: AppHandle, path: String) -> Result<(), String> {
    let target = path_under_updates(Path::new(path.trim()))?;
    emit_progress(
        &app,
        "launching",
        0,
        None,
        "正在安装并准备重启",
        Some(&target.to_string_lossy()),
    );

    let exe = std::env::current_exe().map_err(|_| "无法定位当前程序".to_string())?;
    schedule_silent_install_relaunch(&target, &exe)?;

    tokio::time::sleep(Duration::from_millis(500)).await;
    app.exit(0);
    Ok(())
}
