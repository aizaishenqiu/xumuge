<script setup lang="ts">
/**
 * @file 对话会话侧栏与跨会话正文搜索
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-30
 * @updated 2026-09-07
 * @version 1.1.0
 * @category UI
 * @algo debounce-search
 */

import { FouButton, FouInput, fouAlert as showFouAlert } from "foucui";
import { computed, onBeforeUnmount, ref, watch } from "vue";
import type { Session } from "../../types";
import { searchChatMessages, type ChatSearchHit } from "../../utils/contextMemory";
import { readLs, writeLs } from "../../utils/xuStorage";
import BillingPanel from "./BillingPanel.vue";

const BILLING_OPEN_KEY = "xu.ide.chatBillingOpen";

function readBillingOpen(): boolean {
  try {
    return readLs(BILLING_OPEN_KEY, "1") !== "0";
  } catch {
    return true;
  }
}

const props = withDefaults(
  defineProps<{
    sessions: Session[];
    activeId: string | null;
    badges: Record<string, "running" | "queued" | "done">;
    queueCounts: Record<string, number>;
    billingPresetId?: string;
    billingModelLabel?: string;
    /** 首页任务栏：隐藏顶栏新建、账单，宽度随父容器 */
    compact?: boolean;
    /** 受控：会话搜索+列表是否展开（与 IDE 历史开关同步） */
    sessionsListVisible?: boolean;
    /** 显示「会话/账单」顶栏开关（非 compact 默认开） */
    showPaneToggles?: boolean;
  }>(),
  { compact: false, showPaneToggles: true },
);

const emit = defineEmits<{
  select: [id: string];
  new: [];
  delete: [id: string];
  refresh: [];
  stopSession: [id: string];
  "update:sessionsListVisible": [boolean];
}>();

const pendingDelete = ref<string | null>(null);
let deleteTimer: ReturnType<typeof setTimeout> | null = null;
const searchQuery = ref("");
const searchBusy = ref(false);
const searchHits = ref<ChatSearchHit[]>([]);
let searchTimer: ReturnType<typeof setTimeout> | null = null;

const billingOpen = ref(readBillingOpen());
const localSessionsOpen = ref(true);

const sessionsControlled = computed(() => props.sessionsListVisible !== undefined);
const sessionsOpen = computed(() =>
  sessionsControlled.value ? props.sessionsListVisible !== false : localSessionsOpen.value,
);
const paneToggles = computed(() => !props.compact && props.showPaneToggles !== false);

function toggleSessions() {
  const next = !sessionsOpen.value;
  if (sessionsControlled.value) {
    emit("update:sessionsListVisible", next);
  } else {
    localSessionsOpen.value = next;
  }
}

function toggleBilling() {
  billingOpen.value = !billingOpen.value;
  writeLs(BILLING_OPEN_KEY, billingOpen.value ? "1" : "0");
}

watch(searchQuery, (query) => {
  if (searchTimer) clearTimeout(searchTimer);
  const q = query.trim();
  if (!q) {
    searchHits.value = [];
    searchBusy.value = false;
    return;
  }
  searchBusy.value = true;
  searchTimer = setTimeout(async () => {
    try {
      searchHits.value = await searchChatMessages(q);
    } catch {
      searchHits.value = [];
      await showFouAlert("搜索会话失败，请稍后重试", "搜索失败");
    } finally {
      searchBusy.value = false;
    }
  }, 250);
});

onBeforeUnmount(() => {
  if (searchTimer) clearTimeout(searchTimer);
  if (deleteTimer) clearTimeout(deleteTimer);
});

function selectSearchHit(hit: ChatSearchHit) {
  emit("select", hit.sessionId);
}

function formatDate(iso: string): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    const diff = Date.now() - d.getTime();
    if (diff < 60_000) return "刚刚";
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}分钟前`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}小时前`;
    return `${d.getMonth() + 1}/${d.getDate()}`;
  } catch {
    return "";
  }
}

function requestDelete(id: string) {
  if (pendingDelete.value === id) {
    emit("delete", id);
    pendingDelete.value = null;
    return;
  }
  pendingDelete.value = id;
  if (deleteTimer) clearTimeout(deleteTimer);
  deleteTimer = setTimeout(() => {
    pendingDelete.value = null;
  }, 3000);
}
</script>

<template>
  <aside class="chat-sidebar" :class="{ compact, 'list-collapsed': !sessionsOpen }">
    <div v-if="!compact" class="sidebar-actions">
      <FouButton type="primary" icon="add-line" size="small" @click="emit('new')">新建</FouButton>
      <FouButton icon="refresh-line" size="small" text aria-label="刷新" @click="emit('refresh')" />
      <span class="sidebar-actions-spacer" />
      <template v-if="paneToggles">
        <FouButton
          icon="chat-history-line"
          size="small"
          :type="sessionsOpen ? 'primary' : 'default'"
          native-type="button"
          title="会话列表"
          aria-label="会话列表"
          @click="toggleSessions"
        >
          会话
        </FouButton>
        <FouButton
          icon="money-cny-box-line"
          size="small"
          :type="billingOpen ? 'primary' : 'default'"
          native-type="button"
          title="账单"
          aria-label="账单"
          @click="toggleBilling"
        >
          账单
        </FouButton>
      </template>
    </div>
    <div v-show="sessionsOpen" class="sidebar-search">
      <FouInput
        v-model="searchQuery"
        clearable
        prefix-icon="search-line"
        placeholder="搜索全部会话正文"
        aria-label="搜索全部会话正文"
      />
    </div>
    <div v-show="sessionsOpen" class="session-list">
      <template v-if="searchQuery.trim()">
        <div
          v-for="hit in searchHits"
          :key="hit.messageId"
          class="search-hit"
          role="button"
          tabindex="0"
          @click="selectSearchHit(hit)"
          @keydown.enter="selectSearchHit(hit)"
        >
          <strong class="search-hit-title ui-font">{{ hit.sessionTitle || "未命名会话" }}</strong>
          <span class="search-hit-snippet">{{ hit.snippet }}</span>
        </div>
        <p v-if="searchBusy" class="empty ui-font">正在搜索…</p>
        <p v-else-if="!searchHits.length" class="empty ui-font">未找到匹配正文</p>
      </template>
      <template v-else>
        <div
          v-for="s in sessions"
          :key="s.id"
          role="button"
          tabindex="0"
          class="session-item"
          :class="{ active: s.id === activeId }"
          @click="emit('select', s.id)"
          @keydown.enter="emit('select', s.id)"
        >
          <div class="session-item-main">
            <div class="session-title-row">
              <span class="session-item-title ui-font">{{ s.title || "未命名" }}</span>
            </div>
            <span class="session-item-meta">{{ formatDate(s.updated_at || s.created_at) }}</span>
            <span v-if="s.last_message" class="session-item-sub">{{ s.last_message }}</span>
          </div>
          <span v-if="badges[s.id] === 'running'" class="session-badge running ui-font">生成中</span>
          <span
            v-else-if="badges[s.id] === 'queued' || (queueCounts[s.id] ?? 0) > 0"
            class="session-badge queued ui-font"
          >
            排队 {{ queueCounts[s.id] ?? 0 }}
          </span>
          <FouButton
            v-if="badges[s.id] === 'running'"
            icon="stop-fill"
            size="small"
            text
            aria-label="停止此会话"
            @click.stop="emit('stopSession', s.id)"
          />
          <FouButton
            :icon="pendingDelete === s.id ? 'delete-bin-line' : 'close-line'"
            size="small"
            text
            :aria-label="pendingDelete === s.id ? '确认删除' : '删除'"
            @click.stop="requestDelete(s.id)"
          />
        </div>
        <p v-if="!sessions.length" class="empty ui-font">暂无会话，点新建开始</p>
      </template>
    </div>
    <BillingPanel
      v-if="!compact && billingOpen"
      :preset-id="billingPresetId ?? 'local'"
      :model-label="billingModelLabel ?? '未配置'"
    />
  </aside>
</template>

<style scoped>
.chat-sidebar {
  width: var(--sidebar-w);
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--hairline);
  background: var(--surface-soft);
  min-height: 0;
}
.chat-sidebar.compact {
  width: 100%;
  border-right: none;
  background: transparent;
}
.chat-sidebar.list-collapsed .session-list,
.chat-sidebar.list-collapsed .sidebar-search {
  display: none;
}
.sidebar-actions {
  display: flex;
  gap: 6px;
  align-items: center;
  padding: 10px;
  border-bottom: 1px solid var(--hairline);
  flex-shrink: 0;
}
.sidebar-actions-spacer {
  flex: 1;
  min-width: 8px;
}
.sidebar-search {
  padding: 8px 10px;
  border-bottom: 1px solid var(--hairline);
  flex-shrink: 0;
}
.search-hit {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 9px;
  margin-bottom: 5px;
  border: 1px solid transparent;
  border-radius: var(--radius);
  cursor: pointer;
}
.search-hit:hover,
.search-hit:focus-visible {
  background: var(--surface-card);
  border-color: var(--primary);
  outline: none;
}
.search-hit-title {
  color: var(--ink);
  font-size: 13px;
}
.search-hit-snippet {
  color: var(--muted);
  font-size: 12px;
  line-height: 1.45;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.session-list {
  flex: 1;
  overflow: auto;
  padding: 8px;
  min-height: 0;
}
.session-item {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 8px;
  margin-bottom: 4px;
  border: 1px solid transparent;
  border-radius: var(--radius);
  background: transparent;
  color: inherit;
  cursor: pointer;
  text-align: left;
  overflow: hidden;
  box-sizing: border-box;
}
.session-item :deep(.fou-button) {
  flex-shrink: 0;
}
.session-item:hover {
  background: var(--surface-card);
}
.session-item.active {
  background: var(--surface-card);
  border-color: var(--primary);
  box-shadow: 0 0 0 2px var(--primary-glow);
}
.session-item-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.session-title-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.session-badge {
  flex-shrink: 0;
  font-size: 11px;
  line-height: 1.2;
  padding: 2px 7px;
  border-radius: 999px;
  font-weight: 600;
  white-space: nowrap;
  writing-mode: horizontal-tb;
  text-orientation: mixed;
}
.session-badge.running {
  color: var(--primary);
  background: var(--primary-glow);
}
.session-badge.queued {
  color: #b45309;
  background: rgba(180, 83, 9, 0.12);
}
.session-item-title {
  font-weight: 600;
  font-size: 13px;
  color: var(--ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.session-item-meta {
  font-size: 11px;
  color: var(--muted-soft);
}
.session-item-sub {
  font-size: 12px;
  color: var(--muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.empty {
  padding: 24px 12px;
  text-align: center;
  color: var(--muted);
  font-size: 13px;
}
</style>
