/**
 * @file 会话发送队列的原会话绑定辅助
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-31
 * @version 1.0.0
 * @category Queue
 * @algo session-keyed-fifo
 */

/**
 * 从指定会话 FIFO 取一项，不读取当前 UI 会话。
 * 依赖: 调用方提供不可变队列表；目标会话为空或无队列时返回原表。
 */
export function takeSessionQueuedSend<T extends { id: string }>(
  queues: Readonly<Record<string, T[]>>,
  sessionId: string,
): { item: T | null; queues: Record<string, T[]> } {
  const list = queues[sessionId] ?? [];
  if (!list.length) return { item: null, queues: { ...queues } };
  return {
    item: list[0],
    queues: { ...queues, [sessionId]: list.slice(1) },
  };
}
