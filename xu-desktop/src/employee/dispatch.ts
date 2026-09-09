/**
 * @file 虚募阁 Native Agent 员工派活与训练结果旁路
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-31
 * @version 1.1.0
 * @category AgentLoop
 * @algo bounded-dispatch
 */
import { invoke } from "@tauri-apps/api/core";
import type { Employee } from "../utils/employees";
import { composeEmployeeTaskMessage } from "./policy";
import { readUserAddress } from "../utils/userAddressPrefs";
import { resolveEmployeeEndpoint } from "./brains";
import type { DispatchTaskInput, DispatchTaskResult, PendingDispatchJob } from "./dispatchTypes";
import { toUserError } from "../utils/userFacingError";

/** 冷启动自动断点续跑上限 */
export const MAX_COLD_RESUME = 6;

/**
 * @deprecated 请用 `readKickoffMaxEmployees()`（设置 → 并发 → 单次开工人数上限）。
 * 保留导出以免 HMR 热更新期间旧模块仍 import 本常量导致白屏。
 */
export const MAX_KICKOFF_BATCH = 0;

export { readKickoffMaxEmployees, readKickoffParallel } from "../utils/concurrencySlots";

export {
  type PendingDispatchJob,
} from "./dispatchTypes";

const QUEUE_KEY = "xu.employee.dispatchQueue";
const LEGACY_QUEUE_KEY = "xu.pendingEmployeeTaskQueue";
const LEGACY_ONE_KEY = "xu.pendingEmployeeTask";

function readQueue(): PendingDispatchJob[] {
  try {
    const raw = sessionStorage.getItem(QUEUE_KEY);
    if (raw) {
      const q = JSON.parse(raw) as PendingDispatchJob[];
      if (Array.isArray(q)) return q;
    }
  } catch {
    /* ignore */
  }
  // migrate legacy Hermes-bridge queue
  try {
    const raw = sessionStorage.getItem(LEGACY_QUEUE_KEY);
    if (raw) {
      const legacy = JSON.parse(raw) as Array<{
        employeeId: string;
        employeeName: string;
        workspaceRoot: string;
        message: string;
        brainSlot: string;
        aiModel?: string;
        aiBaseUrl?: string;
        forceNewSession?: boolean;
        createdAt: number;
      }>;
      if (Array.isArray(legacy)) {
        const mapped: PendingDispatchJob[] = legacy.map((t) => ({
          jobId: `job_${t.createdAt}_${t.employeeId}`,
          employeeId: t.employeeId,
          employeeName: t.employeeName,
          workspaceRoot: t.workspaceRoot,
          message: t.message,
          brainSlot: t.brainSlot as PendingDispatchJob["brainSlot"],
          endpoint: {
            provider: "custom",
            model: t.aiModel ?? "",
            baseUrl: t.aiBaseUrl ?? "",
            apiKeyEnv: "",
            brainSlot: t.brainSlot as PendingDispatchJob["brainSlot"],
          },
          forceNewSession: t.forceNewSession === true,
          createdAt: t.createdAt,
        }));
        writeQueue(mapped);
        sessionStorage.removeItem(LEGACY_QUEUE_KEY);
        sessionStorage.removeItem(LEGACY_ONE_KEY);
        return mapped;
      }
    }
  } catch {
    /* ignore */
  }
  return [];
}

function writeQueue(q: PendingDispatchJob[]) {
  try {
    sessionStorage.setItem(QUEUE_KEY, JSON.stringify(q));
  } catch {
    /* ignore */
  }
  window.dispatchEvent(
    new CustomEvent("xu-employee-queue-changed", {
      detail: { count: q.length, queue: q },
    }),
  );
}

/** @deprecated Prefer `dispatchEmployeeTask`. Runs live dispatch instead of orphan queue. */
export async function enqueueEmployeeTask(
  emp: Employee,
  task: string,
  opts?: { forceNewSession?: boolean; projectId?: string; directImplement?: boolean },
): Promise<DispatchTaskResult> {
  return dispatchEmployeeTask(emp, {
    task,
    forceNewSession: opts?.forceNewSession,
    projectId: opts?.projectId,
    directImplement: opts?.directImplement,
    workspaceRoot: emp.workspaceRoot,
  });
}

/** Legacy queue read — jobs are no longer consumed here; use `dispatchEmployeeTask`. */
export function consumeDispatchJob(): PendingDispatchJob | null {
  const q = readQueue();
  if (!q.length) return null;
  const first = q.shift()!;
  writeQueue(q);
  return first;
}

export function peekDispatchJob(): PendingDispatchJob | null {
  return readQueue()[0] ?? null;
}

export function listDispatchJobs(): PendingDispatchJob[] {
  return readQueue();
}

export function dispatchJobCount(): number {
  return readQueue().length;
}

export function clearDispatchQueue(): void {
  try {
    sessionStorage.removeItem(QUEUE_KEY);
    sessionStorage.removeItem(LEGACY_QUEUE_KEY);
    sessionStorage.removeItem(LEGACY_ONE_KEY);
  } catch {
    /* ignore */
  }
}

export async function stopAllEmployeeDispatches(): Promise<{
  cancelledSessions: number;
  approvalsDenied: number;
  employeesReset: number;
  checkpointsCleared: number;
}> {
  return invoke("xu_stop_all_employee_dispatches");
}

export async function stopEmployeeDispatch(employeeId: string): Promise<boolean> {
  return invoke("xu_stop_employee_dispatch", { employeeId });
}

/**
 * Preferred entry: ask Rust to run 虚募阁 Native Agent.
 * Falls back to local enqueue if command not ready yet.
 */
export async function dispatchEmployeeTask(
  emp: Employee,
  input: Omit<DispatchTaskInput, "employeeId">,
): Promise<DispatchTaskResult> {
  const workspaceRoot = (input.workspaceRoot ?? emp.workspaceRoot)?.trim() || "";
  if (!workspaceRoot) {
    throw new Error("请先为该员工设置可写工作区，或在项目里配置「生成路径」");
  }
  const { isDevRole } = await import("../utils/devWorkspace");
  const endpoint = await resolveEmployeeEndpoint(emp, {
    preferRemote: emp.brainSlot === "code" || isDevRole(emp),
  });
  const { checkDispatchSlots } = await import("../utils/concurrencySlots");
  const gate = checkDispatchSlots(input.projectId, { baseUrl: endpoint.baseUrl });
  // Slot full → Rust permit waits. Do not throw (kickoff would mark 派活失败).

  let extraHints = "";
  let ideCli: string | null = null;
  let codeEditorSurface: "builtin" | "external" = "builtin";
  let toolPolicy = null;
  if (input.projectId) {
    const { loadProjects } = await import("../utils/projects");
    const { buildProjectDispatchHints } = await import("../utils/projectDispatchHints");
    const { cliForIde } = await import("../utils/ideCli");
    const {
      resolveCodeEditorSurface,
      buildCodingSurfaceDispatchHint,
    } = await import("../utils/codingSurfacePrefs");
    const projects = await loadProjects();
    const project = projects.find((p) => p.id === input.projectId);
    if (project) {
      extraHints = buildProjectDispatchHints(project, emp);
      const { buildEmployeeWorkPack } = await import("../intent/workPack");
      const pack = await buildEmployeeWorkPack(project, emp);
      if (pack) extraHints = `${pack}\n\n${extraHints}`.trim();
      codeEditorSurface = resolveCodeEditorSurface(emp, project);
      extraHints = `${extraHints}\n${buildCodingSurfaceDispatchHint(codeEditorSurface)}`.trim();
      ideCli = cliForIde(project.toolchain?.ide) || null;
      toolPolicy = project.toolPolicy ?? null;
    }
  }
  if (!extraHints) {
    const {
      resolveCodeEditorSurface,
      buildCodingSurfaceDispatchHint,
    } = await import("../utils/codingSurfacePrefs");
    const { getAgencyRole, buildRoleAgencyPack } = await import("../office/agencyRoles");
    codeEditorSurface = resolveCodeEditorSurface(emp);
    extraHints = buildCodingSurfaceDispatchHint(codeEditorSurface);
    const rolePack = buildRoleAgencyPack(getAgencyRole(emp.agentRoleId));
    if (rolePack) extraHints = `${rolePack}\n\n${extraHints}`.trim();
  }
  if (!ideCli && codeEditorSurface === "external") {
    const { readIdeCliOverride, cliForIde } = await import("../utils/ideCli");
    const { readCodingSurfacePrefs } = await import("../utils/codingSurfacePrefs");
    const override = readIdeCliOverride();
    ideCli = override || cliForIde(readCodingSurfacePrefs().externalIde);
  }

  try {
    const { buildAntiDistillPrompt } = await import("../utils/antiDistill");
    const ad = buildAntiDistillPrompt();
    if (ad) extraHints = `${ad}\n\n${extraHints}`.trim();
  } catch {
    /* ignore */
  }

  try {
    const { buildMcpTrainingHints } = await import("../training/mcpTraining");
    const mcp = await buildMcpTrainingHints({
      roleId: emp.agentRoleId,
      taskHint: input.task,
    });
    if (mcp) extraHints = `${mcp}\n\n${extraHints}`.trim();
  } catch {
    /* ignore */
  }

  try {
    const { getAgencyRole } = await import("../office/agencyRoles");
    const { parseMcpToolsAllowlist } = await import("../utils/mcpToolsAllowlist");
    const { normalizeProjectToolPolicy } = await import("../utils/projectToolPolicy");
    const role = getAgencyRole(emp.agentRoleId);
    const allow = parseMcpToolsAllowlist(role?.mcpTools);
    const base = normalizeProjectToolPolicy(toolPolicy);
    toolPolicy = { ...base, mcpToolsAllowlist: allow };
  } catch {
    /* ignore */
  }

  try {
    const { parseFouCalcDirective, runCalcSandbox, formatCalcForAgent } = await import(
      "../utils/calcSandbox"
    );
    const calcOp = parseFouCalcDirective(input.task);
    if (calcOp) {
      extraHints = `${formatCalcForAgent(runCalcSandbox(calcOp))}\n\n${extraHints}`.trim();
    }
  } catch {
    /* ignore */
  }

  try {
    const { buildDispatchCapabilityHints } = await import("../capabilities/hints");
    const caps = await buildDispatchCapabilityHints(emp.agentRoleId, emp.id);
    if (caps) extraHints = `${caps}\n\n${extraHints}`.trim();
  } catch {
    /* ignore */
  }
  // Curriculum is injected once via buildPolicyPreamble — do not duplicate here.

  let resolvedWorkspace = workspaceRoot;
  if (input.projectId) {
    const { loadProjects } = await import("../utils/projects");
    const { isDevRole, prepareDevDispatchWorkspace } = await import("../utils/devWorkspace");
    const projects = await loadProjects();
    const project = projects.find((p) => p.id === input.projectId);
    if (project && isDevRole(emp)) {
      resolvedWorkspace = await prepareDevDispatchWorkspace(project, emp);
    }
  }

  try {
    const { agentsMdDispatchHint, agentsMdPath, readAgentsMdExcerpt, WRITEBACK_LOOP_HINT } =
      await import("../utils/projectAgentsMd");
    const agentsPath = agentsMdPath(resolvedWorkspace);
    const excerpt = await readAgentsMdExcerpt(resolvedWorkspace);
    extraHints = `${agentsMdDispatchHint(excerpt, agentsPath)}\n\n${WRITEBACK_LOOP_HINT}\n\n${extraHints}`.trim();
  } catch {
    /* ignore */
  }

  try {
    const outcomeCapture = await import("../training/outcomes");
    outcomeCapture.ensureTrainingOutcomeCapture();
    const result = await invoke<DispatchTaskResult>("xu_emp_dispatch_task", {
      employeeId: emp.id,
      task: input.task,
      forceNewSession: input.forceNewSession ?? false,
      projectId: input.projectId ?? null,
      directImplement: input.directImplement ?? false,
      qaMode: input.qaMode ?? false,
      endpoint,
      workspaceRoot: resolvedWorkspace,
      ideCli,
      codeEditorSurface,
      composedMessage: await composeEmployeeTaskMessage(emp, input.task, extraHints),
      projectToolPolicy: toolPolicy,
      userAddressName: readUserAddress(),
    });
    void outcomeCapture
      .recordDispatchAccepted({
        jobId: result.jobId,
        sessionId: result.sessionId,
        employeeId: emp.id,
        roleId: emp.agentRoleId,
        projectId: input.projectId ?? undefined,
        task: input.task,
      })
      .catch(() => {
        /* 训练轨迹为旁路，写盘失败不能把已受理任务伪装成派活失败 */
      });
    if (input.projectId) {
      const { setLiveProjectId } = await import("./events");
      setLiveProjectId(emp.id, input.projectId);
    }
    window.dispatchEvent(
      new CustomEvent("xu-employee-dispatched", { detail: result }),
    );
    if (!gate.ok) {
      return {
        ...result,
        waitingForSlot: true,
        message: gate.message,
      };
    }
    return result;
  } catch (e) {
    // Do NOT silently pretend success — surface the real error
    throw new Error(`派活失败：${toUserError(e)}`);
  }
}

export async function resumeInterruptedDispatches(maxResume?: number): Promise<{
  scanned: number;
  resumed: number;
  meeting: number;
  skipped: number;
  errors: string[];
}> {
  return invoke("xu_resume_interrupted_dispatches", {
    maxResume: maxResume ?? undefined,
  });
}

export async function resumeEmployeeAfterConfirm(
  emp: Employee,
  bossReply: string,
): Promise<DispatchTaskResult> {
  const workspaceRoot = (emp.workspaceRoot || "").trim();
  if (!workspaceRoot) {
    throw new Error("请先为该员工设置可写工作区");
  }
  const endpoint = await resolveEmployeeEndpoint(emp);
  return invoke<DispatchTaskResult>("xu_emp_resume_after_confirm", {
    employeeId: emp.id,
    bossReply,
    endpoint,
    workspaceRoot,
  });
}

/** Compatibility aliases — delegate to live dispatch. */
export async function queueEmployeeTask(
  emp: Employee,
  task: string,
  opts?: { forceNewSession?: boolean; projectId?: string; directImplement?: boolean },
): Promise<DispatchTaskResult> {
  return enqueueEmployeeTask(emp, task, opts);
}

export async function queueEmployeeTaskFirst(
  emp: Employee,
  task: string,
  opts?: { forceNewSession?: boolean; projectId?: string; directImplement?: boolean },
): Promise<DispatchTaskResult> {
  return enqueueEmployeeTask(emp, task, opts);
}
