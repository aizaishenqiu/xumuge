<script setup lang="ts">
import { FouButton } from "foucui";
import { computed } from "vue";
import type { LintDiagnostic } from "../../utils/workspaceLint";
import { lintSeverityLabel, lintSummary } from "../../utils/workspaceLint";

const props = defineProps<{
  diagnostics: LintDiagnostic[];
  activePath: string | null;
  collapsed?: boolean;
}>();

const emit = defineEmits<{
  select: [diag: LintDiagnostic];
  toggle: [];
}>();

const filtered = computed(() => {
  if (!props.activePath) return props.diagnostics;
  const norm = props.activePath.replace(/\\/g, "/").toLowerCase();
  return props.diagnostics.filter(
    (d) => d.file.replace(/\\/g, "/").toLowerCase() === norm,
  );
});

const summary = computed(() => lintSummary(filtered.value));

function fileName(path: string): string {
  return path.replace(/^.*[/\\]/, "") || path;
}

function rowIcon(sev: string): string {
  if (sev === "error") return "error-warning-line";
  if (sev === "warning") return "alert-line";
  return "information-line";
}
</script>

<template>
  <section class="problems-panel ui-font" :class="{ collapsed }">
    <header class="problems-head">
      <FouButton
        class="head-toggle"
        :icon="collapsed ? 'arrow-up-s-line' : 'arrow-down-s-line'"
        text
        size="small"
        native-type="button"
        @click="emit('toggle')"
      >
        <span>问题</span>
        <span class="head-count">{{ summary }}</span>
      </FouButton>
    </header>
    <ul v-if="!collapsed && filtered.length" class="problems-list">
      <li
        v-for="(diag, idx) in filtered"
        :key="`${diag.file}-${diag.line}-${diag.column}-${idx}`"
        class="problem-row"
        :class="diag.severity"
        @click="emit('select', diag)"
      >
        <FouIcon :icon="rowIcon(diag.severity)" size="14" class="row-icon" />
        <span class="row-msg" :title="diag.message">{{ diag.message }}</span>
        <span class="row-loc">{{ fileName(diag.file) }}:{{ diag.line }}:{{ diag.column }}</span>
        <span class="row-sev">{{ lintSeverityLabel(diag.severity) }}</span>
      </li>
    </ul>
    <p v-else-if="!collapsed" class="problems-empty">当前文件无检查问题</p>
  </section>
</template>

<style scoped>
.problems-panel {
  flex-shrink: 0;
  border-top: 1px solid var(--hairline);
  background: var(--surface-soft);
  max-height: 180px;
  display: flex;
  flex-direction: column;
}
.problems-panel.collapsed {
  max-height: 34px;
}
.problems-head {
  display: flex;
  align-items: center;
  padding: 0 8px;
  min-height: 34px;
  border-bottom: 1px solid var(--hairline);
}
.head-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 12px;
  color: var(--body);
  padding: 4px 2px;
}
.head-count {
  color: var(--muted);
  font-size: 11px;
}
.problems-list {
  list-style: none;
  margin: 0;
  padding: 0;
  overflow: auto;
  flex: 1;
}
.problem-row {
  display: grid;
  grid-template-columns: auto 1fr auto auto;
  gap: 8px;
  align-items: center;
  padding: 5px 10px;
  font-size: 12px;
  cursor: pointer;
  border-bottom: 1px solid color-mix(in srgb, var(--hairline) 60%, transparent);
}
.problem-row:hover {
  background: var(--canvas);
}
.problem-row.error .row-icon {
  color: #dc2626;
}
.problem-row.warning .row-icon {
  color: #d97706;
}
.row-msg {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.row-loc,
.row-sev {
  color: var(--muted);
  font-size: 11px;
  white-space: nowrap;
}
.problems-empty {
  margin: 0;
  padding: 10px 12px;
  font-size: 12px;
  color: var(--muted);
}
</style>
