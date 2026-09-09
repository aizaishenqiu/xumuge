/**
 * @file 音色与 voice 设置同步（避免循环依赖）
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-31
 * @updated 2026-09-01
 * @version 1.1.0
 * @category Config
 * @algo tone-voice-sync
 */

import type { VoiceSettings } from "../stores/voiceSettings";
import type { InstalledVoicePack } from "./voicePacks";
import { resolveProsody } from "./voiceToneEngineMap";
import {
  getVoiceTonePreset,
  matchSystemVoiceForTone,
  matchVoiceHint,
} from "./voiceTonePresets";
import { systemVoiceDirId } from "./voiceTimbrePresets";

/**
 * 按当前 provider / 包 / 音色同步 voice、rate、pitch；返回需 persist 的 patch。
 */
export function syncVoiceToTone(
  settings: VoiceSettings,
  packs: InstalledVoicePack[],
  systemVoices: SpeechSynthesisVoice[],
): Partial<VoiceSettings> {
  const tone = getVoiceTonePreset(settings.timbreId || settings.toneId);
  const prosody = resolveProsody(settings.timbreId || settings.toneId, settings.moodId);
  let voice = settings.voice;
  if (settings.provider === "system-webspeech") {
    voice = matchSystemVoiceForTone(systemVoices, tone) || systemVoices[0]?.voiceURI || voice;
  } else if (settings.provider === "cosyvoice") {
    const sysId = systemVoiceDirId(tone.id);
    if (!voice || voice === settings.toneId || !voice.startsWith("sys-")) {
      voice = sysId;
    }
  } else {
    const pack = packs.find((p) => p.id === settings.packId);
    const voices = pack?.voices ?? [];
    if (voices.length === 1) {
      voice = voices[0].id;
    } else if (voices.length > 1) {
      voice = matchVoiceHint(voices, tone) || voices[0]?.id || voice;
    }
  }
  const patch: Partial<VoiceSettings> = {};
  if (voice && voice !== settings.voice) patch.voice = voice;
  if (prosody.rate !== settings.rate) patch.rate = prosody.rate;
  if (prosody.pitch !== settings.pitch) patch.pitch = prosody.pitch;
  if (tone.id !== settings.timbreId) patch.timbreId = tone.id;
  if (tone.id !== settings.toneId) patch.toneId = tone.id;
  return patch;
}
