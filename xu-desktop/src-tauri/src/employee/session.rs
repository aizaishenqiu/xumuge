//! Employee ↔ Xu session binding (semantics: Xu chat session id, not Hermes).

use crate::desktop_db::FouDb;
use tauri::State;

/// Alias of xu_get_employee_session with Hermes-free naming.
#[tauri::command]
pub fn xu_emp_get_session(
    db: State<'_, FouDb>,
    employee_id: String,
) -> Result<Option<String>, String> {
    crate::commands::desktop::xu_get_employee_session(db, employee_id)
}

#[tauri::command]
pub fn xu_emp_set_session(
    db: State<'_, FouDb>,
    employee_id: String,
    session_id: String,
) -> Result<(), String> {
    // Underlying column still hermes_session_id until migration E0 SQL lands.
    crate::commands::desktop::xu_set_employee_session(db, employee_id, session_id)
}

#[tauri::command]
pub fn xu_emp_clear_session(db: State<'_, FouDb>, employee_id: String) -> Result<(), String> {
    crate::commands::desktop::xu_clear_employee_session(db, employee_id)
}
