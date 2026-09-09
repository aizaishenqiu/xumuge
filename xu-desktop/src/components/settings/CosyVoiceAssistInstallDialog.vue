<!--
  @file CosyVoice 系统协助安装向导：探测门槛、选盘、披露确认、依赖先行
  @author qiuye <yjk150@qq.com>
  @date 2026-08-31
  @updated 2026-09-01
  @version 1.1.0
  @category UI
  @algo cosyvoice-wizard-steps
-->
<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { FouButton, fouAlert as showFouAlert } from "foucui";
import {
  cosyInstallStageLabel,
  cosyvoiceCancel,
  cosyvoiceInstall,
  cosyvoiceInstallRead,
  cosyvoiceInstallResume,
  cosyvoicePlan,
  cosyvoiceProbe,
  cosyvoiceStatus,
  formatGiB,
  type CosyDisclosure,
  type CosyInstallPlan,
  type CosyProbeReport,
  type CosyStatus,
} from "../../utils/cosyvoiceInstallApi";
import { VOICE_TONE_PRESETS } from "../../utils/voiceTonePresets";

const props = defineProps<{ visible: boolean }>();
const emit = defineEmits<{ "update:visible": [boolean]; done: [] }>();

type Step = "probe" | "form" | "confirm" | "running" | "result";

const step = ref<Step>("probe");
const busy = ref(false);
const probe = ref<CosyProbeReport | null>(null);
const installRoot = ref("");
const modelSource = ref<"modelscope" | "huggingface" | "local">("modelscope");
const localModelPath = ref("");
const selectedModes = ref<string[]>(
  VOICE_TONE_PRESETS.filter((p) =>
    ["female-loli", "female-mature", "female-gentle", "female-cute", "female-angry", "female-happy", "female-sunny", "female-joke"].includes(
      p.id,
    ),
  ).map((p) => p.id),
);
const plan = ref<CosyInstallPlan | null>(null);
const acknowledged = ref(false);
const status = ref<CosyStatus | null>(null);
const resultOk = ref(false);
const canResume = ref(false);
const failedStage = ref("");
const failedReason = ref("");
let pollTimer: ReturnType<typeof setInterval> | null = null;

const open = computed({
  get: () => props.visible,
  set: (v: boolean) => emit("update:visible", v),
});

const disclosure = computed<CosyDisclosure | null>(() => plan.value?.disclosure ?? null);

watch(
  () => props.visible,
  async (v) => {
    if (!v) {
      stopPoll();
      return;
    }
    step.value = "probe";
    acknowledged.value = false;
    plan.value = null;
    resultOk.value = false;
    await runProbe();
  },
);

async function runProbe() {
  busy.value = true;
  try {
    probe.value = await cosyvoiceProbe();
    installRoot.value = probe.value.recommendedInstallRoot;
  } catch (e) {
    await showFouAlert(String(e instanceof Error ? e.message : e));
    open.value = false;
  } finally {
    busy.value = false;
  }
}

function goForm() {
  if (!probe.value) return;
  if (probe.value.blockers.length) {
    void showFouAlert(probe.value.blockers.join("\n"));
    return;
  }
  step.value = "form";
}

async function goConfirm() {
  busy.value = true;
  try {
    const p = await cosyvoicePlan({
      installRoot: installRoot.value.trim(),
      modelSource: modelSource.value,
      localModelPath: localModelPath.value.trim() || undefined,
      modeIds: selectedModes.value,
    });
    plan.value = p;
    if (!p.ok) {
      await showFouAlert(p.errors.join("\n") || "无法开始安装");
      return;
    }
    acknowledged.value = false;
    step.value = "confirm";
  } catch (e) {
    await showFouAlert(String(e instanceof Error ? e.message : e));
  } finally {
    busy.value = false;
  }
}

async function startInstall() {
  if (!plan.value || !acknowledged.value) {
    await showFouAlert("请先勾选「我已阅读并同意」");
    return;
  }
  step.value = "running";
  busy.value = true;
  startPoll();
  try {
    await cosyvoiceInstall(plan.value);
    const s = await cosyvoiceStatus();
    status.value = s;
    resultOk.value = s.phase === "ready";
    step.value = "result";
    if (resultOk.value) {
      emit("done");
      open.value = false;
    }
  } catch (e) {
    status.value = await cosyvoiceStatus().catch(() => null);
    resultOk.value = false;
    step.value = "result";
    await loadInstallFailure();
    await showFouAlert(String(e instanceof Error ? e.message : e));
  } finally {
    busy.value = false;
    stopPoll();
  }
}

async function resumeInstall() {
  const root = (plan.value?.installRoot || status.value?.installRoot || installRoot.value).trim();
  if (!root) {
    await showFouAlert("缺少 installRoot，请返回上一步重新确认");
    return;
  }
  step.value = "running";
  busy.value = true;
  startPoll();
  try {
    await cosyvoiceInstallResume(root);
    const s = await cosyvoiceStatus();
    status.value = s;
    resultOk.value = s.phase === "ready";
    step.value = "result";
    if (resultOk.value) {
      emit("done");
      open.value = false;
    }
  } catch (e) {
    status.value = await cosyvoiceStatus().catch(() => null);
    resultOk.value = false;
    step.value = "result";
    await loadInstallFailure();
    await showFouAlert(String(e instanceof Error ? e.message : e));
  } finally {
    busy.value = false;
    stopPoll();
  }
}

async function loadInstallFailure() {
  try {
    const read = await cosyvoiceInstallRead();
    canResume.value = read.canResume;
    failedStage.value = read.failedStage ?? "";
    failedReason.value = read.failedReason ?? status.value?.lastError ?? "";
  } catch {
    canResume.value = false;
    failedStage.value = "";
    failedReason.value = status.value?.lastError ?? "";
  }
}

function startPoll() {
  stopPoll();
  pollTimer = setInterval(() => {
    void cosyvoiceStatus()
      .then((s) => {
        status.value = s;
      })
      .catch(() => undefined);
  }, 800);
}

function stopPoll() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

async function onCancel() {
  await cosyvoiceCancel();
  stopPoll();
  open.value = false;
}

function toggleMode(id: string) {
  const i = selectedModes.value.indexOf(id);
  if (i >= 0) selectedModes.value.splice(i, 1);
  else selectedModes.value.push(id);
}
</script>

<template>
  <FouDialog
    v-model="open"
    title="CosyVoice 系统协助安装"
    width="640px"
    append-to-body
    :close-on-click-modal="false"
    :show-fullscreen="false"
    :show-minimize="false"
  >
    <div v-if="step === 'probe'" class="wiz">
      <p class="hint">正在对照本机与最低安装条件（不写死某台开发机配置）。</p>
      <div v-if="busy">探测中…</div>
      <template v-else-if="probe">
        <ul class="list">
          <li>NVIDIA：{{ probe.hasNvidia ? "有" : "无" }}，显存 {{ probe.vramMb != null ? `${probe.vramMb} MB` : "未知" }}（建议 ≥8192 MB）</li>
          <li>推荐安装目录：{{ probe.recommendedInstallRoot }}</li>
          <li>Git：{{ probe.hasGit ? "已有" : "缺失" }} · conda：{{ probe.hasConda ? "已有" : "缺失" }} · MSVC：{{ probe.hasMsvc == null ? "未知" : probe.hasMsvc ? "已有" : "缺失" }}</li>
        </ul>
        <p v-if="probe.drives.length" class="sub">各盘剩余：</p>
        <ul class="list">
          <li v-for="d in probe.drives" :key="d.path">{{ d.path }} 剩余 {{ formatGiB(d.freeBytes) }}</li>
        </ul>
        <p v-if="probe.missingDeps.length" class="sub">将尝试安装的缺失依赖：</p>
        <ul class="list">
          <li v-for="d in probe.missingDeps" :key="d.id">{{ d.label }}{{ d.needsElevation ? "（可能需管理员）" : "" }}</li>
        </ul>
        <p v-for="w in probe.warnings" :key="w" class="warn">{{ w }}</p>
        <p v-for="b in probe.blockers" :key="b" class="err">{{ b }}</p>
      </template>
    </div>

    <div v-else-if="step === 'form'" class="wiz">
      <label class="field">安装目录（必填，建议空闲 ≥30GB）
        <input v-model="installRoot" class="inp" type="text" />
      </label>
      <label class="field">模型来源
        <select v-model="modelSource" class="inp">
          <option value="modelscope">ModelScope（推荐）</option>
          <option value="huggingface">HuggingFace（可能超时）</option>
          <option value="local">本机路径</option>
        </select>
      </label>
      <label v-if="modelSource === 'local'" class="field">本机模型路径
        <input v-model="localModelPath" class="inp" type="text" />
      </label>
      <p class="sub">预置语音模式（可多选）：</p>
      <div class="modes">
        <label v-for="p in VOICE_TONE_PRESETS.filter((x) => x.id.startsWith('female-'))" :key="p.id" class="mode">
          <input type="checkbox" :checked="selectedModes.includes(p.id)" @change="toggleMode(p.id)" />
          {{ p.label }}
        </label>
      </div>
    </div>

    <div v-else-if="step === 'confirm' && disclosure" class="wiz">
      <p class="sub">将安装：</p>
      <ul class="list"><li v-for="x in disclosure.willInstall" :key="x">{{ x }}</li></ul>
      <p class="sub">将跳过：</p>
      <ul class="list"><li v-for="x in disclosure.willSkip" :key="x">{{ x }}</li></ul>
      <p class="sub">磁盘约：合计 {{ formatGiB(disclosure.disk.totalSuggestedBytes) }}（环境包 {{ formatGiB(disclosure.disk.envPackagesBytes) }} + 模型 {{ formatGiB(disclosure.disk.modelBytes) }} 等）</p>
      <p class="sub">耗时约：{{ disclosure.time.totalMinutes }}（依赖 {{ disclosure.time.depsMinutes }} / 环境 {{ disclosure.time.envMinutes }} / 模型 {{ disclosure.time.modelMinutes }}）</p>
      <p class="sub">默认模型：{{ disclosure.defaultModel }}</p>
      <ul class="list"><li v-for="n in disclosure.notes" :key="n">{{ n }}</li></ul>
      <label class="mode">
        <input v-model="acknowledged" type="checkbox" />
        我已阅读并同意上述磁盘、耗时与依赖安装说明
      </label>
    </div>

    <div v-else-if="step === 'running'" class="wiz">
      <p>安装进行中… {{ status?.phase }} {{ status?.percent ?? 0 }}%</p>
      <p>{{ status?.message }}</p>
      <ul class="list">
        <li v-for="d in status?.deps || []" :key="d.id">{{ d.label }} · {{ d.state }}</li>
      </ul>
    </div>

    <div v-else-if="step === 'result'" class="wiz">
      <p :class="resultOk ? 'ok' : 'err'">
        {{ resultOk ? `阶段：${status?.phase || "完成"}。${status?.message || ""}` : failedReason || status?.lastError || "安装未成功" }}
      </p>
      <p v-if="!resultOk && failedStage" class="warn">
        断点：{{ cosyInstallStageLabel(failedStage) }}
      </p>
    </div>

    <template #footer>
      <FouButton icon="close-line" variant="ghost" :disabled="busy && step === 'running'" @click="onCancel">取消</FouButton>
      <FouButton v-if="step === 'probe'" icon="arrow-right-line" :loading="busy" :disabled="!!probe?.blockers?.length" @click="goForm">下一步</FouButton>
      <FouButton v-else-if="step === 'form'" icon="arrow-right-line" :loading="busy" @click="goConfirm">生成确认清单</FouButton>
      <FouButton v-else-if="step === 'confirm'" icon="download-cloud-2-line" :loading="busy" :disabled="!acknowledged" @click="startInstall">开始安装</FouButton>
      <FouButton
        v-else-if="step === 'result' && !resultOk && canResume"
        icon="play-circle-line"
        :loading="busy"
        @click="resumeInstall"
      >
        继续安装
      </FouButton>
      <FouButton v-else-if="step === 'result'" icon="check-line" @click="open = false">关闭</FouButton>
    </template>
  </FouDialog>
</template>

<style scoped>
.wiz { display: flex; flex-direction: column; gap: 10px; max-height: 60vh; overflow: auto; }
.hint, .sub { margin: 0; opacity: 0.85; font-size: 13px; }
.list { margin: 0; padding-left: 1.2em; font-size: 13px; }
.warn { color: #b45309; margin: 0; font-size: 13px; }
.err { color: #b91c1c; margin: 0; font-size: 13px; }
.ok { color: #047857; }
.field { display: flex; flex-direction: column; gap: 4px; font-size: 13px; }
.inp { padding: 6px 8px; border: 1px solid var(--fou-border, #ddd); border-radius: 6px; }
.modes { display: flex; flex-wrap: wrap; gap: 8px 12px; }
.mode { display: flex; align-items: center; gap: 6px; font-size: 13px; }
</style>
