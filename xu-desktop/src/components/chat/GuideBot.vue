<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
  useGuideBotAppearance,
  type GuideBotAppearance,
} from "../../composables/useGuideBotAppearance";

export type GuideBotMood =
  | "sleep"
  | "heartbeat"
  | "ok"
  | "pulse"
  | "error"
  | "typing"
  | "alert"
  | "success";

const props = withDefaults(
  defineProps<{
    streaming?: boolean;
    error?: string | null;
    typing?: boolean;
    contextPct?: number;
    queued?: boolean;
    emptySession?: boolean;
    /** Settings preview: fixed appearance + mood */
    appearanceOnly?: boolean;
    appearance?: GuideBotAppearance;
    mood?: GuideBotMood;
  }>(),
  {
    streaming: false,
    typing: false,
    contextPct: 0,
    queued: false,
    emptySession: false,
    appearanceOnly: false,
  },
);

const { appearance: storedAppearance } = useGuideBotAppearance();

const appearance = computed(() => {
  if (props.appearance) return props.appearance;
  if (props.appearanceOnly) return storedAppearance.value;
  return storedAppearance.value;
});

const justFinished = ref(false);
let finishTimer: ReturnType<typeof setTimeout> | undefined;

watch(
  () => props.streaming,
  (streaming, was) => {
    if (was && !streaming) {
      justFinished.value = true;
      if (finishTimer) clearTimeout(finishTimer);
      finishTimer = setTimeout(() => {
        justFinished.value = false;
      }, 1500);
    }
  },
);

const mood = computed<GuideBotMood>(() => {
  if (props.mood) return props.mood;
  if (props.error?.trim()) return "error";
  if (props.contextPct >= 70 && !props.streaming) return "alert";
  if (props.streaming && props.queued) return "ok";
  if (props.streaming) return "heartbeat";
  if (justFinished.value) return "success";
  if (props.typing) return "typing";
  if (props.emptySession) return "pulse";
  return "sleep";
});

const avatarClass = computed(() => [
  "guide-bot-avatar",
  `guide-bot-avatar-${appearance.value}`,
  `guide-bot-${mood.value}`,
]);
</script>

<template>
  <div class="guide-bot" :class="`guide-bot-${mood}`">
    <div :class="avatarClass">
      <div class="guide-bot-antenna" />
      <div class="guide-bot-head">
        <div class="guide-bot-screen">
          <div class="guide-bot-pixel-grid" />
          <div class="guide-face guide-face-eyes">
            <span class="guide-eye guide-eye-left" />
            <span class="guide-eye guide-eye-right" />
            <span class="guide-mouth" />
          </div>
          <div class="guide-face guide-face-sleep">
            <span>z</span>
            <span>z</span>
            <span>z</span>
          </div>
          <div class="guide-face guide-face-heartbeat">
            <svg viewBox="0 0 31 15" aria-hidden="true">
              <path d="M0 8 L6 8 L9 3 L13 12 L16 6 L19 10 L22 8 L31 8" />
            </svg>
          </div>
          <div class="guide-face guide-face-ok">OK</div>
          <div class="guide-face guide-face-pulse">
            <span />
            <span />
            <span />
          </div>
          <div class="guide-face guide-face-error">!</div>
          <div class="guide-face guide-face-typing">
            <span class="guide-typing-eye guide-typing-eye-left" />
            <span class="guide-typing-eye guide-typing-eye-right" />
            <span class="guide-typing-mouth" />
          </div>
          <div class="guide-face guide-face-alert">
            <span class="guide-alert-eye guide-alert-eye-left" />
            <span class="guide-alert-eye guide-alert-eye-right" />
            <span class="guide-alert-mouth" />
          </div>
          <div class="guide-face guide-face-success">✓</div>
        </div>
      </div>
      <div class="guide-bot-base" />
    </div>
  </div>
</template>
