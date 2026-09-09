/**
 * @file officeWindowFullscreen.ts 办公室沉浸：Tauri/浏览器真全屏（隐藏任务栏）
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-30
 * @version 1.1.0
 * @category UI
 * @algo tauri-window-fullscreen
 */

import { invoke } from "@tauri-apps/api/core";
import {
  currentMonitor,
  getCurrentWindow,
  LogicalPosition,
  LogicalSize,
} from "@tauri-apps/api/window";

function inTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

type SavedBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
  maximized: boolean;
};

let savedBounds: SavedBounds | null = null;

/** 进入沉浸前保存窗口几何，退出时恢复 */
async function rememberWindowBounds(): Promise<void> {
  if (!inTauri() || savedBounds) return;
  const win = getCurrentWindow();
  const [pos, size, maximized] = await Promise.all([
    win.outerPosition(),
    win.outerSize(),
    win.isMaximized(),
  ]);
  savedBounds = {
    x: pos.x,
    y: pos.y,
    width: size.width,
    height: size.height,
    maximized,
  };
}

/** 退出沉浸后恢复进入前的窗口状态 */
async function restoreWindowBounds(): Promise<void> {
  if (!inTauri() || !savedBounds) return;
  const win = getCurrentWindow();
  const snap = savedBounds;
  savedBounds = null;
  if (snap.maximized) {
    await win.maximize();
    return;
  }
  await win.unmaximize();
  await win.setSize(new LogicalSize(snap.width, snap.height));
  await win.setPosition(new LogicalPosition(snap.x, snap.y));
}

/** setFullscreen 权限不足时：铺满当前显示器（仍尽力隐藏任务栏区域） */
async function coverCurrentMonitor(): Promise<void> {
  const win = getCurrentWindow();
  const mon = await currentMonitor();
  if (!mon) return;
  await win.unmaximize();
  await win.setPosition(mon.position);
  await win.setSize(mon.size);
}

/** 调用 Rust 沉浸命令；失败时退回 JS API */
async function setImmersiveNative(on: boolean): Promise<void> {
  const win = getCurrentWindow();
  try {
    await invoke("xu_office_set_immersive", { on });
  } catch (e) {
    console.warn("[xu] xu_office_set_immersive", e);
    await win.setFullscreen(on);
  }
}

/** 进入系统级全屏（Windows 隐藏任务栏） */
export async function enterWindowFullscreen(): Promise<void> {
  if (inTauri()) {
    const win = getCurrentWindow();
    await rememberWindowBounds();
    await setImmersiveNative(true);
    const ok = await win.isFullscreen();
    if (!ok) await coverCurrentMonitor();
    return;
  }
  if (document.fullscreenElement) return;
  await document.documentElement.requestFullscreen?.();
}

/** 退出系统级全屏 */
export async function exitWindowFullscreen(): Promise<void> {
  if (inTauri()) {
    const win = getCurrentWindow();
    await setImmersiveNative(false);
    if (await win.isFullscreen()) await win.setFullscreen(false);
    await restoreWindowBounds();
    return;
  }
  if (document.fullscreenElement) await document.exitFullscreen();
}

/** 监听用户从系统退出全屏（Esc / Win+D 等），回调同步 UI 状态 */
export function bindWindowFullscreenExit(onExit: () => void): () => void {
  let disposed = false;
  const onDocFs = () => {
    if (!document.fullscreenElement) onExit();
  };
  document.addEventListener("fullscreenchange", onDocFs);

  let unlistenResize: (() => void) | null = null;
  void (async () => {
    if (!inTauri() || disposed) return;
    const win = getCurrentWindow();
    unlistenResize = await win.onResized(async () => {
      if (disposed) return;
      try {
        if (!(await win.isFullscreen())) onExit();
      } catch {
        /* ignore */
      }
    });
  })();

  return () => {
    disposed = true;
    document.removeEventListener("fullscreenchange", onDocFs);
    unlistenResize?.();
    unlistenResize = null;
  };
}
