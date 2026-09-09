/**
 * @file boardAnchors.ts 校验 board.json 是否仍含配方题材锚点
 * @author qiuye <yjk150@qq.com>
 * @date 2026-09-06
 * @version 1.0.0
 * @category Cache
 * @algo canvas-board-anchor-check
 */

import { CANVAS_DIRS, readCanvasText } from "../canvasIo";
import type { CanvasDrawKind } from "./types";

const ANCHORS: Record<CanvasDrawKind, RegExp[]> = {
  floorPlan: [/客厅/, /主卧/],
  posterAd: [/主视觉区/],
  typeset: [/栏\s*1/],
  generic: [/通用草图|区块\s*A/],
};

/** Duty: 读草图全部文字图元拼成一段文本。 */
async function boardTextBlob(workspace: string): Promise<string> {
  try {
    const raw = await readCanvasText(workspace, `${CANVAS_DIRS.sketch}/board.json`);
    const parsed = JSON.parse(raw) as { strokes?: Array<{ text?: string; label?: string }> };
    if (!Array.isArray(parsed.strokes)) return "";
    return parsed.strokes
      .map((s) => `${s.text || ""}${s.label || ""}`)
      .join("\n");
  } catch {
    return "";
  }
}

/**
 * Duty: 判断当前 board 是否仍含该题材锚点（防模型覆盖后乱图）。
 * floorPlan 须同时有客厅与主卧；其它题材任一锚点命中即可。
 */
export async function boardHasRecipeAnchors(
  workspace: string,
  kind: CanvasDrawKind,
): Promise<boolean> {
  const blob = await boardTextBlob(workspace);
  if (!blob.trim()) return false;
  const list = ANCHORS[kind] || ANCHORS.generic;
  if (kind === "floorPlan") {
    return list.every((re) => re.test(blob));
  }
  return list.some((re) => re.test(blob));
}
