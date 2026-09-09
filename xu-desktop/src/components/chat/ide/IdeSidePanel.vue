<script setup lang="ts">
import { computed, ref } from "vue";
import type { IdeSideView } from "../../../composables/useIdeSideView";
import IdeSearchPanel from "./IdeSearchPanel.vue";
import IdeGitPanel from "./IdeGitPanel.vue";
import IdeExtensionsPanel from "./IdeExtensionsPanel.vue";
import IdeNpmPanel from "./IdeNpmPanel.vue";
import IdeOutlinePanel from "./IdeOutlinePanel.vue";
import IdeTimelinePanel from "./IdeTimelinePanel.vue";
import ProblemsPanel from "../ProblemsPanel.vue";
import FileTreePanel from "../../FileTreePanel.vue";
import type { LintDiagnostic } from "../../../utils/workspaceLint";
import type { ProjectGitConfig } from "../../../utils/projects";

const props = defineProps<{
  view: IdeSideView;
  workingDir: string | null;
  selectedPath: string | null;
  fileTreePinned?: boolean;
  diagnostics: LintDiagnostic[];
  activeFilePath: string | null;
  editorContent: string;
  problemsCollapsed?: boolean;
  projectGit?: ProjectGitConfig | null;
}>();

const emit = defineEmits<{
  "request-pick-dir": [];
  "open-terminal": [cwd?: string];
  "add-to-chat": [text: string];
  "preview-file": [path: string];
  "open-file": [path: string];
  "open-file-line": [path: string, line: number];
  "problem-select": [diag: LintDiagnostic];
  "problems-toggle": [];
  "run-npm-script": [command: string];
  "goto-line": [line: number];
}>();

const treeRef = ref<InstanceType<typeof FileTreePanel> | null>(null);

const fileName = computed(() => props.activeFilePath?.split(/[/\\]/).pop() ?? "");

defineExpose({
  revealPath: (path: string) => treeRef.value?.revealPath(path),
});
</script>

<template>
  <div class="ide-side-panel">
    <FileTreePanel
      v-show="view === 'explorer'"
      ref="treeRef"
      :initial-path="workingDir ?? ''"
      :pinned="fileTreePinned ?? true"
      :selected-path="selectedPath"
      @request-pick-dir="emit('request-pick-dir')"
      @open-terminal="emit('open-terminal', $event)"
      @add-to-chat="emit('add-to-chat', $event)"
      @preview-file="emit('preview-file', $event)"
      @open-file="emit('open-file', $event)"
    />
    <IdeSearchPanel
      v-if="view === 'search'"
      :working-dir="workingDir"
      @open-file="(p, line) => emit('open-file-line', p, line ?? 1)"
    />
    <IdeGitPanel
      v-else-if="view === 'scm'"
      :working-dir="workingDir"
      :project-git="projectGit"
      :diagnostics="diagnostics"
    />
    <div v-else-if="view === 'problems'" class="problems-wrap">
      <ProblemsPanel
        :diagnostics="diagnostics"
        :active-path="activeFilePath"
        :collapsed="problemsCollapsed"
        @toggle="emit('problems-toggle')"
        @select="emit('problem-select', $event)"
      />
    </div>
    <IdeExtensionsPanel v-else-if="view === 'extensions'" :working-dir="workingDir" />
    <IdeNpmPanel
      v-else-if="view === 'npm'"
      :working-dir="workingDir"
      @run-script="emit('run-npm-script', $event)"
    />
    <IdeOutlinePanel
      v-else-if="view === 'outline'"
      :content="editorContent"
      :filename="fileName"
      @goto-line="emit('goto-line', $event)"
    />
    <IdeTimelinePanel
      v-else-if="view === 'timeline'"
      :working-dir="workingDir"
      :file-path="activeFilePath"
    />
  </div>
</template>

<style scoped>
.ide-side-panel {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.problems-wrap {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.problems-wrap :deep(.problems-panel) {
  flex: 1;
  max-height: none;
  border-top: none;
}
</style>
