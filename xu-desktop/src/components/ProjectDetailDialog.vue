<script setup lang="ts">
/**
 * @file 项目详情、开工配置与工作流启动
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-31
 * @version 1.0.1
 * @category UI
 * @algo gated-workflow-dispatch
 */
import { computed, ref, watch, nextTick, onBeforeUnmount } from "vue";
import { useRouter } from "vue-router";
import { FouButton, FouCheckbox } from "foucui";
import * as echarts from "echarts";
import {
  formatProjectTime,
  genderLabel,
  genderTagClass,
  PROJECT_TYPE_LABEL,
  resolveProjectEmployees,
  upsertProject,
  KICKOFF_MODE_LABEL,
  WORKFLOW_STATE_LABEL,
  projectToolPolicyComplete,
  defaultProjectToolPolicy,
  type ProjectKickoffMode,
  workflowBlockReason,
  type XuProject,
  type KickoffPlan,
  type ProjectToolchain,
} from "../utils/projects";
import {
  TOOL_POLICY_LABELS,
  type ProjectToolPolicy,
} from "../utils/projectToolPolicy";
import { softwareCodingSurfaceChosen } from "../utils/codingSurfacePrefs";
import { loadEmployees, readEmployees, type Employee } from "../utils/employees";
import { getAgencyRole } from "../office/agencyRoles";
import { industryPipelineSummary } from "../office/industryWorkflows";
import { openWorkflowStudio } from "../commerce";
import { startPlannerWorkflow } from "../utils/workflowOrchestrator";
import {
  allocateSoftwareKickoff,
  ensureKickoffPlan,
  formatKickoffBrief,
  IDE_OPTIONS,
} from "../utils/softwareKickoff";
import {
  emptyIdeProbe,
  firstInstalledIde,
  idePickerOptions,
  isIdeCliInstalled,
  probeInstalledIdes,
  type IdeProbeResult,
} from "../utils/ideProbe";
import { announceStaffing } from "../utils/projectStaffing";
import { saveProjectTheme, type ProjectTheme } from "../utils/projectTheme";
import { toUserError } from "../utils/userFacingError";
import {
  computeOverallPercent,
  deliveryFromKickoff,
  type DeliveryProgress,
  type DeliveryStepProgress,
  type ProgressStatus,
} from "../utils/projectStack";

const props = defineProps<{
  open: boolean;
  project: XuProject | null;
}>();

const emit = defineEmits<{
  close: [];
  saved: [project: XuProject];
}>();

const router = useRouter();

const dialogOpen = computed({
  get: () => props.open,
  set: (v: boolean) => {
    if (!v) emit("close");
  },
});

const employees = ref<Employee[]>([]);
const notes = ref<Record<string, string>>({});
const plan = ref<KickoffPlan | null>(null);
const progress = ref<DeliveryProgress | null>(null);
const customDraft = ref("");
const saving = ref(false);
const starting = ref(false);
const error = ref("");
const kickoffMode = ref<ProjectKickoffMode>("phased");
const queueCompleteOnUat = ref(false);
const codeEditorSurface = ref<"builtin" | "external">("builtin");
const toolchainIde = ref<ProjectToolchain["ide"]>("cursor");
const ideProbe = ref<IdeProbeResult>(emptyIdeProbe());
const toolPolicyDlg = ref(false);
const legacyToolPolicy = ref<ProjectToolPolicy>(defaultProjectToolPolicy());
const legacyToolPolicyAck = ref(false);

const members = computed(() => {
  if (!props.project) return [] as Employee[];
  return resolveProjectEmployees(props.project, employees.value);
});

const ideLabel = computed(() => {
  const surf = codeEditorSurface.value;
  if (surf === "builtin") return "内置 虚募阁 IDE";
  const ide = toolchainIde.value;
  return IDE_OPTIONS.find((o) => o.id === ide)?.label || ide || "本机 IDE";
});

const ideSelectOptions = computed(() => idePickerOptions(ideProbe.value));

const overallPct = computed(() => progress.value?.overallPercent ?? 0);

const deliverChartEl = ref<HTMLElement | null>(null);
let deliverChart: echarts.ECharts | null = null;

function renderDeliverChart() {
  if (!deliverChartEl.value || !progress.value?.steps?.length) return;
  const counts = { pending: 0, doing: 0, done: 0, blocked: 0 };
  for (const s of progress.value.steps) {
    const st = s.status;
    if (st === "doing" || st === "done" || st === "blocked") counts[st] += 1;
    else counts.pending += 1;
  }
  if (!deliverChart) deliverChart = echarts.init(deliverChartEl.value);
  deliverChart.setOption({
    color: ["#94a3b8", "#38bdf8", "#22c55e", "#f59e0b"],
    tooltip: { trigger: "axis" },
    grid: { left: 40, right: 12, top: 12, bottom: 28 },
    xAxis: {
      type: "category",
      data: ["未做", "进行中", "已完成", "阻塞"],
    },
    yAxis: { type: "value", minInterval: 1 },
    series: [
      {
        type: "bar",
        data: [counts.pending, counts.doing, counts.done, counts.blocked],
        barMaxWidth: 36,
      },
    ],
  });
}

watch(
  () => progress.value?.steps?.map((s) => `${s.id}:${s.status}`).join("|"),
  async () => {
    await nextTick();
    renderDeliverChart();
  },
);

onBeforeUnmount(() => {
  deliverChart?.dispose();
  deliverChart = null;
});

const showIndustryPipeline = computed(() => {
  const t = props.project?.type;
  return t === "software" || t === "delivery" || t === "consulting" || t === "internal";
});

const industryPipeline = computed(() =>
  props.project ? industryPipelineSummary(props.project.type) : "",
);

async function boot() {
  error.value = "";
  saving.value = false;
  starting.value = false;
  customDraft.value = "";
  try {
    employees.value = await loadEmployees();
  } catch {
    employees.value = readEmployees();
  }
  notes.value = { ...(props.project?.employeeNotes || {}) };
  for (const e of members.value) {
    if (notes.value[e.id] == null) notes.value[e.id] = "";
  }
  plan.value = props.project ? ensureKickoffPlan(props.project) : null;
  progress.value =
    props.project?.deliveryProgress?.steps?.length
      ? {
          ...props.project.deliveryProgress,
          steps: props.project.deliveryProgress.steps.map((s) => ({ ...s })),
        }
      : plan.value
        ? deliveryFromKickoff(plan.value)
        : null;
  kickoffMode.value = props.project?.kickoffMode || "phased";
  queueCompleteOnUat.value = props.project?.queueCompleteOnUat === true;
  const surf = props.project?.toolchain?.codeEditorSurface;
  codeEditorSurface.value = surf === "external" ? "external" : "builtin";
  toolchainIde.value = props.project?.toolchain?.ide || "cursor";
  void probeInstalledIdes().then((p) => {
    ideProbe.value = p;
    if (codeEditorSurface.value === "external" && !isIdeCliInstalled(toolchainIde.value, p)) {
      const hit = firstInstalledIde(p);
      if (hit) toolchainIde.value = hit;
    }
  });
  if (props.project && !projectToolPolicyComplete(props.project.toolPolicy)) {
    legacyToolPolicy.value = defaultProjectToolPolicy();
    legacyToolPolicyAck.value = false;
    toolPolicyDlg.value = true;
  }
}

async function saveLegacyToolPolicy() {
  if (!props.project || !legacyToolPolicyAck.value) {
    error.value = "请勾选确认后再保存";
    return;
  }
  saving.value = true;
  try {
    const saved = await upsertProject({
      ...props.project,
      toolPolicy: { ...legacyToolPolicy.value },
    });
    emit("saved", saved);
    toolPolicyDlg.value = false;
  } catch (e) {
    error.value = toUserError(e);
  } finally {
    saving.value = false;
  }
}

watch(
  () => props.open,
  (o) => {
    if (o) void boot();
  },
);

function setStepStatus(step: DeliveryStepProgress, status: ProgressStatus) {
  if (!progress.value) return;
  step.status = status;
  if (status === "done") step.percent = 100;
  else if (status === "pending") step.percent = 0;
  else if (status === "doing" && step.percent < 10) step.percent = 10;
  progress.value = {
    steps: [...progress.value.steps],
    overallPercent: computeOverallPercent(progress.value.steps),
    updatedAt: Date.now(),
  };
}

async function persistNotesAndPlan(): Promise<XuProject | null> {
  if (!props.project || !plan.value) return null;
  return upsertProject({
    id: props.project.id,
    name: props.project.name,
    categoryId: props.project.categoryId,
    industryId: props.project.industryId,
    type: props.project.type,
    employeeIds: [...props.project.employeeIds],
    employeeNotes: { ...notes.value },
    docPath: props.project.docPath,
    generatePath: props.project.generatePath,
    toolchain: props.project.toolchain
      ? {
          ...props.project.toolchain,
          codeEditorSurface: codeEditorSurface.value,
          ide: toolchainIde.value,
        }
      : props.project.type === "software"
        ? {
            ide: toolchainIde.value,
            codeEditorSurface: codeEditorSurface.value,
          }
        : props.project.toolchain,
    kickoffPlan: {
      ...plan.value,
      updatedAt: Date.now(),
    },
    stackProfile: props.project.stackProfile,
    requirements: props.project.requirements,
    deliveryProgress: progress.value,
    kickoffMode: props.project.type === "software" ? kickoffMode.value : null,
    queueCompleteOnUat:
      props.project.type === "software" && kickoffMode.value === "phased"
        ? queueCompleteOnUat.value
        : false,
  });
}

function addCustomRequirement() {
  const text = customDraft.value.trim();
  if (!text || !plan.value) return;
  plan.value = {
    ...plan.value,
    customRequirements: [...plan.value.customRequirements, text],
    updatedAt: Date.now(),
  };
  customDraft.value = "";
}

async function save() {
  if (!props.project) return;
  saving.value = true;
  error.value = "";
  try {
    const saved = await persistNotesAndPlan();
    if (!saved) throw new Error("保存失败");
    if ((progress.value?.overallPercent ?? 0) >= 100) {
      const { notifyProjectMaybeComplete } = await import("../utils/projectQueueRunner");
      void notifyProjectMaybeComplete(saved.id);
    }
    emit("saved", saved);
    emit("close");
  } catch (e) {
    error.value = toUserError(e);
  } finally {
    saving.value = false;
  }
}

async function bossStart() {
  if (!props.project || !plan.value) return;
  if (props.project.type === "software" && !softwareCodingSurfaceChosen({
    ...props.project,
    toolchain: {
      ide: toolchainIde.value,
      codeEditorSurface: codeEditorSurface.value,
    },
  })) {
    error.value = "软件项目请先选择写码表面（内置或本机 IDE）";
    return;
  }
  if (
    props.project.type === "software" &&
    codeEditorSurface.value === "external" &&
    !isIdeCliInstalled(toolchainIde.value, ideProbe.value)
  ) {
    error.value = "本机 IDE 未检测到 CLI，请改选内置虚募阁 IDE 或安装对应编辑器";
    return;
  }
  if (props.project.type === "software" && !props.project.requirements?.playbookPath) {
    error.value = "软件项目缺少 REQUIREMENTS_PLAYBOOK，请先编辑项目并生成操作说明";
    return;
  }
  if (!window.confirm(`下达开始「${props.project.name}」？将按开工清单分配任务并通知团队。`)) {
    return;
  }
  starting.value = true;
  error.value = "";
  try {
    if (progress.value?.steps?.length) {
      const steps = progress.value.steps.map((s, i) =>
        i === 0 ? { ...s, status: "doing" as const, percent: 10 } : s,
      );
      progress.value = {
        steps,
        overallPercent: computeOverallPercent(steps),
        updatedAt: Date.now(),
      };
    }
    const saved = await persistNotesAndPlan();
    if (!saved) throw new Error("保存失败");
    if (saved.type === "software") {
      if ((saved.kickoffMode || "phased") === "strict") {
        void startPlannerWorkflow(saved).catch((e) => {
          console.warn("[workflow] startPlannerWorkflow", e);
        });
        emit("saved", saved);
        emit("close");
        if (window.confirm("已启动瀑布模式（计划→设计→技术方案→开发→Review→UAT）。是否前往办公室？")) {
          await router.push("/office");
        }
        return;
      }
      emit("saved", saved);
      emit("close");
      if (
        window.confirm(
          "已保存敏捷 Scrum。请到办公室点「全体开工」（需求→设计→技术方案→开发→Review→测试）。是否前往办公室？",
        )
      ) {
        await router.push("/office");
      }
      return;
    }
    const emps = resolveProjectEmployees(saved, employees.value);
    const assignments = allocateSoftwareKickoff(saved, employees.value);
    const theme: ProjectTheme = {
      id: saved.id,
      name: saved.name,
      goal: `${saved.name} · 老板下达开工`,
      brief: formatKickoffBrief(saved),
      phase: "build",
      priority: "P0",
      progress: saved.deliveryProgress?.overallPercent ?? 0,
      assignments,
      createdAt: saved.createdAt,
      updatedAt: Date.now(),
      staffingSource: "local",
      runtimeStatus: "running",
      lastStartedAt: Date.now(),
    };
    await saveProjectTheme(theme);
    await announceStaffing(theme, emps, { dispatchTasks: true });
    emit("saved", saved);
    emit("close");
    if (window.confirm("已下达开始。是否前往办公室查看？")) {
      await router.push("/office");
    }
  } catch (e) {
    error.value = toUserError(e);
  } finally {
    starting.value = false;
  }
}

function roleLabel(e: Employee) {
  const ar = getAgencyRole(e.agentRoleId);
  return ar?.nameZh || e.role;
}
</script>

<template>
  <FouDialog
    v-model="dialogOpen"
    class="proj-detail-dialog"
    :title="project ? `项目详情 · ${project.name}` : '项目详情'"
    width="760px"
    append-to-body
    :close-on-click-modal="true"
    :show-fullscreen="false"
    :show-minimize="false"
    :z-index="21000"
    @close="emit('close')"
  >
    <div v-if="project" class="pd-meta">
      <span>类型：{{ PROJECT_TYPE_LABEL[project.type] }}</span>
      <span v-if="project.workflow">流程：{{ WORKFLOW_STATE_LABEL[project.workflow.state] }}</span>
      <span v-if="workflowBlockReason(project.workflow)" class="pd-wf-block">
        {{ workflowBlockReason(project.workflow) }}
      </span>
      <span v-if="project.type === 'software'">写码表面：{{ ideLabel }}</span>
      <span v-if="project.type === 'software'">
        开工模式：{{ KICKOFF_MODE_LABEL[kickoffMode] }}
      </span>
      <span v-if="project.requirements?.playbookPath">playbook 已生成</span>
      <span>创建：{{ formatProjectTime(project.createdAt) }}</span>
      <span>修改：{{ formatProjectTime(project.updatedAt) }}</span>
    </div>

    <section v-if="showIndustryPipeline && project" class="pd-section">
      <h3 class="pd-h">行业标准流水线</h3>
      <p class="pd-pipeline ui-font">{{ industryPipeline }}</p>
      <p class="pd-empty">
        全员开工按上列顺序分波派活；岗位归属波次见岗位库「派活波次」。顺序由行业模板 + 岗位元数据决定，非 AI 自行安排。
      </p>
      <FouButton icon="organization-chart" size="small" @click="openWorkflowStudio">
        流程工作室
      </FouButton>
    </section>

    <section v-if="project?.type === 'software'" class="pd-section">
      <h3 class="pd-h">研发模式</h3>
      <div class="pd-type-row">
        <FouButton
          icon="refresh-line"
          size="small"
          native-type="button"
          :type="kickoffMode === 'phased' ? 'primary' : 'default'"
          @click="kickoffMode = 'phased'"
        >
          {{ KICKOFF_MODE_LABEL.phased }}
        </FouButton>
        <FouButton
          icon="git-branch-line"
          size="small"
          native-type="button"
          :type="kickoffMode === 'strict' ? 'primary' : 'default'"
          @click="kickoffMode = 'strict'"
        >
          {{ KICKOFF_MODE_LABEL.strict }}
        </FouButton>
      </div>
      <p class="pd-empty">
        敏捷 Scrum：分波切片，设计确认后还要确认技术方案，再写码；Review 通过才能合 dev。瀑布：规划师出计划 → 确认计划 → 确认设计 → 确认技术方案 → 开发 → Review → 测试 → UAT。办公室「派活模型」只选 AI，不是研发模式。
      </p>
      <FouCheckbox
        v-if="kickoffMode === 'phased'"
        v-model="queueCompleteOnUat"
        class="pd-queue-uat"
      >
        UAT 通过后退出项目队列（进入下一项）
      </FouCheckbox>
    </section>

    <section v-if="project?.type === 'software'" class="pd-section">
      <h3 class="pd-h">写码表面</h3>
      <div class="pd-type-row">
        <FouButton
          icon="code-box-line"
          size="small"
          native-type="button"
          :type="codeEditorSurface === 'builtin' ? 'primary' : 'default'"
          @click="codeEditorSurface = 'builtin'"
        >
          内置 虚募阁 IDE
        </FouButton>
        <FouButton
          icon="terminal-window-line"
          size="small"
          native-type="button"
          :type="codeEditorSurface === 'external' ? 'primary' : 'default'"
          @click="codeEditorSurface = 'external'"
        >
          本机 IDE
        </FouButton>
      </div>
      <FouSelect
        v-if="codeEditorSurface === 'external'"
        v-model="toolchainIde"
        placeholder="已安装的 IDE"
        :options="ideSelectOptions"
        style="max-width: 280px; margin-top: 8px"
      />
      <p class="pd-empty">
        必须提前指定。改文件走 Agent；内置在应用内看过程，本机在开发开始时打开所选 IDE。
      </p>
    </section>

    <section v-if="progress" class="pd-section">
      <h3 class="pd-h">交付进度 · {{ overallPct }}%</h3>
      <div class="pd-bar-track" aria-hidden="true">
        <div class="pd-bar-fill" :style="{ width: `${overallPct}%` }" />
      </div>
      <div ref="deliverChartEl" class="pd-deliver-chart" aria-label="交付状态分布" />
      <ul class="pd-progress-list">
        <li v-for="s in progress.steps" :key="s.id" class="pd-progress-item">
          <div class="pd-progress-head">
            <strong>{{ s.title }}</strong>
            <span class="pd-status">{{ s.status }}</span>
          </div>
          <div class="pd-type-row">
            <FouButton
              icon="time-line"
              size="small"
              native-type="button"
              :type="s.status === 'pending' ? 'primary' : 'default'"
              @click="setStepStatus(s, 'pending')"
            >
              未做
            </FouButton>
            <FouButton
              icon="play-circle-line"
              size="small"
              native-type="button"
              :type="s.status === 'doing' ? 'primary' : 'default'"
              @click="setStepStatus(s, 'doing')"
            >
              进行中
            </FouButton>
            <FouButton
              icon="checkbox-circle-line"
              size="small"
              native-type="button"
              :type="s.status === 'done' ? 'primary' : 'default'"
              @click="setStepStatus(s, 'done')"
            >
              已做
            </FouButton>
            <FouButton
              icon="error-warning-line"
              size="small"
              native-type="button"
              :type="s.status === 'blocked' ? 'primary' : 'default'"
              @click="setStepStatus(s, 'blocked')"
            >
              受阻
            </FouButton>
          </div>
        </li>
      </ul>
    </section>

    <section v-if="plan" class="pd-section">
      <h3 class="pd-h">开工清单</h3>
      <ol class="pd-steps">
        <li v-for="s in plan.steps" :key="s.id">
          <strong>{{ s.title }}</strong>
          <p>{{ s.detail }}</p>
          <small v-if="s.doneWhen">完成标准：{{ s.doneWhen }}</small>
        </li>
      </ol>
      <div class="pd-custom">
        <h4 class="pd-h4">用户独立需求</h4>
        <ul v-if="plan.customRequirements.length" class="pd-reqs">
          <li v-for="(c, i) in plan.customRequirements" :key="i">{{ c }}</li>
        </ul>
        <p v-else class="pd-empty">暂无自定义需求</p>
        <div class="pd-add-req">
          <FouInput v-model="customDraft" placeholder="追加一条独立需求…" />
          <FouButton
            icon="add-line"
            size="small"
            type="primary"
            native-type="button"
            :disabled="!customDraft.trim()"
            @click="addCustomRequirement"
          >
            追加
          </FouButton>
        </div>
      </div>
    </section>

    <p class="pd-hint">为每位员工填写本项目的独立说明（仅作用于本项目）</p>

    <div class="pd-list">
      <div v-for="e in members" :key="e.id" class="pd-row">
        <div class="pd-emp">
          <span :class="genderTagClass(e.gender)">{{ genderLabel(e.gender) }}</span>
          <strong>{{ e.name }}</strong>
          <small>{{ roleLabel(e) }}</small>
        </div>
        <FouInput
          v-model="notes[e.id]"
          type="textarea"
          :rows="2"
          placeholder="例如：本周负责登录页与接口联调…"
        />
      </div>
      <p v-if="members.length === 0" class="pd-empty">暂无员工，请先编辑项目添加角色</p>
    </div>

    <p v-if="error" class="pd-error">{{ error }}</p>

    <template #footer>
      <FouButton icon="close-line" native-type="button" @click="emit('close')">取消</FouButton>
      <FouButton
        type="primary"
        icon="flag-line"
        native-type="button"
        :disabled="starting || saving || !project"
        @click="bossStart"
      >
        {{ starting ? "下达中…" : "下达开始" }}
      </FouButton>
      <FouButton
        type="default"
        icon="save-line"
        native-type="button"
        :disabled="saving || starting || !project"
        @click="save"
      >
        {{ saving ? "保存中…" : "保存" }}
      </FouButton>
    </template>
  </FouDialog>

  <FouDialog v-model="toolPolicyDlg" title="补全 Agent 工具权限" width="520px" append-to-body :close-on-click-modal="false">
    <p class="ui-font muted">此项目创建于工具权限功能之前，请确认保守默认（只读开、写/shell 关）或按需调整。</p>
    <div class="pd-tool-policy">
      <label v-for="(meta, key) in TOOL_POLICY_LABELS" :key="key" class="pd-tool-policy-row">
        <FouCheckbox v-model="legacyToolPolicy[key]" />
        <span>{{ meta.label }} — {{ meta.hint }}</span>
      </label>
    </div>
    <label class="pd-tool-policy-row">
      <FouCheckbox v-model="legacyToolPolicyAck" />
      <span>已确认工具权限</span>
    </label>
    <template #footer>
      <FouButton icon="save-line" type="primary" :loading="saving" @click="saveLegacyToolPolicy">保存</FouButton>
    </template>
  </FouDialog>
</template>

<style scoped>
.pd-wf-block {
  color: var(--warning, #c97a00);
  font-size: 12px;
}
.pd-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 12px 16px;
  font-size: 12px;
  color: var(--muted);
  margin-bottom: 8px;
}
.pd-section {
  margin-bottom: 14px;
  padding: 10px 12px;
  border: 1px solid var(--hairline);
  border-radius: 8px;
  background: var(--surface-soft, #f7f8fa);
  max-height: min(28vh, 260px);
  overflow: auto;
}
.pd-h {
  margin: 0 0 8px;
  font-size: 13px;
}
.pd-h4 {
  margin: 10px 0 6px;
  font-size: 12px;
}
.pd-steps {
  margin: 0;
  padding-left: 1.2em;
  font-size: 12px;
  line-height: 1.45;
}
.pd-steps p {
  margin: 2px 0 4px;
  color: var(--muted);
}
.pd-steps small {
  color: var(--muted);
}
.pd-reqs {
  margin: 0;
  padding-left: 1.2em;
  font-size: 12px;
}
.pd-add-req {
  display: flex;
  gap: 8px;
  margin-top: 8px;
  align-items: center;
}
.pd-hint {
  margin: 0 0 10px;
  font-size: 12px;
  color: var(--muted);
}
.pd-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-height: min(32vh, 280px);
  overflow: auto;
}
.pd-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px;
  border: 1px solid var(--hairline);
  border-radius: 8px;
  background: var(--surface-soft, #f7f8fa);
}
.pd-emp {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}
.pd-emp small {
  color: var(--muted);
}
.pd-empty {
  text-align: center;
  color: var(--muted);
  font-size: 13px;
}
.pd-error {
  color: #b42318;
  font-size: 12px;
}
.pd-bar-track {
  height: 8px;
  border-radius: 999px;
  background: #e5e7eb;
  overflow: hidden;
  margin-bottom: 10px;
}
.pd-bar-fill {
  height: 100%;
  background: #2563eb;
  transition: width 0.2s ease;
}
.pd-deliver-chart {
  width: 100%;
  height: 160px;
  margin-bottom: 12px;
}
.pd-progress-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.pd-progress-item {
  padding: 6px 0;
  border-bottom: 1px solid var(--hairline, #e5e7eb);
}
.pd-progress-head {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  margin-bottom: 4px;
}
.pd-status {
  color: var(--muted);
  text-transform: uppercase;
  font-size: 11px;
}
.pd-type-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
</style>
