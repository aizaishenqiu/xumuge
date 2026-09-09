<script setup lang="ts">
/**
 * @file CanvasPage.vue 独立 Canvas 画板页
 * @author qiuye <yjk150@qq.com>
 * @date 2026-09-06
 * @version 1.2.0
 * @category Layout
 * @algo canvas-workspace-pick
 */
import { onMounted, onUnmounted, ref } from "vue";
import { useRouter } from "vue-router";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { FouButton } from "foucui";
import CanvasStudioPanel from "../components/canvas/CanvasStudioPanel.vue";
import ChatPage from "./ChatPage.vue";
import { useChatPanelResize } from "../composables/useChatPanelResize";
import { readLs, writeLs } from "../utils/xuStorage";
import { emitWorkingDirChanged, onWorkingDirChanged } from "../utils/crossWindowBus";
import { focusIdeWindow } from "../utils/windowManager";
import { ensureDefaultCanvasWorkspace } from "../utils/canvasDefaultWorkspace";

const router = useRouter();

function readStoredWorkingDir(): string | null {
  try {
    const dir = readLs("xu.chat.workingDir", "hermes_working_dir");
    return dir?.trim() ? dir : null;
  } catch {
    return null;
  }
}

const workingDir = ref<string | null>(readStoredWorkingDir());
const { codeAgentWidth, resizing, startResize } = useChatPanelResize(() => true);
const chatVisible = ref(true);
let unlistenDir: (() => void) | undefined;

onMounted(async () => {
  unlistenDir = await onWorkingDirChanged((dir) => {
    workingDir.value = dir;
  });
  if (!workingDir.value?.trim()) {
    const ws = await ensureDefaultCanvasWorkspace();
    if (ws) workingDir.value = ws;
  }
});
onUnmounted(() => {
  unlistenDir?.();
});

/** Duty: 选目录作为画板工作区并同步聊天 cwd。 */
async function pickWorkspace() {
  try {
    const dir = await openFileDialog({ directory: true, multiple: false });
    if (typeof dir !== "string" || !dir.trim()) return;
    const next = dir.trim();
    workingDir.value = next;
    writeLs("xu.chat.workingDir", next, "hermes_working_dir");
    emitWorkingDirChanged(next);
  } catch {
    /* ignore */
  }
}

function openIde() {
  void focusIdeWindow();
  if (router.currentRoute.value.path !== "/ide") {
    void router.push("/ide");
  }
}
</script>

<template>
  <div class="canvas-page ui-font" :class="{ resizing }">
    <div class="canvas-page-row">
      <div class="canvas-page-main">
        <CanvasStudioPanel :workspace="workingDir" @pick-workspace="pickWorkspace">
          <template #actions>
            <FouButton
              icon="folder-open-line"
              size="small"
              text
              native-type="button"
              title="更换画板工作区"
              @click="pickWorkspace"
            >
              更换工作区
            </FouButton>
            <FouButton
              icon="layout-right-2-line"
              size="small"
              text
              native-type="button"
              :aria-label="chatVisible ? '隐藏对话' : '显示对话'"
              @click="chatVisible = !chatVisible"
            >
              {{ chatVisible ? "隐藏对话" : "显示对话" }}
            </FouButton>
            <FouButton icon="code-box-line" size="small" native-type="button" @click="openIde">
              打开 IDE
            </FouButton>
          </template>
        </CanvasStudioPanel>
      </div>
      <div
        v-show="chatVisible"
        class="panel-split"
        title="拖动调整对话区宽度"
        @pointerdown="startResize('agent', $event)"
      />
      <div v-show="chatVisible" class="canvas-page-chat" :style="{ width: `${codeAgentWidth}px` }">
        <ChatPage ide-panel managed-by-parent canvas-side-chat :working-dir-override="workingDir" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.canvas-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--surface-base, #0f1419);
}
.canvas-page-row {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: row;
}
.canvas-page-main {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.canvas-page-chat {
  flex-shrink: 0;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--chrome-bar, var(--surface-soft));
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
.canvas-page.resizing .panel-split,
.panel-split:hover {
  background: var(--primary);
  width: 2px;
}
</style>
