<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { FouButton } from "foucui";
import { verifyLoginPassword } from "../utils/auth";
import { RESET_DELETE_PHRASE } from "../utils/resetReplanConstants";
import { toUserError } from "../utils/userFacingError";

const props = defineProps<{
  modelValue: boolean;
  previewText?: string;
  generatePath?: string;
}>();

const emit = defineEmits<{
  "update:modelValue": [boolean];
  confirmed: [];
}>();

const step = ref<1 | 2>(1);
const password = ref("");
const phrase = ref("");
const ackIrreversible = ref(false);
const error = ref("");
const busy = ref(false);

const pathPreview = computed(() => {
  const p = props.generatePath?.trim();
  return p || "（未设置生成路径）";
});

watch(
  () => props.modelValue,
  (open) => {
    if (!open) {
      step.value = 1;
      password.value = "";
      phrase.value = "";
      ackIrreversible.value = false;
      error.value = "";
      busy.value = false;
    }
  },
);

function close() {
  emit("update:modelValue", false);
}

async function onStep1Next() {
  if (!password.value.trim()) {
    error.value = "请输入登录密码";
    return;
  }
  busy.value = true;
  error.value = "";
  try {
    await verifyLoginPassword(password.value);
    step.value = 2;
    password.value = "";
  } catch (e) {
    const msg = toUserError(e);
    error.value = msg.includes("密码") ? "密码错误" : msg;
  } finally {
    busy.value = false;
  }
}

function onConfirmDelete() {
  if (phrase.value.trim() !== RESET_DELETE_PHRASE) {
    error.value = `请输入「${RESET_DELETE_PHRASE}」以继续`;
    return;
  }
  if (!ackIrreversible.value) {
    error.value = "请勾选「我已知晓不可恢复」";
    return;
  }
  emit("update:modelValue", false);
  emit("confirmed");
  phrase.value = "";
  ackIrreversible.value = false;
}
</script>

<template>
  <FouDialog
    :model-value="modelValue"
    :title="step === 1 ? '确认清理重规划（1/2）' : '确认删除全部产出（2/2）'"
    width="520px"
    append-to-body
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="reset-confirm-body">
      <template v-if="step === 1">
        <p class="reset-risk">
          此操作将<strong>全员停工</strong>、取消在跑会话，并<strong>删除生成路径下的全部文件与目录</strong>后重新规划。误操作将导致项目产出<strong>不可恢复</strong>丢失。
        </p>
        <p v-if="previewText" class="reset-preview">指令：{{ previewText }}</p>
        <p class="reset-hint">请输入当前登录密码（云账号请用云端密码，非本机镜像密码）。</p>
        <FouInput
          v-model="password"
          type="password"
          placeholder="输入当前登录密码"
          autocomplete="current-password"
          :disabled="busy"
          @keyup.enter="onStep1Next"
        />
      </template>
      <template v-else>
        <p class="reset-risk reset-risk--danger">
          将永久删除以下写入目录中的<strong>全部内容</strong>（无保留 playbook / .xu 例外）：
        </p>
        <p class="reset-path">{{ pathPreview }}</p>
        <FouInput
          v-model="phrase"
          placeholder="输入「确认删除」"
          :disabled="busy"
          @keyup.enter="onConfirmDelete"
        />
        <FouCheckbox v-model="ackIrreversible" :disabled="busy">
          我已知晓不可恢复，确认删除上述目录全部内容
        </FouCheckbox>
      </template>
      <p v-if="error" class="reset-error">{{ error }}</p>
    </div>
    <template #footer>
      <FouButton icon="close-line" :disabled="busy" @click="close">取消</FouButton>
      <FouButton
        v-if="step === 1"
        type="primary"
        icon="shield-keyhole-line"
        :loading="busy"
        @click="onStep1Next"
      >
        下一步
      </FouButton>
      <FouButton
        v-else
        type="danger"
        icon="delete-bin-line"
        :loading="busy"
        @click="onConfirmDelete"
      >
        确认删除并清理
      </FouButton>
    </template>
  </FouDialog>
</template>

<style scoped>
.reset-confirm-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.reset-risk {
  margin: 0;
  font-size: 13px;
  line-height: 1.55;
  color: var(--body, #334155);
}
.reset-risk--danger {
  color: var(--danger, #dc2626);
}
.reset-preview,
.reset-path {
  margin: 0;
  font-size: 12px;
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--surface-muted, rgba(127, 127, 127, 0.08));
  color: var(--ink-muted, #64748b);
  word-break: break-word;
}
.reset-path {
  font-family: ui-monospace, monospace;
}
.reset-hint {
  margin: 0;
  font-size: 12px;
  color: var(--ink-muted, #64748b);
}
.reset-ack {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: 12px;
  line-height: 1.45;
  cursor: pointer;
}
.reset-error {
  margin: 0;
  font-size: 12px;
  color: var(--danger, #dc2626);
}
</style>
