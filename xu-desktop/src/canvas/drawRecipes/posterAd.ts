/**
 * @file posterAd.ts 海报/广告出图配方
 * @author qiuye <yjk150@qq.com>
 * @date 2026-09-06
 * @version 1.0.0
 * @category Cache
 * @algo poster-ad-draw-recipe
 */

import { newStrokeId, type Stroke } from "../sketchTypes";
import type { CanvasDrawRecipe } from "./types";

const POSTER_RE = /海报|广告|海鸥|宣传|招贴|banner|主视觉|卖点|促销/i;
const LAYER = "ly1";
const PAPER_W = 420;
const PAPER_H = 297;

const strokeRect = (
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
  width = 2,
  fill: string | null = null,
): Stroke => ({
  id: newStrokeId(),
  layerId: LAYER,
  kind: "rect",
  x,
  y,
  w,
  h,
  style: { color, width, fill, opacity: 1 },
});

const strokeText = (x: number, y: number, text: string, color = "#0f172a"): Stroke => ({
  id: newStrokeId(),
  layerId: LAYER,
  kind: "text",
  x,
  y,
  text,
  style: { color, width: 1, fill: null, opacity: 1 },
});

function parseBrand(text: string): string {
  const t = (text || "").trim();
  const m =
    t.match(/([^\s，。！？]{2,12})(?:广告|海报|宣传)/) ||
    t.match(/(?:为|给|做)([^\s，。！？]{2,12})(?:做|画|出)/);
  if (m?.[1]) return m[1]!;
  if (/海鸥/.test(t)) return "海鸥";
  return "品牌";
}

export const posterAdRecipe: CanvasDrawRecipe = {
  id: "posterAd",
  kind: "posterAd",
  match: (text) => POSTER_RE.test((text || "").trim()),
  build: (text) => {
    const brand = parseBrand(text);
    const m = 24;
    const w = PAPER_W - m * 2;
    const h = PAPER_H - m * 2;
    const ox = m;
    const oy = m;

    const frame: Stroke[] = [
      strokeRect(ox, oy, w, h, "#0f172a", 3),
      strokeText(ox + 8, oy - 12, `${brand} · 广告海报骨架`),
    ];

    const heroH = h * 0.42;
    const hero: Stroke[] = [
      strokeRect(ox + 12, oy + 16, w - 24, heroH, "#0369a1", 2, "#e0f2fe"),
      strokeText(ox + w / 2 - 36, oy + 16 + heroH / 2 - 6, "主视觉区"),
    ];

    const titleY = oy + 16 + heroH + 20;
    const copy: Stroke[] = [
      strokeText(ox + 20, titleY, `${brand}`, "#0c4a6e"),
      strokeText(ox + 20, titleY + 22, "一句话卖点 / 副标题", "#334155"),
      strokeRect(ox + 16, titleY + 40, w - 32, 36, "#64748b", 1),
      strokeText(ox + 24, titleY + 52, "卖点条 · 可改文案", "#475569"),
    ];

    const ctaY = oy + h - 48;
    const cta: Stroke[] = [
      strokeRect(ox + w / 2 - 70, ctaY, 140, 32, "#0f766e", 2, "#ccfbf1"),
      strokeText(ox + w / 2 - 28, ctaY + 10, "立即了解", "#134e4a"),
    ];

    return {
      summary: `已按「${brand}」海报骨架画在左侧草图，可继续改文案与配色。`,
      steps: [
        { id: "frame", label: "第1步：画画框", strokes: frame },
        { id: "hero", label: "第2步：主视觉", strokes: [...frame, ...hero] },
        {
          id: "copy",
          label: "第3步：文案与按钮",
          strokes: [...frame, ...hero, ...copy, ...cta],
        },
      ],
    };
  },
};
