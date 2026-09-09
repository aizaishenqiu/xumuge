import { onUnmounted, ref } from "vue";
import { readLs, writeLs } from "../utils/xuStorage";

const TREE_WIDTH_KEY = "xu.chat.codeTreeWidth";
const AGENT_WIDTH_KEY = "xu.chat.codeAgentWidth";

const TREE_MIN = 200;
const TREE_MAX = 520;
const AGENT_MIN = 260;
const AGENT_MAX = 560;

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function loadWidth(key: string, fallback: number, min: number, max: number): number {
  try {
    const n = Number(readLs(key));
    if (Number.isFinite(n)) return clamp(n, min, max);
  } catch {
    /* ignore */
  }
  return fallback;
}

export function useChatPanelResize(agentOnRight: () => boolean) {
  const codeTreeWidth = ref(loadWidth(TREE_WIDTH_KEY, 300, TREE_MIN, TREE_MAX));
  const codeAgentWidth = ref(loadWidth(AGENT_WIDTH_KEY, 320, AGENT_MIN, AGENT_MAX));
  const resizing = ref(false);

  let resizeSide: "tree" | "agent" | null = null;
  let startX = 0;
  let startW = 0;

  function persist() {
    writeLs(TREE_WIDTH_KEY, String(codeTreeWidth.value));
    writeLs(AGENT_WIDTH_KEY, String(codeAgentWidth.value));
  }

  function onPointerMove(e: PointerEvent) {
    if (!resizeSide) return;
    const dx = e.clientX - startX;
    const right = agentOnRight();

    if (resizeSide === "tree") {
      codeTreeWidth.value = clamp(startW + (right ? dx : -dx), TREE_MIN, TREE_MAX);
    } else {
      codeAgentWidth.value = clamp(startW + (right ? -dx : dx), AGENT_MIN, AGENT_MAX);
    }
  }

  function onPointerUp() {
    if (!resizeSide) return;
    resizeSide = null;
    resizing.value = false;
    persist();
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }

  function startResize(side: "tree" | "agent", e: PointerEvent) {
    e.preventDefault();
    resizeSide = side;
    resizing.value = true;
    startX = e.clientX;
    startW = side === "tree" ? codeTreeWidth.value : codeAgentWidth.value;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  }

  function resetResize() {
    if (!resizeSide) return;
    resizeSide = null;
    resizing.value = false;
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }

  onUnmounted(() => {
    resetResize();
  });

  return {
    codeTreeWidth,
    codeAgentWidth,
    resizing,
    startResize,
    resetResize,
  };
}
