/**
 * After planning / tech confirm: pull idle product, engineers, and all reviewers.
 */
import { appendFouMessage, dispatchEmployeeTask, type Employee } from "../employee";
import { classifyKickoffWave, buildWaveTask, type KickoffWave } from "./kickoffOrchestrator";
import { readKickoffParallel } from "./concurrencySlots";
import {
  buildMidDevReviewTask,
  pendingGateForReviewers,
  pickMidDevReviewers,
  writeCodeReviewGate,
} from "./codeReviewGate";
import type { XuProject } from "./projects";

export function listIdleNonBoss(employees: Employee[]): Employee[] {
  return employees.filter((e) => e.roleKind !== "boss" && e.status === "idle");
}

export function pickIdleByWaves(
  employees: Employee[],
  waves: KickoffWave[],
  industry: XuProject["type"] = "software",
): Employee[] {
  const allow = new Set(waves);
  return listIdleNonBoss(employees).filter((e) =>
    allow.has(classifyKickoffWave(e, industry || "software")),
  );
}

async function systemMsg(sessionTag: string, content: string, quiet?: boolean) {
  if (quiet) return;
  try {
    await appendFouMessage({ sessionTag, role: "system", content });
  } catch {
    /* ignore */
  }
}

async function dispatchInSlots(
  emps: Employee[],
  run: (emp: Employee) => Promise<void>,
): Promise<void> {
  const slot = Math.max(1, readKickoffParallel());
  for (let i = 0; i < emps.length; i += slot) {
    const chunk = emps.slice(i, i + slot);
    await Promise.all(chunk.map((emp) => run(emp)));
  }
}

export type IdleSurgeOpts = {
  project: XuProject;
  roster: Employee[];
  excludeIds?: Iterable<string>;
  bossText?: string;
  playbookPath?: string;
  mapEmployee?: (e: Employee) => Employee;
  sessionTag?: string;
  quiet?: boolean;
};

function excludeSet(opts: IdleSurgeOpts): Set<string> {
  return new Set([...(opts.excludeIds || [])].filter(Boolean));
}

async function dispatchWaveHelpers(
  opts: IdleSurgeOpts,
  helpers: Employee[],
  wave: KickoffWave,
  label: string,
): Promise<Employee[]> {
  const project = opts.project;
  const root = (project.generatePath || "").trim();
  if (!helpers.length || !root) return [];
  const mapEmp = opts.mapEmployee || ((e: Employee) => e);
  const sent: Employee[] = [];
  await dispatchInSlots(helpers, async (emp) => {
    const ws = (emp.workspaceRoot || "").trim() || root;
    if (wave === "dev" && project.type === "software") {
      const { ensureFeatureGitBranch } = await import("./gitBranchPolicy");
      await ensureFeatureGitBranch(ws, emp.id);
    }
    try {
      const task = await buildWaveTask(wave, {
        bossText:
          opts.bossText ||
          (wave === "dev" ? "【空闲增援 · 写码】请接下当前未完成切片。" : "【空闲增援 · 收尾规划】请补齐规划/设计文档。"),
        playbookPath: opts.playbookPath,
        project,
        emp,
        duty: wave === "dev" ? "增援当前未完成切片" : "规划/设计收尾",
        root: ws,
        qaReady: true,
      });
      const result = await dispatchEmployeeTask(mapEmp({ ...emp, workspaceRoot: ws }), {
        task,
        projectId: project.id,
        directImplement: false,
        workspaceRoot: ws,
      });
      if (!result.queuedOnly) sent.push(emp);
    } catch (e) {
      console.warn("[xu] idle surge", emp.name, e);
    }
  });
  if (sent.length) {
    await systemMsg(
      opts.sessionTag || "office-floor",
      `▶ ${label}（${sent.length} 人）：${sent.map((e) => e.name).join("、")}`,
      opts.quiet,
    );
  }
  return sent;
}

/** After planning wave: idle 产品/设计收尾；技术方案已确认才拉空闲程序员。 */
export async function surgeIdleAfterPlanning(opts: IdleSurgeOpts): Promise<Employee[]> {
  const skip = excludeSet(opts);
  const industry = opts.project.type || "software";
  const helpers = pickIdleByWaves(opts.roster, ["planning", "design"], industry).filter(
    (e) => !skip.has(e.id),
  );
  const sent = await dispatchWaveHelpers(opts, helpers, "planning", "空闲产品/设计收尾");
  const { isTechDesignConfirmed } = await import("./techDesignGate");
  if (await isTechDesignConfirmed(opts.project)) {
    sent.push(...(await surgeIdleEngineers(opts, new Set([...skip, ...sent.map((e) => e.id)]))));
  }
  return sent;
}

export async function surgeIdleEngineers(
  opts: IdleSurgeOpts,
  extraSkip?: Set<string>,
): Promise<Employee[]> {
  const { isTechDesignConfirmed } = await import("./techDesignGate");
  if (!(await isTechDesignConfirmed(opts.project))) return [];
  const { isCrossModuleBlocking } = await import("./crossModuleGate");
  if (await isCrossModuleBlocking(opts.project.generatePath || "")) return [];
  const skip = new Set([...excludeSet(opts), ...(extraSkip || [])]);
  const engineers = pickIdleByWaves(opts.roster, ["dev"], opts.project.type || "software").filter(
    (e) => !skip.has(e.id),
  );
  return dispatchWaveHelpers(opts, engineers, "dev", "空闲程序员增援写码");
}

/** All idle reviewers/QA — not just one. */
export async function surgeIdleReviewers(opts: IdleSurgeOpts): Promise<Employee[]> {
  const skip = excludeSet(opts);
  const idle = listIdleNonBoss(opts.roster).filter((e) => !skip.has(e.id));
  let reviewers = pickMidDevReviewers(idle);
  if (!reviewers.length) {
    reviewers = pickMidDevReviewers(opts.roster.filter((e) => e.roleKind !== "boss" && !skip.has(e.id)));
  }
  const root = (opts.project.generatePath || "").trim();
  if (!reviewers.length || !root) return [];
  await writeCodeReviewGate(
    root,
    pendingGateForReviewers(reviewers.map((e) => e.id), "多人代码 Review"),
  );
  const mapEmp = opts.mapEmployee || ((e: Employee) => e);
  const sent: Employee[] = [];
  await dispatchInSlots(reviewers, async (emp) => {
    const ws = (emp.workspaceRoot || "").trim() || root;
    try {
      const result = await dispatchEmployeeTask(mapEmp({ ...emp, workspaceRoot: ws }), {
        task: buildMidDevReviewTask(opts.project.name, root, emp.id),
        projectId: opts.project.id,
        directImplement: false,
        workspaceRoot: ws,
      });
      if (!result.queuedOnly) sent.push(emp);
    } catch (e) {
      console.warn("[xu] idle review surge", emp.name, e);
    }
  });
  if (sent.length) {
    await systemMsg(
      opts.sessionTag || "office-floor",
      `▶ 代码 Review（${sent.length} 人，须全员通过才合 dev）：${sent.map((e) => e.name).join("、")}`,
      opts.quiet,
    );
  }
  return sent;
}
