import type { Employee } from "./employees";
import { appendFouMessage, readEmployees, saveEmployeesBatch } from "./employees";
import type { ProjectAssignment, ProjectTheme } from "./projectTheme";
import { recomputeOverallProgress } from "./projectTheme";
import { dispatchEmployeeTask } from "../employee";

/** Local (template) AI-ish work split by role + brief keywords. */
export function allocateWorkLocal(
  project: Pick<ProjectTheme, "name" | "goal" | "brief" | "phase">,
  employees: Employee[],
  selectedIds?: string[] | null,
): ProjectAssignment[] {
  let workers = employees.filter((e) => e.roleKind !== "boss");
  if (selectedIds && selectedIds.length > 0) {
    const set = new Set(selectedIds);
    workers = workers.filter((e) => set.has(e.id));
  }
  const brief = `${project.goal}\n${project.brief}`.toLowerCase();
  const isHotfix = project.phase === "hotfix" || /bug|崩溃|修复|hotfix/.test(brief);
  const isDocs = /文档|策略|roadmap|说明/.test(brief);
  const isUi = /ui|界面|办公室|3d|前端|样式/.test(brief);

  return workers.map((emp, i) => {
    let duty = "";
    let checklist: string[] = [];
    if (emp.roleKind === "reviewer") {
      duty = `审核「${project.name}」相关变更质量与边界`;
      checklist = ["阅读项目 brief", "对照验收标准抽查", "给出可合并/需改意见"];
    } else if (isHotfix) {
      duty = `热修：定位并修复「${project.name}」相关问题`;
      checklist = ["复现问题", "最小改动修复", "自测后提审"];
    } else if (isDocs && i === 0) {
      duty = `整理「${project.name}」文档与可读材料`;
      checklist = ["补全说明段落", "挂载只读文档清单", "同步进度到协作条"];
    } else if (isUi || /前端|工程师/.test(emp.role)) {
      duty = `实现「${project.name}」：${project.goal.slice(0, 40) || emp.role}`;
      checklist = ["确认可写工作区", "按 checklist 提交增量", "截图/日志回传协作条"];
    } else {
      duty = `推进「${project.name}」中与「${emp.role}」相关的交付`;
      checklist = ["阅读项目目标", "拆出今日可完成项", "完成后更新进度"];
    }
    return {
      employeeId: emp.id,
      employeeName: emp.name,
      role: emp.role,
      duty,
      checklist,
      progress: 0,
      status: "pending" as const,
    };
  });
}

/** Remote-style: ask first available engineer to refine the split (虚募阁 Native Agent). */
export function buildRemoteSplitPrompt(project: ProjectTheme): string {
  return [
    `【项目拆分】请根据以下项目内容，为团队做任务拆分（每人 1～3 条可执行任务）。`,
    `项目：${project.name}`,
    `目标：${project.goal}`,
    `说明：\n${project.brief}`,
    `阶段：${project.phase}`,
    `请用简洁中文列出：角色/姓名建议 · 任务 · 完成定义。不要写代码。`,
  ].join("\n");
}

export async function announceStaffing(
  project: ProjectTheme,
  employees: Employee[],
  opts?: { dispatchTasks?: boolean },
): Promise<void> {
  const dispatchTasks = opts?.dispatchTasks !== false;

  await appendFouMessage({
    sessionTag: "office-floor",
    employeeId: null,
    role: "system",
    content: `📌 项目「${project.name}」已创建 · 总体进度 ${project.progress}%\n目标：${project.goal}`,
  });
  if (project.assignments.length) {
    const lines = project.assignments
      .slice(0, 8)
      .map((a) => `· ${a.employeeName}（${a.role}）：${a.duty}`);
    const more =
      project.assignments.length > 8
        ? `\n…另有 ${project.assignments.length - 8} 人，详见「工作监控」页`
        : "";
    await appendFouMessage({
      sessionTag: "office-floor",
      employeeId: null,
      role: "system",
      content: `🔔 任务已分配给 ${project.assignments.length} 人：\n${lines.join("\n")}${more}`,
    });
  }

  // One batch status write — never N× saveEmployee (that storms 3D rebuilds)
  const workingBatch: Employee[] = [];
  for (const a of project.assignments) {
    const emp = employees.find((e) => e.id === a.employeeId);
    if (!emp || emp.status === "working") continue;
    workingBatch.push({ ...emp, status: "working" });
  }
  if (workingBatch.length) {
    try {
      await saveEmployeesBatch(workingBatch);
    } catch {
      /* ignore */
    }
  }

  if (!dispatchTasks) return;

  const fresh = readEmployees();
  // Cap mass dispatch — firing N hermes chats freezes the desktop
  const DISPATCH_CAP = 3;
  let dispatched = 0;
  for (const a of project.assignments) {
    if (dispatched >= DISPATCH_CAP) break;
    const emp = fresh.find((e) => e.id === a.employeeId);
    if (!emp?.workspaceRoot?.trim()) continue;
    const task = [
      `【项目】${project.name}`,
      `【目标】${project.goal}`,
      `【你的职责】${a.duty}`,
      `【清单】\n${a.checklist.map((c, i) => `${i + 1}. ${c}`).join("\n")}`,
      project.brief ? `【说明】\n${project.brief}` : "",
      `请开始执行；完成后简要汇报进度。`,
    ]
      .filter(Boolean)
      .join("\n");
    try {
      await dispatchEmployeeTask(emp, { task, projectId: project.id });
      dispatched += 1;
    } catch {
      /* no workspace / brain */
    }
  }
  if (project.assignments.length > dispatched) {
    try {
      await appendFouMessage({
        sessionTag: "office-floor",
        employeeId: null,
        role: "system",
        content: `其余 ${project.assignments.length - dispatched} 人已领任务，可在协作条对具体员工点「派活」。`,
      });
    } catch {
      /* ignore */
    }
  }

  const planner =
    fresh.find((e) => e.brainSlot === "code" && e.workspaceRoot) ||
    fresh.find((e) => e.roleKind === "worker" && e.workspaceRoot);
  if (planner && project.staffingSource === "hybrid") {
    try {
      await dispatchEmployeeTask(planner, {
        task: buildRemoteSplitPrompt(project),
        projectId: project.id,
      });
    } catch {
      /* ignore */
    }
  }
}

export function bumpAssignmentProgress(
  project: ProjectTheme,
  employeeId: string,
  progress: number,
  status?: ProjectAssignment["status"],
): ProjectTheme {
  const next = {
    ...project,
    assignments: project.assignments.map((a) =>
      a.employeeId === employeeId
        ? {
            ...a,
            progress: Math.max(0, Math.min(100, progress)),
            status: status ?? (progress >= 100 ? "done" : progress > 0 ? "working" : a.status),
          }
        : a,
    ),
  };
  next.progress = recomputeOverallProgress(next);
  next.updatedAt = Date.now();
  return next;
}
