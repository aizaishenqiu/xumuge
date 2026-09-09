/** Fixed product brand + user-editable company display name. */

/** Product brand (对外品牌) */
export const BRAND_NAME = "虚募阁｜Virmoor";
/** Short Chinese mark (nav / tight spaces) */
export const BRAND_NAME_ZH = "虚募阁";
/** English mark */
export const BRAND_NAME_EN = "Virmoor";
/** Default system prompt intro for main chat */
export const BRAND_ASSISTANT_INTRO = `你是${BRAND_NAME_ZH}桌面助手。用简洁中文回答。`;
/** Employee dispatch system prompt prefix */
export const BRAND_EMPLOYEE_INTRO = (name: string) =>
  `你是${BRAND_NAME_ZH}的 AI 员工「${name}」。`;
/** Square app / favicon mark (high-contrast tile) */
export const BRAND_ICON_URL = "/icon.png";
/** Original mark art */
export const BRAND_MARK_URL = "/logo.png";
/** Horizontal wordmark (transparent, for light surfaces) */
export const BRAND_LOGO_URL = "/h-logo.png";
/** Operating company (主体公司) */
export const COMPANY_LEGAL_NAME = "玖咖科技";
export const DEFAULT_COMPANY_NAME = "玖咖科技";
export const COMPANY_NAME_KEY = "xu.brand.companyName";
export const COMPANY_NAME_MAX = 40;

/**
 * Initial commercial policy（对外口径）:
 * - 注册成功自动发放 30 天测试资格
 * - 到期时间在个人中心展示
 * - 到期后新版本发布与续用规则，以后续正式通知为准（本轮不发明续费产品）
 */
export const TRIAL_POLICY = {
  days: 30,
  summary:
    "注册后获 30 天测试资格；个人中心可查看到期时间。到期后新版本发布与续用规则，以后续正式通知为准。",
} as const;

export function normalizeCompanyName(raw: string): string {
  const t = raw.trim().replace(/\s+/g, " ");
  if (!t) return DEFAULT_COMPANY_NAME;
  return t.slice(0, COMPANY_NAME_MAX);
}

export function readCompanyName(): string {
  try {
    const raw = localStorage.getItem(COMPANY_NAME_KEY);
    if (raw == null || !raw.trim()) return DEFAULT_COMPANY_NAME;
    return normalizeCompanyName(raw);
  } catch {
    return DEFAULT_COMPANY_NAME;
  }
}

export function writeCompanyName(value: string): string {
  const next = normalizeCompanyName(value);
  try {
    localStorage.setItem(COMPANY_NAME_KEY, next);
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new CustomEvent("xu-brand-settings", { detail: { companyName: next } }));
  try {
    document.title = `${BRAND_NAME} · ${next}`;
  } catch {
    /* ignore */
  }
  return next;
}

/** Call once on app boot so tab title matches stored company. */
export function applyDocumentTitle(companyName = readCompanyName()): void {
  try {
    document.title = `${BRAND_NAME} · ${companyName}`;
  } catch {
    /* ignore */
  }
}
