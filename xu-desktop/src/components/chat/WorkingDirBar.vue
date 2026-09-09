<script setup lang="ts">
import { FouButton } from "foucui";

defineProps<{
  path: string | null;
  showThink: boolean;
  showTools: boolean;
  repliesCollapsed: boolean;
}>();

const emit = defineEmits<{
  pick: [];
  clear: [];
  toggleThink: [];
  toggleTools: [];
  toggleReplies: [];
  openTerminal: [];
  toggleSnapshot: [];
  toggleFileTree: [];
}>();
</script>

<template>
  <div class="workdir-wrap">
    <div class="workdir-bar">
      <span class="workdir-label ui-font">工作目录</span>
      <span class="workdir-path ui-font" :title="path || ''">{{ path || "未选择（工具沙箱关闭）" }}</span>
      <FouButton icon="folder-open-line" size="small" text class="workdir-toolbar-btn" @click="emit('pick')">选择</FouButton>
      <FouButton
        v-if="path"
        icon="close-line"
        size="small"
        text
        class="workdir-toolbar-btn"
        aria-label="清除"
        @click="emit('clear')"
      />
    </div>
  </div>
</template>

<style scoped>
.workdir-wrap {
  background: var(--surface-soft);
  border-bottom: 1px solid var(--hairline);
}
.workdir-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px 0;
  min-height: 36px;
}
.spacer {
  flex: 1;
}
.workdir-label {
  font-size: 12px;
  color: var(--muted);
  flex-shrink: 0;
}
.workdir-path {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  color: var(--body);
  font-family: var(--font-mono);
}
.status-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 4px 12px 8px;
}
.chip {
  border: 1px solid var(--hairline);
  border-radius: 999px;
  padding: 2px 8px;
  font-size: 10px;
  background: var(--canvas);
  color: var(--muted);
  cursor: pointer;
}
.chip--on {
  border-color: var(--primary);
  color: var(--primary);
  background: var(--primary-glow);
}
.chip:not(button) {
  cursor: default;
}
</style>
