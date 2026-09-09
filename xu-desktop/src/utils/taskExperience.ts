/**
 * @file 任务终态 Judge → Distill 模式记忆 → 派活 Retrieve 提示
 * @author qiuye <yjk150@qq.com>
 * @date 2026-09-01
 * @version 1.0.0
 * @category AgentLoop
 * @algo retrieve-judge-distill
 */
import { upsertMemory } from "../employee/memory";

export type TaskOutcome = "success" | "fail";

export type JudgeInput = {
  employeeId: string;
  projectId?: string | null;
  taskHint?: string;
  lastOutput?: string;
  kind: "done" | "error";
};

const OUTCOME_LS_PREFIX = "xu.task.outcome.";

/** Map agent live kind to success/fail. */
export function judgeTaskOutcome(kind: "done" | "error" | string): TaskOutcome {
  return kind === "done" ? "success" : "fail";
}

/** Persist outcome label for run correlation (local). */
export function writeTaskOutcome(
  employeeId: string,
  outcome: TaskOutcome,
  meta?: { projectId?: string | null; at?: number },
): void {
  const id = (employeeId || "").trim();
  if (!id) return;
  try {
    localStorage.setItem(
      OUTCOME_LS_PREFIX + id,
      JSON.stringify({
        outcome,
        projectId: meta?.projectId ?? null,
        at: meta?.at ?? Date.now(),
      }),
    );
  } catch {
    /* ignore */
  }
}

export function readLastTaskOutcome(employeeId: string): TaskOutcome | null {
  try {
    const raw = localStorage.getItem(OUTCOME_LS_PREFIX + employeeId);
    if (!raw) return null;
    const o = JSON.parse(raw) as { outcome?: string };
    return o.outcome === "success" || o.outcome === "fail" ? o.outcome : null;
  } catch {
    return null;
  }
}

/** Build a short reusable pattern body from task + output (not full transcript). */
export function distillPatternBody(opts: {
  taskHint?: string;
  lastOutput?: string;
  outcome: TaskOutcome;
}): string {
  const hint = (opts.taskHint || "").trim().slice(0, 200);
  const out = (opts.lastOutput || "").trim().replace(/\s+/g, " ").slice(0, 280);
  const lines = [
    `结局：${opts.outcome === "success" ? "成功" : "失败"}`,
    hint ? `任务要点：${hint}` : null,
    out ? `可复用结论：${out}` : null,
    "下次同类 Brief/派活优先对照本模式，勿重复踩坑。",
  ].filter(Boolean);
  return lines.join("\n");
}

/**
 * Duty: on terminal agent event, judge + optionally distill pattern memory.
 * Deps: xu_upsert_memory; only success writes pattern (fail only labels).
 * Failure: swallow upsert errors (never block UI).
 */
export async function judgeAndDistillTask(input: JudgeInput): Promise<{
  outcome: TaskOutcome;
  distilled: boolean;
}> {
  const outcome = judgeTaskOutcome(input.kind);
  writeTaskOutcome(input.employeeId, outcome, { projectId: input.projectId });
  if (outcome !== "success") {
    return { outcome, distilled: false };
  }
  const body = distillPatternBody({
    taskHint: input.taskHint,
    lastOutput: input.lastOutput,
    outcome,
  });
  if (body.length < 24) return { outcome, distilled: false };
  const titleHint = (input.taskHint || input.lastOutput || "任务").trim().slice(0, 28);
  try {
    await upsertMemory({
      scope: input.projectId ? "project" : "employee",
      scopeId: input.projectId || input.employeeId,
      title: `模式：${titleHint}${titleHint.length >= 28 ? "…" : ""}`,
      body,
      tags: JSON.stringify(["pattern", "task_distill", "structured"]),
      source: "task_distill",
      pinned: false,
    });
    return { outcome, distilled: true };
  } catch {
    return { outcome, distilled: false };
  }
}

/** Boost pattern recall in buildMemoryPreamble taskHint. */
export function patternRetrieveHint(taskHint?: string): string {
  const base = (taskHint || "").trim();
  const boost = "模式 pattern task_distill";
  return base ? `${boost} ${base}` : boost;
}
