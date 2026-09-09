//! Git 托管令牌本机 AES-GCM 加密（仅存 xu.db，密钥在 XU_HOME）。
//!
//! @file git_token_crypto.rs
//! @author qiuye <yjk150@qq.com>
//! @date 2026-09-05
//! @version 1.0.0
//! @category Security
//! @algo aes-gcm-token-at-rest

use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use std::fs;
use std::path::PathBuf;
use uuid::Uuid;

use crate::xu_paths;

const ENC_PREFIX: &str = "enc1:";

fn key_path() -> Result<PathBuf, String> {
    Ok(xu_paths::xu_home()?.join("git-token.key"))
}

fn load_or_create_key() -> Result<[u8; 32], String> {
    let path = key_path()?;
    if path.is_file() {
        let raw = fs::read(&path).map_err(|e| format!("读取令牌密钥失败：{e}"))?;
        if raw.len() == 32 {
            let mut key = [0u8; 32];
            key.copy_from_slice(&raw);
            return Ok(key);
        }
    }
    let mut key = [0u8; 32];
    let a = *Uuid::new_v4().as_bytes();
    let b = *Uuid::new_v4().as_bytes();
    key[..16].copy_from_slice(&a);
    key[16..].copy_from_slice(&b);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建数据目录失败：{e}"))?;
    }
    fs::write(&path, key).map_err(|e| format!("写入令牌密钥失败：{e}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&path, fs::Permissions::from_mode(0o600));
    }
    Ok(key)
}

fn random_nonce() -> [u8; 12] {
    let a = *Uuid::new_v4().as_bytes();
    let b = *Uuid::new_v4().as_bytes();
    let mut nonce = [0u8; 12];
    nonce[..8].copy_from_slice(&a[..8]);
    nonce[8..].copy_from_slice(&b[..4]);
    nonce
}

/// 加密私人令牌；失败返回中文。
pub fn encrypt_token(plain: &str) -> Result<String, String> {
    let key = load_or_create_key()?;
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|e| e.to_string())?;
    let nonce_bytes = random_nonce();
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ct = cipher
        .encrypt(nonce, plain.as_bytes())
        .map_err(|_| "令牌加密失败".to_string())?;
    let mut packed = Vec::with_capacity(12 + ct.len());
    packed.extend_from_slice(&nonce_bytes);
    packed.extend_from_slice(&ct);
    Ok(format!("{ENC_PREFIX}{}", STANDARD.encode(packed)))
}

/// 解密；无 `enc1:` 前缀视为旧明文。失败返回中文。
pub fn decrypt_token(stored: &str) -> Result<String, String> {
    let stored = stored.trim();
    if stored.is_empty() {
        return Ok(String::new());
    }
    if !stored.starts_with(ENC_PREFIX) {
        return Ok(stored.to_string());
    }
    let b64 = &stored[ENC_PREFIX.len()..];
    let packed = STANDARD
        .decode(b64)
        .map_err(|_| "令牌密文损坏".to_string())?;
    if packed.len() < 12 + 16 {
        return Err("令牌密文损坏".into());
    }
    let key = load_or_create_key()?;
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|e| e.to_string())?;
    let nonce = Nonce::from_slice(&packed[..12]);
    let plain = cipher
        .decrypt(nonce, &packed[12..])
        .map_err(|_| "令牌解密失败".to_string())?;
    String::from_utf8(plain).map_err(|_| "令牌解密失败".to_string())
}

pub fn is_encrypted(stored: &str) -> bool {
    stored.trim().starts_with(ENC_PREFIX)
}
