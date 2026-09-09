/**
 * @file 软件项目技术栈、端目录、需求与交付进度
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-31
 * @version 1.0.1
 * @category Config
 * @algo deterministic-stack-classification
 */

import { listDir, mkdirRecursive, writeTextUnderWorkspace } from "./fsBridge";
import type { KickoffPlan, KickoffStep } from "./projects";

export type StackLang =
  | "TypeScript"
  | "JavaScript"
  | "Vue"
  | "React"
  | "Go"
  | "Java"
  | "Python"
  | "Rust"
  | "Kotlin"
  | "Swift"
  | "C#"
  | "其他"
  | (string & {});

/** 语言 + 框架 + 桌面/构建工具（项目表单多选真源） */
export const TECH_STACK_OPTIONS: string[] = [
  "TypeScript",
  "JavaScript",
  "Vue",
  "React",
  "Svelte",
  "Angular",
  "Solid",
  "Next.js",
  "Nuxt",
  "Remix",
  "NestJS",
  "Express",
  "Go",
  "Gin",
  "Java",
  "Spring Boot",
  "Python",
  "Django",
  "FastAPI",
  "Flask",
  "Rust",
  "Kotlin",
  "Swift",
  "C#",
  ".NET",
  "C++",
  "PHP",
  "Laravel",
  "Vite",
  "Webpack",
  "Rollup",
  "esbuild",
  "Tauri",
  "Electron",
  "WXT",
  "Uni-app",
  "React Native",
  "Flutter",
  "Capacitor",
  "Cordova",
  "HarmonyOS",
  "Node.js",
  "Deno",
  "Bun",
  "Docker",
  "Kubernetes",
  "其他",
];

/** @deprecated 使用 TECH_STACK_OPTIONS */
export const STACK_LANG_OPTIONS: string[] = TECH_STACK_OPTIONS;

/** 解析端语言 / toolchain 语言（兼容逗号、顿号、斜杠分隔的旧数据）。 */
export function parseStackLangs(value: string | undefined | null): string[] {
  if (!value?.trim()) return [];
  return [...new Set(value.split(/[,，/|、\s]+/).map((s) => s.trim()).filter(Boolean))];
}

export function formatStackLangs(langs: string[]): string {
  return [...new Set(langs.map((s) => s.trim()).filter(Boolean))].join(", ");
}

export function toggleStackLang(langs: string[], lang: string): string[] {
  const set = new Set(langs);
  if (set.has(lang)) set.delete(lang);
  else set.add(lang);
  const ordered = TECH_STACK_OPTIONS.filter((o) => set.has(o));
  const extra = [...set].filter((x) => !TECH_STACK_OPTIONS.includes(x));
  return [...ordered, ...extra];
}

export type StackEndKey = "frontend" | "backend" | "ui" | "desktop" | "app";

export const STACK_ENDS: Array<{ key: StackEndKey; label: string; langKey: keyof StackProfile }> = [
  { key: "frontend", label: "前端", langKey: "frontendLang" },
  { key: "backend", label: "后端", langKey: "backendLang" },
  { key: "ui", label: "UI/设计资产", langKey: "uiLang" },
  { key: "desktop", label: "桌面端", langKey: "desktopLang" },
  { key: "app", label: "移动 App", langKey: "appLang" },
];

export interface StackProfile {
  enabled: Partial<Record<StackEndKey, boolean>>;
  frontendDir?: string;
  backendDir?: string;
  uiDir?: string;
  desktopDir?: string;
  appDir?: string;
  frontendLang?: StackLang | string;
  backendLang?: StackLang | string;
  uiLang?: StackLang | string;
  desktopLang?: StackLang | string;
  appLang?: StackLang | string;
}

export type RequirementsMode = "editor" | "doc_folder" | "both";

export interface ProjectRequirements {
  mode: RequirementsMode;
  richHtml?: string;
  docFolder?: string;
  playbookPath?: string;
}

export type ProgressStatus = "pending" | "doing" | "done" | "blocked";

export interface DeliveryStepProgress {
  id: string;
  title: string;
  status: ProgressStatus;
  percent: number;
  evidence?: string;
}

export interface DeliveryProgress {
  steps: DeliveryStepProgress[];
  overallPercent: number;
  updatedAt: number;
}

export function emptyStackProfile(): StackProfile {
  return {
    enabled: { frontend: true, backend: true, ui: false, desktop: false, app: false },
    frontendLang: "TypeScript",
    backendLang: "TypeScript",
  };
}

/** 根据项目名为已启用端生成缺省目录；保留用户已填写目录，不执行文件写入。 */
export function suggestStackEndDirs(
  projectName: string,
  stack: StackProfile,
): Partial<StackProfile> {
  const slug =
    (projectName.trim() || "app").replace(/[<>:"/\\|?*\s]+/g, "-").slice(0, 40) || "app";
  const suffix: Record<StackEndKey, string> = {
    frontend: "web",
    backend: "api",
    ui: "ui",
    desktop: "desktop",
    app: "app",
  };
  const suggested: Partial<StackProfile> = {};
  for (const end of STACK_ENDS) {
    if (!stack.enabled?.[end.key]) continue;
    const dirKey = `${end.key}Dir` as keyof StackProfile;
    if (String(stack[dirKey] || "").trim()) continue;
    (suggested as Record<string, unknown>)[dirKey] = `${slug}-${suffix[end.key]}`;
  }
  return suggested;
}

export function normalizeStackProfile(raw: unknown): StackProfile | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Partial<StackProfile>;
  const enabled = { ...(o.enabled || {}) };
  return {
    enabled,
    frontendDir: o.frontendDir ? String(o.frontendDir) : undefined,
    backendDir: o.backendDir ? String(o.backendDir) : undefined,
    uiDir: o.uiDir ? String(o.uiDir) : undefined,
    desktopDir: o.desktopDir ? String(o.desktopDir) : undefined,
    appDir: o.appDir ? String(o.appDir) : undefined,
    frontendLang: o.frontendLang ? String(o.frontendLang) : undefined,
    backendLang: o.backendLang ? String(o.backendLang) : undefined,
    uiLang: o.uiLang ? String(o.uiLang) : undefined,
    desktopLang: o.desktopLang ? String(o.desktopLang) : undefined,
    appLang: o.appLang ? String(o.appLang) : undefined,
  };
}

export function normalizeRequirements(raw: unknown): ProjectRequirements | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Partial<ProjectRequirements>;
  const mode =
    o.mode === "doc_folder" || o.mode === "both" || o.mode === "editor" ? o.mode : "editor";
  return {
    mode,
    richHtml: o.richHtml ? String(o.richHtml) : undefined,
    docFolder: o.docFolder ? String(o.docFolder) : undefined,
    playbookPath: o.playbookPath ? String(o.playbookPath) : undefined,
  };
}

export function normalizeDeliveryProgress(raw: unknown): DeliveryProgress | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Partial<DeliveryProgress>;
  if (!Array.isArray(o.steps)) return null;
  const steps = o.steps.map((s, i) => {
    const st = s as DeliveryStepProgress;
    const status: ProgressStatus =
      st.status === "doing" || st.status === "done" || st.status === "blocked"
        ? st.status
        : "pending";
    return {
      id: String(st.id || `step_${i}`),
      title: String(st.title || `步骤 ${i + 1}`),
      status,
      percent: Math.max(0, Math.min(100, Number(st.percent) || 0)),
      evidence: st.evidence ? String(st.evidence) : undefined,
    };
  });
  return {
    steps,
    overallPercent:
      typeof o.overallPercent === "number"
        ? o.overallPercent
        : computeOverallPercent(steps),
    updatedAt: typeof o.updatedAt === "number" ? o.updatedAt : Date.now(),
  };
}

export function computeOverallPercent(steps: DeliveryStepProgress[]): number {
  if (!steps.length) return 0;
  const sum = steps.reduce((a, s) => {
    if (s.status === "done") return a + 100;
    if (s.status === "doing") return a + Math.max(s.percent, 10);
    if (s.status === "blocked") return a + Math.min(s.percent, 50);
    return a;
  }, 0);
  return Math.round(sum / steps.length);
}

export function deliveryFromKickoff(plan: KickoffPlan | null | undefined): DeliveryProgress {
  const steps = (plan?.steps || []).map((s: KickoffStep) => ({
    id: s.id,
    title: s.title,
    status: "pending" as ProgressStatus,
    percent: 0,
  }));
  return {
    steps,
    overallPercent: 0,
    updatedAt: Date.now(),
  };
}

export function validateStackForSoftware(stack: StackProfile | null | undefined): string | null {
  if (!stack) return "软件项目请配置各端目录与语言";
  const ends = STACK_ENDS.filter((e) => stack.enabled?.[e.key]);
  if (ends.length === 0) return "请至少启用一个端（前端/后端/…）";
  for (const e of ends) {
    const dirKey = `${e.key}Dir` as keyof StackProfile;
    const langKey = e.langKey;
    const dir = stack[dirKey];
    const lang = stack[langKey];
    if (!dir || typeof dir !== "string" || !dir.trim()) {
      return `请为「${e.label}」选择目录`;
    }
    if (!lang || typeof lang !== "string" || !parseStackLangs(String(lang)).length) {
      return `请为「${e.label}」选择至少一种语言`;
    }
  }
  return null;
}

const FRONTEND_TECH = new Set([
  "TypeScript",
  "JavaScript",
  "Vue",
  "React",
  "Svelte",
  "Angular",
  "Solid",
  "Next.js",
  "Nuxt",
  "Remix",
  "Vite",
  "Webpack",
  "Rollup",
  "esbuild",
  "WXT",
]);
const BACKEND_TECH = new Set([
  "Go",
  "Gin",
  "Java",
  "Spring Boot",
  "Python",
  "Django",
  "FastAPI",
  "Flask",
  "Rust",
  "C#",
  ".NET",
  "PHP",
  "Laravel",
  "Node.js",
  "Deno",
  "Bun",
  "NestJS",
  "Express",
  "Kotlin",
]);
const DESKTOP_TECH = new Set(["Tauri", "Electron", "WXT", "C++"]);
const APP_TECH = new Set([
  "Uni-app",
  "React Native",
  "Flutter",
  "Capacitor",
  "Cordova",
  "HarmonyOS",
  "Swift",
  "Kotlin",
]);

function classifyTech(tech: string[]): Record<StackEndKey, string[]> {
  const out: Record<StackEndKey, string[]> = {
    frontend: [],
    backend: [],
    ui: [],
    desktop: [],
    app: [],
  };
  for (const t of tech) {
    const x = t.trim();
    if (!x) continue;
    let placed = false;
    if (FRONTEND_TECH.has(x)) {
      out.frontend.push(x);
      placed = true;
    }
    if (BACKEND_TECH.has(x)) {
      out.backend.push(x);
      placed = true;
    }
    if (DESKTOP_TECH.has(x)) {
      out.desktop.push(x);
      placed = true;
    }
    if (APP_TECH.has(x)) {
      out.app.push(x);
      placed = true;
    }
    if (!placed) {
      // 通用语言两边都挂，便于 Agent 读到
      out.frontend.push(x);
      out.backend.push(x);
    }
  }
  return out;
}

function inferPackageManager(tech: string[]): string {
  const s = new Set(tech);
  if (s.has("Rust") || s.has("Tauri")) return "cargo";
  if (s.has("Go") || s.has("Gin")) return "go";
  if (s.has("Java") || s.has("Spring Boot") || s.has("Kotlin")) return "maven";
  if (s.has("Python") || s.has("Django") || s.has("FastAPI") || s.has("Flask")) return "pip";
  if (s.has("C#") || s.has(".NET")) return "dotnet";
  if (s.has("PHP") || s.has("Laravel")) return "composer";
  if (s.has("Flutter")) return "pub";
  return "pnpm";
}

export type KickoffSoftwareStackResult = {
  languages: string[];
  packageManager: string;
  stackProfile: StackProfile;
};

/**
 * Build toolchain languages + stackProfile from multi-select tech chips (start-project dialog).
 * Fills suggested end dirs from project name.
 */
export function buildKickoffSoftwareStack(
  projectName: string,
  tech: string[],
  endOverrides?: Partial<Record<StackEndKey, boolean>>,
): KickoffSoftwareStackResult {
  const languages = [...new Set(tech.map((s) => s.trim()).filter(Boolean))];
  const classified = classifyTech(languages);
  const enabled: Partial<Record<StackEndKey, boolean>> = {
    frontend: endOverrides?.frontend ?? classified.frontend.length > 0,
    backend: endOverrides?.backend ?? classified.backend.length > 0,
    ui: endOverrides?.ui ?? false,
    desktop: endOverrides?.desktop ?? classified.desktop.length > 0,
    app: endOverrides?.app ?? classified.app.length > 0,
  };
  if (!Object.values(enabled).some(Boolean)) {
    enabled.frontend = true;
    enabled.backend = true;
  }
  let stack: StackProfile = {
    enabled,
    frontendLang: formatStackLangs(
      classified.frontend.length ? classified.frontend : languages,
    ),
    backendLang: formatStackLangs(
      classified.backend.length ? classified.backend : languages,
    ),
    desktopLang: classified.desktop.length
      ? formatStackLangs(classified.desktop)
      : undefined,
    appLang: classified.app.length ? formatStackLangs(classified.app) : undefined,
  };
  const slug =
    (projectName.trim() || "app").replace(/[<>:"/\\|?*\s]+/g, "-").slice(0, 40) || "app";
  if (enabled.frontend) stack.frontendDir = `${slug}-web`;
  if (enabled.backend) stack.backendDir = `${slug}-api`;
  if (enabled.desktop) stack.desktopDir = `${slug}-desktop`;
  if (enabled.app) stack.appDir = `${slug}-app`;
  return {
    languages,
    packageManager: inferPackageManager(languages),
    stackProfile: stack,
  };
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/h[1-6]>/gi, "\n")
    .replace(/<li>/gi, "- ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .trim();
}

function extractHeadings(html: string): string[] {
  const out: string[] = [];
  const re = /<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const t = stripHtml(m[1] || "").trim();
    if (t) out.push(t);
  }
  return out;
}

async function listDocFiles(folder: string): Promise<string[]> {
  try {
    const entries = await listDir(folder);
    return entries
      .filter((e) => !e.is_dir && e.name)
      .map((e) => e.name)
      .filter((n) => /\.(md|txt|docx|pdf)$/i.test(n))
      .slice(0, 80);
  } catch {
    return [];
  }
}

export function stackDirMapMarkdown(stack: StackProfile, generatePath: string): string {
  const lines: string[] = ["## 目录地图（禁止猜测）", ""];
  for (const e of STACK_ENDS) {
    if (!stack.enabled?.[e.key]) continue;
    const dir = String(stack[`${e.key}Dir` as keyof StackProfile] || "").trim();
    const lang = String(stack[e.langKey] || "").trim();
    lines.push(`- **${e.label}**：\`${dir}\` · 语言：${lang}`);
  }
  lines.push(`- **生成根目录**：\`${generatePath}\``);
  lines.push("");
  return lines.join("\n");
}

export async function buildAndWritePlaybook(opts: {
  projectName: string;
  generatePath: string;
  stack: StackProfile;
  requirements?: ProjectRequirements | null;
  customRequirements?: string[];
}): Promise<string> {
  const root = opts.generatePath.trim();
  if (!root) throw new Error("生成路径为空，无法写 playbook");
  try {
    await mkdirRecursive(root, root);
  } catch {
    /* may exist */
  }
  const playbookPath = `${root.replace(/[/\\]$/, "")}/REQUIREMENTS_PLAYBOOK.md`;
  const headings = opts.requirements?.richHtml
    ? extractHeadings(opts.requirements.richHtml)
    : [];
  const bodyText = opts.requirements?.richHtml
    ? stripHtml(opts.requirements.richHtml).slice(0, 8000)
    : "";
  const docFolder = opts.requirements?.docFolder?.trim() || "";
  const docFiles = docFolder ? await listDocFiles(docFolder) : [];

  const parts: string[] = [
    `# ${opts.projectName} · 员工操作说明（REQUIREMENTS_PLAYBOOK）`,
    "",
    "> 本文件由虚募阁生成。员工必须按此执行，禁止猜测目录与语言。",
    "",
    "## 项目目标",
    "",
    `完成「${opts.projectName}」交付；所有新建/修改必须落在声明的目录内。`,
    "",
    stackDirMapMarkdown(opts.stack, root),
    "## 功能需求清单",
    "",
  ];

  if (headings.length) {
    headings.forEach((h, i) => parts.push(`${i + 1}. ${h}`));
    parts.push("");
  }
  if (bodyText) {
    parts.push("### 需求正文摘要", "", "```", bodyText.slice(0, 4000), "```", "");
  }
  if (docFolder) {
    parts.push(`### 需求文档目录`, "", `\`${docFolder}\``, "");
    if (docFiles.length) {
      parts.push("文档索引：");
      docFiles.forEach((f) => parts.push(`- ${f}`));
      parts.push("");
    } else {
      parts.push("（目录可读但未枚举到 md/txt/docx/pdf，请人工核对）", "");
    }
  }
  if (opts.customRequirements?.length) {
    parts.push("### 自定义追加需求");
    opts.customRequirements.forEach((c, i) => parts.push(`${i + 1}. ${c}`));
    parts.push("");
  }

  parts.push(
    "## 怎么做（强制流程）",
    "",
    "1. **阅读**：先读本 playbook + 需求文档目录；用 `list_dir` / `read_file` / `glob_file_search` 核实目录真实存在。",
    "2. **计划**：调用 `update_plan`，步骤对应开工清单 id（align/env/skeleton…）。",
    "3. **落盘**：按端目录写入；文本 `write_file`/`apply_patch`；Office 用 `office_write_*`。",
    "4. **IDE**：需要打开代码时用 `ide_open`，勿空口声称已在 IDE 保存。",
    "5. **自测**：每次写入后跑仓库已有 lint/test；失败再改最多两轮。测试员工用浏览器/桌面自动化并写缺陷工单。",
    "6. **汇报**：只写工具真实返回的路径；不确定则输出 `XU_NEED_CONFIRM:` 开会请示 Boss。",
    "7. **规范**：遵守同目录 `AGENTS.md`；老板补充优先于旧任务。",
    "",
    "## 禁止",
    "",
    "- 猜测 monorepo 布局或未声明的目录",
    "- 空口报「已创建文件」而未调用写入工具",
    "- 跳过确认项直接实现有争议方案",
    "",
  );

  await writeTextUnderWorkspace(root, playbookPath, parts.join("\n"));
  try {
    const { writeProjectAgentsMd } = await import("./projectAgentsMd");
    await writeProjectAgentsMd({
      workspaceRoot: root,
      projectName: opts.projectName,
      playbookPath,
    });
  } catch {
    /* playbook still valid if AGENTS.md write fails */
  }
  return playbookPath;
}

/** Short system-prompt appendix for employees. */
export function playbookSystemHint(playbookPath: string | undefined, stack: StackProfile | null): string {
  if (!playbookPath && !stack) return "";
  const lines = ["【项目操作说明】"];
  if (playbookPath) lines.push(`必读 playbook：${playbookPath}`);
  lines.push("必读仓库规范：工作区根目录 AGENTS.md");
  if (stack) {
    for (const e of STACK_ENDS) {
      if (!stack.enabled?.[e.key]) continue;
      const dir = stack[`${e.key}Dir` as keyof StackProfile];
      const lang = stack[e.langKey];
      if (dir) lines.push(`${e.label}目录=${dir} 语言=${lang || "?"}`);
    }
  }
  lines.push("禁止猜测目录；落盘必须在上述路径内。");
  return lines.join("\n");
}
