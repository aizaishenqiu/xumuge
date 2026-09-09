/**
 * @file CosyVoice FastAPI 参考音色库扫描（用户自选目录，无写死路径）
 * @author qiuye <yjk150@qq.com>
 * @date 2026-09-01
 * @updated 2026-09-03
 * @version 1.3.0
 * @category Config
 * @algo directory-preset-scan
 */

import { invoke } from "@tauri-apps/api/core";
import type { VoiceGender } from "./voiceTimbrePresets";

export interface CosyFastapiVoicePreset {
  id: string;
  name: string;
  /** sample.wav 绝对路径 */
  sampleWav: string;
  promptText: string;
  /** 缺 prompt.txt 时为 true */
  missingPrompt: boolean;
}

/** 扫描音色库：子目录含 sample.wav（或 ref.wav）即入列。 */
export function scanCosyFastapiVoices(voicesRoot: string): Promise<CosyFastapiVoicePreset[]> {
  const root = voicesRoot.trim();
  if (!root) return Promise.resolve([]);
  return invoke<CosyFastapiVoicePreset[]>("xu_cosyvoice_scan_voices", { voicesRoot: root });
}

/** 内置 SFT spk（无参考音频时的退路）；仅中英男女，无日语。 */
export const COSY_FASTAPI_BUILTIN_SPK: { id: string; name: string }[] = [
  { id: "中文女", name: "中文女" },
  { id: "中文男", name: "中文男" },
  { id: "英文女", name: "英文女" },
  { id: "英文男", name: "英文男" },
];

/** Duty: map builtin SFT spk id to voice gender; unknown → null. */
export function builtinSpkGender(spkId: string): VoiceGender | null {
  const id = spkId.trim();
  if (id === "中文女" || id === "英文女") return "female";
  if (id === "中文男" || id === "英文男") return "male";
  return null;
}

/**
 * Duty: infer gender from scanned voice id/name (sys-female-* / 女·…).
 * Failure: returns null when unknown.
 */
export function inferCosyVoiceGender(
  voice: Pick<CosyFastapiVoicePreset, "id" | "name">,
): VoiceGender | null {
  const blob = `${voice.id} ${voice.name}`.toLowerCase();
  if (
    blob.includes("sys-female") ||
    blob.includes("female-") ||
    voice.name.startsWith("女·") ||
    /中文女|英文女/.test(voice.name)
  ) {
    return "female";
  }
  if (
    blob.includes("sys-male") ||
    blob.includes("male-") ||
    voice.name.startsWith("男·") ||
    /中文男|英文男/.test(voice.name)
  ) {
    return "male";
  }
  return null;
}

/** Duty: keep voices matching current gender (unknown kept only when gender unset). */
export function filterCosyVoicesByGender(
  voices: CosyFastapiVoicePreset[],
  gender: VoiceGender,
): CosyFastapiVoicePreset[] {
  return voices.filter((v) => {
    const g = inferCosyVoiceGender(v);
    return g == null || g === gender;
  });
}

/** V1 内置 spk：按性别默认中文男/女。 */
export function defaultCosyBuiltinSpkId(gender: VoiceGender): string {
  return gender === "male" ? "中文男" : "中文女";
}

/**
 * Duty: 选与当前性别一致的 spk；已选但性别不符则回落默认。
 * CosyVoice2 返回空串（走参考音）。
 */
export function resolveCosyFastapiSpkId(
  settings: {
    cosyVoice2?: boolean;
    cosyFastapiSpkId?: string;
    voiceGender?: VoiceGender;
  },
): string {
  if (settings.cosyVoice2) return "";
  const gender = settings.voiceGender === "male" ? "male" : "female";
  const want = (settings.cosyFastapiSpkId || "").trim();
  if (want && builtinSpkGender(want) === gender) return want;
  return defaultCosyBuiltinSpkId(gender);
}

/**
 * Duty: 在当前性别扫描列表中解析参考音色；禁止回落到异性 presets[0]。
 */
export function resolveCosyFastapiPreset(
  presets: CosyFastapiVoicePreset[],
  settings: { voice?: string; timbreId?: string; toneId?: string; voiceGender?: VoiceGender },
): CosyFastapiVoicePreset | null {
  const gender = settings.voiceGender === "male" ? "male" : "female";
  const pool = filterCosyVoicesByGender(presets, gender);
  const timbreId = settings.timbreId || settings.toneId || "";
  const sysId = timbreId ? `sys-${timbreId}` : "";
  return (
    pool.find((p) => p.id === settings.voice) ||
    (sysId ? pool.find((p) => p.id === sysId) : undefined) ||
    pool.find((p) => p.id.startsWith(`sys-${gender}`)) ||
    null
  );
}

/** Duty: sys-* 种子音色（共用默认参考音），CV1 应走 spk 而非 instruct2。 */
export function isCosySysSeedPresetId(id?: string | null): boolean {
  return Boolean(id && id.trim().toLowerCase().startsWith("sys-"));
}

/** 穷测用短句。 */
export const COSY_MATRIX_UTTERANCE = "你好，这是虚募阁 CosyVoice 穷测。";
