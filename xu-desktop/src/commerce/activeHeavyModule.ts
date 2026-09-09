import { toUserError } from "../utils/userFacingError";
/**
 * Heavy commercial modules (.xubiz / Canvas runtime): only one active at a time.
 */
let activeHeavyId: string | null = null;

export function getActiveHeavyModuleId(): string | null {
  return activeHeavyId;
}

/**
 * Acquire exclusive heavy-module slot.
 * @throws if another heavy module is already active
 */
export function acquireHeavyModule(id: string): void {
  const next = (id || "").trim();
  if (!next) throw new Error("重组件 id 为空");
  if (activeHeavyId && activeHeavyId !== next) {
    throw new Error(
      `重组件「${activeHeavyId}」仍在运行。请先关闭后再打开「${next}」（按本机性能同一时刻只激活一个重组件）。`,
    );
  }
  activeHeavyId = next;
}

export function releaseHeavyModule(id?: string | null): void {
  if (!activeHeavyId) return;
  if (id && id !== activeHeavyId) return;
  activeHeavyId = null;
}

export function tryAcquireHeavyModule(id: string): { ok: true } | { ok: false; message: string } {
  try {
    acquireHeavyModule(id);
    return { ok: true };
  } catch (e) {
    return { ok: false, message: toUserError(e) };
  }
}
