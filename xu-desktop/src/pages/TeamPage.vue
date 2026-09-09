<script setup lang="ts">
/**
 * @author qiuye <yjk150@qq.com>
 */
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { FouButton } from "foucui";
import { useRoute, useRouter } from "vue-router";
import RolePackCatalogBanner from "../components/RolePackCatalogBanner.vue";
import PageHelpButton from "../components/help/PageHelpButton.vue";
import BatchHireDialog from "../components/BatchHireDialog.vue";
import AssignTaskDialog from "../components/AssignTaskDialog.vue";
import AddEmployeeDialog from "../components/AddEmployeeDialog.vue";
import {
  employeeBoundarySummary,
  loadEmployees,
  readEmployees,
  removeEmployee,
  type Employee,
} from "../utils/employees";
import { canUseInputDrive, readDriveSettings } from "../utils/driveSettings";
import { runReviewerConfirmAssist } from "../utils/reviewerAssist";
import { getAgencyRole } from "../office/agencyRoles";

const router = useRouter();
const route = useRoute();
const employees = ref<Employee[]>(readEmployees());
const showAdd = ref(false);
const showBatch = ref(false);
const editing = ref<Employee | null>(null);
const assigning = ref<Employee | null>(null);
const driveOk = ref(canUseInputDrive());
const reviewing = ref(false);
const hireRoleHint = ref<string | null>(null);
const preferredRoleId = ref<string | null>(null);
const tableHost = ref<HTMLElement | null>(null);
const tableHeight = ref(420);
const page = ref(1);
const pageSize = ref(20);

const STATUS_ZH: Record<string, string> = {
  idle: "空闲",
  working: "工作中",
  meeting: "会议",
  away: "离开",
};

const BRAIN_ZH: Record<string, string> = {
  command: "指挥脑",
  work: "工作脑",
  code: "代码脑",
};

type TeamRow = Employee & {
  genderLabel: string;
  statusLabel: string;
  roleLabel: string;
  deskLabel: string;
  brainLabel: string;
  seqNo?: number;
};

const tableRows = computed<TeamRow[]>(() =>
  employees.value.map((emp) => {
    const agency = getAgencyRole(emp.agentRoleId);
    return {
      ...emp,
      genderLabel: emp.gender === "female" ? "女" : "男",
      statusLabel: STATUS_ZH[emp.status] || emp.status,
      roleLabel: agency ? `${emp.role} · ${agency.nameZh || agency.name}` : emp.role,
      deskLabel: emp.deskIndex == null ? "未分配" : `工位 ${emp.deskIndex + 1}`,
      brainLabel: `${BRAIN_ZH[emp.brainSlot] || emp.brainSlot} · ${emp.driveMode}`,
    };
  }),
);

const totalCount = computed(() => tableRows.value.length);
const totalPages = computed(() => Math.max(1, Math.ceil(totalCount.value / pageSize.value)));
const pageRows = computed(() => {
  const start = (page.value - 1) * pageSize.value;
  return tableRows.value.slice(start, start + pageSize.value).map((row, i) => ({
    ...row,
    seqNo: start + i + 1,
  }));
});

function onPageChange(p: number) {
  page.value = p;
}

function onSizeChange(size: number) {
  pageSize.value = size;
  page.value = 1;
}

function syncTableHeight() {
  const el = tableHost.value;
  if (!el) return;
  tableHeight.value = Math.max(240, el.clientHeight - 48);
}

async function refresh() {
  try {
    employees.value = await loadEmployees();
  } catch {
    employees.value = readEmployees();
  }
  driveOk.value = canUseInputDrive(readDriveSettings());
}

async function remove(id: string) {
  if (!window.confirm("确定移除该员工？")) return;
  await removeEmployee(id);
  await refresh();
}

async function assistConfirm() {
  if (reviewing.value) return;
  reviewing.value = true;
  try {
    const result = await runReviewerConfirmAssist();
    if (result.phase === "error") {
      window.alert(result.message);
      return;
    }
    await router.push("/office");
  } finally {
    reviewing.value = false;
  }
}

function openAdd() {
  editing.value = null;
  showAdd.value = true;
}

function applyHireQuery() {
  const id = typeof route.query.hire === "string" ? route.query.hire : "";
  if (!id) return;
  const role = getAgencyRole(id);
  preferredRoleId.value = id;
  hireRoleHint.value = role ? `${role.nameZh || role.name}` : id;
  openAdd();
  void router.replace({ path: "/team", query: {} });
}

let resizeObserver: ResizeObserver | null = null;

onMounted(() => {
  void refresh();
  applyHireQuery();
  window.addEventListener("xu-employees-changed", refresh);
  window.addEventListener("xu-drive-settings", refresh);
  resizeObserver = new ResizeObserver(() => syncTableHeight());
  if (tableHost.value) resizeObserver.observe(tableHost.value);
  window.addEventListener("resize", syncTableHeight);
  syncTableHeight();
});

watch(
  () => route.query.hire,
  () => applyHireQuery(),
);

watch(pageSize, () => {
  page.value = 1;
});

watch(totalPages, (tp) => {
  if (page.value > tp) page.value = tp;
});

onUnmounted(() => {
  window.removeEventListener("xu-employees-changed", refresh);
  window.removeEventListener("xu-drive-settings", refresh);
  window.removeEventListener("resize", syncTableHeight);
  resizeObserver?.disconnect();
});
</script>

<template>
  <div class="vue-page team-page">
    <header class="vue-page-header">
      <div>
        <h1 class="ui-font">AI 团队</h1>
        <p class="ui-font muted">花名册表格 · 虚拟人设 · 工作区边界 · 派活</p>
      </div>
      <div class="team-header-actions">
        <PageHelpButton topic="team.overview" label="帮助" />
        <FouButton icon="checkbox-circle-line" :disabled="reviewing" @click="assistConfirm">
          {{ reviewing ? "代确认中…" : "代点确认" }}
        </FouButton>
        <FouButton icon="user-star-line" @click="router.push('/agency')">岗位库</FouButton>
        <FouButton icon="group-line" @click="showBatch = true">批量入职</FouButton>
        <FouButton type="primary" icon="user-add-line" @click="openAdd">添加员工</FouButton>
      </div>
    </header>

    <RolePackCatalogBanner />

    <p v-if="hireRoleHint" class="team-hire-hint ui-font">已选岗位：{{ hireRoleHint }}，请在弹窗确认并保存。</p>

    <div ref="tableHost" class="team-table-host">
      <FouTable
        :data="pageRows"
        :height="tableHeight"
        row-key="id"
        border
        stripe
        size="small"
        empty-text="还没有员工。添加时请设置可写工作区，否则无法派活。"
      >
        <FouTableColumn prop="seqNo" label="序号" width="64" align="center" />
        <FouTableColumn prop="employeeNo" label="工号" width="88" sortable />
        <FouTableColumn prop="name" label="姓名" width="100" sortable />
        <FouTableColumn prop="age" label="年龄" width="72" align="center" sortable />
        <FouTableColumn prop="genderLabel" label="性别" width="72" align="center" sortable />
        <FouTableColumn prop="roleLabel" label="岗位" min-width="160" sortable />
        <FouTableColumn prop="deskLabel" label="工位" width="100" sortable />
        <FouTableColumn prop="statusLabel" label="状态" width="88" sortable />
        <FouTableColumn prop="brainLabel" label="脑槽/驾驶" width="140" />
        <FouTableColumn label="工作区" min-width="180">
          <template #default="{ row }">
            <span :class="{ 'team-warn': row.driveMode === 'input_control' && !driveOk }">
              {{ employeeBoundarySummary(row) }}
            </span>
          </template>
        </FouTableColumn>
        <FouTableColumn label="操作" width="248" fixed="right" align="center">
          <template #default="{ row }">
            <FouButton icon="send-plane-line" size="small" @click="assigning = row">派活</FouButton>
            <FouButton
              icon="edit-line"
              size="small"
              @click="
                editing = row;
                showAdd = true;
              "
            >
              编辑
            </FouButton>
            <FouButton icon="delete-bin-line" size="small" type="danger" @click="remove(row.id)">
              移除
            </FouButton>
          </template>
        </FouTableColumn>
      </FouTable>
      <footer class="team-pager">
        <FouPagination
          :total="totalCount"
          :current-page="page"
          :page-size="pageSize"
          :page-sizes="[10, 20, 50, 100]"
          :pager-count="7"
          layout="total, sizes, prev, pager, next, jumper"
          background
          small
          @current-change="onPageChange"
          @update:current-page="onPageChange"
          @size-change="onSizeChange"
          @update:page-size="onSizeChange"
        />
      </footer>
    </div>

    <AddEmployeeDialog
      :is-open="showAdd"
      :employee="editing"
      :preferred-role-id="preferredRoleId"
      @close="
        showAdd = false;
        editing = null;
        preferredRoleId = null;
        hireRoleHint = null;
      "
      @saved="
        showAdd = false;
        editing = null;
        preferredRoleId = null;
        hireRoleHint = null;
        refresh();
      "
      @batch="
        showAdd = false;
        showBatch = true;
      "
    />
    <BatchHireDialog
      :is-open="showBatch"
      @close="showBatch = false"
      @done="
        showBatch = false;
        refresh();
      "
    />
    <AssignTaskDialog :open="Boolean(assigning)" :employee="assigning" @close="assigning = null" />
  </div>
</template>

<style scoped>
.team-page {
  height: 100%;
  padding: 20px 24px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-sizing: border-box;
}
.vue-page-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  flex-shrink: 0;
  margin-bottom: 12px;
}
.team-header-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: flex-end;
}
.muted {
  color: var(--muted, #888);
  font-size: 13px;
  margin: 4px 0 0;
}
.team-hire-hint {
  margin: 0 0 10px;
  padding: 8px 12px;
  border-radius: 8px;
  background: var(--surface-2, rgba(127, 127, 127, 0.08));
  flex-shrink: 0;
}
.team-table-host {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.team-pager {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-shrink: 0;
  padding: 8px 4px 2px;
}
.team-warn {
  color: var(--warning, #c45c34);
}
</style>
