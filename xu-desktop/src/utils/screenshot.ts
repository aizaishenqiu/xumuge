/**
 * @file screenshot.ts — single-owner screenshot sessions and binary PNG export
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-30
 * @updated 2026-08-31
 * @version 1.3.0
 * @category Stream
 * @algo Rust owner lease + path-based chat attach
 */

import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { onApiCatch, toUserError } from "./userFacingError";
import { emit, emitTo, listen, once } from "@tauri-apps/api/event";
import { save } from "@tauri-apps/plugin-dialog";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { LogicalPosition, LogicalSize, PhysicalPosition, PhysicalSize } from "@tauri-apps/api/dpi";
import {
  availableMonitors,
  cursorPosition,
  getCurrentWindow,
  monitorFromPoint,
  type Monitor,
} from "@tauri-apps/api/window";

export type CaptureTarget = "monitor" | "cursor-window";

const SCREENSHOT_START = "xu-screenshot-start";
export const SCREENSHOT_SESSION_KEY = "xu.screenshot.session";
export const SCREENSHOT_OVERLAY_LABEL = "xu-screenshot-overlay";
export const SCREENSHOT_OVERLAY_READY = "xu-screenshot-overlay-ready";
export const SCREENSHOT_BEGIN = "xu-screenshot-begin";

let screenshotBusy = false;
let screenshotSessionGen = 0;

function bumpScreenshotSession(): number {
  screenshotSessionGen += 1;
  return screenshotSessionGen;
}

async function focusMainWindow(): Promise<void> {
  try {
    const main = await WebviewWindow.getByLabel("main");
    if (!main) return;
    if (await main.isMinimized()) await main.unminimize();
    await main.show();
    await main.setFocus();
  } catch {
    /* ignore */
  }
}

export type CaptureWindowInfo = {
  id: number;
  title: string;
  appName: string;
  x: number;
  y: number;
  width: number;
  height: number;
  z: number;
};

/** Trigger screenshot (opens dedicated overlay window — does not resize main/chat/ide). */
export function openScreenshotSession(): void {
  void beginScreenshotSession();
}

/** @deprecated use openScreenshotSession */
export function startRegionScreenshot() {
  openScreenshotSession();
}

export function setScreenshotActive(active: boolean): void {
  void emit("xu-screenshot-active", { active });
}


function logicalBounds(bounds: MonitorCaptureBounds) {
  const s = bounds.scaleFactor > 0 ? bounds.scaleFactor : 1;
  return {
    x: Math.round(bounds.x / s),
    y: Math.round(bounds.y / s),
    width: Math.round(bounds.width / s),
    height: Math.round(bounds.height / s),
  };
}

async function overlayCoverRect(
  bounds: MonitorCaptureBounds,
): Promise<{ x: number; y: number; width: number; height: number }> {
  try {
    const pos = await cursorPosition();
    const mon = await monitorFromPoint(pos.x, pos.y);
    if (mon) {
      return {
        x: mon.position.x,
        y: mon.position.y,
        width: mon.size.width,
        height: mon.size.height,
      };
    }
  } catch {
    /* fall through to xcap bounds */
  }
  return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
}

async function fitOverlayToMonitor(
  win: WebviewWindow,
  bounds: MonitorCaptureBounds,
): Promise<void> {
  const rect = await overlayCoverRect(bounds);
  try {
    await win.setResizable(false);
  } catch {
    /* ignore */
  }
  try {
    await win.setMinSize(null);
  } catch {
    /* ignore */
  }
  try {
    await win.unmaximize();
  } catch {
    /* ignore */
  }
  try {
    await win.setAlwaysOnTop(true);
  } catch {
    /* ignore */
  }
  await win.setPosition(new PhysicalPosition(rect.x, rect.y));
  await win.setSize(new PhysicalSize(rect.width, rect.height));
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: number | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = window.setTimeout(() => reject(new Error(`${label}超时（${Math.round(ms / 1000)}s）`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer !== undefined) window.clearTimeout(timer);
  }
}

async function waitOverlayReady(ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      resolve(ok);
    };
    void once(SCREENSHOT_OVERLAY_READY, () => finish(true))
      .then((unlisten) => {
        if (done) unlisten();
      })
      .catch(() => finish(false));
    window.setTimeout(() => finish(false), ms);
  });
}

async function pushSessionToOverlay(payload: MonitorCaptureBounds): Promise<void> {
  try {
    await emitTo(SCREENSHOT_OVERLAY_LABEL, SCREENSHOT_BEGIN, payload);
  } catch {
    await emit(SCREENSHOT_BEGIN, payload);
  }
  try {
    await emitTo(SCREENSHOT_OVERLAY_LABEL, SCREENSHOT_IMAGE_READY, payload);
  } catch {
    await emit(SCREENSHOT_IMAGE_READY, payload);
  }
}

/** Create or reuse the overlay webview. Hidden until PNG is ready so it is not in the capture. */
export async function openScreenshotOverlayWindow(
  bounds: MonitorCaptureBounds,
  opts?: { visible?: boolean },
): Promise<{ win: WebviewWindow; created: boolean }> {
  const { WebviewWindow: WW } = await import("@tauri-apps/api/webviewWindow");
  const visible = opts?.visible ?? true;
  const existing = await WW.getByLabel(SCREENSHOT_OVERLAY_LABEL);
  if (existing) {
    try {
      await existing.hide();
    } catch {
      /* ignore */
    }
    await fitOverlayToMonitor(existing, bounds);
    return { win: existing, created: false };
  }
  const lb = logicalBounds(bounds);
  const win = new WW(SCREENSHOT_OVERLAY_LABEL, {
    url: "/#/screenshot-overlay",
    title: "xu-screenshot",
    width: lb.width,
    height: lb.height,
    x: lb.x,
    y: lb.y,
    decorations: false,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    focus: visible,
    visible: false,
  });
  await new Promise<void>((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    win.once("tauri://created", finish);
    win.once("tauri://error", (e) => {
      console.error("screenshot overlay window", e);
      setScreenshotActive(false);
      finish();
    });
    window.setTimeout(finish, 4000);
  });
  await fitOverlayToMonitor(win, bounds);
  return { win, created: true };
}

export async function closeScreenshotOverlayWindow(
  owner?: string | null,
  token?: string | null,
): Promise<void> {
  bumpScreenshotSession();
  setScreenshotActive(false);
  await releaseScreenshotOwner(owner, token);
  try {
    localStorage.removeItem(SCREENSHOT_SESSION_KEY);
  } catch {
    /* ignore */
  }
  try {
    const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    const win = await WebviewWindow.getByLabel(SCREENSHOT_OVERLAY_LABEL);
    if (win) {
      try {
        await win.hide();
      } catch {
        /* ignore */
      }
    }
  } catch (e) {
    console.warn("closeScreenshotOverlayWindow", e);
  }
  await focusMainWindow();
}

/** Release the Rust screenshot owner lease; mismatched stale owners are ignored. */
export async function releaseScreenshotOwner(
  owner: string | null | undefined,
  token: string | null | undefined,
): Promise<void> {
  if (!owner || !token) return;
  try {
    await invoke<boolean>("xu_screenshot_release", { owner, token });
  } catch (error) {
    console.warn("[screenshot] owner release failed", error);
  }
}

export function readScreenshotSession(): MonitorCaptureBounds | null {
  try {
    const raw = localStorage.getItem(SCREENSHOT_SESSION_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as MonitorCaptureBounds;
  } catch {
    return null;
  }
}

export function onScreenshotStart(handler: () => void): () => void {
  const fn = () => handler();
  window.addEventListener(SCREENSHOT_START, fn);
  return () => window.removeEventListener(SCREENSHOT_START, fn);
}

export async function listenScreenshotHotkey(handler: () => void): Promise<() => void> {
  const unlisten = await listen(SCREENSHOT_START, () => handler());
  return unlisten;
}

export async function copyImageToClipboard(pngDataUrl: string): Promise<void> {
  await invoke("xu_clipboard_set_image", { pngBase64: pngDataUrl });
}

/** One IPC-friendly number list; avoid repeating Array.from on large PNGs. */
function pngBytesForIpc(pngBytes: Uint8Array): number[] {
  return Array.from(pngBytes);
}

/** Copy binary PNG to the OS clipboard; errors are surfaced to the caller. */
export async function copyImageBytesToClipboard(pngBytes: Uint8Array): Promise<void> {
  await invoke("xu_clipboard_set_image_bytes", { pngBytes: pngBytesForIpc(pngBytes) });
}

export async function savePngToFile(pngDataUrl: string): Promise<void> {
  const path = await save({
    filters: [{ name: "PNG", extensions: ["png"] }],
    defaultPath: `screenshot-${Date.now()}.png`,
  });
  if (!path) return;
  await invoke("xu_write_png_file", { path, pngBase64: pngDataUrl });
}

/** Save binary PNG after a native file dialog, avoiding synchronous canvas serialization. */
export async function savePngBytesToFile(pngBytes: Uint8Array): Promise<void> {
  const path = await save({
    filters: [{ name: "PNG", extensions: ["png"] }],
    defaultPath: `screenshot-${Date.now()}.png`,
  });
  if (!path) return;
  await invoke("xu_write_png_file_bytes", { path, pngBytes: pngBytesForIpc(pngBytes) });
}

/** Persist edited PNG in bounded app data and return path + main-webview asset URL. */
export async function writeScreenshotAttachment(
  pngBytes: Uint8Array,
  ipcBytes?: number[],
): Promise<{ path: string; url: string }> {
  const path = await invoke<string>("xu_write_screenshot_temp", {
    pngBytes: ipcBytes ?? pngBytesForIpc(pngBytes),
  });
  return { path, url: screenshotFileUrl(path) };
}

/**
 * Write temp PNG and copy clipboard in parallel with a single Array.from.
 * Dependency: xu_write_screenshot_temp + xu_clipboard_set_image_bytes.
 * Failure: either step rejects; caller should surface fouAlert.
 */
export async function exportScreenshotPng(
  pngBytes: Uint8Array,
): Promise<{ path: string; url: string }> {
  const ipcBytes = pngBytesForIpc(pngBytes);
  const [attachment] = await Promise.all([
    writeScreenshotAttachment(pngBytes, ipcBytes),
    invoke("xu_clipboard_set_image_bytes", { pngBytes: ipcBytes }),
  ]);
  return attachment;
}

export async function pinImageToScreen(pngDataUrl: string): Promise<void> {
  const id = `xu-pin-${Date.now()}`;
  const html = `<!DOCTYPE html><html><head><style>
    *{margin:0}body{background:transparent;overflow:hidden}
    img{width:100vw;height:100vh;object-fit:contain;pointer-events:none}
  </style></head><body><img src="${pngDataUrl}" /></body></html>`;
  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const win = new WebviewWindow(id, {
    url,
    title: "固定截图",
    width: 480,
    height: 320,
    resizable: true,
    decorations: true,
    alwaysOnTop: true,
    skipTaskbar: false,
  });
  win.once("tauri://created", () => {
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  });
}

async function filePathToDataUrl(path: string): Promise<string> {
  return await invoke<string>("xu_read_image_data_url", { path });
}

export type SavedWindowState = {
  position: PhysicalPosition;
  size: PhysicalSize;
  decorations: boolean;
  alwaysOnTop: boolean;
  maximized: boolean;
};

export type CaptureMonitorInfo = {
  screenshotId: number;
  monitor: Monitor | null;
};

export type MonitorCaptureBounds = {
  path: string;
  x: number;
  y: number;
  width: number;
  height: number;
  scaleFactor: number;
  monitorId: number;
  name: string;
  ownerWindow?: string;
  leaseToken?: string;
};

type ScreenshotLeaseGrant = {
  token: string;
  ttlMs: number;
};

/** Fast monitor metadata at cursor (no PNG capture). */
export async function monitorBoundsAtCursor(): Promise<MonitorCaptureBounds> {
  const pos = await cursorPosition();
  return invoke<MonitorCaptureBounds>("xu_monitor_bounds_at_point", {
    x: pos.x,
    y: pos.y,
  });
}

/** Capture monitor under cursor via Rust/xcap (path only — no base64). */
export async function captureMonitorAtCursor(
  owner: string,
  token: string,
): Promise<MonitorCaptureBounds> {
  const pos = await cursorPosition();
  return invoke<MonitorCaptureBounds>("xu_capture_monitor_at_point", {
    owner,
    token,
    x: pos.x,
    y: pos.y,
  });
}

export const SCREENSHOT_IMAGE_READY = "xu-screenshot-image-ready";

let lastBusyAt = 0;

/** Capture in parallel with a hidden overlay window, then show when PNG is ready. */
export async function beginScreenshotSession(): Promise<void> {
  if (screenshotBusy && Date.now() - lastBusyAt < 20_000) return;
  screenshotBusy = true;
  lastBusyAt = Date.now();
  const gen = bumpScreenshotSession();
  const ownerWindow = getCurrentWindow().label;
  let lease: ScreenshotLeaseGrant | null = null;
  let sessionHandedOff = false;
  const startedAt = performance.now();
  try {
    lease = await invoke<ScreenshotLeaseGrant | null>("xu_screenshot_acquire", {
      owner: ownerWindow,
    });
  } catch (error) {
    screenshotBusy = false;
    throw error;
  }
  if (!lease) {
    screenshotBusy = false;
    return;
  }
  setScreenshotActive(true);
  try {
    try {
      const { WebviewWindow: WW } = await import("@tauri-apps/api/webviewWindow");
      const existing = await WW.getByLabel(SCREENSHOT_OVERLAY_LABEL);
      if (existing) await existing.hide();
    } catch {
      /* ignore */
    }

    const bounds = await withTimeout(monitorBoundsAtCursor(), 4000, "读取显示器");
    if (gen !== screenshotSessionGen) return;

    const pending: MonitorCaptureBounds = {
      ...bounds,
      path: "",
      ownerWindow,
      leaseToken: lease.token,
    };
    try {
      localStorage.setItem(SCREENSHOT_SESSION_KEY, JSON.stringify(pending));
    } catch {
      /* ignore */
    }

    const { WebviewWindow: WW } = await import("@tauri-apps/api/webviewWindow");
    const already = await WW.getByLabel(SCREENSHOT_OVERLAY_LABEL);
    const readyWait = already ? null : waitOverlayReady(15000);

    const captureP = withTimeout(
      captureMonitorAtCursor(ownerWindow, lease.token),
      12000,
      "截屏",
    );
    const winP = openScreenshotOverlayWindow(bounds, { visible: false });

    const [rawCaptured, overlay] = await Promise.all([captureP, winP]);
    const captured: MonitorCaptureBounds = {
      ...rawCaptured,
      ownerWindow,
      leaseToken: lease.token,
    };
    if (gen !== screenshotSessionGen) {
      try {
        await overlay.win.hide();
      } catch {
        /* ignore */
      }
      return;
    }

    try {
      localStorage.setItem(SCREENSHOT_SESSION_KEY, JSON.stringify(captured));
    } catch {
      /* ignore */
    }

    if (readyWait) {
      const ok = await readyWait;
      if (!ok && overlay.created) {
        throw new Error("截图窗口启动超时，请再试一次");
      }
    }
    if (gen !== screenshotSessionGen) return;

    await fitOverlayToMonitor(overlay.win, captured);
    await pushSessionToOverlay(captured);

    try {
      await overlay.win.show();
      await overlay.win.setFocus();
      sessionHandedOff = true;
      console.info(`[screenshot:perf] ready ${Math.round(performance.now() - startedAt)}ms`);
    } catch (e) {
      console.warn("show screenshot overlay", e);
    }
  } catch (e) {
    setScreenshotActive(false);
    await releaseScreenshotOwner(ownerWindow, lease?.token);
    console.error("beginScreenshotSession", e);
    try {
      const { fouMsg } = await import("foucui");
      void onApiCatch(e);
    } catch {
      /* ignore */
    }
  } finally {
    if (lease && !sessionHandedOff) {
      await releaseScreenshotOwner(ownerWindow, lease.token);
    }
    screenshotBusy = false;
  }
}

export async function windowRectAtScreenPoint(
  x: number,
  y: number,
): Promise<CaptureWindowInfo | null> {
  const hit = await invoke<CaptureWindowInfo | null>("xu_window_rect_at_point", { x, y });
  return hit ?? null;
}

export function screenshotFileUrl(path: string): string {
  return convertFileSrc(path);
}

export async function listCaptureWindows(): Promise<CaptureWindowInfo[]> {
  return invoke<CaptureWindowInfo[]>("xu_list_capture_windows");
}

/** Expand main window to cover captured monitor bounds (physical pixels from xcap). */
export async function resolveCaptureMonitor(): Promise<CaptureMonitorInfo> {
  const api = await import("tauri-plugin-screenshots-api");
  const shotMonitors = await api.getScreenshotableMonitors();
  if (!shotMonitors.length) throw new Error("未找到显示器");

  let screenshotId = shotMonitors[0]!.id;
  let monitor: Monitor | null = null;

  try {
    const pos = await cursorPosition();
    monitor = await monitorFromPoint(pos.x, pos.y);
    const tauriMonitors = await availableMonitors();

    const px = pos.x;
    const py = pos.y;
    let idx = tauriMonitors.findIndex((m) => {
      const left = m.position.x;
      const top = m.position.y;
      return px >= left && px < left + m.size.width && py >= top && py < top + m.size.height;
    });

    if (idx < 0 && monitor) {
      idx = tauriMonitors.findIndex(
        (m) =>
          m.position.x === monitor!.position.x &&
          m.position.y === monitor!.position.y &&
          m.size.width === monitor!.size.width &&
          m.size.height === monitor!.size.height,
      );
    }

    if (idx >= 0 && idx < shotMonitors.length) {
      screenshotId = shotMonitors[idx]!.id;
      monitor = tauriMonitors[idx] ?? monitor;
    } else if (monitor?.name?.trim()) {
      const name = monitor.name.trim();
      const exact = shotMonitors.find((m) => m.name === name);
      if (exact) screenshotId = exact.id;
      else {
        const fuzzy = shotMonitors.find(
          (m) => m.name.includes(name) || name.includes(m.name),
        );
        if (fuzzy) screenshotId = fuzzy.id;
      }
    }
  } catch (e) {
    console.warn("resolveCaptureMonitor", e);
  }

  return { screenshotId, monitor };
}

/** Capture a specific monitor by plugin id (use resolveCaptureMonitor first). */
export async function captureMonitorScreenshot(
  screenshotId: number,
): Promise<{ dataUrl: string; filename: string }> {
  const api = await import("tauri-plugin-screenshots-api");
  const path = await api.getMonitorScreenshot(screenshotId);
  return {
    dataUrl: await filePathToDataUrl(path),
    filename: `monitor-${screenshotId}.png`,
  };
}

/** Expand current window to cover captured monitor bounds (overlay window only). */
export async function expandWindowToBounds(bounds: MonitorCaptureBounds): Promise<SavedWindowState> {
  const win = getCurrentWindow();
  const maximized = await win.isMaximized();
  const prev: SavedWindowState = {
    position: await win.outerPosition(),
    size: await win.outerSize(),
    decorations: await win.isDecorated(),
    alwaysOnTop: await win.isAlwaysOnTop(),
    maximized,
  };
  if (maximized) await win.unmaximize();
  await win.setAlwaysOnTop(true);
  const s = bounds.scaleFactor > 0 ? bounds.scaleFactor : 1;
  await win.setPosition(new LogicalPosition(bounds.x / s, bounds.y / s));
  await win.setSize(new LogicalSize(bounds.width / s, bounds.height / s));
  return prev;
}

/** Expand main window to cover target monitor so overlay coords match capture. */
export async function expandWindowToMonitor(monitor: Monitor): Promise<SavedWindowState> {
  const win = getCurrentWindow();
  const maximized = await win.isMaximized();
  const prev: SavedWindowState = {
    position: await win.outerPosition(),
    size: await win.outerSize(),
    decorations: await win.isDecorated(),
    alwaysOnTop: await win.isAlwaysOnTop(),
    maximized,
  };
  const scale = monitor.scaleFactor;
  if (maximized) await win.unmaximize();
  await win.setAlwaysOnTop(true);
  await win.setPosition(monitor.position.toLogical(scale));
  await win.setSize(monitor.size.toLogical(scale));
  return prev;
}

export async function restoreCaptureWindow(state: SavedWindowState | null): Promise<void> {
  if (!state) return;
  const win = getCurrentWindow();
  try {
    await win.setAlwaysOnTop(false);
    if (await win.isMaximized()) await win.unmaximize();
    await win.setPosition(state.position);
    await win.setSize(state.size);
    if (state.maximized) await win.maximize();
    else await win.setAlwaysOnTop(state.alwaysOnTop);
  } catch (e) {
    console.warn("restoreCaptureWindow", e);
  }
}

export async function captureScreenToDataUrl(
  target: CaptureTarget = "monitor",
): Promise<{ dataUrl: string; filename: string }> {
  try {
    if (target === "monitor") {
      const owner = getCurrentWindow().label;
      const lease = await invoke<ScreenshotLeaseGrant | null>("xu_screenshot_acquire", { owner });
      if (!lease) throw new Error("已有截图任务正在运行");
      try {
        const captured = await captureMonitorAtCursor(owner, lease.token);
        return {
          dataUrl: screenshotFileUrl(captured.path),
          filename: `monitor-${captured.monitorId}.jpg`,
        };
      } finally {
        await releaseScreenshotOwner(owner, lease.token);
      }
    }

    if (target === "cursor-window") {
      const api = await import("tauri-plugin-screenshots-api");
      const windows = await api.getScreenshotableWindows();
      const hit =
        windows.find((w) => /cursor/i.test(w.title) || /cursor/i.test(w.appName) || /cursor/i.test(w.name)) ??
        windows[0];
      if (!hit) throw new Error("未找到可截取的窗口");
      const path = await api.getWindowScreenshot(hit.id);
      return {
        dataUrl: screenshotFileUrl(path),
        filename: `window-${hit.id}.png`,
      };
    }

    throw new Error("未支持的截屏目标");
  } catch (e) {
    const msg = toUserError(e);
    if (/permission|denied|录屏|screen/i.test(msg)) {
      throw new Error(`截屏失败（可能缺少屏幕录制权限）：${msg}`);
    }
    throw new Error(`截屏失败：${msg}`);
  }
}

/** Pending composer image: prefer file path (small IPC); dataUrl kept for paste/legacy. */
export type PendingChatImage = {
  filename: string;
  dataUrl?: string;
  path?: string;
};

function publishPendingChatImage(payload: PendingChatImage): void {
  try {
    // Never put multi-MB data URLs into localStorage — path-only stays tiny.
    const stored: PendingChatImage = payload.path
      ? { path: payload.path, filename: payload.filename }
      : payload.dataUrl?.startsWith("data:") && payload.dataUrl.length > 200_000
        ? { filename: payload.filename, path: payload.path }
        : payload;
    if (stored.path || stored.dataUrl) {
      localStorage.setItem("xu.pendingChatImage", JSON.stringify(stored));
    }
  } catch {
    /* ignore quota */
  }
  void emit("xu-attach-chat-image", payload);
  window.dispatchEvent(new CustomEvent("xu-attach-chat-image", { detail: payload }));
}

/** Notify chat to attach an image data URL (paste / office); persist lightly when small. */
export function attachImageToChat(dataUrl: string, filename?: string) {
  publishPendingChatImage({
    dataUrl,
    filename: filename || `capture-${Date.now()}.png`,
  });
}

/**
 * Attach a screenshot file path into chat; main webview builds preview via convertFileSrc.
 * Dependency: path under screenshot temp dir; chat resolves preview/send separately.
 */
export function attachScreenshotPathToChat(path: string, filename?: string) {
  const name = filename || `capture-${Date.now()}.png`;
  publishPendingChatImage({
    path,
    filename: name,
    // Hint for same-webview callers; cross-webview listeners should rebuild from path.
    dataUrl: screenshotFileUrl(path),
  });
}

export function takePendingChatImage(): PendingChatImage | null {
  try {
    const raw = localStorage.getItem("xu.pendingChatImage");
    if (!raw) return null;
    localStorage.removeItem("xu.pendingChatImage");
    const v = JSON.parse(raw) as PendingChatImage;
    if (!v?.path && !v?.dataUrl) return null;
    return {
      path: v.path,
      dataUrl: v.dataUrl,
      filename: v.filename || "capture.png",
    };
  } catch {
    return null;
  }
}

export function peekPendingChatImage(): PendingChatImage | null {
  try {
    const raw = localStorage.getItem("xu.pendingChatImage");
    if (!raw) return null;
    const v = JSON.parse(raw) as PendingChatImage;
    if (!v?.path && !v?.dataUrl) return null;
    return {
      path: v.path,
      dataUrl: v.dataUrl,
      filename: v.filename || "capture.png",
    };
  } catch {
    return null;
  }
}
