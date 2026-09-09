/** 虚募阁项目管理：多项目列表（文档路径只读、生成路径可写）+ 分类。 */

import { invoke } from "@tauri-apps/api/core";
import { readEmployees, type Employee, type Gender } from "./employees";
import {
  inferIndustryId,
  industryToProjectType,
} from "../project/industryWizards";
import {
  normalizeIndustryProfile,
  INDUSTRY_LABEL,
  type IndustryId,
  type IndustryProfile,
} from "../project/industryProfiles";
import {
  normalizeDeliveryProgress,
  normalizeRequirements,
  normalizeStackProfile,
  type DeliveryProgress,
  type ProjectRequirements,
  type StackProfile,
} from "./projectStack";
import {
  defaultProjectToolPolicy,
  normalizeProjectToolPolicy,
  projectToolPolicyComplete,
  type ProjectToolPolicy,
} from "./projectToolPolicy";

export type { ProjectToolPolicy };
export { defaultProjectToolPolicy, normalizeProjectToolPolicy, projectToolPolicyComplete };

export type { DeliveryProgress, ProjectRequirements, StackProfile };
export type { IndustryId, IndustryProfile };
export { INDUSTRY_LABEL };

export type ProjectType = "software" | "delivery" | "consulting" | "internal" | "other";

/** 软件项目办公室「全体开工」模式 */
export type ProjectKickoffMode = "phased" | "strict";

export const KICKOFF_MODE_LABEL: Record<ProjectKickoffMode, string> = {
  phased: "敏捷 Scrum（切片开发，可小范围调需求）",
  strict: "瀑布（需求/设计/技术方案锁定后再写码）",
};

export const PROJECT_TYPE_LABEL: Record<ProjectType, string> = {
  software: "软件研发",
  delivery: "交付实施",
  consulting: "咨询服务",
  internal: "内部事务",
  other: "其他",
};

export interface ProjectCategory {
  id: string;
  name: string;
  createdAt: number;
}

export interface ProjectToolchain {
  ide: "cursor" | "vscode" | "trae" | "qoder" | "jetbrains" | "windsurf" | "zed" | "other";
  ideNote?: string;
  /** inherit | builtin | external */
  codeEditorSurface?: "builtin" | "external" | "inherit";
  languages?: string[];
  packageManager?: string;
  repoStyle?: string;
}

export interface KickoffStep {
  id: string;
  title: string;
  detail: string;
  reads: string[];
  outputs: string[];
  ownerRole?: string;
  doneWhen?: string;
}

export interface KickoffPlan {
  version: number;
  steps: KickoffStep[];
  customRequirements: string[];
  updatedAt: number;
}

/** 软件项目全流程状态机 */
export type ProjectWorkflowState =
  | "requirements"
  | "planning"
  | "plan_review"
  | "design_review"
  | "tech_review"
  | "developing"
  | "code_review"
  | "qa"
  | "fixing"
  | "acceptance"
  | "done";

export type WorkflowTaskStatus =
  | "pending"
  | "assigned"
  | "working"
  | "qa"
  | "fixing"
  | "done"
  | "blocked";

export interface WorkflowTaskItem {
  taskId: string;
  title: string;
  roleHint: string;
  deliverable?: string;
  dependsOn: string[];
  employeeId?: string | null;
  status: WorkflowTaskStatus;
}

export interface ProjectWorkflow {
  state: ProjectWorkflowState;
  planArtifactPath?: string | null;
  taskBoard: WorkflowTaskItem[];
  activeFeatureId?: string | null;
  plannerEmployeeId?: string | null;
  updatedAt: number;
}

export const WORKFLOW_STATE_LABEL: Record<ProjectWorkflowState, string> = {
  requirements: "待规划",
  planning: "规划师工作中",
  plan_review: "待 Boss 确认计划",
  design_review: "待 Boss 确认设计",
  tech_review: "待确认技术方案",
  developing: "开发中",
  code_review: "代码 Review 中",
  qa: "测试中",
  fixing: "修缺陷中",
  acceptance: "UAT 用户验收",
  done: "已完成",
};

export function workflowBlockReason(w: ProjectWorkflow | null | undefined): string | null {
  if (!w) return null;
  switch (w.state) {
    case "plan_review":
      return "等待 Boss 在飞书或办公室回复「同意」确认项目计划";
    case "design_review":
      return "等待 Boss 确认各页设计线框（弹窗或回复「确认设计」）";
    case "tech_review":
      return "等待 Boss 确认技术方案（回复「确认技术方案」）后再写码";
    case "code_review":
      return "代码 Review 进行中或未通过，有问题禁止合并到 dev";
    case "acceptance":
      return "等待 UAT 用户验收（飞书或办公室回复「验收通过」）";
    case "planning":
      return "规划师正在读取需求并拆分任务…";
    case "qa":
      return "测试工程师正在验证交付物…";
    case "fixing":
      return "开发正在修复缺陷…";
    default:
      return null;
  }
}

function normalizeWorkflowTask(t: unknown, i: number): WorkflowTaskItem | null {
  if (!t || typeof t !== "object") return null;
  const o = t as Partial<WorkflowTaskItem>;
  const title = String(o.title || `任务 ${i + 1}`).trim();
  if (!title) return null;
  const status = (
    ["pending", "assigned", "working", "qa", "fixing", "done", "blocked"] as const
  ).includes(o.status as WorkflowTaskStatus)
    ? (o.status as WorkflowTaskStatus)
    : "pending";
  return {
    taskId: String(o.taskId || `task_${i + 1}`),
    title,
    roleHint: String(o.roleHint || "工程"),
    deliverable: o.deliverable ? String(o.deliverable) : undefined,
    dependsOn: Array.isArray(o.dependsOn) ? o.dependsOn.map(String) : [],
    employeeId: o.employeeId ? String(o.employeeId) : null,
    status,
  };
}

export function normalizeWorkflow(w: unknown): ProjectWorkflow | null {
  if (!w || typeof w !== "object") return null;
  const o = w as Partial<ProjectWorkflow>;
  const state = (
    [
      "requirements",
      "planning",
      "plan_review",
      "design_review",
      "tech_review",
      "developing",
      "code_review",
      "qa",
      "fixing",
      "acceptance",
      "done",
    ] as const
  ).includes(o.state as ProjectWorkflowState)
    ? (o.state as ProjectWorkflowState)
    : "requirements";
  const taskBoard = Array.isArray(o.taskBoard)
    ? o.taskBoard.map(normalizeWorkflowTask).filter(Boolean) as WorkflowTaskItem[]
    : [];
  return {
    state,
    planArtifactPath: o.planArtifactPath ? String(o.planArtifactPath) : null,
    taskBoard,
    activeFeatureId: o.activeFeatureId ? String(o.activeFeatureId) : null,
    plannerEmployeeId: o.plannerEmployeeId ? String(o.plannerEmployeeId) : null,
    updatedAt: typeof o.updatedAt === "number" ? o.updatedAt : Date.now(),
  };
}

export function defaultProjectWorkflow(): ProjectWorkflow {
  return {
    state: "requirements",
    planArtifactPath: null,
    taskBoard: [],
    activeFeatureId: null,
    plannerEmployeeId: null,
    updatedAt: Date.now(),
  };
}

export interface ProjectGitConfig {
  /** 远程仓库 URL（展示 / 文档用，可选） */
  remoteUrl?: string;
  /** 默认分支，如 main */
  defaultBranch?: string;
  /** 推送目标 remote，默认 origin */
  pushRemote?: string;
}

function normalizeGit(g: unknown): ProjectGitConfig | null {
  if (!g || typeof g !== "object") return null;
  const o = g as Record<string, unknown>;
  const remoteUrl = String(o.remoteUrl ?? "").trim();
  const defaultBranch = String(o.defaultBranch ?? "").trim();
  const pushRemote = String(o.pushRemote ?? "").trim();
  if (!remoteUrl && !defaultBranch && !pushRemote) return null;
  return {
    remoteUrl: remoteUrl || undefined,
    defaultBranch: defaultBranch || undefined,
    pushRemote: pushRemote || undefined,
  };
}

export interface XuProject {
  id: string;
  name: string;
  /** 项目分类 id（可选标签，侧栏以 industryId 为准） */
  categoryId: string;
  /** 行业（驱动创建向导与项目页侧栏） */
  industryId: IndustryId;
  /** 行业专属配置 */
  industryProfile?: IndustryProfile | null;
  type: ProjectType;
  employeeIds: string[];
  /** 项目内对员工的独立说明 employeeId → note */
  employeeNotes: Record<string, string>;
  /** 文档路径（只读展示；创建时选定） */
  docPath: string;
  /** 生成路径（可读写） */
  generatePath: string;
  /** 写码工具链（软件类建议填写） */
  toolchain?: ProjectToolchain | null;
  /** 开工清单（可查看 / 可追加自定义需求） */
  kickoffPlan?: KickoffPlan | null;
  /** 软件项目：各端目录与语言（禁止员工猜布局） */
  stackProfile?: StackProfile | null;
  /** 需求：富文本 / 文档夹 / playbook 路径 */
  requirements?: ProjectRequirements | null;
  /** 交付进度（与 kickoff 步骤对齐） */
  deliveryProgress?: DeliveryProgress | null;
  /** 软件项目全流程编排 */
  workflow?: ProjectWorkflow | null;
  /** 办公室全体开工：敏捷 Scrum / 瀑布 */
  kickoffMode?: ProjectKickoffMode | null;
  /** Agent 工具权限（新建必填；未授权工具运行时硬拒绝） */
  toolPolicy?: ProjectToolPolicy | null;
  /** 每项目 Git 远程与分支（推送时使用） */
  git?: ProjectGitConfig | null;
  /** 敏捷软件项目在 UAT 通过后退出队列（否则继续迭代） */
  queueCompleteOnUat?: boolean | null;
  createdAt: number;
  updatedAt: number;
}

const LS_KEY = "xu.projects";
const DB_KEY = "projects_list";
const CAT_LS = "xu.project_categories";
const CAT_DB = "project_categories";

const DEFAULT_CATEGORIES: ProjectCategory[] = [
  { id: "cat_product", name: "产品研发", createdAt: 0 },
  { id: "cat_delivery", name: "客户交付", createdAt: 0 },
  { id: "cat_ops", name: "运营支持", createdAt: 0 },
  { id: "cat_other", name: "其他", createdAt: 0 },
];

export const ALL_CATEGORY_ID = "all";

export { ALL_INDUSTRY_ID } from "../project/industryNav";

export function industryName(industryId: IndustryId | string | undefined): string {
  if (!industryId) return "未分类";
  const known = INDUSTRY_LABEL[industryId as IndustryId];
  if (known) return known;
  return "未分类";
}

function uid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export function formatProjectTime(ts: number): string {
  if (!ts) return "—";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "—";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function normalizeCategory(c: Partial<ProjectCategory>): ProjectCategory | null {
  if (!c?.id || !c?.name) return null;
  return {
    id: String(c.id),
    name: String(c.name).trim(),
    createdAt: c.createdAt ?? Date.now(),
  };
}

function normalizeToolchain(t: unknown): ProjectToolchain | null {
  if (!t || typeof t !== "object") return null;
  const o = t as Partial<ProjectToolchain>;
  const ide = o.ide;
  if (
    ide !== "cursor" &&
    ide !== "vscode" &&
    ide !== "trae" &&
    ide !== "qoder" &&
    ide !== "jetbrains" &&
    ide !== "windsurf" &&
    ide !== "zed" &&
    ide !== "other"
  ) {
    return null;
  }
  return {
    ide,
    ideNote: o.ideNote ? String(o.ideNote) : undefined,
    codeEditorSurface:
      o.codeEditorSurface === "builtin" || o.codeEditorSurface === "external"
        ? o.codeEditorSurface
        : o.codeEditorSurface === "inherit"
          ? "inherit"
          : undefined,
    languages: Array.isArray(o.languages) ? o.languages.map(String) : undefined,
    packageManager: o.packageManager ? String(o.packageManager) : undefined,
    repoStyle: o.repoStyle ? String(o.repoStyle) : undefined,
  };
}

function normalizeKickoffPlan(p: unknown): KickoffPlan | null {
  if (!p || typeof p !== "object") return null;
  const o = p as Partial<KickoffPlan>;
  if (!Array.isArray(o.steps)) return null;
  return {
    version: typeof o.version === "number" ? o.version : 1,
    steps: o.steps.map((s, i) => ({
      id: String((s as KickoffStep)?.id || `step_${i}`),
      title: String((s as KickoffStep)?.title || `步骤 ${i + 1}`),
      detail: String((s as KickoffStep)?.detail || ""),
      reads: Array.isArray((s as KickoffStep)?.reads) ? (s as KickoffStep).reads.map(String) : [],
      outputs: Array.isArray((s as KickoffStep)?.outputs)
        ? (s as KickoffStep).outputs.map(String)
        : [],
      ownerRole: (s as KickoffStep)?.ownerRole ? String((s as KickoffStep).ownerRole) : undefined,
      doneWhen: (s as KickoffStep)?.doneWhen ? String((s as KickoffStep).doneWhen) : undefined,
    })),
    customRequirements: Array.isArray(o.customRequirements)
      ? o.customRequirements.map(String)
      : [],
    updatedAt: typeof o.updatedAt === "number" ? o.updatedAt : Date.now(),
  };
}

function normalizeKickoffMode(m: unknown): ProjectKickoffMode {
  return m === "strict" ? "strict" : "phased";
}

function normalize(p: Partial<XuProject>): XuProject | null {
  if (!p?.name || !p.id) return null;
  const type = (p.type && PROJECT_TYPE_LABEL[p.type as ProjectType] ? p.type : "software") as ProjectType;
  const industryId = inferIndustryId(p.industryId, type);
  const resolvedType = p.industryId ? industryToProjectType(industryId) : type;
  return {
    id: p.id,
    name: String(p.name).trim(),
    categoryId: String(p.categoryId || DEFAULT_CATEGORIES[0]!.id),
    industryId,
    industryProfile: normalizeIndustryProfile(industryId, p.industryProfile),
    type: resolvedType,
    employeeIds: Array.isArray(p.employeeIds) ? p.employeeIds.map(String) : [],
    employeeNotes:
      p.employeeNotes && typeof p.employeeNotes === "object" && !Array.isArray(p.employeeNotes)
        ? { ...p.employeeNotes }
        : {},
    docPath: String(p.docPath ?? ""),
    generatePath: String(p.generatePath ?? ""),
    toolchain: normalizeToolchain(p.toolchain),
    kickoffPlan: normalizeKickoffPlan(p.kickoffPlan),
    stackProfile: normalizeStackProfile(p.stackProfile),
    requirements: normalizeRequirements(p.requirements),
    deliveryProgress: normalizeDeliveryProgress(p.deliveryProgress),
    workflow: normalizeWorkflow(p.workflow) ?? (type === "software" ? defaultProjectWorkflow() : null),
    kickoffMode: type === "software" ? normalizeKickoffMode(p.kickoffMode) : null,
    toolPolicy: projectToolPolicyComplete(p.toolPolicy)
      ? normalizeProjectToolPolicy(p.toolPolicy)
      : null,
    git: normalizeGit(p.git),
    queueCompleteOnUat: p.queueCompleteOnUat === true,
    createdAt: p.createdAt ?? Date.now(),
    updatedAt: p.updatedAt ?? Date.now(),
  };
}

function readLocal(): XuProject[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as XuProject[];
    if (!Array.isArray(arr)) return [];
    return arr.map(normalize).filter(Boolean) as XuProject[];
  } catch {
    return [];
  }
}

function writeLocal(list: XuProject[], opts?: { emit?: boolean }) {
  localStorage.setItem(LS_KEY, JSON.stringify(list));
  if (opts?.emit !== false) {
    window.dispatchEvent(new CustomEvent("xu-projects-changed", { detail: list }));
  }
}

function readCatsLocal(): ProjectCategory[] {
  try {
    const raw = localStorage.getItem(CAT_LS);
    if (!raw) return DEFAULT_CATEGORIES.map((c) => ({ ...c }));
    const arr = JSON.parse(raw) as ProjectCategory[];
    if (!Array.isArray(arr) || arr.length === 0) return DEFAULT_CATEGORIES.map((c) => ({ ...c }));
    return arr.map(normalizeCategory).filter(Boolean) as ProjectCategory[];
  } catch {
    return DEFAULT_CATEGORIES.map((c) => ({ ...c }));
  }
}

function writeCatsLocal(list: ProjectCategory[], opts?: { emit?: boolean }) {
  localStorage.setItem(CAT_LS, JSON.stringify(list));
  if (opts?.emit !== false) {
    window.dispatchEvent(new CustomEvent("xu-project-categories-changed", { detail: list }));
  }
}

export async function loadProjectCategories(): Promise<ProjectCategory[]> {
  try {
    const raw = await invoke<string | null>("xu_get_setting", { key: CAT_DB });
    if (raw) {
      const arr = JSON.parse(raw) as ProjectCategory[];
      if (Array.isArray(arr) && arr.length) {
        const list = arr.map(normalizeCategory).filter(Boolean) as ProjectCategory[];
        writeCatsLocal(list, { emit: false });
        return list;
      }
    }
  } catch {
    /* local */
  }
  const local = readCatsLocal();
  writeCatsLocal(local, { emit: false });
  return local;
}

export async function saveProjectCategories(list: ProjectCategory[]): Promise<void> {
  writeCatsLocal(list);
  try {
    await invoke("xu_set_setting", { key: CAT_DB, value: JSON.stringify(list) });
  } catch (e) {
    console.warn("saveProjectCategories remote", e);
  }
}

export async function addProjectCategory(name: string): Promise<ProjectCategory> {
  const n = name.trim();
  if (!n) throw new Error("请填写分类名称");
  const list = await loadProjectCategories();
  if (list.some((c) => c.name === n)) throw new Error("分类已存在");
  const cat: ProjectCategory = { id: uid("cat"), name: n, createdAt: Date.now() };
  list.push(cat);
  await saveProjectCategories(list);
  return cat;
}

export async function renameProjectCategory(id: string, name: string): Promise<void> {
  const n = name.trim();
  if (!n) throw new Error("请填写分类名称");
  const list = await loadProjectCategories();
  const i = list.findIndex((c) => c.id === id);
  if (i < 0) throw new Error("分类不存在");
  if (list.some((c) => c.id !== id && c.name === n)) throw new Error("分类已存在");
  list[i] = { ...list[i]!, name: n };
  await saveProjectCategories(list);
}

export async function deleteProjectCategory(id: string): Promise<void> {
  const list = (await loadProjectCategories()).filter((c) => c.id !== id);
  if (list.length === 0) throw new Error("至少保留一个分类");
  await saveProjectCategories(list);
  const fallback = list[0]!.id;
  const projects = await loadProjects();
  let changed = false;
  for (const p of projects) {
    if (p.categoryId === id) {
      p.categoryId = fallback;
      p.updatedAt = Date.now();
      changed = true;
    }
  }
  if (changed) await saveProjects(projects);
}

export function categoryName(
  categoryId: string,
  categories: ProjectCategory[],
): string {
  if (!categoryId || categoryId === ALL_CATEGORY_ID) return "未分类";
  return categories.find((c) => c.id === categoryId)?.name ?? "未分类";
}

/** 迁移：为缺 industryId 的旧项目补全并持久化 */
async function migrateProjectsIndustry(list: XuProject[]): Promise<XuProject[]> {
  let changed = false;
  const next = list.map((p) => {
    if (p.industryId) return p;
    changed = true;
    const industryId = inferIndustryId(undefined, p.type);
    return {
      ...p,
      industryId,
      industryProfile: p.industryProfile ?? normalizeIndustryProfile(industryId, null),
    };
  });
  if (changed) await saveProjects(next);
  return next;
}

export async function loadProjects(): Promise<XuProject[]> {
  try {
    const raw = await invoke<string | null>("xu_get_setting", { key: DB_KEY });
    if (raw) {
      const arr = JSON.parse(raw) as XuProject[];
      if (Array.isArray(arr)) {
        const list = arr.map(normalize).filter(Boolean) as XuProject[];
        // Sync cache only — do not emit, or listeners refresh → load → emit → loop
        writeLocal(list, { emit: false });
        return migrateProjectsIndustry(list);
      }
    }
  } catch {
    /* local */
  }
  return migrateProjectsIndustry(readLocal());
}

export async function saveProjects(list: XuProject[]): Promise<void> {
  writeLocal(list);
  try {
    await invoke("xu_set_setting", { key: DB_KEY, value: JSON.stringify(list) });
  } catch (e) {
    console.warn("saveProjects remote", e);
  }
}

export async function upsertProject(
  input: Omit<XuProject, "id" | "createdAt" | "updatedAt"> & { id?: string },
): Promise<XuProject> {
  const list = await loadProjects();
  const now = Date.now();
  const categoryId = input.categoryId?.trim() || "cat_other";
  if (input.id) {
    const i = list.findIndex((p) => p.id === input.id);
    if (i >= 0) {
      const prev = list[i]!;
      const industryId = input.industryId ?? prev.industryId ?? inferIndustryId(undefined, input.type);
      const next: XuProject = {
        ...prev,
        name: input.name.trim(),
        categoryId: categoryId,
        industryId,
        industryProfile:
          input.industryProfile !== undefined
            ? normalizeIndustryProfile(industryId, input.industryProfile)
            : prev.industryProfile,
        type: input.type,
        employeeIds: [...input.employeeIds],
        employeeNotes: { ...(input.employeeNotes || {}) },
        docPath: input.docPath,
        generatePath: input.generatePath,
        toolchain:
          input.toolchain !== undefined ? normalizeToolchain(input.toolchain) : prev.toolchain,
        kickoffPlan:
          input.kickoffPlan !== undefined
            ? normalizeKickoffPlan(input.kickoffPlan)
            : prev.kickoffPlan,
        stackProfile:
          input.stackProfile !== undefined
            ? normalizeStackProfile(input.stackProfile)
            : prev.stackProfile,
        requirements:
          input.requirements !== undefined
            ? normalizeRequirements(input.requirements)
            : prev.requirements,
        deliveryProgress:
          input.deliveryProgress !== undefined
            ? normalizeDeliveryProgress(input.deliveryProgress)
            : prev.deliveryProgress,
        workflow:
          input.workflow !== undefined
            ? normalizeWorkflow(input.workflow)
            : prev.workflow,
        kickoffMode:
          input.kickoffMode !== undefined
            ? normalizeKickoffMode(input.kickoffMode)
            : prev.kickoffMode,
        toolPolicy:
          input.toolPolicy !== undefined
            ? projectToolPolicyComplete(input.toolPolicy)
              ? normalizeProjectToolPolicy(input.toolPolicy)
              : prev.toolPolicy
            : prev.toolPolicy,
        git: input.git !== undefined ? normalizeGit(input.git) : prev.git,
        updatedAt: now,
      };
      list[i] = next;
      await saveProjects(list);
      return next;
    }
  }
  const industryId = input.industryId ?? inferIndustryId(undefined, input.type);
  const created: XuProject = {
    id: uid("proj"),
    name: input.name.trim(),
    categoryId,
    industryId,
    industryProfile: normalizeIndustryProfile(industryId, input.industryProfile),
    type: input.type,
    employeeIds: [...input.employeeIds],
    employeeNotes: { ...(input.employeeNotes || {}) },
    docPath: input.docPath,
    generatePath: input.generatePath,
    toolchain: normalizeToolchain(input.toolchain),
    kickoffPlan: normalizeKickoffPlan(input.kickoffPlan),
    stackProfile: normalizeStackProfile(input.stackProfile),
    requirements: normalizeRequirements(input.requirements),
    deliveryProgress: normalizeDeliveryProgress(input.deliveryProgress),
    workflow:
      input.workflow !== undefined
        ? normalizeWorkflow(input.workflow)
        : input.type === "software"
          ? defaultProjectWorkflow()
          : null,
    kickoffMode: input.type === "software" ? normalizeKickoffMode(input.kickoffMode) : null,
    toolPolicy: projectToolPolicyComplete(input.toolPolicy)
      ? normalizeProjectToolPolicy(input.toolPolicy)
      : undefined,
    git: normalizeGit(input.git),
    createdAt: now,
    updatedAt: now,
  };
  list.unshift(created);
  await saveProjects(list);
  return created;
}

export async function deleteProjects(ids: string[]): Promise<void> {
  const set = new Set(ids);
  const list = (await loadProjects()).filter((p) => !set.has(p.id));
  await saveProjects(list);
  try {
    const { readProjectThemeLocal, clearProjectTheme } = await import("./projectTheme");
    const theme = readProjectThemeLocal();
    if (!list.length || (theme?.id && set.has(theme.id))) {
      await clearProjectTheme();
    }
  } catch {
    /* ignore */
  }
}

export function resolveProjectEmployees(project: XuProject, employees = readEmployees()): Employee[] {
  const map = new Map(employees.map((e) => [e.id, e]));
  return project.employeeIds.map((id) => map.get(id)).filter(Boolean) as Employee[];
}

export function genderTagClass(g: Gender | undefined): string {
  return g === "female" ? "gender-tag gender-tag--f" : "gender-tag gender-tag--m";
}

export function genderLabel(g: Gender | undefined): string {
  return g === "female" ? "女" : "男";
}

export function defaultEmployeeIds(employees = readEmployees()): string[] {
  return employees.filter((e) => e.roleKind !== "boss").map((e) => e.id);
}

/** 交付进度未满 100% 或仍有未完成的 kickoff 步骤。 */
export function isProjectIncomplete(p: XuProject): boolean {
  const pct = p.deliveryProgress?.overallPercent;
  if (pct != null && pct >= 100) return false;
  const steps = p.deliveryProgress?.steps;
  if (steps?.length && steps.every((s) => s.status === "done")) return false;
  return true;
}
