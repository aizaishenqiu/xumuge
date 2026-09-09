/**
 * @file Agent voice_set_tone / instruct 事件 → 会话覆盖 + voiceSettings
 * @author qiuye <yjk150@qq.com>
 * @date 2026-09-07
 * @version 1.0.0
 * @category Config
 * @algo voice-route-override-apply
 */

import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { loadVoiceSettings, saveVoiceSettings } from "../stores/voiceSettings";
import {
  clearVoiceSessionOverride,
  saveVoiceSessionOverride,
} from "./voiceSessionOverride";
import { getVoiceTimbrePreset, systemVoiceDirId } from "./voiceTimbrePresets";
import { migrateLegacyToneId } from "./voiceMoodPresets";
import { resolveProsody } from "./voiceToneEngineMap";

export type VoiceRouteOverridePayload = {
  toneId?: string;
  cosyInstruct?: string;
};

/**
 * Duty: 把 Rust/Agent 广播的音色覆盖落到前端设置（通话中不必打开设置页）。
 */
export function applyVoiceRouteOverridePayload(p: VoiceRouteOverridePayload): void {
  if (!p.toneId && !p.cosyInstruct) {
    clearVoiceSessionOverride();
    return;
  }
  saveVoiceSessionOverride({
    toneId: p.toneId,
    cosyInstruct: p.cosyInstruct,
  });
  if (!p.toneId?.trim()) return;
  const migrated = migrateLegacyToneId(p.toneId);
  const timbre = getVoiceTimbrePreset(migrated.timbreId);
  const cur = loadVoiceSettings();
  // 保留当前心情；仅旧 tone→mood 映射且与默认不同时才改 mood
  const moodId =
    migrated.moodId !== "calm" ? migrated.moodId : cur.moodId || "calm";
  const prosody = resolveProsody(timbre.id, moodId);
  saveVoiceSettings({
    ...cur,
    provider: cur.provider === "cosyvoice" || timbre.requiresCosy ? "cosyvoice" : cur.provider,
    timbreId: timbre.id,
    toneId: timbre.id,
    moodId,
    voiceGender: timbre.gender,
    rate: prosody.rate,
    pitch: prosody.pitch,
    voice: systemVoiceDirId(timbre.id),
    cosyWantRunning: timbre.requiresCosy ? true : cur.cosyWantRunning,
  });
}

/** 订阅 xu:voice-route-override；返回 unlisten。 */
export async function listenVoiceRouteOverride(
  onApply?: (p: VoiceRouteOverridePayload) => void,
): Promise<UnlistenFn> {
  return listen<VoiceRouteOverridePayload>("xu:voice-route-override", (event) => {
    const p = event.payload || {};
    applyVoiceRouteOverridePayload(p);
    onApply?.(p);
  });
}
