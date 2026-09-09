<script setup lang="ts">
/**
 * @file OfficeChatFloatLauncher.vue 办公室协作条最小化后的可拖拽浮动唤出按钮
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-30
 * @version 1.0.0
 * @category UI
 * @algo pointer-drag
 */
import { onMounted, onUnmounted, ref } from "vue";
import { FouButton } from "foucui";

const emit = defineEmits<{ open: [] }>();

const POS_KEY = "xu.office.chatFloatPos";
const hostRef = ref<HTMLElement | null>(null);
const left = ref(0);
const top = ref(0);
const hasSavedPos = ref(false);
let drag: { ox: number; oy: number; sl: number; st: number } | null = null;
let moved = false;

/** 读取上次保存的浮动按钮位置 */
function loadPos() {
  try {
    const raw = localStorage.getItem(POS_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as { left?: number; top?: number };
    if (typeof parsed.left === "number") left.value = parsed.left;
    if (typeof parsed.top === "number") top.value = parsed.top;
    hasSavedPos.value = true;
  } catch {
    /* ignore */
  }
}

/** 持久化浮动按钮位置 */
function savePos() {
  try {
    localStorage.setItem(POS_KEY, JSON.stringify({ left: left.value, top: top.value }));
  } catch {
    /* ignore */
  }
}

/** 默认右下角（首次打开） */
function placeDefault() {
  const pad = 24;
  left.value = Math.max(pad, window.innerWidth - 72 - pad);
  top.value = Math.max(pad, window.innerHeight - 72 - pad);
}

function onPointerDown(e: PointerEvent) {
  if (e.button !== 0) return;
  moved = false;
  drag = { ox: e.clientX, oy: e.clientY, sl: left.value, st: top.value };
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
}

function onPointerMove(e: PointerEvent) {
  if (!drag) return;
  const dx = e.clientX - drag.ox;
  const dy = e.clientY - drag.oy;
  if (Math.abs(dx) + Math.abs(dy) > 4) moved = true;
  left.value = Math.min(window.innerWidth - 56, Math.max(8, drag.sl + dx));
  top.value = Math.min(window.innerHeight - 56, Math.max(8, drag.st + dy));
}

function onPointerUp() {
  drag = null;
  window.removeEventListener("pointermove", onPointerMove);
  window.removeEventListener("pointerup", onPointerUp);
  savePos();
}

/** 单击（非拖拽）展开协作条 */
function onClick() {
  if (moved) return;
  emit("open");
}

onMounted(() => {
  loadPos();
  if (!hasSavedPos.value) placeDefault();
  window.addEventListener("resize", () => {
    if (!hasSavedPos.value) placeDefault();
  });
});

onUnmounted(() => {
  window.removeEventListener("pointermove", onPointerMove);
  window.removeEventListener("pointerup", onPointerUp);
});
</script>

<template>
  <div
    ref="hostRef"
    class="office-chat-float"
    :style="{ left: `${left}px`, top: `${top}px` }"
    @pointerdown="onPointerDown"
  >
    <FouButton
      class="office-chat-float-btn"
      type="primary"
      icon="chat-3-line"
      native-type="button"
      title="展开协作条"
      @click="onClick"
    >
      协作
    </FouButton>
  </div>
</template>

<style scoped>
.office-chat-float {
  position: fixed;
  z-index: 1200;
  -webkit-app-region: no-drag;
  touch-action: none;
}
.office-chat-float-btn {
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.28);
  border-radius: 999px;
}
</style>
