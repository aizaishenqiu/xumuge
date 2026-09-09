/**
 * 重置 body 滚动/指针锁定，并解除 FouDialog 等遗留遮罩对整页的点击拦截。
 * 勿移除 fou-dialog-root 等 Vue Teleport 节点，否则会破坏 vnode。
 *
 * @author qiuye <yjk150@qq.com>
 */
export type ClearBlockersOptions = {
  /** 兼容旧调用；不再强制删除 Vue 管理的弹层 DOM */
  force?: boolean;
};

let guardInstalled = false;

function resetBodyInteractionLock(): void {
  document.body.style.overflow = "";
  document.body.style.pointerEvents = "";
  document.body.style.cursor = "";
  document.body.style.userSelect = "";
  document.documentElement.style.pointerEvents = "";
  document.documentElement.style.overflow = "";
  document.body.classList.remove("xu-popup-parent--hidden");
}

/** 仅清理非 Vue 管理的遗留底（勿动 fou-dialog-root） */
function removeLegacyBackdrops(): void {
  document.querySelectorAll(".ctx-pop-backdrop").forEach((el) => el.remove());
}

function isHidden(el: Element): boolean {
  const style = window.getComputedStyle(el);
  return (
    style.display === "none" ||
    style.visibility === "hidden" ||
    Number(style.opacity) === 0
  );
}

/** 关闭后仍挡点击的虚募阁弹层：只改 pointer-events，不删 DOM */
function neutralizeStuckPopupLayers(): void {
  const rootSelectors = [
    ".fou-dialog-root",
    ".fou-msgbox-root",
    ".fou-drawer-root",
    ".fou-popover-root",
    ".fou-popconfirm-root",
  ];
  const panelSelectors = [".fou-dialog", ".fou-msgbox", ".fou-drawer", ".fou-popover", ".fou-popconfirm"];
  const maskSelectors = [
    ".fou-dialog__mask",
    ".fou-msgbox-mask",
    ".fou-drawer__mask",
    ".fou-popover__mask",
    ".fou-popconfirm__mask",
  ];

  for (const rootSel of rootSelectors) {
    document.querySelectorAll(`body > ${rootSel}`).forEach((root) => {
      const node = root as HTMLElement;
      if (isHidden(node)) {
        node.style.pointerEvents = "none";
        return;
      }
      const panel = panelSelectors.map((s) => node.querySelector(s)).find(Boolean) as HTMLElement | null;
      const mask = maskSelectors.map((s) => node.querySelector(s)).find(Boolean) as HTMLElement | null;
      const panelHidden = !panel || isHidden(panel) || panel.offsetParent === null;
      if (panelHidden) {
        node.style.pointerEvents = "none";
        if (mask) mask.style.pointerEvents = "none";
      }
    });
  }

  // 兼容旧版 fou-overlay 类名（若存在）
  document.querySelectorAll("body > .fou-overlay").forEach((el) => {
    const node = el as HTMLElement;
    if (isHidden(node)) {
      node.remove();
      return;
    }
    const dialog = node.querySelector(".fou-dialog");
    if (!dialog || isHidden(dialog)) {
      node.style.pointerEvents = "none";
      node.style.display = "none";
    }
  });
}

/** 解除 body 交互锁；不删除 FouDialog 等 Teleport 根节点；顺带清孤儿语音层 */
export function clearStuckUiBlockers(_options: ClearBlockersOptions = {}): void {
  resetBodyInteractionLock();
  removeLegacyBackdrops();
  neutralizeStuckPopupLayers();
  // 遗留语音通话黑层（Vue 已卸但 DOM 残留）
  document.querySelectorAll("body > .voice-assistant-overlay").forEach((el) => {
    const node = el as HTMLElement;
    const chrome = node.querySelector(".vad-chrome, .vad-picker, .vad-fallback");
    if (!chrome || isHidden(chrome)) {
      node.style.pointerEvents = "none";
      try {
        node.remove();
      } catch {
        node.style.display = "none";
      }
    }
  });
}

export function installUiBlockerGuard(): void {
  if (guardInstalled || typeof document === "undefined") return;
  guardInstalled = true;
  clearStuckUiBlockers();
  window.addEventListener("focus", () => clearStuckUiBlockers());
  (window as unknown as { __fouClearUiBlockers?: () => void }).__fouClearUiBlockers = () =>
    clearStuckUiBlockers();
}
