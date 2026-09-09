<script setup lang="ts">
/**
 * @author qiuye <yjk150@qq.com>
 */
import { computed, onMounted, onUnmounted, reactive, ref } from "vue";
import { FouButton } from "foucui";
import PageHelpButton from "../components/help/PageHelpButton.vue";
import { useRouter } from "vue-router";
import {
  loadEmployees,
  readEmployees,
  type Employee,
  type EmployeeStatus,
} from "../utils/employees";
import { loadProjectTheme, type ProjectTheme } from "../utils/projectTheme";
import { loadProjects, type XuProject } from "../utils/projects";
import { formatToolApprovalLabel } from "../utils/toolApprovalLabels";
import { sanitizeUserDisplayText } from "../utils/userFacingError";
import {
  ensureEmployeeLiveBridge,
  getLivePatch,
  getRecentAgentEvents,
  mapEventState,
  subscribeAgentLive,
  subscribeEmployeeLive,
  agentKindLabel,
  type AgentLiveEvent,
  type EmployeeLiveEvent,
  type LivePatch,
} from "../employee/events";
import {
  getDeliveryDisputes,
  type DeliveryDispute,
} from "../utils/deliveryReviewOrchestrator";

const router = useRouter();
const employees = ref<Employee[]>(readEmployees());
const project = ref<ProjectTheme | null>(null);
const projects = ref<XuProject[]>([]);
const filterProjectId = ref<string>("");
/** live action text — pushed from Rust, no polling */
const live = reactive<Record<string, LivePatch>>({});
/** Real Codex-style agent turns (not fake PEER chat) */
const agentFeed = ref<AgentLiveEvent[]>([]);
const disputes = ref<DeliveryDispute[]>(getDeliveryDisputes());

const openDisputeByEmployee = computed(() => {
  const m = new Map<string, DeliveryDispute>();
  for (const d of disputes.value) {
    if (d.status === "open" || d.status === "discussing") m.set(d.employeeId, d);
  }
  return m;
});

function onDisputesChanged() {
  disputes.value = getDeliveryDisputes();
}

const STATUS_ZH: Record<EmployeeStatus, string> = {
  idle: "空闲",
  working: "工作中",
  meeting: "会议中",
  away: "离开",
};

async function refresh() {
  try {
    employees.value = await loadEmployees();
  } catch {
    employees.value = readEmployees();
  }
  try {
    project.value = await loadProjectTheme();
  } catch {
    project.value = null;
  }
  try {
    projects.value = await loadProjects();
  } catch {
    projects.value = [];
  }
  for (const e of employees.value) {
    const p = getLivePatch(e.id);
    if (p) live[e.id] = p;
  }
}

function onLive(ev: EmployeeLiveEvent) {
  const prev = live[ev.employeeId];
  live[ev.employeeId] = {
    state: ev.state,
    action: ev.action,
    message: ev.message,
    at: ev.at,
    projectId: prev?.projectId ?? getLivePatch(ev.employeeId)?.projectId,
  };
  const st = mapEventState(ev.state);
  if (!st) return;
  // Patch local list only — Rust already wrote DB
  const idx = employees.value.findIndex((e) => e.id === ev.employeeId);
  if (idx >= 0 && employees.value[idx].status !== st) {
    const next = employees.value.slice();
    next[idx] = { ...next[idx], status: st };
    employees.value = next;
  }
}

function matchesProjectFilter(e: Employee): boolean {
  const pid = filterProjectId.value;
  if (!pid) return true;
  const livePid = live[e.id]?.projectId || getLivePatch(e.id)?.projectId;
  if (livePid === pid) return true;
  const fou = projects.value.find((p) => p.id === pid);
  if (fou?.employeeIds.includes(e.id)) {
    if (project.value?.id === pid) return true;
    return e.status === "working" || e.status === "meeting" || Boolean(livePid);
  }
  return false;
}

function agentFeedBody(ev: AgentLiveEvent): string {
  if (ev.kind === "tool_call") {
    return formatToolApprovalLabel(ev.toolName || "tool", ev.toolArgs);
  }
  return sanitizeUserDisplayText((ev.content || "").slice(0, 120), "运行中…");
}

const roster = computed(() =>
  employees.value.filter((e) => e.roleKind !== "boss" && matchesProjectFilter(e)),
);

const working = computed(() =>
  roster.value.filter((e) => e.status === "working" || e.status === "meeting"),
);
const idle = computed(() =>
  roster.value.filter((e) => e.status === "idle" || e.status === "away"),
);

const dutyOf = computed(() => {
  const m = new Map<string, string>();
  for (const a of project.value?.assignments ?? []) {
    m.set(a.employeeId, a.duty);
  }
  return m;
});

const progressOf = computed(() => {
  const m = new Map<string, number>();
  for (const a of project.value?.assignments ?? []) {
    m.set(a.employeeId, a.progress);
  }
  return m;
});

function actionOf(id: string): string {
  const p = live[id];
  if (!p) return "";
  if (p.agentKind) {
    const tag = agentKindLabel(p.agentKind);
    if (p.message) return `[${tag}] ${p.message}`;
  }
  if (p.message) return p.message;
  return p.action || "";
}

function onAgent(ev: AgentLiveEvent) {
  agentFeed.value = [...getRecentAgentEvents()].reverse().slice(0, 24);
  if (ev.employeeId) {
    const p = getLivePatch(ev.employeeId);
    if (p) live[ev.employeeId] = p;
  }
}

let unsub: (() => void) | null = null;
let unsubAgent: (() => void) | null = null;
let refreshTimer: number | null = null;
function softRefresh() {
  if (refreshTimer != null) return;
  refreshTimer = window.setTimeout(() => {
    refreshTimer = null;
    void refresh();
  }, 800);
}

onMounted(() => {
  void ensureEmployeeLiveBridge();
  void refresh();
  agentFeed.value = [...getRecentAgentEvents()].reverse().slice(0, 24);
  unsub = subscribeEmployeeLive(onLive);
  unsubAgent = subscribeAgentLive(onAgent);
  window.addEventListener("xu-employees-changed", softRefresh);
  window.addEventListener("xu-project-changed", softRefresh);
  window.addEventListener("xu-projects-changed", softRefresh);
  window.addEventListener("xu-delivery-disputes-changed", onDisputesChanged);
});
onUnmounted(() => {
  unsub?.();
  unsubAgent?.();
  if (refreshTimer != null) window.clearTimeout(refreshTimer);
  window.removeEventListener("xu-employees-changed", softRefresh);
  window.removeEventListener("xu-project-changed", softRefresh);
  window.removeEventListener("xu-projects-changed", softRefresh);
  window.removeEventListener("xu-delivery-disputes-changed", onDisputesChanged);
});
</script>

<template>
  <div class="vue-page monitor-page">
    <header class="vue-page-header">
      <div>
        <h1 class="ui-font">工作监控</h1>
        <p class="ui-font muted">
          看谁在干活与实时进度（与「员工往来」不同：这里看在岗，那边看对话）
          · 在岗 {{ working.length }} / {{ roster.length }}
          <template v-if="project"> · {{ project.name }}</template>
        </p>
      </div>
      <div class="vue-page-actions">
        <PageHelpButton topic="monitor.overview" label="帮助" />
        <PageHelpButton topic="monitor.delivery-review" label="交付监控" />
        <div class="mon-filter">
          <FouButton
            icon="filter-3-line"
            size="small"
            native-type="button"
            :type="!filterProjectId ? 'primary' : 'default'"
            @click="filterProjectId = ''"
          >
            全部项目
          </FouButton>
          <FouButton
            v-for="p in projects.slice(0, 8)"
            :key="p.id"
            icon="folder-line"
            size="small"
            native-type="button"
            :type="filterProjectId === p.id ? 'primary' : 'default'"
            @click="filterProjectId = p.id"
          >
            {{ p.name }}
          </FouButton>
        </div>
        <FouButton icon="refresh-line" native-type="button" @click="refresh">刷新</FouButton>
        <FouButton icon="building-4-line" native-type="button" @click="router.push('/office')">
          回办公室
        </FouButton>
        <FouButton icon="contacts-book-2-line" native-type="button" @click="router.push('/contacts')">
          员工往来
        </FouButton>
      </div>
    </header>

    <div class="mon-grid">
      <section class="mon-col">
        <h2 class="ui-font">
          <span class="dot on" /> 工作中 · {{ working.length }}
        </h2>
        <ul v-if="working.length" class="mon-list ui-font">
          <li v-for="e in working" :key="e.id">
            <div class="row-top">
              <strong>{{ e.name }}</strong>
              <span v-if="openDisputeByEmployee.get(e.id)" class="dispute-badge">交付争议</span>
              <span class="st" data-st="working">{{ STATUS_ZH[e.status] }}</span>
            </div>
            <div class="meta">{{ e.role }} · {{ e.deskIndex != null ? `工位 ${e.deskIndex}` : "未入座" }}</div>
            <div class="duty">{{ dutyOf.get(e.id) || "暂无项目分工" }}</div>
            <div v-if="actionOf(e.id)" class="action">正在：{{ actionOf(e.id) }}</div>
            <div class="bar"><i :style="{ width: `${progressOf.get(e.id) ?? 0}%` }" /></div>
          </li>
        </ul>
        <p v-else class="empty ui-font">当前没有人在工作</p>
      </section>

      <section class="mon-col">
        <h2 class="ui-font">
          <span class="dot off" /> 未在工作 · {{ idle.length }}
        </h2>
        <ul v-if="idle.length" class="mon-list ui-font">
          <li v-for="e in idle" :key="e.id">
            <div class="row-top">
              <strong>{{ e.name }}</strong>
              <span v-if="openDisputeByEmployee.get(e.id)" class="dispute-badge">交付争议</span>
              <span class="st" :data-st="e.status">{{ STATUS_ZH[e.status] }}</span>
            </div>
            <div class="meta">{{ e.role }} · {{ e.deskIndex != null ? `工位 ${e.deskIndex}` : "未入座" }}</div>
            <div class="duty">{{ dutyOf.get(e.id) || "暂无项目分工" }}</div>
            <div v-if="actionOf(e.id)" class="action">最近：{{ actionOf(e.id) }}</div>
          </li>
        </ul>
        <p v-else class="empty ui-font">全部在忙</p>
      </section>
    </div>

    <section class="mon-feed">
      <h2 class="ui-font">运行监控</h2>
      <p class="ui-font muted feed-hint">智能体工具调用、思考与上下文整理事件（实时推送）</p>
      <ul v-if="agentFeed.length" class="feed-list ui-font">
        <li v-for="(ev, i) in agentFeed" :key="`${ev.at}-${i}`">
          <span class="feed-kind" :data-k="ev.kind">{{ agentKindLabel(ev.kind) }}</span>
          <span class="feed-who">{{
            employees.find((e) => e.id === ev.employeeId)?.name || ev.employeeId || "会话"
          }}</span>
          <span class="feed-body">{{ agentFeedBody(ev) }}</span>
        </li>
      </ul>
      <p v-else class="empty ui-font">尚无 Agent 事件；派活后会出现在这里</p>
    </section>
  </div>
</template>

<style scoped>
.monitor-page {
  height: 100%;
  overflow: auto;
  padding: 12px 16px 24px;
}
.mon-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
  margin-top: 12px;
}
.mon-filter {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
  max-width: min(52vw, 640px);
}
@media (max-width: 900px) {
  .mon-grid {
    grid-template-columns: 1fr;
  }
}
.mon-col {
  border: 1px solid var(--border, rgba(15, 23, 42, 0.08));
  border-radius: 14px;
  background: var(--surface, #fff);
  padding: 14px;
  min-height: 200px;
}
.mon-col h2 {
  margin: 0 0 12px;
  font-size: 14px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}
.dot.on {
  background: #14b8a6;
  box-shadow: 0 0 0 3px rgba(20, 184, 166, 0.25);
}
.dot.off {
  background: #94a3b8;
}
.mon-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.mon-list li {
  padding: 10px 12px;
  border-radius: 10px;
  background: var(--surface-soft, #f8fafc);
}
.row-top {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}
.dispute-badge {
  font-size: 10px;
  font-weight: 700;
  padding: 2px 6px;
  border-radius: 999px;
  background: rgba(239, 68, 68, 0.15);
  color: #b91c1c;
}
.st {
  font-size: 11px;
  font-weight: 700;
  padding: 2px 7px;
  border-radius: 999px;
}
.st[data-st="working"],
.st[data-st="meeting"] {
  background: rgba(20, 184, 166, 0.15);
  color: #0f766e;
}
.st[data-st="idle"],
.st[data-st="away"] {
  background: rgba(148, 163, 184, 0.2);
  color: #475569;
}
.meta,
.duty,
.action {
  font-size: 12px;
  color: var(--muted, #64748b);
  margin-top: 4px;
}
.action {
  color: #0f766e;
  font-weight: 600;
}
.bar {
  margin-top: 8px;
  height: 4px;
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.08);
  overflow: hidden;
}
.bar i {
  display: block;
  height: 100%;
  background: #14b8a6;
}
.empty {
  margin: 24px 0;
  text-align: center;
  color: var(--muted, #64748b);
}
.mon-feed {
  margin-top: 16px;
  border: 1px solid var(--border, rgba(15, 23, 42, 0.08));
  border-radius: 14px;
  background: var(--surface, #fff);
  padding: 14px;
}
.mon-feed h2 {
  margin: 0;
  font-size: 14px;
}
.feed-hint {
  margin: 4px 0 10px;
  font-size: 12px;
}
.feed-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 280px;
  overflow: auto;
}
.feed-list li {
  display: grid;
  grid-template-columns: 52px 72px 1fr;
  gap: 8px;
  align-items: baseline;
  font-size: 12px;
  padding: 6px 8px;
  border-radius: 8px;
  background: var(--surface-soft, #f8fafc);
}
.feed-kind {
  font-weight: 700;
  font-size: 11px;
}
.feed-kind[data-k="tool_call"] {
  color: #0f766e;
}
.feed-kind[data-k="error"] {
  color: #b91c1c;
}
.feed-kind[data-k="done"] {
  color: #475569;
}
.feed-who {
  color: var(--muted, #64748b);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.feed-body {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
