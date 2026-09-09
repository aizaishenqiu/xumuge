/**
 * @file 项目队列推进：结项检测、切换办公室、自动开工
 * @author qiuye <yjk150@qq.com>
 * @date 2026-09-02
 * @version 1.0.0
 * @category Schedule
 * @algo sequential-queue-runner
 */

import { appendFouMessage } from "./employees";
import { loadEmployees, readEmployees } from "./employees";
import { loadBrief } from "../intent/briefStore";
import { runBriefMatchedKickoff } from "../intent/briefMatchedKickoff";
import { runProjectKickoff } from "./projectKickoff";
import {
  isProjectIncomplete,
  loadProjects,
  type XuProject,
} from "./projects";
import {
  advanceQueuePointer,
  loadProjectQueue,
  queuePosition,
  type ProjectQueueState,
} from "./projectQueue";
import { switchOfficeProject } from "./switchOfficeProject";
import { stopAllEmployeeDispatches } from "../employee/dispatch";
import { trySoftwareAutopilotGates } from "./softwareAutopilotWorkflow";

const OFFICE_SESSION = "office-floor";
let advanceInflight = false;

/** Whether project counts as complete for queue advance. */
export function isProjectQueueComplete(p: XuProject): boolean {
  if (p.type === "software") {
    const w = p.workflow;
    if (w?.state === "done") return true;
    const agile = (p.kickoffMode || "phased") !== "strict";
    if (agile && p.queueCompleteOnUat === true && w?.state === "acceptance") {
      return false;
    }
    return w?.state === "done";
  }
  return !isProjectIncomplete(p);
}

async function systemLine(content: string): Promise<void> {
  try {
    await appendFouMessage({ sessionTag: OFFICE_SESSION, role: "system", content });
  } catch {
    /* ignore */
  }
}

/** Start kickoff for a queued project after office switch. */
export async function startQueuedProject(project: XuProject): Promise<void> {
  const emps = await loadEmployees().catch(() => readEmployees());
  await switchOfficeProject(project, emps);

  const brief = await loadBrief(project.id).catch(() => null);
  if (brief?.status === "gathering") {
    await systemLine(
      `📋 队列已切换到「${project.name}」，但需求仍在澄清中。请完成澄清并确认需求后再开工。`,
    );
    return;
  }

  if (brief?.status === "ready" || brief?.status === "executing") {
    await runBriefMatchedKickoff({
      project,
      brief,
      bossText: `【队列开工】${project.name}：请按职责在生成路径落盘交付物。`,
      quiet: false,
    });
  } else {
    await runProjectKickoff(project);
  }

  await trySoftwareAutopilotGates(project.id);
}

/** After current queue item completes, advance and start next. */
export async function tryAdvanceAfterProjectComplete(
  projectId: string,
  opts?: { force?: boolean },
): Promise<boolean> {
  if (advanceInflight) return false;
  advanceInflight = true;
  try {
    const q = await loadProjectQueue();
    if (!q.enabled || !q.autoAdvance) return false;
    if (q.currentProjectId !== projectId) return false;

    const projects = await loadProjects();
    const cur = projects.find((p) => p.id === projectId);
    if (!cur) return false;
    if (!opts?.force && !isProjectQueueComplete(cur)) return false;

    await systemLine(`✅ 队列项目「${cur.name}」已结项，准备下一项…`);

    try {
      await stopAllEmployeeDispatches();
    } catch {
      /* best effort */
    }

    const adv = await advanceQueuePointer();
    if (!adv.nextId) {
      await systemLine("🎉 项目队列已全部完成。");
      return true;
    }

    const next = (await loadProjects()).find((p) => p.id === adv.nextId);
    if (!next) {
      await systemLine("⚠️ 下一队列项目不存在，已跳过。");
      return false;
    }

    const pos = queuePosition(await loadProjectQueue(), next.id);
    const total = (await loadProjectQueue()).orderedProjectIds.length;
    await systemLine(
      `▶️ 队列 ${pos}/${total}：开始「${next.name}」`,
    );
    await startQueuedProject(next);
    return true;
  } finally {
    advanceInflight = false;
  }
}

/** Check delivery/non-software completion after progress update. */
export async function notifyProjectMaybeComplete(projectId: string): Promise<void> {
  const projects = await loadProjects();
  const p = projects.find((x) => x.id === projectId);
  if (!p || p.type === "software") return;
  if (!isProjectQueueComplete(p)) return;
  await tryAdvanceAfterProjectComplete(projectId);
}

/** Called when agile project opts into queue exit on UAT (before agile loop). */
export async function tryAdvanceAfterAgileUat(projectId: string): Promise<void> {
  const p = (await loadProjects()).find((x) => x.id === projectId);
  if (!p?.queueCompleteOnUat) return;
  await tryAdvanceAfterProjectComplete(projectId, { force: true });
}

let bridgeStarted = false;

/** App-level bridge: refresh queue cache on change. */
export function ensureProjectQueueBridge(): void {
  if (bridgeStarted) return;
  bridgeStarted = true;
  void loadProjectQueue();
  window.addEventListener("xu-project-queue-changed", () => {
    void loadProjectQueue();
  });
}

export function formatQueueBadge(state: ProjectQueueState, projectName?: string): string | null {
  if (!state.enabled || !state.orderedProjectIds.length) return null;
  const cur = state.currentProjectId;
  const pos = cur ? queuePosition(state, cur) : 0;
  const total = state.orderedProjectIds.length;
  if (!pos) return `队列 ${total} 项`;
  const name = projectName ? ` · ${projectName}` : "";
  return `队列 ${pos}/${total}${name}`;
}
