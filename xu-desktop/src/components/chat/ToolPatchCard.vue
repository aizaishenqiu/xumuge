<script setup lang="ts">
import { computed } from "vue";
import type { ToolCallBlock } from "../../types";
import { isPatchTool, parseToolPatch } from "../../utils/patchDiff";
import { formatToolApprovalLabel, formatToolArgsSummary } from "../../utils/toolApprovalLabels";
import { sanitizeUserDisplayText } from "../../utils/userFacingError";
import PatchDiffCard from "./PatchDiffCard.vue";

const props = defineProps<{
  block: ToolCallBlock;
  defaultOpen?: boolean;
}>();

const changes = computed(() => parseToolPatch(props.block.name, props.block.input));
const showDiff = computed(() => isPatchTool(props.block.name) && changes.value.length > 0);
const toolLabel = computed(() => formatToolApprovalLabel(props.block.name, props.block.input || undefined));
const argsSummary = computed(() => formatToolArgsSummary(props.block.name, props.block.input || undefined));
const outputSummary = computed(() =>
  props.block.output ? sanitizeUserDisplayText(props.block.output, "") : "",
);
</script>

<template>
  <details class="tool-patch-card">
    <summary class="ui-font">
      <FouIcon icon="tools-line" size="14" />
      {{ toolLabel }}
      <span v-if="block.outputDone" class="done-tag">完成</span>
      <span v-else class="run-tag">执行中…</span>
    </summary>
    <PatchDiffCard v-if="showDiff" :changes="changes" compact />
    <p v-else-if="argsSummary && argsSummary !== toolLabel" class="tool-summary">{{ argsSummary }}</p>
    <p v-if="outputSummary" class="tool-summary out">{{ outputSummary }}</p>
  </details>
</template>

<style scoped>
.tool-patch-card {
  width: 100%;
  background: var(--surface-soft);
  border: 1px solid var(--hairline);
  border-radius: 10px;
  padding: 8px 10px;
  font-size: 12px;
}
.tool-patch-card summary {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  list-style: none;
  color: var(--body);
}
.tool-patch-card summary::-webkit-details-marker {
  display: none;
}
.done-tag {
  margin-left: auto;
  font-size: 11px;
  color: #16a34a;
}
.run-tag {
  margin-left: auto;
  font-size: 11px;
  color: var(--accent, #2563eb);
}
.tool-summary {
  margin: 8px 0 0;
  padding: 0;
  font-size: 12px;
  line-height: 1.45;
  color: var(--muted);
  word-break: break-word;
}
.tool-summary.out {
  margin-top: 6px;
}
</style>
