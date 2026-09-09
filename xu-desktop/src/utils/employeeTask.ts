import type { BrainSlot, Employee } from "./employees";
import { composeEmployeeTaskMessage } from "./employees";

export const PENDING_EMPLOYEE_TASK_KEY = "xu.pendingEmployeeTask";
const QUEUE_KEY = "xu.pendingEmployeeTaskQueue";

export interface PendingEmployeeTask {
  employeeId: string;
  employeeName: string;
  workspaceRoot: string;
  message: string;
  brainSlot: BrainSlot;
  aiModel: string;
  aiBaseUrl: string;
  /** When true, ignore saved Hermes session and start fresh. */
  forceNewSession?: boolean;
  createdAt: number;
}

function readQueue(): PendingEmployeeTask[] {
  try {
    const raw = sessionStorage.getItem(QUEUE_KEY);
    if (raw) {
      const q = JSON.parse(raw) as PendingEmployeeTask[];
      if (Array.isArray(q)) {
        return q.map((t) => ({
          ...t,
          aiModel: t.aiModel ?? "",
          aiBaseUrl: t.aiBaseUrl ?? "",
        }));
      }
    }
  } catch {
    /* ignore */
  }
  // migrate single-slot
  try {
    const one = sessionStorage.getItem(PENDING_EMPLOYEE_TASK_KEY);
    if (one) {
      sessionStorage.removeItem(PENDING_EMPLOYEE_TASK_KEY);
      const t = JSON.parse(one) as PendingEmployeeTask;
      return [
        {
          ...t,
          aiModel: t.aiModel ?? "",
          aiBaseUrl: t.aiBaseUrl ?? "",
        },
      ];
    }
  } catch {
    /* ignore */
  }
  return [];
}

function writeQueue(q: PendingEmployeeTask[]) {
  try {
    sessionStorage.setItem(QUEUE_KEY, JSON.stringify(q));
    if (q[0]) sessionStorage.setItem(PENDING_EMPLOYEE_TASK_KEY, JSON.stringify(q[0]));
    else sessionStorage.removeItem(PENDING_EMPLOYEE_TASK_KEY);
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new CustomEvent("xu-employee-queue-changed", { detail: { count: q.length, queue: q } }));
}

async function toPayload(
  emp: Employee,
  task: string,
  forceNewSession?: boolean,
): Promise<PendingEmployeeTask> {
  return {
    employeeId: emp.id,
    employeeName: emp.name,
    workspaceRoot: emp.workspaceRoot!.trim(),
    message: await composeEmployeeTaskMessage(emp, task),
    brainSlot: emp.brainSlot,
    aiModel: (emp.aiModel ?? "").trim(),
    aiBaseUrl: (emp.aiBaseUrl ?? "").trim(),
    forceNewSession: forceNewSession === true,
    createdAt: Date.now(),
  };
}

/** Queue a policy-wrapped task (supports multiple; FIFO). */
export async function queueEmployeeTask(
  emp: Employee,
  task: string,
  opts?: { forceNewSession?: boolean },
): Promise<PendingEmployeeTask> {
  if (!emp.workspaceRoot?.trim()) {
    throw new Error("请先为该员工设置可写工作区路径");
  }
  const payload = await toPayload(emp, task, opts?.forceNewSession);
  const q = readQueue();
  q.push(payload);
  writeQueue(q);
  window.dispatchEvent(new CustomEvent("xu-pending-employee-task", { detail: payload }));
  return payload;
}

/**
 * 单独派活：当前指令插到队首，该员工优先执行这条（先于队列里其它任务）。
 */
export async function queueEmployeeTaskFirst(
  emp: Employee,
  task: string,
  opts?: { forceNewSession?: boolean },
): Promise<PendingEmployeeTask> {
  if (!emp.workspaceRoot?.trim()) {
    throw new Error("请先为该员工设置可写工作区路径");
  }
  const payload = await toPayload(emp, task, opts?.forceNewSession);
  const q = readQueue().filter((t) => t.employeeId !== emp.id);
  q.unshift(payload);
  writeQueue(q);
  window.dispatchEvent(new CustomEvent("xu-pending-employee-task", { detail: payload }));
  return payload;
}

export function consumePendingEmployeeTask(): PendingEmployeeTask | null {
  const q = readQueue();
  if (!q.length) return null;
  const first = q.shift()!;
  writeQueue(q);
  return first;
}

export function peekPendingEmployeeTask(): PendingEmployeeTask | null {
  return readQueue()[0] ?? null;
}

export function listPendingEmployeeTasks(): PendingEmployeeTask[] {
  return readQueue();
}

export function pendingEmployeeTaskCount(): number {
  return readQueue().length;
}
