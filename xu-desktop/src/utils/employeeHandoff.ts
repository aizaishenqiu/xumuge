/**
 * @file 员工任务交接：读 checkpoint → 停源岗 → 派目标岗
 * @author qiuye <yjk150@qq.com>
 * @date 2026-09-02
 * @version 1.0.0
 * @category AgentLoop
 * @algo checkpoint-handoff-dispatch
 */

import { invoke } from "@tauri-apps/api/core";
import { dispatchEmployeeTask, stopEmployeeDispatch } from "../employee/dispatch";
import { appendFouMessage, updateEmployee, type Employee } from "./employees";
import { OFFICE_FLOOR } from "./officeComms";

type DispatchCheckpoint = {
  state?: string;
  analysis?: string;
  questions?: string[];
  jobId?: string;
  at?: number;
};

const HANDOFF_RE = /^(?:转派|交接给|handoff)\s*@?\s*(.+)$/i;

/** Match employee by name substring (case-insensitive). */
export function findEmployeeByHint(hint: string, employees: Employee[]): Employee | null {
  const q = (hint || "").trim().replace(/^@/, "");
  if (!q) return null;
  const lower = q.toLowerCase();
  const exact = employees.find((e) => e.name === q || e.id === q);
  if (exact) return exact;
  const partial = employees.filter(
    (e) => e.name.toLowerCase().includes(lower) || lower.includes(e.name.toLowerCase()),
  );
  if (partial.length === 1) return partial[0]!;
  return null;
}

export function parseHandoffCommand(text: string): { targetHint: string } | null {
  const m = HANDOFF_RE.exec((text || "").trim());
  if (!m?.[1]) return null;
  return { targetHint: m[1].trim() };
}

/** Resolve handoff target from free text like「转派 张三 继续接口」. */
export function resolveHandoffTarget(
  hint: string,
  employees: Employee[],
): { target: Employee; note: string } | null {
  const rest = (hint || "").trim();
  if (!rest) return null;
  const sorted = [...employees].sort((a, b) => b.name.length - a.name.length);
  for (const e of sorted) {
    if (rest === e.name || rest.startsWith(`${e.name} `) || rest.startsWith(`@${e.name}`)) {
      const note = rest.replace(new RegExp(`^@?${e.name}\\s*`), "").trim();
      return { target: e, note };
    }
  }
  const first = rest.split(/\s+/)[0] || rest;
  const target = findEmployeeByHint(first, employees);
  if (!target) return null;
  const note = rest.replace(new RegExp(`^@?${target.name}\\s*`), "").trim();
  return { target, note };
}

function buildHandoffTask(from: Employee, cp: DispatchCheckpoint, note?: string): string {
  const parts: string[] = [
    `【交接自 ${from.name}】`,
    note?.trim() ? `说明：${note.trim()}` : "",
    cp.analysis?.trim() ? `原分析摘要：${cp.analysis.trim().slice(0, 1200)}` : "",
    Array.isArray(cp.questions) && cp.questions.length
      ? `待对齐：${cp.questions.slice(0, 5).join("；")}`
      : "",
    "请接续完成上述工作包；若仍阻塞请输出 XU_NEED_CONFIRM 开会，不要静默跳过。",
  ];
  return parts.filter(Boolean).join("\n");
}

/** Transfer active checkpoint from one employee to another. */
export async function handoffEmployeeTask(opts: {
  from: Employee;
  to: Employee;
  note?: string;
  projectId?: string | null;
  workspaceRoot?: string;
}): Promise<void> {
  const { from, to, note, projectId, workspaceRoot } = opts;
  if (from.id === to.id) {
    throw new Error("不能转派给自己");
  }
  let raw = "{}";
  try {
    raw = await invoke<string>("xu_emp_dispatch_status", { employeeId: from.id });
  } catch {
    /* ignore */
  }
  let cp: DispatchCheckpoint = {};
  try {
    cp = JSON.parse(raw) as DispatchCheckpoint;
  } catch {
    cp = {};
  }

  const task = buildHandoffTask(from, cp, note);
  const root = (workspaceRoot || to.workspaceRoot || from.workspaceRoot || "").trim();
  if (!root) {
    throw new Error("请先为接手员工设置工作区路径");
  }

  try {
    await stopEmployeeDispatch(from.id);
  } catch {
    /* best effort */
  }
  await updateEmployee(from.id, { status: "idle" });

  await dispatchEmployeeTask(to, {
    task,
    projectId: projectId ?? undefined,
    directImplement: cp.state === "implementing" || cp.state === "analyzing",
    workspaceRoot: root,
    forceNewSession: true,
  });

  await appendFouMessage({
    sessionTag: OFFICE_FLOOR,
    role: "system",
    content: `🔀 已将 ${from.name} 的任务交接给 ${to.name}。源岗已停工，接手岗开始执行。`,
  });
}
