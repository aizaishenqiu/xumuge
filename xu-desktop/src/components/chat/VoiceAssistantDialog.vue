<script setup lang="ts">
/**
 * @file 全屏语音助手外壳与风格选择
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-30
 * @updated 2026-09-01
 * @version 1.4.0
 * @category UI
 * @algo persisted-preset-selection
 */
import { computed, onUnmounted, ref, watch } from "vue";
import { FouButton } from "foucui";
import { openHelp } from "../../composables/useHelp";
import { clearStuckUiBlockers } from "../../utils/clearStuckUiBlockers";
import type { VoicePhase } from "../../utils/voiceCall";
import {
  VOICE_ASSISTANT_PRESETS,
  getVoiceAssistantPreset,
  loadVoiceAssistantId,
  saveVoiceAssistantId,
  type VoiceAssistantPreset,
} from "../../utils/voiceAssistantPrefs";
import VoiceAssistantStage from "./VoiceAssistantStage.vue";

const props = defineProps<{
  visible: boolean;
  phase: VoicePhase;
  interim: string;
  captions: Array<{ role: "user" | "assistant"; text: string }>;
  summarizing?: boolean;
}>();

const emit = defineEmits<{
  "update:visible": [boolean];
  ready: [];
  hangup: [];
  "open-style": [];
}>();

const pickedId = ref<string | null>(loadVoiceAssistantId());
const picking = ref(!getVoiceAssistantPreset(loadVoiceAssistantId()));

const preset = computed<VoiceAssistantPreset | null>(() =>
  getVoiceAssistantPreset(pickedId.value),
);

const capsuleTitle = computed(() => {
  const name = preset.value?.name;
  return name ? `个人智能助理 · ${name}` : "个人智能助理";
});

const PRESET_GRADIENTS: Record<string, string> = {
  "m-suit": "linear-gradient(145deg, #0f172a 0%, #1e3a5f 100%)",
  "m-vest": "linear-gradient(145deg, #431407 0%, #ea580c 100%)",
  "m-hoodie": "linear-gradient(145deg, #1e293b 0%, #475569 100%)",
  "f-navy": "linear-gradient(145deg, #172554 0%, #1d4ed8 100%)",
  "f-dress": "linear-gradient(145deg, #4c1d95 0%, #a855f7 100%)",
  "f-blazer": "linear-gradient(145deg, #78350f 0%, #d97706 100%)",
};

function presetGradient(id: string): string {
  return PRESET_GRADIENTS[id] ?? "linear-gradient(145deg, #0f172a 0%, #334155 100%)";
}

/** Resolve saved id; invalid → reopen picker (prevents black empty stage). */
function syncPresetFromStorage() {
  const id = loadVoiceAssistantId();
  const hit = getVoiceAssistantPreset(id);
  if (hit) {
    pickedId.value = hit.id;
    picking.value = false;
    emit("ready");
    return;
  }
  pickedId.value = null;
  picking.value = true;
}

watch(
  () => props.visible,
  (v) => {
    if (!v) {
      document.body.style.overflow = "";
      clearStuckUiBlockers();
      return;
    }
    document.body.style.overflow = "hidden";
    clearStuckUiBlockers();
    syncPresetFromStorage();
  },
);

function chooseLook(id: string) {
  saveVoiceAssistantId(id);
  pickedId.value = id;
  picking.value = false;
  emit("ready");
}

function reopenStylePicker() {
  picking.value = true;
}

function onHangup() {
  emit("hangup");
}

function onBackdropClick() {
  /* 通话中禁止点遮罩关闭，避免误触 */
}

onUnmounted(() => {
  document.body.style.overflow = "";
  clearStuckUiBlockers();
});
</script>

<template>
  <Teleport to="body">
    <div
      v-if="visible"
      class="voice-assistant-overlay ui-font"
      role="dialog"
      aria-modal="true"
      aria-label="语音助手"
      @click.self="onBackdropClick"
    >
      <div class="vad-panel">
        <header v-if="!picking" class="vad-chrome">
          <FouButton
            icon="settings-3-line"
            size="small"
            text
            native-type="button"
            aria-label="重选助手外观（性别音色请到设置）"
            title="重选助手外观；性别/音色/心情请到设置 → 语音与朗读"
            @click="reopenStylePicker"
          />
          <div class="vad-capsule" :title="capsuleTitle">
            <span class="vad-capsule-dot" />
            {{ capsuleTitle }}
          </div>
          <div class="vad-chrome-right">
            <FouButton
              icon="question-line"
              size="small"
              text
              native-type="button"
              aria-label="帮助"
              @click="openHelp('chat.voice-assistant')"
            />
            <FouButton
              icon="phone-off-line"
              type="danger"
              size="small"
              native-type="button"
              @click="onHangup"
            >
              挂断
            </FouButton>
          </div>
        </header>

        <div class="vad-shell">
          <div v-if="picking" class="vad-picker">
            <p class="vad-lead">选一套助手风格开始通话（男 3 / 女 3）</p>
            <div class="vad-grid">
              <button
                v-for="p in VOICE_ASSISTANT_PRESETS"
                :key="p.id"
                type="button"
                class="vad-card"
                :class="{ active: pickedId === p.id }"
                :aria-label="`${p.genderLabel} · ${p.name} · ${p.lookLabel}`"
                @click="chooseLook(p.id)"
              >
                <div class="vad-card-visual" :style="{ background: presetGradient(p.id) }">
                  <span class="vad-card-glyph" aria-hidden="true">{{
                    p.gender === "female" ? "♀" : "♂"
                  }}</span>
                </div>
                <span class="vad-card-meta">
                  <em>{{ p.genderLabel }} · {{ p.name }}</em>
                  {{ p.lookLabel }}
                </span>
              </button>
            </div>
            <div class="vad-picker-actions">
              <FouButton icon="question-line" size="small" text native-type="button" @click="openHelp('chat.voice-assistant')">
                帮助
              </FouButton>
              <FouButton icon="phone-off-line" type="danger" size="small" native-type="button" @click="onHangup">
                取消
              </FouButton>
            </div>
          </div>

          <template v-else-if="preset">
            <VoiceAssistantStage
              :phase="phase"
              :interim="interim"
              :captions="captions"
              :preset-name="preset.name"
              :summarizing="summarizing"
            />
          </template>

          <div v-else class="vad-fallback">
            <p>助手风格无效，请重新选择。</p>
            <FouButton icon="refresh-line" native-type="button" @click="reopenStylePicker">
              重选风格
            </FouButton>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.voice-assistant-overlay {
  position: fixed;
  inset: 0;
  z-index: 9800;
  display: flex;
  flex-direction: column;
  background: #03060c;
}

.vad-panel {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.vad-chrome {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 5;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  pointer-events: none;
}

.vad-chrome :deep(.fou-button),
.vad-chrome .vad-capsule {
  pointer-events: auto;
}

.vad-capsule {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  max-width: min(420px, 52vw);
  margin: 0 auto;
  padding: 7px 14px;
  border-radius: 999px;
  border: 1px solid rgba(148, 163, 184, 0.28);
  background: rgba(15, 23, 42, 0.55);
  backdrop-filter: blur(10px);
  color: #cbd5e1;
  font-size: 13px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.vad-capsule-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #38bdf8;
  box-shadow: 0 0 10px rgba(56, 189, 248, 0.8);
  flex-shrink: 0;
}

.vad-chrome-right {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
}

.vad-shell {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.vad-picker {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 48px 20px 24px;
  color: #e2e8f0;
  background: linear-gradient(165deg, #050810 0%, #0a1628 100%);
}

.vad-lead {
  margin: 0 0 16px;
  font-size: 14px;
  color: #94a3b8;
  text-align: center;
}

.vad-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  max-width: 720px;
  margin: 0 auto;
}

.vad-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 10px;
  border: 1px solid rgba(148, 163, 184, 0.25);
  border-radius: 14px;
  background: rgba(15, 23, 42, 0.65);
  cursor: pointer;
}

.vad-card.active,
.vad-card:hover {
  border-color: rgba(56, 189, 248, 0.65);
  box-shadow: 0 0 20px rgba(56, 189, 248, 0.2);
}

.vad-card-visual {
  width: 100%;
  aspect-ratio: 3 / 4;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(255, 255, 255, 0.92);
}

.vad-card-glyph {
  font-size: 36px;
  opacity: 0.9;
}

.vad-card-meta {
  font-size: 12px;
  color: #cbd5e1;
}

.vad-card-meta em {
  font-style: normal;
  margin-right: 4px;
  color: #7dd3fc;
}

.vad-picker-actions {
  display: flex;
  justify-content: center;
  gap: 10px;
  margin-top: 20px;
}

.vad-fallback {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: #e2e8f0;
  background: #050810;
}

@media (prefers-reduced-motion: reduce) {
  .voice-assistant-overlay *,
  .voice-assistant-overlay *::before,
  .voice-assistant-overlay *::after {
    animation: none !important;
    transition: none !important;
  }
}
</style>
