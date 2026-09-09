<script setup lang="ts">
import { FouButton } from "foucui";
import { ref } from "vue";
import TerminalPanel from "../../TerminalPanel.vue";
import type { TerminalTab } from "../../../composables/useTerminalTabs";

const props = defineProps<{
  tabs: TerminalTab[];
  activeId: string | null;
  workingDir: string | null;
  height: number;
}>();

const emit = defineEmits<{
  select: [id: string];
  close: [id: string];
  add: [];
  collapse: [];
  "resize-height": [height: number];
  ready: [id: string];
}>();

const resizing = ref(false);

function startResize(e: PointerEvent) {
  e.preventDefault();
  const handle = e.currentTarget as HTMLElement | null;
  handle?.setPointerCapture?.(e.pointerId);
  resizing.value = true;
  const startY = e.clientY;
  const startH = props.height;
  const onMove = (ev: PointerEvent) => {
    const next = startH + (startY - ev.clientY);
    emit("resize-height", next);
  };
  const onUp = () => {
    resizing.value = false;
    handle?.releasePointerCapture?.(e.pointerId);
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
}

function onTabKeydown(e: KeyboardEvent, id: string) {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    emit("select", id);
  }
}
</script>

<template>
  <section class="ide-terminal-dock ui-font" :class="{ resizing }" :style="{ height: `${height}px` }">
    <div class="dock-resize" title="拖动调整终端高度" @pointerdown="startResize" />
    <header class="dock-head">
      <div class="dock-tabs">
        <div
          v-for="tab in tabs"
          :key="tab.id"
          role="tab"
          tabindex="0"
          class="dock-tab"
          :class="{ active: tab.id === activeId }"
          :aria-selected="tab.id === activeId"
          @click="emit('select', tab.id)"
          @keydown="onTabKeydown($event, tab.id)"
        >
          <FouIcon icon="terminal-box-line" size="14" />
          <span>{{ tab.title }}</span>
          <FouButton
            icon="close-line"
            size="small"
            text
            native-type="button"
            class="tab-close"
            aria-label="关闭终端"
            @click.stop="emit('close', tab.id)"
          />
        </div>
        <FouButton
          icon="add-line"
          size="small"
          text
          native-type="button"
          aria-label="新建终端"
          @click="emit('add')"
        />
      </div>
      <FouButton
        icon="arrow-down-s-line"
        size="small"
        text
        native-type="button"
        aria-label="收起终端"
        @click="emit('collapse')"
      />
    </header>
    <div class="dock-body">
      <TerminalPanel
        v-for="tab in tabs"
        v-show="tab.id === activeId"
        :key="tab.id"
        embedded
        :pty-id="tab.id"
        :workspace-root="tab.cwd || workingDir"
        @ready="emit('ready', tab.id)"
      />
      <p v-if="!tabs.length" class="dock-empty muted">点击 + 新建终端</p>
    </div>
  </section>
</template>

<style scoped>
.ide-terminal-dock {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  min-height: 120px;
  border-top: 1px solid var(--hairline);
  background: var(--surface-soft);
  position: relative;
}
.ide-terminal-dock.resizing {
  user-select: none;
}
.dock-resize {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 8px;
  cursor: row-resize;
  z-index: 2;
}
.dock-resize:hover {
  background: color-mix(in srgb, var(--primary) 35%, transparent);
}
.dock-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 4px 8px;
  border-bottom: 1px solid var(--hairline);
  background: var(--surface-card);
  flex-shrink: 0;
}
.dock-tabs {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 1;
  min-width: 0;
  overflow-x: auto;
}
.dock-tab {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: 1px solid transparent;
  background: transparent;
  border-radius: 6px;
  padding: 2px 6px 2px 8px;
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
  outline: none;
}
.dock-tab:focus-visible {
  border-color: var(--primary);
}
.dock-tab.active {
  border-color: var(--hairline);
  background: var(--primary-glow);
  color: var(--primary);
}
.tab-close {
  margin-left: 2px;
}
.dock-body {
  flex: 1;
  min-height: 0;
  position: relative;
  overflow: hidden;
}
.dock-body :deep(.terminal-panel) {
  position: absolute;
  inset: 0;
  height: 100%;
}
.dock-empty {
  padding: 16px;
  font-size: 12px;
}
.muted {
  color: var(--muted);
}
</style>
