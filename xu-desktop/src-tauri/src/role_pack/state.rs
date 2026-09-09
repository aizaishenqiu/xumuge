use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use super::codec::{
    decode_xupack, demo_pack_key, derive_commercial_key, parse_key_hex, try_decode_with_keys,
    XupackHeader, XupackPayload, XupackRole,
};
use super::session_vault;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstalledPackRecord {
    pub pack_id: String,
    pub locale: String,
    pub role_count: usize,
    pub path: String,
    pub demo: bool,
    #[serde(default)]
    pub built_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content_version: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<String>,
    /// Deprecated: never persist plaintext commercial keys (ignored on load).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub key_hex: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct InstalledRegistry {
    packs: Vec<InstalledPackRecord>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoleMeta {
    pub id: String,
    pub slug: String,
    pub name: String,
    pub name_zh: String,
    pub emoji: String,
    pub division: String,
    pub division_zh: String,
    pub description: String,
    pub role_kind: String,
    pub brain_slot: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub mcp_tools: String,
    pub kickoff_wave: Option<String>,
    pub tags: Vec<String>,
    pub source: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub industry_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub industry_zh: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub position_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub position_zh: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub position_category: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub position_category_zh: Option<String>,
}

struct LoadedRole {
    meta: RoleMeta,
    prompt: String,
}

pub struct RolePackState {
    pub inner: Mutex<InnerState>,
}

pub struct InnerState {
    roles: HashMap<String, LoadedRole>,
    packs: Vec<InstalledPackRecord>,
    registry_path: PathBuf,
    user_pack_dir: PathBuf,
}

impl RolePackState {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(InnerState {
                roles: HashMap::new(),
                packs: Vec::new(),
                registry_path: PathBuf::new(),
                user_pack_dir: PathBuf::new(),
            }),
        }
    }
}

impl InnerState {
    pub fn reload_all(&mut self, app: &AppHandle) -> Result<(), String> {
        let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
        fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;
        self.user_pack_dir = data_dir.join("role-packs");
        fs::create_dir_all(&self.user_pack_dir).map_err(|e| e.to_string())?;
        self.registry_path = self.user_pack_dir.join("installed.json");

        self.roles.clear();
        self.packs.clear();

        // Dev: prefer local full pack (demo key, gitignored; see scripts/ensure-dev-role-pack.mjs)
        #[cfg(debug_assertions)]
        {
            if let Ok(manifest_dir) = std::env::var("CARGO_MANIFEST_DIR") {
                let dev_full = PathBuf::from(manifest_dir)
                    .join("..")
                    .join("resources")
                    .join("role-packs")
                    .join("dev.full.zh-CN.xupack");
                if dev_full.is_file() {
                    if let Some(header) = self.try_load_pack_logged(&dev_full, None, true) {
                        self.packs.push(InstalledPackRecord {
                            pack_id: header.pack_id,
                            locale: header.locale,
                            role_count: header.role_count.unwrap_or(0) as usize,
                            path: dev_full.to_string_lossy().into_owned(),
                            demo: true,
                            built_at: header.built_at,
                            content_version: header.content_version,
                            expires_at: None,
                            key_hex: None,
                        });
                    }
                }
            }
        }

        // Bundled full pack (trial release) then demo fallback when full missing
        if self.roles.is_empty() {
            let pack_names = ["full.zh-CN.xupack", "demo.zh-CN.xupack"];
            let mut candidates: Vec<PathBuf> = Vec::new();
            if let Ok(res) = app.path().resource_dir() {
                for name in pack_names {
                    candidates.push(res.join("role-packs").join(name));
                }
            }
            // Portable exe / MSI: resources next to the binary
            if let Ok(exe) = std::env::current_exe() {
                if let Some(dir) = exe.parent() {
                    for name in pack_names {
                        candidates.push(dir.join("role-packs").join(name));
                        candidates.push(dir.join("resources").join("role-packs").join(name));
                    }
                }
            }
            if let Ok(manifest_dir) = std::env::var("CARGO_MANIFEST_DIR") {
                let base = PathBuf::from(manifest_dir)
                    .join("..")
                    .join("resources")
                    .join("role-packs");
                for name in pack_names {
                    candidates.push(base.join(name));
                }
            }
            let mut tried = 0usize;
            for pack_path in candidates {
                tried += 1;
                if !pack_path.is_file() {
                    eprintln!("[role-pack] bundled candidate missing: {}", pack_path.display());
                    continue;
                }
                if let Some(header) = self.try_load_pack_logged(&pack_path, None, true) {
                    self.packs.push(InstalledPackRecord {
                        pack_id: header.pack_id,
                        locale: header.locale,
                        role_count: header.role_count.unwrap_or(0) as usize,
                        path: pack_path.to_string_lossy().into_owned(),
                        demo: true,
                        built_at: header.built_at,
                        content_version: header.content_version,
                        expires_at: None,
                        key_hex: None,
                    });
                    break;
                }
            }
            if self.roles.is_empty() {
                eprintln!(
                    "[role-pack] no bundled roles loaded after {tried} candidates; cloud download required"
                );
            }
        }

        let registry = self.read_registry();
        for mut rec in registry.packs {
            // Strip any legacy persisted keys from disk records.
            rec.key_hex = None;
            let path = PathBuf::from(&rec.path);
            if !path.is_file() {
                continue;
            }
            let vault_key = if rec.demo {
                None
            } else {
                session_vault::get_key_hex(&rec.pack_id)
            };
            if let Some(header) = self.try_load_pack_logged(&path, vault_key.as_deref(), rec.demo) {
                let mut merged = rec.clone();
                merged.role_count = header.role_count.unwrap_or(merged.role_count as u32) as usize;
                merged.key_hex = None;
                self.packs.push(merged);
            } else if !rec.demo {
                // Keep ciphertext registration without loading roles (await session key).
                eprintln!(
                    "[role-pack] commercial pack {} present but no session key; roles not loaded",
                    rec.pack_id
                );
                self.packs.push(rec);
            }
        }

        if self.roles.is_empty() {
            eprintln!("[role-pack] WARN: no roles loaded after reload_all");
        }

        Ok(())
    }

    pub fn role_count(&self) -> usize {
        self.roles.len()
    }

    pub fn installed_packs(&self) -> Vec<InstalledPackRecord> {
        self.packs.clone()
    }

    pub fn list_role_meta(&self) -> Vec<RoleMeta> {
        let mut out: Vec<RoleMeta> = self.roles.values().map(|r| r.meta.clone()).collect();
        out.sort_by(|a, b| a.name_zh.cmp(&b.name_zh));
        out
    }

    pub fn get_prompt(&self, role_id: &str) -> Option<String> {
        self.roles.get(role_id).map(|r| r.prompt.clone())
    }

    pub fn import_pack_file(
        &mut self,
        app: &AppHandle,
        src_path: &str,
        key_hex: Option<&str>,
        expires_at: Option<String>,
    ) -> Result<InstalledPackRecord, String> {
        let src = PathBuf::from(src_path);
        if !src.is_file() {
            return Err(format!("文件不存在: {src_path}"));
        }
        let data = fs::read(&src).map_err(|e| e.to_string())?;

        let (payload, flags) = if let Some(hex) = key_hex {
            let key = parse_key_hex(hex)?;
            decode_xupack(&data, &key)?
        } else {
            let demo = demo_pack_key();
            let commercial = derive_commercial_key("hermes-roles-zh-CN", "");
            try_decode_with_keys(&data, &[demo, commercial])?
        };

        let is_demo = flags & super::codec::XUPACK_FLAG_DEMO != 0 || payload.header.demo;
        let file_name = format!(
            "{}-{}.xupack",
            sanitize_filename(&payload.header.pack_id),
            payload.header.locale
        );
        let dest = self.user_pack_dir.join(&file_name);
        fs::copy(&src, &dest).map_err(|e| e.to_string())?;

        let record = InstalledPackRecord {
            pack_id: payload.header.pack_id.clone(),
            locale: payload.header.locale.clone(),
            role_count: payload.roles.len(),
            path: dest.to_string_lossy().into_owned(),
            demo: is_demo,
            built_at: payload.header.built_at.clone(),
            content_version: payload.header.content_version.clone(),
            expires_at,
            // Never persist commercial unwrap keys.
            key_hex: None,
        };

        if let Some(hex) = key_hex {
            if !is_demo {
                session_vault::put_key(session_vault::SessionKeyEntry {
                    pack_id: record.pack_id.clone(),
                    unwrap_key_hex: hex.to_string(),
                    session_id: session_vault::account_session_id()
                        .unwrap_or_else(|| "import".into()),
                    expires_at: session_vault::default_expires_at(),
                    edition: "import".into(),
                    seats: 1,
                    refresh_token: None,
                });
            }
        }

        self.merge_payload(payload);
        self.packs
            .retain(|p| p.pack_id != record.pack_id || p.locale != record.locale);
        self.packs.push(record.clone());
        self.write_registry()?;
        let _ = app;
        Ok(record)
    }

    fn try_load_pack_logged(
        &mut self,
        path: &Path,
        key_hex: Option<&str>,
        assume_demo: bool,
    ) -> Option<XupackHeader> {
        match self.load_pack_file(path, key_hex, assume_demo) {
            Ok(header) => Some(header),
            Err(e) => {
                eprintln!("[role-pack] failed to load {}: {e}", path.display());
                None
            }
        }
    }

    fn load_pack_file(
        &mut self,
        path: &Path,
        key_hex: Option<&str>,
        assume_demo: bool,
    ) -> Result<XupackHeader, String> {
        let data = fs::read(path).map_err(|e| e.to_string())?;
        let (payload, _flags) = if let Some(hex) = key_hex {
            let key = parse_key_hex(hex)?;
            decode_xupack(&data, &key)?
        } else if assume_demo {
            decode_xupack(&data, &demo_pack_key())?
        } else {
            let demo = demo_pack_key();
            let commercial = derive_commercial_key("hermes-roles-zh-CN", "");
            try_decode_with_keys(&data, &[demo, commercial])?
        };
        let header = payload.header.clone();
        self.merge_payload(payload);
        Ok(header)
    }

    fn merge_payload(&mut self, payload: XupackPayload) {
        for role in payload.roles {
            let meta = role_to_meta(&role);
            let prompt = role.prompt;
            self.roles
                .insert(meta.id.clone(), LoadedRole { meta, prompt });
        }
    }

    fn read_registry(&self) -> InstalledRegistry {
        if !self.registry_path.is_file() {
            return InstalledRegistry { packs: vec![] };
        }
        match fs::read_to_string(&self.registry_path) {
            Ok(raw) => serde_json::from_str(&raw).unwrap_or(InstalledRegistry { packs: vec![] }),
            Err(_) => InstalledRegistry { packs: vec![] },
        }
    }

    fn write_registry(&self) -> Result<(), String> {
        let packs: Vec<InstalledPackRecord> = self
            .packs
            .iter()
            .map(|p| {
                let mut c = p.clone();
                c.key_hex = None;
                c
            })
            .collect();
        let reg = InstalledRegistry { packs };
        let raw = serde_json::to_string_pretty(&reg).map_err(|e| e.to_string())?;
        fs::write(&self.registry_path, raw).map_err(|e| e.to_string())
    }

    pub fn user_pack_dir(&self) -> &Path {
        &self.user_pack_dir
    }

    /// Drop commercial roles; keep demo roles loaded.
    pub fn unload_commercial_roles(&mut self) {
        self.roles.clear();
        let demos: Vec<InstalledPackRecord> =
            self.packs.iter().filter(|p| p.demo).cloned().collect();
        for rec in demos {
            let path = PathBuf::from(&rec.path);
            let _ = self.load_pack_file(&path, None, true);
        }
    }

    /// Clear all in-memory roles (caller should reload_all for demo).
    pub fn clear_roles(&mut self) {
        self.roles.clear();
    }

    /// Re-decrypt commercial packs using current session vault keys.
    pub fn reload_commercial_with_vault(&mut self) -> Result<usize, String> {
        let mut loaded = 0usize;
        let commercial: Vec<InstalledPackRecord> =
            self.packs.iter().filter(|p| !p.demo).cloned().collect();
        for rec in commercial {
            let Some(hex) = session_vault::get_key_hex(&rec.pack_id) else {
                continue;
            };
            let path = PathBuf::from(&rec.path);
            if !path.is_file() {
                continue;
            }
            match self.load_pack_file(&path, Some(&hex), false) {
                Ok(_) => loaded += 1,
                Err(e) => eprintln!("[role-pack] vault reload {}: {e}", rec.pack_id),
            }
        }
        Ok(loaded)
    }
}

fn role_to_meta(role: &XupackRole) -> RoleMeta {
    RoleMeta {
        id: role.id.clone(),
        slug: role.slug.clone(),
        name: if role.name.is_empty() {
            role.name_zh.clone()
        } else {
            role.name.clone()
        },
        name_zh: role.name_zh.clone(),
        emoji: if role.emoji.is_empty() {
            "👤".into()
        } else {
            role.emoji.clone()
        },
        division: role.division.clone(),
        division_zh: if role.division_zh.is_empty() {
            role.division.clone()
        } else {
            role.division_zh.clone()
        },
        description: role.description.clone(),
        role_kind: if role.role_kind.is_empty() {
            "worker".into()
        } else {
            role.role_kind.clone()
        },
        brain_slot: if role.brain_slot.is_empty() {
            "work".into()
        } else {
            role.brain_slot.clone()
        },
        mcp_tools: role.mcp_tools.clone(),
        kickoff_wave: role.kickoff_wave.clone(),
        tags: role.tags.clone(),
        source: role.source.clone(),
        industry_id: role.industry_id.clone(),
        industry_zh: role.industry_zh.clone(),
        position_id: role.position_id.clone(),
        position_zh: role.position_zh.clone(),
        position_category: role.position_category.clone(),
        position_category_zh: role.position_category_zh.clone(),
    }
}

fn sanitize_filename(s: &str) -> String {
    s.chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect()
}
