<script setup lang="ts">
import { FouButton } from "foucui";
import PageHelpButton from "../help/PageHelpButton.vue";
import { onMounted, onUnmounted, ref, watch } from "vue";
import type { ChatPanelLayout, ChatViewMode } from "../../utils/chatLayoutPrefs";

const props = defineProps<{
  streaming: boolean;
  versionLabel: string;
  sessionTitle: string | null;
  viewMode: ChatViewMode;
  panelLayout: ChatPanelLayout;
  homeMode?: boolean;
}>();

const emit = defineEmits<{
  newSession: [];
  rename: [title: string];
  "update:viewMode": [ChatViewMode];
  "update:panelLayout": [ChatPanelLayout];
  openIde: [];
  toggleSessions: [];
}>();

const editing = ref(false);
const draft = ref("");
const layoutOpen = ref(false);
const layoutAnchor = ref<HTMLElement | null>(null);
const layoutPanelStyle = ref<Record<string, string>>({});

watch(
  () => props.sessionTitle,
  (t) => {
    if (!editing.value) draft.value = t?.trim() || "";
  },
);

function commitTitle() {
  editing.value = false;
  const next = draft.value.trim();
  if (!next || next === (props.sessionTitle?.trim() || "")) return;
  emit("rename", next);
}

function placeLayoutPanel() {
  const el = layoutAnchor.value;
  if (!el) return;
  const r = el.getBoundingClientRect();
  layoutPanelStyle.value = {
    position: "fixed",
    top: `${Math.round(r.bottom + 6)}px`,
    left: `${Math.round(Math.min(r.left, window.innerWidth - 220))}px`,
    width: "200px",
    zIndex: "9999",
  };
}

function toggleLayoutMenu() {
  layoutOpen.value = !layoutOpen.value;
  if (layoutOpen.value) placeLayoutPanel();
}

function pickLayout(layout: ChatPanelLayout) {
  emit("update:panelLayout", layout);
  layoutOpen.value = false;
}

function onDocClick(e: MouseEvent) {
  if (!layoutOpen.value) return;
  const t = e.target as Node;
  if (layoutAnchor.value?.contains(t)) return;
  const panel = document.getElementById("xu-chat-layout-panel");
  if (panel?.contains(t)) return;
  layoutOpen.value = false;
}

onMounted(() => {
  document.addEventListener("click", onDocClick, true);
  window.addEventListener("resize", placeLayoutPanel);
});

onUnmounted(() => {
  document.removeEventListener("click", onDocClick, true);
  window.removeEventListener("resize", placeLayoutPanel);
});
</script>

<template>
  <header class="chat-topbar" :class="{ 'chat-topbar-home': homeMode }">
    <div class="chat-topbar-left">
      <FouButton icon="add-line" size="small" aria-label="新对话" @click="emit('newSession')">
        <span v-if="!homeMode">新对话</span>
      </FouButton>
      <div v-if="editing" class="title-edit">
        <FouInput
          v-model="draft"
          size="small"
          @keydown.enter="commitTitle"
          @blur="commitTitle"
        />
      </div>
      <FouButton
        v-else
        class="session-title ui-font"
        :class="{ 'session-title-home': homeMode }"
        icon="edit-line"
        text
        native-type="button"
        :disabled="!sessionTitle && !homeMode"
        @click="
          () => {
            if (!sessionTitle) return;
            draft = sessionTitle;
            editing = true;
          }
        "
      >
        {{ sessionTitle?.trim() || (homeMode ? "今天帮你做些什么？" : "新对话") }}
      </FouButton>
      <span v-if="!homeMode" class="version-pill ui-font">{{ versionLabel }}</span>
      <span v-if="streaming" class="streaming-dot" title="生成中" />
    </div>
    <div class="chat-topbar-right">
      <FouButton icon="code-box-line" size="small" text native-type="button" @click="emit('openIde')">
        打开 IDE
      </FouButton>
      <template v-if="!homeMode">
        <div class="view-toggle ui-font" role="group" aria-label="视图模式">
          <FouButton
            class="view-mode-btn"
            :class="{ active: viewMode === 'qa' }"
            icon="question-answer-line"
            size="small"
            text
            native-type="button"
            @click="emit('update:viewMode', 'qa')"
          >
            问答
          </FouButton>
        </div>
        <div ref="layoutAnchor" class="layout-wrap">
          <FouButton
            icon="layout-column-line"
            size="small"
            text
            native-type="button"
            title="布局设置"
            @click.stop="toggleLayoutMenu"
          >
            布局
          </FouButton>
          <Teleport to="body">
            <div
              v-if="layoutOpen"
              id="xu-chat-layout-panel"
              class="layout-menu ui-font"
              :style="layoutPanelStyle"
              @click.stop
            >
              <FouButton
                class="layout-item"
                :class="{ active: panelLayout === 'agentLeft' }"
                icon="layout-left-line"
                text
                native-type="button"
                @click="pickLayout('agentLeft')"
              >
                智能体在左
              </FouButton>
              <FouButton
                class="layout-item"
                :class="{ active: panelLayout === 'agentRight' }"
                icon="layout-right-line"
                text
                native-type="button"
                @click="pickLayout('agentRight')"
              >
                智能体在右
              </FouButton>
            </div>
          </Teleport>
        </div>
      </template>
      <PageHelpButton :topic="viewMode === 'code' ? 'chat.code-layout' : 'chat.overview'" label="帮助" />
    </div>
  </header>
</template>

<style scoped>
.chat-topbar {
  height: var(--topbar-h);
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 0 12px;
  border-bottom: 1px solid var(--hairline);
  background: var(--chrome-bar, var(--surface-soft));
  position: relative;
  z-index: 40;
}
.chat-topbar-home {
  height: 52px;
  padding: 0 20px;
  background: var(--surface-base, #f8fafc);
  border-bottom-color: color-mix(in srgb, var(--hairline) 70%, transparent);
}
.chat-topbar-left,
.chat-topbar-right {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.chat-topbar-home .chat-topbar-left {
  flex: 1;
  justify-content: center;
}
.chat-topbar-home .chat-topbar-right {
  flex-shrink: 0;
}
.session-title-home {
  font-size: 16px;
  font-weight: 600;
  max-width: min(480px, 50vw);
}
.view-toggle {
  display: flex;
  gap: 2px;
  padding: 2px;
  border-radius: 8px;
  border: 1px solid var(--hairline);
  background: var(--canvas);
}
.view-mode-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--muted);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.view-mode-btn:hover {
  color: var(--ink);
  background: var(--surface-soft);
}
.view-mode-btn.active {
  background: var(--primary-glow);
  color: var(--primary);
  font-weight: 600;
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--primary) 35%, transparent);
}
.session-title {
  border: none;
  background: transparent;
  font-size: 14px;
  font-weight: 600;
  color: var(--ink);
  cursor: pointer;
  max-width: 240px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.session-title:disabled {
  opacity: 0.5;
  cursor: default;
}
.title-edit {
  min-width: 160px;
  max-width: 280px;
}
.version-pill {
  font-size: 10px;
  color: var(--muted);
  padding: 2px 6px;
  border-radius: 4px;
  background: var(--canvas);
}
.streaming-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--primary);
  animation: pulse 1.2s ease-in-out infinite;
}
.layout-menu {
  background: var(--surface-card);
  border: 1px solid var(--hairline);
  border-radius: var(--radius);
  box-shadow: var(--shadow-lg);
  padding: 4px;
}
.layout-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 10px;
  border: none;
  border-radius: var(--radius);
  background: transparent;
  text-align: left;
  font-size: 12px;
  cursor: pointer;
}
.layout-item:hover,
.layout-item.active {
  background: var(--primary-glow);
}
@keyframes pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.35;
  }
}
</style>
