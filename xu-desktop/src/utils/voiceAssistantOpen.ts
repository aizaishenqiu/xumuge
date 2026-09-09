/**
 * @file 全局打开语音助手通话层（任意路由可请求，对话页承接会话）
 * @author qiuye <yjk150@qq.com>
 * @date 2026-09-01
 * @updated 2026-09-03
 * @version 2.3.0
 * @category Stream
 * @algo request-id-overlay-state-machine
 */

const FLAG_KEY = "xu.voice.openAssistant.v1";
export const XU_VOICE_OPEN_ASSISTANT = "xu-voice-open-assistant";
export const XU_VOICE_WAKE_REFRESH = "xu-voice-wake-refresh";
export const XU_VOICE_FORCE_HANGUP = "xu-voice-force-hangup";

/** opening 宽限期：此时间内禁止 clearStale 冲掉合法打开 */
export const OPENING_GRACE_MS = 5_000;

export type VoiceAssistantOpenState =
  | "idle"
  | "opening"
  | "visible"
  | "acquiringMic"
  | "active"
  | "closing"
  | "error";

let openState: VoiceAssistantOpenState = "idle";
let currentRequestId = "";
let openingSinceMs = 0;
let graceRefreshTimer: ReturnType<typeof setTimeout> | null = null;

function newRequestId(): string {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `voice_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function clearGraceRefreshTimer(): void {
  if (graceRefreshTimer) {
    clearTimeout(graceRefreshTimer);
    graceRefreshTimer = null;
  }
}

/**
 * Duty: opening 宽限期结束后再触发一次唤醒同步，避免卡在 opening 永久停听。
 */
function scheduleWakeRefreshAfterOpeningGrace(): void {
  clearGraceRefreshTimer();
  if (typeof window === "undefined") return;
  graceRefreshTimer = window.setTimeout(() => {
    graceRefreshTimer = null;
    // 仍无 DOM 的 opening/visible 由 clearStale 回收；无论是否回收都 refresh
    dispatchVoiceWakeRefresh();
  }, OPENING_GRACE_MS + 200);
}

function markOpeningNow(): void {
  openState = "opening";
  openingSinceMs = Date.now();
  scheduleWakeRefreshAfterOpeningGrace();
}

/** 通话层是否已打开（全局唤醒据此暂停，避免抢麦）。 */
export function isVoiceAssistantOverlayOpen(): boolean {
  return openState !== "idle" && openState !== "closing" && openState !== "error";
}

/**
 * 仅当 opening/visible 超过宽限期且仍无 DOM 时清掉卡死状态。
 * 宽限期内禁止清，避免 blur/refresh 冲掉合法唤醒打开。
 */
export function clearStaleVoiceAssistantOpen(): boolean {
  const hasDom =
    typeof document !== "undefined" &&
    Boolean(document.querySelector(".voice-assistant-overlay"));
  if (hasDom) return false;
  if (openState === "idle" || openState === "closing" || openState === "error") {
    return false;
  }
  if (openState === "opening" || openState === "visible") {
    const age = openingSinceMs > 0 ? Date.now() - openingSinceMs : OPENING_GRACE_MS + 1;
    if (age < OPENING_GRACE_MS) return false;
  }
  openState = "idle";
  currentRequestId = "";
  openingSinceMs = 0;
  clearGraceRefreshTimer();
  try {
    sessionStorage.removeItem(FLAG_KEY);
  } catch {
    /* ignore */
  }
  return true;
}

/** 是否正在等待实际通话层确认可见。 */
export function isVoiceWakeOpening(): boolean {
  return openState === "opening";
}

/** ChatPage 打开/关闭通话层时同步。 */
export function setVoiceAssistantOverlayOpen(open: boolean): void {
  openState = open ? "visible" : "idle";
  if (!open) {
    currentRequestId = "";
    openingSinceMs = 0;
    clearGraceRefreshTimer();
  } else if (!openingSinceMs) {
    openingSinceMs = Date.now();
  }
}

/**
 * 唤醒命中时进入 opening；不再提前伪造 overlay 已可见。
 */
export function beginVoiceWakeOpen(_ms = 0): void {
  markOpeningNow();
}

/** 首页与 IDE/Canvas 已挂载 ChatPage，勿再 push 卸组件。 */
export function routeHasChatPage(path: string): boolean {
  return path === "/home" || path === "/ide" || path === "/canvas";
}

/** 请求打开全屏语音通话；返回 requestId，承接组件须显式确认。 */
export function requestOpenVoiceAssistant(detail?: { phrase?: string }): string {
  const requestId = newRequestId();
  currentRequestId = requestId;
  markOpeningNow();
  try {
    sessionStorage.setItem(FLAG_KEY, requestId);
  } catch {
    /* ignore */
  }
  window.dispatchEvent(
    new CustomEvent(XU_VOICE_OPEN_ASSISTANT, {
      detail: { ...(detail ?? {}), requestId },
    }),
  );
  return requestId;
}

/** ChatPage 在真实 Dialog 已置 visible 后确认同一打开请求。 */
export function acknowledgeVoiceAssistantVisible(requestId?: string): boolean {
  if (requestId && currentRequestId && requestId !== currentRequestId) return false;
  openState = "visible";
  openingSinceMs = 0;
  clearGraceRefreshTimer();
  try {
    sessionStorage.removeItem(FLAG_KEY);
  } catch {
    /* ignore */
  }
  return true;
}

/**
 * ChatPage 挂载时消费一次打开标记。
 * 返回 requestId（新）或 "1"（旧兼容）；无标记返回空串。
 */
export function consumeOpenVoiceAssistantFlag(): string {
  try {
    const v = sessionStorage.getItem(FLAG_KEY);
    if (v) {
      sessionStorage.removeItem(FLAG_KEY);
      return v;
    }
  } catch {
    /* ignore */
  }
  return "";
}

/** 通知全局重新同步唤醒监听。 */
export function dispatchVoiceWakeRefresh(): void {
  window.dispatchEvent(new CustomEvent(XU_VOICE_WAKE_REFRESH));
}

/** Esc / 清障：强制挂断并清孤儿遮罩。 */
export function forceCloseVoiceAssistantOverlay(): void {
  openState = "closing";
  currentRequestId = "";
  openingSinceMs = 0;
  clearGraceRefreshTimer();
  try {
    sessionStorage.removeItem(FLAG_KEY);
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new CustomEvent(XU_VOICE_FORCE_HANGUP));
  document.querySelectorAll(".voice-assistant-overlay").forEach((el) => {
    const node = el as HTMLElement;
    node.style.pointerEvents = "none";
    node.style.display = "none";
    try {
      node.remove();
    } catch {
      /* ignore */
    }
  });
  document.body.style.overflow = "";
  openState = "idle";
  dispatchVoiceWakeRefresh();
}
