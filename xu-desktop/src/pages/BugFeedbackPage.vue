<script setup lang="ts">
/**
 * @file 问题反馈：栏目选择 + 云端上报（本机草稿缓存）
 * @author qiuye <yjk150@qq.com>
 * @date 2026-09-01
 * @updated 2026-09-04
 * @version 1.5.1
 * @category Layout
 * @algo none
 */
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import {
  FouButton,
  FouCheckbox,
  FouDialog,
  FouInput,
  FouPagination,
  FouSelect,
  FouTable,
  fouAlert,
  fouConfirmPromise,
  fouMsg,
} from "foucui";
import PageHelpButton from "../components/help/PageHelpButton.vue";
import XuReqEditor from "../components/XuReqEditor.vue";
import {
  BUG_SECTIONS,
  BUG_SEVERITIES,
  BUG_STATUSES,
  bugSectionLabel,
  bugSeverityLabel,
  bugStatusLabel,
  isBugProcessed,
  type BugReportStatus,
  type BugSectionId,
  type BugSeverity,
} from "../utils/bugReportCatalog";
import {
  deleteBugReport,
  hydrateBugHtmlForEditor,
  hydrateBugHtmlForView,
  listBugReports,
  normalizeBugHtmlForStorage,
  repairLocalBugHtmlAssets,
  saveBugReport,
  updateBugReportStatus,
  uploadBugImageForEditor,
  writeBugReportsMarkdownFile,
  type BugReport,
} from "../utils/bugReports";
import { sanitizeUserMessage } from "../utils/userFacingError";

const loading = ref(false);
const saving = ref(false);
const rows = ref<BugReport[]>([]);
const query = ref("");
const sectionFilter = ref<string>("all");
const statusFilter = ref<string>("all");
const tableHeight = ref(420);
const tableHost = ref<HTMLElement | null>(null);
const page = ref(1);
const pageSize = ref(20);
let resizeObs: ResizeObserver | null = null;

const dialogOpen = ref(false);
const editingId = ref<string | null>(null);
const formSection = ref<BugSectionId>("other");
const formTitle = ref("");
const formSeverity = ref<BugSeverity>("major");
const formHtml = ref("<p></p>");
const editorKey = ref(0);

const detailOpen = ref(false);
const detailTitle = ref("");
const detailMeta = ref("");
const detailHtml = ref("");
const detailLoading = ref(false);

const exportOpen = ref(false);
const exportBusy = ref(false);
/** 表格勾选（跨页保留） */
const tableSelectedIds = ref<string[]>([]);

const pageAllSelected = computed(() => {
  const ids = pageRows.value.map((r) => r.id);
  return ids.length > 0 && ids.every((id) => tableSelectedIds.value.includes(id));
});

const pageSomeSelected = computed(() => {
  const ids = pageRows.value.map((r) => r.id);
  if (!ids.length) return false;
  const n = ids.filter((id) => tableSelectedIds.value.includes(id)).length;
  return n > 0 && n < ids.length;
});

const sectionFilterOptions = computed(() => [
  { label: "全部栏目", value: "all" },
  ...BUG_SECTIONS.map((s) => ({ label: s.label, value: s.id })),
]);

const statusFilterOptions = computed(() => [
  { label: "全部状态", value: "all" },
  ...BUG_STATUSES.map((s) => ({ label: s.label, value: s.id })),
]);

const filteredRows = computed(() => {
  const q = query.value.trim().toLowerCase();
  return rows.value.filter((r) => {
    if (sectionFilter.value !== "all" && r.sectionId !== sectionFilter.value) return false;
    if (statusFilter.value !== "all" && r.status !== statusFilter.value) return false;
    if (!q) return true;
    const blob = `${r.title} ${bugSectionLabel(r.sectionId)} ${htmlSnippet(r.html)}`.toLowerCase();
    return blob.includes(q);
  });
});

const tableRows = computed(() =>
  filteredRows.value.map((r) => ({
    ...r,
    sectionLabel: bugSectionLabel(r.sectionId),
    severityLabel: bugSeverityLabel(r.severity),
    statusLabel: bugStatusLabel(r.status),
    createdLabel: formatTs(r.createdAt),
    updatedLabel: formatTs(r.updatedAt),
    synced: Boolean(r.cloudId),
    canEdit: !r.cloudId || r.status === "open",
    canLocalStatus: !r.cloudId,
  })),
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
  page.value = Math.min(Math.max(1, Number(p) || 1), totalPages.value);
}

function onSizeChange(size: number) {
  pageSize.value = size;
  page.value = 1;
}

watch([query, sectionFilter, statusFilter], () => {
  page.value = 1;
});

watch(pageSize, () => {
  page.value = 1;
});

function formatTs(raw: string): string {
  const n = Number(raw);
  if (Number.isFinite(n) && n > 1e11) {
    try {
      return new Date(n).toLocaleString("zh-CN");
    } catch {
      /* fallthrough */
    }
  }
  const d = Date.parse(raw);
  if (!Number.isNaN(d)) {
    try {
      return new Date(d).toLocaleString("zh-CN");
    } catch {
      /* fallthrough */
    }
  }
  return raw || "—";
}

function htmlSnippet(html: string): string {
  const tmp = document.createElement("div");
  tmp.innerHTML = html || "";
  return (tmp.textContent || "").slice(0, 80);
}

async function refresh() {
  loading.value = true;
  try {
    rows.value = await listBugReports();
    const alive = new Set(rows.value.map((r) => r.id));
    tableSelectedIds.value = tableSelectedIds.value.filter((id) => alive.has(id));
  } catch (e) {
    void fouAlert(sanitizeUserMessage(e, "加载反馈列表失败"), "问题反馈");
  } finally {
    loading.value = false;
  }
}

function measureTable() {
  const el = tableHost.value;
  if (!el) return;
  // 预留下方分页条高度
  tableHeight.value = Math.max(240, Math.floor(el.clientHeight) - 48);
}

async function openCreate() {
  editingId.value = null;
  formSection.value = "other";
  formTitle.value = "";
  formSeverity.value = "major";
  formHtml.value = "<p></p>";
  editorKey.value += 1;
  dialogOpen.value = true;
}

async function openEdit(row: BugReport) {
  if (row.cloudId && row.status !== "open") {
    void fouAlert("已同步的反馈请到官网管理端改状态；仅未处理可在本机编辑。", "问题反馈");
    return;
  }
  editingId.value = row.id;
  formSection.value = (row.sectionId as BugSectionId) || "other";
  formTitle.value = row.title;
  formSeverity.value = (row.severity as BugSeverity) || "major";
  try {
    formHtml.value = await hydrateBugHtmlForEditor(row.html || "<p></p>");
  } catch (e) {
    formHtml.value = row.html || "<p></p>";
    void fouAlert(sanitizeUserMessage(e, "正文图片未能加载，仍可编辑文字"), "问题反馈");
  }
  editorKey.value += 1;
  dialogOpen.value = true;
}

async function openDetail(row: BugReport) {
  detailLoading.value = true;
  detailOpen.value = true;
  detailTitle.value = row.title || "（无标题）";
  detailMeta.value = [
    bugSectionLabel(row.sectionId),
    bugSeverityLabel(row.severity),
    bugStatusLabel(row.status),
    formatTs(row.updatedAt),
    row.cloudId ? "已同步" : "仅本机",
  ].join(" · ");
  const raw = row.html || "<p></p>";
  // 先放原文，避免 hydrate 期间整页空白
  detailHtml.value = raw;
  try {
    const hydrated = await hydrateBugHtmlForView(raw);
    detailHtml.value = looksEmptyBugHtml(hydrated) ? "<p>（暂无正文）</p>" : hydrated;
    void repairLocalBugHtmlAssets(row)
      .then((fixed) => {
        if (!fixed) return;
        const i = rows.value.findIndex((r) => r.id === row.id);
        if (i >= 0) rows.value[i] = { ...rows.value[i]!, html: fixed.html };
      })
      .catch(() => undefined);
  } catch (e) {
    detailHtml.value = looksEmptyBugHtml(raw) ? "<p>（暂无正文）</p>" : raw;
    void fouAlert(sanitizeUserMessage(e, "正文图片未能完整加载"), "问题反馈");
  } finally {
    detailLoading.value = false;
  }
}

function looksEmptyBugHtml(html: string): boolean {
  const s = String(html || "")
    .replace(/<img\b[^>]*>/gi, "IMG")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .trim();
  return !s;
}

async function onUploadImage(file: File): Promise<string> {
  try {
    return await uploadBugImageForEditor(file);
  } catch (e) {
    void fouAlert(sanitizeUserMessage(e, "截图未能加入正文"), "问题反馈");
    throw e;
  }
}

async function submitForm() {
  if (!formSection.value) {
    void fouAlert("请选择出问题的栏目", "问题反馈");
    return;
  }
  if (!formTitle.value.trim()) {
    void fouAlert("请填写标题", "问题反馈");
    return;
  }
  saving.value = true;
  try {
    const existing = editingId.value
      ? rows.value.find((r) => r.id === editingId.value)
      : undefined;
    const saved = await saveBugReport({
      id: editingId.value,
      sectionId: formSection.value,
      title: formTitle.value.trim(),
      severity: formSeverity.value,
      html: normalizeBugHtmlForStorage(formHtml.value || "<p></p>"),
      status: existing?.status ?? "open",
      cloudId: existing?.cloudId ?? null,
      syncedAt: existing?.syncedAt ?? null,
    });
    dialogOpen.value = false;
    if (saved.cloudId) {
      fouMsg.success(editingId.value ? "已更新并同步" : "已上报");
    } else {
      fouMsg.success("已存本机草稿");
      void fouAlert("请先登录账号后再保存，反馈才会同步。", "问题反馈");
    }
    await refresh();
  } catch (e) {
    void fouAlert(sanitizeUserMessage(e, "保存失败"), "问题反馈");
  } finally {
    saving.value = false;
  }
}

async function setStatus(row: BugReport, status: BugReportStatus) {
  if (row.cloudId) {
    void fouAlert("已同步条目的状态请到官网管理端修改。", "问题反馈");
    return;
  }
  try {
    await updateBugReportStatus(row.id, status);
    fouMsg.success(`已标为${bugStatusLabel(status)}`);
    await refresh();
  } catch (e) {
    void fouAlert(sanitizeUserMessage(e, "更新状态失败"), "问题反馈");
  }
}

async function removeRow(row: BugReport) {
  const decision = await fouConfirmPromise(
    `确定删除「${row.title}」？`,
    "删除反馈",
  );
  if (decision !== "confirm") return;
  try {
    await deleteBugReport(row.id);
    fouMsg.success("已删除");
    await refresh();
  } catch (e) {
    void fouAlert(sanitizeUserMessage(e, "删除失败"), "问题反馈");
  }
}

async function exportMarkdown() {
  if (!rows.value.length) {
    void fouAlert("当前没有可导出的反馈。", "问题反馈");
    return;
  }
  if (tableSelectedIds.value.length > 0) {
    const pool = rows.value.filter((r) => tableSelectedIds.value.includes(r.id));
    if (!pool.length) {
      void fouAlert("勾选的反馈已不存在，请刷新后重试。", "问题反馈");
      return;
    }
    await runExport(pool, "导出所选反馈");
    return;
  }
  exportOpen.value = true;
}

function toggleRowSelected(id: string, on: boolean) {
  const set = new Set(tableSelectedIds.value);
  if (on) set.add(id);
  else set.delete(id);
  tableSelectedIds.value = [...set];
}

function togglePageSelectAll(on: boolean) {
  const pageIds = pageRows.value.map((r) => r.id);
  const set = new Set(tableSelectedIds.value);
  if (on) {
    for (const id of pageIds) set.add(id);
  } else {
    for (const id of pageIds) set.delete(id);
  }
  tableSelectedIds.value = [...set];
}

async function exportCurrentPage() {
  const ids = new Set(pageRows.value.map((r) => r.id));
  const pool = rows.value.filter((r) => ids.has(r.id));
  if (!pool.length) {
    void fouAlert("当前页没有可导出的反馈。", "问题反馈");
    return;
  }
  await runExport(pool, "导出本页反馈");
}

async function exportAllRows() {
  if (!rows.value.length) {
    void fouAlert("当前没有可导出的反馈。", "问题反馈");
    return;
  }
  await runExport(rows.value.slice(), "导出全部反馈");
}

async function runExport(pool: BugReport[], dialogTitle: string) {
  exportBusy.value = true;
  try {
    const path = await saveDialog({
      title: dialogTitle,
      defaultPath: `virmoor-bugs-${new Date().toISOString().slice(0, 10)}.md`,
      filters: [{ name: "Markdown", extensions: ["md"] }],
    });
    if (!path) return;
    await writeBugReportsMarkdownFile(path, pool);
    exportOpen.value = false;
    fouMsg.success(`已导出 ${pool.length} 条`);
  } catch (e) {
    void fouAlert(sanitizeUserMessage(e, "导出失败"), "问题反馈");
  } finally {
    exportBusy.value = false;
  }
}

watch(dialogOpen, (open) => {
  // 关闭时不必重建；打开时由 openCreate/openEdit 自行 bump editorKey
  if (!open) {
    formHtml.value = "<p></p>";
  }
});

onMounted(() => {
  void refresh();
  void nextTick(() => {
    measureTable();
    if (tableHost.value && typeof ResizeObserver !== "undefined") {
      resizeObs = new ResizeObserver(() => measureTable());
      resizeObs.observe(tableHost.value);
    }
  });
});

onUnmounted(() => {
  resizeObs?.disconnect();
  resizeObs = null;
});
</script>

<template>
  <div class="bug-feedback-page ui-font">
    <header class="bug-toolbar">
      <FouInput
        v-model="query"
        class="bug-search"
        clearable
        placeholder="搜索标题 / 栏目 / 正文"
      />
      <FouSelect
        class="bug-filter"
        fit
        :model-value="sectionFilter"
        :options="sectionFilterOptions"
        @update:model-value="(v: string) => (sectionFilter = String(v))"
      />
      <FouSelect
        class="bug-filter"
        fit
        :model-value="statusFilter"
        :options="statusFilterOptions"
        @update:model-value="(v: string) => (statusFilter = String(v))"
      />
      <FouButton icon="search-line" type="primary" native-type="button" @click="refresh">
        查询
      </FouButton>
      <FouButton icon="refresh-line" native-type="button" @click="refresh">刷新</FouButton>
      <span class="bug-toolbar-sep" aria-hidden="true" />
      <FouButton icon="add-line" type="primary" native-type="button" @click="openCreate">
        新建反馈
      </FouButton>
      <FouButton icon="download-2-line" native-type="button" @click="exportMarkdown">
        导出
      </FouButton>
      <PageHelpButton topic="settings.bug-feedback" label="帮助" size="small" />
    </header>

    <div ref="tableHost" class="bug-table-host">
      <FouTable
        :data="pageRows"
        :height="tableHeight"
        :loading="loading"
        row-key="id"
        border
        stripe
        size="small"
        empty-text="暂无反馈。点「新建反馈」选择栏目并粘贴截图。"
      >
        <FouTableColumn width="48" align="center">
          <template #header>
            <FouCheckbox
              :model-value="pageAllSelected"
              :indeterminate="pageSomeSelected"
              aria-label="全选本页"
              @update:model-value="(v: boolean) => togglePageSelectAll(Boolean(v))"
            />
          </template>
          <template #default="{ row }">
            <FouCheckbox
              :model-value="tableSelectedIds.includes(row.id)"
              :aria-label="`选择 ${row.title || '反馈'}`"
              @update:model-value="(v: boolean) => toggleRowSelected(row.id, Boolean(v))"
            />
          </template>
        </FouTableColumn>
        <FouTableColumn prop="seqNo" label="序号" width="64" align="center" />
        <FouTableColumn prop="sectionLabel" label="栏目" width="140" sortable />
        <FouTableColumn prop="title" label="标题" min-width="160" show-overflow-tooltip sortable />
        <FouTableColumn prop="severityLabel" label="严重度" width="100" sortable />
        <FouTableColumn prop="statusLabel" label="状态" width="96" sortable />
        <FouTableColumn label="同步" width="72" align="center">
          <template #default="{ row }">
            <span>{{ row.synced ? "已同步" : "仅本机" }}</span>
          </template>
        </FouTableColumn>
        <FouTableColumn prop="updatedLabel" label="更新" width="150" sortable />
        <FouTableColumn label="操作" width="280" fixed="right" align="center">
          <template #default="{ row }">
            <div class="bug-row-actions">
              <FouButton
                icon="article-line"
                size="small"
                text
                native-type="button"
                @click="openDetail(row)"
              >
                详情
              </FouButton>
              <FouButton
                v-if="row.canEdit"
                icon="edit-line"
                size="small"
                text
                native-type="button"
                @click="openEdit(row)"
              >
                编辑
              </FouButton>
              <FouButton
                v-if="row.canLocalStatus && !isBugProcessed(row.status)"
                icon="checkbox-circle-line"
                size="small"
                text
                native-type="button"
                @click="setStatus(row, 'triaged')"
              >
                标记已处理
              </FouButton>
              <FouButton
                icon="delete-bin-line"
                size="small"
                text
                type="danger"
                native-type="button"
                @click="removeRow(row)"
              >
                删除
              </FouButton>
            </div>
          </template>
        </FouTableColumn>
      </FouTable>
      <footer class="bug-pager">
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

    <FouDialog
      v-model="dialogOpen"
      :title="editingId ? '编辑反馈' : '新建反馈'"
      width="720px"
      append-to-body
      destroy-on-close
    >
      <div class="bug-form">
        <p class="bug-form-hint">先点选出问题的栏目，再用编辑器粘贴截图与说明。</p>
        <div class="bug-field">
          <span class="bug-label">栏目</span>
          <div class="bug-section-grid">
            <FouButton
              v-for="s in BUG_SECTIONS"
              :key="s.id"
              :icon="s.icon"
              size="small"
              native-type="button"
              :type="formSection === s.id ? 'primary' : 'default'"
              @click="formSection = s.id"
            >
              {{ s.label }}
            </FouButton>
          </div>
        </div>
        <div class="bug-field">
          <span class="bug-label">标题</span>
          <FouInput v-model="formTitle" maxlength="120" placeholder="一句话概括问题" />
        </div>
        <div class="bug-field">
          <span class="bug-label">严重度</span>
          <div class="bug-severity-row">
            <FouButton
              v-for="s in BUG_SEVERITIES"
              :key="s.id"
              :icon="s.icon"
              size="small"
              native-type="button"
              :type="formSeverity === s.id ? 'primary' : 'default'"
              @click="formSeverity = s.id"
            >
              {{ s.label }}
            </FouButton>
          </div>
        </div>
        <div class="bug-field">
          <span class="bug-label">描述与截图</span>
          <XuReqEditor
            :key="editorKey"
            v-model="formHtml"
            placeholder="粘贴截图，说明复现步骤与期望结果…"
            :upload-image="onUploadImage"
          />
        </div>
      </div>
      <template #footer>
        <FouButton icon="close-line" native-type="button" @click="dialogOpen = false">
          取消
        </FouButton>
        <FouButton
          icon="save-line"
          type="primary"
          native-type="button"
          :loading="saving"
          :disabled="saving"
          @click="submitForm"
        >
          保存
        </FouButton>
      </template>
    </FouDialog>

    <FouDialog
      v-model="detailOpen"
      title="反馈详情"
      width="720px"
      append-to-body
      destroy-on-close
    >
      <article class="bug-detail">
        <p v-if="detailLoading" class="bug-detail-meta">加载中…</p>
        <template v-else>
          <h2 class="bug-detail-title">{{ detailTitle }}</h2>
          <p class="bug-detail-meta">{{ detailMeta }}</p>
          <div class="bug-detail-body" v-html="detailHtml" />
        </template>
      </article>
      <template #footer>
        <FouButton icon="close-line" native-type="button" @click="detailOpen = false">
          关闭
        </FouButton>
      </template>
    </FouDialog>

    <FouDialog
      v-model="exportOpen"
      title="导出反馈"
      width="420px"
      append-to-body
      destroy-on-close
    >
      <div class="bug-export">
        <p class="bug-export-hint">
          当前未勾选任何反馈。请选择导出本页（{{ pageRows.length }} 条）或全部数据（{{ rows.length }} 条）。
        </p>
        <div class="bug-export-modes">
          <FouButton
            icon="file-list-line"
            type="primary"
            native-type="button"
            :loading="exportBusy"
            :disabled="exportBusy || !pageRows.length"
            @click="exportCurrentPage"
          >
            导出本页（{{ pageRows.length }}）
          </FouButton>
          <FouButton
            icon="database-2-line"
            native-type="button"
            :loading="exportBusy"
            :disabled="exportBusy || !rows.length"
            @click="exportAllRows"
          >
            导出全部（{{ rows.length }}）
          </FouButton>
        </div>
      </div>
      <template #footer>
        <FouButton icon="close-line" native-type="button" @click="exportOpen = false">
          取消
        </FouButton>
      </template>
    </FouDialog>
  </div>
</template>

<style scoped>
.bug-feedback-page {
  margin: 20px;
  height: calc(100% - 40px);
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
  box-sizing: border-box;
}
.bug-toolbar {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  justify-content: flex-start;
  gap: 8px;
  overflow-x: auto;
  flex-shrink: 0;
}
.bug-toolbar-sep {
  width: 1px;
  height: 22px;
  margin: 0 4px;
  background: var(--fou-border-color, rgba(0, 0, 0, 0.12));
  flex-shrink: 0;
}
.bug-search {
  /* foucui .fou-input 默认 width:100%!important，须盖过 */
  width: 220px !important;
  max-width: 220px !important;
  min-width: 160px !important;
  flex: 0 0 220px !important;
}
.bug-filter {
  /* 配合 fit；再限上限，避免个别主题仍拉满 */
  width: auto !important;
  max-width: 160px !important;
  min-width: 110px !important;
  flex: 0 0 auto !important;
}
.bug-table-host {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.bug-pager {
  flex-shrink: 0;
  display: flex;
  justify-content: flex-end;
  padding-top: 8px;
}
.bug-table-host :deep(.fou-table),
.bug-table-host :deep(.fou-table__main) {
  height: 100%;
}
.bug-row-actions {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 2px;
  justify-content: center;
}
.bug-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.bug-form-hint {
  margin: 0;
  font-size: 12px;
  color: var(--muted);
}
.bug-field {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.bug-label {
  font-size: 13px;
  color: var(--muted);
}
.bug-section-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.bug-severity-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.bug-detail {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 120px;
}
.bug-detail-title {
  margin: 0;
  font-size: 20px;
  font-weight: 650;
  line-height: 1.35;
}
.bug-detail-meta {
  margin: 0;
  font-size: 12px;
  color: var(--muted);
}
.bug-detail-body {
  font-size: 14px;
  line-height: 1.65;
  color: var(--fou-text-color, inherit);
}
.bug-detail-body :deep(img) {
  max-width: 100%;
  height: auto;
  display: block;
  margin: 10px 0;
  border-radius: 6px;
}
.bug-detail-body :deep(p) {
  margin: 0 0 0.75em;
}
.bug-export {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-height: 80px;
}
.bug-export-hint {
  margin: 0;
  font-size: 13px;
  color: var(--muted);
  line-height: 1.5;
}
.bug-export-modes {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
</style>
