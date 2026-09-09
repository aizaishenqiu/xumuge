/**
 * @file Sherpa / CosyVoice 分轨：音色 + 心情 → 引擎参数
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-31
 * @updated 2026-09-01
 * @version 2.0.0
 * @category Config
 * @algo provider-tone-param-table
 */

import type { VoiceProviderId } from "./voicePacks";
import { getVoiceMoodPreset } from "./voiceMoodPresets";
import {
  getVoiceTonePreset,
  toneRequiresCosy,
  VOICE_TONE_PRESETS,
  type VoiceTonePreset,
} from "./voiceTonePresets";
import { getVoiceTimbrePreset, listTimbresByGender } from "./voiceTimbrePresets";

export interface SherpaToneProsody {
  rate: number;
  pitch: number;
  toneIdsHints: string[];
}

export interface CosyVoiceToneParams {
  instruct: string;
  emotion?: string;
}

export type OfflineToneProvider = Exclude<VoiceProviderId, "system-webspeech">;

export const ENGINE_TONE_BLURB: Record<OfflineToneProvider, string> = {
  "sherpa-onnx":
    "离线主路径：Sherpa 识别 + Kokoro 朗读。声线为 zf_/zm_ 固定表，无心情。戏剧音色请用 CosyVoice。",
  cosyvoice:
    "戏剧扩展：本机 FastAPI。音色（萝莉/夹子等）与心情（开心/悲伤）分开选；系统自动写入参考音色库，无需用户训练。",
};

export function listTonesForProvider(provider: VoiceProviderId): VoiceTonePreset[] {
  if (provider === "sherpa-onnx" || provider === "cosyvoice") {
    return VOICE_TONE_PRESETS.slice();
  }
  return VOICE_TONE_PRESETS.filter((t) => !t.requiresCosy);
}

export function listTimbresForProvider(
  provider: VoiceProviderId,
  gender: "female" | "male",
) {
  const all = listTimbresByGender(gender);
  if (provider === "system-webspeech") {
    return all.filter((t) => !t.requiresCosy);
  }
  return all;
}

export function resolveSherpaToneProsody(toneId?: string | null): SherpaToneProsody {
  const tone = getVoiceTonePreset(toneId);
  return {
    rate: tone.rate,
    pitch: tone.pitch,
    toneIdsHints: [tone.id, ...tone.voiceHints],
  };
}

/**
 * Cosy：音色 instruct + 心情缀；兼容只传旧 toneId。
 */
export function resolveCosyVoiceToneParams(
  toneOrTimbreId?: string | null,
  moodId?: string | null,
): CosyVoiceToneParams {
  const timbre = getVoiceTimbrePreset(toneOrTimbreId);
  const mood = getVoiceMoodPreset(moodId);
  return {
    instruct: `${timbre.cosyInstruct} ${mood.instructSuffix}`.trim(),
    emotion: mood.emotion,
  };
}

/** 合成用：合并音色与心情的语速音高。 */
export function resolveProsody(timbreId?: string | null, moodId?: string | null) {
  const t = getVoiceTimbrePreset(timbreId);
  const m = getVoiceMoodPreset(moodId);
  return {
    rate: Math.min(2, Math.max(0.5, t.rate * m.rateMul)),
    pitch: Math.min(2, Math.max(0.5, t.pitch * m.pitchMul)),
  };
}

export function engineToneBlurb(provider: OfflineToneProvider): string {
  return ENGINE_TONE_BLURB[provider];
}

export function providerNeedsGpuHint(provider: OfflineToneProvider): boolean {
  return provider === "cosyvoice";
}

export { toneRequiresCosy };
