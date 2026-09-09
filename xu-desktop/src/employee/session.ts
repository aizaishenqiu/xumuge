/**
 * xu-session: employee ↔ Xu chat session binding.
 * Column semantics: session_id (desktop), not Hermes state.db.
 */
import { invoke } from "@tauri-apps/api/core";
import type { EmployeeSessionBinding } from "./types";

/** Read Xu session id bound to an employee (legacy command still named hermes in DB — migrating). */
export async function getEmployeeSession(employeeId: string): Promise<string | null> {
  try {
    return await invoke<string | null>("xu_emp_get_session", { employeeId });
  } catch {
    // Fallback to existing desktop command during migration
    try {
      return await invoke<string | null>("xu_get_employee_session", { employeeId });
    } catch {
      return null;
    }
  }
}

export async function setEmployeeSession(
  employeeId: string,
  sessionId: string,
): Promise<void> {
  try {
    await invoke("xu_emp_set_session", { employeeId, sessionId });
    return;
  } catch {
    await invoke("xu_set_employee_session", {
      employeeId,
      sessionId,
    });
  }
}

export async function clearEmployeeSession(employeeId: string): Promise<void> {
  try {
    await invoke("xu_emp_clear_session", { employeeId });
    return;
  } catch {
    await invoke("xu_clear_employee_session", { employeeId });
  }
}

export async function loadEmployeeSessionBinding(
  employeeId: string,
): Promise<EmployeeSessionBinding> {
  return {
    employeeId,
    sessionId: await getEmployeeSession(employeeId),
  };
}
