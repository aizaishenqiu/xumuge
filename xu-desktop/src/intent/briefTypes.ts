/**
 * @file 需求 Brief、结构化需求与追踪矩阵模型
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-30
 * @version 1.2.0
 * @category Parse
 * @algo FNV-1a-stable-id
 */
export type BriefStatus = "gathering" | "ready" | "executing";

export type RequirementDimension =
  | "goal_scope"
  | "data_lifecycle"
  | "external_api"
  | "roles_threats"
  | "privacy_compliance"
  | "performance_sla"
  | "deployment_rollback"
  | "observability"
  | "compatibility"
  | "i18n_a11y"
  | "test_acceptance_env";

export type RequirementSource = "user" | "legacy" | "analyst" | "review" | "qa" | "system";
export type RequirementPriority = "must" | "should" | "could" | "wont";
export type RequirementStatus =
  | "draft"
  | "confirmed"
  | "in_progress"
  | "passed"
  | "failed"
  | "blocked"
  | "waived";

export interface RequirementAcceptanceCriterion {
  id: string;
  text: string;
  status: "pending" | "passed" | "failed" | "waived";
  evidence?: string;
}

export interface StructuredRequirement {
  id: string;
  dimension: RequirementDimension;
  title: string;
  detail: string;
  source: RequirementSource;
  priority: RequirementPriority;
  acceptanceCriteria: RequirementAcceptanceCriterion[];
  status: RequirementStatus;
  conflicts: string[];
}

export interface RequirementTraceRow {
  requirementId: string;
  dimension: RequirementDimension;
  priority: RequirementPriority;
  requirement: string;
  acceptanceIds: string[];
  status: RequirementStatus;
  conflicts: string[];
}

/** Task → role → acceptance row for kickoff matching. */
export interface RoleMatchItem {
  roleId: string;
  roleNameZh: string;
  task: string;
  acceptance: string[];
}

/** Software page / screen inventory for design-before-code. */
export type BriefPageStatus = "draft" | "designed" | "confirmed";

export type BriefPageSourceKind = "upload" | "html" | "canvas" | "svg";

export interface BriefPage {
  id: string;
  name: string;
  route?: string;
  purpose?: string;
  status: BriefPageStatus;
  /** Relative to generatePath, e.g. .xu/design/approved/login.svg */
  chosenDesignPath?: string;
  /** Relative preview path (HTML or image under .xu/design/). */
  previewPath?: string;
  sourceKind?: BriefPageSourceKind;
}

export type DesignMode = "upload" | "html" | "canvas";

/** 工作模式：决定 Brief 题库与是否弹窗收集 */
export type WorkMode = "software_build" | "delivery" | "operation" | "question";

export type DeliveryComplexity = "simple" | "complex";

/** 使用规模档位（软件立项架构 sizing） */
export type UsageScaleTier = "personal" | "team" | "org" | "saas" | "unspecified";

/** 身份与组织/租户模型 */
export type IdentityModel =
  | "none"
  | "simple_account"
  | "member_portal"
  | "multi_tenant"
  | "hybrid"
  | "unspecified";

const USAGE_SCALE_TIERS = new Set<UsageScaleTier>([
  "personal",
  "team",
  "org",
  "saas",
  "unspecified",
]);

const IDENTITY_MODELS = new Set<IdentityModel>([
  "none",
  "simple_account",
  "member_portal",
  "multi_tenant",
  "hybrid",
  "unspecified",
]);

export function parseUsageScaleTier(raw: unknown): UsageScaleTier {
  const s = String(raw || "").trim() as UsageScaleTier;
  return USAGE_SCALE_TIERS.has(s) ? s : "unspecified";
}

export function parseIdentityModel(raw: unknown): IdentityModel {
  const s = String(raw || "").trim() as IdentityModel;
  return IDENTITY_MODELS.has(s) ? s : "unspecified";
}

export function isUsageScaleSpecified(tier?: UsageScaleTier): boolean {
  return Boolean(tier && tier !== "unspecified");
}

export function isIdentityModelSpecified(model?: IdentityModel): boolean {
  return Boolean(model && model !== "unspecified");
}

export function formatUsageScaleLabel(tier?: UsageScaleTier): string {
  switch (tier) {
    case "personal":
      return "个人/演示（<10）";
    case "team":
      return "小团队（10~200）";
    case "org":
      return "单组织（200~5000）";
    case "saas":
      return "多客户/SaaS";
    default:
      return "未指定规模";
  }
}

export function formatIdentityModelLabel(model?: IdentityModel): string {
  switch (model) {
    case "none":
      return "无登录/单机";
    case "simple_account":
      return "单组织账号";
    case "member_portal":
      return "C 端会员";
    case "multi_tenant":
      return "多租户 B 端";
    case "hybrid":
      return "B+C 混合";
    default:
      return "未指定身份模型";
  }
}

/** 从用户自然语言推断规模档位（供 absorb 使用）。 */
export function inferUsageScaleTier(text: string): UsageScaleTier | null {
  const t = text.toLowerCase();
  if (/多租户|multi.?tenant|saas|多企业|租户隔离|b2b\s*saas|多企业\s*saas/i.test(t)) return "saas";
  if (/单组织|几百~几千|200~5000|一家公司|集团内|园区/i.test(t)) return "org";
  if (/小团队|10~200|10-200|部门内/i.test(t)) return "team";
  if (/个人|演示|原型|内部试用|<\s*50|几十人|个人演示/i.test(t)) return "personal";
  if (/几千|上万|5000|大规模|高并发/i.test(t)) return "org";
  if (/几百|200|500/i.test(t)) return "team";
  return null;
}

/** 从用户自然语言推断身份模型。 */
export function inferIdentityModel(text: string): IdentityModel | null {
  const t = text.toLowerCase();
  if (/多租户\s*b|multi.?tenant|租户管理员|多租户 b/i.test(t)) return "multi_tenant";
  if (/b\+c|b\+c 混合|b端.*c端|混合登录|双端会员/i.test(t)) return "hybrid";
  if (/c\s*端会员|c端会员|会员登录|注册会员/i.test(t)) return "member_portal";
  if (/无登录|不需要登录|单机|离线/i.test(t)) return "none";
  if (/单组织账号|账号密码|单组织|管理员登录|内部账号/i.test(t)) return "simple_account";
  if (/多租户|tenant/i.test(t)) return "multi_tenant";
  return null;
}

export function formatArchitectureConstraintLine(b: RequirementBrief): string {
  const scale = isUsageScaleSpecified(b.usageScaleTier)
    ? formatUsageScaleLabel(b.usageScaleTier)
    : b.audience?.trim() || "规模待澄清";
  const identity = isIdentityModelSpecified(b.identityModel)
    ? formatIdentityModelLabel(b.identityModel)
    : b.architectureNotes?.trim().slice(0, 80) || "身份/租户待澄清";
  return `架构约束：${scale} · ${identity}；未 Boss 确认前不得扩大租户/会员/计费范围`;
}

export interface RequirementBrief {
  projectId: string;
  status: BriefStatus;
  goal: string;
  /** 规则分类的工作模式（影响缺口题库） */
  workMode?: WorkMode;
  /** delivery 模式下的复杂度；simple 不弹窗 */
  deliveryComplexity?: DeliveryComplexity;
  industry?: string;
  constraints: string[];
  decisions: string[];
  openQuestions: string[];
  /** All remaining gap questions (for UI reopen); cleared on ready. */
  pendingGapQuestions?: string[];
  acceptance: string[];
  scopeIn: string[];
  scopeOut: string[];
  /** MoSCoW：必须 / 应该 / 可以 / 不做 */
  must?: string[];
  should?: string[];
  could?: string[];
  wont?: string[];
  /** UI/UX、参考竞品、主色调（软件项目澄清维度） */
  uxNotes?: string;
  /** 用户画像与规模预估 */
  audience?: string;
  /** 结构化规模档位 */
  usageScaleTier?: UsageScaleTier;
  /** 结构化身份/租户模型 */
  identityModel?: IdentityModel;
  /** 系统边界、端划分、架构倾向 */
  architectureNotes?: string;
  /** Canonical requirement list; legacy scalar fields remain for old Brief/UI compatibility. */
  requirements?: StructuredRequirement[];
  /** Explicit user confirmation. A content update clears this and reopens the gate. */
  requirementsConfirmedAt?: number;
  /** Last computed completeness score, 0–100; informative, never a round-limit bypass. */
  requirementGapScore?: number;
  matchedRoleIds: string[];
  /** Structured match table (preferred over bare matchedRoleIds). */
  matchPlan: RoleMatchItem[];
  /** Software: screens to wireframe then confirm before coding. */
  pages?: BriefPage[];
  /** Design path: upload | html preview | canvas wireframe. */
  designMode?: DesignMode;
  /** After approve: frozen until bump + re-confirm. */
  designFrozen?: boolean;
  /** Bumps when Brief content changes enough to rewrite project Skills. */
  version: number;
  clarifyRound: number;
  updatedAt: number;
}

export function emptyBrief(projectId: string): RequirementBrief {
  return {
    projectId,
    status: "gathering",
    goal: "",
    industry: "",
    constraints: [],
    decisions: [],
    openQuestions: [],
    pendingGapQuestions: [],
    acceptance: [],
    scopeIn: [],
    scopeOut: [],
    must: [],
    should: [],
    could: [],
    wont: [],
    uxNotes: "",
    audience: "",
    usageScaleTier: "unspecified",
    identityModel: "unspecified",
    architectureNotes: "",
    requirements: [],
    requirementsConfirmedAt: undefined,
    requirementGapScore: 0,
    matchedRoleIds: [],
    matchPlan: [],
    pages: [],
    designMode: undefined,
    designFrozen: false,
    version: 0,
    clarifyRound: 0,
    updatedAt: Date.now(),
  };
}

function normalizeStableText(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36).padStart(7, "0");
}

/** 为同一语义内容生成稳定 ID；依赖维度与规范化文本，失败时返回可持久化占位 ID。 */
export function stableRequirementId(
  dimension: RequirementDimension,
  detail: string,
  prefix = "REQ",
): string {
  return `${prefix}-${dimension.replace(/_/g, "-").toUpperCase()}-${fnv1a(
    `${dimension}:${normalizeStableText(detail) || "unspecified"}`,
  )}`;
}

/** 创建规范需求项；依赖明确维度与文本，验收文本为空时使用需求正文兜底。 */
export function createStructuredRequirement(opts: {
  dimension: RequirementDimension;
  title: string;
  detail: string;
  source?: RequirementSource;
  priority?: RequirementPriority;
  acceptance?: string[];
  status?: RequirementStatus;
  conflicts?: string[];
  id?: string;
}): StructuredRequirement {
  const detail = opts.detail.trim();
  const id = opts.id?.trim() || stableRequirementId(opts.dimension, detail);
  const acceptance = (opts.acceptance?.length ? opts.acceptance : [detail]).filter(
    (text) => text.trim(),
  );
  return {
    id,
    dimension: opts.dimension,
    title: opts.title.trim() || detail.slice(0, 60),
    detail,
    source: opts.source || "analyst",
    priority: opts.priority || "must",
    acceptanceCriteria: acceptance.map((text) => ({
      id: stableRequirementId(opts.dimension, `${id}:${text}`, "AC"),
      text: text.trim(),
      status: "pending",
    })),
    status: opts.status || "draft",
    conflicts: [...new Set((opts.conflicts || []).map((x) => x.trim()).filter(Boolean))],
  };
}

function normalizeCriterion(
  raw: Partial<RequirementAcceptanceCriterion>,
  requirementId: string,
  dimension: RequirementDimension,
): RequirementAcceptanceCriterion | null {
  const text = String(raw.text || "").trim();
  if (!text) return null;
  const status =
    raw.status === "passed" ||
    raw.status === "failed" ||
    raw.status === "waived" ||
    raw.status === "pending"
      ? raw.status
      : "pending";
  return {
    id: String(raw.id || "").trim() || stableRequirementId(dimension, `${requirementId}:${text}`, "AC"),
    text,
    status,
    evidence: String(raw.evidence || "").trim() || undefined,
  };
}

const REQUIREMENT_DIMENSIONS = new Set<RequirementDimension>([
  "goal_scope",
  "data_lifecycle",
  "external_api",
  "roles_threats",
  "privacy_compliance",
  "performance_sla",
  "deployment_rollback",
  "observability",
  "compatibility",
  "i18n_a11y",
  "test_acceptance_env",
]);

/** 规范化已持久化需求；保留合法旧 ID，缺失字段以兼容默认值补齐。 */
export function normalizeStructuredRequirements(raw: unknown): StructuredRequirement[] {
  if (!Array.isArray(raw)) return [];
  const byId = new Map<string, StructuredRequirement>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Partial<StructuredRequirement>;
    if (!REQUIREMENT_DIMENSIONS.has(o.dimension as RequirementDimension)) continue;
    const dimension = o.dimension as RequirementDimension;
    const detail = String(o.detail || "").trim();
    if (!detail) continue;
    const id = String(o.id || "").trim() || stableRequirementId(dimension, detail);
    const status: RequirementStatus =
      o.status === "confirmed" ||
      o.status === "in_progress" ||
      o.status === "passed" ||
      o.status === "failed" ||
      o.status === "blocked" ||
      o.status === "waived"
        ? o.status
        : "draft";
    const priority: RequirementPriority =
      o.priority === "should" || o.priority === "could" || o.priority === "wont"
        ? o.priority
        : "must";
    const criteria = Array.isArray(o.acceptanceCriteria)
      ? o.acceptanceCriteria
          .map((criterion) => normalizeCriterion(criterion, id, dimension))
          .filter((x): x is RequirementAcceptanceCriterion => Boolean(x))
      : [];
    byId.set(id, {
      id,
      dimension,
      title: String(o.title || detail).trim().slice(0, 120),
      detail,
      source:
        o.source === "user" ||
        o.source === "legacy" ||
        o.source === "review" ||
        o.source === "qa" ||
        o.source === "system"
          ? o.source
          : "analyst",
      priority,
      acceptanceCriteria: criteria.length
        ? criteria
        : createStructuredRequirement({ dimension, title: detail, detail }).acceptanceCriteria,
      status,
      conflicts: Array.isArray(o.conflicts)
        ? [...new Set(o.conflicts.map(String).map((x) => x.trim()).filter(Boolean))]
        : [],
    });
  }
  return [...byId.values()];
}

/** 将旧 Brief 字段补入结构化需求；已有 requirements 优先，重复文本按稳定 ID 去重。 */
export function migrateLegacyRequirements(
  brief: Pick<
    RequirementBrief,
    "requirements" | "goal" | "scopeIn" | "scopeOut" | "must" | "should" | "could" | "wont" | "acceptance" | "constraints"
  >,
): StructuredRequirement[] {
  const out = normalizeStructuredRequirements(brief.requirements);
  const add = (
    dimension: RequirementDimension,
    title: string,
    detail: string,
    priority: RequirementPriority = "must",
  ) => {
    if (!detail.trim()) return;
    const requirement = createStructuredRequirement({
      dimension,
      title,
      detail,
      source: "legacy",
      priority,
      acceptance: dimension === "test_acceptance_env" ? [detail] : undefined,
    });
    if (!out.some((item) => item.id === requirement.id)) out.push(requirement);
  };
  add("goal_scope", "项目目标", brief.goal || "");
  for (const text of brief.scopeIn || []) add("goal_scope", "范围内", text);
  for (const text of brief.scopeOut || []) add("goal_scope", "范围外", text, "wont");
  for (const text of brief.must || []) add("goal_scope", "Must", text);
  for (const text of brief.should || []) add("goal_scope", "Should", text, "should");
  for (const text of brief.could || []) add("goal_scope", "Could", text, "could");
  for (const text of brief.wont || []) add("goal_scope", "Won't", text, "wont");
  for (const text of brief.acceptance || []) add("test_acceptance_env", "验收标准", text);
  for (const text of brief.constraints || []) {
    const dimension: RequirementDimension = /隐私|合规|等保|gdpr|个人信息/i.test(text)
      ? "privacy_compliance"
      : /兼容|浏览器|windows|mac|linux/i.test(text)
        ? "compatibility"
        : "goal_scope";
    add(dimension, "约束", text);
  }
  return out;
}

/** 构建需求到验收项的追踪矩阵；冲突或失败状态原样保留给员工与门禁消费。 */
export function buildTraceabilityMatrix(brief: RequirementBrief): RequirementTraceRow[] {
  return migrateLegacyRequirements(brief).map((item) => ({
    requirementId: item.id,
    dimension: item.dimension,
    priority: item.priority,
    requirement: item.detail,
    acceptanceIds: item.acceptanceCriteria.map((criterion) => criterion.id),
    status: item.status,
    conflicts: item.conflicts,
  }));
}

/** 格式化员工工作包追踪矩阵；无需求时返回空串，避免伪造验收项。 */
export function formatTraceabilityMatrix(brief: RequirementBrief): string {
  const rows = buildTraceabilityMatrix(brief);
  if (!rows.length) return "";
  return [
    "【需求追踪矩阵 · Requirement → Acceptance】",
    ...rows.map(
      (row) =>
        `- ${row.requirementId} [${row.priority}/${row.dimension}/${row.status}] ${row.requirement}` +
        ` → ${row.acceptanceIds.join(", ") || "（无验收项）"}` +
        (row.conflicts.length ? `｜冲突：${row.conflicts.join("；")}` : ""),
    ),
  ].join("\n");
}

export function briefSettingKey(projectId: string): string {
  return `xu.brief.${projectId}`;
}

export function formatMatchPlanSummary(plan: RoleMatchItem[]): string {
  if (!plan.length) return "";
  return [
    "【任务 → 岗位 → 验收】",
    ...plan.map(
      (row, i) =>
        `${i + 1}. ${row.roleNameZh}：${row.task}` +
        (row.acceptance.length ? `｜验收：${row.acceptance.join("；")}` : ""),
    ),
  ].join("\n");
}

export function formatPagesSummary(pages: BriefPage[] | undefined): string {
  if (!pages?.length) return "";
  return [
    "【页面清单】",
    ...pages.map(
      (p, i) =>
        `${i + 1}. ${p.name}${p.route ? `（${p.route}）` : ""} · ${p.status}` +
        (p.purpose ? ` — ${p.purpose}` : ""),
    ),
  ].join("\n");
}

export function formatBriefSummary(b: RequirementBrief): string {
  const lines = [
    `【需求 Brief · ${b.status === "ready" ? "已就绪" : b.status === "executing" ? "执行中" : "收集中"} · v${b.version || 0}】`,
    b.goal ? `目标：${b.goal}` : "目标：（未明确）",
    b.industry ? `行业：${b.industry}` : "",
    b.scopeIn.length ? `范围内：${b.scopeIn.join("；")}` : "",
    b.scopeOut.length ? `范围外：${b.scopeOut.join("；")}` : "",
    (b.must || []).length ? `Must 必须：${b.must!.join("；")}` : "",
    (b.should || []).length ? `Should 应该：${b.should!.join("；")}` : "",
    (b.could || []).length ? `Could 可以：${b.could!.join("；")}` : "",
    (b.wont || []).length ? `Won't 不做：${b.wont!.join("；")}` : "",
    b.uxNotes?.trim() ? `交互与视觉：${b.uxNotes.trim()}` : "",
    b.audience?.trim() ? `受众与规模：${b.audience.trim()}` : "",
    isUsageScaleSpecified(b.usageScaleTier)
      ? `规模档位：${formatUsageScaleLabel(b.usageScaleTier)}`
      : "",
    isIdentityModelSpecified(b.identityModel)
      ? `身份/租户：${formatIdentityModelLabel(b.identityModel)}`
      : "",
    b.architectureNotes?.trim() ? `系统边界/架构：${b.architectureNotes.trim()}` : "",
    Number.isFinite(b.requirementGapScore) ? `需求完整度：${b.requirementGapScore}%` : "",
    b.requirementsConfirmedAt ? "需求确认：用户已显式确认" : "需求确认：待用户显式确认",
    b.constraints.length ? `约束：${b.constraints.join("；")}` : "",
    b.decisions.length ? `已拍板：${b.decisions.join("；")}` : "",
    b.acceptance.length ? `验收：${b.acceptance.join("；")}` : "",
    b.openQuestions.length
      ? `待澄清：${b.openQuestions.map((q, i) => `${i + 1}. ${q}`).join(" ")}`
      : "待澄清：（无）",
    formatPagesSummary(b.pages),
    formatMatchPlanSummary(b.matchPlan || []),
  ];
  return lines.filter(Boolean).join("\n");
}

/** Fingerprint for deciding whether Skills need rewrite. */
export function briefContentFingerprint(b: RequirementBrief): string {
  return JSON.stringify({
    goal: b.goal,
    industry: b.industry,
    constraints: b.constraints,
    decisions: b.decisions,
    acceptance: b.acceptance,
    scopeIn: b.scopeIn,
    scopeOut: b.scopeOut,
    must: b.must,
    should: b.should,
    could: b.could,
    wont: b.wont,
    uxNotes: b.uxNotes,
    audience: b.audience,
    usageScaleTier: b.usageScaleTier,
    identityModel: b.identityModel,
    architectureNotes: b.architectureNotes,
    requirements: migrateLegacyRequirements(b),
    requirementsConfirmedAt: b.requirementsConfirmedAt,
    matchPlan: b.matchPlan,
    pages: b.pages,
    status: b.status,
  });
}
