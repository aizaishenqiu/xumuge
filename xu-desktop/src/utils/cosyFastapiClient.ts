/**
 * @file CosyVoice FastAPI 客户端：PCM 封装、流式边合边播
 * @author qiuye <yjk150@qq.com>
 * @date 2026-09-01
 * @updated 2026-09-05
 * @version 1.3.1
 * @category Stream
 * @algo stream-pcm-pipeline-playback
 */

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { tapAudioBuffer } from "./ttsPlaybackTap";

export interface CosyFastapiSynthOpts {
  baseUrl: string;
  text: string;
  /** 参考音频绝对路径；有则 zero_shot / instruct2 */
  promptWavPath?: string;
  promptText?: string;
  instruct?: string;
  /** 无参考音频时的内置 spk_id（CosyVoice1 SFT） */
  spkId?: string;
  modelDir?: string;
  fallbackPromptWav?: string;
  fallbackPromptText?: string;
  /** 播放语速（WebAudio playbackRate，Cosy 本体无此参） */
  playbackRate?: number;
  /** 半音偏移近似音高（detune） */
  detuneCents?: number;
}

/** 按句切开（与 ttsProvider 同策略，避免循环依赖）。Cosy 单次贵：短段不二次切开。 */
export function splitFastapiSpeakUnits(text: string): string[] {
  const raw = text.replace(/\s+/g, " ").trim();
  if (!raw) return [];
  // 通话侧已按较大块切好；≤96 字整段合成，避免标点再拆导致多次冷推理（日志：夹子音 11–24 字卡顿）
  if (raw.length <= 96) return [raw];
  const parts = raw.split(/(?<=[。！？；.!?\n])/).map((s) => s.trim()).filter(Boolean);
  if (parts.length <= 1 && raw.length > 96) {
    const mid = Math.min(72, Math.floor(raw.length / 2));
    const cut = raw.lastIndexOf("，", mid) > 24 ? raw.lastIndexOf("，", mid) + 1 : mid;
    return [raw.slice(0, cut).trim(), raw.slice(cut).trim()].filter(Boolean);
  }
  // 多句：合并到约 80 字再合成
  const merged: string[] = [];
  let buf = "";
  for (const p of parts) {
    if (!buf) {
      buf = p;
      continue;
    }
    if (buf.length < 80) {
      buf += p;
      continue;
    }
    merged.push(buf);
    buf = p;
  }
  if (buf) merged.push(buf);
  return merged.length ? merged : [raw];
}

export interface CosyFastapiPcmResult {
  pcmBase64: string;
  sampleRate: number;
}

/** 流式分片事件（与 Rust `FastapiPcmStreamEvt` 对齐）。 */
export interface CosyFastapiPcmStreamEvt {
  jobId: string;
  kind: string;
  pcmBase64?: string | null;
  sampleRate: number;
  message?: string | null;
}

export const COSY_PCM_EVENT = "xu:cosy-pcm";

/** 16kHz mono PCM16 → 可 decode 的 WAV Blob。 */
export function pcm16ToWavBlob(samples: Int16Array, sampleRate = 22050): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, samples.length * 2, true);
  let off = 44;
  for (let i = 0; i < samples.length; i++) {
    view.setInt16(off, samples[i]!, true);
    off += 2;
  }
  return new Blob([buffer], { type: "audio/wav" });
}

/** base64 → Int16Array（小端 PCM）。 */
export function base64ToInt16(b64: string): Int16Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const aligned = bytes.byteLength & 1 ? bytes.slice(0, bytes.byteLength - 1) : bytes;
  return new Int16Array(aligned.buffer, aligned.byteOffset, aligned.byteLength / 2);
}

function appendInt16(a: Int16Array, b: Int16Array): Int16Array {
  if (!a.length) return b;
  if (!b.length) return a;
  const out = new Int16Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

/** PCM16 → AudioBuffer（跳过 WAV 封装，降低首包延迟）。 */
export function pcm16ToAudioBuffer(
  ac: AudioContext,
  pcm: Int16Array,
  sampleRate: number,
): AudioBuffer {
  const buf = ac.createBuffer(1, pcm.length, sampleRate);
  const ch = buf.getChannelData(0);
  for (let i = 0; i < pcm.length; i++) {
    ch[i] = pcm[i]! / 32768;
  }
  return buf;
}

function newJobId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `cosy_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * 经 Rust 代理调 FastAPI（避开 CORS），返回裸 PCM16。
 * 依赖：本机 CosyVoice FastAPI 已启动；失败抛错。
 */
export async function synthesizeFastapiPcm(opts: CosyFastapiSynthOpts): Promise<{
  pcm: Int16Array;
  sampleRate: number;
}> {
  const res = await Promise.race([
    invoke<CosyFastapiPcmResult>("xu_cosyvoice_fastapi_pcm", {
      baseUrl: opts.baseUrl.trim(),
      text: opts.text,
      promptWavPath: opts.promptWavPath?.trim() || null,
      promptText: opts.promptText?.trim() || null,
      instruct: opts.instruct?.trim() || null,
      spkId: opts.spkId?.trim() || null,
      modelDir: opts.modelDir?.trim() || null,
      fallbackPromptWav: opts.fallbackPromptWav?.trim() || null,
      fallbackPromptText: opts.fallbackPromptText?.trim() || null,
    }),
    new Promise<never>((_, reject) => {
      window.setTimeout(
        () =>
          reject(
            new Error(
              "Cosy 合成超时（120 秒）。CosyVoice2 首次加载模型较慢；请打开控制台查看 sidecar 日志。",
            ),
          ),
        125_000,
      );
    }),
  ]);
  const rate = res.sampleRate > 0 ? res.sampleRate : 22050;
  return { pcm: base64ToInt16(res.pcmBase64), sampleRate: rate };
}

/**
 * 流式合成：边收 PCM 边回调；invoke 在整段结束后 resolve。
 * 依赖：Rust `xu_cosyvoice_fastapi_pcm_stream` + 事件 `xu:cosy-pcm`。
 */
export async function synthesizeFastapiPcmStream(
  opts: CosyFastapiSynthOpts,
  onChunk: (pcm: Int16Array, sampleRate: number) => void,
  signal?: { aborted: () => boolean },
): Promise<number> {
  const jobId = newJobId();
  let sampleRate = 22050;
  let streamError: string | null = null;
  let unlisten: UnlistenFn | null = null;
  const t0 = performance.now();
  let firstChunkAt = 0;
  try {
    unlisten = await listen<CosyFastapiPcmStreamEvt>(COSY_PCM_EVENT, (ev) => {
      const p = ev.payload;
      if (!p || p.jobId !== jobId) return;
      if (signal?.aborted()) return;
      if (p.kind === "error") {
        streamError = (p.message || "Cosy 流式合成失败").trim();
        return;
      }
      if (p.kind === "chunk" && p.pcmBase64) {
        if (p.sampleRate > 0) sampleRate = p.sampleRate;
        if (!firstChunkAt) {
          firstChunkAt = performance.now();
          console.info(
            `[cosy-pcm] job=${jobId.slice(0, 8)} firstChunkMs=${Math.round(firstChunkAt - t0)} textLen=${opts.text.length}`,
          );
        }
        onChunk(base64ToInt16(p.pcmBase64), sampleRate);
        return;
      }
      if (p.kind === "done" && p.sampleRate > 0) {
        sampleRate = p.sampleRate;
      }
    });
    await Promise.race([
      invoke("xu_cosyvoice_fastapi_pcm_stream", {
        jobId,
        baseUrl: opts.baseUrl.trim(),
        text: opts.text,
        promptWavPath: opts.promptWavPath?.trim() || null,
        promptText: opts.promptText?.trim() || null,
        instruct: opts.instruct?.trim() || null,
        spkId: opts.spkId?.trim() || null,
        modelDir: opts.modelDir?.trim() || null,
        fallbackPromptWav: opts.fallbackPromptWav?.trim() || null,
        fallbackPromptText: opts.fallbackPromptText?.trim() || null,
      }),
      new Promise<never>((_, reject) => {
        window.setTimeout(
          () =>
            reject(
              new Error(
                "Cosy 流式合成超时（40 秒）。请检查 Cosy 服务，或改用系统/离线朗读。",
              ),
            ),
          40_000,
        );
      }),
      // 首包超时：证据 speak units 后无 finish + warm fail decode body → UI 假「说话」无声
      new Promise<never>((_, reject) => {
        window.setTimeout(() => {
          if (!firstChunkAt) {
            reject(new Error("Cosy 长时间未返回音频，本句将改用备用朗读。"));
          }
        }, 12_000);
      }),
    ]);
    if (streamError) throw new Error(streamError);
    if (signal?.aborted()) throw new Error("已取消");
    if (!firstChunkAt) {
      throw new Error("Cosy 流式未返回音频");
    }
    return sampleRate;
  } finally {
    try {
      unlisten?.();
    } catch {
      /* ignore */
    }
  }
}

export interface CosyFastapiPlayer {
  speak(text: string, opts: Omit<CosyFastapiSynthOpts, "text"> & { volume?: number }): Promise<void>;
  stop(): void;
}

class PartialStreamError extends Error {
  constructor() {
    super("流式播放中断，请重试；为避免重复播报，本次未自动重播。");
    this.name = "PartialStreamError";
  }
}

/**
 * AudioContext 按句流式播放；播第 i 句时预请求第 i+1 句。
 * 流式失败时回退整包合成。
 */
export function createCosyFastapiPlayer(): CosyFastapiPlayer {
  let aborted = false;
  let ctx: AudioContext | null = null;
  let current: AudioBufferSourceNode | null = null;
  let scheduled: AudioBufferSourceNode[] = [];
  /** 跨 speak() 续接时间线，减少段间「嘟」断点 */
  let timelineCursor = 0;

  const ensureCtx = () => {
    if (!ctx) ctx = new AudioContext();
    return ctx;
  };

  const stopSources = () => {
    for (const src of scheduled) {
      try {
        src.stop();
      } catch {
        /* already stopped */
      }
    }
    scheduled = [];
    try {
      current?.stop();
    } catch {
      /* already stopped */
    }
    current = null;
    timelineCursor = 0;
  };

  const applyProsody = (
    src: AudioBufferSourceNode,
    opts: Omit<CosyFastapiSynthOpts, "text">,
  ) => {
    const rate = opts.playbackRate;
    if (typeof rate === "number" && Number.isFinite(rate) && rate > 0) {
      src.playbackRate.value = Math.min(2, Math.max(0.5, rate));
    }
    const detune = opts.detuneCents;
    if (typeof detune === "number" && Number.isFinite(detune)) {
      src.detune.value = Math.min(1200, Math.max(-1200, detune));
    }
  };

  /** 短淡入淡出，减轻句间卡顿杂音 */
  const armFade = (gain: GainNode, ac: AudioContext, startAt: number, duration: number, volume: number) => {
    const vol = Math.min(1, Math.max(0, volume));
    const fade = Math.min(0.02, Math.max(0.008, duration * 0.08));
    try {
      gain.gain.cancelScheduledValues(startAt);
      gain.gain.setValueAtTime(0.0001, startAt);
      gain.gain.linearRampToValueAtTime(vol, startAt + fade);
      const fadeOutAt = startAt + Math.max(fade, duration - fade);
      gain.gain.setValueAtTime(vol, fadeOutAt);
      gain.gain.linearRampToValueAtTime(0.0001, startAt + duration);
    } catch {
      gain.gain.value = vol;
    }
  };

  async function unitToBuffer(
    unit: string,
    opts: Omit<CosyFastapiSynthOpts, "text">,
  ): Promise<AudioBuffer> {
    const { pcm, sampleRate } = await synthesizeFastapiPcm({ ...opts, text: unit });
    return pcm16ToAudioBuffer(ensureCtx(), pcm, sampleRate);
  }

  async function playBuffer(
    buf: AudioBuffer,
    volume: number,
    opts: Omit<CosyFastapiSynthOpts, "text">,
  ): Promise<void> {
    const ac = ensureCtx();
    if (ac.state === "suspended") await ac.resume();
    return new Promise((resolve, reject) => {
      if (aborted) {
        resolve();
        return;
      }
      // 工程双工：推送播放 PCM 作 AEC 参考
      tapAudioBuffer(buf);
      const src = ac.createBufferSource();
      const gain = ac.createGain();
      applyProsody(src, opts);
      const startAt = Math.max(ac.currentTime + 0.01, timelineCursor);
      armFade(gain, ac, startAt, buf.duration / Math.max(0.5, src.playbackRate.value), volume);
      src.buffer = buf;
      src.connect(gain);
      gain.connect(ac.destination);
      src.onended = () => resolve();
      try {
        current = src;
        scheduled.push(src);
        src.start(startAt);
        timelineCursor = startAt + buf.duration / Math.max(0.5, src.playbackRate.value);
      } catch (e) {
        reject(e instanceof Error ? e : new Error("播放失败"));
      }
    });
  }

  /**
   * 单句流式：收满约 0.2s PCM 即排期播放；失败抛错由上层回退。
   */
  async function playUnitStream(
    unit: string,
    opts: Omit<CosyFastapiSynthOpts, "text">,
    volume: number,
  ): Promise<void> {
    const ac = ensureCtx();
    if (ac.state === "suspended") await ac.resume();
    let pending: Int16Array<ArrayBufferLike> = new Int16Array(0);
    let sampleRate = 22050;
    let nextStart = Math.max(ac.currentTime + 0.02, timelineCursor);
    let endedWaiters: Promise<void>[] = [];
    let receivedPcm = false;
    const minSamples = () => Math.max(4800, Math.floor(sampleRate * 0.22));

    const schedulePcm = (pcm: Int16Array) => {
      if (aborted || !pcm.length) return;
      const buf = pcm16ToAudioBuffer(ac, pcm, sampleRate);
      tapAudioBuffer(buf);
      const src = ac.createBufferSource();
      const gain = ac.createGain();
      applyProsody(src, opts);
      const rate = Math.max(0.5, src.playbackRate.value);
      const dur = buf.duration / rate;
      const startAt = Math.max(ac.currentTime + 0.01, nextStart);
      armFade(gain, ac, startAt, dur, volume);
      src.buffer = buf;
      src.connect(gain);
      gain.connect(ac.destination);
      const waiter = new Promise<void>((resolve) => {
        src.onended = () => resolve();
      });
      endedWaiters.push(waiter);
      scheduled.push(src);
      current = src;
      src.start(startAt);
      nextStart = startAt + dur;
      timelineCursor = nextStart;
    };

    const flushPending = (force: boolean) => {
      const need = minSamples();
      while (pending.length >= need || (force && pending.length > 0)) {
        const take = force
          ? pending.length
          : Math.min(pending.length, Math.max(need, Math.floor(sampleRate * 0.45)));
        const slice = pending.subarray(0, take);
        pending = pending.subarray(take);
        schedulePcm(slice);
        if (force) break;
      }
    };

    try {
      await synthesizeFastapiPcmStream(
        { ...opts, text: unit },
        (pcm, rate) => {
          if (aborted) return;
          receivedPcm = receivedPcm || pcm.length > 0;
          if (rate > 0) sampleRate = rate;
          pending = appendInt16(pending, pcm);
          flushPending(false);
        },
        { aborted: () => aborted },
      );
    } catch (error) {
      if (receivedPcm) {
        stopSources();
        throw new PartialStreamError();
      }
      throw error;
    }
    if (aborted) return;
    flushPending(true);
    await Promise.all(endedWaiters);
  }

  return {
    async speak(text, opts) {
      aborted = false;
      // 不清 timelineCursor，跨句续接时间线
      const units = splitFastapiSpeakUnits(text);
      if (!units.length) return;
      const volume = opts.volume ?? 1;
      const playbackRate = opts.playbackRate;
      const detuneCents = opts.detuneCents;
      const { volume: _v, playbackRate: _r, detuneCents: _d, ...rest } = opts;
      void _v;
      void _r;
      void _d;
      const synthOpts = { ...rest, playbackRate, detuneCents };

      let i = 0;
      while (i < units.length) {
        if (aborted) break;
        const unit = units[i]!;
        const nextUnit = units[i + 1];
        const prefetch =
          nextUnit && !aborted
            ? unitToBuffer(nextUnit, synthOpts).catch(() => null)
            : null;
        try {
          await playUnitStream(unit, synthOpts, volume);
        } catch (error) {
          if (aborted) break;
          if (error instanceof PartialStreamError) throw error;
          const buf = await unitToBuffer(unit, synthOpts);
          if (!aborted) await playBuffer(buf, volume, synthOpts);
        }
        i += 1;
        if (!prefetch || aborted) continue;
        const pre = await prefetch;
        if (pre && !aborted) {
          await playBuffer(pre, volume, synthOpts);
          i += 1;
        }
      }
    },
    stop() {
      aborted = true;
      stopSources();
    },
  };
}

export interface CosyFastapiHealth {
  ok: boolean;
  scriptVersion: string;
  instanceId: string;
  modelDir: string;
  modelFamily: "cosyvoice1" | "cosyvoice2" | "cosyvoice3" | string;
  streaming: boolean;
  sampleRate: number;
}

export interface CosyFastapiHealthProbe {
  ready: boolean;
  reason: string;
  health?: CosyFastapiHealth | null;
}

/** 探测 Xu FastAPI 身份、流式能力和当前加载模型。 */
export function probeFastapiUrl(baseUrl: string): Promise<CosyFastapiHealthProbe> {
  return invoke<CosyFastapiHealthProbe>("xu_cosyvoice_fastapi_probe", {
    baseUrl: baseUrl.trim(),
  });
}
