<script setup lang="ts">
import { FouButton } from "foucui";
import { onMounted, onUnmounted, ref } from "vue";
import {
  formatShortcutLabel,
  onShortcutsChanged,
  readScreenshotShortcut,
} from "../../utils/shortcutSettings";

withDefaults(
  defineProps<{
    showThink: boolean;
    showTools: boolean;
    repliesCollapsed: boolean;
    /** message = think/tools/replies; workspace = terminal/screenshot/filetree */
    mode?: "all" | "message" | "workspace";
  }>(),
  { mode: "all" },
);

const emit = defineEmits<{
  toggleThink: [];
  toggleTools: [];
  toggleReplies: [];
  openTerminal: [];
  toggleSnapshot: [];
  toggleFileTree: [];
}>();

const screenshotLabel = ref(formatShortcutLabel(readScreenshotShortcut()));
let unlisten: (() => void) | undefined;

onMounted(() => {
  unlisten = onShortcutsChanged((spec) => {
    screenshotLabel.value = formatShortcutLabel(spec);
  });
});

onUnmounted(() => {
  unlisten?.();
});
</script>

<template>
  <div class="session-toolbar">
    <template v-if="mode === 'all' || mode === 'message'">
      <FouButton
        :type="showThink ? 'primary' : 'default'"
        icon="lightbulb-line"
        size="small"
        text
        native-type="button"
        title="思考过程（左侧对话）"
        aria-label="思考过程"
        @click="emit('toggleThink')"
      />
      <FouButton
        :type="showTools ? 'primary' : 'default'"
        icon="tools-line"
        size="small"
        text
        native-type="button"
        title="工具调用（左侧对话）"
        aria-label="工具调用"
        @click="emit('toggleTools')"
      />
      <FouButton
        :type="repliesCollapsed ? 'primary' : 'default'"
        icon="collapse-diagonal-line"
        size="small"
        text
        native-type="button"
        title="折叠回复（左侧对话）"
        aria-label="折叠回复"
        @click="emit('toggleReplies')"
      />
    </template>
    <template v-if="mode === 'all' || mode === 'workspace'">
      <FouButton
        icon="terminal-box-line"
        size="small"
        text
        native-type="button"
        title="终端"
        aria-label="终端"
        @click="emit('openTerminal')"
      />
      <FouButton
        icon="camera-line"
        size="small"
        text
        native-type="button"
        :title="`截图 ${screenshotLabel}`"
        aria-label="截图"
        @click="emit('toggleSnapshot')"
      />
      <FouButton
        icon="folder-3-line"
        size="small"
        text
        native-type="button"
        title="文件树"
        aria-label="文件树"
        @click="emit('toggleFileTree')"
      />
    </template>
  </div>
</template>

<style scoped>
.session-toolbar {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}
</style>
