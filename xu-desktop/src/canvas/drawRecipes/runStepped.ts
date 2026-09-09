/**
 * @file runStepped.ts 公用分步写入画板并刷新
 * @author qiuye <yjk150@qq.com>
 * @date 2026-09-06
 * @version 1.0.0
 * @category Cache
 * @algo canvas-draw-stepped-runner
 */

import { emitCanvasSketchUpdated } from "../../utils/crossWindowBus";
import type { CanvasDrawRecipe, CanvasDrawStep } from "./types";
import { writeBoardStrokes } from "./writeBoard";

const DEFAULT_STEP_MS = 350;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => window.setTimeout(r, ms));
}

export type RunCanvasDrawSteppedOpts = {
  workspace: string;
  steps: CanvasDrawStep[];
  summary: string;
  onStep?: (step: CanvasDrawStep, index: number, total: number) => void | Promise<void>;
  stepDelayMs?: number;
};

/**
 * Duty: 按步骤累积写入 board.json 并 emit 刷新。
 */
export async function runCanvasDrawStepped(
  opts: RunCanvasDrawSteppedOpts,
): Promise<{ count: number; summary: string }> {
  const delay = opts.stepDelayMs ?? DEFAULT_STEP_MS;
  const { workspace, steps, summary } = opts;
  let count = 0;
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]!;
    await opts.onStep?.(step, i, steps.length);
    count = await writeBoardStrokes(workspace, step.strokes);
    emitCanvasSketchUpdated(workspace);
    if (i < steps.length - 1) await sleep(delay);
  }
  return { count, summary };
}

/**
 * Duty: 用配方 build 后分步出图。
 */
export async function runDrawRecipeStepped(opts: {
  workspace: string;
  userText: string;
  recipe: CanvasDrawRecipe;
  onStep?: (step: CanvasDrawStep, index: number, total: number) => void | Promise<void>;
  stepDelayMs?: number;
}): Promise<{ count: number; summary: string; kind: string }> {
  const built = opts.recipe.build(opts.userText);
  const result = await runCanvasDrawStepped({
    workspace: opts.workspace,
    steps: built.steps,
    summary: built.summary,
    onStep: opts.onStep,
    stepDelayMs: opts.stepDelayMs,
  });
  return { ...result, kind: opts.recipe.kind };
}
