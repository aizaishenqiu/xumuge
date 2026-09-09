<script setup lang="ts">
import { onApiCatch } from "../utils/userFacingError";
/**
 * @author qiuye <yjk150@qq.com>
 */
import { computed, defineAsyncComponent, onMounted, onUnmounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { invoke } from "@tauri-apps/api/core";
import { fouMsg, FouButton, fouAlert} from "foucui";
import { open as openFileDialog, save as saveFileDialog } from "@tauri-apps/plugin-dialog";
import FileEditorPanel from "../components/chat/FileEditorPanel.vue";
import FileEditorTabs from "../components/chat/FileEditorTabs.vue";
import IdeActivityBar from "../components/chat/ide/IdeActivityBar.vue";
import IdeSidePanel from "../components/chat/ide/IdeSidePanel.vue";
import IdeTerminalDock from "../components/chat/ide/IdeTerminalDock.vue";
import IdeStatusBar from "../components/chat/ide/IdeStatusBar.vue";
import IdeDebugDock from "../components/chat/ide/IdeDebugDock.vue";
import IdePortsDock from "../components/chat/ide/IdePortsDock.vue";
import {
  IDE_OPEN_SETTINGS_EVENT,
  IDE_SETTINGS_TAB,
  isIdeSettingsTab,
  type IdeOpenSettingsDetail,
} from "../utils/ideSpecialTabs";
import type { AppMenuAction } from "../appMenu";
import { useIdeSideView } from "../composables/useIdeSideView";
import { useOpenFileTabs } from "../composables/useOpenFileTabs";
import { useTerminalTabs } from "../composables/useTerminalTabs";
import { useChatPanelResize } from "../composables/useChatPanelResize";
import { defaultEditorTabForPath } from "../utils/fileTypes";
import { requireWorkingDir } from "../utils/pluginCapability";
import { readLs, writeLs } from "../utils/xuStorage";
import {
  debouncedLint,
  filterDiagnosticsForFile,
  lintFiles,
  mergeDiagnosticsBySource,
  type LintDiagnostic,
} from "../utils/workspaceLint";
import { isTsJsPath, tsGetDiagnostics } from "../utils/tsLanguageService";
import { resolveAbsPath } from "../utils/chatWorkspace";
import { useActiveIdeFileDiff } from "../utils/ideFileDiffs";
import { onOpenInEditor, onWorkingDirChanged, emitWorkingDirChanged } from "../utils/crossWindowBus";
import { isSecondaryIdeWindow, ensureCurrentIdeWindowMaximized } from "../utils/windowManager";
import type { ProjectGitConfig } from "../utils/projects";
import { ideChatPanelVisible } from "../composables/useIdeChatPanel";
import { ideSidebarVisible, toggleIdeSidebar } from "../composables/useIdeSidebarVisible";

const ChatPage = defineAsyncComponent(() => import("./ChatPage.vue"));
const SettingsPage = defineAsyncComponent(() => import("./SettingsPage.vue"));

const route = useRoute();

function readStoredWorkingDir(): string | null {
  try {
    const dir = readLs("xu.chat.workingDir", "hermes_working_dir");
    return dir?.trim() ? dir : null;
  } catch {
    return null;
  }
}

const isolateIdeWorkspace = computed(
  () => isSecondaryIdeWindow() || route.query.fresh === "1",
);
const workingDir = ref<string | null>(
  isolateIdeWorkspace.value ? null : readStoredWorkingDir(),
);
const bottomTab = ref<"terminal" | "problems" | "debug" | "ports">("terminal");
const {
  tabs: terminalTabs,
  activeId: terminalActiveId,
  visible: terminalVisible,
  height: terminalHeight,
  addTab: addTerminalTab,
  closeTab: closeTerminalTab,
  selectTab: selectTerminalTab,
  hide: hideTerminal,
  show: showTerminal,
  setHeight: setTerminalHeight,
  toggle: toggleTerminal,
} = useTerminalTabs();
const terminalReadyIds = ref<Set<string>>(new Set());
const {
  tabs: openFileTabs,
  activePath: previewPath,
  openFile,
  setDirty,
  keepOpen,
  togglePin,
  closeTab,
  closeOthers,
  closeToRight,
  closeSaved,
  closeAll,
} = useOpenFileTabs();
const editorViewTab = ref<"preview" | "edit" | "diff">("edit");
const fileEditorRef = ref<InstanceType<typeof FileEditorPanel> | null>(null);
const editorFileContent = ref("");
const settingsTabGroup = ref<string | undefined>(undefined);
const isSettingsTab = computed(() => isIdeSettingsTab(previewPath.value));
const lintDiagnostics = ref<LintDiagnostic[]>([]);
const problemsCollapsed = ref(false);
const { activeView: ideSideView, setView: setIdeSideView } = useIdeSideView();
const ideSideRef = ref<InstanceType<typeof IdeSidePanel> | null>(null);
const chatPanelRef = ref<{ appendDraft?: (text: string) => void } | null>(null);
const chatRailReady = ref(false);
const activeProjectGit = ref<ProjectGitConfig | null>(null);
const { codeTreeWidth, codeAgentWidth, resizing: codeResizing, startResize: startCodeResize } =
  useChatPanelResize(() => true);

const activeFileDiagnostics = computed(() => {
  if (!previewPath.value) return [];
  return filterDiagnosticsForFile(lintDiagnostics.value, previewPath.value);
});
const activeFileDiff = useActiveIdeFileDiff(previewPath);

const cursorLine = ref(1);
const cursorCol = ref(1);

async function pickWorkingDir() {
  try {
    const dir = await openFileDialog({ directory: true, multiple: false });
    if (typeof dir === "string") workingDir.value = dir;
  } catch {
    /* ignore */
  }
}

async function openTerminal(cwd?: string) {
  const target = cwd?.trim() || workingDir.value?.trim() || "";
  if (!target) {
    await requireWorkingDir(workingDir.value, "终端", pickWorkingDir);
    if (!workingDir.value) return;
  }
  bottomTab.value = "terminal";
  if (cwd?.trim()) {
    addTerminalTab(cwd.trim());
    return;
  }
  toggleTerminal();
}

function openTerminalAt(cwd?: string) {
  void openTerminal(cwd);
}

function onAddToChat(text: string) {
  ideChatPanelVisible.value = true;
  chatPanelRef.value?.appendDraft(text);
}

function onPreviewFile(absPath: string) {
  const abs = resolveAbsPath(workingDir.value, absPath);
  openFile(abs, { preview: false });
  editorViewTab.value = defaultEditorTabForPath(abs);
}

function onOpenFile(absPath: string) {
  onPreviewFile(absPath);
}

function onIdeOpenFileLine(path: string, line: number) {
  onOpenFile(path);
  const diff = activeFileDiff.value;
  if (diff?.length) editorViewTab.value = "diff";
  window.setTimeout(() => fileEditorRef.value?.goToLine(line, 1), 80);
}

watch(activeFileDiff, (d) => {
  if (d?.length && previewPath.value) {
    editorViewTab.value = "diff";
    void fileEditorRef.value?.reload?.();
  }
});

function onProblemSelect(diag: LintDiagnostic) {
  onIdeOpenFileLine(diag.file, diag.line);
  bottomTab.value = "problems";
}

function onCloseTab(p: string) {
  closeTab(p);
}

function onTabPreview(p: string) {
  openFile(p, { preview: true });
}

function onEditorDirtyChange(v: boolean) {
  if (previewPath.value) setDirty(previewPath.value, v);
}

function onEditorContentChange(text: string) {
  editorFileContent.value = text;
  const p = previewPath.value;
  if (p && workingDir.value && isTsJsPath(p)) {
    void debouncedLint(() => runLintForPath(p), 700);
  }
}

function onEditorCursor(line: number, column: number) {
  cursorLine.value = line;
  cursorCol.value = column;
}

async function runLintForPath(p: string) {
  if (!workingDir.value) return;
  const abs = resolveAbsPath(workingDir.value, p);
  const ws = workingDir.value;
  let content = editorFileContent.value;
  if (!content && (isTsJsPath(abs) || isTsJsPath(p))) {
    try {
      content = await invoke<string>("read_text_file", { path: abs });
    } catch {
      content = "";
    }
  }

  const eslintPromise = lintFiles(ws, [abs]).catch(() => [] as LintDiagnostic[]);
  const tsPromise =
    isTsJsPath(abs) || isTsJsPath(p)
      ? tsGetDiagnostics(ws, abs, content).catch(() => [] as LintDiagnostic[])
      : Promise.resolve([] as LintDiagnostic[]);

  const [eslintDiags, tsDiags] = await Promise.all([eslintPromise, tsPromise]);
  let next = mergeDiagnosticsBySource(lintDiagnostics.value, abs, eslintDiags, ["eslint"]);
  next = mergeDiagnosticsBySource(next, abs, tsDiags, ["typescript"]);
  lintDiagnostics.value = next;
}

function onGotoDefinition(file: string, line: number, column: number) {
  openFile(file, { preview: false });
  editorViewTab.value = "edit";
  window.setTimeout(() => fileEditorRef.value?.goToLine(line, column), 80);
}

function onRunNpmScript(cmd: string) {
  void cmd;
  void openTerminal();
}

function openSettingsInTab(group?: string) {
  if (group) settingsTabGroup.value = group;
  openFile(IDE_SETTINGS_TAB, { preview: false });
}

function revealInFileTree() {
  if (isIdeSettingsTab(previewPath.value)) return;
  ideSideRef.value?.revealPath?.(previewPath.value || "");
}

function onTerminalReady(id: string) {
  terminalReadyIds.value = new Set([...terminalReadyIds.value, id]);
}

let unlistenEditor: (() => void) | undefined;
let unlistenDir: (() => void) | undefined;

function onOpenIdeSettings(e: Event) {
  const detail = (e as CustomEvent<IdeOpenSettingsDetail>).detail;
  openSettingsInTab(detail?.group);
}

function joinPath(dir: string, name: string): string {
  const sep = dir.includes("\\") ? "\\" : "/";
  return `${dir.replace(/[/\\]+$/, "")}${sep}${name}`;
}

async function ensureWorkspace(): Promise<string | null> {
  if (!workingDir.value?.trim()) {
    await requireWorkingDir(workingDir.value, "工作区", pickWorkingDir);
  }
  return workingDir.value?.trim() || null;
}

async function ideNewPath(isDir: boolean) {
  const ws = await ensureWorkspace();
  if (!ws) return;
  const label = isDir ? "文件夹" : "文件";
  const name = window.prompt(`新建${label}名称`, isDir ? "新建文件夹" : "untitled.txt");
  if (!name?.trim()) return;
  const target = joinPath(ws, name.trim());
  try {
    await invoke("create_workspace_path", {
      workspace: ws,
      path: target,
      isDir,
    });
    fouMsg.success(`${label}已创建`);
    if (!isDir) {
      openFile(target, { preview: false });
      editorViewTab.value = defaultEditorTabForPath(target);
    }
    setIdeSideView("explorer");
    ideSideRef.value?.revealPath?.(target);
  } catch (e) {
    void onApiCatch(e);
  }
}

async function ideOpenFile() {
  try {
    const file = await openFileDialog({ multiple: false });
    if (typeof file !== "string" || !file) return;
    if (!workingDir.value) {
      const parent = file.replace(/[/\\][^/\\]+$/, "");
      if (parent) workingDir.value = parent;
    }
    openFile(file, { preview: false });
    editorViewTab.value = defaultEditorTabForPath(file);
  } catch (e) {
    void onApiCatch(e);
  }
}

async function ideSaveAs() {
  if (!previewPath.value || isIdeSettingsTab(previewPath.value)) {
    void fouAlert("没有可保存的文件", "提示");
    return;
  }
  const ws = await ensureWorkspace();
  if (!ws) return;
  try {
    const dest = await saveFileDialog({
      defaultPath: previewPath.value,
    });
    if (!dest) return;
    const content = await invoke<string>("read_text_file", { path: previewPath.value });
    await invoke("write_text_file", { workspace: ws, path: dest, content });
    openFile(dest, { preview: false });
    fouMsg.success("已另存为");
  } catch (e) {
    void onApiCatch(e);
  }
}

async function onIdeMenu(e: Event) {
  const action = (e as CustomEvent<AppMenuAction>).detail;
  switch (action) {
    case "ide-new-file":
      await ideNewPath(false);
      break;
    case "ide-new-folder":
      await ideNewPath(true);
      break;
    case "ide-open-file":
      await ideOpenFile();
      break;
    case "ide-open-folder":
      await pickWorkingDir();
      setIdeSideView("explorer");
      break;
    case "ide-save":
      if (isSettingsTab.value) break;
      await fileEditorRef.value?.save?.();
      break;
    case "ide-save-as":
      await ideSaveAs();
      break;
    case "ide-save-all":
      if (!isSettingsTab.value) await fileEditorRef.value?.save?.();
      fouMsg.success("已保存当前文件");
      break;
    case "ide-revert-file":
      if (isSettingsTab.value || !previewPath.value) break;
      fileEditorRef.value?.reload?.();
      fouMsg.success("已从磁盘还原");
      break;
    case "ide-close-editor":
      if (previewPath.value) await onCloseTab(previewPath.value);
      break;
    case "ide-close-others":
      if (previewPath.value) await closeOthers(previewPath.value);
      break;
    case "ide-close-saved":
      await closeSaved();
      break;
    case "ide-close-all":
      await closeAll();
      break;
    case "ide-reveal-explorer":
      revealInFileTree();
      setIdeSideView("explorer");
      break;
    case "ide-reveal-in-os":
      if (previewPath.value && !isIdeSettingsTab(previewPath.value)) {
        try {
          await invoke("open_path", { path: previewPath.value });
        } catch (err) {
          void onApiCatch(err);
        }
      }
      break;
    case "ide-toggle-file-tree":
      toggleIdeSidebar();
      if (ideSidebarVisible.value) setIdeSideView("explorer");
      break;
    case "ide-toggle-terminal":
      bottomTab.value = "terminal";
      toggleTerminal();
      break;
    case "ide-toggle-chat":
      ideChatPanelVisible.value = !ideChatPanelVisible.value;
      break;
    default:
      break;
  }
}

function openFromRouteQuery() {
  const file = typeof route.query.file === "string" ? route.query.file.trim() : "";
  if (!file) return;
  const line = Number(route.query.line);
  onIdeOpenFileLine(file, Number.isFinite(line) && line > 0 ? line : 1);
}

onMounted(() => {
  void ensureCurrentIdeWindowMaximized();
  if (isolateIdeWorkspace.value) {
    workingDir.value = null;
  }
  openFromRouteQuery();
  const kickChat = () => {
    chatRailReady.value = true;
  };
  if (typeof requestIdleCallback === "function") {
    requestIdleCallback(kickChat, { timeout: 400 });
  } else {
    window.setTimeout(kickChat, 80);
  }
  window.addEventListener(IDE_OPEN_SETTINGS_EVENT, onOpenIdeSettings);
  window.addEventListener("xu-ide-menu", onIdeMenu);
  void onOpenInEditor((p) => {
    if (p.path) onIdeOpenFileLine(p.path, p.line || 1);
  }).then((fn) => {
    unlistenEditor = fn;
  });
  if (!isolateIdeWorkspace.value) {
    void onWorkingDirChanged((dir) => {
      if (dir && dir !== workingDir.value) workingDir.value = dir;
    }).then((fn) => {
      unlistenDir = fn;
    });
  }
});

onUnmounted(() => {
  window.removeEventListener(IDE_OPEN_SETTINGS_EVENT, onOpenIdeSettings);
  window.removeEventListener("xu-ide-menu", onIdeMenu);
  unlistenEditor?.();
  unlistenDir?.();
});

watch(
  () => route.query.file,
  () => openFromRouteQuery(),
);

watch(workingDir, (dir) => {
  if (isolateIdeWorkspace.value) return;
  try {
    if (dir) writeLs("xu.chat.workingDir", dir);
    else {
      localStorage.removeItem("xu.chat.workingDir");
      localStorage.removeItem("hermes_working_dir");
    }
  } catch {
    /* ignore */
  }
  emitWorkingDirChanged(dir);
});

watch(previewPath, (p) => {
  editorFileContent.value = "";
  if (p && !isIdeSettingsTab(p)) void debouncedLint(() => runLintForPath(p));
});
</script>

<template>
  <div class="ide-page ui-font">
    <div class="ide-layout-row" :class="{ resizing: codeResizing }">
      <div
        v-show="ideSidebarVisible"
        class="panel-side ide-sidebar"
        :style="{ width: `${codeTreeWidth}px` }"
      >
        <IdeActivityBar
          :active="ideSideView"
          @select="setIdeSideView"
        />
        <IdeSidePanel
          ref="ideSideRef"
          :view="ideSideView"
          :working-dir="workingDir"
          :selected-path="previewPath"
          :file-tree-pinned="true"
          :diagnostics="lintDiagnostics"
          :active-file-path="previewPath"
          :editor-content="editorFileContent"
          :project-git="activeProjectGit"
          :problems-collapsed="problemsCollapsed"
          @request-pick-dir="pickWorkingDir"
          @open-terminal="openTerminalAt"
          @preview-file="onPreviewFile"
          @open-file="onOpenFile"
          @open-file-line="onIdeOpenFileLine"
          @problem-select="onProblemSelect"
          @problems-toggle="problemsCollapsed = !problemsCollapsed"
          @run-npm-script="onRunNpmScript"
          @goto-line="(line) => fileEditorRef?.goToLine(line, 1)"
          @add-to-chat="onAddToChat"
        />
      </div>

      <div
        v-show="ideSidebarVisible"
        class="panel-split split-tree"
        title="拖动调整宽度"
        @pointerdown="startCodeResize('tree', $event)"
      />

      <div class="ide-center">
        <div class="editor-terminal-stack">
          <div class="editor-main-pane">
            <FileEditorTabs
              :tabs="openFileTabs"
              :active-path="previewPath"
              :working-dir="workingDir"
              @select="(p) => (previewPath = p)"
              @close="onCloseTab"
              @close-others="closeOthers"
              @close-right="closeToRight"
              @close-saved="closeSaved"
              @close-all="closeAll"
              @keep-open="keepOpen"
              @pin="togglePin"
              @preview="onTabPreview"
              @reveal-in-tree="revealInFileTree"
            />
            <div v-if="isSettingsTab" class="ide-settings-tab">
              <SettingsPage embedded :group="settingsTabGroup" />
            </div>
            <FileEditorPanel
              v-else
              ref="fileEditorRef"
              variant="editor"
              :path="previewPath"
              :working-dir="workingDir"
              :hide-path-title="openFileTabs.length > 0"
              :diagnostics="activeFileDiagnostics"
              :diff-changes="activeFileDiff"
              v-model:view-tab="editorViewTab"
              @close="previewPath && onCloseTab(previewPath)"
              @dirty-change="onEditorDirtyChange"
              @content-change="onEditorContentChange"
              @cursor="onEditorCursor"
              @saved="previewPath && runLintForPath(previewPath)"
              @lint="previewPath && runLintForPath(previewPath)"
              @goto-definition="onGotoDefinition"
            />
          </div>

          <div class="ide-bottom-tabs">
            <FouButton
              class="ide-bottom-tab"
              :class="{ active: bottomTab === 'terminal' }"
              icon="terminal-box-line"
              size="small"
              text
              native-type="button"
              @click="bottomTab = 'terminal'; showTerminal()"
            >
              终端
            </FouButton>
            <FouButton
              class="ide-bottom-tab"
              :class="{ active: bottomTab === 'problems' }"
              icon="error-warning-line"
              size="small"
              text
              native-type="button"
              @click="bottomTab = 'problems'"
            >
              问题
              <span v-if="lintDiagnostics.length" class="ide-tab-badge">{{ lintDiagnostics.length }}</span>
            </FouButton>
            <FouButton
              class="ide-bottom-tab"
              :class="{ active: bottomTab === 'debug' }"
              icon="bug-line"
              size="small"
              text
              native-type="button"
              @click="bottomTab = 'debug'"
            >
              调试控制台
            </FouButton>
            <FouButton
              class="ide-bottom-tab"
              :class="{ active: bottomTab === 'ports' }"
              icon="plug-line"
              size="small"
              text
              native-type="button"
              @click="bottomTab = 'ports'"
            >
              端口
            </FouButton>
          </div>

          <IdeTerminalDock
            v-show="bottomTab === 'terminal' && terminalVisible"
            :tabs="terminalTabs"
            :active-id="terminalActiveId"
            :working-dir="workingDir"
            :height="terminalHeight"
            @select="selectTerminalTab"
            @close="closeTerminalTab"
            @add="addTerminalTab"
            @collapse="hideTerminal"
            @resize-height="setTerminalHeight"
            @ready="onTerminalReady"
          />
          <div
            v-show="bottomTab === 'problems'"
            class="ide-problems-dock"
            :style="{ height: `${terminalHeight}px` }"
          >
            <ul v-if="lintDiagnostics.length" class="ide-problems-list">
              <li
                v-for="(d, i) in lintDiagnostics"
                :key="i"
                class="ide-problem-item"
                @click="onProblemSelect(d)"
              >
                {{ d.file }}:{{ d.line }} — {{ d.message }}
              </li>
            </ul>
            <p v-else class="muted">暂无问题</p>
          </div>
          <IdeDebugDock v-show="bottomTab === 'debug'" :height="terminalHeight" />
          <IdePortsDock
            v-show="bottomTab === 'ports'"
            :height="terminalHeight"
            :active="bottomTab === 'ports'"
          />
        </div>
      </div>

      <div
        v-show="ideChatPanelVisible"
        class="panel-split split-agent"
        title="拖动调整对话区宽度"
        @pointerdown="startCodeResize('agent', $event)"
      />

      <div
        v-show="ideChatPanelVisible"
        class="ide-chat-panel"
        :style="{ width: `${codeAgentWidth}px` }"
      >
        <ChatPage
          v-if="ideChatPanelVisible && chatRailReady"
          ref="chatPanelRef"
          ide-panel
          managed-by-parent
          :working-dir-override="workingDir"
        />
      </div>
    </div>

    <IdeStatusBar
      :working-dir="workingDir"
      :file-path="previewPath"
      :file-content="editorFileContent"
      :line="cursorLine"
      :column="cursorCol"
      :git-branch="activeProjectGit?.defaultBranch ?? null"
    />
  </div>
</template>

<style scoped>
.ide-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--surface-base, #0f1419);
}
.ide-sidebar {
  flex-shrink: 0;
  display: flex;
  min-height: 0;
  /* border provided by adjacent panel-split — no gap */
}
.panel-split {
  width: 1px;
  flex-shrink: 0;
  position: relative;
  touch-action: none;
  z-index: 2;
  align-self: stretch;
  background: var(--hairline, #2a3441);
}
.panel-split::before {
  content: "";
  position: absolute;
  top: 0;
  bottom: 0;
  left: 50%;
  width: 7px;
  transform: translateX(-50%);
  cursor: col-resize;
}
.panel-split::after {
  content: none;
}
.panel-split:hover,
.ide-layout-row.resizing .panel-split {
  background: var(--primary);
  width: 2px;
}
.ide-layout-row {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: row;
}
.ide-center {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.ide-chat-panel {
  flex-shrink: 0;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  /* border provided by panel-split — no extra blank + double line */
  background: var(--chrome-bar, var(--surface-soft));
}
.ide-chat-panel :deep(.chat-agent-column.is-right) {
  border-left: none;
}
.editor-terminal-stack {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.editor-main-pane {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.ide-settings-tab {
  flex: 1;
  min-height: 0;
  overflow: auto;
  background: var(--surface-base, #0f1419);
}
.ide-bottom-tabs {
  display: flex;
  gap: 2px;
  padding: 4px 8px 0;
  border-top: 1px solid var(--hairline, #2a3441);
  background: var(--chrome-bar, var(--surface-soft));
}
.ide-bottom-tab {
  border: none;
  background: transparent;
  color: var(--text-secondary, #94a3b8);
  font-size: 12px;
  padding: 6px 10px;
  border-radius: 6px 6px 0 0;
  cursor: pointer;
}
.ide-bottom-tab.active {
  background: var(--surface-elevated, #1a222c);
  color: var(--text-primary, #e2e8f0);
}
.ide-tab-badge {
  margin-left: 4px;
  font-size: 10px;
  opacity: 0.8;
}
.ide-problems-dock {
  overflow: auto;
  border-top: 1px solid var(--hairline, #2a3441);
  background: var(--surface-elevated, #1a222c);
  font-size: 12px;
}
.ide-problems-list {
  list-style: none;
  margin: 0;
  padding: 8px;
}
.ide-problem-item {
  padding: 4px 6px;
  cursor: pointer;
  border-radius: 4px;
}
.ide-problem-item:hover {
  background: rgba(255, 255, 255, 0.06);
}
.muted {
  padding: 12px;
  color: var(--text-secondary, #64748b);
}
</style>
