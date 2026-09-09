/**
 * @file generic.ts 通用版式兜底配方
 * @author qiuye <yjk150@qq.com>
 * @date 2026-09-06
 * @version 1.0.0
 * @category Cache
 * @algo generic-draw-recipe
 */

import { newStrokeId, type Stroke } from "../sketchTypes";
import type { CanvasDrawRecipe } from "./types";

const LAYER = "ly1";
const PAPER_W = 420;
const PAPER_H = 297;

const strokeRect = (x: number, y: number, w: number, h: number): Stroke => ({
  id: newStrokeId(),
  layerId: LAYER,
  kind: "rect",
  x,
  y,
  w,
  h,
  style: { color: "#1e293b", width: 2, fill: null, opacity: 1 },
});

const strokeText = (x: number, y: number, text: string): Stroke => ({
  id: newStrokeId(),
  layerId: LAYER,
  kind: "text",
  x,
  y,
  text,
  style: { color: "#0f172a", width: 1, fill: null, opacity: 1 },
});

export const genericRecipe: CanvasDrawRecipe = {
  id: "generic",
  kind: "generic",
  match: () => true,
  build: () => {
    const title = "草图";
    const m = 28;
    const ox = m;
    const oy = m;
    const w = PAPER_W - m * 2;
    const h = PAPER_H - m * 2;

    const frame: Stroke[] = [
      strokeRect(ox, oy, w, h),
      strokeText(ox + 8, oy - 12, "通用草图"),
    ];
    const blocks: Stroke[] = [
      strokeRect(ox + 16, oy + 20, w - 32, 48),
      strokeText(ox + 24, oy + 38, title),
      strokeRect(ox + 16, oy + 84, (w - 40) / 2, h - 120),
      strokeText(ox + 24, oy + 100, "区块 A"),
      strokeRect(ox + 24 + (w - 40) / 2, oy + 84, (w - 40) / 2, h - 120),
      strokeText(ox + 32 + (w - 40) / 2, oy + 100, "区块 B"),
    ];

    return {
      summary: "已写入通用草图骨架到左侧，可继续让助手按题材细化。",
      steps: [
        { id: "frame", label: "第1步：画外框", strokes: frame },
        { id: "blocks", label: "第2步：分区", strokes: [...frame, ...blocks] },
        {
          id: "done",
          label: "第3步：完成骨架",
          strokes: [...frame, ...blocks],
        },
      ],
    };
  },
};
