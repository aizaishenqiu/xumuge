/**
 * @file subject.ts 从本句与会话历史解析 Canvas 出图题材
 * @author qiuye <yjk150@qq.com>
 * @date 2026-09-06
 * @version 1.0.0
 * @category Cache
 * @algo canvas-draw-subject-from-session
 */

import { classifyCanvasDrawKind, resolveDrawRecipeByKind } from "./registry";
import type { CanvasDrawKind, CanvasDrawRecipe } from "./types";

/** 抱怨 / 要过程 / 纠错：不是新开一张「通用骨架」。 */
export const DRAW_PROCESS_OR_COMPLAINT_RE =
  /画图过程|线框图|还是这样|画得|画成这样|乱画|没画|重画|遗憾|改了.?轮|读取对话记录/i;

/** Duty: 当前句是过程说明或对已出图的抱怨，而非新题材。 */
export function isDrawProcessOrComplaint(text: string): boolean {
  return DRAW_PROCESS_OR_COMPLAINT_RE.test((text || "").trim());
}

export type CanvasDrawSubject = {
  kind: CanvasDrawKind;
  text: string;
};

function pickHistoryKind(
  rows: Array<{ t: string; kind: CanvasDrawKind }>,
): { t: string; kind: CanvasDrawKind } | undefined {
  return (
    rows.find((x) => x.kind === "floorPlan") ||
    rows.find((x) => x.kind === "posterAd") ||
    rows.find((x) => x.kind === "typeset")
  );
}

/**
 * Duty: 合并当前句与历史用户句，得到出图题材与供配方解析的文本。
 * 抱怨/过程句不降级为 generic；户型数字以历史「N平方 N房N厅」为准。
 */
export function resolveCanvasDrawSubject(
  current: string,
  priorUserTexts: string[],
): CanvasDrawSubject {
  const now = (current || "").trim();
  const currentKind = classifyCanvasDrawKind(now);
  const history = (priorUserTexts || [])
    .map((t) => (t || "").trim())
    .filter(Boolean)
    .map((t) => ({ t, kind: classifyCanvasDrawKind(t) }))
    .filter((x) => x.kind !== "generic");
  const complaint = isDrawProcessOrComplaint(now);

  if (currentKind !== "generic" && !complaint) {
    const same = history.filter((x) => x.kind === currentKind).map((x) => x.t);
    return { kind: currentKind, text: [now, ...same].filter(Boolean).join("\n") };
  }

  const hit = pickHistoryKind(history);
  if (hit) {
    const same = history.filter((x) => x.kind === hit.kind).map((x) => x.t);
    return { kind: hit.kind, text: [now, ...same].filter(Boolean).join("\n") };
  }

  return { kind: currentKind, text: now };
}

/** Duty: 按会话题材取配方（抱怨句沿用历史户型/海报/排版）。 */
export function resolveDrawRecipeFromSession(
  current: string,
  priorUserTexts: string[],
): CanvasDrawRecipe {
  const subject = resolveCanvasDrawSubject(current, priorUserTexts);
  return resolveDrawRecipeByKind(subject.kind);
}
