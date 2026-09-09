/**
 * @file index.ts Canvas 出图配方对外入口
 * @author qiuye <yjk150@qq.com>
 * @date 2026-09-06
 * @version 1.0.0
 * @category Cache
 * @algo canvas-draw-recipes-public-api
 */

export type {
  CanvasDrawKind,
  CanvasDrawStep,
  CanvasDrawBuildResult,
  CanvasDrawRecipe,
} from "./types";
export { classifyCanvasDrawKind, resolveDrawRecipe, resolveDrawRecipeByKind, listDrawRecipes } from "./registry";
export {
  resolveCanvasDrawSubject,
  resolveDrawRecipeFromSession,
  isDrawProcessOrComplaint,
  DRAW_PROCESS_OR_COMPLAINT_RE,
} from "./subject";
export { runCanvasDrawStepped, runDrawRecipeStepped } from "./runStepped";
export { writeBoardStrokes, boardJsonFromStrokes } from "./writeBoard";
export { boardHasRecipeAnchors } from "./boardAnchors";
export { countSketchStrokes } from "../simpleFloorPlanBoard";
export {
  prepareCanvasDrawTurn,
  runLocalIfAny,
  healIfNeeded,
  canvasLayoutHintForKind,
  CANVAS_LLM_DRAW_HINT,
  CANVAS_LOCAL_DONE_HINT,
} from "./orchestrate";
export type { CanvasDrawMode, CanvasDrawPlan } from "./orchestrate";
