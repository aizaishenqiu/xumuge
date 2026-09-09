/**
 * Agency role catalog (加密岗位数据包).
 * Base: Tauri role_pack (.xupack) — metadata in memory, prompts lazy-loaded via Rust
 * Overrides: localStorage xu.agency_role_overrides
 * Custom: localStorage xu.agency_custom_roles
 */

import { ref } from "vue";
import { nextSnowflakeId } from "../utils/snowflake";
import { resolveLegacyAgencyRoleId } from "./agencyRoleIdMap";
import {
  inferKickoffWaveForCatalog,
  waveLabelForIndustry,
  type KickoffWave,
} from "./industryWorkflows";
import { resolveDivisionDisplayName, resolveRoleTaxonomy, isAsciiTaxonomySlug } from "./taxonomy";
import { getRolePackPrompt, listRolePackRoles } from "./rolePackApi";

/** 试用阶段安装包已嵌入全量岗位；不再按账号裁剪岗位列表。 */
function filterRolesForTrial(roles: AgencyRole[]): AgencyRole[] {
  return roles;
}

export type AgencyDivision = string;
export type { KickoffWave };

export interface AgencyRole {
  id: string;
  name: string;
  nameZh: string;
  emoji: string;
  division: AgencyDivision;
  divisionZh?: string;
  description: string;
  roleKind: "worker" | "reviewer" | "boss";
  brainSlot: "command" | "work" | "code";
  /** MCP allowlist string: empty | * | server.tool,... */
  mcpTools?: string;
  prompt: string;
  source: string;
  /** Industry-standard kickoff wave (planning → dev → qa → ops). */
  kickoffWave?: KickoffWave;
  /** Specialized / strategy facet labels for filtering (optional). */
  tags?: string[];
  /** 行业维 */
  industryId?: string;
  industryZh?: string;
  /** 岗位维 */
  positionId?: string;
  positionZh?: string;
  positionCategory?: string;
  positionCategoryZh?: string;
  /** 自定义岗：本岗需求说明（派活时注入，与项目 Brief 互补） */
  roleRequirements?: string;
  /** 自定义岗：岗位 Skill 正文（Markdown，等同 .cursor/skills 片段） */
  roleSkillMd?: string;
}

export type AgencyRoleOverride = {
  nameZh?: string;
  description?: string;
  prompt?: string;
};

export type CustomAgencyRoleInput = {
  nameZh: string;
  description?: string;
  prompt?: string;
  roleRequirements?: string;
  roleSkillMd?: string;
  division: AgencyDivision;
  roleKind?: AgencyRole["roleKind"];
  brainSlot?: AgencyRole["brainSlot"];
  emoji?: string;
  tags?: string[];
};

const OVERRIDES_KEY = "xu.agency_role_overrides";
const CUSTOM_KEY = "xu.agency_custom_roles";

const promptCache = new Map<string, string>();
const promptLoading = new Map<string, Promise<string>>();

function readOverrides(): Record<string, AgencyRoleOverride> {
  try {
    const raw = localStorage.getItem(OVERRIDES_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, AgencyRoleOverride>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function readCustomRoles(): AgencyRole[] {
  try {
    const raw = localStorage.getItem(CUSTOM_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as AgencyRole[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((r) => r && typeof r.id === "string" && (r.source === "custom" || r.id.startsWith("custom_")))
      .map(normalizeRole);
  } catch {
    return [];
  }
}

function writeCustomRoles(list: AgencyRole[]) {
  try {
    localStorage.setItem(CUSTOM_KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
}

function normalizeRole(r: AgencyRole): AgencyRole {
  const tags = Array.isArray(r.tags)
    ? [...new Set(r.tags.map((t) => String(t || "").trim()).filter(Boolean))]
    : undefined;
  const slug = r.source?.split("/").pop()?.replace(/\.md$/i, "") || r.id;
  const tax = resolveRoleTaxonomy({
    division: r.division,
    divisionZh: r.divisionZh,
    slug,
    nameZh: r.nameZh || r.name,
    industryId: r.industryId,
    industryZh: r.industryZh,
    positionId: r.positionId,
    positionZh: r.positionZh,
    positionCategory: r.positionCategory,
    positionCategoryZh: r.positionCategoryZh,
  });
  return {
    ...r,
    roleKind: r.roleKind === "reviewer" || r.roleKind === "boss" ? r.roleKind : "worker",
    brainSlot: r.brainSlot === "command" || r.brainSlot === "code" ? r.brainSlot : "work",
    nameZh: r.nameZh || r.name || "未命名岗位",
    name: r.name || r.nameZh || "custom",
    divisionZh: resolveDivisionDisplayName(r.division, r.divisionZh),
    description: r.description || "",
    prompt: r.prompt || "",
    emoji: r.emoji || "👤",
    source: r.source || "custom",
    kickoffWave: r.kickoffWave || inferKickoffWaveForCatalog(r.division, r.id),
    tags: tags?.length ? tags : undefined,
    roleRequirements: (r.roleRequirements || "").trim() || undefined,
    roleSkillMd: (r.roleSkillMd || "").trim() || undefined,
    ...tax,
  };
}

/** Bump to trigger Vue recomputes that depend on overrideVersion / catalog load. */
export const agencyOverrideVersion = ref(0);

let overridesCache = readOverrides();
let customRolesCache = readCustomRoles();
let baseRoles: AgencyRole[] = [];
let catalogSource = "";
let loadPromise: Promise<void> | null = null;

function applyOverride(r: AgencyRole): AgencyRole {
  const o = overridesCache[r.id];
  if (!o) return { ...r };
  return {
    ...r,
    nameZh: o.nameZh?.trim() || r.nameZh,
    description: o.description?.trim() || r.description,
    prompt: o.prompt?.trim() || r.prompt,
  };
}

const divOrder = [
  "engineering",
  "software-company",
  "design",
  "product",
  "project-management",
  "testing",
  "security",
  "marketing",
  "sales",
  "finance",
  "support",
  "strategy",
  "specialized",
  "academic",
  "game-development",
  "gis",
  "healthcare",
  "paid-media",
  "spatial-computing",
];

/** Mutated in place after catalog load (templates may hold references). */
export const AGENCY_DIVISIONS: Array<{ id: AgencyDivision; name: string }> = [];

/** @deprecated Prefer listAgencyRoles() */
export const AGENCY_ROLES: AgencyRole[] = [];

export const AGENCY_CATALOG_META = {
  source: "xupack",
  count: 0,
  repoUrl: "",
};

function allBaseAndCustom(): AgencyRole[] {
  return [...baseRoles, ...customRolesCache];
}

function rebuildDivisions() {
  const seen = new Map<string, string>();
  for (const r of allBaseAndCustom()) {
    if (!seen.has(r.division)) {
      seen.set(r.division, resolveDivisionDisplayName(r.division, r.divisionZh));
    } else {
      // Prefer a better Chinese name if a later role has one
      const cur = seen.get(r.division)!;
      const next = resolveDivisionDisplayName(r.division, r.divisionZh);
      if (isAsciiTaxonomySlug(cur) && !isAsciiTaxonomySlug(next)) {
        seen.set(r.division, next);
      }
    }
  }
  const next = [
    ...divOrder.filter((id) => seen.has(id)).map((id) => ({ id, name: seen.get(id)! })),
    ...[...seen.entries()]
      .filter(([id]) => !divOrder.includes(id))
      .map(([id, name]) => ({ id, name: resolveDivisionDisplayName(id, name) })),
  ];
  AGENCY_DIVISIONS.length = 0;
  AGENCY_DIVISIONS.push(...next);
  const merged = allBaseAndCustom();
  AGENCY_ROLES.length = 0;
  AGENCY_ROLES.push(...merged);
  AGENCY_CATALOG_META.source = catalogSource;
  AGENCY_CATALOG_META.count = merged.length;
}

function metaToAgencyRole(m: {
  id: string;
  slug?: string;
  name: string;
  nameZh: string;
  emoji: string;
  division: string;
  divisionZh: string;
  description: string;
  roleKind: string;
  brainSlot: string;
  kickoffWave?: string | null;
  mcpTools?: string | null;
  tags: string[];
  source: string;
  industryId?: string | null;
  industryZh?: string | null;
  positionId?: string | null;
  positionZh?: string | null;
  positionCategory?: string | null;
  positionCategoryZh?: string | null;
}): AgencyRole {
  const slug = m.slug || m.source?.split("/").pop()?.replace(/\.md$/i, "") || m.id;
  const tax = resolveRoleTaxonomy({
    division: m.division,
    divisionZh: m.divisionZh,
    slug,
    nameZh: m.nameZh,
    industryId: m.industryId ?? undefined,
    industryZh: m.industryZh ?? undefined,
    positionId: m.positionId ?? undefined,
    positionZh: m.positionZh ?? undefined,
    positionCategory: m.positionCategory ?? undefined,
    positionCategoryZh: m.positionCategoryZh ?? undefined,
  });
  return normalizeRole({
    id: m.id,
    name: m.name,
    nameZh: m.nameZh,
    emoji: m.emoji,
    division: m.division,
    divisionZh: m.divisionZh,
    description: m.description,
    roleKind: (m.roleKind as AgencyRole["roleKind"]) || "worker",
    brainSlot: m.brainSlot as AgencyRole["brainSlot"],
    mcpTools: (m.mcpTools || "").trim() || undefined,
    prompt: "",
    source: m.source,
    kickoffWave: (m.kickoffWave as AgencyRole["kickoffWave"]) || undefined,
    tags: m.tags,
    ...tax,
  });
}

/** Load agency catalog once from encrypted role packs. */
export function migrateAgencyRoleOverridesReadonly(): boolean {
  try {
    const migratedKey = "xu.agency_role_overrides_cleared_v1";
    if (localStorage.getItem(migratedKey)) return false;
    const had = Object.keys(overridesCache).length > 0;
    overridesCache = {};
    localStorage.removeItem(OVERRIDES_KEY);
    localStorage.setItem(migratedKey, "1");
    if (had) agencyOverrideVersion.value += 1;
    return had;
  } catch {
    return false;
  }
}

export function invalidateAgencyCatalog(): void {
  baseRoles = [];
  loadPromise = null;
}

export async function ensureAgencyCatalog(): Promise<void> {
  migrateAgencyRoleOverridesReadonly();
  if (baseRoles.length > 0) return;
  if (!loadPromise) {
    loadPromise = listRolePackRoles()
      .then((rows) => {
        if (!rows.length) {
          throw new Error(
            "岗位包为空：安装包仅含演示岗。请打开 设置 → 岗位数据，登录后下载云端全量包并重新加载。",
          );
        }
        catalogSource = "xupack";
        baseRoles = rows.map((r) => metaToAgencyRole(r));
        customRolesCache = readCustomRoles();
        rebuildDivisions();
        agencyOverrideVersion.value += 1;
      })
      .catch((e) => {
        loadPromise = null;
        throw e;
      });
  }
  await loadPromise;
}

/** Fetch full prompt from Rust (cached). Custom roles return stored prompt. */
export async function ensureAgencyRolePrompt(id: string | undefined | null): Promise<string> {
  if (!id) return "";
  const resolved = resolveLegacyAgencyRoleId(id);
  if (isCustomAgencyRole(resolved)) {
    return getAgencyRole(resolved)?.prompt || "";
  }
  const cached = promptCache.get(resolved);
  if (cached) return cached;
  let pending = promptLoading.get(resolved);
  if (!pending) {
    pending = getRolePackPrompt(resolved).then((p) => {
      const text = p || "";
      promptCache.set(resolved, text);
      const idx = baseRoles.findIndex((r) => r.id === resolved);
      if (idx >= 0) baseRoles[idx] = { ...baseRoles[idx], prompt: text };
      promptLoading.delete(resolved);
      agencyOverrideVersion.value += 1;
      return text;
    });
    promptLoading.set(resolved, pending);
  }
  return pending;
}

/** Ensure role object includes prompt (for editors / dispatch). */
export async function getAgencyRoleWithPrompt(
  id: string | undefined | null,
): Promise<AgencyRole | undefined> {
  const role = getAgencyRole(id);
  if (!role) return undefined;
  if (isCustomAgencyRole(role.id)) return role;
  if (!role.prompt?.trim()) {
    const prompt = await ensureAgencyRolePrompt(role.id);
    return applyOverride({ ...role, prompt });
  }
  return role;
}

export async function reloadAgencyCatalog(): Promise<number> {
  const { reloadRolePacks } = await import("./rolePackApi");
  invalidateAgencyCatalog();
  promptCache.clear();
  promptLoading.clear();
  const count = await reloadRolePacks();
  await ensureAgencyCatalog();
  return count;
}

/** Catalog roles are read-only; custom roles may still be edited locally. */
export function listAgencyRoles(): AgencyRole[] {
  void agencyOverrideVersion.value;
  return filterRolesForTrial(allBaseAndCustom().map((r) => (r.source === "custom" ? applyOverride(r) : r)));
}

export function isCustomAgencyRole(id: string | undefined | null): boolean {
  if (!id) return false;
  const role = allBaseAndCustom().find((r) => r.id === id);
  if (role?.source === "custom") return true;
  return id.startsWith("custom_");
}

export const LEGACY_DIVISION_ALIAS: Record<string, string> = {
  project: "project-management",
  qa: "testing",
  ops: "support",
};

export function getAgencyRole(id: string | undefined | null): AgencyRole | undefined {
  if (!id) return undefined;
  const resolved = resolveLegacyAgencyRoleId(id);
  const base = allBaseAndCustom().find((r) => r.id === resolved);
  if (!base) return undefined;
  return base.source === "custom" ? applyOverride(base) : base;
}

export function agencyRolesByDivision(division: AgencyDivision): AgencyRole[] {
  const key = LEGACY_DIVISION_ALIAS[division] || division;
  return listAgencyRoles().filter((r) => r.division === key || r.division === division);
}

export function agencyRolesByIndustry(industryId: string): AgencyRole[] {
  if (!industryId || industryId === "all") return listAgencyRoles();
  return listAgencyRoles().filter((r) => r.industryId === industryId);
}

export function agencyRolesByPositionCategory(categoryId: string): AgencyRole[] {
  if (!categoryId || categoryId === "all") return listAgencyRoles();
  return listAgencyRoles().filter((r) => r.positionCategory === categoryId);
}

/** 中文优先搜索：名称 / 部门 / 描述 / 提示词 / 英文名 / id */
export function searchAgencyRoles(query: string): AgencyRole[] {
  const q = query.trim().toLowerCase();
  const all = listAgencyRoles();
  if (!q) return all;
  return all.filter((r) => {
    const hay = [
      r.nameZh,
      r.name,
      r.divisionZh || "",
      r.division,
      r.industryZh || "",
      r.industryId || "",
      r.positionZh || "",
      r.positionId || "",
      r.positionCategoryZh || "",
      r.positionCategory || "",
      r.description,
      promptCache.get(r.id) || "",
      r.id,
      r.source,
      ...(r.tags || []),
    ]
      .join("\n")
      .toLowerCase();
    return hay.includes(q);
  });
}

/** Distinct tags across catalog (for 专项/战略筛选). */
export function listAgencyTags(): string[] {
  void agencyOverrideVersion.value;
  const set = new Set<string>();
  for (const r of listAgencyRoles()) {
    for (const t of r.tags || []) set.add(t);
  }
  return [...set].sort((a, b) => a.localeCompare(b, "zh"));
}

/** Parse「法务合规，智能体平台」style tag input. */
export function parseAgencyTagsInput(raw: string | undefined | null): string[] {
  if (!raw?.trim()) return [];
  return [
    ...new Set(
      raw
        .split(/[,，;；|、]/)
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ];
}

export function formatAgencyTagsInput(tags: string[] | undefined | null): string {
  return (tags || []).join("，");
}

export function getAgencyRoleOverride(id: string): AgencyRoleOverride | undefined {
  return overridesCache[id];
}

export function saveAgencyRoleOverride(id: string, patch: AgencyRoleOverride): AgencyRole {
  if (!isCustomAgencyRole(id)) {
    throw new Error("岗位库人设只读，不可本地微调。请通过岗位包更新或创建自定义岗位。");
  }
  if (isCustomAgencyRole(id)) {
    const cur = customRolesCache.find((r) => r.id === id);
    if (!cur) throw new Error("自定义岗位不存在");
    const nextRole = normalizeRole({
      ...cur,
      nameZh: patch.nameZh?.trim() || cur.nameZh,
      description: patch.description?.trim() ?? cur.description,
      prompt: patch.prompt?.trim() ?? cur.prompt,
    });
    customRolesCache = customRolesCache.map((r) => (r.id === id ? nextRole : r));
    writeCustomRoles(customRolesCache);
    rebuildDivisions();
    agencyOverrideVersion.value += 1;
    return applyOverride(nextRole);
  }
  const merged: AgencyRoleOverride = { ...(overridesCache[id] || {}), ...patch };
  for (const k of Object.keys(merged) as (keyof AgencyRoleOverride)[]) {
    if (!merged[k]?.trim()) delete merged[k];
  }
  const next = { ...overridesCache };
  if (Object.keys(merged).length === 0) delete next[id];
  else next[id] = merged;
  overridesCache = next;
  try {
    localStorage.setItem(OVERRIDES_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  agencyOverrideVersion.value += 1;
  return getAgencyRole(id)!;
}

export function resetAgencyRoleOverride(id: string): AgencyRole | undefined {
  if (isCustomAgencyRole(id)) return getAgencyRole(id);
  const next = { ...overridesCache };
  delete next[id];
  overridesCache = next;
  try {
    localStorage.setItem(OVERRIDES_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  agencyOverrideVersion.value += 1;
  return getAgencyRole(id);
}

export function addCustomAgencyRole(input: CustomAgencyRoleInput): AgencyRole {
  const nameZh = input.nameZh.trim();
  if (!nameZh) throw new Error("请填写岗位名称");
  const division = input.division.trim();
  if (!division) throw new Error("请选择分类");
  const divMeta = AGENCY_DIVISIONS.find((d) => d.id === division);
  const id = nextSnowflakeId();
  const role = normalizeRole({
    id,
    name: nameZh,
    nameZh,
    emoji: input.emoji?.trim() || "👤",
    division,
    divisionZh: divMeta?.name || division,
    description: (input.description || "").trim() || `${nameZh}（自定义岗位）`,
    roleKind: input.roleKind || "worker",
    brainSlot: input.brainSlot || "work",
    prompt:
      (input.prompt || "").trim() ||
      `你是「${nameZh}」。按岗位职责高质量完成老板交办的任务，用简洁中文汇报。`,
    source: "custom",
    tags: input.tags,
    roleRequirements: (input.roleRequirements || "").trim() || undefined,
    roleSkillMd: (input.roleSkillMd || "").trim() || undefined,
  });
  customRolesCache = [...customRolesCache, role];
  writeCustomRoles(customRolesCache);
  rebuildDivisions();
  agencyOverrideVersion.value += 1;
  return role;
}

export function updateCustomAgencyRole(
  id: string,
  patch: Partial<CustomAgencyRoleInput>,
): AgencyRole {
  if (!isCustomAgencyRole(id)) throw new Error("仅自定义岗位可改结构字段");
  const cur = customRolesCache.find((r) => r.id === id);
  if (!cur) throw new Error("自定义岗位不存在");
  const division = patch.division?.trim() || cur.division;
  const divMeta = AGENCY_DIVISIONS.find((d) => d.id === division);
  const next = normalizeRole({
    ...cur,
    nameZh: patch.nameZh?.trim() || cur.nameZh,
    name: patch.nameZh?.trim() || cur.name,
    description: patch.description !== undefined ? patch.description.trim() : cur.description,
    prompt: patch.prompt !== undefined ? patch.prompt.trim() : cur.prompt,
    roleRequirements:
      patch.roleRequirements !== undefined
        ? patch.roleRequirements.trim() || undefined
        : cur.roleRequirements,
    roleSkillMd:
      patch.roleSkillMd !== undefined ? patch.roleSkillMd.trim() || undefined : cur.roleSkillMd,
    division,
    divisionZh: divMeta?.name || division,
    roleKind: patch.roleKind || cur.roleKind,
    brainSlot: patch.brainSlot || cur.brainSlot,
    emoji: patch.emoji?.trim() || cur.emoji,
    tags: patch.tags !== undefined ? patch.tags : cur.tags,
  });
  customRolesCache = customRolesCache.map((r) => (r.id === id ? next : r));
  writeCustomRoles(customRolesCache);
  rebuildDivisions();
  agencyOverrideVersion.value += 1;
  return next;
}

export function removeCustomAgencyRole(id: string): boolean {
  if (!isCustomAgencyRole(id)) return false;
  const before = customRolesCache.length;
  customRolesCache = customRolesCache.filter((r) => r.id !== id);
  if (customRolesCache.length === before) return false;
  writeCustomRoles(customRolesCache);
  const ov = { ...overridesCache };
  delete ov[id];
  overridesCache = ov;
  try {
    localStorage.setItem(OVERRIDES_KEY, JSON.stringify(ov));
  } catch {
    /* ignore */
  }
  rebuildDivisions();
  agencyOverrideVersion.value += 1;
  return true;
}

export const BRAIN_SLOT_ZH: Record<string, string> = {
  command: "指挥脑",
  work: "工作脑",
  code: "代码脑",
};

export const ROLE_KIND_ZH: Record<string, string> = {
  worker: "员工",
  reviewer: "审核员",
  boss: "老板助理",
};

/** 岗位正文语言：full=正文以中文为主；shell=仅中文外壳+英文正文 */
export function agencyPromptLang(role: Pick<AgencyRole, "prompt" | "id"> | null | undefined): "full" | "shell" | "custom" {
  if (!role?.prompt) return "shell";
  if (isCustomAgencyRole(role.id)) return "custom";
  const marker = "—— 完整岗位说明 ——";
  const i = role.prompt.indexOf(marker);
  const body = i >= 0 ? role.prompt.slice(i + marker.length) : role.prompt;
  const sample = body.replace(/```[\s\S]*?```/g, "");
  const zh = (sample.match(/[\u4e00-\u9fff]/g) || []).length;
  const en = (sample.match(/[A-Za-z]/g) || []).length;
  const ratio = zh + en ? zh / (zh + en) : 0;
  return ratio >= 0.45 ? "full" : "shell";
}

export const PROMPT_LANG_ZH: Record<string, string> = {
  full: "全文中文",
  shell: "仅外壳",
  custom: "全文中文",
};

const PROMPT_BODY_MARKER = "—— 完整岗位说明 ——";

/** Prefer these body ## sections when assembling short dispatch persona. */
const DEFAULT_PERSONA_SECTION_HINTS = [
  "身份",
  "核心使命",
  "必须遵守",
  "硬约束",
  "交付",
  "范围",
  "规则",
];

/**
 * Task keywords → extra body section title hints (merged into short persona).
 * Keep patterns Chinese-first; English aliases for mixed tasks.
 */
const TASK_SECTION_KEYWORD_RULES: Array<{ re: RegExp; sections: string[] }> = [
  { re: /测试|验收|用例|回归|缺陷|质检|\bqa\b|\bbug\b/i, sections: ["测试", "验收", "质量", "交付", "验证"] },
  { re: /安全|漏洞|合规|权限|密钥|沙箱|渗透|等保|隐私/i, sections: ["安全", "合规", "硬约束", "规则", "必须遵守"] },
  { re: /重构|架构|性能|优化|技术债|接口|api|数据库/i, sections: ["范围", "架构", "规则", "硬约束", "交付"] },
  { re: /ui|界面|组件|设计|无障碍|视觉|交互|foucui/i, sections: ["设计", "交付", "硬约束", "核心使命"] },
  { re: /营销|投放|内容|运营|增长|seo|广告|私域/i, sections: ["增长", "内容", "交付", "核心使命"] },
  { re: /法务|合同|协议|知识产权|nda|诉讼/i, sections: ["法务", "合规", "规则", "必须遵守"] },
  { re: /会议|纪要|拍板|决策|汇报|催办|协调/i, sections: ["身份", "核心使命", "交付", "组织"] },
  { re: /部署|发布|运维|监控|故障|事故|sre|ci\/cd/i, sections: ["运维", "范围", "规则", "交付"] },
  { re: /招聘|入职|培训|组织|人力|hr/i, sections: ["人力", "身份", "交付"] },
  { re: /预算|成本|财务|发票|报价|套餐|用量/i, sections: ["财务", "交付", "规则"] },
];

/** Merge default section hints with extras inferred from the task text. */
export function resolvePersonaSectionsForTask(task: string, baseHints?: string[]): string[] {
  const out = new Set((baseHints?.length ? baseHints : DEFAULT_PERSONA_SECTION_HINTS).map((h) => h));
  const text = (task || "").trim();
  if (!text) return [...out];
  for (const rule of TASK_SECTION_KEYWORD_RULES) {
    if (!rule.re.test(text)) continue;
    for (const s of rule.sections) out.add(s);
  }
  return [...out];
}

export type AgencyPromptSection = { title: string; content: string };

export function splitAgencyPrompt(prompt: string): { shell: string; body: string } {
  const i = (prompt || "").indexOf(PROMPT_BODY_MARKER);
  if (i < 0) return { shell: prompt || "", body: "" };
  return {
    shell: prompt.slice(0, i).trim(),
    body: prompt.slice(i + PROMPT_BODY_MARKER.length).replace(/^\s*\n/, ""),
  };
}

/** Parse markdown ## / ### headings in the body into sections. */
export function parseAgencyPromptSections(prompt: string): AgencyPromptSection[] {
  const { body } = splitAgencyPrompt(prompt);
  if (!body.trim()) return [];
  const parts = body.split(/\n(?=#{2,3}\s+)/);
  const out: AgencyPromptSection[] = [];
  for (const part of parts) {
    const m = part.match(/^#{2,3}\s+(.+?)\s*\n([\s\S]*)$/);
    if (!m) continue;
    const title = m[1].replace(/[^\u4e00-\u9fffA-Za-z0-9（）()\-_/·\s]/g, "").trim();
    const content = m[2].trim();
    if (title && content) out.push({ title, content });
  }
  return out;
}

/**
 * Dispatch-size persona: identity + compact CN context + selected body sections.
 * Pass `task` to dynamically widen section hints from keywords.
 */
export function buildAgencyShortPersona(
  role: Pick<AgencyRole, "id" | "nameZh" | "name" | "description" | "roleKind" | "brainSlot" | "prompt">,
  opts?: { includeSections?: string[]; task?: string; maxChars?: number },
): string {
  const hints = (
    opts?.includeSections?.length
      ? opts.includeSections
      : resolvePersonaSectionsForTask(opts?.task || "")
  ).map((h) => h.toLowerCase());
  const extra = Math.max(0, hints.length - DEFAULT_PERSONA_SECTION_HINTS.length);
  const maxChars = opts?.maxChars ?? Math.min(3600, 2200 + extra * 280);
  const kind = ROLE_KIND_ZH[role.roleKind] || role.roleKind;
  const slot = BRAIN_SLOT_ZH[role.brainSlot] || role.brainSlot;
  const lines: string[] = [
    `你是「${role.nameZh || role.name}」。`,
    `类型：${kind} · 脑槽：${slot}`,
  ];
  if (role.description?.trim()) {
    lines.push(`简介：${role.description.trim()}`);
  }
  lines.push(
    "中国语境（摘要）：默认简体中文；法规映射国内要求；协作优先飞书/企微/钉钉；汇报结论先行，交付含假设/步骤/验收。",
  );

  const sections = parseAgencyPromptSections(role.prompt || "");
  const picked: string[] = [];
  const seen = new Set<string>();
  for (const sec of sections) {
    const t = sec.title.toLowerCase();
    if (!hints.some((h) => t.includes(h))) continue;
    const key = sec.title;
    if (seen.has(key)) continue;
    seen.add(key);
    picked.push(`## ${sec.title}\n${sec.content}`);
  }
  if (picked.length === 0 && sections[0]) {
    picked.push(`## ${sections[0].title}\n${sections[0].content}`);
  }

  let text = [...lines, "", "【岗位要点】", ...picked].join("\n").trim();
  if (text.length > maxChars) {
    text = `${text.slice(0, maxChars - 12).trim()}\n…（已截断）`;
  }
  return text;
}

/** Custom role requirements + Skill markdown for dispatch work pack. */
export function buildRoleAgencyPack(
  role: Pick<AgencyRole, "nameZh" | "roleRequirements" | "roleSkillMd"> | null | undefined,
): string {
  if (!role) return "";
  const req = (role.roleRequirements || "").trim();
  const skill = (role.roleSkillMd || "").trim();
  if (!req && !skill) return "";
  const lines: string[] = ["【岗位自定义 · 需求与 Skill】"];
  if (req) {
    lines.push("## 本岗需求说明", req);
  }
  if (skill) {
    lines.push("## 本岗 Skill（按此执行，优先级高于泛化猜测）", skill);
  }
  return lines.join("\n");
}

export type AgencyLocalBundle = {
  version: 1;
  exportedAt: string;
  overrides: Record<string, AgencyRoleOverride>;
  customRoles: AgencyRole[];
};

export function exportAgencyLocalBundle(): AgencyLocalBundle {
  void agencyOverrideVersion.value;
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    overrides: { ...overridesCache },
    customRoles: customRolesCache.map((r) => ({ ...r })),
  };
}

export function importAgencyLocalBundle(
  data: unknown,
  mode: "merge" | "replace" = "merge",
): { overrides: number; custom: number } {
  if (!data || typeof data !== "object") throw new Error("无效的导入文件");
  const raw = data as Partial<AgencyLocalBundle>;
  const overridesIn =
    raw.overrides && typeof raw.overrides === "object" && !Array.isArray(raw.overrides)
      ? (raw.overrides as Record<string, AgencyRoleOverride>)
      : {};
  const customIn = Array.isArray(raw.customRoles)
    ? raw.customRoles
        .filter(
          (r) =>
            r &&
            typeof r.id === "string" &&
            (r.source === "custom" || r.id.startsWith("custom_") || /^\d+$/.test(r.id)),
        )
        .map(normalizeRole)
    : [];

  if (mode === "replace") {
    overridesCache = { ...overridesIn };
    customRolesCache = customIn;
  } else {
    overridesCache = { ...overridesCache, ...overridesIn };
    const byId = new Map(customRolesCache.map((r) => [r.id, r]));
    for (const r of customIn) byId.set(r.id, r);
    customRolesCache = [...byId.values()];
  }

  try {
    localStorage.setItem(OVERRIDES_KEY, JSON.stringify(overridesCache));
  } catch {
    /* ignore */
  }
  writeCustomRoles(customRolesCache);
  rebuildDivisions();
  agencyOverrideVersion.value += 1;
  return { overrides: Object.keys(overridesIn).length, custom: customIn.length };
}

/** Browser download of local overrides + custom roles JSON. */
export function downloadAgencyLocalBundle(filename = "xu-agency-local.json"): void {
  const blob = new Blob([JSON.stringify(exportAgencyLocalBundle(), null, 2)], {
    type: "application/json;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Display label for catalog kickoff wave (software SDLC baseline). */
export function kickoffWaveLabel(wave?: KickoffWave | null): string {
  if (!wave) return "—";
  return waveLabelForIndustry(wave, "software");
}
