<!--
  @file 语音与朗读设置、语气与角色、语音包安装及试听
  @author qiuye <yjk150@qq.com>
  @date 2026-08-30
  @updated 2026-09-03
  @version 3.24.4
  @category UI
  @algo voice-settings-ia-seven-tabs
-->
<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import {
  FouButton,
  FouCheckbox,
  FouInput,
  FouSelect,
  FouTabBar,
  FouTabPane,
  fouAlert as showFouAlert,
  fouConfirmPromise,
  fouMsg,
} from "foucui";
import PageHelpButton from "../help/PageHelpButton.vue";
import CosyVoiceAssistInstallDialog from "./CosyVoiceAssistInstallDialog.vue";
import {
  cosyInstallStageLabel,
  cosyvoiceDiscover,
  cosyvoiceInstallRead,
  cosyvoiceInstallResume,
  type CosyDiscoverReport,
  type CosyInstallRead,
} from "../../utils/cosyvoiceInstallApi";
import { probeCosyBackend } from "../../utils/cosyvoiceSynthApi";
import {
  voicePackEtaLabel,
  voicePackProgressAmount,
  voicePackProgressPercent,
  voicePackStageLabel,
} from "../../utils/voicePackProgressUi";
import {
  COSY_CUSTOM_HTTP_API_KEY_ENV,
  COSY_DASHSCOPE_API_KEY_ENV,
  healVoiceSettingsToUsable,
  loadVoiceSettings,
  saveVoiceSettings,
  WAKE_LANG_OPTIONS,
  type CosyBackendId,
  type VoiceSettings,
} from "../../stores/voiceSettings";
import { setStoredApiKey, isApiKeyConfigured } from "../../utils/apiKeys";
import { cosyConsoleOpen } from "../../utils/cosyConsoleApi";
import {
  createCosyFastapiPlayer,
  probeFastapiUrl,
  type CosyFastapiHealth,
} from "../../utils/cosyFastapiClient";
import {
  COSY_FASTAPI_BUILTIN_SPK,
  COSY_MATRIX_UTTERANCE,
  builtinSpkGender,
  defaultCosyBuiltinSpkId,
  filterCosyVoicesByGender,
  scanCosyFastapiVoices,
  type CosyFastapiVoicePreset,
} from "../../utils/cosyFastapiVoices";
import { ensureSystemCosyVoices } from "../../utils/cosySystemVoices";
import {
  cosyFastapiSidecarStatus,
  setCosyWantRunning,
  startCosyFastapiSidecar,
  stopCosyFastapiSidecar,
} from "../../utils/cosyFastapiSidecarApi";
import { waitCosyFastapiHealthy, ensureCosyAutostartOnce } from "../../utils/cosyAutostart";
import { listenVoiceRouteOverride } from "../../utils/applyVoiceRouteOverride";
import {
  listSystemVoices,
  resolveTtsProvider,
  CosyFastapiProvider,
  SystemWebSpeechProvider,
  type TtsProvider,
} from "../../utils/ttsProvider";
import {
  cancelVoiceTask,
  catalogEntriesForProvider,
  createVoiceRequestId,
  hasVendorVoicePackDownloadConfig,
  installVoicePack,
  listVoicePacks,
  loadVoicePackCatalog,
  onVoicePackProgress,
  resolveCatalogInstallUrl,
  resolveVoicePackSiteDownloadTarget,
  resolveVoicePackSiteUrl,
  stageLocalVoicePack,
  uninstallVoicePack,
  vendorCatalogEntries,
  type InstalledVoicePack,
  type VoicePackCatalogEntry,
  type VoicePackProgress,
  type VoiceProviderId,
} from "../../utils/voicePacks";
import {
  canSelectOfflineAsCurrent,
  fetchVoiceEngineStatus,
  liftCosyOfflineCapability,
  offlineProviderButtonLabel,
  resolveOfflineCapability,
  type OfflineVoiceCapability,
  type VoiceEngineStatus,
} from "../../utils/voiceEngineCapability";
import { isCosyFastapiWarmFresh } from "../../utils/cosyFastapiWarm";
import {
  engineToneBlurb,
  listTimbresForProvider,
  providerNeedsGpuHint,
  resolveCosyVoiceToneParams,
  resolveProsody,
} from "../../utils/voiceToneEngineMap";
import {
  DEFAULT_MOOD_ID,
  getVoiceMoodPreset,
  listMoodsForGender,
} from "../../utils/voiceMoodPresets";
import {
  DEFAULT_TIMBRE_ID,
  getVoiceTimbrePreset,
  listTimbresByGender,
  systemVoiceDirId,
  type VoiceGender,
} from "../../utils/voiceTimbrePresets";
import { getVoiceTonePreset, matchSystemVoiceForTone, toneRequiresCosy } from "../../utils/voiceTonePresets";
import { syncVoiceToTone } from "../../utils/voiceToneSync";
import { formatSystemVoiceLabel, filterZhSystemVoices, filterSystemVoicesByGender, systemHasGender, inferSystemVoiceGender } from "../../utils/systemVoiceLabels";
import { previewUtteranceForTone } from "../../utils/assistantOralPersona";
import {
  KOKORO_TONE_BLURB,
  isKokoroVoiceId,
  kokoroVoiceGender,
  listKokoroVoicesByGender,
  listKokoroVoicesForUi,
  resolveKokoroVoiceId,
} from "../../utils/kokoroVoiceMap";
import { primeKokoroPreviewCache } from "../../utils/kokoroPreviewCache";
import {
  loadVoiceAssistantId,
  saveVoiceAssistantId,
  VOICE_ASSISTANT_PRESETS,
} from "../../utils/voiceAssistantPrefs";
import {
  isVirmoorDownloadAuthorized,
  virmoorDownloadLoginMessage,
} from "../../utils/voicePackDownloadApi";
import {
  cancelVoiceNativeInstall,
  ensureVoiceEspeak,
  installVoiceNative,
  onVoiceNativeProgress,
  probeVoiceNative,
  warmupKokoro,
} from "../../utils/voiceNativeInstallApi";
import {
  loadVoicePackVendorUrl,
  saveVoicePackVendorUrl,
} from "../../utils/voicePackVendorPrefs";
import {
  defaultPersonaScenarios,
  loadPersonaTraining,
  savePersonaTraining,
} from "../../training/personaTraining";
import { AsyncGenerationGuard, retainAsyncDisposer } from "../../utils/asyncLifecycle";
import { toUserError } from "../../utils/userFacingError";
import { isVoiceWakeListening, getVoiceWakeStatus } from "../../utils/voiceWake";
import { XU_VOICE_WAKE_REFRESH, isVoiceAssistantOverlayOpen } from "../../utils/voiceAssistantOpen";
import { getGlobalSpeechRecOwner } from "../../utils/voiceCall";

const settings = ref<VoiceSettings>(loadVoiceSettings());
const wakePhrasesDraft = ref(settings.value.wakePhrases.join("，"));
const wakeListenHint = ref("");
let wakeListenPoll: ReturnType<typeof setInterval> | null = null;
const wakeLangOptions = WAKE_LANG_OPTIONS.map((o) => ({ label: o.label, value: o.value }));
const router = useRouter();
const packs = ref<InstalledVoicePack[]>([]);
const systemVoices = ref<SpeechSynthesisVoice[]>([]);
const engineStatus = ref<Record<string, VoiceEngineStatus>>({});
const catalogEntries = ref<VoicePackCatalogEntry[]>([]);
const voicePackSiteUrl = ref("");
const catalogError = ref("");
const showAcquirePanel = ref(false);
const pendingProvider = ref<Exclude<VoiceProviderId, "system-webspeech"> | null>(null);
const installUrl = ref("");
const vendorSiteUrl = ref(loadVoicePackVendorUrl());
/** 厂商自定义 catalog：默认折叠，主路径走虚募阁下载中心 API */
const showVendorAdvanced = ref(false);
const installRequestId = ref("");
const installBusy = ref(false);
const previewBusy = ref(false);
const personaScenarioCount = ref(0);
const progress = ref<VoicePackProgress | null>(null);
const progressStageStartedAt = ref(0);
const lastProgressStage = ref("");
let stopProgress: (() => void) | null = null;
let stopNativeProgress: (() => void) | null = null;
let previewProvider: TtsProvider | null = null;
let disposed = false;
const previewGuard = new AsyncGenerationGuard();
let offlinePreviewHintShown = false;

const providerLabels: Record<VoiceProviderId, string> = {
  "system-webspeech": "系统语音",
  "sherpa-onnx": "离线语音",
  cosyvoice: "CosyVoice 扩展",
};

const showCosyAssist = ref(false);
const cosyDashKeyDraft = ref("");
const cosyCustomKeyDraft = ref("");
const cosyKeyConfigured = ref({ dashscope: false, custom: false });
const cosyBackendHint = ref("");
const cosyFastapiVoices = ref<CosyFastapiVoicePreset[]>([]);
const cosySidecarHint = ref("");
const cosyLocalHealth = ref<CosyFastapiHealth | null>(null);
const cosySidecarBusy = ref(false);
const cosyMatrixBusy = ref(false);
const showCosyAdvanced = ref(false);
/** 顶栏七页签：见 docs/plans/2026-09-02-voice-settings-ia.md */
type VoicePanelTabId =
  | "defaults"
  | "wake"
  | "system"
  | "offline"
  | "cosy"
  | "packs"
  | "api";
const voicePanelTab = ref<VoicePanelTabId>("defaults");
let cosyHeavyBootstrapped = false;

/** 顶部分区切换 */
function onVoicePanelTabChange(name: string | number) {
  voicePanelTab.value = String(name) as VoicePanelTabId;
}

watch(voicePanelTab, (tab) => {
  if (tab === "wake") {
    refreshWakeListenHint();
    if (!wakeListenPoll) {
      wakeListenPoll = window.setInterval(() => {
        if (!disposed) refreshWakeListenHint();
      }, 1000);
    }
  } else if (wakeListenPoll) {
    clearInterval(wakeListenPoll);
    wakeListenPoll = null;
  }
  if (tab === "offline" || tab === "packs") {
    pendingProvider.value = "sherpa-onnx";
    showAcquirePanel.value = true;
    void refreshCatalog();
  }
  if (tab === "cosy") {
    void ensureCosyHeavyBootstrap();
    // 已引导过也再刷候选，避免漏 Fun-CosyVoice3
    if (cosyHeavyBootstrapped) {
      void runCosyAutoDiscover(true, undefined, true).catch(() => null);
    }
  }
  if (
    tab === "defaults" ||
    tab === "system" ||
    tab === "offline" ||
    tab === "cosy" ||
    tab === "api"
  ) {
    void refreshEngineStatus().then(() => {
      if (!disposed) maybeWarmKokoroForAudition();
    });
  }
  if (tab === "api") void refreshCosyKeyFlags();
});

const cosyPreviewText = ref("");
const systemPreviewText = ref("");
const offlinePreviewText = ref("");
const cosyModelCandidates = ref<string[]>([]);
const cosyDiscoverReport = ref<CosyDiscoverReport | null>(null);
const cosyDiscoverBusy = ref(false);
const cosyConsoleBusy = ref(false);
const cosyInstallRead = ref<CosyInstallRead | null>(null);
const cosyInstallBusy = ref(false);
const showCosyZipPack = ref(false);
const cosyEnvReadyHint = ref("");
const voiceInitBusy = ref(false);
let matrixPlayer: ReturnType<typeof createCosyFastapiPlayer> | null = null;

/**
 * 试听引擎：在系统/离线/Cosy/API 页跟页签走，其它页跟当前默认。
 */
const uiVoiceContext = computed((): VoiceProviderId => {
  switch (voicePanelTab.value) {
    case "system":
      return "system-webspeech";
    case "offline":
      return "sherpa-onnx";
    case "cosy":
    case "api":
      return "cosyvoice";
    default:
      return settings.value.provider;
  }
});

const defaultSummaryLabel = computed(() => {
  const s = settings.value;
  const eng = providerLabels[s.provider] || "系统语音";
  if (s.provider === "system-webspeech") {
    const hit = filterZhSystemVoices(systemVoices.value).find((v) => v.voiceURI === s.voice);
    const name = hit ? formatSystemVoiceLabel(hit) : s.voice || "系统默认";
    return `${eng} · ${name}`;
  }
  if (s.provider === "sherpa-onnx") {
    const id = resolveKokoroVoiceId(s.voice);
    const known = listKokoroVoicesForUi().find((v) => v.id === id);
    const g = kokoroVoiceGender(id) === "male" ? "男" : "女";
    return `${eng} · ${g} · ${known?.label || id}`;
  }
  const g = s.voiceGender === "male" ? "男" : "女";
  const timbre =
    listTimbresForProvider("cosyvoice", s.voiceGender).find((t) => t.id === s.timbreId)?.label ||
    s.timbreId;
  const mood = moodOptions.value.find((o) => o.value === s.moodId)?.label || s.moodId;
  const backend =
    s.cosyBackend === "fastapi" ? "本机" : s.cosyBackend === "dashscope" ? "DashScope" : "远程";
  return `${eng}（${backend}） · ${g} · ${timbre} · ${mood}`;
});

const assistantBackgroundId = ref(loadVoiceAssistantId() || VOICE_ASSISTANT_PRESETS[0]?.id || "");
const assistantBackgroundOptions = computed(() =>
  VOICE_ASSISTANT_PRESETS.map((p) => ({
    label: `${p.genderLabel} · ${p.name}`,
    value: p.id,
  })),
);

function onAssistantBackgroundChange(id: string) {
  assistantBackgroundId.value = id;
  saveVoiceAssistantId(id);
}

/** 跳转到当前默认引擎的音色页 */
function goTuneCurrentEngine() {
  const p = settings.value.provider;
  if (p === "system-webspeech") voicePanelTab.value = "system";
  else if (p === "sherpa-onnx") voicePanelTab.value = "offline";
  else if (settings.value.cosyBackend === "fastapi") voicePanelTab.value = "cosy";
  else voicePanelTab.value = "api";
}

async function setCosyVoiceVersion(v2: boolean) {
  if (settings.value.cosyVoice2 === v2) return;
  persist({ cosyVoice2: v2 });
  let running = false;
  try {
    const st = await cosyFastapiSidecarStatus();
    running = Boolean(st.running);
  } catch {
    running = false;
  }
  if (running) {
    const decision = await fouConfirmPromise(
      v2
        ? "已改为 CosyVoice2/3（参考音模式）。须重启本机服务后才会按新模式合成。现在重启？"
        : "已改为 CosyVoice1（内置说话人）。须重启本机服务后才会按新模式合成。现在重启？",
      "切换版本",
    );
    if (decision === "confirm") {
      await stopCosySidecar();
      await startCosySidecar();
    } else {
      fouMsg.info("版本已保存；下次启动服务时生效。");
    }
  } else {
    fouMsg.info(v2 ? "已选 CosyVoice2/3（参考音），启动服务后按此运行。" : "已选 CosyVoice1（内置说话人），启动服务后按此运行。");
  }
}

/** 自动检测推断的版本（不覆盖用户选择） */
const detectedCosyVoice2 = ref<boolean | null>(null);
const cosyWarmReady = ref(false);

const cosyVersionStatusLabel = computed(() => {
  const chosen = settings.value.cosyVoice2 ? "CosyVoice2/3（参考音）" : "CosyVoice1（内置说话人）";
  const modelPath = (settings.value.cosyModelDir || "").trim();
  const modelName = modelPath
    ? modelPath.replace(/\\/g, "/").split("/").filter(Boolean).pop() || modelPath
    : "未选模型目录";
  const detected =
    detectedCosyVoice2.value == null
      ? "未检测"
      : detectedCosyVoice2.value
        ? "检测像 CosyVoice2/3"
        : "检测像 CosyVoice1";
  const run = cosySidecarHint.value || "服务状态未知";
  return `当前模式：${chosen} · 模型：${modelName} · ${detected} · ${run}`;
});

const cosyModelSelectOptions = computed(() => {
  const packRe = /(^|[\\/])(CosyVoice[23][^\\/]*|Fun-CosyVoice[^\\/]*)$/i;
  const paths = [...cosyModelCandidates.value].filter((p) => packRe.test(p.replace(/\\/g, "/")));
  const cur = settings.value.cosyModelDir.trim();
  if (cur && !paths.includes(cur) && packRe.test(cur.replace(/\\/g, "/"))) {
    paths.unshift(cur);
  } else if (cur && !paths.includes(cur) && /CosyVoice[23]|Fun-CosyVoice/i.test(cur)) {
    // keep hand-picked pack even if path shape differs slightly
    paths.unshift(cur);
  }
  return paths.map((path) => {
    const name = path.replace(/\\/g, "/").split("/").filter(Boolean).pop() || path;
    return { label: name, value: path };
  });
});

async function selectCosyModelDir(path: string) {
  const next = String(path || "").trim();
  if (!next || next === settings.value.cosyModelDir.trim()) return;
  const looksV2 = /CosyVoice[23]|Fun-CosyVoice/i.test(next);
  persist({ cosyModelDir: next, cosyVoice2: looksV2 ? true : settings.value.cosyVoice2 });
  fouMsg.info("模型目录已更新；请到「本机 FastAPI」重启服务后生效。");
}

const cosyInstallPhase = computed(() => {
  const phase = String(cosyInstallRead.value?.installJson?.phase ?? "");
  return phase || "unknown";
});

const cosyInstallResumeLabel = computed(() => {
  const stage = cosyInstallRead.value?.failedStage;
  const reason = cosyInstallRead.value?.failedReason;
  if (!stage) return "";
  const label = cosyInstallStageLabel(stage);
  return reason ? `上次断在：${label}（${reason}）` : `上次断在：${label}`;
});

const cosyDiscoverStatusLines = computed(() => {
  const lines = cosyDiscoverReport.value?.notes ?? [];
  if (cosyFastapiVoices.value.length) {
    return [...lines, `已识别 ${cosyFastapiVoices.value.length} 个参考音色。`];
  }
  return lines;
});

function applyDiscoverReport(report: CosyDiscoverReport) {
  cosyDiscoverReport.value = report;
  const candidates = (
    Array.isArray(report.modelCandidates) && report.modelCandidates.length
      ? report.modelCandidates
      : report.modelDir
        ? [report.modelDir]
        : []
  ).filter((p) => /(^|[\\/])(CosyVoice[23][^\\/]*|Fun-CosyVoice[^\\/]*)$/i.test(String(p).replace(/\\/g, "/")));
  cosyModelCandidates.value = candidates;
  if (typeof report.cosyVoice2 === "boolean") {
    detectedCosyVoice2.value = report.cosyVoice2;
  }
  // 有手选且仍在候选里：绝不被「CV3 优先」覆盖
  const existing = settings.value.cosyModelDir.trim();
  const existingStillValid =
    Boolean(existing) &&
    (candidates.some((p) => p.replace(/\\/g, "/").toLowerCase() === existing.replace(/\\/g, "/").toLowerCase()) ||
      candidates.some((p) => p.replace(/\\/g, "/").toLowerCase().endsWith(existing.replace(/\\/g, "/").split("/").pop() || "__none__")));
  const selectedModel = existingStillValid ? existing : report.modelDir || existing;
  const selectedUsesReference =
    /cosyvoice[23]|fun-cosyvoice/i.test(selectedModel) || report.cosyVoice2 === true;
  persist({
    cosyBackend: "fastapi",
    cosyPython: report.python ?? settings.value.cosyPython,
    cosyServerScript: report.serverScript ?? settings.value.cosyServerScript,
    cosyModelDir: selectedModel,
    cosyVoicesRoot: report.voicesRoot ?? settings.value.cosyVoicesRoot,
    cosyFastapiBaseUrl: report.baseUrl || settings.value.cosyFastapiBaseUrl,
    cosyScanRoot: report.scanRoot || settings.value.cosyScanRoot,
    cosyDefaultPromptWav: report.defaultPromptWav ?? settings.value.cosyDefaultPromptWav,
    cosyDefaultPromptText: report.defaultPromptText ?? settings.value.cosyDefaultPromptText,
    cosyVoice2: selectedUsesReference,
  });
}

/** 自动探测本机 CosyVoice 路径并写入 settings。 */
async function runCosyAutoDiscover(
  silent = false,
  optionalRoot?: string,
  forceRefresh = false,
): Promise<CosyDiscoverReport | null> {
  cosyDiscoverBusy.value = true;
  try {
    const report = await cosyvoiceDiscover({
      optionalRoot: optionalRoot || settings.value.cosyScanRoot || undefined,
      hintPython: settings.value.cosyPython || undefined,
      hintServer: settings.value.cosyServerScript || undefined,
      preferredModel: settings.value.cosyModelDir || undefined,
      useCache: !optionalRoot && !forceRefresh,
    });
    applyDiscoverReport(report);
    await refreshCosyFastapiVoices();
    if (!silent) {
      if (report.ok) {
        fouMsg.success("已自动识别 CosyVoice 路径");
      } else {
        await showFouAlert(
          report.notes.join("\n") || "未完整识别路径，可选 Cosy 根目录后重试。",
          "自动检测",
        );
      }
    }
    return report;
  } catch (error) {
    if (!silent) {
      await showFouAlert(sanitizeUserMessage(error, "自动检测失败"), "CosyVoice");
    }
    return null;
  } finally {
    cosyDiscoverBusy.value = false;
  }
}

async function pickCosyScanRoot() {
  const picked = await openFileDialog({
    directory: true,
    multiple: false,
    title: "选择 CosyVoice 根目录（如含 CosyVoice/runtime 的上级目录）",
  });
  if (!picked || Array.isArray(picked)) return;
  persist({ cosyScanRoot: String(picked) });
  await runCosyAutoDiscover(false, String(picked));
}

async function copyCosyPath(text: string) {
  const v = text.trim();
  if (!v) return;
  try {
    await navigator.clipboard.writeText(v);
    fouMsg.success("已复制路径");
  } catch {
    await showFouAlert("复制失败，请手动选择复制。", "路径");
  }
}

async function ensureCosyPathsReady(): Promise<boolean> {
  if (settings.value.cosyPython.trim() && settings.value.cosyServerScript.trim()) {
    return true;
  }
  const report = await runCosyAutoDiscover(true);
  return !!(report?.python && report?.serverScript);
}

/** 在独立窗口打开 CosyVoice Web 控制台（tools/console/index.html）。 */
async function openCosyConsoleWindow() {
  cosyConsoleBusy.value = true;
  try {
    await cosyConsoleOpen();
    fouMsg.success("已打开 CosyVoice 控制台");
  } catch (error) {
    await showFouAlert(sanitizeUserMessage(error, "无法打开控制台"), "CosyVoice");
  } finally {
    cosyConsoleBusy.value = false;
  }
}

function cosyProbeUrl(): string {
  return settings.value.cosyBackend === "fastapi"
    ? settings.value.cosyFastapiBaseUrl
    : settings.value.cosyCustomBaseUrl;
}

async function seedSystemCosyVoicesSilent() {
  try {
    const result = await ensureSystemCosyVoices({
      voicesRoot: settings.value.cosyVoicesRoot,
      defaultPromptWav: settings.value.cosyDefaultPromptWav,
      defaultPromptText: settings.value.cosyDefaultPromptText,
      persistRoot: true,
    });
    if (result.voicesRoot) {
      settings.value = loadVoiceSettings();
    }
  } catch {
    /* 后台补种失败不打断设置页 */
  }
}

async function refreshCosyFastapiVoices() {
  await seedSystemCosyVoicesSilent();
  const root = loadVoiceSettings().cosyVoicesRoot.trim() || settings.value.cosyVoicesRoot.trim();
  if (!root) {
    cosyFastapiVoices.value = [];
    return;
  }
  if (root !== settings.value.cosyVoicesRoot) {
    settings.value = loadVoiceSettings();
  }
  try {
    const all = await scanCosyFastapiVoices(root);
    cosyFastapiVoices.value = [
      ...all.filter((v) => v.id.startsWith("sys-")),
      ...all.filter((v) => !v.id.startsWith("sys-")),
    ];
  } catch (error) {
    cosyFastapiVoices.value = [];
    await showFouAlert(sanitizeUserMessage(error, "扫描音色库失败"), "音色库");
  }
}

async function pickCosyVoicesRoot() {
  const picked = await openFileDialog({
    directory: true,
    multiple: false,
    title: "选择 CosyVoice 参考音色库目录",
  });
  if (!picked || Array.isArray(picked)) return;
  persist({ cosyVoicesRoot: String(picked) });
  await refreshCosyFastapiVoices();
}

async function pickCosyPath(field: "cosyPython" | "cosyServerScript" | "cosyModelDir") {
  const isDir = field === "cosyModelDir";
  const picked = await openFileDialog({
    directory: isDir,
    multiple: false,
    title:
      field === "cosyPython"
        ? "选择 Python 可执行文件"
        : field === "cosyServerScript"
          ? "选择 server.py"
          : "选择 model_dir",
    filters: isDir
      ? undefined
      : field === "cosyPython"
        ? [{ name: "Executable", extensions: ["exe", "*"] }]
        : [{ name: "Python", extensions: ["py"] }],
  });
  if (!picked || Array.isArray(picked)) return;
  persist({ [field]: String(picked) });
}

async function refreshCosyInstallStatus() {
  try {
    cosyInstallRead.value = await cosyvoiceInstallRead();
  } catch {
    cosyInstallRead.value = null;
  }
}

async function healCosyBackendFromInstall() {
  await refreshCosyInstallStatus();
  const read = cosyInstallRead.value;
  if (!read) return;
  const endpoint = read.installJson?.endpoint;
  if (typeof endpoint === "string" && endpoint.trim() && !settings.value.cosyCustomBaseUrl.trim()) {
    persist({ cosyBackend: "customHttp", cosyCustomBaseUrl: endpoint.trim() });
  }
  if (cosyInstallPhase.value === "ready" && settings.value.cosyBackend === "fastapi") {
    const key = "xu.cosy.ready.hint.v1";
    if (!sessionStorage.getItem(key)) {
      sessionStorage.setItem(key, "1");
      cosyEnvReadyHint.value =
        "协助安装环境已就绪。将自动检测路径；请点「启动服务」后探测后端。";
    }
  }
}

async function applyLaunchHintsFromInstall() {
  await runCosyAutoDiscover(false, undefined, true);
}

async function resumeCosyInstall() {
  const root = String(cosyInstallRead.value?.installJson?.installRoot ?? "").trim();
  if (!root) {
    await showFouAlert("install.json 缺少 installRoot，请重新运行协助安装。", "无法续装");
    return;
  }
  cosyInstallBusy.value = true;
  try {
    await cosyvoiceInstallResume(root);
    await refreshCosyInstallStatus();
    await refreshEngineStatus();
    fouMsg.success("续装完成");
    if (cosyInstallPhase.value === "ready") {
      await onCosyAssistDone();
    }
  } catch (error) {
    await refreshCosyInstallStatus();
    await showFouAlert(sanitizeUserMessage(error, "续装失败"), "安装失败");
  } finally {
    cosyInstallBusy.value = false;
  }
}

async function showCosyInstallLog() {
  await refreshCosyInstallStatus();
  const tail = cosyInstallRead.value?.logTail ?? [];
  const summary = cosyInstallResumeLabel.value || "暂无断点信息";
  await showFouAlert(
    tail.length ? `${summary}\n\n--- 安装日志（末尾）---\n${tail.slice(-24).join("\n")}` : summary,
    "安装日志",
  );
}

async function onCosyAssistDone() {
  await refreshCosyInstallStatus();
  await refreshEngineStatus();
  persist({ cosyBackend: "fastapi" });
  const report = await runCosyAutoDiscover(true);
  if (report?.python && report?.serverScript) {
    await startCosySidecar();
    await probeSelectedCosyBackend();
  }
}

function defaultCosyPreviewText(): string {
  return previewUtteranceForTone(settings.value.toneId) || "你好，这是 CosyVoice 试听。";
}

async function refreshCosyKeyFlags() {
  cosyKeyConfigured.value = {
    dashscope: await isApiKeyConfigured(COSY_DASHSCOPE_API_KEY_ENV),
    custom: await isApiKeyConfigured(COSY_CUSTOM_HTTP_API_KEY_ENV),
  };
}

async function saveCosyBackend(backend: CosyBackendId) {
  persist({ cosyBackend: backend });
  await refreshEngineStatus();
  if (backend === "fastapi") await refreshCosyFastapiVoices();
}

async function probeCosyBackendSilent() {
  try {
    const p = await withTimeout(
      probeCosyBackend(settings.value.cosyBackend, cosyProbeUrl()),
      8000,
      "探测后端",
    );
    cosyBackendHint.value = p.reason;
    void refreshEngineStatus();
    return p;
  } catch {
    cosyBackendHint.value = "探测后端超时或失败";
    return null;
  }
}

async function probeSelectedCosyBackend() {
  try {
    const p = await probeCosyBackend(settings.value.cosyBackend, cosyProbeUrl());
    cosyBackendHint.value = p.reason;
    if (!p.ready) {
      await showFouAlert(p.reason, "CosyVoice 未就绪");
    } else {
      fouMsg.success(p.reason);
    }
    await refreshEngineStatus();
  } catch (error) {
    await showFouAlert(sanitizeUserMessage(error, "探测失败"), "CosyVoice");
  }
}

/** 只探测本机 Xu sidecar，禁止复用 DashScope/自建后端的 ready。 */
async function refreshCosyFastapiHealth(showError = false): Promise<CosyFastapiHealth | null> {
  try {
    const probe = await probeFastapiUrl(settings.value.cosyFastapiBaseUrl);
    cosyLocalHealth.value = probe.ready ? probe.health ?? null : null;
    // 不根据运行中模型悄悄改用户模式；换模型须用户停启服务。
    if (!probe.ready && showError) {
      await showFouAlert(probe.reason, "本机 CosyVoice 未就绪");
    }
    return cosyLocalHealth.value;
  } catch (error) {
    cosyLocalHealth.value = null;
    if (showError) {
      await showFouAlert(sanitizeUserMessage(error, "本机 CosyVoice 探测失败"), "探测失败");
    }
    return null;
  }
}

async function startCosySidecar() {
  cosySidecarBusy.value = true;
  try {
    if (!(await ensureCosyPathsReady())) {
      await showFouAlert("未能识别语音服务。请点「自动检测」或选择 Cosy 根目录。", "无法启动");
      return;
    }
    const st = await startCosyFastapiSidecar({
      python: settings.value.cosyPython,
      serverScript: settings.value.cosyServerScript,
      modelDir: settings.value.cosyModelDir,
      extraArgs: settings.value.cosyExtraArgs,
      port: 50000,
    });
    cosySidecarHint.value = st.running
      ? `已启动（pid ${st.pid ?? "?"}），等待 API 就绪…`
      : st.lastError || "未在运行";
    if (st.running) {
      persist({ cosyWantRunning: true });
      try {
        await setCosyWantRunning({
          want: true,
          python: settings.value.cosyPython,
          serverScript: settings.value.cosyServerScript,
          model: settings.value.cosyModelDir,
          port: 50000,
          extraArgs: settings.value.cosyExtraArgs,
        });
      } catch {
        // 磁盘标记失败不挡本机使用
      }
      const healthy = await waitCosyFastapiHealthy(settings.value.cosyFastapiBaseUrl, 90_000, 2_000);
      if (healthy) {
        const health = await refreshCosyFastapiHealth();
        cosySidecarHint.value = health
          ? `已启动且就绪（pid ${st.pid ?? "?"}，${health.modelFamily}，脚本 ${health.scriptVersion}）`
          : `已启动（pid ${st.pid ?? "?"}），但身份校验未通过`;
        await probeCosyBackendSilent();
        void refreshCosyFastapiVoices();
        const { warmCosyFastapiQuiet } = await import("../../utils/cosyFastapiWarm");
        void warmCosyFastapiQuiet({ force: true }).then((ok) => {
          if (!disposed) cosyWarmReady.value = Boolean(ok);
        });
      } else {
        cosySidecarHint.value = `进程在跑（pid ${st.pid ?? "?"}），模型仍在加载；稍后点「探测后端」`;
        cosyBackendHint.value = "FastAPI 进程已启，API 尚未就绪（模型加载较慢属正常）";
      }
    } else {
      await probeCosyBackendSilent();
    }
  } catch (error) {
    await showFouAlert(sanitizeUserMessage(error, "启动失败"), "CosyVoice FastAPI");
  } finally {
    cosySidecarBusy.value = false;
  }
}

async function stopCosySidecar() {
  cosySidecarBusy.value = true;
  try {
    const st = await stopCosyFastapiSidecar();
    cosyLocalHealth.value = null;
    cosyWarmReady.value = false;
    cosySidecarHint.value = st.running ? "仍在运行" : "已停止";
    persist({ cosyWantRunning: false });
    try {
      await setCosyWantRunning({ want: false });
    } catch {
      // ignore
    }
  } catch (error) {
    await showFouAlert(sanitizeUserMessage(error, "停止失败"), "CosyVoice FastAPI");
  } finally {
    cosySidecarBusy.value = false;
  }
}

async function refreshCosySidecarStatus() {
  try {
    const st = await cosyFastapiSidecarStatus();
    const health = st.running ? await refreshCosyFastapiHealth() : null;
    cosySidecarHint.value = st.running
      ? health
        ? `运行中 pid=${st.pid ?? "?"} · ${health.modelFamily} · 脚本 ${health.scriptVersion}`
        : `运行中 pid=${st.pid ?? "?"}，等待身份校验`
      : st.lastError || "未由本应用启动（可自行外启后探测）";
  } catch {
    cosySidecarHint.value = "";
  }
}

/** 音色 × 心情穷测：行=当前性别音色，列=心情；杜绝男声×夹子。 */
async function runCosyVoiceEmotionMatrix(single?: { timbreId: string; moodId: string }) {
  if (settings.value.cosyBackend !== "fastapi") {
    await showFouAlert("穷测仅支持「本地 FastAPI」后端。", "穷测");
    return;
  }
  const baseUrl = settings.value.cosyFastapiBaseUrl.trim();
  if (!baseUrl) {
    await showFouAlert("请先填写 FastAPI Base URL。", "穷测");
    return;
  }
  await refreshCosyFastapiVoices();
  const gender = settings.value.voiceGender;
  const timbres = listTimbresForProvider("cosyvoice", gender).filter(
    (t) => t.requiresCosy || t.autoSeed,
  );
  const moods = listMoodsForGender(gender);
  const pairs = single
    ? [{ timbreId: single.timbreId, moodId: single.moodId }]
    : timbres.flatMap((t) => moods.map((m) => ({ timbreId: t.id, moodId: m.id })));
  if (!pairs.length) {
    await showFouAlert("当前性别下没有可测的音色或心情。", "穷测");
    return;
  }
  cosyMatrixBusy.value = true;
  matrixPlayer?.stop();
  matrixPlayer = createCosyFastapiPlayer();
  const failures: string[] = [];
  const scanned = filterCosyVoicesByGender(cosyFastapiVoices.value, gender);
  try {
    for (const row of pairs) {
      if (!matrixPlayer) break;
      const timbre = getVoiceTimbrePreset(row.timbreId);
      const mood = getVoiceMoodPreset(row.moodId);
      const mapped = resolveCosyVoiceToneParams(row.timbreId, row.moodId);
      const sysId = systemVoiceDirId(row.timbreId);
      const voiceHit =
        scanned.find((v) => v.id === sysId || v.id === row.timbreId) ||
        scanned.find((v) => v.name.includes(timbre.label));
      try {
        await Promise.race([
          matrixPlayer.speak(COSY_MATRIX_UTTERANCE, {
            baseUrl,
            promptWavPath: voiceHit?.sampleWav || undefined,
            promptText: voiceHit?.promptText || undefined,
            instruct: mapped.instruct,
            spkId: settings.value.cosyVoice2
              ? ""
              : settings.value.cosyFastapiSpkId &&
                  builtinSpkGender(settings.value.cosyFastapiSpkId) === gender
                ? settings.value.cosyFastapiSpkId
                : defaultCosyBuiltinSpkId(gender),
            modelDir: settings.value.cosyModelDir,
            fallbackPromptWav: settings.value.cosyDefaultPromptWav,
            fallbackPromptText: settings.value.cosyDefaultPromptText,
            volume: settings.value.volume,
          }),
          new Promise<void>((_, reject) => {
            setTimeout(() => reject(new Error("单格超时 120s")), 125_000);
          }),
        ]);
      } catch (e) {
        failures.push(
          `${timbre.label}×${mood.label}: ${toUserError(e)}`,
        );
      }
    }
  } finally {
    cosyMatrixBusy.value = false;
  }
  if (failures.length) {
    await showFouAlert(
      `完成 ${pairs.length} 格，失败 ${failures.length}：\n${failures.slice(0, 8).join("\n")}`,
      "穷测结果",
    );
  } else {
    fouMsg.success(`穷测完成：${pairs.length} 格全部成功`);
  }
}

function stopCosyMatrix() {
  matrixPlayer?.stop();
  cosyMatrixBusy.value = false;
}

async function saveDashscopeKey() {
  try {
    await setStoredApiKey(COSY_DASHSCOPE_API_KEY_ENV, cosyDashKeyDraft.value);
    cosyDashKeyDraft.value = "";
    await refreshCosyKeyFlags();
    await refreshEngineStatus();
    fouMsg.success("已保存 DashScope API Key");
  } catch (error) {
    await showFouAlert(sanitizeUserMessage(error, "保存 API Key 失败"), "保存失败");
  }
}

async function saveCustomHttpKey() {
  try {
    await setStoredApiKey(COSY_CUSTOM_HTTP_API_KEY_ENV, cosyCustomKeyDraft.value);
    cosyCustomKeyDraft.value = "";
    await refreshCosyKeyFlags();
    await refreshEngineStatus();
    fouMsg.success("已保存自建 HTTP Key");
  } catch (error) {
    await showFouAlert(sanitizeUserMessage(error, "保存 API Key 失败"), "保存失败");
  }
}

const availableVoices = computed(() => {
  if (uiVoiceContext.value === "sherpa-onnx") {
    const pack = packs.value.find((p) => p.provider === "sherpa-onnx");
    return listKokoroVoicesByGender(settings.value.voiceGender, pack?.voices).map((v) => ({
      id: v.id,
      name: v.label,
    }));
  }
  if (uiVoiceContext.value === "cosyvoice") {
    if (settings.value.cosyBackend === "fastapi" && cosyFastapiVoices.value.length) {
      return filterCosyVoicesByGender(cosyFastapiVoices.value, settings.value.voiceGender).map(
        (v) => ({ id: v.id, name: v.name }),
      );
    }
    const pack = packs.value.find((p) => p.provider === "cosyvoice");
    if (pack?.voices?.length) {
      return pack.voices.map((v) => ({ id: v.id, name: v.name || v.id }));
    }
    return [];
  }
  return filterSystemVoicesByGender(systemVoices.value, settings.value.voiceGender).map((voice) => ({
    id: voice.voiceURI,
    name: formatSystemVoiceLabel(voice),
  }));
});

/** 系统页：仅本机真实中文声线 */
const systemVoiceSelectOptions = computed(() =>
  filterSystemVoicesByGender(systemVoices.value, settings.value.voiceGender).map((v) => ({
    label: formatSystemVoiceLabel(v),
    value: v.voiceURI,
  })),
);
const systemGenderOptions = computed(() => {
  const opts: Array<{ label: string; value: VoiceGender }> = [];
  if (systemHasGender(systemVoices.value, "female") || !systemHasGender(systemVoices.value, "male")) {
    opts.push({ label: "女声", value: "female" });
  }
  if (systemHasGender(systemVoices.value, "male")) {
    opts.push({ label: "男声", value: "male" });
  }
  return opts;
});

/** 离线页：Kokoro 固定表 */
const kokoroVoiceSelectOptions = computed(() => {
  const pack = packs.value.find((p) => p.provider === "sherpa-onnx");
  return listKokoroVoicesByGender(settings.value.voiceGender, pack?.voices).map((v) => ({
    label: v.label,
    value: v.id,
  }));
});

/** Cosy / API 页戏剧音色（跟页签，不跟系统/离线） */
const cosyTimbreOptions = computed(() =>
  listTimbresForProvider("cosyvoice", settings.value.voiceGender).map((t) => ({
    label: t.requiresCosy ? `${t.label}` : t.label,
    value: t.id,
  })),
);

const matrixTimbreRows = computed(() =>
  listTimbresForProvider("cosyvoice", settings.value.voiceGender).filter(
    (t) => t.requiresCosy || t.autoSeed,
  ),
);
const matrixMoods = computed(() => listMoodsForGender(settings.value.voiceGender));

/** FastAPI：优先扫描音色库（按当前性别过滤）；Cosy2/3 无库时不用假 SFT。 */
const cosyFastapiSpkOptions = computed(() => {
  if (cosyFastapiVoices.value.length > 0) {
    return filterCosyVoicesByGender(cosyFastapiVoices.value, settings.value.voiceGender).map(
      (v) => ({ id: v.id, name: v.name }),
    );
  }
  if (settings.value.cosyVoice2) {
    return [{ id: "__default_ref__", name: "默认参考音（zero_shot）" }];
  }
  return COSY_FASTAPI_BUILTIN_SPK.map((s) => ({ id: s.id, name: s.name }));
});
const matchedVoiceLabel = computed(() => {
  const hit = availableVoices.value.find((v) => v.id === settings.value.voice);
  return hit?.name || settings.value.voice || "—";
});
const showVoicePicker = computed(() => availableVoices.value.length > 0);
const showToneSelect = computed(() => true);
const genderOptions = [
  { label: "女声", value: "female" as VoiceGender },
  { label: "男声", value: "male" as VoiceGender },
];
/** @deprecated 仅 Cosy/API 用 cosyTimbreOptions；保留避免旧引用 */
const timbreOptions = computed(() => cosyTimbreOptions.value);
const moodOptions = computed(() =>
  listMoodsForGender(settings.value.voiceGender).map((m) => ({ label: m.label, value: m.id })),
);
/** @deprecated 兼容旧模板引用 */
const toneOptions = computed(() => cosyTimbreOptions.value);
const acquireEngineBlurb = computed(() =>
  pendingProvider.value ? engineToneBlurb(pendingProvider.value) : "",
);
const acquireNeedsGpu = computed(
  () => pendingProvider.value != null && providerNeedsGpuHint(pendingProvider.value),
);

const progressPercent = computed(() => voicePackProgressPercent(progress.value));
const progressStageLabelText = computed(() => voicePackStageLabel(progress.value?.stage));
const progressAmount = computed(() => voicePackProgressAmount(progress.value));
const progressEta = computed(() => {
  if (!progressStageStartedAt.value) return "";
  return voicePackEtaLabel(progress.value, Date.now() - progressStageStartedAt.value);
});
const progressBarWidth = computed(() => {
  const pct = progressPercent.value;
  if (pct !== null) return pct;
  if (progress.value?.stage === "starting") return 6;
  if (progress.value?.stage === "done") return 100;
  return 42;
});
const progressPercentLabel = computed(() => {
  const pct = progressPercent.value;
  if (pct !== null) return `${pct}%`;
  if (progress.value?.received && progress.value.received > 0) return progressAmount.value;
  return "…";
});
const progressIndeterminate = computed(
  () => installBusy.value && progressPercent.value === null && progress.value?.stage !== "starting",
);

function applyProgressEvent(event: VoicePackProgress) {
  if (event.stage !== lastProgressStage.value) {
    lastProgressStage.value = event.stage;
    progressStageStartedAt.value = Date.now();
  }
  progress.value = event;
}

/** 离线页目录固定按 sherpa-onnx 过滤 */
const pendingCatalogEntries = computed(() =>
  catalogEntriesForProvider(catalogEntries.value, "sherpa-onnx"),
);
const virmoorCatalogEntries = computed(() =>
  pendingCatalogEntries.value.filter((e) => e.source === "download-api"),
);
const virmoorLoggedIn = computed(() => isVirmoorDownloadAuthorized());
const virmoorDownloadAvailable = computed(() => virmoorCatalogEntries.value.length > 0);
const virmoorDownloadStatusLabel = computed(() => {
  if (catalogError.value && !virmoorCatalogEntries.value.length) {
    return `拉取失败`;
  }
  if (virmoorCatalogEntries.value.length > 0) {
    return virmoorLoggedIn.value
      ? `已发布 ${virmoorCatalogEntries.value.length} 个`
      : `已发布 ${virmoorCatalogEntries.value.length} 个（下载需登录）`;
  }
  return "暂无发布包";
});
const vendorCatalogEntriesForPanel = computed(() =>
  catalogEntriesForProvider(vendorCatalogEntries(catalogEntries.value), "sherpa-onnx"),
);
const vendorDownloadConfigured = computed(() => hasVendorVoicePackDownloadConfig());
const vendorDownloadAvailable = computed(() => vendorCatalogEntriesForPanel.value.length > 0);
const vendorDownloadStatusLabel = computed(() => {
  if (vendorDownloadAvailable.value) return "可下载";
  if (catalogError.value && vendorDownloadConfigured.value) {
    return `拉取失败：${catalogError.value}`;
  }
  if (vendorDownloadConfigured.value) return "目录为空";
  return "未配置";
});

function catalogSourceLabel(entry: VoicePackCatalogEntry): string {
  if (entry.source === "download-api") return "虚募阁发布";
  if (entry.source === "catalog") return "厂商目录";
  if (entry.source === "env-url") return "环境直链";
  return "";
}

function capabilityFor(
  provider: Exclude<VoiceProviderId, "system-webspeech">,
): OfflineVoiceCapability {
  const base = resolveOfflineCapability(provider, packs.value, engineStatus.value[provider]);
  if (provider !== "cosyvoice") return base;
  return liftCosyOfflineCapability(base, {
    installPhaseReady: cosyInstallPhase.value === "ready",
    launchPathsConfigured:
      Boolean(settings.value.cosyPython.trim()) &&
      Boolean(settings.value.cosyServerScript.trim()),
    discoverOk: Boolean(cosyDiscoverReport.value?.ok),
  });
}

function providerButtonLabel(provider: VoiceProviderId): string {
  if (provider === "system-webspeech") return providerLabels[provider];
  return offlineProviderButtonLabel(providerLabels[provider], capabilityFor(provider));
}

/** 语音包页只跟当前朗读方式；安装预览时跟 pending。 */
function isProviderButtonActive(provider: VoiceProviderId): boolean {
  if (pendingProvider.value) {
    return pendingProvider.value === provider;
  }
  return settings.value.provider === provider;
}

function catalogEntryMeta(entry: VoicePackCatalogEntry): string {
  const parts: string[] = [];
  if (entry.gender) parts.push(entry.gender);
  if (entry.tones?.length) parts.push(entry.tones.join("、"));
  return parts.length ? `官网公示：${parts.join(" · ")}` : "";
}

function persist(patch: Partial<VoiceSettings>) {
  settings.value = saveVoiceSettings({ ...settings.value, ...patch });
  if (
    "wakeEnabled" in patch ||
    "wakePhrases" in patch ||
    "wakeConfirmSpeak" in patch ||
    "wakeLang" in patch
  ) {
    window.dispatchEvent(new CustomEvent(XU_VOICE_WAKE_REFRESH));
    window.setTimeout(() => refreshWakeListenHint(), 400);
  }
}

function refreshWakeListenHint() {
  if (!settings.value.wakeEnabled) {
    wakeListenHint.value = "";
    return;
  }
  if (typeof document !== "undefined" && document.visibilityState !== "visible") {
    wakeListenHint.value = "窗口未在前台可见，唤醒已暂停。请回到本窗口后再试。";
    return;
  }
  if (isVoiceAssistantOverlayOpen()) {
    wakeListenHint.value = "语音通话进行中，唤醒已暂停；挂断后会自动再听。";
    return;
  }
  const owner = getGlobalSpeechRecOwner();
  if (owner === "call" || owner === "dictation") {
    wakeListenHint.value =
      owner === "call"
        ? "通话占用麦克风，唤醒已暂停。"
        : "听写占用麦克风，唤醒已暂停。";
    return;
  }
  const st = getVoiceWakeStatus();
  if (st.lastError === "mic-denied" || st.lastError === "not-allowed") {
    wakeListenHint.value = "无法使用麦克风。请在系统设置中允许虚募阁访问麦克风后重开开关。";
    return;
  }
  if (st.lastError === "language-not-supported") {
    wakeListenHint.value =
      "在线识别语言不受支持。可换「识别语言」，或安装离线唤醒模型。";
    return;
  }
  if (isVoiceWakeListening()) {
    const eng = st.engine === "kws" ? "离线关键词" : "在线识别";
    if (st.lastError === "network") {
      wakeListenHint.value = "在线识别网络不稳，正在自动重试（无需关开关）。";
      return;
    }
    wakeListenHint.value = st.asrLive
      ? `正在听唤醒词（${eng}）。请说词表中的词。`
      : "正在连接语音识别…请稍候。";
    return;
  }
  wakeListenHint.value =
    "尚未开始听：请保持本窗口在前台可见；若刚打开开关，请稍等一两秒或切到其它页再回来。";
}

function saveWakePhrasesFromDraft() {
  const parts = wakePhrasesDraft.value
    .split(/[,，\n;/|]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  persist({ wakePhrases: parts });
  wakePhrasesDraft.value = settings.value.wakePhrases.join("，");
  fouMsg.success("唤醒词已保存");
}

function preferredSystemVoiceUri(): string {
  const tone = getVoiceTonePreset(settings.value.timbreId || settings.value.toneId);
  return (
    matchSystemVoiceForTone(systemVoices.value, tone) ||
    systemVoices.value[0]?.voiceURI ||
    ""
  );
}

function applyVoiceSync() {
  const patch = syncVoiceToTone(settings.value, packs.value, systemVoices.value);
  if (Object.keys(patch).length) persist(patch);
}

let espeakEnsureTried = false;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      window.setTimeout(() => reject(new Error(`${label}超时`)), ms);
    }),
  ]);
}

async function refreshEngineStatus() {
  const next: Record<string, VoiceEngineStatus> = {};
  for (const provider of ["sherpa-onnx", "cosyvoice"] as const) {
    try {
      next[provider] = await fetchVoiceEngineStatus(provider, {
        cosyBackend: settings.value.cosyBackend,
        cosyCustomBaseUrl: cosyProbeUrl(),
      });
    } catch {
      next[provider] = {
        provider,
        packInstalled: packs.value.some((p) => p.provider === provider),
        synthesisAvailable: false,
        reason: "无法探测合成引擎状态",
      };
    }
  }
  if (!disposed) engineStatus.value = next;

  const sherpa = next["sherpa-onnx"];
  if (
    !disposed &&
    !espeakEnsureTried &&
    sherpa?.packInstalled &&
    !sherpa.synthesisAvailable &&
    /espeak/i.test(sherpa.reason || "")
  ) {
    espeakEnsureTried = true;
    try {
      await ensureVoiceEspeak();
      if (!disposed) await refreshEngineStatus();
    } catch {
      /* 设置页加载时不弹窗打断；用户可手动点一键安装 */
    }
  }
  // 预热改到进入「试听」Tab，避免打开设置页卡顿
}

function maybeWarmKokoroForAudition() {
  const sherpa = engineStatus.value["sherpa-onnx"];
  if (!sherpa?.synthesisAvailable || settings.value.provider !== "sherpa-onnx") return;
  const voice = resolveKokoroVoiceId(settings.value.voice || settings.value.toneId || "zf_xiaoxiao");
  void warmupKokoro(voice)
    .then(() =>
      primeKokoroPreviewCache(voice, settings.value).catch(() => {
        /* 预合成失败不打断设置页 */
      }),
    )
    .catch(() => {
      /* 预热失败不打断设置页 */
    });
}

function healToUsable() {
  const provider = settings.value.provider;
  // Cosy 允许用户先选中再启服务，勿在打开设置时悄悄改回系统音
  if (provider === "cosyvoice") return;
  let offlineUsable = false;
  if (provider === "sherpa-onnx") {
    offlineUsable = canSelectOfflineAsCurrent(capabilityFor(provider));
  }
  const healed = healVoiceSettingsToUsable(settings.value, {
    offlineUsable,
    systemVoiceUri: preferredSystemVoiceUri(),
  });
  if (
    healed.provider !== settings.value.provider ||
    healed.packId !== settings.value.packId ||
    healed.voice !== settings.value.voice
  ) {
    settings.value = saveVoiceSettings(healed);
  }
}

function selectVoiceGender(gender: VoiceGender) {
  if (settings.value.voiceGender === gender) return;
  const ctx = uiVoiceContext.value;

  if (ctx === "system-webspeech") {
    if (!systemHasGender(systemVoices.value, gender)) {
      void showFouAlert(
        gender === "male" ? "当前系统没有可用的中文男声。" : "当前系统没有可用的中文女声。",
        "系统语音",
      );
      return;
    }
    const pool = filterSystemVoicesByGender(systemVoices.value, gender);
    const next = pool.find((v) => v.voiceURI === settings.value.voice) || pool[0];
    persist({
      voiceGender: gender,
      voice: next?.voiceURI || settings.value.voice,
    });
    return;
  }

  if (ctx === "sherpa-onnx") {
    const pack = packs.value.find((p) => p.provider === "sherpa-onnx");
    const list = listKokoroVoicesByGender(gender, pack?.voices);
    const keep = list.find((v) => v.id === resolveKokoroVoiceId(settings.value.voice));
    const next = keep || list[0];
    if (next) applyKokoroVoice(next.id);
    else persist({ voiceGender: gender });
    return;
  }

  const next = listTimbresByGender(gender)[0];
  const moodId =
    gender === "male" && getVoiceMoodPreset(settings.value.moodId).femaleOnly
      ? "calm"
      : settings.value.moodId;
  if (next) {
    void applyTimbre(next.id, gender).then(() => {
      if (moodId !== settings.value.moodId) applyMood(moodId);
    });
  } else {
    persist({ voiceGender: gender, moodId });
  }
}

function selectSystemVoice(voiceUri: string) {
  const hit = filterZhSystemVoices(systemVoices.value).find((v) => v.voiceURI === voiceUri);
  const inferred = hit ? inferSystemVoiceGender(hit) : "unknown";
  persist({
    provider: "system-webspeech",
    voice: voiceUri,
    voiceGender: inferred === "male" ? "male" : "female",
  });
}

function selectBuiltinSpk(spkId: string) {
  const gender = builtinSpkGender(spkId);
  persist({ cosyFastapiSpkId: spkId });
  if (gender && gender !== settings.value.voiceGender) {
    selectVoiceGender(gender);
  }
}

async function applyTimbre(timbreId: string, genderOverride?: VoiceGender) {
  const timbre = getVoiceTimbrePreset(timbreId);
  const gender = genderOverride ?? timbre.gender;
  const prosody = resolveProsody(timbre.id, settings.value.moodId);
  const wantCosy =
    uiVoiceContext.value === "cosyvoice" ||
    toneRequiresCosy(timbre.id) ||
    settings.value.provider === "cosyvoice";

  // 在 Cosy Tab / 戏剧音色 / 已是 Cosy：切到 Cosy 默认，避免只记偏好却走系统音
  if (wantCosy && settings.value.provider !== "cosyvoice") {
    const cosyOk = engineStatus.value.cosyvoice?.synthesisAvailable;
    persist({
      ...(cosyOk ? { provider: "cosyvoice" as const } : {}),
      voiceGender: gender,
      timbreId: timbre.id,
      toneId: timbre.id,
      rate: prosody.rate,
      pitch: prosody.pitch,
      voice: systemVoiceDirId(timbre.id),
      cosyFastapiSpkId: defaultCosyBuiltinSpkId(gender),
    });
    if (!cosyOk) {
      await showFouAlert(
        "已记下该音色。请先启动 Cosy 并探测成功后，再到「默认语音」选 Cosy 作为当前引擎。",
        "音色提示",
      );
    }
    return;
  }

  const onKokoro =
    settings.value.provider === "sherpa-onnx" || uiVoiceContext.value === "sherpa-onnx";
  if (onKokoro && settings.value.provider === "sherpa-onnx" && !toneRequiresCosy(timbre.id)) {
    persist({
      voiceGender: gender,
      timbreId: timbre.id,
      toneId: timbre.id,
      rate: prosody.rate,
      pitch: prosody.pitch,
    });
    return;
  }
  let voice = settings.value.voice;
  if (settings.value.provider === "system-webspeech") {
    voice =
      matchSystemVoiceForTone(systemVoices.value, getVoiceTonePreset(timbre.id)) ||
      settings.value.voice ||
      preferredSystemVoiceUri();
  } else if (settings.value.provider === "cosyvoice" || uiVoiceContext.value === "cosyvoice") {
    voice = systemVoiceDirId(timbre.id);
  }
  persist({
    voiceGender: gender,
    timbreId: timbre.id,
    toneId: timbre.id,
    rate: prosody.rate,
    pitch: prosody.pitch,
    voice,
    ...(uiVoiceContext.value === "cosyvoice" || settings.value.provider === "cosyvoice"
      ? {
          cosyFastapiSpkId:
            settings.value.cosyFastapiSpkId &&
            builtinSpkGender(settings.value.cosyFastapiSpkId) === gender
              ? settings.value.cosyFastapiSpkId
              : defaultCosyBuiltinSpkId(gender),
        }
      : {}),
  });
  if (settings.value.provider !== "cosyvoice") return;
  if (!toneRequiresCosy(timbre.id)) return;
  const cosyOk = engineStatus.value.cosyvoice?.synthesisAvailable;
  if (cosyOk) return;
  await showFouAlert(
    "「夹子音」等戏剧音色需要 CosyVoice 就绪。请先安装/配置 CosyVoice。",
    "音色提示",
  );
}

function applyMood(moodId: string) {
  const mood = getVoiceMoodPreset(moodId);
  if (mood.femaleOnly && settings.value.voiceGender === "male") {
    void showFouAlert("「卖萌」仅女声可用，已保持当前心情。", "心情");
    return;
  }
  const prosody = resolveProsody(settings.value.timbreId || settings.value.toneId, mood.id);
  persist({
    moodId: mood.id,
    rate: prosody.rate,
    pitch: prosody.pitch,
  });
}

/** @deprecated 兼容旧调用 */
async function applyTone(toneId: string) {
  await applyTimbre(toneId);
}

function applyKokoroVoice(voiceId: string) {
  const id = resolveKokoroVoiceId(voiceId);
  const gender = kokoroVoiceGender(id);
  persist({
    voice: id,
    voiceGender: gender,
    packId: settings.value.packId || "native",
    ...(settings.value.provider === "sherpa-onnx" ? { provider: "sherpa-onnx" as const } : {}),
  });
  void warmupKokoro(id)
    .then(() => primeKokoroPreviewCache(id, { ...settings.value, voice: id }).catch(() => undefined))
    .catch(() => undefined);
}

function applySystemProvider() {
  const prosody = resolveProsody(DEFAULT_TIMBRE_ID, DEFAULT_MOOD_ID);
  persist({
    provider: "system-webspeech",
    packId: "",
    voice: preferredSystemVoiceUri(),
    moodId: DEFAULT_MOOD_ID,
    timbreId: DEFAULT_TIMBRE_ID,
    toneId: DEFAULT_TIMBRE_ID,
    rate: prosody.rate,
    pitch: prosody.pitch,
  });
  showAcquirePanel.value = false;
  pendingProvider.value = null;
  voicePanelTab.value = "defaults";
}

/**
 * Duty: 未就绪引擎 → 只导航到安装页，不写 provider。
 * 依赖: refreshCatalog（离线）；失败由安装页自行提示。
 */
async function openAcquireFor(provider: Exclude<VoiceProviderId, "system-webspeech">) {
  pendingProvider.value = provider;
  if (provider === "cosyvoice") {
    showAcquirePanel.value = false;
    voicePanelTab.value = "cosy";
    return;
  }
  showAcquirePanel.value = true;
  voicePanelTab.value = "packs";
  await refreshCatalog();
}

/**
 * Duty: 选用当前朗读引擎；未装则 goInstall，不改 provider。
 * 失败: capability 不可用时切安装页。
 */
async function selectProvider(provider: VoiceProviderId) {
  if (provider === "system-webspeech") {
    applySystemProvider();
    return;
  }
  const capability = capabilityFor(provider);
  if (canSelectOfflineAsCurrent(capability)) {
    const firstPack = packs.value.find((pack) => pack.provider === provider);
    const voices = firstPack?.voices ?? [];
    let voice = settings.value.voice;
    let toneId = settings.value.toneId;
    if (provider === "sherpa-onnx") {
      const kokoro = listKokoroVoicesForUi(voices);
      voice = resolveKokoroVoiceId(
        isKokoroVoiceId(settings.value.voice) ? settings.value.voice : kokoro[0]?.id,
      );
      toneId = settings.value.timbreId || "female-announce";
    } else if (voices.length >= 1) {
      voice = voices[0].id;
    }
    persist({
      provider,
      packId: firstPack?.id ?? (provider === "sherpa-onnx" ? "native" : ""),
      voice,
      toneId,
      timbreId: toneId,
    });
    showAcquirePanel.value = false;
    pendingProvider.value = null;
    voicePanelTab.value = provider === "cosyvoice" ? "cosy" : "offline";
    fouMsg.success(provider === "cosyvoice" ? "已切换为 CosyVoice" : "已切换为离线语音");
    return;
  }
  // Cosy 环境已装但服务未热：仍允许设为默认，避免「点了没反应」
  if (provider === "cosyvoice" && (capability === "packOnly" || capability === "packMissing")) {
    persist({
      provider: "cosyvoice",
      packId: packs.value.find((p) => p.provider === "cosyvoice")?.id ?? settings.value.packId,
    });
    voicePanelTab.value = "cosy";
    await showFouAlert(
      capability === "packOnly"
        ? "已设为 Cosy 默认引擎。请在本页启动/探测服务；未就绪时通话可能先用系统音。"
        : "已设为 Cosy 默认引擎。请先完成本机安装或配置 API，再试听与通话。",
      "切换引擎",
    );
    return;
  }
  if (provider === "sherpa-onnx") {
    voicePanelTab.value = "offline";
    await showFouAlert(
      "离线语音引擎尚未就绪，请先安装 Kokoro/Sherpa 模型后再设为默认。",
      "切换引擎",
    );
    await openAcquireFor(provider);
    return;
  }
  await openAcquireFor(provider);
}

async function refreshPacks() {
  try {
    const next = await listVoicePacks();
    if (disposed) return;
    packs.value = next;
  } catch (error) {
    if (disposed) return;
    await showFouAlert(sanitizeUserMessage(error, "无法读取本机语音包"), "语音包");
  }
}

async function refreshCatalog() {
  const { entries, siteUrl, catalogError: err } = await loadVoicePackCatalog();
  if (disposed) return;
  catalogEntries.value = entries;
  voicePackSiteUrl.value = siteUrl;
  catalogError.value = err ?? "";
}

async function ensureVirmoorLogin(): Promise<boolean> {
  if (isVirmoorDownloadAuthorized()) return true;
  const decision = await fouConfirmPromise(
    `${virmoorDownloadLoginMessage()}是否前往登录？`,
    "需要登录",
  );
  if (decision === "confirm") {
    await router.push({ path: "/login", query: { redirect: "/settings" } });
  }
  return false;
}

async function downloadFromVirmoor() {
  if (!(await ensureVirmoorLogin())) return;
  await refreshCatalog();
  const entries = virmoorCatalogEntries.value;
  if (entries.length === 0) {
    await showFouAlert("虚募阁暂无可下载的语音包，请稍后再试或改用本机 ZIP。", "暂不可下载");
    return;
  }
  if (entries.length === 1) {
    await installFromCatalogEntry(entries[0]);
    return;
  }
  await showFouAlert(
    `虚募阁有 ${entries.length} 个可选包，请点击上方列表中的「下载安装」。`,
    "请选择语音包",
  );
}

async function saveVendorSiteUrl() {
  saveVoicePackVendorUrl(vendorSiteUrl.value);
  await refreshCatalog();
  fouMsg.success("已保存语音包官网地址");
}

async function downloadFromVoicePackSite() {
  await refreshCatalog();
  const entries = vendorCatalogEntriesForPanel.value;
  if (entries.length === 1) {
    await installFromCatalogEntry(entries[0]);
    return;
  }
  if (entries.length > 1) {
    await showFouAlert(
      `语音包官网有 ${entries.length} 个可选包，请点击上方列表中的「下载安装」。`,
      "请选择语音包",
    );
    return;
  }
  if (!vendorDownloadConfigured.value) {
    await showFouAlert(
      "请先在下方填写语音包官网地址（catalog.json 或 ZIP 直链）。这与虚募阁官网无关。",
      "未配置",
    );
    return;
  }
  try {
    const url = await resolveVoicePackSiteDownloadTarget(
      vendorSiteUrl.value || voicePackSiteUrl.value,
      pendingProvider.value ?? undefined,
    );
    if (!url) {
      await showFouAlert(
        "语音包官网目录为空或暂无匹配包。请检查 catalog 中的 downloadUrl，或改用本机 ZIP。",
        "暂不可下载",
      );
      return;
    }
    await installFromUrl(url, true);
  } catch (error) {
    await showFouAlert(sanitizeUserMessage(error, "语音包官网下载失败"), "下载失败");
  }
}

async function installFromCatalogEntry(entry: VoicePackCatalogEntry) {
  if (entry.source === "download-api" && !(await ensureVirmoorLogin())) return;
  try {
    const url = await resolveCatalogInstallUrl(entry);
    await installFromUrl(url, true);
  } catch (error) {
    await showFouAlert(sanitizeUserMessage(error, "无法获取安装地址"), "安装失败");
  }
}

async function pickLocalZip() {
  const picked = await openFileDialog({
    multiple: false,
    filters: [{ name: "语音包 ZIP", extensions: ["zip"] }],
  });
  if (!picked || Array.isArray(picked)) return;
  try {
    const staged = await stageLocalVoicePack(picked);
    await installFromUrl(staged, false);
  } catch (error) {
    await showFouAlert(sanitizeUserMessage(error, "无法暂存本机语音包"), "本机安装");
  }
}

async function installFromUrl(urlRaw?: string, fromCatalog = false) {
  const url = (urlRaw ?? installUrl.value).trim();
  if (!/^(https?|file):\/\//i.test(url)) {
    await showFouAlert("请输入 http、https 或 file 地址。地址应指向包含 manifest.json 的 ZIP。", "地址无效");
    return;
  }
  const decision = await fouConfirmPromise(
    "下载地址的模型和许可证须自行核对。仅当你已核对 licenseSpdx、licenseUrl、sourceUrl 并接受商用与安全风险时继续。",
    "语音包风险确认",
  );
  if (decision !== "confirm") return;
  installRequestId.value = createVoiceRequestId("voice-pack");
  installBusy.value = true;
  progress.value = null;
  lastProgressStage.value = "";
  progressStageStartedAt.value = Date.now();
  try {
    await installVoicePack(url, installRequestId.value, true);
    if (!urlRaw) installUrl.value = "";
    await refreshPacks();
    await refreshEngineStatus();
    // 本轮不自动切到离线为当前朗读（合成引擎未内置）
    healToUsable();
    fouMsg.success("语音包已安装。当前构建未内置合成引擎，朗读仍使用系统语音。");
  } catch (error) {
    progress.value = null;
    await showFouAlert(
      sanitizeUserMessage(
        error,
        fromCatalog
          ? "推荐包安装失败；若已部分下载，再次点击可续传。"
          : "语音包安装失败；若已部分下载，再次点击可续传。",
      ),
      "安装失败",
    );
  } finally {
    installBusy.value = false;
    installRequestId.value = "";
    const finalProgress = progress.value as VoicePackProgress | null;
    if (finalProgress?.stage === "done") progress.value = null;
  }
}

async function cancelInstall() {
  if (installRequestId.value === "native-install") {
    await cancelVoiceNativeInstall();
    installBusy.value = false;
    return;
  }
  if (installRequestId.value) await cancelVoiceTask(installRequestId.value);
}

/** 设置页主路径：一键装 ASR+TTS 到 XU_HOME（与 MCP 同契约）。 */
async function installNativeOffline() {
  installBusy.value = true;
  installRequestId.value = "native-install";
  progress.value = {
    requestId: "native-install",
    stage: "downloading",
    received: 0,
    total: 250_000_000,
    message: "准备一键安装…",
  };
  progressStageStartedAt.value = Date.now();
  lastProgressStage.value = "downloading";
  stopNativeProgress?.();
  stopNativeProgress = await onVoiceNativeProgress((p) => {
    if (disposed) return;
    if (p.stage !== lastProgressStage.value) {
      lastProgressStage.value = p.stage;
      progressStageStartedAt.value = Date.now();
    }
    const stage =
      p.stage === "ready"
        ? "done"
        : p.stage.includes("extract")
          ? "extracting"
          : p.stage.includes("download")
            ? "downloading"
            : "starting";
    progress.value = {
      requestId: "native-install",
      stage,
      received: Math.round((p.percent / 100) * 250_000_000),
      total: 250_000_000,
      message: p.message || voicePackStageLabel(stage),
    };
  });
  try {
    const probe = await probeVoiceNative();
    if (probe.warnings.length) {
      const decision = await fouConfirmPromise(
        `${probe.warnings.join("\n")}\n\n仍要继续安装吗？约 ${Math.round(probe.approxBytes / 1e6)}MB，${probe.freeHint}。`,
        "离线语音安装提示",
      );
      if (decision !== "confirm") return;
    }
    await installVoiceNative();
    if (disposed) return;
    await refreshEngineStatus();
    await refreshPacks();
    const tone = getVoiceTonePreset(settings.value.timbreId || settings.value.toneId);
    persist({
      provider: "sherpa-onnx",
      packId: "native",
      voice: isKokoroVoiceId(settings.value.voice)
        ? resolveKokoroVoiceId(settings.value.voice)
        : "zf_xiaoxiao",
      toneId: tone.id,
      timbreId: tone.id,
      rate: tone.rate,
      pitch: tone.pitch,
    });
    fouMsg.success("离线 ASR/TTS 已安装");
    showAcquirePanel.value = false;
    pendingProvider.value = null;
  } catch (error) {
    if (disposed) return;
    await showFouAlert(sanitizeUserMessage(error, "一键安装失败"), "安装失败");
  } finally {
    installBusy.value = false;
    installRequestId.value = "";
    stopNativeProgress?.();
    stopNativeProgress = null;
    if (progress.value?.stage === "done") progress.value = null;
  }
}

async function removePack(pack: InstalledVoicePack) {
  const decision = await fouConfirmPromise(
    `确定卸载语音包“${pack.id}”吗？本机模型和引擎文件会被删除。`,
    "卸载语音包",
  );
  if (decision !== "confirm") return;
  try {
    await uninstallVoicePack(pack.id);
    await refreshPacks();
    await refreshEngineStatus();
    healToUsable();
    fouMsg.success("已卸载语音包");
  } catch (error) {
    await showFouAlert(sanitizeUserMessage(error, "语音包卸载失败"), "卸载失败");
  }
}

function adjust(field: "rate" | "pitch" | "volume", delta: number) {
  persist({ [field]: Number((settings.value[field] + delta).toFixed(2)) });
}

async function preview() {
  const generation = previewGuard.begin();
  previewProvider?.cancel();
  previewProvider = null;
  previewBusy.value = true;
  const isCurrent = () => previewGuard.isCurrent(generation);
  try {
    const ctx = uiVoiceContext.value;
    if (ctx === "cosyvoice") {
      const cap = capabilityFor("cosyvoice");
      if (!canSelectOfflineAsCurrent(cap) && settings.value.cosyBackend !== "dashscope") {
        const reason =
          engineStatus.value.cosyvoice?.reason ||
          cosyBackendHint.value ||
          "CosyVoice 未就绪，请先协助安装或启动 FastAPI。";
        await showFouAlert(reason, "Cosy 试听不可用");
        return;
      }
      const text = cosyPreviewText.value.trim();
      if (!text) {
        await showFouAlert("请输入试听文本。", "试听");
        return;
      }
      const speakSettings =
        voicePanelTab.value === "cosy"
          ? {
              ...settings.value,
              cosyBackend: "fastapi" as const,
              cosyFastapiSpkId:
                settings.value.cosyFastapiSpkId &&
                builtinSpkGender(settings.value.cosyFastapiSpkId) === settings.value.voiceGender
                  ? settings.value.cosyFastapiSpkId
                  : defaultCosyBuiltinSpkId(settings.value.voiceGender),
              voice: settings.value.voice?.startsWith("sys-")
                ? settings.value.voice
                : systemVoiceDirId(settings.value.timbreId || settings.value.toneId),
            }
          : voicePanelTab.value === "api" && settings.value.cosyBackend === "fastapi"
            ? { ...settings.value, cosyBackend: "dashscope" as const }
            : settings.value;

      let provider;
      let fallbackReason: string | undefined;
      const localHealth =
        speakSettings.cosyBackend === "fastapi" && voicePanelTab.value === "cosy"
          ? await refreshCosyFastapiHealth(true)
          : null;
      const fastapiReady = Boolean(localHealth?.streaming);
      const selectedModel = speakSettings.cosyModelDir.replace(/\\/g, "/").toLowerCase();
      const runningModel = (localHealth?.modelDir || "").replace(/\\/g, "/").toLowerCase();
      if (
        fastapiReady &&
        selectedModel &&
        runningModel &&
        selectedModel !== runningModel
      ) {
        await showFouAlert(
          "当前服务加载的模型与页面选择不一致。请先停止，再重新启动本机 CosyVoice。",
          "模型尚未切换",
        );
        return;
      }
      if (fastapiReady && voicePanelTab.value === "cosy") {
        const presets = speakSettings.cosyVoicesRoot.trim()
          ? await scanCosyFastapiVoices(speakSettings.cosyVoicesRoot).catch(() => [])
          : cosyFastapiVoices.value;
        provider = new CosyFastapiProvider(presets);
      } else {
        const resolved = await resolveTtsProvider(speakSettings, { forceProvider: ctx });
        if (!isCurrent()) return;
        provider = resolved.provider;
        fallbackReason = resolved.fallbackReason;
      }
      if (!isCurrent()) return;
      if (fallbackReason) {
        await showFouAlert(fallbackReason, "朗读提示");
        if (!isCurrent()) return;
      }
      previewProvider = provider;
      if (speakSettings.cosyBackend === "fastapi" && !isCosyFastapiWarmFresh()) {
        fouMsg.info(
          settings.value.cosyVoice2
            ? "模型可能仍在加载（CosyVoice2/3 首句可能需数秒）…"
            : "模型可能仍在加载，首句可能需数秒…",
        );
      } else {
        fouMsg.info("试听中…");
      }
      await Promise.race([
        provider.speak(text, speakSettings),
        new Promise<void>((_, reject) => {
          setTimeout(
            () => reject(new Error("试听超时。可在 Cosy 控制台查看 sidecar 日志，或确认模型已就绪。")),
            120_000,
          );
        }),
      ]);
      cosyWarmReady.value = true;
      return;
    }
    if (ctx === "sherpa-onnx" && canSelectOfflineAsCurrent(capabilityFor("sherpa-onnx"))) {
      const text = offlinePreviewText.value.trim();
      if (!text) {
        await showFouAlert("请输入试听文本。", "试听");
        return;
      }
      const resolved = await resolveTtsProvider(settings.value, { forceProvider: ctx });
      if (!isCurrent()) return;
      if (resolved.provider.id !== "system-webspeech") {
        if (resolved.fallbackReason) {
          await showFouAlert(resolved.fallbackReason, "朗读提示");
          if (!isCurrent()) return;
        }
        previewProvider = resolved.provider;
        await Promise.race([
          resolved.provider.speak(text, settings.value),
          new Promise<void>((_, reject) => {
            setTimeout(() => reject(new Error("试听超时（90 秒）。请确认 Kokoro 模型已安装。")), 90_000);
          }),
        ]);
        return;
      }
      if (resolved.fallbackReason && !offlinePreviewHintShown) {
        offlinePreviewHintShown = true;
        await showFouAlert(resolved.fallbackReason, "离线试听不可用");
        if (!isCurrent()) return;
      }
    }
    if (ctx !== "system-webspeech") {
      const cap = capabilityFor(ctx as Exclude<VoiceProviderId, "system-webspeech">);
      if (!canSelectOfflineAsCurrent(cap)) {
        if (!offlinePreviewHintShown) {
          offlinePreviewHintShown = true;
          const reason =
            engineStatus.value[ctx]?.reason ||
            "离线合成引擎不可用，已用系统语音试听语气。";
          await showFouAlert(reason, "离线试听不可用");
          if (!isCurrent()) return;
        }
      }
    }
    const sys = new SystemWebSpeechProvider();
    const text =
      ctx === "sherpa-onnx"
        ? offlinePreviewText.value.trim()
        : systemPreviewText.value.trim();
    if (!text) {
      await showFouAlert("请输入试听文本。", "试听");
      return;
    }
    previewProvider = sys;
    const previewSettings: VoiceSettings = {
      ...settings.value,
      provider: "system-webspeech",
      voice: settings.value.provider === "system-webspeech"
        ? settings.value.voice
        : preferredSystemVoiceUri(),
    };
    await sys.speak(text, previewSettings);
  } catch (error) {
    if (!isCurrent()) return;
    await showFouAlert(sanitizeUserMessage(error, "语音试听失败"), "试听失败");
  } finally {
    if (isCurrent()) {
      previewBusy.value = false;
      previewProvider = null;
    }
  }
}

function stopPreview() {
  previewGuard.invalidate();
  previewProvider?.cancel();
  previewProvider = null;
  previewBusy.value = false;
}

async function seedPersonaExamples() {
  try {
    const doc = await loadPersonaTraining(true);
    if (doc.scenarios.length > 0) {
      personaScenarioCount.value = doc.scenarios.length;
      await showFouAlert("训练目录已有语气示例，未覆盖。", "提示");
      return;
    }
    await savePersonaTraining({
      schemaVersion: 1,
      updatedAt: new Date().toISOString(),
      scenarios: defaultPersonaScenarios(),
    });
    personaScenarioCount.value = defaultPersonaScenarios().length;
    fouMsg.success("已写入默认语气示例");
  } catch (error) {
    await showFouAlert(sanitizeUserMessage(error, "无法写入语气示例"), "失败");
  }
}

function refreshSystemVoices() {
  systemVoices.value = listSystemVoices();
  applyVoiceSync();
}

function sanitizeUserMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  if (typeof error === "string" && error.trim()) return error.trim();
  return fallback;
}

onMounted(() => {
  disposed = false;
  if (!vendorSiteUrl.value) vendorSiteUrl.value = resolveVoicePackSiteUrl();
  refreshSystemVoices();
  window.speechSynthesis?.addEventListener("voiceschanged", refreshSystemVoices);
  if (!cosyPreviewText.value) cosyPreviewText.value = defaultCosyPreviewText();
  if (!systemPreviewText.value) systemPreviewText.value = previewUtteranceForTone(settings.value.toneId) || "你好，这是系统语音试听。";
  if (!offlinePreviewText.value) offlinePreviewText.value = previewUtteranceForTone(settings.value.toneId) || "你好，这是离线语音试听。";
  void bootstrapVoiceSettings();
});

/** 首屏轻量：包列表 + 引擎徽章；重活推迟到 Cosy / 试听 Tab */
async function bootstrapVoiceSettings() {
  voiceInitBusy.value = true;
  try {
    const stopRoute = await listenVoiceRouteOverride(() => {
      if (disposed) return;
      settings.value = loadVoiceSettings();
    });
    if (!retainAsyncDisposer(stopRoute, () => disposed, () => {})) {
      /* keep listening until unmount via stopRoute */
    }
    const stop = await onVoicePackProgress((event) => {
      if (disposed) return;
      if (event.requestId === installRequestId.value) applyProgressEvent(event);
    });
    if (!retainAsyncDisposer(stop, () => disposed, (fn) => {
      stopProgress = fn;
    })) return;
    await withTimeout(refreshPacks(), 8_000, "加载语音包").catch(() => {
      /* 超时不阻断设置页 */
    });
    if (disposed) return;
    // 安装态 + 引擎状态并行刷新（默认页徽章不依赖先进入 Cosy Tab）
    void withTimeout(
      Promise.all([
        refreshCosyInstallStatus().then(() => healCosyBackendFromInstall()),
        refreshEngineStatus(),
      ]),
      8000,
      "加载引擎状态",
    ).catch(() => {
      /* 超时不阻断 */
    });
    if (disposed) return;
    healToUsable();
    applyVoiceSync();
    try {
      const doc = await loadPersonaTraining();
      if (!disposed) personaScenarioCount.value = doc.scenarios.length;
    } catch {
      /* ignore */
    }
  } finally {
    if (!disposed) voiceInitBusy.value = false;
  }
}

/** Cosy 扩展 Tab 首次进入：安装状态 / 发现 / sidecar / 探测 */
async function ensureCosyHeavyBootstrap() {
  if (cosyHeavyBootstrapped || disposed) return;
  cosyHeavyBootstrapped = true;
  void refreshCosyKeyFlags();
  await refreshCosyInstallStatus().then(() => healCosyBackendFromInstall()).catch(() => {
    /* ignore */
  });
  if (disposed) return;
  if (settings.value.cosyBackend === "fastapi") {
    // 始终强制刷新模型候选（缓存常只剩 CosyVoice2，漏掉 Fun-CosyVoice3）
    await runCosyAutoDiscover(true, undefined, true).catch(() => null);
    if (disposed) return;
    await Promise.race([
      Promise.all([refreshCosyFastapiVoices(), refreshCosySidecarStatus()]),
      new Promise<void>((resolve) => {
        window.setTimeout(resolve, 4000);
      }),
    ]);
    let diskWant = false;
    try {
      const { getCosyWantRunning } = await import("../../utils/cosyFastapiSidecarApi");
      const disk = await getCosyWantRunning();
      diskWant = Boolean(disk?.want);
      if (diskWant && !settings.value.cosyWantRunning) {
        persist({ cosyWantRunning: true });
      }
    } catch {
      /* ignore */
    }
    // 进入 Cosy 页时若应自动启却未在跑，立即拉起（不傻等 App 延迟）
    if (settings.value.cosyWantRunning || diskWant) {
      const st = await cosyFastapiSidecarStatus().catch(() => null);
      if (!st?.running) {
        void startCosySidecar();
      } else {
        void ensureCosyAutostartOnce()
          .then(async (r) => {
            if (disposed || !r) return;
            if (r.attempted) {
              cosySidecarHint.value = r.message;
              await probeCosyBackendSilent();
            }
          })
          .catch(() => {
            /* ignore */
          });
      }
    }
    void import("../../utils/cosyFastapiWarm")
      .then(async ({ warmCosyFastapiQuiet, isCosyFastapiWarmFresh }) => {
        if (disposed) return;
        const ok = await warmCosyFastapiQuiet({ force: true });
        if (!disposed) cosyWarmReady.value = ok || isCosyFastapiWarmFresh();
      })
      .catch(() => {
        /* ignore */
      });
  } else {
    void refreshCosyKeyFlags();
  }
  if (!disposed) {
    void refreshEngineStatus().catch(() => {
      /* ignore */
    });
  }
}

onUnmounted(() => {
  disposed = true;
  if (wakeListenPoll) {
    clearInterval(wakeListenPoll);
    wakeListenPoll = null;
  }
  previewGuard.dispose();
  stopProgress?.();
  stopProgress = null;
  stopNativeProgress?.();
  stopNativeProgress = null;
  stopPreview();
  stopCosyMatrix();
  window.speechSynthesis?.removeEventListener("voiceschanged", refreshSystemVoices);
});
</script>

<template>
  <section class="settings-section voice-settings-section">
    <div class="settings-section-header">
      <div>
        <h2 class="settings-section-title ui-font">语音与朗读</h2>
        <p class="settings-section-desc">
          先在「默认语音」选定引擎与通话策略；各声音页调音色试听；外部包与 API 独立配置。仅 Cosy 可调心情。
        </p>
      </div>
      <PageHelpButton topic="settings.voice-packs" label="说明" />
    </div>

    <div
      v-if="installBusy || progress"
      class="voice-progress voice-progress-sticky"
      aria-live="polite"
    >
      <div class="voice-progress-head">
        <span class="voice-progress-stage">{{ progressStageLabelText }}</span>
        <span class="voice-progress-msg">{{ progress?.message ?? "准备安装…" }}</span>
      </div>
      <div class="voice-progress-track" :class="{ indeterminate: progressIndeterminate }">
        <i :style="{ width: `${progressBarWidth}%` }" />
      </div>
      <div class="voice-progress-meta">
        <span class="voice-progress-pct">{{ progressPercentLabel }}</span>
        <span v-if="progressEta" class="voice-progress-eta">{{ progressEta }}</span>
      </div>
      <FouButton
        v-if="installBusy"
        icon="close-circle-line"
        type="danger"
        size="small"
        @click="cancelInstall"
      >
        取消
      </FouButton>
    </div>

    <FouTabBar
      :model-value="voicePanelTab"
      type="border-card"
      class="voice-settings-tabs"
      @update:model-value="onVoicePanelTabChange"
    >
      <FouTabPane name="defaults" label="默认语音">
        <div class="voice-panel">
          <div class="voice-block voice-card">
            <h3 class="voice-block-title">当前默认</h3>
            <p class="voice-muted">{{ defaultSummaryLabel }}</p>
            <div class="voice-actions voice-provider-row">
              <FouButton
                v-for="item in [
                  ['system-webspeech', 'computer-line'],
                  ['sherpa-onnx', 'download-cloud-2-line'],
                ]"
                :key="item[0]"
                :icon="item[1]"
                size="small"
                :type="isProviderButtonActive(item[0] as VoiceProviderId) ? 'primary' : 'default'"
                @click="selectProvider(item[0] as VoiceProviderId)"
              >
                {{ providerButtonLabel(item[0] as VoiceProviderId) }}
              </FouButton>
              <FouButton
                icon="cpu-line"
                size="small"
                :type="settings.provider === 'cosyvoice' ? 'primary' : 'default'"
                @click="selectProvider('cosyvoice')"
              >
                {{ providerButtonLabel("cosyvoice") }}
              </FouButton>
              <FouButton
                icon="cloud-line"
                size="small"
                @click="voicePanelTab = 'api'"
              >
                去 API TTS
              </FouButton>
            </div>
            <p class="voice-muted">
              未装好的引擎点选会跳到安装页，不会偷偷改掉当前默认。角色音色可在员工设置中绑定。
            </p>
            <div class="voice-field voice-call-realtime">
              <FouCheckbox
                :model-value="settings.callPreferRealtime !== false"
                @update:model-value="(v: boolean | string | number) => persist({ callPreferRealtime: Boolean(v) })"
              />
              <span>通话优先实时（仅离线引擎：正文改系统音）</span>
            </div>
            <p class="voice-muted">
              垫话/确认语始终用系统音抢开口。勾选后：默认引擎是离线 Kokoro 时，通话正文也改系统音以免拖慢；默认 Cosy 时正文仍走 Cosy（请先启动服务）。阿里云 / 自建是整段合成，不是边合边播。
            </p>
            <div class="voice-actions">
              <FouButton icon="equalizer-line" size="small" type="primary" @click="goTuneCurrentEngine">
                去调当前引擎音色
              </FouButton>
            </div>
          </div>
          <div class="voice-block voice-card">
            <h3 class="voice-block-title">通话外观</h3>
            <p class="voice-muted">
              仅改全屏通话助手形象，不是朗读音色。系统 / 离线 / Cosy 各自音色请到对应页签。
            </p>
            <div class="voice-field">
              <span class="voice-label">背景</span>
              <FouSelect
                class="voice-tone-select"
                :model-value="assistantBackgroundId"
                :options="assistantBackgroundOptions"
                @update:model-value="(v: string) => onAssistantBackgroundChange(String(v))"
              />
            </div>
          </div>
        </div>
      </FouTabPane>

      <FouTabPane name="wake" label="唤醒">
        <div class="voice-panel">
          <div class="voice-block voice-card">
            <h3 class="voice-block-title">语音唤醒</h3>
            <p class="voice-muted">
              任意业务页前台可听词；命中后全屏通话层置顶，可挂断关闭。有离线唤醒模型时优先本机听词（不依赖网络）；否则用在线识别，需能访问语音识别服务。
            </p>
            <p v-if="wakeListenHint" class="voice-muted">{{ wakeListenHint }}</p>
            <div class="voice-field voice-call-realtime">
              <FouCheckbox
                :model-value="settings.wakeEnabled"
                @update:model-value="(v: boolean | string | number) => persist({ wakeEnabled: Boolean(v) })"
              />
              <span>启用语音唤醒（仅前台；通话中暂停）</span>
            </div>
            <div class="voice-field voice-call-realtime">
              <FouCheckbox
                :model-value="settings.wakeConfirmSpeak !== false"
                @update:model-value="(v: boolean | string | number) => persist({ wakeConfirmSpeak: Boolean(v) })"
              />
              <span>命中后先说「在呢」再进通话</span>
            </div>
            <div class="voice-field voice-call-realtime">
              <FouCheckbox
                :model-value="settings.wakeMaximizeWindow !== false"
                @update:model-value="(v: boolean | string | number) => persist({ wakeMaximizeWindow: Boolean(v) })"
              />
              <span>唤醒时最大化主窗口</span>
            </div>
            <div class="voice-field">
              <span class="voice-label">识别语言</span>
              <FouSelect
                :model-value="settings.wakeLang"
                :options="wakeLangOptions"
                style="width: 200px"
                @update:model-value="(v: string | number | boolean | undefined) => persist({ wakeLang: String(v || 'zh-CN') })"
              />
            </div>
            <div class="voice-field">
              <span class="voice-label">唤醒词</span>
              <FouInput v-model="wakePhrasesDraft" placeholder="虚募阁，小虚，嘿虚幕" />
              <FouButton icon="save-line" size="small" @click="saveWakePhrasesFromDraft">
                保存唤醒词
              </FouButton>
            </div>
          </div>
        </div>
      </FouTabPane>

      <FouTabPane name="system" label="系统语音">
        <div class="voice-panel">
          <div class="voice-block voice-card">
            <h3 class="voice-block-title">系统音色与试听</h3>
            <p class="voice-muted">
              只列出本机已安装的中文系统声线（常见为慧慧 / 瑶瑶等）。无心情、无戏剧角色声。
            </p>
            <div class="voice-actions">
              <FouButton
                icon="check-line"
                size="small"
                type="primary"
                @click="selectProvider('system-webspeech')"
              >
                设为当前默认
              </FouButton>
            </div>
            <div v-if="systemGenderOptions.length > 1" class="voice-field">
              <span class="voice-label">性别</span>
              <div class="voice-actions">
                <FouButton
                  v-for="g in systemGenderOptions"
                  :key="g.value"
                  :icon="g.value === 'female' ? 'user-smile-line' : 'user-line'"
                  size="small"
                  :type="settings.voiceGender === g.value ? 'primary' : 'default'"
                  @click="selectVoiceGender(g.value)"
                >
                  {{ g.label }}
                </FouButton>
              </div>
            </div>
            <div class="voice-field">
              <span class="voice-label">声线</span>
              <FouSelect
                class="voice-tone-select"
                :model-value="settings.voice"
                :options="systemVoiceSelectOptions"
                @update:model-value="(v: string) => selectSystemVoice(String(v))"
              />
            </div>
            <p v-if="!systemVoiceSelectOptions.length" class="voice-muted">
              未检测到中文系统声线。请在 Windows「设置 → 时间和语言 → 语音」中安装中文语音包。
            </p>
            <div class="voice-field">
              <span class="voice-label">试听文案</span>
              <FouInput v-model="systemPreviewText" placeholder="输入要试听的句子" />
            </div>
            <div class="voice-actions">
              <FouButton icon="play-circle-line" type="primary" :loading="previewBusy" @click="preview">
                播放试听
              </FouButton>
              <FouButton v-if="previewBusy" icon="stop-circle-line" @click="stopPreview">停止</FouButton>
            </div>
          </div>
        </div>
      </FouTabPane>

      <FouTabPane name="offline" label="离线语音">
        <div class="voice-panel">
          <div class="voice-block voice-card">
            <h3 class="voice-block-title">离线音色与试听</h3>
            <p class="voice-muted">
              {{ KOKORO_TONE_BLURB }} 无心情。萝莉 / 夹子等请到 CosyVoice。
            </p>
            <div class="voice-actions">
              <FouButton
                icon="check-line"
                size="small"
                type="primary"
                @click="selectProvider('sherpa-onnx')"
              >
                设为当前默认
              </FouButton>
              <FouButton icon="download-cloud-2-line" size="small" @click="voicePanelTab = 'packs'">
                去安装离线包
              </FouButton>
            </div>
            <div class="voice-field">
              <span class="voice-label">性别</span>
              <div class="voice-actions">
                <FouButton
                  v-for="g in genderOptions"
                  :key="g.value"
                  :icon="g.value === 'female' ? 'user-smile-line' : 'user-line'"
                  size="small"
                  :type="settings.voiceGender === g.value ? 'primary' : 'default'"
                  @click="selectVoiceGender(g.value)"
                >
                  {{ g.label }}
                </FouButton>
              </div>
            </div>
            <div class="voice-field">
              <span class="voice-label">Kokoro 声线</span>
              <FouSelect
                class="voice-tone-select"
                :model-value="resolveKokoroVoiceId(settings.voice)"
                :options="kokoroVoiceSelectOptions"
                @update:model-value="(v: string) => applyKokoroVoice(String(v))"
              />
            </div>
            <div class="voice-tuning">
              <div
                v-for="field in [
                  { key: 'rate', label: '语速', step: 0.05 },
                  { key: 'pitch', label: '音高', step: 0.05 },
                  { key: 'volume', label: '音量', step: 0.05 },
                ]"
                :key="field.key"
                class="voice-tune"
              >
                <span>{{ field.label }}</span>
                <FouButton
                  icon="subtract-line"
                  size="small"
                  aria-label="降低"
                  @click="adjust(field.key as 'rate' | 'pitch' | 'volume', -field.step)"
                />
                <strong>{{ settings[field.key as 'rate' | 'pitch' | 'volume'].toFixed(2) }}</strong>
                <FouButton
                  icon="add-line"
                  size="small"
                  aria-label="提高"
                  @click="adjust(field.key as 'rate' | 'pitch' | 'volume', field.step)"
                />
              </div>
            </div>
            <div class="voice-field">
              <span class="voice-label">试听文案</span>
              <FouInput v-model="offlinePreviewText" placeholder="输入要试听的句子" />
            </div>
            <div class="voice-actions">
              <FouButton icon="play-circle-line" type="primary" :loading="previewBusy" @click="preview">
                播放试听
              </FouButton>
              <FouButton v-if="previewBusy" icon="stop-circle-line" @click="stopPreview">停止</FouButton>
            </div>
          </div>
        </div>
      </FouTabPane>

      <FouTabPane name="cosy" label="CosyVoice">
        <div class="voice-panel">
          <div class="voice-block voice-card">
            <h3 class="voice-block-title">运行版本</h3>
            <p class="voice-muted">
              上方按钮选合成模式（不是安装包名）。具体权重看下方模型目录；启动服务请到「本机 FastAPI」。
            </p>
            <div class="voice-actions">
              <FouButton
                icon="cpu-line"
                size="small"
                :type="!settings.cosyVoice2 ? 'primary' : 'default'"
                @click="setCosyVoiceVersion(false)"
              >
                CosyVoice1（内置说话人）
              </FouButton>
              <FouButton
                icon="sparkling-2-line"
                size="small"
                :type="settings.cosyVoice2 ? 'primary' : 'default'"
                @click="setCosyVoiceVersion(true)"
              >
                CosyVoice2/3（参考音）
              </FouButton>
            </div>
            <div v-if="cosyModelSelectOptions.length" class="voice-field">
              <span class="voice-label">模型目录</span>
              <FouSelect
                class="voice-tone-select"
                :model-value="settings.cosyModelDir"
                :options="cosyModelSelectOptions"
                @update:model-value="(v: string) => selectCosyModelDir(String(v))"
              />
            </div>
            <p class="voice-muted">{{ cosyVersionStatusLabel }}</p>
          </div>

          <div class="voice-block voice-card">
            <h3 class="voice-block-title">音色 · 心情 · 试听</h3>
            <p class="voice-muted">
              仅 Cosy 可调心情。试听必播下方输入框全文。服务已热时起播较快；冷启动首句可能需数秒。
            </p>
            <div class="voice-actions">
              <FouButton
                icon="check-line"
                size="small"
                type="primary"
                @click="saveCosyBackend('fastapi'); selectProvider('cosyvoice')"
              >
                设为当前默认（本机）
              </FouButton>
            </div>
            <div class="voice-field">
              <span class="voice-label">性别</span>
              <div class="voice-actions">
                <FouButton
                  v-for="g in genderOptions"
                  :key="g.value"
                  :icon="g.value === 'female' ? 'user-smile-line' : 'user-line'"
                  size="small"
                  :type="settings.voiceGender === g.value ? 'primary' : 'default'"
                  @click="selectVoiceGender(g.value)"
                >
                  {{ g.label }}
                </FouButton>
              </div>
            </div>
            <div class="voice-field">
              <span class="voice-label">音色</span>
              <FouSelect
                class="voice-tone-select"
                :model-value="settings.timbreId"
                :options="cosyTimbreOptions"
                @update:model-value="(v: string) => applyTimbre(String(v))"
              />
            </div>
            <div class="voice-field">
              <span class="voice-label">心情</span>
              <FouSelect
                class="voice-tone-select"
                :model-value="settings.moodId"
                :options="moodOptions"
                @update:model-value="(v: string) => applyMood(String(v))"
              />
            </div>
            <div class="voice-field">
              <span class="voice-label">试听文案</span>
              <FouInput v-model="cosyPreviewText" placeholder="输入要试听的句子" />
            </div>
            <div class="voice-actions">
              <FouButton icon="play-circle-line" type="primary" :loading="previewBusy" @click="preview">
                播放试听
              </FouButton>
              <FouButton v-if="previewBusy" icon="stop-circle-line" @click="stopPreview">停止</FouButton>
            </div>
            <p v-if="cosyWarmReady" class="voice-muted voice-install-ready">本机合成已暖机，试听应较快开口。</p>
          </div>

          <div class="voice-block voice-card">
            <h3 class="voice-block-title">控制面板 · 音色 × 心情穷测</h3>
            <p class="voice-muted">点格子试听当前性别下该音色+心情；「全部穷测」会依次播放。穷测使用固定短句，不是上方试听文案。</p>
            <div class="voice-actions" style="margin-bottom: 8px">
              <FouButton
                icon="grid-line"
                size="small"
                type="primary"
                :loading="cosyMatrixBusy"
                @click="runCosyVoiceEmotionMatrix()"
              >
                全部穷测
              </FouButton>
              <FouButton
                v-if="cosyMatrixBusy"
                icon="stop-circle-line"
                size="small"
                @click="stopCosyMatrix"
              >
                停止穷测
              </FouButton>
            </div>
            <div class="voice-matrix-grid">
              <div v-for="t in matrixTimbreRows" :key="t.id" class="voice-matrix-row">
                <strong>{{ t.label }}</strong>
                <FouButton
                  v-for="m in matrixMoods"
                  :key="`${t.id}-${m.id}`"
                  icon="play-mini-line"
                  size="small"
                  :disabled="cosyMatrixBusy"
                  @click="runCosyVoiceEmotionMatrix({ timbreId: t.id, moodId: m.id })"
                >
                  {{ m.label }}
                </FouButton>
              </div>
            </div>
          </div>

<div class="voice-block voice-card voice-env-install">
      <h3 class="voice-block-title">环境安装状态</h3>
      <p class="voice-muted">
        协助安装负责环境与模型。装好后可启动本机服务。
      </p>
      <p
        class="voice-muted"
        :class="cosyInstallPhase === 'ready' ? 'voice-install-ready' : ''"
      >
        阶段：{{ cosyInstallPhase === "ready" ? "环境已就绪" : cosyInstallPhase }}
        <template v-if="cosyInstallRead?.installJson?.percent != null">
          · {{ cosyInstallRead?.installJson?.percent }}%
        </template>
      </p>
      <p v-if="cosyInstallResumeLabel" class="voice-muted voice-install-warn">{{ cosyInstallResumeLabel }}</p>
      <p v-if="cosyEnvReadyHint" class="voice-muted voice-install-ready">{{ cosyEnvReadyHint }}</p>
      <p v-if="voiceInitBusy" class="voice-muted">正在加载语音引擎状态…</p>
      <div class="voice-actions">
        <FouButton icon="tools-line" size="small" type="primary" @click="showCosyAssist = true">
          系统协助安装
        </FouButton>
        <FouButton
          v-if="cosyInstallRead?.canResume"
          icon="play-circle-line"
          size="small"
          :loading="cosyInstallBusy"
          @click="resumeCosyInstall"
        >
          继续安装
        </FouButton>
        <FouButton icon="file-list-3-line" size="small" @click="showCosyInstallLog">
          打开安装日志
        </FouButton>
        <FouButton
          icon="radar-line"
          size="small"
          :loading="cosyDiscoverBusy"
          @click="runCosyAutoDiscover(false, undefined, true)"
        >
          自动检测路径
        </FouButton>
      </div>
    </div>
    <div class="voice-block voice-card">
      <h3 class="voice-block-title">本机 FastAPI</h3>
      <p class="voice-muted">装好环境后在此启动本机服务。云端与远程接口请到「API TTS」。</p>
      <div class="voice-actions">
        <FouButton
          icon="check-line"
          size="small"
          type="primary"
          @click="saveCosyBackend('fastapi'); selectProvider('cosyvoice')"
        >
          使用本机 Cosy
        </FouButton>
        <FouButton icon="radar-line" size="small" @click="probeSelectedCosyBackend">
          探测后端
        </FouButton>
      </div>
      <p v-if="cosyBackendHint" class="voice-muted">{{ cosyBackendHint }}</p>

        <div v-if="cosyDiscoverStatusLines.length" class="voice-discover-status">
          <p v-for="(line, idx) in cosyDiscoverStatusLines" :key="idx" class="voice-muted">{{ line }}</p>
        </div>
        <p v-else-if="cosyDiscoverBusy" class="voice-muted">正在自动检测 CosyVoice 路径…</p>
        <p v-else class="voice-muted">进入本页将自动检测本机 CosyVoice；也可手动重跑检测。</p>
        <div class="voice-actions voice-sidecar-top">
          <FouButton
            icon="radar-line"
            size="small"
            :loading="cosyDiscoverBusy"
            @click="runCosyAutoDiscover(false, undefined, true)"
          >
            自动检测本机 CosyVoice
          </FouButton>
          <FouButton
            icon="play-circle-line"
            size="small"
            type="primary"
            :loading="cosySidecarBusy"
            @click="startCosySidecar"
          >
            启动服务
          </FouButton>
          <FouButton icon="stop-circle-line" size="small" :loading="cosySidecarBusy" @click="stopCosySidecar">
            停止
          </FouButton>
          <FouButton icon="information-line" size="small" @click="refreshCosySidecarStatus">
            状态
          </FouButton>
          <FouButton icon="radar-line" size="small" @click="probeSelectedCosyBackend">
            探测后端
          </FouButton>
          <FouButton
            icon="window-line"
            size="small"
            :loading="cosyConsoleBusy"
            @click="openCosyConsoleWindow"
          >
            打开 Cosy 控制台
          </FouButton>
        </div>
        <div
          v-if="cosyDiscoverReport && !cosyDiscoverReport.ok"
          class="voice-install-row voice-discover-fallback"
        >
          <span class="voice-label">Cosy 根目录</span>
          <FouInput
            :model-value="settings.cosyScanRoot"
            readonly
            placeholder="自动检测未完整识别，选一次根目录后重扫"
          />
          <FouButton icon="folder-open-line" size="small" @click="pickCosyScanRoot">选目录</FouButton>
        </div>
        <p v-if="cosySidecarHint" class="voice-muted">{{ cosySidecarHint }}</p>
        <div class="voice-install-row">
          <span class="voice-label">内置 spk</span>
          <div class="voice-actions voice-scroll">
            <FouButton
              v-for="spk in COSY_FASTAPI_BUILTIN_SPK"
              :key="spk.id"
              icon="user-voice-line"
              size="small"
              :type="settings.cosyFastapiSpkId === spk.id ? 'primary' : 'default'"
              @click="selectBuiltinSpk(spk.id)"
            >
              {{ spk.name }}
            </FouButton>
          </div>
        </div>
        <div class="voice-actions">
          <FouButton
            icon="settings-3-line"
            size="small"
            @click="showCosyAdvanced = !showCosyAdvanced"
          >
            {{ showCosyAdvanced ? '收起高级路径' : '高级路径' }}
          </FouButton>
        </div>
        <div v-if="showCosyAdvanced" class="voice-fastapi-launch">
          <p class="voice-muted">以下为当前检测到的语音服务配置；需改路径时请选 Cosy 根目录后重跑自动检测。</p>
          <div class="voice-install-row">
            <span class="voice-label">服务地址</span>
            <FouInput :model-value="settings.cosyFastapiBaseUrl" readonly placeholder="例如本机语音服务端口" />
            <FouButton icon="file-copy-line" size="small" @click="copyCosyPath(settings.cosyFastapiBaseUrl)">
              复制
            </FouButton>
          </div>
          <div class="voice-install-row">
            <span class="voice-label">音色库</span>
            <FouInput :model-value="settings.cosyVoicesRoot" readonly placeholder="含示例音频的子目录" />
            <FouButton icon="file-copy-line" size="small" @click="copyCosyPath(settings.cosyVoicesRoot)">
              复制
            </FouButton>
            <FouButton icon="refresh-line" size="small" @click="refreshCosyFastapiVoices">扫描</FouButton>
          </div>
          <div class="voice-install-row">
            <span class="voice-label">附加参数</span>
            <FouInput
              :model-value="settings.cosyExtraArgs"
              @update:model-value="(v: string) => persist({ cosyExtraArgs: String(v) })"
              placeholder="可选，空格分隔"
            />
          </div>
        </div>
        
    </div>
        </div>
      </FouTabPane>

      <FouTabPane name="packs" label="外部语音包">
        <div class="voice-panel">
          <div v-if="packs.length" class="voice-block voice-card">
            <h3 class="voice-block-title">已装包</h3>
            <p class="voice-muted">装好后到「离线语音」或「CosyVoice」选用并试听。</p>
            <div class="voice-pack-list">
              <div v-for="pack in packs" :key="pack.id" class="voice-pack-row">
                <div>
                  <strong>{{ pack.id }} · {{ pack.version }}</strong>
                  <p>
                    {{ pack.provider }} · {{ pack.licenseSpdx }} ·
                    {{ (pack.size / 1024 / 1024).toFixed(1) }} MB
                  </p>
                </div>
                <div class="voice-actions">
                  <FouButton
                    v-if="pack.provider === 'sherpa-onnx'"
                    icon="arrow-right-line"
                    size="small"
                    @click="voicePanelTab = 'offline'"
                  >
                    去离线页
                  </FouButton>
                  <FouButton
                    v-else-if="pack.provider === 'cosyvoice'"
                    icon="arrow-right-line"
                    size="small"
                    @click="voicePanelTab = 'cosy'"
                  >
                    去 Cosy 页
                  </FouButton>
                  <FouButton icon="delete-bin-line" type="danger" size="small" @click="removePack(pack)">
                    卸载
                  </FouButton>
                </div>
              </div>
            </div>
          </div>

          <div class="voice-block voice-card">
            <h3 class="voice-block-title">安装离线语音</h3>
            <p class="voice-muted">{{ engineToneBlurb("sherpa-onnx") }}</p>
            <p class="voice-muted">
              推荐：一键安装经国内加速源下载识别与朗读模型（约 250MB）；单源失败会换下一源。
            </p>
            <div class="voice-actions">
              <FouButton
                icon="download-cloud-2-line"
                type="primary"
                :loading="installBusy"
                :disabled="installBusy"
                @click="installNativeOffline"
              >
                一键安装离线语音
              </FouButton>
            </div>

            <div class="voice-virmoor-block">
              <div class="voice-field">
                <h4 class="voice-block-title">虚募阁发布</h4>
                <FouButton icon="refresh-line" size="small" :disabled="installBusy" @click="refreshCatalog">
                  刷新目录
                </FouButton>
              </div>
              <p class="voice-download-status ui-font">
                下载中心：
                <span :class="virmoorDownloadAvailable ? 'ok' : catalogError ? 'warn' : 'no'">
                  {{ virmoorDownloadStatusLabel }}
                </span>
                <template v-if="!virmoorLoggedIn && virmoorDownloadAvailable"> · 下载前需登录</template>
              </p>
              <p v-if="catalogError && !virmoorDownloadAvailable" class="voice-muted">{{ catalogError }}</p>
              <div
                v-for="entry in virmoorCatalogEntries"
                :key="entry.fileId || entry.downloadUrl"
                class="voice-pack-row"
              >
                <div>
                  <strong>{{ entry.name }}</strong>
                  <p>
                    {{ catalogSourceLabel(entry) }} · {{ entry.provider }}
                    <template v-if="entry.licenseSpdx"> · {{ entry.licenseSpdx }}</template>
                    <template v-if="entry.needsGpu"> · 需 GPU</template>
                  </p>
                </div>
                <FouButton
                  icon="download-2-line"
                  type="primary"
                  size="small"
                  :disabled="installBusy"
                  @click="installFromCatalogEntry(entry)"
                >
                  下载安装
                </FouButton>
              </div>
              <div v-if="!virmoorCatalogEntries.length" class="voice-muted">
                暂无已发布语音包。可在管理端下载中心上架后点刷新。
              </div>
              <div class="voice-actions">
                <FouButton
                  icon="download-cloud-2-line"
                  type="primary"
                  size="small"
                  :disabled="installBusy || !virmoorDownloadAvailable"
                  @click="downloadFromVirmoor"
                >
                  从虚募阁下载
                </FouButton>
                <FouButton icon="folder-open-line" size="small" :disabled="installBusy" @click="pickLocalZip">
                  从本机选择 ZIP
                </FouButton>
              </div>
            </div>

            <div class="voice-actions">
              <FouButton
                :icon="showVendorAdvanced ? 'arrow-up-s-line' : 'links-line'"
                size="small"
                @click="showVendorAdvanced = !showVendorAdvanced"
              >
                {{ showVendorAdvanced ? "收起高级来源" : "高级：厂商目录 / 自定义 ZIP" }}
              </FouButton>
            </div>

            <template v-if="showVendorAdvanced">
              <p class="voice-download-status ui-font">
                厂商目录：
                <span :class="vendorDownloadAvailable ? 'ok' : vendorDownloadConfigured ? 'warn' : 'no'">
                  {{ vendorDownloadStatusLabel }}
                </span>
              </p>
              <div
                v-for="entry in vendorCatalogEntriesForPanel"
                :key="entry.fileId || entry.downloadUrl"
                class="voice-pack-row"
              >
                <div>
                  <strong>{{ entry.name }}</strong>
                  <p>
                    {{ catalogSourceLabel(entry) }} · {{ entry.provider }}
                    <template v-if="entry.licenseSpdx"> · {{ entry.licenseSpdx }}</template>
                    <template v-if="catalogEntryMeta(entry)"> · {{ catalogEntryMeta(entry) }}</template>
                  </p>
                </div>
                <FouButton
                  icon="download-2-line"
                  type="primary"
                  size="small"
                  :disabled="installBusy"
                  @click="installFromCatalogEntry(entry)"
                >
                  下载安装
                </FouButton>
              </div>
              <div class="voice-actions">
                <FouButton
                  icon="download-2-line"
                  type="primary"
                  size="small"
                  :disabled="installBusy || !vendorDownloadAvailable"
                  @click="downloadFromVoicePackSite"
                >
                  从厂商目录下载
                </FouButton>
              </div>
              <div class="voice-install-row voice-vendor-site">
                <span class="voice-label">厂商目录</span>
                <FouInput
                  v-model="vendorSiteUrl"
                  :disabled="installBusy"
                  class="voice-vendor-input"
                  placeholder="可选：目录或 ZIP 直链"
                />
                <FouButton icon="save-line" size="small" :disabled="installBusy" @click="saveVendorSiteUrl">
                  保存
                </FouButton>
              </div>
              <div class="voice-install-row">
                <FouInput
                  v-model="installUrl"
                  :disabled="installBusy"
                  placeholder="自定义 ZIP 地址"
                />
                <FouButton
                  icon="download-2-line"
                  type="primary"
                  :loading="installBusy"
                  @click="installFromUrl()"
                >
                  下载安装
                </FouButton>
              </div>
            </template>
          </div>
        </div>
      </FouTabPane>

      <FouTabPane name="api" label="API TTS">
        <div class="voice-panel">
          <div class="voice-block voice-card">
            <h3 class="voice-block-title">远程 API（CosyVoice 协议）</h3>
            <p class="voice-muted">DashScope 云端或自建远程 JSON。密钥保存在本机。本机 Cosy 安装请到「CosyVoice」页。</p>
            <div class="voice-actions">
              <FouButton
                icon="cloud-line"
                size="small"
                :type="settings.cosyBackend === 'dashscope' ? 'primary' : 'default'"
                @click="saveCosyBackend('dashscope')"
              >
                DashScope
              </FouButton>
              <FouButton
                icon="server-line"
                size="small"
                :type="settings.cosyBackend === 'customHttp' ? 'primary' : 'default'"
                @click="saveCosyBackend('customHttp')"
              >
                远程 JSON
              </FouButton>
              <FouButton
                icon="check-line"
                size="small"
                type="primary"
                @click="selectProvider('cosyvoice')"
              >
                设为当前朗读
              </FouButton>
              <FouButton icon="radar-line" size="small" @click="probeSelectedCosyBackend">
                探测后端
              </FouButton>
            </div>
            <p v-if="cosyBackendHint" class="voice-muted">{{ cosyBackendHint }}</p>
            <div v-if="settings.cosyBackend === 'dashscope'" class="voice-remote-panel">
              <span class="voice-label">API Key</span>
              <FouInput
                v-model="cosyDashKeyDraft"
                type="password"
                :placeholder="cosyKeyConfigured.dashscope ? '已配置，可覆盖保存' : '阿里云百炼 API Key'"
              />
              <FouButton icon="save-line" size="small" @click="saveDashscopeKey">保存 Key</FouButton>
            </div>
            <div v-if="settings.cosyBackend === 'customHttp'" class="voice-remote-panel">
              <span class="voice-label">Base URL</span>
              <FouInput
                :model-value="settings.cosyCustomBaseUrl"
                @update:model-value="(v: string) => persist({ cosyCustomBaseUrl: String(v) })"
                placeholder="远程合成地址"
              />
              <FouInput
                v-model="cosyCustomKeyDraft"
                type="password"
                :placeholder="cosyKeyConfigured.custom ? '已配置可选密钥' : '可选访问密钥'"
              />
              <FouButton icon="save-line" size="small" @click="saveCustomHttpKey">保存 Key</FouButton>
            </div>
            <div class="voice-field voice-call-realtime">
              <FouCheckbox
                :model-value="settings.apiSupportsMood !== false"
                @update:model-value="(v: boolean | string | number) => persist({ apiSupportsMood: Boolean(v) })"
              />
              <span>该 API 支持心情/instruct（仅勾选后才注入心情；云端仍是整段合成）</span>
            </div>
            <div class="voice-field">
              <span class="voice-label">性别</span>
              <div class="voice-actions">
                <FouButton
                  v-for="g in genderOptions"
                  :key="g.value"
                  :icon="g.value === 'female' ? 'user-smile-line' : 'user-line'"
                  size="small"
                  :type="settings.voiceGender === g.value ? 'primary' : 'default'"
                  @click="selectVoiceGender(g.value)"
                >
                  {{ g.label }}
                </FouButton>
              </div>
            </div>
            <div class="voice-field">
              <span class="voice-label">音色</span>
              <FouSelect
                class="voice-tone-select"
                :model-value="settings.timbreId"
                :options="cosyTimbreOptions"
                @update:model-value="(v: string) => applyTimbre(String(v))"
              />
            </div>
            <div v-if="settings.apiSupportsMood !== false" class="voice-field">
              <span class="voice-label">心情</span>
              <FouSelect
                class="voice-tone-select"
                :model-value="settings.moodId"
                :options="moodOptions"
                @update:model-value="(v: string) => applyMood(String(v))"
              />
            </div>
            <div class="voice-field">
              <span class="voice-label">试听文案</span>
              <FouInput v-model="cosyPreviewText" placeholder="输入要试听的句子" />
            </div>
            <div class="voice-actions">
              <FouButton icon="play-circle-line" type="primary" :loading="previewBusy" @click="preview">
                播放试听
              </FouButton>
              <FouButton v-if="previewBusy" icon="stop-circle-line" @click="stopPreview">停止</FouButton>
            </div>
          </div>
        </div>
      </FouTabPane>
    </FouTabBar>

    <CosyVoiceAssistInstallDialog v-model:visible="showCosyAssist" @done="onCosyAssistDone" />
  </section>
</template>

<style scoped>
.voice-settings-section {
  display: grid;
  gap: 14px;
  max-width: 920px;
}
.voice-settings-tabs {
  margin-top: 4px;
}
.voice-settings-tabs :deep(.fou-tab-bar__content),
.voice-custom-tabs :deep(.fou-tab-bar__content),
.voice-cosy-backend-tabs :deep(.fou-tab-bar__content) {
  padding-top: 12px;
}
.voice-panel {
  display: grid;
  gap: 14px;
}
.voice-card {
  padding: 14px 16px;
  border: 1px solid var(--border-color, #dbe3ea);
  border-radius: 12px;
  background: var(--surface, rgba(255, 255, 255, 0.55));
}
.voice-card-inset {
  margin-top: 4px;
  padding: 12px;
  border-radius: 10px;
  background: rgba(100, 116, 139, 0.06);
  display: grid;
  gap: 10px;
}
.voice-provider-row {
  gap: 10px;
}
.voice-progress-sticky {
  margin: 0;
}
.voice-virmoor-block {
  display: grid;
  gap: 10px;
  padding: 12px;
  border-radius: 10px;
  background: rgba(14, 165, 233, 0.06);
  border: 1px solid rgba(14, 165, 233, 0.18);
}
.voice-fastapi-panel { display: grid; gap: 10px; padding-top: 4px; }
.voice-sidecar-top { margin-bottom: 4px; }
.voice-install-ready { color: var(--success, #16a34a); font-weight: 600; }
.voice-install-warn { color: var(--warning, #d97706); }
.voice-fastapi-launch { display: grid; gap: 8px; padding: 8px 0; }
.voice-matrix-grid { display: grid; gap: 8px; max-height: 220px; overflow: auto; }
.voice-matrix-row { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.voice-matrix-row strong { min-width: 64px; }
.voice-block { display: grid; gap: 10px; }
.voice-block-title { margin: 0; font-size: 14px; font-weight: 650; }
.voice-field, .voice-install-row, .voice-actions, .voice-tune { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.voice-call-realtime { margin-top: 4px; cursor: pointer; align-items: flex-start; }
.voice-call-realtime .voice-muted { display: inline; }
.voice-label { min-width: 76px; font-weight: 600; }
.voice-tone-select { min-width: 180px; max-width: 280px; }
.voice-scroll { max-height: 132px; overflow: auto; }
.voice-muted, .voice-pack-row p { margin: 0; color: var(--text-secondary, #64748b); font-size: 12px; }
.voice-tuning { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
.voice-tune { padding: 10px; border: 1px solid var(--border-color, #dbe3ea); border-radius: 10px; }
.voice-tune strong { min-width: 42px; text-align: center; }
.voice-install-panel { display: grid; gap: 8px; padding-top: 8px; }
.voice-progress-top { margin-bottom: 8px; }
.voice-installer { display: grid; gap: 8px; }
.voice-installer h3 { margin: 0; font-size: 14px; }
.voice-download-status { margin: 0 0 4px; font-size: 12px; color: var(--text-secondary, #64748b); }
.voice-download-status .ok { color: var(--success, #16a34a); font-weight: 600; }
.voice-download-status .warn { color: var(--warning, #d97706); font-weight: 600; }
.voice-download-status .no { color: var(--text-secondary, #94a3b8); font-weight: 600; }
.voice-install-row :deep(.fou-input) { flex: 1; min-width: 260px; }
.voice-progress {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 6px 10px;
  align-items: center;
  font-size: 12px;
  padding: 10px 12px;
  border-radius: 10px;
  background: rgba(100, 116, 139, .08);
}
.voice-progress-head {
  grid-column: 1 / -1;
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}
.voice-progress-stage {
  flex: 0 0 auto;
  padding: 2px 8px;
  border-radius: 999px;
  font-weight: 600;
  font-size: 11px;
  color: var(--primary, #0ea5e9);
  background: rgba(14, 165, 233, .12);
}
.voice-progress-msg {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-secondary, #64748b);
}
.voice-progress-track {
  grid-column: 1;
  height: 8px;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(100, 116, 139, .18);
}
.voice-progress-track.indeterminate i {
  animation: voice-progress-pulse 1.2s ease-in-out infinite;
}
.voice-progress-track i {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--primary, #0ea5e9);
  transition: width .2s ease;
}
.voice-progress-meta {
  grid-column: 2;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
  min-width: 72px;
  font-variant-numeric: tabular-nums;
}
.voice-progress-pct { font-weight: 600; }
.voice-progress-eta { font-size: 11px; color: var(--text-secondary, #64748b); }
.voice-progress-eta.muted { font-weight: 400; }
@keyframes voice-progress-pulse {
  0%, 100% { opacity: .55; }
  50% { opacity: 1; }
}
.voice-pack-list { display: grid; gap: 8px; }
.voice-pack-row { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 10px 12px; border: 1px solid var(--border-color, #dbe3ea); border-radius: 10px; }
@media (max-width: 760px) { .voice-tuning { grid-template-columns: 1fr; } }
@media (prefers-reduced-motion: reduce) {
  .voice-progress-track i { transition: none; }
  .voice-progress-track.indeterminate i { animation: none; }
}
.voice-gpu-warn { color: var(--warning, #d97706); font-weight: 600; }
.voice-vendor-site { align-items: flex-start; }
.voice-vendor-input { flex: 1; min-width: 220px; }
.voice-vendor-hint { margin: -4px 0 8px 84px; }
</style>
