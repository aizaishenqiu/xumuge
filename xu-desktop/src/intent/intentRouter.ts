import { isWorkKickoff, isWorkReset, isWorkStop } from "../utils/bossStopIntent";
import { isProtectedProductAsk } from "../utils/antiDistill";
import type { RequirementBrief } from "./briefTypes";
import {
  classifyLocalUserTurn,
  isQuestionTurn,
  isOperationTurn,
  isStrongBuildTurn,
  isStrongBuildObjectTurn,
} from "./turnKind";
import { classifyWorkMode, needsBriefCollection } from "./workModeClassifier";

export type IntentKind =
  | "ops_stop"
  | "ops_reset"
  | "confirm_brief"
  | "force_all_kickoff"
  | "kickoff_ready"
  | "acceptance_rework"
  | "clarify"
  | "chitchat";

export interface IntentResult {
  kind: IntentKind;
  /** True when kickoff keywords present but brief not ready */
  blockedKickoff: boolean;
}

const CONFIRM_RE =
  /确认需求|需求确认|就这样|可以开工|开始执行|brief\s*ready|确认并开工|开始设计|保存并开始设计/i;
const FORCE_ALL_RE = /强制全员|全员强制开工|不管匹配全部开工/i;
const REWORK_RE = /验收返工|按验收返工|返工\s*验收/i;

/**
 * 明确「要立项/做产品」才进 Brief 澄清。
 * 与 isStrongBuildTurn 对齐；操作类（帮我改）不算立项。
 */
export function isProductBuildIntent(text: string): boolean {
  const t = text.trim();
  if (!t || t.length > 800) return false;
  if (/^【需求补充/.test(t)) return true;
  if (isProtectedProductAsk(t)) return false;
  if (isQuestionTurn(t)) return false;
  if (isOperationTurn(t) && !isStrongBuildObjectTurn(t)) return false;
  return isStrongBuildTurn(t) || isStrongBuildObjectTurn(t);
}

/** 普通问答 / 使用帮助：不应打开需求弹窗 */
export function isCasualQaIntent(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (/^【需求补充/.test(t)) return false;
  if (isProductBuildIntent(t)) return false;
  if (isProtectedProductAsk(t)) return true;
  if (CONFIRM_RE.test(t) || FORCE_ALL_RE.test(t) || REWORK_RE.test(t)) return false;
  if (isWorkKickoff(t) || isWorkStop(t) || isWorkReset(t)) return false;
  return classifyLocalUserTurn(t) === "question";
}

/** 像在回答缺口（弹窗回填、编号列举；收窄关键词避免误判） */
function looksLikeGapAnswer(text: string, brief: RequirementBrief | null): boolean {
  const t = text.trim();
  if (!t || t.length > 600) return false;
  if (!brief || brief.status !== "gathering") return false;
  if (/[？?]\s*$/.test(t)) return false;
  if (isCasualQaIntent(t)) return false;
  if (/^【需求补充/.test(t)) return true;
  if (/^\s*\d+[\.、\)]\s*\S+/m.test(t) && /答[：:]/.test(t)) return true;
  if ((brief.openQuestions?.length || brief.pendingGapQuestions?.length) && /^\s*\d+[\.、\)]\s*\S+/m.test(t)) {
    return true;
  }
  return false;
}

/**
 * Classify Boss office / chat message. Kickoff is blocked while brief is gathering.
 */
export function routeBossIntent(
  text: string,
  brief: RequirementBrief | null,
): IntentResult {
  const t = text.trim();
  if (!t) return { kind: "chitchat", blockedKickoff: false };

  if (isProtectedProductAsk(t)) {
    return { kind: "chitchat", blockedKickoff: false };
  }

  if (isWorkStop(t) && !isWorkReset(t)) {
    return { kind: "ops_stop", blockedKickoff: false };
  }
  if (isWorkReset(t)) {
    return { kind: "ops_reset", blockedKickoff: false };
  }
  if (FORCE_ALL_RE.test(t)) {
    return { kind: "force_all_kickoff", blockedKickoff: false };
  }
  if (REWORK_RE.test(t)) {
    return { kind: "acceptance_rework", blockedKickoff: false };
  }
  if (CONFIRM_RE.test(t)) {
    return { kind: "confirm_brief", blockedKickoff: false };
  }

  const wantsKickoff = isWorkKickoff(t);
  const ready = brief?.status === "ready" || brief?.status === "executing";

  if (wantsKickoff && ready) {
    return { kind: "kickoff_ready", blockedKickoff: false };
  }
  if (wantsKickoff && !ready) {
    return { kind: "clarify", blockedKickoff: true };
  }

  const work = classifyWorkMode(t, brief);

  if (
    brief &&
    brief.status === "gathering" &&
    (brief.goal || brief.openQuestions.length || brief.clarifyRound > 0)
  ) {
    if (isCasualQaIntent(t) || work.mode === "question" || work.mode === "operation") {
      return { kind: "chitchat", blockedKickoff: false };
    }
    if (/^【需求补充/.test(t) || looksLikeGapAnswer(t, brief) || needsBriefCollection(work)) {
      return { kind: "clarify", blockedKickoff: false };
    }
    return { kind: "chitchat", blockedKickoff: false };
  }

  if (needsBriefCollection(work) && isProductBuildIntent(t)) {
    return { kind: "clarify", blockedKickoff: false };
  }

  if (wantsKickoff) {
    return { kind: "clarify", blockedKickoff: true };
  }

  return { kind: "chitchat", blockedKickoff: false };
}
