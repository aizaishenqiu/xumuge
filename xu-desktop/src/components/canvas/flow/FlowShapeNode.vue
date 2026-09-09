<script setup lang="ts">
/**
 * @file FlowShapeNode.vue 流程自定义节点（框/起止/判断/箭头/大框）
 * @author qiuye <yjk150@qq.com>
 * @date 2026-09-07
 * @updated 2026-09-08
 * @version 1.3.0
 * @category Layout
 * @algo vue-flow-shape-node-rotate
 */
import { computed, nextTick, onUnmounted, ref, watch } from "vue";
import { Handle, Position, useVueFlow, type NodeProps } from "@vue-flow/core";
import { NodeResizer } from "@vue-flow/node-resizer";
import "@vue-flow/node-resizer/dist/style.css";
import type { FlowNodeData, FlowShape } from "../../../canvas/flowTypes";

const props = defineProps<NodeProps<FlowNodeData>>();

const { updateNodeData } = useVueFlow();

const shape = computed<FlowShape>(() => {
  const t = props.type;
  if (
    t === "terminal" ||
    t === "decision" ||
    t === "process" ||
    t === "arrow" ||
    t === "doubleArrow" ||
    t === "frame" ||
    t === "circle"
  ) {
    return t;
  }
  return "process";
});

/** 用 SVG 画轮廓的形状（CSS clip-path 会裁掉边框与缩放手柄） */
const useSvgShape = computed(
  () => shape.value === "decision" || shape.value === "arrow" || shape.value === "doubleArrow",
);

const svgPoints = computed(() => {
  switch (shape.value) {
    case "decision":
      return "50,2 98,50 50,98 2,50";
    case "arrow":
      return "2,22 68,22 68,4 98,50 68,96 68,78 2,78";
    case "doubleArrow":
      return "2,50 24,4 24,28 76,28 76,4 98,50 76,96 76,72 24,72 24,96";
    default:
      return "";
  }
});

const label = computed(() => String(props.data?.label || ""));
const fill = computed(() => props.data?.fill || "#ffffff");
const stroke = computed(() => props.data?.stroke || "#64748b");
const fontSize = computed(() => Number(props.data?.fontSize) || 13);
const rotation = computed(() => {
  const r = Number(props.data?.rotation);
  return Number.isFinite(r) ? r : 0;
});

const editing = ref(false);
const draft = ref("");
const inputRef = ref<HTMLInputElement | null>(null);
const wrapRef = ref<HTMLElement | null>(null);
const rotating = ref(false);

let rotPointerId: number | null = null;
let rotStartAngle = 0;
let rotBase = 0;

watch(
  () => props.selected,
  (sel) => {
    if (!sel) {
      editing.value = false;
      endRotate();
    }
  },
);

function startEdit() {
  draft.value = label.value;
  editing.value = true;
  void nextTick(() => inputRef.value?.focus());
}

function commitEdit() {
  if (!editing.value) return;
  editing.value = false;
  const next = draft.value.trim() || "节点";
  updateNodeData(props.id, { ...props.data, label: next });
}

function onKey(e: KeyboardEvent) {
  if (e.key === "Enter") {
    e.preventDefault();
    commitEdit();
  } else if (e.key === "Escape") {
    editing.value = false;
  }
}

function normDeg(d: number): number {
  let x = d % 360;
  if (x > 180) x -= 360;
  if (x <= -180) x += 360;
  return Math.round(x * 10) / 10;
}

function pointerAngle(clientX: number, clientY: number): number {
  const el = wrapRef.value;
  if (!el) return 0;
  const r = el.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  return (Math.atan2(clientY - cy, clientX - cx) * 180) / Math.PI;
}

function onRotPointerDown(e: PointerEvent) {
  if (e.button !== 0 || editing.value) return;
  e.preventDefault();
  e.stopPropagation();
  rotating.value = true;
  rotPointerId = e.pointerId;
  rotBase = rotation.value;
  rotStartAngle = pointerAngle(e.clientX, e.clientY);
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  window.addEventListener("pointermove", onRotPointerMove);
  window.addEventListener("pointerup", onRotPointerUp);
  window.addEventListener("pointercancel", onRotPointerUp);
}

function onRotPointerMove(e: PointerEvent) {
  if (!rotating.value || (rotPointerId != null && e.pointerId !== rotPointerId)) return;
  let delta = pointerAngle(e.clientX, e.clientY) - rotStartAngle;
  let next = rotBase + delta;
  if (e.shiftKey) next = Math.round(next / 15) * 15;
  updateNodeData(props.id, { ...props.data, rotation: normDeg(next) });
}

function onRotPointerUp(e: PointerEvent) {
  if (rotPointerId != null && e.pointerId !== rotPointerId) return;
  endRotate();
}

function endRotate() {
  rotating.value = false;
  rotPointerId = null;
  window.removeEventListener("pointermove", onRotPointerMove);
  window.removeEventListener("pointerup", onRotPointerUp);
  window.removeEventListener("pointercancel", onRotPointerUp);
}

onUnmounted(() => endRotate());
</script>

<template>
  <div ref="wrapRef" class="fsn-wrap" :class="{ 'fsn-wrap--selected': selected }">
    <div
      class="fsn-root"
      :class="{ 'fsn-root--selected': selected, 'fsn-root--editing': editing }"
      :style="{ transform: `rotate(${rotation}deg)` }"
      @dblclick.stop="startEdit"
    >
      <NodeResizer
        :node-id="id"
        :is-visible="!!selected && !editing"
        :min-width="64"
        :min-height="40"
        color="#3b82f6"
        :handle-style="{ width: '9px', height: '9px', borderRadius: '2px' }"
      />
      <svg
        v-if="useSvgShape"
        class="fsn-svg"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <polygon
          :points="svgPoints"
          :fill="fill"
          :stroke="stroke"
          stroke-width="2.5"
          stroke-linejoin="round"
          vector-effect="non-scaling-stroke"
        />
      </svg>
      <div
        v-else
        class="fsn"
        :class="`fsn--${shape}`"
        :style="{
          background: fill,
          borderColor: stroke,
        }"
      />
      <Handle id="t" class="fsn-h" type="source" :position="Position.Top" />
      <Handle id="r" class="fsn-h" type="source" :position="Position.Right" />
      <Handle id="b" class="fsn-h" type="source" :position="Position.Bottom" />
      <Handle id="l" class="fsn-h" type="source" :position="Position.Left" />
      <div class="fsn-body ui-font" :style="{ fontSize: fontSize + 'px' }">
        <input
          v-if="editing"
          ref="inputRef"
          v-model="draft"
          class="fsn-input"
          @blur="commitEdit"
          @keydown="onKey"
        />
        <span v-else class="fsn-label">{{ label }}</span>
      </div>
    </div>
    <button
      v-if="selected && !editing"
      type="button"
      class="fsn-rot nodrag nopan"
      title="拖动旋转（Shift 吸附 15°）"
      aria-label="旋转"
      @pointerdown="onRotPointerDown"
    >
      <svg class="fsn-rot-icon" viewBox="0 0 24 24" aria-hidden="true">
        <!-- CDR 式：粗弧 + 箭头，一眼能认 -->
        <path
          fill="none"
          stroke="currentColor"
          stroke-width="2.75"
          stroke-linecap="round"
          d="M17.2 8.2a6.2 6.2 0 1 0 1.1 5.6"
        />
        <path fill="currentColor" d="M17.2 4.6l3.6 3.2-4.8.9z" />
      </svg>
    </button>
  </div>
</template>

<style scoped>
.fsn-wrap {
  position: relative;
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  min-width: 64px;
  min-height: 40px;
  overflow: visible;
}
.fsn-root {
  position: relative;
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  min-width: 64px;
  min-height: 40px;
  color: #0f172a;
  user-select: none;
  overflow: visible;
  transform-origin: center center;
}
.fsn-root--selected {
  outline: 2px solid rgba(59, 130, 246, 0.4);
  outline-offset: 2px;
}
.fsn,
.fsn-svg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  pointer-events: none;
}
.fsn {
  border: 1.5px solid #64748b;
  background: #fff;
}
.fsn--process {
  border-radius: 6px;
}
.fsn--terminal {
  border-radius: 999px;
}
.fsn--circle {
  border-radius: 50%;
}
.fsn--frame {
  border-radius: 10px;
  border-width: 2px;
}
.fsn-body {
  position: relative;
  z-index: 1;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 8px 12px;
  box-sizing: border-box;
  line-height: 1.3;
  pointer-events: none;
}
.fsn-root--editing .fsn-body {
  pointer-events: auto;
}
.fsn-label {
  word-break: break-word;
  text-align: center;
  max-width: 100%;
}
.fsn-input {
  width: 100%;
  max-width: 100%;
  border: 1px solid #93c5fd;
  border-radius: 4px;
  padding: 2px 6px;
  font: inherit;
  text-align: center;
  background: #fff;
  pointer-events: auto;
}
.fsn-h {
  width: 8px !important;
  height: 8px !important;
  background: #3b82f6 !important;
  border: 1px solid #fff !important;
  z-index: 3;
}
.fsn-rot {
  position: absolute;
  left: 50%;
  top: -44px;
  width: 28px;
  height: 28px;
  margin-left: -14px;
  padding: 0;
  border: 2px solid #3b82f6;
  border-radius: 50%;
  background: #fff;
  color: #2563eb;
  cursor: grab;
  z-index: 5;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 2px 6px rgba(15, 23, 42, 0.22);
}
.fsn-rot::before {
  content: "";
  position: absolute;
  left: 50%;
  top: 100%;
  width: 2px;
  height: 14px;
  margin-left: -1px;
  background: #3b82f6;
  pointer-events: none;
}
.fsn-rot-icon {
  width: 18px;
  height: 18px;
  display: block;
  pointer-events: none;
}
.fsn-rot:active {
  cursor: grabbing;
}
</style>
