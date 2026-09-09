<script setup lang="ts">
import { computed } from "vue";
import { detectEol, languageLabelForPath, type EolKind } from "../../../utils/fileTypes";
import { isIdeSettingsTab } from "../../../utils/ideSpecialTabs";

const props = defineProps<{
  workingDir: string | null;
  filePath: string | null;
  fileContent?: string;
  line?: number;
  column?: number;
  gitBranch?: string | null;
  encoding?: string;
}>();

const shortPath = computed(() => {
  const p = props.filePath;
  if (!p || isIdeSettingsTab(p)) return p && isIdeSettingsTab(p) ? "设置" : "未打开文件";
  const parts = p.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || p;
});

const workspaceLabel = computed(() => {
  const d = props.workingDir;
  if (!d) return "未选择工作区";
  const parts = d.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || d;
});

const languageLabel = computed(() => {
  if (!props.filePath || isIdeSettingsTab(props.filePath)) return "";
  return languageLabelForPath(props.filePath);
});

const eolLabel = computed((): EolKind | "" => {
  if (!props.filePath || isIdeSettingsTab(props.filePath)) return "";
  return detectEol(props.fileContent ?? "");
});

const positionLabel = computed(() => {
  if (!props.filePath || isIdeSettingsTab(props.filePath)) return "";
  return `Ln ${props.line ?? 1}, Col ${props.column ?? 1}`;
});
</script>

<template>
  <footer class="ide-status-bar ui-font">
    <span class="ide-status-item" :title="workingDir || ''">{{ workspaceLabel }}</span>
    <span class="ide-status-spacer" />
    <span v-if="gitBranch" class="ide-status-item" title="Git 分支">{{ gitBranch }}</span>
    <span class="ide-status-item" :title="filePath || ''">{{ shortPath }}</span>
    <span v-if="positionLabel" class="ide-status-item">{{ positionLabel }}</span>
    <span v-if="languageLabel" class="ide-status-item">{{ languageLabel }}</span>
    <span v-if="eolLabel" class="ide-status-item">{{ eolLabel }}</span>
    <span v-if="filePath && !isIdeSettingsTab(filePath)" class="ide-status-item">{{
      encoding || "UTF-8"
    }}</span>
  </footer>
</template>

<style scoped>
.ide-status-bar {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 12px;
  height: 24px;
  padding: 0 10px;
  font-size: 11px;
  color: var(--text-secondary, #94a3b8);
  background: color-mix(in srgb, var(--primary, #2dd4bf) 18%, #0d1117);
  border-top: 1px solid var(--hairline, #2a3441);
}
.ide-status-spacer {
  flex: 1;
}
.ide-status-item {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 220px;
}
</style>
