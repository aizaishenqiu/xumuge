/**
 * @file 对话附件异步代际与发送确认辅助
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-31
 * @version 1.0.0
 * @category Queue
 * @algo session-generation-compare
 */

export interface AttachmentRequestToken {
  sessionKey: string;
  generation: number;
}

/** 将空会话统一映射到草稿键；依赖调用方捕获时刻的 sessionId。 */
export function attachmentSessionKey(sessionId?: string | null): string {
  return sessionId?.trim() || "__draft__";
}

/**
 * 判断附件异步结果是否仍属于当前输入区。
 * 依赖: 会话键与单调 generation；任一变化都拒绝覆盖当前附件状态。
 */
export function isCurrentAttachmentRequest(
  token: AttachmentRequestToken,
  currentSessionId: string | null | undefined,
  currentGeneration: number,
): boolean {
  return (
    token.sessionKey === attachmentSessionKey(currentSessionId) &&
    token.generation === currentGeneration
  );
}

/**
 * 仅在父级确认消息已持久化或入队后执行清空。
 * 依赖: accepted 为父级最终确认；失败或未确认时保留全部草稿状态。
 */
export function clearAfterAcceptedSend(accepted: boolean, clear: () => void): void {
  if (accepted) clear();
}
