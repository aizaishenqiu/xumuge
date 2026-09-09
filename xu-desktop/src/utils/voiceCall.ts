/**
 * @file 连续语音通话：Web Speech STT、TTS 与插话控制
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-30
 * @updated 2026-09-07
 * @version 1.10.4
 * @category Stream
 * @algo epoch-guard-echo-lock
 */

import { loadVoiceSettings } from "../stores/voiceSettings";
import {
  resolveTtsProvider,
  type TtsProvider,
} from "./ttsProvider";
import { isCosyFastapiWarmFresh, markCosyFastapiSpoke, warmCosyFastapiQuiet } from "./cosyFastapiWarm";
import { probeFastapiUrl } from "./cosyFastapiClient";
import { parseLlmTtsInstruct } from "./llmTtsInstruct";
import { persistLlmTtsInstructForEngine, saveVoiceSessionOverride } from "./voiceSessionOverride";
import { toUserError } from "./userFacingError";
import { toneRequiresCosy } from "./voiceTonePresets";
import { isDuplexSpikeEnabled, VoiceDuplexSpike } from "./voiceDuplexSpike";
import { clearTap } from "./ttsPlaybackTap";

export type VoicePhase = "idle" | "listening" | "thinking" | "speaking" | "error";

type SpeakItem = {
  text: string;
  /** 垫话/口令确认：强制系统或 Kokoro，不走 Cosy 冷启动 */
  forceFast?: boolean;
  /** 与 ChatPage voiceSpeakTurn 对齐，过期 turn 丢弃 */
  turn?: number;
};

/** 通话静音门：有 final 后稍候提交；仅 interim 时更长，避免半句就答 */
const SILENCE_MS_FINAL = 1_100;
const SILENCE_MS_INTERIM = 1_800;
const BARGE_IN_MIN_CHARS = 2;
/** 朗读中打断门槛更高，避免扬声器回声被当成插话 */
const BARGE_IN_SPEAKING_MIN_CHARS = 8;
const BARGE_IN_DEBOUNCE_MS = 800;
const LISTEN_RESTART_MAX = 80;
const LISTEN_RESTART_GAP_MS = 350;
/** 开麦打断：朗读中延迟开麦，降低回声自激 */
const BARGE_IN_LISTEN_DELAY_MS = 700;
const SPEAK_BARGE_GRACE_MS = 2_500;
const POST_TTS_LISTEN_DELAY_MS = 1_200;
const TRANSCRIPT_DEDUPE_MS = 4_000;
/** 播报结束后仍过滤回声的窗口 */
const ECHO_TAIL_MS = 4_500;
const ECHO_GUARD_MS = 1_800;
/** 朗读中开麦打断：扬声器回声会被当成用户话入对话。默认关闭。 */
const ALLOW_BARGE_WHILE_SPEAKING = false;
/** 唤醒确认「在呢」常被 ASR 听成「在哪」 */
const WAKE_GREETING_ECHO_RE = /^(在呢|在哪|这儿呢|我在|哎+|嗯+)[。.!！]?$/;
const WAKE_GREETING_HOLD_MS = 2_000;

const SENTENCE_END = /[。！？；.!?\n]/;
const SOFT_BREAK = /[，,、；;：:]/;

/**
 * 流式朗读切点：有句号则读到句末；过长无句号时在逗号/长度处软切；flush 读完全文。
 * earlyFirst：首段更早开口；cosyChunk：Cosy 单次合成贵，首段/步进加大（日志：8 字×6 次拖慢）。
 * offlineBatch：男声 Cosy→Kokoro 回退时加大切块（日志：12 字×多段 Kokoro 句间卡顿）。
 */
export function speakLimit(
  clean: string,
  spokenThrough: number,
  flush: boolean,
  opts?: { earlyFirst?: boolean; cosyChunk?: boolean; offlineBatch?: boolean },
): number {
  if (flush) return clean.length;
  if (clean.length <= spokenThrough) return spokenThrough;
  // 取「下一处」断点；勿用最后一个句号（日志：spokenThrough=35→106 一次 chunkLen=71，Cosy 34s + soft-timeout）
  let firstEnd = -1;
  let firstSoft = -1;
  for (let i = spokenThrough; i < clean.length; i++) {
    const ch = clean[i]!;
    if (SENTENCE_END.test(ch)) {
      if (firstEnd < 0) firstEnd = i;
    } else if (SOFT_BREAK.test(ch)) {
      if (firstSoft < 0) firstSoft = i;
    }
  }
  const offline = Boolean(opts?.offlineBatch);
  const cosy = Boolean(opts?.cosyChunk) && !offline;
  const early = Boolean(opts?.earlyFirst) && spokenThrough === 0;
  // Kokoro/离线：流式阶段不切段，等 flush 整段再读（日志：37 字开口+背压→中途卡；且句间再拆 WAV）
  if (offline) {
    return spokenThrough;
  }
  // Cosy：勿在 early 时按逗号切出 14 字碎段（日志：female-jiazi chunkLen 11–24 中途卡）
  if (firstEnd >= spokenThrough) {
    const endLen = firstEnd + 1 - spokenThrough;
    if (!cosy || endLen >= 32) return firstEnd + 1;
  }
  const pending = clean.length - spokenThrough;
  const softMin = early ? (cosy ? 32 : 4) : cosy ? 40 : 16;
  const hardMin = early ? (cosy ? 40 : 8) : cosy ? 52 : 24;
  const hardStep = early ? (cosy ? 48 : 10) : cosy ? 56 : 20;
  if (pending >= softMin && firstSoft >= spokenThrough) {
    const softLen = firstSoft + 1 - spokenThrough;
    if (!cosy || softLen >= (early ? 28 : 36)) return firstSoft + 1;
  }
  if (pending >= hardMin) return Math.min(clean.length, spokenThrough + hardStep);
  return spokenThrough;
}

type UtteranceGate = "open" | "hold" | "barge";

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onstart: ((ev: Event) => void) | null;
  onend: ((ev: Event) => void) | null;
  onerror: ((ev: Event) => void) | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onresult: ((ev: any) => void) | null;
};

let globalRec: SpeechRecognitionLike | null = null;
let globalRecOwner: "call" | "dictation" | "wake" | null = null;

/** 当前占用 Web Speech 识别的会话类型。 */
export function getGlobalSpeechRecOwner(): "call" | "dictation" | "wake" | null {
  return globalRecOwner;
}

/** 标记识别归属；不启动引擎。 */
export function setGlobalSpeechRecOwner(owner: "call" | "dictation" | "wake" | null) {
  globalRecOwner = owner;
}

/** 终止当前 Web Speech 识别所有权；浏览器 abort 异常会被吞掉以保证通话可关闭。 */
export function abortGlobalSpeechRecognition() {
  try {
    globalRec?.abort();
  } catch {
    /* ignore */
  }
  globalRec = null;
  globalRecOwner = null;
}

function speechErrorMessage(code: string): string | null {
  if (code === "not-allowed" || code === "service-not-allowed") {
    return "麦克风权限被拒绝。请在系统设置 → 隐私 → 麦克风 中允许虚募阁访问后重试。";
  }
  if (code === "audio-capture") {
    return "无法捕获麦克风音频。请检查麦克风是否被其它应用占用。";
  }
  if (code === "network") {
    return "语音识别需要网络，当前连接不可用。请检查网络后重试。";
  }
  if (code === "aborted" || code === "no-speech") return null;
  return null;
}

/** 检查浏览器是否提供标准或 WebKit SpeechRecognition；不申请麦克风权限。 */
export function speechRecognitionAvailable(): boolean {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any;
  return Boolean(w.SpeechRecognition || w.webkitSpeechRecognition);
}

/** 检查系统 Web Speech 朗读入口；离线 provider 可用性由 TtsProvider 单独解析。 */
export function ttsAvailable(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

function ensureSpeechReady(): boolean {
  try {
    const synth = window.speechSynthesis;
    if (!synth) return false;
    const voices = synth.getVoices();
    if (synth.paused) synth.resume();
    return voices.length > 0 || true;
  } catch {
    return false;
  }
}

function createRecognition(): SpeechRecognitionLike | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any;
  const SR = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  if (!SR) return null;
  return new SR() as SpeechRecognitionLike;
}

/** 去除整段重复的流式回复；空文本返回空字符串，不抛错。 */
export function dedupeRepeatedText(text: string): string {
  const t = text.trim();
  if (!t) return "";
  const half = Math.floor(t.length / 2);
  if (half > 24 && t.slice(0, half) === t.slice(half, half * 2)) {
    return t.slice(0, half).trim();
  }
  const paras = t.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  if (paras.length >= 2 && paras[0] === paras[1]) {
    const rest = paras.slice(1).every((p) => p === paras[0]);
    if (rest) return paras[0]!;
  }
  return t;
}

/** 合并识别片段；处理完整覆盖、包含和最长首尾重叠，避免 final 分段丢字或重复。 */
export function mergeRecognitionText(previous: string, incoming: string): string {
  const left = previous.trim();
  const right = incoming.trim();
  if (!left) return right;
  if (!right || left === right || left.endsWith(right)) return left;
  if (right.startsWith(left)) return right;
  if (left.includes(right)) return left;
  if (right.includes(left)) return right;
  const maxOverlap = Math.min(left.length, right.length);
  for (let size = maxOverlap; size >= 1; size -= 1) {
    if (left.slice(-size) === right.slice(0, size)) {
      return `${left}${right.slice(size)}`;
    }
  }
  return `${left}${right}`;
}

/** 生成短时去重指纹；忽略空白和常见标点，保留字母数字与中文。 */
export function transcriptFingerprint(text: string): string {
  return text
    .toLocaleLowerCase()
    .replace(/[\s，。！？、,.!?;；:：'"“”‘’（）()\-]/g, "");
}

/**
 * ASR 文本与助手刚播报内容的相似度（0~1）。
 * 用于回声兜底：扬声器漏进麦克风时丢弃识别结果。
 */
export function echoSimilarity(asrText: string, spokenText: string): number {
  const a = transcriptFingerprint(asrText);
  const b = transcriptFingerprint(spokenText);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (b.includes(a) || a.includes(b)) {
    const shorter = Math.min(a.length, b.length);
    const longer = Math.max(a.length, b.length);
    return shorter / longer;
  }
  // 字符集合 Jaccard + 前缀重合
  const setA = new Set(a);
  const setB = new Set(b);
  let inter = 0;
  for (const ch of setA) if (setB.has(ch)) inter += 1;
  const union = setA.size + setB.size - inter;
  const jaccard = union > 0 ? inter / union : 0;
  const n = Math.min(12, a.length, b.length);
  let prefix = 0;
  for (let i = 0; i < n; i++) {
    if (a[i] === b[i]) prefix += 1;
    else break;
  }
  const prefixScore = n > 0 ? prefix / Math.min(12, Math.max(a.length, b.length, 1)) : 0;
  return Math.max(jaccard * 0.85, prefixScore);
}

const ECHO_SIMILARITY_THRESHOLD = 0.55;
/** 朗读中回声更严：系统音漏麦时常低于 0.55 */
const ECHO_SIMILARITY_SPEAKING = 0.38;

export interface VoiceCallHandlers {
  onPhase: (phase: VoicePhase) => void;
  onInterim?: (text: string) => void;
  onUtterance: (text: string) => void;
  /** 致命错误（应结束通话） */
  onError?: (msg: string) => void;
  /** 非致命提示（如 TTS 回退）；不得挂断 */
  onNotice?: (msg: string) => void;
  onBargeIn?: () => void;
}

/**
 * 管理一次连续语音会话。
 * 依赖 Web Speech 与 speechSynthesis；停止、重启后旧 epoch 的识别/TTS 回调会被丢弃。
 */
export class VoiceCallSession {
  private rec: SpeechRecognitionLike | null = null;
  private micStream: MediaStream | null = null;
  private handlers: VoiceCallHandlers;
  private running = false;
  private phase: VoicePhase = "idle";
  private gate: UtteranceGate = "open";
  /** 等待本轮 LLM：垫话播完也不开麦，避免回声掐掉 stream */
  private awaitingAgentReply = false;
  private spokenThrough = 0;
  private speakQueue: SpeakItem[] = [];
  private speaking = false;
  private bridgeSpokenForTurn = false;
  private pendingText = "";
  /** 最近一次 ASR 更新是否含 isFinal（用于静音门时长） */
  private lastAsrHadFinal = false;
  private silenceTimer: ReturnType<typeof setTimeout> | null = null;
  private bargeInTimer: ReturnType<typeof setTimeout> | null = null;
  private ttsWatchdog: ReturnType<typeof setTimeout> | null = null;
  private listenRestartCount = 0;
  private lastListenRestartAt = 0;
  private lastBargeInAt = 0;
  private lastScheduledText = "";
  private lastScheduledHadFinal = false;
  private lastSentUtterance = "";
  private assistantEchoText = "";
  private assistantEchoUntil = 0;
  /** 最近播报片段，供回声相似度比对 */
  private assistantEchoChunks: string[] = [];
  private bargeCollecting = false;
  private epoch = 0;
  private recognitionGeneration = 0;
  private ttsGeneration = 0;
  private resumeTimer: ReturnType<typeof setTimeout> | null = null;
  private recognitionTimer: ReturnType<typeof setTimeout> | null = null;
  private speakStartTimer: ReturnType<typeof setTimeout> | null = null;
  private recentTranscripts = new Map<string, number>();
  private activeTts: TtsProvider | null = null;
  private cachedTts: {
    provider: TtsProvider;
    fallbackReason?: string;
    routeReason?: string;
  } | null = null;
  private fallbackNoticeShown = false;
  private speakStartedAt = 0;
  /** 冷 Cosy 预热连续失败后，短时跳过等待以免每句空等 6s */
  private cosyWarmSkipUntil = 0;
  /** 本通话已提示过 Cosy 回退，避免每句 fouAlert */
  private cosyFallbackNoticed = false;
  /** 当前朗读回合；与 ChatPage voiceSpeakTurn 同步 */
  private activeSpeakTurn = 0;
  /** 唤醒短确认后的回声过滤截止 */
  private wakeGreetingUntil = 0;
  /** 主动打断后短时丢弃 ASR，避免尾音/回声入对话 */
  private asrIgnoreUntil = 0;
  /** P1 工程双工 spike（localStorage 开启） */
  private duplexSpike: VoiceDuplexSpike | null = null;
  /** Cosy 背压：流式未入队的全文，播完一段再继续切 */
  private pendingSpeakFullText = "";
  private pendingSpeakTurn = 0;
  private onSettingsChanged: (() => void) | null = null;

  constructor(handlers: VoiceCallHandlers) {
    this.handlers = handlers;
    if (typeof window !== "undefined") {
      this.onSettingsChanged = () => {
        this.cachedTts = null;
        this.cosyWarmSkipUntil = 0;
        this.cosyFallbackNoticed = false;
      };
      window.addEventListener("xu:voice-settings-changed", this.onSettingsChanged);
    }
  }

  get active() {
    return this.running;
  }

  get currentPhase() {
    return this.phase;
  }

  /** 申请麦克风并启动连续识别；权限或引擎不可用时通过 onError 返回 false。 */
  async start(): Promise<boolean> {
    if (this.running) return true;
    const epoch = ++this.epoch;
    abortGlobalSpeechRecognition();
    if (!speechRecognitionAvailable()) {
      this.handlers.onError?.(
        "当前环境不支持语音识别。请在系统设置 → 隐私 → 麦克风 中为本应用授权后重启，或改用文字输入。",
      );
      return false;
    }
    try {
      this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
    } catch {
      this.handlers.onError?.(
        "无法使用麦克风。请在系统设置中允许虚募阁访问麦克风后重试。",
      );
      return false;
    }
    if (epoch !== this.epoch) {
      this.releaseMic();
      return false;
    }
    this.running = true;
    this.gate = "open";
    this.pendingText = "";
    this.assistantEchoText = "";
    this.assistantEchoChunks = [];
    this.bargeCollecting = false;
    this.clearSilenceTimer();
    this.clearBargeInTimer();
    this.clearTtsWatchdog();
    this.listenRestartCount = 0;
    this.lastListenRestartAt = 0;
    this.lastBargeInAt = 0;
    this.lastSentUtterance = "";
    this.recentTranscripts.clear();
    this.fallbackNoticeShown = false;
    this.setPhase("listening");
    ensureSpeechReady();
    this.ensureRecognition();
    return true;
  }

  /** 停止当前通话、TTS、识别和麦克风轨道；重复调用安全。 */
  stop() {
    this.epoch += 1;
    this.running = false;
    this.gate = "hold";
    this.bargeCollecting = false;
    this.pendingText = "";
    this.clearAllTimers();
    this.cancelSpeech();
    this.stopDuplexSpike();
    this.releaseRec();
    this.releaseMic();
    this.cachedTts = null;
    this.awaitingAgentReply = false;
    if (this.onSettingsChanged && typeof window !== "undefined") {
      window.removeEventListener("xu:voice-settings-changed", this.onSettingsChanged);
      this.onSettingsChanged = null;
    }
    this.setPhase("idle");
  }

  /**
   * Duty: 用户点「打断」——停朗读/思考流并开麦，不把当前 ASR（易为回声）写入对话。
   * Failure: 未在通话中则忽略。
   */
  interruptSpeaking(): void {
    if (!this.running) return;
    if (this.phase !== "speaking" && this.phase !== "thinking") return;
    this.clearBargeInTimer();
    this.clearSilenceTimer();
    if (this.resumeTimer) {
      clearTimeout(this.resumeTimer);
      this.resumeTimer = null;
    }
    this.cancelSpeech();
    this.handlers.onBargeIn?.();
    this.pendingText = "";
    this.lastScheduledText = "";
    this.bargeCollecting = false;
    this.awaitingAgentReply = false;
    this.asrIgnoreUntil = Date.now() + 1_200;
    this.stopDuplexSpike();
    this.gate = "open";
    this.handlers.onInterim?.("");
    this.setPhase("listening");
    this.ensureRecognition();
  }

  /** 进入思考阶段：关麦、禁止打断；不再播固定垫话（易与正文抢麦/字幕脱节）。 */
  markThinking() {
    if (!this.running) return;
    this.awaitingAgentReply = true;
    this.gate = "hold";
    this.bargeCollecting = false;
    this.pendingText = "";
    this.lastScheduledText = "";
    this.bridgeSpokenForTurn = false;
    this.clearSilenceTimer();
    this.clearBargeInTimer();
    if (this.resumeTimer) {
      clearTimeout(this.resumeTimer);
      this.resumeTimer = null;
    }
    this.cancelSpeech();
    this.releaseRec();
    this.setPhase("thinking");
  }

  /** Duty: 是否仍在等 LLM（关麦闸）。 */
  isAwaitingAgentReply(): boolean {
    return this.awaitingAgentReply;
  }

  /**
   * Duty: LLM 本轮结束（成功/失败/取消）后调用，允许恢复开麦。
   * 依赖: ChatPage sendMessage finally / stream done / markError。
   */
  notifyAgentIdle(opts?: { resumeListen?: boolean }) {
    this.awaitingAgentReply = false;
    if (!this.running) return;
    if (this.speaking) return;
    if (this.speakQueue.length > 0) {
      this.pumpSpeakQueue();
      return;
    }
    if (opts?.resumeListen !== false) {
      // 默认在空闲时补开麦；显式 false 时留给随后的 speakCumulative
      if (opts?.resumeListen === true) {
        this.resumeListenSoon(POST_TTS_LISTEN_DELAY_MS);
      }
    }
  }

  /**
   * 绑定当前朗读回合；过期 turn 的队列项与 speakCumulative 会被丢弃。
   */
  setSpeakTurn(turn: number) {
    this.activeSpeakTurn = turn;
    // 新回合清掉上轮 Mode A instruct，避免串到下一句
    saveVoiceSessionOverride({ llmTtsInstruct: "" });
  }

  /**
   * 模式/识别/合成失败：圆圈进失败态；默认可短暂停留后回聆听，不连环重试。
   */
  markError(opts?: { resumeMs?: number }) {
    if (!this.running) return;
    this.awaitingAgentReply = false;
    this.gate = "hold";
    this.bargeCollecting = false;
    this.pendingText = "";
    this.clearSilenceTimer();
    this.clearBargeInTimer();
    this.cancelSpeech();
    this.releaseRec();
    this.setPhase("error");
    const resumeMs = opts?.resumeMs ?? 2800;
    if (resumeMs <= 0) return;
    const epoch = this.epoch;
    if (this.resumeTimer) clearTimeout(this.resumeTimer);
    this.resumeTimer = window.setTimeout(() => {
      this.resumeTimer = null;
      if (!this.running || epoch !== this.epoch) return;
      if (this.phase !== "error") return;
      this.resumeListenSoon(0);
    }, resumeMs);
  }

  /**
   * Duty: 口令改人设后清 TTS 缓存，下一句按新路由合成。
   */
  clearTtsCache() {
    this.cachedTts = null;
  }

  /**
   * Duty: 登记唤醒确认语回声（「在呢」常被听成「在哪」），关麦后再开听。
   */
  markWakeGreeting(spoken = "在呢") {
    if (!this.running) return;
    const line = spoken.trim() || "在呢";
    this.noteAssistantSpoken(line);
    for (const alias of ["在哪", "这儿呢", "我在"]) {
      this.noteAssistantSpoken(alias);
    }
    this.wakeGreetingUntil = Date.now() + 8_000;
    this.gate = "hold";
    this.releaseRec();
    this.clearSilenceTimer();
    this.pendingText = "";
    this.resumeListenSoon(WAKE_GREETING_HOLD_MS);
  }

  /**
   * 朗读短确认（口令换语气/音色）。默认引擎为 Cosy 时走 Cosy，避免「预设 Cosy 却用 Windows 音」。
   */
  speakConfirm(text: string) {
    const line = text.trim();
    if (!this.running || !line) return;
    this.noteAssistantSpoken(line);
    this.gate = "hold";
    this.setPhase("speaking");
    this.releaseRec();
    const vs = loadVoiceSettings();
    const forceFast = vs.provider !== "cosyvoice";
    this.speakQueue.push({ text: line, forceFast, turn: this.activeSpeakTurn });
    this.pumpSpeakQueue();
  }

  /**
   * @deprecated 固定垫话已停用（与正文抢麦、字幕脱节）；保留空实现兼容旧调用。
   */
  speakBridge() {
    this.bridgeSpokenForTurn = true;
  }

  /**
   * 增量朗读累计回复；默认只读到句末，flush 时读完余量。
   * parseLlmTtsInstruct 已剥 TTS_INSTRUCT 与表演括号，只朗读给人听的正文。
   */
  speakCumulative(fullText: string, opts?: { flush?: boolean; turn?: number }) {
    if (!this.running) return;
    const turn = opts?.turn ?? this.activeSpeakTurn;
    if (opts?.turn != null && opts.turn !== this.activeSpeakTurn) return;
    const parsed = parseLlmTtsInstruct(fullText);
    persistLlmTtsInstructForEngine(parsed.ttsInstruct);
    const vs = loadVoiceSettings();
    const clean = parsed.answerText
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    // 男声 + Cosy 且无真男参考音时会回退 Kokoro（ttsProvider I2）；勿按 Cosy 小切块
    const offlineBatch =
      vs.provider === "cosyvoice" && vs.voiceGender === "male";
    const cosyChunk = vs.provider === "cosyvoice" && !offlineBatch;
    const flushDone = Boolean(opts?.flush);
    // Cosy 流结束仍按句切；Kokoro 回退允许 flush 吃掉余量
    const hardFlush = flushDone && !cosyChunk;
    this.pendingSpeakFullText = fullText;
    this.pendingSpeakTurn = turn;
    // 流式背压：Cosy 最多 2 段；Kokoro 回退串行 1 段（减少叠音卡顿）
    if ((cosyChunk || offlineBatch) && !hardFlush) {
      const inflight = this.speakQueue.length + (this.speaking ? 1 : 0);
      const maxInflight = offlineBatch ? 1 : 2;
      if (inflight >= maxInflight) {
        return;
      }
    }
    const earlyFirst = this.spokenThrough === 0;
    const limit = speakLimit(clean, this.spokenThrough, hardFlush, {
      earlyFirst,
      cosyChunk,
      offlineBatch,
    });
    if (limit <= this.spokenThrough) {
      if (flushDone && !this.speaking && this.speakQueue.length === 0) {
        this.pendingSpeakFullText = "";
        this.resumeListenSoon(POST_TTS_LISTEN_DELAY_MS);
      }
      return;
    }
    const chunk = clean.slice(this.spokenThrough, limit).trim();
    // 跳过纯标点碎段（日志：chunkLen=1「。」单独走 Kokoro）
    if (chunk && /^[。！？；.!?\s]+$/.test(chunk)) {
      this.spokenThrough = limit;
      if (this.spokenThrough >= clean.length) this.pendingSpeakFullText = "";
      if (flushDone && !this.speaking && this.speakQueue.length === 0) {
        this.resumeListenSoon(POST_TTS_LISTEN_DELAY_MS);
      }
      return;
    }
    this.spokenThrough = limit;
    if (this.spokenThrough >= clean.length) {
      this.pendingSpeakFullText = "";
    } else if (flushDone && cosyChunk) {
      // 流已结束但还有余量：留给 drain 继续按句切
      this.pendingSpeakFullText = fullText;
    }
    if (!chunk) {
      if (flushDone && !this.speaking && this.speakQueue.length === 0) {
        this.resumeListenSoon(POST_TTS_LISTEN_DELAY_MS);
      }
      return;
    }
    this.assistantEchoText = clean.slice(0, 120);
    this.assistantEchoUntil = Date.now() + 90_000;
    this.noteAssistantSpoken(chunk);
    this.gate = "hold";
    this.bargeCollecting = false;
    this.clearBargeInTimer();
    this.clearSilenceTimer();
    this.releaseRec();
    this.setPhase("speaking");
    this.speakQueue.push({ text: chunk, turn });
    this.pumpSpeakQueue();
    // Cosy 流结束时尽量再入一队，保持边切边播
    if (flushDone && cosyChunk && this.pendingSpeakFullText) {
      this.drainPendingCosySpeak();
    }
  }

  /** Cosy / Kokoro 回退背压解除后继续切下一段。 */
  private drainPendingCosySpeak() {
    if (!this.pendingSpeakFullText || !this.running) return;
    const vs = loadVoiceSettings();
    if (vs.provider !== "cosyvoice") return;
    const offlineBatch = vs.voiceGender === "male";
    const inflight = this.speakQueue.length + (this.speaking ? 1 : 0);
    if (inflight >= (offlineBatch ? 1 : 2)) return;
    const text = this.pendingSpeakFullText;
    const turn = this.pendingSpeakTurn;
    this.speakCumulative(text, { flush: offlineBatch, turn });
  }

  /**
   * 为新一轮回复重置增量朗读游标。
   * preserveFast：只清 LLM 游标，保留队列里 forceFast 短确认（如口令回执）。
   */
  resetSpeakCursor(opts?: { preserveBridge?: boolean; preserveFast?: boolean }) {
    this.spokenThrough = 0;
    this.pendingSpeakFullText = "";
    if (opts?.preserveFast || opts?.preserveBridge) {
      this.speakQueue = this.speakQueue.filter((item) => item.forceFast);
      this.clearBargeInTimer();
      return;
    }
    this.speakQueue = [];
    this.bridgeSpokenForTurn = false;
    this.cancelSpeech();
    this.clearBargeInTimer();
  }

  /** 在 TTS 后延迟恢复识别；epoch 已失效时不再启动麦克风链路。 */
  resumeListenSoon(delayMs = POST_TTS_LISTEN_DELAY_MS) {
    if (!this.running) return;
    // 等 LLM 期间禁止开麦（垫话结束/误调 resume 都会走到这里）
    if (this.awaitingAgentReply) return;
    const epoch = this.epoch;
    this.clearBargeInTimer();
    if (this.resumeTimer) clearTimeout(this.resumeTimer);
    this.bargeCollecting = false;
    // 播报刚结束：保持 hold，延长回声窗，勿立刻清 echo 缓冲
    this.gate = "hold";
    this.assistantEchoUntil = Date.now() + ECHO_TAIL_MS + delayMs;
    this.resumeTimer = window.setTimeout(() => {
      this.resumeTimer = null;
      if (!this.running || epoch !== this.epoch) return;
      if (this.awaitingAgentReply) return;
      this.gate = "open";
      this.pendingText = "";
      this.lastScheduledText = "";
      this.lastSentUtterance = "";
      this.listenRestartCount = 0;
      this.handlers.onInterim?.("");
      this.setPhase("listening");
      this.assistantEchoUntil = Date.now() + ECHO_TAIL_MS;
      ensureSpeechReady();
      try {
        window.speechSynthesis?.cancel();
      } catch {
        /* ignore */
      }
      this.ensureRecognition();
      // 延迟清空播报缓存，给房间混响留过滤时间
      window.setTimeout(() => {
        if (epoch !== this.epoch) return;
        if (Date.now() >= this.assistantEchoUntil) {
          this.assistantEchoText = "";
          this.assistantEchoChunks = [];
        }
      }, ECHO_TAIL_MS);
    }, delayMs);
  }

  private releaseMic() {
    this.micStream?.getTracks().forEach((t) => t.stop());
    this.micStream = null;
  }

  private releaseRec() {
    this.recognitionGeneration += 1;
    try {
      this.rec?.abort();
    } catch {
      /* ignore */
    }
    if (this.rec === globalRec) {
      globalRec = null;
      globalRecOwner = null;
    }
    this.rec = null;
  }

  private clearSilenceTimer() {
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
  }

  private clearBargeInTimer() {
    if (this.bargeInTimer) {
      clearTimeout(this.bargeInTimer);
      this.bargeInTimer = null;
    }
  }

  private clearTtsWatchdog() {
    if (this.ttsWatchdog) {
      clearTimeout(this.ttsWatchdog);
      this.ttsWatchdog = null;
    }
  }

  private clearAllTimers() {
    this.clearSilenceTimer();
    this.clearBargeInTimer();
    this.clearTtsWatchdog();
    if (this.resumeTimer) clearTimeout(this.resumeTimer);
    if (this.recognitionTimer) clearTimeout(this.recognitionTimer);
    if (this.speakStartTimer) clearTimeout(this.speakStartTimer);
    this.resumeTimer = null;
    this.recognitionTimer = null;
    this.speakStartTimer = null;
  }

  private scheduleBargeInGate() {
    this.clearBargeInTimer();
    if (!this.running) return;
    // 默认朗读中不开麦：TTS 回声会被 Web Speech 识别成用户输入，污染对话
    if (!ALLOW_BARGE_WHILE_SPEAKING) {
      return;
    }
    const epoch = this.epoch;
    const delay =
      this.phase === "speaking" ? SPEAK_BARGE_GRACE_MS : BARGE_IN_LISTEN_DELAY_MS;
    this.bargeInTimer = setTimeout(() => {
      this.bargeInTimer = null;
      if (!this.running || epoch !== this.epoch) return;
      if (this.phase === "thinking" || this.phase === "speaking") {
        this.gate = "barge";
        this.ensureRecognition();
      }
    }, delay);
  }

  private noteAssistantSpoken(chunk: string) {
    const t = chunk.trim();
    if (!t) return;
    this.assistantEchoChunks.push(t);
    if (this.assistantEchoChunks.length > 24) {
      this.assistantEchoChunks.splice(0, this.assistantEchoChunks.length - 24);
    }
    this.assistantEchoText = this.assistantEchoChunks.join("").slice(-240);
    this.assistantEchoUntil = Date.now() + 60_000;
  }

  private scheduleSilenceFlush() {
    if (this.gate !== "open") return;
    const text = this.pendingText.trim();
    if (!text) return;
    if (
      text === this.lastScheduledText &&
      this.silenceTimer &&
      this.lastScheduledHadFinal === this.lastAsrHadFinal
    ) {
      return;
    }
    this.lastScheduledText = text;
    this.lastScheduledHadFinal = this.lastAsrHadFinal;
    this.clearSilenceTimer();
    const epoch = this.epoch;
    const silenceMs = this.lastAsrHadFinal ? SILENCE_MS_FINAL : SILENCE_MS_INTERIM;
    this.silenceTimer = setTimeout(() => {
      this.silenceTimer = null;
      this.lastScheduledText = "";
      if (!this.running || epoch !== this.epoch || this.gate !== "open") return;
      if (Date.now() < this.asrIgnoreUntil) {
        this.pendingText = "";
        this.handlers.onInterim?.("");
        return;
      }
      const utter = this.pendingText.trim();
      this.pendingText = "";
      this.handlers.onInterim?.("");
      if (!utter || this.isEcho(utter)) {
        return;
      }
      this.flushUtterance(utter);
    }, silenceMs);
  }

  private isEcho(display: string): boolean {
    const norm = display.trim();
    if (!norm) return true;
    const compact = norm.replace(/\s+/g, "");
    if (
      Date.now() < this.wakeGreetingUntil &&
      WAKE_GREETING_ECHO_RE.test(compact)
    ) {
      return true;
    }
    const fingerprint = transcriptFingerprint(norm);
    const sentFingerprint = transcriptFingerprint(this.lastSentUtterance);
    if (fingerprint && fingerprint === sentFingerprint) return true;
    if (sentFingerprint && fingerprint.startsWith(sentFingerprint)) {
      return fingerprint.length <= sentFingerprint.length + 1;
    }
    // 思考/播报状态锁：打断开麦（gate=barge / 正在收集插话）时不整段丢弃，只走相似度
    const bargeListen = this.gate === "barge" || this.bargeCollecting;
    if (
      !bargeListen &&
      (this.phase === "thinking" || this.phase === "speaking" || this.phase === "error")
    ) {
      return true;
    }
    if (!bargeListen && this.gate === "hold") return true;
    if (Date.now() > this.assistantEchoUntil && this.assistantEchoChunks.length === 0) {
      return false;
    }
    const joined = this.assistantEchoChunks.join("") || this.assistantEchoText;
    if (!joined) return false;
    const thr =
      this.phase === "speaking" || this.phase === "thinking"
        ? ECHO_SIMILARITY_SPEAKING
        : ECHO_SIMILARITY_THRESHOLD;
    if (echoSimilarity(norm, joined) >= thr) return true;
    // 与单段近期播报比对
    for (let i = this.assistantEchoChunks.length - 1; i >= 0; i--) {
      const chunk = this.assistantEchoChunks[i]!;
      if (echoSimilarity(norm, chunk) >= thr) return true;
    }
    const echo = transcriptFingerprint(joined);
    if (!echo || !fingerprint) return false;
    if (fingerprint === echo) return true;
    if (echo.includes(fingerprint) && fingerprint.length >= 4) return true;
    const prefix = echo.slice(0, Math.min(16, echo.length));
    if (prefix.length >= 4 && fingerprint.includes(prefix)) return true;
    return false;
  }

  private flushUtterance(utter: string) {
    const text = utter.trim();
    if (!text || this.isEcho(text)) return;
    const fingerprint = transcriptFingerprint(text);
    const now = Date.now();
    for (const [key, at] of this.recentTranscripts) {
      if (now - at > TRANSCRIPT_DEDUPE_MS) this.recentTranscripts.delete(key);
    }
    if (fingerprint && now - (this.recentTranscripts.get(fingerprint) ?? 0) <= TRANSCRIPT_DEDUPE_MS) {
      return;
    }
    if (fingerprint) this.recentTranscripts.set(fingerprint, now);
    this.lastSentUtterance = text;
    this.gate = "hold";
    this.bargeCollecting = false;
    this.clearSilenceTimer();
    this.clearBargeInTimer();
    this.handlers.onUtterance(text);
  }

  private interruptAssistant(display: string, isFinal: boolean) {
    const norm = display.trim();
    const minChars =
      this.phase === "speaking" ? BARGE_IN_SPEAKING_MIN_CHARS : BARGE_IN_MIN_CHARS;
    if (norm.length < minChars || this.isEcho(norm)) {
      return;
    }
    const now = Date.now();
    if (
      this.phase === "speaking" &&
      this.speakStartedAt > 0 &&
      now - this.speakStartedAt < SPEAK_BARGE_GRACE_MS
    ) {
      return;
    }
    if (now - this.lastBargeInAt < BARGE_IN_DEBOUNCE_MS) return;
    this.lastBargeInAt = now;

    this.clearBargeInTimer();
    this.clearSilenceTimer();
    this.cancelSpeech();
    this.handlers.onBargeIn?.();
    this.gate = "open";
    this.bargeCollecting = true;

    this.pendingText = mergeRecognitionText(this.pendingText, norm);
    this.handlers.onInterim?.(norm);
    this.setPhase("listening");
    this.scheduleSilenceFlush();
    if (isFinal) this.bargeCollecting = true;
    this.ensureRecognition();
  }

  private setPhase(p: VoicePhase) {
    const prev = this.phase;
    this.phase = p;
    this.handlers.onPhase(p);
    if (p === "speaking" && prev !== "speaking") {
      this.startDuplexSpike();
    } else if (p !== "speaking" && prev === "speaking") {
      this.stopDuplexSpike();
    }
  }

  private startDuplexSpike() {
    // P1 spike 默认不启：朗读卡死无声优先恢复；需试验时再开 localStorage xu.voice.duplexSpike=1
    if (!isDuplexSpikeEnabled() || this.duplexSpike) return;
    const spike = new VoiceDuplexSpike({
      onBarge: () => {
        // spike 开启时才接线：打断当前朗读并通知 ChatPage 停流
        this.interruptSpeaking();
        this.handlers.onBargeIn?.();
      },
    });
    this.duplexSpike = spike;
    void spike.start().then((ok) => {
      if (!ok && this.duplexSpike === spike) this.duplexSpike = null;
    });
  }

  private stopDuplexSpike() {
    this.duplexSpike?.stop();
    this.duplexSpike = null;
    clearTap();
  }

  private ensureRecognition() {
    if (!this.running) return;
    // 状态锁：思考/播报 hold 期间禁止开麦，避免 TTS 回声进 ASR
    if (this.gate === "hold") return;
    if (
      this.phase === "thinking" ||
      this.phase === "error" ||
      (this.phase === "speaking" && !ALLOW_BARGE_WHILE_SPEAKING)
    ) {
      return;
    }
    if (this.rec) return;
    const now = Date.now();
    if (now - this.lastListenRestartAt < LISTEN_RESTART_GAP_MS) {
      const epoch = this.epoch;
      if (this.recognitionTimer) clearTimeout(this.recognitionTimer);
      this.recognitionTimer = window.setTimeout(() => {
        this.recognitionTimer = null;
        if (epoch === this.epoch) this.ensureRecognition();
      }, LISTEN_RESTART_GAP_MS);
      return;
    }
    this.lastListenRestartAt = now;
    this.listenRestartCount += 1;
    if (this.listenRestartCount > LISTEN_RESTART_MAX) {
      this.handlers.onError?.("语音识别反复中断，已自动结束通话。请改用文字输入。");
      this.markError({ resumeMs: 0 });
      this.stop();
      return;
    }
    if (globalRecOwner === "dictation" || globalRecOwner === "wake") abortGlobalSpeechRecognition();
    const rec = createRecognition();
    if (!rec) {
      this.handlers.onError?.("无法创建语音识别引擎。");
      this.markError();
      return;
    }
    this.rec = rec;
    const epoch = this.epoch;
    const generation = ++this.recognitionGeneration;
    const isCurrent = () =>
      this.running &&
      epoch === this.epoch &&
      generation === this.recognitionGeneration &&
      this.rec === rec;
    globalRec = rec;
    globalRecOwner = "call";
    rec.lang = "zh-CN";
    rec.continuous = true;
    rec.interimResults = true;
    rec.onstart = () => {
      if (!isCurrent()) return;
      this.listenRestartCount = 0;
      if (this.gate === "open" && !this.bargeCollecting) {
        this.setPhase("listening");
      }
    };
    rec.onerror = (ev: Event) => {
      if (!isCurrent()) return;
      const code = String((ev as Event & { error?: string }).error ?? "");
      const msg = speechErrorMessage(code);
      if (msg) {
        this.handlers.onError?.(msg);
        this.stop();
        return;
      }
      if (code === "aborted" || code === "no-speech") return;
      if (this.rec === globalRec) {
        globalRec = null;
        globalRecOwner = null;
      }
      this.rec = null;
      this.recognitionGeneration += 1;
      this.recognitionTimer = window.setTimeout(
        () => {
          this.recognitionTimer = null;
          if (epoch === this.epoch) this.ensureRecognition();
        },
        LISTEN_RESTART_GAP_MS + 200,
      );
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rec.onresult = (e: any) => {
      if (!isCurrent()) return;
      let interim = "";
      let finalText = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        const t = String(r[0]?.transcript ?? "");
        if (r.isFinal) finalText += t;
        else interim += t;
      }
      const stable = finalText.trim();
      const display = stable
        ? mergeRecognitionText(this.pendingText, stable)
        : mergeRecognitionText(this.pendingText, interim);
      if (!display) return;
      this.lastAsrHadFinal = Boolean(stable);
      if (Date.now() < this.asrIgnoreUntil) {
        this.pendingText = "";
        this.handlers.onInterim?.("");
        return;
      }

      if (this.bargeCollecting) {
        this.pendingText = display;
        this.handlers.onInterim?.(display);
        this.scheduleSilenceFlush();
        return;
      }

      if (this.gate === "barge") {
        this.interruptAssistant(display, Boolean(stable));
        return;
      }

      if (this.gate === "hold") return;

      this.pendingText = display;
      this.handlers.onInterim?.(display);
      this.scheduleSilenceFlush();

    };
    rec.onend = () => {
      if (!isCurrent()) return;
      if (this.rec === globalRec) {
        globalRec = null;
        globalRecOwner = null;
      }
      this.rec = null;
      this.recognitionGeneration += 1;
      if (!this.running) return;
      if (
        this.gate === "open" &&
        this.pendingText.trim() &&
        !this.isEcho(this.pendingText.trim())
      ) {
        // 证据：onend 硬 flush 会截断长句；改为按静音门再提交
        this.scheduleSilenceFlush();
      }
      // hold / 思考 / 播报：不要自动重启识别（状态锁）
      if (
        this.gate === "hold" ||
        this.phase === "thinking" ||
        this.phase === "error" ||
        (this.phase === "speaking" && !ALLOW_BARGE_WHILE_SPEAKING)
      ) {
        return;
      }
      this.recognitionTimer = window.setTimeout(
        () => {
          this.recognitionTimer = null;
          if (epoch === this.epoch) this.ensureRecognition();
        },
        LISTEN_RESTART_GAP_MS,
      );
    };
    try {
      rec.start();
    } catch {
      this.rec = null;
      this.recognitionGeneration += 1;
      this.recognitionTimer = window.setTimeout(
        () => {
          this.recognitionTimer = null;
          if (epoch === this.epoch) this.ensureRecognition();
        },
        LISTEN_RESTART_GAP_MS + 180,
      );
    }
  }

  private cancelSpeech() {
    this.ttsGeneration += 1;
    if (this.assistantEchoText) {
      this.assistantEchoUntil = Date.now() + ECHO_GUARD_MS;
    }
    this.speakQueue = [];
    this.speaking = false;
    this.clearTtsWatchdog();
    try {
      window.speechSynthesis?.cancel();
    } catch {
      /* ignore */
    }
    this.activeTts?.cancel();
    this.activeTts = null;
  }

  private pumpSpeakQueue() {
    if (this.speaking) return;
    let next = this.speakQueue.shift();
    while (next && next.turn != null && next.turn !== this.activeSpeakTurn) {
      next = this.speakQueue.shift();
    }
    if (!next) {
      // 垫话/队列播完时若仍在等 LLM，保持关麦，勿 resume 打断本轮
      if (this.awaitingAgentReply) {
        this.gate = "hold";
        this.releaseRec();
        return;
      }
      this.resumeListenSoon(POST_TTS_LISTEN_DELAY_MS);
      return;
    }
    this.speaking = true;
    this.speakStartedAt = Date.now();
    const epoch = this.epoch;
    const generation = ++this.ttsGeneration;
    const isCurrent = () =>
      this.running && epoch === this.epoch && generation === this.ttsGeneration;
    this.gate = "hold";
    this.setPhase("speaking");
    // 正文才开打断；垫话/确认语 forceFast 保持关麦，避免回声掐掉 LLM
    if (!next.forceFast) {
      this.scheduleBargeInGate();
    }
    if (this.speakStartTimer) clearTimeout(this.speakStartTimer);
    this.speakStartTimer = window.setTimeout(async () => {
      this.speakStartTimer = null;
      if (!isCurrent()) {
        this.speaking = false;
        return;
      }
      ensureSpeechReady();
      const settings = loadVoiceSettings();
      let resolved: {
        provider: TtsProvider;
        fallbackReason?: string;
        routeReason?: string;
      };
      if (next.forceFast) {
        resolved = await resolveTtsProvider(settings, {
          forVoiceCall: true,
          forceProvider: "system-webspeech",
        });
      } else {
        const softStuck =
          this.cachedTts?.routeReason === "call-realtime-system" &&
          settings.provider === "cosyvoice";
        if (!this.cachedTts || softStuck) {
          const again = await resolveTtsProvider(settings, { forVoiceCall: true });
          if (!this.cachedTts || again.routeReason !== "call-realtime-system") {
            this.cachedTts = again;
          }
        }
        resolved = this.cachedTts!;
        if (resolved.provider.id === "cosyvoice" && !isCosyFastapiWarmFresh()) {
          const base = (settings.cosyFastapiBaseUrl || "").trim();
          const probe = base
            ? await probeFastapiUrl(base).catch(() => ({ ready: false, reason: "probe-throw" }))
            : { ready: false, reason: "no-base" };
          // 证据 voice-ux28：probe.ready 仍 firstMs 4.5–8s；未 warmFresh 时硬等 = 用户感知无声
          void warmCosyFastapiQuiet({ force: true });
          const preferSherpa = !toneRequiresCosy(settings.timbreId || settings.toneId);
          this.cachedTts = null;
          resolved = await resolveTtsProvider(settings, {
            forVoiceCall: true,
            forceProvider: preferSherpa ? "sherpa-onnx" : "system-webspeech",
          });
          if (!this.cosyFallbackNoticed) {
            this.cosyFallbackNoticed = true;
            this.handlers.onNotice?.(
              preferSherpa
                ? "Cosy 预热中，本句先用离线音，保证及时开口。"
                : "Cosy 预热中，本句先用系统音，保证及时开口。",
            );
          }
        }
      }
      if (!isCurrent()) {
        resolved.provider.cancel();
        this.speaking = false;
        return;
      }
      const baseBudget = next.text.length * 220 + 4000;
      // Cosy 单句常 >28s（日志 71 字 ~34s）；冷启动地板过低会误触「改用系统音」
      const providerFloor =
        resolved.provider.id === "cosyvoice"
          ? isCosyFastapiWarmFresh()
            ? 75_000
            : 55_000
          : 8_000;
      const maxMs = Math.min(120_000, Math.max(providerFloor, baseBudget));
      this.clearTtsWatchdog();
      const speakText = next.text;
      const startedProviderId = resolved.provider.id;
      this.ttsWatchdog = setTimeout(() => {
        this.ttsWatchdog = null;
        if (!this.speaking || !isCurrent()) return;
        this.activeTts?.cancel();
        try {
          window.speechSynthesis?.cancel();
        } catch {
          /* ignore */
        }
        if (startedProviderId === "cosyvoice") {
          // 禁止切系统音（与 soft-timeout 同症）；跳过本段继续 Cosy 队列
          this.speaking = false;
          this.activeTts = null;
          this.drainPendingCosySpeak();
          this.pumpSpeakQueue();
          return;
        }
        this.speaking = false;
        this.activeTts = null;
        this.pumpSpeakQueue();
      }, maxMs);
      const finish = () => {
        if (!isCurrent()) return;
        this.clearTtsWatchdog();
        this.speaking = false;
        this.activeTts = null;
        this.assistantEchoUntil = Date.now() + ECHO_GUARD_MS;
        if (startedProviderId === "cosyvoice") {
          markCosyFastapiSpoke(settings);
        }
        this.drainPendingCosySpeak();
        this.pumpSpeakQueue();
      };
      try {
        if (resolved.fallbackReason && !this.fallbackNoticeShown) {
          this.fallbackNoticeShown = true;
          this.handlers.onNotice?.(resolved.fallbackReason);
        }
        if (!isCurrent()) {
          resolved.provider.cancel();
          return;
        }
        ensureSpeechReady();
        this.activeTts = resolved.provider;
        try {
          // 禁止 soft-timeout 切系统音（证据：截图「Cosy 较慢」+ 日志 soft-timeout）
          await resolved.provider.speak(next.text, settings);
        } catch (firstErr) {
          const msg = firstErr instanceof Error ? firstErr.message : String(firstErr);
          if (next.forceFast || resolved.provider.id === "system-webspeech") {
            throw firstErr;
          }
          this.handlers.onNotice?.(
            `${msg}。语音引擎还在加载，本句改用系统音，通话继续。`,
          );
          this.cachedTts = null;
          const fallback = await resolveTtsProvider(settings, {
            forVoiceCall: true,
            forceProvider: "system-webspeech",
          });
          this.activeTts = fallback.provider;
          await fallback.provider.speak(next.text, settings);
        }
        finish();
      } catch (error) {
        if (!isCurrent()) return;
        const message = error instanceof Error ? error.message : "语音朗读失败";
        const fatal =
          /不可用|未配置|无法解析|不支持|模式失败|引擎不可用/i.test(message) &&
          !/本段|继续通话|还在加载/i.test(message);
        if (fatal) {
          this.handlers.onError?.(
            toUserError(error, "语音暂时不可用。请到「设置 → 语音与朗读」检查引擎。"),
          );
          this.markError();
          return;
        }
        // 单段失败不挂断整通；跳过本段后继续听
        this.handlers.onNotice?.(
          `${message}。本段未合成，已继续通话。请到「设置 → 语音与朗读」检查引擎与系统音量。`,
        );
        finish();
      }
    }, 50);
  }
}

if (typeof window !== "undefined" && "speechSynthesis" in window) {
  window.speechSynthesis.onvoiceschanged = () => {
    window.speechSynthesis.getVoices();
  };
}

/**
 * 启动一次输入框听写并返回停止函数。
 * 依赖 Web Speech 和麦克风权限；不支持或授权失败时调用 onError。
 */
export function startOneShotDictation(opts: {
  onText: (text: string) => void;
  onStart?: () => void;
  onEnd?: () => void;
  onError?: (msg: string) => void;
}): () => void {
  if (!speechRecognitionAvailable()) {
    opts.onError?.("当前环境不支持语音识别。请在系统设置中为本应用授权麦克风。");
    return () => {};
  }

  let stopped = false;
  let rec: SpeechRecognitionLike | null = null;
  let micStream: MediaStream | null = null;
  let pending = "";
  let stableText = "";
  let recStarted = false;
  let ended = false;

  const finish = (deliver: boolean) => {
    if (ended) return;
    ended = true;
    if (deliver && pending.trim()) opts.onText(pending.trim());
    pending = "";
    micStream?.getTracks().forEach((t) => t.stop());
    micStream = null;
    if (rec === globalRec) {
      globalRec = null;
      globalRecOwner = null;
    }
    rec = null;
    opts.onEnd?.();
  };

  void (async () => {
    if (globalRecOwner === "call" || globalRecOwner === "wake") abortGlobalSpeechRecognition();
    try {
      micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      opts.onError?.("无法使用麦克风。请在系统设置中允许虚募阁访问麦克风后重试。");
      finish(false);
      return;
    }
    if (stopped) {
      finish(false);
      return;
    }

    rec = createRecognition();
    if (!rec) {
      opts.onError?.("无法创建语音识别引擎。");
      finish(false);
      return;
    }

    globalRec = rec;
    globalRecOwner = "dictation";
    opts.onStart?.();

    rec.lang = "zh-CN";
    rec.continuous = true;
    rec.interimResults = true;
    rec.onerror = (ev: Event) => {
      const code = String((ev as Event & { error?: string }).error ?? "");
      const msg = speechErrorMessage(code);
      if (!msg) return;
      opts.onError?.(msg);
      stopped = true;
      try {
        rec?.abort();
      } catch {
        /* finish below owns cleanup */
      }
      finish(false);
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rec.onresult = (e: any) => {
      let interim = "";
      let finalText = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        const t = String(r[0]?.transcript ?? "");
        if (r.isFinal) finalText += t;
        else interim += t;
      }
      if (finalText.trim()) {
        stableText = mergeRecognitionText(stableText, finalText);
      }
      pending = interim.trim()
        ? mergeRecognitionText(stableText, interim)
        : stableText;
    };
    rec.onend = () => {
      if (stopped) {
        finish(true);
        return;
      }
      if (!recStarted) {
        finish(false);
        return;
      }
      window.setTimeout(() => {
        if (stopped || !rec) return;
        try {
          rec.start();
        } catch {
          finish(true);
        }
      }, 280);
    };
    try {
      rec.start();
      recStarted = true;
    } catch (e) {
      opts.onError?.(toUserError(e));
      finish(false);
    }
  })();

  return () => {
    stopped = true;
    if (rec && recStarted) {
      try {
        rec.stop();
      } catch {
        try {
          rec.abort();
        } catch {
          finish(true);
        }
      }
    } else {
      finish(false);
    }
  };
}
