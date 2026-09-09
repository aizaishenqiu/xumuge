import { mkdirRecursive, writeTextUnderWorkspace } from "../utils/fsBridge";
import { getAgencyRole, listAgencyRoles } from "../office/agencyRoles";
import type { RequirementBrief } from "./briefTypes";

function roleSkillSlug(nameZh: string, roleId: string): string {
  const base = (nameZh || roleId)
    .replace(/[^\w\u4e00-\u9fa5-]+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 40)
    .replace(/^-|-$/g, "");
  return base || roleId.slice(-8);
}

/**
 * Write matched custom role Skills to generatePath/.xu/skills/roles/{slug}/SKILL.md
 */
export async function scaffoldRoleSkillsForBrief(
  generatePath: string,
  brief: RequirementBrief,
): Promise<string[]> {
  const root = generatePath.replace(/[/\\]+$/, "");
  if (!root) return [];

  const ids = new Set([
    ...(brief.matchedRoleIds || []),
    ...(brief.matchPlan || []).map((p) => p.roleId),
  ]);
  const written: string[] = [];

  for (const roleId of ids) {
    const role = getAgencyRole(roleId);
    const skill = (role?.roleSkillMd || "").trim();
    if (!role || !skill) continue;
    const slug = roleSkillSlug(role.nameZh, role.id);
    const rel = `.xu/skills/roles/${slug}/SKILL.md`;
    await mkdirRecursive(root, `.xu/skills/roles/${slug}`);
    const header = `---
name: role-${slug}
description: 岗位「${role.nameZh}」自定义 Skill
briefVersion: ${brief.version || 0}
roleId: ${role.id}
updatedAt: ${brief.updatedAt}
---

`;
    const req = (role.roleRequirements || "").trim();
    const body = [
      header.trimEnd(),
      "",
      req ? `## 本岗需求说明\n\n${req}\n` : "",
      skill.startsWith("#") ? skill : `## 岗位 Skill\n\n${skill}`,
    ]
      .filter(Boolean)
      .join("\n");
    await writeTextUnderWorkspace(root, rel, body);
    written.push(`${root}/${rel}`.replace(/\\/g, "/"));
  }
  return written;
}

/** Find a QA-ish agency role id for acceptance rework. */
export function findQaRoleIdForRework(): string | null {
  const roles = listAgencyRoles();
  const qa = roles.find(
    (r) =>
      r.roleKind !== "boss" &&
      /测试|qa|质检|quality/i.test(`${r.nameZh} ${r.id} ${(r.tags || []).join(" ")}`),
  );
  return qa?.id || null;
}
