<script setup lang="ts">
import { FouButton } from "foucui";
import { onMounted, onUnmounted, ref } from "vue";
import {
  formatShortcutLabel,
  onShortcutsChanged,
  readScreenshotShortcut,
} from "../utils/shortcutSettings";

const open = defineModel<boolean>({ default: false });

const isMac = navigator.platform.toLowerCase().includes("mac");
const mod = isMac ? "⌘" : "Ctrl";
const shift = isMac ? "⇧" : "Shift";

const screenshotLabel = ref(formatShortcutLabel(readScreenshotShortcut()));

const SHORTCUTS = ref([
  {
    group: "全局",
    items: [
      { keys: [mod, shift, "H"], label: "显示 / 隐藏窗口" },
      { keys: [mod, "/"], label: "快捷键速查面板" },
      { keys: [screenshotLabel], label: "区域截图（选区 + 标注）" },
    ],
  },
  {
    group: "会话",
    items: [{ keys: [mod, "N"], label: "新建会话" }],
  },
  {
    group: "对话输入",
    items: [
      { keys: ["Enter"], label: "发送消息" },
      { keys: [shift, "Enter"], label: "换行" },
      { keys: ["Esc"], label: "取消 / 关闭面板" },
    ],
  },
  {
    group: "面板",
    items: [
      { keys: [mod, "W"], label: "关闭当前面板" },
      { keys: [mod, "K"], label: "打开快照说明" },
    ],
  },
]);

function refreshScreenshotRow() {
  const label = formatShortcutLabel(readScreenshotShortcut());
  screenshotLabel.value = label;
  const global = SHORTCUTS.value[0];
  if (global) {
    global.items[2] = {
      keys: [label],
      label: "区域截图（选区 + 标注）",
    };
  }
}

let unlistenShortcuts: (() => void) | undefined;

function onKey(e: KeyboardEvent) {
  if (e.key === "Escape") open.value = false;
}

onMounted(() => {
  window.addEventListener("keydown", onKey);
  refreshScreenshotRow();
  unlistenShortcuts = onShortcutsChanged(() => refreshScreenshotRow());
});

onUnmounted(() => {
  window.removeEventListener("keydown", onKey);
  unlistenShortcuts?.();
});
</script>

<template>
  <FouDialog v-model="open" title="快捷键" width="480px" append-to-body destroy-on-close>
    <div class="kbd-panel-body ui-font">
      <div v-for="section in SHORTCUTS" :key="section.group" class="kbd-section">
        <div class="kbd-section-label">{{ section.group }}</div>
        <div v-for="item in section.items" :key="item.label" class="kbd-row">
          <span class="kbd-row-label">{{ item.label }}</span>
          <span class="kbd-row-keys">
            <kbd v-for="(k, i) in item.keys" :key="i" class="kbd-key">{{ k }}</kbd>
          </span>
        </div>
      </div>
    </div>
    <template #footer>
      <FouButton icon="close-line" native-type="button" @click="open = false">关闭</FouButton>
    </template>
  </FouDialog>
</template>

<style scoped>
.kbd-panel-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.kbd-section-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--muted);
  margin-bottom: 8px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.kbd-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 6px 0;
  border-bottom: 1px solid var(--hairline);
}
.kbd-row:last-child {
  border-bottom: none;
}
.kbd-row-label {
  font-size: 13px;
  color: var(--body);
}
.kbd-row-keys {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}
.kbd-key {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 24px;
  padding: 2px 6px;
  border-radius: 4px;
  border: 1px solid var(--hairline);
  background: var(--surface-soft);
  font-size: 11px;
  font-family: inherit;
  color: var(--body);
}
</style>
