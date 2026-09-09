/**
 * @file Cosy 系统音色自动入库（默认参考音 + 音色 instruct → sys-*）
 * @author qiuye <yjk150@qq.com>
 * @date 2026-09-01
 * @updated 2026-09-01
 * @version 1.1.0
 * @category Config
 * @algo cosy-system-voice-seed
 */

import { invoke } from "@tauri-apps/api/core";
import {
  VOICE_TIMBRE_PRESETS,
  systemVoiceDirId,
} from "./voiceTimbrePresets";
import { loadVoiceSettings, saveVoiceSettings } from "../stores/voiceSettings";

export interface EnsureSystemVoicesResult {
  created: string[];
  skipped: string[];
  /** 实际使用的音色库根（可能回落到 XU_HOME） */
  voicesRoot?: string;
}

export interface SystemVoiceSeedDto {
  id: string;
  name: string;
  promptText: string;
  instruct: string;
}

/** 从音色表生成待入库种子（autoSeed）。 */
export function buildSystemVoiceSeeds(promptText = ""): SystemVoiceSeedDto[] {
  return VOICE_TIMBRE_PRESETS.filter((t) => t.autoSeed !== false).map((t) => ({
    id: systemVoiceDirId(t.id),
    name: `${t.gender === "female" ? "女" : "男"}·${t.label}`,
    promptText,
    instruct: t.cosyInstruct,
  }));
}

/** 默认 `{XU_HOME}/cosyvoice/voices`（不存在则创建）。 */
export function defaultCosyVoicesRoot(): Promise<string> {
  return invoke<string>("xu_cosyvoice_default_voices_root");
}

/**
 * 若缺 sys-* 目录则用默认参考音写入。
 * voicesRoot / wav 可空：Rust 侧回落 XU_HOME 与 discover 缓存。
 * 成功后把实际 voicesRoot 写回设置。
 */
export async function ensureSystemCosyVoices(input?: {
  voicesRoot?: string;
  defaultPromptWav?: string;
  defaultPromptText?: string;
  persistRoot?: boolean;
}): Promise<EnsureSystemVoicesResult> {
  const cur = loadVoiceSettings();
  const voicesRoot = (input?.voicesRoot ?? cur.cosyVoicesRoot ?? "").trim();
  const defaultPromptWav = (input?.defaultPromptWav ?? cur.cosyDefaultPromptWav ?? "").trim();
  const defaultPromptText =
    input?.defaultPromptText ?? cur.cosyDefaultPromptText ?? "";
  const seeds = buildSystemVoiceSeeds(defaultPromptText.trim());
  const result = await invoke<EnsureSystemVoicesResult>("xu_cosyvoice_ensure_system_voices", {
    voicesRoot,
    defaultPromptWav,
    defaultPromptText,
    seeds,
  });
  // 读回实际根：若调用时为空则用 default
  let resolvedRoot = voicesRoot;
  if (!resolvedRoot) {
    try {
      resolvedRoot = await defaultCosyVoicesRoot();
    } catch {
      resolvedRoot = "";
    }
  }
  if (input?.persistRoot !== false && resolvedRoot && resolvedRoot !== cur.cosyVoicesRoot) {
    saveVoiceSettings({ ...cur, cosyVoicesRoot: resolvedRoot });
  }
  return { ...result, voicesRoot: resolvedRoot || undefined };
}

/** 展示名：sys-female-loli → 女·萝莉 */
export function labelForSystemVoiceId(id: string): string {
  const raw = id.startsWith("sys-") ? id.slice(4) : id;
  const t = VOICE_TIMBRE_PRESETS.find((p) => p.id === raw);
  if (!t) return id;
  return `${t.gender === "female" ? "女" : "男"}·${t.label}`;
}
