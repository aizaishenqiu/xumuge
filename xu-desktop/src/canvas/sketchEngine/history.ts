/**
 * @file history.ts 草图撤销栈
 * @author qiuye <yjk150@qq.com>
 * @date 2026-09-06
 * @version 1.0.0
 * @category Cache
 * @algo sketch-history-stack
 */

import { toRaw } from "vue";
import type { Stroke } from "../sketchTypes";

const MAX = 80;

/** Duty: 深拷贝单图元为纯对象（WebView 上 structuredClone(Proxy) 常抛错）。 */
export function cloneStroke(s: Stroke): Stroke {
  const raw = toRaw(s) as Stroke;
  try {
    return structuredClone(raw);
  } catch {
    return JSON.parse(JSON.stringify(raw)) as Stroke;
  }
}

/** Duty: 深拷贝图元列表。 */
export function cloneBoard(list: Stroke[]): Stroke[] {
  return list.map((s) => cloneStroke(s));
}

export type HistoryState = {
  stack: Stroke[][];
  idx: number;
};

/** Duty: 初始历史。 */
export function createHistory(initial: Stroke[] = []): HistoryState {
  return { stack: [cloneBoard(initial)], idx: 0 };
};

/** Duty: 推入新板面并裁剪长度。 */
export function pushHistory(h: HistoryState, next: Stroke[]): HistoryState {
  const trimmed = h.stack.slice(0, h.idx + 1);
  trimmed.push(cloneBoard(next));
  if (trimmed.length > MAX) trimmed.shift();
  return { stack: trimmed, idx: trimmed.length - 1 };
}

/** Duty: 撤销，无则返回 null。 */
export function undoHistory(h: HistoryState): { history: HistoryState; strokes: Stroke[] } | null {
  if (h.idx <= 0) return null;
  const idx = h.idx - 1;
  return { history: { stack: h.stack, idx }, strokes: cloneBoard(h.stack[idx]!) };
}

/** Duty: 重做，无则返回 null。 */
export function redoHistory(h: HistoryState): { history: HistoryState; strokes: Stroke[] } | null {
  if (h.idx >= h.stack.length - 1) return null;
  const idx = h.idx + 1;
  return { history: { stack: h.stack, idx }, strokes: cloneBoard(h.stack[idx]!) };
}

/** Duty: 以当前板面重置历史（load 后）。 */
export function resetHistory(strokes: Stroke[]): HistoryState {
  return createHistory(strokes);
}
