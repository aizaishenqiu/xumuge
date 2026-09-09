import { ref, watch } from "vue";
import { readLs, writeLs } from "../utils/xuStorage";

export type TerminalBg = "dark" | "glass" | "ocean" | "sunset" | "forest";

export const TERMINAL_BGS: TerminalBg[] = ["dark", "glass", "ocean", "sunset", "forest"];

const STORAGE_KEY = "xu.terminal.bg";
const LEGACY_KEY = "hermes-terminal-bg";

export function xtermBackground(bg: TerminalBg): string {
  if (bg === "dark") return "#0d1117";
  if (bg === "glass") return "rgba(13, 17, 23, 0.52)";
  return "rgba(0, 0, 0, 0)";
}

function readBg(): TerminalBg {
  try {
    const saved = readLs(STORAGE_KEY, LEGACY_KEY) as TerminalBg | null;
    return saved && TERMINAL_BGS.includes(saved) ? saved : "dark";
  } catch {
    return "dark";
  }
}

export function useTerminalBg() {
  const terminalBg = ref<TerminalBg>(readBg());
  watch(terminalBg, (v) => {
    writeLs(STORAGE_KEY, v, LEGACY_KEY);
  });
  return { terminalBg };
}
