/**
 * @file 系统 Web Speech 与本地语音包 TTS provider 抽象
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-30
 * @updated 2026-09-07
 * @version 1.11.1
 * @category Stream
 * @algo cancellable-provider-adapter
 */

import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { loadVoiceSettings, type VoiceSettings } from "../stores/voiceSettings";
import {
  cancelVoiceTask,
  createVoiceRequestId,
  listVoicePacks,
  synthesizeVoice,
  type InstalledVoicePack,
  type VoiceProviderId,
} from "./voicePacks";
import { fetchVoiceEngineStatus } from "./voiceEngineCapability";
import { toneRequiresCosy } from "./voiceTonePresets";
import { resolveCosyVoiceToneParams } from "./voiceToneEngineMap";
import { resolveKokoroVoiceId } from "./kokoroVoiceMap";
import { synthesizeCosyVoice } from "./cosyvoiceSynthApi";
import { resolveTtsRoute } from "./voiceTtsRoute";
import { loadVoiceSessionOverride, saveVoiceSessionOverride } from "./voiceSessionOverride";
import { getKokoroPreviewSrc, setKokoroPreviewSrc } from "./kokoroPreviewCache";
import { createCosyFastapiPlayer } from "./cosyFastapiClient";
import {
  isCosySysSeedPresetId,
  inferCosyVoiceGender,
  resolveCosyFastapiPreset,
  resolveCosyFastapiSpkId,
  scanCosyFastapiVoices,
  type CosyFastapiVoicePreset,
} from "./cosyFastapiVoices";
import { prepareCosyWarmForSpeak } from "./cosyFastapiWarm";
import { systemVoiceDirId, DEFAULT_TIMBRE_ID, getVoiceTimbrePreset } from "./voiceTimbrePresets";
import { DEFAULT_MOOD_ID } from "./voiceMoodPresets";
import { resolveProsody } from "./voiceToneEngineMap";
import { compactCosyInstruct, formatCv2Instruct2 } from "./llmTtsInstruct";

/** 本机 Cosy 或已勾选「API 支持心情」才注入 instruct。 */
export function moodInstructAllowed(settings: VoiceSettings): boolean {
  const backend = settings.cosyBackend;
  if (backend === "fastapi" || backend === "local") return true;
  return settings.apiSupportsMood === true;
}

/**
 * 按实际朗读引擎规范化心情/音色：
 * - Cosy：保留用户心情+音色
 * - 离线 Kokoro/Sherpa：保留声线，心情回默认（无 Cosy 表情戏）
 * - 系统音：心情+戏剧音色回默认，只保留系统声线 URI
 */
export function normalizeSpeakSettings(
  settings: VoiceSettings,
  providerId: VoiceProviderId,
): VoiceSettings {
  if (providerId === "cosyvoice") return settings;

  if (providerId === "sherpa-onnx") {
    const rawTimbre = settings.timbreId || settings.toneId || DEFAULT_TIMBRE_ID;
    const timbreId = toneRequiresCosy(rawTimbre) ? DEFAULT_TIMBRE_ID : rawTimbre;
    const moodId = DEFAULT_MOOD_ID;
    const prosody = resolveProsody(timbreId, moodId);
    return {
      ...settings,
      moodId,
      timbreId,
      toneId: timbreId,
      rate: prosody.rate,
      pitch: prosody.pitch,
    };
  }

  const prosody = resolveProsody(DEFAULT_TIMBRE_ID, DEFAULT_MOOD_ID);
  return {
    ...settings,
    moodId: DEFAULT_MOOD_ID,
    timbreId: DEFAULT_TIMBRE_ID,
    toneId: DEFAULT_TIMBRE_ID,
    rate: prosody.rate,
    pitch: prosody.pitch,
  };
}

/** Mode A / MCP / 音色心情：远程未勾选心情时不塞 Mode B instruct。 */
export function resolveSpeakInstruct(
  settings: VoiceSettings,
  mappedInstruct: string,
): string {
  const override = loadVoiceSessionOverride();
  const allow = moodInstructAllowed(settings);
  if (!allow) return "";
  return (
    compactCosyInstruct(
      override?.llmTtsInstruct?.trim() ||
        override?.cosyInstruct?.trim() ||
        mappedInstruct.trim() ||
        "",
    )
  );
}

export interface TtsProvider {
  readonly id: string;
  speak(text: string, settings: VoiceSettings): Promise<void>;
  cancel(): void;
}

export interface ResolveTtsProviderOptions {
  /** 语音通话：默认走系统语音保实时 */
  forVoiceCall?: boolean;
  /** 设置页按 Tab 锁定引擎，避免 requiresCosy 语气误跳 Cosy */
  forceProvider?: VoiceProviderId;
}

function systemVoices(): SpeechSynthesisVoice[] {
  return typeof window === "undefined" ? [] : window.speechSynthesis?.getVoices() ?? [];
}

/** 列出系统 Web Speech 声音并稳定排序；无浏览器环境时返回空列表。 */
export function listSystemVoices(): SpeechSynthesisVoice[] {
  return systemVoices().slice().sort((a, b) => a.lang.localeCompare(b.lang) || a.name.localeCompare(b.name));
}

export class SystemWebSpeechProvider implements TtsProvider {
  readonly id = "system-webspeech";

  /** 使用操作系统 Web Speech 真正朗读；失败或取消会 reject，调用方决定是否恢复聆听。 */
  speak(text: string, settings: VoiceSettings): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!("speechSynthesis" in window)) {
        reject(new Error("当前系统不支持 Web Speech 朗读"));
        return;
      }
      const s = normalizeSpeakSettings(settings, "system-webspeech");
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = "zh-CN";
      utterance.rate = s.rate;
      utterance.pitch = s.pitch;
      utterance.volume = s.volume;
      const selected = systemVoices().find((voice) => voice.voiceURI === s.voice);
      if (selected) {
        utterance.voice = selected;
        utterance.lang = selected.lang;
      }
      utterance.onend = () => resolve();
      utterance.onerror = (event) => reject(new Error(event.error === "canceled" ? "朗读已取消" : "系统朗读失败"));
      window.speechSynthesis.speak(utterance);
    });
  }

  /** 取消系统语音队列；没有活动朗读时安全。 */
  cancel() {
    window.speechSynthesis?.cancel();
  }
}

/** 按句切开，便于边播边合成，降低首包等待。 */
export function splitSpeakUnits(text: string): string[] {
  const raw = text.replace(/\s+/g, " ").trim();
  if (!raw) return [];
  const parts = raw.split(/(?<=[。！？；.!?\n])/).map((s) => s.trim()).filter(Boolean);
  if (parts.length <= 1 && raw.length > 36) {
    const mid = Math.min(28, Math.floor(raw.length / 2));
    const cut = raw.lastIndexOf("，", mid) > 8 ? raw.lastIndexOf("，", mid) + 1 : mid;
    return [raw.slice(0, cut).trim(), raw.slice(cut).trim()].filter(Boolean);
  }
  return parts.length ? parts : [raw];
}

/**
 * Duty: 合并短句，减少 Kokoro 每句单独合成导致的句间卡顿（日志：水调歌头按句 WAV 一卡一卡）。
 * Failure: 空输入 → []。
 */
export function mergeSpeakUnits(units: string[], minChars = 72): string[] {
  const src = units.map((u) => u.trim()).filter(Boolean);
  if (!src.length) return [];
  const out: string[] = [];
  let buf = "";
  for (const u of src) {
    if (/^[。！？；.!?\s]+$/.test(u)) {
      if (buf) buf += u;
      continue;
    }
    if (!buf) {
      buf = u;
      continue;
    }
    if (buf.length < minChars) {
      buf += u;
      continue;
    }
    out.push(buf);
    buf = u;
  }
  if (buf.trim()) out.push(buf.trim());
  return out.length ? out : src;
}

async function wavPathToPlayableSrc(wavPath: string): Promise<string> {
  try {
    return await invoke<string>("xu_voice_temp_wav_data_url", { path: wavPath });
  } catch {
    return convertFileSrc(wavPath);
  }
}

function playAudioSrc(
  src: string,
  volume: number,
  onAudio: (audio: HTMLAudioElement | null) => void,
  isCancelled: () => boolean,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (isCancelled()) {
      resolve();
      return;
    }
    const audio = new Audio(src);
    onAudio(audio);
    audio.volume = volume;
    audio.onended = () => resolve();
    audio.onerror = () => reject(new Error("离线语音 WAV 无法播放"));
    void audio.play().catch(() => reject(new Error("离线语音播放失败")));
  });
}

async function synthesizeOne(
  requestId: string,
  packId: string,
  text: string,
  settings: VoiceSettings,
  voice: string,
  cosyInstruct?: string,
  cosyEmotion?: string,
): Promise<string> {
  return synthesizeVoice({
    requestId,
    packId,
    text,
    voice,
    rate: settings.rate,
    pitch: settings.pitch,
    volume: settings.volume,
    toneId: settings.toneId,
    cosyInstruct,
    cosyEmotion,
  });
}

/**
 * 边播边合成：播第 i 句时合成第 i+1 句，缩短「整段合成完才出声」。
 * 命中试听缓存则跳过合成。
 */
async function playSynthWavPipelined(
  requestIdPrefix: string,
  packId: string,
  text: string,
  settings: VoiceSettings,
  voice: string,
  onAudio: (audio: HTMLAudioElement | null) => void,
  isCancelled: () => boolean,
  cosyInstruct?: string,
  cosyEmotion?: string,
): Promise<void> {
  // 短文整段一次合成，避免诗词/笑话逐句 WAV 间隙（日志：240 字仍 unitCount=3）
  const units =
    text.trim().length <= 320
      ? [text.trim()].filter(Boolean)
      : mergeSpeakUnits(splitSpeakUnits(text), 120);
  if (!units.length) return;

  const resolveUnitSrc = async (index: number, unit: string): Promise<string> => {
    const cached = getKokoroPreviewSrc(voice, unit);
    if (cached) return cached;
    const wavPath = await synthesizeOne(
      `${requestIdPrefix}-${index}`,
      packId,
      unit,
      settings,
      voice,
      cosyInstruct,
      cosyEmotion,
    );
    const src = await wavPathToPlayableSrc(wavPath);
    setKokoroPreviewSrc(voice, unit, src);
    return src;
  };

  let nextSrc: Promise<string> | null = resolveUnitSrc(0, units[0]!);

  for (let i = 0; i < units.length; i++) {
    if (isCancelled()) return;
    const src = await nextSrc!;
    if (isCancelled()) return;
    if (i + 1 < units.length) {
      nextSrc = resolveUnitSrc(i + 1, units[i + 1]!);
    } else {
      nextSrc = null;
    }
    await playAudioSrc(src, settings.volume, onAudio, isCancelled);
  }
}

export class OfflinePackProvider implements TtsProvider {
  readonly id: string;
  private requestId = "";
  private audio: HTMLAudioElement | null = null;
  private cancelled = false;

  constructor(private readonly pack: InstalledVoicePack) {
    this.id = pack.provider;
  }

  /**
   * 调用 Rust 管理的应用可信 sidecar 生成并播放 WAV；
   * provider 未内置或无 WAV 时 reject，绝不执行语音包内程序。
   */
  async speak(text: string, settings: VoiceSettings): Promise<void> {
    this.cancelled = false;
    this.requestId = createVoiceRequestId("voice-synth");
    const cosy =
      this.pack.provider === "cosyvoice"
        ? resolveCosyVoiceToneParams(settings.timbreId || settings.toneId, settings.moodId)
        : undefined;
    const voice =
      this.pack.provider === "sherpa-onnx"
        ? resolveKokoroVoiceId(
            settings.voice || settings.timbreId || settings.toneId || this.pack.voices[0]?.id,
          )
        : settings.voice || this.pack.voices[0]?.id || "";
    await playSynthWavPipelined(
      this.requestId,
      this.pack.id,
      text,
      settings,
      voice,
      (audio) => {
        this.audio = audio;
      },
      () => this.cancelled,
      cosy?.instruct,
      cosy?.emotion,
    );
  }

  /** 停止 WAV 播放并通知 Rust 取消 sidecar；任务已结束时安全。 */
  cancel() {
    this.cancelled = true;
    this.audio?.pause();
    this.audio = null;
    if (this.requestId) void cancelVoiceTask(this.requestId);
  }
}

/** 一键安装到 XU_HOME 的 native 引擎（无语音包 ZIP）。 */
export class NativeOfflineProvider implements TtsProvider {
  readonly id = "sherpa-onnx";
  private requestId = "";
  private audio: HTMLAudioElement | null = null;
  private cancelled = false;

  async speak(text: string, settings: VoiceSettings): Promise<void> {
    this.cancelled = false;
    this.requestId = createVoiceRequestId("voice-synth");
    const s = normalizeSpeakSettings(settings, "sherpa-onnx");
    const voice = resolveKokoroVoiceId(
      s.voice || s.timbreId || s.toneId || "zf_xiaoxiao",
    );
    await playSynthWavPipelined(
      this.requestId,
      "native",
      text,
      s,
      voice,
      (audio) => {
        this.audio = audio;
      },
      () => this.cancelled,
    );
  }

  cancel() {
    this.cancelled = true;
    this.audio?.pause();
    this.audio = null;
    if (this.requestId) void cancelVoiceTask(this.requestId);
  }
}

/** CosyVoice 三后端（local / dashscope / customHttp）整段 WAV。 */
export class CosyVoiceProvider implements TtsProvider {
  readonly id = "cosyvoice";
  private audio: HTMLAudioElement | null = null;

  async speak(text: string, settings: VoiceSettings): Promise<void> {
    const override = loadVoiceSessionOverride();
    const mapped = resolveCosyVoiceToneParams(
      override?.toneId || settings.timbreId || settings.toneId,
      settings.moodId,
    );
    const instruct = resolveSpeakInstruct(settings, mapped.instruct);
    const wavPath = await synthesizeCosyVoice({
      text,
      instruct,
      emotion: mapped.emotion,
      voice: settings.voice,
      backend: settings.cosyBackend,
      dashscopeModel: settings.cosyDashscopeModel,
      dashscopeVoice: settings.cosyDashscopeVoice,
      customBaseUrl: settings.cosyCustomBaseUrl,
    });
    await new Promise<void>((resolve, reject) => {
      const audio = new Audio(convertFileSrc(wavPath));
      this.audio = audio;
      audio.volume = settings.volume;
      audio.onended = () => resolve();
      audio.onerror = () => reject(new Error("CosyVoice WAV 无法播放"));
      void audio.play().catch(() => reject(new Error("CosyVoice 播放失败")));
    });
  }

  cancel() {
    this.audio?.pause();
    this.audio = null;
  }
}

/** CosyVoice 本地 FastAPI：按句 PCM + AudioContext 边合边播。 */
export class CosyFastapiProvider implements TtsProvider {
  readonly id = "cosyvoice";
  private player = createCosyFastapiPlayer();
  private presets: CosyFastapiVoicePreset[] = [];

  constructor(presets?: CosyFastapiVoicePreset[]) {
    this.presets = presets ?? [];
  }

  async speak(text: string, settings: VoiceSettings): Promise<void> {
    const override = loadVoiceSessionOverride();
    const timbreId = override?.toneId || settings.timbreId || settings.toneId;
    const mapped = resolveCosyVoiceToneParams(timbreId, settings.moodId);
    const rawInstruct = resolveSpeakInstruct(settings, mapped.instruct);
    const voiceHint =
      settings.voice?.startsWith("sys-") ||
      settings.voice?.startsWith("female-") ||
      settings.voice?.startsWith("male-")
        ? settings.voice
        : systemVoiceDirId(timbreId);
    const preset = resolveCosyFastapiPreset(this.presets, {
      voice: voiceHint,
      timbreId,
      toneId: settings.toneId,
      voiceGender: settings.voiceGender,
    });
    const spkId = resolveCosyFastapiSpkId(settings);
    const isCv2 = Boolean(settings.cosyVoice2);
    const sysSeed = isCosySysSeedPresetId(preset?.id) || isCosySysSeedPresetId(voiceHint);

    const wantGender =
      settings.voiceGender === "male" || settings.voiceGender === "female"
        ? settings.voiceGender
        : getVoiceTimbrePreset(timbreId).gender;
    let maleProsodyBoost = false;
    let sharedFemaleRef = false;
    let usedMaleUserRef = false;

    const sameWav = (a?: string, b?: string) => {
      const x = (a || "").replace(/\\/g, "/").trim().toLowerCase();
      const y = (b || "").replace(/\\/g, "/").trim().toLowerCase();
      return Boolean(x && y && x === y);
    };
    const defaultWav = (settings.cosyDefaultPromptWav || "").trim();
    const femaleSysWav = this.presets.find(
      (p) =>
        isCosySysSeedPresetId(p.id) &&
        inferCosyVoiceGender(p) === "female" &&
        Boolean(p.sampleWav?.trim()),
    )?.sampleWav;
    /** sys-* 全员拷贝同一默认女声（Rust ensure_system_voices）；仅看 id 的 male 不可信 */
    const wavIsSharedFemale = (wav?: string, id?: string) => {
      if (!wav?.trim()) return false;
      if (isCosySysSeedPresetId(id)) return true;
      if (sameWav(wav, defaultWav) || sameWav(wav, femaleSysWav)) return true;
      return /\/sys-/i.test(wav.replace(/\\/g, "/"));
    };
    const maleUserRef = this.presets.find(
      (p) =>
        inferCosyVoiceGender(p) === "male" &&
        !isCosySysSeedPresetId(p.id) &&
        Boolean(p.sampleWav?.trim()) &&
        !wavIsSharedFemale(p.sampleWav, p.id),
    );

    // CV1：sys 种子不传参考音，走 spk + instruct；用户自有音色才 instruct2
    // CV2：男声必须避开共享女声 zero_shot（日志 voice-ux10：male-deep + instructLen0 仍女声）
    let promptWavPath: string | undefined;
    let promptText: string | undefined;
    let fallbackPromptWav: string | undefined;
    let fallbackPromptText: string | undefined;

    if (isCv2) {
      if (wantGender === "male" && maleUserRef?.sampleWav) {
        promptWavPath = maleUserRef.sampleWav;
        promptText = maleUserRef.promptText;
        usedMaleUserRef = true;
      } else if (preset?.sampleWav && !wavIsSharedFemale(preset.sampleWav, preset.id)) {
        promptWavPath = preset.sampleWav;
        promptText = preset.promptText;
      } else if (wantGender === "male" && (preset?.sampleWav || defaultWav)) {
        sharedFemaleRef = true;
        maleProsodyBoost = true;
        promptWavPath = preset?.sampleWav || defaultWav;
        promptText = preset?.promptText || settings.cosyDefaultPromptText;
      } else if (wantGender !== "male" && preset?.sampleWav) {
        promptWavPath = preset.sampleWav;
        promptText = preset.promptText;
      } else if (wantGender !== "male" && defaultWav) {
        fallbackPromptWav = defaultWav;
        fallbackPromptText = settings.cosyDefaultPromptText;
      } else {
        throw new Error(
          wantGender === "male"
            ? "CosyVoice2 男声需要音色库中的男声参考音。请到 Cosy 页导入男声 sample，或暂时听降调近似。"
            : "CosyVoice2 需要参考音频。请到 Cosy 页选择音色或重跑自动检测。",
        );
      }
    } else if (preset?.sampleWav && !sysSeed) {
      promptWavPath = preset.sampleWav;
      promptText = preset.promptText;
    }

    // CV2/3 + 参考音：默认 zero_shot。男声共享女参考音 → Kokoro（先于暖机，避免无用 warm fail）
    const hasRef = Boolean(promptWavPath || fallbackPromptWav);
    let instruct = isCv2 && hasRef ? "" : rawInstruct;
    const pitch = settings.pitch || getVoiceTimbrePreset(timbreId).pitch || 1;
    const rate = settings.rate || getVoiceTimbrePreset(timbreId).rate || 1;
    let playbackRate = maleProsodyBoost ? Math.min(rate, 0.88) : rate;
    let detuneCents = maleProsodyBoost
      ? Math.min(-360, Math.round((pitch - 1) * 900) - 220)
      : Math.round((pitch - 1) * 400);

    if (wantGender === "male" && sharedFemaleRef && !usedMaleUserRef) {
      const sherpa = await fetchVoiceEngineStatus("sherpa-onnx").catch(() => null);
      if (sherpa?.synthesisAvailable) {
        const kokoroVoice = resolveKokoroVoiceId(timbreId);
        const offline = new NativeOfflineProvider();
        await offline.speak(text, {
          ...settings,
          voice: kokoroVoice,
          voiceGender: "male",
          timbreId,
        });
        return;
      }
      instruct = formatCv2Instruct2(rawInstruct || "低沉男声");
      maleProsodyBoost = true;
      playbackRate = Math.min(rate, 0.88);
      detuneCents = Math.min(-360, Math.round((pitch - 1) * 900) - 220);
    }

    // 证据：阻塞等暖机拖慢首响；男声已回退则不再暖 Cosy
    void prepareCosyWarmForSpeak(settings);

    await this.player.speak(text, {
      baseUrl: settings.cosyFastapiBaseUrl,
      promptWavPath,
      promptText,
      instruct,
      spkId,
      modelDir: settings.cosyModelDir,
      fallbackPromptWav,
      fallbackPromptText,
      volume: settings.volume,
      playbackRate,
      detuneCents,
    });
  }

  cancel() {
    this.player.stop();
  }
}

/**
 * 按持久配置与路由解析 provider。离线包缺失时返回系统 provider 和明确原因，
 * 调用方必须展示 fallbackReason，不能把系统朗读冒充离线合成。
 */
export async function resolveTtsProvider(
  settings: VoiceSettings = loadVoiceSettings(),
  options: ResolveTtsProviderOptions = {},
): Promise<{ provider: TtsProvider; fallbackReason?: string; routeReason?: string }> {
  try {
    try {
      const probe = await invoke<{
        toneId?: string;
        cosyInstruct?: string;
      }>("xu_voice_route_probe");
      if (probe.toneId || probe.cosyInstruct) {
        saveVoiceSessionOverride({
          toneId: probe.toneId,
          cosyInstruct: probe.cosyInstruct,
        });
      }
    } catch {
      /* ignore */
    }
    const sherpaStatus = await fetchVoiceEngineStatus("sherpa-onnx").catch(() => null);
    const cosyUrl =
      settings.cosyBackend === "fastapi"
        ? settings.cosyFastapiBaseUrl
        : settings.cosyCustomBaseUrl;
    const cosyStatus = await fetchVoiceEngineStatus("cosyvoice", {
      cosyBackend: settings.cosyBackend,
      cosyCustomBaseUrl: cosyUrl,
    }).catch(() => null);

    /** 设置页 Kokoro Tab：强制离线 Kokoro，不因萝莉/夹子音跳 Cosy */
    if (options.forceProvider === "sherpa-onnx") {
      const degrade =
        toneRequiresCosy(settings.toneId)
          ? "当前语气在对话中会走 CosyVoice；此处试听仅用 Kokoro 近似音色。"
          : undefined;
      if (settings.packId === "native" || !settings.packId) {
        if (sherpaStatus?.synthesisAvailable) {
          return { provider: new NativeOfflineProvider(), fallbackReason: degrade };
        }
      }
      const pack = (await listVoicePacks()).find(
        (item) =>
          (settings.packId ? item.id === settings.packId : true) &&
          item.provider === "sherpa-onnx",
      );
      if (pack) return { provider: new OfflinePackProvider(pack), fallbackReason: degrade };
      if (sherpaStatus?.synthesisAvailable) {
        return { provider: new NativeOfflineProvider(), fallbackReason: degrade };
      }
      return {
        provider: new SystemWebSpeechProvider(),
        fallbackReason: sherpaStatus?.reason || "离线 Kokoro 未就绪，已回退系统朗读。",
      };
    }
    if (options.forceProvider === "cosyvoice") {
      if (cosyStatus?.synthesisAvailable) {
        if (settings.cosyBackend === "fastapi") {
          const presets = settings.cosyVoicesRoot
            ? await scanCosyFastapiVoices(settings.cosyVoicesRoot).catch(() => [])
            : [];
          return { provider: new CosyFastapiProvider(presets) };
        }
        return { provider: new CosyVoiceProvider() };
      }
      return {
        provider: new SystemWebSpeechProvider(),
        fallbackReason: cosyStatus?.reason || "CosyVoice 未就绪。",
      };
    }
    if (options.forceProvider === "system-webspeech") {
      return { provider: new SystemWebSpeechProvider() };
    }

    const route = resolveTtsRoute(settings, {
      cosyReady: cosyStatus?.synthesisAvailable ?? false,
      sherpaReady: sherpaStatus?.synthesisAvailable ?? false,
      sessionOverride: loadVoiceSessionOverride(),
      roleToneId: undefined,
      ttsProviderHint: undefined,
      forVoiceCall: options.forVoiceCall,
    });
    if (route.blocked) {
      return {
        provider: new SystemWebSpeechProvider(),
        fallbackReason: route.blockedMessage,
      };
    }
    if (route.reason === "call-realtime-system") {
      // 默认路径，不弹「回退」告警；软缓存可在 Cosy 就绪后升级
      return { provider: new SystemWebSpeechProvider(), routeReason: "call-realtime-system" };
    }
    if (route.provider === "cosyvoice") {
      if (cosyStatus?.synthesisAvailable) {
        if (settings.cosyBackend === "fastapi") {
          const presets = settings.cosyVoicesRoot
            ? await scanCosyFastapiVoices(settings.cosyVoicesRoot).catch(() => [])
            : [];
          return { provider: new CosyFastapiProvider(presets), routeReason: route.reason };
        }
        return { provider: new CosyVoiceProvider(), routeReason: route.reason };
      }
      return {
        provider: new SystemWebSpeechProvider(),
        fallbackReason: cosyStatus?.reason || "CosyVoice 未就绪，已回退系统朗读。",
        routeReason: route.reason,
      };
    }
    if (route.provider === "sherpa-onnx") {
      const degrade =
        route.reason === "requires-cosy-fallback-kokoro" ? route.degradeNotice : undefined;
      if (settings.packId === "native" || !settings.packId) {
        if (sherpaStatus?.synthesisAvailable) {
          return { provider: new NativeOfflineProvider(), fallbackReason: degrade };
        }
      }
      const pack = (await listVoicePacks()).find(
        (item) =>
          (settings.packId ? item.id === settings.packId : true) &&
          item.provider === "sherpa-onnx",
      );
      if (pack) return { provider: new OfflinePackProvider(pack), fallbackReason: degrade };
      if (sherpaStatus?.synthesisAvailable) {
        return { provider: new NativeOfflineProvider(), fallbackReason: degrade };
      }
      return {
        provider: new SystemWebSpeechProvider(),
        fallbackReason: "离线语音未就绪，已回退系统朗读。",
      };
    }
    return { provider: new SystemWebSpeechProvider() };
  } catch {
    return {
      provider: new SystemWebSpeechProvider(),
      fallbackReason: "无法解析朗读引擎，已回退系统朗读。",
    };
  }
}
