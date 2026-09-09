import { appendFouMessage } from "../employee";
import {
  isResetClearIntentConfirm,
  isResetDeletePhrase,
  isResetReplanCancel,
  isWorkReset,
} from "./bossStopIntent";
import { OFFICE_FLOOR } from "./officeComms";
import {
  advanceToDeletePhraseConfirm,
  clearResetReplanPending,
  isImResetSource,
  loadResetReplanPending,
  requestRemoteResetConfirm,
  takeConfirmedRemoteReset,
} from "./resetReplanPending";

/**
 * Handle Boss inbound related to 清理重规划.
 * @returns true if consumed (caller should skip other handlers).
 */
export async function handleBossInboundReset(
  text: string,
  source?: string,
): Promise<boolean> {
  if (isResetDeletePhrase(text)) {
    const pending = await takeConfirmedRemoteReset();
    if (!pending) {
      await appendFouMessage({
        sessionTag: OFFICE_FLOOR,
        role: "system",
        content:
          "ℹ️ 没有待执行的二次确认（请先回复「确认清除」，再输入「确认删除」）。",
      });
      return true;
    }
    window.dispatchEvent(
      new CustomEvent("xu-team-reset-execute", {
        detail: {
          text: pending.text,
          skipBossBroadcast: true,
          channel: pending.source,
        },
      }),
    );
    await appendFouMessage({
      sessionTag: OFFICE_FLOOR,
      role: "system",
      content:
        "✅ 已收到 IM「确认删除」。请在桌面端弹出的清理确认框输入登录密码后执行（不会自动 wipe）。",
    });
    return true;
  }

  if (isResetClearIntentConfirm(text)) {
    const pending = await loadResetReplanPending();
    if (!pending || pending.stage !== "await_clear_intent") {
      await appendFouMessage({
        sessionTag: OFFICE_FLOOR,
        role: "system",
        content: "ℹ️ 没有待第一次确认的清理重规划（可能已过期或已处理）。",
      });
      return true;
    }
    await advanceToDeletePhraseConfirm(pending);
    return true;
  }

  if (isResetReplanCancel(text)) {
    const pending = await loadResetReplanPending();
    if (pending) {
      await clearResetReplanPending();
      await appendFouMessage({
        sessionTag: OFFICE_FLOOR,
        role: "system",
        content: "✅ 已取消待执行的清理重规划。",
      });
      return true;
    }
    return false;
  }

  if (isWorkReset(text) && isImResetSource(source)) {
    await requestRemoteResetConfirm(text, {
      source: source as import("./resetReplanPending").ResetReplanSource,
    });
    return true;
  }

  return false;
}
