<script setup lang="ts">
import type { VoicePhase } from "../../utils/voiceCall";

defineProps<{
  phase: VoicePhase;
  interimText: string;
}>();

const phaseLabel: Record<VoicePhase, string> = {
  idle: "",
  listening: "正在聆听…",
  thinking: "思考中…",
  speaking: "回复中…",
  error: "语音暂时不可用",
};
</script>

<template>
  <div class="voice-overlay ui-font">
    <div class="voice-overlay-head">
      <span class="voice-mic-pulse" :class="{ active: phase === 'listening' }">
        <FouIcon icon="mic-line" size="18" />
      </span>
      <span class="voice-phase">{{ phaseLabel[phase] || "语音通话" }}</span>
    </div>
    <p v-if="interimText" class="voice-interim">{{ interimText }}</p>
    <p v-else-if="phase === 'error'" class="voice-hint">请稍候恢复，或挂断后重试</p>
    <p v-else-if="phase === 'listening'" class="voice-hint">说完停顿约半秒自动发送</p>
  </div>
</template>

<style scoped>
.voice-overlay {
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid var(--primary);
  background: var(--primary-glow);
}
.voice-overlay-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.voice-mic-pulse {
  display: inline-flex;
  color: var(--primary);
}
.voice-mic-pulse.active {
  animation: pulse 1.2s ease-in-out infinite;
}
.voice-phase {
  font-size: 12px;
  font-weight: 600;
  color: var(--body-strong);
}
.voice-interim {
  margin: 8px 0 0;
  font-size: 14px;
  line-height: 1.45;
  color: var(--ink);
}
.voice-hint {
  margin: 6px 0 0;
  font-size: 11px;
  color: var(--muted);
}
@keyframes pulse {
  0%,
  100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.5;
    transform: scale(0.92);
  }
}
</style>
