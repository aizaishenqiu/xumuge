/**
 * @file coords.ts 纸面坐标与吸附
 * @author qiuye <yjk150@qq.com>
 * @updated 2026-09-07
 * @version 1.1.0
 * @category Cache
 * @algo sketch-paper-coords
 */

import { snapToGuides, type Guides } from "../sketchRuler";
import type { Pt } from "../sketchTypes";

/** Duty: 客户端坐标 → SVG 纸面坐标（优先 CTM）。 */
export function clientToPaper(
  clientX: number,
  clientY: number,
  svg: SVGSVGElement | null,
  paperEl: HTMLElement | null,
  pageW: number,
): Pt {
  if (svg) {
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const ctm = svg.getScreenCTM();
    if (ctm) {
      const loc = pt.matrixTransform(ctm.inverse());
      return { x: loc.x, y: loc.y };
    }
  }
  if (!paperEl) return { x: 0, y: 0 };
  const r = paperEl.getBoundingClientRect();
  const z = r.width / Math.max(pageW, 1);
  if (z <= 0) return { x: 0, y: 0 };
  return { x: (clientX - r.left) / z, y: (clientY - r.top) / z };
}

/** Duty: 网格吸附。 */
export function snapGrid(n: number, enable: boolean, gridPx: number): number {
  if (!enable || gridPx <= 0) return n;
  return Math.round(n / gridPx) * gridPx;
}

/** Duty: 参考线 + 网格 + 可选对象边/中点吸附。 */
export function snapPaperPt(
  p: Pt,
  opts: {
    snapGridOn: boolean;
    snapGuideOn: boolean;
    gridPx: number;
    guides: Guides;
    zoomLike: number;
    /** 对象吸附候选点（边中点、角点、圆心等） */
    objectSnapPts?: Pt[];
    objectSnapTol?: number;
  },
): Pt {
  let { x, y } = p;
  const z = Math.max(opts.zoomLike, 0.05);
  const objTol = opts.objectSnapTol ?? 8 / z;
  if (opts.objectSnapPts?.length) {
    let best: Pt | null = null;
    let bestD = objTol;
    for (const q of opts.objectSnapPts) {
      const d = Math.hypot(x - q.x, y - q.y);
      if (d <= bestD) {
        bestD = d;
        best = q;
      }
    }
    if (best) {
      x = best.x;
      y = best.y;
    }
  }
  if (opts.snapGuideOn) {
    x = snapToGuides(x, opts.guides.v, 8 / z);
    y = snapToGuides(y, opts.guides.h, 8 / z);
  }
  return {
    x: snapGrid(x, opts.snapGridOn, opts.gridPx),
    y: snapGrid(y, opts.snapGridOn, opts.gridPx),
  };
}

/** Duty: 正交约束（直线类）。 */
export function applyOrtho(start: Pt, raw: Pt, orthoOn: boolean): Pt {
  if (!orthoOn) return raw;
  if (Math.abs(raw.x - start.x) >= Math.abs(raw.y - start.y)) return { x: raw.x, y: start.y };
  return { x: start.x, y: raw.y };
}
