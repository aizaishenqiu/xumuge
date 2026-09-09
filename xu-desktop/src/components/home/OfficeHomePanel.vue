<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useRouter } from "vue-router";
import { FouButton } from "foucui";
import AddEmployeeDialog from "../AddEmployeeDialog.vue";
import AssignTaskDialog from "../AssignTaskDialog.vue";
import {
  loadEmployees,
  readEmployees,
  type Employee,
} from "../../utils/employees";
import { readDeskCount } from "../../utils/officeSettings";
import {
  ensureEmployeeLiveBridge,
  getLivePatch,
  mapEventState,
  subscribeEmployeeLive,
  type EmployeeLiveEvent,
} from "../../employee/events";

const router = useRouter();
const employees = ref<Employee[]>([]);
const deskCount = ref(readDeskCount());
const showAdd = ref(false);
const assigning = ref<Employee | null>(null);
const loading = ref(true);

const seatedCount = computed(() => employees.value.filter((e) => e.deskIndex != null).length);

const STATUS_LABEL: Record<string, string> = {
  idle: "空闲",
  working: "工作中",
  meeting: "会议中",
  away: "离开",
};

function statusLabel(e: Employee): string {
  return STATUS_LABEL[e.status] ?? e.status;
}

async function refresh() {
  loading.value = true;
  try {
    employees.value = await loadEmployees();
    deskCount.value = readDeskCount();
  } finally {
    loading.value = false;
  }
}

function onLive(ev: EmployeeLiveEvent) {
  const patch = getLivePatch(ev.employeeId);
  if (!patch) return;
  const idx = employees.value.findIndex((e) => e.id === ev.employeeId);
  if (idx < 0) return;
  const next = { ...employees.value[idx] };
  const mapped = mapEventState(patch.state);
  if (mapped) next.status = mapped;
  employees.value = employees.value.map((e, i) => (i === idx ? next : e));
}

let unlistenLive: (() => void) | undefined;

onMounted(() => {
  employees.value = readEmployees();
  void refresh();
  void ensureEmployeeLiveBridge();
  unlistenLive = subscribeEmployeeLive(onLive);
});

onUnmounted(() => {
  unlistenLive?.();
});

function openOffice() {
  void router.push("/office");
}

function openProjects() {
  void router.push("/projects");
}
</script>

<template>
  <aside class="office-home-panel ui-font">
    <header class="office-home-header">
      <h2 class="office-home-title">办公室</h2>
      <p class="office-home-meta">
        {{ employees.length }} 名员工 · {{ seatedCount }}/{{ deskCount }} 入座
      </p>
    </header>

    <div class="office-home-actions">
      <FouButton icon="building-4-line" size="small" @click="openOffice">进入办公室</FouButton>
      <FouButton icon="user-add-line" size="small" text @click="showAdd = true">添加员工</FouButton>
      <FouButton icon="send-plane-line" size="small" text @click="openProjects">派活</FouButton>
    </div>

    <div v-if="loading" class="office-home-loading">加载中…</div>
    <ul v-else class="office-home-list">
      <li v-for="emp in employees" :key="emp.id" class="office-home-row">
        <span class="status-dot" :class="`status-${emp.status}`" :title="statusLabel(emp)" />
        <div class="office-home-row-body">
          <span class="emp-name">{{ emp.name }}</span>
          <span class="emp-role">{{ emp.role }}</span>
        </div>
        <FouButton
          icon="task-line"
          size="small"
          text
          native-type="button"
          aria-label="派活"
          @click="assigning = emp"
        />
      </li>
      <li v-if="!employees.length" class="office-home-empty">暂无员工，点击「添加员工」入职。</li>
    </ul>

    <AddEmployeeDialog :is-open="showAdd" @close="showAdd = false" @saved="refresh" />
    <AssignTaskDialog :open="Boolean(assigning)" :employee="assigning" @close="assigning = null" />
  </aside>
</template>

<style scoped>
.office-home-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-width: 0;
  border-right: 1px solid var(--hairline);
  background: var(--surface-card);
}
.office-home-header {
  padding: 12px 14px 8px;
  border-bottom: 1px solid var(--hairline);
}
.office-home-title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}
.office-home-meta {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--text-secondary);
}
.office-home-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--hairline);
}
.office-home-loading,
.office-home-empty {
  padding: 16px 14px;
  font-size: 13px;
  color: var(--text-secondary);
}
.office-home-list {
  list-style: none;
  margin: 0;
  padding: 6px 0;
  overflow-y: auto;
  flex: 1;
}
.office-home-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
}
.office-home-row:hover {
  background: var(--surface-hover, rgba(255, 255, 255, 0.04));
}
.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
  background: var(--text-tertiary, #888);
}
.status-dot.status-idle {
  background: #6b7280;
}
.status-dot.status-working {
  background: #22c55e;
}
.status-dot.status-meeting {
  background: #f59e0b;
}
.status-dot.status-away {
  background: #94a3b8;
}
.office-home-row-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.emp-name {
  font-size: 13px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.emp-role {
  font-size: 11px;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
