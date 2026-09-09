/**
 * @file 朗读心情预设（情绪，与音色分离）
 * @author qiuye <yjk150@qq.com>
 * @date 2026-09-01
 * @updated 2026-09-07
 * @version 1.3.1
 * @category Config
 * @algo preset-table-mood
 */

import { VOICE_TIMBRE_PRESETS } from "./voiceTimbrePresets";

export interface VoiceMoodPreset {
  id: string;
  label: string;
  /** Cosy emotion 标签 */
  emotion: string;
  /** 叠在音色 instruct 后的短缀（中文，供本机 Cosy） */
  instructSuffix: string;
  /** 轻微语速偏移（乘在音色 rate 上） */
  rateMul: number;
  pitchMul: number;
  /** 仅女声可选（如卖萌） */
  femaleOnly?: boolean;
}

export const VOICE_MOOD_PRESETS: VoiceMoodPreset[] = [
  {
    id: "calm",
    label: "平静",
    emotion: "neutral",
    instructSuffix: "平静清晰",
    rateMul: 1,
    pitchMul: 1,
  },
  {
    id: "happy",
    label: "开心",
    emotion: "happy",
    instructSuffix: "开心欢快",
    rateMul: 1.06,
    pitchMul: 1.06,
  },
  {
    id: "excited",
    label: "兴奋",
    emotion: "happy",
    instructSuffix: "兴奋有力",
    rateMul: 1.1,
    pitchMul: 1.08,
  },
  {
    id: "playful",
    label: "玩笑",
    emotion: "happy",
    instructSuffix: "轻松玩笑",
    rateMul: 1.04,
    pitchMul: 1.04,
  },
  {
    id: "cute",
    label: "卖萌",
    emotion: "cute",
    instructSuffix: "俏皮卖萌",
    rateMul: 1.06,
    pitchMul: 1.1,
    femaleOnly: true,
  },
  {
    id: "warm",
    label: "温暖",
    emotion: "happy",
    instructSuffix: "温暖亲切",
    rateMul: 0.98,
    pitchMul: 1.02,
  },
  {
    id: "serious",
    label: "正经",
    emotion: "neutral",
    instructSuffix: "正经克制",
    rateMul: 0.98,
    pitchMul: 0.98,
  },
  {
    id: "firm",
    label: "坚定",
    emotion: "neutral",
    instructSuffix: "坚定有力",
    rateMul: 1.02,
    pitchMul: 1.0,
  },
  {
    id: "sad",
    label: "难过",
    emotion: "sad",
    instructSuffix: "柔和安慰",
    rateMul: 0.94,
    pitchMul: 0.96,
  },
  {
    id: "sorrow",
    label: "悲伤",
    emotion: "sad",
    instructSuffix: "悲伤低沉",
    rateMul: 0.9,
    pitchMul: 0.94,
  },
  {
    id: "angry",
    label: "生气",
    emotion: "angry",
    instructSuffix: "急迫克制",
    rateMul: 1.08,
    pitchMul: 1.04,
  },
  {
    id: "nervous",
    label: "紧张",
    emotion: "fearful",
    instructSuffix: "略显紧张",
    rateMul: 1.06,
    pitchMul: 1.05,
  },
  {
    id: "tired",
    label: "疲惫",
    emotion: "sad",
    instructSuffix: "略显疲惫",
    rateMul: 0.92,
    pitchMul: 0.95,
  },
];

export const DEFAULT_MOOD_ID = "calm";

export function getVoiceMoodPreset(id?: string | null): VoiceMoodPreset {
  return (
    VOICE_MOOD_PRESETS.find((p) => p.id === id) ??
    VOICE_MOOD_PRESETS.find((p) => p.id === DEFAULT_MOOD_ID)!
  );
}

/** Duty: moods allowed for a gender (卖萌仅女声). */
export function listMoodsForGender(gender: "female" | "male"): VoiceMoodPreset[] {
  return VOICE_MOOD_PRESETS.filter((m) => !(m.femaleOnly && gender === "male"));
}

/** 注入 LLM 用的心情目录。 */
export function formatMoodCatalogForLlm(gender?: "female" | "male"): string {
  const list =
    gender === "male" || gender === "female"
      ? listMoodsForGender(gender)
      : VOICE_MOOD_PRESETS;
  return list.map((m) => `${m.id}（${m.label}）`).join("、");
}

/** 旧 toneId → { timbreId, moodId } 迁移表。 */
export const LEGACY_TONE_TO_TIMBRE_MOOD: Record<string, { timbreId: string; moodId: string }> = {
  "female-loli": { timbreId: "female-loli", moodId: "calm" },
  "female-mature": { timbreId: "female-mature", moodId: "calm" },
  "female-gentle": { timbreId: "female-gentle", moodId: "calm" },
  "female-jiazi": { timbreId: "female-jiazi", moodId: "calm" },
  "female-cute": { timbreId: "female-gentle", moodId: "cute" },
  "female-angry": { timbreId: "female-gentle", moodId: "angry" },
  "female-happy": { timbreId: "female-gentle", moodId: "happy" },
  "female-sunny": { timbreId: "female-girl", moodId: "happy" },
  "female-joke": { timbreId: "female-gentle", moodId: "playful" },
  "female-sad": { timbreId: "female-gentle", moodId: "sorrow" },
  "female-calm": { timbreId: "female-announce", moodId: "calm" },
  "male-youth": { timbreId: "male-youth", moodId: "calm" },
  "male-steady": { timbreId: "male-steady", moodId: "calm" },
  "male-gentle": { timbreId: "male-gentle", moodId: "calm" },
  "male-excited": { timbreId: "male-sunny", moodId: "excited" },
  "male-angry": { timbreId: "male-steady", moodId: "angry" },
  "male-happy": { timbreId: "male-sunny", moodId: "happy" },
  "male-sunny": { timbreId: "male-sunny", moodId: "calm" },
  "male-joke": { timbreId: "male-gentle", moodId: "playful" },
  "male-sad": { timbreId: "male-deep", moodId: "sorrow" },
  "male-calm": { timbreId: "male-announce", moodId: "calm" },
};

export function migrateLegacyToneId(toneId?: string | null): {
  timbreId: string;
  moodId: string;
} {
  const id = toneId?.trim() || "";
  if (id && LEGACY_TONE_TO_TIMBRE_MOOD[id]) {
    return LEGACY_TONE_TO_TIMBRE_MOOD[id]!;
  }
  // 证据 voice-ux18：male-deep 等新预设不在旧表 → 误回退 female-gentle
  if (id && VOICE_TIMBRE_PRESETS.some((t) => t.id === id)) {
    return { timbreId: id, moodId: "calm" };
  }
  return { timbreId: "female-gentle", moodId: "calm" };
}
