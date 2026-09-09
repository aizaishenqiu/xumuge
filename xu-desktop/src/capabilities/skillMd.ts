import type { CapabilityPackManifest } from "./types";

function slugId(name: string): string {
  const ascii = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  if (ascii.length >= 2) return `skill-${ascii}`.slice(0, 48);
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `skill-${(h >>> 0).toString(16)}`;
}

function parseFrontMatter(raw: string): { meta: Record<string, string>; body: string } {
  const text = raw.replace(/^\uFEFF/, "");
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: text.trim() };
  const meta: Record<string, string> = {};
  for (const line of (m[1] || "").split(/\r?\n/)) {
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    let val = line.slice(idx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (key) meta[key] = val;
  }
  return { meta, body: (m[2] || "").trim() };
}

/** Parse agentskills-style SKILL.md into a light capability pack (local import only). */
export function parseSkillMarkdown(raw: string): Partial<CapabilityPackManifest> {
  const { meta, body } = parseFrontMatter(raw);
  let name = (meta.name || meta.title || "").trim();
  let description = (meta.description || "").trim();
  let hints = body;
  if (!name) {
    const hm = body.match(/^#\s+(.+)$/m);
    name = (hm?.[1] || "").trim();
    if (hm) hints = body.replace(hm[0], "").trim();
  }
  if (!name) throw new Error("SKILL.md 缺少 name / 一级标题");
  const id = (meta.id || "").trim() || slugId(name);
  if (!description) {
    description = hints.split("\n").find((l) => l.trim())?.trim().slice(0, 120) || name;
  }
  const roleId = (meta.roleId || meta.role_id || "").trim() || undefined;
  const employeeId = (meta.employeeId || meta.employee_id || "").trim() || undefined;
  return {
    id,
    name,
    description,
    version: (meta.version || "1.0.0").trim(),
    agentToolHints: `【导入技能 · ${name}】\n${hints}`.trim(),
    roleId,
    employeeId,
  };
}

export function looksLikeSkillMarkdown(raw: string, path?: string): boolean {
  const p = (path || "").toLowerCase();
  if (p.endsWith(".md") || p.endsWith("skill.md")) return true;
  const t = raw.trimStart();
  return t.startsWith("---") || /^#\s+\S/m.test(t.slice(0, 200));
}
