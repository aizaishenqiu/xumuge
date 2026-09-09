/**
 * @file screenshotPrefs.ts — screenshot UX preferences (auto-attach to chat)
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-31
 * @version 1.0.0
 * @category Config
 * @algo localStorage-boolean-pref
 */

const AUTO_ATTACH_KEY = "xu.screenshot.autoAttachChat";
const CHANGE_EVENT = "xu-screenshot-prefs-changed";

/** Whether finishing a screenshot also attaches it into the chat composer. Default on. */
export function readScreenshotAutoAttachChat(): boolean {
  try {
    const raw = localStorage.getItem(AUTO_ATTACH_KEY);
    if (raw === null) return true;
    return raw !== "0" && raw !== "false";
  } catch {
    return true;
  }
}

/** Persist auto-attach preference and notify listeners. */
export function writeScreenshotAutoAttachChat(enabled: boolean): void {
  try {
    localStorage.setItem(AUTO_ATTACH_KEY, enabled ? "1" : "0");
  } catch {
    /* ignore quota */
  }
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: { autoAttachChat: enabled } }));
}

export { CHANGE_EVENT as SCREENSHOT_PREFS_CHANGED };
