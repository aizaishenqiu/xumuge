//! Native Agent 运行账本、跨会话检索、结构化摘要与统一上下文组装。
//!
//! @author qiuye <yjk150@qq.com>
//! @date 2026-08-30
//! @updated 2026-08-31
//! @version 1.1.0
//! @category AgentLoop
//! @algo token-budgeted-context-and-mtime-sha256-index

use std::collections::HashSet;
use std::fs;
use std::path::Path;
use std::time::UNIX_EPOCH;

use ignore::WalkBuilder;
use regex::Regex;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tauri::State;

use crate::desktop_db::{self, FouDb};

const DEFAULT_WINDOW: usize = 200_000;
const DEFAULT_OUTPUT_RESERVE: usize = 16_000;

/// Idempotently upgrades xu.db for context-memory features.
/// Dependency: SQLite; FTS5 is attempted at runtime and LIKE search remains available on failure.
/// Failure: core table failures abort database initialization; optional FTS5 failures are recorded.
pub fn migrate(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS agent_runs (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            status TEXT NOT NULL,
            model TEXT NOT NULL DEFAULT '',
            project_id TEXT,
            employee_id TEXT,
            error TEXT,
            started_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            finished_at INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_agent_runs_session ON agent_runs(session_id, started_at DESC);
        CREATE INDEX IF NOT EXISTS idx_agent_runs_status ON agent_runs(status, updated_at DESC);
        CREATE TABLE IF NOT EXISTS run_steps (
            id TEXT PRIMARY KEY,
            run_id TEXT NOT NULL,
            ordinal INTEGER NOT NULL,
            kind TEXT NOT NULL,
            status TEXT NOT NULL,
            input_json TEXT NOT NULL DEFAULT '{}',
            output_json TEXT NOT NULL DEFAULT '{}',
            error TEXT,
            started_at INTEGER NOT NULL,
            finished_at INTEGER,
            FOREIGN KEY(run_id) REFERENCES agent_runs(id) ON DELETE CASCADE
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_run_steps_ordinal ON run_steps(run_id, ordinal);
        CREATE TABLE IF NOT EXISTS tool_calls (
            id TEXT PRIMARY KEY,
            run_id TEXT NOT NULL,
            step_id TEXT,
            name TEXT NOT NULL,
            arguments_json TEXT NOT NULL DEFAULT '{}',
            output TEXT,
            status TEXT NOT NULL,
            error TEXT,
            started_at INTEGER NOT NULL,
            finished_at INTEGER,
            FOREIGN KEY(run_id) REFERENCES agent_runs(id) ON DELETE CASCADE,
            FOREIGN KEY(step_id) REFERENCES run_steps(id) ON DELETE SET NULL
        );
        CREATE INDEX IF NOT EXISTS idx_tool_calls_run ON tool_calls(run_id, started_at);
        CREATE TABLE IF NOT EXISTS approvals (
            id TEXT PRIMARY KEY,
            run_id TEXT NOT NULL,
            tool_call_id TEXT NOT NULL,
            status TEXT NOT NULL,
            reason TEXT,
            requested_at INTEGER NOT NULL,
            decided_at INTEGER,
            FOREIGN KEY(run_id) REFERENCES agent_runs(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_approvals_run ON approvals(run_id, requested_at);
        CREATE TABLE IF NOT EXISTS checkpoints (
            id TEXT PRIMARY KEY,
            run_id TEXT NOT NULL,
            step_ordinal INTEGER NOT NULL,
            state_json TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            FOREIGN KEY(run_id) REFERENCES agent_runs(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_checkpoints_run ON checkpoints(run_id, step_ordinal DESC);
        CREATE TABLE IF NOT EXISTS session_summaries (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            summary_json TEXT NOT NULL,
            source TEXT NOT NULL,
            version INTEGER NOT NULL DEFAULT 1,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_session_summaries_session ON session_summaries(session_id, updated_at DESC);
        CREATE TABLE IF NOT EXISTS code_index_files (
            workspace_root TEXT NOT NULL,
            path TEXT NOT NULL,
            mtime_ms INTEGER NOT NULL,
            content_hash TEXT NOT NULL,
            language TEXT NOT NULL DEFAULT '',
            indexed_at INTEGER NOT NULL,
            PRIMARY KEY(workspace_root, path)
        );
        CREATE TABLE IF NOT EXISTS code_index_symbols (
            id TEXT PRIMARY KEY,
            workspace_root TEXT NOT NULL,
            path TEXT NOT NULL,
            symbol TEXT NOT NULL,
            kind TEXT NOT NULL,
            line INTEGER NOT NULL,
            snippet TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_code_symbols_lookup ON code_index_symbols(workspace_root, symbol);
        "#,
    )
    .map_err(|e| format!("context-memory schema: {e}"))?;

    for (column, definition) in [
        ("version", "version INTEGER NOT NULL DEFAULT 1"),
        ("confidence", "confidence REAL NOT NULL DEFAULT 0.7"),
        ("expires_at", "expires_at INTEGER"),
        ("conflict_key", "conflict_key TEXT"),
        ("citation", "citation TEXT NOT NULL DEFAULT ''"),
        ("reason", "reason TEXT NOT NULL DEFAULT ''"),
    ] {
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('memories') WHERE name=?1",
                params![column],
                |row| row.get(0),
            )
            .map_err(|e| format!("读取 memories 表结构失败: {e}"))?;
        if count == 0 {
            conn.execute_batch(&format!("ALTER TABLE memories ADD COLUMN {definition}"))
                .map_err(|e| format!("迁移 memories.{column} 失败: {e}"))?;
        }
    }
    let fts = conn.execute_batch(
        r#"
        CREATE VIRTUAL TABLE IF NOT EXISTS chat_messages_fts USING fts5(
            content, session_id UNINDEXED, message_id UNINDEXED, tokenize='unicode61'
        );
        CREATE TRIGGER IF NOT EXISTS chat_messages_fts_ai AFTER INSERT ON chat_messages BEGIN
            INSERT INTO chat_messages_fts(rowid, content, session_id, message_id)
            VALUES (new.rowid, new.content, new.session_id, new.id);
        END;
        CREATE TRIGGER IF NOT EXISTS chat_messages_fts_ad AFTER DELETE ON chat_messages BEGIN
            DELETE FROM chat_messages_fts WHERE rowid = old.rowid;
        END;
        CREATE TRIGGER IF NOT EXISTS chat_messages_fts_au AFTER UPDATE OF content, session_id ON chat_messages BEGIN
            DELETE FROM chat_messages_fts WHERE rowid = old.rowid;
            INSERT INTO chat_messages_fts(rowid, content, session_id, message_id)
            VALUES (new.rowid, new.content, new.session_id, new.id);
        END;
        DELETE FROM chat_messages_fts;
        INSERT INTO chat_messages_fts(rowid, content, session_id, message_id)
        SELECT rowid, content, session_id, id FROM chat_messages;
        "#,
    );
    let mode = if fts.is_ok() { "fts5" } else { "like" };
    desktop_db::setting_set(conn, "chat.search.mode", mode)?;
    Ok(())
}

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

/// Starts a durable Agent run and stores its initial recovery checkpoint.
pub fn start_run(
    conn: &Connection,
    run_id: &str,
    session_id: &str,
    model: &str,
    project_id: Option<&str>,
    employee_id: Option<&str>,
    messages: &[Value],
) -> Result<(), String> {
    start_run_with_context(
        conn,
        run_id,
        session_id,
        model,
        project_id,
        employee_id,
        messages,
        &json!({
            "projectId": project_id.unwrap_or("unscoped"),
            "toolPolicy": {},
            "snapshotBatch": format!("{run_id}:legacy"),
            "plan": []
        }),
    )
}

/// Starts a durable run with a complete non-null recovery context.
/// Dependency: caller supplies project/tool policy/snapshot batch/plan; malformed context is rejected.
/// Failure: no partial run row is committed when checkpoint validation fails.
pub fn start_run_with_context(
    conn: &Connection,
    run_id: &str,
    session_id: &str,
    model: &str,
    project_id: Option<&str>,
    employee_id: Option<&str>,
    messages: &[Value],
    recovery_context: &Value,
) -> Result<(), String> {
    validate_recovery_context(recovery_context)?;
    let now = now_ms();
    let tx = conn
        .unchecked_transaction()
        .map_err(|e| format!("开始运行事务失败: {e}"))?;
    tx.execute(
        "INSERT INTO agent_runs(id,session_id,status,model,project_id,employee_id,error,started_at,updated_at,finished_at)
         VALUES(?1,?2,'running',?3,?4,?5,NULL,?6,?6,NULL)",
        params![run_id, session_id, model, project_id, employee_id, now],
    )
    .map_err(|e| format!("创建运行记录失败: {e}"))?;
    checkpoint(
        &tx,
        run_id,
        0,
        &json!({
            "messages": messages,
            "phase": "started",
            "recoveryContext": recovery_context
        }),
    )?;
    tx.commit().map_err(|e| format!("提交运行记录失败: {e}"))
}

fn validate_recovery_context(context: &Value) -> Result<(), String> {
    for key in ["projectId", "toolPolicy", "snapshotBatch", "plan"] {
        if context.get(key).is_none_or(Value::is_null) {
            return Err(format!("恢复上下文缺少非空字段: {key}"));
        }
    }
    Ok(())
}

/// Applies one terminal status to a run. Allowed terminal states are completed/cancelled/error.
pub fn finish_run(conn: &Connection, run_id: &str, status: &str, error: Option<&str>) {
    let status = match status {
        "completed" | "cancelled" | "error" => status,
        _ => "error",
    };
    let now = now_ms();
    let _ = conn.execute(
        "UPDATE agent_runs SET status=?1,error=?2,updated_at=?3,finished_at=?3 WHERE id=?4",
        params![status, error, now, run_id],
    );
    let _ = conn.execute(
        "UPDATE run_steps SET status=?1,error=COALESCE(error,?2),finished_at=COALESCE(finished_at,?3)
         WHERE run_id=?4 AND status IN ('running','waiting_approval')",
        params![status, error, now, run_id],
    );
    let _ = conn.execute(
        "UPDATE tool_calls SET status=?1,error=COALESCE(error,?2),finished_at=COALESCE(finished_at,?3)
         WHERE run_id=?4 AND status IN ('running','waiting_approval')",
        params![status, error, now, run_id],
    );
    let _ = conn.execute(
        "UPDATE approvals SET status=?1,decided_at=COALESCE(decided_at,?2)
         WHERE run_id=?3 AND status='pending'",
        params![
            if status == "cancelled" {
                "cancelled"
            } else {
                "closed"
            },
            now,
            run_id
        ],
    );
}

/// Marks a running turn as cancelling before its loop observes the atomic cancel flag.
pub fn mark_run_cancelling(conn: &Connection, run_id: &str) {
    let _ = conn.execute(
        "UPDATE agent_runs SET status='cancelling',updated_at=?1 WHERE id=?2 AND status='running'",
        params![now_ms(), run_id],
    );
}

/// Opens one durable LLM/tool round and returns its step id; write failures remain non-fatal to the loop.
pub fn start_step(
    conn: &Connection,
    run_id: &str,
    ordinal: usize,
    kind: &str,
    input: &Value,
) -> String {
    let id = format!("{run_id}:step:{ordinal}");
    let _ = conn.execute(
        "INSERT OR REPLACE INTO run_steps(id,run_id,ordinal,kind,status,input_json,output_json,error,started_at,finished_at)
         VALUES(?1,?2,?3,?4,'running',?5,'{}',NULL,?6,NULL)",
        params![id, run_id, ordinal as i64, kind, input.to_string(), now_ms()],
    );
    id
}

/// Closes a durable round with structured output and an optional failure reason.
pub fn finish_step(
    conn: &Connection,
    step_id: &str,
    status: &str,
    output: &Value,
    error: Option<&str>,
) {
    let _ = conn.execute(
        "UPDATE run_steps SET status=?1,output_json=?2,error=?3,finished_at=?4 WHERE id=?5",
        params![status, output.to_string(), error, now_ms(), step_id],
    );
}

/// Records a tool call before approval or execution so crashes remain recoverable.
pub fn start_tool(
    conn: &Connection,
    run_id: &str,
    step_id: Option<&str>,
    call_id: &str,
    name: &str,
    arguments: &str,
) {
    let _ = conn.execute(
        "INSERT OR REPLACE INTO tool_calls(id,run_id,step_id,name,arguments_json,output,status,error,started_at,finished_at)
         VALUES(?1,?2,?3,?4,?5,NULL,'running',NULL,?6,NULL)",
        params![call_id, run_id, step_id, name, arguments, now_ms()],
    );
}

/// Closes a tool call with a consistent completed/denied/error/cancelled state.
pub fn finish_tool(
    conn: &Connection,
    call_id: &str,
    status: &str,
    output: &str,
    error: Option<&str>,
) {
    let _ = conn.execute(
        "UPDATE tool_calls SET status=?1,output=?2,error=?3,finished_at=?4 WHERE id=?5",
        params![status, output, error, now_ms(), call_id],
    );
}

/// Persists a pending user approval linked to its tool call.
pub fn request_approval(conn: &Connection, run_id: &str, call_id: &str, reason: &str) {
    let id = format!("{run_id}:approval:{call_id}");
    let _ = conn.execute(
        "INSERT OR REPLACE INTO approvals(id,run_id,tool_call_id,status,reason,requested_at,decided_at)
         VALUES(?1,?2,?3,'pending',?4,?5,NULL)",
        params![id, run_id, call_id, reason, now_ms()],
    );
    let _ = conn.execute(
        "UPDATE tool_calls SET status='waiting_approval' WHERE id=?1",
        params![call_id],
    );
}

/// Persists the approval decision used by the live tool loop.
pub fn decide_approval(conn: &Connection, run_id: &str, call_id: &str, status: &str) {
    let _ = conn.execute(
        "UPDATE approvals SET status=?1,decided_at=?2 WHERE run_id=?3 AND tool_call_id=?4",
        params![status, now_ms(), run_id, call_id],
    );
}

/// Saves a restart-safe message checkpoint after a completed round.
pub fn checkpoint(
    conn: &Connection,
    run_id: &str,
    ordinal: usize,
    state: &Value,
) -> Result<(), String> {
    let id = format!("{run_id}:checkpoint:{ordinal}");
    conn.execute(
        "INSERT INTO checkpoints(id,run_id,step_ordinal,state_json,created_at)
         VALUES(?1,?2,?3,?4,?5)",
        params![id, run_id, ordinal as i64, state.to_string(), now_ms()],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Persists one structured, session-scoped compaction summary.
pub fn save_session_summary(
    conn: &Connection,
    session_id: &str,
    source: &str,
    summary: &str,
    dropped_count: usize,
) -> Result<String, String> {
    if session_id.trim().is_empty() {
        return Err("sessionId 不能为空".into());
    }
    let now = now_ms();
    let id = format!("summary_{}_{}", session_id, now);
    let payload = json!({
        "summary": summary,
        "droppedCount": dropped_count,
        "source": source,
        "createdAt": now,
    });
    conn.execute(
        "INSERT INTO session_summaries(id,session_id,summary_json,source,version,created_at,updated_at)
         VALUES(?1,?2,?3,?4,1,?5,?5)",
        params![id, session_id, payload.to_string(), source, now],
    )
    .map_err(|e| e.to_string())?;
    Ok(id)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatSearchHit {
    pub session_id: String,
    pub session_title: String,
    pub message_id: String,
    pub role: String,
    pub snippet: String,
    pub created_at: i64,
    pub backend: String,
}

fn escape_fts_query(query: &str) -> String {
    desktop_db::estimate_tokens(query);
    let terms = crate::agent::memory_recall::tokenize_query(query);
    terms
        .into_iter()
        .take(12)
        .map(|t| format!("\"{}\"", t.replace('"', "\"\"")))
        .collect::<Vec<_>>()
        .join(" OR ")
}

/// Searches message bodies across all chat sessions, preferring FTS5 and reliably falling back to LIKE.
pub fn search_chat_messages(
    conn: &Connection,
    query: &str,
    limit: i64,
) -> Result<Vec<ChatSearchHit>, String> {
    let q = query.trim();
    if q.is_empty() {
        return Ok(Vec::new());
    }
    let limit = limit.clamp(1, 100);
    let fts_q = escape_fts_query(q);
    if !fts_q.is_empty() {
        if let Ok(mut stmt) = conn.prepare(
            "SELECT f.session_id,s.title,f.message_id,m.role,
                    snippet(chat_messages_fts,0,'','', ' … ',18),m.created_at
             FROM chat_messages_fts f
             JOIN chat_messages m ON m.id=f.message_id
             JOIN chat_sessions s ON s.id=f.session_id
             WHERE chat_messages_fts MATCH ?1
             ORDER BY bm25(chat_messages_fts),m.created_at DESC LIMIT ?2",
        ) {
            if let Ok(rows) = stmt.query_map(params![fts_q, limit], |r| {
                Ok(ChatSearchHit {
                    session_id: r.get(0)?,
                    session_title: r.get(1)?,
                    message_id: r.get(2)?,
                    role: r.get(3)?,
                    snippet: r.get(4)?,
                    created_at: r.get(5)?,
                    backend: "fts5".into(),
                })
            }) {
                let out: Vec<_> = rows.flatten().collect();
                if !out.is_empty() {
                    return Ok(out);
                }
            }
        }
    }
    let like = format!(
        "%{}%",
        q.replace('\\', "\\\\")
            .replace('%', "\\%")
            .replace('_', "\\_")
    );
    let mut stmt = conn
        .prepare(
            "SELECT m.session_id,s.title,m.id,m.role,
                    substr(m.content,max(1,instr(lower(m.content),lower(?1))-60),220),m.created_at
             FROM chat_messages m JOIN chat_sessions s ON s.id=m.session_id
             WHERE m.content LIKE ?2 ESCAPE '\\'
             ORDER BY m.created_at DESC LIMIT ?3",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![q, like, limit], |r| {
            Ok(ChatSearchHit {
                session_id: r.get(0)?,
                session_title: r.get(1)?,
                message_id: r.get(2)?,
                role: r.get(3)?,
                snippet: r.get(4)?,
                created_at: r.get(5)?,
                backend: "like".into(),
            })
        })
        .map_err(|e| e.to_string())?;
    Ok(rows.flatten().collect())
}

/// Provider boundary for future Tree-sitter/LSP symbol extractors.
pub trait SymbolExtractor {
    fn extract(&self, path: &Path, source: &str) -> Vec<(String, String, usize, String)>;
}

/// Lightweight extension boundary used until Tree-sitter/LSP providers are connected.
struct RegexSymbolExtractor;

impl SymbolExtractor for RegexSymbolExtractor {
    fn extract(&self, path: &Path, source: &str) -> Vec<(String, String, usize, String)> {
        let ext = path.extension().and_then(|s| s.to_str()).unwrap_or("");
        let pattern = match ext {
            "rs" => {
                r"(?m)^\s*(?:pub\s+)?(?:async\s+)?(fn|struct|enum|trait|mod)\s+([A-Za-z_][A-Za-z0-9_]*)"
            }
            "ts" | "tsx" | "js" | "jsx" => {
                r"(?m)^\s*(?:export\s+)?(?:async\s+)?(function|class|interface|type|const)\s+([A-Za-z_$][\w$]*)"
            }
            "vue" => r"(?m)^\s*(?:async\s+)?(function|const|interface|type)\s+([A-Za-z_$][\w$]*)",
            "go" => r"(?m)^\s*(func|type)\s+(?:\([^)]*\)\s*)?([A-Za-z_][A-Za-z0-9_]*)",
            "py" => r"(?m)^\s*(def|class)\s+([A-Za-z_][A-Za-z0-9_]*)",
            _ => return Vec::new(),
        };
        let Ok(re) = Regex::new(pattern) else {
            return Vec::new();
        };
        let lines: Vec<&str> = source.lines().collect();
        re.captures_iter(source)
            .take(300)
            .filter_map(|cap| {
                let full = cap.get(0)?;
                let line = source[..full.start()]
                    .bytes()
                    .filter(|b| *b == b'\n')
                    .count()
                    + 1;
                let from = line.saturating_sub(2);
                let to = (line + 2).min(lines.len());
                Some((
                    cap.get(2)?.as_str().to_string(),
                    cap.get(1)?.as_str().to_string(),
                    line,
                    lines[from..to].join("\n"),
                ))
            })
            .collect()
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeIndexStats {
    pub scanned: usize,
    pub updated: usize,
    pub unchanged: usize,
    pub removed: usize,
    pub extractor: String,
}

fn code_extension(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_ascii_lowercase()
            .as_str(),
        "rs" | "ts" | "tsx" | "js" | "jsx" | "vue" | "go" | "py" | "java" | "sql" | "md"
    )
}

/// Incrementally indexes paths and lightweight symbols using mtime plus SHA-256.
/// This is an explicit provider boundary, not a claim of full LSP/Tree-sitter indexing.
pub fn index_workspace(
    conn: &Connection,
    workspace: &str,
    max_files: usize,
) -> Result<CodeIndexStats, String> {
    let root = fs::canonicalize(workspace).map_err(|e| format!("工作区不可用: {e}"))?;
    let root_s = root.to_string_lossy().to_string();
    let extractor = RegexSymbolExtractor;
    let mut seen = HashSet::new();
    let mut scanned = 0;
    let mut updated = 0;
    let mut unchanged = 0;
    for entry in WalkBuilder::new(&root)
        .hidden(false)
        .git_ignore(true)
        .build()
        .flatten()
    {
        if scanned >= max_files.clamp(1, 20_000) {
            break;
        }
        let path = entry.path();
        if !entry.file_type().is_some_and(|t| t.is_file()) || !code_extension(path) {
            continue;
        }
        let Ok(meta) = entry.metadata() else { continue };
        if meta.len() > 2_000_000 {
            continue;
        }
        scanned += 1;
        let rel = path
            .strip_prefix(&root)
            .unwrap_or(path)
            .to_string_lossy()
            .replace('\\', "/");
        seen.insert(rel.clone());
        let mtime = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);
        let old: Option<(i64, String)> = conn
            .query_row(
                "SELECT mtime_ms,content_hash FROM code_index_files WHERE workspace_root=?1 AND path=?2",
                params![root_s, rel],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        if old.as_ref().is_some_and(|(m, _)| *m == mtime) {
            unchanged += 1;
            continue;
        }
        let Ok(bytes) = fs::read(path) else { continue };
        let hash = hex::encode(Sha256::digest(&bytes));
        if old.as_ref().is_some_and(|(_, h)| h == &hash) {
            let _ = conn.execute(
                "UPDATE code_index_files SET mtime_ms=?1,indexed_at=?2 WHERE workspace_root=?3 AND path=?4",
                params![mtime, now_ms(), root_s, rel],
            );
            unchanged += 1;
            continue;
        }
        let source = String::from_utf8_lossy(&bytes);
        conn.execute(
            "DELETE FROM code_index_symbols WHERE workspace_root=?1 AND path=?2",
            params![root_s, rel],
        )
        .map_err(|e| e.to_string())?;
        for (symbol, kind, line, snippet) in extractor.extract(path, &source) {
            let id = hex::encode(Sha256::digest(
                format!("{root_s}\0{rel}\0{symbol}\0{line}").as_bytes(),
            ));
            let _ = conn.execute(
                "INSERT OR REPLACE INTO code_index_symbols(id,workspace_root,path,symbol,kind,line,snippet)
                 VALUES(?1,?2,?3,?4,?5,?6,?7)",
                params![id, root_s, rel, symbol, kind, line as i64, snippet],
            );
        }
        conn.execute(
            "INSERT OR REPLACE INTO code_index_files(workspace_root,path,mtime_ms,content_hash,language,indexed_at)
             VALUES(?1,?2,?3,?4,?5,?6)",
            params![
                root_s,
                rel,
                mtime,
                hash,
                path.extension().and_then(|s| s.to_str()).unwrap_or(""),
                now_ms()
            ],
        )
        .map_err(|e| e.to_string())?;
        updated += 1;
    }
    let mut stmt = conn
        .prepare("SELECT path FROM code_index_files WHERE workspace_root=?1")
        .map_err(|e| e.to_string())?;
    let indexed: Vec<String> = stmt
        .query_map(params![root_s], |r| r.get(0))
        .map_err(|e| e.to_string())?
        .flatten()
        .collect();
    let mut removed = 0;
    for rel in indexed {
        if seen.contains(&rel) {
            continue;
        }
        conn.execute(
            "DELETE FROM code_index_symbols WHERE workspace_root=?1 AND path=?2",
            params![root_s, rel],
        )
        .ok();
        conn.execute(
            "DELETE FROM code_index_files WHERE workspace_root=?1 AND path=?2",
            params![root_s, rel],
        )
        .ok();
        removed += 1;
    }
    Ok(CodeIndexStats {
        scanned,
        updated,
        unchanged,
        removed,
        extractor: "regex-boundary (Tree-sitter/LSP provider pending)".into(),
    })
}

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct IdeContextInput {
    #[serde(default)]
    pub open_files: Vec<String>,
    pub active_file: Option<String>,
    pub active_content: Option<String>,
    pub selection: Option<String>,
    pub cursor_line: Option<u32>,
    pub cursor_column: Option<u32>,
    #[serde(default)]
    pub diagnostics: Vec<Value>,
    pub git_diff: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextAssemblyRequest {
    pub session_id: String,
    #[serde(default)]
    pub messages: Vec<Value>,
    pub system_rules: String,
    pub brief: Option<String>,
    pub ide: Option<IdeContextInput>,
    pub workspace_root: Option<String>,
    pub project_id: Option<String>,
    pub employee_id: Option<String>,
    pub query: String,
    pub model_window: Option<usize>,
    pub reserve_output: Option<usize>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextAssemblyResult {
    pub messages: Vec<Value>,
    pub used_tokens: usize,
    pub input_budget: usize,
    pub breakdown: Value,
}

fn take_to_budget(text: &str, budget: usize) -> String {
    if desktop_db::estimate_tokens(text) as usize <= budget {
        return text.to_string();
    }
    let chars = budget.saturating_mul(3).max(80);
    text.chars().take(chars).collect()
}

fn latest_session_summaries(conn: &Connection, session_id: &str) -> String {
    let Ok(mut stmt) = conn.prepare(
        "SELECT summary_json FROM session_summaries WHERE session_id=?1 ORDER BY updated_at DESC LIMIT 4",
    ) else {
        return String::new();
    };
    let Ok(rows) = stmt.query_map(params![session_id], |r| r.get::<_, String>(0)) else {
        return String::new();
    };
    rows.flatten()
        .filter_map(|raw| serde_json::from_str::<Value>(&raw).ok())
        .filter_map(|v| v.get("summary").and_then(Value::as_str).map(str::to_string))
        .collect::<Vec<_>>()
        .join("\n\n")
}

fn recent_other_sessions(conn: &Connection, session_id: &str) -> String {
    let Ok(mut stmt) = conn.prepare(
        "SELECT s.title,m.content
         FROM chat_sessions s
         JOIN chat_messages m ON m.id=(
             SELECT id FROM chat_messages WHERE session_id=s.id AND role='user'
             ORDER BY created_at DESC LIMIT 1
         )
         WHERE s.id<>?1 AND (s.employee_id IS NULL OR s.employee_id='')
         ORDER BY s.updated_at DESC LIMIT 6",
    ) else {
        return String::new();
    };
    let Ok(rows) = stmt.query_map(params![session_id], |r| {
        Ok(format!(
            "- {}：{}",
            r.get::<_, String>(0)?,
            take_to_budget(&r.get::<_, String>(1)?, 180)
        ))
    }) else {
        return String::new();
    };
    rows.flatten().collect::<Vec<_>>().join("\n")
}

fn explained_memories(
    conn: &Connection,
    project_id: Option<&str>,
    employee_id: Option<&str>,
    query: &str,
) -> String {
    let tokens = crate::agent::memory_recall::tokenize_query(query);
    let now = now_ms();
    let mut stmt = match conn.prepare(
        "SELECT id,scope,scope_id,title,body,tags,source,version,confidence,expires_at,conflict_key,citation,reason,pinned,updated_at
         FROM memories
         WHERE (expires_at IS NULL OR expires_at>?1)
           AND (scope='global' OR (scope='project' AND scope_id=?2) OR (scope='employee' AND scope_id=?3))
         ORDER BY pinned DESC,updated_at DESC LIMIT 120",
    ) {
        Ok(v) => v,
        Err(_) => return String::new(),
    };
    let mut rows = match stmt.query(params![
        now,
        project_id.unwrap_or(""),
        employee_id.unwrap_or("")
    ]) {
        Ok(v) => v,
        Err(_) => return String::new(),
    };
    let mut scored = Vec::new();
    while let Ok(Some(r)) = rows.next() {
        let title: String = r.get(3).unwrap_or_default();
        let body: String = r.get(4).unwrap_or_default();
        let tags: String = r.get(5).unwrap_or_default();
        let pinned: i64 = r.get(13).unwrap_or_default();
        let score = crate::agent::memory_recall::score_haystack(
            &format!("{title}\n{body}\n{tags}"),
            &tokens,
            pinned != 0,
            &tags,
        );
        if score <= 0 && pinned == 0 {
            continue;
        }
        let source: String = r.get(6).unwrap_or_default();
        let version: i64 = r.get(7).unwrap_or(1);
        let confidence: f64 = r.get(8).unwrap_or(0.7);
        let citation: String = r.get(11).unwrap_or_default();
        let reason: String = r.get(12).unwrap_or_default();
        let conflict_key: Option<String> = r.get(10).unwrap_or_default();
        scored.push((
            score,
            format!(
                "- [{} v{} · 置信 {:.0}% · 命中 {}] {}：{}{}{}",
                source,
                version,
                confidence * 100.0,
                score,
                title,
                take_to_budget(&body, 350),
                if citation.is_empty() {
                    String::new()
                } else {
                    format!("；引用 {citation}")
                },
                format!(
                    "{}{}",
                    if reason.is_empty() {
                        String::new()
                    } else {
                        format!("；原因 {reason}")
                    },
                    conflict_key
                        .map(|k| format!("；冲突键 {k}"))
                        .unwrap_or_default()
                ),
            ),
        ));
    }
    scored.sort_by(|a, b| b.0.cmp(&a.0));
    scored
        .into_iter()
        .take(12)
        .map(|(_, s)| s)
        .collect::<Vec<_>>()
        .join("\n")
}

fn relevant_code(conn: &Connection, workspace: Option<&str>, query: &str) -> String {
    let Some(root) = workspace.filter(|s| !s.trim().is_empty()) else {
        return String::new();
    };
    let tokens = crate::agent::memory_recall::tokenize_query(query);
    let mut found = Vec::new();
    for token in tokens.into_iter().take(8) {
        let like = format!("%{}%", token.replace('%', "\\%").replace('_', "\\_"));
        let Ok(mut stmt) = conn.prepare(
            "SELECT path,symbol,kind,line,snippet FROM code_index_symbols
             WHERE workspace_root=?1 AND (symbol LIKE ?2 ESCAPE '\\' OR snippet LIKE ?2 ESCAPE '\\')
             LIMIT 8",
        ) else {
            continue;
        };
        let Ok(rows) = stmt.query_map(params![root, like], |r| {
            Ok(format!(
                "{}:{} [{} {}]\n{}",
                r.get::<_, String>(0)?,
                r.get::<_, i64>(3)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(4)?
            ))
        }) else {
            continue;
        };
        for row in rows.flatten() {
            if !found.contains(&row) {
                found.push(row);
            }
        }
    }
    found.into_iter().take(16).collect::<Vec<_>>().join("\n\n")
}

/// Assembles model input by explicit source priority and token budget.
/// Dependency: session summaries, IDE snapshot, incremental code index and memory metadata.
/// Failure: returns a database error; caller should show fouAlert through the shared error handler.
pub fn assemble_context(
    conn: &Connection,
    req: ContextAssemblyRequest,
) -> Result<ContextAssemblyResult, String> {
    let window = req
        .model_window
        .unwrap_or(DEFAULT_WINDOW)
        .clamp(4_096, 1_000_000);
    let reserve = req
        .reserve_output
        .unwrap_or(DEFAULT_OUTPUT_RESERVE)
        .min(window / 2);
    let budget = window.saturating_sub(reserve);
    let mut used = 0usize;
    let mut sections = Vec::new();
    let mut breakdown = serde_json::Map::new();
    let sources: Vec<(&str, String, usize)> = vec![
        ("systemRules", req.system_rules, budget * 30 / 100),
        ("brief", req.brief.unwrap_or_default(), budget * 10 / 100),
        (
            "sessionSummary",
            latest_session_summaries(conn, &req.session_id),
            budget * 12 / 100,
        ),
        (
            "recentSessions",
            recent_other_sessions(conn, &req.session_id),
            budget * 6 / 100,
        ),
        (
            "ideState",
            req.ide
                .as_ref()
                .map(|v| serde_json::to_string_pretty(v).unwrap_or_default())
                .unwrap_or_default(),
            budget * 15 / 100,
        ),
        (
            "relevantCode",
            relevant_code(conn, req.workspace_root.as_deref(), &req.query),
            budget * 12 / 100,
        ),
        (
            "memory",
            explained_memories(
                conn,
                req.project_id.as_deref(),
                req.employee_id.as_deref(),
                &req.query,
            ),
            budget * 12 / 100,
        ),
    ];
    for (name, raw, cap) in sources {
        if raw.trim().is_empty() || used >= budget {
            breakdown.insert(name.into(), json!(0));
            continue;
        }
        let text = take_to_budget(&raw, cap.min(budget - used));
        let tok = desktop_db::estimate_tokens(&text) as usize;
        if tok > 0 {
            sections.push(format!("【{}】\n{}", name, text));
            used += tok;
        }
        breakdown.insert(name.into(), json!(tok));
    }
    let mut selected = Vec::new();
    let mut history_tokens = 0usize;
    for (index, mut message) in req.messages.into_iter().rev().enumerate() {
        let mut tok = desktop_db::estimate_tokens(&message.to_string()) as usize;
        if index == 0 && used + tok > budget {
            let remaining = budget.saturating_sub(used).max(64);
            if let Some(content) = message.get("content").and_then(Value::as_str) {
                message["content"] = json!(take_to_budget(content, remaining));
                tok = desktop_db::estimate_tokens(&message.to_string()) as usize;
            }
        }
        if used + history_tokens + tok > budget {
            continue;
        }
        history_tokens += tok;
        selected.push(message);
    }
    selected.reverse();
    breakdown.insert("recentConversation".into(), json!(history_tokens));
    used += history_tokens;
    let mut messages = vec![json!({
        "role": "system",
        "content": sections.join("\n\n")
    })];
    messages.extend(selected);
    Ok(ContextAssemblyResult {
        messages,
        used_tokens: used,
        input_budget: budget,
        breakdown: Value::Object(breakdown),
    })
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRunView {
    pub id: String,
    pub session_id: String,
    pub status: String,
    pub model: String,
    pub error: Option<String>,
    pub started_at: i64,
    pub updated_at: i64,
    pub finished_at: Option<i64>,
}

fn list_runs(
    conn: &Connection,
    session_id: Option<&str>,
    limit: i64,
) -> Result<Vec<AgentRunView>, String> {
    let sql = if session_id.is_some() {
        "SELECT id,session_id,status,model,error,started_at,updated_at,finished_at
         FROM agent_runs WHERE session_id=?1 ORDER BY started_at DESC LIMIT ?2"
    } else {
        "SELECT id,session_id,status,model,error,started_at,updated_at,finished_at
         FROM agent_runs ORDER BY started_at DESC LIMIT ?2"
    };
    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    let map = |r: &rusqlite::Row<'_>| {
        Ok(AgentRunView {
            id: r.get(0)?,
            session_id: r.get(1)?,
            status: r.get(2)?,
            model: r.get(3)?,
            error: r.get(4)?,
            started_at: r.get(5)?,
            updated_at: r.get(6)?,
            finished_at: r.get(7)?,
        })
    };
    let rows = if let Some(sid) = session_id {
        stmt.query_map(params![sid, limit.clamp(1, 200)], map)
    } else {
        stmt.query_map(params![Option::<String>::None, limit.clamp(1, 200)], map)
    }
    .map_err(|e| e.to_string())?;
    Ok(rows.flatten().collect())
}

/// Searches chat bodies. UI errors must be presented with fouAlert.
#[tauri::command]
pub fn xu_search_chat_messages(
    db: State<'_, FouDb>,
    query: String,
    limit: Option<i64>,
) -> Result<Vec<ChatSearchHit>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    search_chat_messages(&conn, &query, limit.unwrap_or(30))
}

/// Builds the complete budgeted model context for one chat turn.
#[tauri::command]
pub fn xu_assemble_context(
    db: State<'_, FouDb>,
    request: ContextAssemblyRequest,
) -> Result<ContextAssemblyResult, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    assemble_context(&conn, request)
}

/// Updates the lightweight incremental code index for one workspace.
#[tauri::command]
pub fn xu_index_workspace_context(
    db: State<'_, FouDb>,
    workspace_root: String,
    max_files: Option<usize>,
) -> Result<CodeIndexStats, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    index_workspace(&conn, &workspace_root, max_files.unwrap_or(5_000))
}

/// Lists durable runs for diagnostics and recovery UI.
#[tauri::command]
pub fn xu_list_agent_runs(
    db: State<'_, FouDb>,
    session_id: Option<String>,
    limit: Option<i64>,
) -> Result<Vec<AgentRunView>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    list_runs(&conn, session_id.as_deref(), limit.unwrap_or(50))
}

/// Returns the latest checkpoint plus steps/tools/approvals needed to resume a run.
#[tauri::command]
pub fn xu_get_agent_run_recovery(db: State<'_, FouDb>, run_id: String) -> Result<Value, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let run = list_runs(&conn, None, 200)?
        .into_iter()
        .find(|r| r.id == run_id)
        .ok_or_else(|| "运行记录不存在".to_string())?;
    let checkpoint: Option<String> = conn
        .query_row(
            "SELECT state_json FROM checkpoints WHERE run_id=?1 ORDER BY step_ordinal DESC LIMIT 1",
            params![run_id],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let rows = |table: &str| -> Result<Vec<Value>, String> {
        let sql = match table {
            "steps" => "SELECT json_object('id',id,'ordinal',ordinal,'kind',kind,'status',status,'input',input_json,'output',output_json,'error',error) FROM run_steps WHERE run_id=?1 ORDER BY ordinal",
            "tools" => "SELECT json_object('id',id,'stepId',step_id,'name',name,'arguments',arguments_json,'output',output,'status',status,'error',error) FROM tool_calls WHERE run_id=?1 ORDER BY started_at",
            _ => "SELECT json_object('id',id,'toolCallId',tool_call_id,'status',status,'reason',reason) FROM approvals WHERE run_id=?1 ORDER BY requested_at",
        };
        let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![run_id], |r| r.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        Ok(rows
            .flatten()
            .filter_map(|s| serde_json::from_str(&s).ok())
            .collect())
    };
    let checkpoint = checkpoint
        .and_then(|s| serde_json::from_str::<Value>(&s).ok())
        .ok_or_else(|| "运行缺少可恢复检查点".to_string())?;
    let recovery_context = checkpoint
        .get("recoveryContext")
        .cloned()
        .ok_or_else(|| "检查点缺少恢复上下文".to_string())?;
    validate_recovery_context(&recovery_context)?;
    Ok(json!({
        "run": run,
        "checkpoint": checkpoint,
        "recoveryContext": recovery_context,
        "steps": rows("steps")?,
        "toolCalls": rows("tools")?,
        "approvals": rows("approvals")?,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
             CREATE TABLE chat_sessions(id TEXT PRIMARY KEY,title TEXT,employee_id TEXT,created_at INTEGER,updated_at INTEGER,model TEXT);
             CREATE TABLE chat_messages(id TEXT PRIMARY KEY,session_id TEXT,role TEXT,content TEXT,tool_name TEXT,tool_call_id TEXT,created_at INTEGER);
             CREATE TABLE memories(id TEXT PRIMARY KEY,scope TEXT,scope_id TEXT,title TEXT,body TEXT,tags TEXT,source TEXT,pinned INTEGER,created_at INTEGER,updated_at INTEGER);",
        )
        .unwrap();
        migrate(&conn).unwrap();
        conn
    }

    #[test]
    fn schema_and_run_persistence_round_trip() {
        let conn = db();
        start_run(
            &conn,
            "r1",
            "s1",
            "m",
            None,
            None,
            &[json!({"role":"user","content":"x"})],
        )
        .unwrap();
        let step = start_step(&conn, "r1", 1, "llm", &json!({"round":1}));
        start_tool(&conn, "r1", Some(&step), "c1", "read_file", "{}");
        finish_tool(&conn, "c1", "completed", "ok", None);
        finish_step(&conn, &step, "completed", &json!({"ok":true}), None);
        finish_run(&conn, "r1", "completed", None);
        let status: String = conn
            .query_row("SELECT status FROM agent_runs WHERE id='r1'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(status, "completed");
        assert_eq!(list_runs(&conn, None, 10).unwrap().len(), 1);
    }

    #[test]
    fn search_has_fts_or_like_fallback() {
        let conn = db();
        conn.execute(
            "INSERT INTO chat_sessions VALUES('s1','测试',NULL,1,1,'m')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO chat_messages VALUES('m1','s1','user','跨会话正文搜索',NULL,NULL,1)",
            [],
        )
        .unwrap();
        let hits = search_chat_messages(&conn, "正文搜索", 10).unwrap();
        assert_eq!(hits[0].session_id, "s1");
        assert!(matches!(hits[0].backend.as_str(), "fts5" | "like"));
    }

    #[test]
    fn search_falls_back_when_fts_is_unavailable() {
        let conn = db();
        conn.execute_batch(
            "DROP TRIGGER IF EXISTS chat_messages_fts_ai;
             DROP TRIGGER IF EXISTS chat_messages_fts_ad;
             DROP TRIGGER IF EXISTS chat_messages_fts_au;
             DROP TABLE IF EXISTS chat_messages_fts;",
        )
        .unwrap();
        conn.execute(
            "INSERT INTO chat_sessions VALUES('s2','兼容',NULL,1,1,'m')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO chat_messages VALUES('m2','s2','user','可靠兼容搜索路径',NULL,NULL,1)",
            [],
        )
        .unwrap();
        let hits = search_chat_messages(&conn, "兼容搜索", 10).unwrap();
        assert_eq!(hits[0].backend, "like");
    }

    #[test]
    fn context_budget_and_summary_isolation() {
        let conn = db();
        save_session_summary(&conn, "a", "manual", "只属于 A 的摘要", 8).unwrap();
        save_session_summary(&conn, "b", "manual", "只属于 B 的摘要", 8).unwrap();
        let out = assemble_context(
            &conn,
            ContextAssemblyRequest {
                session_id: "a".into(),
                messages: (0..100)
                    .map(|i| json!({"role":"user","content":format!("{i} {}", "x".repeat(200))}))
                    .collect(),
                system_rules: "rules".into(),
                brief: None,
                ide: None,
                workspace_root: None,
                project_id: None,
                employee_id: None,
                query: "test".into(),
                model_window: Some(4096),
                reserve_output: Some(1024),
            },
        )
        .unwrap();
        assert!(out.used_tokens <= out.input_budget);
        let blob = out.messages[0].to_string();
        assert!(blob.contains("只属于 A"));
        assert!(!blob.contains("只属于 B"));
        assert!(out.messages.last().unwrap().to_string().contains("99"));
    }

    #[test]
    fn memory_metadata_migrates_with_defaults() {
        let conn = db();
        conn.execute(
            "INSERT INTO memories(id,scope,scope_id,title,body,tags,source,pinned,created_at,updated_at)
             VALUES('m','global',NULL,'t','b','[]','manual',0,1,1)",
            [],
        )
        .unwrap();
        let (version, confidence): (i64, f64) = conn
            .query_row(
                "SELECT version,confidence FROM memories WHERE id='m'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(version, 1);
        assert!(confidence > 0.0);
    }

    #[test]
    fn checkpoint_requires_and_restores_complete_policy_context() {
        let conn = db();
        let context = json!({
            "projectId": "project-1",
            "toolPolicy": { "readFiles": true, "writeFiles": false },
            "snapshotBatch": "batch-1",
            "plan": [{ "step": "inspect", "status": "completed" }]
        });
        start_run_with_context(
            &conn,
            "r-policy",
            "s-policy",
            "m",
            Some("project-1"),
            None,
            &[json!({"role":"user","content":"x"})],
            &context,
        )
        .unwrap();
        let raw: String = conn
            .query_row(
                "SELECT state_json FROM checkpoints WHERE run_id='r-policy'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let saved: Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(saved["recoveryContext"]["projectId"], "project-1");
        assert_eq!(saved["recoveryContext"]["snapshotBatch"], "batch-1");
        assert!(saved["recoveryContext"]["toolPolicy"].is_object());
        assert!(saved["recoveryContext"]["plan"].is_array());
        assert!(start_run_with_context(
            &conn,
            "bad",
            "s",
            "m",
            None,
            None,
            &[],
            &json!({"projectId": null, "toolPolicy": {}, "snapshotBatch": "b", "plan": []}),
        )
        .is_err());
    }

    #[test]
    fn start_run_rolls_back_when_initial_checkpoint_fails() {
        let conn = db();
        conn.execute(
            "CREATE TRIGGER fail_initial_checkpoint BEFORE INSERT ON checkpoints
             BEGIN SELECT RAISE(ABORT, 'injected checkpoint failure'); END",
            [],
        )
        .unwrap();
        let result = start_run(&conn, "rollback", "s", "m", None, None, &[]);
        assert!(result.is_err());
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM agent_runs WHERE id='rollback'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn duplicate_run_id_does_not_overwrite_existing_run() {
        let conn = db();
        start_run(&conn, "same", "first", "model-a", None, None, &[]).unwrap();
        assert!(start_run(&conn, "same", "second", "model-b", None, None, &[]).is_err());
        let stored: (String, String) = conn
            .query_row(
                "SELECT session_id,model FROM agent_runs WHERE id='same'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(stored, ("first".into(), "model-a".into()));
    }
}
