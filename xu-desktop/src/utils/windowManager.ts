/**
 * @file windowManager.ts IDE / 主窗 / 更新窗
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-30
 * @updated 2026-09-05
 * @version 1.1.0
 * @category UI
 * @algo none
 */
import { WebviewWindow, getAllWebviewWindows } from "@tauri-apps/api/webviewWindow";
import { getCurrentWindow, type Window } from "@tauri-apps/api/window";
import { emit } from "@tauri-apps/api/event";
import { fouAlert } from "foucui";
import { onApiCatch } from "../utils/userFacingError";
import { BRAND_NAME_ZH } from "./brandSettings";
import { SCREENSHOT_OVERLAY_LABEL } from "./screenshot";

export const IDE_LABEL = "ide";
export const UPDATER_LABEL = "updater";

type AppRouter = {
  push: (to: string | { path: string; query?: Record<string, string> }) => unknown;
};

let routerRef: AppRouter | null = null;

/** Register router once from App.vue for navigation helpers. */
export function bindAppRouter(router: AppRouter) {
  routerRef = router;
}

export function getIdeWindowLabel(): string {
  try {
    return getCurrentWindow().label;
  } catch {
    return "main";
  }
}

/** Additional IDE windows created via「新建窗口」(label `ide-<timestamp>`). */
export function isSecondaryIdeWindow(): boolean {
  return getIdeWindowLabel().startsWith(`${IDE_LABEL}-`);
}

export function isPrimaryIdeWindow(): boolean {
  return getIdeWindowLabel() === IDE_LABEL;
}

export function isIdeRoute(path: string): boolean {
  return path === "/ide" || path.startsWith("/ide?");
}

export function isIdeWindow(): boolean {
  try {
    const label = getIdeWindowLabel();
    return label === IDE_LABEL || label.startsWith(`${IDE_LABEL}-`);
  } catch {
    return false;
  }
}

function appHashUrl(hashPath: string): string {
  const hash = hashPath.startsWith("#") ? hashPath : `#/${hashPath.replace(/^\//, "")}`;
  const base = window.location.origin + (window.location.pathname || "/");
  return `${base}${hash}`;
}

function ideUrl(filePath?: string, line?: number, opts?: { fresh?: boolean }): string {
  const q = new URLSearchParams();
  if (opts?.fresh) q.set("fresh", "1");
  if (filePath) q.set("file", filePath);
  if (line != null && line > 0) q.set("line", String(line));
  const qs = q.toString();
  return appHashUrl(qs ? `/ide?${qs}` : "/ide");
}

const IDE_WINDOW_OPTS = {
  title: `${BRAND_NAME_ZH} · IDE`,
  width: 1280,
  height: 800,
  minWidth: 960,
  minHeight: 600,
  decorations: false,
  maximized: true,
  visible: true,
  focus: true,
} as const;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Maximize IDE window; retries once after show (Windows timing). */
async function ensureIdeWindowMaximized(win: Window): Promise<void> {
  try {
    await win.show();
    await win.maximize();
    if (await win.isMaximized()) return;
    await sleep(120);
    await win.maximize();
    if (!(await win.isMaximized())) {
      console.warn("ensureIdeWindowMaximized: window still not maximized after retry");
    }
  } catch (e) {
    console.warn("ensureIdeWindowMaximized", e);
  }
}

async function waitForWebviewWindow(created: WebviewWindow): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    created.once("tauri://created", () => resolve());
    created.once("tauri://error", (e) => reject(e));
  });
}

/** Open or focus the primary IDE window (singleton label `ide`). */
export async function focusIdeWindow(filePath?: string, line?: number): Promise<void> {
  const openInMain = () => {
    if (filePath) {
      const q: Record<string, string> = { file: filePath };
      if (line != null && line > 0) q.line = String(line);
      routerRef?.push({ path: "/ide", query: q });
    } else {
      routerRef?.push("/ide");
    }
  };

  /** Duty: 主窗若被 fallback 成了 /ide，拉回首页对话（勿动 canvas 等其它路由）。 */
  const restoreMainHomeIfNeeded = () => {
    if (!isMainWindow()) return;
    try {
      const hash = typeof window !== "undefined" ? window.location.hash : "";
      if (!/^#\/ide(\?|$)/.test(hash)) return;
      routerRef?.push("/home");
    } catch {
      /* ignore */
    }
  };

  try {
    const url = ideUrl(filePath, line);

    let win = await WebviewWindow.getByLabel(IDE_LABEL);

    if (!win) {
      const created = new WebviewWindow(IDE_LABEL, {
        ...IDE_WINDOW_OPTS,
        url,
      });
      await waitForWebviewWindow(created);
      await ensureIdeWindowMaximized(created);
      restoreMainHomeIfNeeded();
      return;
    }
    await ensureIdeWindowMaximized(win);
    await win.setFocus();
    if (filePath) {
      // 仅 Tauri 跨窗 emit：勿再派本窗 CustomEvent，否则易与主窗监听形成风暴
      void emit("xu:open-in-editor", { path: filePath, line });
    }
    restoreMainHomeIfNeeded();
  } catch (e) {
    console.error("focusIdeWindow", e);
    // 主窗是对话首页：禁止 fallback 到 /ide 占用首页；尽量再聚焦已有 IDE 窗
    if (isMainWindow()) {
      try {
        const existing = await WebviewWindow.getByLabel(IDE_LABEL);
        if (existing) {
          await existing.setFocus();
          if (filePath) void emit("xu:open-in-editor", { path: filePath, line });
          restoreMainHomeIfNeeded();
          return;
        }
      } catch {
        /* ignore */
      }
      void fouAlert("独立 IDE 窗口打开失败，请点击标题栏「IDE」重试。", "IDE");
      restoreMainHomeIfNeeded();
      return;
    }
    void fouAlert("独立 IDE 窗口打开失败，已在当前窗口打开", "IDE");
    openInMain();
  }
}

/** Open an additional IDE window (File → 新建窗口) — empty workspace, no shared project. */
export async function openNewIdeWindow(): Promise<void> {
  const label = `${IDE_LABEL}-${Date.now()}`;
  try {
    const created = new WebviewWindow(label, {
      ...IDE_WINDOW_OPTS,
      url: ideUrl(undefined, undefined, { fresh: true }),
    });
    await waitForWebviewWindow(created);
    await ensureIdeWindowMaximized(created);
  } catch (e) {
    console.error("openNewIdeWindow", e);
    void onApiCatch(e, undefined, { fallback: "新建 IDE 窗口失败" });
  }
}

/** Fallback: maximize when IDE page loads inside a dedicated IDE window. */
export async function ensureCurrentIdeWindowMaximized(): Promise<void> {
  if (!isIdeWindow()) return;
  await ensureIdeWindowMaximized(getCurrentWindow());
}

export function focusChatWindow(): void {
  routerRef?.push("/home");
}

export function isMainWindow(): boolean {
  try {
    const l = getCurrentWindow().label;
    return l === "main" || l === "chat";
  } catch {
    return true;
  }
}

export function isUpdaterWindow(): boolean {
  try {
    return getCurrentWindow().label === UPDATER_LABEL;
  } catch {
    return false;
  }
}

function updaterUrl(): string {
  return appHashUrl("/updater");
}

const UPDATER_WINDOW_OPTS = {
  title: `${BRAND_NAME_ZH} · 软件更新`,
  width: 420,
  height: 220,
  minWidth: 360,
  minHeight: 180,
  resizable: false,
  decorations: true,
  center: true,
  alwaysOnTop: true,
  visible: true,
  focus: true,
} as const;

/**
 * Duty: 隐藏主窗 / IDE 等业务窗（保留更新窗），供下载安装前「先关闭软件」观感。
 * 失败: 忽略单窗错误。
 */
export async function hideBusinessWindowsForUpdate(): Promise<void> {
  try {
    const wins = await getAllWebviewWindows();
    for (const w of wins) {
      const label = w.label;
      if (label === UPDATER_LABEL) continue;
      if (label === SCREENSHOT_OVERLAY_LABEL) {
        try {
          await w.close();
        } catch {
          /* ignore */
        }
        continue;
      }
      try {
        await w.hide();
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
}

/**
 * Duty: 更新失败时重新显示先前隐藏的业务窗。
 */
export async function restoreBusinessWindowsAfterUpdate(): Promise<void> {
  try {
    const wins = await getAllWebviewWindows();
    for (const w of wins) {
      if (w.label === UPDATER_LABEL) continue;
      try {
        await w.show();
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
}

/**
 * Duty: 打开或聚焦独立更新进度窗（label `updater`）。
 * 失败: 抛出给调用方 fouAlert。
 */
export async function openUpdaterWindow(): Promise<WebviewWindow> {
  let win = await WebviewWindow.getByLabel(UPDATER_LABEL);
  if (!win) {
    const created = new WebviewWindow(UPDATER_LABEL, {
      ...UPDATER_WINDOW_OPTS,
      url: updaterUrl(),
    });
    await waitForWebviewWindow(created);
    win = created;
  }
  await win.show();
  await win.setFocus();
  return win;
}

/** Duty: 关闭更新窗（失败忽略）。 */
export async function closeUpdaterWindow(): Promise<void> {
  try {
    const win = await WebviewWindow.getByLabel(UPDATER_LABEL);
    if (win) await win.close();
  } catch {
    /* ignore */
  }
}
