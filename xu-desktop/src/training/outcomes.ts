/**
 * @file 员工真实任务轨迹与训练结果持久化
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-31
 * @version 1.0.0
 * @category AgentLoop
 * @algo dispatch-event-correlation
 */
import { invoke } from "@tauri-apps/api/core";
import {
  subscribeAgentLive,
  type AgentLiveEvent,
} from "../employee/events";
import type { AcceptanceReviewResult } from "../intent/acceptanceReview";
import {
  ensureTrainingDirsAt,
  outcomesPath,
  readTrainingRootOrThrow,
  readTrainingText,
  touchTrainingManifest,
  writeTrainingText,
} from "./trainingStore";

export type TrainingToolTrace = {
  name: string;
  parameterTemplate: string;
  result: "called" | "ok" | "failed";
  at: number;
};

export type TrainingOutcome = {
  id: string;
  jobId: string;
  sessionId: string;
  projectId?: string;
  employeeId: string;
  roleId: string;
  taskInput: string;
  plan: string;
  tools: TrainingToolTrace[];
  reviewQa: string[];
  userRework: boolean;
  acceptance: {
    passed: boolean;
    hit: string[];
    miss: string[];
  } | null;
  status: "running" | "passed" | "failed" | "needs_rework";
  violations: string[];
  startedAt: number;
  completedAt?: number;
  durationMs: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  promptTokenBaseline: number;
  completionTokenBaseline: number;
  sensitive: boolean;
};

type OutcomeDoc = {
  version: 1;
  updatedAt: string;
  outcomes: TrainingOutcome[];
};

type SessionBilling = {
  promptTokens: number;
  completionTokens: number;
};

const activeBySession = new Map<string, string>();
const finalizeTimers = new Map<string, number>();
let stopCapture: (() => void) | null = null;
let mutation = Promise.resolve();

function clip(value: unknown, max = 2_000): string {
  return String(value ?? "").trim().slice(0, max);
}

const SECRET_PATTERNS = [
  /bearer\s+[a-z0-9._~+/=-]+/gi,
  /(?:api[_-]?key|secret|password|token)["']?\s*[:=]\s*["']?[^,\s"']+/gi,
  /\b(?:sk|ghp|glpat)-[a-z0-9_-]{12,}\b/gi,
  /-----BEGIN [A-Z ]+PRIVATE KEY-----[\s\S]*?-----END [A-Z ]+PRIVATE KEY-----/gi,
];

/** 清除轨迹参数中的令牌、密码和私钥；命中后只保留字段结构。 */
export function sanitizeTrainingTrace(value: unknown): { text: string; sensitive: boolean } {
  let text = clip(value);
  let sensitive = false;
  for (const pattern of SECRET_PATTERNS) {
    text = text.replace(pattern, () => {
      sensitive = true;
      return "[REDACTED]";
    });
  }
  return { text, sensitive };
}

function emptyDoc(): OutcomeDoc {
  return { version: 1, updatedAt: new Date().toISOString(), outcomes: [] };
}

export async function loadTrainingOutcomes(): Promise<OutcomeDoc> {
  const root = await readTrainingRootOrThrow();
  try {
    const parsed = JSON.parse(await readTrainingText(outcomesPath(root))) as Partial<OutcomeDoc>;
    return {
      version: 1,
      updatedAt: parsed.updatedAt || new Date().toISOString(),
      outcomes: Array.isArray(parsed.outcomes) ? parsed.outcomes.slice(-500) : [],
    };
  } catch {
    return emptyDoc();
  }
}

/** 合并导入的非敏感训练结果；本机同 id 记录优先，避免覆盖用户标注。 */
export async function mergeTrainingOutcomes(
  incoming: TrainingOutcome[],
): Promise<number> {
  let added = 0;
  await mutateDoc((doc) => {
    const known = new Set(doc.outcomes.map((item) => item.id));
    for (const outcome of incoming) {
      if (!outcome?.id || outcome.sensitive || known.has(outcome.id)) continue;
      doc.outcomes.push(outcome);
      known.add(outcome.id);
      added += 1;
    }
  });
  return added;
}

async function saveDoc(doc: OutcomeDoc): Promise<void> {
  const root = await readTrainingRootOrThrow();
  await ensureTrainingDirsAt(root);
  doc.updatedAt = new Date().toISOString();
  doc.outcomes = doc.outcomes.slice(-500);
  await writeTrainingText(root, outcomesPath(root), JSON.stringify(doc, null, 2));
  await touchTrainingManifest(root);
}

function mutateDoc(task: (doc: OutcomeDoc) => void | Promise<void>): Promise<void> {
  mutation = mutation.then(async () => {
    const doc = await loadTrainingOutcomes();
    await task(doc);
    await saveDoc(doc);
  });
  return mutation;
}

async function sessionBilling(sessionId: string): Promise<SessionBilling> {
  try {
    return await invoke<SessionBilling>("xu_session_billing_summary", { sessionId });
  } catch {
    return { promptTokens: 0, completionTokens: 0 };
  }
}

/** 派活受理后创建训练结果；依赖 job/session 关联，持久化失败不阻断派活。 */
export async function recordDispatchAccepted(input: {
  jobId: string;
  sessionId: string;
  employeeId: string;
  roleId: string;
  projectId?: string;
  task: string;
}): Promise<void> {
  const clean = sanitizeTrainingTrace(input.task);
  const billing = await sessionBilling(input.sessionId);
  const outcome: TrainingOutcome = {
    id: `out_${Date.now()}_${input.employeeId}`,
    jobId: input.jobId,
    sessionId: input.sessionId,
    projectId: input.projectId,
    employeeId: input.employeeId,
    roleId: input.roleId,
    taskInput: clean.text,
    plan: "",
    tools: [],
    reviewQa: [],
    userRework: /返工|rework|验收弱项/i.test(input.task),
    acceptance: null,
    status: "running",
    violations: [],
    startedAt: Date.now(),
    durationMs: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    promptTokenBaseline: billing.promptTokens,
    completionTokenBaseline: billing.completionTokens,
    sensitive: clean.sensitive,
  };
  activeBySession.set(input.sessionId, outcome.id);
  await mutateDoc((doc) => {
    doc.outcomes.push(outcome);
  });
}

function violationHints(content: string): string[] {
  const hints: string[] = [];
  if (/policy denied|策略拒绝|越权|禁止外传|secret detected/i.test(content)) {
    hints.push(clip(content, 240));
  }
  return hints;
}

async function applyAgentEvent(event: AgentLiveEvent): Promise<void> {
  const outcomeId = activeBySession.get(event.sessionId);
  if (!outcomeId) return;
  const safeContent = sanitizeTrainingTrace(event.content);
  const safeArgs = sanitizeTrainingTrace(event.toolArgs);
  await mutateDoc((doc) => {
    const outcome = doc.outcomes.find((item) => item.id === outcomeId);
    if (!outcome) return;
    outcome.sensitive ||= safeContent.sensitive || safeArgs.sensitive;
    if (event.kind === "plan_update" || /XU_TASKS[:：]/i.test(safeContent.text)) {
      outcome.plan = safeContent.text;
    }
    if (event.kind === "tool_call" && event.toolName) {
      outcome.tools.push({
        name: event.toolName,
        parameterTemplate: safeArgs.text,
        result: "called",
        at: event.at,
      });
    }
    if (event.kind === "tool_result" && event.toolName) {
      const last = [...outcome.tools].reverse().find((tool) => tool.name === event.toolName);
      if (last) last.result = /error|失败|denied/i.test(safeContent.text) ? "failed" : "ok";
    }
    if (/review|qa|质检|验收/i.test(safeContent.text)) {
      outcome.reviewQa.push(safeContent.text.slice(0, 500));
    }
    outcome.violations.push(...violationHints(safeContent.text));
    if (event.kind === "error") outcome.status = "failed";
  });
  if (event.kind === "done" || event.kind === "error") scheduleFinalize(event.sessionId);
}

function scheduleFinalize(sessionId: string): void {
  const old = finalizeTimers.get(sessionId);
  if (old) window.clearTimeout(old);
  finalizeTimers.set(
    sessionId,
    window.setTimeout(() => void finalizeIfDispatchDone(sessionId), 1_800),
  );
}

async function finalizeIfDispatchDone(sessionId: string): Promise<void> {
  const outcomeId = activeBySession.get(sessionId);
  if (!outcomeId) return;
  const doc = await loadTrainingOutcomes();
  const snapshot = doc.outcomes.find((item) => item.id === outcomeId);
  if (!snapshot) return;
  try {
    const raw = await invoke<string>("xu_emp_dispatch_status", {
      employeeId: snapshot.employeeId,
    });
    const state = (JSON.parse(raw) as { state?: string }).state || "";
    if (!["done", "error"].includes(state)) return;
    const billing = await sessionBilling(sessionId);
    await mutateDoc((next) => {
      const outcome = next.outcomes.find((item) => item.id === outcomeId);
      if (!outcome) return;
      outcome.completedAt = Date.now();
      outcome.durationMs = Math.max(0, outcome.completedAt - outcome.startedAt);
      const prompt = Math.max(0, billing.promptTokens - outcome.promptTokenBaseline);
      const completion = Math.max(
        0,
        billing.completionTokens - outcome.completionTokenBaseline,
      );
      outcome.promptTokens = prompt;
      outcome.completionTokens = completion;
      outcome.totalTokens = prompt + completion;
      if (state === "error") outcome.status = "failed";
      else if (outcome.userRework || outcome.acceptance?.passed === false) outcome.status = "needs_rework";
      else outcome.status = "passed";
    });
    activeBySession.delete(sessionId);
  } catch {
    /* dispatch may still be moving from analysis to implementation */
  }
}

/** 将真实验收命中/弱项回写最近一次员工任务，供评测统计返工和成功率。 */
export async function recordAcceptanceOutcome(result: AcceptanceReviewResult): Promise<void> {
  await mutateDoc((doc) => {
    const outcome = [...doc.outcomes]
      .reverse()
      .find(
        (item) =>
          item.employeeId === result.employeeId &&
          (!item.projectId || item.projectId === result.projectId),
      );
    if (!outcome) return;
    const miss = [...new Set([...result.miss, ...result.selfReportOpen])];
    outcome.acceptance = {
      passed: miss.length === 0,
      hit: result.hit,
      miss,
    };
    if (miss.length) outcome.status = "needs_rework";
  });
}

/** 启动一次全局轨迹订阅；重复调用安全，事件持续写入训练目录。 */
export function ensureTrainingOutcomeCapture(): void {
  if (stopCapture) return;
  stopCapture = subscribeAgentLive((event) => {
    void applyAgentEvent(event);
  });
}
