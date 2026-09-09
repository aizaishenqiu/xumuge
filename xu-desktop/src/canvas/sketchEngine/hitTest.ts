/**
 * @file hitTest.ts 草图图元命中检测
 * @author qiuye <yjk150@qq.com>
 * @updated 2026-09-07
 * @version 1.1.0
 * @category Cache
 * @algo sketch-hit-test
 */

import { groupBBox, strokeBBox, strokeLocalBBox, worldToStrokeLocal, type SketchLayer, type Stroke } from "../sketchTypes";

/** Duty: 图层是否隐藏。 */
export function layerHidden(layers: SketchLayer[], layerId: string | undefined): boolean {
  const ly = layers.find((l) => l.id === layerId);
  return !!ly?.hidden;
}

/** Duty: 图层是否锁定。 */
export function layerLocked(layers: SketchLayer[], layerId: string | undefined): boolean {
  const ly = layers.find((l) => l.id === layerId);
  return !!ly?.locked;
}

/**
 * Duty: 自顶向下命中图元下标；跳过隐藏/锁定；默认仅当前层。
 * @param allVisibleLayers 选择工具为 true 时命中所有可见未锁定图层（CDR 习惯）
 * @returns 命中下标，未命中 -1
 */
export function hitTestStroke(
  strokes: Stroke[],
  layers: SketchLayer[],
  activeLayerId: string,
  p: { x: number; y: number },
  tol = 8,
  allVisibleLayers = false,
): number {
  for (let i = strokes.length - 1; i >= 0; i--) {
    const s = strokes[i]!;
    if (s.hidden || layerHidden(layers, s.layerId) || layerLocked(layers, s.layerId)) continue;
    const lid = s.layerId || activeLayerId;
    if (!allVisibleLayers && lid !== activeLayerId) continue;
    if (s.kind === "group") {
      const b = groupBBox(strokes, s);
      if (p.x >= b.x - tol && p.x <= b.x + b.w + tol && p.y >= b.y - tol && p.y <= b.y + b.h + tol) return i;
      continue;
    }
    if (s.parentId) continue;
    const sw = typeof s.style?.width === "number" ? s.style.width : 2;
    const hitTol = tol + Math.max(0, sw / 2);
    if (s.kind === "rect" || s.kind === "image") {
      const lp = worldToStrokeLocal(s, p);
      if (
        lp.x >= s.x - hitTol &&
        lp.x <= s.x + s.w + hitTol &&
        lp.y >= s.y - hitTol &&
        lp.y <= s.y + s.h + hitTol
      ) {
        return i;
      }
    } else if (s.kind === "ellipse") {
      const lp = worldToStrokeLocal(s, p);
      const dx = (lp.x - s.cx) / Math.max(s.rx, 1);
      const dy = (lp.y - s.cy) / Math.max(s.ry, 1);
      if (dx * dx + dy * dy <= 1.15) return i;
    } else if (s.kind === "text") {
      const lp = worldToStrokeLocal(s, p);
      const b = strokeLocalBBox(s);
      if (
        lp.x >= b.x - hitTol &&
        lp.x <= b.x + b.w + hitTol &&
        lp.y >= b.y - hitTol &&
        lp.y <= b.y + b.h + hitTol
      ) {
        return i;
      }
    } else if (s.kind === "polygon" || s.kind === "curve") {
      const xs = s.points.map((q) => q.x);
      const ys = s.points.map((q) => q.y);
      if (!xs.length) continue;
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);
      const curveTol = s.kind === "curve" ? Math.max(hitTol, sw / 2 + 10) : hitTol;
      if (p.x >= minX - curveTol && p.x <= maxX + curveTol && p.y >= minY - curveTol && p.y <= maxY + curveTol) {
        if (s.kind === "curve" && s.points.length >= 2) {
          let near = false;
          for (let k = 1; k < s.points.length; k++) {
            const a = s.points[k - 1]!;
            const b = s.points[k]!;
            const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
            const t = Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / (len * len)));
            const qx = a.x + t * (b.x - a.x);
            const qy = a.y + t * (b.y - a.y);
            if (Math.hypot(p.x - qx, p.y - qy) <= curveTol) {
              near = true;
              break;
            }
          }
          if (near || s.points.length < 2) return i;
          // 空心笔迹：点在包围盒内也算命中，便于选中后拉伸
          return i;
        }
        return i;
      }
    } else if (s.kind === "path") {
      const nums = s.d.match(/-?\d+(\.\d+)?/g)?.map(Number) ?? [];
      for (let k = 0; k + 1 < nums.length; k += 2) {
        if (Math.hypot(p.x - nums[k]!, p.y - nums[k + 1]!) < hitTol + 4) return i;
      }
    } else if (s.kind === "line" || s.kind === "arrow" || s.kind === "dim") {
      const len = Math.hypot(s.x2 - s.x1, s.y2 - s.y1) || 1;
      const t = Math.max(
        0,
        Math.min(1, ((p.x - s.x1) * (s.x2 - s.x1) + (p.y - s.y1) * (s.y2 - s.y1)) / (len * len)),
      );
      const px = s.x1 + t * (s.x2 - s.x1);
      const py = s.y1 + t * (s.y2 - s.y1);
      if (Math.hypot(p.x - px, p.y - py) < hitTol) return i;
    }
  }
  return -1;
}
