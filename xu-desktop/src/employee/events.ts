/**
 * Live employee status — one Tauri event channel (desktop 等价于单条 WebSocket).
 * Never poll N employees from the UI.
 *
 * Also listens to `xu:agent-event` (Codex-style structured turns) and mirrors
 * into live patches so Monitor / office show real ToolCall / Thinking — not fake chat.
 * Stream text for hall bubbles also goes through `officeLiveStream`.
 *
 * Rust is the source of truth (DB status + emit). Frontend only listens and paints.
 *
 * @file employee live event bridge
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-28
 * @updated 2026-09-02
 * @version 1.2.0
 * @category Stream
 * @algo employee-live-bridge
 */
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { EmployeeStatus } from "../utils/employees";
import { formatToolApprovalLabel } from "../utils/toolApprovalLabels";
import {
  bindStreamSession,
  clearOfficeLiveStream,
  setOfficeLiveStream,
} from "./officeLiveStream";

export interface EmployeeLiveEvent {
  employeeId: string;
  state: string;
  action: string;
  message: string;
  at: number;
}

/** Structured agent turn events from Rust (`xu:agent-event`). */
export interface AgentLiveEvent {
  sessionId: string;
  employeeId?: string | null;
  kind: string;
  content: string;
  toolName?: string | null;
  toolArgs?: string | null;
  callId?: string | null;
  at: number;
}

export type LivePatch = {
  state: string;
  action: string;
  message: string;
  at: number;
  /** Last agent event kind when driven by xu:agent-event */
  agentKind?: string;
  /** Last known project for Monitor filter / slot accounting */
  projectId?: string | null;
};

const liveById = new Map<string, LivePatch>();
const listeners = new Set<(ev: EmployeeLiveEvent) => void>();
const agentListeners = new Set<(ev: AgentLiveEvent) => void>();
/** Recent agent events for Monitor (newest last, capped). */
const recentAgentEvents: AgentLiveEvent[] = [];
const MAX_RECENT = 80;

let unlistenEmp: UnlistenFn | null = null;
let unlistenAgent: UnlistenFn | null = null;
let started = false;

export function setLiveProjectId(employeeId: string, projectId: string | null | undefined) {
  const prev = liveById.get(employeeId);
  const next: LivePatch = {
    state: prev?.state || "working",
    action: prev?.action || "",
    message: prev?.message || "",
    at: Date.now(),
    agentKind: prev?.agentKind,
    projectId: projectId ?? null,
  };
  liveById.set(employeeId, next);
}

export function mapEventState(state: string): EmployeeStatus | null {
  if (state === "working" || state === "running") return "working";
  if (state === "meeting" || state === "need_confirm" || state === "awaiting_confirm") {
    return "meeting";
  }
  if (state === "idle" || state === "done") return "idle";
  if (state === "blocked" || state === "error") return "away";
  return null;
}

export function getLivePatch(employeeId: string): LivePatch | undefined {
  return liveById.get(employeeId);
}

export function getAllLivePatches(): Map<string, LivePatch> {
  return new Map(liveById);
}

export function getRecentAgentEvents(): AgentLiveEvent[] {
  return recentAgentEvents.slice();
}

export function subscribeEmployeeLive(handler: (ev: EmployeeLiveEvent) => void): () => void {
  listeners.add(handler);
  void ensureEmployeeLiveBridge();
  return () => {
    listeners.delete(handler);
  };
}

export function subscribeAgentLive(handler: (ev: AgentLiveEvent) => void): () => void {
  agentListeners.add(handler);
  void ensureEmployeeLiveBridge();
  return () => {
    agentListeners.delete(handler);
  };
}

function pushRecent(ev: AgentLiveEvent) {
  recentAgentEvents.push(ev);
  while (recentAgentEvents.length > MAX_RECENT) recentAgentEvents.shift();
}

function notifyEmp(ev: EmployeeLiveEvent) {
  for (const h of listeners) {
    try {
      h(ev);
    } catch {
      /* ignore */
    }
  }
  window.dispatchEvent(new CustomEvent("xu-employee-live", { detail: ev }));
}

function notifyAgent(ev: AgentLiveEvent) {
  for (const h of agentListeners) {
    try {
      h(ev);
    } catch {
      /* ignore */
    }
  }
  window.dispatchEvent(new CustomEvent("xu-agent-live", { detail: ev }));
}

/** Map agent kind → short UI label for Monitor / office. */
export function agentKindLabel(kind: string): string {
  switch (kind) {
    case "start":
      return "开始";
    case "llm_thinking":
      return "思考";
    case "tool_call":
      return "工具";
    case "awaiting_approval":
      return "审批";
    case "tool_result":
      return "结果";
    case "context_compaction":
      return "压缩";
    case "plan_update":
      return "计划";
    case "done":
      return "完成";
    case "error":
      return "错误";
    default:
      return kind;
  }
}

/** Bubble-worthy agent events only (no fake PEER lines). */
export function isAgentBubbleWorthy(ev: AgentLiveEvent): boolean {
  if (ev.kind === "llm_thinking") return true;
  if (ev.kind === "tool_call" && ev.toolName) return true;
  if (ev.kind === "awaiting_approval") return true;
  if (ev.kind === "plan_update") return true;
  if (ev.kind === "done" && (ev.content || "").trim().length >= 6) return true;
  if (ev.kind === "error" && (ev.content || "").trim().length >= 4) return true;
  if (ev.kind === "context_compaction") return true;
  return false;
}

export function agentBubbleText(ev: AgentLiveEvent): string {
  if (ev.kind === "llm_thinking") {
    return "💭 思考中";
  }
  if (ev.kind === "tool_call") {
    return `🔧 ${formatToolApprovalLabel(ev.toolName || "tool", ev.toolArgs || undefined)}`;
  }
  if (ev.kind === "awaiting_approval") {
    return `⏳ 待批 ${formatToolApprovalLabel(ev.toolName || "tool", ev.toolArgs || undefined)}`;
  }
  if (ev.kind === "plan_update") {
    return "📋 更新计划";
  }
  if (ev.kind === "context_compaction") {
    return "📦 压缩上下文";
  }
  return (ev.content || "").trim().slice(0, 28);
}

export async function ensureEmployeeLiveBridge(): Promise<void> {
  if (started) return;
  started = true;

  unlistenEmp = await listen<EmployeeLiveEvent>("xu:employee-event", (e) => {
    const ev = e.payload;
    if (!ev?.employeeId) return;
    const prev = liveById.get(ev.employeeId);
    liveById.set(ev.employeeId, {
      state: ev.state,
      action: ev.action,
      message: ev.message,
      at: ev.at,
      agentKind: prev?.agentKind,
      projectId: prev?.projectId,
    });
    if (
      ev.state === "idle" ||
      ev.state === "done" ||
      ev.state === "blocked" ||
      ev.state === "error"
    ) {
      clearOfficeLiveStream(ev.employeeId);
    } else if (ev.message?.trim()) {
      setOfficeLiveStream(ev.employeeId, ev.message.trim().slice(0, 200));
    }
    notifyEmp(ev);
  });

  unlistenAgent = await listen<AgentLiveEvent>("xu:agent-event", (e) => {
    const raw = e.payload as AgentLiveEvent & {
      session_id?: string;
      employee_id?: string;
      tool_name?: string;
      tool_args?: string;
      call_id?: string;
    };
    if (!raw) return;
    const ev: AgentLiveEvent = {
      sessionId: raw.sessionId ?? raw.session_id ?? "",
      employeeId: raw.employeeId ?? raw.employee_id ?? null,
      kind: raw.kind,
      content: raw.content ?? "",
      toolName: raw.toolName ?? raw.tool_name ?? null,
      toolArgs: raw.toolArgs ?? raw.tool_args ?? null,
      callId: raw.callId ?? raw.call_id ?? null,
      at: raw.at ?? Date.now(),
    };
    pushRecent(ev);
    notifyAgent(ev);

    // Enrich live patch only — do NOT notifyEmp again (Rust already mirrors xu:employee-event)
    const eid = ev.employeeId;
    if (!eid) return;
    const state =
      ev.kind === "done" ? "idle" : ev.kind === "error" ? "blocked" : "working";
    const action =
      ev.kind === "tool_call"
        ? formatToolApprovalLabel(ev.toolName || "tool", ev.toolArgs || undefined)
        : ev.kind === "llm_thinking"
          ? "thinking"
          : ev.kind;
    const message =
      ev.kind === "tool_call"
        ? `调用 ${formatToolApprovalLabel(ev.toolName || "tool", ev.toolArgs || undefined)}`
        : (ev.content || action).slice(0, 200);
    liveById.set(eid, {
      state,
      action,
      message: state === "idle" ? "" : message,
      at: ev.at,
      agentKind: ev.kind,
      projectId: liveById.get(eid)?.projectId,
    });
    if (ev.sessionId) bindStreamSession(ev.sessionId, eid);
    if (state === "idle" || ev.kind === "error") {
      clearOfficeLiveStream(eid);
    } else if (message.trim()) {
      setOfficeLiveStream(eid, message.trim());
    }

    if (ev.kind === "done" || ev.kind === "error") {
      const projectId = liveById.get(eid)?.projectId;
      void import("../utils/taskExperience")
        .then(({ judgeAndDistillTask }) =>
          judgeAndDistillTask({
            employeeId: eid,
            projectId,
            kind: ev.kind === "done" ? "done" : "error",
            lastOutput: ev.content || "",
            taskHint: (ev.content || "").slice(0, 120),
          }),
        )
        .catch(() => {
          /* ignore */
        });
    }

    if (ev.kind === "done") {
      const projectId = liveById.get(eid)?.projectId;
      if (/XU_CROSS_MODULE[:：]/i.test(ev.content || "")) {
        void import("../utils/crossModuleGate")
          .then(({ onCrossModuleDetected }) =>
            onCrossModuleDetected({
              employeeId: eid,
              output: ev.content || "",
              projectId,
            }),
          )
          .catch(() => {
            /* ignore */
          });
      }
      if (projectId) {
        void import("../intent/acceptanceReview")
          .then(({ runAcceptanceReview }) =>
            runAcceptanceReview({
              projectId,
              employeeId: eid,
              lastAgentOutput: ev.content || "",
            }),
          )
          .catch(() => {
            /* ignore */
          });
      }
    }
  });
}

export function stopEmployeeLiveBridge(): void {
  unlistenEmp?.();
  unlistenAgent?.();
  unlistenEmp = null;
  unlistenAgent = null;
  started = false;
}
