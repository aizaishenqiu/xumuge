<script setup lang="ts">
import { FouButton } from "foucui";
import { onMounted, onUnmounted, ref } from "vue";

export type DebugLogEntry = {
  id: string;
  ts: number;
  level: "info" | "warn" | "error";
  text: string;
};

const props = defineProps<{
  height: number;
}>();

const logs = ref<DebugLogEntry[]>([]);
let seq = 0;

function push(level: DebugLogEntry["level"], text: string) {
  const t = text.trim();
  if (!t) return;
  logs.value = [
    ...logs.value.slice(-400),
    { id: `dbg-${++seq}`, ts: Date.now(), level, text: t },
  ];
}

function clearLogs() {
  logs.value = [];
}

function onIdeDebug(e: Event) {
  const d = (e as CustomEvent<{ level?: string; text?: string }>).detail;
  if (!d?.text) return;
  const level =
    d.level === "error" || d.level === "warn" ? (d.level as "error" | "warn") : "info";
  push(level, d.text);
}

function formatTime(ts: number) {
  const d = new Date(ts);
  return d.toLocaleTimeString();
}

onMounted(() => {
  window.addEventListener("xu-ide-debug", onIdeDebug);
  push("info", "调试控制台已就绪。Agent / 工具输出可写入此面板。");
});

onUnmounted(() => {
  window.removeEventListener("xu-ide-debug", onIdeDebug);
});
</script>

<template>
  <div class="ide-debug-dock" :style="{ height: `${height}px` }">
    <div class="ide-debug-toolbar">
      <span class="muted">调试控制台</span>
      <FouButton icon="delete-bin-line" size="small" text native-type="button" @click="clearLogs">
        清空
      </FouButton>
    </div>
    <ul class="ide-debug-list">
      <li
        v-for="row in logs"
        :key="row.id"
        class="ide-debug-row"
        :class="`level-${row.level}`"
      >
        <span class="ts">{{ formatTime(row.ts) }}</span>
        <span class="msg">{{ row.text }}</span>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.ide-debug-dock {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-top: 1px solid var(--hairline, #2a3441);
  background: var(--surface-elevated, #1a222c);
  font-size: 12px;
}
.ide-debug-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 8px;
  border-bottom: 1px solid var(--hairline, #2a3441);
  flex-shrink: 0;
}
.ide-debug-list {
  list-style: none;
  margin: 0;
  padding: 6px 8px;
  overflow: auto;
  flex: 1;
  min-height: 0;
  font-family: var(--font-mono, ui-monospace, monospace);
}
.ide-debug-row {
  display: flex;
  gap: 10px;
  padding: 2px 0;
  line-height: 1.4;
}
.ts {
  color: var(--text-secondary, #64748b);
  flex-shrink: 0;
}
.msg {
  color: var(--text-primary, #e2e8f0);
  white-space: pre-wrap;
  word-break: break-word;
}
.level-warn .msg {
  color: #fbbf24;
}
.level-error .msg {
  color: #f87171;
}
.muted {
  color: var(--text-secondary, #64748b);
}
</style>
