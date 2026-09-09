/**
 * @file 前台语音唤醒：优先本机 KWS，否则 Web Speech；命中后打开语音通话
 * @author qiuye <yjk150@qq.com>
 * @date 2026-09-01
 * @updated 2026-09-05
 * @version 1.6.0
 * @category Stream
 * @algo generation-guarded-mic-handoff
 */

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  DEFAULT_WAKE_PHRASES,
  loadVoiceSettings,
  type VoiceSettings,
} from "../stores/voiceSettings";
import {
  abortGlobalSpeechRecognition,
  getGlobalSpeechRecOwner,
  setGlobalSpeechRecOwner,
  speechRecognitionAvailable,
  transcriptFingerprint,
} from "./voiceCall";

const WAKE_DEBOUNCE_MS = 2_500;
/** 识别轮次间隔：过长会漏掉唤醒词 */
const RESTART_GAP_MS = 180;
const NETWORK_BACKOFF_MS = 2_500;
/** WebView2 上 zh-CN 常报 language-not-supported，按序回退 */
const WAKE_LANG_FALLBACKS = ["zh-CN", "zh-HK", "zh", "cmn-Hans-CN", "en-US"];

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

function createRecognition(): SpeechRecognitionLike | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any;
  const SR = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  if (!SR) return null;
  return new SR() as SpeechRecognitionLike;
}

/**
 * 在识别文本中匹配唤醒词；命中返回词本身，否则 null。
 * 归一化去标点；同音近音折叠（虚募阁↔畜牧格/徐莫格，嘿虚幕↔黑序幕）。
 */
export function matchWakePhrase(
  text: string,
  phrases: string[] = DEFAULT_WAKE_PHRASES,
): string | null {
  const hay = collapseWakePhonetic(text);
  if (!hay || hay.length < 2) return null;
  const sorted = [...phrases]
    .map((p) => p.trim())
    .filter(Boolean)
    .sort((a, b) => collapseWakePhonetic(b).length - collapseWakePhonetic(a).length);
  for (const phrase of sorted) {
    const needle = collapseWakePhonetic(phrase);
    if (needle.length < 2) continue;
    if (hay === needle || hay.includes(needle)) return phrase;
  }
  // 品牌三字兜底：折叠后出现「虚幕阁」即命中默认品牌词
  if (hay.includes("虚幕阁")) {
    const brand = sorted.find((p) => collapseWakePhonetic(p) === "虚幕阁");
    return brand || "虚募阁";
  }
  return null;
}

/** ASR / 词表统一：去标点，募幕慕归一。 */
function normalizeWakeText(text: string): string {
  return transcriptFingerprint(text).replace(/[募慕]/g, "幕");
}

/**
 * 同音近音折叠（证据：Web Speech 常把「虚募阁」听成畜牧格/徐莫格，「嘿虚幕」听成黑序幕）。
 * 不映射「区」→虚，避免「小区」误唤醒。
 */
function collapseWakePhonetic(text: string): string {
  return normalizeWakeText(text)
    .replace(/[虚徐序畜需许叙其奇骑启]/g, "虚")
    .replace(/[募幕慕牧莫木目]/g, "幕")
    .replace(/[阁格哥歌各]/g, "阁")
    .replace(/[嘿黑嗨]/g, "嘿");
}

export type VoiceWakeHandlers = {
  onWake: (phrase: string) => void;
  onError?: (msg: string) => void;
};

/** 设置页诚实提示用：开麦 ≠ ASR 已活。 */
export type VoiceWakeStatus = {
  micOpen: boolean;
  asrLive: boolean;
  lastError: string;
  /** call / dictation 占麦时无法启唤醒 */
  ownerBusy: boolean;
  /** kws | webspeech | "" */
  engine: string;
};

export type KwsProbe = { ready: boolean; reason: string };

/** 探测本机离线关键词模型。 */
export async function probeVoiceWakeKws(): Promise<KwsProbe> {
  try {
    return await invoke<KwsProbe>("xu_voice_wake_probe");
  } catch {
    return { ready: false, reason: "无法探测离线唤醒。" };
  }
}

/**
 * 前台轻量唤醒会话。与 call/dictation 互斥占用 Web Speech。
 */
export class VoiceWakeSession {
  private handlers: VoiceWakeHandlers;
  private running = false;
  private rec: SpeechRecognitionLike | null = null;
  private micStream: MediaStream | null = null;
  private lastHitAt = 0;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private generation = 0;
  private asrLive = false;
  private lastAsrError = "";
  private engine: "kws" | "webspeech" | "" = "";
  private audioCtx: AudioContext | null = null;
  private processor: ScriptProcessorNode | null = null;
  private unlistenKws: UnlistenFn | null = null;
  private networkBackoff = NETWORK_BACKOFF_MS;
  /** Web Speech 语言回退索引（language-not-supported 时轮换） */
  private wakeLangTry = 0;

  constructor(handlers: VoiceWakeHandlers) {
    this.handlers = handlers;
  }

  get active() {
    return this.running;
  }

  get status(): Omit<VoiceWakeStatus, "ownerBusy"> {
    return {
      micOpen: this.running && (this.engine === "kws" ? Boolean(this.micStream) : this.asrLive || this.running),
      asrLive: this.asrLive,
      lastError: this.lastAsrError,
      engine: this.engine,
    };
  }

  /** 启动唤醒监听；引擎不可用或权限拒绝时 onError 并返回 false。 */
  async start(): Promise<boolean> {
    if (this.running) return true;
    const startGeneration = ++this.generation;
    this.asrLive = false;
    this.lastAsrError = "";
    const owner = getGlobalSpeechRecOwner();
    if (owner === "call" || owner === "dictation") {
      this.lastAsrError = "owner-busy";
      return false;
    }
    abortGlobalSpeechRecognition();

    const kws = await probeVoiceWakeKws();
    if (startGeneration !== this.generation) return false;
    if (kws.ready) {
      const ok = await this.startKws(startGeneration);
      if (ok) return true;
    }
    return this.startWebSpeech(startGeneration);
  }

  private async startKws(startGeneration: number): Promise<boolean> {
    const phrases = loadVoiceSettings().wakePhrases;
    try {
      await invoke("xu_voice_wake_start", { input: { keywords: phrases } });
    } catch {
      return false;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
    } catch {
      await invoke("xu_voice_wake_stop").catch(() => undefined);
      this.lastAsrError = "mic-denied";
      this.handlers.onError?.(
        "无法使用麦克风开启语音唤醒。请在系统设置中允许虚募阁访问麦克风。",
      );
      return false;
    }
    if (startGeneration !== this.generation) {
      stream.getTracks().forEach((t) => t.stop());
      await invoke("xu_voice_wake_stop").catch(() => undefined);
      return false;
    }
    this.micStream = stream;
    this.running = true;
    this.engine = "kws";
    this.asrLive = true;
    try {
      this.unlistenKws = await listen<{ phrase?: string }>("xu:voice-wake", (ev) => {
        if (!this.running) return;
        const phrase = String(ev.payload?.phrase || "").trim() || phrases[0] || "虚募阁";
        this.emitWake(phrase);
      });
    } catch {
      /* 仍可 feed */
    }
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) {
      this.stop();
      return false;
    }
    const ctx = new Ctx();
    this.audioCtx = ctx;
    const src = ctx.createMediaStreamSource(stream);
    const proc = ctx.createScriptProcessor(4096, 1, 1);
    this.processor = proc;
    proc.onaudioprocess = (ev) => {
      if (!this.running || this.engine !== "kws") return;
      const input = ev.inputBuffer.getChannelData(0);
      const rate = ctx.sampleRate || 48000;
      const pcm = downsampleTo16k(input, rate);
      if (!pcm.length) return;
      void invoke("xu_voice_wake_feed", {
        samples: Array.from(pcm),
        sampleRate: 16000,
      }).catch(() => undefined);
    };
    const mute = ctx.createGain();
    mute.gain.value = 0;
    src.connect(proc);
    proc.connect(mute);
    mute.connect(ctx.destination);
    return true;
  }

  private async startWebSpeech(startGeneration: number): Promise<boolean> {
    if (!speechRecognitionAvailable()) {
      this.lastAsrError = "no-speech-api";
      this.handlers.onError?.("当前环境不支持语音识别，无法开启语音唤醒。");
      return false;
    }
    try {
      const tmp = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      tmp.getTracks().forEach((t) => t.stop());
    } catch {
      this.lastAsrError = "mic-denied";
      this.handlers.onError?.(
        "无法使用麦克风开启语音唤醒。请在系统设置中允许虚募阁访问麦克风。",
      );
      return false;
    }
    if (startGeneration !== this.generation) return false;
    this.running = true;
    this.engine = "webspeech";
    this.ensureRecognition();
    return true;
  }

  private emitWake(phrase: string) {
    const now = Date.now();
    if (now - this.lastHitAt < WAKE_DEBOUNCE_MS) return;
    this.lastHitAt = now;
    this.handlers.onWake(phrase);
  }

  /** 停止唤醒并释放麦克风。 */
  stop() {
    this.running = false;
    this.asrLive = false;
    this.generation += 1;
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    try {
      this.rec?.abort();
    } catch {
      /* ignore */
    }
    this.rec = null;
    if (getGlobalSpeechRecOwner() === "wake") {
      setGlobalSpeechRecOwner(null);
    }
    try {
      this.processor?.disconnect();
    } catch {
      /* ignore */
    }
    this.processor = null;
    void this.audioCtx?.close().catch(() => undefined);
    this.audioCtx = null;
    this.unlistenKws?.();
    this.unlistenKws = null;
    this.micStream?.getTracks().forEach((t) => t.stop());
    this.micStream = null;
    if (this.engine === "kws") {
      void invoke("xu_voice_wake_stop").catch(() => undefined);
    }
    this.engine = "";
  }

  /** 停止并等待识别器释放；超时也会强制完成，避免通话永久卡住。 */
  async stopAndWait(timeoutMs = 800): Promise<void> {
    const rec = this.rec;
    if (!rec) {
      this.stop();
      return;
    }
    await new Promise<void>((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        resolve();
      };
      const previousEnd = rec.onend;
      rec.onend = (event) => {
        previousEnd?.(event);
        finish();
      };
      this.stop();
      window.setTimeout(finish, timeoutMs);
    });
  }

  private ensureRecognition() {
    if (!this.running || this.rec || this.engine !== "webspeech") return;
    const rec = createRecognition();
    if (!rec) {
      this.running = false;
      this.handlers.onError?.("无法创建语音识别引擎。");
      return;
    }
    const gen = ++this.generation;
    const isCurrent = () => this.running && gen === this.generation && this.rec === rec;
    this.rec = rec;
    setGlobalSpeechRecOwner("wake");
    const preferred = loadVoiceSettings().wakeLang || "zh-CN";
    const langList = [preferred, ...WAKE_LANG_FALLBACKS.filter((l) => l !== preferred)];
    rec.lang = langList[this.wakeLangTry % langList.length] || preferred;
    rec.continuous = true;
    rec.interimResults = true;
    rec.onstart = () => {
      if (!isCurrent()) return;
      this.asrLive = true;
      this.lastAsrError = "";
      this.networkBackoff = NETWORK_BACKOFF_MS;
    };
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
      const display = (finalText || interim).trim();
      if (!display) return;
      const settings = loadVoiceSettings();
      const hit = matchWakePhrase(display, settings.wakePhrases);
      if (!hit) return;
      this.emitWake(hit);
    };
    rec.onerror = (ev: Event) => {
      if (!isCurrent()) return;
      const code = String((ev as Event & { error?: string }).error ?? "");
      if (code === "aborted") return;
      this.asrLive = false;
      this.lastAsrError = code || "asr-error";
      if (code === "not-allowed" || code === "service-not-allowed") {
        this.handlers.onError?.("麦克风权限被拒绝，语音唤醒已停止。");
        this.stop();
        return;
      }
      if (code === "language-not-supported") {
        this.wakeLangTry += 1;
        if (this.wakeLangTry >= langList.length) {
          this.handlers.onError?.(
            "当前环境无法使用在线语音识别（语言不支持）。请安装离线唤醒模型，或换用系统可用的识别语言。",
          );
          this.stop();
          return;
        }
        this.scheduleRestart(gen, RESTART_GAP_MS);
        return;
      }
      if (code === "no-speech" || code === "network" || code === "audio-capture") {
        this.scheduleRestart(gen, code === "network" ? this.networkBackoff : RESTART_GAP_MS);
        if (code === "network") {
          this.networkBackoff = Math.min(12_000, this.networkBackoff * 1.5);
        }
      }
    };
    rec.onend = () => {
      if (!isCurrent()) return;
      this.asrLive = false;
      this.rec = null;
      if (getGlobalSpeechRecOwner() === "wake") {
        setGlobalSpeechRecOwner(null);
      }
      if (!this.running) return;
      this.scheduleRestart(gen, RESTART_GAP_MS);
    };
    try {
      rec.start();
    } catch {
      this.rec = null;
      if (getGlobalSpeechRecOwner() === "wake") setGlobalSpeechRecOwner(null);
      this.scheduleRestart(gen, RESTART_GAP_MS + 200);
    }
  }

  private scheduleRestart(gen: number, delay: number) {
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = window.setTimeout(() => {
      this.restartTimer = null;
      if (this.running && gen === this.generation) this.ensureRecognition();
    }, delay);
  }
}

function downsampleTo16k(input: Float32Array, fromRate: number): Float32Array {
  if (!input.length) return new Float32Array(0);
  if (fromRate === 16000) return input;
  const ratio = fromRate / 16000;
  const outLen = Math.max(1, Math.floor(input.length / ratio));
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const src = Math.min(input.length - 1, Math.floor(i * ratio));
    out[i] = input[src]!;
  }
  return out;
}

let singleton: VoiceWakeSession | null = null;

/** 全局唤醒是否正在听（供设置页状态提示）。 */
export function isVoiceWakeListening(): boolean {
  return Boolean(singleton?.active);
}

/**
 * Duty: 设置页诚实状态（开麦 / ASR / 占麦 / 最近错误）。
 */
export function getVoiceWakeStatus(): VoiceWakeStatus {
  const owner = getGlobalSpeechRecOwner();
  const ownerBusy = owner === "call" || owner === "dictation";
  if (!singleton) {
    return {
      micOpen: false,
      asrLive: false,
      lastError: ownerBusy ? "owner-busy" : "",
      ownerBusy,
      engine: "",
    };
  }
  const s = singleton.status;
  return { ...s, ownerBusy: ownerBusy || s.lastError === "owner-busy" };
}

/**
 * 按设置启停全局唤醒单例。
 * 通话/听写占用识别时返回 false；失败原因经 onError。
 */
export async function syncVoiceWake(opts: {
  wantRunning: boolean;
  onWake: (phrase: string) => void;
  onError?: (msg: string) => void;
}): Promise<boolean> {
  if (!opts.wantRunning) {
    singleton?.stop();
    singleton = null;
    return false;
  }
  const settings: VoiceSettings = loadVoiceSettings();
  if (!settings.wakeEnabled) {
    singleton?.stop();
    singleton = null;
    return false;
  }
  if (getGlobalSpeechRecOwner() === "call" || getGlobalSpeechRecOwner() === "dictation") {
    singleton?.stop();
    singleton = null;
    return false;
  }
  if (singleton?.active) return true;
  singleton?.stop();
  const candidate = new VoiceWakeSession({
    onWake: opts.onWake,
    onError: opts.onError,
  });
  singleton = candidate;
  const ok = await candidate.start();
  if (!ok && singleton === candidate) {
    singleton = null;
  }
  return ok && singleton === candidate;
}

/** 强制停止唤醒（进通话 / 听写前调用）。 */
export function stopVoiceWake() {
  singleton?.stop();
  singleton = null;
}

/** 唤醒命中后等待旧识别器释放麦克风，再交给通话。 */
export async function stopVoiceWakeAndWait(): Promise<void> {
  const current = singleton;
  if (!current) return;
  singleton = null;
  await current.stopAndWait();
}

/** 系统音短确认（不经 Cosy）。 */
export function speakWakeConfirm(text = "在呢") {
  try {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = loadVoiceSettings().wakeLang || "zh-CN";
    u.rate = 1.05;
    window.speechSynthesis?.cancel();
    window.speechSynthesis?.speak(u);
  } catch {
    /* ignore */
  }
}
