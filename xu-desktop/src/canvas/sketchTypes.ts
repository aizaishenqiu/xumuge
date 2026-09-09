/**
 * @file sketchTypes.ts 草图画板图元类型
 * @author qiuye <yjk150@qq.com>
 * @date 2026-09-06
 * @updated 2026-09-08
 * @version 1.9.0
 * @category Cache
 * @algo sketch-stroke-schema
 */

/** 线性 / 径向双色渐变（旧稿仅 linear 仍可读）。 */
export type LinearFill = {
  type: "linear" | "radial";
  a: string;
  b: string;
  angle: number;
};

export type StrokeDash = "solid" | "dash" | "dot" | "dashdot";

export type StrokeStyle = {
  color: string;
  width: number;
  fill: string | LinearFill | null;
  opacity?: number;
  /** 轮廓线型 */
  dash?: StrokeDash;
  /** 文字字号（px），仅 text 使用 */
  fontSize?: number;
  /** 文字是否粗体 */
  fontBold?: boolean;
  /** 文字字体族 */
  fontFamily?: string;
  /** 矩形圆角半径（创建时写入 rect.rx） */
  cornerRadius?: number;
};

export type Pt = { x: number; y: number };

export type SketchLayer = { id: string; name: string; hidden?: boolean; locked?: boolean };

export type Stroke = {
  id: string;
  hidden?: boolean;
  layerId?: string;
  parentId?: string;
  style?: StrokeStyle;
  /** 视觉旋转角（度，顺时针）；矩形/椭圆/贴图/文字用 transform，线/折线仍改坐标 */
  rotation?: number;
} & (
  | { kind: "path"; d: string }
  | { kind: "line"; x1: number; y1: number; x2: number; y2: number }
  | { kind: "rect"; x: number; y: number; w: number; h: number; rx?: number }
  | { kind: "ellipse"; cx: number; cy: number; rx: number; ry: number }
  | { kind: "arrow"; x1: number; y1: number; x2: number; y2: number }
  | { kind: "text"; x: number; y: number; text: string }
  | { kind: "polygon"; points: Pt[] }
  | { kind: "curve"; points: Pt[] }
  | { kind: "dim"; x1: number; y1: number; x2: number; y2: number; label: string }
  | { kind: "image"; x: number; y: number; w: number; h: number; src: string }
  | { kind: "group"; children: string[] }
);

export const DEFAULT_STYLE: StrokeStyle = {
  color: "#1e293b",
  width: 2,
  fill: null,
  opacity: 1,
  dash: "solid",
  fontSize: 18,
  fontBold: false,
  fontFamily: "ui-sans-serif, system-ui, sans-serif",
};

/** Duty: 线型 → SVG stroke-dasharray（solid 返回 undefined）。 */
export function dashArrayOf(dash: StrokeDash | undefined, width = 2): string | undefined {
  const w = Math.max(1, width);
  switch (dash) {
    case "dash":
      return `${w * 4} ${w * 2}`;
    case "dot":
      return `${w} ${w * 2}`;
    case "dashdot":
      return `${w * 4} ${w * 2} ${w} ${w * 2}`;
    default:
      return undefined;
  }
}

/** Duty: 估算文字包围宽（CJK≈1em，其它≈0.55em；支持多行）。 */
export function estimateTextSize(text: string, fontSize: number): { w: number; h: number } {
  const fs = Math.max(1, fontSize);
  const lines = (text || " ").split("\n");
  let maxW = 0;
  for (const line of lines) {
    let w = 0;
    for (const ch of line) {
      w += /[\u3400-\u9fff\uf900-\ufaff]/.test(ch) ? fs : fs * 0.55;
    }
    maxW = Math.max(maxW, w);
  }
  return { w: Math.max(40, maxW), h: Math.max(fs * 1.2, lines.length * fs * 1.35) };
}

/** Duty: 是否为双色渐变填充（linear / radial）。 */
export function isLinearFill(f: StrokeStyle["fill"]): f is LinearFill {
  return !!f && typeof f === "object" && (f.type === "linear" || f.type === "radial");
}

/** Duty: 线性渐变在 objectBoundingBox 下的端点百分比（与导出一致）。 */
export function linearGradientEnds(angleDeg: number): { x1: string; y1: string; x2: string; y2: string } {
  const rad = ((Number(angleDeg) || 0) * Math.PI) / 180;
  const x2 = (50 + 50 * Math.cos(rad)).toFixed(1);
  const y2 = (50 + 50 * Math.sin(rad)).toFixed(1);
  return { x1: "0%", y1: "0%", x2: `${x2}%`, y2: `${y2}%` };
}

/** Duty: 生成单个图元的 SVG 渐变定义（无渐变则空串）。 */
export function gradientDefXml(id: string, fill: LinearFill): string {
  const esc = id.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
  if (fill.type === "radial") {
    return `<radialGradient id="g-${esc}" cx="50%" cy="50%" r="70%" fx="50%" fy="50%"><stop offset="0%" stop-color="${fill.a}"/><stop offset="100%" stop-color="${fill.b}"/></radialGradient>`;
  }
  const e = linearGradientEnds(fill.angle);
  return `<linearGradient id="g-${esc}" x1="${e.x1}" y1="${e.y1}" x2="${e.x2}" y2="${e.y2}"><stop offset="0%" stop-color="${fill.a}"/><stop offset="100%" stop-color="${fill.b}"/></linearGradient>`;
}

/** Duty: SVG fill 属性（纯色）。渐变由调用方写 url(#id)。 */
export function solidFillAttr(f: StrokeStyle["fill"]): string {
  if (!f || isLinearFill(f)) return "none";
  return f;
}

/** Duty: 读取描边样式，缺省与旧 board.json 兼容。 */
export function styleOf(s: Stroke): StrokeStyle {
  return { ...DEFAULT_STYLE, ...s.style };
}

let seq = 0;

/** Duty: 生成图元 id。 */
export function newStrokeId(): string {
  seq += 1;
  return `s_${Date.now().toString(36)}_${seq}`;
}

/** Duty: 把旧 board.json 图元补上 id。 */
export function normalizeStrokes(raw: unknown): Stroke[] {
  if (!raw || typeof raw !== "object") return [];
  const list = (raw as { strokes?: unknown }).strokes;
  if (!Array.isArray(list)) return [];
  return list
    .filter((x) => x && typeof x === "object")
    .map((item) => {
      const s = item as Stroke;
      const id = String((s as { id?: string }).id || "").trim() || newStrokeId();
      return { ...s, id };
    });
}

/** Duty: 平移单个图元（group 壳不改几何）。 */
export function translateStroke(s: Stroke, dx: number, dy: number): Stroke {
  switch (s.kind) {
    case "path": {
      let i = 0;
      const d = s.d.replace(/-?\d+(?:\.\d+)?/g, (n) => {
        const v = Number(n);
        const out = i % 2 === 0 ? v + dx : v + dy;
        i += 1;
        return String(out);
      });
      return { ...s, d };
    }
    case "line":
    case "arrow":
    case "dim":
      return { ...s, x1: s.x1 + dx, y1: s.y1 + dy, x2: s.x2 + dx, y2: s.y2 + dy };
    case "rect":
    case "image":
      return { ...s, x: s.x + dx, y: s.y + dy };
    case "ellipse":
      return { ...s, cx: s.cx + dx, cy: s.cy + dy };
    case "text":
      return { ...s, x: s.x + dx, y: s.y + dy };
    case "polygon":
    case "curve":
      return { ...s, points: s.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) };
    case "group":
      return s;
    default:
      return s;
  }
}

/** Duty: 平移选中集合（含 group 子项）。 */
export function translateSelection(list: Stroke[], ids: string[], dx: number, dy: number): Stroke[] {
  const move = new Set<string>();
  const byId = new Map(list.map((s) => [s.id, s]));
  for (const id of ids) {
    move.add(id);
    const s = byId.get(id);
    if (s?.kind === "group") for (const c of s.children) move.add(c);
  }
  return list.map((s) => (move.has(s.id) && s.kind !== "group" ? translateStroke(s, dx, dy) : s));
}

const MIN_ABS_SCALE = 0.05;

function clampScale(n: number): number {
  if (!Number.isFinite(n) || n === 0) return MIN_ABS_SCALE;
  return Math.abs(n) < MIN_ABS_SCALE ? (n < 0 ? -MIN_ABS_SCALE : MIN_ABS_SCALE) : n;
}

function scalePt(x: number, y: number, ox: number, oy: number, sx: number, sy: number): Pt {
  return { x: ox + (x - ox) * sx, y: oy + (y - oy) * sy };
}

/** Duty: 相对锚点缩放单个图元（group 壳不改几何）。 */
export function scaleStroke(s: Stroke, origin: Pt, sx: number, sy: number): Stroke {
  sx = clampScale(sx);
  sy = clampScale(sy);
  const ox = origin.x;
  const oy = origin.y;
  const sp = (x: number, y: number) => scalePt(x, y, ox, oy, sx, sy);
  switch (s.kind) {
    case "path": {
      let i = 0;
      const d = s.d.replace(/-?\d+(?:\.\d+)?/g, (n) => {
        const v = Number(n);
        const out = i % 2 === 0 ? ox + (v - ox) * sx : oy + (v - oy) * sy;
        i += 1;
        return String(out);
      });
      return { ...s, d };
    }
    case "line":
    case "arrow":
    case "dim": {
      const a = sp(s.x1, s.y1);
      const b = sp(s.x2, s.y2);
      return { ...s, x1: a.x, y1: a.y, x2: b.x, y2: b.y };
    }
    case "rect":
    case "image": {
      const p = sp(s.x, s.y);
      const q = sp(s.x + s.w, s.y + s.h);
      return {
        ...s,
        x: Math.min(p.x, q.x),
        y: Math.min(p.y, q.y),
        w: Math.abs(q.x - p.x),
        h: Math.abs(q.y - p.y),
      };
    }
    case "ellipse": {
      const c = sp(s.cx, s.cy);
      return { ...s, cx: c.x, cy: c.y, rx: Math.abs(s.rx * sx), ry: Math.abs(s.ry * sy) };
    }
    case "text": {
      const p = sp(s.x, s.y);
      const fs0 = typeof s.style?.fontSize === "number" ? s.style.fontSize : 18;
      const scale = Math.max(Math.abs(sx), Math.abs(sy));
      const fontSize = Math.max(8, Math.min(400, fs0 * scale));
      return { ...s, x: p.x, y: p.y, style: { ...s.style, fontSize, color: s.style?.color, width: s.style?.width ?? 2, fill: s.style?.fill ?? null } };
    }
    case "polygon":
    case "curve":
      return { ...s, points: s.points.map((p) => sp(p.x, p.y)) };
    case "group":
      return s;
    default:
      return s;
  }
}

/** Duty: 相对锚点缩放选中集合（含 group 子项）。 */
export function scaleSelection(list: Stroke[], ids: string[], origin: Pt, sx: number, sy: number): Stroke[] {
  const move = new Set<string>();
  const byId = new Map(list.map((s) => [s.id, s]));
  for (const id of ids) {
    move.add(id);
    const s = byId.get(id);
    if (s?.kind === "group") for (const c of s.children) move.add(c);
  }
  return list.map((s) => (move.has(s.id) && s.kind !== "group" ? scaleStroke(s, origin, sx, sy) : s));
}

/** Duty: 平滑折线转 SVG path。 */
export function curveToPath(points: Pt[]): string {
  if (!points.length) return "";
  if (points.length === 1) return `M ${points[0]!.x} ${points[0]!.y}`;
  let d = `M ${points[0]!.x} ${points[0]!.y}`;
  for (let i = 1; i < points.length; i++) {
    const p0 = points[i - 1]!;
    const p1 = points[i]!;
    const mx = (p0.x + p1.x) / 2;
    const my = (p0.y + p1.y) / 2;
    d += ` Q ${p0.x} ${p0.y} ${mx} ${my}`;
  }
  const last = points[points.length - 1]!;
  d += ` T ${last.x} ${last.y}`;
  return d;
}

export type BBox = { x: number; y: number; w: number; h: number };

function expandRotatedBBox(b: BBox, rotationDeg: number): BBox {
  if (!rotationDeg || !Number.isFinite(rotationDeg)) return b;
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  const rad = (-rotationDeg * Math.PI) / 180;
  const corners = [
    rotDeg(b.x, b.y, cx, cy, rad),
    rotDeg(b.x + b.w, b.y, cx, cy, rad),
    rotDeg(b.x + b.w, b.y + b.h, cx, cy, rad),
    rotDeg(b.x, b.y + b.h, cx, cy, rad),
  ];
  const xs = corners.map((p) => p.x);
  const ys = corners.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/** Duty: 图元局部包围盒（未计 rotation 字段）。 */
export function strokeLocalBBox(s: Stroke): BBox {
  switch (s.kind) {
    case "rect":
    case "image":
      return { x: s.x, y: s.y, w: s.w, h: s.h };
    case "ellipse":
      return { x: s.cx - s.rx, y: s.cy - s.ry, w: s.rx * 2, h: s.ry * 2 };
    case "text": {
      const fs = styleOf(s).fontSize ?? 18;
      const { w, h } = estimateTextSize(s.text || "", fs);
      return { x: s.x, y: s.y - fs, w, h };
    }
    case "line":
    case "arrow":
    case "dim": {
      const x = Math.min(s.x1, s.x2);
      const y = Math.min(s.y1, s.y2);
      return { x, y, w: Math.abs(s.x2 - s.x1), h: Math.abs(s.y2 - s.y1) };
    }
    case "polygon":
    case "curve": {
      const xs = s.points.map((p) => p.x);
      const ys = s.points.map((p) => p.y);
      const x = Math.min(...xs);
      const y = Math.min(...ys);
      return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
    }
    case "path": {
      const nums = s.d.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
      const xs: number[] = [];
      const ys: number[] = [];
      for (let i = 0; i + 1 < nums.length; i += 2) {
        xs.push(nums[i]!);
        ys.push(nums[i + 1]!);
      }
      if (!xs.length) return { x: 0, y: 0, w: 0, h: 0 };
      const x = Math.min(...xs);
      const y = Math.min(...ys);
      return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
    }
    case "group":
      return { x: 0, y: 0, w: 0, h: 0 };
    default:
      return { x: 0, y: 0, w: 0, h: 0 };
  }
}

/** Duty: 图元包围盒（含 rotation 后的轴对齐外接框）。 */
export function strokeBBox(s: Stroke): BBox {
  const local = strokeLocalBBox(s);
  if (
    s.kind === "rect" ||
    s.kind === "image" ||
    s.kind === "ellipse" ||
    s.kind === "text"
  ) {
    return expandRotatedBBox(local, s.rotation ?? 0);
  }
  return local;
}

/** Duty: SVG transform（仅矩形系图元存 rotation 时）。 */
export function strokeSvgTransform(s: Stroke): string | undefined {
  const rot = s.rotation;
  if (!rot || !Number.isFinite(rot)) return undefined;
  if (s.kind === "rect" || s.kind === "image") {
    return `rotate(${rot} ${s.x + s.w / 2} ${s.y + s.h / 2})`;
  }
  if (s.kind === "ellipse") {
    return `rotate(${rot} ${s.cx} ${s.cy})`;
  }
  if (s.kind === "text") {
    const b = strokeLocalBBox(s);
    return `rotate(${rot} ${b.x + b.w / 2} ${b.y + b.h / 2})`;
  }
  return undefined;
}

/** Duty: 把点从世界坐标逆旋转到图元局部（命中用）。 */
export function worldToStrokeLocal(s: Stroke, p: Pt): Pt {
  const rot = s.rotation;
  if (
    !rot ||
    !(s.kind === "rect" || s.kind === "image" || s.kind === "ellipse" || s.kind === "text")
  ) {
    return p;
  }
  const b = strokeLocalBBox(s);
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  const rad = (rot * Math.PI) / 180;
  return rotDeg(p.x, p.y, cx, cy, rad);
}

/** Duty: group 或其子项的包围盒。 */
export function groupBBox(list: Stroke[], g: Stroke): BBox {
  if (g.kind !== "group") return strokeBBox(g);
  const kids = list.filter((s) => g.children.includes(s.id));
  return unionBBox(kids);
}

function rotDeg(x: number, y: number, cx: number, cy: number, rad: number): Pt {
  const dx = x - cx;
  const dy = y - cy;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return { x: cx + dx * c - dy * s, y: cy + dx * s + dy * c };
}

/** Duty: 绕点旋转任意角度（度，顺时针为正相对屏幕坐标：数学角取负）。 */
export function rotateStrokeDeg(s: Stroke, degrees: number, origin?: Pt): Stroke {
  if (s.kind === "group" || !Number.isFinite(degrees) || degrees === 0) return s;
  const b = strokeBBox(s);
  const cx = origin?.x ?? b.x + b.w / 2;
  const cy = origin?.y ?? b.y + b.h / 2;
  const rad = (-degrees * Math.PI) / 180;
  const rp = (x: number, y: number) => rotDeg(x, y, cx, cy, rad);
  switch (s.kind) {
    case "rect":
    case "image": {
      const mid = rp(s.x + s.w / 2, s.y + s.h / 2);
      return {
        ...s,
        x: mid.x - s.w / 2,
        y: mid.y - s.h / 2,
        rotation: (s.rotation ?? 0) + degrees,
      };
    }
    case "ellipse": {
      const mid = rp(s.cx, s.cy);
      return {
        ...s,
        cx: mid.x,
        cy: mid.y,
        rotation: (s.rotation ?? 0) + degrees,
      };
    }
    case "line":
    case "arrow":
    case "dim": {
      const a = rp(s.x1, s.y1);
      const b2 = rp(s.x2, s.y2);
      return { ...s, x1: a.x, y1: a.y, x2: b2.x, y2: b2.y };
    }
    case "text": {
      const local = strokeLocalBBox(s);
      const mid = rp(local.x + local.w / 2, local.y + local.h / 2);
      const fs = styleOf(s).fontSize ?? 18;
      return {
        ...s,
        x: mid.x - local.w / 2,
        y: mid.y - local.h / 2 + fs,
        rotation: (s.rotation ?? 0) + degrees,
      };
    }
    case "polygon":
    case "curve":
      return { ...s, points: s.points.map((p) => rp(p.x, p.y)) };
    case "path": {
      const nums = s.d.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
      const pts: Pt[] = [];
      for (let i = 0; i + 1 < nums.length; i += 2) {
        pts.push(rp(nums[i]!, nums[i + 1]!));
      }
      if (!pts.length) return s;
      const d = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
      return { ...s, d };
    }
    default:
      return s;
  }
}

/** Duty: 绕包围盒中心顺时针旋转 90°。 */
export function rotateStroke90(s: Stroke): Stroke {
  return rotateStrokeDeg(s, 90);
}

/** Duty: 旋转选中集合（含 group 子项）。 */
export function rotateSelection(list: Stroke[], ids: string[], degrees: number): Stroke[] {
  const expanded = expandSelection(list, ids).filter((s) => s.kind !== "group");
  if (!expanded.length || !Number.isFinite(degrees) || degrees === 0) return list;
  const box = unionBBox(expanded);
  const origin = { x: box.x + box.w / 2, y: box.y + box.h / 2 };
  const move = new Set(expanded.map((s) => s.id));
  return list.map((s) => (move.has(s.id) ? rotateStrokeDeg(s, degrees, origin) : s));
}

/** Duty: 相对选区中心水平或垂直镜像。 */
export function mirrorSelection(list: Stroke[], ids: string[], axis: "h" | "v"): Stroke[] {
  const expanded = expandSelection(list, ids).filter((s) => s.kind !== "group");
  if (!expanded.length) return list;
  const box = unionBBox(expanded);
  const origin = { x: box.x + box.w / 2, y: box.y + box.h / 2 };
  return scaleSelection(list, ids, origin, axis === "h" ? -1 : 1, axis === "v" ? -1 : 1);
}

/** Duty: 更新曲线/多边形节点。 */
export function setStrokePoint(s: Stroke, index: number, pt: Pt): Stroke {
  if (s.kind !== "curve" && s.kind !== "polygon") return s;
  if (index < 0 || index >= s.points.length) return s;
  const points = s.points.map((p, i) => (i === index ? { x: pt.x, y: pt.y } : p));
  return { ...s, points };
}

/** Duty: CDR 式正多边形顶点（默认顶朝上）。 */
export function regularPolygonPoints(
  cx: number,
  cy: number,
  r: number,
  sides: number,
  rotationDeg = -90,
): Pt[] {
  const n = Math.max(3, Math.min(24, Math.round(sides) || 5));
  const radius = Math.max(0, r);
  const rad0 = (rotationDeg * Math.PI) / 180;
  const pts: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = rad0 + (Math.PI * 2 * i) / n;
    pts.push({ x: cx + radius * Math.cos(a), y: cy + radius * Math.sin(a) });
  }
  return pts;
}

/** Duty: 折线合拢——若首尾未重合则接回起点。 */
export function ensureClosedPoints(points: Pt[]): Pt[] {
  if (points.length < 3) return points;
  const a = points[0]!;
  const b = points[points.length - 1]!;
  if (Math.hypot(a.x - b.x, a.y - b.y) < 0.5) return points;
  return [...points, { x: a.x, y: a.y }];
}

/** 与 Agent `canvas_add_strokes` 默认 layerId 对齐 */
export const DEFAULT_LAYER_ID = "ly1";

/** Duty: 缺省图层。 */
export function defaultLayers(): SketchLayer[] {
  return [{ id: DEFAULT_LAYER_ID, name: "图层 1" }];
}

/** Duty: 生成图层 id。 */
export function newLayerId(): string {
  seq += 1;
  return `ly_${Date.now().toString(36)}_${seq}`;
}

/** Duty: 解析 board.json 的 layers。 */
export function parseLayers(raw: unknown): SketchLayer[] {
  if (!Array.isArray(raw)) return defaultLayers();
  const list = raw
    .filter((x) => x && typeof x === "object")
    .map((item) => {
      const o = item as { id?: unknown; name?: unknown; hidden?: unknown; locked?: unknown };
      const id = String(o.id || "").trim() || newLayerId();
      const name = String(o.name || "").trim() || "图层";
      return { id, name, hidden: !!o.hidden, locked: !!o.locked };
    });
  return list.length ? list : defaultLayers();
}

/** Duty: 图元挂到存在的图层。 */
export function ensureStrokeLayers(list: Stroke[], layers: SketchLayer[]): Stroke[] {
  const first = layers[0]?.id ?? DEFAULT_LAYER_ID;
  const ids = new Set(layers.map((l) => l.id));
  return list.map((s) => ({
    ...s,
    layerId: s.layerId && ids.has(s.layerId) ? s.layerId : first,
  }));
}

/** Duty: 过小草稿不落盘。 */
export function isTinyStroke(s: Stroke): boolean {
  if (s.kind === "group") return false;
  if (s.kind === "line" || s.kind === "arrow" || s.kind === "dim") {
    return Math.hypot(s.x2 - s.x1, s.y2 - s.y1) < 2;
  }
  if (s.kind === "ellipse") return s.rx < 1 && s.ry < 1;
  const b = strokeBBox(s);
  return b.w < 2 && b.h < 2;
}

/** Duty: 多个图元的包围盒。 */
export function unionBBox(list: Stroke[]): BBox {
  if (!list.length) return { x: 0, y: 0, w: 0, h: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const s of list) {
    if (s.kind === "group") continue;
    const b = strokeBBox(s);
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w);
    maxY = Math.max(maxY, b.y + b.h);
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export type AlignDir = "l" | "cx" | "r" | "t" | "cy" | "b";
export type AlignRelative = "selection" | "page";

/** Duty: 对齐选中图元；relative 控制相对选区或页面。 */
export function alignStrokes(
  list: Stroke[],
  ids: string[],
  dir: AlignDir,
  page: { w: number; h: number },
  relative: AlignRelative = "selection",
): Stroke[] {
  const idset = new Set(ids);
  const sel = list.filter((s) => idset.has(s.id) && s.kind !== "group");
  const expanded = expandSelection(list, ids).filter((s) => s.kind !== "group");
  if (!expanded.length) return list;
  let frame: BBox;
  if (relative === "page" || expanded.length === 1) {
    frame = { x: 0, y: 0, w: page.w, h: page.h };
  } else {
    frame = unionBBox(expanded);
  }
  if (relative === "selection" && sel.length === 1) return list;
  const moveIds = new Set(expanded.map((s) => s.id));
  return list.map((s) => {
    if (!moveIds.has(s.id) || s.kind === "group") return s;
    const b = strokeBBox(s);
    let dx = 0;
    let dy = 0;
    if (dir === "l") dx = frame.x - b.x;
    if (dir === "r") dx = frame.x + frame.w - (b.x + b.w);
    if (dir === "cx") dx = frame.x + frame.w / 2 - (b.x + b.w / 2);
    if (dir === "t") dy = frame.y - b.y;
    if (dir === "b") dy = frame.y + frame.h - (b.y + b.h);
    if (dir === "cy") dy = frame.y + frame.h / 2 - (b.y + b.h / 2);
    return translateStroke(s, dx, dy);
  });
}

/** Duty: 展开选中（group → 子 id）。 */
export function expandSelection(list: Stroke[], ids: string[]): Stroke[] {
  const byId = new Map(list.map((s) => [s.id, s]));
  const out = new Map<string, Stroke>();
  for (const id of ids) {
    const s = byId.get(id);
    if (!s) continue;
    if (s.kind === "group") {
      out.set(s.id, s);
      for (const c of s.children) {
        const kid = byId.get(c);
        if (kid) out.set(kid.id, kid);
      }
    } else out.set(s.id, s);
  }
  return [...out.values()];
}

/** Duty: 沿轴均分中心（至少 3 个）。 */
export function distributeStrokes(list: Stroke[], ids: string[], axis: "h" | "v"): Stroke[] {
  const expanded = expandSelection(list, ids).filter((s) => s.kind !== "group");
  const keyed = expanded.map((s) => ({ s, b: strokeBBox(s) }));
  if (keyed.length < 3) return list;
  keyed.sort((a, b) =>
    axis === "h" ? a.b.x + a.b.w / 2 - (b.b.x + b.b.w / 2) : a.b.y + a.b.h / 2 - (b.b.y + b.b.h / 2),
  );
  const first = keyed[0]!;
  const last = keyed[keyed.length - 1]!;
  const c0 = axis === "h" ? first.b.x + first.b.w / 2 : first.b.y + first.b.h / 2;
  const c1 = axis === "h" ? last.b.x + last.b.w / 2 : last.b.y + last.b.h / 2;
  const step = (c1 - c0) / (keyed.length - 1);
  const delta = new Map<string, { dx: number; dy: number }>();
  keyed.forEach((item, i) => {
    const target = c0 + step * i;
    const cur = axis === "h" ? item.b.x + item.b.w / 2 : item.b.y + item.b.h / 2;
    const d = target - cur;
    delta.set(item.s.id, axis === "h" ? { dx: d, dy: 0 } : { dx: 0, dy: d });
  });
  return list.map((s) => {
    const d = delta.get(s.id);
    return d ? translateStroke(s, d.dx, d.dy) : s;
  });
}

/** Duty: 组合选中图元。 */
export function groupStrokes(list: Stroke[], ids: string[], layerId: string): { next: Stroke[]; groupId: string } | null {
  const tops = ids.filter((id) => {
    const s = list.find((x) => x.id === id);
    return s && !s.parentId && s.kind !== "group";
  });
  const alsoGroups = ids.filter((id) => list.find((x) => x.id === id)?.kind === "group");
  const childIds = [...tops, ...alsoGroups.flatMap((gid) => {
    const g = list.find((x) => x.id === gid);
    return g?.kind === "group" ? g.children : [];
  })];
  const unique = [...new Set(childIds)];
  if (unique.length < 2) return null;
  const gid = newStrokeId();
  let next = list
    .filter((s) => !(s.kind === "group" && alsoGroups.includes(s.id)))
    .map((s) => (unique.includes(s.id) ? { ...s, parentId: gid } : s));
  next = [
    ...next,
    { id: gid, kind: "group", children: unique, layerId, style: { ...DEFAULT_STYLE } },
  ];
  return { next, groupId: gid };
}

/** Duty: 打散组合。 */
export function ungroupStrokes(list: Stroke[], ids: string[]): Stroke[] {
  const groups = list.filter((s) => ids.includes(s.id) && s.kind === "group");
  if (!groups.length) return list;
  const gids = new Set(groups.map((g) => g.id));
  const kids = new Set(groups.flatMap((g) => (g.kind === "group" ? g.children : [])));
  return list
    .filter((s) => !gids.has(s.id))
    .map((s) => (kids.has(s.id) ? { ...s, parentId: undefined } : s));
}

/** Duty: 调整图元在数组中的 z 序。 */
export function reorderStroke(list: Stroke[], id: string, mode: "front" | "back" | "up" | "down"): Stroke[] {
  const i = list.findIndex((s) => s.id === id);
  if (i < 0) return list;
  const next = [...list];
  const [item] = next.splice(i, 1);
  if (!item) return list;
  if (mode === "front") next.push(item);
  else if (mode === "back") next.unshift(item);
  else if (mode === "up") next.splice(Math.min(i + 1, next.length), 0, item);
  else next.splice(Math.max(i - 1, 0), 0, item);
  return next;
}
