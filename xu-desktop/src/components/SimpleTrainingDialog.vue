<script setup lang="ts">
/**
 * @file 本机岗位训练对话框：版本、评测、晋级与回滚
 * @author qiuye <yjk150@qq.com>
 * @updated 2026-09-02
 * @version 2.1.0
 * @category UI
 * @algo baseline-gated-promotion
 */
import { onApiCatch } from "../utils/userFacingError";
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  FouButton,
  fouAlert as showFouAlert,
  fouConfirmPromise,
  fouMsg,
} from "foucui";
import { useSimpleTraining, closeSimpleTraining, type SimpleTrainingTab } from "../training/openSimpleTraining";
import {
  buildMcpTrainingHints,
  listMcpToolsFromRust,
  loadMcpTraining,
  mergeMcpToolRows,
  mcpOpenAiName,
  promoteMcpPlaybook,
  saveMcpTraining,
  upsertMcpTrainingRecord,
  type McpTrainingDoc,
  type McpToolRow,
  type McpToolTrainingRecord,
} from "../training/mcpTraining";
import {
  buildFoutrainPack,
  exportFoutrainToFile,
  importFoutrainFromFile,
  isFoutrainPackEmpty,
} from "../training/xutrain";
import {
  downloadEmployeeCurriculumTemplate,
  downloadMcpTrainingTemplate,
  importEmployeeDemoIntoCurriculum,
  importMcpDemoIntoTraining,
  openTrainingDataFolder,
  openTrainingTemplatesFolder,
} from "../training/trainingTemplates";
import {
  clearTrainingDataDir,
  pickTrainingDataDir,
  readCustomTrainingDataDir,
  trainingDataRootUserLabel,
} from "../training/trainingDirPrefs";
import {
  loadCurriculum,
  type CurriculumDoc,
  type CurriculumEntry,
} from "../commerce/trainingLocal";
import { listAgencyRoles } from "../office/agencyRoles";
import { readEmployees } from "../utils/employees";
import {
  createCurriculumVersion,
  promoteCurriculum,
  rollbackCurriculum,
} from "../training/roleTraining";
import { runRoleEval, type EvalRun } from "../training/roleTrainingEval";
import {
  harvestCaseToDrafts,
  listCaseCandidates,
  type CaseLibraryEntry,
} from "../training/caseHarvest";
import { syncPromotedTrainingToCloud } from "../training/trainingCloudSync";

const { visible, tab } = useSimpleTraining();

const dialogOpen = computed({
  get: () => visible.value,
  set: (v: boolean) => {
    if (!v) closeSimpleTraining();
  },
});

const busy = ref(false);
const dataRoot = ref("训练资料目录");
const trainingDirCustom = ref(false);
const extensionTools = ref<McpToolRow[]>([]);
const mcpDoc = ref<McpTrainingDoc | null>(null);
const selectedTool = ref("");
const whenToUse = ref("");
const example = ref("");
const notes = ref("");
const antiPatterns = ref("");
const workflowText = ref("");
const priority = ref(3);
const boundRoles = ref<string[]>([]);
const scenarioTitle = ref("");
const scenarioIntent = ref("");
const scenarioOutcome = ref("");
const curriculum = ref<CurriculumDoc | null>(null);
const newRole = ref("");
const newWave = ref("planning");
const newTask = ref("");
const newRubric = ref("");
const newExpected = ref("");
const newKnowledge = ref("");
const newCounterExample = ref("");
const newEmployeeId = ref("");
const newPassScore = ref(70);
const roleOptions = ref<{ label: string; value: string }[]>([]);
const employeeOptions = ref<{ label: string; value: string }[]>([]);
const evalByEntry = ref<Record<string, EvalRun>>({});
const caseCandidates = ref<CaseLibraryEntry[]>([]);

const hasExtensionTools = computed(() => extensionTools.value.length > 0);

function setTab(t: SimpleTrainingTab) {
  tab.value = t;
}

function parseWorkflowLines(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((l) => l.replace(/^[-*\d.]+\s*/, "").trim())
    .filter(Boolean);
}

function parsePlaybookSteps(raw: string, fallbackTool: string) {
  return raw
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*\d.]+\s*/, "").trim())
    .filter(Boolean)
    .map((line, index) => {
      const [toolName, parameterTemplate, trigger, failureRecovery] = line
        .split("|")
        .map((item) => item.trim());
      return {
        id: `step_${index + 1}`,
        order: index + 1,
        toolName: toolName || fallbackTool,
        parameterTemplate: parameterTemplate || "{}",
        trigger: trigger || (index === 0 ? whenToUse.value.trim() : "上一步成功"),
        failureRecovery: failureRecovery || "停止并向用户说明失败，不写入秘密",
      };
    });
}

function workflowToText(steps?: string[]): string {
  return (steps || []).join("\n");
}

async function refreshDataRoot() {
  dataRoot.value = await trainingDataRootUserLabel();
  trainingDirCustom.value = !!readCustomTrainingDataDir();
}

async function pickTrainingDir() {
  busy.value = true;
  try {
    const path = await pickTrainingDataDir();
    if (path) {
      await refreshDataRoot();
      fouMsg.success(`训练目录已设为：${path}`);
    }
  } catch (e) {
    void onApiCatch(e);
  } finally {
    busy.value = false;
  }
}

async function resetTrainingDir() {
  busy.value = true;
  try {
    await clearTrainingDataDir();
    await refreshDataRoot();
    fouMsg.success("已恢复默认训练目录");
  } catch (e) {
    void onApiCatch(e);
  } finally {
    busy.value = false;
  }
}

function onTrainingDirChanged() {
  void refreshDataRoot();
}

async function refreshMcp() {
  busy.value = true;
  try {
    let live: McpToolRow[] = [];
    try {
      live = await listMcpToolsFromRust();
    } catch (e) {
      void onApiCatch(e);
      live = [];
    }
    mcpDoc.value = await loadMcpTraining();
    extensionTools.value = mergeMcpToolRows(live, mcpDoc.value);
    if (!selectedTool.value && extensionTools.value[0]) {
      selectTool(mcpOpenAiName(extensionTools.value[0].server_id, extensionTools.value[0].name));
    } else if (selectedTool.value) {
      selectTool(selectedTool.value);
    }
  } catch (e) {
    void onApiCatch(e);
  } finally {
    busy.value = false;
  }
}

function selectTool(fullName: string) {
  selectedTool.value = fullName;
  const rec = mcpDoc.value?.tools
    .filter((t) => t.toolName === fullName)
    .sort((a, b) => b.version - a.version)[0];
  whenToUse.value = rec?.whenToUse || "";
  example.value = rec?.example || "";
  notes.value = rec?.notes || "";
  antiPatterns.value = rec?.antiPatterns || "";
  workflowText.value = workflowToText(rec?.workflowSteps);
  if (rec?.playbookSteps?.length) {
    workflowText.value = rec.playbookSteps
      .map(
        (step) =>
          `${step.toolName} | ${step.parameterTemplate} | ${step.trigger} | ${step.failureRecovery}`,
      )
      .join("\n");
  }
  priority.value = rec?.priority ?? 3;
  boundRoles.value = rec?.roleIds ? [...rec.roleIds] : [];
  scenarioTitle.value = "";
  scenarioIntent.value = "";
  scenarioOutcome.value = "";
}

function toggleBoundRole(roleId: string) {
  const set = new Set(boundRoles.value);
  if (set.has(roleId)) set.delete(roleId);
  else set.add(roleId);
  boundRoles.value = [...set];
}

async function saveMcpRecord() {
  if (!mcpDoc.value || !selectedTool.value) return;
  const parts = selectedTool.value.replace(/^mcp__/, "").split("__");
  const serverId = parts[0] || "";
  const tool = parts.slice(1).join("__") || "";
  const existing = mcpDoc.value.tools
    .filter((t) => t.toolName === selectedTool.value)
    .sort((a, b) => b.version - a.version)[0];
  busy.value = true;
  try {
    const record: McpToolTrainingRecord = {
      toolName: selectedTool.value,
      version: existing?.version || 1,
      status: "draft",
      serverId,
      tool,
      priority: priority.value,
      roleIds: [...boundRoles.value],
      whenToUse: whenToUse.value.trim(),
      example: example.value.trim(),
      notes: notes.value.trim() || undefined,
      antiPatterns: antiPatterns.value.trim() || undefined,
      workflowSteps: parseWorkflowLines(workflowText.value),
      playbookSteps: parsePlaybookSteps(workflowText.value, selectedTool.value),
      scenarios: existing?.scenarios || [],
    };
    mcpDoc.value = upsertMcpTrainingRecord(mcpDoc.value, record);
    await saveMcpTraining(mcpDoc.value);
    fouMsg.success("Playbook 候选版本已保存；评测晋级前不会注入员工");
  } catch (e) {
    void onApiCatch(e);
  } finally {
    busy.value = false;
  }
}

async function promoteSelectedPlaybook() {
  if (!mcpDoc.value || !selectedTool.value) return;
  const candidate = mcpDoc.value.tools
    .filter((item) => item.toolName === selectedTool.value && item.status === "draft")
    .sort((a, b) => b.version - a.version)[0];
  if (!candidate) {
    await showFouAlert("请先保存一个 playbook 候选版本", "不能晋级");
    return;
  }
  busy.value = true;
  try {
    const decision = await promoteMcpPlaybook(mcpDoc.value, candidate);
    if (!decision.allowed) {
      await showFouAlert(
        `${decision.reason}（基线 ${decision.baselineScore}，候选 ${decision.candidateScore}）`,
        "不能晋级",
      );
      return;
    }
    mcpDoc.value = await loadMcpTraining();
    fouMsg.success(`Playbook v${candidate.version} 已晋级`);
  } catch (e) {
    void onApiCatch(e);
  } finally {
    busy.value = false;
  }
}

function addScenario() {
  if (!mcpDoc.value || !selectedTool.value) return;
  const title = scenarioTitle.value.trim();
  const userIntent = scenarioIntent.value.trim();
  if (!title || !userIntent) {
    void showFouAlert("请填写场景标题与用户意图", "场景未保存");
    return;
  }
  const rec = mcpDoc.value.tools
    .filter((t) => t.toolName === selectedTool.value)
    .sort((a, b) => b.version - a.version)[0];
  if (!rec) {
    void showFouAlert("请先保存此工具的基础训练", "场景未保存");
    return;
  }
  const scenarios = [...(rec.scenarios || [])];
  scenarios.push({
    id: `sc_${Date.now()}`,
    title,
    userIntent,
    toolChain: [selectedTool.value],
    expectedOutcome: scenarioOutcome.value.trim() || "任务完成",
  });
  mcpDoc.value = {
    ...mcpDoc.value,
    tools: mcpDoc.value.tools.map((item) =>
      item === rec ? { ...rec, scenarios } : item,
    ),
  };
  scenarioTitle.value = "";
  scenarioIntent.value = "";
  scenarioOutcome.value = "";
  fouMsg.success("场景已加入（记得点保存此工具）");
}

async function previewMcpHints() {
  const roleId = boundRoles.value[0] || newRole.value || null;
  const h = await buildMcpTrainingHints({ roleId, taskHint: scenarioIntent.value || newTask.value });
  fouMsg.info(h ? `将注入约 ${h.length} 字完整训练提示` : "尚无可用扩展工具训练条目");
}

async function doExportPack() {
  busy.value = true;
  try {
    const pack = await buildFoutrainPack();
    if (isFoutrainPackEmpty(pack)) {
      const choice = await fouConfirmPromise(
        "当前还没有已保存的扩展工具或员工课程内容。\n\n可导出「骨架包」（含说明），或先下载模板再填写。\n\n保存位置：" +
          dataRoot.value,
        "没有可导出的训练内容",
        { confirmButtonText: "导出骨架包", cancelButtonText: "取消" },
      );
      if (choice !== "confirm") return;
      const path = await exportFoutrainToFile({ allowEmpty: true });
      if (path) {
        await showFouAlert(
          `骨架训练包已导出。\n\n请用「下载员工训练模板」或「下载扩展工具模板」开始填写，保存并晋级后再导出完整包。`,
          "导出成功",
        );
      }
      return;
    }
    const st = pack.manifest.stats;
    const {
      mcpTools: toolUsageCount,
      curriculumEntries,
      outcomes,
      evalRuns,
      sensitiveExcluded,
    } = st;
    const ok = await fouConfirmPromise(
      `将导出 ${toolUsageCount} 条工具用法、${curriculumEntries} 个课程版本、${outcomes} 条任务结果和 ${evalRuns} 次评测。\n已默认排除 ${sensitiveExcluded} 条敏感结果。\n\n保存位置：${dataRoot.value}`,
      "导出本机训练包",
      { confirmButtonText: "继续导出", cancelButtonText: "取消" },
    );
    if (ok !== "confirm") return;
    const path = await exportFoutrainToFile();
    if (path) {
      await showFouAlert(`训练包已导出：\n${path}`, "导出成功");
    }
  } catch (e) {
    void onApiCatch(e);
  } finally {
    busy.value = false;
  }
}

async function downloadEmployeeTemplate() {
  busy.value = true;
  try {
    const path = await downloadEmployeeCurriculumTemplate();
    const n = await importEmployeeDemoIntoCurriculum();
    await refreshEmployee();
    await showFouAlert(
      `模板已写入：\n${path}\n\n并已合并 ${n} 条课程到本机 curriculum（草稿）。请编辑后「运行评测 → 晋级」。`,
      "员工训练模板",
    );
  } catch (e) {
    void onApiCatch(e);
  } finally {
    busy.value = false;
  }
}

async function downloadMcpTemplate() {
  busy.value = true;
  try {
    await downloadMcpTrainingTemplate();
    const n = await importMcpDemoIntoTraining();
    await refreshMcp();
    const where = await trainingDataRootUserLabel();
    const choice = await fouConfirmPromise(
      `模板已写入「${where}」下的 templates 文件夹（mcp-training.demo.json）。\n\n并已合并 ${n} 条演示工具训练（草稿）。请对照真实工具名修改后「评测并晋级」。\n\n要现在打开该文件夹吗？`,
      "扩展工具训练模板",
      { confirmButtonText: "打开所在目录", cancelButtonText: "稍后" },
    );
    if (choice === "confirm") {
      await openTrainingTemplatesFolder();
    }
  } catch (e) {
    void onApiCatch(e);
  } finally {
    busy.value = false;
  }
}

async function openTrainingFolder() {
  busy.value = true;
  try {
    await openTrainingDataFolder();
  } catch (e) {
    void onApiCatch(e);
  } finally {
    busy.value = false;
  }
}

async function doImportPack() {
  busy.value = true;
  try {
    const r = await importFoutrainFromFile();
    if (r) {
      fouMsg.success(
        `已校验并合并：+${r.merged.mcp} 个扩展工具、+${r.merged.curriculum} 课程、+${r.merged.outcomes} 结果、+${r.merged.evalRuns} 评测`,
      );
      await refreshMcp();
      await refreshEmployee();
    }
  } catch (e) {
    void onApiCatch(e);
  } finally {
    busy.value = false;
  }
}

async function doSyncToCloud() {
  busy.value = true;
  try {
    await syncPromotedTrainingToCloud();
  } finally {
    busy.value = false;
  }
}

async function refreshEmployee() {
  busy.value = true;
  try {
    curriculum.value = await loadCurriculum();
    const roles = listAgencyRoles().slice(0, 80);
    roleOptions.value = roles.map((r) => ({
      label: `${r.nameZh || r.name} (${r.id})`,
      value: r.id,
    }));
    employeeOptions.value = readEmployees().map((employee) => ({
      label: `${employee.name} · ${employee.role}`,
      value: employee.id,
    }));
    caseCandidates.value = await listCaseCandidates();
  } catch (e) {
    void onApiCatch(e);
  } finally {
    busy.value = false;
  }
}

async function createEmployeeVersion() {
  if (!curriculum.value) return;
  const roleId = newRole.value.trim();
  const taskExample = newTask.value.trim();
  if (!roleId || !taskExample) {
    await showFouAlert("请选择岗位并填写示例任务", "课程未保存");
    return;
  }
  const employeeId = newEmployeeId.value.trim();
  const rubric = newRubric.value.trim() || "对照 Brief 验收";
  await createCurriculumVersion(curriculum.value, {
    scope: employeeId ? "employee" : "role",
    roleId,
    employeeId: employeeId || undefined,
    title: employeeId ? "员工覆盖课程" : "岗位模板课程",
    wave: newWave.value.trim() || "planning",
    knowledgeDocs: newKnowledge.value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean),
    cases: [{
      id: `case_${Date.now()}`,
      title: "标准案例",
      input: taskExample,
      expected: newExpected.value.trim() || rubric,
    }],
    counterExamples: newCounterExample.value.trim()
      ? [{
          id: `counter_${Date.now()}`,
          title: "禁止做法",
          input: newCounterExample.value.trim(),
          expected: "命中时停止并按 rubric 修复",
        }]
      : [],
    rubricSpec: {
      passScore: newPassScore.value,
      criteria: [{ id: "acceptance", title: "验收标准", weight: 100, requirement: rubric }],
    },
    taskExample,
    rubric,
  });
  curriculum.value = await loadCurriculum();
  newTask.value = "";
  newRubric.value = "";
  newExpected.value = "";
  newCounterExample.value = "";
  fouMsg.success("课程草稿版本已保存，请运行固定评测后晋级");
}

function isActive(entry: CurriculumEntry): boolean {
  if (!curriculum.value) return false;
  const key =
    entry.scope === "employee"
      ? `employee:${entry.employeeId || ""}`
      : `role:${entry.roleId}`;
  return curriculum.value.activeVersions[key] === entry.version;
}

async function saveEmployee() {
  if (!curriculum.value) {
    await showFouAlert("请选择岗位并填写示例任务", "课程未保存");
    return;
  }
  busy.value = true;
  try {
    await createEmployeeVersion();
  } catch (e) {
    void onApiCatch(e);
  } finally {
    busy.value = false;
  }
}

async function runEval(entry: CurriculumEntry) {
  busy.value = true;
  try {
    const run = await runRoleEval(entry);
    evalByEntry.value = { ...evalByEntry.value, [entry.id]: run };
    fouMsg.success(`固定评测完成：${run.score} 分`);
  } catch (e) {
    void onApiCatch(e);
  } finally {
    busy.value = false;
  }
}

async function promote(entry: CurriculumEntry) {
  if (!curriculum.value) return;
  busy.value = true;
  try {
    const decision = await promoteCurriculum(curriculum.value, entry.id);
    if (!decision.allowed) {
      await showFouAlert(decision.reason, "不能晋级");
      return;
    }
    curriculum.value = await loadCurriculum();
    fouMsg.success(`v${entry.version} 已晋级为生效课程`);
  } catch (e) {
    void onApiCatch(e);
  } finally {
    busy.value = false;
  }
}

async function harvestCase(entry: CaseLibraryEntry) {
  busy.value = true;
  try {
    const draft = await harvestCaseToDrafts(entry.id);
    if (!draft) {
      await showFouAlert("未找到该案例或已删除", "收割失败");
      return;
    }
    curriculum.value = await loadCurriculum();
    caseCandidates.value = await listCaseCandidates();
    fouMsg.success(
      draft.mcpHint
        ? `已生成课程草稿；${draft.mcpHint}。请运行评测并晋级。`
        : "已生成课程草稿，请运行评测并晋级。",
    );
  } catch (e) {
    void onApiCatch(e);
  } finally {
    busy.value = false;
  }
}

async function rollback(entry: CurriculumEntry) {
  if (!curriculum.value) return;
  busy.value = true;
  try {
    await rollbackCurriculum(curriculum.value, entry.id);
    curriculum.value = await loadCurriculum();
    fouMsg.success(`已回滚到 v${entry.version}`);
  } catch (e) {
    void onApiCatch(e);
  } finally {
    busy.value = false;
  }
}

watch(dialogOpen, (v) => {
  if (v) {
    void refreshDataRoot();
    void refreshMcp();
    void refreshEmployee();
  }
});

onMounted(() => {
  window.addEventListener("xu-training-dir-changed", onTrainingDirChanged);
  if (dialogOpen.value) {
    void refreshDataRoot();
    void refreshMcp();
    void refreshEmployee();
  }
});

onBeforeUnmount(() => {
  window.removeEventListener("xu-training-dir-changed", onTrainingDirChanged);
});
</script>

<template>
  <FouDialog
    v-model="dialogOpen"
    title="进阶训练（用法库）"
    width="920px"
    append-to-body
    destroy-on-close
  >
    <p class="st-lead ui-font">
      <strong>不训练模型权重</strong>；只有<strong>评测并晋级</strong>后的内容才会注入派活与对话。
      用法库与员工课程永久保存在 <strong>{{ dataRoot }}</strong>（非软件安装目录，升级不覆盖）。
      想让回复立刻更聪明，请到<strong>设置 → 模型</strong>换三脑，或<strong>设置 → 记忆</strong>使用「越用越懂我」主路径。
    </p>
    <ol class="st-steps ui-font">
      <li>在设置 → 扩展工具中启用服务后点「刷新工具」</li>
      <li>下载模板或手写课程 / playbook，保存后评测并晋级</li>
      <li>导出训练包备份；导入可合并到本机目录</li>
    </ol>
    <div class="st-dir-row">
      <FouButton icon="folder-open-line" size="small" :loading="busy" @click="pickTrainingDir">
        选择训练目录
      </FouButton>
      <FouButton icon="folder-3-line" size="small" :loading="busy" @click="openTrainingFolder">
        打开训练目录
      </FouButton>
      <FouButton
        v-if="trainingDirCustom"
        icon="restart-line"
        size="small"
        :loading="busy"
        @click="resetTrainingDir"
      >
        恢复默认
      </FouButton>
    </div>
    <div class="st-pack-acts">
      <FouButton icon="upload-cloud-2-line" size="small" :loading="busy" @click="doSyncToCloud">
        同步到云端
      </FouButton>
      <FouButton icon="upload-2-line" size="small" :loading="busy" @click="doExportPack">
        导出训练包
      </FouButton>
      <FouButton icon="download-2-line" size="small" :loading="busy" @click="doImportPack">
        导入并合并
      </FouButton>
      <FouButton
        icon="file-download-line"
        size="small"
        :loading="busy"
        @click="downloadEmployeeTemplate"
      >
        下载员工训练模板
      </FouButton>
      <FouButton icon="file-code-line" size="small" :loading="busy" @click="downloadMcpTemplate">
        下载扩展工具模板
      </FouButton>
    </div>
    <p class="st-pack-hint ui-font">
      训练包 = 课程 + 扩展工具用法 + 非敏感结果。空内容时可导出骨架包。
      「同步到云端」仅上传已晋级课程与成熟案例，不含原始上传文件；本机副本会保留。
    </p>
    <div class="st-tabs">
      <FouButton
        icon="user-star-line"
        size="small"
        :type="tab === 'employee' ? 'primary' : 'default'"
        @click="setTab('employee')"
      >
        训练员工
      </FouButton>
      <FouButton
        icon="plug-line"
        size="small"
        :type="tab === 'mcp' ? 'primary' : 'default'"
        @click="setTab('mcp')"
      >
        训练扩展工具
      </FouButton>
    </div>

    <div v-show="tab === 'employee'" class="st-pane ui-font">
      <p class="st-hint">
        岗位模板对同岗生效；选择员工后建立覆盖版本。不知道怎么写？点上方「下载员工训练模板」。
        新版本先跑固定评测，只有成功率提升且违规率不增加才能<strong>晋级</strong>（晋级后才注入派活）。
      </p>
      <div v-if="caseCandidates.length" class="st-case-harvest">
        <p class="st-hint"><strong>成熟案例收割</strong>：从验收通过项目生成课程草稿（须再评测晋级）。</p>
        <ul class="st-list">
          <li v-for="c in caseCandidates" :key="c.id" class="st-row">
            <strong>{{ c.title }}</strong>
            <span>{{ c.status }} · {{ c.roleId }}</span>
            <span class="st-sum">{{ c.source.briefExcerpt }}</span>
            <FouButton
              icon="seedling-line"
              size="small"
              :loading="busy"
              @click="harvestCase(c)"
            >
              生成课程草稿
            </FouButton>
          </li>
        </ul>
      </div>
      <div class="st-add">
        <div class="st-add-row">
          <FouSelect v-model="newRole" :options="roleOptions" placeholder="选择岗位…" class="st-select" />
          <FouSelect
            v-model="newEmployeeId"
            :options="[{ label: '岗位模板（全员）', value: '' }, ...employeeOptions]"
            placeholder="员工覆盖（可选）"
            class="st-select"
          />
          <FouInput v-model="newWave" class="st-wave" placeholder="波次 planning/dev/…" />
        </div>
        <FouInput v-model="newKnowledge" type="textarea" :rows="2" placeholder="知识文档（每行一条路径或知识摘要）" />
        <FouInput v-model="newTask" placeholder="案例任务输入（必填）" />
        <FouInput v-model="newExpected" placeholder="案例期望结果" />
        <FouInput v-model="newCounterExample" placeholder="反例 / 禁止做法" />
        <FouInput v-model="newRubric" placeholder="评分 rubric（必填标准）" />
        <label class="st-score">
          <span>通过分</span>
          <FouInputNumber v-model="newPassScore" :min="0" :max="100" />
        </label>
        <div class="st-add-row">
          <FouButton icon="save-line" type="primary" size="small" :loading="busy" @click="saveEmployee">
            保存新版本
          </FouButton>
        </div>
      </div>
      <ul v-if="curriculum?.entries.length" class="st-list">
        <li v-for="e in curriculum.entries" :key="e.id" class="st-row">
          <strong>{{ e.roleId }} · v{{ e.version }}</strong>
          <span>{{ e.scope === "employee" ? `员工覆盖 ${e.employeeId}` : "岗位模板" }}</span>
          <span>{{ isActive(e) ? "生效中" : e.status === "draft" ? "待评测" : "历史" }}</span>
          <span class="st-sum">{{ e.taskExample }}</span>
          <FouButton
            icon="flask-line"
            size="small"
            :loading="busy"
            @click="runEval(e)"
          >运行评测</FouButton>
          <FouButton
            v-if="!isActive(e)"
            icon="arrow-up-circle-line"
            size="small"
            :loading="busy"
            @click="promote(e)"
          >晋级</FouButton>
          <FouButton
            v-if="!isActive(e) && e.status === 'retired'"
            icon="history-line"
            size="small"
            :loading="busy"
            @click="rollback(e)"
          >回滚</FouButton>
          <small v-if="evalByEntry[e.id]">
            成功 {{ Math.round(evalByEntry[e.id].metrics.successRate * 100) }}% ·
            返工 {{ Math.round(evalByEntry[e.id].metrics.reworkRate * 100) }}% ·
            违规 {{ Math.round(evalByEntry[e.id].metrics.violationRate * 100) }}% ·
            {{ evalByEntry[e.id].metrics.avgDurationMs }}ms ·
            {{ evalByEntry[e.id].metrics.avgTokens }} token
          </small>
        </li>
      </ul>
      <p v-else class="muted">暂无课程版本。先建立岗位模板，再按需建立员工覆盖。</p>
    </div>

    <div v-show="tab === 'mcp'" class="st-pane ui-font">
      <p class="st-hint">
        请先在「设置 → MCP」添加并启用服务，再点「刷新工具」。也可先「下载扩展工具模板」写入本机草稿，再对照真实工具名修改。
      </p>
      <div class="st-mcp-toolbar">
        <FouButton icon="refresh-line" size="small" :loading="busy" @click="refreshMcp">刷新工具</FouButton>
      </div>

      <div v-if="!hasExtensionTools" class="st-mcp-empty">
        <p class="st-mcp-empty-title">尚未列出扩展工具</p>
        <p class="muted">
          请先在「设置 → MCP」添加并启用服务后点「刷新工具」；或先下载扩展工具模板，合并本机草稿后再编辑。
        </p>
      </div>

      <div v-else class="st-mcp-layout">
        <p v-if="mcpDoc?.tools?.length" class="st-hint" style="grid-column: 1 / -1">
          左侧含已连接扩展工具与本机草稿/演示（共 {{ extensionTools.length }} 项）。接上服务后可对照真实工具名。
        </p>
        <ul class="st-tool-list">
          <li
            v-for="t in extensionTools"
            :key="mcpOpenAiName(t.server_id, t.name)"
            class="st-tool"
            :class="{ active: selectedTool === mcpOpenAiName(t.server_id, t.name) }"
            @click="selectTool(mcpOpenAiName(t.server_id, t.name))"
          >
            <strong>{{ t.name }}</strong>
            <span class="muted">{{ t.server_id }}{{ t.description ? ` · ${t.description}` : "" }}</span>
          </li>
        </ul>

        <div v-if="selectedTool" class="st-tip-form">
          <code class="st-tool-name">{{ selectedTool }}</code>
          <label>优先级（1–5）</label>
          <FouInputNumber v-model="priority" :min="1" :max="5" style="max-width: 100px" />
          <label>绑定岗位（空=全员；勾选后仅这些岗位派活时优先注入）</label>
          <div class="st-role-chips">
            <FouButton
              v-for="o in roleOptions.slice(0, 24)"
              :key="o.value"
              size="small"
              :type="boundRoles.includes(o.value) ? 'primary' : 'default'"
              icon="user-star-line"
              native-type="button"
              @click="toggleBoundRole(o.value)"
            >
              {{ o.label.split(" (")[0] }}
            </FouButton>
          </div>
          <label>何时使用</label>
          <FouInput v-model="whenToUse" type="textarea" :rows="2" placeholder="例如：查飞书文档、读库表结构时…" />
          <label>勿用 / 反模式</label>
          <FouInput v-model="antiPatterns" type="textarea" :rows="2" placeholder="例如：不要用此工具读大文件…" />
          <label>有序 playbook（每行：工具 | 参数模板 | 触发条件 | 失败修复）</label>
          <FouInput
            v-model="workflowText"
            type="textarea"
            :rows="5"
            placeholder='扩展工具标识 | 参数示例 | 何时使用 | 注意事项'
          />
          <label>调用示例</label>
          <FouInput v-model="example" type="textarea" :rows="2" placeholder='例如：{"query":"..."}' />
          <label>备注（可选）</label>
          <FouInput v-model="notes" type="textarea" :rows="2" />
          <div class="st-scenario-block">
            <strong class="ui-font">训练场景（可选）</strong>
            <FouInput v-model="scenarioTitle" placeholder="场景标题" />
            <FouInput v-model="scenarioIntent" class="st-grow" placeholder="用户典型说法" />
            <FouInput v-model="scenarioOutcome" class="st-grow" placeholder="期望结果" />
            <FouButton icon="add-line" size="small" @click="addScenario">加场景</FouButton>
          </div>
          <div class="st-tip-acts">
            <FouButton icon="save-line" type="primary" size="small" :loading="busy" @click="saveMcpRecord">
              保存此工具
            </FouButton>
            <FouButton icon="eye-line" size="small" @click="previewMcpHints">预览注入</FouButton>
            <FouButton icon="arrow-up-circle-line" size="small" :loading="busy" @click="promoteSelectedPlaybook">
              评测并晋级
            </FouButton>
          </div>
        </div>

        <div v-else class="st-mcp-placeholder">
          <p class="muted">请从左侧列表选择一个工具开始训练。</p>
        </div>
      </div>
    </div>

    <template #footer>
      <FouButton icon="close-line" @click="dialogOpen = false">关闭</FouButton>
    </template>
  </FouDialog>
</template>

<style scoped>
.st-lead {
  margin: 0 0 8px;
  font-size: 13px;
  line-height: 1.5;
  color: var(--text-secondary, #555);
}
.st-steps {
  margin: 0 0 10px;
  padding-left: 1.25em;
  font-size: 12.5px;
  line-height: 1.45;
  color: var(--muted, #666);
}
.st-pack-hint {
  margin: 0 0 10px;
  font-size: 12px;
  color: var(--muted, #666);
}
.st-dir-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 8px;
}
.st-pack-acts {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 10px;
}
.st-tabs {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}
.st-pane {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 320px;
  max-height: 58vh;
  overflow: auto;
}
.st-hint {
  margin: 0;
  font-size: 12px;
  color: var(--muted, #888);
  line-height: 1.45;
}
.st-mcp-toolbar {
  display: flex;
  gap: 8px;
}
.st-mcp-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 240px;
  padding: 24px 16px;
  text-align: center;
  border: 1px dashed var(--hairline, #d1d5db);
  border-radius: 8px;
  background: var(--surface-2, #f9fafb);
}
.st-mcp-empty-title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
}
.st-add {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.st-add-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}
.st-select,
.st-input,
.st-area {
  font: inherit;
  font-size: 13px;
  padding: 6px 8px;
  border: 1px solid var(--hairline, #e5e7eb);
  border-radius: 6px;
  background: var(--surface, #fff);
  color: inherit;
}
.st-select {
  flex: 1;
  min-width: 200px;
  max-width: 100%;
}
.st-wave {
  width: 180px;
}
.st-full {
  width: 100%;
}
.st-grow {
  flex: 1;
  min-width: 140px;
}
.st-area {
  width: 100%;
  resize: vertical;
}
.st-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.st-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  font-size: 12px;
  padding: 6px 8px;
  background: var(--surface-2, #f5f6f8);
  border-radius: 6px;
}
.st-sum {
  flex: 1;
  min-width: 120px;
}
.st-mcp-layout {
  display: grid;
  grid-template-columns: minmax(160px, 220px) 1fr;
  gap: 12px;
  min-height: 280px;
  flex: 1;
}
.st-tool-list {
  list-style: none;
  margin: 0;
  padding: 0;
  overflow: auto;
  border: 1px solid var(--hairline, #e5e7eb);
  border-radius: 8px;
  max-height: 420px;
}
.st-tool {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 10px;
  cursor: pointer;
  border-bottom: 1px solid var(--hairline, #eee);
  font-size: 12px;
}
.st-tool.active {
  background: color-mix(in srgb, var(--primary, #0d9488) 12%, transparent);
}
.st-mcp-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 200px;
  padding: 16px;
  border: 1px dashed var(--hairline, #e5e7eb);
  border-radius: 8px;
  background: var(--surface-2, #f9fafb);
}
.st-tip-form {
  display: flex;
  flex-direction: column;
  gap: 6px;
  overflow: auto;
  max-height: 420px;
}
.st-tip-form label {
  font-size: 12px;
  color: var(--muted, #888);
}
.st-tool-name {
  font-size: 12px;
  word-break: break-all;
}
.st-role-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  max-height: 88px;
  overflow: auto;
}
.st-scenario-block {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  padding: 8px;
  background: var(--surface-2, #f5f6f8);
  border-radius: 8px;
}
.st-tip-acts {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 4px;
}
.muted {
  font-size: 12px;
  color: var(--muted, #999);
}
@media (max-width: 720px) {
  .st-mcp-layout {
    grid-template-columns: 1fr;
  }
}
</style>
