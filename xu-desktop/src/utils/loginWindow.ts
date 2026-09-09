/**
 * Login shell window sizing (QQ / WeChat style compact frame).
 * @author qiuye <yjk150@qq.com>
 */
import { LogicalSize } from "@tauri-apps/api/dpi";
import { getCurrentWindow } from "@tauri-apps/api/window";

export const LOGIN_WINDOW = { width: 600, height: 350 } as const;
export const LOGIN_ROLE_WINDOW = { width: 600, height: 480 } as const;
export const MAIN_WINDOW = {
  width: 1280,
  height: 800,
  minWidth: 960,
  minHeight: 600,
} as const;

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

function isMainWindowLabel(label: string): boolean {
  return label === "main";
}

async function applyFixedWindow(width: number, height: number): Promise<void> {
  try {
    const win = getCurrentWindow();
    if (!isMainWindowLabel(win.label)) return;
    try {
      await win.unmaximize();
    } catch {
      /* not maximized */
    }
    await win.setResizable(false);
    await win.setMinSize(null);
    await win.setMinSize(new LogicalSize(width, height));
    await win.setSize(new LogicalSize(width, height));
    await sleep(30);
    await win.setSize(new LogicalSize(width, height));
    await win.center();
  } catch (e) {
    console.warn("[login-window] applyFixedWindow", e);
  }
}

export async function applyLoginWindowSize(): Promise<void> {
  await applyFixedWindow(LOGIN_WINDOW.width, LOGIN_WINDOW.height);
}

export async function applyLoginRoleWindowSize(): Promise<void> {
  await applyFixedWindow(LOGIN_ROLE_WINDOW.width, LOGIN_ROLE_WINDOW.height);
}

export async function restoreMainWindowSize(): Promise<void> {
  try {
    const win = getCurrentWindow();
    if (!isMainWindowLabel(win.label)) return;
    await win.setResizable(true);
    await win.setMinSize(new LogicalSize(MAIN_WINDOW.minWidth, MAIN_WINDOW.minHeight));
    await win.setSize(new LogicalSize(MAIN_WINDOW.width, MAIN_WINDOW.height));
    await win.center();
  } catch (e) {
    console.warn("[login-window] restoreMainWindowSize", e);
  }
}

export async function minimizeLoginWindow(): Promise<void> {
  try {
    await getCurrentWindow().minimize();
  } catch {
    /* ignore */
  }
}

export async function closeLoginWindow(): Promise<void> {
  try {
    await getCurrentWindow().close();
  } catch {
    /* ignore */
  }
}
