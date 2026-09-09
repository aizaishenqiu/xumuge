<script setup lang="ts">
import { FouButton } from "foucui";
import { onMounted, onUnmounted, ref, watch } from "vue";
import {
  formatShortcutLabel,
  parseKeyEvent,
  type ShortcutSpec,
} from "../utils/shortcutSettings";

const props = defineProps<{
  modelValue: ShortcutSpec;
}>();

const emit = defineEmits<{
  "update:modelValue": [ShortcutSpec];
}>();

const recording = ref(false);
const display = ref(formatShortcutLabel(props.modelValue));

function onKey(e: KeyboardEvent) {
  if (!recording.value) return;
  e.preventDefault();
  e.stopPropagation();
  const spec = parseKeyEvent(e);
  if (!spec) return;
  recording.value = false;
  display.value = spec.label;
  emit("update:modelValue", spec);
}

watch(
  () => props.modelValue,
  (v) => {
    if (!recording.value) display.value = formatShortcutLabel(v);
  },
);

function startRecord() {
  recording.value = true;
  display.value = "按下快捷键…";
}

function cancelRecord() {
  recording.value = false;
  display.value = formatShortcutLabel(props.modelValue);
}

onMounted(() => {
  window.addEventListener("keydown", onKey, true);
});

onUnmounted(() => {
  window.removeEventListener("keydown", onKey, true);
});
</script>

<template>
  <div class="shortcut-capture ui-font">
    <FouButton
      class="shortcut-capture-input"
      :class="{ recording }"
      icon="keyboard-box-line"
      text
      native-type="button"
      @click="startRecord"
      @blur="cancelRecord"
    >
      {{ display }}
    </FouButton>
    <FouButton
      v-if="recording"
      icon="close-line"
      size="small"
      text
      native-type="button"
      aria-label="取消录制"
      @click="cancelRecord"
    />
  </div>
</template>

<style scoped>
.shortcut-capture {
  display: flex;
  align-items: center;
  gap: 6px;
}
.shortcut-capture-input {
  min-width: 140px;
  padding: 6px 12px;
  border-radius: 8px;
  border: 1px solid var(--hairline);
  background: var(--canvas);
  color: var(--ink);
  font-size: 13px;
  font-family: var(--font-mono);
  cursor: pointer;
  text-align: center;
}
.shortcut-capture-input.recording {
  border-color: var(--primary);
  box-shadow: 0 0 0 2px var(--primary-glow);
  color: var(--primary);
}
.shortcut-capture-input:hover:not(.recording) {
  border-color: var(--primary);
}
</style>
