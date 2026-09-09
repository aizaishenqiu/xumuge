<script setup lang="ts">
/**
 * @file CanvasStudioPanel.vue Canvas 画板壳（草图/流程/甘特/图册）
 * @author qiuye <yjk150@qq.com>
 * @date 2026-09-06
 * @updated 2026-09-07
 * @version 1.4.0
 * @category Layout
 * @algo canvas-workspace-gate
 */
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { FouButton } from "foucui";
import { openHelp } from "../../composables/useHelp";
import {
  onCanvasAlbumInsert,
  onCanvasFlowUpdated,
  onCanvasSketchUpdated,
} from "../../utils/crossWindowBus";
import { loadProjects } from "../../utils/projects";
import CanvasSketchPad from "./CanvasSketchPad.vue";
import CanvasFlowPad from "./CanvasFlowPad.vue";
import CanvasMermaidPad from "./CanvasMermaidPad.vue";
import CanvasUiPad from "./CanvasUiPad.vue";

const props = defineProps<{
  workspace?: string | null;
}>();

const emit = defineEmits<{
  pickWorkspace: [];
}>();

type Tab = "sketch" | "flow" | "mermaid" | "gantt" | "ui";
const tab = ref<Tab>("sketch");
const projectLabel = ref("");

const folderName = computed(() => {
  const ws = (props.workspace || "").replace(/\\/g, "/").replace(/\/+$/, "");
  if (!ws) return "";
  const parts = ws.split("/").filter(Boolean);
  return parts[parts.length - 1] || ws;
});

const subtitle = computed(() => {
  if (projectLabel.value) return `项目：${projectLabel.value}`;
  if (folderName.value) return `工作区：${folderName.value}`;
  return "草图 / 流程 / 甘特 / 图册";
});

function sameWorkspace(a: string, b: string): boolean {
  return a.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase() === b.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

async function refreshProjectLabel() {
  const ws = (props.workspace || "").trim();
  if (!ws) {
    projectLabel.value = "";
    return;
  }
  try {
    const list = await loadProjects();
    const norm = ws.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
    const hit = list.find((p) => {
      const gp = (p.generatePath || "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
      return gp && (norm === gp || norm.startsWith(gp + "/") || gp.startsWith(norm + "/"));
    });
    projectLabel.value = hit?.name?.trim() || "";
  } catch {
    projectLabel.value = "";
  }
}

watch(
  () => props.workspace,
  () => {
    void refreshProjectLabel();
  },
  { immediate: true },
);

let unlistenSketch: (() => void) | undefined;
let unlistenAlbum: (() => void) | undefined;
let unlistenFlow: (() => void) | undefined;
onMounted(() => {
  void onCanvasSketchUpdated((ws) => {
    const cur = (props.workspace || "").trim();
    if (!cur || !sameWorkspace(cur, ws)) return;
    tab.value = "sketch";
  }).then((fn) => {
    unlistenSketch = fn;
  });
  void onCanvasAlbumInsert((p) => {
    const cur = (props.workspace || "").trim();
    if (!cur || !sameWorkspace(cur, p.workspace)) return;
    tab.value = "sketch";
  }).then((fn) => {
    unlistenAlbum = fn;
  });
  void onCanvasFlowUpdated((p) => {
    const cur = (props.workspace || "").trim();
    if (!cur || !sameWorkspace(cur, p.workspace)) return;
    tab.value = "flow";
  }).then((fn) => {
    unlistenFlow = fn;
  });
});
onUnmounted(() => {
  unlistenSketch?.();
  unlistenAlbum?.();
  unlistenFlow?.();
});
</script>

<template>
  <div class="canvas-studio ui-font">
    <header class="cs-header">
      <FouIcon icon="artboard-2-line" class="cs-icon" />
      <div class="cs-titles">
        <strong>Canvas</strong>
        <span class="cs-sub">{{ subtitle }}</span>
      </div>
      <div v-if="$slots.actions" class="cs-actions">
        <slot name="actions" />
      </div>
      <FouButton icon="question-line" size="small" text native-type="button" aria-label="Canvas 帮助" @click="openHelp('chat.canvas')">
        帮助
      </FouButton>
    </header>
    <nav v-if="props.workspace" class="cs-tabs">
      <FouButton icon="pencil-line" size="small" :type="tab === 'sketch' ? 'primary' : 'default'" native-type="button" @click="tab = 'sketch'">
        草图
      </FouButton>
      <FouButton icon="organization-chart" size="small" :type="tab === 'flow' ? 'primary' : 'default'" native-type="button" @click="tab = 'flow'">
        流程
      </FouButton>
      <FouButton icon="code-s-slash-line" size="small" :type="tab === 'mermaid' ? 'primary' : 'default'" native-type="button" @click="tab = 'mermaid'">
        流程文本
      </FouButton>
      <FouButton icon="calendar-todo-line" size="small" :type="tab === 'gantt' ? 'primary' : 'default'" native-type="button" @click="tab = 'gantt'">
        甘特
      </FouButton>
      <FouButton icon="image-line" size="small" :type="tab === 'ui' ? 'primary' : 'default'" native-type="button" @click="tab = 'ui'">
        图册
      </FouButton>
    </nav>
    <div v-if="!props.workspace" class="cs-need ui-font">
      <p>正在准备默认画板目录…若长时间无响应，请手动选择工作区。</p>
      <FouButton
        icon="folder-open-line"
        type="primary"
        size="small"
        native-type="button"
        @click="emit('pickWorkspace')"
      >
        选择工作区
      </FouButton>
    </div>
    <div v-else class="cs-body">
      <CanvasSketchPad
        v-show="tab === 'sketch'"
        :key="props.workspace + '-sk'"
        :workspace="props.workspace"
        :active="tab === 'sketch'"
      />
      <CanvasFlowPad v-if="tab === 'flow'" :key="props.workspace + '-fl'" :workspace="props.workspace" />
      <CanvasMermaidPad v-else-if="tab === 'mermaid'" :key="props.workspace + '-mm'" :workspace="props.workspace" kind="flow" />
      <CanvasMermaidPad v-else-if="tab === 'gantt'" :key="props.workspace + '-gt'" :workspace="props.workspace" kind="gantt" />
      <CanvasUiPad v-else-if="tab === 'ui'" :key="props.workspace + '-ui'" :workspace="props.workspace" @inserted="tab = 'sketch'" />
    </div>
  </div>
</template>

<style scoped>
.canvas-studio {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--surface, #fff);
}
.cs-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--hairline);
  flex-shrink: 0;
}
.cs-icon {
  font-size: 22px;
  color: var(--primary, #0d9488);
}
.cs-titles {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1;
}
.cs-sub {
  font-size: 12px;
  color: var(--muted, #888);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cs-actions {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}
.cs-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--hairline);
  flex-shrink: 0;
}
.cs-need {
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  align-items: flex-start;
}
.cs-body {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
</style>
