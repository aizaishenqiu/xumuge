<script setup lang="ts">
/**
 * @file CanvasMermaidPad.vue 流程文本 / 甘特（Mermaid）
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-31
 * @updated 2026-09-07
 * @version 1.2.0
 * @category Layout
 * @algo mermaid-debounce-preview
 */
import { onMounted, onUnmounted, ref, watch } from "vue";
import { FouButton } from "foucui";
import { CANVAS_DIRS, ensureCanvasDirs, readCanvasText, writeCanvasText } from "../../canvas/canvasIo";
import { renderMermaid } from "../../canvas/mermaidRuntime";
import { toUserError } from "../../utils/userFacingError";

const props = defineProps<{
  workspace: string;
  kind: "flow" | "gantt";
}>();

const kindLabel = () => (props.kind === "gantt" ? "甘特" : "流程文本");

const source = ref(
  props.kind === "gantt"
    ? "gantt\n    title 项目计划\n    dateFormat YYYY-MM-DD\n    section 设计\n    草图 :a1, 2026-08-26, 3d\n    section 开发\n    实现 :a2, after a1, 5d"
    : "flowchart TD\n    A[开始] --> B[处理]\n    B --> C[结束]",
);
const svgHtml = ref("");
const status = ref("");
const error = ref("");
let debounceTimer: number | undefined;

function fileRel() {
  return props.kind === "gantt" ? `${CANVAS_DIRS.gantt}/board.mmd` : `${CANVAS_DIRS.flow}/board.mmd`;
}

async function render() {
  error.value = "";
  try {
    const id = `mmd-${props.kind}-${Date.now()}`;
    svgHtml.value = await renderMermaid(id, source.value);
  } catch (e) {
    error.value = toUserError(e).slice(0, 240);
    svgHtml.value = "";
  }
}

function scheduleRender() {
  window.clearTimeout(debounceTimer);
  debounceTimer = window.setTimeout(() => {
    void render();
  }, 400);
}

async function save() {
  if (!props.workspace) {
    status.value = "请先选择工作区";
    return;
  }
  await ensureCanvasDirs(props.workspace);
  await writeCanvasText(props.workspace, fileRel(), source.value);
  status.value = `已保存${kindLabel()}`;
  await render();
}

async function load() {
  if (!props.workspace) {
    await render();
    return;
  }
  await ensureCanvasDirs(props.workspace);
  try {
    source.value = await readCanvasText(props.workspace, fileRel());
    status.value = `已载入${kindLabel()}`;
  } catch {
    /* keep default */
  }
  await render();
}

onMounted(() => {
  void load();
});

onUnmounted(() => {
  window.clearTimeout(debounceTimer);
});

watch(
  () => props.kind,
  () => void load(),
);

watch(source, () => {
  scheduleRender();
});
</script>

<template>
  <div class="cmm">
    <div class="cmm-bar">
      <FouButton icon="eye-line" size="small" native-type="button" @click="render">预览</FouButton>
      <FouButton icon="save-line" type="primary" size="small" native-type="button" @click="save">保存</FouButton>
      <span class="cmm-status ui-font">{{ status }} · {{ kindLabel() }}（改字自动预览）</span>
    </div>
    <div class="cmm-split">
      <textarea v-model="source" class="cmm-src ui-font" spellcheck="false" />
      <div class="cmm-preview">
        <p v-if="error" class="cmm-err ui-font">{{ error }}</p>
        <div v-else class="cmm-svg" v-html="svgHtml" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.cmm {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
.cmm-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
  padding: 8px;
  border-bottom: 1px solid var(--hairline);
}
.cmm-status {
  font-size: 12px;
  color: var(--muted, #888);
}
.cmm-split {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-rows: 1fr 1fr;
}
.cmm-src {
  width: 100%;
  min-height: 120px;
  border: none;
  border-bottom: 1px solid var(--hairline);
  resize: none;
  padding: 10px;
  font-size: 13px;
  line-height: 1.45;
  outline: none;
  background: var(--surface, #fff);
  color: inherit;
}
.cmm-preview {
  min-height: 0;
  overflow: auto;
  padding: 10px;
}
.cmm-err {
  margin: 0;
  color: #b91c1c;
  font-size: 13px;
  white-space: pre-wrap;
}
.cmm-svg :deep(svg) {
  max-width: 100%;
  height: auto;
}
</style>
