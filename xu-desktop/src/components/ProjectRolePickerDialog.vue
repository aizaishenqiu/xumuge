<script setup lang="ts">
import { onApiCatch } from "../utils/userFacingError";
/**
 * 项目/专家岗位选择弹窗：支持多选勾选，按行业/岗位筛选与分页。
 *
 * @author qiuye <yjk150@qq.com>
 */
import { computed, ref, watch } from "vue";
import { FouButton, fouMsg } from "foucui";
import {
  BRAIN_SLOT_ZH,
  ROLE_KIND_ZH,
  ensureAgencyCatalog,
  listAgencyRoles,
  reloadAgencyCatalog,
  searchAgencyRoles,
  type AgencyRole,
} from "../office/agencyRoles";
import AgencyTaxonomyTree from "./AgencyTaxonomyTree.vue";

const taxonomyTab = ref<"industry" | "position">("industry");
const filterId = ref("all");

const props = defineProps<{
  open: boolean;
  selectedRoleIds?: string[];
  singleSelect?: boolean;
}>();

const emit = defineEmits<{
  close: [];
  pick: [role: AgencyRole];
  unpick: [roleId: string];
}>();

function onDialogClose() {
  emit("close");
}

const query = ref("");
const page = ref(1);
const pageSize = ref(12);
const tableHeight = 400;
const reloading = ref(false);

const allRoles = computed(() => listAgencyRoles());

const filtered = computed(() => {
  let list = query.value.trim() ? searchAgencyRoles(query.value) : allRoles.value;
  if (filterId.value !== "all") {
    if (taxonomyTab.value === "industry") {
      list = list.filter((r) => r.industryId === filterId.value);
    } else {
      list = list.filter((r) => r.positionCategory === filterId.value);
    }
  }
  return list;
});

const total = computed(() => filtered.value.length);

const pageRows = computed(() => {
  const start = (page.value - 1) * pageSize.value;
  return filtered.value.slice(start, start + pageSize.value).map((r) => ({
    ...r,
    kindLabel: ROLE_KIND_ZH[r.roleKind] || r.roleKind,
    slotLabel: BRAIN_SLOT_ZH[r.brainSlot] || r.brainSlot,
    divisionLabel: `${r.industryZh || "—"} · ${r.positionCategoryZh || "—"}`,
    positionLabel: r.positionZh || r.nameZh,
  }));
});

const selectedSet = computed(() => new Set(props.selectedRoleIds || []));

const dialogTitle = computed(() =>
  props.singleSelect ? "选择岗位专家" : "选择角色（加入项目员工）",
);

watch(
  () => props.open,
  (o) => {
    if (o) {
      query.value = "";
      filterId.value = "all";
      taxonomyTab.value = "industry";
      page.value = 1;
      if (listAgencyRoles().length === 0) {
        void reloadCatalog();
      } else {
        void ensureAgencyCatalog();
      }
    }
  },
);

async function reloadCatalog() {
  if (reloading.value) return;
  reloading.value = true;
  try {
    const n = await reloadAgencyCatalog();
    fouMsg.success(`已加载 ${n} 个岗位`);
  } catch (e) {
    void onApiCatch(e);
  } finally {
    reloading.value = false;
  }
}

watch([query, filterId, taxonomyTab], () => {
  page.value = 1;
});

watch([total, pageSize], () => {
  const max = Math.max(1, Math.ceil(total.value / pageSize.value));
  if (page.value > max) page.value = max;
});

function isPicked(id: string) {
  return selectedSet.value.has(id);
}

function onTableSelectionChange(
  payload: { records?: AgencyRole[]; rows?: AgencyRole[]; checked?: boolean } | AgencyRole[],
) {
  const list = Array.isArray(payload) ? payload : payload?.records || payload?.rows || [];

  if (props.singleSelect) {
    const last = list[list.length - 1];
    for (const id of props.selectedRoleIds || []) {
      if (!last || id !== last.id) emit("unpick", id);
    }
    if (last && !isPicked(last.id)) emit("pick", last);
    return;
  }

  const pageIds = new Set(pageRows.value.map((r) => r.id));
  const checkedOnPage = new Set(list.map((r) => r.id));
  const offPageIds = (props.selectedRoleIds || []).filter((id) => !pageIds.has(id));
  const desired = new Set([
    ...offPageIds,
    ...[...checkedOnPage].filter((id) => pageIds.has(id)),
  ]);

  for (const id of desired) {
    if (!isPicked(id)) {
      const role =
        filtered.value.find((r) => r.id === id) ?? pageRows.value.find((r) => r.id === id);
      if (role) emit("pick", role);
    }
  }
  for (const id of props.selectedRoleIds || []) {
    if (!desired.has(id)) emit("unpick", id);
  }
}

/** 表格 key：仅随分页/筛选变化 remount，勿绑 selectedRoleIds（否则每勾选一个就重建表格） */
const tableSyncKey = computed(
  () => `rp-${page.value}-${pageSize.value}-${filterId.value}-${taxonomyTab.value}-${query.value.trim()}`,
);

function resetFilter() {
  query.value = "";
  filterId.value = "all";
  page.value = 1;
}

function switchTaxonomyTab(tab: "industry" | "position") {
  taxonomyTab.value = tab;
  filterId.value = "all";
  page.value = 1;
}

function onPageChange(p: number) {
  page.value = p;
}

function onSizeChange(size: number) {
  pageSize.value = size;
  page.value = 1;
}
</script>

<template>
  <FouDialog
    v-if="open"
    :model-value="true"
    class="role-picker-fou-dialog"
    :title="dialogTitle"
    width="1120px"
    append-to-body
    :z-index="25000"
    @update:model-value="(v: boolean) => { if (!v) onDialogClose(); }"
    @close="onDialogClose"
  >
    <div class="rp-body">
      <header class="rp-toolbar">
        <div class="rp-search-row">
          <FouInput
            v-model="query"
            class="rp-search"
            placeholder="搜索角色名称 / 部门 / 描述"
            clearable
          />
          <FouButton icon="search-line" type="primary" native-type="button" @click="page = 1">
            查询
          </FouButton>
          <FouButton icon="refresh-line" native-type="button" @click="resetFilter">
            重置
          </FouButton>
        </div>
        <span class="rp-hint">
          勾选即可多选 · 已选 {{ selectedRoleIds?.length || 0 }}
        </span>
      </header>

      <div class="rp-main">
        <aside class="rp-tree-panel">
          <div class="rp-tax-tabs">
            <FouButton
              icon="building-line"
              size="small"
              native-type="button"
              :type="taxonomyTab === 'industry' ? 'primary' : 'default'"
              @click="switchTaxonomyTab('industry')"
            >
              按行业
            </FouButton>
            <FouButton
              icon="briefcase-line"
              size="small"
              native-type="button"
              :type="taxonomyTab === 'position' ? 'primary' : 'default'"
              @click="switchTaxonomyTab('position')"
            >
              按岗位
            </FouButton>
          </div>
          <AgencyTaxonomyTree v-model="filterId" :mode="taxonomyTab" />
        </aside>

        <div class="rp-table-wrap">
          <div v-if="total === 0 && !reloading" class="rp-empty ui-font">
            <p>岗位库为空。若刚更新 zh-virmoon 源，请先同步并重建开发包，再点重新加载。</p>
            <FouButton
              icon="refresh-line"
              type="primary"
              native-type="button"
              :loading="reloading"
              @click="reloadCatalog"
            >
              重新加载岗位包
            </FouButton>
          </div>
          <FouTable
            :key="tableSyncKey"
            class="rp-table"
            :data="pageRows"
            :height="tableHeight"
            row-key="id"
            border
            stripe
            size="small"
            empty-text="无匹配角色"
            show-selection
            :row-class-name="({ row }: { row: { id: string } }) => (isPicked(row.id) ? 'rp-row-picked' : '')"
            @checkbox-change="onTableSelectionChange"
            @checkbox-all="onTableSelectionChange"
          >
            <FouTableColumn prop="nameZh" label="角色" width="140" />
            <FouTableColumn prop="divisionLabel" label="行业·岗位类" width="140" />
            <FouTableColumn prop="positionLabel" label="岗位" width="120" />
            <FouTableColumn prop="kindLabel" label="职级" width="88" />
            <FouTableColumn prop="slotLabel" label="任务脑" width="88" />
            <FouTableColumn prop="description" label="说明" width="360" />
          </FouTable>
          <footer class="rp-pager">
            <FouPagination
              :total="total"
              :current-page="page"
              :page-size="pageSize"
              :page-sizes="[10, 12, 20, 50]"
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
      </div>
    </div>

    <template #footer>
      <FouButton icon="check-line" type="primary" native-type="button" @click="emit('close')">
        完成
      </FouButton>
    </template>
  </FouDialog>
</template>

<style scoped>
.rp-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
  max-height: min(72vh, 680px);
}
.rp-toolbar {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}
.rp-search-row {
  display: inline-flex;
  flex-wrap: nowrap;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
.rp-search {
  width: 320px !important;
}
.rp-search-row :deep(.fou-input),
.rp-search-row :deep(.fou-input__wrapper) {
  width: 320px;
}
.rp-hint {
  font-size: 12px;
  color: var(--muted, #667085);
  margin-left: auto;
  white-space: nowrap;
}
.rp-main {
  flex: 1;
  min-height: 0;
  display: flex;
  gap: 12px;
  overflow: hidden;
}
.rp-tree-panel {
  width: 220px;
  flex-shrink: 0;
  overflow: auto;
  border: 1px solid var(--hairline, #e5e7eb);
  border-radius: 8px;
  padding: 8px 6px;
  background: var(--surface-soft, #f7f8fa);
}
.rp-tax-tabs {
  display: flex;
  gap: 6px;
  margin-bottom: 8px;
}
.rp-tax-tabs :deep(.fou-button) {
  flex: 1;
}
.rp-table-wrap {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.rp-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  min-height: 240px;
  padding: 16px;
  text-align: center;
  color: var(--ink-muted, #6b7280);
  font-size: 13px;
}
.rp-table-wrap :deep(.fou-table),
.rp-table-wrap :deep(.fou-table__main) {
  min-width: 0;
  max-width: 100%;
}
.rp-table-wrap :deep(.fou-table__header-wrap) {
  overflow: hidden !important;
}
.rp-table-wrap :deep(.fou-table__inner),
.rp-table-wrap :deep(.fou-table__body-table),
.rp-table-wrap :deep(.fou-table__header-table) {
  table-layout: auto !important;
  width: max-content !important;
  min-width: 100%;
}
.rp-pager {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-shrink: 0;
  padding: 8px 4px 2px;
}
</style>

<style>
.role-picker-fou-dialog.fou-dialog {
  max-width: min(1120px, 96vw);
}
.role-picker-fou-dialog .rp-row-picked > td,
.role-picker-fou-dialog tr.rp-row-picked td {
  background: rgba(15, 118, 110, 0.14) !important;
}
[data-theme="ink"] .role-picker-fou-dialog .rp-row-picked > td,
[data-theme="ink"] .role-picker-fou-dialog tr.rp-row-picked td {
  background: color-mix(in srgb, var(--primary) 32%, var(--surface-card)) !important;
  color: var(--body-strong) !important;
}
[data-theme="ink"] .role-picker-fou-dialog .fou-table__body tr:hover > td {
  background: color-mix(in srgb, var(--primary) 12%, var(--surface-soft)) !important;
}
[data-theme="ink"] .role-picker-fou-dialog .fou-pagination,
[data-theme="ink"] .role-picker-fou-dialog .fou-pagination * {
  color: var(--body) !important;
}
[data-theme="ink"] .role-picker-fou-dialog .fou-pagination .fou-pager li,
[data-theme="ink"] .role-picker-fou-dialog .fou-pagination button,
[data-theme="ink"] .role-picker-fou-dialog .fou-pagination .fou-select__selected {
  background: var(--surface-card) !important;
  border-color: var(--hairline) !important;
  color: var(--body-strong) !important;
}
[data-theme="ink"] .role-picker-fou-dialog .fou-pagination .fou-pager li.is-active {
  background: var(--primary) !important;
  color: #fff !important;
  border-color: var(--primary) !important;
}
[data-theme="ink"] .role-picker-fou-dialog .fou-pagination .fou-select__dropdown {
  background: var(--surface-card) !important;
  border-color: var(--hairline) !important;
}
</style>
