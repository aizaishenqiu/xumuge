/**
 * @file floorPlanDrawSteps.ts 户型分步（兼容旧入口，转发公用引擎）
 * @author qiuye <yjk150@qq.com>
 * @date 2026-09-06
 * @updated 2026-09-06
 * @version 1.1.0
 * @category Cache
 * @algo stepped-floor-plan-draw
 */

import { floorPlanRecipe } from "./drawRecipes/floorPlan";
import { runDrawRecipeStepped } from "./drawRecipes/runStepped";
import type { CanvasDrawStep } from "./drawRecipes/types";

/** @deprecated 使用 CanvasDrawStep */
export type FloorPlanStep = CanvasDrawStep;

export type DrawFloorPlanOptions = {
  workspace: string;
  userText: string;
  onStep?: (step: CanvasDrawStep, index: number, total: number) => void | Promise<void>;
  stepDelayMs?: number;
};

/** Duty: 户型分步出图（内部走公用配方引擎）。 */
export async function drawFloorPlanStepped(
  opts: DrawFloorPlanOptions,
): Promise<{ count: number; summary: string }> {
  const r = await runDrawRecipeStepped({
    workspace: opts.workspace,
    userText: opts.userText,
    recipe: floorPlanRecipe,
    onStep: opts.onStep,
    stepDelayMs: opts.stepDelayMs,
  });
  return { count: r.count, summary: r.summary };
}
