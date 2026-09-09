/**
 * @file TTS 播放 PCM 参考环（工程双工 AEC 用）
 * @author qiuye <yjk150@qq.com>
 * @date 2026-09-07
 * @version 1.0.0
 * @category Stream
 * @algo ring-buffer-pcm-tap
 */

const TARGET_RATE = 16_000;
const CAPACITY = TARGET_RATE * 3; // ~3s

const ring = new Float32Array(CAPACITY);
let writePos = 0;
let available = 0;

/** Duty: 将 AudioBuffer 左声道重采样进参考环。Failure: 空缓冲忽略。 */
export function tapAudioBuffer(buf: AudioBuffer): void {
  if (!buf.length) return;
  const ch = buf.getChannelData(0);
  const srcRate = buf.sampleRate || TARGET_RATE;
  if (srcRate === TARGET_RATE) {
    pushSamples(ch);
    return;
  }
  const ratio = srcRate / TARGET_RATE;
  const outLen = Math.max(1, Math.floor(ch.length / ratio));
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const src = i * ratio;
    const i0 = Math.floor(src);
    const i1 = Math.min(ch.length - 1, i0 + 1);
    const t = src - i0;
    out[i] = ch[i0]! * (1 - t) + ch[i1]! * t;
  }
  pushSamples(out);
}

function pushSamples(samples: ArrayLike<number>): void {
  const n = samples.length;
  if (n <= 0) return;
  for (let i = 0; i < n; i++) {
    ring[writePos] = samples[i]!;
    writePos = (writePos + 1) % CAPACITY;
  }
  available = Math.min(CAPACITY, available + n);
}

/** Duty: 取出最多 max 个参考样点（FIFO）。Failure: 无数据返回空数组。 */
export function drainTap(max: number): Float32Array {
  const n = Math.min(max, available);
  if (n <= 0) return new Float32Array(0);
  const out = new Float32Array(n);
  const readPos = (writePos - available + CAPACITY) % CAPACITY;
  for (let i = 0; i < n; i++) {
    out[i] = ring[(readPos + i) % CAPACITY]!;
  }
  available -= n;
  return out;
}

/** Duty: 窥视可用参考样点数。 */
export function tapAvailable(): number {
  return available;
}

/** Duty: 清空参考环（打断/挂断时）。 */
export function clearTap(): void {
  writePos = 0;
  available = 0;
  ring.fill(0);
}

export const TTS_TAP_SAMPLE_RATE = TARGET_RATE;
