//! Agent 运行偏好、执行策略与实验灰度开关。
//!
//! @author qiuye <yjk150@qq.com>
//! @date 2026-08-31
//! @version 1.0.0
//! @category Config
//! @algo none

use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::State;

use crate::desktop_db::{self, FouDb};

pub const AGENT_PREFS_KEY: &str = "agent.prefs";

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentPrefs {
    pub local_stream: bool,
    pub llm_compact: bool,
    pub exec_policy: String,
    #[serde(default = "default_chat_mode")]
    pub chat_mode: String,
    /// Sampling temperature for main chat / agent loops (0.0–1.5). Default 0.2.
    #[serde(default = "default_temperature")]
    pub temperature: f64,
    /// Warn when agent reads many files (suspected whole-project upload).
    #[serde(default = "default_true")]
    pub bulk_read_warn_enabled: bool,
    #[serde(default = "default_bulk_file_threshold")]
    pub bulk_read_file_threshold: usize,
    #[serde(default = "default_bulk_bytes_threshold")]
    pub bulk_read_bytes_threshold: usize,
    /// Experimental IDE completion gates; default off for gradual rollout.
    #[serde(default)]
    pub ide_release_gate_enabled: bool,
}

fn default_true() -> bool {
    true
}

fn default_bulk_file_threshold() -> usize {
    40
}

fn default_bulk_bytes_threshold() -> usize {
    1_572_864
}

fn default_chat_mode() -> String {
    "agent".into()
}

fn default_temperature() -> f64 {
    0.2
}

impl Default for AgentPrefs {
    fn default() -> Self {
        Self {
            local_stream: true,
            llm_compact: false,
            exec_policy: "standard".into(),
            chat_mode: "agent".into(),
            temperature: 0.2,
            bulk_read_warn_enabled: true,
            bulk_read_file_threshold: 40,
            bulk_read_bytes_threshold: 1_572_864,
            ide_release_gate_enabled: false,
        }
    }
}

impl AgentPrefs {
    pub fn clamped_temperature(&self) -> f64 {
        if !self.temperature.is_finite() {
            return 0.2;
        }
        self.temperature.clamp(0.0, 1.5)
    }
}

pub struct AgentPrefsState {
    inner: Mutex<AgentPrefs>,
}

impl AgentPrefsState {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(AgentPrefs::default()),
        }
    }

    pub fn get(&self) -> AgentPrefs {
        let mut prefs = self.inner.lock().map(|g| g.clone()).unwrap_or_default();
        prefs.ide_release_gate_enabled = false;
        prefs
    }

    pub fn set(&self, prefs: AgentPrefs) {
        if let Ok(mut g) = self.inner.lock() {
            *g = prefs;
        }
    }
}

pub fn load_from_conn(conn: &Connection) -> AgentPrefs {
    let mut prefs = match desktop_db::setting_get(conn, AGENT_PREFS_KEY) {
        Ok(Some(raw)) => serde_json::from_str(&raw).unwrap_or_default(),
        _ => AgentPrefs::default(),
    };
    // 1.0.2：强制关闭实验门禁，避免本机曾打开过的偏好继续硬拦写码
    if prefs.ide_release_gate_enabled {
        prefs.ide_release_gate_enabled = false;
        let _ = save_to_conn(conn, &prefs);
    }
    prefs
}

pub fn save_to_conn(conn: &Connection, prefs: &AgentPrefs) -> Result<(), String> {
    let mut prefs = prefs.clone();
    // 实验门禁暂不开放硬拦截；持久化时一律写 false，避免开关误开留存
    prefs.ide_release_gate_enabled = false;
    let raw = serde_json::to_string(&prefs).map_err(|e| e.to_string())?;
    desktop_db::setting_set(conn, AGENT_PREFS_KEY, &raw)
}

pub fn apply_exec_policy(policy: &str, opts: &mut crate::agent::stream::AgentRunOpts) {
    match policy {
        "readonly" => {
            opts.tool_mode = crate::agent::tools::ToolMode::ReadOnly;
            opts.require_approval = true;
        }
        "trusted" => {
            opts.tool_mode = crate::agent::tools::ToolMode::Full;
            opts.require_approval = false;
        }
        _ => {
            opts.tool_mode = crate::agent::tools::ToolMode::Full;
            if !opts.boss_granted_session {
                opts.require_approval = true;
            }
        }
    }
}

#[tauri::command]
pub fn xu_agent_get_prefs(state: State<'_, AgentPrefsState>) -> AgentPrefs {
    let mut prefs = state.get();
    prefs.ide_release_gate_enabled = false;
    prefs
}

#[tauri::command]
pub fn xu_agent_set_prefs(
    mut prefs: AgentPrefs,
    state: State<'_, AgentPrefsState>,
    db: State<'_, FouDb>,
) -> Result<(), String> {
    prefs.ide_release_gate_enabled = false;
    state.set(prefs.clone());
    let db_arc = db.0.clone();
    let conn = db_arc.lock().map_err(|e| e.to_string())?;
    save_to_conn(&conn, &prefs)
}

#[tauri::command]
pub fn xu_agent_undo_workspace(workspace_root: String) -> Result<String, String> {
    crate::agent::snapshots::undo_last_batch(std::path::Path::new(&workspace_root))
}
