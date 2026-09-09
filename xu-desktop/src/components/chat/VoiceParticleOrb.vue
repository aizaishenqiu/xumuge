<script setup lang="ts">
/**
 * @file 语音助手 Canvas2D 粒子球（相位驱动，避免 WebGL 黑屏）
 * @author qiuye <yjk150@qq.com>
 * @date 2026-09-01
 * @updated 2026-09-02
 * @version 1.1.0
 * @category UI
 * @algo fibonacci-sphere-particles
 */
import { onMounted, onUnmounted, ref } from "vue";
import type { VoicePhase } from "../../utils/voiceCall";

const props = defineProps<{
  phase: VoicePhase;
  active?: boolean;
}>();

type Particle = { ox: number; oy: number; oz: number };

const canvasRef = ref<HTMLCanvasElement | null>(null);
let raf = 0;
let particles: Particle[] = [];
let rotY = 0;
let rotX = 0.18;
let disposed = false;

function particleCount(): number {
  try {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return 240;
  } catch {
    /* ignore */
  }
  const cores = navigator.hardwareConcurrency || 4;
  return cores <= 4 ? 480 : 820;
}

function fibonacciSphere(n: number): Particle[] {
  const out: Particle[] = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / Math.max(1, n - 1)) * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = golden * i;
    out.push({
      ox: Math.cos(theta) * r,
      oy: y,
      oz: Math.sin(theta) * r,
    });
  }
  return out;
}

function phaseStyle(phase: VoicePhase, active: boolean) {
  if (phase === "listening") {
    return {
      core: "rgba(34,197,94,0.55)",
      glow: "rgba(134,239,172,0.95)",
      speed: active ? 0.018 : 0.01,
      pulse: active ? 0.08 : 0.04,
      size: active ? 2.2 : 1.8,
    };
  }
  if (phase === "thinking") {
    return {
      core: "rgba(234,179,8,0.45)",
      glow: "rgba(253,230,138,0.9)",
      speed: 0.006,
      pulse: 0.03,
      size: 1.7,
    };
  }
  if (phase === "speaking") {
    return {
      core: "rgba(56,189,248,0.55)",
      glow: "rgba(186,230,253,0.98)",
      speed: 0.014,
      pulse: 0.07,
      size: 2.1,
    };
  }
  if (phase === "error") {
    return {
      core: "rgba(185,28,28,0.5)",
      glow: "rgba(252,165,165,0.75)",
      speed: 0.002,
      pulse: 0.01,
      size: 1.45,
    };
  }
  return {
    core: "rgba(148,163,184,0.35)",
    glow: "rgba(226,232,240,0.85)",
    speed: 0.004,
    pulse: 0.02,
    size: 1.5,
  };
}

function resize(canvas: HTMLCanvasElement) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(1, Math.floor(rect.width * dpr));
  const h = Math.max(1, Math.floor(rect.height * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
}

function frame(ts: number) {
  if (disposed) return;
  const canvas = canvasRef.value;
  if (!canvas) {
    raf = requestAnimationFrame(frame);
    return;
  }
  resize(canvas);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    raf = requestAnimationFrame(frame);
    return;
  }
  const style = phaseStyle(props.phase, Boolean(props.active));
  const w = canvas.width;
  const h = canvas.height;
  const cx = w * 0.5;
  const cy = h * 0.48;
  const radius = Math.min(w, h) * 0.38;
  const t = ts * 0.001;
  const breathe =
    1 + Math.sin(t * (props.phase === "speaking" ? 3.2 : 2.1)) * style.pulse;

  rotY += style.speed;
  rotX = 0.18 + Math.sin(t * 0.35) * 0.05;
  const cosY = Math.cos(rotY);
  const sinY = Math.sin(rotY);
  const cosX = Math.cos(rotX);
  const sinX = Math.sin(rotX);

  ctx.clearRect(0, 0, w, h);

  const grd = ctx.createRadialGradient(cx, cy, radius * 0.05, cx, cy, radius * 1.35);
  grd.addColorStop(0, style.core);
  grd.addColorStop(0.45, "rgba(8,15,30,0.15)");
  grd.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = grd;
  ctx.beginPath();
  ctx.arc(cx, cy, radius * 1.35 * breathe, 0, Math.PI * 2);
  ctx.fill();

  const projected = particles.map((p) => {
    const x1 = p.ox * cosY - p.oz * sinY;
    const z1 = p.ox * sinY + p.oz * cosY;
    const y1 = p.oy * cosX - z1 * sinX;
    const z2 = p.oy * sinX + z1 * cosX;
    return { x: x1, y: y1, z: z2 };
  });
  projected.sort((a, b) => a.z - b.z);

  const dpr = window.devicePixelRatio || 1;
  for (const p of projected) {
    const depth = (p.z + 1) * 0.5;
    const px = cx + p.x * radius * breathe;
    const py = cy + p.y * radius * breathe;
    const alpha = 0.22 + depth * 0.78;
    const size = style.size * (0.55 + depth * 0.9) * dpr;
    ctx.beginPath();
    ctx.fillStyle = `rgba(226,240,255,${alpha})`;
    ctx.arc(px, py, size, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.beginPath();
  ctx.fillStyle = style.glow;
  ctx.globalAlpha = 0.35 + style.pulse;
  ctx.arc(cx, cy, radius * 0.12 * breathe, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  raf = requestAnimationFrame(frame);
}

onMounted(() => {
  disposed = false;
  particles = fibonacciSphere(particleCount());
  raf = requestAnimationFrame(frame);
});

onUnmounted(() => {
  disposed = true;
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
  particles = [];
});
</script>

<template>
  <canvas ref="canvasRef" class="vpo-canvas" aria-hidden="true" />
</template>

<style scoped>
.vpo-canvas {
  width: 100%;
  height: 100%;
  display: block;
  pointer-events: none;
}
</style>
