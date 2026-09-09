/**
 * @file sketchColor.ts RGB / CMYK / Hex / HSV 换算与最近用色
 * @author qiuye <yjk150@qq.com>
 * @date 2026-09-06
 * @version 1.1.0
 * @category Cache
 * @algo rgb-cmyk-hsv-hex
 */
import { readLs, writeLs } from "../utils/xuStorage";

export type Rgb = { r: number; g: number; b: number };
export type Cmyk = { c: number; m: number; y: number; k: number };
export type Hsv = { h: number; s: number; v: number };

const RECENT_KEY = "xu.canvas.recentColors";
const RECENT_MAX = 12;

/** Duty: 解析 #rgb / #rrggbb。 */
export function parseHex(hex: string): Rgb {
  const h = hex.replace("#", "").trim();
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h.slice(0, 6), 16);
  if (!Number.isFinite(n)) return { r: 30, g: 41, b: 59 };
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/** Duty: RGB → #rrggbb。 */
export function rgbToHex(rgb: Rgb): string {
  const c = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${c(rgb.r)}${c(rgb.g)}${c(rgb.b)}`;
}

/** Duty: RGB → CMYK（0–100）。 */
export function rgbToCmyk(rgb: Rgb): Cmyk {
  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;
  const k = 1 - Math.max(r, g, b);
  if (k >= 1) return { c: 0, m: 0, y: 0, k: 100 };
  return {
    c: Math.round(((1 - r - k) / (1 - k)) * 100),
    m: Math.round(((1 - g - k) / (1 - k)) * 100),
    y: Math.round(((1 - b - k) / (1 - k)) * 100),
    k: Math.round(k * 100),
  };
}

/** Duty: CMYK（0–100）→ RGB。 */
export function cmykToRgb(cmyk: Cmyk): Rgb {
  const c = cmyk.c / 100;
  const m = cmyk.m / 100;
  const y = cmyk.y / 100;
  const k = cmyk.k / 100;
  return {
    r: Math.round(255 * (1 - c) * (1 - k)),
    g: Math.round(255 * (1 - m) * (1 - k)),
    b: Math.round(255 * (1 - y) * (1 - k)),
  };
}

/** Duty: RGB → HSV（h 0–360，s/v 0–100）。 */
export function rgbToHsv(rgb: Rgb): Hsv {
  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : (d / max) * 100;
  const v = max * 100;
  return { h: Math.round(h), s: Math.round(s), v: Math.round(v) };
}

/** Duty: HSV → RGB。 */
export function hsvToRgb(hsv: Hsv): Rgb {
  const h = ((hsv.h % 360) + 360) % 360;
  const s = Math.max(0, Math.min(100, hsv.s)) / 100;
  const v = Math.max(0, Math.min(100, hsv.v)) / 100;
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let rp = 0;
  let gp = 0;
  let bp = 0;
  if (h < 60) [rp, gp, bp] = [c, x, 0];
  else if (h < 120) [rp, gp, bp] = [x, c, 0];
  else if (h < 180) [rp, gp, bp] = [0, c, x];
  else if (h < 240) [rp, gp, bp] = [0, x, c];
  else if (h < 300) [rp, gp, bp] = [x, 0, c];
  else [rp, gp, bp] = [c, 0, x];
  return {
    r: Math.round((rp + m) * 255),
    g: Math.round((gp + m) * 255),
    b: Math.round((bp + m) * 255),
  };
}

/** Duty: 读取最近用色。 */
export function loadRecentColors(): string[] {
  try {
    const raw = readLs(RECENT_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return [];
    return arr.map(String).filter((h) => /^#[0-9a-fA-F]{6}$/.test(h)).slice(0, RECENT_MAX);
  } catch {
    return [];
  }
}

/** Duty: 写入最近用色（去重置顶）。 */
export function pushRecentColor(hex: string): string[] {
  const h = rgbToHex(parseHex(hex));
  const next = [h, ...loadRecentColors().filter((x) => x.toLowerCase() !== h.toLowerCase())].slice(0, RECENT_MAX);
  writeLs(RECENT_KEY, JSON.stringify(next));
  return next;
}
