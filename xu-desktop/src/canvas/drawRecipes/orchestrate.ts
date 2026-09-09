/**
 * @file orchestrate.ts Canvas 出图共用编排（模型工具主画 / 配方仅 hint·heal）
 * @author qiuye <yjk150@qq.com>
 * @date 2026-09-06
 * @updated 2026-09-06
 * @version 2.0.0
 * @category Cache
 * @algo canvas-draw-orchestrator
 */

import { isCanvasDrawIntent, isCanvasDrawRetryIntent } from "../../intent/turnKind";
import { boardHasRecipeAnchors } from "./boardAnchors";
import { resolveDrawRecipeByKind } from "./registry";
import { runDrawRecipeStepped } from "./runStepped";
import { resolveCanvasDrawSubject } from "./subject";
import type { CanvasDrawKind, CanvasDrawRecipe, CanvasDrawStep } from "./types";

export type CanvasDrawMode = "llm" | "none";

export type CanvasDrawPlan = {
  mode: CanvasDrawMode;
  kind: CanvasDrawKind;
  subjectText: string;
  /** 兼容旧字段：恒为 false（不再抢先禁用工具） */
  lockTools: boolean;
  /** 失败时可本机配方兜底 */
  canHealRecipe: boolean;
};

/** Duty: 模型用原子工具小步画图（Codex 式）。 */
export const CANVAS_LLM_DRAW_HINT =
  "【本轮画板·工具绘制】优先多轮调用：canvas_clear_sketch（新图）→ canvas_add_strokes（追加 1～N 个图元）→ 需要时 canvas_update_stroke / canvas_delete_strokes。" +
  "少用 canvas_write_sketch 整板覆盖。每步工具结果含图元数与 id，据此继续改，不要口头假装已画。" +
  "图元 text 只能是房间名、标题、尺寸等短标注，禁止把用户整段原话写入画板，禁止「区块 A/B」或「通用草图」当交付。" +
  "禁止只口头描述、禁止「想象一下」、禁止酷家乐/CAD/PS/Figma 教程。设置里没有 Canvas 权限开关。";

/** @deprecated 保留导出：旧「本机已出图锁工具」文案，现仅 heal 旁白偶用 */
export const CANVAS_LOCAL_DONE_HINT =
  "本回合画板已由本机配方兜底画好。勿再整板覆盖冲掉；可用 canvas_update_stroke 微调。" +
  "勿外链软件教程、勿编造设置权限。";

function isHealKind(kind: CanvasDrawKind): boolean {
  return kind === "floorPlan" || kind === "posterAd" || kind === "typeset";
}

/** Duty: 题材布局 hint（不抢画，只给模型参考）。 */
export function canvasLayoutHintForKind(kind: CanvasDrawKind): string {
  switch (kind) {
    case "floorPlan":
      return "【布局建议·户型】纸面约 A3；外墙矩形+内部分隔线+房间名 text+关键边 dim；比例一致，先外框再分区再标注。";
    case "posterAd":
      return "【布局建议·海报】大标题+主视觉区矩形+一句卖点；色块与文字分层，勿堆聊天原文。";
    case "typeset":
      return "【布局建议·排版】栏宽对齐、标题层级清晰；用 rect 做栏框、text 做短标题。";
    default:
      return "【布局建议】按用户需求小步追加图元，先结构后标注。";
  }
}

/** Duty: 判定本回合 llm / none。认得的题材也走模型工具；配方仅 heal。 */
export function prepareCanvasDrawTurn(
  current: string,
  priorUserTexts: string[],
): CanvasDrawPlan {
  const subject = resolveCanvasDrawSubject(current, priorUserTexts);
  const drawIntent =
    isCanvasDrawIntent(current) ||
    (isCanvasDrawRetryIntent(current) && subject.kind !== "generic");
  if (!drawIntent) {
    return {
      mode: "none",
      kind: subject.kind,
      subjectText: subject.text,
      lockTools: false,
      canHealRecipe: false,
    };
  }
  return {
    mode: "llm",
    kind: subject.kind,
    subjectText: subject.text || current,
    lockTools: false,
    canHealRecipe: isHealKind(subject.kind),
  };
}

export type LocalDrawRunOpts = {
  workspace: string;
  plan: CanvasDrawPlan;
  onStep?: (step: CanvasDrawStep, index: number, total: number) => void | Promise<void>;
};

/** Duty: 仅 heal/失败兜底跑本机配方；主路径不再抢跑。 */
export async function runLocalIfAny(
  opts: LocalDrawRunOpts,
): Promise<{ count: number; summary: string; kind: string } | null> {
  if (!opts.plan.canHealRecipe) return null;
  if (!isHealKind(opts.plan.kind)) return null;
  const recipe: CanvasDrawRecipe = resolveDrawRecipeByKind(opts.plan.kind);
  if (recipe.kind === "generic") return null;
  return runDrawRecipeStepped({
    workspace: opts.workspace,
    userText: opts.plan.subjectText,
    recipe,
    onStep: opts.onStep,
  });
}

/** Duty: 本机题材板上锚点丢失则按同一配方重画。 */
export async function healIfNeeded(
  opts: LocalDrawRunOpts,
): Promise<{ count: number; summary: string; kind: string } | null> {
  if (!opts.plan.canHealRecipe) return null;
  const ok = await boardHasRecipeAnchors(opts.workspace, opts.plan.kind);
  if (ok) return null;
  return runLocalIfAny(opts);
}
