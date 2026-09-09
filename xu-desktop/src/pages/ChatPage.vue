<script setup lang="ts">
/**
 * @file 主对话页：会话、Native Agent 流与连续语音协调
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-30
 * @updated 2026-09-07
 * @version 1.5.7
 * @category AgentLoop
 * @algo run-id-single-flight-session-bound-send-ack
 */
import { onApiCatch, sanitizeUserMessage, explainModelFailure, toUserError } from "../utils/userFacingError";
import { computed, defineAsyncComponent, onMounted, onUnmounted, ref, watch, nextTick } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { useRouter } from "vue-router";
import ChatTopBar from "../components/chat/ChatTopBar.vue";
import ChatSidebar from "../components/chat/ChatSidebar.vue";
import ChatMessageList from "../components/chat/ChatMessageList.vue";
import ChatComposer from "../components/chat/ChatComposer.vue";
import ChatChangedFilesStrip, {
  type ChangedFileEntry,
} from "../components/chat/ChatChangedFilesStrip.vue";
import WorkingDirBar from "../components/chat/WorkingDirBar.vue";
import IdeTerminalDock from "../components/chat/ide/IdeTerminalDock.vue";
import { useTerminalTabs } from "../composables/useTerminalTabs";
import SnapshotPanel from "../components/SnapshotPanel.vue";
import FilePreviewPanel from "../components/chat/FilePreviewPanel.vue";
import FileEditorPanel from "../components/chat/FileEditorPanel.vue";
import FileEditorTabs from "../components/chat/FileEditorTabs.vue";
import IdeActivityBar from "../components/chat/ide/IdeActivityBar.vue";
import IdeSidePanel from "../components/chat/ide/IdeSidePanel.vue";
import { useIdeSideView } from "../composables/useIdeSideView";
import { defaultEditorTabForPath } from "../utils/fileTypes";
import ChatAgentColumn from "../components/chat/ChatAgentColumn.vue";
import ChatProjectBar from "../components/ChatProjectBar.vue";
import { ideChatHistoryVisible, setIdeChatHistoryVisible } from "../composables/useIdeChatPanel";
import FileTreePanel from "../components/FileTreePanel.vue";
import { useOpenFileTabs } from "../composables/useOpenFileTabs";
import { useChatPanelResize } from "../composables/useChatPanelResize";
import { useHomeWorkspaceResize } from "../composables/useHomeWorkspaceResize";
import type { ChatAttachment, Message, Session, StreamChunk, ContextUsage } from "../types";
import { formatCnyShort, sessionBillingSummary, sessionBillingRounds, tokenPackageStatus, type SessionBillingRound, type SessionBillingSummary } from "../utils/billing";
import { resolveEndpoint, probeBrain, resolveAssistantDisplayName, type ResolvedEndpoint } from "../utils/opsBrains";
import {
  compactAgentMessages,
  loadAgentPrefs,
  saveAgentPrefs,
  chatModeLabel,
  normalizeChatMode,
  sessionContextUsage,
  type ChatMode,
  type ExecPolicy,
} from "../utils/agentPrefs";
import { parseToolPatch, isWritePatchTool, type PatchFileChange } from "../utils/patchDiff";
import { setIdeFileDiff } from "../utils/ideFileDiffs";
import { parseRememberCommand, rememberUserNote } from "../employee";
import { rememberQuestionOutline } from "../utils/questionOutlineMemory";
import { assembleAgentContext, indexWorkspaceContext, type ContextMessage } from "../utils/contextMemory";
import {
  buildAgencyShortPersona,
  ensureAgencyCatalog,
  ensureAgencyRolePrompt,
  getAgencyRole,
} from "../office/agencyRoles";
import { VoiceCallSession, dedupeRepeatedText, speechRecognitionAvailable, type VoicePhase } from "../utils/voiceCall";
import { parseLlmTtsInstruct, stripLlmTtsInstruct } from "../utils/llmTtsInstruct";
import { stripTextChatStageDirections } from "../utils/assistantOralPersona";
import { persistLlmTtsInstructForEngine } from "../utils/voiceSessionOverride";
import { listenVoiceRouteOverride } from "../utils/applyVoiceRouteOverride";
import { applyVoiceCommand, parseVoiceCommand } from "../utils/voiceCommandParse";
import { warmCosyFastapiQuiet } from "../utils/cosyFastapiWarm";
import { stopVoiceWake, speakWakeConfirm } from "../utils/voiceWake";
import {
  acknowledgeVoiceAssistantVisible,
  consumeOpenVoiceAssistantFlag,
  XU_VOICE_FORCE_HANGUP,
  XU_VOICE_OPEN_ASSISTANT,
  dispatchVoiceWakeRefresh,
  setVoiceAssistantOverlayOpen,
} from "../utils/voiceAssistantOpen";
import VoiceAssistantDialog from "../components/chat/VoiceAssistantDialog.vue";
import { loadVoiceSettings } from "../stores/voiceSettings";
import { resolveKokoroVoiceId } from "../utils/kokoroVoiceMap";
import { warmupKokoro } from "../utils/voiceNativeInstallApi";
import { requireWorkingDir } from "../utils/pluginCapability";
import { startRegionScreenshot } from "../utils/screenshot";
import { emitOpenInEditor, emitCanvasSketchUpdated, emitCanvasFlowUpdated, onWorkingDirChanged } from "../utils/crossWindowBus";
import { focusIdeWindow, isIdeWindow } from "../utils/windowManager";
import { readLs, writeLs } from "../utils/xuStorage";
import { prefetchWithPermission, resolveChatReadTargets } from "../utils/chatFileAccess";
import { BRAND_ASSISTANT_INTRO, BRAND_NAME_ZH } from "../utils/brandSettings";
import { buildUserAddressPromptLine } from "../utils/userAddressPrefs";
import {
  buildChatPrefetchSystemPrompt,
  buildChatToolSystemPrompt,
  buildChatWriteSystemPrompt,
  ensureChatWorkspace,
  isReadOnlyFileIntent,
  isWriteFileIntent,
  parseAppendLineIntent,
  rememberPathsFromMessage,
  resolveTargetFilePath,
  resolveAbsPath,
  toRelativePath,
  wantsFileTools,
} from "../utils/chatWorkspace";
import { readCodingSurfacePrefs } from "../utils/codingSurfacePrefs";
import { clearStuckUiBlockers } from "../utils/clearStuckUiBlockers";
import { buildAgentCapabilityHints } from "../capabilities";
import {
  assistantAsksVoiceConfirm,
  clearVoiceConfirmPending,
  looksLikeVoiceSensitiveOp,
  matchVoiceConfirmUtterance,
  tryResolveVoiceConfirm,
  voiceConfirmAsk,
  VOICE_USER_CONFIRMED_PREFIX,
} from "../utils/voiceConfirmGate";
import { takeSessionQueuedSend } from "../utils/sessionSendQueue";
import { writeClipboardText } from "../utils/clipboardText";
import { isVisionLikelyFailed, saveChatImageToWorkspace } from "../utils/chatImageVision";
import {
  getSessionProjectId,
  setSessionProjectId,
} from "../utils/chatSessionProject";
import { fouMsg, fouAlert, FouButton } from "foucui";
import {
  chatPanelLayoutLabel,
  chatViewModeLabel,
  loadChatLayoutPrefs,
  saveChatLayoutPrefs,
  type ChatPanelLayout,
  type ChatViewMode,
} from "../utils/chatLayoutPrefs";
import {
  debouncedLint,
  filterDiagnosticsForFile,
  lintFiles,
  mergeDiagnosticsBySource,
  type LintDiagnostic,
} from "../utils/workspaceLint";
import { isTsJsPath, tsGetDiagnostics } from "../utils/tsLanguageService";
import type { ProjectGitConfig, XuProject } from "../utils/projects";
import { promptRunProjectAfterSave } from "../utils/projectKickoff";
import RequirementClarifyDialog from "../components/RequirementClarifyDialog.vue";
import ProjectStartConfirmDialog from "../components/ProjectStartConfirmDialog.vue";
import DesignConfirmDialog from "../components/DesignConfirmDialog.vue";
import { XU_DESIGN_CONFIRM_NEEDED } from "../intent/designArtifacts";
import {
  extractClarifyQuestions,
  extractChoiceOptions,
  formatClarifyAnswers,
  looksLikeClarifyInterview,
  looksLikeStatusOrConfirmList,
  matchVoiceChoice,
} from "../intent/clarifyQuestionParse";
import ChoicePickDialog from "../components/ChoicePickDialog.vue";
import type { RequirementBrief } from "../intent/briefTypes";
import { formatMatchPlanSummary } from "../intent/briefTypes";
import {
  buildClarifyDialogOpen,
  markClarifyDialogOpened,
  notifyClarifyPending,
  resolveClarifyQuestions,
  type ClarifyOpenReason,
} from "../intent/clarifyUi";

const ProjectFormDialog = defineAsyncComponent(() => import("../components/ProjectFormDialog.vue"));

const props = defineProps<{
  apiKeyConfigured?: boolean;
  embedded?: boolean;
  homeMode?: boolean;
  /** IDE 右侧对话栏（仅 Agent 列 + 输入框） */
  idePanel?: boolean;
  /** 工作区由 IdePage 托管（新建 IDE 窗口，不读写全局 workingDir） */
  managedByParent?: boolean;
  /** Canvas 右侧对话：放行 canvas_write_sketch，勿因短句判 question 关掉写盘 */
  canvasSideChat?: boolean;
  workingDirOverride?: string | null;
}>();

const router = useRouter();

function onNavigate(e: Event) {
  const detail = (e as CustomEvent<string>).detail;
  if (detail) router.push(detail);
}

const sessions = ref<Session[]>([]);
const sessionDrawerOpen = ref(false);
const homeMdPaths = ref<string[]>([]);
const homeMdActive = ref<string | null>(null);
const activeSessionId = ref<string | null>(null);
const sessionMessages = ref<Record<string, Message[]>>({});
const streamingSessions = ref<Set<string>>(new Set());
const activeRunBySession = new Map<string, string>();
const sessionErrors = ref<Record<string, string>>({});
const workingDir = ref<string | null>(null);

/** 需求澄清弹窗 */
const clarifyDialogVisible = ref(false);
const clarifyQuestions = ref<string[]>([]);
const clarifyHint = ref("请先回答下列问题；答完后继续，若仍有缺口会再次弹出。");
const clarifyDialogTitle = ref("补充需求");
let clarifyFromDialog = false;
const choiceDialogVisible = ref(false);
const choiceOptions = ref<string[]>([]);
let choiceFromDialog = false;

/** Brief ready → 开工确认 */
const startConfirmVisible = ref(false);
const startConfirmBrief = ref<RequirementBrief | null>(null);
const startConfirmProject = ref<XuProject | null>(null);
const startConfirmPath = ref("");
/** 本会话草稿/绑定项目，供 Brief 挂载 */
const chatBriefProjectId = ref<string | null>(null);
/** 打开「补充需求」时快照，提交勿跟切任务后的会话/项目 */
const clarifyBoundProjectId = ref<string | null>(null);
const clarifyBoundSessionId = ref<string | null>(null);
/** Brief CTA：缺口已齐、待显式确认 */
const briefSnapForCta = ref<RequirementBrief | null>(null);
const confirmBriefGapsEmpty = ref(false);
const showConfirmBriefCta = computed(() => {
  const b = briefSnapForCta.value;
  if (!chatBriefProjectId.value || !b) return false;
  if (b.status !== "gathering" || b.requirementsConfirmedAt) return false;
  return confirmBriefGapsEmpty.value;
});
const showOpenCanvasCta = computed(() => router.currentRoute.value.path !== "/canvas");

const designConfirmVisible = ref(false);
const designConfirmProjectId = ref<string | null>(null);

function openDesignConfirm(projectId: string) {
  if (!projectId) return;
  designConfirmProjectId.value = projectId;
  if (voiceSession?.active) {
    void (async () => {
      const d = await voiceUiConfirmAsk(
        "开工前需要确认设计方案。请说确认打开选择界面，或者说取消稍后再说。",
        "设计确认",
      );
      if (d === "confirm") {
        designConfirmVisible.value = true;
      } else {
        voiceSession?.speakConfirm("好的，稍后再确认设计。");
      }
    })();
    return;
  }
  designConfirmVisible.value = true;
}

function onDesignConfirmNeeded(ev: Event) {
  const id = (ev as CustomEvent<{ projectId?: string }>).detail?.projectId;
  if (id) openDesignConfirm(id);
}

function openProjectStartConfirm(brief: RequirementBrief, project: XuProject | null) {
  if (!brief || (brief.status !== "ready" && brief.status !== "executing")) return;
  startConfirmBrief.value = brief;
  startConfirmProject.value = project;
  startConfirmPath.value =
    (project?.generatePath || "").trim() || (workingDir.value || "").trim() || "";
  startConfirmVisible.value = true;
}

function appendLocalAssistant(sessionTag: string, content: string) {
  const text = content.trim();
  if (!text || !sessionTag) return;
  const list = [...(sessionMessages.value[sessionTag] ?? [])];
  const last = list[list.length - 1];
  // 复用发送时插入的助手气泡：保留思考块；中间流式 JSON 正文并入思考，再换成白话
  if (last?.role === "assistant") {
    const thinkBlocks = last.blocks.filter((b) => b.type === "think");
    const draftText = last.blocks
      .filter((b) => b.type === "text")
      .map((b) => (b.type === "text" ? b.content : ""))
      .join("")
      .trim();
    if (draftText && draftText !== text && (draftText.startsWith("{") || draftText.length > 80)) {
      thinkBlocks.push({ type: "think", content: draftText });
    }
    list[list.length - 1] = {
      ...last,
      blocks: [...thinkBlocks, { type: "text" as const, content: text }],
      status: "done",
      statusLine: undefined,
      thinkEndedAt: last.thinkEndedAt ?? Date.now(),
    };
  } else {
    list.push({
      id: `a_${Date.now()}`,
      role: "assistant",
      blocks: [{ type: "text", content: text }],
      timestamp: new Date().toISOString(),
      status: "done",
      thinkPhrase: pickThinkPhrase(),
      thinkStartedAt: Date.now(),
      thinkEndedAt: Date.now(),
    });
  }
  sessionMessages.value = { ...sessionMessages.value, [sessionTag]: list };
  void invoke("xu_append_chat_message", {
    sessionId: sessionTag,
    role: "assistant",
    content: text,
  }).catch(() => null);
}

/** 清掉会话里残留的空流式助手气泡（澄清跳过模型、失败未落字时） */
function pruneEmptyStreamingAssistants(sessionTag: string, keepLastWithText = true) {
  const list = sessionMessages.value[sessionTag] ?? [];
  if (!list.length) return;
  const next = list.filter((m, i) => {
    if (m.role !== "assistant") return true;
    const hasText = m.blocks.some((b) => b.type === "text" && String(b.content || "").trim());
    if (hasText) return true;
    if (m.status === "streaming" || m.status === "error") return false;
    // 已 done 但无正文：若后面还有带正文的助手消息则删掉占位
    if (m.status === "done" && !hasText) {
      const laterHasAnswer = list.slice(i + 1).some(
        (x) =>
          x.role === "assistant" &&
          x.blocks.some((b) => b.type === "text" && String(b.content || "").trim()),
      );
      if (laterHasAnswer) return false;
      if (!keepLastWithText && i === list.length - 1) return false;
    }
    return true;
  });
  if (next.length !== list.length) {
    sessionMessages.value = { ...sessionMessages.value, [sessionTag]: next };
  }
}

/** Brief 澄清类回复同步到办公室聊天条 */
function appendBriefAssistant(sessionTag: string, content: string) {
  appendLocalAssistant(sessionTag, content);
  void import("../intent").then(({ mirrorClarifyTurnToOffice }) =>
    mirrorClarifyTurnToOffice({ systemText: content }),
  );
}

function onProjectStartDone(result: {
  mode: string;
  project?: XuProject;
  kickedOff?: boolean;
  hiredCount?: number;
  dispatched?: number;
  roleSummary?: string;
  awaitingDesignConfirm?: boolean;
}) {
  if (result.project?.id) {
    chatBriefProjectId.value = result.project.id;
    setSessionProjectId(activeSessionId.value, result.project.id);
  }
  if (result.project?.generatePath && !props.managedByParent) {
    workingDir.value = result.project.generatePath;
    try {
      localStorage.setItem("xu.chat.workingDir", result.project.generatePath);
    } catch {
      /* ignore */
    }
  }
  if (result.awaitingDesignConfirm && result.project?.id) {
    openDesignConfirm(result.project.id);
  }
  const sid = activeSessionId.value;
  if (result.mode === "later") {
    fouMsg.info("已保留需求就绪状态；可稍后在弹窗或办公室开工");
  } else if (sid && result.project) {
    const lines = [
      result.mode === "save_and_kickoff"
        ? result.awaitingDesignConfirm
          ? `✅ 已保存项目「${result.project.name}」并开始设计。请确认线框后再写码。`
          : `✅ 已保存项目「${result.project.name}」并按派岗表调用 AI 员工。`
        : `✅ 已保存项目「${result.project.name}」并完成入职（未派活）。`,
      result.roleSummary ? `岗位：${result.roleSummary}` : "",
      result.hiredCount != null ? `入职 ${result.hiredCount} 人` : "",
      result.dispatched != null ? `派活 ${result.dispatched} 人` : "",
      "可到「办公室」查看员工工作状态。",
    ].filter(Boolean);
    appendLocalAssistant(sid, lines.join("\n"));
  }
}

function openClarifyDialog(questions: string[], hint?: string, title?: string) {
  const qs = questions.map((q) => q.trim()).filter(Boolean).slice(0, 3);
  if (!qs.length) return;
  clarifyQuestions.value = qs;
  if (hint) clarifyHint.value = hint;
  if (title) clarifyDialogTitle.value = title;
  clarifyBoundProjectId.value = chatBriefProjectId.value;
  clarifyBoundSessionId.value = activeSessionId.value;
  clarifyDialogVisible.value = true;
  markClarifyDialogOpened("chat", clarifyBoundProjectId.value);
}

function openClarifyIfNeeded(
  brief: RequirementBrief | null,
  reason: ClarifyOpenReason,
  project?: XuProject | null,
) {
  const payload = buildClarifyDialogOpen(brief, reason, { project });
  if (!payload) return;
  openClarifyDialog(payload.questions, payload.hint, payload.title);
}

function collectAssistantText(msg: {
  blocks?: Array<{ type: string; content?: string }>;
} | null | undefined): string {
  if (!msg?.blocks?.length) return "";
  return msg.blocks
    .filter((b) => b.type === "text" && (b.content || "").trim())
    .map((b) => String(b.content || ""))
    .join("\n");
}

function maybeOpenClarifyFromText(text: string, opts?: { force?: boolean }) {
  if (clarifyFromDialog) {
    clarifyFromDialog = false;
    return;
  }
  if (choiceFromDialog) {
    choiceFromDialog = false;
    return;
  }
  const choices = extractChoiceOptions(text);
  if (choices.length >= 2) {
    choiceOptions.value = choices;
    choiceDialogVisible.value = true;
    // 通话：不在此单独播选项，由 stream-done / 收尾 speak 合并念一次
    return;
  }
  // Brief 缺口弹窗优先；自由 LLM 列表仅作兜底（Brief 未接管时）
  const briefId = chatBriefProjectId.value;
  if (briefId) return;
  // 获客确认稿 / 假权限指南等编号列表：不当「补充需求」
  if (!opts?.force && looksLikeStatusOrConfirmList(text)) return;
  const qs = extractClarifyQuestions(text);
  const interview = looksLikeClarifyInterview(text);
  if (qs.length < 1) return;
  if (!opts?.force && !interview && qs.length < 2) return;
  if (voiceSession?.active) {
    pendingVoiceClarifyAsk = `有几件事需要你确认：${qs.slice(0, 4).join("；")}。请直接口头回答。`;
    return;
  }
  openClarifyDialog(
    qs,
    "根据回复整理出的待确认项。填完提交后会写入需求 Brief；若仍缺信息会再次弹出。",
  );
}

function sendChoiceReply(text: string) {
  choiceFromDialog = true;
  choiceDialogVisible.value = false;
  void sendMessage(text);
}

function onChoicePick(opt: string) {
  sendChoiceReply(`【选择】${opt}`);
}

function onChoiceNone() {
  sendChoiceReply("【选择】都不是，我只是随便问问 / 换个做法。");
}

function tryVoiceResolveChoice(utter: string): boolean {
  if (!choiceDialogVisible.value || !choiceOptions.value.length) return false;
  const hit = matchVoiceChoice(utter, choiceOptions.value);
  if (hit === null) return false;
  if (hit < 0) onChoiceNone();
  else onChoicePick(choiceOptions.value[hit]!);
  return true;
}

async function resolveChatProjectForBrief(
  goalHint?: string,
  targetSessionId?: string | null,
  classification?: import("../intent/workModeClassifier").WorkModeClassification,
): Promise<XuProject | null> {
  const { ensureChatProject, findProjectByWorkingDir, shouldCreateBriefProject } =
    await import("../intent/ensureChatProject");
  const { loadProjects } = await import("../utils/projects");
  const list = await loadProjects();
  const sessionKey = (targetSessionId ?? activeSessionId.value) || null;
  const boundId = getSessionProjectId(sessionKey);
  if (boundId) {
    const hit = list.find((p) => p.id === boundId);
    if (hit) {
      if (!targetSessionId || targetSessionId === activeSessionId.value) {
        chatBriefProjectId.value = hit.id;
      }
      return hit;
    }
  }
  const ws = (workingDir.value || "").trim();
  if (ws) {
    const matched = findProjectByWorkingDir(list, ws);
    if (matched) {
      bindChatBriefProject(matched.id, sessionKey, targetSessionId);
      return matched;
    }
  }
  if (classification && !shouldCreateBriefProject(classification)) {
    return null;
  }
  const preferSameSession =
    sessionKey === activeSessionId.value ? chatBriefProjectId.value : null;
  const r = await ensureChatProject({
    workingDir: workingDir.value,
    goalHint,
    preferProjectId: preferSameSession,
    classification,
  });
  bindChatBriefProject(r.project.id, sessionKey, targetSessionId);
  return r.project;
}

/** Duty: 写入本页 Brief 指针 + 会话→项目 map（避免跨任务串台）。 */
function bindChatBriefProject(
  projectId: string,
  sessionKey: string | null,
  targetSessionId?: string | null,
) {
  const pid = String(projectId || "").trim();
  if (!pid) return;
  if (!targetSessionId || targetSessionId === activeSessionId.value) {
    chatBriefProjectId.value = pid;
  }
  setSessionProjectId(sessionKey || targetSessionId || activeSessionId.value, pid);
}

async function afterBriefGate(
  project: XuProject,
  gate: {
    brief: RequirementBrief | null;
    systemMessage: string | null;
    runKickoff?: boolean;
    forceAll?: boolean;
  },
  intentKind: string,
  sessionTag: string,
  bossText?: string,
) {
  const brief = gate.brief;
  if (!brief) return;

  try {
  if (gate.systemMessage?.trim()) {
    appendBriefAssistant(sessionTag, gate.systemMessage);
    notifyClarifyPending(project.id);
  }

  if (gate.runKickoff) {
    const { checkKickoffPreflight, runBriefMatchedKickoff } = await import("../intent");
    const pre = await checkKickoffPreflight(project, brief);
    if (!pre.ok) {
      if (pre.gapQuestions?.length) {
        appendBriefAssistant(
          sessionTag,
          [
            "还不能开始做，请先回答：",
            ...pre.gapQuestions.map((q, i) => `${i + 1}. ${q}`),
          ].join("\n"),
        );
        if (sessionTag === activeSessionId.value) {
          const payload = buildClarifyDialogOpen(brief, "kickoff_preflight", { project });
          if (payload) {
            openClarifyDialog(payload.questions, payload.hint, payload.title);
          }
        }
        notifyClarifyPending(project.id);
      } else {
        appendBriefAssistant(sessionTag, `还不能开始：${pre.reason || "条件未满足"}`);
        if (pre.openProjectStart && sessionTag === activeSessionId.value) {
          openProjectStartConfirm(brief, project);
        }
      }
      return;
    }
    try {
      const kick = await runBriefMatchedKickoff({
        project,
        brief,
        bossText:
          (bossText || "").trim() ||
          `【全体开工】${brief.goal || project.name}`,
        forceAll: gate.forceAll === true,
      });
      if (
        kick.awaitingDesignConfirm &&
        kick.project?.id &&
        sessionTag === activeSessionId.value
      ) {
        openDesignConfirm(kick.project.id);
      }
      appendBriefAssistant(
        sessionTag,
        kick.awaitingDesignConfirm
          ? `设计已开始（${kick.dispatched} 人）。请确认线框后再写代码；可到「办公室」查看。`
          : `已安排开始做（${kick.dispatched} 人）。请到「办公室」查看进度。`,
      );
    } catch (e) {
      appendBriefAssistant(sessionTag, `开始失败：${toUserError(e).slice(0, 400)}`);
    }
    return;
  }

  if (brief.status === "gathering") {
    const reason: ClarifyOpenReason =
      intentKind === "confirm_brief" ? "confirm_brief" : "clarify";
    if (sessionTag === activeSessionId.value) {
      await nextTick();
      openClarifyIfNeeded(brief, reason, project);
    }
    notifyClarifyPending(project.id);
    return;
  }

  if (
    (brief.status === "ready" || brief.status === "executing") &&
    (intentKind === "confirm_brief" || intentKind === "kickoff_ready" || intentKind === "force_all_kickoff")
  ) {
    if (sessionTag === activeSessionId.value) {
      openProjectStartConfirm(brief, project);
    }
  }
  } finally {
    if (sessionTag === activeSessionId.value) {
      void refreshBriefCta();
    }
  }
}

async function onClarifyDialogSubmit(answers: string[]) {
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

  const snapProjectId = clarifyBoundProjectId.value;
  const snapSessionId = clarifyBoundSessionId.value;

  let sessionTag = snapSessionId || activeSessionId.value;
  if (!sessionTag) {
    sessionTag = `xu_${Date.now().toString(36)}`;
    activeSessionId.value = sessionTag;
    sessions.value = [
      {
        id: sessionTag,
        title: "需求补充",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      ...sessions.value,
    ];
  }
  if (snapProjectId) {
    setSessionProjectId(sessionTag, snapProjectId);
  }

  const userMsg = {
    id: `u_${Date.now()}`,
    role: "user" as const,
    blocks: [{ type: "text" as const, content: body }],
    timestamp: new Date().toISOString(),
    status: "done" as const,
  };
  sessionMessages.value = {
    ...sessionMessages.value,
    [sessionTag]: [...(sessionMessages.value[sessionTag] ?? []), userMsg],
  };
  void invoke("xu_append_chat_message", {
    sessionId: sessionTag,
    role: "user",
    content: body,
  }).catch(() => null);

  void import("../intent").then(({ mirrorClarifyTurnToOffice }) =>
    mirrorClarifyTurnToOffice({ bossText: body }),
  );

  try {
    const pid = snapProjectId || chatBriefProjectId.value;
    if (!pid) {
      void sendMessage(body);
      return;
    }
    const { loadProjects } = await import("../utils/projects");
    const project = (await loadProjects()).find((p) => p.id === pid);
    if (!project) {
      void sendMessage(body);
      return;
    }
    const { processClarifyGate, routeBossIntent, loadBrief } = await import("../intent");
    const brief0 = await loadBrief(project.id);
    const intent = routeBossIntent(body, brief0);
    const gate = await processClarifyGate({ text: body, project });
    await afterBriefGate(project, gate, intent.kind, sessionTag, body);
  } catch (e) {
    void onApiCatch(e);
    // 兜底：仍回灌对话
    void sendMessage(body);
  }
}

function onClarifyDialogSkip() {
  fouMsg.info("已跳过本次补充，可随时在对话中继续说明需求");
}
const {
  tabs: terminalTabs,
  activeId: terminalActiveId,
  visible: terminalVisible,
  height: terminalHeight,
  addTab: addTerminalTab,
  closeTab: closeTerminalTab,
  selectTab: selectTerminalTab,
  hide: hideTerminal,
  show: showTerminal,
  setHeight: setTerminalHeight,
  ensureTab: ensureTerminalTab,
  toggle: toggleTerminal,
} = useTerminalTabs();
const terminalReadyIds = ref<Set<string>>(new Set());
const snapshotPanelOpen = ref(false);
const fileTreeOpen = ref(false);
const fileTreeAutoOpened = ref(false);
const {
  tabs: openFileTabs,
  activePath: previewPath,
  openFile,
  setDirty,
  keepOpen,
  togglePin,
  closeTab,
  closeOthers,
  closeToRight,
  closeSaved,
  closeAll,
} = useOpenFileTabs();
const editorViewTab = ref<"preview" | "edit" | "diff">("edit");
const fileEditorRef = ref<InstanceType<typeof FileEditorPanel> | null>(null);
const editorFileContent = ref("");
const lintDiagnostics = ref<LintDiagnostic[]>([]);
const problemsCollapsed = ref(false);
const { activeView: ideSideView, setView: setIdeSideView } = useIdeSideView();
const ideSideRef = ref<InstanceType<typeof IdeSidePanel> | null>(null);
const askTreeRef = ref<InstanceType<typeof FileTreePanel> | null>(null);
const previewCollapsed = ref(false);
const layoutPrefs = loadChatLayoutPrefs();
const chatViewMode = ref<ChatViewMode>(props.homeMode ? "qa" : layoutPrefs.viewMode);
const chatPanelLayout = ref<ChatPanelLayout>(layoutPrefs.panelLayout);
const isCodeView = computed(() => chatViewMode.value === "code");
const layoutAgentRight = computed(() => chatPanelLayout.value === "agentRight");
const activeFileDiagnostics = computed(() => {
  if (!previewPath.value) return [];
  return filterDiagnosticsForFile(lintDiagnostics.value, previewPath.value);
});
const activeFileDiff = computed(() => {
  const p = previewPath.value;
  if (!p) return null;
  const key = p.replace(/\\/g, "/").toLowerCase();
  return fileDiffByPath.value[key] ?? null;
});
const { codeTreeWidth, codeAgentWidth, resizing: codeResizing, startResize: startCodeResize, resetResize: resetCodeResize } =
  useChatPanelResize(() => layoutAgentRight.value);
const {
  taskPanelWidth,
  agentPaneHeight,
  resizing: homeResizing,
  startResize: startHomeResize,
  resetResize: resetHomeResize,
} = useHomeWorkspaceResize();

function lockHomeViewMode() {
  if (!props.homeMode) return;
  if (chatViewMode.value !== "qa") chatViewMode.value = "qa";
  fileTreeOpen.value = false;
  snapshotPanelOpen.value = false;
}

function resetPanelResizeState() {
  resetHomeResize();
  resetCodeResize();
}

async function getBoundProjectGeneratePath(): Promise<string | null> {
  const { loadProjects } = await import("../utils/projects");
  const list = await loadProjects();
  if (chatBriefProjectId.value) {
    const gp = (list.find((p) => p.id === chatBriefProjectId.value)?.generatePath || "").trim();
    if (gp) return gp;
  }
  return null;
}

async function guideHomeProjectStart(): Promise<void> {
  try {
    const pid = chatBriefProjectId.value;
    if (!pid) {
      void fouAlert("请先在对话中说明要做的项目，或从项目页创建。", "提示");
      return;
    }
    const { loadBrief } = await import("../intent");
    const { loadProjects } = await import("../utils/projects");
    const project = (await loadProjects()).find((p) => p.id === pid);
    if (!project) return;
    const brief = await loadBrief(project.id);
    if (brief.status === "ready" || brief.status === "executing") {
      openProjectStartConfirm(brief, project);
      return;
    }
    void fouAlert("请先确认需求（Brief ready）后再在「开始项目」向导中选择保存位置。", "提示");
  } catch (e) {
    void onApiCatch(e);
  }
}

/** Duty: 刷新「确认需求」CTA 可见性（缺口齐且仍 gathering）。 */
async function refreshBriefCta(): Promise<void> {
  const pid = (chatBriefProjectId.value || "").trim();
  if (!pid) {
    briefSnapForCta.value = null;
    confirmBriefGapsEmpty.value = false;
    return;
  }
  try {
    const { loadBrief } = await import("../intent");
    const { loadProjects } = await import("../utils/projects");
    const { computeBriefGaps, briefGapsOptsFromBrief } = await import("../intent/briefGaps");
    const project = (await loadProjects()).find((p) => p.id === pid) ?? null;
    const brief = await loadBrief(pid);
    briefSnapForCta.value = brief;
    const gaps = computeBriefGaps(brief, briefGapsOptsFromBrief(brief, project));
    confirmBriefGapsEmpty.value = gaps.length === 0;
  } catch {
    briefSnapForCta.value = null;
    confirmBriefGapsEmpty.value = false;
  }
}

/** Duty: 对话点「确认需求」→ Brief ready → 打开开始项目。 */
async function onChatConfirmBrief(): Promise<void> {
  const pid = (chatBriefProjectId.value || "").trim();
  if (!pid) return;
  try {
    const { loadProjects } = await import("../utils/projects");
    const { confirmBriefFromUi } = await import("../intent");
    const project = (await loadProjects()).find((p) => p.id === pid);
    if (!project) {
      void fouAlert("未找到当前任务绑定的项目，请先在对话中说明要做的事。", "提示");
      return;
    }
    const brief = await confirmBriefFromUi(project);
    await refreshBriefCta();
    const sid = activeSessionId.value;
    if (brief && (brief.status === "ready" || brief.status === "executing")) {
      if (sid) {
        appendBriefAssistant(sid, "需求已确认。请在「开始项目」中选择保存位置并开工。");
      }
      openProjectStartConfirm(brief, project);
    } else if (brief?.status === "gathering") {
      openClarifyIfNeeded(brief, "confirm_brief", project);
    }
  } catch (e) {
    void onApiCatch(e);
  }
}

/** Duty: 打开 Canvas；无工作区时用默认画板目录（可马上手绘）。 */
async function openCanvasFromChat(): Promise<void> {
  if (!workingDir.value?.trim() && !props.managedByParent) {
    const { ensureDefaultCanvasWorkspace } = await import("../utils/canvasDefaultWorkspace");
    const ws = await ensureDefaultCanvasWorkspace();
    if (ws) workingDir.value = ws;
  }
  if (router.currentRoute.value.path !== "/canvas") {
    void router.push("/canvas");
  }
}

watch(
  () => props.homeMode,
  (home) => {
    if (home) lockHomeViewMode();
  },
  { immediate: true },
);

watch(chatBriefProjectId, async (id) => {
  if (!id) return;
  const gp = await getBoundProjectGeneratePath();
  if (!gp) return;
  workingDir.value = gp;
  if (!props.managedByParent) {
    try {
      localStorage.setItem("xu.chat.workingDir", gp);
    } catch {
      /* ignore */
    }
  }
});

watch([clarifyDialogVisible, startConfirmVisible, designConfirmVisible], (open) => {
  if (open.some(Boolean)) resetPanelResizeState();
  else nextTick(() => clearStuckUiBlockers());
});
type QueuedSend = {
  id: string;
  text: string;
  imageDataUrl?: string | null;
  extras?: { attachments?: ChatAttachment[]; imageDataUrls?: string[]; outputFormat?: string };
};
const queuedBySession = ref<Record<string, QueuedSend[]>>({});
const contextUsage = ref<ContextUsage | null>(null);
const sessionBilling = ref<SessionBillingSummary | null>(null);
const sessionBillingRoundsList = ref<SessionBillingRound[]>([]);
const tokenHardHit = ref(false);
const chatMode = ref<ChatMode>("agent");
const execPolicy = ref<ExecPolicy>("standard");
const changedFilesBySession = ref<Record<string, ChangedFileEntry[]>>({});
const fileDiffByPath = ref<Record<string, PatchFileChange[]>>({});
const activeProjectGit = ref<ProjectGitConfig | null>(null);
const showTools = ref(readLs("xu.chat.showTools", "hermes_show_tools") !== "false");
const showThink = ref(readLs("xu.chat.showThink", "hermes_show_think") !== "false");
const repliesCollapsed = ref(readLs("xu.chat.repliesCollapsed", "hermes_replies_collapsed") === "true");
const draft = ref("");
const editingUserMessage = ref(false);
const showProjectForm = ref(false);
const agentVersion = ref(BRAND_NAME_ZH);
const brainEp = ref<ResolvedEndpoint | null>(null);
const showKeyBanner = ref(false);
const brainHint = ref("");
const brainOk = ref<boolean | null>(null);
const voicePhase = ref<VoicePhase>("idle");
const voiceActive = ref(false);
const voiceInterimText = ref("");
const EXPERT_ROLE_KEY = "xu.chat.expert_role_id";
const selectedExpertRoleId = ref<string | null>(
  (() => {
    try {
      return localStorage.getItem(EXPERT_ROLE_KEY);
    } catch {
      return null;
    }
  })(),
);
let voiceSession: VoiceCallSession | null = null;
let voiceSessionId: string | null = null;
/** 助手已口头征求确认，等待用户说确认/取消 */
let voiceSensitiveHold = false;

async function voiceUiConfirmAsk(
  message: string,
  _title: string,
): Promise<"confirm" | "cancel"> {
  if (!voiceSession?.active) return "cancel";
  // 清 awaiting：否则确权 TTS 播完 pump 因 awaitingAgentReply 不开麦 → 死锁
  const wasAwaiting = voiceSession.isAwaitingAgentReply();
  voiceSession.notifyAgentIdle({ resumeListen: false });
  try {
    return await voiceConfirmAsk(async (prompt) => {
      voiceSession?.speakConfirm(prompt);
    }, message);
  } finally {
    // 仍在 sendMessage 思考链路内时，确权结束后回到关麦等后续 LLM
    if (voiceSession?.active && wasAwaiting) {
      voiceSession.markThinking();
    }
  }
}
const voiceDialogOpen = ref(false);
const voiceSummarizingSessionId = ref<string | null>(null);
const voiceSummarizing = computed(
  () => voiceSummarizingSessionId.value === activeSessionId.value,
);
const voiceCaptions = ref<Array<{ role: "user" | "assistant"; text: string }>>([]);
let voiceHangupLock = false;
let voiceSpeakTurn = 0;
/** stream-done 已 flush 朗读的回合，收尾避免整段复读 */
let voiceFlushedSpeakTurn = -1;
/** 唤醒确认「在呢」：系统音先播，会话就绪后登记回声过滤 */
let pendingWakeConfirmSpeak = false;
/** 通话澄清题：与主答复合并念一次，避免双重 TTS */
let pendingVoiceClarifyAsk = "";
/** 当前通话流式助手气泡 id，字幕/朗读绑定此条，禁止永远取最后一条 */
let voiceStreamBubbleId: string | null = null;
/** 通话流式原始全文（含 TTS_INSTRUCT），气泡只展示剥离后正文 */
const voiceStreamRawBySession = new Map<string, string>();

function isVoiceBoundSession(sessionId: string): boolean {
  return Boolean(
    voiceSession?.active && voiceSessionId && sessionId === voiceSessionId,
  );
}

function buildVoiceAskPayload(raw: string, answerText: string): string {
  const clarify = pendingVoiceClarifyAsk.trim();
  pendingVoiceClarifyAsk = "";
  if (choiceDialogVisible.value && choiceOptions.value.length) {
    const numbered = choiceOptions.value
      .map((c, i) => `选项${i + 1}，${c}`)
      .join("。");
    return `${raw}\n${numbered}。请说编号，或者说都不是。`;
  }
  if (clarify) {
    return answerText.trim()
      ? `${raw}\n${clarify}`
      : clarify;
  }
  return raw;
}

function mergeVoiceStreamRaw(sessionId: string, chunk: StreamChunk) {
  if (chunk.kind !== "text" && chunk.kind !== "token") return;
  const incoming = chunk.content || "";
  if (!incoming) return;
  let prev = voiceStreamRawBySession.get(sessionId) || "";
  if (chunk.kind === "text") {
    if (incoming === prev) return;
    if (incoming.startsWith(prev)) prev = incoming;
    else if (!prev.startsWith(incoming)) prev = prev + incoming;
  } else {
    prev = prev + incoming;
  }
  voiceStreamRawBySession.set(sessionId, prev);
}

/** 通话优先取流式 raw（含 TTS_INSTRUCT）；否则读气泡正文。 */
function voiceStreamRawText(sessionId: string): string {
  const fromMap = voiceStreamRawBySession.get(sessionId);
  if (fromMap != null && fromMap.length > 0) return dedupeRepeatedText(fromMap);
  return assistantPlainText(sessionId);
}

/** 通话字幕：剥 TTS_INSTRUCT 与表演括号后再展示。 */
function upsertVoiceAssistantCaption(text: string): string {
  const spoken = dedupeRepeatedText(stripLlmTtsInstruct(text));
  if (!spoken) return "";
  const caps = [...voiceCaptions.value];
  const last = caps[caps.length - 1];
  if (last?.role === "assistant") {
    if (last.text === spoken) return spoken;
    caps[caps.length - 1] = { role: "assistant", text: spoken };
  } else {
    caps.push({ role: "assistant", text: spoken });
  }
  voiceCaptions.value = caps;
  return spoken;
}

/** 流式 token 节流写字幕，避免每 token 克隆数组拖死 WebView */
let voiceCaptionFlushTimer: ReturnType<typeof setTimeout> | null = null;
let voiceCaptionPending = "";
function scheduleVoiceAssistantCaption(text: string) {
  voiceCaptionPending = text;
  if (voiceCaptionFlushTimer) return;
  voiceCaptionFlushTimer = setTimeout(() => {
    voiceCaptionFlushTimer = null;
    upsertVoiceAssistantCaption(voiceCaptionPending);
  }, 220);
}

function voiceSpeakWhenStreamDone(sessionId: string) {
  if (!isVoiceBoundSession(sessionId)) return;
  const raw = voiceStreamRawText(sessionId);
  const { answerText, ttsInstruct } = parseLlmTtsInstruct(raw);
  persistLlmTtsInstructForEngine(ttsInstruct);
  stripVoiceStreamBubbleTtsInstruct(sessionId, answerText);
  const spoken = upsertVoiceAssistantCaption(answerText);
  // stream done：先清 awaiting，否则 TTS 播完 pump 拒绝开麦 → 多轮卡死
  if (!spoken) {
    voiceSession!.notifyAgentIdle({ resumeListen: true });
    return;
  }
  voiceSession!.notifyAgentIdle();
  if (assistantAsksVoiceConfirm(answerText)) {
    voiceSensitiveHold = true;
  }
  voiceFlushedSpeakTurn = voiceSpeakTurn;
  // 正文先念；澄清/选项在 sendMessage 收尾补一句，避免双重整段
  voiceSession!.speakCumulative(raw, { flush: true, turn: voiceSpeakTurn });
}

/** 流式过程中按句推朗读，避免整段合成完才出声。 */
function voiceSpeakProgress(sessionId: string) {
  if (!isVoiceBoundSession(sessionId)) return;
  const raw = voiceStreamRawText(sessionId);
  if (!raw.trim()) return;
  const { answerText } = parseLlmTtsInstruct(raw);
  scheduleVoiceAssistantCaption(answerText);
  // 传原始文本，speakCumulative 内解析 TTS_INSTRUCT
  voiceSession!.speakCumulative(raw, { turn: voiceSpeakTurn });
}

/** 通话气泡写入已剥指令/表演括号的正文，避免用户看见内部提示。 */
function stripVoiceStreamBubbleTtsInstruct(sessionId: string, answerText: string) {
  const list = sessionMessages.value[sessionId];
  if (!list?.length) return;
  const idx = voiceStreamBubbleId
    ? list.findIndex((m) => m.id === voiceStreamBubbleId)
    : [...list].map((m, i) => ({ m, i })).reverse().find((x) => x.m.role === "assistant")?.i ?? -1;
  if (idx < 0) return;
  const msg = list[idx];
  const nextBlocks = msg.blocks.map((b) =>
    b.type === "text" ? { ...b, content: answerText } : b,
  );
  const next = [...list];
  next[idx] = { ...msg, blocks: nextBlocks };
  sessionMessages.value = { ...sessionMessages.value, [sessionId]: next };
}

const expertRole = computed(() =>
  selectedExpertRoleId.value ? getAgencyRole(selectedExpertRoleId.value) : null,
);

const expertBrainSlot = computed(() => expertRole.value?.brainSlot ?? "command");

async function refreshBrainBadge(opts?: { skipProbe?: boolean }) {
  try {
    const ep = await resolveEndpoint({ slot: expertBrainSlot.value, chatContext: true });
    brainEp.value = ep;
    // 切换模型后立刻清掉所有会话错误条（含旧远程 500/401），避免底栏已本地仍显示远程失败
    sessionErrors.value = {};
    const hasModel = Boolean(ep.model.trim() && ep.baseUrl.trim());
    if (!hasModel) {
      showKeyBanner.value = true;
      brainHint.value = "请先在设置 → 三脑中配置模型与 Base URL（或点底栏模型选择）";
      brainOk.value = false;
      return;
    }
    if (!opts?.skipProbe) {
      try {
        await probeBrain(ep.baseUrl, {
          apiKeyEnv: ep.apiKeyEnv || undefined,
          model: ep.model || undefined,
        });
        brainOk.value = true;
      } catch {
        brainOk.value = false;
      }
    } else {
      brainOk.value = true;
    }
    if (ep.source === "local") {
      showKeyBanner.value = false;
      brainHint.value = brainOk.value ? "" : "本地模型探测失败，请确认 Ollama 已启动";
      return;
    }
    const expectsKey = Boolean(ep.apiKeyEnv.trim());
    let keyOk = props.apiKeyConfigured;
    if (keyOk === undefined) {
      keyOk = !expectsKey;
    }
    showKeyBanner.value = expectsKey && keyOk === false;
    brainHint.value = showKeyBanner.value
      ? "远程模型需要配置 API 密钥（可在设置 → 模型中填写，或改用本地 Ollama）"
      : "";
  } catch (e) {
    brainHint.value = toUserError(e);
    showKeyBanner.value = true;
    brainOk.value = false;
  }
}

const brainLabel = computed(() => {
  const ep = brainEp.value;
  if (!ep?.model) return "未配置模型";
  const src = ep.source === "local" ? "本地" : "远程";
  const name = ep.displayName?.trim() || ep.model;
  return `${src} · ${name}`;
});

const assistantName = computed(() => {
  const role = expertRole.value;
  if (role) return role.nameZh || role.name;
  return resolveAssistantDisplayName(brainEp.value);
});

const modelPillLabel = computed(() => {
  const label = brainLabel.value;
  return label.length > 18 ? `${label.slice(0, 17)}…` : label;
});

const billingPresetId = computed(() => brainEp.value?.presetId ?? "local");
const billingModelLabel = computed(() => brainLabel.value || "未配置");

const sessionCostLabel = computed(() => {
  const c = sessionBilling.value?.costCnyMicros ?? 0;
  if (!c) return "";
  return formatCnyShort(c);
});

const modelShortLabel = computed(() => {
  const label = brainLabel.value || "";
  if (!label) return "";
  return label.length > 8 ? `${label.slice(0, 7)}…` : label;
});

async function refreshSessionBilling() {
  const sid = activeSessionId.value;
  if (!sid) {
    sessionBilling.value = null;
    sessionBillingRoundsList.value = [];
    return;
  }
  try {
    sessionBilling.value = await sessionBillingSummary(sid);
    sessionBillingRoundsList.value = await sessionBillingRounds(sid);
  } catch {
    sessionBilling.value = null;
    sessionBillingRoundsList.value = [];
  }
}

async function refreshContextUsage() {
  const sid = activeSessionId.value;
  if (!sid) {
    contextUsage.value = null;
    return;
  }
  try {
    let stat = await sessionContextUsage(sid);
    const billing =
      sessionBilling.value ??
      (await sessionBillingSummary(sid).catch(() => null));
    const apiTokens =
      (billing?.promptTokens ?? 0) + (billing?.completionTokens ?? 0);
    if (apiTokens > 0 && (stat.used ?? 0) === 0) {
      const max = stat.max ?? 200_000;
      stat = {
        used: apiTokens,
        max,
        pct: Math.min(100, Math.round((apiTokens / max) * 100)),
        breakdown: {
          systemPrompt: 0,
          tools: 0,
          messages: apiTokens,
          connectorsMcp: 0,
          skills: 0,
        },
      };
    }
    contextUsage.value = stat;
  } catch (e) {
    console.warn("refreshContextUsage", e);
    contextUsage.value = { used: 0, max: 200_000, pct: 0 };
  }
}

async function refreshTokenQuota() {
  try {
    const st = await tokenPackageStatus();
    tokenHardHit.value = !!st.hardHit;
  } catch {
    tokenHardHit.value = false;
  }
}

async function refreshSessionStats() {
  await refreshSessionBilling();
  await refreshContextUsage();
  await refreshTokenQuota();
}

const planWriteWarning = computed(
  () => chatMode.value === "plan" && isWriteFileIntent(draft.value),
);

const activeQueuedMessages = computed(() =>
  activeSessionId.value ? queuedBySession.value[activeSessionId.value] ?? [] : [],
);

const changedFilesThisTurn = computed(() =>
  activeSessionId.value ? changedFilesBySession.value[activeSessionId.value] ?? [] : [],
);

const homePreviewVisible = computed(
  () => props.homeMode && homeMdPaths.value.length > 0,
);

function trackHomeMd(path: string) {
  if (!props.homeMode || !/\.md$/i.test(path)) return;
  if (!homeMdPaths.value.includes(path)) {
    homeMdPaths.value = [...homeMdPaths.value, path];
  }
  homeMdActive.value = path;
  openFile(path, { preview: false });
}

watch(changedFilesThisTurn, (files) => {
  if (!props.homeMode) return;
  for (const f of files) trackHomeMd(f.path);
});

const sidebarQueueCounts = computed(() => {
  const counts: Record<string, number> = {};
  for (const [sid, list] of Object.entries(queuedBySession.value)) {
    if (list.length > 0) counts[sid] = list.length;
  }
  return counts;
});

const sidebarBadges = computed(() => {
  const badges: Record<string, "running" | "queued" | "done"> = {};
  for (const sid of streamingSessions.value) {
    badges[sid] = "running";
  }
  for (const sid of Object.keys(queuedBySession.value)) {
    const n = queuedBySession.value[sid]?.length ?? 0;
    if (n > 0 && badges[sid] !== "running") {
      badges[sid] = "queued";
    }
  }
  return badges;
});


const activeSession = computed(() =>
  sessions.value.find((s) => s.id === activeSessionId.value) ?? null,
);
const messages = computed(() =>
  activeSessionId.value ? sessionMessages.value[activeSessionId.value] ?? [] : [],
);
const streaming = computed(() =>
  activeSessionId.value ? streamingSessions.value.has(activeSessionId.value) : false,
);
const activeError = computed(() => {
  const sid = activeSessionId.value;
  if (!sid) return null;
  const msg = (sessionErrors.value[sid] ?? "").trim();
  return msg || null;
});

function dismissActiveError() {
  const sid = activeSessionId.value;
  if (!sid) return;
  sessionErrors.value = { ...sessionErrors.value, [sid]: "" };
}

type ChatHistoryRow = {
  id: string;
  role: string;
  content: string;
  createdAt: number;
  attachments?: ChatAttachment[];
};

async function fouHistoryToMessages(
  rows: ChatHistoryRow[],
): Promise<Message[]> {
  return Promise.all(rows
    .filter((r) => r.role === "user" || r.role === "assistant")
    .map(async (r) => {
      const attachments = await Promise.all(
        (r.attachments ?? []).map(async (attachment) => {
          if (attachment.kind !== "image") return attachment;
          try {
            const previewDataUrl = await invoke<string>("xu_read_chat_attachment_preview", {
              id: attachment.id,
            });
            return { ...attachment, previewDataUrl };
          } catch {
            return attachment;
          }
        }),
      );
      return {
        id: r.id,
        role: r.role as "user" | "assistant",
        blocks: [
          ...attachments.map((attachment) => ({
            type: "attachment" as const,
            attachment,
          })),
          {
            type: "text" as const,
            content:
              r.role === "user" && attachments.length
                ? r.content.split(/\n\n\[附件来源:/, 1)[0]?.trim() ||
                  `[附件: ${attachments.map((item) => item.filename).join("、")}]`
                : r.content,
          },
        ],
        timestamp: new Date(r.createdAt).toISOString(),
        status: "done" as const,
      };
    }));
}

async function loadSessions() {
  try {
    sessions.value = await invoke<Session[]>("xu_list_chat_sessions");
  } catch (e) {
    sessionErrors.value = { ...sessionErrors.value, global: toUserError(e) };
  }
}

function handleNewSession() {
  activeSessionId.value = null;
  chatBriefProjectId.value = null;
  closeSessionScopedDialogs();
}

function openNewProject() {
  showProjectForm.value = true;
}

async function onHomeProjectSaved(project: XuProject) {
  showProjectForm.value = false;
  await promptRunProjectAfterSave(project, router);
}

/** Duty: 切任务时关掉易串台弹窗，避免补充需求仍挂在上一项目。 */
function closeSessionScopedDialogs() {
  clarifyDialogVisible.value = false;
  clarifyQuestions.value = [];
  clarifyBoundProjectId.value = null;
  clarifyBoundSessionId.value = null;
  startConfirmVisible.value = false;
  designConfirmVisible.value = false;
  choiceDialogVisible.value = false;
}

/** Duty: 按会话 map 重绑 Brief/工作目录；无绑定则清空项目指针，避免沿用上一任务。 */
async function rebindBriefForSession(sessionId: string | null) {
  closeSessionScopedDialogs();
  if (!sessionId) {
    chatBriefProjectId.value = null;
    return;
  }
  const bound = getSessionProjectId(sessionId);
  if (!bound) {
    chatBriefProjectId.value = null;
    if (!props.managedByParent) {
      workingDir.value = null;
      try {
        localStorage.removeItem("xu.chat.workingDir");
      } catch {
        /* ignore */
      }
    }
    return;
  }
  chatBriefProjectId.value = bound;
  try {
    const { loadProjects } = await import("../utils/projects");
    const proj = (await loadProjects()).find((p) => p.id === bound);
    if (proj?.generatePath && !props.managedByParent) {
      workingDir.value = proj.generatePath;
      try {
        localStorage.setItem("xu.chat.workingDir", proj.generatePath);
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
}

watch(
  chatBriefProjectId,
  () => {
    void refreshBriefCta();
  },
  { immediate: true },
);

async function handleSelectSession(id: string) {
  activeSessionId.value = id;
  await rebindBriefForSession(id);
  pruneEmptyStreamingAssistants(id);
  if ((sessionMessages.value[id]?.length ?? 0) > 0) {
    void refreshSessionStats();
    return;
  }
  try {
    const rows = await invoke<ChatHistoryRow[]>("xu_get_chat_history", {
      sessionId: id,
      limit: 200,
    });
    sessionMessages.value = {
      ...sessionMessages.value,
      [id]: await fouHistoryToMessages(rows),
    };
    pruneEmptyStreamingAssistants(id);
    void refreshSessionStats();
  } catch (e) {
    sessionErrors.value = { ...sessionErrors.value, [id]: toUserError(e) };
  }
}

async function handleDeleteSession(id: string) {
  try {
    await invoke("xu_delete_chat_session", { sessionId: id });
    if (activeSessionId.value === id) handleNewSession();
    const nextMsgs = { ...sessionMessages.value };
    delete nextMsgs[id];
    sessionMessages.value = nextMsgs;
    await loadSessions();
  } catch (e) {
    sessionErrors.value = { ...sessionErrors.value, global: toUserError(e) };
  }
}

async function handleRenameSession(title: string): Promise<boolean> {
  if (!activeSessionId.value) return false;
  const nextTitle = title.trim();
  if (!nextTitle) return false;
  try {
    await invoke("xu_rename_chat_session", {
      sessionId: activeSessionId.value,
      title: nextTitle,
    });
    await loadSessions();
    return true;
  } catch (e) {
    sessionErrors.value = {
      ...sessionErrors.value,
      [activeSessionId.value]: toUserError(e),
    };
    return false;
  }
}

function patchStreaming(id: string, on: boolean) {
  const next = new Set(streamingSessions.value);
  if (on) next.add(id);
  else next.delete(id);
  streamingSessions.value = next;
}

function createRunId(): string {
  return globalThis.crypto?.randomUUID?.() ??
    `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function isActiveRun(sessionId: string, runId: string): boolean {
  return activeRunBySession.get(sessionId) === runId;
}

function pickThinkPhrase(): string {
  const pool = ["思考中···", "正在努力思考···", "别急，我正努力中"];
  return pool[Math.floor(Math.random() * pool.length)]!;
}

function trackChangedFilesFromMessage(sessionId: string) {
  const list = sessionMessages.value[sessionId] ?? [];
  const last = list[list.length - 1];
  if (!last || last.role !== "assistant") return;
  const prev = changedFilesBySession.value[sessionId] ?? [];
  const map = new Map(prev.map((f) => [f.path, f]));
  const nextDiffs = { ...fileDiffByPath.value };
  for (const b of last.blocks) {
    if (b.type !== "tool" || !b.outputDone || !isWritePatchTool(b.name)) continue;
    for (const ch of parseToolPatch(b.name, b.input)) {
      if (!ch.path) continue;
      const abs = resolveAbsPath(workingDir.value, ch.path);
      const key = abs.replace(/\\/g, "/").toLowerCase();
      map.set(ch.path, {
        path: ch.path,
        kind: ch.kind === "delete" ? "delete" : ch.kind === "add" ? "add" : "update",
        changes: [ch],
      });
      nextDiffs[key] = [ch];
      setIdeFileDiff(abs, [ch]);
      if (props.idePanel) {
        emitOpenInEditor({ path: abs });
      }
      if (sessionId === activeSessionId.value) {
        openFile(abs, { preview: false });
        editorViewTab.value = ch.lines.length ? "diff" : "edit";
        void nextTick(() => fileEditorRef.value?.reload?.());
      }
    }
  }
  fileDiffByPath.value = nextDiffs;
  changedFilesBySession.value = {
    ...changedFilesBySession.value,
    [sessionId]: [...map.values()],
  };
}

/** 语音全屏时节流消息列表写入，避免每 token 克隆拖死 WebView */
let voiceChunkFlushTimer: ReturnType<typeof setTimeout> | null = null;
let voiceChunkPending: { sessionId: string; chunk: StreamChunk } | null = null;

function flushVoiceChunkPending() {
  if (voiceChunkFlushTimer) {
    clearTimeout(voiceChunkFlushTimer);
    voiceChunkFlushTimer = null;
  }
  const pending = voiceChunkPending;
  voiceChunkPending = null;
  if (pending) applyAssistantChunk(pending.sessionId, pending.chunk);
}

function upsertAssistantChunk(sessionId: string, chunk: StreamChunk) {
  const coalesce =
    voiceDialogOpen.value &&
    (chunk.kind === "text" || chunk.kind === "token" || chunk.kind === "think");
  if (!coalesce) {
    flushVoiceChunkPending();
    applyAssistantChunk(sessionId, chunk);
    return;
  }
  if (voiceChunkPending && voiceChunkPending.sessionId === sessionId) {
    const prev = voiceChunkPending.chunk;
    if (
      (chunk.kind === "token" || chunk.kind === "text") &&
      (prev.kind === "token" || prev.kind === "text") &&
      chunk.content
    ) {
      if (chunk.kind === "text" && prev.kind === "text") {
        const a = prev.content || "";
        const b = chunk.content;
        voiceChunkPending = {
          sessionId,
          chunk: {
            ...chunk,
            content: b.startsWith(a) ? b : a.startsWith(b) ? a : a + b,
          },
        };
      } else {
        voiceChunkPending = {
          sessionId,
          chunk: {
            ...chunk,
            kind: "token",
            content: (prev.content || "") + (chunk.content || ""),
          },
        };
      }
    } else {
      applyAssistantChunk(sessionId, prev);
      voiceChunkPending = { sessionId, chunk };
    }
  } else {
    if (voiceChunkPending) applyAssistantChunk(voiceChunkPending.sessionId, voiceChunkPending.chunk);
    voiceChunkPending = { sessionId, chunk };
  }
  if (voiceChunkFlushTimer) return;
  voiceChunkFlushTimer = setTimeout(() => {
    voiceChunkFlushTimer = null;
    flushVoiceChunkPending();
  }, 120);
}

function applyAssistantChunk(sessionId: string, chunk: StreamChunk) {
  const list = [...(sessionMessages.value[sessionId] ?? [])];
  let last = list[list.length - 1];
  if (!last || last.role !== "assistant" || last.status === "done") {
    last = {
      id: `a_${Date.now()}`,
      role: "assistant",
      blocks: [],
      timestamp: new Date().toISOString(),
      status: "streaming",
      thinkPhrase: pickThinkPhrase(),
      thinkStartedAt: Date.now(),
    };
    list.push(last);
  }
  const blocks = [...last.blocks];
  const voiceCallTextChunk =
    Boolean(voiceSession?.active) &&
    voiceSessionId === sessionId &&
    (chunk.kind === "text" || chunk.kind === "token") &&
    Boolean(chunk.content);
  if (voiceCallTextChunk) {
    // 原始全文进 Map（供 TTS 解析）；气泡只写剥离后正文，避免流式露出 TTS_INSTRUCT
    mergeVoiceStreamRaw(sessionId, chunk);
    const display = stripLlmTtsInstruct(voiceStreamRawBySession.get(sessionId) || "");
    const lastBlock = blocks[blocks.length - 1];
    if (lastBlock?.type === "text") {
      blocks[blocks.length - 1] = { ...lastBlock, content: display };
    } else if (display) {
      blocks.push({ type: "text", content: display });
    }
  } else if (chunk.kind === "text" && chunk.content) {
    const lastBlock = blocks[blocks.length - 1];
    const raw = chunk.content;
    const incoming = stripTextChatStageDirections(raw);
    if (lastBlock?.type === "text") {
      const existing = lastBlock.content;
      let next = incoming;
      if (incoming === existing || raw === existing) {
        next = existing;
      } else if (incoming.startsWith(existing)) {
        next = incoming;
      } else if (existing.startsWith(incoming) && incoming) {
        next = existing;
      } else if (raw.startsWith(existing)) {
        next = stripTextChatStageDirections(raw);
      } else {
        next = stripTextChatStageDirections(existing + raw);
      }
      blocks[blocks.length - 1] = { ...lastBlock, content: next };
    } else if (incoming) {
      blocks.push({ type: "text", content: incoming });
    }
  } else if (chunk.kind === "token" && chunk.content) {
    const lastBlock = blocks[blocks.length - 1];
    if (lastBlock?.type === "text") {
      blocks[blocks.length - 1] = {
        ...lastBlock,
        content: stripTextChatStageDirections(lastBlock.content + chunk.content),
      };
    } else {
      const t = stripTextChatStageDirections(chunk.content);
      if (t) blocks.push({ type: "text", content: t });
    }
  } else if (chunk.kind === "status" && chunk.content) {
    last = { ...last, statusLine: chunk.content };
  } else if (chunk.kind === "ctx_stat" && chunk.content) {
    try {
      const stat = JSON.parse(chunk.content) as ContextUsage;
      if (sessionId === activeSessionId.value) {
        contextUsage.value = stat;
      }
    } catch {
      /* ignore */
    }
  } else if (chunk.kind === "think_start") {
    const hasThink = blocks.some((b) => b.type === "think");
    if (!hasThink) blocks.push({ type: "think", content: "" });
  } else if (chunk.kind === "think" && chunk.content) {
    const lastBlock = blocks[blocks.length - 1];
    if (lastBlock?.type === "think") {
      blocks[blocks.length - 1] = {
        ...lastBlock,
        content: lastBlock.content + chunk.content,
      };
    } else {
      blocks.push({ type: "think", content: chunk.content });
    }
  } else if (chunk.kind === "think_end") {
    last = { ...last, thinkEndedAt: Date.now() };
  } else if (chunk.kind === "tool_name" && chunk.content) {
    blocks.push({
      type: "tool",
      name: chunk.content,
      input: "",
      output: "",
      outputDone: false,
    });
  } else if (chunk.kind === "tool_input") {
    for (let i = blocks.length - 1; i >= 0; i--) {
      const b = blocks[i];
      if (b.type === "tool" && !b.outputDone) {
        blocks[i] = { ...b, input: (b.input || "") + chunk.content };
        break;
      }
    }
  } else if (chunk.kind === "tool_output") {
    for (let i = blocks.length - 1; i >= 0; i--) {
      const b = blocks[i];
      if (b.type === "tool" && !b.outputDone) {
        blocks[i] = { ...b, output: (b.output || "") + chunk.content };
        break;
      }
    }
  } else if (chunk.kind === "tool_output_end") {
    let finishedTool: { name: string; output: string } | null = null;
    for (let i = blocks.length - 1; i >= 0; i--) {
      const b = blocks[i];
      if (b.type === "tool" && !b.outputDone) {
        blocks[i] = { ...b, outputDone: true };
        finishedTool = { name: b.name || "", output: b.output || "" };
        break;
      }
    }
    trackChangedFilesFromMessage(sessionId);
    if (
      finishedTool &&
      /canvas_(write_sketch|add_strokes|update_stroke|delete_strokes|clear_sketch)/i.test(
        finishedTool.name,
      ) &&
      /(已写入草图|已追加草图|已更新草图|已删除草图|已清空草图)/.test(finishedTool.output) &&
      !/(写入失败|读取草图失败|缺少|JSON 无效|未找到图元|未授权|不可用)/.test(finishedTool.output)
    ) {
      const ws = workingDir.value?.trim();
      if (ws) emitCanvasSketchUpdated(ws);
    }
    if (
      finishedTool &&
      /canvas_(write_flow|clear_flow)/i.test(finishedTool.name) &&
      /(已写入流程图|已清空流程图)/.test(finishedTool.output) &&
      !/(写入失败|缺少|JSON 无效|未授权|不可用)/.test(finishedTool.output)
    ) {
      const ws = workingDir.value?.trim();
      if (ws) {
        const m = finishedTool.output.match(/flow[\\/]([^\\/\s]+)\.flow\.json/i);
        const name = m?.[1];
        emitCanvasFlowUpdated(ws, name);
      }
    }
  } else if (chunk.kind === "done") {
    last = {
      ...last,
      status: "done",
      blocks,
      statusLine: undefined,
      thinkEndedAt: last.thinkEndedAt ?? Date.now(),
    };
    list[list.length - 1] = last;
    sessionMessages.value = { ...sessionMessages.value, [sessionId]: list };
    return;
  } else if (chunk.kind === "error") {
    const errMsg = explainModelFailure(chunk.content || "流式错误", "模型调用失败");
    sessionErrors.value = {
      ...sessionErrors.value,
      [sessionId]: errMsg,
    };
    last = {
      ...last,
      status: "error",
      blocks,
      statusLine: undefined,
      thinkEndedAt: last.thinkEndedAt ?? Date.now(),
    };
    list[list.length - 1] = last;
    sessionMessages.value = { ...sessionMessages.value, [sessionId]: list };
    return;
  }
  last = { ...last, blocks, status: "streaming" };
  list[list.length - 1] = last;
  sessionMessages.value = { ...sessionMessages.value, [sessionId]: list };
}

/**
 * 接收输入组件发送并在“已入队或附件已绑定消息”后确认清空。
 * 依赖: sendMessage 持久化回调；所有前置失败和异常均确认 false，使草稿保留。
 */
function handleComposerSend(
  text: string,
  imageDataUrl?: string | null,
  extras?: { attachments?: ChatAttachment[]; imageDataUrls?: string[]; outputFormat?: string },
  confirm?: (accepted: boolean) => void,
) {
  if (tokenHardHit.value) {
    void fouAlert("已达 Token 套餐限额，请到设置 → 模型 → Token 套餐调高限额或清零后再试。", "Token 限额");
    confirm?.(false);
    return;
  }
  let accepted = false;
  const acknowledge = () => {
    if (accepted) return;
    accepted = true;
    confirm?.(true);
  };
  void sendMessage(text, imageDataUrl, extras, undefined, acknowledge).finally(() => {
    if (!accepted) confirm?.(false);
  });
}

async function sendMessage(
  text: string,
  imageDataUrl?: string | null,
  extras?: { attachments?: ChatAttachment[]; imageDataUrls?: string[]; outputFormat?: string },
  targetSessionId?: string | null,
  persistedOrQueued?: () => void,
) {
  const trimmed = text.trim();
  if (!trimmed && !imageDataUrl && !extras?.attachments?.length) return;
  let sessionTag = targetSessionId?.trim() || activeSessionId.value;

  const rememberBody = parseRememberCommand(trimmed);
  if (rememberBody) {
    try {
      let projectId: string | null = null;
      const ws = workingDir.value?.trim() || "";
      if (ws) {
        const { loadProjects } = await import("../utils/projects");
        const projects = await loadProjects();
        const norm = ws.replace(/\\/g, "/").toLowerCase();
        const matched = projects.find((p) => {
          const gp = (p.generatePath || "").replace(/\\/g, "/").toLowerCase();
          return gp && (norm === gp || norm.startsWith(`${gp}/`) || norm.startsWith(gp));
        });
        projectId = matched?.id ?? null;
      }
      const mem = await rememberUserNote({ body: rememberBody, projectId });
      fouMsg.success(`已记住：${mem.title}`);
    } catch (e) {
      void onApiCatch(e);
    }
    return;
  }

  // 用户大脑：实质提问写入问题大纲（本地永久，直到用户清理）
  void (async () => {
    try {
      let projectId: string | null = null;
      const ws = workingDir.value?.trim() || "";
      if (ws) {
        const { loadProjects } = await import("../utils/projects");
        const projects = await loadProjects();
        const norm = ws.replace(/\\/g, "/").toLowerCase();
        const matched = projects.find((p) => {
          const gp = (p.generatePath || "").replace(/\\/g, "/").toLowerCase();
          return gp && (norm === gp || norm.startsWith(`${gp}/`) || norm.startsWith(gp));
        });
        projectId = matched?.id ?? null;
      }
      await rememberQuestionOutline({
        userText: trimmed,
        sessionId: sessionTag,
        projectId,
      });
    } catch {
      /* 大纲失败不挡对话 */
    }
  })();

  const voiceFast = Boolean(voiceSession?.active && voiceSessionId === sessionTag);

  if (
    sessionTag &&
    (streamingSessions.value.has(sessionTag) ||
      activeRunBySession.has(sessionTag))
  ) {
    const sid = sessionTag;
    if (voiceFast) {
      if (activeRunBySession.has(sid) || streamingSessions.value.has(sid)) {
        await stopSessionStream(sid, { resumeVoice: false, discardPartial: true });
      }
      patchStreaming(sid, false);
      queuedBySession.value = { ...queuedBySession.value, [sid]: [] };
    } else {
      const next = [
        ...(queuedBySession.value[sid] ?? []),
        {
          id: `q_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          text: trimmed,
          imageDataUrl,
          extras,
        },
      ];
      queuedBySession.value = { ...queuedBySession.value, [sid]: next };
      fouMsg.info(`已排队（共 ${next.length} 条）`);
      persistedOrQueued?.();
      return;
    }
  }

  if (!sessionTag) {
    sessionTag = `xu_${Date.now().toString(36)}`;
    activeSessionId.value = sessionTag;
    sessions.value = [
      {
        id: sessionTag,
        title: (trimmed || extras?.attachments?.[0]?.filename || "截图对话").slice(0, 60),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      ...sessions.value,
    ];
  }
  const runId = createRunId();
  activeRunBySession.set(sessionTag, runId);
  patchStreaming(sessionTag, true);

  if (wantsFileTools(trimmed) && chatMode.value !== "ask") {
    let ok = false;
    try {
      ok = await ensureChatWorkspace({
        getWorkingDir: () => workingDir.value,
        setWorkingDir: (p) => {
          workingDir.value = p;
        },
        message: trimmed,
        pickWorkingDir,
        homeMode: props.homeMode,
        getProjectGeneratePath: getBoundProjectGeneratePath,
        onGuideProjectStart: guideHomeProjectStart,
        confirmAsk: voiceFast ? voiceUiConfirmAsk : undefined,
      });
    } catch (e) {
      if (isActiveRun(sessionTag, runId)) {
        activeRunBySession.delete(sessionTag);
        patchStreaming(sessionTag, false);
      }
      void onApiCatch(e);
      return;
    }
    if (!ok) {
      const { classifyLocalUserTurn } = await import("../intent/turnKind");
      const turn = classifyLocalUserTurn(trimmed);
      // 无项目/无工作区：提问与首页对话照常发；仅非首页且明确写盘时才硬拦
      const allowWithoutWorkspace =
        props.homeMode || turn === "question" || !isWriteFileIntent(trimmed);
      if (!allowWithoutWorkspace) {
        if (isActiveRun(sessionTag, runId)) {
          activeRunBySession.delete(sessionTag);
          patchStreaming(sessionTag, false);
        }
        void fouAlert("未选择工作目录，无法读写文件", "工作目录");
        return;
      }
      if (props.homeMode && isWriteFileIntent(trimmed)) {
        fouMsg.info("还没选定项目保存位置，本轮先回答；要改文件请先「开始项目」。");
      }
      // 放行：本轮无工作区 → 下方 useTools 自动关闭，纯对话
    }
  }

  if (voiceSession?.active) {
    voiceInterimText.value = "";
    // 保留队列中 forceFast 短确认，勿二次 cancel
    voiceSession.resetSpeakCursor({ preserveFast: true });
  }

  const formatHint =
    extras?.outputFormat === "minutes"
      ? "请按会议纪要格式输出（议题/决议/待办）。"
      : extras?.outputFormat === "proposal"
        ? "请按方案格式输出（背景/目标/步骤/风险）。"
        : extras?.outputFormat === "weekly"
          ? "请按周报格式输出（本周进展/风险/下周计划）。"
          : "";

  let contentForModel = trimmed || (imageDataUrl ? "请根据图片说明" : "请根据附件说明");
  let attachmentChars = 0;
  for (const item of extras?.attachments ?? []) {
    const source = `[附件来源: ${item.filename} | ${item.mime}]`;
    if (item.extractedText) {
      const remaining = Math.max(0, 48_000 - attachmentChars);
      const excerpt = item.extractedText.slice(0, remaining);
      attachmentChars += excerpt.length;
      contentForModel += `\n\n${source}\n${excerpt}`;
    } else {
      contentForModel += `\n\n${source}\n（${item.warning || "该二进制附件没有可安全注入的文本"}）`;
    }
  }
  if (formatHint) contentForModel += `\n\n${formatHint}`;

  const ws = workingDir.value?.trim() || "";
  let prefetched = "";
  const readTargets = resolveChatReadTargets(trimmed, {
    workspace: ws || null,
    previewPath: previewPath.value,
  });
  const shouldPrefetch = wantsFileTools(trimmed) || readTargets.length > 0;
  if (shouldPrefetch) {
    try {
      prefetched = await prefetchWithPermission(trimmed, {
        workspace: ws || null,
        previewPath: previewPath.value,
        confirmAsk: voiceFast ? voiceUiConfirmAsk : undefined,
      });
    } catch (e) {
      if (isActiveRun(sessionTag, runId)) {
        activeRunBySession.delete(sessionTag);
        patchStreaming(sessionTag, false);
      }
      void onApiCatch(e);
      return;
    }
    if (prefetched) {
      if (ws) rememberPathsFromMessage(ws, trimmed);
      if (!voiceFast) fouMsg.info("文件已预读，正在请求模型…");
    }
    if (prefetched) contentForModel += `\n\n${prefetched}`;
  }
  const writeIntent = isWriteFileIntent(trimmed);
  const skipToolsBecausePrefetch = Boolean(prefetched) && isReadOnlyFileIntent(trimmed) && !writeIntent;
  const targetFile = ws ? resolveTargetFilePath(ws, trimmed) : null;
  const appendLine = parseAppendLineIntent(trimmed);

  const userMsg: Message = {
    id: `u_${Date.now()}`,
    role: "user",
    blocks: [
      ...((extras?.attachments ?? []).map((attachment) => ({
        type: "attachment" as const,
        attachment,
      }))),
      ...(!extras?.attachments?.some((item) => item.kind === "image") && imageDataUrl
        ? [{ type: "image" as const, dataUrl: imageDataUrl, filename: "attachment.png" }]
        : []),
      {
        type: "text",
        content:
          trimmed ||
          (imageDataUrl
            ? "[图片]"
            : `[附件: ${(extras?.attachments ?? []).map((item) => item.filename).join("、")}]`),
      },
    ],
    timestamp: new Date().toISOString(),
    status: "done",
  };
  sessionMessages.value = {
    ...sessionMessages.value,
    [sessionTag]: [...(sessionMessages.value[sessionTag] ?? []), userMsg],
  };
  changedFilesBySession.value = { ...changedFilesBySession.value, [sessionTag]: [] };
  if (sessionTag === activeSessionId.value) {
    draft.value = "";
    editingUserMessage.value = false;
  }
  sessionErrors.value = { ...sessionErrors.value, [sessionTag]: "" };

  // Immediate assistant placeholder for WeChat thinking UI
  {
    const list = [...(sessionMessages.value[sessionTag] ?? [])];
    const asstId = `a_${Date.now()}`;
    if (voiceFast) {
      voiceStreamBubbleId = asstId;
      voiceStreamRawBySession.delete(sessionTag);
    }
    list.push({
      id: asstId,
      role: "assistant",
      blocks: [],
      timestamp: new Date().toISOString(),
      status: "streaming",
      thinkPhrase: pickThinkPhrase(),
      thinkStartedAt: Date.now(),
    });
    sessionMessages.value = { ...sessionMessages.value, [sessionTag]: list };
  }

  try {
    const visionImages = Array.from(
      new Set([...(extras?.imageDataUrls ?? []), ...(imageDataUrl ? [imageDataUrl] : [])]),
    );
    const hasImage = visionImages.length > 0;
    let savedImageRel: string | null = null;
    if (hasImage && imageDataUrl && ws) {
      try {
        savedImageRel = await saveChatImageToWorkspace(ws, imageDataUrl, "attachment.png");
      } catch (saveErr) {
        console.warn("saveChatImageToWorkspace", saveErr);
      }
    }
    // Vision pass: describe image with vision model, then merge into text for command brain
    if (hasImage && imageDataUrl) {
      const visionEp = await resolveEndpoint({ slot: "command", hasImage: true, chatContext: true });
      if (visionEp.model.trim() && visionEp.baseUrl.trim()) {
        fouMsg.info("正在识别图片…");
        try {
          const visionText = await invoke<string>("xu_agent_stream", {
            request: {
              sessionId: `${sessionTag}_vision`,
              runId: createRunId(),
              endpoint: {
                provider: visionEp.provider || "custom",
                model: visionEp.model,
                baseUrl: visionEp.baseUrl,
                apiKeyEnv: visionEp.apiKeyEnv,
                apiFormat: visionEp.apiFormat ?? "openai",
                presetId: visionEp.presetId ?? (visionEp.source === "local" ? "local" : visionEp.model),
              },
              messages: [
                {
                  role: "system",
                  content:
                    "你是视觉助手。详细描述图片中的文字、UI、表格与关键信息，用中文，便于后续文字模型回答用户。",
                  images: null,
                },
                {
                  role: "user",
                  content: trimmed || "请描述这张图片的内容与关键文字。",
                  images: visionImages,
                },
              ],
              workspaceRoot: null,
              enableTools: false,
            },
          });
          if (visionText?.trim() && !isVisionLikelyFailed(visionText)) {
            contentForModel += `\n\n—— 图片识别 ——\n${visionText.trim()}`;
          } else if (savedImageRel) {
            void fouAlert(
              "视觉模型未成功识图（可能未配置视觉模型或不支持图片）。已保存到工作区，将改用 view_image 读取。",
              "图片识别",
            );
            contentForModel += `\n\n—— 用户附图 ——\n图片已保存到工作区：${savedImageRel}\n请先调用 view_image 读取该路径，再根据图片内容回答用户。`;
          } else {
            void fouAlert(
              "图片识别失败：请在「设置 → 模型」配置支持识图的视觉模型，并选择工作目录后重试。",
              "图片识别",
            );
            contentForModel +=
              "\n\n（图片识别失败：未配置可用视觉模型，或未选择工作目录保存图片。请配置 visionModel 或选择工作区。）";
          }
        } catch (ve) {
          if (savedImageRel) {
            void fouAlert(
              `图片识别接口失败，已保存到工作区 ${savedImageRel}，将改用 view_image。`,
              "图片识别",
            );
            contentForModel += `\n\n—— 用户附图 ——\n图片已保存到工作区：${savedImageRel}\n请先调用 view_image 读取该路径，再根据图片内容回答用户。`;
          } else {
            contentForModel += `\n\n（图片识别失败：${String(ve)}；请配置视觉模型并选择工作目录）`;
            void fouAlert(String(ve), "图片识别");
          }
        }
      } else if (savedImageRel) {
        void fouAlert("未配置视觉模型，已保存图片到工作区，将改用 view_image 读取。", "图片识别");
        contentForModel += `\n\n—— 用户附图 ——\n图片已保存到工作区：${savedImageRel}\n请先调用 view_image 读取该路径，再根据图片内容回答用户。`;
      } else {
        contentForModel += "\n\n（未配置视觉模型，已跳过识图；请在三脑配置 visionModel 并选择工作目录）";
      }
    }

    const ep = await resolveEndpoint({
      slot: expertBrainSlot.value,
      hasImage: false,
      chatContext: true,
    });
    if (sessionTag === activeSessionId.value) brainEp.value = ep;
    if (!ep.model.trim() || !ep.baseUrl.trim()) {
      throw new Error("未配置可用模型：请在设置中配置并测通远程模型，或启用本地模型");
    }
    if (ep.fallbackFromRemote) {
      fouMsg.info(`远程未配置，已自动回退本地：${ep.displayName || ep.model}`);
    }

    await invoke("xu_ensure_chat_session", {
      payload: {
        id: sessionTag,
        title: (trimmed || "截图对话").slice(0, 60) || "新对话",
        employeeId: null,
        brainSlot: ep.brainSlot,
        model: ep.model,
      },
    });
    const attachmentIds = (extras?.attachments ?? []).map((item) => item.id);
    const userMessageId = attachmentIds.length
      ? await invoke<string>("xu_append_chat_message_with_attachments", {
        sessionId: sessionTag,
        role: "user",
        content: contentForModel,
        attachmentIds,
      })
      : await invoke<string>("xu_append_chat_message", {
        sessionId: sessionTag,
        role: "user",
        content: contentForModel,
      });
    persistedOrQueued?.();

    const prior = (sessionMessages.value[sessionTag] ?? [])
      .filter((m) => m.id !== userMsg.id)
      .filter((m) => m.status !== "error")
      .flatMap((m) => {
        const textBlock = m.blocks.find((b) => b.type === "text");
        if (!textBlock || textBlock.type !== "text") return [];
        const content = textBlock.content.trim();
        if (!content) return [];
        // 半截流式助手勿进 prior，避免多轮串题
        if (m.role === "assistant" && m.status === "streaming") return [];
        return [{ role: m.role, content: textBlock.content, images: null }];
      });

    const wsRoot = workingDir.value?.trim() || "";
    let chatProjectId: string | null = null;
    let chatToolPolicy: Record<string, boolean> | null = null;
    let matchedProject: import("../utils/projects").XuProject | null = null;
    if (wsRoot) {
      const { loadProjects } = await import("../utils/projects");
      const { findProjectByWorkingDir } = await import("../intent/ensureChatProject");
      const projects = await loadProjects();
      matchedProject = findProjectByWorkingDir(projects, wsRoot);
      if (matchedProject) {
        chatProjectId = matchedProject.id;
        setSessionProjectId(sessionTag, matchedProject.id);
        if (sessionTag === activeSessionId.value) chatBriefProjectId.value = matchedProject.id;
        chatToolPolicy = matchedProject.toolPolicy
          ? (
              await import("../utils/projectToolPolicy")
            ).projectToolPolicyFlags(matchedProject.toolPolicy)
          : null;
      }
    }

    /** 与办公室共用澄清闸门：仅产品立项 / 开工 / 确认需求时拦截；提问直答不弹窗 */
    let assistantText = "";
    let skippedAgentForClarify = false;
    {
      const {
        processClarifyGate,
        routeBossIntent,
        loadBrief,
        resolveWorkModeWithAssist,
        needsBriefCollection,
        classifyLocalUserTurn,
      } = await import("../intent");
      const { isProtectedProductAsk, buildProtectedProductRefusal } =
        await import("../utils/antiDistill");

      if (isProtectedProductAsk(trimmed)) {
        skippedAgentForClarify = true;
        appendLocalAssistant(sessionTag, buildProtectedProductRefusal(trimmed));
        assistantText = "";
        pruneEmptyStreamingAssistants(sessionTag);
      } else {
      const sessionBoundPid = getSessionProjectId(sessionTag);
      const briefProjectId =
        sessionBoundPid ||
        (sessionTag === activeSessionId.value ? chatBriefProjectId.value : null) ||
        matchedProject?.id ||
        null;
      let briefProbe = briefProjectId ? await loadBrief(briefProjectId) : null;
      const intent = routeBossIntent(trimmed, briefProbe);
      const turn = classifyLocalUserTurn(trimmed);
      const work = await resolveWorkModeWithAssist({
        text: trimmed,
        brief: briefProbe,
        project: matchedProject,
        projectId: briefProjectId || undefined,
      });
      const needGate =
        !voiceFast &&
        turn !== "question" &&
        work.mode !== "operation" &&
        work.mode !== "question" &&
        (needsBriefCollection(work) ||
          intent.kind === "confirm_brief" ||
          intent.kind === "clarify" ||
          intent.blockedKickoff ||
          intent.kind === "kickoff_ready" ||
          intent.kind === "force_all_kickoff");

      if (needGate) {
        const project = await resolveChatProjectForBrief(trimmed, sessionTag, work);
        if (!project) {
          skippedAgentForClarify = false;
        } else {
        matchedProject = project;
        chatProjectId = project.id;
        if (project.toolPolicy) {
          const { projectToolPolicyFlags } = await import("../utils/projectToolPolicy");
          chatToolPolicy = projectToolPolicyFlags(project.toolPolicy);
        }
        briefProbe = await loadBrief(project.id);
        const intent2 = routeBossIntent(trimmed, briefProbe);
        {
          const list = [...(sessionMessages.value[sessionTag] ?? [])];
          const last = list[list.length - 1];
          if (last?.role === "assistant") {
            list[list.length - 1] = {
              ...last,
              status: "streaming",
              statusLine: "正在确认需求…",
            };
            sessionMessages.value = { ...sessionMessages.value, [sessionTag]: list };
          }
        }
        const gate = await processClarifyGate({
          text: trimmed,
          project,
          streamSessionId: sessionTag,
          streamRunId: runId,
        });
        skippedAgentForClarify = true;
        assistantText = (gate.systemMessage || "").trim();
        if (
          !assistantText &&
          (intent2.kind === "kickoff_ready" || intent2.kind === "force_all_kickoff")
        ) {
          assistantText =
            "可以开始了。请在「开始项目」窗口里勾选岗位并确认保存位置。";
        }
        await afterBriefGate(project, gate, intent2.kind, sessionTag, trimmed);
        // afterBriefGate 已追加过 systemMessage 时避免重复写入下方 assistantText 路径
        if (gate.systemMessage?.trim()) {
          assistantText = "";
        }
        pruneEmptyStreamingAssistants(sessionTag);
        }
      }
      }
    }

    if (!skippedAgentForClarify) {
    const mem = "";
    const mode = chatMode.value;
    const {
      classifyLocalUserTurn,
      allowsImmediateWrite,
      turnKindSystemHint,
      isCanvasDrawIntent,
      isFakeCanvasPermissionGuide,
      isFakeExternalDrawGuide,
      FAKE_CANVAS_PERMISSION_REPLACE,
      FAKE_CANVAS_PERMISSION_RETRY_HINT,
      FAKE_EXTERNAL_DRAW_REPLACE,
    } = await import("../intent/turnKind");
    const {
      prepareCanvasDrawTurn,
      runLocalIfAny,
      healIfNeeded,
      canvasLayoutHintForKind,
      CANVAS_LLM_DRAW_HINT,
    } = await import("../canvas/drawRecipes");
    const priorUserTexts = (sessionMessages.value[sessionTag] ?? [])
      .filter((m) => m.role === "user")
      .map((m) =>
        m.blocks
          .filter((b) => b.type === "text")
          .map((b) => (b.type === "text" ? b.content : ""))
          .join("\n"),
      )
      .map((t) => t.trim())
      .filter((t) => t && t !== trimmed);
    const drawPlan = prepareCanvasDrawTurn(trimmed, priorUserTexts);
    const turnKind = classifyLocalUserTurn(trimmed);
    const canvasDraw = drawPlan.mode !== "none";
    const canvasLlmWrite = drawPlan.mode === "llm";
    const canvasChatWrite = canvasDraw || Boolean(props.canvasSideChat);
    const immediateWrite = allowsImmediateWrite(trimmed) || canvasDraw;
    let canWrite = mode === "agent" || mode === "multitask";
    if (turnKind === "question" && !canvasChatWrite) canWrite = false;
    if (turnKind === "requirement" && !immediateWrite) canWrite = false;
    if (canvasChatWrite) canWrite = true;
    let useTools =
      mode !== "ask" &&
      Boolean(wsRoot) &&
      (!skipToolsBecausePrefetch || writeIntent || voiceFast);
    if (voiceFast) {
      // 语音：有工作目录则允许工具；下方再统一覆盖 turnKind，避免 question 关工具
      useTools = Boolean(wsRoot) && mode !== "ask";
    } else if (mode === "plan" || mode === "debug") {
      useTools = Boolean(wsRoot);
    }
    if (!voiceFast && turnKind === "question" && !canvasChatWrite) {
      useTools = Boolean(wsRoot) && isReadOnlyFileIntent(trimmed) && mode !== "ask";
    } else if (!voiceFast && turnKind === "requirement" && !immediateWrite && mode !== "ask") {
      useTools = Boolean(wsRoot);
    }
    if (canvasChatWrite) {
      useTools = Boolean(wsRoot) && mode !== "ask";
    }
    let toolMode: "readonly" | "full" = "full";
    if (mode === "plan" || mode === "debug") {
      toolMode = "readonly";
    } else if (useTools && isReadOnlyFileIntent(trimmed) && !writeIntent && !canvasChatWrite) {
      toolMode = "readonly";
    }
    if (!voiceFast && turnKind === "question" && !canvasChatWrite) toolMode = "readonly";
    if (!voiceFast && turnKind === "requirement" && !immediateWrite && !canvasChatWrite) {
      toolMode = "readonly";
    }
    if (voiceFast && useTools) {
      // 通话与文字同权开工具；敏感意图未口头确认前强制只读
      if (looksLikeVoiceSensitiveOp(trimmed)) {
        toolMode = "readonly";
      } else if (isReadOnlyFileIntent(trimmed) && !writeIntent && !canvasChatWrite) {
        toolMode = "readonly";
      } else {
        toolMode = "full";
      }
    }
    // Canvas 侧对话或画板意图：必须 full，才能调用 canvas_write_sketch
    if (canvasChatWrite && mode !== "ask" && mode !== "plan" && mode !== "debug") {
      toolMode = "full";
      canWrite = true;
      useTools = Boolean(wsRoot);
    }
    if (voiceFast && toolMode === "full") {
      canWrite = mode === "agent" || mode === "multitask" || canvasChatWrite;
    }
    const modeHint =
      mode === "plan"
        ? "\n\n【计划模式】只读分析并输出计划/步骤，禁止 write_file/apply_patch/delete_file/shell 等写盘操作。"
        : mode === "ask"
          ? "\n\n【问询模式】纯问答，不要调用工具。"
          : mode === "debug"
            ? "\n\n【漏洞模式】系统性诊断 bug：先读日志/grep/复现，分析根因并给出修复方案；禁止擅自写盘或执行 shell，除非用户明确要求。"
            : mode === "multitask"
              ? "\n\n【多任务模式】可与其他会话并行执行；本回合专注当前任务，完成后自动处理排队消息。"
              : "";
    let systemContent = skipToolsBecausePrefetch
      ? buildChatPrefetchSystemPrompt(mem)
      : wsRoot && writeIntent && targetFile && canWrite
        ? buildChatWriteSystemPrompt(wsRoot, targetFile, mem)
        : wsRoot && useTools
          ? buildChatToolSystemPrompt(wsRoot, mem)
          : `${BRAND_ASSISTANT_INTRO}\n${buildUserAddressPromptLine()}${mem ? `\n\n${mem}` : ""}`;
    systemContent += modeHint;
    if (drawPlan.mode === "llm") {
      systemContent += `\n\n${CANVAS_LLM_DRAW_HINT}`;
      if (drawPlan.canHealRecipe) {
        systemContent += `\n\n${canvasLayoutHintForKind(drawPlan.kind)}`;
      }
    } else {
      const turnHint = turnKindSystemHint(trimmed);
      const skipCanvasHint = isCanvasDrawIntent(trimmed);
      if (turnHint && !skipCanvasHint) systemContent += `\n\n${turnHint}`;
    }
    if (props.canvasSideChat && wsRoot && drawPlan.mode === "llm") {
      systemContent +=
        "\n\n【Canvas 右侧对话】当前工作区即画板目录。用 canvas_add_strokes 等工具小步写入草图，禁止把用户原话整段写上图。";
    }
    const modelName = ep.displayName?.trim() || ep.model?.trim() || "未配置";
    const modelSrc = ep.source === "local" ? "本地" : "远程";
    systemContent += `\n\n【当前模型】${modelSrc} · ${modelName}（API：${ep.model}）。用户问「你是什么模型 / 用的什么 AI / 底层大模型」时，直接如实回答上述名称，不要含糊说「本地助手框架」或拒绝透露。`;
    const capHints = await buildAgentCapabilityHints();
    if (capHints) {
      systemContent += voiceFast
        ? `\n\n【能力摘要】${capHints.replace(/\s+/g, " ").trim().slice(0, 1800)}`
        : capHints;
    }
    const { buildTextChatStyleBlock, buildVoiceCallPersonaBlock, buildVoiceCallExecBlock } =
      await import("../utils/assistantOralPersona");
    if (voiceFast) {
      systemContent += buildVoiceCallPersonaBlock();
      systemContent += buildVoiceCallExecBlock();
      systemContent +=
        "\n\n【语音对话】关闭内部长考；口语化短句，先给结论，适合朗读；思考阶段无垫话。有工具时先做再简短回报。征求确认时必须说清「请说确认继续，或说取消」。";
      if (useTools && toolMode === "readonly" && looksLikeVoiceSensitiveOp(trimmed)) {
        systemContent +=
          "\n\n【语音敏感闸】本轮工具只读。先用口语说明风险并请用户说「确认」或「取消」；未确认禁止声称已写入/删除/外发。用户下句确认后才会开放写工具。";
      }
    } else {
      systemContent += buildTextChatStyleBlock();
    }
    const role = expertRole.value;
    if (role) {
      const fullPrompt = await ensureAgencyRolePrompt(role.id);
      const persona = buildAgencyShortPersona({ ...role, prompt: fullPrompt }, { task: trimmed });
      systemContent += voiceFast
        ? `\n\n【当前岗位】${persona.slice(0, 900)}`
        : `\n\n${persona}`;
    }
    let briefContext = "";
    if (chatProjectId && !voiceFast) {
      const { loadBrief } = await import("../intent");
      briefContext = JSON.stringify(await loadBrief(chatProjectId).catch(() => null));
    }
    let gitDiff = "";
    if (wsRoot && !voiceFast) {
      void indexWorkspaceContext(wsRoot).catch(() => undefined);
      gitDiff = await invoke<string>("git_workspace", {
        workspace: wsRoot,
        action: "diff",
        path: null,
        message: null,
        maxCount: null,
        remote: null,
        branch: null,
      }).catch(() => "");
    }
    const recentPrior = voiceFast ? prior.slice(-20) : prior;
    const userTurn: ContextMessage = { role: "user", content: contentForModel, images: null };
    let streamMessages: ContextMessage[];
    if (voiceFast) {
      // 语音快路径：跳过 assemble/git/索引，避免 WebView 卡在思考态未响应
      const voiceUser =
        contentForModel.startsWith("/no_think") || contentForModel.startsWith("/nothink")
          ? contentForModel
          : `/no_think ${contentForModel}`;
      streamMessages = [
        { role: "system", content: systemContent, images: null },
        ...recentPrior,
        { role: "user", content: voiceUser, images: null },
      ];
    } else {
      const assembled = await assembleAgentContext({
        sessionId: sessionTag,
        messages: [...prior, userTurn],
        systemRules: systemContent,
        brief: briefContext,
        workspaceRoot: wsRoot || null,
        projectId: chatProjectId,
        query: trimmed,
        ide: {
          openFiles: openFileTabs.value.map((tab) => tab.path),
          activeFile: previewPath.value,
          activeContent: previewPath.value ? editorFileContent.value : null,
          selection: null,
          cursorLine: null,
          cursorColumn: null,
          diagnostics: lintDiagnostics.value,
          gitDiff,
        },
      });
      streamMessages = assembled.messages;
    }
    // Canvas 侧：不注入 writeFiles:false 策略（None = 只读+画板工具），避免 write_file 拒绝诱发假权限指南
    const streamReq = {
      sessionId: sessionTag,
      runId,
      endpoint: {
        provider: ep.provider || "custom",
        model: ep.model,
        baseUrl: ep.baseUrl,
        apiKeyEnv: ep.apiKeyEnv,
        apiFormat: ep.apiFormat ?? "openai",
        presetId: ep.presetId ?? (ep.source === "local" ? "local" : ep.model),
      },
      messages: streamMessages,
      workspaceRoot: useTools ? wsRoot : null,
      enableTools: useTools,
      toolMode,
      requireWrite: useTools && canWrite && (writeIntent || canvasDraw),
      requireCanvasWrite: useTools && Boolean(wsRoot) && canvasLlmWrite,
      projectId: chatProjectId,
      projectToolPolicy: chatToolPolicy,
      memoryScope: voiceFast ? null : chatProjectId ? "project" : "global",
      memoryScopeId: voiceFast ? null : chatProjectId,
      memoryTaskHint: voiceFast ? null : trimmed,
      codeEditorSurface: readCodingSurfacePrefs().defaultSurface,
      maxTokens: voiceFast ? (useTools ? 4096 : 800) : null,
      disableThinking: voiceFast ? true : null,
      skipMemoryExtract: voiceFast ? true : null,
    };
    if (!isActiveRun(sessionTag, runId)) return;

    let localCanvasDrawn = false;
    let localCanvasSummary = "";
    const setStepUi = (label: string) => {
      const list = [...(sessionMessages.value[sessionTag] ?? [])];
      const last = list[list.length - 1];
      if (last?.role === "assistant") {
        list[list.length - 1] = {
          ...last,
          status: "streaming",
          statusLine: label,
          blocks: [
            ...last.blocks.filter((b) => b.type !== "text"),
            { type: "text" as const, content: label },
          ],
        };
        sessionMessages.value = { ...sessionMessages.value, [sessionTag]: list };
      }
    };
    // 主路径：模型工具画图；本机配方仅回合末失败/锚点丢失时 heal

    const streamPromise = invoke<string>("xu_agent_stream", { request: streamReq });
    if (voiceFast) {
      const voiceTimeoutMs = useTools ? 180_000 : 90_000;
      assistantText = await Promise.race([
        streamPromise,
        new Promise<string>((_, reject) => {
          window.setTimeout(
            () => reject(new Error("语音回复超时，请确认本地模型已启动且地址正确")),
            voiceTimeoutMs,
          );
        }),
      ]);
    } else {
      assistantText = await streamPromise;
    }
    if (!isActiveRun(sessionTag, runId)) return;

    // 小模型胡编假权限指南：替换文案并强制再跑一轮写画板（仅一次；配方已画则跳过）
    const wantCanvasRetry = canvasLlmWrite;
    if (
      !voiceFast &&
      !localCanvasDrawn &&
      wantCanvasRetry &&
      useTools &&
      wsRoot &&
      isFakeCanvasPermissionGuide(assistantText || "")
    ) {
      assistantText = FAKE_CANVAS_PERMISSION_REPLACE;
      {
        const list = [...(sessionMessages.value[sessionTag] ?? [])];
        const last = list[list.length - 1];
        if (last?.role === "assistant") {
          list[list.length - 1] = {
            ...last,
            blocks: [{ type: "text", content: FAKE_CANVAS_PERMISSION_REPLACE }],
            status: "streaming",
            statusLine: "正在直接写入画板…",
          };
          sessionMessages.value = { ...sessionMessages.value, [sessionTag]: list };
        }
      }
      try {
        const retryMessages = [
          ...streamMessages,
          {
            role: "assistant" as const,
            content: FAKE_CANVAS_PERMISSION_REPLACE,
            images: null as null,
          },
          {
            role: "user" as const,
            content: `${trimmed}\n\n${FAKE_CANVAS_PERMISSION_RETRY_HINT}`,
            images: null as null,
          },
        ];
        // prepend system nudge into first system message if present
        const withHint = retryMessages.map((m, i) => {
          if (i === 0 && m.role === "system") {
            return { ...m, content: `${m.content}\n\n${FAKE_CANVAS_PERMISSION_RETRY_HINT}` };
          }
          return m;
        });
        assistantText = await invoke<string>("xu_agent_stream", {
          request: {
            ...streamReq,
            messages: withHint,
            enableTools: true,
            toolMode: "full",
            requireWrite: true,
            requireCanvasWrite: true,
            runId: `${runId}_canvas_retry`,
          },
        });
        if (isFakeCanvasPermissionGuide(assistantText || "")) {
          assistantText =
            "本机 Canvas 已可用，无需在设置里开权限。请再说一次户型/草图需求（例如「画一个两室一厅」），我会直接写入画板。";
        }
      } catch {
        assistantText =
          "设置里没有 Canvas 权限开关。请再说一次要画的内容，我会直接写入本机画板。";
      }
      if (!isActiveRun(sessionTag, runId)) return;
    }

    // 画图题材：模型工具优先；失败或假教程时本机配方兜底 heal
    {
      const listProbe = sessionMessages.value[sessionTag] ?? [];
      const lastAsst = [...listProbe].reverse().find((m) => m.role === "assistant");
      const canvasMutateRe =
        /canvas_(write_sketch|add_strokes|update_stroke|delete_strokes|clear_sketch)/i;
      const toolSaidEmptyOrFail = lastAsst?.blocks.some(
        (b) =>
          b.type === "tool" &&
          canvasMutateRe.test(b.name || "") &&
          b.outputDone &&
          /(失败|缺少|不可用|未授权|JSON 无效|不能为空|0 个图元|未找到|未删除)/.test(b.output || ""),
      );
      const hadUsefulCanvasWrite = lastAsst?.blocks.some(
        (b) =>
          b.type === "tool" &&
          /canvas_(write_sketch|add_strokes|update_stroke)/i.test(b.name || "") &&
          b.outputDone &&
          /(已写入草图|已追加草图|已更新草图)/.test(b.output || "") &&
          !/(失败|缺少|不可用|未授权|JSON 无效|不能为空|未找到)/.test(b.output || ""),
      );
      const fakePerm = isFakeCanvasPermissionGuide(assistantText || "");
      const fakeExt = isFakeExternalDrawGuide(assistantText || "");
      let strokeCount = 0;
      if (!voiceFast && wsRoot && (canvasDraw || fakePerm || fakeExt)) {
        try {
          const { countSketchStrokes } = await import("../canvas/simpleFloorPlanBoard");
          strokeCount = await countSketchStrokes(wsRoot);
        } catch {
          strokeCount = 0;
        }
      }
      if (localCanvasDrawn && localCanvasSummary) {
        const t = (assistantText || "").trim();
        const usable =
          Boolean(t) &&
          !fakePerm &&
          !fakeExt &&
          t.length < 400 &&
          !/设置→工具权限|酷家乐|CAD|Photoshop|Figma/i.test(t);
        if (!usable) assistantText = localCanvasSummary;
      }
      const preferLocalFloor =
        !localCanvasDrawn &&
        !voiceFast &&
        Boolean(wsRoot) &&
        drawPlan.canHealRecipe &&
        (fakePerm ||
          fakeExt ||
          toolSaidEmptyOrFail ||
          (!hadUsefulCanvasWrite && strokeCount === 0));
      if (preferLocalFloor && wsRoot) {
        try {
          if (fakeExt) setStepUi(FAKE_EXTERNAL_DRAW_REPLACE);
          const ran = await runLocalIfAny({
            workspace: wsRoot,
            plan: drawPlan,
            onStep: async (step) => {
              setStepUi(step.label);
            },
          });
          if (ran) {
            assistantText = `${ran.summary}（${ran.count} 个图元）`;
            localCanvasDrawn = true;
            localCanvasSummary = assistantText;
          }
        } catch {
          if (fakePerm || fakeExt) {
            assistantText =
              "本机 Canvas 草图可用。请再说一次户型需求（如「109平4房2厅」），我会直接分步画在左侧。";
          }
        }
      }
      if (!voiceFast && wsRoot && drawPlan.canHealRecipe && !hadUsefulCanvasWrite && canvasDraw) {
        try {
          const healed = await healIfNeeded({
            workspace: wsRoot,
            plan: drawPlan,
            onStep: async (step) => {
              setStepUi(step.label);
            },
          });
          if (healed) {
            localCanvasDrawn = true;
            localCanvasSummary = `${healed.summary}（${healed.count} 个图元）`;
            assistantText = localCanvasSummary;
          }
        } catch {
          /* 保留当前文案 */
        }
      }
    }

    const listAfter = sessionMessages.value[sessionTag] ?? [];
    const lastAssistant = [...listAfter].reverse().find((m) => m.role === "assistant");
    const hadWriteTool = lastAssistant?.blocks.some(
      (b) =>
        b.type === "tool" &&
        /write_file|patch_file|apply_patch|delete_file|canvas_write_sketch|canvas_add_strokes|canvas_update_stroke|canvas_delete_strokes|canvas_clear_sketch|canvas_write_mermaid|canvas_write_flow|canvas_clear_flow/i.test(
          b.name,
        ),
    );
    if (
      !voiceFast &&
      wsRoot &&
      targetFile &&
      appendLine &&
      writeIntent &&
      canWrite &&
      !hadWriteTool &&
      !assistantText?.includes("✅ 本轮实际写入")
    ) {
      try {
        await invoke("append_text_line", { path: targetFile, line: appendLine });
        fouMsg.success(`模型未写盘，已自动追加到 ${toRelativePath(wsRoot, targetFile)}`);
      } catch (appendErr) {
        void fouAlert(
          sanitizeUserMessage(appendErr, "自动写入失败，请检查工作目录权限后重试"),
          "写入失败",
        );
      }
    }
    } // end !skippedAgentForClarify

    if (assistantText?.trim()) {
      const persistContent = voiceFast
        ? dedupeRepeatedText(stripLlmTtsInstruct(assistantText.trim()))
        : stripTextChatStageDirections(assistantText.trim());
      await invoke("xu_append_chat_message", {
        sessionId: sessionTag,
        role: "assistant",
        content: persistContent,
      });
      // Ensure UI has final text even if no xu:chunk arrived
      {
        const list = [...(sessionMessages.value[sessionTag] ?? [])];
        let last = list[list.length - 1];
        if (!last || last.role !== "assistant") {
          last = {
            id: `a_${Date.now()}`,
            role: "assistant",
            blocks: [{ type: "text", content: persistContent }],
            timestamp: new Date().toISOString(),
            status: "done",
            thinkPhrase: pickThinkPhrase(),
            thinkStartedAt: Date.now(),
            thinkEndedAt: Date.now(),
          };
          list.push(last);
        } else {
          const blocksWithoutText = last.blocks.filter((b) => b.type !== "text");
          const finalText = persistContent;
          list[list.length - 1] = {
            ...last,
            blocks: [
              ...blocksWithoutText,
              { type: "text" as const, content: finalText },
            ],
            status: "done",
            statusLine: undefined,
            thinkEndedAt: last.thinkEndedAt ?? Date.now(),
          };
        }
        sessionMessages.value = { ...sessionMessages.value, [sessionTag]: list };
      }
      if (sessionTag === activeSessionId.value || isVoiceBoundSession(sessionTag)) {
        maybeOpenClarifyFromText(persistContent);
      }
      if (voiceSession?.active && isVoiceBoundSession(sessionTag)) {
        // LLM 本轮结束：允许后续 TTS 结束后开麦
        voiceSession.notifyAgentIdle();
        if (assistantText.trim()) {
          voiceStreamRawBySession.set(sessionTag, assistantText.trim());
        }
        const raw = voiceStreamRawText(sessionTag);
        const { answerText, ttsInstruct } = parseLlmTtsInstruct(raw);
        persistLlmTtsInstructForEngine(ttsInstruct);
        stripVoiceStreamBubbleTtsInstruct(sessionTag, answerText);
        const spoken = upsertVoiceAssistantCaption(answerText);
        if (assistantAsksVoiceConfirm(answerText)) {
          voiceSensitiveHold = true;
        }
        if (voiceFlushedSpeakTurn === voiceSpeakTurn) {
          // stream-done 已念正文：只补澄清/选项后缀
          const clarify = pendingVoiceClarifyAsk.trim();
          pendingVoiceClarifyAsk = "";
          if (choiceDialogVisible.value && choiceOptions.value.length) {
            const numbered = choiceOptions.value
              .map((c, i) => `选项${i + 1}，${c}`)
              .join("。");
            voiceSession.speakCumulative(
              `${numbered}。请说编号，或者说都不是。`,
              { flush: true, turn: voiceSpeakTurn },
            );
          } else if (clarify) {
            voiceSession.speakCumulative(clarify, {
              flush: true,
              turn: voiceSpeakTurn,
            });
          }
        } else {
          const voiceAsk = buildVoiceAskPayload(raw, answerText);
          if (spoken || answerText || voiceAsk.trim()) {
            if (assistantAsksVoiceConfirm(voiceAsk)) {
              voiceSensitiveHold = true;
            }
            voiceFlushedSpeakTurn = voiceSpeakTurn;
            voiceSession.speakCumulative(voiceAsk, {
              flush: true,
              turn: voiceSpeakTurn,
            });
          } else {
            voiceSession.notifyAgentIdle({ resumeListen: true });
          }
        }
      }
    } else if (voiceSession?.active && isVoiceBoundSession(sessionTag)) {
      voiceSession.notifyAgentIdle();
      const raw = voiceStreamRawText(sessionTag);
      const { answerText, ttsInstruct } = parseLlmTtsInstruct(raw);
      persistLlmTtsInstructForEngine(ttsInstruct);
      stripVoiceStreamBubbleTtsInstruct(sessionTag, answerText);
      const spoken = upsertVoiceAssistantCaption(answerText);
      if (assistantAsksVoiceConfirm(answerText)) {
        voiceSensitiveHold = true;
      }
      if (voiceFlushedSpeakTurn === voiceSpeakTurn) {
        const clarify = pendingVoiceClarifyAsk.trim();
        pendingVoiceClarifyAsk = "";
        if (choiceDialogVisible.value && choiceOptions.value.length) {
          const numbered = choiceOptions.value
            .map((c, i) => `选项${i + 1}，${c}`)
            .join("。");
          voiceSession.speakCumulative(
            `${numbered}。请说编号，或者说都不是。`,
            { flush: true, turn: voiceSpeakTurn },
          );
        } else if (clarify) {
          voiceSession.speakCumulative(clarify, {
            flush: true,
            turn: voiceSpeakTurn,
          });
        }
      } else {
        const voiceAsk = buildVoiceAskPayload(raw, answerText);
        if (spoken || answerText || voiceAsk.trim()) {
          if (assistantAsksVoiceConfirm(voiceAsk)) {
            voiceSensitiveHold = true;
          }
          voiceFlushedSpeakTurn = voiceSpeakTurn;
          voiceSession.speakCumulative(voiceAsk, {
            flush: true,
            turn: voiceSpeakTurn,
          });
        } else {
          voiceSession.notifyAgentIdle({ resumeListen: true });
        }
      }
    }
    await loadSessions();
  } catch (e) {
    if (!isActiveRun(sessionTag, runId)) return;
    const message = explainModelFailure(e, "本轮对话失败，请稍后重试");
    sessionErrors.value = { ...sessionErrors.value, [sessionTag]: message };
    void fouAlert(message, "模型调用失败");
    if (voiceSession?.active) {
      void stopSessionStream(sessionTag, { resumeVoice: false, discardPartial: true });
      voiceSession.markError();
    }
  } finally {
    if (!isActiveRun(sessionTag, runId)) {
      pruneEmptyStreamingAssistants(sessionTag);
      return;
    }
    activeRunBySession.delete(sessionTag);
    patchStreaming(sessionTag, false);
    if (sessionTag === activeSessionId.value) void refreshContextUsage();
    // 先清掉被澄清/本地回复挤在后面的空「思考中」占位
    pruneEmptyStreamingAssistants(sessionTag);
    const list = sessionMessages.value[sessionTag] ?? [];
    const last = list[list.length - 1];
    if (last?.role === "assistant" && last.status === "streaming") {
      sessionMessages.value = {
        ...sessionMessages.value,
        [sessionTag]: [
          ...list.slice(0, -1),
          { ...last, status: "done", statusLine: undefined, thinkEndedAt: last.thinkEndedAt ?? Date.now() },
        ],
      };
    }
    pruneEmptyStreamingAssistants(sessionTag);
    const finalList = sessionMessages.value[sessionTag] ?? [];
    const finalLast = finalList[finalList.length - 1];
    if (
      finalLast?.role === "assistant" &&
      finalLast.status === "done" &&
      !finalLast.blocks.some((b) => b.type === "text" && b.content.trim()) &&
      !sessionErrors.value[sessionTag]?.trim()
    ) {
      const emptyMsg =
        "本轮模型没有返回正文（0 字）。常见原因：网络中断、API 欠费/限流、模型名错误，或上游只返回了思考未给答案。请到设置 → 模型点「测通」，或换一个模型重试。";
      sessionErrors.value = {
        ...sessionErrors.value,
        [sessionTag]: emptyMsg,
      };
      void fouAlert(emptyMsg, "模型无回复");
    } else if (
      finalLast?.role === "assistant" &&
      finalLast.status === "done" &&
      sessionTag === activeSessionId.value
    ) {
      const content = collectAssistantText(finalLast);
      // try 里已弹过则 visible 已是 true；此处兜底（仅流式、无 invoke 返回正文的情况）
      if (content.trim() && !clarifyDialogVisible.value) {
        maybeOpenClarifyFromText(content);
      }
    }
    const consumed = takeSessionQueuedSend(queuedBySession.value, sessionTag);
    queuedBySession.value = consumed.queues;
    if (consumed.item) {
      const queued = consumed.item;
      void sendMessage(queued.text, queued.imageDataUrl, queued.extras, sessionTag);
    }
  }
}

async function stopSessionStream(
  sessionId: string,
  opts?: { resumeVoice?: boolean; discardPartial?: boolean },
) {
  const runId = activeRunBySession.get(sessionId);
  activeRunBySession.delete(sessionId);
  try {
    await invoke("xu_agent_cancel", { sessionId, runId });
  } catch {
    /* ignore */
  }
  if (activeRunBySession.has(sessionId)) return;
  patchStreaming(sessionId, false);
  const list = [...(sessionMessages.value[sessionId] ?? [])];
  const last = list[list.length - 1];
  if (last?.role === "assistant" && last.status === "streaming") {
    if (opts?.discardPartial) {
      list[list.length - 1] = {
        ...last,
        status: "error",
        thinkEndedAt: last.thinkEndedAt ?? Date.now(),
      };
    } else {
      list[list.length - 1] = {
        ...last,
        status: "done",
        thinkEndedAt: last.thinkEndedAt ?? Date.now(),
      };
    }
    sessionMessages.value = { ...sessionMessages.value, [sessionId]: list };
  }
  if (opts?.discardPartial && voiceStreamBubbleId) {
    voiceStreamBubbleId = null;
  }
  if (
    opts?.resumeVoice !== false &&
    sessionId === activeSessionId.value &&
    voiceSession?.active
  ) {
    voiceSession.resumeListenSoon();
  }
}

async function stopStream() {
  if (!activeSessionId.value) return;
  await stopSessionStream(activeSessionId.value);
}

function plainTextOf(m: Message): string {
  return m.blocks
    .filter((b) => b.type === "text" || b.type === "think")
    .map((b) => (b.type === "text" || b.type === "think" ? b.content : ""))
    .join("\n");
}

async function copyMessage(id: string) {
  const list = activeSessionId.value ? sessionMessages.value[activeSessionId.value] ?? [] : [];
  const m = list.find((x) => x.id === id);
  if (!m) return;
  const text = plainTextOf(m).trim() || "(空消息)";
  try {
    await writeClipboardText(text);
    fouMsg.success("已复制");
  } catch {
    void fouAlert("复制失败", "提示");
  }
}

async function copySession() {
  const list = activeSessionId.value ? sessionMessages.value[activeSessionId.value] ?? [] : [];
  const lines = list.map((m) => {
    const who = m.role === "user" ? "你" : assistantName.value;
    return `${who}:\n${plainTextOf(m).trim()}`;
  });
  try {
    await writeClipboardText(lines.join("\n\n"));
    fouMsg.success("已复制本会话");
  } catch {
    void fouAlert("复制失败", "提示");
  }
}

function deleteMessage(id: string) {
  const sid = activeSessionId.value;
  if (!sid) return;
  const list = [...(sessionMessages.value[sid] ?? [])];
  const idx = list.findIndex((m) => m.id === id);
  if (idx < 0) return;
  const victim = list[idx];
  list.splice(idx, 1);
  // If deleting user message, also drop following assistant if contiguous
  if (victim.role === "user" && list[idx]?.role === "assistant") {
    list.splice(idx, 1);
  }
  sessionMessages.value = { ...sessionMessages.value, [sid]: list };
}

async function editMessage(id: string) {
  const sid = activeSessionId.value;
  if (!sid) return;
  if (streamingSessions.value.has(sid)) {
    await stopStream();
  }
  const list = [...(sessionMessages.value[sid] ?? [])];
  const idx = list.findIndex((m) => m.id === id);
  if (idx < 0) return;
  const m = list[idx];
  if (m.role !== "user") return;
  const text = m.blocks
    .filter((b) => b.type === "text")
    .map((b) => (b.type === "text" ? b.content : ""))
    .join("");
  draft.value = text;
  editingUserMessage.value = true;
  sessionMessages.value = { ...sessionMessages.value, [sid]: list.slice(0, idx) };
}

/** 打开全屏通话层（语音通话按钮 / 全局唤醒）。 */
function openVoiceAssistantOverlay() {
  if (voiceSession?.active) return;
  const hasDom =
    typeof document !== "undefined" &&
    Boolean(document.querySelector(".voice-assistant-overlay"));
  // 假 true（状态开了但 DOM 被清掉）时强制重建，避免吞掉唤醒事件
  if (voiceDialogOpen.value && hasDom) return;
  if (voiceDialogOpen.value && !hasDom) {
    voiceDialogOpen.value = false;
  }
  stopVoiceWake();
  clearStuckUiBlockers();
  setVoiceAssistantOverlayOpen(true);
  voiceDialogOpen.value = true;
  const vs = loadVoiceSettings();
  pendingWakeConfirmSpeak = vs.wakeConfirmSpeak !== false;
  // Cosy 默认：等会话就绪后用 Cosy 说「在呢」；系统/离线仍用本机短确认抢首响
  if (pendingWakeConfirmSpeak && vs.provider !== "cosyvoice") {
    window.setTimeout(() => speakWakeConfirm("在呢"), 280);
  }
}

async function toggleVoiceCall() {
  if (
    voiceSession?.active ||
    (voiceDialogOpen.value &&
      typeof document !== "undefined" &&
      document.querySelector(".voice-assistant-overlay"))
  ) {
    await hangupVoiceCall();
    return;
  }
  openVoiceAssistantOverlay();
}

function onOpenVoiceAssistantEvent(event?: Event) {
  openVoiceAssistantOverlay();
  const requestId =
    event instanceof CustomEvent ? String(event.detail?.requestId || "") : "";
  acknowledgeVoiceAssistantVisible(requestId || undefined);
}

function onForceHangupVoice() {
  void hangupVoiceCall({ skipSummary: true });
  voiceDialogOpen.value = false;
  setVoiceAssistantOverlayOpen(false);
  document.body.style.overflow = "";
  clearStuckUiBlockers();
  dispatchVoiceWakeRefresh();
}

function onVoiceDialogVisible(v: boolean) {
  voiceDialogOpen.value = v;
  setVoiceAssistantOverlayOpen(v);
  if (!v && (voiceSession?.active || voiceCaptions.value.length)) {
    void hangupVoiceCall();
  }
  if (!v) {
    dispatchVoiceWakeRefresh();
  }
}

async function onVoiceAssistantReady() {
  if (voiceSession?.active || voiceHangupLock) return;
  await startVoiceCallSession();
}

async function startVoiceCallSession() {
  if (voiceSession?.active) return;
  stopVoiceWake();
  if (!speechRecognitionAvailable()) {
    const msg =
      "当前窗口不支持语音识别（Web Speech）。请授权麦克风后重试，或改用文字对话 /「语音输入」。";
    sessionErrors.value = {
      ...sessionErrors.value,
      [activeSessionId.value || "_voice"]: msg,
    };
    void fouAlert(msg, "提示");
    // 保留通话层，用户可挂断；勿自动拆层以免「唤醒闪一下没了」
    voicePhase.value = "error";
    return;
  }
  let capturedSessionId = activeSessionId.value;
  if (!capturedSessionId) {
    capturedSessionId = `xu_${Date.now().toString(36)}`;
    activeSessionId.value = capturedSessionId;
    sessions.value = [
      {
        id: capturedSessionId,
        title: "语音通话",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      ...sessions.value,
    ];
  }
  voiceSessionId = capturedSessionId;
  const session = new VoiceCallSession({
    onPhase: (p) => {
      voicePhase.value = p;
      voiceActive.value = p !== "idle";
      if (p === "listening") voiceInterimText.value = "";
      if (p === "thinking") voiceInterimText.value = "";
    },
    onInterim: (text) => {
      voiceInterimText.value = text;
    },
    onUtterance: (text) => {
      voiceInterimText.value = "";
      voiceSpeakTurn += 1;
      voiceSession?.setSpeakTurn(voiceSpeakTurn);
      if (tryResolveVoiceConfirm(text)) {
        return;
      }
      if (tryVoiceResolveChoice(text)) {
        voiceSession?.resumeListenSoon(300);
        return;
      }
      if (voiceSensitiveHold) {
        const d = matchVoiceConfirmUtterance(text);
        if (d === "confirm") {
          voiceSensitiveHold = false;
          const rest = text.trim();
          text =
            rest.length <= 6 || matchVoiceConfirmUtterance(rest) === "confirm"
              ? `${VOICE_USER_CONFIRMED_PREFIX}请继续刚才待确认的操作。`
              : `${VOICE_USER_CONFIRMED_PREFIX}${rest}`;
        } else if (d === "cancel") {
          voiceSensitiveHold = false;
          voiceCaptions.value = [...voiceCaptions.value, { role: "user", text }];
          voiceSession?.speakConfirm("好的，已取消，不会继续执行。");
          voiceCaptions.value = [
            ...voiceCaptions.value,
            { role: "assistant", text: "好的，已取消，不会继续执行。" },
          ];
          return;
        } else {
          voiceSession?.speakConfirm("这件事还需要你确认。请说确认继续，或说取消。");
          return;
        }
      }
      const cmd = parseVoiceCommand(text);
      if (cmd) {
        voiceCaptions.value = [...voiceCaptions.value, { role: "user", text }];
        void applyVoiceCommand(cmd)
          .then(() => {
            voiceSession?.clearTtsCache();
            voiceSession?.resetSpeakCursor();
            voiceSession?.speakConfirm(cmd.confirm);
            voiceCaptions.value = [
              ...voiceCaptions.value,
              { role: "assistant", text: cmd.confirm },
            ];
          })
          .catch(() => {
            voiceSession?.resumeListenSoon(300);
          });
        return;
      }
      voiceCaptions.value = [...voiceCaptions.value, { role: "user", text }];
      void (async () => {
        const sid = capturedSessionId;
        if (
          sid &&
          (streamingSessions.value.has(sid) || activeRunBySession.has(sid))
        ) {
          await stopSessionStream(sid, { resumeVoice: false, discardPartial: true });
        }
        voiceSession?.resetSpeakCursor();
        voiceSession?.setSpeakTurn(voiceSpeakTurn);
        voiceSession?.markThinking();
        try {
          await sendMessage(text, null, undefined, capturedSessionId);
        } catch (e) {
          void onApiCatch(e);
          voiceSession?.markError();
        } finally {
          // 早退/无正文：清 awaiting；若仍在播助手 TTS 则不会开麦
          voiceSession?.notifyAgentIdle({ resumeListen: true });
        }
      })();
    },
    onBargeIn: () => {
      voiceInterimText.value = "";
      const sid = capturedSessionId;
      if (sid) void stopSessionStream(sid, { resumeVoice: false, discardPartial: true });
    },
    onError: (msg) => {
      sessionErrors.value = {
        ...sessionErrors.value,
        [capturedSessionId]: msg,
      };
      void fouAlert(msg, "提示");
      if (voiceSession?.active) {
        voiceSession.markError({
          resumeMs: /已自动结束|不支持语音识别/.test(msg) ? 0 : 2800,
        });
      }
      if (/已自动结束/.test(msg) || !voiceSession?.active) {
        void hangupVoiceCall({ skipSummary: true });
      }
    },
    onNotice: (msg) => {
      void fouAlert(msg, "提示");
    },
  });
  voiceSession = session;
  // 离线 Kokoro / Cosy FastAPI：进通话即预热，关掉「优先实时」时首句更快开口
  {
    const vs = loadVoiceSettings();
    if (vs.provider === "sherpa-onnx" && vs.callPreferRealtime === false) {
      const voice = resolveKokoroVoiceId(vs.voice || vs.toneId || "zf_xiaoxiao");
      void warmupKokoro(voice).catch(() => {
        /* 预热失败不挡通话 */
      });
    }
    if (vs.provider === "cosyvoice" && vs.cosyBackend === "fastapi" && vs.cosyFastapiBaseUrl?.trim()) {
      void warmCosyFastapiQuiet();
    }
  }
  // 唤醒刚释放麦，OS 可能短暂占用：失败保留层并重试
  let ok = false;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => window.setTimeout(r, 400));
      if (!voiceDialogOpen.value || voiceHangupLock) return;
    }
    ok = await session.start();
    if (ok) break;
  }
  if (!ok) {
    pendingWakeConfirmSpeak = false;
    voiceSession = null;
    voiceSessionId = null;
    voiceActive.value = false;
    voicePhase.value = "error";
    void fouAlert(
      "麦克风暂时被占用或未授权。请保留通话画面稍候，点挂断后重试，或再对唤醒词说一次。",
      "语音通话",
    );
    // 保留 voiceDialogOpen / overlay，勿自动拆层
    return;
  }
  if (pendingWakeConfirmSpeak) {
    pendingWakeConfirmSpeak = false;
    session.markWakeGreeting("在呢");
    if (loadVoiceSettings().provider === "cosyvoice") {
      session.speakConfirm("在呢");
    }
  }
  voiceActive.value = true;
}

async function hangupVoiceCall(opts?: { skipSummary?: boolean }) {
  if (voiceHangupLock) return;
  voiceHangupLock = true;
  const log = [...voiceCaptions.value];
  const capturedSessionId = voiceSessionId;
  const shouldSummarize = !opts?.skipSummary && log.length > 0;
  voiceSession?.stop();
  voiceSession = null;
  voiceSessionId = null;
  voiceSpeakTurn = 0;
  voiceFlushedSpeakTurn = -1;
  voiceSensitiveHold = false;
  pendingVoiceClarifyAsk = "";
  clearVoiceConfirmPending();
  voiceStreamBubbleId = null;
  if (capturedSessionId) voiceStreamRawBySession.delete(capturedSessionId);
  else voiceStreamRawBySession.clear();
  if (voiceCaptionFlushTimer) {
    clearTimeout(voiceCaptionFlushTimer);
    voiceCaptionFlushTimer = null;
  }
  voiceCaptionPending = "";
  flushVoiceChunkPending();
  voiceActive.value = false;
  voicePhase.value = "idle";
  voiceInterimText.value = "";
  voiceDialogOpen.value = false;
  setVoiceAssistantOverlayOpen(false);
  choiceDialogVisible.value = false;
  voiceCaptions.value = [];
  voiceHangupLock = false;
  document.body.style.overflow = "";
  clearStuckUiBlockers();
  dispatchVoiceWakeRefresh();
  if (shouldSummarize && capturedSessionId) {
    window.setTimeout(() => {
      void summarizeVoiceCall(log, capturedSessionId);
    }, 0);
  }
}

async function summarizeVoiceCall(
  log: Array<{ role: "user" | "assistant"; text: string }>,
  sid: string,
) {
  voiceSummarizingSessionId.value = sid;
  try {
    const ep = await resolveEndpoint({ slot: "command", chatContext: true });
    if (!ep.model.trim() || !ep.baseUrl.trim()) {
      appendLocalAssistant(sid, "【通话总结】指挥脑未配置，无法生成本通摘要。");
      return;
    }
    const transcript = log
      .map((r) => `${r.role === "user" ? "用户" : "助手"}：${r.text}`)
      .join("\n");
    const text = await invoke<string>("xu_agent_stream", {
      request: {
        sessionId: `${sid}_voice_summary`,
        runId: createRunId(),
        endpoint: {
          provider: ep.provider || "custom",
          model: ep.model,
          baseUrl: ep.baseUrl,
          apiKeyEnv: ep.apiKeyEnv,
          apiFormat: ep.apiFormat ?? "openai",
          presetId: ep.presetId ?? (ep.source === "local" ? "local" : ep.model),
        },
        messages: [
          {
            role: "system",
            content:
              "你是通话秘书。根据本通语音对话写一段中文摘要（3–6 句）：结论、待办、未决问题。不要工具、不要代码块。",
            images: null,
          },
          { role: "user", content: `本通语音记录：\n${transcript}`, images: null },
        ],
        workspaceRoot: null,
        enableTools: false,
        memoryScope: "global",
        memoryTaskHint: "语音通话摘要",
      },
    });
    const summary = (text || "").trim();
    if (summary) appendLocalAssistant(sid, `【通话总结】\n${summary}`);
  } catch (e) {
    appendLocalAssistant(
      sid,
      `【通话总结】${sanitizeUserMessage(e, "生成失败，请稍后重试")}`,
    );
  } finally {
    if (voiceSummarizingSessionId.value === sid) voiceSummarizingSessionId.value = null;
  }
}

function assistantPlainText(sessionId: string): string {
  const list = sessionMessages.value[sessionId] ?? [];
  const last = voiceStreamBubbleId
    ? list.find((m) => m.id === voiceStreamBubbleId)
    : [...list].reverse().find((m) => m.role === "assistant");
  if (!last) return "";
  const raw = last.blocks
    .filter((b) => b.type === "text")
    .map((b) => (b.type === "text" ? b.content : ""))
    .join("");
  return dedupeRepeatedText(raw);
}

async function pickWorkingDir() {
  if (props.homeMode) {
    const gp = await getBoundProjectGeneratePath();
    if (gp) {
      workingDir.value = gp;
      return;
    }
    await guideHomeProjectStart();
    return;
  }
  try {
    const dir = await openFileDialog({ directory: true, multiple: false });
    if (typeof dir === "string") workingDir.value = dir;
  } catch {
    /* ignore */
  }
}

async function persistExpertRole(id: string | null) {
  selectedExpertRoleId.value = id;
  try {
    if (id) localStorage.setItem(EXPERT_ROLE_KEY, id);
    else localStorage.removeItem(EXPERT_ROLE_KEY);
  } catch {
    /* ignore */
  }
  await refreshBrainBadge();
}

watch(activeSessionId, (id) => {
  if (id) pruneEmptyStreamingAssistants(id);
  void refreshSessionStats();
});

watch(
  () => props.workingDirOverride,
  (dir) => {
    if (props.managedByParent) workingDir.value = dir ?? null;
  },
  { immediate: true },
);

onMounted(() => {
  let disposed = false;
  if (props.homeMode) {
    lockHomeViewMode();
    clearStuckUiBlockers();
  }
  if (props.embedded && !props.idePanel && chatViewMode.value === "code") {
    chatViewMode.value = "qa";
  }
  void ensureAgencyCatalog();
  void import("../training/personaTraining").then((m) => m.loadPersonaTraining()).catch(() => undefined);
  void loadSessions();
  void refreshBrainBadge();
  void loadAgentPrefs().then((p) => {
    chatMode.value = normalizeChatMode(p.chatMode);
    execPolicy.value = p.execPolicy ?? "standard";
  });
  try {
    if (!props.managedByParent) {
      workingDir.value = readLs("xu.chat.workingDir", "hermes_working_dir");
    }
  } catch {
    /* ignore */
  }
  if (!props.homeMode && workingDir.value) fileTreeAutoOpened.value = true;
  if (!props.homeMode && chatViewMode.value === "code" && workingDir.value) {
    fileTreeOpen.value = true;
  }
  void refreshActiveProjectGit();
  window.addEventListener("xu-navigate", onNavigate);
  window.addEventListener(XU_DESIGN_CONFIRM_NEEDED, onDesignConfirmNeeded);
  window.addEventListener(XU_VOICE_OPEN_ASSISTANT, onOpenVoiceAssistantEvent);
  window.addEventListener(XU_VOICE_FORCE_HANGUP, onForceHangupVoice);
  const pendingOpenId = consumeOpenVoiceAssistantFlag();
  if (pendingOpenId) {
    openVoiceAssistantOverlay();
    acknowledgeVoiceAssistantVisible(pendingOpenId === "1" ? undefined : pendingOpenId);
  }

  let unlistenXu: (() => void) | undefined;
  let unlistenBilling: (() => void) | undefined;
  let unlistenVoiceRoute: (() => void) | undefined;
  void listen("xu:billing-updated", () => {
    if (disposed) return;
    void refreshSessionStats();
  }).then((fn) => {
    if (disposed) fn();
    else unlistenBilling = fn;
  });
  void listenVoiceRouteOverride().then((fn) => {
    if (disposed) fn();
    else unlistenVoiceRoute = fn;
  });
  void refreshSessionStats();
  void listen<StreamChunk>("xu:chunk", ({ payload }) => {
    if (disposed) return;
    if (
      !payload?.session_id ||
      !payload.run_id ||
      activeRunBySession.get(payload.session_id) !== payload.run_id
    ) return;
    upsertAssistantChunk(payload.session_id, payload);
    if (voiceSession?.active && isVoiceBoundSession(payload.session_id)) {
      if (payload.kind === "done") {
        if (voiceCaptionFlushTimer) {
          clearTimeout(voiceCaptionFlushTimer);
          voiceCaptionFlushTimer = null;
          upsertVoiceAssistantCaption(voiceCaptionPending);
        }
        voiceSpeakWhenStreamDone(payload.session_id);
      } else if (payload.kind === "text" || payload.kind === "token") {
        voiceSpeakProgress(payload.session_id);
      }
    }
  }).then((fn) => {
    if (disposed) fn();
    else unlistenXu = fn;
  });

  const onNew = () => handleNewSession();
  const onTerm = () => {
    void openTerminal();
  };
  const onSnap = () => {
    fileTreeOpen.value = false;
    startRegionScreenshot();
  };
  const onTree = () => {
    fileTreeOpen.value = !fileTreeOpen.value;
    snapshotPanelOpen.value = false;
  };
  const onStop = () => void stopStream();

  window.addEventListener("new-session-hotkey", onNew);
  window.addEventListener("toggle-terminal", onTerm);
  window.addEventListener("toggle-snapshot", onSnap);
  window.addEventListener("toggle-file-tree", onTree);
  window.addEventListener("stop-active-session", onStop);

  let unlistenDir: (() => void) | undefined;
  if (props.idePanel && !props.managedByParent) {
    void onWorkingDirChanged((dir) => {
      if (disposed) return;
      workingDir.value = dir;
    }).then((fn) => {
      if (disposed) fn();
      else unlistenDir = fn;
    });
  }

  onUnmounted(() => {
    disposed = true;
    voiceDialogOpen.value = false;
    setVoiceAssistantOverlayOpen(false);
    clearStuckUiBlockers();
    resetPanelResizeState();
    window.removeEventListener("new-session-hotkey", onNew);
    window.removeEventListener("toggle-terminal", onTerm);
    window.removeEventListener("toggle-snapshot", onSnap);
  window.removeEventListener("toggle-file-tree", onTree);
  window.removeEventListener("stop-active-session", onStop);
  window.removeEventListener("xu-navigate", onNavigate);
  window.removeEventListener(XU_DESIGN_CONFIRM_NEEDED, onDesignConfirmNeeded);
  window.removeEventListener(XU_VOICE_OPEN_ASSISTANT, onOpenVoiceAssistantEvent);
  window.removeEventListener(XU_VOICE_FORCE_HANGUP, onForceHangupVoice);
  stopVoiceWake();
  dispatchVoiceWakeRefresh();
  unlistenDir?.();
  unlistenXu?.();
  unlistenBilling?.();
  unlistenVoiceRoute?.();
  voiceSession?.stop();
  voiceSession = null;
  voiceSessionId = null;
});
});

watch(workingDir, (dir) => {
  if (props.managedByParent) return;
  try {
    if (dir) writeLs("xu.chat.workingDir", dir);
    else {
      try {
        localStorage.removeItem("xu.chat.workingDir");
        localStorage.removeItem("hermes_working_dir");
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
  if (dir) {
    fileTreeOpen.value = true;
    snapshotPanelOpen.value = false;
  }
});

function onPreviewFile(absPath: string) {
  const abs = resolveAbsPath(workingDir.value, absPath);
  trackHomeMd(abs);
  openFile(abs, { preview: false });
  editorViewTab.value = defaultEditorTabForPath(abs);
  previewCollapsed.value = false;
}

function onOpenFile(absPath: string) {
  const abs = resolveAbsPath(workingDir.value, absPath);
  openFile(abs, { preview: false });
  editorViewTab.value = defaultEditorTabForPath(abs);
  previewCollapsed.value = false;
}

function onEditorDirtyChange(dirty: boolean) {
  if (previewPath.value) setDirty(previewPath.value, dirty);
}

function revealInFileTree(path: string) {
  fileTreeOpen.value = true;
  setIdeSideView("explorer");
  const tree = isCodeView.value ? ideSideRef.value : askTreeRef.value;
  void tree?.revealPath(path);
}

function openIdeFromChat() {
  setIdeSideView("explorer");
  if (router.currentRoute.value.path === "/canvas") {
    void router.push("/ide");
    return;
  }
  if (!isIdeWindow() && (props.homeMode || !isCodeView.value)) {
    void focusIdeWindow();
  }
}

async function onCloseTab(path: string) {
  await closeTab(path);
}

async function onTabPreview(path: string) {
  editorViewTab.value = "preview";
  previewPath.value = path;
}

async function runLintForPath(path: string | null, silent = false) {
  const ws = workingDir.value;
  if (!ws?.trim() || !path?.trim()) return;
  try {
    const abs = resolveAbsPath(ws, path);
    let content = editorFileContent.value;
    if (!content && (isTsJsPath(abs) || isTsJsPath(path))) {
      try {
        content = await invoke<string>("read_text_file", { path: abs });
      } catch {
        content = "";
      }
    }
    const eslintPromise = lintFiles(ws, [abs]).catch((e) => {
      if (!silent) throw e;
      return [] as LintDiagnostic[];
    });
    const tsPromise =
      isTsJsPath(abs) || isTsJsPath(path)
        ? tsGetDiagnostics(ws, abs, content).catch(() => [] as LintDiagnostic[])
        : Promise.resolve([] as LintDiagnostic[]);
    const [eslintDiags, tsDiags] = await Promise.all([eslintPromise, tsPromise]);
    let next = mergeDiagnosticsBySource(lintDiagnostics.value, abs, eslintDiags, ["eslint"]);
    next = mergeDiagnosticsBySource(next, abs, tsDiags, ["typescript"]);
    lintDiagnostics.value = next;
  } catch (e) {
    if (!silent) void fouAlert(toUserError(e), "代码检查");
  }
}

function scheduleLint(path: string | null) {
  if (!path || !workingDir.value?.trim() || !isCodeView.value) return;
  debouncedLint(() => runLintForPath(path, true));
}

function onProblemSelect(diag: LintDiagnostic) {
  previewPath.value = diag.file;
  editorViewTab.value = "edit";
  setIdeSideView("problems");
  fileEditorRef.value?.goToLine(diag.line, diag.column);
}

function onIdeOpenFileLine(path: string, line: number) {
  onOpenFile(path);
  window.setTimeout(() => fileEditorRef.value?.goToLine(line, 1), 80);
}

function onEditorContentChange(text: string) {
  editorFileContent.value = text;
  const p = previewPath.value;
  if (p && workingDir.value && isTsJsPath(p) && isCodeView.value) {
    scheduleLint(p);
  }
}

function onGotoDefinition(file: string, line: number, column: number) {
  onOpenFile(file);
  editorViewTab.value = "edit";
  window.setTimeout(() => fileEditorRef.value?.goToLine(line, column), 80);
}

function onTerminalReady(id: string) {
  terminalReadyIds.value = new Set([...terminalReadyIds.value, id]);
}

async function writeToTerminal(ptyId: string, data: string): Promise<void> {
  for (let i = 0; i < 12; i++) {
    try {
      await invoke("pty_write", { ptyId, data });
      return;
    } catch (e) {
      if (i >= 11) throw e;
      await new Promise((r) => window.setTimeout(r, 200));
    }
  }
}

async function onRunNpmScript(command: string) {
  const id = ensureTerminalTab();
  showTerminal();
  await nextTick();
  try {
    await writeToTerminal(id, `${command}\r\n`);
    fouMsg.success(`已在终端运行：${command}`);
  } catch (e) {
    void onApiCatch(e);
  }
}

async function refreshActiveProjectGit() {
  const ws = workingDir.value?.trim();
  if (!ws) {
    activeProjectGit.value = null;
    return;
  }
  const { loadProjects } = await import("../utils/projects");
  const projects = await loadProjects();
  const norm = ws.replace(/\\/g, "/").toLowerCase();
  const matched = projects.find((p) => {
    const gp = (p.generatePath || "").replace(/\\/g, "/").toLowerCase();
    return gp && (norm === gp || norm.startsWith(`${gp}/`) || norm.startsWith(gp));
  });
  activeProjectGit.value = matched?.git ?? null;
  if (matched?.generatePath && !workingDir.value?.trim()) {
    workingDir.value = matched.generatePath;
  }
}

watch(previewPath, (path) => {
  if (path) editorViewTab.value = defaultEditorTabForPath(path);
});

watch([previewPath, workingDir, isCodeView], ([path, , code]) => {
  if (code && path) scheduleLint(path);
});

watch(workingDir, () => {
  void refreshActiveProjectGit();
});

function persistChatViewMode(mode: ChatViewMode) {
  if (props.homeMode && mode === "code") return;
  if (chatViewMode.value === mode) return;
  chatViewMode.value = mode;
  saveChatLayoutPrefs({ viewMode: mode });
  if (mode === "qa") {
    fileTreeOpen.value = false;
    snapshotPanelOpen.value = false;
    previewCollapsed.value = true;
  } else if (mode === "code" && workingDir.value) {
    fileTreeOpen.value = true;
  }
  fouMsg.info(`已切换到${chatViewModeLabel(mode)}模式`);
}

function persistChatPanelLayout(layout: ChatPanelLayout) {
  if (chatPanelLayout.value === layout) return;
  chatPanelLayout.value = layout;
  saveChatLayoutPrefs({ panelLayout: layout });
  fouMsg.info(chatPanelLayoutLabel(layout));
}

function removeQueueItem(id: string) {
  const sid = activeSessionId.value;
  if (!sid) return;
  queuedBySession.value = {
    ...queuedBySession.value,
    [sid]: (queuedBySession.value[sid] ?? []).filter((q) => q.id !== id),
  };
}

function clearQueue() {
  const sid = activeSessionId.value;
  if (!sid) return;
  queuedBySession.value = { ...queuedBySession.value, [sid]: [] };
  fouMsg.info("已清空排队");
}

async function persistChatMode(mode: ChatMode) {
  chatMode.value = mode;
  const prefs = await loadAgentPrefs();
  await saveAgentPrefs({ ...prefs, chatMode: mode });
  fouMsg.info(`模式：${chatModeLabel(mode)}`);
}

async function persistExecPolicy(policy: ExecPolicy) {
  execPolicy.value = policy;
  const prefs = await loadAgentPrefs();
  await saveAgentPrefs({ ...prefs, execPolicy: policy });
}

async function compressContext() {
  const sid = activeSessionId.value;
  if (!sid) {
    void fouAlert("请先开始对话", "提示");
    return;
  }
  const msgs = (sessionMessages.value[sid] ?? [])
    .flatMap((m) => {
      const text = m.blocks.find((b) => b.type === "text");
      if (!text || text.type !== "text" || !text.content.trim()) return [];
      return [{ role: m.role, content: text.content }];
    })
    .slice(-40);
  if (msgs.length < 4) {
    fouMsg.info("消息较少，无需压缩");
    return;
  }
  try {
    const result = await compactAgentMessages(msgs, sid);
    if (result.compacted) {
      contextUsage.value = { used: result.after, max: result.max, pct: Math.round((result.after / result.max) * 100) };
      fouMsg.success(`上下文已压缩：约 ${result.before} → ${result.after} tokens`);
    } else {
      fouMsg.info("当前上下文无需压缩");
    }
  } catch (e) {
    void onApiCatch(e);
  }
}
function toggleTools() {
  showTools.value = !showTools.value;
  writeLs("xu.chat.showTools", String(showTools.value));
  fouMsg.info(showTools.value ? "已显示工具调用" : "已隐藏工具调用");
}
function toggleThink() {
  showThink.value = !showThink.value;
  writeLs("xu.chat.showThink", String(showThink.value));
  fouMsg.info(showThink.value ? "已显示思考过程" : "已隐藏思考过程");
}
function toggleReplies() {
  repliesCollapsed.value = !repliesCollapsed.value;
  writeLs("xu.chat.repliesCollapsed", String(repliesCollapsed.value));
  fouMsg.info(repliesCollapsed.value ? "已折叠历史回复" : "已展开历史回复");
}
function toggleSnapshot() {
  fileTreeOpen.value = false;
  startRegionScreenshot();
}
async function toggleFileTree() {
  const opening = !fileTreeOpen.value;
  if (opening && !workingDir.value) {
    await requireWorkingDir(workingDir.value, "文件树", pickWorkingDir);
    if (!workingDir.value) return;
  }
  fileTreeOpen.value = opening;
  if (fileTreeOpen.value) snapshotPanelOpen.value = false;
}
async function openTerminal(cwd?: string) {
  const target = cwd?.trim() || workingDir.value?.trim() || "";
  if (!target) {
    await requireWorkingDir(workingDir.value, "终端", pickWorkingDir);
    if (!workingDir.value) return;
  }
  if (cwd?.trim()) {
    addTerminalTab(cwd.trim());
  } else {
    toggleTerminal();
  }
  snapshotPanelOpen.value = false;
}

watch(streamingSessions, (set) => {
  const status = set.size > 0 ? "running" : "idle";
  invoke("update_tray_status", { status }).catch(() => {});
});

function appendDraft(text: string) {
  const chunk = text.trim();
  if (!chunk) return;
  draft.value = draft.value.trim() ? `${draft.value.trim()}\n${chunk}` : chunk;
}

function fillDraft(text: string) {
  draft.value = text;
}

defineExpose({ appendDraft });
</script>

<template>
  <div v-if="props.idePanel" class="ide-chat-rail fou-chat-embedded">
    <ChatAgentColumn
      :sessions="sessions"
      :active-id="activeSessionId"
      :badges="sidebarBadges"
      :queue-counts="sidebarQueueCounts"
      :messages="messages"
      :streaming="streaming"
      :show-tools="showTools"
      :show-think="showThink"
      :replies-collapsed="repliesCollapsed"
      :working-dir="workingDir"
      :assistant-name="assistantName"
      :session-error="activeError"
      :sessions-visible="ideChatHistoryVisible"
      align-right
      :billing-preset-id="billingPresetId"
      :billing-model-label="billingModelLabel"
      show-open-ide
      @select="handleSelectSession"
      @new="handleNewSession"
      @delete="handleDeleteSession"
      @refresh="loadSessions"
      @stop-session="stopSessionStream"
      @stop="stopStream"
      @edit="editMessage"
      @delete-message="deleteMessage"
      @copy="copyMessage"
      @copy-session="copySession"
      @toggle-think="toggleThink"
      @toggle-tools="toggleTools"
      @toggle-replies="toggleReplies"
      @open-ide="openIdeFromChat"
      @use-example="fillDraft"
      @update:sessions-visible="setIdeChatHistoryVisible"
    >
      <template #composer>
        <div v-if="activeError" class="chat-error-bar ui-font">
          <p class="chat-error agent-error">{{ activeError }}</p>
          <FouButton
            icon="close-line"
            size="small"
            text
            native-type="button"
            aria-label="关闭错误提示"
            @click="dismissActiveError"
          >
            关闭
          </FouButton>
        </div>
        <ChatComposer
          v-model="draft"
          external-resize
          :streaming="streaming"
          :has-session="Boolean(activeSessionId) || messages.length > 0"
          :session-id="activeSessionId"
          :voice-active="voiceActive"
          :voice-phase="voicePhase"
          :voice-interim="voiceInterimText"
          :expert-role-id="selectedExpertRoleId"
          :queued-messages="activeQueuedMessages"
          :model-label="modelPillLabel"
          :brain-ok="brainOk"
          :context-usage="contextUsage"
          :session-cost-label="sessionCostLabel"
          :session-rounds="sessionBillingRoundsList"
          :model-short-label="modelShortLabel"
          :chat-mode="chatMode"
          :exec-policy="execPolicy"
          :plan-write-warning="planWriteWarning"
          :session-error="activeError"
          :token-hard-hit="tokenHardHit"
          :editing-message="editingUserMessage"
          @send="handleComposerSend"
          @stop="stopStream"
          @remove-queue="removeQueueItem"
          @clear-queue="clearQueue"
          @toggle-voice-call="toggleVoiceCall"
          @update:chat-mode="persistChatMode"
          @update:exec-policy="persistExecPolicy"
          @update:expert-role-id="persistExpertRole"
          @brain-changed="() => refreshBrainBadge({ skipProbe: true })"
          @compress="compressContext"
        />
      </template>
    </ChatAgentColumn>
  </div>
  <div
    v-else
    class="app-layout fou-chat-page"
    :class="{ 'xu-chat-embedded': props.embedded, 'xu-chat-home': props.homeMode }"
  >
    <ChatTopBar
      v-if="!props.homeMode"
      :streaming="streaming"
      :version-label="agentVersion"
      :session-title="activeSession?.title ?? null"
      :view-mode="chatViewMode"
      :panel-layout="chatPanelLayout"
      :home-mode="props.homeMode"
      @new-session="handleNewSession"
      @rename="handleRenameSession"
      @update:view-mode="persistChatViewMode"
      @update:panel-layout="persistChatPanelLayout"
      @open-ide="openIdeFromChat"
      @toggle-sessions="sessionDrawerOpen = !sessionDrawerOpen"
    />

    <!-- 代码模式（首页永不进入） -->
    <div
      v-if="isCodeView && !props.homeMode"
      class="chat-main-row code-layout-row"
      :class="{
        'layout-agent-right': layoutAgentRight,
        resizing: codeResizing,
      }"
    >
      <div
        class="panel-agent code-agent-panel"
        :class="{ 'is-right': layoutAgentRight }"
        :style="{ width: `${codeAgentWidth}px` }"
      >
        <ChatAgentColumn
          :sessions="sessions"
          :active-id="activeSessionId"
          :badges="sidebarBadges"
          :queue-counts="sidebarQueueCounts"
          :messages="messages"
          :streaming="streaming"
          :show-tools="showTools"
          :show-think="showThink"
          :replies-collapsed="repliesCollapsed"
          :working-dir="workingDir"
          :assistant-name="assistantName"
          :session-error="activeError"
          :align-right="layoutAgentRight"
          :billing-preset-id="billingPresetId"
          :billing-model-label="billingModelLabel"
          show-open-ide
          @select="handleSelectSession"
          @new="handleNewSession"
          @delete="handleDeleteSession"
          @refresh="loadSessions"
          @stop-session="stopSessionStream"
          @stop="stopStream"
          @edit="editMessage"
          @delete-message="deleteMessage"
          @copy="copyMessage"
          @copy-session="copySession"
          @toggle-think="toggleThink"
          @toggle-tools="toggleTools"
          @toggle-replies="toggleReplies"
          @open-ide="openIdeFromChat"
          @use-example="fillDraft"
        >
          <template #composer>
            <div v-if="activeError" class="chat-error-bar ui-font">
              <p class="chat-error agent-error">{{ activeError }}</p>
              <FouButton
                icon="close-line"
                size="small"
                text
                native-type="button"
                aria-label="关闭错误提示"
                @click="dismissActiveError"
              >
                关闭
              </FouButton>
            </div>
            <ChatComposer
              v-model="draft"
              :streaming="streaming"
              :has-session="Boolean(activeSessionId) || messages.length > 0"
              :session-id="activeSessionId"
              :voice-active="voiceActive"
              :voice-phase="voicePhase"
              :voice-interim="voiceInterimText"
              :expert-role-id="selectedExpertRoleId"
              :queued-messages="activeQueuedMessages"
              :model-label="modelPillLabel"
              :brain-ok="brainOk"
              :context-usage="contextUsage"
          :session-cost-label="sessionCostLabel"
          :session-rounds="sessionBillingRoundsList"
          :model-short-label="modelShortLabel"
              :chat-mode="chatMode"
              :exec-policy="execPolicy"
              :plan-write-warning="planWriteWarning"
              :session-error="activeError"
              :token-hard-hit="tokenHardHit"
              :editing-message="editingUserMessage"
              @send="handleComposerSend"
              @stop="stopStream"
              @remove-queue="removeQueueItem"
              @clear-queue="clearQueue"
              @toggle-voice-call="toggleVoiceCall"
              @update:chat-mode="persistChatMode"
              @update:exec-policy="persistExecPolicy"
              @update:expert-role-id="persistExpertRole"
              @brain-changed="() => refreshBrainBadge({ skipProbe: true })"
              @compress="compressContext"
            />
          </template>
        </ChatAgentColumn>
      </div>

      <div
        class="panel-split split-agent"
        title="拖动调整宽度"
        @pointerdown="startCodeResize('agent', $event)"
      />

      <div class="panel-center code-center">
        <WorkingDirBar
          :path="workingDir"
          :show-think="showThink"
          :show-tools="showTools"
          :replies-collapsed="repliesCollapsed"
          @pick="pickWorkingDir"
          @clear="workingDir = null"
          @open-terminal="openTerminal"
          @toggle-snapshot="toggleSnapshot"
          @toggle-file-tree="toggleFileTree"
        />

        <div v-if="!props.homeMode && (showKeyBanner || brainHint)" class="chat-banner ui-font">
          {{ brainHint || "未检测到可用模型配置；请到设置 → 三脑完成配置。" }}
        </div>

        <div class="editor-terminal-stack">
          <div class="editor-main-pane">
            <FileEditorTabs
              :tabs="openFileTabs"
              :active-path="previewPath"
              :working-dir="workingDir"
              @select="(p) => (previewPath = p)"
              @close="onCloseTab"
              @close-others="closeOthers"
              @close-right="closeToRight"
              @close-saved="closeSaved"
              @close-all="closeAll"
              @keep-open="keepOpen"
              @pin="togglePin"
              @preview="onTabPreview"
              @reveal-in-tree="revealInFileTree"
            />
            <FileEditorPanel
              ref="fileEditorRef"
              variant="editor"
              :path="previewPath"
              :working-dir="workingDir"
              :hide-path-title="openFileTabs.length > 0"
              :diagnostics="activeFileDiagnostics"
              :diff-changes="activeFileDiff"
              v-model:view-tab="editorViewTab"
              @close="previewPath && onCloseTab(previewPath)"
              @dirty-change="onEditorDirtyChange"
              @content-change="onEditorContentChange"
              @saved="previewPath && runLintForPath(previewPath)"
              @lint="previewPath && runLintForPath(previewPath)"
              @goto-definition="onGotoDefinition"
              @add-to-chat="
                (t: string) => {
                  draft = draft ? `${draft}\n${t}` : t;
                }
              "
            />
          </div>
          <IdeTerminalDock
            v-show="terminalVisible"
            :tabs="terminalTabs"
            :active-id="terminalActiveId"
            :working-dir="workingDir"
            :height="terminalHeight"
            @select="selectTerminalTab"
            @close="closeTerminalTab"
            @add="addTerminalTab"
            @collapse="hideTerminal"
            @resize-height="setTerminalHeight"
            @ready="onTerminalReady"
          />
        </div>

        <ChatChangedFilesStrip
          :files="changedFilesThisTurn"
          :working-dir="workingDir"
          @preview="onPreviewFile"
        />
      </div>

      <div
        class="panel-split split-tree"
        title="拖动调整宽度"
        @pointerdown="startCodeResize('tree', $event)"
      />

      <div
        class="panel-side chat-side-panel code-ide-sidebar"
        :style="{ width: `${codeTreeWidth}px` }"
      >
        <IdeActivityBar
          :active="ideSideView"
          @select="setIdeSideView"
        />
        <IdeSidePanel
          ref="ideSideRef"
          :view="ideSideView"
          :working-dir="workingDir"
          :selected-path="previewPath"
          :file-tree-pinned="true"
          :diagnostics="lintDiagnostics"
          :active-file-path="previewPath"
          :editor-content="editorFileContent"
          :project-git="activeProjectGit"
          :problems-collapsed="problemsCollapsed"
          @request-pick-dir="pickWorkingDir"
          @open-terminal="openTerminal"
          @add-to-chat="
            (t: string) => {
              draft = draft ? `${draft}\n${t}` : t;
            }
          "
          @preview-file="onPreviewFile"
          @open-file="onOpenFile"
          @open-file-line="onIdeOpenFileLine"
          @problem-select="onProblemSelect"
          @problems-toggle="problemsCollapsed = !problemsCollapsed"
          @run-npm-script="onRunNpmScript"
          @goto-line="(line) => fileEditorRef?.goToLine(line, 1)"
        />
      </div>
    </div>

    <!-- 首页工作台 -->
    <div v-else-if="props.homeMode" class="home-workspace" :class="{ resizing: homeResizing }">
      <aside class="home-task-panel" :style="{ width: `${taskPanelWidth}px` }">
        <div class="home-task-header">
          <FouButton icon="add-line" size="small" native-type="button" @click.stop="handleNewSession">
            新建任务
          </FouButton>
          <FouButton icon="folder-add-line" size="small" native-type="button" @click.stop="openNewProject">
            新建项目
          </FouButton>
        </div>
        <ChatSidebar
          class="home-task-list"
          compact
          :sessions="sessions"
          :active-id="activeSessionId"
          :badges="sidebarBadges"
          :queue-counts="sidebarQueueCounts"
          :billing-preset-id="billingPresetId"
          :billing-model-label="billingModelLabel"
          @select="handleSelectSession"
          @new="handleNewSession"
          @delete="handleDeleteSession"
          @refresh="loadSessions"
          @stop-session="stopSessionStream"
        />
      </aside>

      <div
        class="home-pane-split-v panel-split"
        title="拖动调整任务栏宽度"
        aria-label="拖动调整任务栏宽度"
        @pointerdown="(e) => startHomeResize('task', e)"
      />

      <div class="home-center-col">
        <ChatProjectBar @new-project="openNewProject" />
        <div class="home-session-box">
          <div class="home-chat-pane">
            <ChatMessageList
              compact-empty
              :messages="messages"
            :streaming="streaming"
            :show-tools="showTools"
            :show-think="showThink"
            :collapsed="repliesCollapsed"
            :working-dir="workingDir"
            :assistant-name="assistantName"
            :session-error="activeError"
            @stop="stopStream"
            @edit="editMessage"
            @delete="deleteMessage"
            @copy="copyMessage"
            @copy-session="copySession"
            @use-example="fillDraft"
          />
          </div>
          <div
            class="home-pane-split-h"
            title="拖动调整输入区高度"
            aria-label="拖动调整输入区高度"
            @pointerdown="(e) => startHomeResize('agent', e)"
          />
          <div class="home-agent-pane" :style="{ height: `${agentPaneHeight}px` }">
          <div v-if="activeError" class="chat-error-bar ui-font">
            <p class="chat-error">{{ activeError }}</p>
            <FouButton
              icon="close-line"
              size="small"
              text
              native-type="button"
              aria-label="关闭错误提示"
              @click="dismissActiveError"
            >
              关闭
            </FouButton>
          </div>
          <div v-if="showOpenCanvasCta || showConfirmBriefCta" class="chat-draw-cta-row ui-font">
            <FouButton
              v-if="showOpenCanvasCta"
              icon="artboard-2-line"
              size="small"
              native-type="button"
              title="打开本机草图画板（生成中也可进入）"
              @click="openCanvasFromChat"
            >
              打开 Canvas
            </FouButton>
            <FouButton
              v-if="showConfirmBriefCta"
              icon="checkbox-circle-line"
              type="primary"
              size="small"
              native-type="button"
              title="确认需求后打开开始项目"
              @click="onChatConfirmBrief"
            >
              确认需求
            </FouButton>
          </div>
          <ChatComposer
            v-model="draft"
            external-resize
            :streaming="streaming"
            :has-session="Boolean(activeSessionId) || messages.length > 0"
            :session-id="activeSessionId"
            :voice-active="voiceActive"
            :voice-phase="voicePhase"
            :voice-interim="voiceInterimText"
            :expert-role-id="selectedExpertRoleId"
            :queued-messages="activeQueuedMessages"
            :model-label="modelPillLabel"
            :brain-ok="brainOk"
            :context-usage="contextUsage"
          :session-cost-label="sessionCostLabel"
          :session-rounds="sessionBillingRoundsList"
          :model-short-label="modelShortLabel"
            :chat-mode="chatMode"
            :exec-policy="execPolicy"
            :plan-write-warning="planWriteWarning"
            :session-error="activeError"
            :token-hard-hit="tokenHardHit"
            :editing-message="editingUserMessage"
            @send="handleComposerSend"
            @stop="stopStream"
            @remove-queue="removeQueueItem"
            @clear-queue="clearQueue"
            @toggle-voice-call="toggleVoiceCall"
            @update:chat-mode="persistChatMode"
            @update:exec-policy="persistExecPolicy"
            @update:expert-role-id="persistExpertRole"
            @brain-changed="() => refreshBrainBadge({ skipProbe: true })"
            @compress="compressContext"
          />
          </div>
        </div>
      </div>

      <aside v-if="homePreviewVisible" class="home-preview-panel">
        <div class="home-md-tabs">
          <FouButton
            v-for="p in homeMdPaths"
            :key="p"
            class="home-md-tab"
            :class="{ active: homeMdActive === p }"
            icon="file-text-line"
            size="small"
            text
            native-type="button"
            @click="
              () => {
                homeMdActive = p;
                previewPath = p;
              }
            "
          >
            {{ p.split(/[/\\]/).pop() }}
          </FouButton>
        </div>
        <FilePreviewPanel
          v-if="homeMdActive"
          class="home-md-preview"
          :path="homeMdActive"
          :working-dir="workingDir"
          :collapsed="false"
          :hide-path-title="false"
          v-model:view-tab="editorViewTab"
          @close="
            () => {
              homeMdPaths = homeMdPaths.filter((x) => x !== homeMdActive);
              homeMdActive = homeMdPaths[0] ?? null;
            }
          "
          @dirty-change="onEditorDirtyChange"
        />
      </aside>

      <ProjectFormDialog
        :open="showProjectForm"
        :project="null"
        @close="showProjectForm = false"
        @saved="onHomeProjectSaved"
      />
    </div>

    <!-- 问答模式 -->
    <div
      v-else
      class="chat-main-row"
      :class="{ 'layout-agent-right': layoutAgentRight, 'home-chat-row': props.homeMode }"
    >
      <div
        v-if="!props.homeMode || sessionDrawerOpen"
        class="panel-agent"
        :class="{ 'home-session-drawer': props.homeMode }"
      >
        <ChatSidebar
          :sessions="sessions"
          :active-id="activeSessionId"
          :badges="sidebarBadges"
          :queue-counts="sidebarQueueCounts"
          :billing-preset-id="billingPresetId"
          :billing-model-label="billingModelLabel"
          @select="handleSelectSession"
          @new="handleNewSession"
          @delete="handleDeleteSession"
          @refresh="loadSessions"
          @stop-session="stopSessionStream"
        />
      </div>

      <div v-if="!props.homeMode && openFileTabs.length && fileTreeOpen" class="panel-preview-with-tabs">
        <FileEditorTabs
          :tabs="openFileTabs"
          :active-path="previewPath"
          :working-dir="workingDir"
          @select="(p) => (previewPath = p)"
          @close="onCloseTab"
          @close-others="closeOthers"
          @close-right="closeToRight"
          @close-saved="closeSaved"
          @close-all="closeAll"
          @keep-open="keepOpen"
          @pin="togglePin"
          @preview="onTabPreview"
          @reveal-in-tree="revealInFileTree"
        />
        <FilePreviewPanel
          v-if="previewPath"
          class="panel-preview"
          :path="previewPath"
          :working-dir="workingDir"
          :collapsed="previewCollapsed"
          :hide-path-title="openFileTabs.length > 0"
          v-model:view-tab="editorViewTab"
          @close="previewPath && onCloseTab(previewPath)"
          @collapse="previewCollapsed = !previewCollapsed"
          @dirty-change="onEditorDirtyChange"
          @add-to-chat="
            (t: string) => {
              draft = draft ? `${draft}\n${t}` : t;
            }
          "
        />
      </div>
      <FilePreviewPanel
        v-else-if="!props.homeMode && previewPath && fileTreeOpen"
        class="panel-preview"
        :path="previewPath"
        :working-dir="workingDir"
        :collapsed="previewCollapsed"
        @close="previewPath && onCloseTab(previewPath)"
        @collapse="previewCollapsed = !previewCollapsed"
        @dirty-change="onEditorDirtyChange"
        @add-to-chat="
          (t: string) => {
            draft = draft ? `${draft}\n${t}` : t;
          }
        "
      />

      <div class="panel-center chat-center">
        <div v-if="!props.homeMode && (showKeyBanner || brainHint)" class="chat-banner ui-font">
          {{ brainHint || "未检测到可用模型配置；请到设置 → 三脑完成配置。" }}
        </div>

        <div class="chat-center-stack">
          <ChatMessageList
            :messages="messages"
            :streaming="streaming"
            :show-tools="showTools"
            :show-think="showThink"
            :collapsed="repliesCollapsed"
            :working-dir="workingDir"
            :assistant-name="assistantName"
            :session-error="activeError"
            @stop="stopStream"
            @edit="editMessage"
            @delete="deleteMessage"
            @copy="copyMessage"
            @copy-session="copySession"
            @use-example="fillDraft"
          />

          <ChatChangedFilesStrip
            v-if="fileTreeOpen"
            :files="changedFilesThisTurn"
            :working-dir="workingDir"
            @preview="onPreviewFile"
          />

          <div v-if="activeError" class="chat-error-bar ui-font">
            <p class="chat-error">{{ activeError }}</p>
            <FouButton
              icon="close-line"
              size="small"
              text
              native-type="button"
              aria-label="关闭错误提示"
              @click="dismissActiveError"
            >
              关闭
            </FouButton>
          </div>

          <ChatComposer
            v-model="draft"
            :streaming="streaming"
            :has-session="Boolean(activeSessionId) || messages.length > 0"
            :session-id="activeSessionId"
            :voice-active="voiceActive"
            :voice-phase="voicePhase"
            :voice-interim="voiceInterimText"
            :expert-role-id="selectedExpertRoleId"
            :queued-messages="activeQueuedMessages"
            :model-label="modelPillLabel"
            :brain-ok="brainOk"
            :context-usage="contextUsage"
          :session-cost-label="sessionCostLabel"
          :session-rounds="sessionBillingRoundsList"
          :model-short-label="modelShortLabel"
            :chat-mode="chatMode"
            :exec-policy="execPolicy"
            :plan-write-warning="planWriteWarning"
            :session-error="activeError"
            :token-hard-hit="tokenHardHit"
            :editing-message="editingUserMessage"
            @send="handleComposerSend"
            @stop="stopStream"
            @remove-queue="removeQueueItem"
            @clear-queue="clearQueue"
            @toggle-voice-call="toggleVoiceCall"
            @update:chat-mode="persistChatMode"
            @update:exec-policy="persistExecPolicy"
            @update:expert-role-id="persistExpertRole"
            @brain-changed="() => refreshBrainBadge({ skipProbe: true })"
            @compress="compressContext"
          />
        </div>

          <IdeTerminalDock
            v-show="terminalVisible"
            :tabs="terminalTabs"
            :active-id="terminalActiveId"
            :working-dir="workingDir"
            :height="terminalHeight"
            @select="selectTerminalTab"
            @close="closeTerminalTab"
            @add="addTerminalTab"
            @collapse="hideTerminal"
            @resize-height="setTerminalHeight"
            @ready="onTerminalReady"
          />
      </div>

      <div v-if="snapshotPanelOpen" class="panel-side chat-side-panel">
        <SnapshotPanel
          :session-title="activeSession?.title ?? '未命名会话'"
          @close="snapshotPanelOpen = false"
        />
      </div>
      <div v-if="fileTreeOpen" class="panel-side chat-side-panel">
        <FileTreePanel
          ref="askTreeRef"
          :initial-path="workingDir ?? ''"
          :selected-path="previewPath"
          @close="fileTreeOpen = false"
          @request-pick-dir="pickWorkingDir"
          @open-terminal="openTerminal"
          @add-to-chat="
            (t: string) => {
              draft = draft ? `${draft}\n${t}` : t;
            }
          "
          @preview-file="onPreviewFile"
          @open-file="onOpenFile"
        />
      </div>
    </div>
  </div>

  <RequirementClarifyDialog
    v-model:visible="clarifyDialogVisible"
    :questions="clarifyQuestions"
    :hint="clarifyHint"
    :title="clarifyDialogTitle"
    @submit="onClarifyDialogSubmit"
    @skip="onClarifyDialogSkip"
  />
  <ChoicePickDialog
    v-model:visible="choiceDialogVisible"
    :options="choiceOptions"
    :voice-hint="voiceActive"
    @pick="onChoicePick"
    @none="onChoiceNone"
  />
  <ProjectStartConfirmDialog
    v-model:visible="startConfirmVisible"
    :brief="startConfirmBrief"
    :project="startConfirmProject"
    :suggested-path="startConfirmPath"
    @done="onProjectStartDone"
  />
  <DesignConfirmDialog
    v-model:visible="designConfirmVisible"
    :project-id="designConfirmProjectId"
  />
  <VoiceAssistantDialog
    :visible="voiceDialogOpen"
    :phase="voicePhase"
    :interim="voiceInterimText"
    :captions="voiceCaptions"
    :summarizing="voiceSummarizing"
    @update:visible="onVoiceDialogVisible"
    @ready="onVoiceAssistantReady"
    @hangup="hangupVoiceCall"
  />
</template>

<style scoped>
.fou-chat-page {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--canvas);
  color: var(--body);
}
.chat-main-row {
  flex: 1;
  min-height: 0;
  display: flex;
  overflow: hidden;
}
.panel-agent {
  order: 1;
  flex-shrink: 0;
  min-height: 0;
  display: flex;
}
.panel-preview {
  order: 2;
  flex-shrink: 0;
}
.panel-center {
  order: 3;
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.panel-side {
  order: 4;
  flex-shrink: 0;
  min-height: 0;
}
.layout-agent-right .panel-agent {
  order: 4;
}
.layout-agent-right .panel-preview {
  order: 3;
}
.layout-agent-right .panel-center {
  order: 2;
}
.layout-agent-right .panel-side {
  order: 1;
}
.code-center {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  padding: 0;
}
.panel-preview-with-tabs {
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex-shrink: 0;
}
.panel-preview-with-tabs :deep(.file-editor-tabs) {
  flex-shrink: 0;
}
.panel-preview-with-tabs :deep(.panel-preview),
.panel-preview-with-tabs :deep(.file-editor.is-drawer) {
  flex: 1;
  min-height: 0;
}
.editor-main-pane {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.chat-center-stack {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.chat-center {
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.editor-terminal-stack {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.editor-terminal-stack :deep(.file-editor.is-editor) {
  flex: 1;
  min-height: 0;
  min-width: 0;
  width: 100%;
  border-bottom: none;
}
.editor-terminal-stack :deep(.file-editor.is-editor .editor-body.edit) {
  padding: 0;
  margin: 0;
}
.editor-terminal-stack :deep(.file-editor.is-editor .cm-host) {
  width: 100%;
  height: 100%;
}
.editor-terminal-stack :deep(.react-host) {
  flex: 1;
  min-height: 0;
}
.agent-error {
  margin: 4px 8px 0;
  font-size: 12px;
}
.code-center :deep(.composer) {
  flex-shrink: 0;
  max-height: 40vh;
  overflow: hidden;
}
.code-layout-row {
  gap: 0;
}
.code-layout-row.resizing {
  cursor: col-resize;
  user-select: none;
}
.code-layout-row .code-agent-panel {
  order: 1;
  flex-shrink: 0;
  min-width: 0;
  display: flex;
}
.code-layout-row .split-agent {
  order: 2;
}
.code-layout-row .code-center {
  order: 3;
}
.code-layout-row .split-tree {
  order: 4;
}
.code-layout-row .code-ide-sidebar,
.code-layout-row .code-tree-panel {
  order: 5;
}
.code-layout-row.layout-agent-right .code-ide-sidebar,
.code-layout-row.layout-agent-right .code-tree-panel {
  order: 1;
}
.code-layout-row.layout-agent-right .split-tree {
  order: 2;
}
.code-layout-row.layout-agent-right .code-center {
  order: 3;
}
.code-layout-row.layout-agent-right .split-agent {
  order: 4;
}
.code-layout-row.layout-agent-right .code-agent-panel {
  order: 5;
}
.panel-split {
  flex: 0 0 6px;
  position: relative;
  cursor: col-resize;
  touch-action: none;
  z-index: 2;
  align-self: stretch;
}
.panel-split::after {
  content: "";
  position: absolute;
  top: 10%;
  bottom: 10%;
  left: 50%;
  width: 2px;
  transform: translateX(-50%);
  border-radius: 2px;
  background: transparent;
  transition: background 0.15s ease;
}
.panel-split:hover::after,
.code-layout-row.resizing .panel-split::after {
  background: var(--primary);
  width: 3px;
}
.code-agent-panel :deep(.chat-agent-column) {
  width: 100%;
  min-width: 0;
  max-width: none;
}
.code-ide-sidebar,
.code-tree-panel {
  flex-shrink: 0;
  min-width: 200px;
  display: flex;
  flex-direction: row;
  min-height: 0;
}
.code-ide-sidebar :deep(.ide-side-panel),
.code-tree-panel :deep(.side-panel) {
  flex: 1;
  min-height: 0;
  width: 100%;
  border-left: none;
}
.chat-center {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.chat-center :deep(.composer) {
  flex-shrink: 0;
  max-height: 45vh;
  overflow: hidden;
}
.chat-side-panel {
  width: min(420px, 42vw);
  min-width: 280px;
  border-left: 1px solid var(--hairline);
  background: var(--surface-card);
  overflow: hidden;
}
.chat-side-panel :deep(.react-host) {
  height: 100%;
}
.chat-banner {
  margin: 8px 16px 0;
  padding: 8px 12px;
  border-radius: var(--radius);
  background: var(--primary-glow);
  color: var(--body-strong);
  font-size: 13px;
}
.chat-error-bar {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin: 0 16px 8px;
}
.chat-error-bar .chat-error {
  margin: 0;
  flex: 1;
  min-width: 0;
  white-space: pre-wrap;
}
.chat-draw-cta-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin: 0 16px 8px;
}
.chat-error {
  margin: 0 16px 8px;
  color: var(--error);
  font-size: 13px;
}
.fou-chat-page.fou-chat-home {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--surface-base, #f8fafc);
}
.home-workspace {
  flex: 1;
  min-height: 0;
  display: flex;
  overflow: hidden;
}
.home-task-panel {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  background: var(--surface-card);
  overflow: hidden;
  min-width: 0;
}
.home-pane-split-v {
  flex-shrink: 0;
}
.home-pane-split-h {
  flex: 0 0 5px;
  position: relative;
  cursor: row-resize;
  touch-action: none;
  z-index: 2;
  background: transparent;
}
.home-pane-split-h::after {
  content: none;
}
.home-pane-split-h:hover::after,
.home-workspace.resizing .home-pane-split-h::after {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  top: 50%;
  height: 2px;
  transform: translateY(-50%);
  background: var(--primary);
}
.home-workspace.resizing {
  user-select: none;
}
.home-workspace.resizing.resizing {
  cursor: inherit;
}
.home-task-header {
  padding: 10px 12px;
  border-bottom: 1px solid var(--hairline);
  flex-shrink: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.home-task-list {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
.home-task-list :deep(.session-list) {
  padding: 6px 4px;
}
.home-center-col {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  padding: 0;
  min-height: 0;
}
.home-session-box {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--hairline);
  border-radius: 0;
  background: var(--surface-card);
  overflow: hidden;
  box-shadow: none;
}
.home-chat-pane {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  padding: 0;
  display: flex;
  flex-direction: column;
  align-items: stretch;
}
.home-chat-pane :deep(.message-list) {
  flex: 1;
  min-height: 0;
  height: 100%;
  overflow: auto;
  background: var(--canvas);
}
.home-chat-pane :deep(.chat-empty) {
  flex: 1;
  min-height: 0;
  height: auto;
}
.home-agent-pane {
  flex-shrink: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--surface-card);
  padding: 0 0 12px;
  border-top: none;
}
.home-agent-pane :deep(.composer) {
  flex: 1;
  min-height: 0;
  border-top: none;
  padding-top: 0;
  display: flex;
  flex-direction: column;
}
.home-agent-pane :deep(.composer-input) {
  flex: 1;
  min-height: 72px;
  height: auto !important;
}
.home-preview-panel {
  width: min(42vw, 520px);
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  border-left: 1px solid var(--hairline);
  background: var(--surface-card);
}
.home-md-tabs {
  display: flex;
  gap: 4px;
  padding: 8px 8px 0;
  overflow-x: auto;
  flex-shrink: 0;
}
.home-md-tab {
  border: 1px solid var(--hairline);
  background: var(--surface-soft);
  border-radius: 8px 8px 0 0;
  padding: 6px 10px;
  font-size: 12px;
  cursor: pointer;
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.home-md-tab.active {
  background: var(--surface-card);
  border-bottom-color: transparent;
  font-weight: 600;
}
.home-md-preview {
  flex: 1;
  min-height: 0;
}
.fou-chat-page.fou-chat-home .chat-main-row {
  flex: 1;
  min-height: 0;
}
.fou-chat-page.fou-chat-home .panel-center.chat-center {
  max-width: 920px;
  margin: 0 auto;
  width: 100%;
}
.fou-chat-page.fou-chat-home .home-session-drawer {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  z-index: 50;
  width: 260px;
  background: var(--surface-card);
  border-right: 1px solid var(--hairline);
  box-shadow: 4px 0 24px rgba(15, 23, 42, 0.12);
}
.fou-chat-page.fou-chat-home .home-chat-row {
  position: relative;
}
.fou-chat-page.fou-chat-embedded {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.fou-chat-page.fou-chat-embedded .chat-main-row {
  flex: 1;
  min-height: 0;
}
.ide-chat-rail {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--surface-card);
}
.ide-chat-rail :deep(.chat-agent-column) {
  width: 100%;
  min-width: 0;
  max-width: none;
  height: 100%;
}
</style>
