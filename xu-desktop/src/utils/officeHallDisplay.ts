/**
 * @file officeHallDisplay.ts 办公室 3D 大厅品牌墙 / 屏风文案与 Logo（用户可配）
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-30
 * @version 1.0.0
 * @category UI
 * @algo localStorage-kv
 */

export const OFFICE_HALL_DISPLAY_KEY = "xu.office.hallDisplay";

export type OfficeHallDisplay = {
  /** data URL；空则用 /icon.png */
  logoDataUrl: string;
  brandName: string;
  mainTitle: string;
  subtitle: string;
  foldingTitle: string;
  foldingSubtitle: string;
  hudLabel: string;
  chipAsk: string;
  chipPlan: string;
  chipAgent: string;
  chipApprove: string;
};

export const DEFAULT_OFFICE_HALL_DISPLAY: OfficeHallDisplay = {
  logoDataUrl: "",
  brandName: "VIRMOOR",
  mainTitle: "虚募阁AI公司",
  subtitle: "问询 · 计划 · 智能体",
  foldingTitle: "虚募阁科技",
  foldingSubtitle: "-- AI前沿站",
  hudLabel: "VIRMOOR // OFFICE",
  chipAsk: "问询",
  chipPlan: "计划",
  chipAgent: "智能体",
  chipApprove: "等你批准",
};

function trimField(value: unknown, fallback: string, max = 80): string {
  const s = typeof value === "string" ? value.trim() : "";
  if (!s) return fallback;
  return s.length > max ? s.slice(0, max) : s;
}

/** 归一化并合并缺省字段 */
export function normalizeOfficeHallDisplay(raw: Partial<OfficeHallDisplay> | null | undefined): OfficeHallDisplay {
  const d = DEFAULT_OFFICE_HALL_DISPLAY;
  return {
    logoDataUrl: typeof raw?.logoDataUrl === "string" ? raw.logoDataUrl : d.logoDataUrl,
    brandName: trimField(raw?.brandName, d.brandName, 32),
    mainTitle: trimField(raw?.mainTitle, d.mainTitle, 48),
    subtitle: trimField(raw?.subtitle, d.subtitle, 64),
    foldingTitle: trimField(raw?.foldingTitle, d.foldingTitle, 48),
    foldingSubtitle: trimField(raw?.foldingSubtitle, d.foldingSubtitle, 48),
    hudLabel: trimField(raw?.hudLabel, d.hudLabel, 48),
    chipAsk: trimField(raw?.chipAsk, d.chipAsk, 16),
    chipPlan: trimField(raw?.chipPlan, d.chipPlan, 16),
    chipAgent: trimField(raw?.chipAgent, d.chipAgent, 16),
    chipApprove: trimField(raw?.chipApprove, d.chipApprove, 16),
  };
}

/** 读取大厅品牌/屏风配置 */
export function readOfficeHallDisplay(): OfficeHallDisplay {
  try {
    const raw = localStorage.getItem(OFFICE_HALL_DISPLAY_KEY);
    if (!raw) return { ...DEFAULT_OFFICE_HALL_DISPLAY };
    return normalizeOfficeHallDisplay(JSON.parse(raw) as Partial<OfficeHallDisplay>);
  } catch {
    return { ...DEFAULT_OFFICE_HALL_DISPLAY };
  }
}

/** 写入大厅品牌/屏风配置并广播刷新 */
export function writeOfficeHallDisplay(patch: Partial<OfficeHallDisplay>): OfficeHallDisplay {
  const next = normalizeOfficeHallDisplay({ ...readOfficeHallDisplay(), ...patch });
  try {
    localStorage.setItem(OFFICE_HALL_DISPLAY_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new CustomEvent("xu-office-display", { detail: next }));
  return next;
}

/** 恢复默认文案与 Logo */
export function resetOfficeHallDisplay(): OfficeHallDisplay {
  try {
    localStorage.removeItem(OFFICE_HALL_DISPLAY_KEY);
  } catch {
    /* ignore */
  }
  const next = { ...DEFAULT_OFFICE_HALL_DISPLAY };
  window.dispatchEvent(new CustomEvent("xu-office-display", { detail: next }));
  return next;
}
