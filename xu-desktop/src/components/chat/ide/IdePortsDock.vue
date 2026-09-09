<script setup lang="ts">
import { FouButton, fouAlert } from "foucui";
import { onApiCatch } from "../../../utils/userFacingError";
import { invoke } from "@tauri-apps/api/core";
import { onMounted, ref, watch } from "vue";

export type ListeningPort = {
  protocol: string;
  local: string;
  pid: string;
  state: string;
};

const props = defineProps<{
  height: number;
  active: boolean;
}>();

const ports = ref<ListeningPort[]>([]);
const loading = ref(false);
const error = ref("");

async function refresh() {
  loading.value = true;
  error.value = "";
  try {
    ports.value = await invoke<ListeningPort[]>("xu_list_listening_ports");
  } catch (e) {
    void onApiCatch(e, (m) => { error.value = m }, { fallback: "端口列表失败" });
  } finally {
    loading.value = false;
  }
}

watch(
  () => props.active,
  (v) => {
    if (v) void refresh();
  },
);

onMounted(() => {
  if (props.active) void refresh();
});
</script>

<template>
  <div class="ide-ports-dock" :style="{ height: `${height}px` }">
    <div class="ide-ports-toolbar">
      <span class="muted">侦听端口</span>
      <FouButton
        icon="refresh-line"
        size="small"
        text
        native-type="button"
        :loading="loading"
        @click="refresh"
      >
        刷新
      </FouButton>
    </div>
    <p v-if="error" class="muted err">{{ error }}</p>
    <table v-else-if="ports.length" class="ide-ports-table">
      <thead>
        <tr>
          <th>协议</th>
          <th>本地地址</th>
          <th>状态</th>
          <th>PID</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(p, i) in ports" :key="`${p.local}-${p.pid}-${i}`">
          <td>{{ p.protocol }}</td>
          <td>{{ p.local }}</td>
          <td>{{ p.state }}</td>
          <td>{{ p.pid }}</td>
        </tr>
      </tbody>
    </table>
    <p v-else class="muted">{{ loading ? "加载中…" : "暂无侦听端口" }}</p>
  </div>
</template>

<style scoped>
.ide-ports-dock {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-top: 1px solid var(--hairline, #2a3441);
  background: var(--surface-elevated, #1a222c);
  font-size: 12px;
}
.ide-ports-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 8px;
  border-bottom: 1px solid var(--hairline, #2a3441);
  flex-shrink: 0;
}
.ide-ports-table {
  width: 100%;
  border-collapse: collapse;
  overflow: auto;
  display: block;
  flex: 1;
  min-height: 0;
}
.ide-ports-table thead,
.ide-ports-table tbody {
  display: table;
  width: 100%;
  table-layout: fixed;
}
.ide-ports-table th,
.ide-ports-table td {
  text-align: left;
  padding: 4px 8px;
  border-bottom: 1px solid var(--hairline, #2a3441);
  color: var(--text-primary, #e2e8f0);
  font-family: var(--font-mono, ui-monospace, monospace);
}
.ide-ports-table th {
  color: var(--text-secondary, #94a3b8);
  font-weight: 500;
}
.muted {
  padding: 12px;
  color: var(--text-secondary, #64748b);
}
.err {
  color: #f87171;
}
</style>
