/**
 * @file CosyVoice FastAPI 静默预热（丢弃音频，降低首句冷启动）
 * @author qiuye <yjk150@qq.com>
 * @date 2026-09-01
 * @updated 2026-09-07
 * @version 1.4.2
 * @category Stream
 * @algo keyed-single-flight-warmup
 */

import { loadVoiceSettings, type VoiceSettings } from "../stores/voiceSettings";
import { probeFastapiUrl, synthesizeFastapiPcmStream } from "./cosyFastapiClient";
import {
  isCosySysSeedPresetId,
  resolveCosyFastapiPreset,
  resolveCosyFastapiSpkId,
  scanCosyFastapiVoices,
} from "./cosyFastapiVoices";
import { resolveCosyVoiceToneParams } from "./voiceToneEngineMap";
import { systemVoiceDirId } from "./voiceTimbrePresets";

let warmGeneration = 0;
let lastWarmAt = 0;
let lastWarmKey = "";
let activeWarmKey = "";
let activeWarmPromise: Promise<boolean> | null = null;
const WARM_COOLDOWN_MS = 45_000;

function warmKey(s: VoiceSettings): string {
  return [
    s.timbreId || s.toneId,
    s.moodId,
    s.voiceGender,
    s.cosyFastapiSpkId,
    s.cosyModelDir,
    s.cosyVoice2 ? "2" : "1",
    s.voice,
  ].join("|");
}

/** 用户停止服务/显式停止时作废暖机结果。 */
export function cancelCosyFastapiWarm(): void {
  warmGeneration += 1;
}

/**
 * Duty: 开口时不阻塞等待暖机（暖机与正句抢 GPU 时取消暖机）。
 */
export async function prepareCosyWarmForSpeak(settings: VoiceSettings): Promise<void> {
  const key = warmKey(settings);
  if (activeWarmPromise && activeWarmKey !== key) {
    cancelCosyFastapiWarm();
  }
  if (lastWarmKey !== key) {
    lastWarmAt = 0;
  }
  void settings;
}

export function markCosyFastapiSpoke(settings?: VoiceSettings): void {
  lastWarmAt = Date.now();
  if (settings) lastWarmKey = warmKey(settings);
  else {
    try {
      lastWarmKey = warmKey(loadVoiceSettings());
    } catch {
      /* ignore */
    }
  }
}

/** 距上次成功暖机是否仍视为热态（供 UI 提示）。 */
export function isCosyFastapiWarmFresh(maxAgeMs = 90_000): boolean {
  return lastWarmAt > 0 && Date.now() - lastWarmAt < maxAgeMs;
}

export interface WarmCosyOpts {
  /** 设置 Cosy 试听页强制暖机（即使默认引擎不是 Cosy） */
  force?: boolean;
}

/**
 * 后台合成极短句并丢弃结果；失败静默。
 * 默认仅当 provider=cosyvoice；参数与正式 speak 对齐。
 */
export function warmCosyFastapiQuiet(opts: WarmCosyOpts = {}): Promise<boolean> {
  const s = loadVoiceSettings();
  const key = warmKey(s);
  if (activeWarmPromise) {
    if (activeWarmKey === key) return activeWarmPromise;
    // 证据：不同 key 直接 false 会让心情切换后永远暖不起来
    cancelCosyFastapiWarm();
  }
  if (Date.now() - lastWarmAt < WARM_COOLDOWN_MS && lastWarmKey === key) {
    return Promise.resolve(true);
  }
  if (s.cosyBackend !== "fastapi") {
    return Promise.resolve(false);
  }
  if (!opts.force && s.provider !== "cosyvoice") return Promise.resolve(false);
  const base = (s.cosyFastapiBaseUrl || "").trim();
  if (!base) {
    return Promise.resolve(false);
  }

  const gen = warmGeneration;
  const run = async (): Promise<boolean> => {
    try {
      // 证据：warmFresh 长期 false 多因 sidecar 未探通；先拉起再合成
      let probe = await probeFastapiUrl(base).catch(() => ({
        ready: false,
        reason: "probe-throw",
      }));
      if (!probe.ready) {
        const { forceStartCosyForVoice, waitCosyFastapiHealthy } = await import("./cosyAutostart");
        const started = await forceStartCosyForVoice();
        if (!started.running && !started.attempted) {
          throw new Error(started.message || "Cosy 未配置");
        }
        const ok = await waitCosyFastapiHealthy(base, 8_000, 500);
        if (!ok) {
          throw new Error(`Cosy API 未就绪: ${probe.reason || "timeout"}`);
        }
        probe = await probeFastapiUrl(base).catch(() => probe);
      }
      if (gen !== warmGeneration) return false;

      const mapped = resolveCosyVoiceToneParams(s.timbreId || s.toneId, s.moodId);
      const timbreId = s.timbreId || s.toneId;
      const voiceHint = s.voice?.startsWith("sys-")
        ? s.voice
        : systemVoiceDirId(timbreId);
      const presets = s.cosyVoicesRoot.trim()
        ? await scanCosyFastapiVoices(s.cosyVoicesRoot).catch(() => [])
        : [];
      const preset = resolveCosyFastapiPreset(presets, {
        voice: voiceHint,
        timbreId,
        toneId: s.toneId,
        voiceGender: s.voiceGender,
      });
      const spkId = resolveCosyFastapiSpkId(s);
      const isCv2 = Boolean(s.cosyVoice2);
      const sysSeed = isCosySysSeedPresetId(preset?.id);

      let promptWavPath: string | undefined;
      let promptText: string | undefined;
      let fallbackPromptWav: string | undefined;
      let fallbackPromptText: string | undefined;
      if (isCv2) {
        if (preset?.sampleWav) {
          promptWavPath = preset.sampleWav;
          promptText = preset.promptText;
        } else if (s.cosyDefaultPromptWav.trim()) {
          fallbackPromptWav = s.cosyDefaultPromptWav.trim();
          fallbackPromptText = s.cosyDefaultPromptText;
        }
        // 证据：无参考音时旧逻辑直接 return false → 永远 warmFresh=false；暖机允许仅 spk/instruct
      } else if (preset?.sampleWav && !sysSeed) {
        promptWavPath = preset.sampleWav;
        promptText = preset.promptText;
      }

      await synthesizeFastapiPcmStream(
        {
          baseUrl: base,
          text: "好。",
          instruct: mapped.instruct,
          spkId,
          modelDir: s.cosyModelDir,
          promptWavPath,
          promptText,
          fallbackPromptWav,
          fallbackPromptText,
        },
        () => {
          /* discard */
        },
        { aborted: () => gen !== warmGeneration },
      );
      if (gen !== warmGeneration) return false;
      lastWarmAt = Date.now();
      lastWarmKey = key;
      return true;
    } catch {
      return false;
    }
  };
  activeWarmKey = key;
  activeWarmPromise = run().finally(() => {
    if (activeWarmKey === key) {
      activeWarmPromise = null;
      activeWarmKey = "";
    }
  });
  return activeWarmPromise;
}
