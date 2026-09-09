//! Structured agent events — Tauri emit (desktop 等价于单条 WebSocket 总线).
//! Channel: `xu:agent-event`

use serde::Serialize;
use tauri::{AppHandle, Emitter};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentEvent {
    pub session_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub employee_id: Option<String>,
    /// start | llm_thinking | tool_call | awaiting_approval | tool_result | context_compaction | done | error
    pub kind: String,
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_args: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub call_id: Option<String>,
    pub at: i64,
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

pub fn emit_agent_event(
    app: &AppHandle,
    session_id: &str,
    employee_id: Option<&str>,
    kind: &str,
    content: &str,
    tool_name: Option<&str>,
    tool_args: Option<&str>,
) {
    emit_agent_event_full(
        app,
        session_id,
        employee_id,
        kind,
        content,
        tool_name,
        tool_args,
        None,
    );
}

pub fn emit_agent_event_full(
    app: &AppHandle,
    session_id: &str,
    employee_id: Option<&str>,
    kind: &str,
    content: &str,
    tool_name: Option<&str>,
    tool_args: Option<&str>,
    call_id: Option<&str>,
) {
    let clipped: String = content.chars().take(2_000).collect();
    let _ = app.emit(
        "xu:agent-event",
        AgentEvent {
            session_id: session_id.to_string(),
            employee_id: employee_id.map(|s| s.to_string()),
            kind: kind.to_string(),
            content: clipped,
            tool_name: tool_name.map(|s| s.to_string()),
            tool_args: tool_args.map(|s| s.chars().take(1_500).collect()),
            call_id: call_id.map(|s| s.to_string()),
            at: now_ms(),
        },
    );

    if let Some(eid) = employee_id {
        let action = match kind {
            "tool_call" | "tool_result" | "awaiting_approval" => tool_name.unwrap_or("tool"),
            "llm_thinking" => "thinking",
            "context_compaction" => "compact",
            "plan_update" => "plan",
            "done" => "done",
            "error" => "error",
            "start" => "start",
            _ => kind,
        };
        if kind == "tool_call" {
            if let Some(tn) = tool_name {
                crate::employee::deliverables::record_deliverable_tool(app, eid, tn, tool_args);
            }
        }
        let state = match kind {
            "done" => "idle",
            "error" => "blocked",
            "awaiting_approval" => "working",
            _ => "working",
        };
        let msg = if content.is_empty() {
            action.to_string()
        } else {
            content.chars().take(200).collect()
        };
        crate::employee::events::emit_employee_event(app, eid, state, action, &msg);
    }
}
