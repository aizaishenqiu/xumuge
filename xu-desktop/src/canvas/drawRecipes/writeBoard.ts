/**
 * @file writeBoard.ts 公用写入 sketch/board.json
 * @author qiuye <yjk150@qq.com>
 * @date 2026-09-06
 * @version 1.0.0
 * @category Cache
 * @algo canvas-board-write
 */

import { CANVAS_DIRS, ensureCanvasDirs, writeCanvasText } from "../canvasIo";
import type { Stroke } from "../sketchTypes";

const PAPER_W = 420;
const PAPER_H = 297;
const LAYER = "ly1";

/** Duty: 组装 version5 board JSON。 */
export function boardJsonFromStrokes(
  strokes: Stroke[],
  opts?: { paperW?: number; paperH?: number; layerId?: string; layerName?: string },
): string {
  const layerId = opts?.layerId ?? LAYER;
  return JSON.stringify(
    {
      version: 5,
      paper: {
        w: opts?.paperW ?? PAPER_W,
        h: opts?.paperH ?? PAPER_H,
        unit: "mm",
        dpi: 96,
        scale: 100,
        bg: "#ffffff",
      },
      deskBg: "#64748b",
      layers: [{ id: layerId, name: opts?.layerName ?? "图层 1", hidden: false, locked: false }],
      strokes,
    },
    null,
    2,
  );
}

/** Duty: 写入草图 board.json；返回图元数。 */
export async function writeBoardStrokes(workspace: string, strokes: Stroke[]): Promise<number> {
  await ensureCanvasDirs(workspace);
  const json = boardJsonFromStrokes(strokes);
  await writeCanvasText(workspace, `${CANVAS_DIRS.sketch}/board.json`, json);
  return strokes.length;
}
