/**
 * @file 软件工作流：规划、设计、开发、Review、QA、UAT 与需求门禁
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-30
 * @version 1.1.0
 * @category AgentLoop
 * @algo gated-workflow-state-machine
 */
import { invoke } from "@tauri-apps/api/core";
import { BRAND_NAME_ZH } from "./brandSettings";
import { mkdirRecursive, writeTextUnderWorkspace } from "./fsBridge";
import { dispatchEmployeeTask } from "../employee";
import { subscribeAgentLive, type AgentLiveEvent } from "../employee/events";
import type { Employee } from "./employees";
import { appendFouMessage, readEmployees } from "./employees";
import { notifyBoss } from "./channelConnections";
import { parseBossIntent } from "./bossIntent";
import { buildPlanArtifactMarkdown, parseXuTasks } from "./xuTasksParser";
import {
  defaultProjectWorkflow,
  type XuProject,
  type ProjectWorkflow,
  type WorkflowTaskItem,
  loadProjects,
  saveProjects,
} from "./projects";
import { getAgencyRole } from "../office/agencyRoles";
import { dispatchDefectFix, dispatchQaForFeature, executeDefectDispatchFromTool, loadDefects, openDefects } from "./workflowQa";
import { loadCodeExecPrefs } from "./codeExecPrefs";
import { writeGuiConsent } from "./guiConsent";
import { readDriveSettings, writeDriveSettings } from "./driveSettings";
import { kickoffPlanningSteps } from "./projectDispatchHints";
import { stackDirMapMarkdown } from "./projectStack";
import {
  ensureDesignScaffold,
  XU_DESIGN_CONFIRM_NEEDED,
} from "../intent/designArtifacts";
import { loadBrief } from "../intent/briefStore";
import { readCodeReviewGate } from "./codeReviewGate";
import { crossModuleDevRule } from "./crossModuleGate";
import { syncRequirementsGateToBrief } from "./requirementsGate";

const PLANNER_ROLE_IDS = [
  "agents-orchestrator",
  "software-company__agents-orchestrator",
  "project-manager-senior",
  "product-manager",
];

const QA_ROLE_HINTS = /测试|qa|quality|质检/i;
const DEV_ROLE_HINTS = /工程|开发|前端|后端|全栈|工程师|architect/i;

type ActiveRun = {
  projectId: string;
  employeeId: string;
  role: "planner" | "dev" | "qa" | "review";
  taskId?: string;
};

let activeRun: ActiveRun | null = null;
let bridgeStarted = false;

export function findPlanner(employees: Employee[], project: XuProject): Employee | null {
  const pool = employees.filter((e) => {
    if (e.roleKind === "boss") return false;
    if (project.employeeIds.length && !project.employeeIds.includes(e.id)) return false;
    return true;
  });
  for (const rid of PLANNER_ROLE_IDS) {
    const hit = pool.find((e) => e.agentRoleId === rid);
    if (hit) return hit;
  }
  const pm = pool.find((e) => /规划|编排|项目经理|产品/.test(e.role));
  if (pm) return pm;
  return pool[0] ?? null;
}

export function matchEmployeeForTask(
  task: WorkflowTaskItem,
  employees: Employee[],
  project: XuProject,
): Employee | null {
  const pool = employees.filter((e) => {
    if (e.roleKind === "boss") return false;
    if (project.employeeIds.length && !project.employeeIds.includes(e.id)) return false;
    return true;
  });
  const hint = task.roleHint.toLowerCase();
  if (QA_ROLE_HINTS.test(hint)) {
    return (
      pool.find((e) => QA_ROLE_HINTS.test(e.role) || /qa/i.test(e.agentRoleId || "")) ||
      pool.find((e) => /测试|工程/.test(e.role)) ||
      null
    );
  }
  const byRole = pool.find((e) => {
    const ar = getAgencyRole(e.agentRoleId);
    const zh = `${ar?.nameZh || ""} ${e.role}`.toLowerCase();
    return hint.split(/[/、\s]+/).some((h) => h.length >= 2 && zh.includes(h));
  });
  if (byRole) return byRole;
  if (DEV_ROLE_HINTS.test(hint)) {
    return pool.find((e) => DEV_ROLE_HINTS.test(e.role)) || pool[0] || null;
  }
  return pool[0] ?? null;
}

export async function syncSoftwareWorkflowState(
  projectId: string,
  state: ProjectWorkflow["state"],
): Promise<void> {
  await patchProjectWorkflow(projectId, { state });
}

async function patchProjectWorkflow(
  projectId: string,
  patch: Partial<ProjectWorkflow>,
): Promise<XuProject | null> {
  const list = await loadProjects();
  const i = list.findIndex((p) => p.id === projectId);
  if (i < 0) return null;
  const prev = list[i]!;
  const wf: ProjectWorkflow = {
    ...(prev.workflow ?? defaultProjectWorkflow()),
    ...patch,
    updatedAt: Date.now(),
  };
  list[i] = { ...prev, workflow: wf, updatedAt: Date.now() };
  await saveProjects(list);
  window.dispatchEvent(new CustomEvent("xu-projects-changed"));
  return list[i]!;
}

function plannerTask(project: XuProject): string {
  const playbook = project.requirements?.playbookPath || "REQUIREMENTS_PLAYBOOK.md";
  const gen = project.generatePath || "（未设生成路径）";
  return [
    "【软件规划师 · 全流程编排】",
    `项目：${project.name}`,
    "",
    "你必须先 read_file 阅读需求与 playbook，再产出团队计划。",
    `1. read_file：${playbook}`,
    `2. list_dir：${gen}`,
    "",
    "输出要求（强制标记）：",
    "XU_TASKS:",
    "1. [产品] …",
    "2. [前端] …",
    "3. [测试] …",
    "",
    "每项写清：岗位关键词、任务标题、交付物。",
    "跨岗疑问：先短讨论；仍不决则 XU_NEED_CONFIRM: 列出问题（上报经理→老板）。",
    "禁止空口声称已写文件；规划阶段只读分析。",
  ].join("\n");
}

function devTask(project: XuProject, task: WorkflowTaskItem): string {
  const genPath = (project.generatePath || "").trim();
  const stack = project.stackProfile;
  return [
    "【开发任务 · 先规划再落盘】",
    `项目：${project.name}`,
    `任务：${task.title}`,
    task.deliverable ? `交付物：${task.deliverable}` : "",
    `可写目录：${genPath}`,
    project.requirements?.playbookPath
      ? `需求：${project.requirements.playbookPath}`
      : "",
    stack && genPath ? stackDirMapMarkdown(stack, genPath) : "",
    kickoffPlanningSteps(project.requirements?.playbookPath),
    "在 feature/<任务> 分支开发，禁止在 main 上提交。Review 全员通过后才能合入 dev。",
    crossModuleDevRule(),
    "用 write_file / patch_file / office_write_* 按 XU_TASKS 路径落盘；禁止根目录散落文件。",
  ]
    .filter(Boolean)
    .join("\n");
}

export async function notifyPlanReviewFeishu(
  project: XuProject,
  plannerName: string,
  tasks: WorkflowTaskItem[],
): Promise<void> {
  const summary = tasks
    .slice(0, 8)
    .map((t, i) => `${i + 1}. [${t.roleHint}] ${t.title}`)
    .join("\n");
  const body = [
    `【待拍板 · 项目计划】${project.name}`,
    `规划师：${plannerName}`,
    `任务 ${tasks.length} 条：`,
    summary,
    tasks.length > 8 ? "…" : "",
    "",
    "回复「同意」或具体修改意见",
  ]
    .filter(Boolean)
    .join("\n");
  await notifyBoss({
    kind: "need_confirm",
    title: `${BRAND_NAME_ZH} · ${project.name} 计划待拍板`,
    body,
    channel: "feishu",
    force: true,
  });
  const plannerEmp = readEmployees().find((e) => e.id === project.workflow?.plannerEmployeeId);
  await appendFouMessage({
    sessionTag: "office-floor",
    employeeId: plannerEmp?.id ?? null,
    role: "assistant",
    content: `【${plannerName} · 分析】\n${body}`,
  });
  await appendFouMessage({
    sessionTag: "office-floor",
    role: "system",
    content: `📋 项目「${project.name}」计划已提交 Boss 拍板（飞书已通知）`,
  });
}

export async function notifyAcceptanceFeishu(project: XuProject): Promise<void> {
  const body = [
    `【待验收 · 项目完成】${project.name}`,
    "全部开发任务与 QA 已通过。",
    "回复「验收通过」结项，或列出遗留问题。",
  ].join("\n");
  await notifyBoss({
    kind: "acceptance",
    title: `${BRAND_NAME_ZH} · ${project.name} 待验收`,
    body,
    channel: "feishu",
    force: true,
  });
}

export async function startPlannerWorkflow(project: XuProject): Promise<void> {
  const emps = readEmployees();
  const planner = findPlanner(emps, project);
  if (!planner) throw new Error("花名册无可用规划师/项目经理");
  if (!project.generatePath?.trim()) throw new Error("请设置生成路径");
  await patchProjectWorkflow(project.id, {
    state: "planning",
    plannerEmployeeId: planner.id,
    taskBoard: [],
    activeFeatureId: null,
  });
  activeRun = { projectId: project.id, employeeId: planner.id, role: "planner" };
  await dispatchEmployeeTask(planner, {
    task: plannerTask(project),
    workspaceRoot: planner.workspaceRoot || project.generatePath,
    projectId: project.id,
    directImplement: false,
    qaMode: false,
  });
  await appendFouMessage({
    sessionTag: "office-floor",
    role: "system",
    content: `📐 规划师 ${planner.name} 开始读取需求并拆分任务…`,
  });
}

async function onPlannerDone(projectId: string, content: string): Promise<void> {
  const list = await loadProjects();
  const project = list.find((p) => p.id === projectId);
  if (!project) return;
  const tasks = parseXuTasks(content);
  if (!tasks.length) {
    await appendFouMessage({
      sessionTag: "office-floor",
      role: "system",
      content: `⚠️ 规划师未输出 XU_TASKS，请 Boss 在办公室补充任务或重新派活规划师。`,
    });
    await patchProjectWorkflow(projectId, { state: "plan_review" });
    return;
  }
  const planner = readEmployees().find((e) => e.id === project.workflow?.plannerEmployeeId);
  const planPath = `${project.generatePath.replace(/[/\\]$/, "")}/PROJECT_PLAN.md`;
  const md = buildPlanArtifactMarkdown(project.name, tasks, planner?.name || "规划师");
  try {
    const genPath = project.generatePath.replace(/[/\\]$/, "");
    const dir = planPath.replace(/[/\\][^/\\]+$/, "");
    await mkdirRecursive(genPath, dir);
    await writeTextUnderWorkspace(genPath, planPath, md);
  } catch (e) {
    console.warn("write PROJECT_PLAN.md", e);
  }
  await patchProjectWorkflow(projectId, {
    state: "plan_review",
    planArtifactPath: planPath,
    taskBoard: tasks,
  });
  const updated = (await loadProjects()).find((p) => p.id === projectId);
  if (updated) await notifyPlanReviewFeishu(updated, planner?.name || "规划师", tasks);
  void import("./softwareAutopilotWorkflow").then(({ trySoftwareAutopilotGates }) =>
    trySoftwareAutopilotGates(projectId),
  );
}

export async function confirmPlanAndDispatch(projectId: string): Promise<void> {
  const project = (await loadProjects()).find((p) => p.id === projectId);
  if (!project?.workflow?.taskBoard?.length) return;
  const emps = readEmployees();
  const board = project.workflow.taskBoard.map((t) => {
    const emp = matchEmployeeForTask(t, emps, project);
    return {
      ...t,
      employeeId: emp?.id ?? null,
      status: emp ? ("assigned" as const) : ("blocked" as const),
    };
  });
  await patchProjectWorkflow(projectId, { state: "design_review", taskBoard: board });
  const updated = (await loadProjects()).find((p) => p.id === projectId);
  if (updated?.generatePath) {
    try {
      const brief = await loadBrief(projectId);
      await ensureDesignScaffold(updated, brief);
    } catch (e) {
      console.warn("[xu] design scaffold after plan confirm", e);
    }
  }
  window.dispatchEvent(
    new CustomEvent(XU_DESIGN_CONFIRM_NEEDED, { detail: { projectId } }),
  );
  await appendFouMessage({
    sessionTag: "office-floor",
    role: "system",
    content:
      "✅ 计划已确认。请确认各页设计线框（弹窗或回复「确认设计」）后再开始写码。",
  });
  const { surgeIdleAfterPlanning } = await import("./idleSurge");
  await surgeIdleAfterPlanning({
    project: updated || project,
    roster: emps,
    excludeIds: emps.filter((e) => e.status !== "idle").map((e) => e.id),
  });
}

/** After design wireframes are approved: require tech design confirm before code. */
export async function confirmDesignAndDispatch(projectId: string): Promise<void> {
  await beginTechReviewAfterDesign(projectId);
}

export async function beginTechReviewAfterDesign(projectId: string): Promise<void> {
  const project = (await loadProjects()).find((p) => p.id === projectId);
  if (!project) return;
  const { writeTechDesignDraft, isTechDesignConfirmed } = await import("./techDesignGate");
  await writeTechDesignDraft(project);
  if (await isTechDesignConfirmed(project)) {
    await confirmTechAndDispatch(projectId);
    return;
  }
  await patchProjectWorkflow(projectId, { state: "tech_review" });
  await appendFouMessage({
    sessionTag: "office-floor",
    role: "system",
    content:
      "✅ 设计已确认。请审阅 `.xu/TECH_DESIGN.md` 后回复「确认技术方案」再写码。",
  });
}

export async function confirmTechAndDispatch(projectId: string): Promise<void> {
  const project = (await loadProjects()).find((p) => p.id === projectId);
  if (!project) return;
  const { confirmTechDesign } = await import("./techDesignGate");
  await confirmTechDesign(project);
  const { assertDevDispatchAllowed } = await import("./releaseGate");
  const fresh = (await loadProjects()).find((p) => p.id === projectId) || project;
  await assertDevDispatchAllowed(fresh);
  const { maybeOpenExternalIdeForDev } = await import("./codingSurfacePrefs");
  await maybeOpenExternalIdeForDev(fresh);
  if (fresh.workflow?.taskBoard?.length) {
    await patchProjectWorkflow(projectId, { state: "developing" });
    await dispatchNextDevTask(projectId);
    const { surgeIdleEngineers } = await import("./idleSurge");
    await surgeIdleEngineers({
      project: fresh,
      roster: readEmployees(),
      excludeIds: [fresh.workflow.taskBoard.find((t) => t.status === "working")?.employeeId || ""],
    });
    return;
  }
  const { dispatchDevAfterDesign } = await import("../intent/briefMatchedKickoff");
  await dispatchDevAfterDesign({ projectId, skipWaveWait: false });
}

async function dispatchNextDevTask(projectId: string): Promise<void> {
  const project = (await loadProjects()).find((p) => p.id === projectId);
  if (!project?.workflow) return;
  const emps = readEmployees();
  const pending = project.workflow.taskBoard.find(
    (t) =>
      (t.status === "assigned" || t.status === "pending") &&
      t.dependsOn.every((dep) =>
        project.workflow!.taskBoard.find((x) => x.taskId === dep)?.status === "done",
      ),
  );
  if (!pending) {
    await onAllTasksDone(projectId);
    return;
  }
  const emp = emps.find((e) => e.id === pending.employeeId);
  if (!emp) {
    await appendFouMessage({
      sessionTag: "office-floor",
      role: "system",
      content: `⚠️ 任务「${pending.title}」无匹配员工，请手动分配。`,
    });
    return;
  }
  const board = project.workflow.taskBoard.map((t) =>
    t.taskId === pending.taskId ? { ...t, status: "working" as const } : t,
  );
  await patchProjectWorkflow(projectId, {
    state: "developing",
    taskBoard: board,
    activeFeatureId: pending.taskId,
  });
  activeRun = {
    projectId,
    employeeId: emp.id,
    role: "dev",
    taskId: pending.taskId,
  };
  const ws = emp.workspaceRoot || project.generatePath;
  if (project.type === "software" && ws) {
    const { ensureFeatureGitBranch } = await import("./gitBranchPolicy");
    await ensureFeatureGitBranch(ws, pending.taskId);
  }
  await dispatchEmployeeTask(emp, {
    task: devTask(project, pending),
    workspaceRoot: ws,
    projectId: project.id,
    directImplement: false,
  });
}

async function onDevDone(projectId: string, taskId: string): Promise<void> {
  const project = (await loadProjects()).find((p) => p.id === projectId);
  if (!project?.workflow) return;
  const board = project.workflow.taskBoard.map((t) =>
    t.taskId === taskId ? { ...t, status: "qa" as const } : t,
  );
  await patchProjectWorkflow(projectId, {
    state: "code_review",
    taskBoard: board,
    activeFeatureId: taskId,
  });
  const root = (project.generatePath || "").trim();
  const { surgeIdleReviewers } = await import("./idleSurge");
  const reviewers = await surgeIdleReviewers({
    project,
    roster: readEmployees(),
  });
  if (!reviewers.length) {
    await appendFouMessage({
      sessionTag: "office-floor",
      role: "system",
      content: "⚠ 无审核/测试岗，代码 Review 未执行。有问题禁止合入 dev，请人工写入 `.xu/code-review.json`。",
    });
    return;
  }
  activeRun = { projectId, employeeId: reviewers[0]!.id, role: "review", taskId };
}

async function continueToQa(projectId: string, taskId: string): Promise<void> {
  const project = (await loadProjects()).find((p) => p.id === projectId);
  if (!project?.workflow) return;
  const board = project.workflow.taskBoard;
  await patchProjectWorkflow(projectId, { state: "qa", taskBoard: board, activeFeatureId: taskId });
  const task = board.find((t) => t.taskId === taskId);
  const emps = readEmployees();
  const qa =
    emps.find(
      (e) =>
        e.roleKind !== "boss" &&
        (QA_ROLE_HINTS.test(e.role) || /qa-engineer/i.test(e.agentRoleId || "")),
    ) || matchEmployeeForTask({ ...task!, roleHint: "测试" }, emps, project);
  if (!qa) {
    await patchProjectWorkflow(projectId, { state: "qa", activeFeatureId: taskId });
    await appendFouMessage({
      sessionTag: "office-floor",
      role: "system",
      content:
        "⛔ 无 QA 岗，需求验收结果无法逐项回写 `.xu/requirements-gate.json`；任务保持 QA，禁止 completed。",
    });
    return;
  }
  activeRun = { projectId, employeeId: qa.id, role: "qa", taskId };
  await dispatchQaForFeature(project, qa, task?.title || taskId);
}

async function onReviewDone(projectId: string, taskId: string): Promise<void> {
  const project = (await loadProjects()).find((p) => p.id === projectId);
  const root = (project?.generatePath || "").trim();
  const gate = root ? await readCodeReviewGate(root) : null;
  if (!gate || gate.status === "fail" || gate.status === "pending") {
    await patchProjectWorkflow(projectId, { state: "code_review" });
    await appendFouMessage({
      sessionTag: "office-floor",
      role: "system",
      content: `⛔ 代码 Review 未通过，禁止合入 dev${gate?.summary ? `：${gate.summary}` : "。请修好后再评。"}`,
    });
    return;
  }
  if (project) await syncRequirementsGateToBrief(project);
  await continueToQa(projectId, taskId);
}

async function onQaDone(projectId: string, taskId: string): Promise<void> {
  const project = (await loadProjects()).find((p) => p.id === projectId);
  if (!project?.generatePath) return;
  await syncRequirementsGateToBrief(project);
  const prefs = await loadCodeExecPrefs();
  try {
    const { runUiAcceptance } = await import("./uiAcceptanceRunner");
    const { publishUiAcceptanceReport } = await import("./uiAcceptanceReport");
    const uiRun = await runUiAcceptance(project.generatePath);
    await publishUiAcceptanceReport(project, uiRun);
  } catch {
    /* UI 批跑失败不阻断 QA 状态机 */
  }
  const defects = openDefects(await loadDefects(project.generatePath));
  const related = defects.filter((d) => d.status === "open" || d.status === "retest");
  if (related.length) {
    await patchProjectWorkflow(projectId, { state: "fixing" });
    if (prefs.autoDispatchDefectFix) {
      const devTask = project.workflow?.taskBoard.find((t) => t.taskId === taskId);
      const emps = readEmployees();
      const dev = emps.find((e) => e.id === devTask?.employeeId) || emps[0];
      if (dev) {
        activeRun = { projectId, employeeId: dev.id, role: "dev", taskId };
        await dispatchDefectFix(project, dev, related[0]!);
      }
    }
    return;
  }
  await markTaskDoneAndContinue(projectId, taskId);
}

async function markTaskDoneAndContinue(projectId: string, taskId: string): Promise<void> {
  const project = (await loadProjects()).find((p) => p.id === projectId);
  if (!project?.workflow) return;
  const board = project.workflow.taskBoard.map((t) =>
    t.taskId === taskId ? { ...t, status: "done" as const } : t,
  );
  await patchProjectWorkflow(projectId, {
    state: "developing",
    taskBoard: board,
    activeFeatureId: null,
  });
  await dispatchNextDevTask(projectId);
}

async function onAllTasksDone(projectId: string): Promise<void> {
  await patchProjectWorkflow(projectId, { state: "acceptance" });
  const project = (await loadProjects()).find((p) => p.id === projectId);
  if (project) await notifyAcceptanceFeishu(project);
}

export async function confirmAcceptance(projectId: string): Promise<void> {
  const project = (await loadProjects()).find((p) => p.id === projectId);
  if (project?.type === "software" && (project.generatePath || "").trim()) {
    const { checkReleaseGate } = await import("./releaseGate");
    const gate = await checkReleaseGate(project);
    if (!gate.ok) {
      await appendFouMessage({
        sessionTag: "office-floor",
        role: "system",
        content: `⛔ 无法结项：${gate.message}`,
      });
      throw new Error(gate.message);
    }
  }
  const agile = project?.type === "software" && (project.kickoffMode || "phased") !== "strict";
  await patchProjectWorkflow(projectId, { state: agile ? "requirements" : "done" });
  await appendFouMessage({
    sessionTag: "office-floor",
    role: "system",
    content: agile
      ? "✅ UAT 已通过。增量可合 main 打版本；下一轮需求从 Brief 再开（敏捷）。"
      : "✅ UAT 已通过，项目结项（设计已冻结 · Review / QA / 发布说明已齐）。",
  });
  void import("../commerce").then(({ enqueueTrainingSample, warnTrainingSampleSkipped }) =>
    enqueueTrainingSample({
      kind: "acceptance_approve",
      industry: project?.type,
      projectId,
      summary: project?.name || projectId,
    }).then(warnTrainingSampleSkipped),
  ).catch((e) => console.warn("[xu] training sample", e));

  try {
    const prefs = await loadCodeExecPrefs();
    if (prefs.harvestCaseOnAcceptance && project) {
      const { appendCaseLibraryCandidate } = await import("../training/caseHarvest");
      await appendCaseLibraryCandidate(project);
    }
  } catch {
    /* 案例采样失败不阻断结项 */
  }

  if (agile && project?.queueCompleteOnUat) {
    const { tryAdvanceAfterAgileUat } = await import("./projectQueueRunner");
    void tryAdvanceAfterAgileUat(projectId);
  } else if (!agile) {
    const { tryAdvanceAfterProjectComplete } = await import("./projectQueueRunner");
    void tryAdvanceAfterProjectComplete(projectId);
  }
}

export async function applyBossDelegation(workspaceRoot?: string | null): Promise<void> {
  await writeGuiConsent(true, workspaceRoot);
  const drive = readDriveSettings();
  await writeDriveSettings({
    ...drive,
    consentAccepted: true,
    useInputControl: true,
    enabled: true,
  });
  try {
    await invoke("xu_set_boss_granted_session", { granted: true });
  } catch {
    /* optional until rust wired */
  }
}

function matchProjectBySpokenName(projects: XuProject[], text: string): XuProject | undefined {
  const t = (text || "").trim();
  if (!t) return undefined;
  const hits = projects
    .filter((p) => (p.name || "").trim().length >= 2 && t.includes(p.name.trim()))
    .sort((a, b) => b.name.trim().length - a.name.trim().length);
  return hits[0];
}

export async function handleBossMessage(
  text: string,
  projectId?: string | null,
  source?: string | null,
): Promise<boolean> {
  const projects = await loadProjects();
  const named = matchProjectBySpokenName(projects, text);
  const project =
    (projectId && projects.find((p) => p.id === projectId)) ||
    named ||
    projects.find(
      (p) =>
        p.type === "software" &&
        p.workflow &&
        (p.workflow.state === "plan_review" ||
          p.workflow.state === "design_review" ||
          p.workflow.state === "tech_review" ||
          p.workflow.state === "acceptance"),
    );
  const intent = parseBossIntent(text, project?.workflow?.state);
  const fromIm = source === "feishu" || source === "wecom";
  if (fromIm && intent.kind === "gui_delegate") {
    const compact = text.replace(/\s/g, "");
    if (!/确认操作电脑|允许键鼠|确认放权/.test(compact)) {
      await appendFouMessage({
        sessionTag: "office-floor",
        role: "system",
        content: "飞书/企微放权须明确口令：「确认操作电脑」。",
      });
      return true;
    }
  }
  if (intent.kind === "gui_delegate") {
    try {
      if (localStorage.getItem("xu.boss.verbalDelegate") !== "1") return false;
    } catch {
      return false;
    }
    const root =
      project?.generatePath ||
      readEmployees().find((e) => e.workspaceRoot)?.workspaceRoot ||
      null;
    await applyBossDelegation(root);
    await appendFouMessage({
      sessionTag: "office-floor",
      role: "system",
      content: "✅ 已记录 Boss 放权：可在工作区与白名单窗口内操作电脑（规则内）。",
    });
    return true;
  }
  if (intent.kind === "plan_approve" && project?.workflow?.state === "plan_review") {
    await confirmPlanAndDispatch(project.id);
    return true;
  }
  if (intent.kind === "design_unfreeze") {
    const target =
      project ||
      projects.find((p) => p.type === "software" && (p.generatePath || "").trim());
    if (!target?.generatePath) return false;
    const { unfreezeDesignForChange, XU_DESIGN_CONFIRM_NEEDED } = await import(
      "../intent/designArtifacts"
    );
    await unfreezeDesignForChange(target, text.trim().slice(0, 80) || "需求/设计变更");
    if (target.workflow) {
      await patchProjectWorkflow(target.id, { state: "design_review" });
    }
    window.dispatchEvent(
      new CustomEvent(XU_DESIGN_CONFIRM_NEEDED, { detail: { projectId: target.id } }),
    );
    await appendFouMessage({
      sessionTag: "office-floor",
      role: "system",
      content:
        "🔓 设计已解冻并升版。请重新确认设计后再派开发；未再确认前禁止新业务写码派活。口令：「确认设计」。",
    });
    return true;
  }
  if (intent.kind === "cross_module_approve") {
    const { confirmCrossModule, readCrossModuleGate } = await import("./crossModuleGate");
    let target =
      project ||
      projects.find((p) => p.type === "software" && (p.generatePath || "").trim());
    if (!target?.generatePath) {
      for (const p of projects) {
        const root = (p.generatePath || "").trim();
        if (!root) continue;
        const g = await readCrossModuleGate(root);
        if (g.updatedAt && g.status === "pending") {
          target = p;
          break;
        }
      }
    }
    if (!target?.generatePath) return false;
    const gate = await readCrossModuleGate(target.generatePath);
    if (!gate.updatedAt) return false;
    await confirmCrossModule(target.generatePath, "boss_ok", readEmployees());
    await appendFouMessage({
      sessionTag: "office-floor",
      role: "system",
      content: "✅ 跨模块已由 Boss 确认，可以开写。",
    });
    if (target.workflow?.state === "developing" || target.workflow?.state === "code_review") {
      const { surgeIdleEngineers } = await import("./idleSurge");
      await surgeIdleEngineers({ project: target, roster: readEmployees() });
    }
    return true;
  }
  if (intent.kind === "tech_approve" && project?.workflow?.state === "tech_review") {
    await confirmTechAndDispatch(project.id);
    await appendFouMessage({
      sessionTag: "office-floor",
      role: "system",
      content: "✅ 技术方案已确认，开始按 feature 分支写码。Review 通过后才能合入 dev。",
    });
    return true;
  }
  if (intent.kind === "design_approve" && project?.workflow?.state === "design_review") {
    window.dispatchEvent(
      new CustomEvent(XU_DESIGN_CONFIRM_NEEDED, {
        detail: { projectId: project.id },
      }),
    );
    await appendFouMessage({
      sessionTag: "office-floor",
      role: "system",
      content: "🎨 请在「确认设计」弹窗中选定路径与各页稿并保存；确认后自动冻结并开始写码。",
    });
    return true;
  }
  if (intent.kind === "acceptance_approve" && project?.workflow?.state === "acceptance") {
    await confirmAcceptance(project.id);
    return true;
  }
  return false;
}

async function onAgentDone(ev: AgentLiveEvent): Promise<void> {
  if (!activeRun || ev.kind !== "done") return;
  if (ev.employeeId !== activeRun.employeeId) return;
  const { projectId, role, taskId } = activeRun;
  activeRun = null;
  const content = ev.content || "";
  if (role === "planner") {
    await onPlannerDone(projectId, content);
    return;
  }
  if (role === "dev" && taskId) {
    if (content.includes("修缺陷") || content.includes("【修缺陷】")) {
      await onQaDone(projectId, taskId);
    } else {
      await onDevDone(projectId, taskId);
    }
    return;
  }
  if (role === "review" && taskId) {
    await onReviewDone(projectId, taskId);
    return;
  }
  if (role === "qa" && taskId) {
    await onQaDone(projectId, taskId);
  }
}

async function onAgentToolResult(ev: AgentLiveEvent): Promise<void> {
  if (ev.kind !== "tool_result" || ev.toolName !== "dispatch_defect_fix") return;
  if (!ev.content?.includes("\"dispatch\":true")) return;
  const projects = await loadProjects();
  const project =
    projects.find((p) => p.workflow && !["done", "requirements"].includes(p.workflow.state)) ||
    projects.find((p) => p.type === "software");
  if (!project) return;
  await executeDefectDispatchFromTool(project, ev.content);
}

export function ensureWorkflowBridge(): void {
  if (bridgeStarted) return;
  bridgeStarted = true;
  subscribeAgentLive((ev) => {
    void onAgentDone(ev);
    void onAgentToolResult(ev);
  });
}

export async function getActiveSoftwareProject(): Promise<XuProject | null> {
  const list = await loadProjects();
  return (
    list.find(
      (p) =>
        p.type === "software" &&
        p.workflow &&
        !["done", "requirements"].includes(p.workflow.state),
    ) ?? null
  );
}
