<script setup lang="ts">
/**
 * @file 训练工作室：样本、课程版本、固定评测与晋级
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-31
 * @updated 2026-09-02
 * @version 2.1.0
 * @category UI
 * @algo baseline-gated-promotion
 */
import { onApiCatch } from "../utils/userFacingError";
import { onMounted, ref } from "vue";
import {
  FouButton,
  fouMsg,
} from "foucui";
import {
  listLocalTrainingSamples,
  loadCurriculum,
  saveCurriculum,
  type CurriculumDoc,
  type TrainingSampleRow,
  type CurriculumEntry,
} from "./trainingLocal";
import { isTrainingOptIn, setTrainingOptIn } from "./training";
import {
  createCurriculumVersion,
  promoteCurriculum,
  rollbackCurriculum,
} from "../training/roleTraining";
import { runRoleEval, type EvalRun } from "../training/roleTrainingEval";
import { loadTrainingOutcomes, type TrainingOutcome } from "../training/outcomes";
import { syncPromotedTrainingToCloud } from "../training/trainingCloudSync";

const samples = ref<TrainingSampleRow[]>([]);
const curriculum = ref<CurriculumDoc | null>(null);
const optIn = ref(false);
const busy = ref(false);
const uploadMsg = ref("");
const newTask = ref("");
const newRubric = ref("");
const newRole = ref("");
const newWave = ref("planning");
const outcomes = ref<TrainingOutcome[]>([]);
const evalByEntry = ref<Record<string, EvalRun>>({});

async function refresh() {
  busy.value = true;
  try {
    optIn.value = isTrainingOptIn();
    samples.value = await listLocalTrainingSamples(120);
    curriculum.value = await loadCurriculum();
    outcomes.value = (await loadTrainingOutcomes()).outcomes.slice(-80).reverse();
  } catch (e) {
    void onApiCatch(e);
  } finally {
    busy.value = false;
  }
}

function onOptIn(v: boolean) {
  setTrainingOptIn(v);
  optIn.value = v;
}

async function saveCur() {
  if (!curriculum.value) return;
  busy.value = true;
  try {
    await saveCurriculum(curriculum.value);
    fouMsg.success("课程已保存");
  } catch (e) {
    void onApiCatch(e);
  } finally {
    busy.value = false;
  }
}

async function addEntry() {
  if (!curriculum.value) return;
  const roleId = newRole.value.trim();
  const taskExample = newTask.value.trim();
  if (!roleId || !taskExample) {
    void onApiCatch(new Error("请填写角色与示例任务"));
    return;
  }
  const rubric = newRubric.value.trim() || "对照 Brief 验收";
  await createCurriculumVersion(curriculum.value, {
    scope: "role",
    roleId,
    title: "工作室岗位模板",
    wave: newWave.value.trim() || "planning",
    knowledgeDocs: [],
    cases: [{ id: `case_${Date.now()}`, title: "标准案例", input: taskExample, expected: rubric }],
    counterExamples: [],
    rubricSpec: {
      passScore: 70,
      criteria: [{ id: "acceptance", title: "验收标准", weight: 100, requirement: rubric }],
    },
    taskExample,
    rubric,
  });
  curriculum.value = await loadCurriculum();
  newRole.value = "";
  newTask.value = "";
  newRubric.value = "";
}

function isActive(entry: CurriculumEntry): boolean {
  if (!curriculum.value) return false;
  const key = entry.scope === "employee"
    ? `employee:${entry.employeeId || ""}`
    : `role:${entry.roleId}`;
  return curriculum.value.activeVersions[key] === entry.version;
}

async function evaluate(entry: CurriculumEntry) {
  try {
    const run = await runRoleEval(entry);
    evalByEntry.value = { ...evalByEntry.value, [entry.id]: run };
    fouMsg.success(`v${entry.version} 评测 ${run.score} 分`);
  } catch (e) {
    void onApiCatch(e);
  }
}

async function promote(entry: CurriculumEntry) {
  if (!curriculum.value) return;
  const decision = await promoteCurriculum(curriculum.value, entry.id);
  if (!decision.allowed) {
    void onApiCatch(new Error(decision.reason));
    return;
  }
  curriculum.value = await loadCurriculum();
  fouMsg.success(`v${entry.version} 已晋级`);
}

async function rollback(entry: CurriculumEntry) {
  if (!curriculum.value) return;
  await rollbackCurriculum(curriculum.value, entry.id);
  curriculum.value = await loadCurriculum();
  fouMsg.success(`已回滚 v${entry.version}`);
}

function exportSamples() {
  const safeSamples = samples.value.filter((sample) => !sample.sensitive);
  const blob = new Blob(
    [safeSamples.map((s) => JSON.stringify(s)).join("\n") + "\n"],
    { type: "application/x-ndjson" },
  );
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `training-samples-${new Date().toISOString().slice(0, 10)}.jsonl`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function exportCurriculum() {
  if (!curriculum.value) return;
  const blob = new Blob([JSON.stringify(curriculum.value, null, 2)], {
    type: "application/json",
  });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `curriculum-${curriculum.value.industry}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

async function uploadIngest() {
  uploadMsg.value = "";
  busy.value = true;
  try {
    const r = await syncPromotedTrainingToCloud();
    uploadMsg.value = r.message;
    if (r.ok) fouMsg.success(r.message);
  } catch (e) {
    void onApiCatch(e, (m) => { uploadMsg.value = m });
  } finally {
    busy.value = false;
  }
}

onMounted(() => {
  void refresh();
});
</script>

<template>
  <div class="trs ui-font">
    <header class="trs-toolbar">
      <label class="trs-opt">
        <span>采集同意</span>
        <FouSwitch :model-value="optIn" @update:model-value="onOptIn" />
      </label>
      <FouButton icon="refresh-line" size="small" :loading="busy" @click="refresh">刷新</FouButton>
      <FouButton icon="download-2-line" size="small" @click="exportSamples">导出样本</FouButton>
      <FouButton icon="book-2-line" size="small" @click="exportCurriculum">导出课程</FouButton>
      <FouButton icon="upload-cloud-2-line" type="primary" size="small" :loading="busy" @click="uploadIngest">
        同步到云端
      </FouButton>
    </header>
    <p v-if="uploadMsg" class="trs-msg">{{ uploadMsg }}</p>

    <section class="trs-sec">
      <h3>本机样本（脱敏）</h3>
      <ul v-if="samples.length" class="trs-list">
        <li v-for="(s, i) in samples" :key="i" class="trs-row">
          <code>{{ s.at.slice(0, 19) }}</code>
          <strong>{{ s.kind }}</strong>
          <span v-if="s.industry">{{ s.industry }}</span>
          <span v-if="s.wave">{{ s.wave }}</span>
          <span class="trs-sum">{{ s.summary || "—" }}</span>
        </li>
      </ul>
      <p v-else class="muted">暂无样本。开启采集后，澄清确认 / 开工波次 / 验收通过会写入本机 JSONL。</p>
    </section>

    <section v-if="curriculum" class="trs-sec">
      <h3>课程（角色 × 波次 × 示例）</h3>
      <div class="trs-add">
        <FouInput v-model="newRole" size="small" placeholder="roleId" style="width: 120px" />
        <FouInput v-model="newWave" size="small" placeholder="wave" style="width: 100px" />
        <FouInput v-model="newTask" size="small" placeholder="示例任务" style="flex: 1" />
        <FouInput v-model="newRubric" size="small" placeholder="评分标准" style="flex: 1" />
        <FouButton icon="add-line" size="small" @click="addEntry">添加</FouButton>
        <FouButton icon="save-line" type="primary" size="small" :loading="busy" @click="saveCur">
          保存课程
        </FouButton>
      </div>
      <ul class="trs-list">
        <li v-for="e in curriculum.entries" :key="e.id" class="trs-row">
          <strong>{{ e.roleId }} · v{{ e.version }}</strong>
          <span>{{ e.wave }}</span>
          <span>{{ isActive(e) ? "生效" : e.status }}</span>
          <span class="trs-sum">{{ e.taskExample }}</span>
          <FouButton icon="flask-line" size="small" @click="evaluate(e)">评测</FouButton>
          <FouButton v-if="!isActive(e)" icon="arrow-up-circle-line" size="small" @click="promote(e)">晋级</FouButton>
          <FouButton v-if="e.status === 'retired'" icon="history-line" size="small" @click="rollback(e)">回滚</FouButton>
          <small v-if="evalByEntry[e.id]">
            成功率 {{ Math.round(evalByEntry[e.id].metrics.successRate * 100) }}% /
            返工率 {{ Math.round(evalByEntry[e.id].metrics.reworkRate * 100) }}% /
            违规率 {{ Math.round(evalByEntry[e.id].metrics.violationRate * 100) }}%
          </small>
        </li>
      </ul>
    </section>

    <section class="trs-sec">
      <h3>真实任务训练结果</h3>
      <ul v-if="outcomes.length" class="trs-list">
        <li v-for="item in outcomes" :key="item.id" class="trs-row">
          <strong>{{ item.roleId || item.employeeId }}</strong>
          <span>{{ item.status }}</span>
          <span class="trs-sum">{{ item.taskInput }}</span>
          <span>{{ Math.round(item.durationMs / 1000) }}s</span>
          <span>{{ item.totalTokens }} token</span>
        </li>
      </ul>
      <p v-else class="muted">尚无员工任务结果；下一次真实派活会自动捕获计划、工具、验收、耗时和 token。</p>
    </section>
  </div>
</template>

<style scoped>
.trs {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 12px;
  height: 100%;
  overflow: auto;
}
.trs-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}
.trs-opt {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  margin-right: 8px;
}
.trs-sec h3 {
  margin: 0 0 8px;
  font-size: 14px;
}
.trs-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.trs-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  font-size: 12px;
  padding: 6px 8px;
  background: var(--surface-2, #f5f6f8);
  border-radius: 6px;
}
.trs-sum {
  flex: 1;
  min-width: 120px;
  color: var(--text-secondary, #555);
}
.trs-add {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 8px;
}
.trs-msg {
  margin: 0;
  font-size: 12px;
  color: var(--muted, #888);
}
.muted {
  font-size: 12px;
  color: var(--muted, #999);
}
</style>
