<script setup lang="ts">
/**
 * @file 办公室协作聊天条：员工流式状态、澄清与派活
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-31
 * @updated 2026-09-02
 * @version 1.1.0
 * @category AgentLoop
 * @algo disposed-listener-guard
 */
import { onApiCatch, toUserError } from "../utils/userFacingError";
import { computed, nextTick, onMounted, onUnmounted, ref } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { FouButton, fouMsg, fouAlert} from "foucui";
import {
  appendFouMessage,
  dispatchEmployeeTask,
  resumeEmployeeAfterConfirm,
  listenFouChunks,
  subscribeAgentLive,
  subscribeEmployeeLive,
  getLivePatch,
  updateEmployee,
  bindStreamSession,
  clearOfficeLiveStream,
  clearOfficeLiveStreamBySession,
  getEmployeeIdBySession,
  setOfficeLiveStream,
  type AgentLiveEvent,
  type Employee,
  type EmployeeLiveEvent,
} from "../employee";
import { stopAllEmployeeDispatches, stopEmployeeDispatch, clearDispatchQueue } from "../employee/dispatch";
import { resetAndReplanTask } from "../utils/projectDispatchHints";
import {
  loadProjectTheme,
  saveProjectTheme,
  type ProjectTheme,
} from "../utils/projectTheme";
import { bumpAssignmentProgress } from "../utils/projectStaffing";
import { loadProjects, PROJECT_TYPE_LABEL, type XuProject } from "../utils/projects";
import { appendActivityLog } from "../utils/activityLog";
import { openAppSettings } from "../utils/openAppSettings";
import { loadOfficeLayout } from "../utils/officeLayout";
import { BOSS_PEER_ID, OFFICE_FLOOR, isOfficeFloorStripVisible, peerSessionTag } from "../utils/officeComms";
import { parseRememberCommand, rememberUserNote } from "../employee/memory";
import { rememberQuestionOutline } from "../utils/questionOutlineMemory";
import {
  confirmBriefFromUi,
  formatBriefSummary,
  handleOfficeClarifyGate,
  handleSingleDispatchClarifyGate,
  loadBrief,
  routeBossIntent,
  runBriefMatchedKickoff,
  classifyLocalUserTurn,
  resolveWorkModeWithAssist,
  needsBriefCollection,
  turnKindSystemHint,
  type RequirementBrief,
} from "../intent";
import {
  buildClarifyDialogOpen,
  briefPipelineStageLabel,
  CLARIFY_DIALOG_HINT_OFFICE,
  markClarifyDialogOpened,
  shouldOfficeAutoOpenClarify,
  XU_CLARIFY_PENDING,
  resolveClarifyQuestions,
} from "../intent/clarifyUi";
import { briefGapsOptsFromBrief } from "../intent/briefGaps";
import { checkKickoffPreflight } from "../intent/kickoffPreflight";
import {
  formatClarifyAnswers,
} from "../intent/clarifyQuestionParse";
import RequirementClarifyDialog from "./RequirementClarifyDialog.vue";
import ProjectStartConfirmDialog from "./ProjectStartConfirmDialog.vue";
import DesignConfirmDialog from "./DesignConfirmDialog.vue";
import {
  XU_DESIGN_CONFIRM_NEEDED,
  XU_DESIGN_CONFIRMED,
  hasDesignArtifacts,
} from "../intent/designArtifacts";
import { isWorkKickoff, isWorkReset, isWorkStop } from "../utils/bossStopIntent";
import {
  beginEscalationForNeedConfirm,
  escalationHintForStage,
  findManagerEmployee,
  parseManagerIntent,
  readEscalationStage,
  writeEscalationStage,
} from "../utils/escalationChain";
import {
  beginMeetingFuse,
  bumpMeetingRound,
  checkMeetingFuse,
  clearMeetingFuse,
  formatMeetingFuseConclusion,
} from "../utils/meetingFuse";
import { formatToolApprovalLabel } from "../utils/toolApprovalLabels";
import { probeBrain, resolveEndpoint } from "../employee/brains";
import { loadGlobalModelProfiles, type RemoteModelPreset } from "../utils/globalModelProfiles";
import { listLocalModels, OLLAMA_DEFAULT_BASE } from "../utils/opsBrains";
import { readKickoffMaxEmployees } from "../utils/concurrencySlots";
import SwitchProjectTrigger from "./SwitchProjectTrigger.vue";
import ResetReplanConfirmDialog from "./ResetReplanConfirmDialog.vue";
import KickoffWizardDialog from "./KickoffWizardDialog.vue";
import { useOfficeKickoffPreview } from "../composables/office/useOfficeKickoffPreview";
import { executeTeamReset } from "../utils/teamReset";
import {
  logCleanupAttempt,
  wipeProjectGeneratePath,
  type CleanupChannel,
} from "../utils/cleanupAuditLog";
import {
  VoiceCallSession,
  speechRecognitionAvailable,
  startOneShotDictation,
  type VoicePhase,
} from "../utils/voiceCall";
import {
  listAwaitingBossConfirm,
  nudgeBossNow,
  clearBossReplyRemind,
  type AwaitingBossItem,
} from "../utils/bossReplyWatch";
import {
  parseHandoffCommand,
  resolveHandoffTarget,
  handoffEmployeeTask,
} from "../utils/employeeHandoff";

export interface FouChatMessage {
  id: string;
  sessionTag: string;
  employeeId?: string | null;
  role: string;
  content: string;
  imagePath?: string | null;
  createdAt: number;
}

const OFFICE_SESSION = OFFICE_FLOOR;
const ALL_ID = "__all__";

const props = defineProps<{
  employees: Employee[];
  panelMode?: "normal" | "maximized" | "minimized";
  /** 浮于 3D 大厅上时标题栏可拖拽 */
  floating?: boolean;
}>();

const emit = defineEmits<{
  "panel-action": ["minimize" | "maximize" | "restore"];
  "header-pointerdown": [PointerEvent];
}>();

/** 浮层模式：标题栏空白区按下转发拖拽 */
function onHeaderPointerDown(e: PointerEvent) {
  if (!props.floating) return;
  emit("header-pointerdown", e);
}

const switchRef = ref<InstanceType<typeof SwitchProjectTrigger> | null>(null);

defineExpose({
  openSwitchProject: () => switchRef.value?.openMenu(),
});

const messages = ref<FouChatMessage[]>([]);
const loading = ref(false);
/** Last raw DB tail id (before visibility filter) — catches writes that refresh must re-read. */
const lastRawTailId = ref<string | undefined>(undefined);
const draft = ref("");
const targetId = ref(ALL_ID);
const sending = ref(false);
const sendError = ref("");
const bodyEl = ref<HTMLElement | null>(null);
const project = ref<ProjectTheme | null>(null);
const fouProject = ref<XuProject | null>(null);
const projectStarted = ref(false);
let timer: number | undefined;
let unlistenXu: UnlistenFn | null = null;
let unsubAgent: (() => void) | null = null;
let unsubEmpLive: (() => void) | null = null;
const streamingLine = ref("");
const streamingSession = ref("");
const streamingName = ref("员工");
/** 当前流式员工 id（与 officeLiveStream / 大厅冒泡对齐） */
const streamingEmployeeId = ref("");
const liveTick = ref(0);
const resetDialogOpen = ref(false);
const resetPendingText = ref("");
const resetSkipBossBroadcast = ref(false);
const resetChannel = ref<CleanupChannel>("desktop_button");
const speechOk = speechRecognitionAvailable();
const isRecording = ref(false);
const voiceActive = ref(false);
const voicePhase = ref<VoicePhase>("idle");
let stopDictation: (() => void) | null = null;
let voiceSession: VoiceCallSession | null = null;
let voiceDraftBase = "";

/** 空 = 跟随各员工脑槽；local:模型名 / remote:预设 id */
const kickoffModelKey = ref("");
const kickoffRemotePresets = ref<RemoteModelPreset[]>([]);
const kickoffLocalModels = ref<string[]>([]);
const kickoffLocalBase = ref(OLLAMA_DEFAULT_BASE);
/** 需求 Brief 状态（办公室澄清闸门） */
const briefSnap = ref<RequirementBrief | null>(null);
/** 本次开工是否强制全员（忽略 RoleMatcher） */
const kickoffForceAll = ref(false);
const kickoffWizardVisible = ref(false);
const kickoffWizardBossText = ref("");
const {
  loading: kickoffPreviewLoading,
  preview: kickoffPreview,
  error: kickoffPreviewError,
  buildPreview,
} = useOfficeKickoffPreview({
  employees: computed(() => props.employees),
  fouProject,
  brief: briefSnap,
});

const clarifyDialogVisible = ref(false);
const clarifyQuestions = ref<string[]>([]);
const awaitingBossItems = ref<AwaitingBossItem[]>([]);
const nudgeBossBusy = ref(false);
const clarifyHint = ref("请补充需求缺口；答完后若仍缺会再次弹出。");
const clarifyDialogTitle = ref("补充需求");
let clarifyFromDialog = false;
/** 停工 /「稍后」后禁止自动弹补充需求，直到用户主动点补充需求/开工/确认需求 */
let suppressOfficeAutoClarify = false;

function clearClarifySuppress() {
  suppressOfficeAutoClarify = false;
}

function suppressClarifyUntilUserAction() {
  suppressOfficeAutoClarify = true;
  clarifyDialogVisible.value = false;
}

const startConfirmVisible = ref(false);
const startConfirmBrief = ref<RequirementBrief | null>(null);
const startConfirmPath = ref("");

const designConfirmVisible = ref(false);
const designConfirmProjectId = ref<string | null>(null);
const showDesignConfirmBtn = ref(false);

function openDesignConfirm(projectId: string) {
  if (!projectId) return;
  designConfirmProjectId.value = projectId;
  designConfirmVisible.value = true;
}

async function openOfficeGallery() {
  const p = fouProject.value;
  if (!p?.generatePath) return;
  try {
    const { openDesignGallery } = await import("../intent/designArtifacts");
    await openDesignGallery(p);
  } catch (e) {
    void onApiCatch(e);
  }
}

function onDesignConfirmNeeded(ev: Event) {
  const id = (ev as CustomEvent<{ projectId?: string }>).detail?.projectId;
  if (id) openDesignConfirm(id);
}

function onDesignConfirmed() {
  void refreshDesignConfirmBtn();
}

/**
 * Duty: if meeting fuse trips, force boss_review and emit a traceable system line.
 * Deps: meetingFuse + escalationChain localStorage.
 * Failure: returns false when fuse did not trip.
 */
async function tripMeetingFuseIfNeeded(employeeId: string): Promise<boolean> {
  const id = (employeeId || "").trim();
  if (!id) return false;
  const check = checkMeetingFuse(id);
  if (check === "ok") return false;
  writeEscalationStage(id, "boss_review");
  const conclusion = formatMeetingFuseConclusion(check, id);
  clearMeetingFuse(id);
  await appendFouMessage({
    sessionTag: OFFICE_SESSION,
    role: "system",
    content: conclusion,
  });
  return true;
}

async function refreshAwaitingBoss() {
  try {
    awaitingBossItems.value = await listAwaitingBossConfirm(props.employees);
  } catch {
    awaitingBossItems.value = [];
  }
}

async function onNudgeBoss(item: AwaitingBossItem) {
  nudgeBossBusy.value = true;
  try {
    await nudgeBossNow(item);
    await appendFouMessage({
      sessionTag: OFFICE_SESSION,
      role: "system",
      content: `🔔 已提醒老板：${item.employeeName} 的开会事项等待拍板（约 ${Math.floor(item.elapsedSec / 60)} 分钟）。`,
    });
  } catch (e) {
    void onApiCatch(e);
  } finally {
    nudgeBossBusy.value = false;
  }
}

async function refreshDesignConfirmBtn() {
  const p = fouProject.value;
  if (!p || p.type !== "software" || !(p.generatePath || "").trim()) {
    showDesignConfirmBtn.value = false;
    return;
  }
  try {
    showDesignConfirmBtn.value = !(await hasDesignArtifacts(p));
  } catch {
    showDesignConfirmBtn.value = true;
  }
}

function openOfficeProjectStart(brief: RequirementBrief | null | undefined) {
  if (!brief || (brief.status !== "ready" && brief.status !== "executing")) return;
  startConfirmBrief.value = brief;
  startConfirmPath.value =
    (fouProject.value?.generatePath || "").trim() || "";
  startConfirmVisible.value = true;
}

function onOfficeProjectStartDone(result: {
  mode: string;
  project?: XuProject;
  kickedOff?: boolean;
  awaitingDesignConfirm?: boolean;
}) {
  if (result.project) {
    fouProject.value = result.project;
  }
  void refreshBriefSnap();
  scheduleRefresh(true);
  void refreshDesignConfirmBtn();
  if (result.awaitingDesignConfirm && result.project?.id) {
    openDesignConfirm(result.project.id);
  }
  if (result.mode === "later") {
    void appendFouMessage({
      sessionTag: OFFICE_SESSION,
      role: "system",
      content: "已保留需求就绪。需要时点「确认需求」旁流程或发「全体开工」。",
    });
  } else if (result.mode === "save_only") {
    void appendFouMessage({
      sessionTag: OFFICE_SESSION,
      role: "system",
      content: `项目已保存${result.project ? `「${result.project.name}」` : ""}；员工已按派岗表入职。需要时点「全体开工」。`,
    });
  } else if (result.kickedOff) {
    void appendFouMessage({
      sessionTag: OFFICE_SESSION,
      role: "system",
      content: result.awaitingDesignConfirm
        ? "已保存并开始设计。请确认线框后再写码。"
        : "已按开工确认弹窗保存项目并派活。",
    });
  }
}

function openClarifyIfNeeded(
  brief: RequirementBrief | null | undefined,
  reason: "clarify" | "confirm_brief" | "blocked_kickoff" | "kickoff_preflight" | "manual",
) {
  if (clarifyFromDialog) {
    clarifyFromDialog = false;
    return;
  }
  if (
    suppressOfficeAutoClarify &&
    reason !== "manual" &&
    reason !== "confirm_brief" &&
    reason !== "kickoff_preflight"
  ) {
    return;
  }
  if (reason === "manual" || reason === "confirm_brief" || reason === "kickoff_preflight") {
    clearClarifySuppress();
  }
  const payload = buildClarifyDialogOpen(brief, reason, {
    project: fouProject.value,
    hint: CLARIFY_DIALOG_HINT_OFFICE,
  });
  if (!payload) return;
  clarifyQuestions.value = payload.questions;
  clarifyHint.value = payload.hint;
  clarifyDialogTitle.value = payload.title;
  clarifyDialogVisible.value = true;
  markClarifyDialogOpened("office", fouProject.value?.id || brief?.projectId);
}

function openClarifyManual() {
  clearClarifySuppress();
  openClarifyIfNeeded(briefSnap.value, "manual");
}

const showClarifyCta = computed(() => {
  const b = briefSnap.value;
  if (!b || b.status !== "gathering") return false;
  return resolveClarifyQuestions(b, {
    project: fouProject.value,
    gapOpts: briefGapsOptsFromBrief(b, fouProject.value),
  }).length > 0;
});

async function onClarifyPendingDom() {
  await refreshBriefSnap();
  if (suppressOfficeAutoClarify) return;
  if (
    briefSnap.value?.status === "gathering" &&
    shouldOfficeAutoOpenClarify(fouProject.value?.id || briefSnap.value?.projectId)
  ) {
    // 勿用 manual：manual 会绕过 workMode 过滤，停工/重启后易误弹
    openClarifyIfNeeded(briefSnap.value, "blocked_kickoff");
  }
  scheduleRefresh(false);
}

function maybeOpenOfficeClarify(brief: RequirementBrief | null | undefined) {
  openClarifyIfNeeded(brief, "clarify");
}

async function onOfficeClarifySubmit(answers: string[]) {
  const filled = answers.filter((a) => (a || "").trim().length > 0);
  if (filled.length < clarifyQuestions.value.length) {
    void fouAlert("请填写全部缺口项后再提交", "提示");
    return;
  }
  const body = formatClarifyAnswers(clarifyQuestions.value, answers);
  if (!body.includes("答：")) {
    void fouAlert("请填写全部缺口项后再提交", "提示");
    return;
  }
  clarifyFromDialog = true;
  draft.value = body;
  await send();
}

function onOfficeClarifySkip() {
  /* 点「稍后」：保留 gathering，但不要反复自动弹窗 */
  suppressClarifyUntilUserAction();
}

const briefStatusLabel = computed(() =>
  briefPipelineStageLabel(briefSnap.value, {
    software: fouProject.value?.type === "software",
    awaitingDesignConfirm: showDesignConfirmBtn.value,
    designFrozen: briefSnap.value?.designFrozen,
  }),
);

async function refreshBriefSnap() {
  const id = fouProject.value?.id;
  if (!id) {
    briefSnap.value = null;
    return;
  }
  try {
    briefSnap.value = await loadBrief(id);
  } catch {
    briefSnap.value = null;
  }
}

const kickoffModelLabel = computed(() => {
  const key = kickoffModelKey.value;
  if (!key) return "";
  if (key.startsWith("local:")) return `本地 · ${key.slice(6)}`;
  const id = key.startsWith("remote:") ? key.slice(7) : "";
  const preset = kickoffRemotePresets.value.find((p) => p.id === id);
  return preset ? `远程 · ${preset.label} · ${preset.textModel}` : "";
});

async function loadKickoffModelOptions() {
  try {
    const profiles = await loadGlobalModelProfiles();
    kickoffRemotePresets.value = profiles.remotePresets.filter((p) => p.textModel.trim());
    kickoffLocalBase.value = profiles.local.baseUrl || OLLAMA_DEFAULT_BASE;
    const locals = await listLocalModels(kickoffLocalBase.value);
    kickoffLocalModels.value = locals.length
      ? locals
      : profiles.local.textModel
        ? [profiles.local.textModel]
        : [];
  } catch {
    kickoffLocalModels.value = [];
    kickoffRemotePresets.value = [];
  }
}

function applyKickoffModel(emp: Employee): Employee {
  const key = kickoffModelKey.value;
  if (!key) return emp;
  if (key.startsWith("local:")) {
    const model = key.slice("local:".length);
    return {
      ...emp,
      aiModel: model,
      aiBaseUrl: kickoffLocalBase.value,
      apiSource: "local",
      remotePresetId: "",
    };
  }
  if (key.startsWith("remote:")) {
    const preset = kickoffRemotePresets.value.find((p) => p.id === key.slice("remote:".length));
    if (!preset) return emp;
    return {
      ...emp,
      aiModel: preset.textModel,
      aiBaseUrl: preset.baseUrl,
      aiVisionModel: preset.visionModel,
      apiSource: "remote",
      remotePresetId: preset.id,
    };
  }
  return emp;
}
const composerResizing = ref(false);

const composerH = ref(
  (() => {
    try {
      const n = Number(localStorage.getItem("xu.office.composerH"));
      return Number.isFinite(n) && n >= 72 && n <= 360 ? n : 110;
    } catch {
      return 110;
    }
  })(),
);

function composerMaxHeight(): number {
  return props.floating ? 520 : 360;
}

function onComposerResizeStart(e: PointerEvent) {
  e.preventDefault();
  e.stopPropagation();
  composerResizing.value = true;
  const startY = e.clientY;
  const startH = composerH.value;
  const maxH = composerMaxHeight();
  const onMove = (ev: PointerEvent) => {
    const next = Math.max(72, Math.min(maxH, startH + (ev.clientY - startY)));
    composerH.value = next;
  };
  const onUp = () => {
    composerResizing.value = false;
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    try {
      localStorage.setItem("xu.office.composerH", String(composerH.value));
    } catch {
      /* ignore */
    }
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
}

const voiceBtnLabel = computed(() => {
  if (!voiceActive.value) return "语音通话";
  if (voicePhase.value === "listening") return "听中…点停";
  if (voicePhase.value === "thinking") return "发送中…";
  if (voicePhase.value === "speaking") return "通话中…点停";
  return "通话中·点停";
});

function toggleMic() {
  if (voiceActive.value) return;
  if (isRecording.value && stopDictation) {
    stopDictation();
    stopDictation = null;
    isRecording.value = false;
    return;
  }
  stopDictation = startOneShotDictation({
    onStart: () => {
      isRecording.value = true;
    },
    onEnd: () => {
      isRecording.value = false;
      stopDictation = null;
    },
    onError: (msg) => {
      isRecording.value = false;
      stopDictation = null;
      sendError.value = msg;
    },
    onText: (text) => {
      draft.value = draft.value ? `${draft.value}${text}` : text;
    },
  });
}

async function toggleVoiceCall() {
  if (voiceSession?.active) {
    voiceSession.stop();
    voiceSession = null;
    voiceActive.value = false;
    voicePhase.value = "idle";
    voiceDraftBase = "";
    return;
  }
  if (!speechOk) {
    sendError.value =
      "当前环境不支持语音识别。请授权麦克风后重试，或改用文字输入。";
    return;
  }
  const session = new VoiceCallSession({
    onPhase: (p) => {
      voicePhase.value = p;
      voiceActive.value = p !== "idle";
    },
    onInterim: (text) => {
      draft.value = voiceDraftBase + text;
    },
    onUtterance: async (text) => {
      const t = text.trim();
      if (!t) return;
      draft.value = t;
      voiceDraftBase = "";
      session.markThinking();
      try {
        await send();
      } finally {
        voiceDraftBase = draft.value.trim() ? `${draft.value.trim()} ` : "";
        session.resumeListenSoon(500);
      }
    },
    onError: (msg) => {
      sendError.value = msg;
      session.stop();
      voiceSession = null;
      voiceActive.value = false;
      voicePhase.value = "idle";
    },
    onNotice: (msg) => {
      sendError.value = msg;
    },
  });
  const ok = await session.start();
  if (!ok) {
    voiceSession = null;
    voiceActive.value = false;
    voicePhase.value = "idle";
    return;
  }
  voiceSession = session;
  voiceDraftBase = draft.value.trim() ? `${draft.value.trim()} ` : "";
}

const projectTitle = computed(() => fouProject.value?.name || project.value?.name || "未绑定项目");
const projectSubtitle = computed(() => {
  if (!fouProject.value && !project.value) {
    return "在「项目」里创建并生成办公室 / 下达开始后，此处会同步状态";
  }
  if (fouProject.value && !projectStarted.value) {
    return `未启动 · ${PROJECT_TYPE_LABEL[fouProject.value.type]} · 请在项目详情「下达开始」或一键生成办公室`;
  }
  return project.value?.goal || fouProject.value?.name || "";
});
const startBadge = computed(() => {
  if (!fouProject.value && !project.value) return "无项目";
  return projectStarted.value ? "已启动" : "未启动";
});

const chatTargets = computed(() => props.employees.filter((e) => e.roleKind !== "boss"));

/** Who is actively working / meeting — props status + live patch. */
const workingNow = computed(() => {
  void liveTick.value;
  const rows: Array<{ id: string; title: string; status: string }> = [];
  for (const e of chatTargets.value) {
    const live = getLivePatch(e.id);
    const st = live?.state || e.status;
    const busy =
      st === "working" ||
      st === "running" ||
      st === "meeting" ||
      st === "need_confirm" ||
      e.status === "working" ||
      e.status === "meeting";
    if (!busy) continue;
    const title = e.role?.trim() ? `${e.role} · ${e.name}` : e.name;
    rows.push({ id: e.id, title, status: "工作中" });
  }
  return rows;
});

const selected = computed(() => chatTargets.value.find((e) => e.id === targetId.value) ?? null);

const nameById = computed(() => {
  const map = new Map<string, string>();
  for (const e of props.employees) map.set(e.id, e.name);
  return map;
});

function isBossMsg(m: FouChatMessage) {
  return m.role === "boss" || m.role === "user";
}

function isSystemMsg(m: FouChatMessage) {
  return m.role === "system" || m.role === "notify";
}

function isFeishuMsg(m: FouChatMessage) {
  return m.role === "feishu" || (m.content || "").startsWith("飞书｜");
}

function speakerName(m: FouChatMessage) {
  if (isBossMsg(m)) return "Boss";
  if (isSystemMsg(m)) return "系统";
  if (isFeishuMsg(m)) {
    const m2 = /飞书｜([^：:]+)[：:]/.exec(m.content || "");
    return m2?.[1]?.trim() || "飞书";
  }
  if (m.employeeId && nameById.value.has(m.employeeId)) return nameById.value.get(m.employeeId)!;
  if (m.role === "assistant") return "助手";
  return m.role || "同事";
}

function formatTime(ts: number) {
  try {
    return new Date(ts).toLocaleString("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  } catch {
    return "";
  }
}

async function scrollBottom() {
  await nextTick();
  const el = bodyEl.value;
  if (el) el.scrollTop = el.scrollHeight;
}

async function refreshProject() {
  const theme = await loadProjectTheme();
  let projects: XuProject[] = [];
  try {
    projects = await loadProjects();
  } catch {
    projects = [];
  }
  let boundId: string | null = null;
  try {
    const layout = await loadOfficeLayout();
    boundId = layout.meta?.projectId || null;
  } catch {
    boundId = null;
  }
  const byBound = boundId ? projects.find((p) => p.id === boundId) : undefined;
  const byTheme = theme?.id ? projects.find((p) => p.id === theme.id) : undefined;
  let fou = byBound || byTheme || null;
  if (!fou && projects.length > 0) {
    fou = [...projects].sort((a, b) => b.updatedAt - a.updatedAt)[0] || null;
  }
  fouProject.value = fou;

  if (fou && theme && theme.id === fou.id && (theme.assignments?.length ?? 0) > 0) {
    project.value = theme;
    projectStarted.value = true;
  } else if (fou) {
    project.value = null;
    projectStarted.value = false;
  } else {
    project.value = null;
    projectStarted.value = false;
  }
  void refreshBriefSnap();
}

function onProjectChanged() {
  void refreshProject();
  void refreshDesignConfirmBtn();
}

function onProjectsListChanged() {
  void refreshProject();
  void refreshDesignConfirmBtn();
}

let refreshTimer: number | null = null;
let refreshInflight = false;
let refreshQueued = false;
const REFRESH_MIN_MS = 600;

let liveTickTimer: number | null = null;
function bumpLiveTick() {
  if (liveTickTimer != null) return;
  liveTickTimer = window.setTimeout(() => {
    liveTickTimer = null;
    liveTick.value += 1;
  }, 450);
}

function scheduleRefresh(immediate = false) {
  if (immediate) {
    if (refreshTimer != null) {
      window.clearTimeout(refreshTimer);
      refreshTimer = null;
    }
    void refresh();
    return;
  }
  if (refreshTimer != null) return;
  refreshTimer = window.setTimeout(() => {
    refreshTimer = null;
    void refresh();
  }, REFRESH_MIN_MS);
}

async function refresh() {
  if (refreshInflight) {
    refreshQueued = true;
    return;
  }
  refreshInflight = true;
  try {
    const rows = await invoke<FouChatMessage[]>("xu_list_messages", {
      sessionTag: OFFICE_SESSION,
      limit: 120,
    });
    if (!Array.isArray(rows)) return;
    const rawTailId = rows[rows.length - 1]?.id;
    const next = rows
      .filter((m) => isOfficeFloorStripVisible(m.content, m.role))
      .slice(-100);
    const prevTail = messages.value[messages.value.length - 1]?.id;
    const nextTail = next[next.length - 1]?.id;
    const visibleChanged =
      messages.value.length !== next.length || prevTail !== nextTail;
    const rawChanged = lastRawTailId.value !== rawTailId;
    if (!visibleChanged && !rawChanged) {
      await refreshAwaitingBoss();
      return;
    }
    lastRawTailId.value = rawTailId;
    messages.value = next;
    await scrollBottom();
    await refreshAwaitingBoss();
  } catch (e) {
    console.warn("[OfficeChatStrip] refresh failed", e);
  } finally {
    refreshInflight = false;
    if (refreshQueued) {
      refreshQueued = false;
      scheduleRefresh(false);
    }
  }
}

async function haltTeamWork(): Promise<{
  cancelledSessions: number;
  employeesReset: number;
  checkpointsCleared: number;
}> {
  clearDispatchQueue();
  suppressClarifyUntilUserAction();
  const r = await stopAllEmployeeDispatches();
  if (streamingEmployeeId.value) clearOfficeLiveStream(streamingEmployeeId.value);
  streamingLine.value = "";
  streamingEmployeeId.value = "";
  liveTick.value += 1;
  window.dispatchEvent(new CustomEvent("xu-employees-changed"));
  try {
    await appendActivityLog({
      kind: "halt",
      title: "全员停止工作",
      detail: `已取消 ${r.cancelledSessions} 个会话，重置 ${r.employeesReset} 名员工`,
      projectId: fouProject.value?.id ?? null,
      stopped: true,
      outcome: "blocked",
    });
  } catch {
    /* ignore */
  }
  return r;
}

function openActivityLogPanel() {
  void openAppSettings(undefined, "security");
  window.dispatchEvent(new CustomEvent("xu-open-activity-log"));
}

async function haltOneEmployee(emp: Employee): Promise<void> {
  clearDispatchQueue();
  await stopEmployeeDispatch(emp.id);
  await updateEmployee(emp.id, { status: "idle" });
  clearOfficeLiveStream(emp.id);
  if (streamingEmployeeId.value === emp.id) {
    streamingEmployeeId.value = "";
    streamingLine.value = "";
  }
  liveTick.value += 1;
  window.dispatchEvent(new CustomEvent("xu-employees-changed"));
}

/** 开工前探测 work 脑槽：本地 Ollama 挂了就别全员空跑 */
async function assertLlmReachable(): Promise<string | null> {
  try {
    const ep = await resolveEndpoint({ slot: "work" });
    if (!ep.model?.trim() || !ep.baseUrl?.trim()) {
      return "❌ 员工脑槽未配置模型/baseUrl。请到「设置」配置 Ops 三脑（本地先启动 Ollama，或改用远程 API）。";
    }
    const url = ep.baseUrl.toLowerCase();
    const isLocal = url.includes("11434") || url.includes("ollama") || url.includes("127.0.0.1");
    try {
      await probeBrain(ep.baseUrl, { apiKeyEnv: ep.apiKeyEnv, model: ep.model });
      return null;
    } catch (e) {
      const msg = toUserError(e);
      if (isLocal) {
        return `❌ 本地模型连不上（${ep.baseUrl}）。请先在终端运行 ollama serve，并 ollama pull ${ep.model || "模型名"}；或到设置把「工作脑」改成远程 API。\n详情：${msg.slice(0, 180)}`;
      }
      return `❌ 模型接口不可用（${ep.baseUrl}）。请检查网络 / API Key / baseUrl。\n详情：${msg.slice(0, 180)}`;
    }
  } catch (e) {
    return `❌ 无法解析员工脑槽：${toUserError(e).slice(0, 200)}`;
  }
}

async function onConfirmBriefClick(): Promise<void> {
  if (!fouProject.value || sending.value) return;
  clearClarifySuppress();
  sending.value = true;
  sendError.value = "";
  try {
    briefSnap.value = await confirmBriefFromUi(fouProject.value);
    if (briefSnap.value?.status === "ready" || briefSnap.value?.status === "executing") {
      openOfficeProjectStart(briefSnap.value);
    } else if (briefSnap.value?.status === "gathering") {
      openClarifyIfNeeded(briefSnap.value, "confirm_brief");
    }
  } catch (e) {
    sendError.value = toUserError(e);
  } finally {
    sending.value = false;
  }
}

async function reportKickoffPreflightBlock(pre: Awaited<ReturnType<typeof checkKickoffPreflight>>) {
  if (pre.gapQuestions?.length) {
    await appendFouMessage({
      sessionTag: OFFICE_SESSION,
      role: "system",
      content: "⛔ 还不能全员开工，请先补齐需求。已打开补充窗口。",
    });
    const payload = buildClarifyDialogOpen(briefSnap.value, "kickoff_preflight", {
      project: fouProject.value,
    });
    if (payload) {
      clarifyQuestions.value = payload.questions;
      clarifyHint.value = payload.hint;
      clarifyDialogTitle.value = payload.title;
      clarifyDialogVisible.value = true;
      markClarifyDialogOpened("office", fouProject.value?.id);
    }
    return;
  }
  await appendFouMessage({
    sessionTag: OFFICE_SESSION,
    role: "system",
    content: `⛔ ${pre.reason || "开工前置条件未满足"}`,
  });
  if (pre.openProjectStart && briefSnap.value) {
    openOfficeProjectStart(briefSnap.value);
  }
}

async function kickoffTeam(bossText: string, opts?: { forceAll?: boolean }): Promise<void> {
  clearClarifySuppress();
  kickoffForceAll.value = opts?.forceAll === true;
  const targets = chatTargets.value;
  const canEnsureMatched =
    !kickoffForceAll.value && (briefSnap.value?.matchedRoleIds?.length ?? 0) > 0;
  if (!targets.length && !canEnsureMatched) {
    await appendFouMessage({
      sessionTag: OFFICE_SESSION,
      role: "system",
      content: "花名册为空，无法开工。",
    });
    return;
  }

  const llmBlock = await assertLlmReachable();
  if (llmBlock) {
    await appendFouMessage({
      sessionTag: OFFICE_SESSION,
      role: "system",
      content: llmBlock,
    });
    return;
  }

  const kickoffMax = readKickoffMaxEmployees();
  if (kickoffMax > 0 && targets.length > kickoffMax) {
    await appendFouMessage({
      sessionTag: OFFICE_SESSION,
      role: "system",
      content:
        `⚠️ 单次「全体开工」人数上限为 ${kickoffMax} 人（当前 ${targets.length} 人）。` +
        `请到「设置 → 并发」调整「单次开工人数上限」，或改为 0 表示不限制。`,
    });
    return;
  }

  if (fouProject.value) {
    const pre = await checkKickoffPreflight(fouProject.value, briefSnap.value);
    if (!pre.ok) {
      await reportKickoffPreflightBlock(pre);
      return;
    }
  }

  kickoffWizardBossText.value = bossText;
  try {
    await buildPreview(kickoffForceAll.value);
    kickoffWizardVisible.value = true;
  } catch (e) {
    await appendFouMessage({
      sessionTag: OFFICE_SESSION,
      role: "system",
      content: `❌ 无法预览开工：${toUserError(e).slice(0, 200)}`,
    });
  }
}

async function onKickoffWizardConfirm() {
  kickoffWizardVisible.value = false;
  const bossText = kickoffWizardBossText.value;
  const targets = chatTargets.value;
  await appendFouMessage({
    sessionTag: OFFICE_SESSION,
    role: "system",
    content: [
      `⏳ 正在受理全员开工（${
        targets.length || briefSnap.value?.matchedRoleIds?.length || kickoffPreview.value?.total || "?"
      } 人）…界面保持可操作，完成后会推送汇总。`,
      kickoffModelLabel.value ? `统一模型：${kickoffModelLabel.value}` : "",
      !kickoffForceAll.value && briefSnap.value?.matchedRoleIds?.length
        ? `按 Brief 匹配岗位派活（${briefSnap.value.matchedRoleIds.length} 岗）`
        : "",
    ]
      .filter(Boolean)
      .join("\n"),
  });
  scheduleRefresh(true);
  void runKickoffTeamWork(bossText);
}

function onKickoffWizardCancel() {
  kickoffWizardVisible.value = false;
}

/** 后台派活：与 Chat 共用 runBriefMatchedKickoff，避免双份编排漂移 */
async function runKickoffTeamWork(bossText: string): Promise<void> {
  const proj = fouProject.value;
  const genPath = (proj?.generatePath || "").trim();
  if (!proj || !genPath) {
    return;
  }

  try {
    const result = await runBriefMatchedKickoff({
      project: proj,
      brief: briefSnap.value,
      bossText,
      forceAll: kickoffForceAll.value,
      mapEmployee: applyKickoffModel,
      sessionTag: OFFICE_SESSION,
    });
    fouProject.value = result.project;
    try {
      const theme = await loadProjectTheme();
      if (theme && theme.id === result.project.id) project.value = theme;
    } catch {
      /* ignore */
    }
    void refreshBriefSnap();
    void refreshDesignConfirmBtn();
    if (result.awaitingDesignConfirm) {
      openDesignConfirm(result.project.id);
    }
  } catch (e) {
    await appendFouMessage({
      sessionTag: OFFICE_SESSION,
      role: "system",
      content: `❌ 全体开工失败：${toUserError(e).slice(0, 400)}`,
    });
  }

  liveTick.value += 1;
  scheduleRefresh(true);
}

async function onHaltTeamClick() {
  if (sending.value) return;
  sending.value = true;
  sendError.value = "";
  try {
    const r = await haltTeamWork();
    await appendFouMessage({
      sessionTag: OFFICE_SESSION,
      role: "system",
      content: [
        "🛑 已下令全员停止工作",
        `· 取消 ${r.cancelledSessions} 个在跑会话`,
        `· ${r.employeesReset} 人改回休息`,
        r.checkpointsCleared ? `· 清除 ${r.checkpointsCleared} 条断点` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    });
    await refresh();
  } catch (e) {
    sendError.value = toUserError(e);
  } finally {
    sending.value = false;
  }
}

async function onResetTeamClick() {
  if (sending.value) return;
  const text =
    draft.value.trim() ||
    "清理此前零散落盘文档，按 playbook 重新规划目录后再实现";
  openResetConfirm(text);
}

function openResetConfirm(
  text: string,
  opts?: { skipBossBroadcast?: boolean; channel?: CleanupChannel },
) {
  resetPendingText.value = text;
  resetSkipBossBroadcast.value = opts?.skipBossBroadcast ?? false;
  resetChannel.value = opts?.channel ?? "desktop_button";
  resetDialogOpen.value = true;
}

async function onResetDialogConfirmed() {
  await runResetAfterAuth(resetPendingText.value, {
    skipBossBroadcast: resetSkipBossBroadcast.value,
    channel: resetChannel.value,
  });
}

async function runResetAfterAuth(
  text: string,
  opts?: { skipBossBroadcast?: boolean; channel?: CleanupChannel },
): Promise<void> {
  if (sending.value) return;
  sending.value = true;
  sendError.value = "";
  const channel = opts?.channel ?? "desktop_button";
  const genPath = (fouProject.value?.generatePath || "").trim();
  let wipeResult = null;
  try {
    if (genPath) {
      wipeResult = await wipeProjectGeneratePath(genPath, "full");
      await appendFouMessage({
        sessionTag: OFFICE_SESSION,
        role: "system",
        content: [
          "🗑 已擦除生成目录全部内容",
          `· 路径：${genPath}`,
          `· 删除 ${wipeResult.deletedFiles} 个文件、${wipeResult.deletedDirs} 个目录`,
          wipeResult.errors.length
            ? `· ⚠️ 部分错误：${wipeResult.errors.slice(0, 2).join("；")}`
            : "",
        ]
          .filter(Boolean)
          .join("\n"),
      });
    }
    await executeTeamReset(
      text,
      {
        sessionTag: OFFICE_SESSION,
        playbookPath: fouProject.value?.requirements?.playbookPath,
        haltTeam: haltTeamWork,
        kickoffTeam,
      },
      { skipBossBroadcast: opts?.skipBossBroadcast },
    );
    await logCleanupAttempt({
      projectId: fouProject.value?.id,
      projectName: fouProject.value?.name,
      generatePath: genPath || "—",
      channel,
      commandText: text,
      wipeResult,
      outcome: "executed",
    });
    draft.value = "";
    await refresh();
  } catch (e) {
    sendError.value = toUserError(e);
    await logCleanupAttempt({
      projectId: fouProject.value?.id,
      projectName: fouProject.value?.name,
      generatePath: genPath || "—",
      channel,
      commandText: text,
      wipeResult,
      outcome: `failed: ${toUserError(e).slice(0, 200)}`,
    });
  } finally {
    sending.value = false;
  }
}

function onTeamResetExecute(ev: Event) {
  const d = (ev as CustomEvent<{
    text?: string;
    skipBossBroadcast?: boolean;
    channel?: CleanupChannel;
  }>).detail;
  if (!d?.text) return;
  openResetConfirm(d.text, {
    skipBossBroadcast: d.skipBossBroadcast,
    channel: d.channel ?? "feishu",
  });
}

async function send() {
  const text = draft.value.trim();
  if (!text) {
    sendError.value = "请输入内容";
    return;
  }

  const rememberBody = parseRememberCommand(text);
  if (rememberBody) {
    sending.value = true;
    sendError.value = "";
    try {
      const mem = await rememberUserNote({
        body: rememberBody,
        projectId: fouProject.value?.id || project.value?.id || null,
        employeeId: targetId.value !== ALL_ID ? targetId.value : null,
      });
      await appendFouMessage({
        sessionTag: OFFICE_SESSION,
        role: "system",
        content: `📌 已写入记忆：${mem.title}`,
      });
      draft.value = "";
      scheduleRefresh(true);
    } catch (e) {
      sendError.value = toUserError(e);
    } finally {
      sending.value = false;
    }
    return;
  }

  const handoffCmd = parseHandoffCommand(text);
  if (handoffCmd && selected.value && targetId.value !== ALL_ID) {
    const resolved = resolveHandoffTarget(handoffCmd.targetHint, props.employees);
    if (!resolved) {
      sendError.value = "找不到接手员工，请用全名，例如：转派 @开发工程师";
      return;
    }
    sending.value = true;
    sendError.value = "";
    try {
      const genPath = (fouProject.value?.generatePath || "").trim();
      const root =
        (selected.value.workspaceRoot || "").trim() ||
        (resolved.target.workspaceRoot || "").trim() ||
        genPath;
      await handoffEmployeeTask({
        from: selected.value,
        to: resolved.target,
        note: resolved.note || undefined,
        projectId: fouProject.value?.id || project.value?.id || null,
        workspaceRoot: root,
      });
      draft.value = "";
      scheduleRefresh(true);
    } catch (e) {
      sendError.value = toUserError(e);
    } finally {
      sending.value = false;
    }
    return;
  }

  sending.value = true;
  sendError.value = "";
  try {
    void rememberQuestionOutline({
      userText: text,
      sessionId: OFFICE_SESSION,
      projectId: fouProject.value?.id || project.value?.id || null,
      employeeId: targetId.value !== ALL_ID ? targetId.value : null,
    }).catch(() => {});
    const { handleBossMessage, applyBossDelegation } = await import("../utils/workflowOrchestrator");
    const { parseBossIntent } = await import("../utils/bossIntent");
    await handleBossMessage(text, fouProject.value?.id || project.value?.id);
    if (/确认设计|设计通过|采用设计|线框确认/i.test(text) && fouProject.value?.id) {
      openDesignConfirm(fouProject.value.id);
    }
    if (/解冻设计|重新确认设计|需求变更|改设计/i.test(text) && fouProject.value?.id) {
      void refreshDesignConfirmBtn();
      openDesignConfirm(fouProject.value.id);
    }
    const revMatch = text.match(/第\s*(\d+)\s*页[：:]\s*(.+)/);
    if (revMatch && fouProject.value?.generatePath) {
      try {
        const { appendDesignRevision } = await import("../intent/designArtifacts");
        await appendDesignRevision(
          fouProject.value,
          `第 ${revMatch[1]} 页：${revMatch[2]}`,
        );
        await appendFouMessage({
          sessionTag: OFFICE_SESSION,
          role: "system",
          content: `📝 已写入设计修订 .xu/design/REVISIONS.md（第 ${revMatch[1]} 页）`,
        });
      } catch {
        /* ignore */
      }
    }
    if (parseBossIntent(text).kind === "gui_delegate") {
      const root =
        fouProject.value?.generatePath ||
        selected.value?.workspaceRoot ||
        null;
      await applyBossDelegation(root);
    }
    if (targetId.value === ALL_ID) {
      await appendFouMessage({
        sessionTag: OFFICE_SESSION,
        employeeId: null,
        role: "boss",
        content: `@所有人 ${text}`,
      });
      if (isWorkStop(text) && !isWorkReset(text)) {
        const r = await haltTeamWork();
        await appendFouMessage({
          sessionTag: OFFICE_SESSION,
          role: "system",
          content: [
            `🛑 已下令全员停止工作`,
            `· 取消 ${r.cancelledSessions} 个在跑会话`,
            `· ${r.employeesReset} 人状态改回休息`,
            r.checkpointsCleared ? `· 清除 ${r.checkpointsCleared} 条断点续跑记录` : "",
            "员工不会再继续写文件；若要重新开工请发「全体开工」或清理重规划指令。",
          ]
            .filter(Boolean)
            .join("\n"),
        });
      } else if (isWorkReset(text)) {
        draft.value = "";
        openResetConfirm(text, { skipBossBroadcast: true, channel: "desktop_command" });
      } else if (isWorkKickoff(text) || /确认需求|强制全员/i.test(text)) {
        const gate = await handleOfficeClarifyGate({
          text,
          project: fouProject.value,
        });
        briefSnap.value = gate.brief;
        if (gate.runKickoff) {
          await kickoffTeam(text, { forceAll: gate.forceAll });
        } else if (
          gate.brief?.status === "ready" ||
          gate.brief?.status === "executing"
        ) {
          const intent = routeBossIntent(text, gate.brief);
          if (/确认需求/i.test(text) && !isWorkKickoff(text)) {
            openOfficeProjectStart(gate.brief);
          } else if (
            intent.kind === "confirm_brief" ||
            intent.kind === "kickoff_ready"
          ) {
            openOfficeProjectStart(gate.brief);
          }
        } else {
          maybeOpenOfficeClarify(gate.brief);
        }
      } else if (/验收返工|按验收返工|返工\s*验收/i.test(text)) {
        const gate = await handleOfficeClarifyGate({
          text,
          project: fouProject.value,
        });
        briefSnap.value = gate.brief;
      } else {
        const { routeBossIntent } = await import("../intent");
        const { isProtectedProductAsk, buildProtectedProductRefusal } =
          await import("../utils/antiDistill");
        if (isProtectedProductAsk(text)) {
          await appendFouMessage({
            sessionTag: OFFICE_SESSION,
            role: "system",
            content: buildProtectedProductRefusal(text),
          });
        } else {
          const intent = routeBossIntent(text, briefSnap.value);
          const turn = classifyLocalUserTurn(text);
          const work = await resolveWorkModeWithAssist({
            text,
            brief: briefSnap.value,
            project: fouProject.value,
            projectId: fouProject.value?.id,
          });
          const shouldClarify =
            turn !== "question" &&
            work.mode !== "operation" &&
            work.mode !== "question" &&
            (needsBriefCollection(work) ||
              intent.kind === "clarify" ||
              intent.blockedKickoff ||
              intent.kind === "confirm_brief");
          if (shouldClarify) {
            const gate = await handleOfficeClarifyGate({
              text,
              project: fouProject.value,
            });
            briefSnap.value = gate.brief;
            if (
              gate.brief?.status === "ready" ||
              gate.brief?.status === "executing"
            ) {
              openOfficeProjectStart(gate.brief);
            } else if (
              intent.kind === "clarify" ||
              intent.blockedKickoff ||
              intent.kind === "confirm_brief"
            ) {
              maybeOpenOfficeClarify(gate.brief);
            }
          } else {
            await appendFouMessage({
              sessionTag: OFFICE_SESSION,
              role: "system",
              content:
                "📢 已广播到办公室。本条未派活——员工不会自动变「工作中」。要开工请带上「开始/开工/任务」等词，或点下方「全体开工」。停止请说「停止工作」；清理重规划请说「清理文档重新规划」；清除后待命请说「清除…等我通知再开始」。",
            });
          }
        }
      }
      // 普通闲聊不刷员工回执进对话框
    } else {
      const emp = selected.value;
      if (!emp) {
        sendError.value = "请选择聊天对象";
        return;
      }
      await appendFouMessage({
        sessionTag: OFFICE_SESSION,
        employeeId: null,
        role: "boss",
        content: text,
      });
      await appendFouMessage({
        sessionTag: peerSessionTag(BOSS_PEER_ID, emp.id),
        employeeId: null,
        role: "boss",
        content: text,
      });
      if (isWorkStop(text) && !isWorkReset(text)) {
        await haltOneEmployee(emp);
        await appendFouMessage({
          sessionTag: OFFICE_SESSION,
          employeeId: emp.id,
          role: "system",
          content: `🛑 ${emp.name} 已停止工作`,
        });
      } else if (isWorkReset(text)) {
        await appendFouMessage({
          sessionTag: OFFICE_SESSION,
          employeeId: emp.id,
          role: "system",
          content:
            "ℹ️ 单人「清理重规划」只派该员工整理其工作区，**不会** wipe 整个生成目录。要全员清理请用办公室「清理重规划」按钮或 @所有人 发清理指令。",
        });
        await haltOneEmployee(emp);
        const genPath = (fouProject.value?.generatePath || "").trim();
        const root = (emp.workspaceRoot || "").trim() || genPath;
        if (!root) {
          sendError.value = "无工作区：请给员工设路径，或在项目填写「生成路径」";
          return;
        }
        streamingName.value = emp.name;
        await dispatchEmployeeTask(
          applyKickoffModel({ ...emp, workspaceRoot: root }),
          {
            task: resetAndReplanTask(text, fouProject.value?.requirements?.playbookPath),
            projectId: project.value?.id || fouProject.value?.id,
            directImplement: false,
            workspaceRoot: root,
          },
        );
        await updateEmployee(emp.id, { status: "working", workspaceRoot: root });
        await appendFouMessage({
          sessionTag: OFFICE_SESSION,
          employeeId: emp.id,
          role: "system",
          content: `♻️ ${emp.name} 已停止旧任务，开始清理并重新规划…`,
        });
      } else if (
        isWorkKickoff(text) ||
        /确认需求|强制全员/i.test(text) ||
        (briefSnap.value?.status === "gathering" &&
          needsBriefCollection(
            await resolveWorkModeWithAssist({
              text,
              brief: briefSnap.value,
              project: fouProject.value,
              projectId: fouProject.value?.id,
            }),
          ))
      ) {
        const single = await handleSingleDispatchClarifyGate({
          text,
          project: fouProject.value,
        });
        briefSnap.value = single.brief;
        if (!single.allowDispatch) {
          maybeOpenOfficeClarify(single.brief);
        } else {
          const genPath = (fouProject.value?.generatePath || "").trim();
          const root = (emp.workspaceRoot || "").trim() || genPath;
          if (!root) {
            sendError.value = "无工作区：请给员工设路径，或在项目填写「生成路径」";
            return;
          }
          if (!(emp.workspaceRoot || "").trim() && genPath) {
            await updateEmployee(emp.id, { workspaceRoot: genPath, status: "working" });
          } else {
            await updateEmployee(emp.id, { status: "working" });
          }
          streamingName.value = emp.name;
          try {
            await dispatchEmployeeTask(
              applyKickoffModel({ ...emp, workspaceRoot: root }),
              {
                task: `${text}\n\n【可写目录】${root}\nWord 用 office_write_docx；Excel 用 office_write_xlsx；文本用 write_file。`,
                projectId: project.value?.id || fouProject.value?.id,
                directImplement: true,
                workspaceRoot: root,
              },
            );
            await appendFouMessage({
              sessionTag: OFFICE_SESSION,
              employeeId: emp.id,
              role: "system",
              content: `✅ ${emp.name} 已收到消息并开始工作`,
            });
            streamingLine.value = "已受理，排队处理中…";
            liveTick.value += 1;
          } catch (e) {
            sendError.value = toUserError(e);
            await updateEmployee(emp.id, { status: "idle" });
            return;
          }
          if (project.value) {
            const next = bumpAssignmentProgress(
              project.value,
              emp.id,
              Math.max(
                project.value.assignments.find((a) => a.employeeId === emp.id)?.progress ?? 0,
                8,
              ),
              "working",
            );
            await saveProjectTheme(next);
            project.value = next;
            window.dispatchEvent(new CustomEvent("xu-project-changed"));
          }
        }
      } else if (emp.status === "meeting") {
        // 开会：经理审查 → 老板拍板；无经理则直接老板答复 resume
        const genPath = (fouProject.value?.generatePath || "").trim();
        const root = (emp.workspaceRoot || "").trim() || genPath;
        if (!root) {
          sendError.value = "无工作区，无法继续开会后实现";
          return;
        }
        beginMeetingFuse(emp.id);
        bumpMeetingRound(emp.id);
        if (await tripMeetingFuseIfNeeded(emp.id)) {
          draft.value = "";
          await refresh();
          return;
        }
        const manager = findManagerEmployee(props.employees);
        let stage = readEscalationStage(emp.id);
        if (!stage) {
          stage = beginEscalationForNeedConfirm(emp.id, props.employees, {
            confirmText: text,
          });
        }
        const speakerIsManager = Boolean(manager && selected.value?.id === manager.id);
        const intent = parseManagerIntent(text);

        if (stage === "manager_review") {
          if (intent === "escalate" || (speakerIsManager && /上报/.test(text))) {
            writeEscalationStage(emp.id, "boss_review");
            clearMeetingFuse(emp.id);
            await appendFouMessage({
              sessionTag: OFFICE_SESSION,
              role: "system",
              content: `⬆️ ${manager?.name || "经理"}同意上报：${emp.name} 的开会事项请老板拍板。\n${escalationHintForStage("boss_review")}`,
            });
            draft.value = "";
            await refresh();
            return;
          }
          if (
            intent === "decide" ||
            speakerIsManager ||
            (!manager && intent !== "unknown")
          ) {
            streamingName.value = emp.name;
            try {
              await resumeEmployeeAfterConfirm({ ...emp, workspaceRoot: root }, text);
              writeEscalationStage(emp.id, null);
              clearMeetingFuse(emp.id);
              clearBossReplyRemind(emp.id);
              await updateEmployee(emp.id, { status: "working", workspaceRoot: root });
              await appendFouMessage({
                sessionTag: OFFICE_SESSION,
                role: "system",
                content: `✅ ${manager && speakerIsManager ? "经理已裁决" : "已确认"}，${emp.name} 继续工作。`,
              });
            } catch (e) {
              sendError.value = toUserError(e);
              return;
            }
          } else {
            await appendFouMessage({
              sessionTag: OFFICE_SESSION,
              role: "system",
              content: escalationHintForStage("manager_review", manager?.name),
            });
            draft.value = "";
            await refresh();
            return;
          }
        } else {
          // boss_review
          streamingName.value = emp.name;
          try {
            await resumeEmployeeAfterConfirm({ ...emp, workspaceRoot: root }, text);
            writeEscalationStage(emp.id, null);
            clearMeetingFuse(emp.id);
            clearBossReplyRemind(emp.id);
            await updateEmployee(emp.id, { status: "working", workspaceRoot: root });
          } catch (e) {
            sendError.value = toUserError(e);
            return;
          }
        }
      } else {
        // 工作中：老板补充（中途转向）；否则轻量问答
        const genPath = (fouProject.value?.generatePath || "").trim();
        const root = (emp.workspaceRoot || "").trim() || genPath;
        if (!root) {
          sendError.value = "无工作区：请给员工设路径，或在项目填写「生成路径」";
          return;
        }
        const liveWorking =
          emp.status === "working" ||
          workingNow.value.some((w) => (w as { id?: string }).id === emp.id);
        const turn = classifyLocalUserTurn(text);
        const hint = turnKindSystemHint(text);
        let task = liveWorking
          ? `【老板补充 · 中途转向】请立即按以下补充调整当前任务，不要另起项目、不要丢掉未完成的改动：\n${text}`
          : text;
        if (!liveWorking && turn === "requirement" && hint) {
          task = `${hint}\n${text}`;
        }
        const qaMode = liveWorking ? false : turn !== "requirement";
        streamingName.value = emp.name;
        try {
          await dispatchEmployeeTask(
            { ...emp, workspaceRoot: root },
            {
              task,
              forceNewSession: false,
              projectId: project.value?.id || fouProject.value?.id,
              qaMode,
              workspaceRoot: root,
            },
          );
          await updateEmployee(emp.id, { status: "working", workspaceRoot: root });
          await appendFouMessage({
            sessionTag: OFFICE_SESSION,
            employeeId: emp.id,
            role: "system",
            content: liveWorking
              ? `📢 已把补充发给 ${emp.name}，将在当前任务上转向。`
              : `✅ ${emp.name} 已收到，正在回复…`,
          });
          streamingLine.value = liveWorking ? "正在按老板补充转向…" : "正在回复老板…";
      liveTick.value += 1;
          window.dispatchEvent(new CustomEvent("xu-employees-changed"));
        } catch (e) {
          sendError.value = toUserError(e);
          return;
        }
      }
    }
    draft.value = "";
    await refresh();
  } catch (e) {
    sendError.value = toUserError(e);
  } finally {
    sending.value = false;
  }
}

async function sendDeep() {
  const defaultAll =
    "【全体开工】请按各自职责立刻在生成路径落盘可交付内容（文档/骨架/配置等），禁止只回复计划。";
  const defaultOne = "【派活】请立刻在工作区落盘推进当前任务，禁止只回复计划。";
  const text =
    draft.value.trim() ||
    (targetId.value === ALL_ID ? defaultAll : defaultOne);
  sending.value = true;
  sendError.value = "";
  try {
    const llmBlock = await assertLlmReachable();
    if (llmBlock) {
      sendError.value = llmBlock.replace(/^❌\s*/, "");
      await appendFouMessage({
        sessionTag: OFFICE_SESSION,
        role: "system",
        content: llmBlock,
      });
      await refresh();
      return;
    }
    if (targetId.value === ALL_ID) {
      await appendFouMessage({
        sessionTag: OFFICE_SESSION,
        employeeId: null,
        role: "boss",
        content: `@所有人 ${text}`,
      });
      const { routeBossIntent, isProductBuildIntent } = await import("../intent");
      const { isProtectedProductAsk, buildProtectedProductRefusal } =
        await import("../utils/antiDistill");
      if (isProtectedProductAsk(text)) {
        await appendFouMessage({
          sessionTag: OFFICE_SESSION,
          role: "system",
          content: buildProtectedProductRefusal(text),
        });
        draft.value = "";
        await refresh();
        return;
      }
      const preIntent = routeBossIntent(text, briefSnap.value);
      const work = await resolveWorkModeWithAssist({
        text,
        brief: briefSnap.value,
        project: fouProject.value,
        projectId: fouProject.value?.id,
      });
      const needClarifyGate =
        needsBriefCollection(work) ||
        preIntent.kind === "clarify" ||
        preIntent.blockedKickoff ||
        preIntent.kind === "confirm_brief" ||
        preIntent.kind === "kickoff_ready" ||
        preIntent.kind === "force_all_kickoff" ||
        preIntent.kind === "acceptance_rework" ||
        isWorkKickoff(text);
      if (!needClarifyGate) {
        await appendFouMessage({
          sessionTag: OFFICE_SESSION,
          role: "system",
          content:
            "📢 已广播到办公室。本条未派活——员工不会自动变「工作中」。要开工请带上「开始/开工/派活」等词，或点下方「全体开工」。",
        });
        draft.value = "";
        await refresh();
        return;
      }
      const gate = await handleOfficeClarifyGate({
        text,
        project: fouProject.value,
      });
      briefSnap.value = gate.brief;
      if (gate.runKickoff) {
        await kickoffTeam(text, { forceAll: gate.forceAll });
      } else if (
        gate.brief?.status === "ready" ||
        gate.brief?.status === "executing"
      ) {
        if (/确认需求/i.test(text) && !isWorkKickoff(text)) {
          openOfficeProjectStart(gate.brief);
        } else if (
          preIntent.kind === "confirm_brief" ||
          preIntent.kind === "kickoff_ready"
        ) {
          openOfficeProjectStart(gate.brief);
        }
      } else if (
        preIntent.kind === "clarify" ||
        preIntent.blockedKickoff ||
        preIntent.kind === "confirm_brief"
      ) {
        maybeOpenOfficeClarify(gate.brief);
      }
      draft.value = "";
      await refresh();
      return;
    }
    const emp = selected.value;
    const genPath = (fouProject.value?.generatePath || "").trim();
    const root = (emp?.workspaceRoot || "").trim() || genPath;
    if (!emp || !root) {
      sendError.value = "该员工未设工作区，且项目无「生成路径」";
      return;
    }
    const single = await handleSingleDispatchClarifyGate({
      text,
      project: fouProject.value,
    });
    briefSnap.value = single.brief;
    if (!single.allowDispatch) {
      maybeOpenOfficeClarify(single.brief);
      draft.value = "";
      await refresh();
      return;
    }
    if (!(emp.workspaceRoot || "").trim() && genPath) {
      await updateEmployee(emp.id, { workspaceRoot: genPath });
    }
    await appendFouMessage({
      sessionTag: OFFICE_SESSION,
      employeeId: null,
      role: "boss",
      content: text,
    });
    await appendFouMessage({
      sessionTag: peerSessionTag(BOSS_PEER_ID, emp.id),
      employeeId: null,
      role: "boss",
      content: text,
    });
    await dispatchEmployeeTask(
      applyKickoffModel({ ...emp, workspaceRoot: root }),
      {
        task: `${text}\n\n【可写目录】${root}\n请立刻在该目录落盘。`,
        projectId: project.value?.id || fouProject.value?.id,
        directImplement: true,
        workspaceRoot: root,
      },
    );
    streamingName.value = emp.name;
    await updateEmployee(emp.id, { status: "working", workspaceRoot: root });
    await appendFouMessage({
      sessionTag: OFFICE_SESSION,
      employeeId: emp.id,
      role: "system",
      content: `✅ ${emp.name} 已收到派活并开始工作`,
    });
    streamingLine.value = "已受理，正在落盘…";
    liveTick.value += 1;
    window.dispatchEvent(new CustomEvent("xu-employees-changed"));
    if (project.value) {
      const next = bumpAssignmentProgress(
        project.value,
        emp.id,
        Math.max(
          project.value.assignments.find((a) => a.employeeId === emp.id)?.progress ?? 0,
          8,
        ),
        "working",
      );
      await saveProjectTheme(next);
      project.value = next;
      window.dispatchEvent(new CustomEvent("xu-project-changed"));
    }
    draft.value = "";
    await refresh();
  } catch (e) {
    sendError.value = toUserError(e);
  } finally {
    sending.value = false;
  }
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    void send();
  }
}

let unlistenOfficeNotify: UnlistenFn | null = null;
let disposed = false;

function onOfficeNotifyDom() {
  void refreshBriefSnap();
  scheduleRefresh(false);
}

onMounted(() => {
  disposed = false;
  loading.value = true;
  void refresh().finally(() => {
    loading.value = false;
  });
  void refreshProject();
  void loadKickoffModelOptions();
  void refreshBriefSnap();
  window.addEventListener("xu-project-changed", onProjectChanged);
  window.addEventListener("xu-projects-changed", onProjectsListChanged);
  window.addEventListener("xu-office-notify", onOfficeNotifyDom);
  window.addEventListener(XU_CLARIFY_PENDING, onClarifyPendingDom);
  window.addEventListener("xu-team-reset-execute", onTeamResetExecute);
  window.addEventListener(XU_DESIGN_CONFIRM_NEEDED, onDesignConfirmNeeded);
  window.addEventListener(XU_DESIGN_CONFIRMED, onDesignConfirmed);
  void refreshDesignConfirmBtn();
  void listen("xu-office-notify", () => {
    if (disposed) return;
    scheduleRefresh(false);
  }).then((u) => {
    if (disposed) u();
    else unlistenOfficeNotify = u;
  });
  let empStormTimer: number | null = null;
  const notifyEmployeesChanged = () => {
    if (empStormTimer != null) return;
    empStormTimer = window.setTimeout(() => {
      empStormTimer = null;
      window.dispatchEvent(new CustomEvent("xu-employees-changed"));
    }, 800);
  };
  let streamRaf = 0;
  let streamBuf = "";
  const pushStreamToHub = (text: string) => {
    const eid = streamingEmployeeId.value.trim();
    if (!eid) return;
    setOfficeLiveStream(eid, text);
  };
  void listenFouChunks((chunk) => {
    if (disposed) return;
    if (chunk.kind === "text") {
      if (streamingSession.value !== chunk.session_id) {
        streamingSession.value = chunk.session_id;
        streamBuf = "";
        const mapped = getEmployeeIdBySession(chunk.session_id);
        if (mapped) streamingEmployeeId.value = mapped;
      }
      streamBuf += chunk.content;
      if (!streamRaf) {
        streamRaf = requestAnimationFrame(() => {
          streamRaf = 0;
          streamingLine.value = streamBuf;
          pushStreamToHub(streamBuf);
        });
      }
    } else if (chunk.kind === "tool_name") {
      streamBuf += `\n⚙ ${chunk.content}`;
      streamingLine.value = streamBuf;
      pushStreamToHub(streamBuf);
    } else if (chunk.kind === "tool_output") {
      const preview = chunk.content.length > 120 ? `${chunk.content.slice(0, 120)}…` : chunk.content;
      streamBuf += `\n→ ${preview}`;
      streamingLine.value = streamBuf;
      pushStreamToHub(streamBuf);
    } else if (chunk.kind === "done" || chunk.kind === "error") {
      if (streamingSession.value) clearOfficeLiveStreamBySession(streamingSession.value);
      else if (streamingEmployeeId.value) clearOfficeLiveStream(streamingEmployeeId.value);
      streamBuf = "";
      streamingLine.value = "";
      streamingSession.value = "";
      streamingEmployeeId.value = "";
      scheduleRefresh(false);
      notifyEmployeesChanged();
    } else if (chunk.kind === "status" && chunk.content.includes("employee:")) {
      const m = /employee:([^:]+)/.exec(chunk.content);
      if (m?.[1]) {
        const emp = props.employees.find((e) => e.id === m[1]);
        if (emp) {
          streamingName.value = emp.name;
          streamingEmployeeId.value = emp.id;
          if (streamingSession.value) bindStreamSession(streamingSession.value, emp.id);
        }
      }
      notifyEmployeesChanged();
    } else if (chunk.kind === "status" && chunk.content.includes("office:")) {
      scheduleRefresh(false);
    }
  }).then((u) => {
    if (disposed) u();
    else unlistenXu = u;
  });
  unsubAgent = subscribeAgentLive((ev: AgentLiveEvent) => {
    if (ev.kind === "tool_call" || ev.kind === "awaiting_approval") {
      const label = formatToolApprovalLabel(ev.toolName || "tool", ev.toolArgs || undefined);
      streamingLine.value = ev.kind === "awaiting_approval" ? `⏳ 待批 ${label}` : `⚙ ${label}`;
      if (ev.employeeId) {
        const emp = props.employees.find((e) => e.id === ev.employeeId);
        if (emp) streamingName.value = emp.name;
        streamingEmployeeId.value = ev.employeeId;
        if (ev.sessionId) bindStreamSession(ev.sessionId, ev.employeeId);
        setOfficeLiveStream(ev.employeeId, streamingLine.value);
      }
      bumpLiveTick();
    } else if (ev.kind === "done" || ev.kind === "error" || ev.kind === "context_compaction") {
      if (ev.employeeId) clearOfficeLiveStream(ev.employeeId);
      scheduleRefresh(false);
      notifyEmployeesChanged();
      bumpLiveTick();
    } else if (ev.kind === "plan_update") {
      streamingLine.value = (ev.content || "计划已更新").slice(0, 100);
      if (ev.employeeId) {
        streamingEmployeeId.value = ev.employeeId;
        if (ev.sessionId) bindStreamSession(ev.sessionId, ev.employeeId);
        setOfficeLiveStream(ev.employeeId, streamingLine.value);
      }
      bumpLiveTick();
    } else if (ev.kind === "llm_thinking") {
      streamingLine.value = ev.content.slice(0, 80) || "思考中…";
      if (ev.employeeId) {
        streamingEmployeeId.value = ev.employeeId;
        if (ev.sessionId) bindStreamSession(ev.sessionId, ev.employeeId);
        setOfficeLiveStream(ev.employeeId, streamingLine.value);
      }
      bumpLiveTick();
    }
  });
  unsubEmpLive = subscribeEmployeeLive((ev: EmployeeLiveEvent) => {
    bumpLiveTick();
    const emp = props.employees.find((e) => e.id === ev.employeeId);
    if (emp) streamingName.value = emp.name;
    if (ev.message?.trim()) {
      streamingLine.value = ev.message.trim().slice(0, 100);
      streamingEmployeeId.value = ev.employeeId;
      setOfficeLiveStream(ev.employeeId, streamingLine.value);
    }
    // 仅终态刷新聊天条；工作中事件只更新 streaming，避免 N× xu_list_messages 卡死 UI
    if (ev.state === "idle" || ev.state === "done" || ev.state === "blocked" || ev.state === "error") {
      clearOfficeLiveStream(ev.employeeId);
      scheduleRefresh(false);
    } else if (ev.state === "meeting" || ev.state === "need_confirm") {
      if (ev.employeeId) {
        beginMeetingFuse(ev.employeeId);
        void (async () => {
          if (await tripMeetingFuseIfNeeded(ev.employeeId)) {
            scheduleRefresh(false);
            return;
          }
          const stage = beginEscalationForNeedConfirm(ev.employeeId, props.employees, {
            confirmText: ev.message || "",
            isCrossModule: /XU_CROSS_MODULE|跨模块/i.test(ev.message || ""),
          });
          const mgr = findManagerEmployee(props.employees);
          void appendFouMessage({
            sessionTag: OFFICE_SESSION,
            role: "system",
            content: escalationHintForStage(stage, mgr?.name),
          });
          scheduleRefresh(false);
        })();
        return;
      }
      scheduleRefresh(false);
    }
  });
});

onUnmounted(() => {
  disposed = true;
  if (timer) window.clearInterval(timer);
  timer = undefined;
  if (refreshTimer != null) window.clearTimeout(refreshTimer);
  if (liveTickTimer != null) window.clearTimeout(liveTickTimer);
  window.removeEventListener("xu-project-changed", onProjectChanged);
  window.removeEventListener("xu-projects-changed", onProjectsListChanged);
  window.removeEventListener("xu-office-notify", onOfficeNotifyDom);
  window.removeEventListener(XU_CLARIFY_PENDING, onClarifyPendingDom);
  window.removeEventListener("xu-team-reset-execute", onTeamResetExecute);
  window.removeEventListener(XU_DESIGN_CONFIRM_NEEDED, onDesignConfirmNeeded);
  window.removeEventListener(XU_DESIGN_CONFIRMED, onDesignConfirmed);
  unlistenOfficeNotify?.();
  unlistenOfficeNotify = null;
  unlistenXu?.();
  unlistenXu = null;
  unsubAgent?.();
  unsubAgent = null;
  unsubEmpLive?.();
  unsubEmpLive = null;
  stopDictation?.();
  stopDictation = null;
  voiceSession?.stop();
  voiceSession = null;
});
</script>

<template>
  <aside class="office-chat-strip" aria-label="员工协作聊天">
    <header
      class="strip-head"
      :class="{ 'is-floating': floating }"
      @pointerdown="onHeaderPointerDown"
    >
      <div class="strip-title-row">
        <div class="strip-titles ui-font">
          <div class="strip-title-line">
            <strong>{{ projectTitle }}</strong>
            <span
              class="strip-badge"
              :class="projectStarted ? 'strip-badge--on' : 'strip-badge--off'"
            >
              {{ startBadge }}
            </span>
          </div>
          <span class="strip-sub">{{ projectSubtitle }}</span>
          <span class="strip-sub strip-local">本地编排 · 员工发言会进此对话框</span>
          <span
            v-if="workingNow.length"
            class="strip-sub strip-working"
            :title="workingNow.map((w) => `${w.title}：${w.status}`).join('\n')"
          >
            🟢 工作中 {{ workingNow.length }} 人：{{
              workingNow.map((w) => w.title).slice(0, 4).join("、")
            }}{{ workingNow.length > 4 ? ` 等` : "" }}
          </span>
          <span v-else class="strip-sub strip-idle">⚪ 当前无人工作中</span>
          <span
            class="strip-sub"
            :class="briefSnap?.status === 'ready' || briefSnap?.status === 'executing' ? 'strip-working' : 'strip-idle'"
            :title="briefSnap ? formatBriefSummary(briefSnap) : '尚未收集需求'"
          >
            📋 {{ briefStatusLabel }}
            <template v-if="briefSnap?.matchedRoleIds?.length">
              · 匹配 {{ briefSnap.matchedRoleIds.length }} 岗
            </template>
          </span>
        </div>
        <SwitchProjectTrigger
          ref="switchRef"
          :employees="employees"
          @switched="() => void refreshProject()"
        >
          <template #default="{ open, loading: switchLoading }">
            <FouButton
              icon="arrow-left-right-line"
              size="small"
              :type="fouProject || project ? 'default' : 'primary'"
              native-type="button"
              :loading="switchLoading"
              @click="open"
            >
              {{ fouProject || project ? "切换项目" : "选项目" }}
            </FouButton>
          </template>
        </SwitchProjectTrigger>
        <div class="strip-panel-actions">
          <FouButton
            v-if="props.panelMode !== 'maximized'"
            icon="fullscreen-line"
            size="small"
            text
            native-type="button"
            title="最大化协作条"
            aria-label="最大化协作条"
            @click="emit('panel-action', 'maximize')"
          />
          <FouButton
            v-else
            icon="fullscreen-exit-line"
            size="small"
            text
            native-type="button"
            title="还原协作条"
            aria-label="还原协作条"
            @click="emit('panel-action', 'restore')"
          />
          <FouButton
            icon="subtract-line"
            size="small"
            text
            native-type="button"
            title="最小化协作条"
            aria-label="最小化协作条"
            @click="emit('panel-action', 'minimize')"
          />
        </div>
      </div>
    </header>

    <div v-if="awaitingBossItems.length" class="strip-awaiting ui-font">
      <span class="strip-awaiting-label">
        ⏳ {{ awaitingBossItems.length }} 位员工开会等您拍板
        <template v-if="awaitingBossItems[0]">
          · {{ awaitingBossItems[0].employeeName }} 已等 {{ Math.floor(awaitingBossItems[0].elapsedSec / 60) }} 分
        </template>
      </span>
      <FouButton
        icon="notification-3-line"
        size="small"
        type="warning"
        native-type="button"
        :loading="nudgeBossBusy"
        title="播放提示音并通过已连接通道提醒"
        @click="onNudgeBoss(awaitingBossItems[0]!)"
      >
        催老板
      </FouButton>
    </div>

    <div ref="bodyEl" class="strip-body wx-body">
      <p v-if="loading && messages.length === 0" class="strip-empty ui-font">加载中…</p>
      <p v-else-if="messages.length === 0" class="strip-empty ui-font">
        暂无消息。员工「交付/落地/实现/分析/回复」会显示在此；仅隐藏「已受理」回执。
      </p>
      <template v-for="m in messages" :key="m.id">
        <div v-if="isSystemMsg(m)" class="wx-sys ui-font">
          <span>{{ m.content }}</span>
        </div>
        <div v-else class="wx-row" :class="{ mine: isBossMsg(m) }">
          <div class="wx-avatar ui-font">{{ speakerName(m).slice(0, 1) }}</div>
          <div class="wx-col">
            <div class="wx-meta ui-font">
              <span>{{ speakerName(m) }}</span>
              <time>{{ formatTime(m.createdAt) }}</time>
            </div>
            <div class="wx-bubble ui-font">{{ m.content }}</div>
          </div>
        </div>
      </template>
      <div v-if="streamingLine" class="wx-row">
        <div class="wx-avatar ui-font">{{ streamingName.slice(0, 1) }}</div>
        <div class="wx-col">
          <div class="wx-meta ui-font"><span>{{ streamingName }}</span></div>
          <div class="wx-bubble ui-font strip-streaming">
            {{ streamingLine }}<span class="strip-cursor">▍</span>
          </div>
        </div>
      </div>
    </div>

    <footer class="strip-composer">
      <label class="strip-target ui-font">
        <span>对话对象</span>
        <select v-model="targetId" class="strip-select">
          <option :value="ALL_ID">所有人（通知广播）</option>
          <option v-for="e in chatTargets" :key="e.id" :value="e.id">
            {{ e.role?.trim() ? `${e.role} · ${e.name}` : e.name }}
          </option>
        </select>
      </label>
      <label class="strip-target ui-font">
        <span>派活模型</span>
        <select v-model="kickoffModelKey" class="strip-select">
          <option value="">跟随各员工脑槽（默认）</option>
          <optgroup v-if="kickoffLocalModels.length" label="本地 Ollama">
            <option v-for="m in kickoffLocalModels" :key="'l-' + m" :value="'local:' + m">
              {{ m }}
            </option>
          </optgroup>
          <optgroup v-if="kickoffRemotePresets.length" label="远程 API">
            <option
              v-for="p in kickoffRemotePresets"
              :key="p.id"
              :value="'remote:' + p.id"
            >
              {{ p.label }} · {{ p.textModel }}
            </option>
          </optgroup>
        </select>
      </label>
      <div
        class="strip-composer-split"
        :class="{ 'is-active': composerResizing }"
        title="拖动调整输入框高度"
        aria-label="拖动调整输入框高度"
        @pointerdown="onComposerResizeStart"
      />
      <textarea
        v-model="draft"
        class="strip-input ui-font"
        :style="{ height: `${composerH}px` }"
        placeholder="跟团队说点什么…（Enter 发送 · Shift+Enter 换行）"
        :disabled="sending"
        @keydown="onKeydown"
      />
      <p v-if="sendError" class="strip-err ui-font">{{ sendError }}</p>
      <div class="strip-actions">
        <FouButton
          icon="file-list-3-line"
          size="small"
          native-type="button"
          :disabled="sending"
          title="查看活动日志（澄清、写文件、读取警告、中止）"
          @click="openActivityLogPanel"
        >
          活动日志
        </FouButton>
        <FouButton
          v-if="showClarifyCta"
          icon="question-answer-line"
          size="small"
          native-type="button"
          :disabled="sending"
          title="补充需求缺口（写入 Brief）"
          @click="openClarifyManual"
        >
          补充需求
        </FouButton>
        <FouButton
          v-if="targetId === ALL_ID && fouProject"
          icon="checkbox-circle-line"
          size="small"
          native-type="button"
          :disabled="sending || briefSnap?.status === 'ready' || briefSnap?.status === 'executing'"
          title="确认当前需求 Brief，生成 Skills 后再开工"
          @click="onConfirmBriefClick"
        >
          确认需求
        </FouButton>
        <FouButton
          v-if="showDesignConfirmBtn && fouProject"
          icon="palette-line"
          size="small"
          native-type="button"
          :disabled="sending"
          title="确认各页设计后再写码"
          @click="openDesignConfirm(fouProject.id)"
        >
          确认设计
        </FouButton>
        <FouButton
          v-if="fouProject?.type === 'software' && fouProject.generatePath"
          icon="layout-grid-line"
          size="small"
          native-type="button"
          :disabled="sending"
          title="打开界面画廊预览"
          @click="openOfficeGallery"
        >
          界面画廊
        </FouButton>
        <FouButton
          icon="send-plane-line"
          type="primary"
          size="small"
          native-type="button"
          :disabled="sending"
          @click="send"
        >
          发送
        </FouButton>
        <FouButton
          icon="robot-2-line"
          size="small"
          native-type="button"
          :disabled="sending"
          @click="sendDeep"
        >
          {{ targetId === ALL_ID ? "全体开工" : "派活" }}
        </FouButton>
        <FouButton
          v-if="targetId === ALL_ID"
          icon="stop-circle-line"
          size="small"
          native-type="button"
          :disabled="sending"
          @click="onHaltTeamClick"
        >
          全员停工
        </FouButton>
        <FouButton
          v-if="targetId === ALL_ID"
          icon="restart-line"
          size="small"
          native-type="button"
          :disabled="sending"
          @click="onResetTeamClick"
        >
          清理重规划
        </FouButton>
      </div>
      <p class="strip-hint ui-font">
        {{
          targetId === ALL_ID
            ? "「全体开工」可不填内容，一点即派全员；可在上方选择统一模型"
            : "「派活」可不填内容，一点即开工；可在上方选择统一模型"
        }}
      </p>
    </footer>
    <RequirementClarifyDialog
      v-model:visible="clarifyDialogVisible"
      :questions="clarifyQuestions"
      :hint="clarifyHint"
      :title="clarifyDialogTitle"
      @submit="onOfficeClarifySubmit"
      @skip="onOfficeClarifySkip"
    />
    <ProjectStartConfirmDialog
      v-model:visible="startConfirmVisible"
      :brief="startConfirmBrief"
      :project="fouProject"
      :suggested-path="startConfirmPath"
      @done="onOfficeProjectStartDone"
    />
    <DesignConfirmDialog
      v-model:visible="designConfirmVisible"
      :project-id="designConfirmProjectId"
      @confirmed="() => void refreshDesignConfirmBtn()"
    />
    <ResetReplanConfirmDialog
      v-model="resetDialogOpen"
      :preview-text="resetPendingText"
      :generate-path="fouProject?.generatePath || ''"
      @confirmed="onResetDialogConfirmed"
    />
    <KickoffWizardDialog
      v-model:visible="kickoffWizardVisible"
      :loading="kickoffPreviewLoading"
      :preview="kickoffPreview"
      :error="kickoffPreviewError"
      @confirm="onKickoffWizardConfirm"
      @cancel="onKickoffWizardCancel"
    />
  </aside>
</template>

<style scoped>
.office-chat-strip {
  width: 100%;
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  border-radius: 14px;
  background: rgba(12, 16, 22, 0.78);
  border: 1px solid rgba(255, 255, 255, 0.08);
  backdrop-filter: blur(10px);
  color: rgba(240, 244, 248, 0.92);
  overflow: hidden;
}
.strip-head {
  padding: 10px 12px 8px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex-shrink: 0;
}
.strip-head.is-floating {
  cursor: grab;
}
.strip-head.is-floating:active {
  cursor: grabbing;
}
.strip-awaiting {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 12px;
  background: rgba(255, 180, 60, 0.12);
  border-bottom: 1px solid rgba(255, 180, 60, 0.25);
  flex-shrink: 0;
  font-size: 12px;
}
.strip-awaiting-label {
  min-width: 0;
  line-height: 1.35;
}
.strip-title-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
}
.strip-panel-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}
.strip-titles {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.strip-titles strong {
  font-size: 13px;
  font-weight: 650;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.strip-title-line {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.strip-badge {
  flex-shrink: 0;
  font-size: 10px;
  font-weight: 700;
  padding: 2px 7px;
  border-radius: 999px;
  letter-spacing: 0.02em;
}
.strip-badge--on {
  background: rgba(20, 184, 166, 0.25);
  color: #5eead4;
  border: 1px solid rgba(45, 212, 191, 0.45);
}
.strip-badge--off {
  background: rgba(248, 113, 113, 0.18);
  color: #fca5a5;
  border: 1px solid rgba(248, 113, 113, 0.35);
}
.strip-sub {
  font-size: 11px;
  opacity: 0.72;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.strip-local {
  opacity: 0.55;
}
.strip-working {
  opacity: 0.95;
  color: #5eead4;
  white-space: normal;
}
.strip-idle {
  opacity: 0.5;
}
.strip-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 10px 12px;
}
.wx-body {
  background: rgba(8, 10, 14, 0.35);
}
.strip-empty {
  margin: 24px 8px;
  text-align: center;
  font-size: 12px;
  opacity: 0.65;
}
.wx-sys {
  text-align: center;
  margin: 8px 0;
  font-size: 11px;
  opacity: 0.7;
}
.wx-row {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
  align-items: flex-start;
}
.wx-row.mine {
  flex-direction: row-reverse;
}
.wx-avatar {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  background: rgba(45, 212, 191, 0.25);
  display: grid;
  place-items: center;
  font-size: 12px;
  font-weight: 700;
  flex-shrink: 0;
}
.wx-row.mine .wx-avatar {
  background: rgba(148, 163, 184, 0.35);
}
.wx-col {
  max-width: 78%;
  min-width: 0;
}
.wx-row.mine .wx-col {
  align-items: flex-end;
  display: flex;
  flex-direction: column;
}
.wx-meta {
  display: flex;
  gap: 8px;
  font-size: 10px;
  opacity: 0.65;
  margin-bottom: 4px;
}
.wx-row.mine .wx-meta {
  flex-direction: row-reverse;
}
.wx-bubble {
  background: #fff;
  color: #1e293b;
  border-radius: 4px 10px 10px 10px;
  padding: 8px 10px;
  font-size: 12px;
  line-height: 1.45;
  word-break: break-word;
  white-space: pre-wrap;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.12);
}
.wx-row.mine .wx-bubble {
  background: #95ec69;
  border-radius: 10px 4px 10px 10px;
}
.strip-streaming {
  opacity: 0.95;
}
.strip-cursor {
  animation: strip-blink 1s step-end infinite;
}
@keyframes strip-blink {
  50% {
    opacity: 0;
  }
}
.strip-composer {
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  padding: 10px 12px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex-shrink: 0;
}
.strip-composer-split {
  flex-shrink: 0;
  height: 12px;
  margin: -2px 0 0;
  cursor: ns-resize;
  position: relative;
  touch-action: none;
}
.strip-composer-split::after {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  top: 50%;
  height: 2px;
  transform: translateY(-50%);
  border-radius: 1px;
  background: transparent;
  transition: background 0.15s;
}
.strip-composer-split:hover::after,
.strip-composer-split.is-active::after {
  background: rgba(45, 212, 191, 0.5);
}
.strip-target {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 11px;
  opacity: 0.8;
}
.strip-select {
  width: 100%;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  background: rgba(0, 0, 0, 0.35);
  color: inherit;
  padding: 6px 8px;
  font-size: 12px;
}
.strip-input {
  width: 100%;
  resize: none;
  min-height: 72px;
  max-height: 360px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  background: rgba(0, 0, 0, 0.35);
  color: inherit;
  padding: 8px 10px;
  font-size: 12px;
  line-height: 1.4;
  box-sizing: border-box;
}
.strip-resize-handle {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 14px;
  margin: -4px 0 0;
  border: 0;
  padding: 0;
  cursor: ns-resize;
  background: transparent;
  color: inherit;
}
.strip-resize-handle span {
  width: 36px;
  height: 3px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.28);
}
.strip-resize-handle:hover span {
  background: rgba(45, 212, 191, 0.7);
}
.strip-input:focus,
.strip-select:focus {
  outline: 1px solid color-mix(in srgb, #0f766e 70%, white);
}
.strip-err {
  margin: 0;
  font-size: 11px;
  color: #fda4af;
}
.strip-voice-row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: center;
}
.strip-voice-warn {
  font-size: 10px;
  opacity: 0.55;
}
.strip-hint {
  margin: 6px 0 0;
  font-size: 11px;
  opacity: 0.55;
}
.strip-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
</style>
