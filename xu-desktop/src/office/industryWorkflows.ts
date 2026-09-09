/**
 * Industry-standard kickoff pipeline templates (not project-specific).
 * Wave keys are shared; labels and order vary by ProjectType.
 */
import type { ProjectType } from "../utils/projects";

export type KickoffWave = "planning" | "design" | "dev" | "qa" | "security" | "ops" | "other";

export type IndustryWorkflowTemplate = {
  id: ProjectType;
  nameZh: string;
  waves: KickoffWave[];
  waveLabels: Record<KickoffWave, string>;
  /** Default wave when catalog has no kickoffWave (custom roles). */
  divisionDefault: Record<string, KickoffWave>;
  /** Per-role overrides (catalog id). */
  roleIdOverrides: Record<string, KickoffWave>;
};

const SOFTWARE_DIVISION_DEFAULT: Record<string, KickoffWave> = {
  product: "planning",
  design: "design",
  "project-management": "planning",
  strategy: "planning",
  academic: "planning",
  engineering: "dev",
  "software-company": "dev",
  "game-development": "dev",
  gis: "dev",
  "spatial-computing": "dev",
  integrations: "dev",
  testing: "qa",
  security: "security",
  marketing: "other",
  sales: "other",
  finance: "other",
  support: "other",
  healthcare: "other",
  "paid-media": "other",
  specialized: "other",
};

const SOFTWARE_ROLE_OVERRIDES: Record<string, KickoffWave> = {
  "7857282669250483458": "planning",
  "6498566562038029790": "qa",
  "32413536923064341397": "ops",
  "8006305619126655581": "ops",
  "28289746272528766400": "planning",
  "15116902864854847567": "planning",
  "4416039595775497713": "planning",
  "16599486053199517788": "ops",
  "22149760307607770316": "qa",
  "7284391915586459989": "qa",
  "26786141295500991319": "planning",
  "32558903181967495702": "planning",
  "19885543485759165641": "planning",
  "35671419686152705612": "planning",
};

const SOFTWARE_WAVE_LABELS: Record<KickoffWave, string> = {
  planning: "需求/产品",
  design: "产品设计",
  dev: "开发",
  qa: "测试",
  security: "安全审查",
  ops: "运维与下一轮需求",
  other: "其他",
};

const DELIVERY_WAVE_LABELS: Record<KickoffWave, string> = {
  planning: "对齐/方案",
  design: "设计",
  dev: "实施",
  qa: "验收",
  security: "安全审查",
  ops: "运维",
  other: "其他",
};

const CONSULTING_WAVE_LABELS: Record<KickoffWave, string> = {
  planning: "调研",
  design: "设计",
  dev: "分析/交付",
  qa: "评审",
  security: "安全审查",
  ops: "运维",
  other: "其他",
};

const INTERNAL_WAVE_LABELS: Record<KickoffWave, string> = {
  planning: "规划",
  design: "设计",
  dev: "执行",
  qa: "检查",
  security: "安全审查",
  ops: "收尾",
  other: "其他",
};

export const INDUSTRY_WORKFLOWS: Record<ProjectType, IndustryWorkflowTemplate> = {
  software: {
    id: "software",
    nameZh: "软件研发",
    waves: ["planning", "design", "dev", "qa", "security", "ops", "other"],
    waveLabels: SOFTWARE_WAVE_LABELS,
    divisionDefault: SOFTWARE_DIVISION_DEFAULT,
    roleIdOverrides: SOFTWARE_ROLE_OVERRIDES,
  },
  delivery: {
    id: "delivery",
    nameZh: "交付实施",
    waves: ["planning", "dev", "qa", "ops", "other"],
    waveLabels: DELIVERY_WAVE_LABELS,
    divisionDefault: {
      ...SOFTWARE_DIVISION_DEFAULT,
      design: "planning",
      "project-management": "planning",
      support: "dev",
      sales: "planning",
    },
    roleIdOverrides: {
      ...SOFTWARE_ROLE_OVERRIDES,
      "28644007349028265882": "planning",
      "22740845207589362602": "planning",
    },
  },
  consulting: {
    id: "consulting",
    nameZh: "咨询服务",
    waves: ["planning", "dev", "qa", "other"],
    waveLabels: CONSULTING_WAVE_LABELS,
    divisionDefault: {
      ...SOFTWARE_DIVISION_DEFAULT,
      design: "planning",
      strategy: "planning",
      academic: "planning",
      finance: "dev",
    },
    roleIdOverrides: SOFTWARE_ROLE_OVERRIDES,
  },
  internal: {
    id: "internal",
    nameZh: "内部事务",
    waves: ["planning", "dev", "qa", "other"],
    waveLabels: INTERNAL_WAVE_LABELS,
    divisionDefault: {
      ...SOFTWARE_DIVISION_DEFAULT,
      design: "planning",
    },
    roleIdOverrides: SOFTWARE_ROLE_OVERRIDES,
  },
  other: {
    id: "other",
    nameZh: "其他",
    waves: ["planning", "dev", "qa", "ops", "other"],
    waveLabels: SOFTWARE_WAVE_LABELS,
    divisionDefault: {
      ...SOFTWARE_DIVISION_DEFAULT,
      design: "planning",
    },
    roleIdOverrides: SOFTWARE_ROLE_OVERRIDES,
  },
};

/** In-memory overrides from {XU_HOME}/workflow-overrides (populated by resolveIndustryWorkflow). */
const overrideCache = new Map<ProjectType, IndustryWorkflowTemplate>();

export function getBuiltinIndustryWorkflow(
  type: ProjectType | null | undefined,
): IndustryWorkflowTemplate {
  if (type && INDUSTRY_WORKFLOWS[type]) return INDUSTRY_WORKFLOWS[type];
  return INDUSTRY_WORKFLOWS.software;
}

/** Sync read: builtin merged with last resolved override (if any). */
export function getIndustryWorkflow(type: ProjectType | null | undefined): IndustryWorkflowTemplate {
  const id = (type && INDUSTRY_WORKFLOWS[type] ? type : "software") as ProjectType;
  const cached = overrideCache.get(id);
  if (cached) return cached;
  return getBuiltinIndustryWorkflow(id);
}

export function setIndustryWorkflowCache(tpl: IndustryWorkflowTemplate): void {
  overrideCache.set(tpl.id, tpl);
}

export function clearIndustryWorkflowCache(industryId?: ProjectType): void {
  if (industryId) overrideCache.delete(industryId);
  else overrideCache.clear();
}

/**
 * Load builtin template, merge XU_HOME override, and refresh sync cache.
 * Kickoff / Studio should prefer this before dispatch.
 */
export async function resolveIndustryWorkflow(
  type: ProjectType | null | undefined,
): Promise<IndustryWorkflowTemplate> {
  const { loadWorkflowOverrideFile, mergeWorkflowOverride } = await import("./workflowOverrides");
  const builtin = getBuiltinIndustryWorkflow(type);
  const raw = await loadWorkflowOverrideFile(builtin.id);
  const merged = mergeWorkflowOverride(builtin, raw);
  overrideCache.set(merged.id, merged);
  return merged;
}

export async function persistIndustryWorkflowOverride(
  tpl: IndustryWorkflowTemplate,
): Promise<void> {
  const { saveWorkflowOverrideFile } = await import("./workflowOverrides");
  await saveWorkflowOverrideFile(tpl);
  overrideCache.set(tpl.id, tpl);
}

export async function restoreOfficialIndustryWorkflow(
  industryId: ProjectType,
): Promise<IndustryWorkflowTemplate> {
  const { clearWorkflowOverrideFile } = await import("./workflowOverrides");
  await clearWorkflowOverrideFile(industryId);
  overrideCache.delete(industryId);
  return getBuiltinIndustryWorkflow(industryId);
}

export function kickoffWaveOrderForIndustry(type: ProjectType | null | undefined): KickoffWave[] {
  return [...getIndustryWorkflow(type).waves];
}

export function waveLabelForIndustry(w: KickoffWave, type: ProjectType | null | undefined): string {
  const tpl = getIndustryWorkflow(type);
  return tpl.waveLabels[w] || SOFTWARE_WAVE_LABELS[w];
}

/** Regex fallback when catalog lacks kickoffWave. */
export function inferKickoffWaveFromText(hay: string): KickoffWave {
  const SECURITY_RE = /安全|渗透|appsec|等保|secops|漏洞|威胁建模/i;
  const QA_RE = /测试|qa\b|quality|质检|质量|reviewer|审核/i;
  const DEV_RE =
    /工程|开发|前端|后端|全栈|工程师|developer|architect|desktop|tauri|flutter|android|ios|服务端|api/i;
  const DESIGN_RE = /设计|ux|ui\b|视觉|原型|线框|交互设计|界面设计/i;
  const PLANNING_RE = /产品|需求|pm\b|规划|项目经理|编排|prd|文档|writer/i;
  const OPS_RE = /运维|devops|部署|secops|sre/i;
  if (SECURITY_RE.test(hay)) return "security";
  if (QA_RE.test(hay)) return "qa";
  if (DEV_RE.test(hay)) return "dev";
  if (DESIGN_RE.test(hay)) return "design";
  if (PLANNING_RE.test(hay)) return "planning";
  if (OPS_RE.test(hay)) return "ops";
  return "other";
}

/**
 * Canonical tagging rule (software SDLC) — used by catalog script and runtime fallback.
 */
export function inferKickoffWaveForCatalog(division: string, roleId: string): KickoffWave {
  if (SOFTWARE_ROLE_OVERRIDES[roleId]) return SOFTWARE_ROLE_OVERRIDES[roleId];
  const baseId = roleId.replace(/^software-company__/, "");
  if (SOFTWARE_ROLE_OVERRIDES[baseId]) return SOFTWARE_ROLE_OVERRIDES[baseId];

  const div = SOFTWARE_DIVISION_DEFAULT[division];
  if (div) return div;

  return inferKickoffWaveFromText(`${division} ${roleId}`);
}

export function resolveKickoffWave(opts: {
  catalogWave?: KickoffWave | null;
  roleId?: string | null;
  division?: string | null;
  haystack?: string;
  industry: ProjectType;
}): KickoffWave {
  const tpl = getIndustryWorkflow(opts.industry);
  const rid = (opts.roleId || "").trim();
  const div = (opts.division || "").trim();

  // Software: design division always maps to design wave (even if catalog says planning).
  if (opts.industry === "software" && div === "design") {
    return "design";
  }
  if (
    opts.industry === "software" &&
    opts.haystack &&
    /设计|ux|ui\b|视觉|原型|线框/i.test(opts.haystack) &&
    !/工程|开发|前端|后端|全栈|测试|qa/i.test(opts.haystack)
  ) {
    return "design";
  }

  if (opts.catalogWave) {
    // Normalize unknown catalog values; remap planning→design for design roles already handled.
    if (opts.catalogWave === "design") return "design";
    return opts.catalogWave;
  }

  if (rid && tpl.roleIdOverrides[rid]) return tpl.roleIdOverrides[rid];
  const baseId = rid.replace(/^software-company__/, "");
  if (baseId && tpl.roleIdOverrides[baseId]) return tpl.roleIdOverrides[baseId];

  if (div && tpl.divisionDefault[div]) return tpl.divisionDefault[div];

  if (div || rid) {
    const fromCatalog = inferKickoffWaveForCatalog(div, rid);
    if (fromCatalog !== "other") return fromCatalog;
  }

  if (opts.haystack) return inferKickoffWaveFromText(opts.haystack);
  return "other";
}

export function industryPipelineSummary(type: ProjectType): string {
  if (type === "software") {
    return "需求 → 产品设计 → 技术方案 → 开发 → 代码Review → 测试 → 安全审查 → UAT → 发布 → 运维迭代";
  }
  const tpl = getIndustryWorkflow(type);
  return tpl.waves.map((w) => tpl.waveLabels[w]).join(" → ");
}
