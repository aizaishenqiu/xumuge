<script setup lang="ts">
import { FouButton } from "foucui";
import { invoke } from "@tauri-apps/api/core";
import { onMounted, ref, watch } from "vue";
import { toRelativePath } from "../../../utils/chatWorkspace";

const props = defineProps<{
  workingDir: string | null;
  filePath: string | null;
}>();

const loading = ref(false);
const entries = ref<string[]>([]);

async function refresh() {
  const ws = props.workingDir?.trim();
  const file = props.filePath?.trim();
  if (!ws || !file) {
    entries.value = [];
    return;
  }
  loading.value = true;
  try {
    const rel = toRelativePath(ws, file);
    const raw = await invoke<string>("git_workspace", {
      workspace: ws,
      action: "log_file",
      path: rel,
      max_count: 25,
    });
    entries.value = raw.split(/\r?\n/).filter(Boolean);
  } catch {
    entries.value = [];
  } finally {
    loading.value = false;
  }
}

onMounted(() => void refresh());
watch(() => [props.workingDir, props.filePath] as const, () => void refresh());
</script>

<template>
  <div class="ide-timeline-panel ui-font">
    <header class="panel-head">
      <span class="panel-title">时间线</span>
      <FouButton
        icon="refresh-line"
        size="small"
        text
        native-type="button"
        :loading="loading"
        aria-label="刷新"
        @click="refresh"
      />
    </header>
    <p v-if="!filePath" class="panel-empty muted">打开文件后显示 Git 提交历史</p>
    <ul v-else-if="entries.length" class="timeline-list">
      <li v-for="(row, i) in entries" :key="i" class="timeline-row">{{ row }}</li>
    </ul>
    <p v-else class="panel-empty muted">暂无提交记录或不是 Git 仓库</p>
  </div>
</template>

<style scoped>
.ide-timeline-panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
}
.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px 6px;
  border-bottom: 1px solid var(--hairline);
}
.panel-title {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--muted);
}
.timeline-list {
  list-style: none;
  margin: 0;
  padding: 4px 0;
  overflow: auto;
  flex: 1;
}
.timeline-row {
  padding: 6px 12px;
  font-size: 11px;
  font-family: var(--font-mono);
  border-bottom: 1px solid var(--hairline);
}
.panel-empty {
  padding: 16px 12px;
  font-size: 12px;
}
.muted {
  color: var(--muted);
}
</style>
