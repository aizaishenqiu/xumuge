//! License endpoint resolution: local server first (enterprise), cloud fallback.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum FouEdition {
    Solo,
    Enterprise,
}

impl Default for FouEdition {
    fn default() -> Self {
        Self::Solo
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum EndpointMode {
    Auto,
    Local,
    Cloud,
}

impl Default for EndpointMode {
    fn default() -> Self {
        Self::Auto
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditionPrefs {
    #[serde(default)]
    pub edition: FouEdition,
    #[serde(default)]
    pub endpoint_mode: EndpointMode,
    #[serde(default)]
    pub local_base_url: String,
    #[serde(default)]
    pub cloud_base_url: String,
    /// Enterprise: role ids selected to run on this machine.
    #[serde(default)]
    pub active_role_ids: Vec<String>,
}

impl Default for EditionPrefs {
    fn default() -> Self {
        Self {
            edition: FouEdition::Solo,
            endpoint_mode: EndpointMode::Auto,
            local_base_url: String::new(),
            cloud_base_url: String::new(),
            active_role_ids: vec![],
        }
    }
}

fn default_cloud_base() -> String {
    strip_to_v1_root(&crate::xu_env::default_account_base())
}

/// Normalize activate URL or /v1 root to `/v1` prefix without trailing slash issues.
pub fn strip_to_v1_root(url: &str) -> String {
    let t = url.trim().trim_end_matches('/');
    if t.ends_with("/activate") {
        t.trim_end_matches("/activate").to_string()
    } else if t.ends_with("/v1") || t.contains("/v1/") {
        if let Some(idx) = t.find("/v1") {
            format!("{}{}", &t[..idx], "/v1")
        } else {
            t.to_string()
        }
    } else {
        format!("{t}/v1")
    }
}

pub fn prefs_path(user_pack_dir: &Path) -> PathBuf {
    user_pack_dir.join("edition-prefs.json")
}

pub fn load_prefs(user_pack_dir: &Path) -> EditionPrefs {
    let path = prefs_path(user_pack_dir);
    if !path.is_file() {
        return EditionPrefs::default();
    }
    fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

pub fn save_prefs(user_pack_dir: &Path, prefs: &EditionPrefs) -> Result<(), String> {
    let path = prefs_path(user_pack_dir);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let raw = serde_json::to_string_pretty(prefs).map_err(|e| e.to_string())?;
    fs::write(path, raw).map_err(|e| e.to_string())
}

pub async fn health_ok(base: &str) -> bool {
    let url = format!(
        "{}/health",
        base.trim_end_matches('/').replacen("/v1", "", 1)
    );
    // Also try base/health when base already ends with /v1 → /v1/../health wrong;
    // Prefer: root health at host:port/health AND base/health
    let candidates = [
        format!("{}/health", strip_host_root(base)),
        format!("{}/health", base.trim_end_matches('/')),
    ];
    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(2))
        .build()
    {
        Ok(c) => c,
        Err(_) => return false,
    };
    for u in &candidates {
        if let Ok(resp) = client.get(u).send().await {
            if resp.status().is_success() {
                return true;
            }
        }
    }
    let _ = url;
    false
}

fn strip_host_root(v1_base: &str) -> String {
    let t = v1_base.trim().trim_end_matches('/');
    if let Some(idx) = t.rfind("/v1") {
        t[..idx].to_string()
    } else {
        t.to_string()
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedEndpoint {
    pub base_url: String,
    pub source: String,
    pub local_tried: bool,
    pub local_ok: bool,
}

/// Resolve which license API base (`…/v1`) to use.
pub async fn resolve_endpoint(prefs: &EditionPrefs) -> ResolvedEndpoint {
    let cloud = if prefs.cloud_base_url.trim().is_empty() {
        default_cloud_base()
    } else {
        strip_to_v1_root(&prefs.cloud_base_url)
    };
    let local = prefs.local_base_url.trim();
    let local_norm = if local.is_empty() {
        String::new()
    } else {
        strip_to_v1_root(local)
    };

    match prefs.endpoint_mode {
        EndpointMode::Cloud => ResolvedEndpoint {
            base_url: cloud,
            source: "cloud".into(),
            local_tried: false,
            local_ok: false,
        },
        EndpointMode::Local => {
            let ok = if local_norm.is_empty() {
                false
            } else {
                health_ok(&local_norm).await
            };
            if ok {
                ResolvedEndpoint {
                    base_url: local_norm,
                    source: "local".into(),
                    local_tried: true,
                    local_ok: true,
                }
            } else {
                ResolvedEndpoint {
                    base_url: cloud,
                    source: "cloud_fallback".into(),
                    local_tried: true,
                    local_ok: false,
                }
            }
        }
        EndpointMode::Auto => {
            if local_norm.is_empty() {
                return ResolvedEndpoint {
                    base_url: cloud,
                    source: "cloud".into(),
                    local_tried: false,
                    local_ok: false,
                };
            }
            let ok = health_ok(&local_norm).await;
            if ok {
                ResolvedEndpoint {
                    base_url: local_norm,
                    source: "local".into(),
                    local_tried: true,
                    local_ok: true,
                }
            } else {
                ResolvedEndpoint {
                    base_url: cloud,
                    source: "cloud_fallback".into(),
                    local_tried: true,
                    local_ok: false,
                }
            }
        }
    }
}

pub fn join_v1(base: &str, path: &str) -> String {
    let b = base.trim_end_matches('/');
    let p = path.trim_start_matches('/');
    format!("{b}/{p}")
}
