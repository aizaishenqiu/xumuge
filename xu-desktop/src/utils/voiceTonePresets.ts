/**
 * @file 语音声调兼容层：旧 toneId API；真源为音色 + 心情
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-31
 * @updated 2026-09-01
 * @version 2.0.0
 * @category Config
 * @algo preset-table-voice-matching
 */

import {
  getVoiceMoodPreset,
  migrateLegacyToneId,
} from "./voiceMoodPresets";
import {
  DEFAULT_TIMBRE_ID,
  getVoiceTimbrePreset,
  listTimbresByGender,
  timbreRequiresCosy,
  VOICE_TIMBRE_PRESETS,
  type VoiceGender,
  type VoiceTimbrePreset,
} from "./voiceTimbrePresets";

export type VoiceToneGender = VoiceGender;

/** @deprecated 使用 VoiceTimbrePreset；保留字段兼容旧调用 */
export interface VoiceTonePreset {
  id: string;
  label: string;
  gender: VoiceToneGender;
  rate: number;
  pitch: number;
  oralStyle: string;
  voiceHints: string[];
  requiresCosy?: boolean;
}

function timbreAsTone(t: VoiceTimbrePreset): VoiceTonePreset {
  return {
    id: t.id,
    label: t.label,
    gender: t.gender,
    rate: t.rate,
    pitch: t.pitch,
    oralStyle: t.oralStyle,
    voiceHints: t.voiceHints,
    requiresCosy: t.requiresCosy,
  };
}

/** 兼容旧列表：音色表（不再含纯心情项） */
export const VOICE_TONE_PRESETS: VoiceTonePreset[] = VOICE_TIMBRE_PRESETS.map(timbreAsTone);

export const DEFAULT_VOICE_TONE_ID = DEFAULT_TIMBRE_ID;

/** 按 id 取预设；支持旧 toneId 与新 timbreId。 */
export function getVoiceTonePreset(toneId?: string | null): VoiceTonePreset {
  const direct = VOICE_TIMBRE_PRESETS.find((p) => p.id === toneId);
  if (direct) return timbreAsTone(direct);
  const mig = migrateLegacyToneId(toneId);
  return timbreAsTone(getVoiceTimbrePreset(mig.timbreId));
}

export function toneRequiresCosy(toneId?: string | null): boolean {
  const direct = VOICE_TIMBRE_PRESETS.find((p) => p.id === toneId);
  if (direct) return Boolean(direct.requiresCosy);
  const mig = migrateLegacyToneId(toneId);
  return timbreRequiresCosy(mig.timbreId);
}

export function listVoiceTonesByGender(gender: VoiceToneGender): VoiceTonePreset[] {
  return listTimbresByGender(gender).map(timbreAsTone);
}

/** 从持久配置读口语人设（优先 timbreId）。 */
export function getVoiceToneOralStyle(): string {
  try {
    const raw = JSON.parse(localStorage.getItem("xu.voice.tts.settings.v1") || "{}") as {
      timbreId?: string;
      toneId?: string;
      moodId?: string;
    };
    const timbre = getVoiceTimbrePreset(raw.timbreId || migrateLegacyToneId(raw.toneId).timbreId);
    const mood = getVoiceMoodPreset(raw.moodId);
    if (mood.id === "calm") return timbre.oralStyle;
    return `${timbre.oralStyle} 当前心情：${mood.label}。`;
  } catch {
    return getVoiceTimbrePreset(DEFAULT_TIMBRE_ID).oralStyle;
  }
}

export type PackVoiceCandidate = {
  id: string;
  name: string;
  toneIds?: string[];
};

export function matchVoiceHint(
  voices: PackVoiceCandidate[],
  tone: VoiceTonePreset,
): string {
  const byToneId = voices.find(
    (v) => Array.isArray(v.toneIds) && v.toneIds.includes(tone.id),
  );
  if (byToneId) return byToneId.id;
  const hints = tone.voiceHints.map((h) => h.toLowerCase());
  for (const hint of hints) {
    const hit = voices.find((v) => {
      const hay = `${v.id} ${v.name}`.toLowerCase();
      return hay.includes(hint);
    });
    if (hit) return hit.id;
  }
  return "";
}

export function matchSystemVoiceForTone(
  voices: SpeechSynthesisVoice[],
  tone: VoiceTonePreset,
): string {
  const femaleHints = [
    "huihui",
    "hui",
    "慧",
    "yaoyao",
    "瑶",
    "female",
    "woman",
    "girl",
    "女",
    "晓",
    "婷",
  ];
  const maleHints = [
    "kangkang",
    "kang",
    "康",
    "male",
    "man",
    "boy",
    "男",
    "云",
    "强",
    "杰",
  ];
  const genderHints = tone.gender === "female" ? femaleHints : maleHints;
  const zh = voices.filter((v) => /zh|cmn|chinese/i.test(v.lang));
  const pool = zh.length ? zh : voices;
  for (const hint of genderHints) {
    const hit = pool.find((v) => v.name.toLowerCase().includes(hint.toLowerCase()));
    if (hit) return hit.voiceURI;
  }
  return pool[0]?.voiceURI ?? "";
}
