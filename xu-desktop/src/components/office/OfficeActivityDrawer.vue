<script setup lang="ts">
/**
 * Collapsible in-office subset of Monitor: dispatch queue + recent agent events.
 */
import { computed, onMounted, onUnmounted, ref } from "vue";
import { FouButton } from "foucui";
import {
  agentKindLabel,
  ensureEmployeeLiveBridge,
  getRecentAgentEvents,
  subscribeAgentLive,
  type AgentLiveEvent,
} from "../../employee/events";
import { listDispatchJobs, type PendingDispatchJob } from "../../employee/dispatch";
import { readEmployees, type Employee } from "../../utils/employees";
import { formatToolApprovalLabel } from "../../utils/toolApprovalLabels";
import { sanitizeUserDisplayText } from "../../utils/userFacingError";

const props = defineProps<{
  employees: Employee[];
  projectId?: string;
}>();

const LS_KEY = "xu.office.activityDrawerOpen";
const open = ref(false);
const queue = ref<PendingDispatchJob[]>([]);
const agentFeed = ref<AgentLiveEvent[]>([]);

const nameById = computed(() => {
  const m = new Map<string, string>();
  for (const e of props.employees) m.set(e.id, e.name);
  for (const e of readEmployees()) m.set(e.id, e.name);
  return m;
});

function refreshQueue() {
  queue.value = listDispatchJobs();
}

function refreshAgentFeed() {
  agentFeed.value = [...getRecentAgentEvents()].reverse().slice(0, 16);
}

function onQueueChanged() {
  refreshQueue();
}

function onAgent(ev: AgentLiveEvent) {
  void ev;
  refreshAgentFeed();
}

let unsubAgent: (() => void) | null = null;

onMounted(() => {
  try {
    open.value = localStorage.getItem(LS_KEY) === "1";
  } catch {
    /* ignore */
  }
  void ensureEmployeeLiveBridge();
  refreshQueue();
  refreshAgentFeed();
  unsubAgent = subscribeAgentLive(onAgent);
  window.addEventListener("xu-employee-queue-changed", onQueueChanged);
});

onUnmounted(() => {
  unsubAgent?.();
  window.removeEventListener("xu-employee-queue-changed", onQueueChanged);
});

function toggle() {
  open.value = !open.value;
  try {
    localStorage.setItem(LS_KEY, open.value ? "1" : "0");
  } catch {
    /* ignore */
  }
}

function agentEventSummary(ev: AgentLiveEvent): string {
  if (ev.kind === "tool_call") {
    return formatToolApprovalLabel(ev.toolName || "tool", ev.toolArgs);
  }
  return sanitizeUserDisplayText(ev.content || ev.toolName || "", "运行中…");
}

const workingCount = computed(
  () => props.employees.filter((e) => e.status === "working" || e.status === "meeting").length,
);
</script>

<template>
  <div class="oad ui-font" :class="{ open }">
    <FouButton
      class="oad-toggle"
      :icon="open ? 'arrow-down-s-line' : 'arrow-up-s-line'"
      size="small"
      native-type="button"
      @click="toggle"
    >
      进行中 · 在岗 {{ workingCount }}
      <span v-if="queue.length" class="oad-badge">{{ queue.length }}</span>
    </FouButton>
    <div v-show="open" class="oad-body">
      <section class="oad-col">
        <h3>派活队列</h3>
        <ul v-if="queue.length" class="oad-list">
          <li v-for="job in queue" :key="job.jobId">
            <strong>{{ job.employeeName || nameById.get(job.employeeId) || job.employeeId }}</strong>
            <span class="oad-meta">{{ job.message.slice(0, 72) }}{{ job.message.length > 72 ? "…" : "" }}</span>
          </li>
        </ul>
        <p v-else class="oad-empty">队列为空</p>
      </section>
      <section class="oad-col">
        <h3>最近运行事件</h3>
        <ul v-if="agentFeed.length" class="oad-list">
          <li v-for="(ev, i) in agentFeed" :key="`${ev.employeeId}-${ev.at}-${i}`">
            <strong>{{ nameById.get(ev.employeeId || "") || "智能体" }}</strong>
            <span class="oad-meta">[{{ agentKindLabel(ev.kind) }}] {{ agentEventSummary(ev).slice(0, 64) }}</span>
          </li>
        </ul>
        <p v-else class="oad-empty">暂无事件</p>
      </section>
    </div>
  </div>
</template>

<style scoped>
.oad {
  border-top: 1px solid var(--fou-border-color, #e2e8f0);
  background: var(--fou-bg-color-overlay, rgba(255, 255, 255, 0.92));
}
.oad-toggle {
  width: 100%;
  justify-content: center;
  border-radius: 0;
}
.oad-badge {
  margin-left: 6px;
  padding: 0 6px;
  border-radius: 10px;
  background: var(--fou-color-primary, #2563eb);
  color: #fff;
  font-size: 11px;
}
.oad-body {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  padding: 8px 12px 12px;
  max-height: 200px;
  overflow: auto;
}
.oad-col h3 {
  margin: 0 0 6px;
  font-size: 13px;
  font-weight: 600;
}
.oad-list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.oad-list li {
  margin-bottom: 6px;
  font-size: 12px;
}
.oad-meta {
  display: block;
  opacity: 0.8;
  margin-top: 2px;
}
.oad-empty {
  margin: 0;
  font-size: 12px;
  opacity: 0.65;
}
@media (max-width: 720px) {
  .oad-body {
    grid-template-columns: 1fr;
  }
}
</style>
