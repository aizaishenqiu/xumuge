/**
 * @file 工程双工 P1 spike：朗读中采麦 + TTS 参考 → Rust NLMS → 能量插话
 * @author qiuye <yjk150@qq.com>
 * @date 2026-09-07
 * @version 1.0.0
 * @category Stream
 * @algo duplex-spike-pcm-feed
 *
 * 开启：localStorage.setItem("xu.voice.duplexSpike","1") 后重新进通话。
 * 不接 LLM；插话只回调 onBarge，由 VoiceCallSession.interruptSpeaking 处理。
 */

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { clearTap, drainTap, TTS_TAP_SAMPLE_RATE } from "./ttsPlaybackTap";

const FEED_HZ = 16_000;
const PROC_SIZE = 2048;

export function isDuplexSpikeEnabled(): boolean {
  try {
    return localStorage.getItem("xu.voice.duplexSpike") === "1";
  } catch {
    return false;
  }
}

export type DuplexSpikeHandlers = {
  onBarge: () => void;
};

/**
 * 朗读相位启动：独立 getUserMedia（不抢 Web Speech 所有者），
 * 与 TTS 参考对齐后喂 Rust；插话事件触发 onBarge。
 */
export class VoiceDuplexSpike {
  private handlers: DuplexSpikeHandlers;
  private running = false;
  private stream: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private proc: ScriptProcessorNode | null = null;
  private unlisten: UnlistenFn | null = null;
  private lastBargeAt = 0;

  constructor(handlers: DuplexSpikeHandlers) {
    this.handlers = handlers;
  }

  async start(): Promise<boolean> {
    if (this.running || !isDuplexSpikeEnabled()) return false;
    try {
      await invoke("xu_voice_duplex_start");
    } catch {
      return false;
    }
    clearTap();
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
    } catch {
      await invoke("xu_voice_duplex_stop").catch(() => {});
      return false;
    }
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) {
      this.releaseMic();
      await invoke("xu_voice_duplex_stop").catch(() => {});
      return false;
    }
    this.ctx = new Ctx();
    const src = this.ctx.createMediaStreamSource(this.stream);
    this.proc = this.ctx.createScriptProcessor(PROC_SIZE, 1, 1);
    const mute = this.ctx.createGain();
    mute.gain.value = 0;
    this.proc.onaudioprocess = (ev) => {
      if (!this.running) return;
      const input = ev.inputBuffer.getChannelData(0);
      const mic = downsampleTo16k(input, this.ctx?.sampleRate ?? FEED_HZ);
      if (!mic.length) return;
      let reference = drainTap(mic.length);
      if (reference.length < mic.length) {
        const pad = new Float32Array(mic.length);
        pad.set(reference);
        reference = pad;
      } else if (reference.length > mic.length) {
        reference = reference.subarray(0, mic.length);
      }
      void invoke("xu_voice_duplex_feed", {
        input: {
          mic: Array.from(mic),
          reference: Array.from(reference),
          sampleRate: TTS_TAP_SAMPLE_RATE,
        },
      }).catch(() => {});
    };
    src.connect(this.proc);
    this.proc.connect(mute);
    mute.connect(this.ctx.destination);

    this.unlisten = await listen<{ barge?: boolean }>("xu:voice-duplex-barge", () => {
      const now = Date.now();
      if (now - this.lastBargeAt < 800) return;
      this.lastBargeAt = now;
      this.handlers.onBarge();
    });
    this.running = true;
    return true;
  }

  stop(): void {
    this.running = false;
    if (this.unlisten) {
      void this.unlisten();
      this.unlisten = null;
    }
    try {
      this.proc?.disconnect();
    } catch {
      /* */
    }
    this.proc = null;
    try {
      void this.ctx?.close();
    } catch {
      /* */
    }
    this.ctx = null;
    this.releaseMic();
    clearTap();
    void invoke("xu_voice_duplex_stop").catch(() => {});
  }

  private releaseMic() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
  }
}

function downsampleTo16k(input: Float32Array, srcRate: number): Float32Array {
  if (srcRate === FEED_HZ) return input.slice();
  const ratio = srcRate / FEED_HZ;
  const outLen = Math.max(1, Math.floor(input.length / ratio));
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const src = i * ratio;
    const i0 = Math.floor(src);
    const i1 = Math.min(input.length - 1, i0 + 1);
    const t = src - i0;
    out[i] = input[i0]! * (1 - t) + input[i1]! * t;
  }
  return out;
}
