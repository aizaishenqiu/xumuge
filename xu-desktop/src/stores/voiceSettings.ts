/**
 * @file 语音与朗读配置 store（含声调、Cosy 多后端含 FastAPI）
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-30
 * @updated 2026-09-02
 * @version 2.1.1
 * @category Config
 * @algo bounded-preference-normalization
 */

import { defineStore } from "pinia";
import { ref } from "vue";
import type { VoiceProviderId } from "../utils/voicePacks";
import {
  DEFAULT_MOOD_ID,
  getVoiceMoodPreset,
  migrateLegacyToneId,
  VOICE_MOOD_PRESETS,
} from "../utils/voiceMoodPresets";
import {
  DEFAULT_TIMBRE_ID,
  getVoiceTimbrePreset,
  VOICE_TIMBRE_PRESETS,
  type VoiceGender,
} from "../utils/voiceTimbrePresets";
import { resolveProsody } from "../utils/voiceToneEngineMap";
import { getCosyFastapiDefaultUrl } from "../utils/appEnv";

const STORAGE_KEY = "xu.voice.tts.settings.v1";

/** CosyVoice 后端：本地安装 / 百炼 / 自建 JSON / 本地 FastAPI。 */
export type CosyBackendId = "local" | "dashscope" | "customHttp" | "fastapi";

export interface VoiceSettings {
  provider: VoiceProviderId;
  voice: string;
  packId: string;
  /** @deprecated 兼容；与 timbreId 同步 */
  toneId: string;
  voiceGender: VoiceGender;
  timbreId: string;
  moodId: string;
  rate: number;
  pitch: number;
  volume: number;
  callPreferRealtime: boolean;
  wakeEnabled: boolean;
  wakePhrases: string[];
  wakeLang: string;
  wakeConfirmSpeak: boolean;
  /** 唤醒命中时是否最大化主窗（默认开） */
  wakeMaximizeWindow: boolean;
  /** 远程 API 是否支持心情注入（customHttp 可勾选；dashscope 默认 true） */
  apiSupportsMood: boolean;
  cosyBackend: CosyBackendId;
  cosyDashscopeModel: string;
  cosyCustomBaseUrl: string;
  cosyDashscopeVoice: string;
  cosyFastapiBaseUrl: string;
  cosyVoicesRoot: string;
  cosyFastapiSpkId: string;
  cosyPython: string;
  cosyServerScript: string;
  cosyModelDir: string;
  cosyExtraArgs: string;
  cosyScanRoot: string;
  cosyDefaultPromptWav: string;
  cosyDefaultPromptText: string;
  cosyVoice2: boolean;
  cosyWantRunning: boolean;
}

export const DEFAULT_WAKE_PHRASES = ["虚募阁", "虚幕阁", "虚慕阁", "小虚", "嘿虚幕", "嘿虚慕"];

export const WAKE_LANG_OPTIONS = [
  { value: "zh-CN", label: "中文（简体）" },
  { value: "zh-TW", label: "中文（繁体）" },
  { value: "en-US", label: "English (US)" },
  { value: "ja-JP", label: "日本語" },
] as const;

export type WakeLangId = (typeof WAKE_LANG_OPTIONS)[number]["value"];

const defaultProsody = resolveProsody(DEFAULT_TIMBRE_ID, DEFAULT_MOOD_ID);

export const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  provider: "system-webspeech",
  voice: "",
  packId: "",
  toneId: DEFAULT_TIMBRE_ID,
  voiceGender: "female",
  timbreId: DEFAULT_TIMBRE_ID,
  moodId: DEFAULT_MOOD_ID,
  rate: defaultProsody.rate,
  pitch: defaultProsody.pitch,
  volume: 1,
  callPreferRealtime: true,
  wakeEnabled: false,
  wakePhrases: [...DEFAULT_WAKE_PHRASES],
  wakeLang: "zh-CN",
  wakeConfirmSpeak: true,
  wakeMaximizeWindow: true,
  apiSupportsMood: false,
  cosyBackend: "fastapi",
  cosyDashscopeModel: "cosyvoice-v3-flash",
  cosyCustomBaseUrl: "",
  cosyDashscopeVoice: "longanyang",
  cosyFastapiBaseUrl: getCosyFastapiDefaultUrl(),
  cosyVoicesRoot: "",
  cosyFastapiSpkId: "中文女",
  cosyPython: "",
  cosyServerScript: "",
  cosyModelDir: "",
  cosyExtraArgs: "",
  cosyScanRoot: "",
  cosyDefaultPromptWav: "",
  cosyDefaultPromptText: "",
  cosyVoice2: false,
  cosyWantRunning: false,
};

function normalizeWakePhrases(raw: unknown): string[] {
  let list: string[] = [];
  if (Array.isArray(raw)) {
    list = raw.map((x) => String(x).trim()).filter(Boolean);
  } else if (typeof raw === "string") {
    list = raw
      .split(/[,，\n;/|]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  const cleaned = [...new Set(list.map((s) => s.slice(0, 32)))].slice(0, 12);
  return cleaned.length ? cleaned : [...DEFAULT_WAKE_PHRASES];
}

function normalizeWakeLang(raw: unknown): WakeLangId {
  const s = String(raw ?? "").trim();
  if (WAKE_LANG_OPTIONS.some((o) => o.value === s)) return s as WakeLangId;
  return "zh-CN";
}

function normalizeCosyBackend(raw: unknown): CosyBackendId {
  // 旧版「local」与远程 JSON / FastAPI 职责重叠，统一迁移为 fastapi 默认档。
  if (raw === "local") return "fastapi";
  if (raw === "dashscope" || raw === "customHttp" || raw === "fastapi") {
    return raw;
  }
  return "fastapi";
}

/** 规范化持久配置；旧 toneId 迁移为 timbreId+moodId。 */
export function normalizeVoiceSettings(raw: Partial<VoiceSettings> & { toneId?: string }): VoiceSettings {
  const provider: VoiceProviderId =
    raw.provider === "sherpa-onnx" || raw.provider === "cosyvoice"
      ? raw.provider
      : "system-webspeech";

  let timbreId = String(raw.timbreId ?? "").trim();
  let moodId = String(raw.moodId ?? "").trim();
  if (!VOICE_TIMBRE_PRESETS.some((p) => p.id === timbreId)) {
    const mig = migrateLegacyToneId(raw.toneId);
    timbreId = mig.timbreId;
    if (!VOICE_MOOD_PRESETS.some((p) => p.id === moodId)) {
      moodId = mig.moodId;
    }
  }
  if (!VOICE_MOOD_PRESETS.some((p) => p.id === moodId)) {
    moodId = DEFAULT_MOOD_ID;
  }
  const timbre = getVoiceTimbrePreset(timbreId);
  let mood = getVoiceMoodPreset(moodId);
  const voiceGender: VoiceGender =
    raw.voiceGender === "male" || raw.voiceGender === "female"
      ? raw.voiceGender
      : timbre.gender;
  // 性别与音色不一致时，落到该性别默认音色
  if (timbre.gender !== voiceGender) {
    const first = VOICE_TIMBRE_PRESETS.find((p) => p.gender === voiceGender);
    timbreId = first?.id ?? timbreId;
  }
  if (mood.femaleOnly && voiceGender === "male") {
    moodId = DEFAULT_MOOD_ID;
    mood = getVoiceMoodPreset(moodId);
  }
  const syncedTimbre = getVoiceTimbrePreset(timbreId);
  const prosody = resolveProsody(timbreId, moodId);
  const rate = Number(raw.rate);
  const pitch = Number(raw.pitch);
  const volume = Number(raw.volume);
  let cosyFastapiSpkId = String(raw.cosyFastapiSpkId || "中文女").trim().slice(0, 64);
  if (cosyFastapiSpkId === "日语男") {
    cosyFastapiSpkId = voiceGender === "male" ? "中文男" : "中文女";
  }
  return {
    provider,
    voice: String(raw.voice ?? ""),
    packId: String(raw.packId ?? ""),
    toneId: syncedTimbre.id,
    voiceGender,
    timbreId: syncedTimbre.id,
    moodId: mood.id,
    rate: Math.min(2, Math.max(0.5, Number.isFinite(rate) ? rate : prosody.rate)),
    pitch: Math.min(2, Math.max(0.5, Number.isFinite(pitch) ? pitch : prosody.pitch)),
    volume: Math.min(1, Math.max(0, Number.isFinite(volume) ? volume : 1)),
    callPreferRealtime: raw.callPreferRealtime !== false,
    wakeEnabled: Boolean(raw.wakeEnabled),
    wakePhrases: normalizeWakePhrases(raw.wakePhrases),
    wakeLang: normalizeWakeLang(raw.wakeLang),
    wakeConfirmSpeak: raw.wakeConfirmSpeak !== false,
    wakeMaximizeWindow: raw.wakeMaximizeWindow !== false,
    apiSupportsMood:
      raw.apiSupportsMood !== undefined
        ? Boolean(raw.apiSupportsMood)
        : normalizeCosyBackend(raw.cosyBackend) === "dashscope",
    cosyBackend: normalizeCosyBackend(raw.cosyBackend),
    cosyDashscopeModel: String(raw.cosyDashscopeModel || "cosyvoice-v3-flash").slice(0, 96),
    cosyCustomBaseUrl: String(raw.cosyCustomBaseUrl ?? "").trim().slice(0, 512),
    cosyDashscopeVoice: String(raw.cosyDashscopeVoice || "longanyang").slice(0, 64),
    cosyFastapiBaseUrl: String(
      raw.cosyFastapiBaseUrl || DEFAULT_VOICE_SETTINGS.cosyFastapiBaseUrl,
    )
      .trim()
      .slice(0, 512),
    cosyVoicesRoot: String(raw.cosyVoicesRoot ?? "").trim().slice(0, 1024),
    cosyFastapiSpkId,
    cosyPython: String(raw.cosyPython ?? "").trim().slice(0, 1024),
    cosyServerScript: String(raw.cosyServerScript ?? "").trim().slice(0, 1024),
    cosyModelDir: String(raw.cosyModelDir ?? "").trim().slice(0, 1024),
    cosyExtraArgs: String(raw.cosyExtraArgs ?? "").trim().slice(0, 512),
    cosyScanRoot: String(raw.cosyScanRoot ?? "").trim().slice(0, 1024),
    cosyDefaultPromptWav: String(raw.cosyDefaultPromptWav ?? "").trim().slice(0, 1024),
    cosyDefaultPromptText: String(raw.cosyDefaultPromptText ?? "").trim().slice(0, 2048),
    cosyVoice2: Boolean(raw.cosyVoice2),
    cosyWantRunning: Boolean(raw.cosyWantRunning),
  };
}

/**
 * 将不可用的离线 provider 回退为系统语音（保留语气与语速等）。
 * 仅当 offlineUsable=true（pack + 合成引擎均可用）时保留离线 provider。
 */
export function healVoiceSettingsToUsable(
  current: VoiceSettings,
  opts: {
    offlineUsable: boolean;
    systemVoiceUri?: string;
  },
): VoiceSettings {
  const normalized = normalizeVoiceSettings(current);
  if (normalized.provider === "system-webspeech") {
    return normalized;
  }
  if (opts.offlineUsable) {
    return normalized;
  }
  return normalizeVoiceSettings({
    ...normalized,
    provider: "system-webspeech",
    packId: "",
    voice: opts.systemVoiceUri ?? "",
  });
}

/** 从 localStorage 读取语音配置；损坏或不可读时返回系统语音默认值。 */
export function loadVoiceSettings(): VoiceSettings {
  try {
    return normalizeVoiceSettings(JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"));
  } catch {
    return { ...DEFAULT_VOICE_SETTINGS };
  }
}

/** 保存规范化语音配置并广播变更；存储不可用时仍返回当前会话可用配置。 */
export function saveVoiceSettings(settings: VoiceSettings): VoiceSettings {
  const normalized = normalizeVoiceSettings(settings);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
  } catch {
    // Local storage failure must not make system speech unusable.
  }
  window.dispatchEvent(new CustomEvent("xu:voice-settings-changed", { detail: normalized }));
  return normalized;
}

export const useVoiceSettingsStore = defineStore("voice-settings", () => {
  const settings = ref<VoiceSettings>(loadVoiceSettings());

  /**
   * 保存完整语音配置。依赖 localStorage；写入失败仍保留当前会话值，
   * 数值会限制到浏览器和 sidecar 共同支持的区间。
   */
  function update(next: Partial<VoiceSettings>) {
    settings.value = saveVoiceSettings({ ...settings.value, ...next });
  }

  return { settings, update };
});

/** DashScope / 自建 HTTP 的密钥 env 名（存 xu.db，不进 localStorage）。 */
export const COSY_DASHSCOPE_API_KEY_ENV = "XU_COSYVOICE_DASHSCOPE_API_KEY";
export const COSY_CUSTOM_HTTP_API_KEY_ENV = "XU_COSYVOICE_CUSTOM_HTTP_API_KEY";
