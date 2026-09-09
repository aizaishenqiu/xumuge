/**
 * @file 桌面外观主题：整应用 CSS 变量 + 多窗口同步
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-20
 * @updated 2026-09-05
 * @version 1.1.0
 * @category Config
 * @algo theme-sync
 */
import { onMounted, ref, type Ref } from "vue";
import { emit, listen } from "@tauri-apps/api/event";

export type Theme = "xu" | "mist" | "ink" | "warm" | "fresh" | "sky";

const STORAGE_KEY = "xu-theme";
const LEGACY_KEY = "hermes-theme";
const THEME_DOM_EVENT = "xu-theme-change";
const THEME_TAURI_EVENT = "xu-theme-changed";

export const THEMES: Theme[] = ["xu", "mist", "ink", "warm", "fresh", "sky"];

function migrateLegacy(raw: string | null): Theme | null {
  if (!raw) return null;
  if (THEMES.includes(raw as Theme)) return raw as Theme;
  if (raw === "claude" || raw === "apple" || raw === "warp") return "xu";
  return null;
}

export function applyTheme(theme: Theme) {
  if (theme === "xu") {
    document.documentElement.removeAttribute("data-theme");
  } else {
    document.documentElement.setAttribute("data-theme", theme);
  }
}

function readStoredTheme(): Theme {
  try {
    const next = migrateLegacy(localStorage.getItem(STORAGE_KEY));
    if (next) return next;
    const legacy = migrateLegacy(localStorage.getItem(LEGACY_KEY));
    if (legacy) return legacy;
  } catch {
    /* ignore */
  }
  return "xu";
}

const theme: Ref<Theme> = ref(readStoredTheme());
let syncBound = false;

function adoptTheme(next: Theme, persist = false) {
  if (!THEMES.includes(next) || theme.value === next) return;
  theme.value = next;
  applyTheme(next);
  if (persist) {
    try {
      localStorage.setItem(STORAGE_KEY, next);
      localStorage.removeItem(LEGACY_KEY);
    } catch {
      /* ignore */
    }
  }
}

/** 启动时与各窗口间同步主题（IDE 改主题 → 主窗口办公区/岗位库同步） */
export function initThemeSync() {
  if (syncBound || typeof document === "undefined") return;
  syncBound = true;
  applyTheme(theme.value);

  window.addEventListener("storage", (e) => {
    if (e.key !== STORAGE_KEY && e.key !== LEGACY_KEY) return;
    adoptTheme(readStoredTheme());
  });

  window.addEventListener(THEME_DOM_EVENT, (e) => {
    const next = (e as CustomEvent<Theme>).detail;
    if (THEMES.includes(next)) adoptTheme(next);
  });

  void listen<Theme>(THEME_TAURI_EVENT, (ev) => {
    const next = ev.payload;
    if (!THEMES.includes(next)) return;
    adoptTheme(next, true);
  });
}

export function useTheme() {
  onMounted(() => {
    initThemeSync();
    theme.value = readStoredTheme();
    applyTheme(theme.value);
  });

  function setTheme(next: Theme) {
    theme.value = next;
    applyTheme(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
      localStorage.removeItem(LEGACY_KEY);
    } catch {
      /* ignore */
    }
    window.dispatchEvent(new CustomEvent(THEME_DOM_EVENT, { detail: next }));
    void emit(THEME_TAURI_EVENT, next).catch(() => {
      /* browser dev */
    });
  }

  function toggle() {
    setTheme(THEMES[(THEMES.indexOf(theme.value) + 1) % THEMES.length]);
  }

  return { theme, setTheme, toggle };
}
