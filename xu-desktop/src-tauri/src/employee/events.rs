//! Employee live status events — push to UI (Tauri emit = desktop 等价于单条 WS).
//! Do NOT poll N employees from the frontend.

use serde::Serialize;
use tauri::{AppHandle, Emitter};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EmployeeEvent {
    pub employee_id: String,
    pub state: String,
    pub action: String,
    pub message: String,
    pub at: i64,
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

pub fn emit_employee_event(
    app: &AppHandle,
    employee_id: &str,
    state: &str,
    action: &str,
    message: &str,
) {
    let _ = app.emit(
        "xu:employee-event",
        EmployeeEvent {
            employee_id: employee_id.to_string(),
            state: state.to_string(),
            action: action.to_string(),
            message: message.chars().take(400).collect(),
            at: now_ms(),
        },
    );
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeliveryReviewRequest {
    pub employee_id: String,
    pub task_text: String,
    pub delivery_body: String,
    pub at: i64,
}

/// Frontend runs alignment check + peer discussion after dispatch completes.
pub fn emit_delivery_review_request(
    app: &AppHandle,
    employee_id: &str,
    task_text: &str,
    delivery_body: &str,
) {
    let task = task_text.trim();
    let body = delivery_body.trim();
    if task.is_empty() && body.is_empty() {
        return;
    }
    let _ = app.emit(
        "xu:delivery-review-request",
        DeliveryReviewRequest {
            employee_id: employee_id.to_string(),
            task_text: task.chars().take(4000).collect(),
            delivery_body: body.chars().take(4000).collect(),
            at: now_ms(),
        },
    );
}
