<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { FouButton } from "foucui";

const props = withDefaults(
  defineProps<{
    visible: boolean;
    options: string[];
    title?: string;
    hint?: string;
    voiceHint?: boolean;
  }>(),
  {
    title: "想做什么？",
    hint: "选一项继续，或点「都不是」。",
    voiceHint: false,
  },
);

const emit = defineEmits<{
  "update:visible": [boolean];
  pick: [text: string];
  none: [];
}>();

const open = computed({
  get: () => props.visible,
  set: (v: boolean) => emit("update:visible", v),
});

const selected = ref(-1);

watch(
  () => [props.visible, props.options] as const,
  ([vis]) => {
    if (vis) selected.value = -1;
  },
);

function confirm() {
  const opt = props.options[selected.value];
  if (!opt) return;
  emit("pick", opt);
  emit("update:visible", false);
}

function none() {
  emit("none");
  emit("update:visible", false);
}
</script>

<template>
  <FouDialog
    v-model="open"
    :title="title"
    width="520px"
    append-to-body
    :close-on-click-modal="false"
    :show-fullscreen="false"
    :show-minimize="false"
    :z-index="22000"
  >
    <p class="cpd-hint ui-font">
      {{ hint }}
      <span v-if="voiceHint">也可以直接说编号，或说「都不是」。</span>
    </p>
    <div class="cpd-list">
      <button
        v-for="(opt, i) in options"
        :key="i"
        type="button"
        class="cpd-opt ui-font"
        :class="{ active: selected === i }"
        @click="selected = i"
      >
        <FouIcon :icon="selected === i ? 'checkbox-circle-fill' : 'checkbox-blank-circle-line'" />
        <span>{{ i + 1 }}. {{ opt }}</span>
      </button>
    </div>
    <template #footer>
      <FouButton icon="close-circle-line" native-type="button" @click="none">都不是</FouButton>
      <FouButton
        type="primary"
        icon="check-line"
        native-type="button"
        :disabled="selected < 0"
        @click="confirm"
      >
        选这项
      </FouButton>
    </template>
  </FouDialog>
</template>

<style scoped>
.cpd-hint {
  margin: 0 0 12px;
  font-size: 13px;
  color: var(--muted, #64748b);
  line-height: 1.45;
}
.cpd-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.cpd-opt {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  text-align: left;
  padding: 10px 12px;
  border: 1px solid var(--hairline, #e5e7eb);
  border-radius: 10px;
  background: var(--surface, #fff);
  color: inherit;
  cursor: pointer;
}
.cpd-opt.active {
  border-color: var(--primary, #3b82f6);
  background: var(--primary-glow, #eff6ff);
}
.cpd-opt span {
  line-height: 1.4;
}
</style>
