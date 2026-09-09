<script setup lang="ts">
import { onApiCatch } from "../utils/userFacingError";
import { FouButton, fouConfirmPromise, fouMsg, fouAlert} from "foucui";
import { invoke } from "@tauri-apps/api/core";
import { join } from "@tauri-apps/api/path";
import { computed, nextTick, ref, watch } from "vue";
import FileTreeContextMenu, { type FileTreeMenuEntry } from "./FileTreeContextMenu.vue";
import { fileTreeIcon } from "../utils/fileTreeIcons";
import { resolveUniquePasteName } from "../utils/uniquePasteName";

type FileEntry = {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
};

type VisibleRow = {
  kind: "entry";
  entry: FileEntry;
  depth: number;
};

type CreateRow = {
  kind: "create";
  depth: number;
  parentDir: string;
  isDir: boolean;
};

type TreeRow = VisibleRow | CreateRow;

type PendingCreate = {
  parentDir: string;
  isDir: boolean;
  depth: number;
};

type ClipboardState = {
  path: string;
  mode: "copy" | "cut";
} | null;

const props = defineProps<{
  initialPath?: string;
  pinned?: boolean;
  selectedPath?: string | null;
}>();

const emit = defineEmits<{
  close: [];
  "add-to-chat": [text: string];
  "request-pick-dir": [];
  "preview-file": [absPath: string];
  "open-file": [absPath: string];
  "open-terminal": [cwd?: string];
}>();

const expanded = ref(new Set<string>());
const cache = ref(new Map<string, FileEntry[]>());
const loadingPaths = ref(new Set<string>());
const rootLoading = ref(false);
const showHidden = ref(false);
const ctxVisible = ref(false);
const ctxPos = ref({ x: 0, y: 0 });
const ctxEntry = ref<FileTreeMenuEntry | null>(null);
const clipboard = ref<ClipboardState>(null);
const pendingCreate = ref<PendingCreate | null>(null);
const inlineName = ref("");
const createInputRef = ref<HTMLInputElement | null>(null);
const selectedEntryPath = ref<string | null>(null);
const treeWrapRef = ref<HTMLElement | null>(null);

const rootPath = computed(() => props.initialPath?.trim() || "");

const visibleRows = computed((): VisibleRow[] => {
  const rows: VisibleRow[] = [];
  const walk = (dirPath: string, depth: number) => {
    const entries = cache.value.get(dirPath) ?? [];
    for (const entry of entries) {
      rows.push({ kind: "entry", entry, depth });
      if (entry.is_dir && expanded.value.has(entry.path)) {
        walk(entry.path, depth + 1);
      }
    }
  };
  if (rootPath.value) walk(rootPath.value, 0);
  return rows;
});

function normTreePath(p: string): string {
  return p.replace(/\\/g, "/").toLowerCase();
}

function isUnderDir(childPath: string, dirPath: string): boolean {
  const child = childPath.replace(/\\/g, "/");
  const dir = dirPath.replace(/\\/g, "/").replace(/\/$/, "");
  return child === dir || child.startsWith(`${dir}/`);
}

function dirDepth(dirPath: string): number {
  const root = normTreePath(rootPath.value).replace(/\/$/, "");
  const norm = normTreePath(dirPath).replace(/\/$/, "");
  if (!root || norm === root) return 0;
  const rel = norm.slice(root.length).replace(/^\//, "");
  return rel.split("/").filter(Boolean).length;
}

const displayRows = computed((): TreeRow[] => {
  const rows: TreeRow[] = [...visibleRows.value];
  const pending = pendingCreate.value;
  if (!pending) return rows;

  let insertAt = 0;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (row.kind === "entry" && isUnderDir(row.entry.path, pending.parentDir)) {
      insertAt = i + 1;
    }
  }
  rows.splice(insertAt, 0, {
    kind: "create",
    depth: pending.depth,
    parentDir: pending.parentDir,
    isDir: pending.isDir,
  });
  return rows;
});

const ctxTargetDir = computed(() => {
  if (ctxEntry.value) {
    return ctxEntry.value.is_dir ? ctxEntry.value.path : parentDir(ctxEntry.value.path);
  }
  if (selectedEntryPath.value) {
    const norm = normTreePath(selectedEntryPath.value);
    const rows = visibleRows.value;
    const hit = rows.find((r) => normTreePath(r.entry.path) === norm);
    if (hit) {
      return hit.entry.is_dir ? hit.entry.path : parentDir(hit.entry.path);
    }
  }
  return rootPath.value;
});

async function loadDir(path: string) {
  if (loadingPaths.value.has(path)) return;
  loadingPaths.value.add(path);
  if (path === rootPath.value) rootLoading.value = true;
  try {
    const entries = await invoke<FileEntry[]>("list_dir", {
      path,
      includeHidden: showHidden.value,
    });
    cache.value.set(path, entries);
  } catch (e) {
    void onApiCatch(e);
  } finally {
    loadingPaths.value.delete(path);
    if (path === rootPath.value) rootLoading.value = false;
  }
}

async function refreshTree() {
  if (!rootPath.value) return;
  const paths = [rootPath.value, ...expanded.value];
  cache.value = new Map();
  await Promise.all(paths.map((p) => loadDir(p)));
}

async function toggleDir(entry: FileEntry) {
  if (!entry.is_dir) return;
  if (expanded.value.has(entry.path)) {
    expanded.value.delete(entry.path);
    expanded.value = new Set(expanded.value);
    return;
  }
  expanded.value.add(entry.path);
  expanded.value = new Set(expanded.value);
  if (!cache.value.has(entry.path)) await loadDir(entry.path);
}

function parentDir(full: string): string {
  const norm = full.replace(/\\/g, "/");
  const idx = norm.lastIndexOf("/");
  return idx > 0 ? full.slice(0, idx) : full;
}

function relativePath(full: string): string {
  const root = rootPath.value.replace(/\\/g, "/").replace(/\/$/, "");
  const norm = full.replace(/\\/g, "/");
  if (root && (norm === root || norm.startsWith(`${root}/`))) {
    return norm.slice(root.length).replace(/^\//, "") || full;
  }
  return full;
}

function previewFile(entry: FileEntry) {
  emit("preview-file", entry.path);
}

function addEntryToChat(entry: FileEntry) {
  const path = entry.path.trim();
  if (!path) return;
  emit("add-to-chat", path);
  fouMsg.success(`已加入对话：${path}`);
}

function openContextMenu(e: MouseEvent, entry: FileEntry) {
  e.preventDefault();
  selectedEntryPath.value = entry.path;
  ctxEntry.value = entry;
  ctxPos.value = { x: e.clientX, y: e.clientY };
  ctxVisible.value = true;
}

function closeContextMenu() {
  ctxVisible.value = false;
}

function cancelPending() {
  pendingCreate.value = null;
  inlineName.value = "";
}

function validateName(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) {
    void fouAlert("名称不能为空", "提示");
    return null;
  }
  if (/[<>:"|?*\\]/.test(trimmed)) {
    void fouAlert("名称包含非法字符", "提示");
    return null;
  }
  return trimmed;
}

async function startCreate(isDir: boolean) {
  closeContextMenu();
  const dir = ctxTargetDir.value;
  if (!dir || !rootPath.value) return;

  if (dir !== rootPath.value) {
    expanded.value.add(dir);
    expanded.value = new Set(expanded.value);
    if (!cache.value.has(dir)) await loadDir(dir);
  }

  const depth = dir === rootPath.value ? 0 : dirDepth(dir);
  pendingCreate.value = { parentDir: dir, isDir, depth };
  inlineName.value = isDir ? "新建文件夹" : "";

  await nextTick();
  createInputRef.value?.focus();
  createInputRef.value?.select();
}

async function commitCreate() {
  const pending = pendingCreate.value;
  if (!pending || !rootPath.value) return;
  const name = validateName(inlineName.value);
  if (!name) return;

  const target = await join(pending.parentDir, name);
  const siblings = cache.value.get(pending.parentDir) ?? [];
  if (siblings.some((e) => e.name.toLowerCase() === name.toLowerCase())) {
    void fouAlert("同名项已存在", "提示");
    createInputRef.value?.focus();
    createInputRef.value?.select();
    return;
  }

  try {
    await invoke("create_workspace_path", {
      workspace: rootPath.value,
      path: target,
      isDir: pending.isDir,
    });
    cancelPending();
    await loadDir(pending.parentDir);
    if (pending.parentDir !== rootPath.value) await loadDir(rootPath.value);
    if (pending.isDir) {
      expanded.value.add(target);
      expanded.value = new Set(expanded.value);
      await loadDir(target);
    } else {
      emit("open-file", target);
    }
    fouMsg.success(pending.isDir ? "文件夹已创建" : "文件已创建");
  } catch (e) {
    void onApiCatch(e);
    await nextTick();
    createInputRef.value?.focus();
  }
}

function onCreateKeydown(e: KeyboardEvent) {
  if (e.key === "Enter") {
    e.preventDefault();
    void commitCreate();
  } else if (e.key === "Escape") {
    e.preventDefault();
    cancelPending();
  }
}

function onCreateBlur() {
  if (!pendingCreate.value) return;
  if (inlineName.value.trim()) void commitCreate();
  else cancelPending();
}

async function createNew(isDir: boolean) {
  await startCreate(isDir);
}

async function createNewFromHeader(isDir: boolean) {
  ctxEntry.value = null;
  await startCreate(isDir);
}

async function revealInExplorer() {
  const entry = ctxEntry.value;
  closeContextMenu();
  if (!entry) return;
  try {
    await invoke("open_path", { path: entry.path });
  } catch (e) {
    void onApiCatch(e);
  }
}

function openTerminalHere() {
  const entry = ctxEntry.value;
  closeContextMenu();
  const cwd = entry
    ? entry.is_dir
      ? entry.path
      : parentDir(entry.path)
    : rootPath.value;
  if (cwd) emit("open-terminal", cwd);
}

function collapseAllFolders() {
  expanded.value = new Set();
}

function cutEntry() {
  const entry = ctxEntry.value;
  closeContextMenu();
  if (!entry) return;
  clipboard.value = { path: entry.path, mode: "cut" };
  fouMsg.success("已剪切到剪贴板");
}

function copyEntry() {
  const entry = ctxEntry.value;
  closeContextMenu();
  if (!entry) return;
  clipboard.value = { path: entry.path, mode: "copy" };
  fouMsg.success("已复制到剪贴板");
}

async function pasteEntry() {
  closeContextMenu();
  const clip = clipboard.value;
  const dir = ctxTargetDir.value;
  if (!clip || !dir || !rootPath.value) return;

  if (clip.mode === "cut" && isUnderDir(dir, clip.path)) {
    void fouAlert("不能将文件夹粘贴到自身或其子目录内", "提示");
    return;
  }

  if (!cache.value.has(dir)) await loadDir(dir);
  const baseName = clip.path.replace(/^.*[/\\]/, "");
  const siblings = (cache.value.get(dir) ?? []).map((e) => e.name);
  const uniqueName = resolveUniquePasteName(baseName, siblings);
  const dest = await join(dir, uniqueName);

  try {
    if (clip.mode === "copy") {
      await invoke("copy_path", {
        workspace: rootPath.value,
        from: clip.path,
        to: dest,
      });
    } else {
      await invoke("rename_path", {
        workspace: rootPath.value,
        from: clip.path,
        to: dest,
      });
      clipboard.value = null;
    }
    fouMsg.success("粘贴完成");
    await loadDir(dir);
    if (dir !== rootPath.value) await loadDir(rootPath.value);
  } catch (e) {
    void onApiCatch(e);
  }
}

function cutSelectedEntry() {
  const path = selectedEntryPath.value ?? ctxEntry.value?.path;
  if (!path) return;
  clipboard.value = { path, mode: "cut" };
  fouMsg.success("已剪切到剪贴板");
}

function copySelectedEntry() {
  const path = selectedEntryPath.value ?? ctxEntry.value?.path;
  if (!path) return;
  clipboard.value = { path, mode: "copy" };
  fouMsg.success("已复制到剪贴板");
}

function onTreeKeydown(e: KeyboardEvent) {
  if (pendingCreate.value) return;
  const mod = e.ctrlKey || e.metaKey;
  if (!mod) return;
  const key = e.key.toLowerCase();
  if (key === "c") {
    e.preventDefault();
    copySelectedEntry();
  } else if (key === "x") {
    e.preventDefault();
    cutSelectedEntry();
  } else if (key === "v") {
    e.preventDefault();
    void pasteEntry();
  }
}

async function copyPath(abs = true) {
  const entry = ctxEntry.value;
  closeContextMenu();
  if (!entry) return;
  const text = abs ? entry.path : relativePath(entry.path);
  try {
    await navigator.clipboard.writeText(text);
    fouMsg.success(abs ? "已复制绝对路径" : "已复制相对路径");
  } catch (e) {
    void onApiCatch(e);
  }
}

async function renameEntry() {
  const entry = ctxEntry.value;
  closeContextMenu();
  if (!entry || !rootPath.value) return;
  const name = window.prompt("重命名为", entry.name);
  if (name === null) return;
  const trimmed = validateName(name);
  if (!trimmed || trimmed === entry.name) return;
  const dest = await join(parentDir(entry.path), trimmed);
  try {
    await invoke("rename_path", {
      workspace: rootPath.value,
      from: entry.path,
      to: dest,
    });
    fouMsg.success("重命名成功");
    await refreshTree();
  } catch (e) {
    void onApiCatch(e);
  }
}

async function deleteEntry() {
  const entry = ctxEntry.value;
  closeContextMenu();
  if (!entry || !rootPath.value) return;
  const action = await fouConfirmPromise(
    `确定删除「${entry.name}」？${entry.is_dir ? "（将递归删除目录内容）" : ""}`,
    "删除",
    { confirmButtonText: "删除", cancelButtonText: "取消" },
  );
  if (action !== "confirm") return;
  try {
    await invoke("remove_path", { workspace: rootPath.value, path: entry.path });
    fouMsg.success("已删除");
    expanded.value.delete(entry.path);
    expanded.value = new Set(expanded.value);
    await refreshTree();
  } catch (e) {
    void onApiCatch(e);
  }
}

function isPreviewSelected(entry: FileEntry): boolean {
  const sel = props.selectedPath?.trim();
  if (!sel) return false;
  return normTreePath(entry.path) === normTreePath(sel);
}

function isRowSelected(entry: FileEntry): boolean {
  if (isPreviewSelected(entry)) return true;
  const sel = selectedEntryPath.value?.trim();
  if (!sel) return false;
  return normTreePath(entry.path) === normTreePath(sel);
}

function rowIcon(entry: FileEntry): string {
  return fileTreeIcon(entry.name, entry.is_dir, expanded.value.has(entry.path));
}

function onRowClick(entry: FileEntry) {
  selectedEntryPath.value = entry.path;
  if (entry.is_dir) {
    void toggleDir(entry);
  } else {
    previewFile(entry);
  }
}

function onRowDblClick(entry: FileEntry) {
  if (entry.is_dir) void toggleDir(entry);
  else emit("open-file", entry.path);
}

async function revealPath(targetPath: string) {
  const trimmed = targetPath.trim();
  if (!trimmed || !rootPath.value) return;

  let current = parentDir(trimmed);
  const chain: string[] = [];
  const rootNorm = normTreePath(rootPath.value);
  while (current && normTreePath(current).length >= rootNorm.length) {
    chain.unshift(current);
    if (normTreePath(current) === rootNorm) break;
    current = parentDir(current);
  }

  for (const dir of chain) {
    expanded.value.add(dir);
    if (!cache.value.has(dir)) await loadDir(dir);
  }
  expanded.value = new Set(expanded.value);

  await nextTick();
  const targetNorm = normTreePath(trimmed);
  const rows = document.querySelectorAll<HTMLElement>(".tree-row[data-tree-path]");
  for (const row of rows) {
    if (normTreePath(row.dataset.treePath ?? "") === targetNorm) {
      row.scrollIntoView({ block: "nearest", behavior: "smooth" });
      break;
    }
  }
}

defineExpose({ revealPath });

function openBlankContextMenu(e: MouseEvent) {
  if ((e.target as HTMLElement).closest(".tree-row")) return;
  e.preventDefault();
  ctxEntry.value = null;
  ctxPos.value = { x: e.clientX, y: e.clientY };
  ctxVisible.value = true;
}

watch(showHidden, () => {
  void refreshTree();
});

watch(
  rootPath,
  (path) => {
    expanded.value = new Set();
    cache.value = new Map();
    clipboard.value = null;
    cancelPending();
    selectedEntryPath.value = null;
    if (path) void loadDir(path);
  },
  { immediate: true },
);
</script>

<template>
  <aside class="side-panel ui-font">
    <header>
      <strong>文件树</strong>
      <div class="head-actions">
        <FouButton
          v-if="rootPath"
          icon="file-add-line"
          size="small"
          text
          native-type="button"
          title="新建文件"
          aria-label="新建文件"
          @click="void createNewFromHeader(false)"
        />
        <FouButton
          v-if="rootPath"
          icon="folder-add-line"
          size="small"
          text
          native-type="button"
          title="新建文件夹"
          aria-label="新建文件夹"
          @click="void createNewFromHeader(true)"
        />
        <FouButton
          v-if="rootPath"
          :icon="showHidden ? 'eye-line' : 'eye-off-line'"
          size="small"
          text
          native-type="button"
          :title="showHidden ? '隐藏点文件' : '显示隐藏文件'"
          :aria-label="showHidden ? '隐藏点文件' : '显示隐藏文件'"
          @click="showHidden = !showHidden"
        />
        <FouButton
          v-if="rootPath"
          icon="fold-line"
          size="small"
          text
          native-type="button"
          title="全部折叠"
          aria-label="全部折叠"
          @click="collapseAllFolders"
        />
        <FouButton
          v-if="rootPath"
          icon="refresh-line"
          size="small"
          text
          native-type="button"
          title="刷新"
          :loading="rootLoading"
          aria-label="刷新"
          @click="refreshTree"
        />
        <FouButton
          v-if="!pinned"
          icon="close-line"
          text
          native-type="button"
          aria-label="关闭"
          @click="emit('close')"
        />
      </div>
    </header>

    <div v-if="!rootPath" class="empty">
      <p>尚未选择工作目录，无法浏览项目文件。</p>
      <FouButton icon="folder-open-line" type="primary" native-type="button" @click="emit('request-pick-dir')">
        选择工作目录
      </FouButton>
    </div>

    <div
      v-else
      ref="treeWrapRef"
      class="tree-wrap"
      data-xu-context
      tabindex="0"
      @contextmenu.prevent="openBlankContextMenu"
      @keydown="onTreeKeydown"
      @click="treeWrapRef?.focus()"
    >
      <p class="root-hint" :title="rootPath">{{ rootPath }}</p>
      <p v-if="rootLoading && !displayRows.length" class="loading-hint">加载中…</p>
      <ul v-else-if="displayRows.length" class="tree">
        <template v-for="(row, idx) in displayRows" :key="row.kind === 'entry' ? row.entry.path : `create-${idx}`">
          <li
            v-if="row.kind === 'entry'"
            class="tree-row"
            :class="{ selected: isRowSelected(row.entry) }"
            :data-tree-path="row.entry.path"
            @click="onRowClick(row.entry)"
            @dblclick="onRowDblClick(row.entry)"
            @contextmenu.stop.prevent="openContextMenu($event, row.entry)"
          >
            <div class="row-inner" :style="{ paddingLeft: `${4 + row.depth * 12}px` }">
              <span
                v-if="row.entry.is_dir"
                class="chevron"
                :class="{ expanded: expanded.has(row.entry.path) }"
                @click.stop="toggleDir(row.entry)"
              >
                ▸
              </span>
              <span v-else class="chevron placeholder" />
              <FouIcon :icon="rowIcon(row.entry)" size="14" class="entry-icon" />
              <span class="entry-name" :title="row.entry.path">{{ row.entry.name }}</span>
              <span class="row-actions">
                <FouButton
                  v-if="!row.entry.is_dir"
                  class="icon-action"
                  icon="eye-line"
                  size="small"
                  text
                  native-type="button"
                  title="预览"
                  aria-label="预览"
                  @click.stop="previewFile(row.entry)"
                />
                <FouButton
                  class="icon-action"
                  icon="chat-3-line"
                  size="small"
                  text
                  native-type="button"
                  title="加入对话"
                  aria-label="加入对话"
                  @click.stop="addEntryToChat(row.entry)"
                />
              </span>
            </div>
          </li>
          <li v-else class="tree-row create-row">
            <div class="row-inner" :style="{ paddingLeft: `${4 + row.depth * 12}px` }">
              <span class="chevron placeholder" />
              <FouIcon
                :icon="row.isDir ? 'folder-add-line' : 'file-add-line'"
                size="14"
                class="entry-icon"
              />
              <input
                ref="createInputRef"
                v-model="inlineName"
                class="create-input"
                :placeholder="row.isDir ? '文件夹名称' : '文件名'"
                spellcheck="false"
                @keydown="onCreateKeydown"
                @blur="onCreateBlur"
                @click.stop
              />
            </div>
          </li>
        </template>
      </ul>
      <p v-else-if="!rootLoading" class="empty-hint">此目录为空；右键可新建文件或文件夹</p>
    </div>

    <FileTreeContextMenu
      :visible="ctxVisible"
      :x="ctxPos.x"
      :y="ctxPos.y"
      :entry="ctxEntry"
      :can-paste="Boolean(clipboard && ctxTargetDir)"
      @close="closeContextMenu"
      @new-file="createNew(false)"
      @new-folder="createNew(true)"
      @reveal="revealInExplorer"
      @terminal="openTerminalHere"
      @cut="cutEntry"
      @copy="copyEntry"
      @paste="pasteEntry"
      @copy-path="copyPath(true)"
      @copy-rel-path="copyPath(false)"
      @rename="renameEntry"
      @delete="deleteEntry"
    />
  </aside>
</template>

<style scoped>
.side-panel {
  height: 100%;
  display: flex;
  flex-direction: column;
  border-left: 1px solid var(--hairline);
  background: var(--surface-card);
  min-width: 280px;
  max-width: 400px;
}
header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border-bottom: 1px solid var(--hairline);
}
header strong {
  color: var(--ink);
  font-size: 14px;
}
.head-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}
.empty {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  font-size: 13px;
  color: var(--muted, #64748b);
}
.tree-wrap {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.root-hint {
  margin: 0;
  padding: 8px 12px;
  font-size: 11px;
  color: var(--muted, #64748b);
  border-bottom: 1px solid var(--hairline);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tree {
  list-style: none;
  margin: 0;
  padding: 4px 0;
  overflow: auto;
  flex: 1;
}
.tree {
  list-style: none;
  margin: 0;
  padding: 4px 0;
}
.tree-row {
  margin: 0;
  cursor: pointer;
  font-size: var(--file-tree-font-size, 12px);
}
.tree-row:hover {
  background: var(--surface-soft, #f8fafc);
}
.tree-row.selected {
  background: var(--primary-glow);
}
.tree-row.create-row {
  background: var(--primary-glow);
}
.create-input {
  flex: 1;
  min-width: 0;
  border: 1px solid var(--primary);
  border-radius: 4px;
  padding: 1px 6px;
  font-size: inherit;
  font-family: inherit;
  line-height: 22px;
  background: var(--canvas);
  color: var(--body);
  outline: none;
}
.tree-row.selected .entry-name {
  color: var(--primary);
  font-weight: 500;
}
.row-inner {
  display: flex;
  align-items: center;
  gap: 4px;
  min-height: 24px;
  padding-right: 6px;
}
.chevron {
  width: 14px;
  flex-shrink: 0;
  font-size: 10px;
  color: var(--muted);
  text-align: center;
  cursor: pointer;
  user-select: none;
  transition: transform 0.12s ease;
}
.chevron.expanded {
  transform: rotate(90deg);
}
.chevron.placeholder {
  visibility: hidden;
  cursor: default;
}
.entry-icon {
  flex-shrink: 0;
  color: var(--muted);
}
.tree-row.selected .entry-icon {
  color: var(--primary);
}
.entry-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  line-height: 24px;
  color: var(--body);
}
.row-actions {
  display: none;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}
.tree-row:hover .row-actions {
  display: flex;
}
.icon-action {
  border: none;
  background: transparent;
  padding: 2px;
  border-radius: 4px;
  cursor: pointer;
  color: var(--muted);
  display: inline-flex;
}
.icon-action:hover {
  background: var(--canvas);
  color: var(--primary);
}
.loading-hint {
  margin: 12px;
  font-size: 12px;
  color: var(--muted, #64748b);
}
</style>
