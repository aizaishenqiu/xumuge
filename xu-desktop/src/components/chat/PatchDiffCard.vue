<script setup lang="ts">
import { computed } from "vue";
import { kindLabel, type PatchFileChange } from "../../utils/patchDiff";

const props = defineProps<{
  changes: PatchFileChange[];
  compact?: boolean;
}>();

const visible = computed(() => props.changes.filter((c) => c.path));
</script>

<template>
  <div class="patch-diff" :class="{ compact }">
    <div v-for="(ch, idx) in visible" :key="idx" class="patch-file">
      <div class="patch-head ui-font">
        <FouIcon
          :icon="
            ch.kind === 'add'
              ? 'file-add-line'
              : ch.kind === 'delete'
                ? 'delete-bin-line'
                : ch.kind === 'move'
                  ? 'file-transfer-line'
                  : 'file-edit-line'
          "
          size="14"
        />
        <span class="patch-path" :title="ch.path">{{ ch.path }}</span>
        <span class="patch-kind">{{ kindLabel(ch.kind) }}</span>
        <span v-if="ch.moveTo" class="patch-move">→ {{ ch.moveTo }}</span>
      </div>
      <pre v-if="ch.lines.length" class="patch-lines"><code
        ><span
          v-for="(line, li) in ch.lines"
          :key="li"
          class="diff-line"
          :class="line.type"
        >{{ line.type === "add" ? "+ " : line.type === "del" ? "- " : "  " }}{{ line.text }}
</span></code></pre>
      <p v-else-if="ch.kind === 'delete'" class="patch-empty ui-font">（将删除此文件）</p>
    </div>
  </div>
</template>

<style scoped>
.patch-diff {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.patch-diff.compact .patch-lines {
  max-height: 200px;
}
.patch-file {
  border: 1px solid var(--hairline);
  border-radius: 10px;
  background: var(--surface);
  overflow: hidden;
}
.patch-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  background: var(--surface-soft);
  border-bottom: 1px solid var(--hairline);
  font-size: 12px;
}
.patch-path {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-mono);
  color: var(--body);
}
.patch-kind {
  flex-shrink: 0;
  font-size: 11px;
  color: var(--muted);
  padding: 2px 6px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--accent, #2563eb) 8%, transparent);
}
.patch-move {
  font-size: 11px;
  color: var(--muted);
  font-family: var(--font-mono);
}
.patch-lines {
  margin: 0;
  padding: 8px 0;
  overflow: auto;
  max-height: 360px;
  font-size: 11px;
  line-height: 1.45;
  font-family: var(--font-mono);
}
.diff-line {
  display: block;
  padding: 0 10px;
  white-space: pre-wrap;
  word-break: break-word;
}
.diff-line.ctx {
  color: var(--muted);
}
.diff-line.add {
  background: color-mix(in srgb, #16a34a 12%, transparent);
  color: #15803d;
}
.diff-line.del {
  background: color-mix(in srgb, #dc2626 10%, transparent);
  color: #b91c1c;
}
.patch-empty {
  margin: 0;
  padding: 10px;
  font-size: 12px;
  color: var(--muted);
}
</style>
