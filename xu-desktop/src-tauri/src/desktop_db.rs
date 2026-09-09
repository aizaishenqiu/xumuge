//! Xu Desktop local SQLite (`{XU_HOME}/xu.db`) 与持久化迁移。
//!
//! @author qiuye <yjk150@qq.com>
//! @date 2026-08-30
//! @updated 2026-09-05
//! @version 1.2.0
//! @category DB
//! @algo sqlite-wal-and-validated-secret-lookup

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use crate::xu_paths;

const SCHEMA_VERSION: i64 = 2;

pub struct FouDb(pub Arc<Mutex<Connection>>);

impl Clone for FouDb {
    fn clone(&self) -> Self {
        FouDb(Arc::clone(&self.0))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmployeeRow {
    pub id: String,
    pub name: String,
    pub role: String,
    pub avatar_id: String,
    pub desk_index: Option<i64>,
    pub status: String,
    pub created_at: i64,
    pub workspace_root: Option<String>,
    pub read_extra_paths: String, // JSON array
    pub allow_network_exfil: bool,
    pub drive_mode: String,
    pub gender: String,
    pub role_kind: String,
    pub brain_slot: String,
    #[serde(default = "default_outfit")]
    pub outfit: String,
    #[serde(default = "default_hair")]
    pub hair_style: String,
    #[serde(default)]
    pub agent_role_id: String,
    #[serde(default)]
    pub ai_model: String,
    #[serde(default)]
    pub ai_base_url: String,
    #[serde(default)]
    pub employee_no: String,
    #[serde(default = "default_api_source")]
    pub api_source: String,
    #[serde(default)]
    pub ai_vision_model: String,
    #[serde(default)]
    pub remote_preset_id: String,
    #[serde(default = "default_age")]
    pub age: i64,
    #[serde(default = "default_code_editor_surface")]
    pub code_editor_surface: String,
}

fn default_age() -> i64 {
    28
}

fn default_outfit() -> String {
    "casual".into()
}
fn default_hair() -> String {
    "short".into()
}
fn default_api_source() -> String {
    "inherit".into()
}

fn default_code_editor_surface() -> String {
    "inherit".into()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageRow {
    pub id: String,
    pub session_tag: String,
    pub employee_id: Option<String>,
    pub role: String,
    pub content: String,
    pub image_path: Option<String>,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct BrainRemoteSnapshot {
    #[serde(default)]
    pub base_url: String,
    #[serde(default)]
    pub model: String,
    #[serde(default)]
    pub api_key_env: String,
    #[serde(default)]
    pub provider: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrainSlotConfig {
    pub base_url: String,
    pub model: String,
    pub api_key_env: String,
    #[serde(default)]
    pub provider: String,
    /// "local" | "remote"
    #[serde(default = "default_brain_source")]
    pub source: String,
    #[serde(default)]
    pub vision_model: String,
    #[serde(default)]
    pub remote_snapshot: Option<BrainRemoteSnapshot>,
    /// User-facing alias shown in chat (e.g. "Qwen3 助手")
    #[serde(default)]
    pub display_name: String,
}

fn default_brain_source() -> String {
    "remote".into()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpsBrains {
    pub command: BrainSlotConfig,
    pub work: BrainSlotConfig,
    pub code: BrainSlotConfig,
}

impl Default for OpsBrains {
    fn default() -> Self {
        let empty = BrainSlotConfig {
            base_url: String::new(),
            model: String::new(),
            api_key_env: String::new(),
            provider: String::new(),
            source: "remote".into(),
            vision_model: String::new(),
            remote_snapshot: None,
            display_name: String::new(),
        };
        Self {
            command: empty.clone(),
            work: empty.clone(),
            code: empty,
        }
    }
}

fn desktop_dir() -> Result<PathBuf, String> {
    xu_paths::xu_home()
}

pub fn db_path() -> Result<PathBuf, String> {
    Ok(desktop_dir()?.join("xu.db"))
}

fn has_column(conn: &Connection, table: &str, column: &str) -> Result<bool, String> {
    let sql = format!("SELECT COUNT(*) FROM pragma_table_info('{table}') WHERE name=?1");
    let count: i64 = conn
        .query_row(&sql, params![column], |row| row.get(0))
        .map_err(|e| format!("读取 {table} 表结构失败: {e}"))?;
    Ok(count > 0)
}

fn add_column_if_missing(
    conn: &Connection,
    table: &str,
    column: &str,
    definition: &str,
) -> Result<(), String> {
    if !has_column(conn, table, column)? {
        conn.execute_batch(&format!("ALTER TABLE {table} ADD COLUMN {definition}"))
            .map_err(|e| format!("迁移 {table}.{column} 失败: {e}"))?;
    }
    Ok(())
}

fn migrate_employee_session_column(conn: &Connection) -> Result<(), String> {
    if has_column(conn, "employee_sessions", "hermes_session_id")?
        && !has_column(conn, "employee_sessions", "session_id")?
    {
        conn.execute_batch(
            "ALTER TABLE employee_sessions RENAME COLUMN hermes_session_id TO session_id;",
        )
        .map_err(|e| format!("迁移 employee_sessions.session_id 失败: {e}"))?;
    }
    Ok(())
}

pub fn open_connection() -> Result<Connection, String> {
    let path = db_path()?;
    xu_paths::migrate_db_if_needed(&path)?;
    let conn = Connection::open(&path).map_err(|e| format!("open xu.db: {e}"))?;
    migrate_connection(&conn)?;
    Ok(conn)
}

/// 对已打开连接执行完整 schema 迁移；所有步骤可重复运行。
/// 依赖: SQLite DDL、上下文与账单子迁移。
/// 失败: 返回迁移错误，调用方不得使用半初始化连接。
fn migrate_connection(conn: &Connection) -> Result<(), String> {
    migrate_connection_with_hook(conn, || Ok(()))
}

fn migrate_connection_with_hook(
    conn: &Connection,
    before_commit: impl FnOnce() -> Result<(), String>,
) -> Result<(), String> {
    conn.execute_batch(
        "PRAGMA foreign_keys=ON;
         PRAGMA journal_mode=WAL;",
    )
    .map_err(|e| format!("配置 xu.db 失败: {e}"))?;
    let foreign_keys: i64 = conn
        .query_row("PRAGMA foreign_keys", [], |row| row.get(0))
        .map_err(|e| format!("verify foreign keys: {e}"))?;
    if foreign_keys != 1 {
        return Err("SQLite 外键约束未启用".into());
    }
    let current_version: i64 = conn
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .map_err(|e| format!("读取数据库版本失败: {e}"))?;
    if current_version > SCHEMA_VERSION {
        return Err(format!(
            "数据库版本 {current_version} 高于当前支持版本 {SCHEMA_VERSION}"
        ));
    }
    if current_version == SCHEMA_VERSION {
        return Ok(());
    }

    let tx = conn
        .unchecked_transaction()
        .map_err(|e| format!("开始数据库迁移事务失败: {e}"))?;
    tx.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS employees (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT '员工',
            avatar_id TEXT NOT NULL DEFAULT 'classic',
            desk_index INTEGER,
            status TEXT NOT NULL DEFAULT 'idle',
            created_at INTEGER NOT NULL,
            workspace_root TEXT,
            read_extra_paths TEXT NOT NULL DEFAULT '[]',
            allow_network_exfil INTEGER NOT NULL DEFAULT 0,
            drive_mode TEXT NOT NULL DEFAULT 'off',
            gender TEXT NOT NULL DEFAULT 'male',
            role_kind TEXT NOT NULL DEFAULT 'worker',
            brain_slot TEXT NOT NULL DEFAULT 'work'
        );
        CREATE TABLE IF NOT EXISTS messages (
            id TEXT PRIMARY KEY,
            session_tag TEXT NOT NULL,
            employee_id TEXT,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            image_path TEXT,
            created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);
        CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_tag);
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS employee_sessions (
            employee_id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            updated_at INTEGER NOT NULL
        );
        "#,
    )
    .map_err(|e| format!("migrate xu.db: {e}"))?;
    migrate_employee_session_column(&tx)?;
    tx.execute(
        "CREATE TABLE IF NOT EXISTS employee_sessions (
            employee_id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            updated_at INTEGER NOT NULL
        )",
        [],
    )
    .map_err(|e| format!("迁移 employee_sessions 失败: {e}"))?;
    for (column, definition) in [
        ("outfit", "outfit TEXT NOT NULL DEFAULT 'casual'"),
        ("hair_style", "hair_style TEXT NOT NULL DEFAULT 'short'"),
        ("agent_role_id", "agent_role_id TEXT NOT NULL DEFAULT ''"),
        ("ai_model", "ai_model TEXT NOT NULL DEFAULT ''"),
        ("ai_base_url", "ai_base_url TEXT NOT NULL DEFAULT ''"),
        ("employee_no", "employee_no TEXT NOT NULL DEFAULT ''"),
        ("api_source", "api_source TEXT NOT NULL DEFAULT 'inherit'"),
        (
            "ai_vision_model",
            "ai_vision_model TEXT NOT NULL DEFAULT ''",
        ),
        ("age", "age INTEGER NOT NULL DEFAULT 28"),
        (
            "code_editor_surface",
            "code_editor_surface TEXT NOT NULL DEFAULT 'inherit'",
        ),
        (
            "remote_preset_id",
            "remote_preset_id TEXT NOT NULL DEFAULT ''",
        ),
    ] {
        add_column_if_missing(&tx, "employees", column, definition)?;
    }
    ensure_chat_tables(&tx)?;
    add_column_if_missing(
        &tx,
        "git_accounts",
        "base_url",
        "base_url TEXT NOT NULL DEFAULT ''",
    )?;
    crate::context_memory::migrate(&tx)?;
    migrate_billing_schema(&tx)?;
    before_commit()?;
    tx.pragma_update(None, "user_version", SCHEMA_VERSION)
        .map_err(|e| format!("写入数据库版本失败: {e}"))?;
    tx.commit().map_err(|e| format!("提交数据库迁移失败: {e}"))
}

fn migrate_billing_schema(conn: &Connection) -> Result<(), String> {
    let cols = [
        ("cached_tokens", "cached_tokens INTEGER NOT NULL DEFAULT 0"),
        (
            "cost_cny_micros",
            "cost_cny_micros INTEGER NOT NULL DEFAULT 0",
        ),
        (
            "pricing_tier",
            "pricing_tier TEXT NOT NULL DEFAULT 'default'",
        ),
        ("preset_id", "preset_id TEXT NOT NULL DEFAULT ''"),
        ("provider", "provider TEXT NOT NULL DEFAULT ''"),
    ];
    for (column, definition) in cols {
        add_column_if_missing(conn, "token_usage_events", column, definition)?;
    }
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS model_preset_quotas (
            preset_id TEXT PRIMARY KEY,
            hard_limit_cny_micros INTEGER NOT NULL DEFAULT 0,
            soft_ratio REAL NOT NULL DEFAULT 0.8,
            used_cny_micros INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_token_usage_preset ON token_usage_events(preset_id);
        INSERT OR IGNORE INTO settings(key, value) VALUES('pricing.manifest_url', '');
        INSERT OR IGNORE INTO settings(key, value) VALUES('pricing.last_sync_at', '0');
        "#,
    )
    .map_err(|e| format!("迁移计费 schema 失败: {e}"))?;
    Ok(())
}

/// Xu Native Agent sessions (Hermes-free).
fn ensure_chat_tables(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS chat_sessions (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL DEFAULT '',
            employee_id TEXT,
            brain_slot TEXT,
            model TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS chat_messages (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            tool_name TEXT,
            tool_call_id TEXT,
            created_at INTEGER NOT NULL,
            FOREIGN KEY(session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id, created_at);
        CREATE TABLE IF NOT EXISTS chat_attachments (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL DEFAULT '__draft__',
            message_id TEXT,
            filename TEXT NOT NULL,
            stored_path TEXT NOT NULL,
            mime TEXT NOT NULL,
            kind TEXT NOT NULL,
            size_bytes INTEGER NOT NULL,
            extracted_text TEXT NOT NULL DEFAULT '',
            extraction_status TEXT NOT NULL DEFAULT 'ready',
            warning TEXT,
            created_at INTEGER NOT NULL,
            FOREIGN KEY(message_id) REFERENCES chat_messages(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_chat_attachments_pending
            ON chat_attachments(session_id, message_id, created_at);
        INSERT OR IGNORE INTO settings(key, value) VALUES('xu.runtime', 'native');
        CREATE TABLE IF NOT EXISTS memories (
            id TEXT PRIMARY KEY,
            scope TEXT NOT NULL,
            scope_id TEXT,
            title TEXT NOT NULL DEFAULT '',
            body TEXT NOT NULL,
            tags TEXT NOT NULL DEFAULT '[]',
            source TEXT NOT NULL DEFAULT 'manual',
            pinned INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_memories_scope ON memories(scope, scope_id);
        CREATE INDEX IF NOT EXISTS idx_memories_updated ON memories(updated_at);
        CREATE TABLE IF NOT EXISTS memory_chunks (
            id TEXT PRIMARY KEY,
            memory_id TEXT NOT NULL,
            chunk_index INTEGER NOT NULL,
            text TEXT NOT NULL,
            token_est INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL,
            FOREIGN KEY(memory_id) REFERENCES memories(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_chunks_memory ON memory_chunks(memory_id);
        CREATE TABLE IF NOT EXISTS agent_tool_fingerprints (
            employee_id TEXT NOT NULL,
            signature TEXT NOT NULL,
            hit_count INTEGER NOT NULL DEFAULT 1,
            last_tools TEXT NOT NULL DEFAULT '',
            updated_at INTEGER NOT NULL,
            PRIMARY KEY (employee_id, signature)
        );
        CREATE TABLE IF NOT EXISTS token_usage_events (
            id TEXT PRIMARY KEY,
            session_id TEXT,
            employee_id TEXT,
            source TEXT NOT NULL,
            prompt_tokens INTEGER NOT NULL DEFAULT 0,
            completion_tokens INTEGER NOT NULL DEFAULT 0,
            total_tokens INTEGER NOT NULL DEFAULT 0,
            model TEXT,
            created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_token_usage_created ON token_usage_events(created_at);
        INSERT OR IGNORE INTO settings(key, value) VALUES('memory.corpus.max_tokens', '1000000');
        INSERT OR IGNORE INTO settings(key, value) VALUES('memory.inject.max_tokens', '12000');
        INSERT OR IGNORE INTO settings(key, value) VALUES('memory.inject.max_chars', '24000');
        INSERT OR IGNORE INTO settings(key, value) VALUES('token.package.hard_limit', '2000000');
        INSERT OR IGNORE INTO settings(key, value) VALUES('writing.per_model_quota_yuan', '5000');
        INSERT OR IGNORE INTO settings(key, value) VALUES('writing.quota.boss_lock', '');
        INSERT OR IGNORE INTO settings(key, value) VALUES('token.package.soft_ratio', '0.8');
        INSERT OR IGNORE INTO settings(key, value) VALUES('token.usage.total', '0');
        CREATE TABLE IF NOT EXISTS channel_endpoints (
            id TEXT PRIMARY KEY,
            enabled INTEGER NOT NULL DEFAULT 0,
            kind TEXT NOT NULL DEFAULT 'webhook',
            webhook_url TEXT,
            secret_ref TEXT,
            extra_json TEXT NOT NULL DEFAULT '{}',
            updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS app_users (
            id TEXT PRIMARY KEY,
            username TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'user',
            created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS app_sessions (
            token TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            expires_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS git_accounts (
            id TEXT PRIMARY KEY,
            xu_user TEXT NOT NULL DEFAULT 'local',
            provider TEXT NOT NULL,
            username TEXT NOT NULL DEFAULT '',
            token TEXT NOT NULL DEFAULT '',
            base_url TEXT NOT NULL DEFAULT '',
            updated_at INTEGER NOT NULL,
            UNIQUE(xu_user, provider)
        );
        CREATE TABLE IF NOT EXISTS git_repos (
            id TEXT PRIMARY KEY,
            xu_user TEXT NOT NULL DEFAULT 'local',
            local_path TEXT NOT NULL,
            display_name TEXT NOT NULL DEFAULT '',
            default_branch TEXT NOT NULL DEFAULT '',
            last_branch TEXT NOT NULL DEFAULT '',
            cloud_full_name TEXT NOT NULL DEFAULT '',
            updated_at INTEGER NOT NULL,
            UNIQUE(xu_user, local_path)
        );
        CREATE TABLE IF NOT EXISTS git_remotes (
            id TEXT PRIMARY KEY,
            repo_id TEXT NOT NULL,
            name TEXT NOT NULL,
            url TEXT NOT NULL,
            provider TEXT NOT NULL DEFAULT '',
            FOREIGN KEY(repo_id) REFERENCES git_repos(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_git_repos_user ON git_repos(xu_user);
        CREATE INDEX IF NOT EXISTS idx_git_remotes_repo ON git_remotes(repo_id);
        "#,
    )
    .map_err(|e| format!("chat tables: {e}"))?;
    Ok(())
}

pub fn init_managed() -> Result<FouDb, String> {
    let conn = open_connection()?;
    Ok(FouDb(Arc::new(Mutex::new(conn))))
}

pub fn setting_get(conn: &Connection, key: &str) -> Result<Option<String>, String> {
    conn.query_row(
        "SELECT value FROM settings WHERE key = ?1",
        params![key],
        |r| r.get(0),
    )
    .optional()
    .map_err(|e| e.to_string())
}

pub fn setting_set(conn: &Connection, key: &str, value: &str) -> Result<(), String> {
    conn.execute(
        "INSERT INTO settings(key, value) VALUES(?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn list_settings_prefixed(
    conn: &Connection,
    prefix: &str,
) -> Result<Vec<(String, String)>, String> {
    let pattern = format!("{prefix}%");
    let mut stmt = conn
        .prepare("SELECT key, value FROM settings WHERE key LIKE ?1 ORDER BY key")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![pattern], |r| Ok((r.get(0)?, r.get(1)?)))
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

pub const API_KEY_SETTING_PREFIX: &str = "xu.api_key.";

const FORBIDDEN_API_KEY_ENV_NAMES: &[&str] = &[
    "ALLUSERSPROFILE",
    "APPDATA",
    "COMSPEC",
    "HOME",
    "HOMEDRIVE",
    "HOMEPATH",
    "LOCALAPPDATA",
    "PATH",
    "PATHEXT",
    "PROGRAMDATA",
    "PROGRAMFILES",
    "PROGRAMFILES(X86)",
    "PROGRAMW6432",
    "PSMODULEPATH",
    "PUBLIC",
    "SHELL",
    "SYSTEMDRIVE",
    "SYSTEMROOT",
    "TEMP",
    "TMP",
    "USERPROFILE",
    "WINDIR",
];

/// Validates a model-secret environment variable name before any environment API is called.
/// Dependency: ASCII `/^[A-Z_][A-Z0-9_]*$/` plus a process-control denylist.
/// Failure: returns a user-safe error; malformed input never reaches `set_var`/`remove_var`.
pub fn validate_api_key_env_name(env_name: &str) -> Result<&str, String> {
    let name = env_name.trim();
    let mut bytes = name.bytes();
    let first_ok = bytes
        .next()
        .map(|b| b == b'_' || b.is_ascii_uppercase())
        .unwrap_or(false);
    if !first_ok || !bytes.all(|b| b == b'_' || b.is_ascii_uppercase() || b.is_ascii_digit()) {
        return Err("API Key 环境变量名必须匹配 /^[A-Z_][A-Z0-9_]*$/".into());
    }
    if FORBIDDEN_API_KEY_ENV_NAMES.contains(&name) {
        return Err(format!(
            "环境变量 {name} 属于系统保留项，不能用于保存 API Key"
        ));
    }
    Ok(name)
}

pub fn api_key_storage_key(env_name: &str) -> Result<String, String> {
    Ok(format!(
        "{}{}",
        API_KEY_SETTING_PREFIX,
        validate_api_key_env_name(env_name)?
    ))
}

pub fn get_stored_api_key(conn: &Connection, env_name: &str) -> Result<Option<String>, String> {
    setting_get(conn, &api_key_storage_key(env_name)?)
}

pub fn set_stored_api_key(conn: &Connection, env_name: &str, value: &str) -> Result<(), String> {
    let key = api_key_storage_key(env_name)?;
    let v = value.trim();
    if v.is_empty() {
        conn.execute("DELETE FROM settings WHERE key = ?1", params![key])
            .map_err(|e| e.to_string())?;
        return Ok(());
    }
    setting_set(conn, &key, v)?;
    Ok(())
}

pub fn api_key_configured(conn: &Connection, env_name: &str) -> Result<bool, String> {
    let name = env_name.trim();
    if name.is_empty() {
        return Ok(false);
    }
    let name = validate_api_key_env_name(name)?;
    if std::env::var(name)
        .ok()
        .filter(|s| !s.trim().is_empty())
        .is_some()
    {
        return Ok(true);
    }
    Ok(get_stored_api_key(conn, name)?
        .filter(|s| !s.trim().is_empty())
        .is_some())
}

/// Resolves a model secret from the launch environment or local database without global hydration.
/// Dependency: validated environment name and optional xu.db connection.
/// Failure: rejects malformed/reserved names or reports that the selected key is not configured.
pub fn resolve_api_key(env_name: &str, conn: Option<&Connection>) -> Result<String, String> {
    let name = env_name.trim();
    if name.is_empty() {
        return Ok("local".into());
    }
    let name = validate_api_key_env_name(name)?;
    if let Ok(v) = std::env::var(name) {
        if !v.trim().is_empty() {
            return Ok(v.trim().to_string());
        }
    }
    if let Some(conn) = conn {
        if let Some(stored) = get_stored_api_key(conn, name)? {
            let t = stored.trim();
            if !t.is_empty() {
                return Ok(t.to_string());
            }
        }
    }
    Err(format!(
        "未配置 API Key：请在设置 → 远程模型预设中填写 Key，或设置系统环境变量 {name} 后重启虚募阁"
    ))
}

pub fn list_employees(conn: &Connection) -> Result<Vec<EmployeeRow>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, name, role, avatar_id, desk_index, status, created_at,
                    workspace_root, read_extra_paths, allow_network_exfil, drive_mode,
                    gender, role_kind, brain_slot,
                    COALESCE(outfit, 'casual'), COALESCE(hair_style, 'short'),
                    COALESCE(agent_role_id, ''),
                    COALESCE(ai_model, ''), COALESCE(ai_base_url, ''),
                    COALESCE(employee_no, ''), COALESCE(api_source, 'inherit'),
                    COALESCE(ai_vision_model, ''), COALESCE(age, 28),
                    COALESCE(remote_preset_id, ''),
                    COALESCE(code_editor_surface, 'inherit')
             FROM employees ORDER BY created_at ASC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok(EmployeeRow {
                id: r.get(0)?,
                name: r.get(1)?,
                role: r.get(2)?,
                avatar_id: r.get(3)?,
                desk_index: r.get(4)?,
                status: r.get(5)?,
                created_at: r.get(6)?,
                workspace_root: r.get(7)?,
                read_extra_paths: r.get(8)?,
                allow_network_exfil: r.get::<_, i64>(9)? != 0,
                drive_mode: r.get(10)?,
                gender: r.get(11)?,
                role_kind: r.get(12)?,
                brain_slot: r.get(13)?,
                outfit: r.get(14).unwrap_or_else(|_| "casual".into()),
                hair_style: r.get(15).unwrap_or_else(|_| "short".into()),
                agent_role_id: r.get(16).unwrap_or_else(|_| "".into()),
                ai_model: r.get(17).unwrap_or_else(|_| "".into()),
                ai_base_url: r.get(18).unwrap_or_else(|_| "".into()),
                employee_no: r.get(19).unwrap_or_else(|_| "".into()),
                api_source: r.get(20).unwrap_or_else(|_| "inherit".into()),
                ai_vision_model: r.get(21).unwrap_or_else(|_| "".into()),
                age: r.get(22).unwrap_or(28),
                remote_preset_id: r.get(23).unwrap_or_else(|_| "".into()),
                code_editor_surface: r.get(24).unwrap_or_else(|_| "inherit".into()),
            })
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

pub fn upsert_employee(conn: &Connection, emp: &EmployeeRow) -> Result<(), String> {
    conn.execute(
        "INSERT INTO employees (
            id, name, role, avatar_id, desk_index, status, created_at,
            workspace_root, read_extra_paths, allow_network_exfil, drive_mode,
            gender, role_kind, brain_slot, outfit, hair_style, agent_role_id,
            ai_model, ai_base_url, employee_no, api_source, ai_vision_model, age, remote_preset_id,
            code_editor_surface
         ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22,?23,?24,?25)
         ON CONFLICT(id) DO UPDATE SET
            name=excluded.name, role=excluded.role, avatar_id=excluded.avatar_id,
            desk_index=excluded.desk_index, status=excluded.status,
            workspace_root=excluded.workspace_root, read_extra_paths=excluded.read_extra_paths,
            allow_network_exfil=excluded.allow_network_exfil, drive_mode=excluded.drive_mode,
            gender=excluded.gender, role_kind=excluded.role_kind, brain_slot=excluded.brain_slot,
            outfit=excluded.outfit, hair_style=excluded.hair_style,
            agent_role_id=excluded.agent_role_id,
            ai_model=excluded.ai_model, ai_base_url=excluded.ai_base_url,
            employee_no=excluded.employee_no, api_source=excluded.api_source,
            ai_vision_model=excluded.ai_vision_model, age=excluded.age,
            remote_preset_id=excluded.remote_preset_id,
            code_editor_surface=excluded.code_editor_surface",
        params![
            emp.id,
            emp.name,
            emp.role,
            emp.avatar_id,
            emp.desk_index,
            emp.status,
            emp.created_at,
            emp.workspace_root,
            emp.read_extra_paths,
            if emp.allow_network_exfil { 1 } else { 0 },
            emp.drive_mode,
            emp.gender,
            emp.role_kind,
            emp.brain_slot,
            emp.outfit,
            emp.hair_style,
            emp.agent_role_id,
            emp.ai_model,
            emp.ai_base_url,
            emp.employee_no,
            if emp.api_source.is_empty() {
                "inherit"
            } else {
                &emp.api_source
            },
            emp.ai_vision_model,
            emp.age,
            emp.remote_preset_id,
            if emp.code_editor_surface.is_empty() {
                "inherit"
            } else {
                &emp.code_editor_surface
            },
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn remap_employee_id(conn: &Connection, old_id: &str, new_id: &str) -> Result<(), String> {
    if old_id == new_id {
        return Ok(());
    }
    let mut emp = conn
        .query_row(
            "SELECT id, name, role, avatar_id, desk_index, status, created_at,
                    workspace_root, read_extra_paths, allow_network_exfil, drive_mode,
                    gender, role_kind, brain_slot,
                    COALESCE(outfit, 'casual'), COALESCE(hair_style, 'short'),
                    COALESCE(agent_role_id, ''),
                    COALESCE(ai_model, ''), COALESCE(ai_base_url, ''),
                    COALESCE(employee_no, ''), COALESCE(api_source, 'inherit'),
                    COALESCE(ai_vision_model, ''), COALESCE(age, 28),
                    COALESCE(remote_preset_id, ''),
                    COALESCE(code_editor_surface, 'inherit')
             FROM employees WHERE id = ?1",
            params![old_id],
            |r| {
                Ok(EmployeeRow {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    role: r.get(2)?,
                    avatar_id: r.get(3)?,
                    desk_index: r.get(4)?,
                    status: r.get(5)?,
                    created_at: r.get(6)?,
                    workspace_root: r.get(7)?,
                    read_extra_paths: r.get(8)?,
                    allow_network_exfil: r.get::<_, i64>(9)? != 0,
                    drive_mode: r.get(10)?,
                    gender: r.get(11)?,
                    role_kind: r.get(12)?,
                    brain_slot: r.get(13)?,
                    outfit: r.get(14).unwrap_or_else(|_| "casual".into()),
                    hair_style: r.get(15).unwrap_or_else(|_| "short".into()),
                    agent_role_id: r.get(16).unwrap_or_else(|_| "".into()),
                    ai_model: r.get(17).unwrap_or_else(|_| "".into()),
                    ai_base_url: r.get(18).unwrap_or_else(|_| "".into()),
                    employee_no: r.get(19).unwrap_or_else(|_| "".into()),
                    api_source: r.get(20).unwrap_or_else(|_| "inherit".into()),
                    ai_vision_model: r.get(21).unwrap_or_else(|_| "".into()),
                    age: r.get(22).unwrap_or(28),
                    remote_preset_id: r.get(23).unwrap_or_else(|_| "".into()),
                    code_editor_surface: r.get(24).unwrap_or_else(|_| "inherit".into()),
                })
            },
        )
        .map_err(|e| format!("remap employee {old_id}: {e}"))?;
    emp.id = new_id.to_string();
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    tx.execute(
        "UPDATE messages SET employee_id = ?1 WHERE employee_id = ?2",
        params![new_id, old_id],
    )
    .map_err(|e| e.to_string())?;
    tx.execute(
        "UPDATE employee_sessions SET employee_id = ?1 WHERE employee_id = ?2",
        params![new_id, old_id],
    )
    .map_err(|e| e.to_string())?;
    tx.execute(
        "UPDATE chat_sessions SET employee_id = ?1 WHERE employee_id = ?2",
        params![new_id, old_id],
    )
    .map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM employees WHERE id = ?1", params![old_id])
        .map_err(|e| e.to_string())?;
    upsert_employee(&tx, &emp)?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

pub fn delete_employee(conn: &Connection, id: &str) -> Result<(), String> {
    conn.execute("DELETE FROM employees WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn append_message(conn: &Connection, msg: &MessageRow) -> Result<(), String> {
    conn.execute(
        "INSERT INTO messages (id, session_tag, employee_id, role, content, image_path, created_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7)",
        params![
            msg.id,
            msg.session_tag,
            msg.employee_id,
            msg.role,
            msg.content,
            msg.image_path,
            msg.created_at,
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn list_messages(
    conn: &Connection,
    session_tag: Option<String>,
    limit: i64,
) -> Result<Vec<MessageRow>, String> {
    let limit = limit.clamp(1, 500);
    if let Some(tag) = session_tag {
        let mut stmt = conn
            .prepare(
                "SELECT id, session_tag, employee_id, role, content, image_path, created_at
                 FROM messages WHERE session_tag = ?1 ORDER BY created_at DESC LIMIT ?2",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![tag, limit], map_message)
            .map_err(|e| e.to_string())?;
        collect_messages(rows)
    } else {
        let mut stmt = conn
            .prepare(
                "SELECT id, session_tag, employee_id, role, content, image_path, created_at
                 FROM messages ORDER BY created_at DESC LIMIT ?1",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![limit], map_message)
            .map_err(|e| e.to_string())?;
        collect_messages(rows)
    }
}

fn map_message(r: &rusqlite::Row<'_>) -> rusqlite::Result<MessageRow> {
    Ok(MessageRow {
        id: r.get(0)?,
        session_tag: r.get(1)?,
        employee_id: r.get(2)?,
        role: r.get(3)?,
        content: r.get(4)?,
        image_path: r.get(5)?,
        created_at: r.get(6)?,
    })
}

fn collect_messages(
    rows: rusqlite::MappedRows<'_, impl FnMut(&rusqlite::Row<'_>) -> rusqlite::Result<MessageRow>>,
) -> Result<Vec<MessageRow>, String> {
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| e.to_string())?);
    }
    out.reverse();
    Ok(out)
}

/// 0 / missing = never purge. Positive = keep last N days.
pub fn get_retention_days(conn: &Connection) -> Result<i64, String> {
    match setting_get(conn, "chat_retention_days")? {
        Some(v) => Ok(v.parse().unwrap_or(0)),
        None => Ok(0),
    }
}

pub fn set_retention_days(conn: &Connection, days: i64) -> Result<(), String> {
    setting_set(conn, "chat_retention_days", &days.max(0).to_string())
}

pub fn purge_old_messages(conn: &Connection) -> Result<u64, String> {
    let days = get_retention_days(conn)?;
    if days <= 0 {
        return Ok(0);
    }
    let cutoff = chrono::Utc::now().timestamp_millis() - days * 86_400_000;
    let n = conn
        .execute(
            "DELETE FROM messages WHERE created_at < ?1",
            params![cutoff],
        )
        .map_err(|e| e.to_string())?;
    Ok(n as u64)
}

pub fn get_ops_brains(conn: &Connection) -> Result<OpsBrains, String> {
    match setting_get(conn, "ops_brains")? {
        Some(raw) => serde_json::from_str(&raw).map_err(|e| e.to_string()),
        None => Ok(OpsBrains::default()),
    }
}

pub fn set_ops_brains(conn: &Connection, brains: &OpsBrains) -> Result<(), String> {
    let raw = serde_json::to_string(brains).map_err(|e| e.to_string())?;
    setting_set(conn, "ops_brains", &raw)
}

pub fn get_default_reviewer_id(conn: &Connection) -> Result<Option<String>, String> {
    setting_get(conn, "default_reviewer_id")
}

pub fn set_default_reviewer_id(conn: &Connection, id: Option<String>) -> Result<(), String> {
    match id {
        Some(v) if !v.is_empty() => setting_set(conn, "default_reviewer_id", &v),
        _ => {
            conn.execute("DELETE FROM settings WHERE key = 'default_reviewer_id'", [])
                .map_err(|e| e.to_string())?;
            Ok(())
        }
    }
}

pub fn employee_count(conn: &Connection) -> Result<i64, String> {
    conn.query_row("SELECT COUNT(*) FROM employees", [], |r| r.get(0))
        .map_err(|e| e.to_string())
}

pub fn get_office_layout(conn: &Connection) -> Result<Option<String>, String> {
    setting_get(conn, "office_layout")
}

pub fn set_office_layout(conn: &Connection, layout_json: &str) -> Result<(), String> {
    setting_set(conn, "office_layout", layout_json)
}

pub fn reset_office_layout(conn: &Connection) -> Result<(), String> {
    conn.execute("DELETE FROM settings WHERE key = 'office_layout'", [])
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn get_project_theme(conn: &Connection) -> Result<Option<String>, String> {
    setting_get(conn, "project_theme")
}

pub fn set_project_theme(conn: &Connection, theme_json: &str) -> Result<(), String> {
    setting_set(conn, "project_theme", theme_json)
}

pub fn clear_project_theme(conn: &Connection) -> Result<(), String> {
    conn.execute("DELETE FROM settings WHERE key = 'project_theme'", [])
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn get_delivery_disputes(conn: &Connection) -> Result<Option<String>, String> {
    setting_get(conn, "delivery_disputes")
}

pub fn set_delivery_disputes(conn: &Connection, disputes_json: &str) -> Result<(), String> {
    setting_set(conn, "delivery_disputes", disputes_json)
}

pub fn get_employee_session(
    conn: &Connection,
    employee_id: &str,
) -> Result<Option<String>, String> {
    let sql = if conn
        .prepare("SELECT session_id FROM employee_sessions LIMIT 0")
        .is_ok()
    {
        "SELECT session_id FROM employee_sessions WHERE employee_id = ?1"
    } else {
        "SELECT hermes_session_id FROM employee_sessions WHERE employee_id = ?1"
    };
    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    let mut rows = stmt
        .query(params![employee_id])
        .map_err(|e| e.to_string())?;
    if let Some(row) = rows.next().map_err(|e| e.to_string())? {
        let id: String = row.get(0).map_err(|e| e.to_string())?;
        Ok(Some(id))
    } else {
        Ok(None)
    }
}

pub fn set_employee_session(
    conn: &Connection,
    employee_id: &str,
    session_id: &str,
) -> Result<(), String> {
    let now = chrono::Utc::now().timestamp_millis();
    let col = if conn
        .prepare("SELECT session_id FROM employee_sessions LIMIT 0")
        .is_ok()
    {
        "session_id"
    } else {
        "hermes_session_id"
    };
    let sql = format!(
        "INSERT INTO employee_sessions(employee_id, {col}, updated_at) VALUES(?1, ?2, ?3)
         ON CONFLICT(employee_id) DO UPDATE SET
           {col}=excluded.{col},
           updated_at=excluded.updated_at"
    );
    conn.execute(&sql, params![employee_id, session_id, now])
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn clear_employee_session(conn: &Connection, employee_id: &str) -> Result<(), String> {
    conn.execute(
        "DELETE FROM employee_sessions WHERE employee_id = ?1",
        params![employee_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn set_employee_status(
    conn: &Connection,
    employee_id: &str,
    status: &str,
) -> Result<(), String> {
    conn.execute(
        "UPDATE employees SET status = ?1 WHERE id = ?2",
        params![status, employee_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// App cold start: Rust runtime has no live agents — clear stale working/meeting flags in one shot.
pub fn reset_busy_employees(conn: &Connection) -> Result<u32, String> {
    let n = conn
        .execute(
            "UPDATE employees SET status = 'idle' WHERE status IN ('working', 'meeting')",
            [],
        )
        .map_err(|e| e.to_string())?;
    Ok(n as u32)
}

pub fn upsert_employees_batch(conn: &Connection, employees: &[EmployeeRow]) -> Result<(), String> {
    if employees.is_empty() {
        return Ok(());
    }
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    for emp in employees {
        upsert_employee(&tx, emp)?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

pub fn get_employee_name(conn: &Connection, employee_id: &str) -> Result<Option<String>, String> {
    conn.query_row(
        "SELECT name FROM employees WHERE id = ?1",
        params![employee_id],
        |r| r.get(0),
    )
    .optional()
    .map_err(|e| e.to_string())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessageRow {
    pub id: String,
    pub session_id: String,
    pub role: String,
    pub content: String,
    pub tool_name: Option<String>,
    pub tool_call_id: Option<String>,
    pub created_at: i64,
    #[serde(default)]
    pub attachments: Vec<ChatAttachmentRow>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatAttachmentRow {
    pub id: String,
    pub session_id: String,
    pub message_id: Option<String>,
    pub filename: String,
    pub stored_path: String,
    pub mime: String,
    pub kind: String,
    pub size_bytes: u64,
    pub extracted_text: String,
    pub extraction_status: String,
    pub warning: Option<String>,
    pub created_at: i64,
}

pub fn create_chat_session(
    conn: &Connection,
    id: &str,
    title: &str,
    employee_id: Option<&str>,
    brain_slot: &str,
    model: &str,
) -> Result<(), String> {
    let now = chrono::Utc::now().timestamp_millis();
    conn.execute(
        "INSERT INTO chat_sessions(id, title, employee_id, brain_slot, model, created_at, updated_at)
         VALUES(?1,?2,?3,?4,?5,?6,?7)",
        params![id, title, employee_id, brain_slot, model, now, now],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn touch_chat_session(conn: &Connection, session_id: &str) -> Result<(), String> {
    let now = chrono::Utc::now().timestamp_millis();
    conn.execute(
        "UPDATE chat_sessions SET updated_at = ?1 WHERE id = ?2",
        params![now, session_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn append_chat_message(
    conn: &Connection,
    session_id: &str,
    role: &str,
    content: &str,
) -> Result<String, String> {
    let id = format!(
        "cm_{}_{}",
        chrono::Utc::now().timestamp_millis(),
        &session_id.chars().take(6).collect::<String>()
    );
    let now = chrono::Utc::now().timestamp_millis();
    conn.execute(
        "INSERT INTO chat_messages(id, session_id, role, content, tool_name, tool_call_id, created_at)
         VALUES(?1,?2,?3,?4,NULL,NULL,?5)",
        params![id, session_id, role, content, now],
    )
    .map_err(|e| e.to_string())?;
    touch_chat_session(conn, session_id)?;
    Ok(id)
}

pub fn list_chat_messages(
    conn: &Connection,
    session_id: &str,
    limit: i64,
) -> Result<Vec<ChatMessageRow>, String> {
    let limit = limit.clamp(1, 200);
    let mut stmt = conn
        .prepare(
            "SELECT id, session_id, role, content, tool_name, tool_call_id, created_at
             FROM chat_messages WHERE session_id = ?1
             ORDER BY created_at DESC LIMIT ?2",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![session_id, limit], |r| {
            Ok(ChatMessageRow {
                id: r.get(0)?,
                session_id: r.get(1)?,
                role: r.get(2)?,
                content: r.get(3)?,
                tool_name: r.get(4)?,
                tool_call_id: r.get(5)?,
                created_at: r.get(6)?,
                attachments: Vec::new(),
            })
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| e.to_string())?);
    }
    out.reverse();
    for message in &mut out {
        let mut attachment_stmt = conn
            .prepare(
                "SELECT id, session_id, message_id, filename, stored_path, mime, kind,
                        size_bytes, extracted_text, extraction_status, warning, created_at
                 FROM chat_attachments WHERE message_id = ?1 ORDER BY created_at ASC",
            )
            .map_err(|e| e.to_string())?;
        let attachments = attachment_stmt
            .query_map(params![message.id], |row| {
                Ok(ChatAttachmentRow {
                    id: row.get(0)?,
                    session_id: row.get(1)?,
                    message_id: row.get(2)?,
                    filename: row.get(3)?,
                    stored_path: row.get(4)?,
                    mime: row.get(5)?,
                    kind: row.get(6)?,
                    size_bytes: row.get::<_, i64>(7)?.max(0) as u64,
                    extracted_text: row.get(8)?,
                    extraction_status: row.get(9)?,
                    warning: row.get(10)?,
                    created_at: row.get(11)?,
                })
            })
            .map_err(|e| e.to_string())?;
        message.attachments = attachments
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
    }
    Ok(out)
}

pub fn chat_session_exists(conn: &Connection, session_id: &str) -> Result<bool, String> {
    let n: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM chat_sessions WHERE id = ?1",
            params![session_id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    Ok(n > 0)
}

fn ms_to_rfc3339(ms: i64) -> String {
    chrono::DateTime::from_timestamp_millis(ms)
        .map(|dt| dt.to_rfc3339())
        .unwrap_or_else(|| ms.to_string())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FouChatSessionView {
    pub id: String,
    pub title: String,
    pub created_at: String,
    pub updated_at: String,
    pub message_count: Option<u32>,
    pub model: Option<String>,
    pub last_message: Option<String>,
}

pub fn list_chat_sessions(conn: &Connection) -> Result<Vec<FouChatSessionView>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, title, model, created_at, updated_at,
                (SELECT COUNT(*) FROM chat_messages m WHERE m.session_id = s.id),
                (SELECT content FROM chat_messages m
                   WHERE m.session_id = s.id AND m.role = 'user'
                   ORDER BY m.created_at DESC LIMIT 1)
             FROM chat_sessions s
             WHERE employee_id IS NULL OR employee_id = ''
             ORDER BY updated_at DESC
             LIMIT 200",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            let created: i64 = r.get(3)?;
            let updated: i64 = r.get(4)?;
            let count: i64 = r.get(5)?;
            let last: Option<String> = r.get(6)?;
            Ok(FouChatSessionView {
                id: r.get(0)?,
                title: r.get(1)?,
                model: {
                    let m: String = r.get(2)?;
                    if m.is_empty() {
                        None
                    } else {
                        Some(m)
                    }
                },
                created_at: ms_to_rfc3339(created),
                updated_at: ms_to_rfc3339(updated),
                message_count: Some(count.max(0) as u32),
                last_message: last.filter(|s| !s.trim().is_empty()),
            })
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

pub fn ensure_chat_session(
    conn: &Connection,
    id: &str,
    title: &str,
    employee_id: Option<&str>,
    brain_slot: &str,
    model: &str,
) -> Result<(), String> {
    if chat_session_exists(conn, id)? {
        let now = chrono::Utc::now().timestamp_millis();
        conn.execute(
            "UPDATE chat_sessions SET updated_at = ?1,
               title = CASE WHEN title = '' OR title = '新对话' THEN ?2 ELSE title END,
               model = CASE WHEN model = '' THEN ?3 ELSE model END
             WHERE id = ?4",
            params![now, title, model, id],
        )
        .map_err(|e| e.to_string())?;
        return Ok(());
    }
    create_chat_session(conn, id, title, employee_id, brain_slot, model)
}

pub fn rename_chat_session(conn: &Connection, id: &str, title: &str) -> Result<(), String> {
    let now = chrono::Utc::now().timestamp_millis();
    let n = conn
        .execute(
            "UPDATE chat_sessions SET title = ?1, updated_at = ?2 WHERE id = ?3",
            params![title, now, id],
        )
        .map_err(|e| e.to_string())?;
    if n == 0 {
        return Err("会话不存在".into());
    }
    Ok(())
}

/// 事务删除会话、消息与附件行，并返回提交后待清理的附件路径。
/// 依赖: `foreign_keys=ON`；任一 SQL 失败则整批回滚，调用方不得提前删文件。
pub fn delete_chat_session(conn: &mut Connection, id: &str) -> Result<Vec<String>, String> {
    let tx = conn
        .transaction()
        .map_err(|_| "无法开始删除会话".to_string())?;
    let paths = {
        let mut stmt = tx
            .prepare("SELECT stored_path FROM chat_attachments WHERE session_id = ?1")
            .map_err(|_| "无法读取会话附件".to_string())?;
        let rows = stmt
            .query_map(params![id], |row| row.get::<_, String>(0))
            .map_err(|_| "无法读取会话附件".to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|_| "无法读取会话附件".to_string())?
    };
    tx.execute(
        "DELETE FROM chat_attachments WHERE session_id = ?1",
        params![id],
    )
    .map_err(|_| "无法删除会话附件".to_string())?;
    tx.execute(
        "DELETE FROM chat_messages WHERE session_id = ?1",
        params![id],
    )
    .map_err(|_| "无法删除会话消息".to_string())?;
    tx.execute("DELETE FROM chat_sessions WHERE id = ?1", params![id])
        .map_err(|_| "无法删除会话".to_string())?;
    tx.commit().map_err(|_| "无法提交会话删除".to_string())?;
    Ok(paths)
}

#[derive(Debug, Clone)]
pub struct EmployeeAcl {
    pub name: String,
    pub workspace_root: Option<String>,
    pub read_extra_paths: Vec<String>,
}

pub fn get_employee_acl(
    conn: &Connection,
    employee_id: &str,
) -> Result<Option<EmployeeAcl>, String> {
    let mut stmt = conn
        .prepare("SELECT name, workspace_root, read_extra_paths FROM employees WHERE id = ?1")
        .map_err(|e| e.to_string())?;
    let mut rows = stmt
        .query(params![employee_id])
        .map_err(|e| e.to_string())?;
    if let Some(row) = rows.next().map_err(|e| e.to_string())? {
        let name: String = row.get(0).map_err(|e| e.to_string())?;
        let workspace_root: Option<String> = row.get(1).map_err(|e| e.to_string())?;
        let raw: String = row.get(2).map_err(|e| e.to_string())?;
        let read_extra_paths: Vec<String> = serde_json::from_str(&raw).unwrap_or_default();
        Ok(Some(EmployeeAcl {
            name,
            workspace_root,
            read_extra_paths,
        }))
    } else {
        Ok(None)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryRow {
    pub id: String,
    pub scope: String,
    pub scope_id: Option<String>,
    pub title: String,
    pub body: String,
    pub tags: String,
    pub source: String,
    #[serde(default = "default_memory_version")]
    pub version: i64,
    #[serde(default = "default_memory_confidence")]
    pub confidence: f64,
    #[serde(default)]
    pub expires_at: Option<i64>,
    #[serde(default)]
    pub conflict_key: Option<String>,
    #[serde(default)]
    pub citation: String,
    #[serde(default)]
    pub reason: String,
    pub pinned: bool,
    pub created_at: i64,
    pub updated_at: i64,
}

fn default_memory_version() -> i64 {
    1
}

fn default_memory_confidence() -> f64 {
    0.7
}

pub fn list_memories(
    conn: &Connection,
    scope: Option<&str>,
    scope_id: Option<&str>,
    limit: i64,
) -> Result<Vec<MemoryRow>, String> {
    let limit = limit.clamp(1, 200);
    let mut out = Vec::new();
    if let Some(sc) = scope {
        if let Some(sid) = scope_id {
            let mut stmt = conn
                .prepare(
                    "SELECT id, scope, scope_id, title, body, tags, source, version, confidence,
                            expires_at, conflict_key, citation, reason, pinned, created_at, updated_at
                     FROM memories WHERE scope = ?1 AND scope_id = ?2
                       AND (expires_at IS NULL OR expires_at > unixepoch('now') * 1000)
                     ORDER BY pinned DESC, updated_at DESC LIMIT ?3",
                )
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map(params![sc, sid, limit], map_memory)
                .map_err(|e| e.to_string())?;
            for r in rows {
                out.push(r.map_err(|e| e.to_string())?);
            }
        } else {
            let mut stmt = conn
                .prepare(
                    "SELECT id, scope, scope_id, title, body, tags, source, version, confidence,
                            expires_at, conflict_key, citation, reason, pinned, created_at, updated_at
                     FROM memories WHERE scope = ?1
                       AND (expires_at IS NULL OR expires_at > unixepoch('now') * 1000)
                     ORDER BY pinned DESC, updated_at DESC LIMIT ?2",
                )
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map(params![sc, limit], map_memory)
                .map_err(|e| e.to_string())?;
            for r in rows {
                out.push(r.map_err(|e| e.to_string())?);
            }
        }
    } else {
        let mut stmt = conn
            .prepare(
                "SELECT id, scope, scope_id, title, body, tags, source, version, confidence,
                        expires_at, conflict_key, citation, reason, pinned, created_at, updated_at
                 FROM memories
                 WHERE expires_at IS NULL OR expires_at > unixepoch('now') * 1000
                 ORDER BY pinned DESC, updated_at DESC LIMIT ?1",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![limit], map_memory)
            .map_err(|e| e.to_string())?;
        for r in rows {
            out.push(r.map_err(|e| e.to_string())?);
        }
    }
    Ok(out)
}

fn map_memory(r: &rusqlite::Row<'_>) -> rusqlite::Result<MemoryRow> {
    let pinned: i64 = r.get(13)?;
    Ok(MemoryRow {
        id: r.get(0)?,
        scope: r.get(1)?,
        scope_id: r.get(2)?,
        title: r.get(3)?,
        body: r.get(4)?,
        tags: r.get(5)?,
        source: r.get(6)?,
        version: r.get(7)?,
        confidence: r.get(8)?,
        expires_at: r.get(9)?,
        conflict_key: r.get(10)?,
        citation: r.get(11)?,
        reason: r.get(12)?,
        pinned: pinned != 0,
        created_at: r.get(14)?,
        updated_at: r.get(15)?,
    })
}

/// Rough token estimate: CJK ≈ 1 tok/char, Latin ≈ 4 chars/tok.
pub fn estimate_tokens(s: &str) -> u64 {
    let mut cjk: u64 = 0;
    let mut latin: u64 = 0;
    for ch in s.chars() {
        if ch.is_ascii() {
            latin += 1;
        } else {
            cjk += 1;
        }
    }
    cjk + (latin + 3) / 4
}

fn chunk_text(body: &str, target_tokens: usize) -> Vec<String> {
    let target = target_tokens.max(200);
    let mut chunks = Vec::new();
    let mut buf = String::new();
    for para in body.split('\n') {
        let line = if para.is_empty() {
            "\n".to_string()
        } else {
            format!("{para}\n")
        };
        if estimate_tokens(&(buf.clone() + &line)) as usize > target && !buf.is_empty() {
            chunks.push(std::mem::take(&mut buf));
        }
        buf.push_str(&line);
    }
    if !buf.trim().is_empty() {
        chunks.push(buf);
    }
    if chunks.is_empty() && !body.is_empty() {
        chunks.push(body.to_string());
    }
    chunks
}

pub fn memory_corpus_tokens(conn: &Connection) -> Result<u64, String> {
    let n: i64 = conn
        .query_row(
            "SELECT COALESCE(SUM(token_est), 0) FROM memory_chunks",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);
    Ok(n.max(0) as u64)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryCorpusStats {
    pub used_tokens: u64,
    pub max_tokens: u64,
    pub memory_count: u64,
    pub chunk_count: u64,
    pub inject_max_tokens: u64,
}

pub fn memory_corpus_stats(conn: &Connection) -> Result<MemoryCorpusStats, String> {
    let max_tokens: u64 = setting_get(conn, "memory.corpus.max_tokens")?
        .and_then(|v| v.parse().ok())
        .unwrap_or(1_000_000);
    let inject_max_tokens: u64 = setting_get(conn, "memory.inject.max_tokens")?
        .and_then(|v| v.parse().ok())
        .unwrap_or(12_000);
    let used = memory_corpus_tokens(conn)?;
    let memory_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM memories", [], |r| r.get(0))
        .unwrap_or(0);
    let chunk_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM memory_chunks", [], |r| r.get(0))
        .unwrap_or(0);
    Ok(MemoryCorpusStats {
        used_tokens: used,
        max_tokens,
        memory_count: memory_count.max(0) as u64,
        chunk_count: chunk_count.max(0) as u64,
        inject_max_tokens,
    })
}

fn reindex_memory_chunks(conn: &Connection, memory_id: &str, body: &str) -> Result<u64, String> {
    conn.execute(
        "DELETE FROM memory_chunks WHERE memory_id = ?1",
        params![memory_id],
    )
    .map_err(|e| e.to_string())?;

    let now = chrono::Utc::now().timestamp_millis();
    let chunks = chunk_text(body, 700);
    let mut added: u64 = 0;
    for (i, text) in chunks.into_iter().enumerate() {
        let tok = estimate_tokens(&text);
        added += tok;
        let id = format!("chk_{memory_id}_{i}");
        conn.execute(
            "INSERT INTO memory_chunks(id, memory_id, chunk_index, text, token_est, created_at)
             VALUES(?1,?2,?3,?4,?5,?6)",
            params![id, memory_id, i as i64, text, tok as i64, now],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(added)
}

pub fn upsert_memory(conn: &Connection, row: &MemoryRow) -> Result<(), String> {
    let max_corpus: u64 = setting_get(conn, "memory.corpus.max_tokens")?
        .and_then(|v| v.parse().ok())
        .unwrap_or(1_000_000);
    let new_est = estimate_tokens(&row.body);
    let old_est: u64 = conn
        .query_row(
            "SELECT COALESCE(SUM(token_est),0) FROM memory_chunks WHERE memory_id = ?1",
            params![row.id],
            |r| r.get::<_, i64>(0),
        )
        .unwrap_or(0)
        .max(0) as u64;
    let used = memory_corpus_tokens(conn)?;
    let projected = used.saturating_sub(old_est).saturating_add(new_est);
    if projected > max_corpus && !row.pinned {
        return Err(format!(
            "记忆体容量已满（约 {used}/{max_corpus} tokens）。请删除旧记忆、提高 memory.corpus.max_tokens，或将条目设为置顶后再试。"
        ));
    }

    conn.execute(
        "INSERT INTO memories(id, scope, scope_id, title, body, tags, source, version, confidence,
                              expires_at, conflict_key, citation, reason, pinned, created_at, updated_at)
         VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16)
         ON CONFLICT(id) DO UPDATE SET
           scope=excluded.scope, scope_id=excluded.scope_id, title=excluded.title,
           body=excluded.body, tags=excluded.tags, source=excluded.source,
           version=excluded.version, confidence=excluded.confidence,
           expires_at=excluded.expires_at, conflict_key=excluded.conflict_key,
           citation=excluded.citation, reason=excluded.reason,
           pinned=excluded.pinned, updated_at=excluded.updated_at",
        params![
            row.id,
            row.scope,
            row.scope_id,
            row.title,
            row.body,
            row.tags,
            row.source,
            row.version,
            row.confidence,
            row.expires_at,
            row.conflict_key,
            row.citation,
            row.reason,
            if row.pinned { 1 } else { 0 },
            row.created_at,
            row.updated_at,
        ],
    )
    .map_err(|e| e.to_string())?;
    let _ = reindex_memory_chunks(conn, &row.id, &row.body);
    Ok(())
}

pub fn delete_memory(conn: &Connection, id: &str) -> Result<(), String> {
    conn.execute(
        "DELETE FROM memory_chunks WHERE memory_id = ?1",
        params![id],
    )
    .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM memories WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn get_memory(conn: &Connection, id: &str) -> Result<MemoryRow, String> {
    conn.query_row(
        "SELECT id, scope, scope_id, title, body, tags, source, version, confidence,
                expires_at, conflict_key, citation, reason, pinned, created_at, updated_at
         FROM memories WHERE id = ?1",
        params![id],
        map_memory,
    )
    .map_err(|e| e.to_string())
}

/// Build memory preamble for Native Agent.
/// Corpus can hold ≥1M tokens; each inject is retrieval-capped (default 12k tokens).
/// Priority: pinned + pref/constraint → task-hint chunks → scoped recent facts.
pub fn build_memory_preamble(
    conn: &Connection,
    employee_id: Option<&str>,
    employee_name: Option<&str>,
    project_id: Option<&str>,
    task_hint: Option<&str>,
) -> Result<String, String> {
    let max_tokens: usize = setting_get(conn, "memory.inject.max_tokens")?
        .and_then(|v| v.parse().ok())
        .unwrap_or(12_000);
    let max_chars: usize = setting_get(conn, "memory.inject.max_chars")?
        .and_then(|v| v.parse().ok())
        .unwrap_or(24_000);
    let max_items: usize = setting_get(conn, "memory.inject.max_items")?
        .and_then(|v| v.parse().ok())
        .unwrap_or(16);

    let hint = task_hint.unwrap_or("").trim();
    let mut bullets: Vec<String> = Vec::new();
    let mut used_tokens: usize = 0;
    let mut seen_ids: std::collections::HashSet<String> = std::collections::HashSet::new();

    // 1) Pinned + preference / constraint / decision first (all scopes)
    let mut rule_pool: Vec<MemoryRow> = Vec::new();
    rule_pool.extend(list_memories(conn, Some("global"), None, 30)?);
    if let Some(eid) = employee_id {
        rule_pool.extend(list_memories(conn, Some("employee"), Some(eid), 30)?);
    }
    if let Some(pid) = project_id {
        rule_pool.extend(list_memories(conn, Some("project"), Some(pid), 30)?);
    }
    rule_pool.sort_by(|a, b| {
        let score = |m: &MemoryRow| {
            let tags = m.tags.to_lowercase();
            let mut s = if m.pinned { 100 } else { 0 };
            if tags.contains("pref") {
                s += 40;
            }
            if tags.contains("constraint") {
                s += 45;
            }
            if tags.contains("decision") {
                s += 30;
            }
            if tags.contains("playbook") {
                s += 22;
            }
            if tags.contains("pattern") || tags.contains("task_distill") {
                s += 35;
            }
            if m.source == "task_distill" {
                s += 10;
            }
            s
        };
        score(b)
            .cmp(&score(a))
            .then(b.updated_at.cmp(&a.updated_at))
    });
    for m in rule_pool {
        let tags = m.tags.to_lowercase();
        let is_pattern = tags.contains("pattern")
            || tags.contains("task_distill")
            || m.source == "task_distill";
        let is_rule = m.pinned
            || tags.contains("pref")
            || tags.contains("constraint")
            || tags.contains("decision")
            || tags.contains("playbook")
            || is_pattern;
        if !is_rule {
            continue;
        }
        let label = if is_pattern { "模式" } else { "铁律" };
        let line = format_memory_bullet(label, &m);
        if !push_memory_bullet(
            &mut bullets,
            &mut used_tokens,
            &mut seen_ids,
            line,
            Some(&m.id),
            max_tokens,
            max_items,
        ) {
            break;
        }
    }

    // 2) Chunk retrieval: keyword Top-K (not whole-hint LIKE, which misses long tasks)
    if !hint.is_empty() {
        let tokens = crate::agent::memory_recall::tokenize_query(hint);
        let top_k: usize = setting_get(conn, "memory.inject.top_k")?
            .and_then(|v| v.parse().ok())
            .unwrap_or(8);
        let eid = employee_id.unwrap_or("");
        let pid = project_id.unwrap_or("");
        if let Ok(mut stmt) = conn.prepare(
            "SELECT c.text, m.title, m.scope, m.pinned, m.id, m.tags, m.updated_at
             FROM memory_chunks c
             JOIN memories m ON m.id = c.memory_id
             WHERE m.scope = 'global'
                OR (m.scope = 'employee' AND m.scope_id = ?1)
                OR (m.scope = 'project' AND m.scope_id = ?2)
             ORDER BY m.updated_at DESC
             LIMIT 200",
        ) {
            if let Ok(rows) = stmt.query_map(params![eid, pid], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, i64>(3)?,
                    r.get::<_, String>(4)?,
                    r.get::<_, String>(5)?,
                    r.get::<_, i64>(6)?,
                ))
            }) {
                let mut scored: Vec<(i32, String, String)> = Vec::new();
                for row in rows.flatten() {
                    let (text, title, scope, pinned, id, tags, _updated) = row;
                    if seen_ids.contains(&id) {
                        continue;
                    }
                    let hay = format!("{title}\n{text}\n{tags}");
                    let mut sc = crate::agent::memory_recall::score_haystack(
                        &hay,
                        &tokens,
                        pinned != 0,
                        &tags,
                    );
                    if sc <= 0 {
                        continue;
                    }
                    if scope == "project" {
                        sc += 4;
                    }
                    let pin = if pinned != 0 { "📌" } else { "" };
                    let kind_label = memory_kind_label(&tags);
                    let head = if title.trim().is_empty() {
                        format!("[{scope}{kind_label}]{pin}")
                    } else {
                        format!("[{scope}{kind_label}]{pin} **{}**", title.trim())
                    };
                    let snippet: String = text.chars().take(600).collect();
                    scored.push((sc, id, format!("- {head} {snippet}")));
                }
                scored.sort_by(|a, b| b.0.cmp(&a.0));
                for (_sc, id, line) in scored.into_iter().take(top_k) {
                    if !push_memory_bullet(
                        &mut bullets,
                        &mut used_tokens,
                        &mut seen_ids,
                        line,
                        Some(&id),
                        max_tokens,
                        max_items,
                    ) {
                        break;
                    }
                }
            }
        }
    }

    // 3) Fill remaining with scoped recent (facts / summaries)
    let hint_l = hint.to_lowercase();
    let mut sections: Vec<(String, Vec<MemoryRow>)> = vec![(
        "全局".into(),
        prioritize(list_memories(conn, Some("global"), None, 20)?, &hint_l),
    )];
    if let Some(eid) = employee_id {
        let label = employee_name.unwrap_or(eid);
        sections.push((
            format!("员工·{label}"),
            prioritize(
                list_memories(conn, Some("employee"), Some(eid), 20)?,
                &hint_l,
            ),
        ));
    }
    if let Some(pid) = project_id {
        sections.push((
            format!("项目·{pid}"),
            prioritize(
                list_memories(conn, Some("project"), Some(pid), 20)?,
                &hint_l,
            ),
        ));
    }
    'sections: for (heading, rows) in sections {
        for m in rows {
            let line = format_memory_bullet(&heading, &m);
            if !push_memory_bullet(
                &mut bullets,
                &mut used_tokens,
                &mut seen_ids,
                line,
                Some(&m.id),
                max_tokens,
                max_items,
            ) {
                break 'sections;
            }
        }
    }

    if bullets.is_empty() {
        return Ok(String::new());
    }

    let stats = memory_corpus_stats(conn).ok();
    let mut out = String::from("【虚募阁记忆体 · 检索注入】\n");
    if let Some(s) = stats {
        out.push_str(&format!(
            "（库容量 {}/{} tokens · 本次注入约 {} tokens）\n",
            s.used_tokens, s.max_tokens, used_tokens
        ));
    }
    for b in bullets {
        out.push_str(&b);
        out.push('\n');
    }
    if out.chars().count() > max_chars {
        out = out.chars().take(max_chars).collect();
        out.push_str("\n…(记忆注入已截断)\n");
    }
    Ok(out)
}

fn memory_kind_label(tags: &str) -> String {
    let t = tags.to_lowercase();
    if t.contains("pref") {
        "·偏好".into()
    } else if t.contains("constraint") {
        "·约束".into()
    } else if t.contains("decision") {
        "·决策".into()
    } else if t.contains("playbook") {
        "·手法".into()
    } else if t.contains("session_summary") {
        "·摘要".into()
    } else {
        String::new()
    }
}

fn format_memory_bullet(heading: &str, m: &MemoryRow) -> String {
    let kind_label = memory_kind_label(&m.tags);
    let pin = if m.pinned { "📌" } else { "" };
    let t = if m.title.trim().is_empty() {
        String::new()
    } else {
        format!("**{}** ", m.title.trim())
    };
    let body: String = m.body.chars().take(500).collect();
    format!("- ({heading}{kind_label}){pin} {t}{body}")
}

fn push_memory_bullet(
    bullets: &mut Vec<String>,
    used_tokens: &mut usize,
    seen_ids: &mut std::collections::HashSet<String>,
    line: String,
    id: Option<&str>,
    max_tokens: usize,
    max_items: usize,
) -> bool {
    if bullets.len() >= max_items || *used_tokens >= max_tokens {
        return false;
    }
    if let Some(i) = id {
        if !seen_ids.insert(i.to_string()) {
            return true;
        }
    }
    let t = estimate_tokens(&line) as usize;
    if *used_tokens + t > max_tokens {
        return false;
    }
    *used_tokens += t;
    bullets.push(line);
    true
}

// ─── Token package / usage ───────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenPackageStatus {
    pub used_tokens: u64,
    pub hard_limit: u64,
    pub soft_limit: u64,
    pub remaining: u64,
    pub soft_hit: bool,
    pub hard_hit: bool,
    pub message: String,
}

pub fn token_package_status(conn: &Connection) -> Result<TokenPackageStatus, String> {
    let hard: u64 = setting_get(conn, "token.package.hard_limit")?
        .and_then(|v| v.parse().ok())
        .unwrap_or(2_000_000);
    let soft_ratio: f64 = setting_get(conn, "token.package.soft_ratio")?
        .and_then(|v| v.parse().ok())
        .unwrap_or(0.8);
    let used: u64 = setting_get(conn, "token.usage.total")?
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);
    let soft = ((hard as f64) * soft_ratio.clamp(0.1, 1.0)) as u64;
    let hard_hit = hard > 0 && used >= hard;
    let soft_hit = soft > 0 && used >= soft;
    let remaining = hard.saturating_sub(used);
    let message = if hard_hit {
        format!("Token 套餐已用尽（{used}/{hard}）。请补充额度或暂停工作，否则无法继续调用模型。")
    } else if soft_hit {
        format!("Token 套餐接近上限（{used}/{hard}，软限 {soft}）。建议尽快补充或放缓派活。")
    } else {
        format!("Token 套餐余量正常（已用 {used}/{hard}，剩余 {remaining}）。")
    };
    Ok(TokenPackageStatus {
        used_tokens: used,
        hard_limit: hard,
        soft_limit: soft,
        remaining,
        soft_hit,
        hard_hit,
        message,
    })
}

/// Returns Err with user-facing message when hard limit exceeded or writing-quota boss-lock set.
pub fn assert_token_quota(conn: &Connection) -> Result<TokenPackageStatus, String> {
    assert_writing_quota_unlocked(conn)?;
    let st = token_package_status(conn)?;
    if st.hard_hit {
        return Err(st.message);
    }
    Ok(st)
}

const WRITING_PER_MODEL_QUOTA_YUAN_KEY: &str = "writing.per_model_quota_yuan";
const WRITING_QUOTA_BOSS_LOCK_KEY: &str = "writing.quota.boss_lock";

/// Duty: block new model calls after mid-run writing quota disconnect until boss clears lock.
pub fn assert_writing_quota_unlocked(conn: &Connection) -> Result<(), String> {
    let lock = setting_get(conn, WRITING_QUOTA_BOSS_LOCK_KEY)?
        .unwrap_or_default()
        .trim()
        .to_string();
    if lock.is_empty() {
        return Ok(());
    }
    Err(format!(
        "单模型额度已触顶并断开（{lock}）。重开须老板确认：设置 → 协作护栏 →「老板确认并重开」。"
    ))
}

fn writing_per_model_quota_micros(conn: &Connection) -> i64 {
    let yuan: i64 = setting_get(conn, WRITING_PER_MODEL_QUOTA_YUAN_KEY)
        .ok()
        .flatten()
        .and_then(|v| v.parse().ok())
        .unwrap_or(5000);
    if yuan <= 0 {
        return 0;
    }
    yuan.saturating_mul(1_000_000)
}

fn set_writing_quota_boss_lock(conn: &Connection, preset_id: &str) -> Result<(), String> {
    setting_set(conn, WRITING_QUOTA_BOSS_LOCK_KEY, preset_id.trim())
}

pub fn record_token_usage(
    conn: &Connection,
    session_id: Option<&str>,
    employee_id: Option<&str>,
    source: &str,
    prompt_tokens: u64,
    completion_tokens: u64,
    model: Option<&str>,
) -> Result<TokenPackageStatus, String> {
    record_token_usage_detail(
        conn,
        TokenUsageRecord {
            session_id: session_id.map(|s| s.to_string()),
            employee_id: employee_id.map(|s| s.to_string()),
            source: source.to_string(),
            prompt_tokens,
            completion_tokens,
            cached_tokens: 0,
            model: model.map(|s| s.to_string()),
            preset_id: String::new(),
            provider: String::new(),
        },
    )
}

#[derive(Debug, Clone)]
pub struct TokenUsageRecord {
    pub session_id: Option<String>,
    pub employee_id: Option<String>,
    pub source: String,
    pub prompt_tokens: u64,
    pub completion_tokens: u64,
    pub cached_tokens: u64,
    pub model: Option<String>,
    pub preset_id: String,
    pub provider: String,
}

pub fn record_token_usage_detail(
    conn: &Connection,
    rec: TokenUsageRecord,
) -> Result<TokenPackageStatus, String> {
    let preset_id = rec.preset_id.trim();
    let total = rec.prompt_tokens.saturating_add(rec.completion_tokens);
    let now = chrono::Utc::now().timestamp_millis();
    let (cost_micros, tier) = crate::pricing::compute_cost_cny_micros(
        conn,
        preset_id,
        rec.prompt_tokens,
        rec.completion_tokens,
        rec.cached_tokens,
        now,
    );

    if !preset_id.is_empty() {
        assert_preset_quota(conn, preset_id, cost_micros.max(0) as u64)?;
    }

    let id = format!("tok_{now}_{total}");
    conn.execute(
        "INSERT INTO token_usage_events(id, session_id, employee_id, source, prompt_tokens, completion_tokens, total_tokens, model, created_at, cached_tokens, cost_cny_micros, pricing_tier, preset_id, provider)
         VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14)",
        params![
            id,
            rec.session_id,
            rec.employee_id,
            rec.source,
            rec.prompt_tokens as i64,
            rec.completion_tokens as i64,
            total as i64,
            rec.model,
            now,
            rec.cached_tokens as i64,
            cost_micros,
            tier.as_str(),
            preset_id,
            rec.provider,
        ],
    )
    .map_err(|e| e.to_string())?;

    if !preset_id.is_empty() && cost_micros > 0 {
        let prev_used: i64 = conn
            .query_row(
                "SELECT used_cny_micros FROM model_preset_quotas WHERE preset_id = ?1",
                params![preset_id],
                |r| r.get(0),
            )
            .unwrap_or(0);
        let next_used = prev_used.saturating_add(cost_micros);
        conn.execute(
            "INSERT INTO model_preset_quotas(preset_id, hard_limit_cny_micros, soft_ratio, used_cny_micros)
             VALUES(?1, 0, 0.8, ?2)
             ON CONFLICT(preset_id) DO UPDATE SET used_cny_micros = ?2",
            params![preset_id, next_used],
        )
        .map_err(|e| e.to_string())?;
    }

    let prev: u64 = setting_get(conn, "token.usage.total")?
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);
    let next = prev.saturating_add(total);
    setting_set(conn, "token.usage.total", &next.to_string())?;
    token_package_status(conn)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PresetQuotaStatus {
    pub preset_id: String,
    pub hard_limit_cny_micros: i64,
    pub soft_ratio: f64,
    pub used_cny_micros: i64,
    pub soft_hit: bool,
    pub hard_hit: bool,
}

pub fn get_preset_quota(conn: &Connection, preset_id: &str) -> Result<PresetQuotaStatus, String> {
    let id = preset_id.trim();
    let row: (i64, f64, i64) = conn
        .query_row(
            "SELECT hard_limit_cny_micros, soft_ratio, used_cny_micros FROM model_preset_quotas WHERE preset_id = ?1",
            params![id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .unwrap_or((0, 0.8, 0));
    let (hard, soft_ratio, used) = row;
    let soft_limit = ((hard as f64) * soft_ratio.clamp(0.1, 1.0)) as i64;
    Ok(PresetQuotaStatus {
        preset_id: id.to_string(),
        hard_limit_cny_micros: hard,
        soft_ratio,
        used_cny_micros: used,
        soft_hit: hard > 0 && used >= soft_limit,
        hard_hit: hard > 0 && used >= hard,
    })
}

pub fn set_preset_quota(
    conn: &Connection,
    preset_id: &str,
    hard_limit_cny_micros: i64,
    soft_ratio: Option<f64>,
) -> Result<PresetQuotaStatus, String> {
    let id = preset_id.trim();
    if id.is_empty() {
        return Err("preset_id 不能为空".into());
    }
    let ratio = soft_ratio.unwrap_or(0.8).clamp(0.1, 1.0);
    let used: i64 = conn
        .query_row(
            "SELECT used_cny_micros FROM model_preset_quotas WHERE preset_id = ?1",
            params![id],
            |r| r.get(0),
        )
        .unwrap_or(0);
    conn.execute(
        "INSERT INTO model_preset_quotas(preset_id, hard_limit_cny_micros, soft_ratio, used_cny_micros)
         VALUES(?1,?2,?3,?4)
         ON CONFLICT(preset_id) DO UPDATE SET hard_limit_cny_micros = ?2, soft_ratio = ?3",
        params![id, hard_limit_cny_micros, ratio, used],
    )
    .map_err(|e| e.to_string())?;
    get_preset_quota(conn, id)
}

fn assert_preset_quota(
    conn: &Connection,
    preset_id: &str,
    projected_micros: u64,
) -> Result<(), String> {
    let st = get_preset_quota(conn, preset_id)?;
    // Per-preset override, else writing-guardrail default from 协作护栏「单模型额度」
    let hard = if st.hard_limit_cny_micros > 0 {
        st.hard_limit_cny_micros
    } else {
        writing_per_model_quota_micros(conn)
    };
    if hard <= 0 {
        return Ok(());
    }
    let projected = st.used_cny_micros.saturating_add(projected_micros as i64);
    if projected > hard {
        let _ = set_writing_quota_boss_lock(conn, preset_id);
        return Err(format!(
            "单模型额度已触顶，已断开连接（¥{:.2}/¥{:.2}，参考价 · {preset_id}）。重开须老板确认（设置 → 协作护栏）。",
            st.used_cny_micros as f64 / 1_000_000.0,
            hard as f64 / 1_000_000.0,
        ));
    }
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenBillingSummary {
    pub preset_id: String,
    pub model: String,
    pub provider: String,
    pub call_count: u64,
    pub prompt_tokens: u64,
    pub completion_tokens: u64,
    pub cached_tokens: u64,
    pub cost_cny_micros: i64,
}

pub fn token_billing_summary(
    conn: &Connection,
    preset_id: Option<&str>,
) -> Result<Vec<TokenBillingSummary>, String> {
    let sql = if preset_id.map(|p| !p.is_empty()).unwrap_or(false) {
        "SELECT COALESCE(preset_id,''), COALESCE(model,''), COALESCE(provider,''),
                COUNT(*), SUM(prompt_tokens), SUM(completion_tokens), SUM(cached_tokens), SUM(cost_cny_micros)
         FROM token_usage_events WHERE preset_id = ?1 GROUP BY preset_id, model, provider"
    } else {
        "SELECT COALESCE(preset_id,''), COALESCE(model,''), COALESCE(provider,''),
                COUNT(*), SUM(prompt_tokens), SUM(completion_tokens), SUM(cached_tokens), SUM(cost_cny_micros)
         FROM token_usage_events GROUP BY preset_id, model, provider"
    };
    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    let map_row = |r: &rusqlite::Row<'_>| {
        Ok(TokenBillingSummary {
            preset_id: r.get(0)?,
            model: r.get(1)?,
            provider: r.get(2)?,
            call_count: r.get::<_, i64>(3)? as u64,
            prompt_tokens: r.get::<_, i64>(4)? as u64,
            completion_tokens: r.get::<_, i64>(5)? as u64,
            cached_tokens: r.get::<_, i64>(6)? as u64,
            cost_cny_micros: r.get(7)?,
        })
    };
    let rows = if let Some(pid) = preset_id.filter(|p| !p.is_empty()) {
        stmt.query_map(params![pid], map_row)
    } else {
        stmt.query_map([], map_row)
    }
    .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

/// 按时间区间汇总各模型 Token/费用（设置 → 账单表格；与图表区间一致）
pub fn token_billing_summary_range(
    conn: &Connection,
    from_ms: i64,
    to_ms: i64,
    preset_id: Option<&str>,
) -> Result<Vec<TokenBillingSummary>, String> {
    let base = "SELECT COALESCE(preset_id,''), COALESCE(model,''), COALESCE(provider,''),
                COUNT(*), SUM(prompt_tokens), SUM(completion_tokens), SUM(cached_tokens), SUM(cost_cny_micros)
         FROM token_usage_events
         WHERE created_at >= ?1 AND created_at <= ?2
           AND preset_id != '' AND preset_id != 'local'";
    let sql = if preset_id.map(|p| !p.is_empty()).unwrap_or(false) {
        format!("{base} AND preset_id = ?3 GROUP BY preset_id, model, provider ORDER BY SUM(prompt_tokens) DESC")
    } else {
        format!("{base} GROUP BY preset_id, model, provider ORDER BY SUM(prompt_tokens) DESC")
    };
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let map_row = |r: &rusqlite::Row<'_>| {
        Ok(TokenBillingSummary {
            preset_id: r.get(0)?,
            model: r.get(1)?,
            provider: r.get(2)?,
            call_count: r.get::<_, i64>(3)? as u64,
            prompt_tokens: r.get::<_, i64>(4)? as u64,
            completion_tokens: r.get::<_, i64>(5)? as u64,
            cached_tokens: r.get::<_, i64>(6)? as u64,
            cost_cny_micros: r.get(7)?,
        })
    };
    let rows = if let Some(pid) = preset_id.filter(|p| !p.is_empty()) {
        stmt.query_map(params![from_ms, to_ms, pid], map_row)
    } else {
        stmt.query_map(params![from_ms, to_ms], map_row)
    }
    .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenBillRow {
    pub id: String,
    pub session_id: Option<String>,
    pub source: String,
    pub model: Option<String>,
    pub preset_id: String,
    pub provider: String,
    pub prompt_tokens: u64,
    pub completion_tokens: u64,
    pub cached_tokens: u64,
    pub cost_cny_micros: i64,
    pub pricing_tier: String,
    pub created_at: i64,
}

pub fn list_token_bills(
    conn: &Connection,
    preset_id: Option<&str>,
    limit: usize,
) -> Result<Vec<TokenBillRow>, String> {
    let lim = limit.clamp(1, 500) as i64;
    if let Some(pid) = preset_id.filter(|p| !p.is_empty()) {
        let mut stmt = conn
            .prepare(
                "SELECT id, session_id, source, model, preset_id, provider, prompt_tokens, completion_tokens, cached_tokens, cost_cny_micros, pricing_tier, created_at
                 FROM token_usage_events WHERE preset_id = ?1 ORDER BY created_at DESC LIMIT ?2",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![pid, lim], map_token_bill_row)
            .map_err(|e| e.to_string())?;
        return rows
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string());
    }
    let mut stmt = conn
        .prepare(
            "SELECT id, session_id, source, model, preset_id, provider, prompt_tokens, completion_tokens, cached_tokens, cost_cny_micros, pricing_tier, created_at
             FROM token_usage_events ORDER BY created_at DESC LIMIT ?1",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![lim], map_token_bill_row)
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

/// 按时间区间列出每次 API 调用的 Token 账单明细（设置 → 账单表格）
pub fn list_token_bills_range(
    conn: &Connection,
    from_ms: i64,
    to_ms: i64,
    preset_id: Option<&str>,
    limit: usize,
) -> Result<Vec<TokenBillRow>, String> {
    let from = from_ms.min(to_ms);
    let to = from_ms.max(to_ms);
    let lim = limit.clamp(1, 2000) as i64;
    if let Some(pid) = preset_id.filter(|p| !p.is_empty()) {
        let mut stmt = conn
            .prepare(
                "SELECT id, session_id, source, model, preset_id, provider, prompt_tokens, completion_tokens, cached_tokens, cost_cny_micros, pricing_tier, created_at
                 FROM token_usage_events
                 WHERE created_at >= ?1 AND created_at <= ?2 AND preset_id = ?3
                 ORDER BY created_at DESC LIMIT ?4",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![from, to, pid, lim], map_token_bill_row)
            .map_err(|e| e.to_string())?;
        return rows
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string());
    }
    let mut stmt = conn
        .prepare(
            "SELECT id, session_id, source, model, preset_id, provider, prompt_tokens, completion_tokens, cached_tokens, cost_cny_micros, pricing_tier, created_at
             FROM token_usage_events
             WHERE created_at >= ?1 AND created_at <= ?2
             ORDER BY created_at DESC LIMIT ?3",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![from, to, lim], map_token_bill_row)
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionBillingSummary {
    pub session_id: String,
    pub prompt_tokens: u64,
    pub completion_tokens: u64,
    pub cached_tokens: u64,
    pub cost_cny_micros: i64,
    pub call_count: u64,
}

pub fn session_billing_summary(
    conn: &Connection,
    session_id: &str,
) -> Result<SessionBillingSummary, String> {
    let sid = session_id.trim();
    if sid.is_empty() {
        return Ok(SessionBillingSummary {
            session_id: String::new(),
            prompt_tokens: 0,
            completion_tokens: 0,
            cached_tokens: 0,
            cost_cny_micros: 0,
            call_count: 0,
        });
    }
    conn.query_row(
        "SELECT COALESCE(SUM(prompt_tokens),0), COALESCE(SUM(completion_tokens),0),
                COALESCE(SUM(cached_tokens),0), COALESCE(SUM(cost_cny_micros),0), COUNT(*)
         FROM token_usage_events WHERE session_id = ?1",
        params![sid],
        |r| {
            Ok(SessionBillingSummary {
                session_id: sid.to_string(),
                prompt_tokens: r.get::<_, i64>(0)? as u64,
                completion_tokens: r.get::<_, i64>(1)? as u64,
                cached_tokens: r.get::<_, i64>(2)? as u64,
                cost_cny_micros: r.get(3)?,
                call_count: r.get::<_, i64>(4)? as u64,
            })
        },
    )
    .map_err(|e| e.to_string())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionBillingRound {
    pub round_index: u32,
    pub model: String,
    pub preset_id: String,
    pub prompt_tokens: u64,
    pub completion_tokens: u64,
    pub cached_tokens: u64,
    pub cost_cny_micros: i64,
    pub created_at: i64,
}

pub fn session_billing_rounds(
    conn: &Connection,
    session_id: &str,
) -> Result<Vec<SessionBillingRound>, String> {
    let sid = session_id.trim();
    if sid.is_empty() {
        return Ok(vec![]);
    }
    let mut stmt = conn
        .prepare(
            "SELECT model, preset_id, prompt_tokens, completion_tokens, cached_tokens, cost_cny_micros, created_at
             FROM token_usage_events WHERE session_id = ?1 ORDER BY created_at ASC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![sid], |r| {
            Ok((
                r.get::<_, Option<String>>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, i64>(2)? as u64,
                r.get::<_, i64>(3)? as u64,
                r.get::<_, i64>(4)? as u64,
                r.get::<_, i64>(5)?,
                r.get::<_, i64>(6)?,
            ))
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for (i, row) in rows.enumerate() {
        let (model, preset_id, prompt, completion, cached, cost, created_at) =
            row.map_err(|e| e.to_string())?;
        out.push(SessionBillingRound {
            round_index: (i + 1) as u32,
            model: model.unwrap_or_else(|| "unknown".into()),
            preset_id,
            prompt_tokens: prompt,
            completion_tokens: completion,
            cached_tokens: cached,
            cost_cny_micros: cost,
            created_at,
        });
    }
    Ok(out)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelBillingSeriesPoint {
    pub label: String,
    pub model: String,
    pub prompt_tokens: u64,
    pub completion_tokens: u64,
    pub cost_cny_micros: i64,
    pub call_count: u64,
}

pub fn token_billing_model_series(
    conn: &Connection,
    from_ms: i64,
    to_ms: i64,
    granularity: &str,
) -> Result<Vec<ModelBillingSeriesPoint>, String> {
    let fmt = match granularity {
        "week" => "%Y-W%W",
        "month" => "%Y-%m",
        _ => "%Y-%m-%d",
    };
    let sql = format!(
        "SELECT strftime('{fmt}', created_at/1000, 'unixepoch', 'localtime') AS lbl,
                COALESCE(NULLIF(model,''), preset_id, 'unknown') AS mdl,
                COALESCE(SUM(prompt_tokens),0), COALESCE(SUM(completion_tokens),0),
                COALESCE(SUM(cost_cny_micros),0), COUNT(*)
         FROM token_usage_events
         WHERE created_at >= ?1 AND created_at <= ?2
           AND preset_id != '' AND preset_id != 'local'
         GROUP BY lbl, mdl ORDER BY lbl ASC, mdl ASC"
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![from_ms, to_ms], |r| {
            Ok(ModelBillingSeriesPoint {
                label: r.get(0)?,
                model: r.get(1)?,
                prompt_tokens: r.get::<_, i64>(2)? as u64,
                completion_tokens: r.get::<_, i64>(3)? as u64,
                cost_cny_micros: r.get(4)?,
                call_count: r.get::<_, i64>(5)? as u64,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenBillingBucket {
    pub bucket_start: i64,
    pub label: String,
    pub prompt_tokens: u64,
    pub completion_tokens: u64,
    pub cached_tokens: u64,
    pub cost_cny_micros: i64,
    pub call_count: u64,
}

pub fn token_billing_series(
    conn: &Connection,
    preset_id: Option<&str>,
    from_ms: i64,
    to_ms: i64,
    granularity: &str,
) -> Result<Vec<TokenBillingBucket>, String> {
    let fmt = match granularity {
        "week" => "%Y-W%W",
        "month" => "%Y-%m",
        _ => "%Y-%m-%d",
    };
    let base = format!(
        "SELECT strftime('{fmt}', created_at/1000, 'unixepoch', 'localtime') AS lbl,
                MIN(created_at), COALESCE(SUM(prompt_tokens),0), COALESCE(SUM(completion_tokens),0),
                COALESCE(SUM(cached_tokens),0), COALESCE(SUM(cost_cny_micros),0), COUNT(*)
         FROM token_usage_events
         WHERE created_at >= ?1 AND created_at <= ?2"
    );
    let (sql, pid): (String, Option<&str>) = if let Some(p) = preset_id.filter(|p| !p.is_empty()) {
        (
            format!("{base} AND preset_id = ?3 GROUP BY lbl ORDER BY lbl ASC"),
            Some(p),
        )
    } else {
        (format!("{base} GROUP BY lbl ORDER BY lbl ASC"), None)
    };
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = if let Some(p) = pid {
        stmt.query_map(params![from_ms, to_ms, p], map_billing_bucket)
    } else {
        stmt.query_map(params![from_ms, to_ms], map_billing_bucket)
    }
    .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

fn map_billing_bucket(r: &rusqlite::Row<'_>) -> rusqlite::Result<TokenBillingBucket> {
    Ok(TokenBillingBucket {
        label: r.get(0)?,
        bucket_start: r.get(1)?,
        prompt_tokens: r.get::<_, i64>(2)? as u64,
        completion_tokens: r.get::<_, i64>(3)? as u64,
        cached_tokens: r.get::<_, i64>(4)? as u64,
        cost_cny_micros: r.get(5)?,
        call_count: r.get::<_, i64>(6)? as u64,
    })
}

fn map_token_bill_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<TokenBillRow> {
    Ok(TokenBillRow {
        id: r.get(0)?,
        session_id: r.get(1)?,
        source: r.get(2)?,
        model: r.get(3)?,
        preset_id: r.get(4)?,
        provider: r.get(5)?,
        prompt_tokens: r.get::<_, i64>(6)? as u64,
        completion_tokens: r.get::<_, i64>(7)? as u64,
        cached_tokens: r.get::<_, i64>(8)? as u64,
        cost_cny_micros: r.get(9)?,
        pricing_tier: r.get(10)?,
        created_at: r.get(11)?,
    })
}

pub fn set_token_package(
    conn: &Connection,
    hard_limit: u64,
    soft_ratio: Option<f64>,
    reset_usage: bool,
) -> Result<TokenPackageStatus, String> {
    setting_set(conn, "token.package.hard_limit", &hard_limit.to_string())?;
    if let Some(r) = soft_ratio {
        setting_set(
            conn,
            "token.package.soft_ratio",
            &r.clamp(0.1, 1.0).to_string(),
        )?;
    }
    if reset_usage {
        setting_set(conn, "token.usage.total", "0")?;
    }
    token_package_status(conn)
}

fn prioritize(mut rows: Vec<MemoryRow>, hint: &str) -> Vec<MemoryRow> {
    rows.sort_by(|a, b| {
        let score = |m: &MemoryRow| {
            let tags = m.tags.to_lowercase();
            let mut s = if m.pinned { 100 } else { 0 };
            if tags.contains("pref") {
                s += 35;
            }
            if tags.contains("constraint") {
                s += 40;
            }
            if tags.contains("decision") {
                s += 25;
            }
            if tags.contains("session_summary") {
                s += 10;
            }
            if !hint.is_empty() {
                let hay = format!("{} {} {}", m.title, m.body, m.tags);
                let toks = crate::agent::memory_recall::tokenize_query(hint);
                s += crate::agent::memory_recall::score_haystack(&hay, &toks, false, &m.tags);
            }
            s
        };
        score(b)
            .cmp(&score(a))
            .then(b.updated_at.cmp(&a.updated_at))
    });
    rows
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelEndpointRow {
    pub id: String,
    pub enabled: bool,
    pub kind: String,
    pub webhook_url: Option<String>,
    pub secret_ref: Option<String>,
    pub extra_json: String,
    pub updated_at: i64,
}

pub fn get_channel_endpoint(
    conn: &Connection,
    id: &str,
) -> Result<Option<ChannelEndpointRow>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, enabled, kind, webhook_url, secret_ref, extra_json, updated_at
             FROM channel_endpoints WHERE id = ?1",
        )
        .map_err(|e| e.to_string())?;
    let mut rows = stmt.query(params![id]).map_err(|e| e.to_string())?;
    if let Some(row) = rows.next().map_err(|e| e.to_string())? {
        let enabled: i64 = row.get(1).map_err(|e| e.to_string())?;
        Ok(Some(ChannelEndpointRow {
            id: row.get(0).map_err(|e| e.to_string())?,
            enabled: enabled != 0,
            kind: row.get(2).map_err(|e| e.to_string())?,
            webhook_url: row.get(3).map_err(|e| e.to_string())?,
            secret_ref: row.get(4).map_err(|e| e.to_string())?,
            extra_json: row.get(5).map_err(|e| e.to_string())?,
            updated_at: row.get(6).map_err(|e| e.to_string())?,
        }))
    } else {
        Ok(None)
    }
}

pub fn upsert_channel_endpoint(conn: &Connection, row: &ChannelEndpointRow) -> Result<(), String> {
    conn.execute(
        "INSERT INTO channel_endpoints(id, enabled, kind, webhook_url, secret_ref, extra_json, updated_at)
         VALUES(?1,?2,?3,?4,?5,?6,?7)
         ON CONFLICT(id) DO UPDATE SET
           enabled=excluded.enabled, kind=excluded.kind, webhook_url=excluded.webhook_url,
           secret_ref=excluded.secret_ref, extra_json=excluded.extra_json, updated_at=excluded.updated_at",
        params![
            row.id,
            if row.enabled { 1 } else { 0 },
            row.kind,
            row.webhook_url,
            row.secret_ref,
            row.extra_json,
            row.updated_at,
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn list_channel_endpoints(conn: &Connection) -> Result<Vec<ChannelEndpointRow>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, enabled, kind, webhook_url, secret_ref, extra_json, updated_at
             FROM channel_endpoints",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            let enabled: i64 = row.get(1)?;
            Ok(ChannelEndpointRow {
                id: row.get(0)?,
                enabled: enabled != 0,
                kind: row.get(2)?,
                webhook_url: row.get(3)?,
                secret_ref: row.get(4)?,
                extra_json: row.get(5)?,
                updated_at: row.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

#[cfg(test)]
mod migration_tests {
    use super::*;

    #[test]
    fn api_key_env_names_are_strict_and_never_reach_process_mutation() {
        for valid in ["DEEPSEEK_API_KEY", "_LOCAL_MODEL_KEY", "KEY2"] {
            assert_eq!(validate_api_key_env_name(valid).unwrap(), valid);
        }
        for invalid in [
            "",
            "lowercase",
            "9KEY",
            "API-KEY",
            "API=KEY",
            "API\0KEY",
            "密钥",
            "PATH",
            "PATHEXT",
            "COMSPEC",
            "SYSTEMROOT",
        ] {
            let result = std::panic::catch_unwind(|| validate_api_key_env_name(invalid));
            assert!(result.is_ok(), "validation panicked for {invalid:?}");
            assert!(result.unwrap().is_err(), "accepted {invalid:?}");
        }
    }

    #[test]
    fn stored_api_keys_do_not_hydrate_the_process_environment() {
        let conn = Connection::open_in_memory().expect("open in-memory database");
        migrate_connection(&conn).expect("migrate");
        let name = "XU_AUDIT_TEST_MODEL_KEY";
        std::env::remove_var(name);
        set_stored_api_key(&conn, name, "secret").expect("store key");
        assert!(std::env::var_os(name).is_none());
        assert_eq!(
            resolve_api_key(name, Some(&conn)).expect("resolve stored key"),
            "secret"
        );
        assert!(std::env::var_os(name).is_none());
    }

    #[test]
    fn full_schema_migration_is_idempotent() {
        let conn = Connection::open_in_memory().expect("open in-memory database");
        migrate_connection(&conn).expect("first migration");
        migrate_connection(&conn).expect("second migration");
        let foreign_keys: i64 = conn
            .query_row("PRAGMA foreign_keys", [], |row| row.get(0))
            .expect("query foreign keys");
        assert_eq!(foreign_keys, 1);
        let employee_columns: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('employees') WHERE name='code_editor_surface'",
                [],
                |row| row.get(0),
            )
            .expect("query migrated column");
        assert_eq!(employee_columns, 1);
        let attachment_columns: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('chat_attachments')",
                [],
                |row| row.get(0),
            )
            .expect("query attachment columns");
        assert_eq!(attachment_columns, 12);
        let version: i64 = conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .expect("query user version");
        assert_eq!(version, SCHEMA_VERSION);
    }

    #[test]
    fn migration_failure_rolls_back_schema_and_version() {
        let conn = Connection::open_in_memory().expect("open in-memory database");
        let result = migrate_connection_with_hook(&conn, || Err("injected failure".into()));
        assert!(result.is_err());
        let version: i64 = conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .unwrap();
        let employees: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='employees'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(version, 0);
        assert_eq!(employees, 0);
        migrate_connection(&conn).expect("retry migration after rollback");
        migrate_connection(&conn).expect("idempotent migration after retry");
    }

    #[test]
    fn rejects_database_from_newer_schema_version() {
        let conn = Connection::open_in_memory().expect("open in-memory database");
        conn.pragma_update(None, "user_version", SCHEMA_VERSION + 1)
            .unwrap();
        assert!(migrate_connection(&conn).is_err());
    }

    #[test]
    fn history_restores_bound_attachments() {
        let conn = Connection::open_in_memory().expect("open in-memory database");
        migrate_connection(&conn).expect("migrate");
        create_chat_session(&conn, "session", "test", None, "command", "model").unwrap();
        let message_id = append_chat_message(&conn, "session", "user", "hello").unwrap();
        conn.execute(
            "INSERT INTO chat_attachments
             (id,session_id,message_id,filename,stored_path,mime,kind,size_bytes,
              extracted_text,extraction_status,warning,created_at)
             VALUES('att','session',?1,'image.png','safe','image/png','image',8,'','ready',NULL,1)",
            params![message_id],
        )
        .unwrap();
        let history = list_chat_messages(&conn, "session", 20).unwrap();
        assert_eq!(history.len(), 1);
        assert_eq!(history[0].attachments.len(), 1);
        assert_eq!(history[0].attachments[0].filename, "image.png");
    }

    #[test]
    fn session_delete_removes_attachment_rows_transactionally() {
        let mut conn = Connection::open_in_memory().expect("open in-memory database");
        migrate_connection(&conn).expect("migrate");
        create_chat_session(&conn, "session", "test", None, "command", "model").unwrap();
        let message_id = append_chat_message(&conn, "session", "user", "hello").unwrap();
        conn.execute(
            "INSERT INTO chat_attachments
             (id,session_id,message_id,filename,stored_path,mime,kind,size_bytes,
              extracted_text,extraction_status,warning,created_at)
             VALUES('att','session',?1,'file.txt','stored/file.txt','text/plain','text',4,'test','ready',NULL,1)",
            params![message_id],
        )
        .unwrap();
        let paths = delete_chat_session(&mut conn, "session").unwrap();
        let attachment_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM chat_attachments", [], |row| {
                row.get(0)
            })
            .unwrap();
        let session_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM chat_sessions", [], |row| row.get(0))
            .unwrap();
        assert_eq!(paths, vec!["stored/file.txt"]);
        assert_eq!(attachment_count, 0);
        assert_eq!(session_count, 0);
    }
}
