/**
 * @file typeset.ts 排版出图配方
 * @author qiuye <yjk150@qq.com>
 * @date 2026-09-06
 * @version 1.0.0
 * @category Cache
 * @algo typeset-draw-recipe
 */

import { newStrokeId, type Stroke } from "../sketchTypes";
import type { CanvasDrawRecipe } from "./types";

const TYPESET_RE = /排版|版式|双栏|三栏|栏\s*版|杂志|通栏|页眉|页脚|正文栏/i;
const LAYER = "ly1";
const PAPER_W = 420;
const PAPER_H = 297;

const strokeRect = (x: number, y: number, w: number, h: number, color = "#1e293b"): Stroke => ({
  id: newStrokeId(),
  layerId: LAYER,
  kind: "rect",
  x,
  y,
  w,
  h,
  style: { color, width: 1.5, fill: null, opacity: 1 },
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

const strokeLine = (x1: number, y1: number, x2: number, y2: number): Stroke => ({
  id: newStrokeId(),
  layerId: LAYER,
  kind: "line",
  x1,
  y1,
  x2,
  y2,
  style: { color: "#94a3b8", width: 1, fill: null, opacity: 1 },
});

function parseColumns(text: string): number {
  if (/三栏|3\s*栏/.test(text)) return 3;
  if (/单栏|1\s*栏/.test(text)) return 1;
  if (/双栏|两栏|2\s*栏/.test(text)) return 2;
  return 2;
}

export const typesetRecipe: CanvasDrawRecipe = {
  id: "typeset",
  kind: "typeset",
  match: (text) => TYPESET_RE.test((text || "").trim()),
  build: (text) => {
    const cols = parseColumns(text);
    const m = 28;
    const ox = m;
    const oy = m;
    const w = PAPER_W - m * 2;
    const h = PAPER_H - m * 2;

    const frame: Stroke[] = [
      strokeRect(ox, oy, w, h, "#0f172a"),
      strokeText(ox + 6, oy - 12, `排版 · ${cols} 栏版式`),
    ];

    const headH = 36;
    const footH = 22;
    const gap = 10;
    const bodyTop = oy + headH + 12;
    const bodyH = h - headH - footH - 24;
    const colW = (w - gap * (cols + 1)) / cols;

    const header: Stroke[] = [
      strokeRect(ox + 8, oy + 8, w - 16, headH),
      strokeText(ox + 16, oy + 20, "大标题 / Headline"),
      strokeLine(ox + 8, oy + 8 + headH + 4, ox + w - 8, oy + 8 + headH + 4),
    ];

    const columns: Stroke[] = [];
    for (let i = 0; i < cols; i++) {
      const x = ox + gap + i * (colW + gap);
      columns.push(strokeRect(x, bodyTop, colW, bodyH, "#64748b"));
      columns.push(strokeText(x + 8, bodyTop + 14, `栏 ${i + 1}`));
      for (let L = 0; L < 5; L++) {
        columns.push(
          strokeLine(x + 8, bodyTop + 36 + L * 14, x + colW - 8, bodyTop + 36 + L * 14),
        );
      }
    }

    const footer: Stroke[] = [
      strokeLine(ox + 8, oy + h - footH - 4, ox + w - 8, oy + h - footH - 4),
      strokeText(ox + 12, oy + h - footH + 4, "页脚 · 页码 / 来源"),
    ];

    return {
      summary: `已按 ${cols} 栏版式画在左侧草图，可继续改标题与栏宽。`,
      steps: [
        { id: "frame", label: "第1步：页框", strokes: frame },
        { id: "header", label: "第2步：标题区", strokes: [...frame, ...header] },
        {
          id: "body",
          label: "第3步：分栏与页脚",
          strokes: [...frame, ...header, ...columns, ...footer],
        },
      ],
    };
  },
};
