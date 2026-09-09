/**
 * @file registry.ts Canvas 出图配方注册与解析
 * @author qiuye <yjk150@qq.com>
 * @date 2026-09-06
 * @updated 2026-09-06
 * @version 1.0.1
 * @category Cache
 * @algo canvas-draw-recipe-registry
 */

import { floorPlanRecipe } from "./floorPlan";
import { genericRecipe } from "./generic";
import { posterAdRecipe } from "./posterAd";
import { typesetRecipe } from "./typeset";
import type { CanvasDrawKind, CanvasDrawRecipe } from "./types";

const RECIPES: CanvasDrawRecipe[] = [
  floorPlanRecipe,
  posterAdRecipe,
  typesetRecipe,
  genericRecipe,
];

const FLOOR_HINT =
  /户型|平面图|施工图|几房|\d\s*房|\d\s*室|\d\s*厅|卧室|客厅|布局图|房子布局|装修图|平方|㎡|m²|室一厅|室两厅|一厅|两厅|三厅|别墅|自建|层楼|\d\s*层|占地|建筑面积|\d+\s*平/i;
const POSTER_HINT = /海报|广告|海鸥|宣传|招贴|banner|主视觉|卖点|促销/i;
const TYPESET_HINT = /排版|版式|双栏|三栏|栏\s*版|杂志|通栏|页眉|页脚|正文栏/i;

/** Duty: 从话术判定出图题材。 */
export function classifyCanvasDrawKind(text: string): CanvasDrawKind {
  const t = (text || "").trim();
  if (!t) return "generic";
  // 更具体的题材优先；户型与海报同时出现时偏海报（广告话术常带「画」）
  if (POSTER_HINT.test(t) && !FLOOR_HINT.test(t)) return "posterAd";
  if (POSTER_HINT.test(t) && /海报|广告|海鸥/.test(t)) return "posterAd";
  if (TYPESET_HINT.test(t) && !FLOOR_HINT.test(t)) return "typeset";
  if (FLOOR_HINT.test(t)) return "floorPlan";
  if (TYPESET_HINT.test(t)) return "typeset";
  if (POSTER_HINT.test(t)) return "posterAd";
  return "generic";
}

/** Duty: 按题材取配方；未知走 generic。 */
export function resolveDrawRecipe(text: string): CanvasDrawRecipe {
  return resolveDrawRecipeByKind(classifyCanvasDrawKind(text));
}

/** Duty: 按已判定题材取配方。 */
export function resolveDrawRecipeByKind(kind: CanvasDrawKind): CanvasDrawRecipe {
  const hit = RECIPES.find((r) => r.kind === kind);
  return hit ?? genericRecipe;
}

/** Duty: 列出已注册配方（调试/帮助用）。 */
export function listDrawRecipes(): CanvasDrawRecipe[] {
  return [...RECIPES];
}
