/**
 * @file 语音通话确权闸：确认/取消词匹配与挂起 Promise
 * @author qiuye <yjk150@qq.com>
 * @date 2026-09-07
 * @updated 2026-09-07
 * @version 1.1.0
 * @category Stream
 * @algo voice-confirm-promise-gate
 */

export type VoiceConfirmDecision = "confirm" | "cancel";

/** 用户口头确认后送入模型的前缀（本轮放行写工具）。 */
export const VOICE_USER_CONFIRMED_PREFIX = "【用户已口头确认】";

type Pending = {
  resolve: (d: VoiceConfirmDecision) => void;
  prompt: string;
};

let pending: Pending | null = null;

/**
 * Duty: 从用户口述中识别确认/取消。
 * Failure: 无法判定时返回 null（不消费本句）。
 */
export function matchVoiceConfirmUtterance(text: string): VoiceConfirmDecision | null {
  const t = text
    .trim()
    .replace(/\s+/g, "")
    .replace(/[。！？.!?，,、；;：:\s]/g, "");
  if (!t) return null;
  // 长句取前 80 字判定，避免「确认并删掉…」因过长漏判
  const head = t.length > 80 ? t.slice(0, 80) : t;
  if (/不(确认|同意|授权|可以)|别确认/.test(head)) return "cancel";
  if (/取消|算了|不要|拒绝|先不|打住|停下/.test(head)) return "cancel";
  if (/确认|同意|授权|去选择|继续(吧|执行)?|可以了|好的?可以|准了/.test(head)) {
    return "confirm";
  }
  if (/^(好的?|行|可以|是的?|嗯)$/.test(head)) return "confirm";
  return null;
}

/**
 * Duty: 用户话术是否像敏感写/外发/删（通话本轮强制只读直至口头确认）。
 */
export function looksLikeVoiceSensitiveOp(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (t.includes(VOICE_USER_CONFIRMED_PREFIX)) return false;
  return /密钥|证书|\.env\b|密码|口令|token|身份证|银行卡|批量删除|删掉所有|删除全部|chmod|改权限|git\s*push|推送(到)?远程|强制推送|外发|发到网上|webhook|私钥|private\s*key|api[_\s-]?key|ssh\s*key/i.test(
    t,
  );
}

/** Duty: 是否有挂起的确权等待。 */
export function isVoiceConfirmPending(): boolean {
  return pending != null;
}

/** Duty: 挂起确权；再次调用会取消上一笔（视为 cancel）。 */
export function armVoiceConfirm(prompt: string): Promise<VoiceConfirmDecision> {
  if (pending) {
    const prev = pending;
    pending = null;
    prev.resolve("cancel");
  }
  return new Promise((resolve) => {
    pending = { resolve, prompt };
  });
}

/** Duty: 清除挂起；默认按取消收尾。 */
export function clearVoiceConfirmPending(resolveAsCancel = true): void {
  if (!pending) return;
  const p = pending;
  pending = null;
  if (resolveAsCancel) p.resolve("cancel");
}

/**
 * Duty: 若本句命中确认/取消则 resolve 挂起并返回 true。
 * Failure: 无挂起或无法判定 → false。
 */
export function tryResolveVoiceConfirm(text: string): boolean {
  if (!pending) return false;
  const d = matchVoiceConfirmUtterance(text);
  if (!d) return false;
  const p = pending;
  pending = null;
  p.resolve(d);
  return true;
}

/**
 * Duty: 播报提示并等待用户口头确认/取消。
 * Failure: 播报失败仍等待口述；超时返回 cancel 并清挂起。
 */
export async function voiceConfirmAsk(
  speak: (text: string) => void | Promise<void>,
  prompt: string,
  opts?: { timeoutMs?: number },
): Promise<VoiceConfirmDecision> {
  const wait = armVoiceConfirm(prompt);
  await speak(prompt);
  const timeoutMs = opts?.timeoutMs ?? 90_000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      wait,
      new Promise<VoiceConfirmDecision>((resolve) => {
        timer = setTimeout(() => {
          clearVoiceConfirmPending(true);
          resolve("cancel");
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer != null) clearTimeout(timer);
  }
}

/** 助手正文是否在征求确认（用于敏感操作口头闸）。 */
export function assistantAsksVoiceConfirm(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  return /请.*?(确认|同意)|是否同意|说[「"']?确认|需要你确认|等你确认/.test(t);
}
