/**
 * @file 办公室提醒音：短促提示音，不依赖外部资源
 * @author qiuye <yjk150@qq.com>
 * @date 2026-09-02
 * @version 1.0.0
 * @category Stream
 * @algo web-audio-beep
 */

let sharedCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return null;
    if (!sharedCtx || sharedCtx.state === "closed") {
      sharedCtx = new Ctx();
    }
    if (sharedCtx.state === "suspended") {
      void sharedCtx.resume().catch(() => {});
    }
    return sharedCtx;
  } catch {
    return null;
  }
}

/** Play a short attention beep (two-tone). */
export function playAttentionBeep(volume = 0.35): void {
  const ctx = getAudioContext();
  if (!ctx) return;
  const now = ctx.currentTime;
  const gain = ctx.createGain();
  gain.gain.value = Math.max(0.05, Math.min(1, volume));
  gain.connect(ctx.destination);

  const playTone = (freq: number, start: number, dur: number) => {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = freq;
    osc.connect(gain);
    osc.start(now + start);
    osc.stop(now + start + dur);
  };

  playTone(880, 0, 0.12);
  playTone(1174, 0.14, 0.16);
}

/** Optional TTS one-liner for boss idle reminders. */
export function speakAttentionLine(text: string): void {
  const line = (text || "").trim();
  if (!line || typeof window === "undefined" || !window.speechSynthesis) return;
  try {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(line);
    utterance.lang = "zh-CN";
    utterance.rate = 1.05;
    utterance.volume = 0.9;
    window.speechSynthesis.speak(utterance);
  } catch {
    /* ignore */
  }
}
