/**
 * Agent live event → 3D speech bubble phase + duration.
 * Replaces ad-hoc fixed timers in OfficeScene3D.
 */
import type { AgentLiveEvent } from "../employee/events";

export type AgentBubblePhase =
  | "thinking"
  | "tool"
  | "awaiting_approval"
  | "delivery"
  | "error"
  | "other";

const PHASE_PRIORITY: Record<AgentBubblePhase, number> = {
  error: 50,
  awaiting_approval: 40,
  tool: 30,
  thinking: 20,
  delivery: 15,
  other: 10,
};

const PHASE_SECONDS: Record<AgentBubblePhase, number> = {
  thinking: 4,
  tool: 6,
  awaiting_approval: 12,
  delivery: 7,
  error: 8,
  other: 5,
};

export function agentBubblePhase(ev: AgentLiveEvent): AgentBubblePhase {
  switch (ev.kind) {
    case "llm_thinking":
      return "thinking";
    case "tool_call":
    case "tool_result":
      return "tool";
    case "awaiting_approval":
      return "awaiting_approval";
    case "done":
      return "delivery";
    case "error":
      return "error";
    case "plan_update":
    case "context_compaction":
      return "other";
    default:
      return "other";
  }
}

export function bubbleSecondsForPhase(phase: AgentBubblePhase): number {
  return PHASE_SECONDS[phase] ?? 5;
}

export function bubblePriority(phase: AgentBubblePhase): number {
  return PHASE_PRIORITY[phase] ?? 0;
}

/** Whether incoming phase should replace an active bubble. */
export function shouldReplaceBubble(
  current: AgentBubblePhase | null,
  incoming: AgentBubblePhase,
  remainingSec: number,
): boolean {
  if (!current || remainingSec <= 0.5) return true;
  return bubblePriority(incoming) >= bubblePriority(current);
}
