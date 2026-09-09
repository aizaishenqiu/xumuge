//! 从桌面仓 / 安装目录旁的 `.env*` 加载 `XU_*` / `VITE_*`（不覆盖已有系统变量）。
//!
//! Release 包**禁止**用 `CARGO_MANIFEST_DIR` 回指本机构建源码树（否则会读进开发者
//! `.env.development` / `.env.local` 与本机 API）。正式包只读：安装目录旁可选覆盖文件；
//! 缺省则走内置生产账号服地址。
//!
//! @author qiuye <yjk150@qq.com>
//! @date 2026-09-05
//! @updated 2026-09-08
//! @version 1.1.0
//! @category Config
//! @algo dotenv-no-override

use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

const DEFAULT_ACCOUNT_DEV: &str = "http://127.0.0.1:8080/api/v1";
const DEFAULT_ACCOUNT_REL: &str = "https://api.xumuge.com/api/v1";

/// 启动时加载 env 文件。系统里已存在的键不改写。
pub fn load_desktop_env() {
    let Some(root) = desktop_root() else {
        return;
    };
    let mut merged: HashMap<String, String> = HashMap::new();
    let mode = if cfg!(debug_assertions) {
        ".env.development"
    } else {
        ".env.production"
    };
    // Release：只允许安装目录旁的显式覆盖（.env / .env.production / .env.local），
    // 不读源码树，避免把本机开发 API / 密钥带进运行时。
    for name in [".env", mode, ".env.local"] {
        parse_env_file(root.join(name), &mut merged);
    }
    for (k, v) in merged {
        if std::env::var(&k).is_err() {
            std::env::set_var(&k, v);
        }
    }
    copy_if_unset("XU_ACCOUNT_URL", "VITE_XU_ACCOUNT_URL");
    copy_if_unset("XU_LICENSE_URL", "VITE_XU_LICENSE_URL");
}

/// Dev：仓库根（`src-tauri` 的上一级）。Release：仅可执行文件所在目录（若存在）。
fn desktop_root() -> Option<PathBuf> {
    if cfg!(debug_assertions) {
        let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        return manifest.parent().map(|p| p.to_path_buf());
    }
    // 正式包：禁止 CARGO_MANIFEST_DIR（编译进二进制的本机绝对路径）。
    std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(|p| p.to_path_buf()))
}

fn parse_env_file(path: PathBuf, into: &mut HashMap<String, String>) {
    let Ok(text) = fs::read_to_string(&path) else {
        return;
    };
    for raw in text.lines() {
        let line = raw.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let Some((k, rest)) = line.split_once('=') else {
            continue;
        };
        let key = k.trim();
        if key.is_empty() {
            continue;
        }
        let mut val = rest.trim().to_string();
        if (val.starts_with('"') && val.ends_with('"')) || (val.starts_with('\'') && val.ends_with('\''))
        {
            val = val[1..val.len() - 1].to_string();
        }
        into.insert(key.to_string(), val);
    }
}

fn copy_if_unset(dest: &str, src: &str) {
    if std::env::var(dest).ok().filter(|s| !s.trim().is_empty()).is_some() {
        return;
    }
    if let Ok(v) = std::env::var(src) {
        if !v.trim().is_empty() {
            std::env::set_var(dest, v);
        }
    }
}

pub fn nonempty(key: &str) -> Option<String> {
    std::env::var(key)
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

pub fn env_or(key: &str, default: &str) -> String {
    nonempty(key).unwrap_or_else(|| default.to_string())
}

pub fn default_account_base() -> String {
    nonempty("XU_ACCOUNT_URL")
        .or_else(|| nonempty("XU_LICENSE_URL"))
        .or_else(|| nonempty("VITE_XU_ACCOUNT_URL"))
        .or_else(|| nonempty("VITE_XU_LICENSE_URL"))
        .unwrap_or_else(|| {
            if cfg!(debug_assertions) {
                DEFAULT_ACCOUNT_DEV.to_string()
            } else {
                DEFAULT_ACCOUNT_REL.to_string()
            }
        })
}
