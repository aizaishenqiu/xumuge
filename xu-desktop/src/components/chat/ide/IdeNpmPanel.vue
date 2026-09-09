<script setup lang="ts">
import { FouButton, fouMsg, fouAlert} from "foucui";
import { invoke } from "@tauri-apps/api/core";
import { computed, onMounted, ref, watch } from "vue";

const props = defineProps<{
  workingDir: string | null;
}>();

const emit = defineEmits<{
  "run-script": [command: string];
}>();

const scripts = ref<Record<string, string>>({});
const loading = ref(false);

const scriptEntries = computed(() =>
  Object.entries(scripts.value).map(([name, cmd]) => ({ name, cmd })),
);

async function loadScripts() {
  const ws = props.workingDir?.trim();
  if (!ws) {
    scripts.value = {};
    return;
  }
  loading.value = true;
  try {
    const pkgPath = `${ws.replace(/\\+$/, "")}\\package.json`;
    const raw = await invoke<string>("read_text_file", { path: pkgPath });
    const pkg = JSON.parse(raw) as { scripts?: Record<string, string> };
    scripts.value = pkg.scripts ?? {};
  } catch {
    scripts.value = {};
  } finally {
    loading.value = false;
  }
}

function runScript(name: string) {
  const ws = props.workingDir?.trim();
  if (!ws) {
    void fouAlert("请先选择工作目录", "提示");
    return;
  }
  emit("run-script", `pnpm run ${name}`);
}

onMounted(() => void loadScripts());
watch(() => props.workingDir, () => void loadScripts());
</script>

<template>
  <div class="ide-npm-panel ui-font">
    <header class="panel-head">
      <span class="panel-title">npm 脚本</span>
      <FouButton
        icon="refresh-line"
        size="small"
        text
        native-type="button"
        :loading="loading"
        aria-label="刷新"
        @click="loadScripts"
      />
    </header>
    <ul v-if="scriptEntries.length" class="script-list">
      <li v-for="s in scriptEntries" :key="s.name" class="script-row">
        <div class="script-info">
          <strong>{{ s.name }}</strong>
          <span class="cmd">{{ s.cmd }}</span>
        </div>
        <FouButton
          icon="play-line"
          size="small"
          native-type="button"
          @click="runScript(s.name)"
        >
          运行
        </FouButton>
      </li>
    </ul>
    <p v-else class="panel-empty muted">未找到 package.json 或 scripts 为空</p>
  </div>
</template>

<style scoped>
.ide-npm-panel {
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
.script-list {
  list-style: none;
  margin: 0;
  padding: 4px 0;
  overflow: auto;
  flex: 1;
}
.script-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--hairline);
}
.script-info {
  min-width: 0;
  flex: 1;
}
.script-info strong {
  display: block;
  font-size: 13px;
}
.cmd {
  display: block;
  font-size: 11px;
  color: var(--muted);
  font-family: var(--font-mono);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.panel-empty {
  padding: 16px 12px;
  font-size: 12px;
}
.muted {
  color: var(--muted);
}
</style>
