/**
 * @file 办公室设计模式：默认锁定员工档案；设计模式下可改布局与员工
 * @author qiuye <yjk150@qq.com>
 * @date 2026-09-01
 * @version 1.0.0
 * @category Office
 * @algo localStorage-flag
 */

export const OFFICE_DESIGN_MODE_KEY = "xu.office.designMode";

/** Duty: read design-office flag (default false = daily locked). */
export function readOfficeDesignMode(): boolean {
  try {
    return localStorage.getItem(OFFICE_DESIGN_MODE_KEY) === "1";
  } catch {
    return false;
  }
}

/** Duty: persist design-office flag and notify listeners. */
export function writeOfficeDesignMode(on: boolean): void {
  try {
    if (on) localStorage.setItem(OFFICE_DESIGN_MODE_KEY, "1");
    else localStorage.removeItem(OFFICE_DESIGN_MODE_KEY);
  } catch {
    /* ignore */
  }
  try {
    window.dispatchEvent(
      new CustomEvent("xu-office-design-mode", { detail: { on: Boolean(on) } }),
    );
  } catch {
    /* ignore */
  }
}
