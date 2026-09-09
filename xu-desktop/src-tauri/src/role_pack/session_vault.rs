//! In-memory session unwrap keys for commercial `.xupack` (never persist plaintext keys).

use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};

use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionKeyEntry {
    pub pack_id: String,
    pub unwrap_key_hex: String,
    pub session_id: String,
    pub expires_at: String,
    pub edition: String,
    pub seats: u32,
    #[serde(default)]
    pub refresh_token: Option<String>,
}

#[derive(Debug, Default)]
struct VaultInner {
    by_pack: HashMap<String, SessionKeyEntry>,
    account_session_id: Option<String>,
    account_token: Option<String>,
}

static VAULT: LazyLock<Mutex<VaultInner>> = LazyLock::new(|| Mutex::new(VaultInner::default()));

pub fn set_account_session(session_id: String, token: Option<String>) {
    if let Ok(mut g) = VAULT.lock() {
        g.account_session_id = Some(session_id);
        g.account_token = token;
    }
}

pub fn clear_account_session() {
    if let Ok(mut g) = VAULT.lock() {
        g.account_session_id = None;
        g.account_token = None;
        g.by_pack.clear();
    }
}

pub fn account_session_id() -> Option<String> {
    VAULT.lock().ok().and_then(|g| g.account_session_id.clone())
}

pub fn put_key(entry: SessionKeyEntry) {
    if let Ok(mut g) = VAULT.lock() {
        g.by_pack.insert(entry.pack_id.clone(), entry);
    }
}

pub fn get_key_hex(pack_id: &str) -> Option<String> {
    let g = VAULT.lock().ok()?;
    let e = g.by_pack.get(pack_id)?;
    if is_expired(&e.expires_at) {
        return None;
    }
    Some(e.unwrap_key_hex.clone())
}

pub fn get_entry(pack_id: &str) -> Option<SessionKeyEntry> {
    let g = VAULT.lock().ok()?;
    let e = g.by_pack.get(pack_id)?.clone();
    if is_expired(&e.expires_at) {
        return None;
    }
    Some(e)
}

pub fn list_entries() -> Vec<SessionKeyEntry> {
    VAULT
        .lock()
        .ok()
        .map(|g| {
            g.by_pack
                .values()
                .filter(|e| !is_expired(&e.expires_at))
                .cloned()
                .collect()
        })
        .unwrap_or_default()
}

pub fn clear_all_keys() {
    if let Ok(mut g) = VAULT.lock() {
        g.by_pack.clear();
    }
}

pub fn is_expired(expires_at: &str) -> bool {
    match DateTime::parse_from_rfc3339(expires_at) {
        Ok(dt) => dt < Utc::now(),
        Err(_) => false,
    }
}

/// Default session TTL when server omits expires_at (4 hours).
pub fn default_expires_at() -> String {
    (Utc::now() + Duration::hours(4)).to_rfc3339()
}
