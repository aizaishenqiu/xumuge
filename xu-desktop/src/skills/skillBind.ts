/** Whether a skill should inject for this role / employee. Empty bind = global. */
export function skillAppliesTo(
  skill: { roleId?: string; employeeId?: string },
  roleId?: string | null,
  employeeId?: string | null,
): boolean {
  const r = (skill.roleId || "").trim();
  const e = (skill.employeeId || "").trim();
  if (!r && !e) return true;
  const wantRole = (roleId || "").trim();
  const wantEmp = (employeeId || "").trim();
  if (r && wantRole) {
    const base = wantRole.replace(/^software-company__/, "");
    if (r === wantRole || r === base || wantRole.endsWith(r) || r.endsWith(base)) return true;
  }
  if (e && wantEmp && e === wantEmp) return true;
  return false;
}
