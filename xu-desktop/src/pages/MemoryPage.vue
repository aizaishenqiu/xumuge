<script setup lang="ts">
/**
 * @file 虚募阁记忆库管理页
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-28
 * @updated 2026-09-01
 * @version 1.1.0
 * @category Layout
 * @algo none
 */
import { computed, onMounted, ref, watch } from "vue";
import { FouButton, fouAlert, fouMsg } from "foucui";
import PageHelpButton from "../components/help/PageHelpButton.vue";
import { invoke } from "@tauri-apps/api/core";
import {
  buildMemoryPreamble,
  deleteMemory,
  listMemories,
  memoryCorpusStats,
  upsertMemory,
  type XuMemory,
  type MemoryCorpusStats,
} from "../employee";
import { loadEmployees, type Employee } from "../utils/employees";
import { isOutlineMemory } from "../utils/questionOutlineMemory";
import { toUserError } from "../utils/userFacingError";

const memories = ref<XuMemory[]>([]);
const employees = ref<Employee[]>([]);
const corpus = ref<MemoryCorpusStats | null>(null);
const loading = ref(false);
const filterScope = ref<"all" | "global" | "employee" | "project">("all");
const filterKind = ref<"all" | "outline">("all");
const filterEmployeeId = ref("");
const q = ref("");

const FILTER_SCOPE_OPTIONS = [
  { value: "all", label: "全部" },
  { value: "global", label: "全局" },
  { value: "employee", label: "员工" },
  { value: "project", label: "项目" },
];

const FILTER_KIND_OPTIONS = [
  { value: "all", label: "全部类型" },
  { value: "outline", label: "问题大纲" },
];

const FORM_SCOPE_OPTIONS = [
  { value: "global", label: "全局" },
  { value: "employee", label: "员工" },
  { value: "project", label: "项目" },
];

const filterEmployeeOptions = computed(() => [
  { value: "", label: "全部员工" },
  ...employees.value.map((e) => ({
    value: e.id,
    label: `${e.name} · ${e.role}`,
  })),
]);

const formEmployeeOptions = computed(() =>
  employees.value.map((e) => ({
    value: e.id,
    label: `${e.name} · ${e.role}`,
  })),
);

const editorOpen = ref(false);
const editingId = ref<string | null>(null);
const formScope = ref<"global" | "employee" | "project">("global");
const formScopeId = ref("");
const formTitle = ref("");
const formBody = ref("");
const formPinned = ref(false);
const saving = ref(false);
const formError = ref("");

const preambleOpen = ref(false);
const preambleText = ref("");
const preambleBusy = ref(false);

const filtered = computed(() => {
  const needle = q.value.trim().toLowerCase();
  return memories.value.filter((m) => {
    if (filterScope.value !== "all" && m.scope !== filterScope.value) return false;
    if (filterScope.value === "employee" && filterEmployeeId.value) {
      if ((m.scopeId ?? "") !== filterEmployeeId.value) return false;
    }
    if (filterKind.value === "outline" && !isOutlineMemory(m)) return false;
    if (!needle) return true;
    const hay = `${m.title} ${m.body} ${m.tags}`.toLowerCase();
    return hay.includes(needle);
  });
});

function empName(id: string | null | undefined) {
  if (!id) return "—";
  return employees.value.find((e) => e.id === id)?.name ?? id;
}

function sourceLabel(source: string) {
  if (source === "auto_extract") return "自动摘录";
  if (source === "manual") return "手工录入";
  if (source === "outline") return "问题大纲";
  return source || "—";
}

function scopeLabel(m: XuMemory) {
  if (m.scope === "global") return "全局";
  if (m.scope === "employee") return `员工 · ${empName(m.scopeId)}`;
  if (m.scope === "project") return `项目 · ${m.scopeId || "—"}`;
  return m.scope;
}

async function refresh() {
  loading.value = true;
  try {
    memories.value = await listMemories({ limit: 200 });
    employees.value = await loadEmployees();
    corpus.value = await memoryCorpusStats().catch(() => null);
  } catch (e) {
    void fouAlert(toUserError(e), "记忆库");
  } finally {
    loading.value = false;
  }
}

function openCreate() {
  editingId.value = null;
  formScope.value = filterScope.value === "all" ? "global" : filterScope.value;
  formScopeId.value =
    formScope.value === "employee"
      ? filterEmployeeId.value || employees.value[0]?.id || ""
      : "";
  formTitle.value = "";
  formBody.value = "";
  formPinned.value = false;
  formError.value = "";
  editorOpen.value = true;
}

function openEdit(m: XuMemory) {
  editingId.value = m.id;
  formScope.value = (m.scope as "global" | "employee" | "project") || "global";
  formScopeId.value = m.scopeId ?? "";
  formTitle.value = m.title;
  formBody.value = m.body;
  formPinned.value = m.pinned;
  formError.value = "";
  editorOpen.value = true;
}

watch(formScope, (s) => {
  if (s === "global") formScopeId.value = "";
  if (s === "employee" && !formScopeId.value && employees.value[0]) {
    formScopeId.value = employees.value[0].id;
  }
});

async function save() {
  if (!formBody.value.trim()) {
    formError.value = "请填写记忆正文";
    return;
  }
  if (formScope.value === "employee" && !formScopeId.value.trim()) {
    formError.value = "请选择员工";
    return;
  }
  if (formScope.value === "project" && !formScopeId.value.trim()) {
    formError.value = "请填写项目 ID";
    return;
  }
  saving.value = true;
  formError.value = "";
  try {
    await upsertMemory({
      id: editingId.value ?? undefined,
      scope: formScope.value,
      scopeId: formScope.value === "global" ? null : formScopeId.value.trim(),
      title: formTitle.value.trim(),
      body: formBody.value.trim(),
      pinned: formPinned.value,
      source: editingId.value ? undefined : "manual",
    });
    editorOpen.value = false;
    await refresh();
    fouMsg.success(editingId.value ? "已更新记忆" : "已添加记忆");
  } catch (e) {
    formError.value = toUserError(e);
    void fouAlert(toUserError(e), "保存记忆");
  } finally {
    saving.value = false;
  }
}

async function remove(m: XuMemory) {
  if (!window.confirm(`删除记忆「${m.title || m.id}」？`)) return;
  try {
    await deleteMemory(m.id);
    await refresh();
    fouMsg.success("已删除");
  } catch (e) {
    void fouAlert(toUserError(e), "删除记忆");
  }
}

async function previewPreamble() {
  preambleBusy.value = true;
  preambleText.value = "";
  preambleOpen.value = true;
  try {
    const empId =
      filterScope.value === "employee" && filterEmployeeId.value
        ? filterEmployeeId.value
        : undefined;
    const emp = empId ? employees.value.find((e) => e.id === empId) : undefined;
    preambleText.value =
      (await buildMemoryPreamble({
        employeeId: empId,
        employeeName: emp?.name,
        taskHint: q.value.trim() || undefined,
      })) || "（当前无匹配记忆，派活时不会注入）";
  } catch (e) {
    preambleText.value = toUserError(e);
  } finally {
    preambleBusy.value = false;
  }
}

onMounted(() => {
  void refresh();
});
</script>

<template>
  <div class="vue-page memory-page">
    <header class="vue-page-header">
      <div>
        <h1 class="ui-font">虚募阁记忆</h1>
        <p class="ui-font muted">
          派活前自动注入虚募阁记忆库；实质提问会写入「问题大纲」（用户大脑），本地永久保存直到你删除。
        </p>
      </div>
      <div class="vue-page-actions">
        <PageHelpButton topic="memory.overview" label="帮助" />
        <FouButton icon="refresh-line" native-type="button" :disabled="loading" @click="refresh">
          刷新
        </FouButton>
        <FouButton icon="eye-line" native-type="button" @click="previewPreamble">预览注入</FouButton>
        <FouButton type="primary" icon="add-line" native-type="button" @click="openCreate">
          新建记忆
        </FouButton>
      </div>
    </header>

    <div v-if="corpus" class="corpus-banner ui-font">
      <strong>记忆体容量</strong>
      <span>
        {{ corpus.usedTokens.toLocaleString() }} / {{ corpus.maxTokens.toLocaleString() }} tokens
        · {{ corpus.memoryCount }} 条 · {{ corpus.chunkCount }} 块
        · 单次注入上限 {{ corpus.injectMaxTokens.toLocaleString() }}
      </span>
      <div class="corpus-bar">
        <div
          class="corpus-bar-fill"
          :style="{
            width: `${Math.min(100, (100 * corpus.usedTokens) / Math.max(1, corpus.maxTokens))}%`,
          }"
        />
      </div>
    </div>

    <div class="filters ui-font">
      <label class="filter">
        <span>范围</span>
        <FouSelect v-model="filterScope" :options="FILTER_SCOPE_OPTIONS" />
      </label>
      <label class="filter">
        <span>类型</span>
        <FouSelect v-model="filterKind" :options="FILTER_KIND_OPTIONS" />
      </label>
      <label v-if="filterScope === 'employee'" class="filter">
        <span>员工</span>
        <FouSelect v-model="filterEmployeeId" :options="filterEmployeeOptions" />
      </label>
      <label class="filter grow">
        <span>搜索</span>
        <FouInput v-model="q" placeholder="标题 / 正文 / 标签" clearable />
      </label>
    </div>

    <p v-if="loading && !memories.length" class="empty ui-font">加载中…</p>
    <p v-else-if="!filtered.length" class="empty ui-font">
      暂无记忆。可点击「新建记忆」添加。
    </p>

    <ul v-else class="mem-list">
      <li v-for="m in filtered" :key="m.id" class="mem-card">
        <div class="mem-head">
          <div>
            <strong class="ui-font">{{ m.title || "（无标题）" }}</strong>
            <div class="mem-meta ui-font">
              <span>{{ scopeLabel(m) }}</span>
              <span v-if="m.pinned" class="pin">置顶</span>
              <span class="muted">{{ sourceLabel(m.source) }}</span>
            </div>
          </div>
          <div class="mem-actions">
            <FouButton icon="edit-line" size="small" native-type="button" @click="openEdit(m)">
              编辑
            </FouButton>
            <FouButton icon="delete-bin-line" size="small" native-type="button" @click="remove(m)">
              删除
            </FouButton>
          </div>
        </div>
        <p class="mem-body ui-font">{{ m.body }}</p>
      </li>
    </ul>

    <FouDialog
      v-model="editorOpen"
      :title="editingId ? '编辑记忆' : '新建记忆'"
      width="560px"
      append-to-body
      :show-fullscreen="false"
      :show-minimize="false"
      :draggable="false"
      :resizable="false"
      :z-index="20000"
    >
      <label class="field ui-font">
        <span>范围</span>
        <FouSelect v-model="formScope" :options="FORM_SCOPE_OPTIONS" />
      </label>
      <label v-if="formScope === 'employee'" class="field ui-font">
        <span>员工</span>
        <FouSelect v-model="formScopeId" :options="formEmployeeOptions" />
      </label>
      <label v-if="formScope === 'project'" class="field ui-font">
        <span>项目 ID</span>
        <FouInput v-model="formScopeId" placeholder="project id" />
      </label>
      <label class="field ui-font">
        <span>标题</span>
        <FouInput v-model="formTitle" placeholder="可选" />
      </label>
      <label class="field ui-font">
        <span>正文</span>
        <FouInput v-model="formBody" type="textarea" :rows="8" placeholder="Markdown 亦可" />
      </label>
      <label class="field check ui-font">
        <FouCheckbox v-model="formPinned">置顶（优先注入）</FouCheckbox>
      </label>
      <p v-if="formError" class="err">{{ formError }}</p>
      <template #footer>
        <FouButton icon="close-line" native-type="button" @click="editorOpen = false">取消</FouButton>
        <FouButton
          type="primary"
          icon="save-line"
          native-type="button"
          :disabled="saving"
          @click="save"
        >
          {{ saving ? "保存中…" : "保存" }}
        </FouButton>
      </template>
    </FouDialog>

    <FouDialog
      v-model="preambleOpen"
      title="记忆注入预览"
      width="560px"
      append-to-body
      :show-fullscreen="false"
      :show-minimize="false"
      :draggable="false"
      :resizable="false"
      :z-index="20000"
    >
      <p class="hint ui-font">与派活时拼进 system 的文本一致（受 max_chars 截断）。</p>
      <pre class="preamble ui-font">{{ preambleBusy ? "生成中…" : preambleText }}</pre>
      <template #footer>
        <FouButton icon="close-line" native-type="button" @click="preambleOpen = false">关闭</FouButton>
      </template>
    </FouDialog>
  </div>
</template>

<style scoped>
.memory-page {
  padding: 20px 24px 32px;
  overflow: auto;
  height: 100%;
  box-sizing: border-box;
}
.vue-page-header {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: flex-start;
  margin-bottom: 16px;
}
.vue-page-header h1 {
  margin: 0 0 6px;
  font-size: 22px;
}
.muted {
  color: var(--muted, #64748b);
  margin: 0;
  font-size: 13px;
}
.vue-page-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.corpus-banner {
  margin: 0 0 14px;
  padding: 12px 14px;
  border: 1px solid var(--hairline);
  border-radius: var(--radius);
  background: var(--surface-card);
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
}
.corpus-bar {
  height: 6px;
  border-radius: 999px;
  background: var(--surface-soft);
  overflow: hidden;
}
.corpus-bar-fill {
  height: 100%;
  background: var(--primary);
}
.filters {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 16px;
  align-items: flex-end;
}
.filter {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 140px;
  font-size: 12px;
}
.filter.grow {
  flex: 1;
  min-width: 200px;
}
.empty {
  color: var(--muted, #64748b);
  font-size: 13px;
}
.mem-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.mem-card {
  border: 1px solid var(--hairline, rgba(0, 0, 0, 0.1));
  border-radius: 12px;
  padding: 12px 14px;
  background: var(--surface-card, #fff);
}
.mem-head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: flex-start;
}
.mem-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 4px;
  font-size: 11px;
  color: var(--muted, #64748b);
}
.pin {
  color: #b45309;
  font-weight: 600;
}
.mem-actions {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}
.mem-body {
  margin: 10px 0 0;
  font-size: 13px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 160px;
  overflow: auto;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 12px;
  font-size: 13px;
}
.field.check {
  flex-direction: row;
  align-items: center;
}
.err {
  color: #b91c1c;
  font-size: 13px;
}
.hint {
  margin: 0 0 10px;
  font-size: 12px;
  color: var(--muted, #64748b);
}
.preamble {
  margin: 0;
  padding: 12px;
  max-height: 360px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 12px;
  line-height: 1.45;
  background: color-mix(in srgb, var(--surface-card, #f8fafc) 90%, #000 4%);
  border-radius: 8px;
  border: 1px solid var(--hairline, rgba(0, 0, 0, 0.08));
}
</style>
