/**
 * @file sketchPaper.ts 图纸规格（CDR 式自由宽高）
 * @author qiuye <yjk150@qq.com>
 * @date 2026-09-06
 * @version 1.3.0
 * @category Cache
 * @algo cdr-page-setup
 */

export type LengthUnit = "px" | "mm" | "cm" | "m" | "in";

export type PaperState = {
  w: number;
  h: number;
  unit: LengthUnit;
  dpi: number;
  scale: number;
  /** 纸面底色 */
  bg?: string;
};

export const DEFAULT_DESK_BG = "#64748b";
export const DEFAULT_PAPER_BG = "#ffffff";

export const UNITS: { id: LengthUnit; label: string }[] = [
  { id: "mm", label: "mm" },
  { id: "cm", label: "cm" },
  { id: "m", label: "m" },
  { id: "in", label: "in" },
  { id: "px", label: "px" },
];

export const DEFAULT_PAPER: PaperState = {
  w: 420,
  h: 297,
  unit: "mm",
  dpi: 96,
  scale: 100,
  bg: DEFAULT_PAPER_BG,
};

export type PagePreset = { id: string; label: string; patch: Partial<PaperState> };

export const PAGE_PRESETS: PagePreset[] = [
  { id: "a4-p", label: "A4 纵向", patch: { w: 210, h: 297, unit: "mm" } },
  { id: "a4-l", label: "A4 横向", patch: { w: 297, h: 210, unit: "mm" } },
  { id: "a3-l", label: "A3 横向", patch: { w: 420, h: 297, unit: "mm" } },
  { id: "a5-p", label: "A5 纵向", patch: { w: 148, h: 210, unit: "mm" } },
  { id: "letter", label: "Letter", patch: { w: 8.5, h: 11, unit: "in" } },
  { id: "web", label: "网页 1920×1080", patch: { w: 1920, h: 1080, unit: "px", dpi: 96, scale: 1 } },
  { id: "house", label: "户型（A3 · 1:100）", patch: { w: 420, h: 297, unit: "mm", dpi: 96, scale: 100 } },
];

const PX_MIN = 64;
const PX_MAX = 8192;

/** Duty: 把长度换算成毫米。 */
export function toMm(v: number, unit: LengthUnit, dpi: number): number {
  const d = dpi > 0 ? dpi : 96;
  if (unit === "mm") return v;
  if (unit === "cm") return v * 10;
  if (unit === "m") return v * 1000;
  if (unit === "in") return v * 25.4;
  return (v * 25.4) / d;
}

/** Duty: 毫米换算成目标单位。 */
export function fromMm(mm: number, unit: LengthUnit, dpi: number): number {
  const d = dpi > 0 ? dpi : 96;
  if (unit === "mm") return mm;
  if (unit === "cm") return mm / 10;
  if (unit === "m") return mm / 1000;
  if (unit === "in") return mm / 25.4;
  return (mm * d) / 25.4;
}

/** Duty: 图纸像素宽高（限制上限以免撑爆内存）。 */
export function paperPixelSize(paper: PaperState): { w: number; h: number } {
  const dpi = paper.dpi > 0 ? paper.dpi : 96;
  const wMm = toMm(paper.w, paper.unit, dpi);
  const hMm = toMm(paper.h, paper.unit, dpi);
  const w = Math.round((wMm * dpi) / 25.4);
  const h = Math.round((hMm * dpi) / 25.4);
  return {
    w: Math.min(PX_MAX, Math.max(PX_MIN, w || PX_MIN)),
    h: Math.min(PX_MAX, Math.max(PX_MIN, h || PX_MIN)),
  };
}

/** Duty: 纸面像素 → 实际毫米（含比例）。 */
export function pxToRealMm(px: number, paper: PaperState): number {
  const dpi = paper.dpi > 0 ? paper.dpi : 96;
  const paperMm = (px * 25.4) / dpi;
  return paperMm * (paper.scale > 0 ? paper.scale : 1);
}

/** Duty: 实际毫米 → 纸面像素。 */
export function realMmToPx(mm: number, paper: PaperState): number {
  const dpi = paper.dpi > 0 ? paper.dpi : 96;
  const s = paper.scale > 0 ? paper.scale : 1;
  return ((mm / s) * dpi) / 25.4;
}

/** Duty: 换单位，保持物理尺寸。 */
export function convertPaperUnit(paper: PaperState, unit: LengthUnit): PaperState {
  const mmW = toMm(paper.w, paper.unit, paper.dpi);
  const mmH = toMm(paper.h, paper.unit, paper.dpi);
  return {
    ...paper,
    unit,
    w: roundLen(fromMm(mmW, unit, paper.dpi)),
    h: roundLen(fromMm(mmH, unit, paper.dpi)),
  };
}

function roundLen(n: number): number {
  if (Math.abs(n) >= 100) return Math.round(n * 10) / 10;
  if (Math.abs(n) >= 1) return Math.round(n * 100) / 100;
  return Math.round(n * 1000) / 1000;
}

const OLD: Record<string, { w: number; h: number; unit: LengthUnit }> = {
  "a3-l": { w: 420, h: 297, unit: "mm" },
  "a4-l": { w: 297, h: 210, unit: "mm" },
  "a4-p": { w: 210, h: 297, unit: "mm" },
};

/** Duty: 解析 board.json 的 paper（兼容旧 size 枚举）。 */
export function parsePaper(raw: unknown): PaperState {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_PAPER };
  const o = raw as {
    size?: string;
    w?: number;
    h?: number;
    unit?: string;
    dpi?: number;
    scale?: number;
    bg?: string;
  };
  const base = { ...DEFAULT_PAPER };
  if (typeof o.size === "string" && OLD[o.size]) Object.assign(base, OLD[o.size]);
  const unit = UNITS.some((u) => u.id === o.unit) ? (o.unit as LengthUnit) : base.unit;
  const dpi = Number(o.dpi);
  const scale = Number(o.scale);
  const w = Number(o.w);
  const h = Number(o.h);
  const bg =
    typeof o.bg === "string" && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(o.bg.trim())
      ? o.bg.trim()
      : base.bg ?? DEFAULT_PAPER_BG;
  return {
    w: Number.isFinite(w) && w > 0 ? w : base.w,
    h: Number.isFinite(h) && h > 0 ? h : base.h,
    unit,
    dpi: Number.isFinite(dpi) && dpi >= 36 && dpi <= 600 ? dpi : base.dpi,
    scale: Number.isFinite(scale) && scale > 0 ? scale : base.scale,
    bg,
  };
}

/** Duty: 解析粘贴板（灰色工作区）底色。 */
export function parseDeskBg(raw: unknown): string {
  if (typeof raw === "string" && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(raw.trim())) return raw.trim();
  return DEFAULT_DESK_BG;
}

/** Duty: 快捷填入预设（不锁定，之后仍可改数）。 */
export function applyPreset(paper: PaperState, id: string): PaperState {
  const p = PAGE_PRESETS.find((x) => x.id === id);
  if (!p) return paper;
  return { ...paper, ...p.patch };
}
