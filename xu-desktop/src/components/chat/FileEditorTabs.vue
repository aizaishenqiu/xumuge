<script setup lang="ts">
import { onApiCatch } from "../../utils/userFacingError";
import { FouButton, fouMsg, fouAlert} from "foucui";
import { invoke } from "@tauri-apps/api/core";
import { computed, ref } from "vue";
import type { OpenFileTab } from "../../composables/useOpenFileTabs";
import { fileTreeIcon } from "../../utils/fileTreeIcons";
import { toRelativePath } from "../../utils/chatWorkspace";
import { isIdeSettingsTab } from "../../utils/ideSpecialTabs";
import FileTabContextMenu from "./FileTabContextMenu.vue";

const props = defineProps<{
  tabs: OpenFileTab[];
  activePath: string | null;
  workingDir: string | null;
}>();

const emit = defineEmits<{
  select: [path: string];
  close: [path: string];
  "close-others": [path: string];
  "close-right": [path: string];
  "close-saved": [];
  "close-all": [];
  "keep-open": [path: string];
  pin: [path: string];
  preview: [path: string];
  "reveal-in-tree": [path: string];
}>();

const ctxVisible = ref(false);
const ctxPos = ref({ x: 0, y: 0 });
const ctxTab = ref<OpenFileTab | null>(null);

const activeNorm = computed(() => props.activePath?.replace(/\\/g, "/").toLowerCase() ?? "");

function isActive(path: string): boolean {
  return path.replace(/\\/g, "/").toLowerCase() === activeNorm.value;
}

function tabLabel(path: string): string {
  if (isIdeSettingsTab(path)) return "设置";
  return path.replace(/^.*[/\\]/, "") || path;
}

function tabIcon(path: string): string {
  if (isIdeSettingsTab(path)) return "settings-3-line";
  return fileTreeIcon(tabLabel(path), false, false);
}

function openContextMenu(e: MouseEvent, tab: OpenFileTab) {
  e.preventDefault();
  ctxTab.value = tab;
  ctxPos.value = { x: e.clientX, y: e.clientY };
  ctxVisible.value = true;
}

function closeContextMenu() {
  ctxVisible.value = false;
}

function onCtx(action: () => void) {
  closeContextMenu();
  action();
}

async function copyPath(abs: boolean) {
  const tab = ctxTab.value;
  if (!tab) return;
  const text = abs
    ? tab.path
    : props.workingDir
      ? toRelativePath(props.workingDir, tab.path)
      : tab.path;
  try {
    await navigator.clipboard.writeText(text);
    fouMsg.success(abs ? "已复制绝对路径" : "已复制相对路径");
  } catch (e) {
    void onApiCatch(e);
  }
}

async function revealInExplorer() {
  const tab = ctxTab.value;
  if (!tab) return;
  try {
    await invoke("open_path", { path: tab.path });
  } catch (e) {
    void onApiCatch(e);
  }
}

async function findReferences() {
  const tab = ctxTab.value;
  if (!tab || !props.workingDir?.trim()) {
    void fouAlert("请先选择工作目录", "提示");
    return;
  }
  const name = tabLabel(tab.path);
  const base = name.includes(".") ? name.slice(0, name.lastIndexOf(".")) : name;
  const patterns = [name, base].filter(Boolean);
  try {
    const results: string[] = [];
    for (const pattern of patterns) {
      const out = await invoke<string>("grep_workspace", {
        workspace: props.workingDir,
        pattern,
        maxHits: 30,
      });
      if (out && !out.startsWith("无命中")) results.push(out);
    }
    const merged = results.join("\n").trim();
    if (!merged || merged.startsWith("无命中")) {
      fouMsg.info(`未找到对「${name}」的引用`);
      return;
    }
    const lines = merged.split("\n").slice(0, 12);
    fouMsg.success(`找到 ${lines.length}+ 处引用（详见通知）`);
    window.alert(`「${name}」引用（前 ${lines.length} 条）：\n\n${lines.join("\n")}`);
  } catch (e) {
    void onApiCatch(e);
  }
}
</script>

<template>
  <div v-if="tabs.length" class="file-editor-tabs ui-font" data-xu-context>
    <div class="tabs-scroll">
      <div
        v-for="tab in tabs"
        :key="tab.path"
        role="tab"
        tabindex="0"
        class="file-tab"
        :class="{
          active: isActive(tab.path),
          preview: tab.preview,
          pinned: tab.pinned,
          dirty: tab.dirty,
        }"
        :title="tab.path"
        @click="emit('select', tab.path)"
        @keydown.enter="emit('select', tab.path)"
        @contextmenu.prevent="openContextMenu($event, tab)"
      >
        <FouIcon v-if="tab.pinned" icon="pushpin-2-fill" size="12" class="tab-pin" />
        <FouIcon :icon="tabIcon(tab.path)" size="14" class="tab-icon" />
        <span class="tab-name">{{ tabLabel(tab.path) }}</span>
        <span v-if="tab.dirty" class="tab-dot" aria-hidden="true" />
        <FouButton
          icon="close-line"
          size="small"
          text
          native-type="button"
          class="tab-close"
          aria-label="关闭标签页"
          @click.stop="emit('close', tab.path)"
        />
      </div>
    </div>

    <FileTabContextMenu
      :visible="ctxVisible"
      :x="ctxPos.x"
      :y="ctxPos.y"
      :tab="ctxTab"
      @close="closeContextMenu"
      @close-tab="onCtx(() => ctxTab && emit('close', ctxTab.path))"
      @close-others="onCtx(() => ctxTab && emit('close-others', ctxTab.path))"
      @close-right="onCtx(() => ctxTab && emit('close-right', ctxTab.path))"
      @close-saved="onCtx(() => emit('close-saved'))"
      @close-all="onCtx(() => emit('close-all'))"
      @copy-path="onCtx(() => void copyPath(true))"
      @copy-rel-path="onCtx(() => void copyPath(false))"
      @preview="onCtx(() => ctxTab && emit('preview', ctxTab.path))"
      @reveal="onCtx(() => void revealInExplorer())"
      @reveal-in-tree="onCtx(() => ctxTab && emit('reveal-in-tree', ctxTab.path))"
      @keep-open="onCtx(() => ctxTab && emit('keep-open', ctxTab.path))"
      @pin="onCtx(() => ctxTab && emit('pin', ctxTab.path))"
      @find-refs="onCtx(() => void findReferences())"
    />
  </div>
</template>

<style scoped>
.file-editor-tabs {
  flex-shrink: 0;
  border-bottom: 1px solid var(--hairline);
  background: var(--surface-soft);
  min-height: 34px;
}
.tabs-scroll {
  display: flex;
  align-items: stretch;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: thin;
}
.file-tab {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 180px;
  padding: 0 8px 0 10px;
  height: 34px;
  border: none;
  border-right: 1px solid var(--hairline);
  background: transparent;
  color: var(--muted);
  font-size: 12px;
  cursor: pointer;
  flex-shrink: 0;
}
.file-tab:hover {
  background: color-mix(in srgb, var(--primary) 6%, transparent);
  color: var(--body);
}
.file-tab.active {
  background: var(--surface-card);
  color: var(--body);
  border-bottom: 2px solid var(--primary);
  margin-bottom: -1px;
}
.file-tab.preview .tab-name {
  font-style: italic;
}
.tab-pin {
  opacity: 0.7;
  flex-shrink: 0;
}
.tab-icon {
  flex-shrink: 0;
  opacity: 0.85;
}
.tab-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}
.tab-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--primary);
  flex-shrink: 0;
}
.tab-close {
  opacity: 0;
  margin-left: 2px;
  flex-shrink: 0;
}
.file-tab:hover .tab-close,
.file-tab.active .tab-close {
  opacity: 1;
}
</style>
