<script setup lang="ts">
/**
 * @file 需求澄清弹窗：行业标准缺口表单；支持「不适用」一键跳过
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-31
 * @updated 2026-09-02
 * @version 3.1.0
 * @category Layout
 * @algo clarify-dialog-na
 */
import { computed, nextTick, ref, watch } from "vue";
import { FouButton } from "foucui";
import { getClarifyChipOptions } from "../intent/briefGaps";
import { clearStuckUiBlockers } from "../utils/clearStuckUiBlockers";

const props = withDefaults(
  defineProps<{
    visible: boolean;
    questions: string[];
    title?: string;
    hint?: string;
  }>(),
  {
    title: "补充需求",
    hint: "按行业标准逐项补充（每轮最多 3 问）。不适用请点「不适用」或填「无」。",
  },
);

const emit = defineEmits<{
  "update:visible": [boolean];
  submit: [answers: string[]];
  skip: [];
}>();

const dialogOpen = computed({
  get: () => props.visible,
  set: (v: boolean) => emit("update:visible", v),
});

watch(dialogOpen, (open) => {
  if (!open) nextTick(() => clearStuckUiBlockers());
});

const answers = ref<string[]>([]);

/** 每次打开弹窗或问题列表变化时清空，避免沿用上一轮答案 */
watch(
  () => [props.visible, props.questions.join("\x1e")] as const,
  ([vis]) => {
    if (!vis) return;
    answers.value = props.questions.map(() => "");
  },
);

const canSubmit = computed(
  () =>
    props.questions.length > 0 &&
    props.questions.every((_, i) => (answers.value[i] || "").trim().length > 0),
);

function markNotApplicable(index: number) {
  const next = [...answers.value];
  next[index] = "本期不适用";
  answers.value = next;
}

function chipsForQuestion(q: string): string[] {
  return getClarifyChipOptions(q);
}

function applyChip(index: number, chip: string) {
  const next = [...answers.value];
  next[index] = chip;
  answers.value = next;
}

function onSubmit() {
  if (!canSubmit.value) return;
  emit(
    "submit",
    props.questions.map((_, i) => (answers.value[i] || "").trim()),
  );
  emit("update:visible", false);
}

function onSkip() {
  emit("skip");
  emit("update:visible", false);
}
</script>

<template>
  <FouDialog
    v-model="dialogOpen"
    :title="title"
    width="560px"
    append-to-body
    :close-on-click-modal="false"
    :show-fullscreen="false"
    :show-minimize="false"
    :z-index="21000"
  >
    <p class="rcd-hint ui-font">{{ hint }}</p>
    <div v-for="(q, i) in questions" :key="'q-' + i" class="rcd-field">
      <div class="rcd-label-row">
        <label class="rcd-label ui-font">{{ i + 1 }}. {{ q }}</label>
        <FouButton
          icon="prohibited-line"
          size="small"
          native-type="button"
          @click="markNotApplicable(i)"
        >
          不适用
        </FouButton>
      </div>
      <div v-if="chipsForQuestion(q).length" class="rcd-chips">
        <FouButton
          v-for="chip in chipsForQuestion(q)"
          :key="chip"
          icon="flashlight-line"
          size="small"
          native-type="button"
          @click="applyChip(i, chip)"
        >
          {{ chip }}
        </FouButton>
      </div>
      <FouInput
        v-model="answers[i]"
        type="textarea"
        :rows="2"
        :placeholder="'请填写；不会就点「不适用」'"
      />
    </div>
    <template #footer>
      <FouButton icon="time-line" native-type="button" @click="onSkip">稍后</FouButton>
      <FouButton
        type="primary"
        icon="check-line"
        native-type="button"
        :disabled="!canSubmit"
        @click="onSubmit"
      >
        提交并继续
      </FouButton>
    </template>
  </FouDialog>
</template>

<style scoped>
.rcd-hint {
  margin: 0 0 12px;
  font-size: 13px;
  color: var(--muted, #64748b);
  line-height: 1.45;
}
.rcd-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 12px;
}
.rcd-label-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
}
.rcd-label {
  flex: 1;
  font-size: 13px;
  color: var(--body-strong, #0f172a);
  line-height: 1.4;
}
.rcd-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
</style>
