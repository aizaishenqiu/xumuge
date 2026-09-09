import { ref } from "vue";
import { readLs, writeLs } from "../utils/xuStorage";

export type TerminalTab = {
  id: string;
  title: string;
  /** Optional cwd for this tab; falls back to workspace root in the dock */
  cwd?: string | null;
};

const HEIGHT_KEY = "xu.ide.terminalHeight";
const VISIBLE_KEY = "xu.ide.terminalVisible";
const DEFAULT_HEIGHT = 220;
const MIN_HEIGHT = 120;
const MAX_HEIGHT = 520;

let nextTerminalNum = 1;

function readHeight(): number {
  try {
    const raw = Number(readLs(HEIGHT_KEY, String(DEFAULT_HEIGHT)));
    if (!Number.isFinite(raw)) return DEFAULT_HEIGHT;
    return Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Math.round(raw)));
  } catch {
    return DEFAULT_HEIGHT;
  }
}

export function useTerminalTabs() {
  const tabs = ref<TerminalTab[]>([]);
  const activeId = ref<string | null>(null);
  const visible = ref(readLs(VISIBLE_KEY) === "1");
  const height = ref(readHeight());

  function persistHeight() {
    writeLs(HEIGHT_KEY, String(height.value));
  }

  function clampHeight(n: number): number {
    return Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Math.round(n)));
  }

  function addTab(cwd?: string | null): string {
    const id = `term-${nextTerminalNum++}`;
    const title = `终端 ${tabs.value.length + 1}`;
    tabs.value = [...tabs.value, { id, title, cwd: cwd?.trim() || null }];
    activeId.value = id;
    visible.value = true;
    writeLs(VISIBLE_KEY, "1");
    return id;
  }

  function ensureTab(): string {
    if (!tabs.value.length) return addTab();
    if (!activeId.value) activeId.value = tabs.value[0]!.id;
    visible.value = true;
    writeLs(VISIBLE_KEY, "1");
    return activeId.value;
  }

  function closeTab(id: string) {
    tabs.value = tabs.value.filter((t) => t.id !== id);
    if (activeId.value === id) {
      activeId.value = tabs.value[tabs.value.length - 1]?.id ?? null;
    }
    if (!tabs.value.length) {
      visible.value = false;
      writeLs(VISIBLE_KEY, "0");
    }
  }

  function show() {
    ensureTab();
    visible.value = true;
    writeLs(VISIBLE_KEY, "1");
  }

  function hide() {
    visible.value = false;
    writeLs(VISIBLE_KEY, "0");
  }

  function toggle() {
    if (visible.value && tabs.value.length) {
      hide();
      return;
    }
    show();
  }

  function setHeight(n: number) {
    height.value = clampHeight(n);
    persistHeight();
  }

  function selectTab(id: string) {
    activeId.value = id;
  }

  return {
    tabs,
    activeId,
    visible,
    height,
    addTab,
    ensureTab,
    closeTab,
    selectTab,
    show,
    hide,
    toggle,
    setHeight,
    MIN_HEIGHT,
    MAX_HEIGHT,
  };
}
