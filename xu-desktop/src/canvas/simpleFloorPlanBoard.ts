/**
 * @file simpleFloorPlanBoard.ts 按面积生成真实向户型矢量（本机算法出图）
 * @author qiuye <yjk150@qq.com>
 * @date 2026-09-06
 * @updated 2026-09-06
 * @version 2.0.1
 * @category Cache
 * @algo area-scaled-apartment-layout
 */

import { CANVAS_DIRS, ensureCanvasDirs, readCanvasText, writeCanvasText } from "./canvasIo";
import { newStrokeId, type Stroke } from "./sketchTypes";

export type FloorHint = { bedrooms: number; living: number; areaM2: number | null };

export type FloorPlanStrokeGroups = {
  shell: Stroke[];
  partitions: Stroke[];
  labels: Stroke[];
  hint: FloorHint;
  paperW: number;
  paperH: number;
  layerId: string;
  summary: string;
};

const PAPER_W = 420;
const PAPER_H = 297;
const MARGIN = 28;
const WALL = 3;
const WALL_IN = 1.5;
const LAYER = "ly1";

const styleOut = { color: "#0f172a", width: WALL, fill: null as null, opacity: 1 };
const styleIn = { color: "#1e293b", width: WALL_IN, fill: null as null, opacity: 1 };
const styleText = { color: "#0f172a", width: 1, fill: null as null, opacity: 1 };
const styleDim = { color: "#475569", width: 1, fill: null as null, opacity: 1 };

/** Duty: 从用户话里粗解析几房几厅与面积（含「4室」「两厅」等口语）。 */
export function parseFloorHint(text: string): FloorHint {
  const t = (text || "").trim();
  const bed =
    Number((t.match(/(\d+)\s*房/) || t.match(/(\d+)\s*室/) || [])[1]) ||
    (/主卧|次卧|卧室/.test(t) ? 2 : 3);
  const livingDigit = Number((t.match(/(\d+)\s*厅/) || [])[1]);
  const livingCn = /三厅/.test(t) ? 3 : /两厅|二厅/.test(t) ? 2 : /一厅/.test(t) ? 1 : 0;
  const living =
    livingDigit || livingCn || (/客厅|餐厅|2厅/.test(t) ? 2 : 1);
  const areaRaw = t.match(/(\d+(?:\.\d+)?)\s*(?:平|㎡|m²|平方)/i);
  const areaM2 = areaRaw ? Number(areaRaw[1]) : null;
  return {
    bedrooms: Math.min(6, Math.max(1, bed)),
    living: Math.min(3, Math.max(1, living)),
    areaM2: areaM2 && areaM2 > 0 ? areaM2 : null,
  };
}

type Room = { name: string; x: number; y: number; w: number; h: number; areaHint: number };

function line(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  style = styleIn,
): Stroke {
  return { id: newStrokeId(), layerId: LAYER, kind: "line", x1, y1, x2, y2, style };
}

function rect(x: number, y: number, w: number, h: number, style = styleOut): Stroke {
  return { id: newStrokeId(), layerId: LAYER, kind: "rect", x, y, w, h, style };
}

function text(x: number, y: number, t: string, style = styleText): Stroke {
  return { id: newStrokeId(), layerId: LAYER, kind: "text", x, y, text: t, style };
}

function dim(x1: number, y1: number, x2: number, y2: number, label: string): Stroke {
  return {
    id: newStrokeId(),
    layerId: LAYER,
    kind: "dim",
    x1,
    y1,
    x2,
    y2,
    label,
    style: styleDim,
  };
}

/** 门洞：在墙上留缺口（两段线代替整墙）。 */
function wallWithDoor(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  doorAt: number,
  doorLen: number,
): Stroke[] {
  const horiz = Math.abs(y2 - y1) < 0.1;
  if (horiz) {
    const y = y1;
    const left = Math.min(x1, x2);
    const right = Math.max(x1, x2);
    const d0 = Math.max(left + 4, Math.min(right - doorLen - 4, left + (right - left) * doorAt));
    const d1 = d0 + doorLen;
    return [line(left, y, d0, y), line(d1, y, right, y)];
  }
  const x = x1;
  const top = Math.min(y1, y2);
  const bot = Math.max(y1, y2);
  const d0 = Math.max(top + 4, Math.min(bot - doorLen - 4, top + (bot - top) * doorAt));
  const d1 = d0 + doorLen;
  return [line(x, top, x, d0), line(x, d1, x, bot)];
}

/**
 * Duty: 按面积比例排布典型公寓（南厅北卧、厨卫侧置），返回分步图元组。
 */
export function buildFloorPlanStrokeGroups(userText: string): FloorPlanStrokeGroups {
  const hint = parseFloorHint(userText);
  const area = hint.areaM2 ?? hint.bedrooms * 18 + hint.living * 22 + 18;
  // 1:100：1m → 10mm；再 fit 到纸面可画区
  const aspect = 1.25;
  let realW = Math.sqrt(area * aspect);
  let realH = area / realW;
  let footW = realW * 10;
  let footH = realH * 10;
  const maxW = PAPER_W - MARGIN * 2;
  const maxH = PAPER_H - MARGIN * 2 - 18;
  const fit = Math.min(maxW / footW, maxH / footH, 1.85);
  footW *= fit;
  footH *= fit;
  const ox = MARGIN + (maxW - footW) / 2;
  const oy = MARGIN + 16 + (maxH - footH) / 2;

  const beds = hint.bedrooms;
  const livings = hint.living;

  // 纵向：南侧公区 ~42%，北侧卧室带 ~58%
  const southH = footH * 0.42;
  const northH = footH - southH;
  // 横向：东侧厨卫阳台条 ~22%
  const eastW = Math.min(footW * 0.24, 72);
  const mainW = footW - eastW;

  const rooms: Room[] = [];
  const shareLiving = area * 0.28;
  const shareDining = livings > 1 ? area * 0.12 : 0;
  const livingW = livings > 1 ? mainW * 0.62 : mainW;
  const diningW = mainW - livingW;

  rooms.push({
    name: "客厅",
    x: ox,
    y: oy + northH,
    w: livingW,
    h: southH,
    areaHint: Math.round(shareLiving),
  });
  if (livings > 1) {
    rooms.push({
      name: "餐厅",
      x: ox + livingW,
      y: oy + northH,
      w: diningW,
      h: southH * 0.55,
      areaHint: Math.round(shareDining || area * 0.1),
    });
  }

  const balH = southH * 0.45;
  rooms.push({
    name: "阳台",
    x: ox + mainW,
    y: oy + northH + southH - balH,
    w: eastW,
    h: balH,
    areaHint: Math.max(3, Math.round(area * 0.04)),
  });
  rooms.push({
    name: "厨房",
    x: ox + mainW,
    y: oy + northH,
    w: eastW,
    h: southH - balH,
    areaHint: Math.max(5, Math.round(area * 0.06)),
  });

  const bathW = eastW;
  const bathH = Math.min(northH * 0.38, 42);
  rooms.push({
    name: "卫生间",
    x: ox + mainW,
    y: oy,
    w: bathW,
    h: bathH,
    areaHint: Math.max(4, Math.round(area * 0.045)),
  });

  const bedBandW = mainW;
  const bedBandH = northH;
  const bedCols = beds <= 2 ? beds : beds <= 4 ? 2 : 3;
  const bedRows = Math.ceil(beds / bedCols);
  const cellW = bedBandW / bedCols;
  const cellH = bedBandH / bedRows;
  const bedShare = (area * 0.42) / beds;
  for (let i = 0; i < beds; i++) {
    const col = i % bedCols;
    const row = Math.floor(i / bedCols);
    const name = i === 0 ? "主卧" : `次卧${i}`;
    rooms.push({
      name,
      x: ox + col * cellW,
      y: oy + row * cellH,
      w: cellW,
      h: cellH,
      areaHint: Math.round(i === 0 ? bedShare * 1.15 : bedShare * 0.95),
    });
  }

  // —— 分步图元 ——
  const shell: Stroke[] = [
    rect(ox, oy, footW, footH, styleOut),
    dim(ox, oy + footH + 8, ox + footW, oy + footH + 8, `${realW.toFixed(1)}m`),
    dim(ox - 10, oy, ox - 10, oy + footH, `${realH.toFixed(1)}m`),
  ];

  const partitions: Stroke[] = [];
  // 南北分界（客厅与卧室）带门洞
  partitions.push(...wallWithDoor(ox, oy + northH, ox + mainW, oy + northH, 0.35, 12));
  // 公区与厨卫条
  partitions.push(...wallWithDoor(ox + mainW, oy, ox + mainW, oy + footH, 0.55, 10));
  // 厨 / 阳台
  partitions.push(line(ox + mainW, oy + northH + (southH - balH), ox + footW, oy + northH + (southH - balH)));
  // 卫南界
  partitions.push(line(ox + mainW, oy + bathH, ox + footW, oy + bathH));
  // 客厅 / 餐厅
  if (livings > 1) {
    partitions.push(...wallWithDoor(ox + livingW, oy + northH, ox + livingW, oy + footH, 0.4, 10));
    partitions.push(line(ox + livingW, oy + northH + southH * 0.55, ox + mainW, oy + northH + southH * 0.55));
  }
  // 卧室网格
  for (let c = 1; c < bedCols; c++) {
    const x = ox + c * cellW;
    partitions.push(...wallWithDoor(x, oy, x, oy + northH, 0.5, 9));
  }
  for (let r = 1; r < bedRows; r++) {
    const y = oy + r * cellH;
    partitions.push(...wallWithDoor(ox, y, ox + mainW, y, 0.4, 9));
  }

  const labels: Stroke[] = [];
  const title =
    hint.areaM2 != null
      ? `${hint.bedrooms}房${hint.living}厅 · 约 ${hint.areaM2}㎡ · 比例 1:100`
      : `${hint.bedrooms}房${hint.living}厅 · 约 ${Math.round(area)}㎡ · 比例 1:100`;
  labels.push(text(ox, oy - 12, title));
  for (const r of rooms) {
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    labels.push(text(cx - r.name.length * 5, cy - 8, r.name));
    labels.push(text(cx - 14, cy + 6, `约${r.areaHint}㎡`, styleDim));
  }

  const summary =
    hint.areaM2 != null
      ? `已按 ${hint.bedrooms}房${hint.living}厅约 ${hint.areaM2}㎡ 画在左侧草图，可继续拖改。`
      : `已按 ${hint.bedrooms}房${hint.living}厅画在左侧草图，可继续拖改。`;

  return {
    shell,
    partitions,
    labels,
    hint,
    paperW: PAPER_W,
    paperH: PAPER_H,
    layerId: LAYER,
    summary,
  };
}

function boardJson(strokes: Stroke[]): string {
  return JSON.stringify(
    {
      version: 5,
      paper: {
        w: PAPER_W,
        h: PAPER_H,
        unit: "mm",
        dpi: 96,
        scale: 100,
        bg: "#ffffff",
      },
      deskBg: "#64748b",
      layers: [{ id: LAYER, name: "图层 1", hidden: false, locked: false }],
      strokes,
    },
    null,
    2,
  );
}

/** Duty: 一次性生成完整 board JSON（兼容旧调用）。 */
export function buildSimpleFloorPlanBoardJson(userText: string): string {
  const g = buildFloorPlanStrokeGroups(userText);
  return boardJson([...g.shell, ...g.partitions, ...g.labels]);
}

/** Duty: 读取草图 board.json 的图元数量；无文件或无效时返回 0。 */
export async function countSketchStrokes(workspace: string): Promise<number> {
  try {
    const raw = await readCanvasText(workspace, `${CANVAS_DIRS.sketch}/board.json`);
    const parsed = JSON.parse(raw) as { strokes?: unknown };
    return Array.isArray(parsed.strokes) ? parsed.strokes.length : 0;
  } catch {
    return 0;
  }
}

/** Duty: 写入完整户型；返回图元数。 */
export async function writeSimpleFloorPlanBoard(
  workspace: string,
  userText: string,
): Promise<number> {
  await ensureCanvasDirs(workspace);
  const json = buildSimpleFloorPlanBoardJson(userText);
  const parsed = JSON.parse(json) as { strokes?: unknown[] };
  await writeCanvasText(workspace, `${CANVAS_DIRS.sketch}/board.json`, json);
  return Array.isArray(parsed.strokes) ? parsed.strokes.length : 0;
}

/** Duty: 写入指定累积 strokes（分步用）；转发公用 writeBoardStrokes。 */
export async function writeFloorPlanStrokes(
  workspace: string,
  strokes: Stroke[],
): Promise<number> {
  const { writeBoardStrokes } = await import("./drawRecipes/writeBoard");
  return writeBoardStrokes(workspace, strokes);
}
