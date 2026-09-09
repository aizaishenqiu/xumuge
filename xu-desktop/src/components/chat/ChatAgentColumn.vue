<script setup lang="ts">
import { computed, onUnmounted, ref } from "vue";
import { FouButton } from "foucui";
import ChatSidebar from "./ChatSidebar.vue";
import ChatMessageList from "./ChatMessageList.vue";
import ChatSessionToolbar from "./ChatSessionToolbar.vue";
import type { Message, Session } from "../../types";
import { readLs, writeLs } from "../../utils/xuStorage";

const IDE_COMPOSER_RATIO_KEY = "xu.ide.chatComposerRatio";
const SPLIT_H = 9;
const RATIO_MIN = 0.22;
const RATIO_MAX = 0.78;

const props = defineProps<{
  sessions: Session[];
  activeId: string | null;
  badges: Record<string, "running" | "queued" | "done">;
  queueCounts: Record<string, number>;
  messages: Message[];
  streaming: boolean;
  showTools: boolean;
  showThink: boolean;
  repliesCollapsed: boolean;
  workingDir: string | null;
  assistantName: string;
  sessionError?: string | null;
  alignRight?: boolean;
  billingPresetId?: string;
  billingModelLabel?: string;
  sessionsVisible?: boolean;
  /** Code / IDE / Canvas：聊天列顶栏显示「打开 IDE」 */
  showOpenIde?: boolean;
}>();

const emit = defineEmits<{
  select: [id: string];
  new: [];
  delete: [id: string];
  refresh: [];
  stopSession: [id: string];
  stop: [];
  edit: [id: string];
  deleteMessage: [id: string];
  copy: [id: string];
  copySession: [];
  toggleThink: [];
  toggleTools: [];
  toggleReplies: [];
  openIde: [];
  useExample: [text: string];
  "update:sessionsVisible": [boolean];
}>();

const columnRef = ref<HTMLElement | null>(null);
const resizingComposer = ref(false);
const composerRatio = ref(loadComposerRatio());

function loadComposerRatio(): number {
  try {
    const n = Number(readLs(IDE_COMPOSER_RATIO_KEY, ""));
    if (Number.isFinite(n) && n >= RATIO_MIN && n <= RATIO_MAX) return n;
  } catch {
    /* ignore */
  }
  return 0.5;
}

function persistComposerRatio() {
  writeLs(IDE_COMPOSER_RATIO_KEY, String(composerRatio.value));
}

const gridRows = computed(() => {
  if (!props.alignRight) return undefined;
  const msg = Math.max(RATIO_MIN, 1 - composerRatio.value);
  const comp = Math.max(RATIO_MIN, composerRatio.value);
  // 侧栏常驻（仅折叠列表），始终占一行
  return `auto minmax(120px, ${msg}fr) ${SPLIT_H}px minmax(140px, ${comp}fr)`;
});

function clampRatio(r: number): number {
  return Math.min(RATIO_MAX, Math.max(RATIO_MIN, r));
}

let resizeStartY = 0;

function onComposerResizeMove(e: PointerEvent) {
  if (!resizingComposer.value || !columnRef.value) return;
  const rect = columnRef.value.getBoundingClientRect();
  const sessionsEl = columnRef.value.querySelector(".agent-sessions");
  const sessionsH = sessionsEl?.getBoundingClientRect().height ?? 0;
  const avail = rect.height - sessionsH - SPLIT_H;
  if (avail <= 0) return;
  const pointerY = e.clientY - rect.top - sessionsH;
  const nextComp = clampRatio(1 - pointerY / avail);
  composerRatio.value = nextComp;
}

function onComposerResizeUp() {
  if (!resizingComposer.value) return;
  resizingComposer.value = false;
  persistComposerRatio();
  window.removeEventListener("pointermove", onComposerResizeMove);
  window.removeEventListener("pointerup", onComposerResizeUp);
  document.body.style.cursor = "";
  document.body.style.userSelect = "";
}

function startComposerResize(e: PointerEvent) {
  if (!props.alignRight) return;
  e.preventDefault();
  resizingComposer.value = true;
  resizeStartY = e.clientY;
  document.body.style.cursor = "row-resize";
  document.body.style.userSelect = "none";
  window.addEventListener("pointermove", onComposerResizeMove);
  window.addEventListener("pointerup", onComposerResizeUp);
}

onUnmounted(() => {
  window.removeEventListener("pointermove", onComposerResizeMove);
  window.removeEventListener("pointerup", onComposerResizeUp);
});

function onSessionsListVisible(v: boolean) {
  emit("update:sessionsVisible", v);
}
</script>

<template>
  <aside
    ref="columnRef"
    class="chat-agent-column ui-font"
    :class="{
      'is-right': alignRight,
      'sessions-hidden': sessionsVisible === false,
      'resizing-composer': resizingComposer,
    }"
    :style="alignRight ? { gridTemplateRows: gridRows } : undefined"
  >
    <div class="agent-sessions">
      <ChatSidebar
        :sessions="sessions"
        :active-id="activeId"
        :badges="badges"
        :queue-counts="queueCounts"
        :billing-preset-id="billingPresetId"
        :billing-model-label="billingModelLabel"
        :sessions-list-visible="sessionsVisible"
        @select="emit('select', $event)"
        @new="emit('new')"
        @delete="emit('delete', $event)"
        @refresh="emit('refresh')"
        @stop-session="emit('stopSession', $event)"
        @update:sessions-list-visible="onSessionsListVisible"
      />
    </div>

    <div class="agent-messages" :class="{ 'with-split': alignRight }">
      <div v-if="!alignRight || showOpenIde" class="agent-msg-toolbar">
        <FouButton
          v-if="showOpenIde"
          icon="code-box-line"
          size="small"
          text
          native-type="button"
          title="打开 IDE"
          aria-label="打开 IDE"
          @click="emit('openIde')"
        >
          打开 IDE
        </FouButton>
        <ChatSessionToolbar
          v-if="!alignRight"
          mode="message"
          :show-think="showThink"
          :show-tools="showTools"
          :replies-collapsed="repliesCollapsed"
          @toggle-think="emit('toggleThink')"
          @toggle-tools="emit('toggleTools')"
          @toggle-replies="emit('toggleReplies')"
        />
      </div>
      <ChatMessageList
        :messages="messages"
        :streaming="streaming"
        :show-tools="showTools"
        :show-think="showThink"
        :collapsed="repliesCollapsed"
        :working-dir="workingDir"
        :assistant-name="assistantName"
        :session-error="sessionError"
        @stop="emit('stop')"
        @edit="emit('edit', $event)"
        @delete="emit('deleteMessage', $event)"
        @copy="emit('copy', $event)"
        @copy-session="emit('copySession')"
        @use-example="emit('useExample', $event)"
      />
    </div>

    <div
      v-if="alignRight"
      class="agent-column-split"
      title="拖动调整输入区高度"
      aria-label="拖动调整输入区高度"
      @pointerdown="startComposerResize"
    />

    <div class="agent-composer" :class="{ 'with-split': alignRight }">
      <slot name="composer" />
    </div>
  </aside>
</template>

<style scoped>
.chat-agent-column {
  width: min(320px, 28vw);
  min-width: 280px;
  height: 100%;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
  border-right: 1px solid var(--hairline);
  background: var(--surface-card);
}
.chat-agent-column.is-right {
  display: grid;
  flex-direction: unset;
  border-right: none;
  border-left: none;
  min-height: 0;
}
.agent-sessions {
  flex: 0 0 26%;
  min-height: 110px;
  max-height: 32%;
  overflow: hidden;
  border-bottom: 1px solid var(--hairline);
}
.chat-agent-column.is-right .agent-sessions {
  flex: unset;
  max-height: none;
  min-height: 0;
}
.chat-agent-column.sessions-hidden .agent-sessions {
  flex: 0 0 auto;
  min-height: 0;
  max-height: none;
}
.agent-sessions :deep(.chat-sidebar) {
  width: 100%;
  height: 100%;
  border-right: none;
}
.agent-messages {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  border-bottom: 1px solid var(--hairline);
}
.agent-messages.with-split {
  flex: unset;
  border-bottom: none;
  min-height: 0;
}
.agent-msg-toolbar {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 4px;
  padding: 4px 8px;
  border-bottom: 1px solid var(--hairline);
  background: var(--surface-soft);
}
.agent-messages :deep(.message-list) {
  flex: 1;
  min-height: 0;
}
.agent-column-split {
  position: relative;
  width: 100%;
  min-height: 9px;
  cursor: row-resize;
  touch-action: none;
  z-index: 3;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
}
.agent-column-split::before {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
  cursor: row-resize;
}
.agent-column-split::after {
  content: "";
  display: block;
  width: 100%;
  height: 100%;
  background: none;
}
.agent-composer {
  flex-shrink: 0;
  min-height: 0;
  max-height: 48%;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  background: var(--surface-card);
}
.agent-composer.with-split {
  flex: unset;
  max-height: none;
  min-height: 0;
  overflow: hidden;
}
.agent-composer :deep(.composer) {
  border-top: none;
  padding-top: 8px;
  max-height: 100%;
}
.agent-composer.with-split :deep(.composer) {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 0 16px 0;
  gap: 8px;
}
.agent-composer.with-split :deep(.composer-input) {
  flex: 1;
  min-height: 72px;
  height: auto !important;
}
</style>
