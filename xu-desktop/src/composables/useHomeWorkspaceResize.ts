import { onUnmounted, ref } from "vue";
import { readLs, writeLs } from "../utils/xuStorage";

const TASK_W_KEY = "xu.home.taskPanelW";
const AGENT_H_KEY = "xu.home.agentPaneH";

const TASK_MIN = 160;
const TASK_MAX = 400;
const AGENT_MIN = 180;
const AGENT_MAX = 560;

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function loadNum(key: string, fallback: number, min: number, max: number): number {
  try {
    const n = Number(readLs(key));
    if (Number.isFinite(n)) return clamp(n, min, max);
  } catch {
    /* ignore */
  }
  return fallback;
}

export function useHomeWorkspaceResize() {
  const taskPanelWidth = ref(loadNum(TASK_W_KEY, 220, TASK_MIN, TASK_MAX));
  const agentPaneHeight = ref(loadNum(AGENT_H_KEY, 260, AGENT_MIN, AGENT_MAX));
  const resizing = ref<"task" | "agent" | null>(null);

  let startX = 0;
  let startY = 0;
  let startW = 0;
  let startH = 0;

  function persist() {
    writeLs(TASK_W_KEY, String(taskPanelWidth.value));
    writeLs(AGENT_H_KEY, String(agentPaneHeight.value));
  }

  function onPointerMove(e: PointerEvent) {
    if (!resizing.value) return;
    if (resizing.value === "task") {
      taskPanelWidth.value = clamp(startW + (e.clientX - startX), TASK_MIN, TASK_MAX);
    } else {
      agentPaneHeight.value = clamp(startH - (e.clientY - startY), AGENT_MIN, AGENT_MAX);
    }
  }

  function onPointerUp() {
    if (!resizing.value) return;
    resizing.value = null;
    persist();
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    window.removeEventListener("pointercancel", onPointerUp);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }

  function startResize(side: "task" | "agent", e: PointerEvent) {
    e.preventDefault();
    resizing.value = side;
    startX = e.clientX;
    startY = e.clientY;
    startW = taskPanelWidth.value;
    startH = agentPaneHeight.value;
    document.body.style.cursor = side === "task" ? "col-resize" : "row-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
  }

  function resetResize() {
    if (!resizing.value) return;
    resizing.value = null;
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    window.removeEventListener("pointercancel", onPointerUp);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }

  onUnmounted(() => {
    resetResize();
  });

  return { taskPanelWidth, agentPaneHeight, resizing, startResize, resetResize };
}
