/**
 * @file Kokoro 试听句内存缓存：预热后合成固定短句，二次试听近即时
 * @author qiuye <yjk150@qq.com>
 * @date 2026-09-01
 * @version 1.0.0
 * @category Stream
 * @algo bounded-lru-string-cache
 */

import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { createVoiceRequestId, synthesizeVoice } from "./voicePacks";
import { previewUtteranceForTone } from "./assistantOralPersona";
import type { VoiceSettings } from "../stores/voiceSettings";

const MAX_ENTRIES = 8;
const cache = new Map<string, string>();

function cacheKey(voice: string, text: string): string {
  return `${voice}\u0000${text}`;
}

/** 取已缓存的可播放 data URL / asset URL。 */
export function getKokoroPreviewSrc(voice: string, text: string): string | null {
  return cache.get(cacheKey(voice, text)) ?? null;
}

/** 写入缓存；超出容量淘汰最早条目。 */
export function setKokoroPreviewSrc(voice: string, text: string, src: string): void {
  const key = cacheKey(voice, text);
  if (cache.has(key)) cache.delete(key);
  cache.set(key, src);
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

async function wavPathToSrc(wavPath: string): Promise<string> {
  try {
    return await invoke<string>("xu_voice_temp_wav_data_url", { path: wavPath });
  } catch {
    return convertFileSrc(wavPath);
  }
}

/**
 * 后台合成设置页试听短句并入缓存。
 * 依赖：native Kokoro 已可用；失败静默。
 */
export async function primeKokoroPreviewCache(
  voice: string,
  settings: Pick<VoiceSettings, "rate" | "pitch" | "volume" | "toneId">,
  text: string = previewUtteranceForTone(settings.toneId),
): Promise<void> {
  const v = voice.trim();
  const t = text.trim();
  if (!v || !t) return;
  if (getKokoroPreviewSrc(v, t)) return;
  const wavPath = await synthesizeVoice({
    requestId: createVoiceRequestId("kokoro-preview-prime"),
    packId: "native",
    text: t,
    voice: v,
    rate: settings.rate,
    pitch: settings.pitch,
    volume: settings.volume,
    toneId: settings.toneId,
  });
  const src = await wavPathToSrc(wavPath);
  setKokoroPreviewSrc(v, t, src);
}
