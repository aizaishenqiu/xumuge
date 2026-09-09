/**
 * @file 语音助手外观预设（通话显示名 ≠ 服装/配色标签）
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-30
 * @updated 2026-09-07
 * @version 1.2.0
 * @category Config
 * @algo voice-assistant-look-presets
 */

import type { Gender } from "./employees";

const STORAGE_KEY = "xu.voice.assistantId";

export interface VoiceAssistantPreset {
  id: string;
  /** 通话字幕/状态栏显示的助手名（不是主题色或服装名） */
  name: string;
  /** 选择卡上的外观描述（服装/配色） */
  lookLabel: string;
  gender: Gender;
  genderLabel: string;
  avatarId: string;
  outfit: string;
  hairStyle: string;
}

export const VOICE_ASSISTANT_PRESETS: VoiceAssistantPreset[] = [
  {
    id: "m-suit",
    name: "墨川",
    lookLabel: "墨黑西装",
    gender: "male",
    genderLabel: "男",
    avatarId: "ink",
    outfit: "suit",
    hairStyle: "short",
  },
  {
    id: "m-vest",
    name: "橙予",
    lookLabel: "暖橙马甲",
    gender: "male",
    genderLabel: "男",
    avatarId: "warm",
    outfit: "vest",
    hairStyle: "side",
  },
  {
    id: "m-hoodie",
    name: "岩辰",
    lookLabel: "岩灰卫衣",
    gender: "male",
    genderLabel: "男",
    avatarId: "slate",
    outfit: "hoodie",
    hairStyle: "undercut",
  },
  {
    id: "f-navy",
    name: "青岚",
    lookLabel: "藏青套裙",
    gender: "female",
    genderLabel: "女",
    avatarId: "rose",
    outfit: "navy_suit",
    hairStyle: "bob",
  },
  {
    id: "f-dress",
    name: "紫霞",
    lookLabel: "紫霞裙装",
    gender: "female",
    genderLabel: "女",
    avatarId: "violet",
    outfit: "dress",
    hairStyle: "pony",
  },
  {
    id: "f-blazer",
    name: "沙言",
    lookLabel: "米色西装",
    gender: "female",
    genderLabel: "女",
    avatarId: "sand",
    outfit: "beige_blazer",
    hairStyle: "long",
  },
];

export function getVoiceAssistantPreset(id: string | null | undefined): VoiceAssistantPreset | null {
  if (!id) return null;
  return VOICE_ASSISTANT_PRESETS.find((p) => p.id === id) ?? null;
}

export function loadVoiceAssistantId(): string | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)?.trim();
    return raw && getVoiceAssistantPreset(raw) ? raw : null;
  } catch {
    return null;
  }
}

export function saveVoiceAssistantId(id: string): void {
  if (!getVoiceAssistantPreset(id)) return;
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    /* ignore */
  }
}

export function voicePhaseLabel(phase: string): string {
  if (phase === "listening") return "聆听";
  if (phase === "thinking") return "思考";
  if (phase === "speaking") return "说话";
  if (phase === "error") return "失败";
  return "空闲";
}
