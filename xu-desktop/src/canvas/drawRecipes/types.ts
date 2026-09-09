/**
 * @file types.ts Canvas 公用出图配方类型
 * @author qiuye <yjk150@qq.com>
 * @date 2026-09-06
 * @version 1.0.0
 * @category Cache
 * @algo canvas-draw-recipe-types
 */

import type { Stroke } from "../sketchTypes";

export type CanvasDrawKind = "floorPlan" | "posterAd" | "typeset" | "generic";

export type CanvasDrawStep = {
  id: string;
  label: string;
  strokes: Stroke[];
};

export type CanvasDrawBuildResult = {
  steps: CanvasDrawStep[];
  summary: string;
};

export type CanvasDrawRecipe = {
  id: string;
  kind: CanvasDrawKind;
  /** Duty: 是否匹配该用户话术（registry 也可先 classify 再取配方）。 */
  match: (text: string) => boolean;
  build: (text: string) => CanvasDrawBuildResult;
};
