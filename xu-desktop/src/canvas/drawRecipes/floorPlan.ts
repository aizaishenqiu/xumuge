/**
 * @file floorPlan.ts 户型出图配方
 * @author qiuye <yjk150@qq.com>
 * @date 2026-09-06
 * @version 1.0.0
 * @category Cache
 * @algo floor-plan-draw-recipe
 */

import { buildFloorPlanStrokeGroups } from "../simpleFloorPlanBoard";
import type { CanvasDrawRecipe } from "./types";

const FLOOR_RE =
  /户型|平面图|施工图|几房|房\d|\d\s*室|厅|卧室|客厅|布局图|房子布局|装修图|平方|㎡|m²|室一厅|室两厅|一厅|两厅|三厅|别墅|自建|层楼|\d\s*层|占地|建筑面积|\d+\s*平/i;

export const floorPlanRecipe: CanvasDrawRecipe = {
  id: "floorPlan",
  kind: "floorPlan",
  match: (text) => FLOOR_RE.test((text || "").trim()),
  build: (text) => {
    const g = buildFloorPlanStrokeGroups(text);
    return {
      summary: g.summary,
      steps: [
        { id: "shell", label: "第1步：画外墙", strokes: g.shell },
        {
          id: "partitions",
          label: "第2步：分间",
          strokes: [...g.shell, ...g.partitions],
        },
        {
          id: "labels",
          label: "第3步：标注",
          strokes: [...g.shell, ...g.partitions, ...g.labels],
        },
      ],
    };
  },
};
