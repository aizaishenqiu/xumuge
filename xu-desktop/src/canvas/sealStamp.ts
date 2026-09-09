/**
 * @file sealStamp.ts 草图制章模板（圆环绕字 + 中心星/字）
 * @author qiuye <yjk150@qq.com>
 * @date 2026-09-08
 * @version 1.0.0
 * @category Cache
 * @algo seal-ring-text-star
 */
import { newStrokeId, type Stroke, type StrokeStyle } from "./sketchTypes";

export const SEAL_DEFAULT_COLOR = "#c41e3a";

export type SealStampOpts = {
  /** 外圈环绕文字 */
  ringText: string;
  /** 中心文字（与五角星二选一；有字则优先字） */
  centerText?: string;
  /** 是否画中心五角星（无中心文字时默认 true） */
  centerStar?: boolean;
  /** 直径（纸面像素） */
  diameter: number;
  /** 章色 */
  color?: string;
  /** 圆心 */
  cx: number;
  cy: number;
  layerId: string;
};

/** Duty: 五角星顶点（外尖 + 内凹）。 */
export function starPolygonPoints(
  cx: number,
  cy: number,
  outerR: number,
  innerR: number,
  tips = 5,
): { x: number; y: number }[] {
  const n = Math.max(3, Math.min(12, Math.round(tips) || 5));
  const pts: { x: number; y: number }[] = [];
  const start = -Math.PI / 2;
  for (let i = 0; i < n * 2; i++) {
    const r = i % 2 === 0 ? outerR : innerR;
    const a = start + (Math.PI * i) / n;
    pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  return pts;
}

/**
 * Duty: 生成印章图元（外圆 + 环字 + 中心星/字）。
 * 环字按角度均分，每字独立 text + rotation。
 */
export function buildSealStrokes(opts: SealStampOpts): Stroke[] {
  const color = (opts.color || SEAL_DEFAULT_COLOR).trim() || SEAL_DEFAULT_COLOR;
  const diameter = Math.max(40, Math.min(2000, Number(opts.diameter) || 160));
  const r = diameter / 2;
  const { cx, cy, layerId } = opts;
  const ring = String(opts.ringText || "")
    .replace(/\s+/g, "")
    .slice(0, 48);
  const centerText = String(opts.centerText || "").trim().slice(0, 8);
  const wantStar = centerText ? false : opts.centerStar !== false;

  const strokeW = Math.max(2, Math.round(diameter * 0.035));
  const baseStyle: StrokeStyle = {
    color,
    width: strokeW,
    fill: null,
    opacity: 1,
    dash: "solid",
  };

  const out: Stroke[] = [];

  out.push({
    id: newStrokeId(),
    layerId,
    kind: "ellipse",
    cx,
    cy,
    rx: r,
    ry: r,
    style: { ...baseStyle, fill: "rgba(196, 30, 58, 0.04)" },
  });

  // 内细圈（略小）
  const innerR = r * 0.82;
  out.push({
    id: newStrokeId(),
    layerId,
    kind: "ellipse",
    cx,
    cy,
    rx: innerR,
    ry: innerR,
    style: { ...baseStyle, width: Math.max(1, strokeW * 0.55), fill: null },
  });

  if (ring.length) {
    const textR = r * 0.9;
    const fontSize = Math.max(10, Math.min(36, Math.round(diameter * 0.11)));
    const n = ring.length;
    for (let i = 0; i < n; i++) {
      const ch = ring[i]!;
      // 自顶顺时针均分
      const a = -Math.PI / 2 + (Math.PI * 2 * i) / n;
      const x = cx + textR * Math.cos(a);
      const y = cy + textR * Math.sin(a);
      // 字朝外，基线沿切向
      const rotation = (a * 180) / Math.PI + 90;
      out.push({
        id: newStrokeId(),
        layerId,
        kind: "text",
        x: x - fontSize * 0.45,
        y: y + fontSize * 0.35,
        text: ch,
        rotation,
        style: {
          ...baseStyle,
          width: 1,
          fill: null,
          fontSize,
          fontBold: true,
          fontFamily: "SimSun, Songti SC, serif",
          color,
        },
      });
    }
  }

  if (centerText) {
    const fs = Math.max(14, Math.min(56, Math.round(diameter * 0.22)));
    const estW = centerText.length * fs * 0.9;
    out.push({
      id: newStrokeId(),
      layerId,
      kind: "text",
      x: cx - estW / 2,
      y: cy + fs * 0.35,
      text: centerText,
      style: {
        ...baseStyle,
        width: 1,
        fill: null,
        fontSize: fs,
        fontBold: true,
        fontFamily: "SimSun, Songti SC, serif",
        color,
      },
    });
  } else if (wantStar) {
    const outer = r * 0.32;
    const inner = outer * 0.42;
    out.push({
      id: newStrokeId(),
      layerId,
      kind: "polygon",
      points: starPolygonPoints(cx, cy, outer, inner, 5),
      style: { ...baseStyle, width: Math.max(1, strokeW * 0.6), fill: color },
    });
  }

  return out;
}
