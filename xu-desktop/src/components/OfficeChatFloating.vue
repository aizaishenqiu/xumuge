<script setup lang="ts">
/**
 * @file OfficeChatFloating.vue 办公室协作条：浮于 3D 大厅上，可拖拽与拉伸
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-30
 * @version 1.3.0
 * @category UI
 * @algo pointer-drag-resize
 */
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import OfficeChatStrip from "./OfficeChatStrip.vue";
import WecomKfDraftBar from "./WecomKfDraftBar.vue";
import type { Employee } from "../utils/employees";

const RECT_KEY = "xu.office.chatFloatRect";

type FloatRect = { left: number; top: number; width: number; height: number };
type ChatPanelMode = "normal" | "maximized" | "minimized";

const props = defineProps<{
  employees: Employee[];
  panelMode: ChatPanelMode;
  stageEl: HTMLElement | null;
  /** 办公室沉浸全屏：放宽最大化比例与尺寸上限 */
  immersive?: boolean;
}>();

const emit = defineEmits<{
  "panel-action": ["minimize" | "maximize" | "restore"];
}>();

/** 最大化态下从 DOM 同步像素矩形，便于切换为可拉伸 */
function syncRectFromDom() {
  const panel = panelRef.value;
  const stage = resolveStage();
  if (!panel || !stage) return;
  const pb = panel.getBoundingClientRect();
  const sb = stage.getBoundingClientRect();
  rect.value = {
    left: pb.left - sb.left,
    top: pb.top - sb.top,
    width: pb.width,
    height: pb.height,
  };
}

const chatStripRef = ref<InstanceType<typeof OfficeChatStrip> | null>(null);
const panelRef = ref<HTMLElement | null>(null);
const rect = ref<FloatRect>({ left: 0, top: 0, width: 420, height: 560 });
const dragging = ref(false);
const resizing = ref(false);

const MIN_W = 320;
const MIN_H = 280;
const STAGE_PAD = 10;

function resolveStage(): HTMLElement | null {
  const el = props.stageEl;
  if (el instanceof HTMLElement && el.clientWidth > 0) return el;
  const parent = panelRef.value?.parentElement;
  if (parent?.classList.contains("office-stage")) return parent;
  return el instanceof HTMLElement ? el : null;
}

function stageSize(stage: HTMLElement): { w: number; h: number } {
  const box = stage.getBoundingClientRect();
  return {
    w: Math.max(0, Math.round(box.width) || stage.clientWidth),
    h: Math.max(0, Math.round(box.height) || stage.clientHeight),
  };
}

/** 浮层可占用的最大宽高（随舞台变化，不再写死 920×900） */
function stageMaxSize(stageW: number, stageH: number): { maxW: number; maxH: number } {
  return {
    maxW: Math.max(MIN_W, stageW - STAGE_PAD * 2),
    maxH: Math.max(MIN_H, stageH - STAGE_PAD * 2),
  };
}

/** 根据舞台尺寸计算默认浮层位置（靠右） */
function defaultRect(stageW: number, stageH: number): FloatRect {
  const width = Math.min(480, Math.max(360, Math.round(stageW * 0.36)));
  const height = Math.min(Math.round(stageH * 0.82), 680);
  return {
    left: Math.max(16, stageW - width - 20),
    top: Math.max(12, Math.round((stageH - height) * 0.08)),
    width,
    height,
  };
}

/** 最大化：铺满舞台（留边距），靠 CSS inset 保证尺寸准确 */
function maximizedRect(stageW: number, stageH: number): FloatRect {
  const pad = STAGE_PAD;
  return {
    left: pad,
    top: pad,
    width: Math.max(MIN_W, stageW - pad * 2),
    height: Math.max(MIN_H, stageH - pad * 2),
  };
}

function clampRect(r: FloatRect, stageW: number, stageH: number): FloatRect {
  const { maxW, maxH } = stageMaxSize(stageW, stageH);
  const width = Math.min(maxW, Math.max(MIN_W, r.width));
  const height = Math.min(maxH, Math.max(MIN_H, r.height));
  const left = Math.min(stageW - MIN_W - 8, Math.max(8, r.left));
  const top = Math.min(stageH - MIN_H - 8, Math.max(8, r.top));
  return { left, top, width, height };
}

function loadRect(): FloatRect | null {
  try {
    const raw = localStorage.getItem(RECT_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<FloatRect>;
    if (
      typeof p.left === "number" &&
      typeof p.top === "number" &&
      typeof p.width === "number" &&
      typeof p.height === "number"
    ) {
      return p as FloatRect;
    }
  } catch {
    /* ignore */
  }
  return null;
}

function saveRect() {
  if (props.panelMode === "maximized") return;
  try {
    localStorage.setItem(RECT_KEY, JSON.stringify(rect.value));
  } catch {
    /* ignore */
  }
}

function applyStageLayout() {
  const stage = resolveStage();
  if (!stage) return;
  const { w: sw, h: sh } = stageSize(stage);
  if (sw < MIN_W || sh < MIN_H) return;
  if (props.panelMode === "maximized") {
    rect.value = maximizedRect(sw, sh);
    return;
  }
  const saved = loadRect();
  rect.value = clampRect(saved ?? defaultRect(sw, sh), sw, sh);
}

const isMaximized = computed(() => props.panelMode === "maximized");

const panelStyle = computed(() => {
  if (isMaximized.value) return undefined;
  return {
    left: `${rect.value.left}px`,
    top: `${rect.value.top}px`,
    width: `${rect.value.width}px`,
    height: `${rect.value.height}px`,
  };
});

function isInteractiveTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return Boolean(el.closest("button, a, input, textarea, select, label, .fou-button"));
}

/** 标题栏拖拽移动浮层 */
function onDragStart(e: PointerEvent) {
  if (props.panelMode === "maximized") return;
  if (e.button !== 0 || isInteractiveTarget(e.target)) return;
  e.preventDefault();
  dragging.value = true;
  const startX = e.clientX;
  const startY = e.clientY;
  const base = { ...rect.value };
  const stage = resolveStage();
  const onMove = (ev: PointerEvent) => {
    if (!stage) return;
    const { w, h } = stageSize(stage);
    const dx = ev.clientX - startX;
    const dy = ev.clientY - startY;
    rect.value = clampRect(
      { ...base, left: base.left + dx, top: base.top + dy },
      w,
      h,
    );
  };
  const onUp = () => {
    dragging.value = false;
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    saveRect();
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
}

type ResizeEdge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

/** 八面拉伸浮层（最大化时先还原为像素定位） */
async function onResizeStart(edge: ResizeEdge, e: PointerEvent) {
  e.preventDefault();
  e.stopPropagation();
  if (props.panelMode === "maximized") {
    syncRectFromDom();
    emit("panel-action", "restore");
    await nextTick();
  }
  resizing.value = true;
  const startX = e.clientX;
  const startY = e.clientY;
  const base = { ...rect.value };
  const stage = resolveStage();
  const onMove = (ev: PointerEvent) => {
    if (!stage) return;
    const { w, h } = stageSize(stage);
    let { left, top, width, height } = base;
    const dx = ev.clientX - startX;
    const dy = ev.clientY - startY;
    if (edge.includes("e")) width = base.width + dx;
    if (edge.includes("w")) {
      width = base.width - dx;
      left = base.left + dx;
    }
    if (edge.includes("s")) height = base.height + dy;
    if (edge.includes("n")) {
      height = base.height - dy;
      top = base.top + dy;
    }
    rect.value = clampRect({ left, top, width, height }, w, h);
  };
  const onUp = () => {
    resizing.value = false;
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    saveRect();
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
}

function openSwitchProject() {
  chatStripRef.value?.openSwitchProject();
}

defineExpose({ openSwitchProject });

watch(
  () => [props.panelMode, props.immersive, props.stageEl],
  async () => {
    await nextTick();
    applyStageLayout();
    requestAnimationFrame(() => applyStageLayout());
  },
);

let stageObserver: ResizeObserver | null = null;

onMounted(() => {
  void nextTick(() => {
    applyStageLayout();
    requestAnimationFrame(() => applyStageLayout());
  });
  window.addEventListener("resize", applyStageLayout);
  const stage = resolveStage();
  if (typeof ResizeObserver !== "undefined" && stage) {
    stageObserver = new ResizeObserver(() => applyStageLayout());
    stageObserver.observe(stage);
  }
});

watch(
  () => props.stageEl,
  (el, _prev, onCleanup) => {
    stageObserver?.disconnect();
    stageObserver = null;
    const stage =
      el instanceof HTMLElement ? el : panelRef.value?.parentElement ?? null;
    if (!stage || typeof ResizeObserver === "undefined") return;
    stageObserver = new ResizeObserver(() => applyStageLayout());
    stageObserver.observe(stage);
    onCleanup(() => {
      stageObserver?.disconnect();
      stageObserver = null;
    });
  },
  { immediate: true },
);

onUnmounted(() => {
  window.removeEventListener("resize", applyStageLayout);
  stageObserver?.disconnect();
  stageObserver = null;
});
</script>

<template>
  <div
    ref="panelRef"
    class="office-chat-floating"
    :class="{ dragging, resizing, maximized: isMaximized }"
    :style="panelStyle"
  >
    <div class="ocf-body">
      <WecomKfDraftBar />
      <OfficeChatStrip
        ref="chatStripRef"
        :employees="employees"
        :panel-mode="panelMode"
        floating
        @panel-action="emit('panel-action', $event)"
        @header-pointerdown="onDragStart"
      />
    </div>
    <div
      class="ocf-resize ocf-resize-n"
      title="拖动调整高度"
      @pointerdown="onResizeStart('n', $event)"
    />
    <div
      class="ocf-resize ocf-resize-s"
      title="拖动调整高度"
      @pointerdown="onResizeStart('s', $event)"
    />
    <div
      class="ocf-resize ocf-resize-e"
      title="拖动调整宽度"
      @pointerdown="onResizeStart('e', $event)"
    />
    <div
      class="ocf-resize ocf-resize-w"
      title="拖动调整宽度"
      @pointerdown="onResizeStart('w', $event)"
    />
    <div
      class="ocf-resize ocf-resize-ne"
      title="拖动调整大小"
      @pointerdown="onResizeStart('ne', $event)"
    />
    <div
      class="ocf-resize ocf-resize-nw"
      title="拖动调整大小"
      @pointerdown="onResizeStart('nw', $event)"
    />
    <div
      class="ocf-resize ocf-resize-se"
      title="拖动调整大小"
      @pointerdown="onResizeStart('se', $event)"
    />
    <div
      class="ocf-resize ocf-resize-sw"
      title="拖动调整大小"
      @pointerdown="onResizeStart('sw', $event)"
    />
  </div>
</template>

<style scoped>
.office-chat-floating {
  position: absolute;
  z-index: 30;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.35);
  border-radius: 14px;
  overflow: visible;
  touch-action: none;
}
.office-chat-floating.dragging {
  cursor: grabbing;
  user-select: none;
}
.office-chat-floating.resizing {
  user-select: none;
}
.office-chat-floating.maximized {
  inset: 10px;
  width: auto !important;
  height: auto !important;
  border-radius: 10px;
}
.ocf-body {
  flex: 1;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
  border-radius: inherit;
}
.ocf-resize {
  position: absolute;
  z-index: 40;
  touch-action: none;
}
.ocf-resize-n {
  top: 0;
  left: 10%;
  width: 80%;
  height: 10px;
  cursor: ns-resize;
}
.ocf-resize-s {
  left: 10%;
  bottom: 0;
  width: 80%;
  height: 10px;
  cursor: ns-resize;
}
.ocf-resize-e {
  top: 10%;
  right: 0;
  width: 10px;
  height: 80%;
  cursor: ew-resize;
}
.ocf-resize-w {
  top: 10%;
  left: 0;
  width: 10px;
  height: 80%;
  cursor: ew-resize;
}
.ocf-resize-ne,
.ocf-resize-nw,
.ocf-resize-se,
.ocf-resize-sw {
  width: 18px;
  height: 18px;
}
.ocf-resize-ne {
  top: 0;
  right: 0;
  cursor: nesw-resize;
}
.ocf-resize-nw {
  top: 0;
  left: 0;
  cursor: nwse-resize;
}
.ocf-resize-se {
  right: 0;
  bottom: 0;
  cursor: nwse-resize;
}
.ocf-resize-sw {
  left: 0;
  bottom: 0;
  cursor: nesw-resize;
}
.office-chat-floating:hover .ocf-resize-se::after,
.office-chat-floating.resizing .ocf-resize-se::after {
  content: "";
  position: absolute;
  right: 4px;
  bottom: 4px;
  width: 8px;
  height: 8px;
  border-right: 2px solid rgba(255, 255, 255, 0.35);
  border-bottom: 2px solid rgba(255, 255, 255, 0.35);
  border-radius: 0 0 2px 0;
  pointer-events: none;
}
</style>
