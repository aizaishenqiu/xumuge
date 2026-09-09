<script setup lang="ts">
/**
 * @file 科幻化连续语音助手状态舞台（粒子球 + 双栏字幕）
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-30
 * @updated 2026-09-02
 * @version 2.1.0
 * @category UI
 * @algo phase-driven-visual-state
 */
import { computed } from "vue";
import type { VoicePhase } from "../../utils/voiceCall";
import { voicePhaseLabel } from "../../utils/voiceAssistantPrefs";
import VoiceParticleOrb from "./VoiceParticleOrb.vue";

const props = defineProps<{
  phase: VoicePhase;
  interim: string;
  captions: Array<{ role: "user" | "assistant"; text: string }>;
  presetName?: string;
  summarizing?: boolean;
}>();

const phaseText = computed(() => voicePhaseLabel(props.phase));
const phaseClass = computed(() => `phase-${props.phase}`);

const orbActive = computed(
  () => props.phase === "listening" && Boolean(props.interim.trim()),
);

const statusHeadline = computed(() => {
  if (props.summarizing) return "正在总结本通通话";
  const name = (props.presetName || "助手").trim();
  if (props.phase === "error") return "语音暂时不可用";
  if (props.phase === "speaking") return `${name}正在说话`;
  if (props.phase === "listening") return `${name}正在聆听`;
  if (props.phase === "thinking") return `${name}正在思考`;
  return `${name}已就绪`;
});

const userCaption = computed(() => {
  if (props.interim.trim()) return props.interim.trim();
  const rows = [...props.captions].reverse();
  const hit = rows.find((r) => r.role === "user");
  return hit?.text || "";
});

const assistantCaption = computed(() => {
  if (props.summarizing) return "正在总结本通通话…";
  if (props.phase === "error") {
    return "识别或朗读出了问题。请稍候自动恢复，或点挂断后重试。";
  }
  const rows = [...props.captions].reverse();
  const hit = rows.find((r) => r.role === "assistant");
  if (hit?.text) return hit.text;
  if (props.phase === "thinking") return "思考中…";
  if (props.phase === "speaking") return "回复中…";
  if (props.phase === "listening" && !props.interim.trim()) {
    return "开始说话，停顿约半秒后我会回答";
  }
  return "语音助手就绪";
});
</script>

<template>
  <div class="vas-root ui-font" :class="phaseClass">
    <div class="vas-bg" aria-hidden="true" />
    <div class="vas-vignette" aria-hidden="true" />

    <div class="vas-center">
      <div class="vas-orb-wrap" :class="{ active: orbActive }">
        <VoiceParticleOrb :phase="phase" :active="orbActive" />
      </div>
    </div>

    <footer class="vas-bottom">
      <div class="vas-status-row">
        <strong class="vas-status-title">{{ statusHeadline }}</strong>
        <span class="vas-wave" :class="phaseClass" aria-hidden="true">
          <i /><i /><i /><i /><i />
        </span>
        <span class="vas-phase-pill">{{ phaseText }}</span>
      </div>

      <div class="vas-dual">
        <div class="vas-col vas-col-user">
          <p class="vas-col-label">你</p>
          <p class="vas-col-body">
            {{ userCaption || "（等待你说话）" }}
          </p>
        </div>
        <div class="vas-col vas-col-assistant">
          <p class="vas-col-label">助手{{ presetName ? ` · ${presetName}` : "" }}</p>
          <p class="vas-col-body">{{ assistantCaption }}</p>
        </div>
      </div>
    </footer>
  </div>
</template>

<style scoped>
.vas-root {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  color: #e8eef7;
  background: #03060c;
}

.vas-bg {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(ellipse at 50% 42%, rgba(56, 189, 248, 0.14), transparent 52%),
    radial-gradient(ellipse at 50% 100%, rgba(15, 23, 42, 0.9), #02040a 70%),
    linear-gradient(180deg, #050a14 0%, #02040a 100%);
  pointer-events: none;
}

.vas-vignette {
  position: absolute;
  inset: 0;
  box-shadow: inset 0 0 120px rgba(0, 0, 0, 0.65);
  pointer-events: none;
}

.vas-center {
  position: relative;
  z-index: 1;
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 8px 16px 12px;
}

.vas-orb-wrap {
  width: min(520px, 86vw);
  height: min(520px, 72vh);
  max-height: 100%;
}

.vas-bottom {
  position: relative;
  z-index: 2;
  width: min(920px, 94vw);
  margin: 0 auto 18px;
  padding: 0 8px;
}

.vas-status-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}

.vas-status-title {
  font-size: 22px;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: #f8fafc;
  text-shadow: 0 0 24px rgba(56, 189, 248, 0.25);
}

.vas-phase-pill {
  margin-left: auto;
  font-size: 12px;
  color: #94a3b8;
  padding: 4px 10px;
  border-radius: 999px;
  border: 1px solid rgba(148, 163, 184, 0.28);
  background: rgba(15, 23, 42, 0.55);
}

.vas-wave {
  display: inline-flex;
  align-items: flex-end;
  gap: 3px;
  height: 18px;
}

.vas-wave i {
  display: block;
  width: 3px;
  height: 6px;
  border-radius: 2px;
  background: #64748b;
}

.phase-listening .vas-wave i,
.phase-speaking .vas-wave i {
  background: #7dd3fc;
  animation: waveBar 0.9s ease-in-out infinite;
}

.phase-thinking .vas-wave i {
  background: #fbbf24;
  animation: waveBar 1.4s ease-in-out infinite;
}

.phase-error .vas-wave i {
  background: #f87171;
  animation: none;
  height: 5px;
  opacity: 0.55;
}

.phase-error .vas-status-title {
  color: #fecaca;
  text-shadow: 0 0 20px rgba(248, 113, 113, 0.35);
}

.phase-error .vas-phase-pill {
  color: #fca5a5;
  border-color: rgba(248, 113, 113, 0.4);
}

.vas-wave i:nth-child(2) {
  animation-delay: 0.1s;
}
.vas-wave i:nth-child(3) {
  animation-delay: 0.2s;
}
.vas-wave i:nth-child(4) {
  animation-delay: 0.3s;
}
.vas-wave i:nth-child(5) {
  animation-delay: 0.4s;
}

.phase-listening .vas-wave i:nth-child(1),
.phase-listening .vas-wave i:nth-child(5) {
  background: #86efac;
}

@keyframes waveBar {
  0%,
  100% {
    height: 5px;
    opacity: 0.55;
  }
  50% {
    height: 16px;
    opacity: 1;
  }
}

.vas-dual {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.vas-col {
  min-height: 88px;
  max-height: 140px;
  overflow: auto;
  padding: 12px 14px;
  border-radius: 12px;
  border: 1px solid rgba(148, 163, 184, 0.22);
  background: rgba(8, 14, 28, 0.72);
  backdrop-filter: blur(8px);
}

.vas-col-user {
  border-color: rgba(34, 197, 94, 0.35);
}

.vas-col-assistant {
  border-color: rgba(56, 189, 248, 0.4);
  box-shadow: 0 0 24px rgba(56, 189, 248, 0.08);
}

.vas-col-label {
  margin: 0 0 6px;
  font-size: 11px;
  letter-spacing: 0.06em;
  color: #94a3b8;
}

.vas-col-user .vas-col-label {
  color: #86efac;
}

.vas-col-assistant .vas-col-label {
  color: #7dd3fc;
}

.vas-col-body {
  margin: 0;
  font-size: 14px;
  line-height: 1.55;
  color: #e2e8f0;
  word-break: break-word;
  white-space: pre-wrap;
}

@media (max-width: 640px) {
  .vas-dual {
    grid-template-columns: 1fr;
  }
  .vas-status-title {
    font-size: 18px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .vas-root *,
  .vas-root *::before,
  .vas-root *::after {
    animation: none !important;
    transition: none !important;
  }
}
</style>
