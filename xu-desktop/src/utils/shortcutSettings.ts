/** Screenshot global shortcut preferences (localStorage + Rust registration). */

import { invoke } from "@tauri-apps/api/core";
import { readLs, writeLs } from "./xuStorage";

export type ShortcutModifier = "Alt" | "Control" | "Shift" | "Super";

export interface ShortcutSpec {
  modifiers: ShortcutModifier[];
  code: string;
  label: string;
}

const STORAGE_KEY = "xu.shortcuts.screenshot";
const CHANGE_EVENT = "xu-shortcuts-changed";

export const DEFAULT_SCREENSHOT_SHORTCUT: ShortcutSpec = {
  modifiers: ["Alt"],
  code: "KeyA",
  label: "Alt+A",
};

const isMac = typeof navigator !== "undefined" && navigator.platform.toLowerCase().includes("mac");

export function formatShortcutLabel(spec: ShortcutSpec): string {
  if (spec.label) return spec.label;
  const parts = spec.modifiers.map((m) => {
    if (m === "Alt") return isMac ? "⌥" : "Alt";
    if (m === "Control") return isMac ? "⌃" : "Ctrl";
    if (m === "Shift") return isMac ? "⇧" : "Shift";
    if (m === "Super") return isMac ? "⌘" : "Win";
    return m;
  });
  const key = spec.code.replace(/^Key/, "").replace(/^Digit/, "");
  return [...parts, key].join(isMac ? "" : "+");
}

export function readScreenshotShortcut(): ShortcutSpec {
  try {
    const raw = readLs(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SCREENSHOT_SHORTCUT };
    const v = JSON.parse(raw) as ShortcutSpec;
    if (!v?.code || !Array.isArray(v.modifiers)) return { ...DEFAULT_SCREENSHOT_SHORTCUT };
    return {
      modifiers: v.modifiers as ShortcutModifier[],
      code: v.code,
      label: v.label || formatShortcutLabel(v as ShortcutSpec),
    };
  } catch {
    return { ...DEFAULT_SCREENSHOT_SHORTCUT };
  }
}

export function writeScreenshotShortcut(spec: ShortcutSpec): void {
  const normalized: ShortcutSpec = {
    ...spec,
    label: spec.label || formatShortcutLabel(spec),
  };
  writeLs(STORAGE_KEY, JSON.stringify(normalized));
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: normalized }));
}

export function onShortcutsChanged(handler: (spec: ShortcutSpec) => void): () => void {
  const fn = (e: Event) => {
    const detail = (e as CustomEvent<ShortcutSpec>).detail;
    handler(detail ?? readScreenshotShortcut());
  };
  window.addEventListener(CHANGE_EVENT, fn);
  return () => window.removeEventListener(CHANGE_EVENT, fn);
}

export async function applyScreenshotShortcut(spec: ShortcutSpec): Promise<void> {
  await invoke("xu_set_screenshot_shortcut", { spec });
  writeScreenshotShortcut(spec);
}

export async function syncScreenshotShortcutFromRust(): Promise<ShortcutSpec> {
  try {
    const spec = await invoke<ShortcutSpec>("xu_get_screenshot_shortcut");
    if (spec?.code) {
      writeLs(STORAGE_KEY, JSON.stringify(spec));
      return spec;
    }
  } catch {
    /* use local */
  }
  return readScreenshotShortcut();
}

export function parseKeyEvent(e: KeyboardEvent): ShortcutSpec | null {
  if (e.key === "Escape" || e.key === "Tab") return null;
  const modifiers: ShortcutModifier[] = [];
  if (e.altKey) modifiers.push("Alt");
  if (e.ctrlKey) modifiers.push("Control");
  if (e.shiftKey) modifiers.push("Shift");
  if (e.metaKey) modifiers.push("Super");

  const code = e.code;
  if (!code || code === "AltLeft" || code === "AltRight" || code === "ControlLeft" || code === "ControlRight" || code === "ShiftLeft" || code === "ShiftRight" || code === "MetaLeft" || code === "MetaRight") {
    return null;
  }

  const spec: ShortcutSpec = { modifiers, code, label: "" };
  spec.label = formatShortcutLabel(spec);
  return spec;
}

export async function bootstrapScreenshotShortcut(): Promise<void> {
  const local = readScreenshotShortcut();
  try {
    await invoke("xu_set_screenshot_shortcut", { spec: local });
  } catch (e) {
    console.warn("screenshot shortcut bootstrap", e);
  }
}
