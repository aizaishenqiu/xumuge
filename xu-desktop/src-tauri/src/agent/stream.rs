//! Xu Native Agent loop: OpenAI-compatible chat + optional workspace tools.
//!
//! @author qiuye <yjk150@qq.com>
//! @date 2026-08-30
//! @updated 2026-08-31
//! @version 1.1.0
//! @category AgentLoop
//! @algo run-id-compare-and-remove

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::agent::events::emit_agent_event;
use crate::agent::ide_release::ReleaseEvidence;
use crate::agent::memory_extract; // maybe_extract_memory_async / write_session_summary_memory
use crate::agent::prefs::{apply_exec_policy, AgentPrefs, AgentPrefsState};
use crate::agent::sanitize::{extract_tool_calls_from_content, parse_tool_arguments};
use crate::agent::snapshots;
use crate::agent::tool_policy::{
    is_canvas_sketch_mutate_tool, is_canvas_tool, project_policy_allows, ProjectToolPolicy,
};
use crate::agent::tools::{
    execute_tool_mode, openai_tool_defs_with_mcp, parse_view_image_marker, PathSandbox, ToolMode,
};
use crate::commands::activity_log::{log_bulk_read_decision, log_file_change, log_halt};
use crate::commands::security_audit::audit_tool_event;
use crate::desktop_db::FouDb;
use crate::StreamChunk;

tokio::task_local! {
    static STREAM_RUN_ID: String;
}

/// Codex-style turn budget (was 8; raised for long employee tasks).
const MAX_TOOL_ROUNDS: usize = 12;

fn user_facing_llm_status(round: usize) -> &'static str {
    if round == 0 {
        "正在思考…"
    } else {
        "继续处理…"
    }
}
/// Context window limit (tokens). Remote and local share the same cap.
const MAX_CTX: usize = 200_000;
/// Keep this many newest messages after compaction (plus system + trim notice).
const COMPACT_KEEP_TAIL: usize = 8;
/// Max path bookmarks kept in the trim notice.
const COMPACT_BOOKMARK_MAX: usize = 12;

#[derive(Default)]
pub(crate) struct SessionBulkReadState {
    unique_paths: HashSet<String>,
    total_bytes: usize,
    glob_hits: usize,
    /// User chose「继续」for this session.
    override_allowed: bool,
}

fn default_bulk_file_threshold(local_llm: bool, prefs: &AgentPrefs) -> usize {
    let base = prefs.bulk_read_file_threshold.max(1);
    if local_llm {
        base.saturating_mul(2)
    } else {
        base
    }
}

fn default_bulk_bytes_threshold(local_llm: bool, prefs: &AgentPrefs) -> usize {
    let base = prefs.bulk_read_bytes_threshold.max(64 * 1024);
    if local_llm {
        base.saturating_mul(2)
    } else {
        base
    }
}

/// Returns human-readable reason when bulk-read guard should prompt the user.
fn check_bulk_read_before_tool(
    runtime: &AgentRuntime,
    session_id: &str,
    name: &str,
    args: &Value,
    local_llm: bool,
    prefs: &AgentPrefs,
) -> Option<String> {
    if !prefs.bulk_read_warn_enabled {
        return None;
    }
    let file_cap = default_bulk_file_threshold(local_llm, prefs);
    let byte_cap = default_bulk_bytes_threshold(local_llm, prefs);
    let mut sessions = runtime.bulk_read_sessions.lock().ok()?;
    let st = sessions
        .entry(session_id.to_string())
        .or_insert_with(SessionBulkReadState::default);
    if st.override_allowed {
        return None;
    }
    if name == "glob_file_search" {
        let pattern = args
            .get("glob_pattern")
            .or_else(|| args.get("pattern"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim();
        if pattern.contains("**") && (pattern == "**/*" || pattern.ends_with("/**/*")) {
            return Some(format!(
                "检测到可能扫描整个项目（glob: {pattern}）。远程模型可能上传大量源码，是否停止使用？"
            ));
        }
    }
    if name == "read_file" {
        let path = args
            .get("path")
            .or_else(|| args.get("target_file"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim();
        if !path.is_empty() {
            st.unique_paths.insert(path.to_string());
        }
    }
    if st.unique_paths.len() > file_cap {
        return Some(format!(
            "本会话已读取 {} 个文件（阈值 {}），疑似上传整个项目到{}模型。是否停止使用？",
            st.unique_paths.len(),
            file_cap,
            if local_llm { "本地" } else { "远程" }
        ));
    }
    if st.total_bytes > byte_cap {
        let mb = st.total_bytes / (1024 * 1024);
        return Some(format!(
            "本会话已向模型发送约 {mb} MB 文件内容（阈值 {} MB）。是否停止使用？",
            byte_cap / (1024 * 1024)
        ));
    }
    None
}

fn record_bulk_read_output(runtime: &AgentRuntime, session_id: &str, name: &str, output: &str) {
    if !matches!(
        name,
        "read_file" | "glob_file_search" | "grep_search" | "list_dir"
    ) {
        return;
    }
    if let Ok(mut sessions) = runtime.bulk_read_sessions.lock() {
        if let Some(st) = sessions.get_mut(session_id) {
            st.total_bytes = st.total_bytes.saturating_add(output.len());
            if name == "glob_file_search" {
                let hits = output.matches('\n').count().saturating_add(1);
                st.glob_hits = st.glob_hits.saturating_add(hits);
            }
        }
    }
}

fn set_bulk_read_override(runtime: &AgentRuntime, session_id: &str) {
    if let Ok(mut sessions) = runtime.bulk_read_sessions.lock() {
        let st = sessions
            .entry(session_id.to_string())
            .or_insert_with(SessionBulkReadState::default);
        st.override_allowed = true;
    }
}

fn resolve_employee_role_slug(db: &FouDb, employee_id: &str) -> Option<String> {
    let eid = employee_id.trim();
    if eid.is_empty() {
        return None;
    }
    let conn = db.0.lock().ok()?;
    let employees = crate::desktop_db::list_employees(&conn).ok()?;
    employees
        .iter()
        .find(|e| e.id == eid)
        .map(|e| e.role.trim().to_string())
        .filter(|r| !r.is_empty())
}

fn run_agent_tool(
    app: &AppHandle,
    sb: &PathSandbox,
    opts: &AgentRunOpts,
    session_id: &str,
    name: &str,
    args: &Value,
) -> String {
    if !project_policy_allows(&opts.project_tool_policy, name) {
        audit_tool_event(
            "tool_denied",
            name,
            Some(session_id),
            opts.project_id.as_deref(),
            opts.employee_id.as_deref(),
            "项目未授权此工具",
            "denied",
        );
        if is_canvas_tool(name) {
            return "画板工具不可用：请打开 Canvas 页面确认工作区；设置里没有单独的 Canvas 权限开关。".into();
        }
        if opts.require_canvas_write
            && matches!(
                name,
                "write_file" | "patch_file" | "apply_patch" | "mkdir" | "delete_file"
            )
        {
            return "户型/草图请用 canvas_add_strokes（或 canvas_write_sketch）写入画板，不要用 write_file；设置里没有 Canvas 权限开关。".into();
        }
        return "项目未授权此工具（请在项目设置中勾选对应权限）".into();
    }
    if matches!(name, "ide_open" | "vscode_open") {
        let surface_owned = opts
            .code_editor_surface
            .clone()
            .or_else(|| std::env::var("XU_CODING_SURFACE").ok())
            .unwrap_or_else(|| "builtin".into());
        if surface_owned == "builtin" {
            let path_raw = args.get("path").and_then(|v| v.as_str()).unwrap_or("");
            if path_raw.trim().is_empty() {
                return "缺少 path".into();
            }
            let line = args
                .get("line")
                .and_then(|v| v.as_u64())
                .unwrap_or(1)
                .max(1);
            let resolved = match sb.resolve_read(path_raw) {
                Ok(p) => p,
                Err(e) => return e,
            };
            let rel = resolved
                .strip_prefix(&sb.workspace)
                .map(|p| p.to_string_lossy().into_owned())
                .unwrap_or_else(|_| path_raw.to_string());
            let emit_path = resolved.display().to_string();
            let _ = app.emit(
                "xu:open-in-editor",
                json!({ "path": emit_path, "line": line }),
            );
            return format!("已在应用内编辑器打开 {rel}:{line}");
        }
    }
    let mcp_db = app.try_state::<FouDb>();
    let mut output = execute_tool_mode(
        sb,
        opts.tool_mode,
        name,
        args,
        Some(&opts.usage_source),
        mcp_db.as_deref(),
    );
    if matches!(name, "ide_open" | "vscode_open") {
        if let Some(db) = mcp_db.as_ref() {
            if crate::commands::cursor_sdk::cursor_sdk_tool_allowed(
                db,
                project_policy_allows(&opts.project_tool_policy, name),
            ) {
                output.push_str("\n提示：Cursor SDK 已就绪，可用 cursor_sdk_prompt 委托 Agent 在本机工作区执行任务。");
            }
        }
    }
    let outcome = if output.contains("失败") || output.contains("错误") || output.contains("禁止")
    {
        "error"
    } else {
        "ok"
    };
    let audit_kind = if name == "shell_exec" {
        "shell_exec"
    } else {
        "tool_execute"
    };
    if name == "shell_exec"
        || matches!(
            name,
            "write_file" | "patch_file" | "apply_patch" | "delete_file"
        )
        || name.starts_with("mcp__")
    {
        audit_tool_event(
            audit_kind,
            name,
            Some(session_id),
            opts.project_id.as_deref(),
            opts.employee_id.as_deref(),
            &args.to_string().chars().take(500).collect::<String>(),
            outcome,
        );
    }
    if outcome == "ok"
        && matches!(
            name,
            "write_file" | "patch_file" | "apply_patch" | "delete_file"
        )
    {
        let path = args
            .get("path")
            .or_else(|| args.get("target_file"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim();
        if !path.is_empty() {
            log_file_change(
                session_id,
                opts.project_id.as_deref(),
                opts.employee_id.as_deref(),
                name,
                path,
            );
        }
    }
    output
}

#[derive(Clone)]
struct CancelRun {
    run_id: String,
    flag: Arc<AtomicBool>,
}

pub struct AgentRuntime {
    pub cancels: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
    stream_cancels: Arc<Mutex<HashMap<String, CancelRun>>>,
    stream_starting: Arc<Mutex<HashSet<String>>>,
    /// Max concurrent employee agent tasks (queue). Keep small so work is ordered.
    /// Mutex so `xu_set_employee_slots` can replace the semaphore.
    pub employee_slots: Arc<Mutex<Arc<tokio::sync::Semaphore>>>,
    /// Per-project in-flight cap (default 2).
    pub per_project_limit: Arc<AtomicUsize>,
    /// In-flight employee tasks keyed by project id.
    pub project_inflight: Arc<Mutex<HashMap<String, usize>>>,
    /// Parallel HTTP calls to local LLM — sized from host_capacity auto probe.
    pub local_llm_slots: Arc<Mutex<Arc<tokio::sync::Semaphore>>>,
    /// Simultaneous remote-API employee streams (UI bound; not VRAM).
    pub remote_slots: Arc<Mutex<Arc<tokio::sync::Semaphore>>>,
    /// When true, remote API skips remote_slots (local still limited).
    pub remote_unlimited: Arc<AtomicBool>,
    /// Pending tool approvals: key = `{session_id}:{call_id}` → oneshot allow/deny.
    pub approvals: Arc<Mutex<HashMap<String, tokio::sync::oneshot::Sender<bool>>>>,
    /// Per-session read volume for bulk-upload warning.
    pub(crate) bulk_read_sessions: Arc<Mutex<HashMap<String, SessionBulkReadState>>>,
    /// Boss GUI grants scoped to exact `{session_id}:{project_id}` pairs.
    pub boss_grants: Arc<Mutex<HashSet<String>>>,
}

/// Holds global/local or remote semaphore permit + per-project count until dropped.
pub struct EmployeeSlotGuard {
    _permit: Option<tokio::sync::OwnedSemaphorePermit>,
    project_id: Option<String>,
    project_inflight: Arc<Mutex<HashMap<String, usize>>>,
}

impl Drop for EmployeeSlotGuard {
    fn drop(&mut self) {
        if self._permit.is_none() {
            return;
        }
        if let Some(pid) = self.project_id.as_ref() {
            if let Ok(mut map) = self.project_inflight.lock() {
                if let Some(n) = map.get_mut(pid) {
                    *n = n.saturating_sub(1);
                    if *n == 0 {
                        map.remove(pid);
                    }
                }
            }
        }
    }
}

impl Clone for AgentRuntime {
    fn clone(&self) -> Self {
        Self {
            cancels: Arc::clone(&self.cancels),
            stream_cancels: Arc::clone(&self.stream_cancels),
            stream_starting: Arc::clone(&self.stream_starting),
            employee_slots: Arc::clone(&self.employee_slots),
            per_project_limit: Arc::clone(&self.per_project_limit),
            project_inflight: Arc::clone(&self.project_inflight),
            local_llm_slots: Arc::clone(&self.local_llm_slots),
            remote_slots: Arc::clone(&self.remote_slots),
            remote_unlimited: Arc::clone(&self.remote_unlimited),
            approvals: Arc::clone(&self.approvals),
            bulk_read_sessions: Arc::clone(&self.bulk_read_sessions),
            boss_grants: Arc::clone(&self.boss_grants),
        }
    }
}

impl AgentRuntime {
    pub fn new() -> Self {
        Self {
            cancels: Arc::new(Mutex::new(HashMap::new())),
            stream_cancels: Arc::new(Mutex::new(HashMap::new())),
            stream_starting: Arc::new(Mutex::new(HashSet::new())),
            employee_slots: Arc::new(Mutex::new(Arc::new(tokio::sync::Semaphore::new(2)))),
            per_project_limit: Arc::new(AtomicUsize::new(2)),
            project_inflight: Arc::new(Mutex::new(HashMap::new())),
            local_llm_slots: Arc::new(Mutex::new(Arc::new(tokio::sync::Semaphore::new(1)))),
            remote_slots: Arc::new(Mutex::new(Arc::new(tokio::sync::Semaphore::new(2)))),
            remote_unlimited: Arc::new(AtomicBool::new(false)),
            approvals: Arc::new(Mutex::new(HashMap::new())),
            bulk_read_sessions: Arc::new(Mutex::new(HashMap::new())),
            boss_grants: Arc::new(Mutex::new(HashSet::new())),
        }
    }

    /// Wait for a local (VRAM) or remote (UI stream) slot. Remote unlimited
    /// skips only the remote semaphore; local employees always wait.
    pub async fn acquire_employee_permit(
        &self,
        project_id: Option<&str>,
        local_llm: bool,
    ) -> Result<EmployeeSlotGuard, String> {
        let skip_limit = !local_llm && self.remote_unlimited.load(Ordering::Relaxed);
        if skip_limit {
            return Ok(EmployeeSlotGuard {
                _permit: None,
                project_id: None,
                project_inflight: Arc::clone(&self.project_inflight),
            });
        }
        loop {
            if let Some(pid) = project_id {
                loop {
                    let over = {
                        let map = self.project_inflight.lock().map_err(|e| e.to_string())?;
                        let limit = self.per_project_limit.load(Ordering::Relaxed).max(1);
                        map.get(pid).copied().unwrap_or(0) >= limit
                    };
                    if !over {
                        break;
                    }
                    tokio::time::sleep(Duration::from_millis(200)).await;
                }
            }

            let sem = {
                let g = if local_llm {
                    self.employee_slots.lock().map_err(|e| e.to_string())?
                } else {
                    self.remote_slots.lock().map_err(|e| e.to_string())?
                };
                Arc::clone(&*g)
            };
            let permit = sem
                .acquire_owned()
                .await
                .map_err(|_| "员工并发槽已关闭".to_string())?;

            if let Some(pid) = project_id {
                let retry = {
                    let mut map = self.project_inflight.lock().map_err(|e| e.to_string())?;
                    let limit = self.per_project_limit.load(Ordering::Relaxed).max(1);
                    let cur = map.get(pid).copied().unwrap_or(0);
                    if cur >= limit {
                        true
                    } else {
                        *map.entry(pid.to_string()).or_insert(0) += 1;
                        false
                    }
                };
                if retry {
                    drop(permit);
                    tokio::time::sleep(Duration::from_millis(200)).await;
                    continue;
                }
            }

            return Ok(EmployeeSlotGuard {
                _permit: Some(permit),
                project_id: project_id.map(|s| s.to_string()),
                project_inflight: Arc::clone(&self.project_inflight),
            });
        }
    }
}

/// Reserves a session while its durable run is being created.
struct StreamStartGuard {
    session_id: String,
    starting: Arc<Mutex<HashSet<String>>>,
    armed: bool,
}

impl Drop for StreamStartGuard {
    fn drop(&mut self) {
        if self.armed {
            if let Ok(mut starting) = self.starting.lock() {
                starting.remove(&self.session_id);
            }
        }
    }
}

/// Removes only the exact run published by this command, including early returns and panics.
struct StreamRunGuard {
    session_id: String,
    run_id: String,
    runs: Arc<Mutex<HashMap<String, CancelRun>>>,
}

impl Drop for StreamRunGuard {
    fn drop(&mut self) {
        if let Ok(mut runs) = self.runs.lock() {
            if runs
                .get(&self.session_id)
                .is_some_and(|entry| entry.run_id == self.run_id)
            {
                runs.remove(&self.session_id);
            }
        }
    }
}

impl AgentRuntime {
    fn reserve_stream_session(&self, session_id: &str) -> Result<StreamStartGuard, String> {
        if self
            .stream_cancels
            .lock()
            .map_err(|e| e.to_string())?
            .contains_key(session_id)
        {
            return Err("该会话已有运行中的任务，请先取消或等待完成".into());
        }
        let mut starting = self.stream_starting.lock().map_err(|e| e.to_string())?;
        if !starting.insert(session_id.to_string()) {
            return Err("该会话正在启动另一项任务，请稍后重试".into());
        }
        drop(starting);
        Ok(StreamStartGuard {
            session_id: session_id.to_string(),
            starting: Arc::clone(&self.stream_starting),
            armed: true,
        })
    }

    fn publish_stream_run(
        &self,
        mut start: StreamStartGuard,
        session_id: &str,
        run_id: &str,
        flag: Arc<AtomicBool>,
    ) -> Result<StreamRunGuard, String> {
        let mut runs = self.stream_cancels.lock().map_err(|e| e.to_string())?;
        if runs.contains_key(session_id) {
            return Err("该会话已有运行中的任务，请先取消或等待完成".into());
        }
        runs.insert(
            session_id.to_string(),
            CancelRun {
                run_id: run_id.to_string(),
                flag,
            },
        );
        drop(runs);
        if let Ok(mut starting) = start.starting.lock() {
            starting.remove(session_id);
            start.armed = false;
        }
        Ok(StreamRunGuard {
            session_id: session_id.to_string(),
            run_id: run_id.to_string(),
            runs: Arc::clone(&self.stream_cancels),
        })
    }
}

fn tool_needs_approval(name: &str) -> bool {
    if name.starts_with("mcp__") {
        return true;
    }
    matches!(
        name,
        "write_file"
            | "mkdir"
            | "patch_file"
            | "apply_patch"
            | "delete_file"
            | "undo_last_changes"
            | "office_write_docx"
            | "office_write_xlsx"
            | "office_write_pptx"
            | "office_docx_replace"
            | "office_edit_xlsx_cells"
            | "office_apply_template"
            | "office_open"
            | "shell_exec"
            | "clipboard_set"
            | "open_program"
            | "ide_open"
            | "vscode_open"
            | "vscode_save"
            | "vscode_reload_window"
            | "browser_open"
            | "browser_click"
            | "browser_type"
            | "run_ui_acceptance"
            | "dispatch_defect_fix"
            | "app_launch"
            | "input_click"
            | "input_type"
    )
}

fn scoped_grant_key(session_id: &str, project_id: Option<&str>) -> String {
    format!(
        "{}:{}",
        session_id.trim(),
        project_id.unwrap_or("unscoped").trim()
    )
}

/// Boss 已派活：文本/办公落盘免二次审批（shell/开程序/删文件/git 写仍要批）。
fn tool_needs_approval_for(opts: &AgentRunOpts, name: &str, args: &Value) -> bool {
    if name.starts_with("mcp__") {
        return true;
    }
    if matches!(
        name,
        "open_program"
            | "app_launch"
            | "input_click"
            | "input_type"
            | "ui_click_element"
            | "ui_focus_window"
            | "gui_record_start"
            | "gui_record_stop"
            | "gui_replay"
    ) {
        return true;
    }
    if opts.im_inbound {
        return tool_needs_approval(name)
            || (name == "git"
                && matches!(
                    args.get("action")
                        .and_then(|v| v.as_str())
                        .unwrap_or("status")
                        .to_ascii_lowercase()
                        .as_str(),
                    "add" | "commit" | "checkout" | "reset" | "push" | "pull" | "merge"
                ));
    }
    if !opts.require_approval {
        return false;
    }
    if opts.boss_granted_session
        && matches!(
            name,
            "screenshot_window"
                | "browser_open"
                | "browser_screenshot"
                | "browser_click"
                | "browser_fill"
                | "browser_evaluate"
        )
    {
        return false;
    }
    if name == "git" {
        let action = args
            .get("action")
            .and_then(|v| v.as_str())
            .unwrap_or("status")
            .to_ascii_lowercase();
        return matches!(
            action.as_str(),
            "add" | "commit" | "checkout" | "reset" | "push" | "pull"
        );
    }
    let land = must_land_files(opts);
    if land
        && matches!(
            name,
            "write_file"
                | "mkdir"
                | "patch_file"
                | "apply_patch"
                | "office_write_docx"
                | "office_write_xlsx"
                | "office_write_pptx"
                | "office_docx_replace"
                | "office_edit_xlsx_cells"
                | "office_apply_template"
                | "ide_open"
                | "vscode_open"
                | "office_open"
        )
    {
        return false;
    }
    tool_needs_approval(name)
}

fn tool_is_parallel_safe(name: &str) -> bool {
    matches!(
        name,
        "list_dir"
            | "read_file"
            | "glob_file_search"
            | "grep_search"
            | "office_read_xlsx"
            | "office_read_xlsx_range"
            | "office_read_docx"
            | "clipboard_get"
            | "view_image"
            | "git"
    )
}

fn must_land_files(opts: &AgentRunOpts) -> bool {
    opts.tool_mode == ToolMode::Full
        && (opts.usage_source.contains("kickoff") || opts.usage_source.contains("implement"))
}

fn content_claims_files(s: &str) -> bool {
    let lower = s.to_lowercase();
    lower.contains(".docx")
        || lower.contains(".xlsx")
        || lower.contains(".pdf")
        || lower.contains(".pptx")
        || s.contains("已创建")
        || s.contains("已写入")
        || s.contains("已生成")
        || s.contains("写入了")
        || s.contains("落盘到")
        || (s.contains("文件") && (s.contains("完成") || s.contains("交付")))
}

pub(crate) fn is_local_llm(base_url: &str) -> bool {
    let u = base_url.to_lowercase();
    u.contains("11434")
        || u.contains("ollama")
        || u.contains("localhost")
        || u.contains("127.0.0.1")
        || u.contains("0.0.0.0")
}

/// Only show「等待空闲」when the slot is actually contended; then switch to「正在调用」.
async fn acquire_local_llm_permit(
    app: &AppHandle,
    session_id: &str,
    employee_id: Option<&str>,
    slots: &Arc<tokio::sync::Semaphore>,
) -> Result<tokio::sync::OwnedSemaphorePermit, String> {
    match Arc::clone(slots).try_acquire_owned() {
        Ok(permit) => {
            if let Some(eid) = employee_id {
                crate::employee::events::emit_employee_event(
                    app,
                    eid,
                    "working",
                    "llm",
                    "正在调用本地模型…",
                );
            }
            Ok(permit)
        }
        Err(_) => {
            if let Some(eid) = employee_id {
                crate::employee::events::emit_employee_event(
                    app,
                    eid,
                    "working",
                    "llm_wait",
                    "等待本地模型空闲…",
                );
            }
            emit_chunk(app, session_id, "status", "等待本地模型槽位");
            let permit = Arc::clone(slots)
                .acquire_owned()
                .await
                .map_err(|_| "本地 LLM 并发槽已关闭".to_string())?;
            if let Some(eid) = employee_id {
                crate::employee::events::emit_employee_event(
                    app,
                    eid,
                    "working",
                    "llm",
                    "正在调用本地模型…",
                );
            }
            emit_chunk(app, session_id, "status", "已获得本地模型槽位");
            Ok(permit)
        }
    }
}

fn format_llm_request_error(base_url: &str, err: &impl std::fmt::Display) -> String {
    let e = err.to_string();
    let local = is_local_llm(base_url);
    let net = e.contains("error sending request")
        || e.contains("connection refused")
        || e.contains("tcp connect error")
        || e.contains("os error 10061")
        || e.contains("ConnectError")
        || e.contains("timed out")
        || e.contains("timeout")
        || e.contains("dns error")
        || e.contains("Failed to connect")
        || e.contains("network unreachable")
        || e.contains("No such host")
        || e.contains("name resolution");
    if local && net {
        return format!(
            "本地模型连不上。请确认：① Ollama 已启动（ollama serve）；② 已 pull 所用模型；③ 设置里本地地址正确。也可把工作脑改为远程 API。"
        );
    }
    if net {
        return format!(
            "远程模型网络不通（可能断网、代理异常或厂商服务不可达）。请检查本机网络后重试；仍失败请到设置 → 模型对该预设点「测通」。"
        );
    }
    format!("请求模型失败：{e}")
}

/// Enrich LLM HTTP failures so UI shows which endpoint/model actually failed.
fn format_llm_http_error(
    base_url: &str,
    model: &str,
    status: reqwest::StatusCode,
    body: &str,
) -> String {
    let snippet: String = body.chars().take(280).collect();
    let snippet_l = snippet.to_lowercase();
    let local = is_local_llm(base_url);
    let where_ = if local { "本地模型" } else { "远程模型" };
    let model_s = if model.trim().is_empty() {
        "（未指定模型）".to_string()
    } else {
        model.trim().to_string()
    };

    let unpaid = snippet_l.contains("insufficient")
        || snippet_l.contains("balance")
        || snippet_l.contains("quota")
        || snippet_l.contains("billing")
        || snippet_l.contains("arrears")
        || snippet.contains("欠费")
        || snippet.contains("余额不足")
        || snippet.contains("额度不足")
        || snippet.contains("可用额度");

    if unpaid || status.as_u16() == 402 {
        return format!(
            "{where_}调用失败：疑似 API 欠费或额度不足（HTTP {status}）· 模型 {model_s}。请到对应厂商控制台充值或更换可用 Key，再到设置 → 模型测通。"
        );
    }
    match status.as_u16() {
        401 | 403 => {
            return format!(
                "{where_}鉴权失败（HTTP {status}）· 模型 {model_s}。常见原因：API Key 错误、过期或权限不足。请到设置 → 模型检查 Key 后测通。"
            );
        }
        404 => {
            return format!(
                "{where_}找不到接口或模型（HTTP 404）· 模型 {model_s}。请确认 Base URL 与模型名是否与厂商文档一致。"
            );
        }
        429 => {
            return format!(
                "{where_}请求过于频繁或触发限流（HTTP 429）· 模型 {model_s}。请稍后再试，或降低并发。"
            );
        }
        500..=599 => {
            if snippet.contains("Upstream gateway error") || snippet_l.contains("upstream") {
                return format!(
                    "上游网关错误（HTTP {status}）· {where_} · 模型 {model_s}。常见原因：中转不稳定、额度不足。建议换官方直连或切本地模型。"
                );
            }
            return format!(
                "{where_}服务端异常（HTTP {status}）· 模型 {model_s}。多为厂商侧故障，请稍后重试。"
            );
        }
        _ => {}
    }

    if snippet.contains("Upstream gateway error") || snippet_l.contains("upstream") {
        return format!(
            "上游网关错误（HTTP {status}）· {where_} · 模型 {model_s}。常见原因：中转不稳定、额度不足。建议换官方直连或切本地模型。"
        );
    }
    format!("{where_}调用失败（HTTP {status}）· 模型 {model_s}：{snippet}")
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentEndpoint {
    pub provider: String,
    pub model: String,
    pub base_url: String,
    pub api_key_env: String,
    #[serde(default = "default_api_format")]
    pub api_format: String,
    /// Catalog / remote preset id for billing attribution
    #[serde(default)]
    pub preset_id: String,
}

fn default_api_format() -> String {
    "openai".into()
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentMessage {
    pub role: String,
    pub content: String,
    /// Optional image data-URLs for vision / multimodal models.
    #[serde(default)]
    pub images: Option<Vec<String>>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRunRequest {
    pub session_id: String,
    pub run_id: String,
    pub endpoint: AgentEndpoint,
    pub messages: Vec<AgentMessage>,
    #[serde(default)]
    pub workspace_root: Option<String>,
    #[serde(default)]
    pub read_extra_paths: Option<Vec<String>>,
    #[serde(default)]
    pub enable_tools: Option<bool>,
    /// `readonly` = list/read tools only; default `full`.
    #[serde(default)]
    pub tool_mode: Option<String>,
    /// Preferred IDE CLI name or alias (cursor/vscode/trae/qoder).
    #[serde(default)]
    pub ide_cli: Option<String>,
    /// `builtin` | `external` — how ide_open behaves.
    #[serde(default)]
    pub code_editor_surface: Option<String>,
    /// Chat: nudge model to call write_file when user asked to modify files.
    #[serde(default)]
    pub require_write: Option<bool>,
    /// Chat/Canvas: nudge model to call canvas sketch mutate tools (not write_file).
    #[serde(default)]
    pub require_canvas_write: Option<bool>,
    #[serde(default)]
    pub project_id: Option<String>,
    #[serde(default)]
    pub project_tool_policy: Option<ProjectToolPolicy>,
    #[serde(default)]
    pub memory_scope: Option<String>,
    #[serde(default)]
    pub memory_scope_id: Option<String>,
    #[serde(default)]
    pub memory_task_hint: Option<String>,
    /// Experimental fail-closed IDE completion gate. Defaults off for gradual rollout.
    #[serde(default)]
    pub release_gate: Option<bool>,
    /// Soft cap for completion length (OpenAI `max_tokens`). Voice turns use a small value.
    #[serde(default)]
    pub max_tokens: Option<u32>,
    /// Disable model "thinking" (Qwen3/Ollama): `reasoning_effort=none` + think=false.
    #[serde(default)]
    pub disable_thinking: Option<bool>,
    /// Skip post-turn memory extract (another LLM round) — voice must return ASAP.
    #[serde(default)]
    pub skip_memory_extract: Option<bool>,
}

#[derive(Clone)]
pub struct AgentRunOpts {
    pub workspace_root: Option<PathBuf>,
    pub read_extra_paths: Vec<PathBuf>,
    pub enable_tools: bool,
    pub tool_mode: ToolMode,
    pub employee_id: Option<String>,
    pub usage_source: String,
    /// When true, high-risk tools wait for xu_agent_approve_tool.
    pub require_approval: bool,
    /// When true, skip per-tool approval for GUI/browser within rules.
    pub boss_granted_session: bool,
    /// Preferred IDE CLI (cursor/code/trae/qoder); else XU_IDE_CLI / cursor.
    pub ide_cli: Option<String>,
    /// `builtin` opens in-app editor; `external` spawns IDE CLI.
    pub code_editor_surface: Option<String>,
    /// Apply global exec policy / stream / compact prefs from settings.
    pub apply_global_prefs: bool,
    /// Snapshot batch id for undo_last_changes.
    pub snapshot_batch: Option<String>,
    /// When true, agent loop nudges for write_file if none ran (chat write intent).
    pub require_write: bool,
    /// When true, agent loop nudges for canvas sketch mutate tools (Canvas / 户型意图).
    pub require_canvas_write: bool,
    pub project_id: Option<String>,
    pub project_tool_policy: Option<ProjectToolPolicy>,
    pub memory_scope: Option<String>,
    pub memory_scope_id: Option<String>,
    pub memory_task_hint: Option<String>,
    pub release_gate: bool,
    /// Feishu/WeCom inbound: write/shell always need approval (no kickoff skip).
    pub im_inbound: bool,
    pub max_tokens: Option<u32>,
    pub disable_thinking: bool,
}

impl Default for AgentRunOpts {
    fn default() -> Self {
        Self {
            workspace_root: None,
            read_extra_paths: Vec::new(),
            enable_tools: false,
            tool_mode: ToolMode::Full,
            employee_id: None,
            usage_source: "chat".into(),
            require_approval: false,
            ide_cli: None,
            code_editor_surface: None,
            boss_granted_session: false,
            apply_global_prefs: false,
            snapshot_batch: None,
            require_write: false,
            require_canvas_write: false,
            project_id: None,
            project_tool_policy: None,
            memory_scope: None,
            memory_scope_id: None,
            memory_task_hint: None,
            release_gate: false,
            im_inbound: false,
            max_tokens: None,
            disable_thinking: false,
        }
    }
}

/// Emit a stream chunk under the current command task's run id.
/// Dependency: `STREAM_RUN_ID` is scoped by `xu_agent_stream`; emit failure is intentionally ignored.
pub fn emit_chunk(app: &AppHandle, session_id: &str, kind: &str, content: &str) {
    let run_id = STREAM_RUN_ID.try_with(Clone::clone).unwrap_or_default();
    let _ = app.emit(
        "xu:chunk",
        StreamChunk {
            kind: kind.into(),
            content: content.into(),
            session_id: session_id.into(),
            run_id,
        },
    );
}

fn current_stream_run_id() -> String {
    STREAM_RUN_ID.try_with(Clone::clone).unwrap_or_default()
}

fn persist_round_checkpoint(
    app: &AppHandle,
    round: usize,
    messages: &[Value],
    opts: &AgentRunOpts,
    plan: &Option<Value>,
    evidence: &ReleaseEvidence,
) {
    let run_id = current_stream_run_id();
    if run_id.is_empty() {
        return;
    }
    if let Some(db) = app.try_state::<FouDb>() {
        if let Ok(conn) = db.0.lock() {
            let _ = crate::context_memory::checkpoint(
                &conn,
                &run_id,
                round + 1,
                &json!({
                    "messages": messages,
                    "phase": "round_complete",
                    "recoveryContext": {
                        "projectId": opts.project_id.clone().unwrap_or_else(|| "unscoped".into()),
                        "toolPolicy": opts.project_tool_policy.clone().unwrap_or_else(ProjectToolPolicy::conservative),
                        "snapshotBatch": opts.snapshot_batch.clone().unwrap_or_else(|| format!("{run_id}:recovered")),
                        "plan": plan.clone().unwrap_or_else(|| json!([])),
                        "releaseGate": opts.release_gate,
                        "releaseEvidence": evidence
                    }
                }),
            );
        }
    }
}

fn estimate_message_tokens(messages: &[Value]) -> usize {
    messages
        .iter()
        .map(|m| {
            let blob = message_content_blob(m);
            crate::desktop_db::estimate_tokens(&blob) as usize
        })
        .sum()
}

fn message_content_blob(m: &Value) -> String {
    m.get("content")
        .and_then(|c| c.as_str().map(|s| s.to_string()))
        .unwrap_or_else(|| m.to_string())
}

fn estimate_ctx_breakdown(messages: &[Value]) -> (usize, Value) {
    let mut system_prompt = 0usize;
    let mut tools = 0usize;
    let mut chat_messages = 0usize;
    let mut connectors_mcp = 0usize;
    let mut skills = 0usize;

    for m in messages {
        let role = m.get("role").and_then(|r| r.as_str()).unwrap_or("");
        let blob = message_content_blob(m);
        let tok = crate::desktop_db::estimate_tokens(&blob) as usize;
        match role {
            "system" => {
                if blob.contains("Skill")
                    || blob.contains(".cursor/skills")
                    || blob.contains("技能")
                    || blob.contains("SKILL.md")
                {
                    skills += tok;
                } else {
                    system_prompt += tok;
                }
            }
            "tool" => {
                if blob.contains("mcp__") || blob.to_ascii_lowercase().contains("mcp ") {
                    connectors_mcp += tok;
                } else {
                    tools += tok;
                }
            }
            "assistant" => {
                if m.get("tool_calls").is_some() {
                    tools += tok;
                } else {
                    chat_messages += tok;
                }
            }
            _ => chat_messages += tok,
        }
    }
    let used = system_prompt + tools + chat_messages + connectors_mcp + skills;
    let breakdown = json!({
        "systemPrompt": system_prompt,
        "tools": tools,
        "messages": chat_messages,
        "connectorsMcp": connectors_mcp,
        "skills": skills,
    });
    (used, breakdown)
}

fn emit_ctx_stat(app: &AppHandle, session_id: &str, messages: &[Value], max: usize) {
    let payload_obj = context_usage_from_messages(messages, max);
    let payload = payload_obj.to_string();
    emit_chunk(app, session_id, "ctx_stat", &payload);
    if let Some(db) = app.try_state::<crate::desktop_db::FouDb>() {
        if let Ok(conn) = db.0.lock() {
            let key = format!("ctx_stat:{session_id}");
            let _ = crate::desktop_db::setting_set(&conn, &key, &payload);
        }
    }
}

pub fn context_usage_from_messages(messages: &[Value], max: usize) -> Value {
    let (used, breakdown) = estimate_ctx_breakdown(messages);
    let pct = if max == 0 {
        0
    } else {
        ((used as f64 / max as f64) * 100.0).round() as u32
    };
    json!({
        "used": used,
        "max": max,
        "pct": pct,
        "breakdown": breakdown,
    })
}

pub fn context_usage_for_session_messages(messages: &[Value]) -> Value {
    context_usage_from_messages(messages, MAX_CTX)
}

/// Estimate context window usage from an OpenAI-style message list.
#[tauri::command]
pub fn xu_agent_context_usage(messages: Vec<Value>) -> Result<Value, String> {
    Ok(context_usage_from_messages(&messages, MAX_CTX))
}

/// Pull likely file paths from dropped history (deterministic, no LLM).
fn extract_path_bookmarks(blob: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let re = regex::Regex::new(
        r#"(?i)(?:[A-Za-z]:\\[^\s"'`<>|]{3,160}|/(?:Users|home|var|tmp|opt|mnt)/[^\s"'`<>|]{3,160}|[\w./\\-]{3,120}\.(?:rs|ts|tsx|vue|js|jsx|py|go|java|md|json|toml|yaml|yml|css|html|sql))"#,
    )
    .ok();
    let Some(re) = re else {
        return out;
    };
    for cap in re.find_iter(blob) {
        let p = cap
            .as_str()
            .trim_matches(|c| matches!(c, '"' | '\'' | '`' | ',' | ';'));
        if p.len() < 4 {
            continue;
        }
        if !out.iter().any(|x| x == p) {
            out.push(p.to_string());
        }
        if out.len() >= COMPACT_BOOKMARK_MAX {
            break;
        }
    }
    out
}

/// Built-in context compression for both local and remote: drop middle history,
/// keep system + recent tail, inject a short deterministic notice (paths only).
/// Never calls an API / model for summarization.
/// Returns (tokens_before, tokens_after, dropped_count, summary_for_memory).
fn compact_context_builtin(messages: &mut Vec<Value>) -> Option<(usize, usize, usize, String)> {
    if messages.len() <= COMPACT_KEEP_TAIL + 2 {
        return None;
    }
    let tokens_before = estimate_message_tokens(messages);
    let system_idx = messages
        .iter()
        .position(|m| m.get("role").and_then(|r| r.as_str()) == Some("system"));
    let system = system_idx.and_then(|i| messages.get(i).cloned());
    let body_start = system_idx.map(|i| i + 1).unwrap_or(0);
    let keep_from = messages
        .len()
        .saturating_sub(COMPACT_KEEP_TAIL)
        .max(body_start);
    if keep_from <= body_start {
        return None;
    }
    let dropped = keep_from - body_start;
    let middle_blob: String = messages[body_start..keep_from]
        .iter()
        .map(|m| {
            m.get("content")
                .map(|c| match c {
                    Value::String(s) => s.clone(),
                    other => other.to_string(),
                })
                .unwrap_or_default()
        })
        .collect::<Vec<_>>()
        .join("\n");
    let bookmarks = extract_path_bookmarks(&middle_blob);
    let bookmark_line = if bookmarks.is_empty() {
        String::new()
    } else {
        format!("\n曾出现路径（供续写参考）：\n- {}", bookmarks.join("\n- "))
    };

    let memory_summary: String = {
        let clipped: String = middle_blob.chars().take(900).collect();
        format!("压缩丢弃 {dropped} 条中间回合。{bookmark_line}\n要点摘录：\n{clipped}")
    };

    let tail: Vec<Value> = messages[keep_from..].to_vec();
    let mut next = Vec::new();
    if let Some(sys) = system {
        next.push(sys);
    }
    next.push(json!({
        "role": "user",
        "content": format!(
            "【上下文已内置压缩】已丢弃中间约 {dropped} 条历史（未调用模型摘要），仅保留最近回合。请根据最近工具结果继续，勿重复已完成步骤。{bookmark_line}"
        )
    }));
    next.push(json!({
        "role": "assistant",
        "content": "明白，按最近回合继续。"
    }));
    next.extend(tail);
    *messages = next;
    let tokens_after = estimate_message_tokens(messages);
    Some((tokens_before, tokens_after, dropped, memory_summary))
}

async fn compact_context_llm(
    client: &reqwest::Client,
    url: &str,
    api_key: &str,
    model: &str,
    messages: &mut Vec<Value>,
) -> Option<(usize, usize, usize, String)> {
    if messages.len() <= COMPACT_KEEP_TAIL + 2 {
        return None;
    }
    let tokens_before = estimate_message_tokens(messages);
    let system_idx = messages
        .iter()
        .position(|m| m.get("role").and_then(|r| r.as_str()) == Some("system"));
    let system = system_idx.and_then(|i| messages.get(i).cloned());
    let body_start = system_idx.map(|i| i + 1).unwrap_or(0);
    let keep_from = messages
        .len()
        .saturating_sub(COMPACT_KEEP_TAIL)
        .max(body_start);
    if keep_from <= body_start {
        return None;
    }
    let dropped = keep_from - body_start;
    let middle_blob: String = messages[body_start..keep_from]
        .iter()
        .map(|m| {
            m.get("content")
                .map(|c| match c {
                    Value::String(s) => s.clone(),
                    other => other.to_string(),
                })
                .unwrap_or_default()
        })
        .collect::<Vec<_>>()
        .join("\n")
        .chars()
        .take(6000)
        .collect();
    let summary_body = json!({
        "model": model,
        "messages": [
            {"role": "system", "content": "你是上下文压缩助手。用简体中文要点总结对话历史，保留文件路径、决策与未完成事项。不超过 400 字。"},
            {"role": "user", "content": middle_blob}
        ],
        "stream": false,
        "temperature": 0.2
    });
    let summary =
        match invoke_chat_completions_json(client, url, api_key, &summary_body, model).await {
            Ok(t) => t.content.trim().to_string(),
            Err(_) => String::new(),
        };
    let bookmarks = extract_path_bookmarks(&middle_blob);
    let bookmark_line = if bookmarks.is_empty() {
        String::new()
    } else {
        format!("\n路径：\n- {}", bookmarks.join("\n- "))
    };
    let tail: Vec<Value> = messages[keep_from..].to_vec();
    let mut next = Vec::new();
    if let Some(sys) = system {
        next.push(sys);
    }
    let summary_text = if summary.is_empty() {
        format!("【上下文已压缩】丢弃中间 {dropped} 条。{bookmark_line}")
    } else {
        format!("【上下文 LLM 摘要】\n{summary}{bookmark_line}")
    };
    let memory_summary = if summary.is_empty() {
        format!(
            "{summary_text}\n{}",
            middle_blob.chars().take(600).collect::<String>()
        )
    } else {
        format!("{summary}{bookmark_line}")
    };
    next.push(json!({"role": "user", "content": summary_text}));
    next.push(json!({"role": "assistant", "content": "明白，按摘要与最近回合继续。"}));
    next.extend(tail);
    *messages = next;
    let tokens_after = estimate_message_tokens(messages);
    Some((tokens_before, tokens_after, dropped, memory_summary))
}

fn resolve_api_key_with_db(app: &AppHandle, api_key_env: &str) -> Result<String, String> {
    if let Some(db) = app.try_state::<FouDb>() {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        return crate::desktop_db::resolve_api_key(api_key_env, Some(&conn));
    }
    crate::desktop_db::resolve_api_key(api_key_env, None)
}

pub fn chat_completions_url(base_url: &str) -> Result<String, String> {
    let b = base_url.trim().trim_end_matches('/');
    if b.is_empty() {
        return Err("未配置模型 baseUrl".into());
    }
    if b.ends_with("/chat/completions") {
        return Ok(b.to_string());
    }
    if b.ends_with("/v1") {
        return Ok(format!("{b}/chat/completions"));
    }
    Ok(format!("{b}/v1/chat/completions"))
}

#[derive(Deserialize)]
struct CompletionResponse {
    choices: Option<Vec<CompletionChoice>>,
    usage: Option<CompletionUsage>,
}

#[derive(Deserialize, Default)]
struct PromptTokenDetails {
    #[serde(default)]
    cached_tokens: Option<u64>,
}

#[derive(Deserialize)]
struct CompletionUsage {
    prompt_tokens: Option<u64>,
    completion_tokens: Option<u64>,
    total_tokens: Option<u64>,
    #[serde(default)]
    prompt_tokens_details: Option<PromptTokenDetails>,
    #[serde(default)]
    cache_read_input_tokens: Option<u64>,
    #[serde(default)]
    cache_creation_input_tokens: Option<u64>,
}

fn cached_tokens_from_usage(u: &CompletionUsage) -> u64 {
    if let Some(d) = &u.prompt_tokens_details {
        if let Some(c) = d.cached_tokens {
            return c;
        }
    }
    u.cache_read_input_tokens
        .or(u.cache_creation_input_tokens)
        .unwrap_or(0)
}

fn record_llm_turn_usage(
    app: &AppHandle,
    session_id: &str,
    endpoint: &AgentEndpoint,
    opts: &AgentRunOpts,
    usage: &CompletionUsage,
) -> Result<(), String> {
    let prompt = usage.prompt_tokens.unwrap_or(0);
    let completion = usage.completion_tokens.unwrap_or_else(|| {
        usage
            .total_tokens
            .unwrap_or(0)
            .saturating_sub(usage.prompt_tokens.unwrap_or(0))
    });
    if prompt == 0 && completion == 0 {
        return Ok(());
    }
    let cached = cached_tokens_from_usage(usage);
    let preset_id = {
        let p = endpoint.preset_id.trim();
        if p.is_empty() {
            if endpoint.api_key_env.trim().is_empty() {
                "local".to_string()
            } else {
                endpoint.model.trim().to_string()
            }
        } else {
            p.to_string()
        }
    };
    let Some(db) = app.try_state::<crate::desktop_db::FouDb>() else {
        return Ok(());
    };
    let Ok(conn) = db.0.lock() else {
        return Ok(());
    };
    let rec = crate::desktop_db::TokenUsageRecord {
        session_id: Some(session_id.to_string()),
        employee_id: opts.employee_id.clone(),
        source: opts.usage_source.clone(),
        prompt_tokens: prompt,
        completion_tokens: completion,
        cached_tokens: cached,
        model: Some(endpoint.model.clone()),
        preset_id,
        provider: endpoint.provider.clone(),
    };
    match crate::desktop_db::record_token_usage_detail(&conn, rec) {
        Ok(st) => {
            if st.hard_hit || st.soft_hit {
                emit_chunk(app, session_id, "status", &st.message);
            }
            let _ = app.emit(
                "xu:billing-updated",
                serde_json::json!({ "sessionId": session_id }),
            );
            Ok(())
        }
        Err(msg) => {
            emit_chunk(app, session_id, "error", &msg);
            emit_agent_event(app, session_id, opts.employee_id.as_deref(), "error", &msg, None, None);
            Err(msg)
        }
    }
}

#[derive(Deserialize)]
struct CompletionChoice {
    message: Option<CompletionMessage>,
    finish_reason: Option<String>,
}

#[derive(Deserialize)]
struct CompletionMessage {
    #[allow(dead_code)]
    role: Option<String>,
    content: Option<String>,
    /// DeepSeek-R1 / Qwen thinking / OpenAI-compat reasoning field
    #[serde(default)]
    reasoning_content: Option<String>,
    #[serde(default)]
    reasoning: Option<String>,
    tool_calls: Option<Vec<ToolCall>>,
}

#[derive(Deserialize, Clone)]
struct ToolCall {
    id: Option<String>,
    #[serde(rename = "type")]
    type_: Option<String>,
    function: Option<ToolFn>,
}

#[derive(Deserialize, Clone)]
struct ToolFn {
    name: Option<String>,
    arguments: Option<String>,
}

struct LlmTurn {
    content: String,
    reasoning: String,
    tool_calls: Vec<ToolCall>,
    finish_reason: Option<String>,
    usage: Option<CompletionUsage>,
    think_streamed: bool,
    answer_streamed: bool,
}

/// Incrementally split streamed `content` deltas into think vs answer (Qwen3 ``, etc.).
struct ContentThinkParser {
    buffer: String,
    in_think: bool,
    think_streamed: bool,
    think_started: bool,
    answer_streamed: bool,
}

impl ContentThinkParser {
    fn mark_think_streamed(&mut self) {
        self.think_streamed = true;
    }
    fn new() -> Self {
        Self {
            buffer: String::new(),
            in_think: false,
            think_streamed: false,
            think_started: false,
            answer_streamed: false,
        }
    }

    fn emit_answer(&mut self, app: &AppHandle, session_id: &str, text: &str) {
        if text.is_empty() {
            return;
        }
        emit_chunk(app, session_id, "token", text);
        self.answer_streamed = true;
    }

    fn feed(&mut self, app: &AppHandle, session_id: &str, delta: &str) {
        if delta.is_empty() {
            return;
        }
        self.buffer.push_str(delta);
        self.drain(app, session_id);
    }

    fn drain(&mut self, app: &AppHandle, session_id: &str) {
        loop {
            if self.in_think {
                if let Some((pos, close_len)) = find_think_close_tag(&self.buffer) {
                    let inner = self.buffer[..pos].to_string();
                    if !inner.is_empty() {
                        self.emit_think(app, session_id, &inner);
                    }
                    self.buffer = self.buffer[pos + close_len..].to_string();
                    self.in_think = false;
                    if self.think_started {
                        emit_chunk(app, session_id, "think_end", "");
                        self.think_started = false;
                    }
                } else {
                    let keep = partial_tag_suffix_len(&self.buffer, THINK_CLOSE_TAGS);
                    let emit_len = self.buffer.len().saturating_sub(keep);
                    if emit_len == 0 {
                        break;
                    }
                    let part = self.buffer[..emit_len].to_string();
                    self.buffer = self.buffer[emit_len..].to_string();
                    self.emit_think(app, session_id, &part);
                    break;
                }
            } else if let Some((start, open_len)) = find_think_open_tag(&self.buffer) {
                let answer = self.buffer[..start].to_string();
                if !answer.is_empty() {
                    self.emit_answer(app, session_id, &answer);
                }
                self.buffer = self.buffer[start + open_len..].to_string();
                self.in_think = true;
                if !self.think_started {
                    emit_chunk(app, session_id, "think_start", "");
                    self.think_started = true;
                }
            } else {
                let keep = partial_tag_suffix_len(&self.buffer, THINK_OPEN_TAGS);
                let emit_len = self.buffer.len().saturating_sub(keep);
                if emit_len == 0 {
                    break;
                }
                let part = self.buffer[..emit_len].to_string();
                self.buffer = self.buffer[emit_len..].to_string();
                self.emit_answer(app, session_id, &part);
                break;
            }
        }
    }

    fn emit_think(&mut self, app: &AppHandle, session_id: &str, text: &str) {
        if text.is_empty() {
            return;
        }
        emit_chunk(app, session_id, "think", text);
        self.think_streamed = true;
    }

    fn finish(&mut self, app: &AppHandle, session_id: &str) {
        if !self.buffer.is_empty() {
            if self.in_think {
                let tail = self.buffer.clone();
                self.buffer.clear();
                self.emit_think(app, session_id, &tail);
            } else {
                let tail = self.buffer.clone();
                self.buffer.clear();
                self.emit_answer(app, session_id, &tail);
            }
        }
        if self.think_started {
            emit_chunk(app, session_id, "think_end", "");
            self.think_started = false;
        }
    }
}

const QWEN_THINK_OPEN: &str = concat!("<", "think", ">");
const QWEN_THINK_CLOSE: &str = concat!("<", "/", "think", ">");
const THINK_OPEN_TAGS: &[&str] = &["<think>", QWEN_THINK_OPEN, "《思考》"];
const THINK_CLOSE_TAGS: &[&str] = &["</think>", QWEN_THINK_CLOSE, "《/思考》"];

fn find_think_open_tag(buf: &str) -> Option<(usize, usize)> {
    let lower = buf.to_ascii_lowercase();
    let mut best: Option<(usize, usize)> = None;
    for tag in THINK_OPEN_TAGS {
        if let Some(pos) = lower.find(&tag.to_ascii_lowercase()) {
            if best.map(|(p, _)| pos < p).unwrap_or(true) {
                best = Some((pos, tag.len()));
            }
        }
    }
    best
}

fn find_think_close_tag(buf: &str) -> Option<(usize, usize)> {
    let lower = buf.to_ascii_lowercase();
    let mut best: Option<(usize, usize)> = None;
    for tag in THINK_CLOSE_TAGS {
        if let Some(pos) = lower.find(&tag.to_ascii_lowercase()) {
            if best.map(|(p, _)| pos < p).unwrap_or(true) {
                best = Some((pos, tag.len()));
            }
        }
    }
    best
}

fn partial_tag_suffix_len(buf: &str, tags: &[&str]) -> usize {
    let mut max_keep = 0usize;
    for tag in tags {
        let boundaries: Vec<usize> = tag.char_indices().map(|(i, _)| i).collect();
        for i in boundaries.iter().skip(1) {
            let prefix = &tag[..*i];
            if buf.ends_with(prefix) {
                max_keep = max_keep.max(prefix.len());
            }
        }
    }
    max_keep
}

fn tool_call_parallel_safe(name: &str, args: &Value) -> bool {
    if !tool_is_parallel_safe(name) {
        return false;
    }
    if name == "git" {
        let action = args
            .get("action")
            .and_then(|v| v.as_str())
            .unwrap_or("status")
            .to_ascii_lowercase();
        return matches!(action.as_str(), "status" | "diff" | "log" | "branch");
    }
    true
}

fn load_view_image_data_url(abs: &std::path::Path, mime: &str) -> Result<String, String> {
    let bytes = std::fs::read(abs).map_err(|e| format!("读图片失败: {e}"))?;
    let b64 = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &bytes);
    Ok(format!("data:{mime};base64,{b64}"))
}

async fn invoke_chat_completions(
    app: &AppHandle,
    session_id: &str,
    client: &reqwest::Client,
    url: &str,
    api_key: &str,
    body: &Value,
    use_stream: bool,
    cancel: &AtomicBool,
) -> Result<LlmTurn, String> {
    let model = body
        .get("model")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    if use_stream {
        invoke_chat_completions_stream(app, session_id, client, url, api_key, body, &model, cancel)
            .await
    } else {
        invoke_chat_completions_json(client, url, api_key, body, &model).await
    }
}

/// Public thin wrapper for lightweight JSON completions (memory extract, etc.).
pub async fn invoke_chat_completions_text(
    client: &reqwest::Client,
    url: &str,
    api_key: &str,
    body: &Value,
) -> Result<String, String> {
    let model = body.get("model").and_then(|v| v.as_str()).unwrap_or("");
    let turn = invoke_chat_completions_json(client, url, api_key, body, model).await?;
    Ok(turn.content)
}

async fn invoke_chat_completions_json(
    client: &reqwest::Client,
    url: &str,
    api_key: &str,
    body: &Value,
    model: &str,
) -> Result<LlmTurn, String> {
    let mut body = body.clone();
    body["stream"] = json!(false);
    let resp = client
        .post(url)
        .header("Authorization", format!("Bearer {api_key}"))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = resp.status();
    let resp_text = resp.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        let base = url
            .trim_end_matches("/chat/completions")
            .trim_end_matches("/v1/chat/completions");
        return Err(format_llm_http_error(base, model, status, &resp_text));
    }
    let parsed: CompletionResponse =
        serde_json::from_str(&resp_text).map_err(|e| format!("解析 LLM 响应失败: {e}"))?;
    let choice = parsed
        .choices
        .and_then(|mut c| c.pop())
        .ok_or_else(|| "LLM 无 choices".to_string())?;
    let message = choice.message.ok_or_else(|| "LLM 无 message".to_string())?;
    Ok(LlmTurn {
        content: message.content.unwrap_or_default(),
        reasoning: message
            .reasoning_content
            .or(message.reasoning)
            .unwrap_or_default(),
        tool_calls: message.tool_calls.unwrap_or_default(),
        finish_reason: choice.finish_reason,
        usage: parsed.usage,
        think_streamed: false,
        answer_streamed: false,
    })
}

async fn invoke_chat_completions_stream(
    app: &AppHandle,
    session_id: &str,
    client: &reqwest::Client,
    url: &str,
    api_key: &str,
    body: &Value,
    model: &str,
    cancel: &AtomicBool,
) -> Result<LlmTurn, String> {
    use futures_util::StreamExt;

    let mut body = body.clone();
    body["stream"] = json!(true);
    // Ollama often rejects / ignores stream_options; omit for local to keep SSE path alive.
    let local = url.contains("127.0.0.1")
        || url.contains("localhost")
        || url.contains("0.0.0.0")
        || url.contains("ollama");
    if !local && body.get("stream_options").is_none() {
        body["stream_options"] = json!({ "include_usage": true });
    } else if local {
        if let Some(obj) = body.as_object_mut() {
            obj.remove("stream_options");
        }
    }

    let resp = client
        .post(url)
        .header("Authorization", format!("Bearer {api_key}"))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = resp.status();
    if !status.is_success() {
        let resp_text = resp.text().await.unwrap_or_default();
        let base = url
            .trim_end_matches("/chat/completions")
            .trim_end_matches("/v1/chat/completions");
        return Err(format_llm_http_error(base, model, status, &resp_text));
    }

    let mut content = String::new();
    let mut reasoning = String::new();
    let mut content_parser = ContentThinkParser::new();
    let mut tool_acc: HashMap<usize, (String, String, String)> = HashMap::new();
    let mut finish_reason: Option<String> = None;
    let mut usage: Option<CompletionUsage> = None;
    let mut buf = String::new();

    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        if cancel.load(Ordering::Relaxed) {
            return Err("已取消".into());
        }
        let chunk = chunk.map_err(|e| format!("SSE 读失败: {e}"))?;
        buf.push_str(&String::from_utf8_lossy(&chunk));
        while let Some(pos) = buf.find('\n') {
            let line = buf[..pos].trim_end_matches('\r').to_string();
            buf.drain(..=pos);
            let line = line.trim();
            if line.is_empty() {
                continue;
            }
            let Some(data) = line.strip_prefix("data:") else {
                continue;
            };
            let data = data.trim();
            if data == "[DONE]" {
                continue;
            }
            let Ok(v) = serde_json::from_str::<Value>(data) else {
                continue;
            };
            if let Some(u) = v.get("usage") {
                usage = serde_json::from_value(u.clone()).ok();
            }
            let Some(choices) = v.get("choices").and_then(|c| c.as_array()) else {
                continue;
            };
            let Some(ch0) = choices.first() else {
                continue;
            };
            if let Some(fr) = ch0.get("finish_reason").and_then(|x| x.as_str()) {
                if fr != "null" {
                    finish_reason = Some(fr.to_string());
                }
            }
            let delta = ch0.get("delta").cloned().unwrap_or(json!({}));
            if let Some(t) = delta.get("content").and_then(|x| x.as_str()) {
                if !t.is_empty() {
                    content.push_str(t);
                    content_parser.feed(app, session_id, t);
                }
            }
            if let Some(t) = delta
                .get("reasoning_content")
                .or_else(|| delta.get("reasoning"))
                .and_then(|x| x.as_str())
            {
                if !t.is_empty() {
                    reasoning.push_str(t);
                    emit_chunk(app, session_id, "think", t);
                    content_parser.mark_think_streamed();
                }
            }
            if let Some(tcs) = delta.get("tool_calls").and_then(|x| x.as_array()) {
                for tc in tcs {
                    let idx = tc.get("index").and_then(|x| x.as_u64()).unwrap_or(0) as usize;
                    let entry = tool_acc.entry(idx).or_insert_with(|| {
                        (
                            tc.get("id")
                                .and_then(|x| x.as_str())
                                .unwrap_or("")
                                .to_string(),
                            String::new(),
                            String::new(),
                        )
                    });
                    if let Some(id) = tc.get("id").and_then(|x| x.as_str()) {
                        if !id.is_empty() {
                            entry.0 = id.to_string();
                        }
                    }
                    if let Some(f) = tc.get("function") {
                        if let Some(n) = f.get("name").and_then(|x| x.as_str()) {
                            entry.1.push_str(n);
                        }
                        if let Some(a) = f.get("arguments").and_then(|x| x.as_str()) {
                            entry.2.push_str(a);
                        }
                    }
                }
            }
        }
    }

    content_parser.finish(app, session_id);
    let think_streamed = content_parser.think_streamed || !reasoning.is_empty();

    let mut idxs: Vec<_> = tool_acc.keys().copied().collect();
    idxs.sort_unstable();
    let tool_calls: Vec<ToolCall> = idxs
        .into_iter()
        .filter_map(|i| tool_acc.remove(&i))
        .filter(|(_, name, _)| !name.is_empty())
        .map(|(id, name, arguments)| ToolCall {
            id: Some(if id.is_empty() {
                format!("call_{}", name)
            } else {
                id
            }),
            type_: Some("function".into()),
            function: Some(ToolFn {
                name: Some(name),
                arguments: Some(arguments),
            }),
        })
        .collect();

    Ok(LlmTurn {
        content,
        reasoning,
        tool_calls,
        finish_reason,
        usage,
        think_streamed,
        answer_streamed: content_parser.answer_streamed,
    })
}

/// Agent loop with optional tools. Final assistant text is returned.
pub async fn run_agent_loop(
    app: &AppHandle,
    session_id: &str,
    endpoint: &AgentEndpoint,
    seed_messages: &[AgentMessage],
    opts: AgentRunOpts,
    cancel: Arc<AtomicBool>,
) -> Result<String, String> {
    let mut opts = opts;
    if let Some(rt) = app.try_state::<AgentRuntime>() {
        let grant_key = scoped_grant_key(session_id, opts.project_id.as_deref());
        opts.boss_granted_session = opts.boss_granted_session
            || rt
                .boss_grants
                .lock()
                .map(|grants| grants.contains(&grant_key))
                .unwrap_or(false);
    }
    let prefs: AgentPrefs = app
        .try_state::<AgentPrefsState>()
        .map(|s| s.get())
        .unwrap_or_default();
    if opts.apply_global_prefs {
        apply_exec_policy(&prefs.exec_policy, &mut opts);
        // 不再用 prefs.ide_release_gate_enabled OR 覆盖：该实验开关曾把日常 IDE/办公室写码硬拦死。
        // 仅当调用方显式传 release_gate=true 时才启用（见下方完成检查，现为软提示）。
    }
    if opts.snapshot_batch.is_none() {
        opts.snapshot_batch = Some(snapshots::new_batch_id(session_id));
    }
    let model = endpoint.model.trim();
    if model.is_empty() {
        return Err("未配置模型 model".into());
    }
    let api_key = resolve_api_key_with_db(app, &endpoint.api_key_env)?;
    let url = chat_completions_url(&endpoint.base_url)?;

    let sandbox = if opts.enable_tools {
        let root = opts
            .workspace_root
            .clone()
            .ok_or_else(|| "启用工具需要 workspaceRoot".to_string())?;
        {
            let mut sb = PathSandbox::with_ide_cli(
                root,
                opts.read_extra_paths.clone(),
                opts.ide_cli.clone(),
            )?;
            sb.gui_consent = PathSandbox::detect_gui_consent(&sb.workspace);
            sb.gui_experimental = PathSandbox::detect_gui_experimental(&sb.workspace);
            sb.gui_window_allowlist = PathSandbox::detect_gui_allowlist(&sb.workspace);
            if sb.gui_experimental && crate::agent::gui_record::start_real_input_monitor().is_err()
            {
                sb.gui_experimental = false;
            }
            sb.snapshot_batch = opts.snapshot_batch.clone();
            Some(sb)
        }
    } else {
        None
    };

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(300))
        .build()
        .map_err(|e| e.to_string())?;

    let mut messages: Vec<Value> = seed_messages
        .iter()
        .map(|m| {
            if let Some(imgs) = m.images.as_ref().filter(|v| !v.is_empty()) {
                let mut parts = vec![json!({ "type": "text", "text": m.content })];
                for url in imgs {
                    parts.push(json!({
                        "type": "image_url",
                        "image_url": { "url": url }
                    }));
                }
                json!({ "role": m.role, "content": parts })
            } else {
                json!({ "role": m.role, "content": m.content })
            }
        })
        .collect();

    let mut final_text = String::new();
    let mut write_count: usize = 0;
    let mut used_tools: Vec<String> = Vec::new();
    let mut latest_plan: Option<Value> = None;
    let mut release_evidence = ReleaseEvidence::default();
    let eid = opts.employee_id.as_deref();
    emit_chunk(app, session_id, "status", &format!("正在调用 {model}"));
    emit_agent_event(
        app,
        session_id,
        eid,
        "start",
        &format!("开始回合 · {model}"),
        None,
        None,
    );

    let local_llm = is_local_llm(&endpoint.base_url);
    let local_slots = if local_llm {
        let rt = app.state::<AgentRuntime>();
        let g = rt.local_llm_slots.lock().map_err(|e| e.to_string())?;
        Some(Arc::clone(&*g))
    } else {
        None
    };

    for round in 0..MAX_TOOL_ROUNDS {
        if cancel.load(Ordering::Relaxed) {
            emit_chunk(app, session_id, "error", "已取消");
            emit_agent_event(app, session_id, eid, "error", "已取消", None, None);
            return Err("已取消".into());
        }

        let est = estimate_message_tokens(&messages);
        let ctx_limit = MAX_CTX;
        let persisted_step_id = {
            let run_id = current_stream_run_id();
            if run_id.is_empty() {
                String::new()
            } else if let Some(db) = app.try_state::<FouDb>() {
                if let Ok(conn) = db.0.lock() {
                    crate::context_memory::start_step(
                        &conn,
                        &run_id,
                        round + 1,
                        "llm_tool_round",
                        &json!({ "estimatedTokens": est, "model": model }),
                    )
                } else {
                    String::new()
                }
            } else {
                String::new()
            }
        };
        emit_ctx_stat(app, session_id, &messages, ctx_limit);
        // 内置压缩；可选 LLM 摘要（设置页开关）
        if est > ctx_limit {
            let compacted = if prefs.llm_compact {
                compact_context_llm(&client, &url, &api_key, model, &mut messages).await
            } else {
                None
            };
            let compacted = compacted.or_else(|| compact_context_builtin(&mut messages));
            if let Some((before, after, dropped, mem_summary)) = compacted {
                let msg = format!(
                    "内置压缩：约 {before}→{after} tokens（丢弃中间 {dropped} 条，阈值 {ctx_limit}）"
                );
                emit_agent_event(app, session_id, eid, "context_compaction", &msg, None, None);
                emit_chunk(app, session_id, "status", &msg);
                if let Some(id) = eid {
                    crate::employee::events::emit_employee_event(
                        app,
                        id,
                        "working",
                        "context_compaction",
                        &msg,
                    );
                }
                // Persist rolling session summary so discarded turns still inform later jobs
                if let Some(db) = app.try_state::<FouDb>() {
                    if let Ok(conn) = db.0.lock() {
                        let scope = opts.memory_scope.as_deref().unwrap_or("global");
                        let scope_id = opts
                            .memory_scope_id
                            .as_deref()
                            .or(opts.project_id.as_deref())
                            .or(opts.employee_id.as_deref());
                        let hint = opts
                            .project_id
                            .as_deref()
                            .or(opts.employee_id.as_deref())
                            .unwrap_or(session_id);
                        crate::agent::memory_extract::write_session_summary_memory(
                            &conn,
                            scope,
                            scope_id,
                            &mem_summary,
                            hint,
                        );
                    }
                }
            }
        }

        let mut body = json!({
            "model": model,
            "messages": messages,
            "stream": false,
            "temperature": prefs.clamped_temperature(),
        });
        if let Some(mt) = opts.max_tokens.filter(|n| *n > 0) {
            body["max_tokens"] = json!(mt);
        }
        if opts.disable_thinking {
            // Ollama /v1 ignores top-level `think`; reasoning_effort=none is the reliable switch.
            body["reasoning_effort"] = json!("none");
            body["think"] = json!(false);
            body["chat_template_kwargs"] = json!({ "enable_thinking": false });
        }
        if sandbox.is_some() {
            let mcp_db = app.try_state::<FouDb>();
            let employee_role = mcp_db.as_ref().and_then(|db| {
                opts.employee_id
                    .as_deref()
                    .and_then(|eid| resolve_employee_role_slug(db, eid))
            });
            let include_cursor_sdk = mcp_db
                .as_ref()
                .map(|db| {
                    crate::commands::cursor_sdk::cursor_sdk_tool_allowed(
                        db,
                        project_policy_allows(&opts.project_tool_policy, "ide_open"),
                    )
                })
                .unwrap_or(false);
            body["tools"] = openai_tool_defs_with_mcp(
                opts.tool_mode,
                mcp_db.as_deref(),
                employee_role.as_deref(),
                include_cursor_sdk,
            );
            // Force a tool call until something actually lands on disk / canvas
            if (must_land_files(&opts) || opts.require_write || opts.require_canvas_write)
                && write_count == 0
                && round + 1 < MAX_TOOL_ROUNDS
            {
                body["tool_choice"] = json!("required");
            } else {
                body["tool_choice"] = json!("auto");
            }
        }

        emit_chunk(app, session_id, "status", user_facing_llm_status(round));
        emit_agent_event(
            app,
            session_id,
            eid,
            "llm_thinking",
            &format!("回合 {}/{} · 调用模型…", round + 1, MAX_TOOL_ROUNDS),
            None,
            None,
        );

        let _llm_permit = if let Some(slots) = local_slots.as_ref() {
            Some(acquire_local_llm_permit(app, session_id, eid, slots).await?)
        } else {
            None
        };

        // Remote + local Ollama: stream when enabled; local falls back to JSON on failure.
        let use_stream = if local_llm { prefs.local_stream } else { true };
        let mut turn_result = invoke_chat_completions(
            app, session_id, &client, &url, &api_key, &body, use_stream, &cancel,
        )
        .await;
        if local_llm && use_stream && turn_result.is_err() {
            emit_chunk(app, session_id, "status", "本地流式失败，回退非流式");
            turn_result = invoke_chat_completions(
                app, session_id, &client, &url, &api_key, &body, false, &cancel,
            )
            .await;
        }
        drop(_llm_permit);

        let mut turn = match turn_result {
            Ok(t) => t,
            Err(e) => {
                // Some local models reject tool_choice=required — retry once with auto
                let can_fallback = sandbox.is_some()
                    && body.get("tool_choice").and_then(|v| v.as_str()) == Some("required");
                if can_fallback {
                    body["tool_choice"] = json!("auto");
                    emit_chunk(app, session_id, "status", "tool_choice 回退为 auto");
                    let _llm_permit2 = if let Some(slots) = local_slots.as_ref() {
                        Some(acquire_local_llm_permit(app, session_id, eid, slots).await?)
                    } else {
                        None
                    };
                    let retry = invoke_chat_completions(
                        app, session_id, &client, &url, &api_key, &body, use_stream, &cancel,
                    )
                    .await;
                    drop(_llm_permit2);
                    match retry {
                        Ok(t) => t,
                        Err(e2) => {
                            let msg = if e2.contains("error sending request")
                                || e2.contains("connection refused")
                                || e2.contains("tcp connect")
                            {
                                format_llm_request_error(&endpoint.base_url, &e2)
                            } else {
                                e2
                            };
                            emit_chunk(app, session_id, "error", &msg);
                            emit_agent_event(app, session_id, eid, "error", &msg, None, None);
                            return Err(msg);
                        }
                    }
                } else {
                    let msg = if e.contains("error sending request")
                        || e.contains("connection refused")
                        || e.contains("tcp connect")
                    {
                        format_llm_request_error(&endpoint.base_url, &e)
                    } else {
                        e
                    };
                    emit_chunk(app, session_id, "error", &msg);
                    emit_agent_event(app, session_id, eid, "error", &msg, None, None);
                    return Err(msg);
                }
            }
        };

        if let Some(u) = &turn.usage {
            record_llm_turn_usage(app, session_id, endpoint, &opts, u)?;
        }

        let mut tool_calls = std::mem::take(&mut turn.tool_calls);
        let content = turn.content;
        let reasoning = turn.reasoning;
        let think_streamed = turn.think_streamed;
        let answer_streamed = turn.answer_streamed;
        let finish_reason = turn.finish_reason;
        // Local models sometimes dump tool JSON into content instead of tool_calls
        if tool_calls.is_empty() && sandbox.is_some() {
            if let Some(extracted) = extract_tool_calls_from_content(&content) {
                for (id, name, args) in extracted {
                    tool_calls.push(ToolCall {
                        id: Some(id),
                        type_: Some("function".into()),
                        function: Some(ToolFn {
                            name: Some(name),
                            arguments: Some(args),
                        }),
                    });
                }
            }
        }

        if !tool_calls.is_empty() {
            let Some(sb) = sandbox.as_ref() else {
                return Err("模型请求工具但未启用工具沙箱".into());
            };

            let assistant_msg = json!({
                "role": "assistant",
                "content": if content.is_empty() { Value::Null } else { json!(content) },
                "tool_calls": tool_calls.iter().map(|tc| {
                    json!({
                        "id": tc.id.clone().unwrap_or_default(),
                        "type": tc.type_.clone().unwrap_or_else(|| "function".into()),
                        "function": {
                            "name": tc.function.as_ref().and_then(|f| f.name.clone()).unwrap_or_default(),
                            "arguments": tc.function.as_ref().and_then(|f| f.arguments.clone()).unwrap_or_else(|| "{}".into()),
                        }
                    })
                }).collect::<Vec<_>>(),
            });
            messages.push(assistant_msg);

            // Read-only multi-tool: run in parallel (Codex multi_tool_use.parallel 精简版)
            let prepared: Vec<(String, String, String, Value)> = tool_calls
                .iter()
                .map(|tc| {
                    let id = tc.id.clone().unwrap_or_else(|| format!("call_{round}"));
                    let name = tc
                        .function
                        .as_ref()
                        .and_then(|f| f.name.clone())
                        .unwrap_or_default();
                    let args_raw = tc
                        .function
                        .as_ref()
                        .and_then(|f| f.arguments.clone())
                        .unwrap_or_else(|| "{}".into());
                    let args = parse_tool_arguments(&args_raw);
                    (id, name, args_raw, args)
                })
                .collect();
            for (_, name, _, _) in &prepared {
                if !name.is_empty() {
                    used_tools.push(name.clone());
                }
            }
            let parallel_bulk_safe = {
                let runtime = app.state::<AgentRuntime>();
                prepared.iter().all(|(_, name, _, args)| {
                    check_bulk_read_before_tool(&runtime, session_id, name, args, local_llm, &prefs)
                        .is_none()
                })
            };
            let can_parallel = prepared.len() > 1
                && parallel_bulk_safe
                && prepared.iter().all(|(_, name, _, args)| {
                    tool_call_parallel_safe(name, args)
                        && !tool_needs_approval_for(&opts, name, args)
                });

            if can_parallel {
                for (id, name, args_raw, _) in &prepared {
                    emit_chunk(app, session_id, "tool_name", name);
                    emit_chunk(app, session_id, "tool_input", args_raw);
                    crate::agent::events::emit_agent_event_full(
                        app,
                        session_id,
                        eid,
                        "tool_call",
                        &format!("并行调用 {name}"),
                        Some(name),
                        Some(args_raw),
                        Some(id),
                    );
                    let run_id = current_stream_run_id();
                    if let Some(db) = app.try_state::<FouDb>() {
                        if let Ok(conn) = db.0.lock() {
                            crate::context_memory::start_tool(
                                &conn,
                                &run_id,
                                if persisted_step_id.is_empty() {
                                    None
                                } else {
                                    Some(&persisted_step_id)
                                },
                                id,
                                name,
                                args_raw,
                            );
                        }
                    }
                }
                let sb_clone = sb.clone();
                let app_clone = app.clone();
                let opts_clone = opts.clone();
                let session_clone = session_id.to_string();
                let jobs: Vec<_> = prepared
                    .iter()
                    .map(|(id, name, _, args)| {
                        let sb2 = sb_clone.clone();
                        let app2 = app_clone.clone();
                        let opts2 = opts_clone.clone();
                        let session2 = session_clone.clone();
                        let name_exec = name.clone();
                        let name_ret = name.clone();
                        let args2 = args.clone();
                        let id2 = id.clone();
                        async move {
                            let out = tokio::task::spawn_blocking(move || {
                                run_agent_tool(&app2, &sb2, &opts2, &session2, &name_exec, &args2)
                            })
                            .await
                            .unwrap_or_else(|e| format!("并行工具失败: {e}"));
                            (id2, name_ret, out)
                        }
                    })
                    .collect();
                let results = futures_util::future::join_all(jobs).await;
                for ((id, name, args_raw, args), (_id2, _name2, output)) in
                    prepared.into_iter().zip(results.into_iter())
                {
                    release_evidence.observe_tool(&name, &args, &output);
                    if name == "update_plan" {
                        latest_plan = Some(args.clone());
                    }
                    {
                        let runtime = app.state::<AgentRuntime>();
                        record_bulk_read_output(&runtime, session_id, &name, &output);
                    }
                    let mut image_inject: Option<Value> = None;
                    let mut clipped = output;
                    if name == "view_image" {
                        if let Some((rel, mime, abs)) = parse_view_image_marker(&clipped) {
                            if let Ok(data_url) = load_view_image_data_url(&abs, &mime) {
                                image_inject = Some(json!({
                                    "role": "user",
                                    "content": [
                                        { "type": "text", "text": format!("（系统）已附入图片 {rel}，请根据图像继续。") },
                                        { "type": "image_url", "image_url": { "url": data_url } }
                                    ]
                                }));
                                clipped = format!("✅ 已将图片 {rel} 附入下一轮视觉上下文");
                            }
                        }
                    }
                    let clipped: String = clipped.chars().take(12_000).collect();
                    emit_chunk(app, session_id, "tool_output", &clipped);
                    emit_chunk(app, session_id, "tool_output_end", "");
                    crate::agent::events::emit_agent_event_full(
                        app,
                        session_id,
                        eid,
                        "tool_result",
                        &clipped.chars().take(300).collect::<String>(),
                        Some(&name),
                        None,
                        Some(&id),
                    );
                    if let Some(db) = app.try_state::<FouDb>() {
                        if let Ok(conn) = db.0.lock() {
                            crate::context_memory::finish_tool(
                                &conn,
                                &id,
                                if clipped.contains("失败") || clipped.contains("错误") {
                                    "error"
                                } else {
                                    "completed"
                                },
                                &clipped,
                                None,
                            );
                        }
                    }
                    let _ = args_raw;
                    messages.push(json!({
                        "role": "tool",
                        "tool_call_id": id,
                        "content": clipped,
                    }));
                    if let Some(img) = image_inject {
                        messages.push(img);
                    }
                }
                if let Some(db) = app.try_state::<FouDb>() {
                    if let Ok(conn) = db.0.lock() {
                        crate::context_memory::finish_step(
                            &conn,
                            &persisted_step_id,
                            "completed",
                            &json!({ "toolCalls": "parallel" }),
                            None,
                        );
                    }
                }
                persist_round_checkpoint(
                    app,
                    round,
                    &messages,
                    &opts,
                    &latest_plan,
                    &release_evidence,
                );
                continue;
            }

            for tc in &tool_calls {
                if cancel.load(Ordering::Relaxed) {
                    emit_chunk(app, session_id, "error", "已取消");
                    emit_agent_event(app, session_id, eid, "error", "已取消", None, None);
                    return Err("已取消".into());
                }
                let id = tc.id.clone().unwrap_or_else(|| format!("call_{round}"));
                let name = tc
                    .function
                    .as_ref()
                    .and_then(|f| f.name.clone())
                    .unwrap_or_default();
                let args_raw = tc
                    .function
                    .as_ref()
                    .and_then(|f| f.arguments.clone())
                    .unwrap_or_else(|| "{}".into());
                let args: Value = parse_tool_arguments(&args_raw);
                emit_chunk(app, session_id, "tool_name", &name);
                emit_chunk(app, session_id, "tool_input", &args_raw);
                crate::agent::events::emit_agent_event_full(
                    app,
                    session_id,
                    eid,
                    "tool_call",
                    &format!("调用 {name}"),
                    Some(&name),
                    Some(&args_raw),
                    Some(&id),
                );
                let run_id = current_stream_run_id();
                if let Some(db) = app.try_state::<FouDb>() {
                    if let Ok(conn) = db.0.lock() {
                        crate::context_memory::start_tool(
                            &conn,
                            &run_id,
                            if persisted_step_id.is_empty() {
                                None
                            } else {
                                Some(&persisted_step_id)
                            },
                            &id,
                            &name,
                            &args_raw,
                        );
                    }
                }

                let mut denied = false;
                let bulk_reason = {
                    let runtime = app.state::<AgentRuntime>();
                    check_bulk_read_before_tool(
                        &runtime, session_id, &name, &args, local_llm, &prefs,
                    )
                };
                let needs_approval =
                    bulk_reason.is_some() || tool_needs_approval_for(&opts, &name, &args);
                if needs_approval {
                    let approval_name = if bulk_reason.is_some() {
                        "bulk_read_warning".to_string()
                    } else {
                        name.clone()
                    };
                    let approval_args_raw = if let Some(ref reason) = bulk_reason {
                        json!({ "reason": reason, "blockedTool": name }).to_string()
                    } else if name.starts_with("mcp__") {
                        let risk = app
                            .try_state::<FouDb>()
                            .map(|db| crate::mcp::configured_tool_risk(&db, &name))
                            .unwrap_or_else(|| "high".into());
                        json!({
                            "risk": risk,
                            "tool": name,
                            "arguments": args
                        })
                        .to_string()
                    } else {
                        args_raw.clone()
                    };
                    let (tx, rx) = tokio::sync::oneshot::channel::<bool>();
                    let key = format!("{session_id}:{id}");
                    {
                        let runtime = app.state::<AgentRuntime>();
                        let mut map = runtime.approvals.lock().map_err(|e| e.to_string())?;
                        map.insert(key.clone(), tx);
                    }
                    crate::agent::events::emit_agent_event_full(
                        app,
                        session_id,
                        eid,
                        "awaiting_approval",
                        &format!("等待审批：{approval_name}"),
                        Some(&approval_name),
                        Some(&approval_args_raw),
                        Some(&id),
                    );
                    emit_chunk(
                        app,
                        session_id,
                        "status",
                        &format!("awaiting_approval:{id}"),
                    );
                    if let Some(db) = app.try_state::<FouDb>() {
                        if let Ok(conn) = db.0.lock() {
                            crate::context_memory::request_approval(
                                &conn,
                                &run_id,
                                &id,
                                &approval_args_raw,
                            );
                        }
                    }
                    let allowed =
                        tokio::time::timeout(std::time::Duration::from_secs(300), rx).await;
                    denied =
                        match allowed {
                            Ok(Ok(true)) => {
                                if let Some(db) = app.try_state::<FouDb>() {
                                    if let Ok(conn) = db.0.lock() {
                                        crate::context_memory::decide_approval(
                                            &conn, &run_id, &id, "approved",
                                        );
                                    }
                                }
                                audit_tool_event(
                                    "tool_approval",
                                    &approval_name,
                                    Some(session_id),
                                    opts.project_id.as_deref(),
                                    opts.employee_id.as_deref(),
                                    "grant",
                                    "allowed",
                                );
                                if let Some(ref reason) = bulk_reason {
                                    let paths = {
                                        let runtime = app.state::<AgentRuntime>();
                                        runtime.bulk_read_sessions.lock().ok().and_then(|m| {
                                            m.get(session_id).map(|st| {
                                                st.unique_paths.iter().cloned().collect::<Vec<_>>()
                                            })
                                        })
                                    };
                                    let bytes = {
                                        let runtime = app.state::<AgentRuntime>();
                                        runtime.bulk_read_sessions.lock().ok().and_then(|m| {
                                            m.get(session_id).map(|st| st.total_bytes)
                                        })
                                    };
                                    log_bulk_read_decision(
                                        session_id,
                                        opts.project_id.as_deref(),
                                        opts.employee_id.as_deref(),
                                        reason,
                                        &name,
                                        true,
                                        paths,
                                        bytes,
                                    );
                                }
                                if bulk_reason.is_some() {
                                    let runtime = app.state::<AgentRuntime>();
                                    set_bulk_read_override(&runtime, session_id);
                                }
                                false
                            }
                            Ok(Ok(false)) => {
                                if let Some(db) = app.try_state::<FouDb>() {
                                    if let Ok(conn) = db.0.lock() {
                                        crate::context_memory::decide_approval(
                                            &conn, &run_id, &id, "denied",
                                        );
                                    }
                                }
                                audit_tool_event(
                                    "tool_approval",
                                    &approval_name,
                                    Some(session_id),
                                    opts.project_id.as_deref(),
                                    opts.employee_id.as_deref(),
                                    "deny",
                                    "denied",
                                );
                                if let Some(ref reason) = bulk_reason {
                                    let paths = {
                                        let runtime = app.state::<AgentRuntime>();
                                        runtime.bulk_read_sessions.lock().ok().and_then(|m| {
                                            m.get(session_id).map(|st| {
                                                st.unique_paths.iter().cloned().collect::<Vec<_>>()
                                            })
                                        })
                                    };
                                    let bytes = {
                                        let runtime = app.state::<AgentRuntime>();
                                        runtime.bulk_read_sessions.lock().ok().and_then(|m| {
                                            m.get(session_id).map(|st| st.total_bytes)
                                        })
                                    };
                                    log_bulk_read_decision(
                                        session_id,
                                        opts.project_id.as_deref(),
                                        opts.employee_id.as_deref(),
                                        reason,
                                        &name,
                                        false,
                                        paths,
                                        bytes,
                                    );
                                }
                                true
                            }
                            Ok(Err(_)) => {
                                if let Some(db) = app.try_state::<FouDb>() {
                                    if let Ok(conn) = db.0.lock() {
                                        crate::context_memory::decide_approval(
                                            &conn, &run_id, &id, "closed",
                                        );
                                    }
                                }
                                true
                            }
                            Err(_) => {
                                audit_tool_event(
                                    "tool_approval",
                                    &approval_name,
                                    Some(session_id),
                                    opts.project_id.as_deref(),
                                    opts.employee_id.as_deref(),
                                    "timeout",
                                    "denied",
                                );
                                let runtime = app.state::<AgentRuntime>();
                                if let Ok(mut map) = runtime.approvals.lock() {
                                    map.remove(&key);
                                }
                                if let Some(db) = app.try_state::<FouDb>() {
                                    if let Ok(conn) = db.0.lock() {
                                        crate::context_memory::decide_approval(
                                            &conn, &run_id, &id, "timeout",
                                        );
                                    }
                                }
                                true
                            }
                        };
                }

                let mut image_inject: Option<Value> = None;
                let clipped: String = if denied {
                    if bulk_reason.is_some() {
                        "已按您的选择停止：疑似整仓读取已拦截".into()
                    } else {
                        "用户拒绝执行该工具（或审批超时）".into()
                    }
                } else {
                    let output = run_agent_tool(app, sb, &opts, session_id, &name, &args);
                    release_evidence.observe_tool(&name, &args, &output);
                    {
                        let runtime = app.state::<AgentRuntime>();
                        record_bulk_read_output(&runtime, session_id, &name, &output);
                    }
                    if name == "update_plan" {
                        latest_plan = Some(args.clone());
                        crate::agent::events::emit_agent_event_full(
                            app,
                            session_id,
                            eid,
                            "plan_update",
                            &output.chars().take(800).collect::<String>(),
                            Some("update_plan"),
                            None,
                            Some(&id),
                        );
                    }
                    let mut out = output;
                    if name == "view_image" {
                        if let Some((rel, mime, abs)) = parse_view_image_marker(&out) {
                            match load_view_image_data_url(&abs, &mime) {
                                Ok(data_url) => {
                                    image_inject = Some(json!({
                                        "role": "user",
                                        "content": [
                                            {
                                                "type": "text",
                                                "text": format!("（系统）已附入图片 {rel}，请根据图像继续。")
                                            },
                                            {
                                                "type": "image_url",
                                                "image_url": { "url": data_url }
                                            }
                                        ]
                                    }));
                                    out = format!("✅ 已将图片 {rel} 附入下一轮视觉上下文");
                                }
                                Err(e) => {
                                    out = e;
                                }
                            }
                        }
                    }
                    if name == "write_file"
                        || name == "mkdir"
                        || name == "patch_file"
                        || name == "apply_patch"
                        || name == "delete_file"
                        || name == "office_write_docx"
                        || name == "office_write_xlsx"
                        || name == "office_write_pptx"
                        || name == "office_docx_replace"
                        || name == "office_edit_xlsx_cells"
                        || name == "office_apply_template"
                        || is_canvas_sketch_mutate_tool(&name)
                        || name == "canvas_write_mermaid"
                        || name == "canvas_write_flow"
                        || name == "canvas_clear_flow"
                        || name == "canvas_export"
                    {
                        write_count = write_count.saturating_add(1);
                    }
                    out.chars().take(12_000).collect()
                };
                emit_chunk(app, session_id, "tool_output", &clipped);
                emit_chunk(app, session_id, "tool_output_end", "");
                crate::agent::events::emit_agent_event_full(
                    app,
                    session_id,
                    eid,
                    "tool_result",
                    &clipped.chars().take(300).collect::<String>(),
                    Some(&name),
                    None,
                    Some(&id),
                );
                if let Some(db) = app.try_state::<FouDb>() {
                    if let Ok(conn) = db.0.lock() {
                        crate::context_memory::finish_tool(
                            &conn,
                            &id,
                            if denied {
                                "denied"
                            } else if clipped.contains("失败") || clipped.contains("错误") {
                                "error"
                            } else {
                                "completed"
                            },
                            &clipped,
                            None,
                        );
                    }
                }

                messages.push(json!({
                    "role": "tool",
                    "tool_call_id": id,
                    "content": clipped,
                }));
                if let Some(img) = image_inject {
                    messages.push(img);
                }
            }
            if let Some(db) = app.try_state::<FouDb>() {
                if let Ok(conn) = db.0.lock() {
                    crate::context_memory::finish_step(
                        &conn,
                        &persisted_step_id,
                        "completed",
                        &json!({ "toolCalls": tool_calls.len() }),
                        None,
                    );
                }
            }
            persist_round_checkpoint(
                app,
                round,
                &messages,
                &opts,
                &latest_plan,
                &release_evidence,
            );
            continue;
        }

        // Model talked without tools — kickoff must land files; nudge instead of accepting plan-only
        if sandbox.is_some()
            && (must_land_files(&opts) || opts.require_write || opts.require_canvas_write)
            && write_count == 0
            && round + 1 < MAX_TOOL_ROUNDS
        {
            let preview = if !content.is_empty() {
                content.clone()
            } else {
                reasoning.clone()
            };
            if !preview.is_empty() {
                messages.push(json!({
                    "role": "assistant",
                    "content": preview,
                }));
            }
            let hallucinated = content_claims_files(&preview);
            let nudge = if opts.require_canvas_write {
                "系统校验：用户要画户型/草图，但你尚未改动画板。\
禁止编造「设置→工具权限→Canvas本机工具」；设置里没有该开关。\
立即调用 canvas_add_strokes（可先 canvas_clear_sketch）追加图元，或 canvas_write_sketch 整板写入。不要用 write_file。多轮小步绘制，禁止把用户原话整段写成 text。"
            } else if opts.require_write && !must_land_files(&opts) {
                "系统校验：用户要求修改/追加文件内容，但你尚未调用 apply_patch、patch_file 或 write_file。\
禁止只在回复里描述已写入；优先 apply_patch（Begin Patch），小改可用 patch_file，新文件用 write_file。"
            } else if hallucinated {
                "系统硬校验：你刚才声称已创建/写入文件，但本轮写入类工具调用次数为 0，那些路径全部无效。\
若要 Word/Excel/PPT：调用 office_write_docx / office_write_xlsx / office_write_pptx。\
文本优先 apply_patch 或 write_file（.md/.txt/.json）。禁止空口报路径。"
            } else {
                "系统校验：尚未调用写入工具。禁止只写计划。\
请立刻用 apply_patch / patch_file / write_file，或 office_write_docx / office_write_xlsx / office_write_pptx 落盘；\
.docx/.xlsx/.pptx 必须用 office_*，不要用 write_file 假装。"
            };
            messages.push(json!({
                "role": "user",
                "content": nudge,
            }));
            emit_chunk(
                app,
                session_id,
                "status",
                if opts.require_canvas_write {
                    "催促写入画板 canvas_add_strokes"
                } else {
                    "催促落盘 apply_patch/write_file"
                },
            );
            if let Some(db) = app.try_state::<FouDb>() {
                if let Ok(conn) = db.0.lock() {
                    crate::context_memory::finish_step(
                        &conn,
                        &persisted_step_id,
                        "completed",
                        &json!({ "nudge": "write_required" }),
                        None,
                    );
                }
            }
            persist_round_checkpoint(
                app,
                round,
                &messages,
                &opts,
                &latest_plan,
                &release_evidence,
            );
            continue;
        }

        let answer = emit_think_and_answer(
            app,
            session_id,
            &reasoning,
            &content,
            think_streamed,
            answer_streamed,
        );
        if !answer.is_empty() {
            final_text = answer.clone();
        }
        let reason = finish_reason.unwrap_or_default();
        if reason == "length" && final_text.is_empty() {
            emit_chunk(app, session_id, "status", "输出已截断");
        }
        if let Some(db) = app.try_state::<FouDb>() {
            if let Ok(conn) = db.0.lock() {
                crate::context_memory::finish_step(
                    &conn,
                    &persisted_step_id,
                    "completed",
                    &json!({ "finishReason": reason }),
                    None,
                );
            }
        }
        persist_round_checkpoint(
            app,
            round,
            &messages,
            &opts,
            &latest_plan,
            &release_evidence,
        );
        break;
    }

    if final_text.is_empty() {
        let msg = if sandbox.is_some() {
            "（已执行工具，模型未返回最终文字说明）"
        } else {
            "（模型未返回正文，可能仍在推理或仅输出了思考内容）"
        };
        final_text = msg.to_string();
        emit_chunk(app, session_id, "text", msg);
    }

    // Analyze / read-only: never accept hallucinated "I created files" reports
    if sandbox.is_some()
        && opts.tool_mode == ToolMode::ReadOnly
        && content_claims_files(&final_text)
    {
        let msg = "（分析稿已作废）模型在「只读分析」阶段声称已创建 .docx/.xlsx 等文件——本阶段不能写盘，\
这些路径全部无效。请仅输出文字分析、XU_TASKS、XU_NEED_CONFIRM；落盘请等实现阶段调用 write_file（仅 .md/.txt 等文本）。";
        final_text = msg.to_string();
        emit_chunk(app, session_id, "text", msg);
    }

    // Hard fail: never present hallucinated file lists as success
    if sandbox.is_some() && must_land_files(&opts) && write_count == 0 {
        let msg = "❌ 落盘失败：本轮未实际调用写入工具（write_file / office_write_docx / office_write_xlsx / office_write_pptx 等）。\
口述的文件清单无效。请换支持 function calling 的模型后重试。";
        emit_chunk(app, session_id, "text", msg);
        emit_chunk(app, session_id, "error", msg);
        emit_chunk(app, session_id, "done", "");
        emit_agent_event(app, session_id, eid, "error", msg, None, None);
        return Err(msg.to_string());
    }

    // Soft warn only when user expected file/canvas writes but none occurred
    if sandbox.is_some()
        && opts.tool_mode == ToolMode::Full
        && write_count == 0
        && !must_land_files(&opts)
        && (opts.require_write || opts.require_canvas_write || content_claims_files(&final_text))
    {
        let warn = if opts.require_canvas_write {
            "\n\n⚠️ 系统提示：本轮未调用 canvas_add_strokes / canvas_write_sketch；画板可能仍为空。请确认模型支持工具调用后重试。"
        } else {
            "\n\n⚠️ 系统提示：本轮未实际写入任何文件；若你要求了改文件，请确认模型支持工具调用后重试。"
        };
        final_text.push_str(warn);
        emit_chunk(app, session_id, "text", warn);
    } else if write_count > 0 {
        let ok = format!("\n\n✅ 本轮实际写入/建目录 {write_count} 次。");
        final_text.push_str(&ok);
        emit_chunk(app, session_id, "text", &ok);
    }

    if opts.release_gate {
        let missing = sandbox
            .as_ref()
            .map(|sb| release_evidence.missing(&sb.workspace))
            .unwrap_or_else(|| vec!["IDE 工作区绑定".into()]);
        if !missing.is_empty() {
            // 软提示：不再 Err 中断整轮（1.0.2 实测中硬门禁误伤日常写码）
            let warn = format!(
                "\n\n⚠️ IDE 交活证据未齐（缺少 {}）。本轮仍完成；可在「设置 → IDE 安全完成门禁」保持关闭。",
                missing.join("、")
            );
            final_text.push_str(&warn);
            emit_chunk(app, session_id, "text", &warn);
        }
    }

    emit_chunk(app, session_id, "done", "");
    emit_agent_event(
        app,
        session_id,
        eid,
        "done",
        &final_text.chars().take(400).collect::<String>(),
        None,
        None,
    );
    if let Some(eid) = opts.employee_id.as_deref() {
        if !used_tools.is_empty() {
            if let Some(db) = app.try_state::<FouDb>() {
                if let Ok(conn) = db.0.lock() {
                    let _ = crate::agent::playbook::record_tool_run(&conn, eid, None, &used_tools);
                }
            }
        }
    }
    Ok(final_text)
}

fn split_chunks(s: &str, size: usize) -> Vec<String> {
    if s.is_empty() {
        return Vec::new();
    }
    let mut out = Vec::new();
    let mut buf = String::new();
    for ch in s.chars() {
        buf.push(ch);
        if buf.chars().count() >= size {
            out.push(std::mem::take(&mut buf));
        }
    }
    if !buf.is_empty() {
        out.push(buf);
    }
    out
}

/// Split model content into (think, answer). Supports `<think>…</think>` and `《思考》…《/思考》`.
fn split_think_answer(content: &str) -> (String, String) {
    let mut think = String::new();
    let mut answer = String::new();
    let mut rest = content;

    while !rest.is_empty() {
        let lower = rest.to_ascii_lowercase();
        let start_qwen = lower.find("<think>");
        let start_en = lower.find("<think>");
        let start_zh = rest.find("《思考》");
        let picked = [
            start_qwen.map(|a| (a, "<think>", "</think>")),
            start_en.map(|a| (a, "<think>", "</think>")),
            start_zh.map(|b| (b, "《思考》", "《/思考》")),
        ]
        .into_iter()
        .flatten()
        .min_by_key(|(pos, _, _)| *pos);
        let Some((start, open, close)) = picked else {
            answer.push_str(rest);
            break;
        };
        answer.push_str(&rest[..start]);
        let after_open = &rest[start + open.len()..];
        let close_pos = if close == "</think>" || close == "``" {
            after_open.to_ascii_lowercase().find(close)
        } else {
            after_open.find(close)
        };
        if let Some(end) = close_pos {
            let inner = after_open[..end].trim();
            if !inner.is_empty() {
                if !think.is_empty() {
                    think.push_str("\n\n");
                }
                think.push_str(inner);
            }
            rest = &after_open[end + close.len()..];
        } else {
            let inner = after_open.trim();
            if !inner.is_empty() {
                if !think.is_empty() {
                    think.push_str("\n\n");
                }
                think.push_str(inner);
            }
            break;
        }
    }

    (think.trim().to_string(), answer.trim().to_string())
}

fn emit_think_chunks(app: &AppHandle, session_id: &str, think: &str) {
    if think.is_empty() {
        return;
    }
    emit_chunk(app, session_id, "think_start", "");
    for chunk in split_chunks(think, 48) {
        emit_chunk(app, session_id, "think", &chunk);
    }
    emit_chunk(app, session_id, "think_end", "");
}

/// Emit reasoning + tagged think as `think` chunks; answer as `text`. Returns answer body.
fn emit_think_and_answer(
    app: &AppHandle,
    session_id: &str,
    reasoning_field: &str,
    content: &str,
    think_streamed: bool,
    answer_streamed: bool,
) -> String {
    let (tagged_think, answer) = split_think_answer(content);
    if answer_streamed {
        return if answer.is_empty() && !reasoning_field.trim().is_empty() {
            reasoning_field.trim().to_string()
        } else {
            answer
        };
    }
    if think_streamed {
        let mut out = answer;
        if out.is_empty() && !reasoning_field.trim().is_empty() {
            out = reasoning_field.trim().to_string();
            for chunk in split_chunks(&out, 48) {
                emit_chunk(app, session_id, "text", &chunk);
            }
        } else if !out.is_empty() {
            for chunk in split_chunks(&out, 48) {
                emit_chunk(app, session_id, "text", &chunk);
            }
        }
        return out;
    }
    let mut think = reasoning_field.trim().to_string();
    if !tagged_think.is_empty() {
        if !think.is_empty() {
            think.push_str("\n\n");
        }
        think.push_str(&tagged_think);
    }
    emit_think_chunks(app, session_id, &think);
    if !answer.is_empty() {
        for chunk in split_chunks(&answer, 48) {
            emit_chunk(app, session_id, "text", &chunk);
        }
    }
    answer
}

/// Backward-compatible alias used by older call sites.
pub async fn run_chat_completion(
    app: &AppHandle,
    session_id: &str,
    endpoint: &AgentEndpoint,
    messages: &[AgentMessage],
    cancel: Arc<AtomicBool>,
) -> Result<String, String> {
    run_agent_loop(
        app,
        session_id,
        endpoint,
        messages,
        AgentRunOpts::default(),
        cancel,
    )
    .await
}

#[tauri::command]
/// Run one Native Agent turn and isolate all emitted chunks/cancellation by `run_id`.
/// Dependency: model endpoint, token quota and optional workspace tools; failures return to the invoke caller.
pub async fn xu_agent_stream(
    app: AppHandle,
    runtime: State<'_, AgentRuntime>,
    request: AgentRunRequest,
) -> Result<String, String> {
    let start_guard = runtime.reserve_stream_session(&request.session_id)?;
    {
        let db_arc = app.state::<crate::desktop_db::FouDb>().0.clone();
        let conn = match db_arc.lock() {
            Ok(c) => c,
            Err(e) => return Err(e.to_string()),
        };
        crate::desktop_db::assert_token_quota(&conn)?;
    }

    let cancel = Arc::new(AtomicBool::new(false));
    let snapshot_batch = snapshots::new_batch_id(&request.session_id);
    {
        let db = app.state::<crate::desktop_db::FouDb>();
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let seed: Vec<Value> = request
            .messages
            .iter()
            .map(|m| json!({ "role": m.role, "content": m.content, "images": m.images }))
            .collect();
        crate::context_memory::start_run_with_context(
            &conn,
            &request.run_id,
            &request.session_id,
            &request.endpoint.model,
            request.project_id.as_deref(),
            None,
            &seed,
            &json!({
                "projectId": request.project_id.clone().unwrap_or_else(|| "unscoped".into()),
                "toolPolicy": request.project_tool_policy.clone().unwrap_or_else(ProjectToolPolicy::conservative),
                "snapshotBatch": snapshot_batch.clone(),
                "plan": [],
                "releaseGate": request.release_gate.unwrap_or(false)
            }),
        )?;
    }
    let _run_guard = match runtime.publish_stream_run(
        start_guard,
        &request.session_id,
        &request.run_id,
        cancel.clone(),
    ) {
        Ok(guard) => guard,
        Err(error) => {
            if let Some(db) = app.try_state::<FouDb>() {
                if let Ok(conn) = db.0.lock() {
                    crate::context_memory::finish_run(
                        &conn,
                        &request.run_id,
                        "error",
                        Some(&error),
                    );
                }
            }
            return Err(error);
        }
    };
    let enable = request
        .enable_tools
        .unwrap_or(request.workspace_root.is_some());
    let tool_mode = match request.tool_mode.as_deref() {
        Some("readonly" | "readOnly" | "read_only") => ToolMode::ReadOnly,
        _ => ToolMode::Full,
    };
    let opts = AgentRunOpts {
        workspace_root: request.workspace_root.clone().map(PathBuf::from),
        read_extra_paths: request
            .read_extra_paths
            .clone()
            .unwrap_or_default()
            .into_iter()
            .map(PathBuf::from)
            .collect(),
        enable_tools: enable,
        tool_mode,
        employee_id: None,
        usage_source: "chat".into(),
        require_approval: false,
        ide_cli: request.ide_cli.clone(),
        code_editor_surface: request.code_editor_surface.clone(),
        boss_granted_session: false,
        apply_global_prefs: true,
        snapshot_batch: Some(snapshot_batch),
        require_write: request.require_write.unwrap_or(false),
        require_canvas_write: request.require_canvas_write.unwrap_or(false),
        project_id: request.project_id.clone(),
        project_tool_policy: request.project_tool_policy.clone(),
        memory_scope: request.memory_scope.clone().or(Some("global".into())),
        memory_scope_id: request.memory_scope_id.clone(),
        memory_task_hint: request.memory_task_hint.clone(),
        release_gate: request.release_gate.unwrap_or(false),
        im_inbound: false,
        max_tokens: request.max_tokens,
        disable_thinking: request.disable_thinking.unwrap_or(false),
    };
    let result = STREAM_RUN_ID
        .scope(
            request.run_id.clone(),
            run_agent_loop(
                &app,
                &request.session_id,
                &request.endpoint,
                &request.messages,
                opts,
                cancel,
            ),
        )
        .await;
    if let Err(err) = &result {
        let status = if err.contains("已取消") {
            "cancelled"
        } else {
            "error"
        };
        if let Some(db) = app.try_state::<FouDb>() {
            if let Ok(conn) = db.0.lock() {
                crate::context_memory::finish_run(&conn, &request.run_id, status, Some(err));
            }
        }
    } else {
        let skip_mem = request.skip_memory_extract.unwrap_or(false);
        if !skip_mem {
        let mut msgs = request.messages.clone();
        if let Ok(ref answer) = result {
            msgs.push(AgentMessage {
                role: "assistant".into(),
                content: answer.clone(),
                images: None,
            });
        }
        let scope = request
            .memory_scope
            .clone()
            .unwrap_or_else(|| "global".into());
        let scope_id = request.memory_scope_id.clone();
        let hint = request.memory_task_hint.clone().unwrap_or_else(|| {
            request
                .messages
                .last()
                .map(|m| m.content.clone())
                .unwrap_or_default()
        });

        let client = reqwest::Client::new();
        let llm_owned = match (
            chat_completions_url(&request.endpoint.base_url),
            resolve_api_key_with_db(&app, &request.endpoint.api_key_env),
        ) {
            (Ok(url), Ok(key)) => Some((url, key, request.endpoint.model.clone())),
            _ => None,
        };

        // Quota check (brief lock)
        {
            let fou = app.state::<crate::desktop_db::FouDb>();
            let conn = match fou.0.lock() {
                Ok(c) => c,
                Err(_) => {
                    if let Some(db) = app.try_state::<FouDb>() {
                        if let Ok(conn) = db.0.lock() {
                            crate::context_memory::finish_run(
                                &conn,
                                &request.run_id,
                                "error",
                                Some("数据库锁不可用"),
                            );
                        }
                    }
                    return Err("数据库锁不可用".into());
                }
            };
            if let Err(msg) = crate::desktop_db::assert_token_quota(&conn) {
                crate::context_memory::finish_run(&conn, &request.run_id, "error", Some(&msg));
                return Err(msg);
            }
        }

        let xu_db = app.state::<crate::desktop_db::FouDb>();
        let llm_refs = llm_owned
            .as_ref()
            .map(|(u, k, m)| (&client, u.as_str(), k.as_str(), m.as_str()));
        memory_extract::maybe_extract_memory_async(
            &*xu_db,
            &msgs,
            &scope,
            scope_id.as_deref(),
            &hint,
            llm_refs,
        )
        .await;
        } // !skip_mem
        if let Some(db) = app.try_state::<FouDb>() {
            if let Ok(conn) = db.0.lock() {
                crate::context_memory::finish_run(&conn, &request.run_id, "completed", None);
            }
        }
    }
    result
}

#[tauri::command]
pub fn xu_agent_approve_tool(
    runtime: State<'_, AgentRuntime>,
    session_id: String,
    call_id: String,
    allow: bool,
) -> Result<(), String> {
    let key = format!("{session_id}:{call_id}");
    let mut map = runtime.approvals.lock().map_err(|e| e.to_string())?;
    if let Some(tx) = map.remove(&key) {
        let _ = tx.send(allow);
        Ok(())
    } else {
        Err(format!("没有等待中的审批：{key}"))
    }
}

#[tauri::command]
/// Cancel a specific chat run, or the current session task when `run_id` is absent.
/// Dependency: runtime cancel maps; unknown/already-finished runs are treated as successful no-ops.
pub fn xu_agent_cancel(
    app: AppHandle,
    runtime: State<'_, AgentRuntime>,
    session_id: String,
    run_id: Option<String>,
) -> Result<(), String> {
    let stream_map = runtime.stream_cancels.lock().map_err(|e| e.to_string())?;
    let mut cancelled = false;
    if let Some(run) = stream_map.get(&session_id) {
        if run_id.as_deref().map_or(true, |id| id == run.run_id) {
            run.flag.store(true, Ordering::Relaxed);
            if let Some(db) = app.try_state::<FouDb>() {
                if let Ok(conn) = db.0.lock() {
                    crate::context_memory::mark_run_cancelling(&conn, &run.run_id);
                }
            }
            cancelled = true;
        }
    }
    drop(stream_map);
    if run_id.is_none() {
        let map = runtime.cancels.lock().map_err(|e| e.to_string())?;
        if let Some(flag) = map.get(&session_id) {
            flag.store(true, Ordering::Relaxed);
            cancelled = true;
        }
    }
    if cancelled {
        log_halt(
            Some(&session_id),
            None,
            "Agent 会话已取消",
            "用户中止了当前 Agent 流式任务",
        );
    }
    Ok(())
}

/// Persist preferred IDE CLI for agent tools (also sets XU_IDE_CLI for this process).
#[tauri::command]
pub fn xu_set_ide_cli(cli: String) -> Result<String, String> {
    let t = cli.trim();
    if t.is_empty() {
        std::env::remove_var("XU_IDE_CLI");
        return Ok("cleared".into());
    }
    let mapped = crate::agent::tools::map_ide_alias_pub(t);
    std::env::set_var("XU_IDE_CLI", &mapped);
    Ok(mapped)
}

/// Persist global coding surface (`builtin` = in-app editor, `external` = IDE CLI).
#[tauri::command]
pub fn xu_set_coding_surface(surface: String) -> Result<String, String> {
    let t = surface.trim();
    match t {
        "builtin" | "external" => {
            std::env::set_var("XU_CODING_SURFACE", t);
            Ok(t.into())
        }
        "" => {
            std::env::set_var("XU_CODING_SURFACE", "builtin");
            Ok("builtin".into())
        }
        _ => Err("surface 须为 builtin 或 external".into()),
    }
}

#[tauri::command]
pub fn xu_set_employee_slots(
    runtime: State<'_, AgentRuntime>,
    slots: u32,
    per_project: Option<u32>,
) -> Result<(), String> {
    let n = slots.clamp(1, 4) as usize;
    {
        let mut g = runtime.employee_slots.lock().map_err(|e| e.to_string())?;
        *g = Arc::new(tokio::sync::Semaphore::new(n));
    }
    if let Some(pp) = per_project {
        runtime
            .per_project_limit
            .store((pp.clamp(1, 8)) as usize, Ordering::Relaxed);
    }
    Ok(())
}

#[tauri::command]
pub fn xu_set_boss_granted_session(
    runtime: State<'_, AgentRuntime>,
    session_id: String,
    project_id: Option<String>,
    granted: bool,
) -> Result<(), String> {
    if session_id.trim().is_empty() {
        return Err("Boss grant 必须绑定 sessionId".into());
    }
    let key = scoped_grant_key(&session_id, project_id.as_deref());
    let mut grants = runtime.boss_grants.lock().map_err(|e| e.to_string())?;
    if granted {
        grants.insert(key);
    } else {
        grants.remove(&key);
    }
    Ok(())
}

/// Manually compact a message list and persist its structured summary for this session.
/// Dependency: xu.db `session_summaries`; failures are returned for the UI to show via fouAlert.
#[tauri::command]
pub fn xu_agent_compact_messages(
    db: State<'_, FouDb>,
    session_id: Option<String>,
    messages: Vec<Value>,
) -> Result<Value, String> {
    let mut msgs = messages;
    let before = estimate_message_tokens(&msgs);
    let result = compact_context_builtin(&mut msgs);
    let after = estimate_message_tokens(&msgs);
    let summary_id = if let (Some(sid), Some((_, _, dropped, summary))) =
        (session_id.as_deref(), result.as_ref())
    {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        Some(crate::context_memory::save_session_summary(
            &conn,
            sid,
            "manual_compaction",
            summary,
            *dropped,
        )?)
    } else {
        None
    };
    Ok(json!({
        "messages": msgs,
        "before": before,
        "after": after,
        "compacted": result.is_some(),
        "summaryId": summary_id,
        "max": MAX_CTX,
    }))
}

#[cfg(test)]
mod think_tag_tests {
    use super::*;

    #[test]
    fn partial_tag_suffix_len_utf8_tags_do_not_panic() {
        let tags = &["</think>", "《/思考》"];
        assert_eq!(partial_tag_suffix_len("《", tags), 3);
        assert_eq!(partial_tag_suffix_len("《/", tags), 4);
    }

    #[test]
    fn boss_grant_key_is_session_and_project_scoped() {
        assert_ne!(
            scoped_grant_key("session-a", Some("project-a")),
            scoped_grant_key("session-a", Some("project-b"))
        );
        assert_ne!(
            scoped_grant_key("session-a", Some("project-a")),
            scoped_grant_key("session-b", Some("project-a"))
        );
    }

    #[test]
    fn mcp_and_gui_input_always_require_step_approval() {
        let mut opts = AgentRunOpts::default();
        opts.require_approval = false;
        opts.boss_granted_session = true;
        assert!(tool_needs_approval_for(
            &opts,
            "mcp__server__write",
            &json!({})
        ));
        assert!(tool_needs_approval_for(&opts, "open_program", &json!({})));
        assert!(tool_needs_approval_for(&opts, "app_launch", &json!({})));
        assert!(tool_needs_approval_for(&opts, "input_click", &json!({})));
        assert!(tool_needs_approval_for(&opts, "input_type", &json!({})));
        assert!(tool_needs_approval_for(&opts, "gui_replay", &json!({})));
        opts.require_approval = true;
        assert!(tool_needs_approval_for(&opts, "input_click", &json!({})));
    }

    #[test]
    fn parallel_reads_still_trip_bulk_guard() {
        let runtime = AgentRuntime::new();
        let prefs = AgentPrefs {
            bulk_read_file_threshold: 1,
            bulk_read_bytes_threshold: usize::MAX,
            ..AgentPrefs::default()
        };
        assert!(check_bulk_read_before_tool(
            &runtime,
            "s",
            "read_file",
            &json!({"path":"a.rs"}),
            false,
            &prefs,
        )
        .is_none());
        assert!(check_bulk_read_before_tool(
            &runtime,
            "s",
            "read_file",
            &json!({"path":"b.rs"}),
            false,
            &prefs,
        )
        .is_some());
    }

    #[test]
    fn concurrent_stream_for_same_session_is_rejected() {
        let runtime = AgentRuntime::new();
        let start = runtime.reserve_stream_session("session").unwrap();
        assert!(runtime.reserve_stream_session("session").is_err());
        let run = runtime
            .publish_stream_run(start, "session", "run-1", Arc::new(AtomicBool::new(false)))
            .unwrap();
        assert!(runtime.reserve_stream_session("session").is_err());
        drop(run);
        assert!(runtime.reserve_stream_session("session").is_ok());
    }

    #[test]
    fn stream_run_guard_only_removes_its_own_run() {
        let runtime = AgentRuntime::new();
        let start = runtime.reserve_stream_session("session").unwrap();
        let guard = runtime
            .publish_stream_run(start, "session", "run-1", Arc::new(AtomicBool::new(false)))
            .unwrap();
        runtime.stream_cancels.lock().unwrap().insert(
            "session".into(),
            CancelRun {
                run_id: "run-2".into(),
                flag: Arc::new(AtomicBool::new(false)),
            },
        );
        drop(guard);
        assert_eq!(
            runtime
                .stream_cancels
                .lock()
                .unwrap()
                .get("session")
                .unwrap()
                .run_id,
            "run-2"
        );
    }
}
