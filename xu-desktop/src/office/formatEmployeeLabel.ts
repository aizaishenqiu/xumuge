import { getAgencyRole } from "./agencyRoles";
import type { Employee, EmployeeStatus } from "../utils/employees";
import type { OfficeDisplayPrefs } from "../utils/officeDisplayPrefs";

export function statusLabel(status: EmployeeStatus): string {
  switch (status) {
    case "working":
      return "工作中";
    case "meeting":
      return "会议中";
    case "away":
      return "离开";
    default:
      return "空闲";
  }
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(1, max - 1))}…`;
}

function agencyTitle(emp: Employee): string {
  const role = getAgencyRole(emp.agentRoleId);
  return role?.nameZh?.trim() || emp.role?.trim() || "员工";
}

export function formatPrimaryLine(emp: Employee, prefs: OfficeDisplayPrefs): string {
  const name = truncate(emp.name.trim() || "员工", prefs.nameTruncate);
  const role = truncate(emp.role?.trim() || "员工", prefs.nameTruncate);
  const title = truncate(agencyTitle(emp), prefs.nameTruncate);
  switch (prefs.primaryFormat) {
    case "roleAndName":
      return `${role} · ${name}`;
    case "titleAndName":
      return `${title} ${name}`;
    default:
      return name;
  }
}

export function formatSecondaryLine(
  emp: Employee,
  prefs: OfficeDisplayPrefs,
  statusText?: string,
): string {
  const parts: string[] = [];
  if (prefs.showEmployeeNo && emp.employeeNo) {
    parts.push(emp.employeeNo);
  }
  switch (prefs.secondaryLine) {
    case "role":
      if (emp.role?.trim()) parts.push(emp.role.trim());
      break;
    case "status":
      parts.push(statusText?.trim() || statusLabel(emp.status));
      break;
    case "employeeNo":
      if (!prefs.showEmployeeNo && emp.employeeNo) parts.push(emp.employeeNo);
      break;
    default:
      break;
  }
  return parts.join(" · ");
}

/** Compact single-line label for 2D hover bar. */
export function formatCompactLabel(
  emp: Employee,
  prefs: OfficeDisplayPrefs,
  statusText?: string,
): string {
  const primary = formatPrimaryLine(emp, prefs);
  const secondary = formatSecondaryLine(emp, prefs, statusText);
  if (!secondary || prefs.secondaryLine === "none") return primary;
  return `${primary} · ${secondary}`;
}
