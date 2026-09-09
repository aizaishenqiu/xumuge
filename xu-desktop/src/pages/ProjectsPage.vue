<script setup lang="ts">
/**
 * @file 项目列表：左侧行业 FouTree + 右侧表格
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-20
 * @updated 2026-09-05
 * @version 1.1.0
 * @category UI
 * @algo industry-subtree-filter
 */
import { computed, defineAsyncComponent, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { FouButton, FouCheckbox } from "foucui";
import PageHelpButton from "../components/help/PageHelpButton.vue";
import {
  deleteProjects,
  formatProjectTime,
  genderLabel,
  genderTagClass,
  industryName,
  isProjectIncomplete,
  loadProjects,
  PROJECT_TYPE_LABEL,
  resolveProjectEmployees,
  WORKFLOW_STATE_LABEL,
  type XuProject,
} from "../utils/projects";
import {
  ALL_INDUSTRY_ID,
  buildProjectIndustryTree,
  industryFilterIds,
} from "../project/industryNav";
import { INDUSTRY_LABEL, type IndustryId } from "../project/industryProfiles";
import { loadEmployees, readEmployees, type Employee } from "../utils/employees";
import { generateProjectOffice, promptRunProjectAfterSave } from "../utils/projectKickoff";
import {
  clearProjectQueue,
  enqueueProjects,
  loadProjectQueue,
  moveQueueItem,
  removeFromQueue,
  saveProjectQueue,
  type ProjectQueueState,
} from "../utils/projectQueue";
import { startQueuedProject } from "../utils/projectQueueRunner";
import { toUserError } from "../utils/userFacingError";

const ProjectBatchCreateDialog = defineAsyncComponent(
  () => import("../components/ProjectBatchCreateDialog.vue"),
);

/** Lazy: keep ~4MB agency catalog off the projects list critical path */
const ProjectFormDialog = defineAsyncComponent(() => import("../components/ProjectFormDialog.vue"));
const ProjectDetailDialog = defineAsyncComponent(() => import("../components/ProjectDetailDialog.vue"));

const router = useRouter();
const projects = ref<XuProject[]>([]);
const employees = ref<Employee[]>([]);
const loading = ref(false);
const query = ref("");
const activeIndustryId = ref<string>(ALL_INDUSTRY_ID);
const industryTreeRef = ref<{ setCurrentKey?: (key: string | number) => void } | null>(null);
const selectedKeys = ref<string[]>([]);
const showForm = ref(false);
const showDetail = ref(false);
const editing = ref<XuProject | null>(null);
const detailProject = ref<XuProject | null>(null);
const tableHeight = ref(320);
const tableHost = ref<HTMLElement | null>(null);
const busyGen = ref(false);
const showBatchCreate = ref(false);
const queueState = ref<ProjectQueueState>({
  enabled: false,
  mode: "sequential",
  orderedProjectIds: [],
  currentProjectId: null,
  autoAdvance: true,
});
const queueBusy = ref(false);
const page = ref(1);
const pageSize = ref(15);
/** Avoid remount/flash while nested dialogs create employees */
const overlayOpen = computed(() => showForm.value || showDetail.value);

type Row = XuProject & {
  typeLabel: string;
  industryLabel: string;
  employeeCount: number;
  employees: Employee[];
  employeeSummary: string;
  progressPct: number;
  createdLabel: string;
  updatedLabel: string;
};

const industryCounts = computed(() => {
  const m = new Map<string, number>();
  for (const p of projects.value) {
    m.set(p.industryId, (m.get(p.industryId) || 0) + 1);
  }
  return m;
});

const industryTree = computed(() =>
  buildProjectIndustryTree(industryCounts.value, projects.value.length),
);

async function syncIndustryTreeCurrent() {
  await nextTick();
  industryTreeRef.value?.setCurrentKey?.(activeIndustryId.value);
}

function onIndustryNodeClick(data: { id?: string | number }) {
  activeIndustryId.value = String(data?.id ?? ALL_INDUSTRY_ID);
  void syncIndustryTreeCurrent();
}

const industryFilterSet = computed(() =>
  industryFilterIds(industryTree.value, activeIndustryId.value),
);

const preferredIndustryId = computed(() => {
  const id = activeIndustryId.value;
  if (id === ALL_INDUSTRY_ID) return null;
  return id in INDUSTRY_LABEL ? (id as IndustryId) : null;
});

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase();
  const allow = industryFilterSet.value;
  return projects.value.filter((p) => {
    if (allow && !allow.has(p.industryId)) {
      return false;
    }
    if (!q) return true;
    const ind = industryName(p.industryId).toLowerCase();
    return (
      p.name.toLowerCase().includes(q) ||
      PROJECT_TYPE_LABEL[p.type].toLowerCase().includes(q) ||
      ind.includes(q) ||
      p.docPath.toLowerCase().includes(q) ||
      p.generatePath.toLowerCase().includes(q)
    );
  });
});

const rows = computed<Row[]>(() =>
  filtered.value.map((p) => {
    const emps = resolveProjectEmployees(p, employees.value);
    return {
      ...p,
      typeLabel: PROJECT_TYPE_LABEL[p.type],
      industryLabel: industryName(p.industryId),
      employeeCount: emps.length,
      employees: emps,
      employeeSummary: emps.map((e) => e.name).join("、") || "—",
      progressPct: p.deliveryProgress?.overallPercent ?? 0,
      createdLabel: formatProjectTime(p.createdAt),
      updatedLabel: formatProjectTime(p.updatedAt),
    };
  }),
);

const totalPages = computed(() => Math.max(1, Math.ceil(rows.value.length / pageSize.value)));
const pageRows = computed(() => {
  const start = (page.value - 1) * pageSize.value;
  return rows.value.slice(start, start + pageSize.value);
});

type QueueRow = {
  id: string;
  order: number;
  name: string;
  industryLabel: string;
  statusLabel: string;
  isCurrent: boolean;
};

const queueRows = computed((): QueueRow[] => {
  const q = queueState.value;
  return q.orderedProjectIds.map((id, idx) => {
    const p = projects.value.find((x) => x.id === id);
    let statusLabel = "—";
    if (p?.type === "software") {
      statusLabel = p.workflow?.state
        ? WORKFLOW_STATE_LABEL[p.workflow.state] || p.workflow.state
        : "待开工";
    } else if (p) {
      statusLabel = isProjectIncomplete(p) ? "进行中" : "已完成";
    }
    return {
      id,
      order: idx + 1,
      name: p?.name || id,
      industryLabel: p ? industryName(p.industryId) : "—",
      statusLabel,
      isCurrent: q.currentProjectId === id,
    };
  });
});

async function refreshQueue() {
  queueState.value = await loadProjectQueue();
}

async function toggleQueueEnabled(v: boolean) {
  queueState.value = await saveProjectQueue({ enabled: v });
}

async function toggleQueueAutoAdvance(v: boolean) {
  queueState.value = await saveProjectQueue({ autoAdvance: v });
}

async function enqueueSelectedToQueue() {
  const ids = selectedKeys.value.length
    ? selectedKeys.value
    : filtered.value.filter(isProjectIncomplete).map((p) => p.id);
  if (!ids.length) {
    window.alert("请勾选未完成项目，或筛选后有可入队项目");
    return;
  }
  queueBusy.value = true;
  try {
    queueState.value = await enqueueProjects(ids);
  } finally {
    queueBusy.value = false;
  }
}

async function clearQueue() {
  if (!window.confirm("清空项目队列？")) return;
  queueState.value = await clearProjectQueue();
}

async function queueMove(id: string, dir: -1 | 1) {
  queueState.value = await moveQueueItem(id, dir);
}

async function queueRemove(id: string) {
  queueState.value = await removeFromQueue(id);
}

async function startCurrentInQueue() {
  const id = queueState.value.currentProjectId;
  if (!id) return;
  const p = projects.value.find((x) => x.id === id);
  if (!p) return;
  queueBusy.value = true;
  try {
    await startQueuedProject(p);
    await router.push("/office");
  } catch (e) {
    window.alert(toUserError(e));
  } finally {
    queueBusy.value = false;
  }
}

async function onBatchCreated() {
  await refresh({ quiet: true });
  await refreshQueue();
}

watch(overlayOpen, async (open) => {
  if (!open) {
    await nextTick();
    measureTable();
  }
});

watch([filtered, pageSize], () => {
  page.value = 1;
});

watch(totalPages, (tp) => {
  if (page.value > tp) page.value = tp;
});

watch(industryTree, () => {
  void syncIndustryTreeCurrent();
});

let refreshing = false;
let refreshQueued = false;

/** Default quiet (no「加载中」overlay). Pass `{ quiet: false }` for 查询/刷新/首次进入. */
async function refresh(opts?: { quiet?: boolean }) {
  const showSpinner = opts?.quiet === false;
  if (refreshing) {
    refreshQueued = true;
    return;
  }
  refreshing = true;
  if (showSpinner) loading.value = true;
  try {
    employees.value = await loadEmployees().catch(() => readEmployees());
    projects.value = await loadProjects();
    await refreshQueue();
  } finally {
    refreshing = false;
    if (showSpinner) loading.value = false;
    await nextTick();
    measureTable();
    if (refreshQueued) {
      refreshQueued = false;
      void refresh({ quiet: true });
    }
  }
}

function measureTable() {
  if (overlayOpen.value) return;
  const el = tableHost.value;
  if (!el) return;
  // Reserve space for custom pager bar (~44px) so pagination stays visible
  const next = Math.max(200, el.clientHeight - 48);
  if (Math.abs(next - tableHeight.value) < 6) return;
  tableHeight.value = next;
}

function onResize() {
  measureTable();
}

function openAdd() {
  editing.value = null;
  showForm.value = true;
}

function openEdit(row: XuProject) {
  editing.value = row;
  showForm.value = true;
}

function openDetail(row: XuProject) {
  detailProject.value = row;
  showDetail.value = true;
}

async function onSaved(project: XuProject) {
  const wasNew = !editing.value;
  showForm.value = false;
  editing.value = null;
  await refresh({ quiet: true });
  if (wasNew) {
    await promptRunProjectAfterSave(project, router);
  }
}

async function onDetailSaved() {
  showDetail.value = false;
  detailProject.value = null;
  await refresh({ quiet: true });
}

async function removeOne(row: XuProject) {
  if (!window.confirm(`删除项目「${row.name}」？`)) return;
  await deleteProjects([row.id]);
  selectedKeys.value = selectedKeys.value.filter((id) => id !== row.id);
  await refresh();
}

async function removeSelected() {
  if (!selectedKeys.value.length) {
    window.alert("请先勾选要删除的项目");
    return;
  }
  if (!window.confirm(`批量删除 ${selectedKeys.value.length} 个项目？`)) return;
  await deleteProjects(selectedKeys.value);
  selectedKeys.value = [];
  await refresh();
}

function onCheckChange(payload: { records?: XuProject[]; rows?: XuProject[] } | XuProject[]) {
  const list = Array.isArray(payload)
    ? payload
    : payload?.records || payload?.rows || [];
  selectedKeys.value = list.map((r) => r.id);
}

function onPageChange(p: number) {
  page.value = p;
}

function onSizeChange(size: number) {
  pageSize.value = size;
  page.value = 1;
}

function prevPage() {
  page.value = Math.max(1, page.value - 1);
}

function nextPage() {
  page.value = Math.min(totalPages.value, page.value + 1);
}

let refreshTimer: number | null = null;

function onExternalRefresh() {
  if (overlayOpen.value || busyGen.value) return;
  if (refreshTimer != null) window.clearTimeout(refreshTimer);
  refreshTimer = window.setTimeout(() => {
    refreshTimer = null;
    void refresh({ quiet: true });
    void refreshQueue();
  }, 280);
}

async function generateOffice(project: XuProject) {
  if (busyGen.value) return;
  busyGen.value = true;
  try {
    await generateProjectOffice(project, employees.value);
    await router.push("/office");
  } catch (e) {
    window.alert(`生成失败：${toUserError(e)}`);
  } finally {
    busyGen.value = false;
  }
}

async function generateSelected() {
  const id = selectedKeys.value[0] || filtered.value[0]?.id;
  const p = projects.value.find((x) => x.id === id);
  if (!p) {
    window.alert("请先选择一个项目");
    return;
  }
  if (!window.confirm(`为「${p.name}」一键生成三开间办公室（左老板 / 中员工 / 右茶水）？`)) return;
  await generateOffice(p);
}

function resetQuery() {
  query.value = "";
  activeIndustryId.value = ALL_INDUSTRY_ID;
  void syncIndustryTreeCurrent();
}

onMounted(async () => {
  await refresh({ quiet: false });
  void syncIndustryTreeCurrent();
  window.addEventListener("resize", onResize);
  window.addEventListener("xu-projects-changed", onExternalRefresh);
  window.addEventListener("xu-employees-changed", onExternalRefresh);
  window.addEventListener("xu-project-queue-changed", onExternalRefresh);
});

onUnmounted(() => {
  window.removeEventListener("resize", onResize);
  window.removeEventListener("xu-projects-changed", onExternalRefresh);
  window.removeEventListener("xu-employees-changed", onExternalRefresh);
  window.removeEventListener("xu-project-queue-changed", onExternalRefresh);
});
</script>

<template>
  <div class="projects-page">
    <aside class="projects-cat">
      <div class="projects-cat-tree">
        <FouTree
          ref="industryTreeRef"
          class="projects-industry-tree ui-font"
          :data="industryTree"
          node-key="id"
          :props="{ label: 'label', children: 'children' }"
          default-expand-all
          highlight-current
          :expand-on-click-node="false"
          @node-click="onIndustryNodeClick"
        />
      </div>
    </aside>

    <section class="projects-main">
      <header class="projects-toolbar">
        <div class="projects-search-row">
          <FouInput v-model="query" class="projects-search" placeholder="项目名称 / 分类 / 路径" clearable />
          <FouButton
            icon="search-line"
            type="primary"
            native-type="button"
            @click="refresh({ quiet: false })"
          >
            查询
          </FouButton>
          <FouButton
            icon="refresh-line"
            native-type="button"
            @click="resetQuery(); refresh({ quiet: false })"
          >
            重置
          </FouButton>
        </div>
        <PageHelpButton topic="projects.overview" label="帮助" />
        <FouButton icon="add-line" type="primary" native-type="button" @click="openAdd">
          新增项目
        </FouButton>
        <FouButton icon="stack-line" native-type="button" @click="showBatchCreate = true">
          批量预设
        </FouButton>
        <FouButton icon="delete-bin-line" type="danger" native-type="button" @click="removeSelected">
          批量删除
        </FouButton>
        <FouButton
          icon="building-4-line"
          type="primary"
          native-type="button"
          :disabled="busyGen"
          @click="generateSelected"
        >
          {{ busyGen ? "生成中…" : "一键生成办公室" }}
        </FouButton>
        <FouButton icon="refresh-line" native-type="button" @click="refresh({ quiet: false })">
          刷新
        </FouButton>
      </header>

      <section class="projects-queue ui-font">
        <div class="projects-queue-head">
          <strong>项目队列（严格顺序）</strong>
          <PageHelpButton topic="projects.queue" label="说明" />
          <FouCheckbox
            :model-value="queueState.enabled"
            @update:model-value="(v: boolean) => toggleQueueEnabled(Boolean(v))"
          >
            启用队列
          </FouCheckbox>
          <FouCheckbox
            :model-value="queueState.autoAdvance"
            :disabled="!queueState.enabled"
            @update:model-value="(v: boolean) => toggleQueueAutoAdvance(Boolean(v))"
          >
            结项后自动下一项
          </FouCheckbox>
          <FouButton
            icon="play-line"
            size="small"
            type="primary"
            native-type="button"
            :disabled="!queueState.currentProjectId || queueBusy"
            @click="startCurrentInQueue"
          >
            开工当前项
          </FouButton>
          <FouButton
            icon="add-circle-line"
            size="small"
            native-type="button"
            :disabled="queueBusy"
            @click="enqueueSelectedToQueue"
          >
            加入队列
          </FouButton>
          <FouButton
            icon="delete-bin-line"
            size="small"
            type="danger"
            native-type="button"
            :disabled="!queueRows.length"
            @click="clearQueue"
          >
            清空
          </FouButton>
        </div>
        <FouTable
          v-if="queueRows.length"
          :data="queueRows"
          row-key="id"
          border
          stripe
          size="small"
          empty-text="队列为空"
        >
          <FouTableColumn prop="order" label="顺序" width="64" align="center" />
          <FouTableColumn prop="name" label="项目" min-width="120" />
          <FouTableColumn prop="industryLabel" label="行业" width="100" />
          <FouTableColumn label="状态" width="120">
            <template #default="{ row }">
              <span v-if="row.isCurrent" class="queue-current">当前 · </span>{{ row.statusLabel }}
            </template>
          </FouTableColumn>
          <FouTableColumn label="操作" width="200" align="center">
            <template #default="{ row }">
              <FouButton
                icon="arrow-up-line"
                size="small"
                text
                native-type="button"
                @click="queueMove(row.id, -1)"
              />
              <FouButton
                icon="arrow-down-line"
                size="small"
                text
                native-type="button"
                @click="queueMove(row.id, 1)"
              />
              <FouButton
                icon="close-line"
                size="small"
                text
                type="danger"
                native-type="button"
                @click="queueRemove(row.id)"
              />
            </template>
          </FouTableColumn>
        </FouTable>
        <p v-else class="projects-queue-empty">暂无队列项。勾选项目点「加入队列」，或使用「批量预设」。</p>
      </section>

      <div ref="tableHost" class="projects-table-host">
        <FouTable
          :data="pageRows"
          :height="tableHeight"
          :loading="loading"
          row-key="id"
          border
          stripe
          show-index
          show-selection
          size="small"
          empty-text="暂无项目，点击「新增项目」开始"
          @checkbox-change="onCheckChange"
        >
          <FouTableColumn prop="name" label="项目名称" min-width="120" sortable />
          <FouTableColumn prop="industryLabel" label="行业" width="110" sortable />
          <FouTableColumn prop="typeLabel" label="类型" width="96" sortable />
          <FouTableColumn prop="employeeCount" label="人数" width="72" align="center" sortable />
          <FouTableColumn prop="progressPct" label="进度" width="120" align="center" sortable>
            <template #default="{ row }">
              <div class="proj-progress" :title="`${row.progressPct}%`">
                <div class="proj-progress-track">
                  <div class="proj-progress-fill" :style="{ width: `${row.progressPct}%` }" />
                </div>
                <span>{{ row.progressPct }}%</span>
              </div>
            </template>
          </FouTableColumn>
          <FouTableColumn label="员工列表" min-width="160">
            <template #default="{ row }">
              <div class="proj-emp-list" :title="row.employeeSummary">
                <span v-for="e in row.employees.slice(0, 4)" :key="e.id" class="proj-emp-cell">
                  <span :class="genderTagClass(e.gender)">{{ genderLabel(e.gender) }}</span>
                  {{ e.name }}
                </span>
                <span v-if="row.employees.length > 4" class="proj-emp-more">+{{ row.employees.length - 4 }}</span>
                <span v-if="!row.employees?.length">—</span>
              </div>
            </template>
          </FouTableColumn>
          <FouTableColumn prop="docPath" label="文档路径" min-width="120" />
          <FouTableColumn prop="generatePath" label="生成路径" min-width="120" />
          <FouTableColumn prop="createdLabel" label="创建时间" width="138" sortable />
          <FouTableColumn prop="updatedLabel" label="修改时间" width="138" sortable />
          <FouTableColumn label="操作" width="240" fixed="right" align="center">
            <template #default="{ row }">
              <div class="proj-ops">
                <FouButton
                  icon="file-info-line"
                  size="small"
                  text
                  type="primary"
                  native-type="button"
                  @click="openDetail(row)"
                >
                  详情
                </FouButton>
                <FouButton
                  icon="edit-line"
                  size="small"
                  text
                  type="primary"
                  native-type="button"
                  @click="openEdit(row)"
                >
                  编辑
                </FouButton>
                <FouButton
                  icon="building-4-line"
                  size="small"
                  text
                  type="primary"
                  native-type="button"
                  :disabled="busyGen"
                  @click="generateOffice(row)"
                >
                  生成
                </FouButton>
                <FouButton
                  icon="delete-bin-line"
                  size="small"
                  text
                  type="danger"
                  native-type="button"
                  @click="removeOne(row)"
                >
                  删除
                </FouButton>
              </div>
            </template>
          </FouTableColumn>
        </FouTable>
        <footer class="projects-pager">
          <FouPagination
            :total="rows.length"
            :current-page="page"
            :page-size="pageSize"
            :page-sizes="[10, 15, 20, 50]"
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
    </section>

    <ProjectFormDialog
      :open="showForm"
      :project="editing"
      :preferred-industry-id="preferredIndustryId"
      @close="showForm = false; editing = null"
      @saved="onSaved"
    />
    <ProjectDetailDialog
      :open="showDetail"
      :project="detailProject"
      @close="showDetail = false; detailProject = null"
      @saved="onDetailSaved"
    />
    <ProjectBatchCreateDialog v-model:visible="showBatchCreate" @created="onBatchCreated" />
  </div>
</template>

<style scoped>
.projects-page {
  height: 100%;
  max-height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: row;
  gap: 12px;
  padding: 12px 14px;
  box-sizing: border-box;
  overflow: hidden;
  background: var(--canvas, #f5f6f8);
}
.projects-cat {
  width: 220px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
  padding: 10px;
  border: 1px solid var(--hairline, #e5e7eb);
  border-radius: 8px;
  background: var(--surface-card, #fff);
  overflow: hidden;
}
.projects-cat-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  flex-shrink: 0;
}
.projects-cat-tree {
  flex: 1;
  min-height: 0;
  overflow: auto;
}
.projects-industry-tree :deep(.fou-tree) {
  background: transparent;
  font-size: 12.5px;
}
.projects-main {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  overflow: hidden;
}
.projects-queue {
  flex-shrink: 0;
  margin: 0 4px;
  padding: 10px 12px;
  border: 1px solid var(--hairline, #e5e7eb);
  border-radius: 8px;
  background: var(--surface-card, #fff);
}
.projects-queue-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.projects-queue-empty {
  margin: 0;
  font-size: 12px;
  opacity: 0.75;
}
.queue-current {
  color: var(--primary, #2563eb);
  font-weight: 600;
}
.projects-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
.projects-search-row {
  display: inline-flex;
  flex-wrap: nowrap;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
.projects-search {
  width: min(220px, 36vw);
  flex-shrink: 0;
}
.projects-table-host {
  flex: 1;
  min-height: 0;
  min-width: 0;
  background: var(--surface-card, #fff);
  border: 1px solid var(--hairline, #e5e7eb);
  border-radius: 8px;
  padding: 6px;
  overflow: hidden;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
}
.projects-pager {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-shrink: 0;
  padding: 8px 4px 2px;
}
.proj-ops {
  display: inline-flex;
  flex-wrap: nowrap;
  gap: 0;
  justify-content: center;
}
.proj-emp-list {
  display: flex;
  flex-wrap: nowrap;
  gap: 6px;
  align-items: center;
  overflow: hidden;
  max-width: 100%;
}
.proj-progress {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
}
.proj-progress-track {
  flex: 1;
  height: 6px;
  border-radius: 999px;
  background: #e5e7eb;
  overflow: hidden;
  min-width: 48px;
}
.proj-progress-fill {
  height: 100%;
  background: #2563eb;
}
.proj-emp-cell {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 12px;
  white-space: nowrap;
}
.proj-emp-more {
  font-size: 12px;
  color: var(--muted);
  flex-shrink: 0;
}
</style>

<style>
.gender-tag {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 16px;
  padding: 0 4px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 600;
  line-height: 1;
  border: 1px solid transparent;
}
.gender-tag--m {
  color: #1d4ed8;
  background: #eff6ff;
  border-color: #bfdbfe;
}
.gender-tag--f {
  color: #be185d;
  background: #fdf2f8;
  border-color: #fbcfe8;
}
.projects-page .fou-table,
.projects-page .fou-table__main {
  max-width: 100%;
}
</style>
