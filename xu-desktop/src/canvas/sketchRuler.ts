/**
 * @file sketchRuler.ts 标尺刻度
 * @author qiuye <yjk150@qq.com>
 * @date 2026-09-06
 * @version 1.1.0
 * @category Cache
 * @algo nice-ruler-ticks
 */
import { fromMm, pxToRealMm, realMmToPx, type PaperState } from "./sketchPaper";

export type RulerTick = { pos: number; major: boolean; label: string };

const STEPS = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000];

function formatUnit(paperPx: number, paper: PaperState): string {
  const mm = pxToRealMm(paperPx, { ...paper, scale: 1 });
  const v = fromMm(mm, paper.unit, paper.dpi);
  if (paper.unit === "px") return String(Math.round(paperPx));
  if (paper.unit === "m") return v.toFixed(2);
  if (paper.unit === "in") return v.toFixed(2);
  if (paper.unit === "cm") return v.toFixed(1);
  return String(Math.round(v));
}

/** Duty: 生成主/次刻度，覆盖 [minPx, maxPx]（可含负数，0 为纸面原点）。 */
export function buildRulerTicks(
  minPx: number,
  maxPx: number,
  screenPerPx: number,
  paper: PaperState,
): RulerTick[] {
  const z = screenPerPx > 0 ? screenPerPx : 1;
  const targetMm = pxToRealMm(48 / z, { ...paper, scale: 1 });
  const majorMm = STEPS.find((s) => targetMm <= s) ?? 5000;
  const majorPx = realMmToPx(majorMm, { ...paper, scale: 1 });
  const minorPx = majorPx / 5;
  const ticks: RulerTick[] = [];
  if (minorPx <= 0 || !Number.isFinite(minPx) || !Number.isFinite(maxPx) || maxPx <= minPx) return ticks;
  const start = Math.floor(minPx / minorPx) * minorPx;
  const end = maxPx + minorPx * 0.01;
  for (let p = start, i = Math.round(start / minorPx); p <= end; p += minorPx, i += 1) {
    const major = ((i % 5) + 5) % 5 === 0;
    ticks.push({ pos: p, major, label: major ? formatUnit(p, paper) : "" });
  }
  return ticks;
}

export type Guides = { v: number[]; h: number[] };

/** Duty: 解析 board.json 的 guides。 */
export function parseGuides(raw: unknown): Guides {
  if (!raw || typeof raw !== "object") return { v: [], h: [] };
  const o = raw as { v?: unknown; h?: unknown };
  const nums = (x: unknown) =>
    Array.isArray(x) ? x.map(Number).filter((n) => Number.isFinite(n)) : [];
  return { v: nums(o.v), h: nums(o.h) };
}

/** Duty: 吸附到最近参考线。 */
export function snapToGuides(n: number, lines: number[], tol: number): number {
  let best = n;
  let d = tol;
  for (const g of lines) {
    const dist = Math.abs(n - g);
    if (dist < d) {
      d = dist;
      best = g;
    }
  }
  return best;
}
