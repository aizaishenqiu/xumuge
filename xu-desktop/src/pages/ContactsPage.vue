<script setup lang="ts">
/**
 * @author qiuye <yjk150@qq.com>
 */
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { FouButton } from "foucui";
import PageHelpButton from "../components/help/PageHelpButton.vue";
import { useRouter } from "vue-router";
import {
  appendFouMessage,
  loadEmployees,
  readEmployees,
  type Employee,
} from "../utils/employees";
import { BOSS_PEER_ID, OFFICE_FLOOR, isOfficeFloorWorthy, peerSessionTag } from "../utils/officeComms";

interface FouChatMessage {
  id: string;
  sessionTag: string;
  employeeId?: string | null;
  role: string;
  content: string;
  createdAt: number;
}

const router = useRouter();
const employees = ref<Employee[]>(readEmployees());
const selectedId = ref<string | null>(null);
const peerId = ref<string | null>(null);
const floorMsgs = ref<FouChatMessage[]>([]);
const peerMsgs = ref<FouChatMessage[]>([]);
const draft = ref("");
const sending = ref(false);

const roster = computed(() => employees.value.filter((e) => e.roleKind !== "boss"));
const peerSelectOptions = computed(() => [
  { label: "（仅看个人大厅发言）", value: null as string | null },
  { label: "Boss（老板往来）", value: BOSS_PEER_ID },
  ...roster.value
    .filter((x) => x.id !== selectedId.value)
    .map((e) => ({ label: e.name, value: e.id })),
]);
const selected = computed(() => roster.value.find((e) => e.id === selectedId.value) ?? null);
const peer = computed(() => {
  if (peerId.value === BOSS_PEER_ID) {
    return { id: BOSS_PEER_ID, name: "Boss", role: "老板" } as Employee;
  }
  return roster.value.find((e) => e.id === peerId.value) ?? null;
});

const empMsgs = computed(() => {
  const id = selectedId.value;
  if (!id) return [];
  const name = selected.value?.name || "";
  return floorMsgs.value.filter(
    (m) =>
      m.employeeId === id ||
      (name && m.content.includes(name)) ||
      (m.role === "assistant" && m.employeeId === id),
  );
});

async function refreshRoster() {
  try {
    employees.value = await loadEmployees();
  } catch {
    employees.value = readEmployees();
  }
}

async function refreshFloor() {
  try {
    floorMsgs.value = await invoke<FouChatMessage[]>("xu_list_messages", {
      sessionTag: OFFICE_FLOOR,
      limit: 200,
    });
  } catch {
    floorMsgs.value = [];
  }
}

async function refreshPeer() {
  if (!selectedId.value || !peerId.value || selectedId.value === peerId.value) {
    peerMsgs.value = [];
    return;
  }
  try {
    peerMsgs.value = await invoke<FouChatMessage[]>("xu_list_messages", {
      sessionTag: peerSessionTag(selectedId.value, peerId.value),
      limit: 120,
    });
  } catch {
    peerMsgs.value = [];
  }
}

async function refreshAll() {
  await refreshRoster();
  await refreshFloor();
  await refreshPeer();
}

function pick(id: string) {
  selectedId.value = id;
  if (peerId.value === id) peerId.value = null;
  void refreshFloor();
  void refreshPeer();
}

function bubbleClass(role: string, peer = false): string {
  if (peer) return "bubble bubble--peer";
  if (role === "boss" || role === "user") return "bubble bubble--out";
  if (role === "system") return "bubble bubble--system";
  return "bubble bubble--in";
}

function formatTime(ts: number) {
  try {
    return new Date(ts).toLocaleString("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  } catch {
    return "";
  }
}

async function postPeerNote() {
  const a = selected.value;
  const b = peer.value;
  const text = draft.value.trim();
  if (!a || !b || !text || sending.value) return;
  sending.value = true;
  try {
    const tag = peerSessionTag(a.id, b.id);
    await appendFouMessage({
      sessionTag: tag,
      employeeId: null,
      role: "boss",
      content: `【旁听备注】${text}`,
    });
    // 仅开会/需老板安排类旁听进办公室对话框
    if (isOfficeFloorWorthy(text, "boss") || /开会|会议|确认|安排|排期|审批/.test(text)) {
      await appendFouMessage({
        sessionTag: OFFICE_FLOOR,
        role: "system",
        content: `通讯录旁听 · ${a.name} ↔ ${b.name}：${text}`,
      });
    }
    draft.value = "";
    window.dispatchEvent(new CustomEvent("xu-office-notify"));
    await refreshPeer();
    await refreshFloor();
  } finally {
    sending.value = false;
  }
}

watch([selectedId, peerId], () => void refreshPeer());

onMounted(() => {
  void refreshAll();
  window.addEventListener("xu-employees-changed", refreshRoster);
  window.addEventListener("xu-office-notify", refreshFloor);
});
onUnmounted(() => {
  window.removeEventListener("xu-employees-changed", refreshRoster);
  window.removeEventListener("xu-office-notify", refreshFloor);
});
</script>

<template>
  <div class="vue-page contacts-page">
    <header class="vue-page-header">
      <div>
        <h1 class="ui-font">员工往来</h1>
        <p class="ui-font muted">
          查看与旁听员工对话（与「工作监控」不同：这里看对话，那边看在岗进度）
        </p>
      </div>
      <div class="vue-page-actions">
        <PageHelpButton topic="contacts.overview" label="帮助" />
        <FouButton icon="refresh-line" native-type="button" @click="refreshAll">刷新</FouButton>
        <FouButton icon="dashboard-line" native-type="button" @click="router.push('/monitor')">
          工作监控
        </FouButton>
        <FouButton icon="building-4-line" native-type="button" @click="router.push('/office')">
          回办公室
        </FouButton>
      </div>
    </header>

    <div class="contacts-layout">
      <aside class="roster ui-font">
        <h2>花名册 · {{ roster.length }}</h2>
        <button
          v-for="e in roster"
          :key="e.id"
          type="button"
          class="roster-item"
          :class="{ active: selectedId === e.id }"
          @click="pick(e.id)"
        >
          <span class="roster-avatar" aria-hidden="true">{{ e.name.slice(0, 1) }}</span>
          <span class="roster-text">
            <strong>{{ e.name }}</strong>
            <span>{{ e.role }}</span>
          </span>
        </button>
        <div v-if="!roster.length" class="empty-state">
          <span class="empty-icon" aria-hidden="true">👥</span>
          <p>暂无员工</p>
        </div>
      </aside>

      <section class="thread ui-font">
        <template v-if="selected">
          <header class="thread-head">
            <div>
              <h2>{{ selected.name }}</h2>
              <p>{{ selected.role }} · 办公室大厅发言</p>
            </div>
            <label class="peer-pick">
              互聊对象
              <FouSelect v-model="peerId" :options="peerSelectOptions" style="min-width: 200px" />
            </label>
          </header>

          <div class="msg-pane">
            <h3 class="section-title">大厅 · 与 {{ selected.name }} 相关</h3>
            <div v-for="m in empMsgs" :key="m.id" :class="bubbleClass(m.role)">
              <div class="bubble-meta">
                <span>{{ m.role }}</span>
                <time>{{ formatTime(m.createdAt) }}</time>
              </div>
              <div class="bubble-body">{{ m.content }}</div>
            </div>
            <div v-if="!empMsgs.length" class="empty-state empty-state--inline">
              <span class="empty-icon" aria-hidden="true">💬</span>
              <p>暂无相关发言（派活/回复会出现在此）</p>
            </div>

            <template v-if="peer">
              <h3 class="section-title">{{ selected.name }} ↔ {{ peer.name }}</h3>
              <div v-for="m in peerMsgs" :key="m.id" :class="bubbleClass(m.role, true)">
                <div class="bubble-meta">
                  <span>{{ m.role }}</span>
                  <time>{{ formatTime(m.createdAt) }}</time>
                </div>
                <div class="bubble-body">{{ m.content }}</div>
              </div>
              <div v-if="!peerMsgs.length" class="empty-state empty-state--inline">
                <span class="empty-icon" aria-hidden="true">📝</span>
                <p>尚无互聊记录，可在下方写旁听备注</p>
              </div>
              <div class="peer-compose">
                <textarea
                  v-model="draft"
                  rows="3"
                  class="peer-input"
                  placeholder="旁听备注会写入双方会话，并同步一条到办公室大厅…"
                />
                <FouButton
                  icon="chat-check-line"
                  type="primary"
                  native-type="button"
                  :disabled="sending || !draft.trim()"
                  @click="postPeerNote"
                >
                  写入旁听
                </FouButton>
              </div>
            </template>
          </div>
        </template>
        <div v-else class="empty-state pick-hint">
          <span class="empty-icon" aria-hidden="true">📇</span>
          <p>← 选择一位员工查看发言</p>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.contacts-page {
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 12px 16px;
}
.contacts-layout {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 240px 1fr;
  gap: 12px;
  margin-top: 10px;
}
.roster {
  border: 1px solid var(--border, rgba(15, 23, 42, 0.08));
  border-radius: 14px;
  background: var(--surface, #fff);
  padding: 12px;
  overflow: auto;
}
.roster h2 {
  margin: 0 0 10px;
  font-size: 13px;
}
.roster-item {
  width: 100%;
  text-align: left;
  border: 0;
  background: transparent;
  padding: 8px 10px;
  border-radius: 10px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 10px;
  color: inherit;
  border-left: 3px solid transparent;
}
.roster-avatar {
  width: 32px;
  height: 32px;
  border-radius: 999px;
  background: var(--surface-soft, #e2e8f0);
  color: var(--primary, #0d9488);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  font-weight: 600;
  flex-shrink: 0;
}
.roster-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.roster-text strong {
  font-size: 13px;
}
.roster-item span {
  font-size: 11px;
  color: var(--muted, #64748b);
}
.roster-item:hover {
  background: var(--surface-soft, #f1f5f9);
}
.roster-item.active {
  background: var(--surface-soft, #f1f5f9);
  border-left-color: var(--primary, #0d9488);
}
.thread {
  border: 1px solid var(--border, rgba(15, 23, 42, 0.08));
  border-radius: 14px;
  background: var(--surface, #fff);
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.thread-head {
  padding: 12px 14px;
  border-bottom: 1px solid var(--border, rgba(15, 23, 42, 0.08));
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: flex-start;
}
.thread-head h2 {
  margin: 0;
  font-size: 16px;
}
.thread-head p {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--muted, #64748b);
}
.peer-pick {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 11px;
  color: var(--muted, #64748b);
}
.peer-pick select {
  min-width: 160px;
  padding: 6px 8px;
  border-radius: 8px;
  border: 1px solid var(--border, #e2e8f0);
}
.msg-pane {
  flex: 1;
  overflow: auto;
  padding: 12px 14px 20px;
}
.section-title {
  margin: 16px 0 10px;
  font-size: 12px;
  font-weight: 600;
  color: var(--muted, #64748b);
}
.section-title:first-child {
  margin-top: 0;
}
.bubble {
  max-width: 92%;
  margin-bottom: 10px;
  padding: 8px 12px;
  border-radius: 12px;
}
.bubble--in {
  background: var(--surface-soft, #f1f5f9);
  margin-right: auto;
}
.bubble--out {
  background: rgba(13, 148, 136, 0.12);
  margin-left: auto;
}
.bubble--peer {
  background: rgba(20, 184, 166, 0.1);
  margin-right: auto;
}
.bubble--system {
  background: rgba(100, 116, 139, 0.1);
  margin-right: auto;
  max-width: 100%;
}
.bubble-meta {
  display: flex;
  justify-content: space-between;
  font-size: 10px;
  color: var(--muted, #64748b);
  margin-bottom: 4px;
  gap: 8px;
}
.bubble-body {
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 13px;
  line-height: 1.5;
}
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 24px 12px;
  color: var(--muted, #64748b);
  text-align: center;
}
.empty-state--inline {
  padding: 16px 8px;
}
.empty-state p {
  margin: 0;
  font-size: 13px;
}
.empty-icon {
  font-size: 28px;
  line-height: 1;
  opacity: 0.85;
}
.pick-hint .empty-icon {
  font-size: 40px;
}
.peer-compose {
  margin-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.peer-input {
  width: 100%;
  resize: vertical;
  min-height: 72px;
  border-radius: 8px;
  border: 1px solid var(--border, #e2e8f0);
  padding: 8px 10px;
  box-sizing: border-box;
  font: inherit;
}
.pick-hint {
  margin: auto;
  min-height: 240px;
}
</style>
