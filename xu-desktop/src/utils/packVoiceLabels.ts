/**
 * @file 离线语音包 manifest 声音展示名
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-31
 * @version 1.0.0
 * @category Config
 * @algo manifest-gender-suffix
 */

import type { VoicePackVoice } from "./voicePacks";

function genderSuffix(gender?: string): string {
  if (!gender) return "";
  const g = gender.toLowerCase();
  if (g === "male" || g === "男" || g === "m") return "男";
  if (g === "female" || g === "女" || g === "f") return "女";
  return gender;
}

/** 格式化包内声音展示名；优先 manifest.name + 性别后缀。 */
export function formatPackVoiceLabel(voice: VoicePackVoice): string {
  const base = voice.name.trim() || voice.id;
  const suffix = genderSuffix(voice.gender);
  if (!suffix) return base;
  if (base.endsWith(`-${suffix}`) || base.endsWith(suffix)) return base;
  return `${base}-${suffix}`;
}

/** 包内是否存在多种 gender 标注。 */
export function packVoicesHaveMixedGender(voices: VoicePackVoice[]): boolean {
  const set = new Set(
    voices.map((v) => genderSuffix(v.gender)).filter(Boolean),
  );
  return set.size > 1;
}
