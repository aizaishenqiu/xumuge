<script setup lang="ts">
import { onApiCatch } from "../../utils/userFacingError";
import { FouButton, fouMsg, fouAlert} from "foucui";
import { invoke } from "@tauri-apps/api/core";
import { computed, onUnmounted, ref, watch } from "vue";
import CodeMirrorEditor from "./CodeMirrorEditor.vue";
import ChatMarkdown from "./ChatMarkdown.vue";
import { readIdeCliOverride } from "../../utils/ideCli";
import { toRelativePath } from "../../utils/chatWorkspace";
import type { LintDiagnostic } from "../../utils/workspaceLint";
import { isMarkdownPath } from "../../utils/fileTypes";
import PatchDiffCard from "./PatchDiffCard.vue";
import type { PatchFileChange } from "../../utils/patchDiff";
import { toUserError } from "../../utils/userFacingError";

type FileViewTab = "preview" | "edit" | "diff";

const props = defineProps<{
  path: string | null;
  workingDir: string | null;
  variant?: "drawer" | "editor";
  collapsed?: boolean;
  hidePathTitle?: boolean;
  viewTab?: FileViewTab;
  diagnostics?: LintDiagnostic[];
  diffChanges?: PatchFileChange[] | null;
}>();

const emit = defineEmits<{
  close: [];
  "add-to-chat": [text: string];
  collapse: [];
  "dirty-change": [dirty: boolean];
  "update:viewTab": [tab: FileViewTab];
  saved: [];
  lint: [];
  "goto-line": [line: number, column: number];
  "content-change": [content: string];
  cursor: [line: number, column: number];
  "goto-definition": [file: string, line: number, column: number];
}>();

const content = ref("");
const savedContent = ref("");
const loading = ref(false);
const saving = ref(false);
const linting = ref(false);
const error = ref("");
const activeTab = ref<FileViewTab>("edit");
const cmRef = ref<InstanceType<typeof CodeMirrorEditor> | null>(null);
const previewMdRef = ref<HTMLElement | null>(null);
const previewDragging = ref(false);
const previewZoom = ref(1);
const PREVIEW_ZOOM_MIN = 0.5;
const PREVIEW_ZOOM_MAX = 2.5;
const PREVIEW_ZOOM_STEP = 0.1;
let previewDragStartY = 0;
let previewDragScrollTop = 0;
let previewDragMoved = false;
let loadSeq = 0;

const LOAD_TIMEOUT_MS = 20_000;

const isMarkdown = computed(() => isMarkdownPath(props.path));
const showPreviewTab = computed(() => isMarkdown.value);
const showDiffTab = computed(() => (props.diffChanges?.length ?? 0) > 0);
const showTabRow = computed(() => showPreviewTab.value || showDiffTab.value);
const isEditor = computed(() => (props.variant ?? "drawer") === "editor");
const showEditorHead = computed(
  () => isDrawer.value || showTabRow.value || !props.hidePathTitle,
);
const autoSaveEnabled = computed(() => isEditor.value && !isMarkdown.value);

let autoSaveTimer: ReturnType<typeof setTimeout> | null = null;

watch(
  () => props.viewTab,
  (tab) => {
    if (tab) activeTab.value = tab;
  },
);

watch(activeTab, (tab) => {
  emit("update:viewTab", tab);
});

const isDrawer = computed(() => (props.variant ?? "drawer") === "drawer");
const visible = computed(() => {
  if (isDrawer.value) return Boolean(props.path) && !props.collapsed;
  return true;
});
const dirty = computed(() => content.value !== savedContent.value);
const fileName = computed(() => props.path?.split(/[/\\]/).pop() ?? "");

watch(dirty, (d) => {
  emit("dirty-change", d);
});

watch(content, (c) => {
  emit("content-change", c);
  scheduleAutoSave();
});

function scheduleAutoSave() {
  if (!autoSaveEnabled.value || loading.value || !dirty.value) return;
  if (autoSaveTimer) window.clearTimeout(autoSaveTimer);
  autoSaveTimer = window.setTimeout(() => {
    void autoSaveFile();
  }, 700);
}

onUnmounted(() => {
  if (autoSaveTimer) window.clearTimeout(autoSaveTimer);
});

async function autoSaveFile() {
  if (!props.path || !props.workingDir?.trim() || !dirty.value) return;
  if (isMarkdownPath(props.path)) return;
  saving.value = true;
  try {
    await invoke("write_text_file", {
      workspace: props.workingDir,
      path: props.path,
      content: content.value,
    });
    savedContent.value = content.value;
    emit("saved");
  } catch (e) {
    void onApiCatch(e);
  } finally {
    saving.value = false;
  }
}

const relPath = computed(() => {
  if (!props.path || !props.workingDir) return props.path || "";
  return toRelativePath(props.workingDir, props.path);
});

const tabLabel = (tab: FileViewTab) => {
  if (tab === "preview") {
    const base = "预览";
    return dirty.value && activeTab.value === "edit" ? `${base}` : base;
  }
  if (tab === "diff") return "变更";
  const base = "编辑";
  if (dirty.value) return `${base} *`;
  return base;
};

async function loadFile(p: string, seq: number) {
  loading.value = true;
  error.value = "";
  try {
    const text = await Promise.race([
      invoke<string>("read_text_file", { path: p }),
      new Promise<never>((_, reject) => {
        window.setTimeout(() => reject(new Error("读取超时，请重启应用或重试")), LOAD_TIMEOUT_MS);
      }),
    ]);
    if (seq !== loadSeq) return;
    content.value = text;
    savedContent.value = text;
    if (activeTab.value !== "diff") {
      activeTab.value = isMarkdownPath(p) ? "preview" : "edit";
    }
  } catch (e) {
    if (seq !== loadSeq) return;
    error.value = toUserError(e);
    content.value = "";
    savedContent.value = "";
  } finally {
    if (seq === loadSeq) loading.value = false;
  }
}

watch(
  () => props.path,
  (p) => {
    loadSeq += 1;
    const seq = loadSeq;
    if (!p?.trim()) {
      loading.value = false;
      content.value = "";
      savedContent.value = "";
      error.value = "";
      return;
    }
    void loadFile(p, seq);
  },
  { immediate: true },
);

async function openInIde() {
  if (!props.path) return;
  try {
    await invoke("open_with_editor", {
      path: props.path,
      editor: readIdeCliOverride() || "cursor",
    });
  } catch (e) {
    void onApiCatch(e);
  }
}

async function saveFile() {
  if (!props.path || !props.workingDir?.trim()) {
    void fouAlert("请先选择工作目录", "提示");
    return;
  }
  saving.value = true;
  try {
    await invoke("write_text_file", {
      workspace: props.workingDir,
      path: props.path,
      content: content.value,
    });
    savedContent.value = content.value;
    fouMsg.success("已保存");
    emit("saved");
  } catch (e) {
    void onApiCatch(e);
  } finally {
    saving.value = false;
  }
}

function runLint() {
  linting.value = true;
  emit("lint");
  window.setTimeout(() => {
    linting.value = false;
  }, 400);
}

function goToLine(line: number, column: number) {
  activeTab.value = "edit";
  window.setTimeout(() => {
    cmRef.value?.goToLine(line, column);
  }, 0);
  emit("goto-line", line, column);
}

function previewInteractiveTarget(el: EventTarget | null): boolean {
  if (!(el instanceof Element)) return false;
  return Boolean(el.closest("a, button, input, textarea, select, .md-code-copy"));
}

function onPreviewPointerDown(e: PointerEvent) {
  if (e.button !== 0) return;
  if (previewInteractiveTarget(e.target)) return;
  const el = previewMdRef.value;
  if (!el) return;
  previewDragging.value = true;
  previewDragMoved = false;
  previewDragStartY = e.clientY;
  previewDragScrollTop = el.scrollTop;
  el.setPointerCapture(e.pointerId);
}

function onPreviewPointerMove(e: PointerEvent) {
  if (!previewDragging.value) return;
  const el = previewMdRef.value;
  if (!el) return;
  const dy = e.clientY - previewDragStartY;
  if (Math.abs(dy) > 3) previewDragMoved = true;
  el.scrollTop = previewDragScrollTop - dy;
  e.preventDefault();
}

function onPreviewPointerUp(e: PointerEvent) {
  if (!previewDragging.value) return;
  const el = previewMdRef.value;
  previewDragging.value = false;
  try {
    el?.releasePointerCapture(e.pointerId);
  } catch {
    /* ignore */
  }
}

function onPreviewClickCapture(e: MouseEvent) {
  if (previewDragMoved) {
    e.preventDefault();
    e.stopPropagation();
    previewDragMoved = false;
  }
}

function onPreviewWheel(e: WheelEvent) {
  if (!e.ctrlKey && !e.metaKey) return;
  e.preventDefault();
  const dir = e.deltaY > 0 ? -1 : 1;
  const next = Math.round((previewZoom.value + dir * PREVIEW_ZOOM_STEP) * 100) / 100;
  previewZoom.value = Math.min(PREVIEW_ZOOM_MAX, Math.max(PREVIEW_ZOOM_MIN, next));
}

watch(
  () => props.path,
  () => {
    previewZoom.value = 1;
  },
);

defineExpose({
  goToLine,
  save: () => saveFile(),
  reload: () => {
    if (!props.path?.trim()) return;
    loadSeq += 1;
    void loadFile(props.path, loadSeq);
  },
});
</script>

<template>
  <aside v-if="visible" class="file-editor ui-font" :class="{ 'is-drawer': isDrawer, 'is-editor': !isDrawer }">
    <header v-if="showEditorHead" class="editor-head">
      <FouButton
        v-if="isDrawer"
        icon="side-bar-line"
        size="small"
        text
        native-type="button"
        aria-label="收起预览"
        @click="emit('collapse')"
      />
      <span v-if="!hidePathTitle" class="editor-title" :title="relPath">{{ relPath || "文件" }}</span>
      <div v-if="path && showTabRow" class="tab-row">
        <template v-if="showPreviewTab">
          <FouButton
            class="tab-btn"
            :class="{ active: activeTab === 'preview' }"
            icon="eye-line"
            size="small"
            text
            native-type="button"
            @click="activeTab = 'preview'"
          >
            {{ tabLabel('preview') }}
          </FouButton>
        </template>
        <FouButton
          class="tab-btn"
          :class="{ active: activeTab === 'edit' }"
          icon="edit-line"
          size="small"
          text
          native-type="button"
          @click="activeTab = 'edit'"
        >
          {{ tabLabel('edit') }}
        </FouButton>
        <FouButton
          v-if="showDiffTab"
          class="tab-btn"
          :class="{ active: activeTab === 'diff' }"
          icon="git-merge-line"
          size="small"
          text
          native-type="button"
          @click="activeTab = 'diff'"
        >
          {{ tabLabel('diff') }}
        </FouButton>
      </div>
      <FouButton
        v-if="isDrawer"
        icon="close-line"
        size="small"
        text
        native-type="button"
        aria-label="关闭"
        @click="emit('close')"
      />
    </header>

    <div v-if="!path" class="editor-empty muted">从文件树选择文件以预览或编辑</div>
    <div v-else-if="loading" class="editor-body muted">加载中…</div>
    <div v-else-if="error" class="editor-error">{{ error }}</div>
    <div
      v-else-if="showPreviewTab && activeTab === 'preview'"
      ref="previewMdRef"
      class="editor-body preview-md"
      :class="{ 'is-dragging': previewDragging }"
      @pointerdown="onPreviewPointerDown"
      @pointermove="onPreviewPointerMove"
      @pointerup="onPreviewPointerUp"
      @pointercancel="onPreviewPointerUp"
      @click.capture="onPreviewClickCapture"
      @wheel="onPreviewWheel"
    >
      <ChatMarkdown
        :content="content"
        class="preview-md-doc"
        :style="{ zoom: previewZoom }"
      />
    </div>
    <div v-else-if="activeTab === 'diff' && showDiffTab" class="editor-body diff-pane">
      <PatchDiffCard :changes="diffChanges ?? []" compact />
    </div>
    <CodeMirrorEditor
      v-else-if="activeTab === 'edit' || !showDiffTab"
      ref="cmRef"
      v-model="content"
      class="editor-body edit"
      :filename="fileName"
      :file-path="path"
      :working-dir="workingDir"
      :diagnostics="diagnostics ?? []"
      @cursor="(line, col) => emit('cursor', line, col)"
      @goto-definition="(loc) => emit('goto-definition', loc.file, loc.line, loc.column)"
    />

    <footer v-if="path && !isEditor" class="editor-foot">
      <FouButton
        v-if="isMarkdown || isDrawer"
        icon="save-line"
        size="small"
        native-type="button"
        :loading="saving"
        :disabled="!dirty"
        @click="saveFile"
      >
        保存
      </FouButton>
      <span v-else-if="saving" class="save-hint muted">自动保存中…</span>
      <span v-else-if="dirty" class="save-hint muted">待保存…</span>
      <span v-else class="save-hint muted">已自动保存</span>
      <FouButton
        icon="error-warning-line"
        size="small"
        native-type="button"
        :loading="linting"
        @click="runLint"
      >
        检查
      </FouButton>
      <FouButton icon="code-box-line" size="small" native-type="button" @click="openInIde">在 IDE 打开</FouButton>
    </footer>
  </aside>
  <div v-else-if="isDrawer && path && collapsed" class="preview-collapsed">
    <FouButton
      icon="file-text-line"
      size="small"
      text
      native-type="button"
      :title="relPath"
      @click="emit('collapse')"
    >
      预览
    </FouButton>
  </div>
</template>

<style scoped>
.file-editor {
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--surface-card);
}
.file-editor.is-drawer {
  width: min(360px, 28vw);
  min-width: 240px;
  flex-shrink: 0;
  border-right: 1px solid var(--hairline);
  z-index: 1;
}
.file-editor.is-editor {
  flex: 1;
  min-width: 0;
  width: 100%;
  align-self: stretch;
  border-bottom: none;
}
.editor-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--hairline);
  background: var(--surface-soft);
  flex-wrap: wrap;
}
.editor-title {
  flex: 1;
  min-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  font-family: var(--font-mono);
}
.tab-row {
  display: flex;
  gap: 4px;
}
.tab-btn {
  border: 1px solid var(--hairline);
  background: var(--canvas);
  border-radius: 6px;
  padding: 2px 8px;
  font-size: 11px;
  cursor: pointer;
}
.tab-btn.active {
  border-color: var(--primary);
  color: var(--primary);
  background: var(--primary-glow);
}
.editor-body {
  flex: 1;
  min-height: 0;
  margin: 0;
  padding: 10px 12px;
  overflow: auto;
  font-size: 12px;
  line-height: 1.5;
  font-family: var(--font-mono);
}
.editor-body.preview-md {
  padding: 16px 24px;
  overflow: auto;
  font-family: var(--font-sans, system-ui, sans-serif);
  cursor: grab;
  user-select: none;
}
.editor-body.preview-md.is-dragging {
  cursor: grabbing;
}
.editor-body.preview-md :deep(a),
.editor-body.preview-md :deep(button),
.editor-body.preview-md :deep(.md-code-copy) {
  cursor: pointer;
  user-select: auto;
}
.editor-body.preview-md .preview-md-doc,
.editor-body.preview-md :deep(.chat-md) {
  display: block;
  box-sizing: border-box;
  font-size: 13px;
  min-width: 1288px;
  width: 1288px;
  max-width: 1288px;
  margin: 0 auto;
  padding: 28px 40px 40px;
  background: var(--surface, #fff);
  border: 1px solid var(--hairline, #e2e8f0);
  border-radius: 8px;
  box-shadow:
    0 1px 2px rgba(15, 23, 42, 0.04),
    0 8px 24px rgba(15, 23, 42, 0.08);
}
.editor-body.edit {
  display: flex;
  flex-direction: column;
  padding: 0;
  overflow: hidden;
}
.editor-body.diff-pane {
  padding: 8px 10px;
  overflow: auto;
}
.editor-body.muted,
.editor-empty {
  color: var(--muted);
  padding: 16px;
  font-size: 13px;
}
.editor-error {
  flex: 1;
  padding: 12px;
  font-size: 12px;
  color: #b91c1c;
  background: color-mix(in srgb, #dc2626 8%, transparent);
}
.editor-foot.compact {
  padding: 4px 8px;
  gap: 4px;
}
.save-hint {
  font-size: 11px;
  margin-right: 4px;
}
.editor-foot {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 8px 10px;
  border-top: 1px solid var(--hairline);
}
.preview-collapsed {
  width: 48px;
  flex-shrink: 0;
  border-right: 1px solid var(--hairline);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 8px;
  background: var(--surface-soft);
}
</style>
