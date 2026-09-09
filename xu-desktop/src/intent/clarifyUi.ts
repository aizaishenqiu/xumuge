/**
 * @file 澄清弹窗 / 状态文案（Chat 与办公室共用）
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-31
 * @updated 2026-09-02
 * @version 2.2.0
 * @category Parse
 * @algo clarify-question-cap-3
 */
import type { RequirementBrief } from "./briefTypes";
import type { XuProject } from "../utils/projects";
import {
  briefGapsOptsFromBrief,
  computeBriefGaps,
  countBriefGapProgress,
  gapsToQuestions,
  type BriefGapsOpts,
} from "./briefGaps";
import { shouldCollectViaDialog } from "./workModeClassifier";

export const CLARIFY_DIALOG_HINT_DEFAULT =
  "按行业标准逐项补充（每轮最多 3 问）。不适用请点「不适用」或填「无」。";

export const CLARIFY_DIALOG_HINT_DELIVERY =
  "确认交付要求（最多 3 项：目标、验收、约束）。不适用请点「不适用」或填「无」。";

export const CLARIFY_DIALOG_HINT_OFFICE =
  "按行业标准逐项补充（每轮最多 3 问）。全部齐后请先确认需求。";

export const GAPS_FILLED_HINT =
  "标准需求项已齐。请回复或点击「确认需求」，确认后再打开「开始项目」。";

/** Dispatched when main chat mirrors clarify; office should refresh Brief + maybe open dialog. */
export const XU_CLARIFY_PENDING = "xu-clarify-pending";

export type ClarifyOpenReason =
  | "clarify"
  | "confirm_brief"
  | "blocked_kickoff"
  | "kickoff_preflight"
  | "manual";

const DEFAULT_MAX_QUESTIONS = 3;

let lastClarifyDialogSource: "chat" | "office" | null = null;
let lastClarifyDialogProjectId: string | null = null;
let lastClarifyDialogAt = 0;

/** 记录弹窗由哪端打开，避免 Chat/办公室双开。 */
export function markClarifyDialogOpened(
  source: "chat" | "office",
  projectId?: string | null,
): void {
  lastClarifyDialogSource = source;
  lastClarifyDialogProjectId = projectId || null;
  lastClarifyDialogAt = Date.now();
}

export function shouldOfficeAutoOpenClarify(projectId?: string | null): boolean {
  if (
    lastClarifyDialogSource === "chat" &&
    lastClarifyDialogProjectId === (projectId || null) &&
    Date.now() - lastClarifyDialogAt < 4000
  ) {
    return false;
  }
  return true;
}

export function isSoftwareBriefProject(project: XuProject | null | undefined): boolean {
  return project?.type === "software";
}

function resolveGapOpts(
  brief: RequirementBrief | null | undefined,
  project?: XuProject | null,
  opts?: { gapOpts?: BriefGapsOpts; software?: boolean },
): BriefGapsOpts {
  if (opts?.gapOpts) return opts.gapOpts;
  if (brief) return briefGapsOptsFromBrief(brief, project);
  return { software: opts?.software };
}

export function clarifyDialogCopy(brief: RequirementBrief | null | undefined): {
  title: string;
  hint: string;
} {
  if (brief?.workMode === "delivery") {
    return {
      title: "确认交付要求",
      hint: CLARIFY_DIALOG_HINT_DELIVERY,
    };
  }
  return {
    title: "补充需求",
    hint: CLARIFY_DIALOG_HINT_DEFAULT,
  };
}

/**
 * 弹窗/进度用的问题列表：按行业标准顺序取未填项，最多 3 条。
 */
export function resolveClarifyQuestions(
  brief: RequirementBrief | null | undefined,
  opts?: { software?: boolean; gapOpts?: BriefGapsOpts; max?: number; project?: XuProject | null },
): string[] {
  if (!brief || brief.status !== "gathering") return [];
  const gapOpts = resolveGapOpts(brief, opts?.project, opts);
  if (gapOpts.profile === "none") return [];
  const max = opts?.max ?? DEFAULT_MAX_QUESTIONS;
  const fromOpen = (brief.openQuestions || []).map((q) => q.trim()).filter(Boolean);
  if (fromOpen.length) return fromOpen.slice(0, max);
  const fromPending = (brief.pendingGapQuestions || [])
    .map((q) => q.trim())
    .filter(Boolean);
  if (fromPending.length) return fromPending.slice(0, max);
  const gaps = computeBriefGaps(brief, gapOpts);
  return gapsToQuestions(gaps, max);
}

export function shouldOpenClarifyDialog(
  brief: RequirementBrief | null | undefined,
  reason: ClarifyOpenReason,
  opts?: { software?: boolean; gapOpts?: BriefGapsOpts; project?: XuProject | null },
): boolean {
  if (!brief || brief.status !== "gathering") return false;
  const gapOpts = resolveGapOpts(brief, opts?.project, opts);
  if (
    gapOpts.profile === "none" &&
    reason !== "manual" &&
    reason !== "kickoff_preflight" &&
    reason !== "confirm_brief"
  ) {
    return false;
  }
  if (
    brief.workMode &&
    !shouldCollectViaDialog({ mode: brief.workMode, complexity: brief.deliveryComplexity }, reason)
  ) {
    if (reason !== "manual" && reason !== "kickoff_preflight" && reason !== "confirm_brief") {
      return false;
    }
  }
  const qs = resolveClarifyQuestions(brief, { ...opts, gapOpts });
  if (!qs.length) return false;
  if (reason === "manual" || reason === "kickoff_preflight" || reason === "confirm_brief") {
    return true;
  }
  return reason === "clarify" || reason === "blocked_kickoff";
}

export type ClarifyDialogOpenPayload = {
  questions: string[];
  hint: string;
  title: string;
  reason: ClarifyOpenReason;
};

export function buildClarifyDialogOpen(
  brief: RequirementBrief | null | undefined,
  reason: ClarifyOpenReason,
  opts?: { software?: boolean; gapOpts?: BriefGapsOpts; hint?: string; project?: XuProject | null },
): ClarifyDialogOpenPayload | null {
  if (!shouldOpenClarifyDialog(brief, reason, opts)) return null;
  const gapOpts = resolveGapOpts(brief, opts?.project, opts);
  const questions = resolveClarifyQuestions(brief, {
    ...opts,
    gapOpts,
    max: DEFAULT_MAX_QUESTIONS,
  });
  if (!questions.length) return null;
  const copy = clarifyDialogCopy(brief);
  return {
    questions,
    hint: opts?.hint || copy.hint,
    title: copy.title,
    reason,
  };
}

/**
 * 短状态通知：只报完整度，不再复述问题列表（避免与弹窗重复）。
 */
export function formatPendingClarifyNotice(
  brief: RequirementBrief,
  opts?: BriefGapsOpts | { software?: boolean },
): string | null {
  const gapOpts =
    opts && "profile" in opts ? opts : briefGapsOptsFromBrief(brief, null);
  if (gapOpts.profile === "none") return null;
  const gaps = computeBriefGaps(brief, gapOpts);
  if (!gaps.length && brief.goal?.trim()) return GAPS_FILLED_HINT;
  if (!gaps.length) return null;
  const { filled, total } = countBriefGapProgress(brief, gapOpts);
  const label = brief.workMode === "delivery" ? "交付要求" : "需求";
  return `${label}收集中（${filled}/${total}）。点「补充需求」继续；无则写「无」。`;
}

/** Office strip stage label beyond brief.status. */
export type BriefPipelineStage =
  | "none"
  | "gathering"
  | "ready"
  | "designing"
  | "awaiting_tech"
  | "executing";

export function briefPipelineStageLabel(
  brief: RequirementBrief | null | undefined,
  opts?: {
    software?: boolean;
    gapOpts?: BriefGapsOpts;
    project?: XuProject | null;
    awaitingDesignConfirm?: boolean;
    designFrozen?: boolean;
  },
): string {
  if (!brief) return "需求未确认";
  const gapOpts = resolveGapOpts(brief, opts?.project, opts);
  const software = gapOpts.profile === "software";
  const v = brief.version ? ` · v${brief.version}` : "";
  if (brief.status === "executing") return `开发中${v}`;
  if (brief.status === "ready") {
    if (opts?.awaitingDesignConfirm) return `设计中${v}`;
    if (software && brief.designFrozen) return `待确认技术${v}`;
    if (software) return `已就绪 · 待开始设计${v}`;
    return `需求已就绪${v}`;
  }
  if (brief.status === "gathering") {
    const { filled, total } = countBriefGapProgress(brief, gapOpts);
    return brief.goal?.trim()
      ? `收集中 (${filled}/${total})${v}`
      : `需求未确认${v}`;
  }
  return "需求未确认";
}

export function notifyClarifyPending(projectId?: string | null): void {
  window.dispatchEvent(
    new CustomEvent(XU_CLARIFY_PENDING, { detail: { projectId: projectId || null } }),
  );
}
