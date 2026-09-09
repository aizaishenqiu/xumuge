/**
 * Phased team kickoff: industry-standard waves (planning → dev → QA → ops).
 */
import { exists, readDir } from "@tauri-apps/plugin-fs";
import type { Employee } from "./employees";
import type { XuProject, ProjectType } from "./projects";
import { getAgencyRole } from "../office/agencyRoles";
import {
  getIndustryWorkflow,
  kickoffWaveOrderForIndustry,
  resolveIndustryWorkflow,
  resolveKickoffWave,
  waveLabelForIndustry,
  type KickoffWave,
} from "../office/industryWorkflows";
import { kickoffPlanningSteps } from "./projectDispatchHints";
import { buildQaTask } from "./workflowQa";
import type { StackProfile } from "./projectStack";
import { subscribeAgentLive, type AgentLiveEvent } from "../employee/events";

export type { KickoffWave };

export function classifyKickoffWave(emp: Employee, industry: ProjectType = "software"): KickoffWave {
  const ar = getAgencyRole(emp.agentRoleId);
  const div = ar?.division || "";
  const hay = `${emp.role} ${emp.agentRoleId || ""} ${ar?.nameZh || ""} ${ar?.name || ""} ${ar?.divisionZh || ""} ${div}`;
  return resolveKickoffWave({
    catalogWave: ar?.kickoffWave,
    roleId: emp.agentRoleId,
    division: div,
    haystack: hay,
    industry,
  });
}

export function groupEmployeesByWave(
  employees: Employee[],
  industry: ProjectType = "software",
): Record<KickoffWave, Employee[]> {
  const out: Record<KickoffWave, Employee[]> = {
    planning: [],
    design: [],
    dev: [],
    qa: [],
    security: [],
    ops: [],
    other: [],
  };
  for (const e of employees) {
    out[classifyKickoffWave(e, industry)].push(e);
  }
  return out;
}

/** Human-readable wave assignment table for Boss before kickoff. */
export async function buildWaveAssignmentSummary(
  employees: Employee[],
  industry: ProjectType,
): Promise<string> {
  await resolveIndustryWorkflow(industry);
  const grouped = groupEmployeesByWave(employees, industry);
  const order = kickoffWaveOrderForIndustry(industry);
  const lines = ["【行业标准派活顺序】", `行业：${getIndustryWorkflow(industry).nameZh}`, ""];
  for (const wave of order) {
    const batch = grouped[wave];
    if (!batch.length) continue;
    lines.push(
      `${waveLabelForIndustry(wave, industry)}（${batch.length} 人）：${batch.map((e) => e.name).join("、")}`,
    );
  }
  return lines.join("\n");
}

function joinRoot(root: string, sub: string): string {
  const r = root.replace(/[/\\]+$/, "");
  const s = sub.replace(/^[/\\]+/, "");
  return `${r}/${s}`;
}

const SOURCE_EXTS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".vue",
  ".rs",
  ".go",
  ".py",
  ".java",
  ".kt",
  ".cs",
  ".cpp",
  ".c",
  ".h",
]);

async function dirHasSourceFiles(dir: string, depth = 0): Promise<boolean> {
  if (depth > 4) return false;
  try {
    if (!(await exists(dir))) return false;
    const entries = await readDir(dir);
    for (const ent of entries) {
      const name = ent.name || "";
      if (name === "node_modules" || name === ".git" || name === "target") continue;
      if (ent.isDirectory) {
        if (await dirHasSourceFiles(`${dir}/${name}`, depth + 1)) return true;
        continue;
      }
      const lower = name.toLowerCase();
      for (const ext of SOURCE_EXTS) {
        if (lower.endsWith(ext)) return true;
      }
    }
  } catch {
    return false;
  }
  return false;
}

/** Heuristic: any source file under stack dev dirs or generate root. */
export async function hasDevArtifacts(project: XuProject): Promise<boolean> {
  const gen = (project.generatePath || "").trim();
  if (!gen) return false;
  const stack = project.stackProfile;
  const dirs: string[] = [];
  if (stack) {
    for (const key of ["frontendDir", "backendDir", "desktopDir", "appDir"] as const) {
      const rel = String(stack[key] || "").trim();
      if (rel) dirs.push(joinRoot(gen, rel));
    }
  }
  if (!dirs.length) {
    dirs.push(gen);
  }
  for (const d of dirs) {
    if (await dirHasSourceFiles(d)) return true;
  }
  return false;
}

export type WaveTaskOptions = {
  bossText: string;
  playbookPath?: string;
  project: XuProject;
  emp: Employee;
  duty?: string;
  root: string;
  qaReady: boolean;
};

export async function buildWaveTask(wave: KickoffWave, opts: WaveTaskOptions): Promise<string> {
  const { bossText, playbookPath, project, emp, duty, root, qaReady } = opts;
  const boss = bossText.trim().slice(0, 1800);
  const industry = project.type || "software";
  const waveZh = waveLabelForIndustry(wave, industry);

  if (wave === "planning") {
    let archLine = "";
    if (project.type === "software" && project.id) {
      try {
        const { loadBrief } = await import("../intent/briefStore");
        const { formatArchitectureConstraintLine } = await import("../intent/briefTypes");
        const b = await loadBrief(project.id);
        archLine = formatArchitectureConstraintLine(b);
      } catch {
        /* ignore */
      }
    }
    return [
      `【Boss 开工 · ${waveZh}波次】`,
      boss,
      archLine,
      duty ? `【你的职责】${duty}` : `【你的角色】${emp.role}——产出需求/PRD/目录规划`,
      `【可写目录】${root}`,
      project.docPath ? `【只读参考】${project.docPath}` : "",
      kickoffPlanningSteps(playbookPath),
      "本波次只做规划与文档，不写实现代码。",
      "若尚未有页面清单：请在 Brief / .xu/design/pages.json 写出本产品全部页面（名称、路由、用途）。",
    ]
      .filter(Boolean)
      .join("\n");
  }

  if (wave === "design") {
    const { buildDesignWaveExtraInstructions, readDesignMode } = await import(
      "../intent/designArtifacts"
    );
    const mode = project.type === "software" ? await readDesignMode(project) : null;
    const extra = await buildDesignWaveExtraInstructions(project, mode);
    return [
      `【Boss 开工 · ${waveZh}波次 · 设计预览】`,
      boss,
      duty ? `【你的职责】${duty}` : `【你的角色】${emp.role}——产出设计预览（上传整理 / HTML 预览 / Canvas 简图）`,
      `【可写目录】${root}`,
      `【设计目录】${root}/.xu/design/（只允许写此处，禁止写业务 src/）`,
      extra,
      "同步更新 .xu/design/pages.json 与 Brief 页面状态为 designed。",
      "禁止编写业务实现代码（.vue/.ts 业务组件等）。用户确认设计并冻结后才会进入开发波次。",
      kickoffPlanningSteps(playbookPath),
    ]
      .filter(Boolean)
      .join("\n");
  }

  if (wave === "dev") {
    return [
      `【Boss 开工 · ${waveZh}波次】`,
      boss,
      duty ? `【你的职责】${duty}` : `【你的角色】${emp.role}——实现代码/骨架/配置`,
      `【可写目录】${root}`,
      `【必须遵守设计定稿】读取 ${root}/.xu/design/APPROVED.md 与 approved/ 下各页线框，按定稿实现页面；未确认的页面不得实现。`,
      kickoffPlanningSteps(playbookPath),
      "实现阶段：在 frontend/backend 等子目录落盘源码；文本 write_file；Word office_write_docx。",
      project.type === "software"
        ? [
            "请先 git checkout -B feature/<切片>，禁止在 main 上直接提交。",
            "写完一个切片必须停下来做【代码 Review】：对照 lint/diff 自检。Rust 路径校验是 Review 重点。有阻断问题先修，禁止合入 dev，更禁止合 main。",
            "核心模块（授权、文件读写、模型调用）写单元测试或本地自测说明。",
            "【跨模块铁律】涉及两个以上模块/端（frontend/backend/桌面等）或跨人接口时：先输出 XU_CROSS_MODULE: 模块、调用方、被调方、待对齐点，并 XU_NEED_CONFIRM。禁止先写跨模块实现。对齐或 Boss「确认跨模块 / 开写」后再写。",
          ].join("\n")
        : "",
    ]
      .filter(Boolean)
      .join("\n");
  }

  if (wave === "qa") {
    if (!qaReady && project.type === "software") {
      return [
        "【QA 待命 · 禁止写测试报告】",
        "开发波次尚未产出可测源码。请 list_dir 检查 frontend/backend 目录。",
        "若无 .ts/.vue/.rs 等源码文件：只输出 XU_PHASE: WAITING_DEV 并结束，禁止 write_file/office_write 测试报告。",
        `【生成根】${root}`,
      ].join("\n");
    }
    if (project.type === "software") {
      const { ensureSecurityChecklistDraft } = await import("./securityGate");
      await ensureSecurityChecklistDraft(project);
      return buildQaTask(project, boss.slice(0, 200) || "当前迭代");
    }
    return [
      `【Boss 开工 · ${waveZh}波次】`,
      boss,
      duty ? `【你的职责】${duty}` : `【你的角色】${emp.role}——验收/评审交付物`,
      `【可写目录】${root}`,
      kickoffPlanningSteps(playbookPath),
      "对照需求与方案检查交付物，输出验收/评审清单。",
    ]
      .filter(Boolean)
      .join("\n");
  }

  if (wave === "security") {
    if (!qaReady && project.type === "software") {
      return [
        "【安全审查待命 · 禁止写清单】",
        "测试波次尚未完成或尚无源码。请先完成 QA 波并产出可测交付物。",
        `【生成根】${root}`,
      ].join("\n");
    }
    if (project.type === "software") {
      const { buildSecurityWaveTask, ensureSecurityChecklistDraft } = await import("./securityGate");
      await ensureSecurityChecklistDraft(project);
      return buildSecurityWaveTask(project, boss);
    }
    return [
      `【Boss 开工 · ${waveZh}波次】`,
      boss,
      duty ? `【你的职责】${duty}` : `【你的角色】${emp.role}——安全/合规审查`,
      `【可写目录】${root}`,
      kickoffPlanningSteps(playbookPath),
      "对照威胁面输出安全检查清单。",
    ]
      .filter(Boolean)
      .join("\n");
  }

  if (wave === "ops") {
    return [
      `【Boss 开工 · ${waveZh}波次】`,
      boss,
      duty ? `【你的职责】${duty}` : `【你的角色】${emp.role}——部署/运维/收尾`,
      `【可写目录】${root}`,
      kickoffPlanningSteps(playbookPath),
      "完成环境、部署脚本、监控与运维文档。",
      project.type === "software"
        ? "【必须】写入 `.xu/ops/MONITOR.md`：日志（报错/AI/授权）、监控告警要点、回滚说明。写完后本轮进入 UAT，敏捷项目下一轮回到需求。"
        : "",
    ]
      .filter(Boolean)
      .join("\n");
  }

  return [
    "【Boss 开工指令 · 先规划再落盘】",
    boss,
    duty ? `【你的职责】${duty}` : `【你的角色】${emp.role}——按岗位产出可交付内容`,
    `【可写目录】${root}`,
    kickoffPlanningSteps(playbookPath),
    "实现阶段：文本 write_file；Word office_write_docx；Excel office_write_xlsx。",
  ]
    .filter(Boolean)
    .join("\n");
}

export function kickoffWaveOrder(industry: ProjectType = "software"): KickoffWave[] {
  return kickoffWaveOrderForIndustry(industry);
}

export function waveLabel(w: KickoffWave, industry: ProjectType = "software"): string {
  return waveLabelForIndustry(w, industry);
}

/** Wait until all listed employees emit agent done/error or go idle (timeout). */
export function waitForEmployeesDone(
  employeeIds: string[],
  timeoutMs = 45 * 60 * 1000,
): Promise<{ done: string[]; timedOut: boolean }> {
  if (!employeeIds.length) return Promise.resolve({ done: [], timedOut: false });
  const pending = new Set(employeeIds);
  const finished = new Set<string>();

  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      unsub();
      resolve({ done: [...finished], timedOut: pending.size > 0 });
    }, timeoutMs);

    const onDone = (ev: AgentLiveEvent) => {
      const eid = ev.employeeId;
      if (!eid || !pending.has(eid)) return;
      if (ev.kind === "done" || ev.kind === "error") {
        pending.delete(eid);
        finished.add(eid);
        if (!pending.size) {
          window.clearTimeout(timer);
          unsub();
          resolve({ done: [...finished], timedOut: false });
        }
      }
    };

    const unsub = subscribeAgentLive(onDone);
  });
}

const PHASED_TYPES = new Set<ProjectType>(["software", "delivery", "consulting", "internal"]);

export function shouldUsePhasedKickoff(project: XuProject | null | undefined): boolean {
  if (!project) return false;
  if (!PHASED_TYPES.has(project.type)) return false;
  if (project.type === "software") {
    return (project.kickoffMode || "phased") === "phased";
  }
  return true;
}

export function isStrictKickoff(project: XuProject | null | undefined): boolean {
  return project?.type === "software" && project.kickoffMode === "strict";
}

/** Whether QA wave should wait for dev artifacts (software only). */
export function qaWaveNeedsDevGate(project: XuProject | null | undefined): boolean {
  return project?.type === "software";
}

/** Software + industry workflow still includes a design wave. */
export function designWaveNeedsConfirmGate(project: XuProject | null | undefined): boolean {
  if (project?.type !== "software") return false;
  return getIndustryWorkflow(project.type).waves.includes("design");
}
