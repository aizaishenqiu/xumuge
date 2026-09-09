use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LicenseSubscription {
    pub license: String,
    pub pack_id: String,
    pub machine_id: String,
    pub expires_at: Option<String>,
    pub seats: u32,
    pub content_version: Option<String>,
    pub activated_at: String,
    /// Commercial SKUs (e.g. canvas.studio); absent on older license-store rows.
    #[serde(default)]
    pub entitlements: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct LicenseStore {
    machine_id: Option<String>,
    subscriptions: Vec<LicenseSubscription>,
}

pub fn license_store_path(user_pack_dir: &Path) -> PathBuf {
    user_pack_dir.join("license-store.json")
}

pub fn get_or_create_machine_id(user_pack_dir: &Path) -> Result<String, String> {
    let path = license_store_path(user_pack_dir);
    let mut store = read_store(&path);
    if let Some(id) = store.machine_id.clone() {
        if !id.is_empty() {
            return Ok(id);
        }
    }
    let id = format!("xu-{}", uuid::Uuid::new_v4());
    store.machine_id = Some(id.clone());
    write_store(&path, &store)?;
    Ok(id)
}

pub fn save_subscription(user_pack_dir: &Path, sub: LicenseSubscription) -> Result<(), String> {
    let path = license_store_path(user_pack_dir);
    let mut store = read_store(&path);
    store
        .subscriptions
        .retain(|s| !(s.license == sub.license && s.pack_id == sub.pack_id));
    store.subscriptions.push(sub);
    write_store(&path, &store)
}

pub fn list_subscriptions(user_pack_dir: &Path) -> Vec<LicenseSubscription> {
    read_store(&license_store_path(user_pack_dir)).subscriptions
}

pub fn subscription_valid(sub: &LicenseSubscription) -> bool {
    if let Some(exp) = &sub.expires_at {
        if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(exp) {
            if dt < chrono::Utc::now() {
                return false;
            }
        }
    }
    true
}

fn read_store(path: &Path) -> LicenseStore {
    if !path.is_file() {
        return LicenseStore::default();
    }
    fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn write_store(path: &Path, store: &LicenseStore) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let raw = serde_json::to_string_pretty(store).map_err(|e| e.to_string())?;
    fs::write(path, raw).map_err(|e| e.to_string())
}
