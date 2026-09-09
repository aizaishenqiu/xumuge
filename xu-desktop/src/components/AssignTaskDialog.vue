<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { FouButton } from "foucui";
import {
  canUseInputDrive,
  readDriveSettings,
} from "../utils/driveSettings";
import { canUseSdkDriveAsync } from "../utils/cursorSdkBridge";
import { toUserError } from "../utils/userFacingError";
import {
  dispatchEmployeeTask,
  employeeBoundarySummary,
  updateEmployee,
  type Employee,
} from "../employee";

const props = defineProps<{
  open: boolean;
  employee: Employee | null;
}>();

const emit = defineEmits<{
  close: [];
}>();

const task = ref("");
const error = ref("");
const driveHint = ref("");
const starting = ref(false);

const dialogOpen = computed({
  get: () => Boolean(props.open && props.employee),
  set: (v: boolean) => {
    if (!v) emit("close");
  },
});

watch(
  () => props.open,
  (open) => {
    if (open) {
      task.value = "";
      error.value = "";
      starting.value = false;
      void (async () => {
        const drive = readDriveSettings();
        if (props.employee?.driveMode === "input_control" && !canUseInputDrive(drive)) {
          driveHint.value = "本员工偏好键鼠驾驶，但设置页尚未同意启用 — 将仅派虚募阁任务。";
        } else if (props.employee?.driveMode === "sdk" && !(await canUseSdkDriveAsync(drive))) {
          driveHint.value =
            "本员工偏好 SDK，请在设置中开启编码驾驶 · Cursor SDK，并确保本机已安装 Cursor 命令行。";
        } else {
          driveHint.value = "";
        }
      })();
    }
  },
);

function close() {
  emit("close");
}

async function start() {
  if (!props.employee) return;
  if (!props.employee.workspaceRoot?.trim()) {
    error.value = "请先编辑员工并设置可写工作区";
    return;
  }
  if (!task.value.trim()) {
    error.value = "请填写任务内容";
    return;
  }
  starting.value = true;
  error.value = "";
  try {
    // 虚募阁 Native Agent path — no hermes CLI
    await dispatchEmployeeTask(props.employee, { task: task.value.trim() });
    await updateEmployee(props.employee.id, { status: "working" });
    emit("close");
  } catch (e) {
    error.value = toUserError(e);
  } finally {
    starting.value = false;
  }
}
</script>

<template>
  <FouDialog
    v-model="dialogOpen"
    :title="employee ? `派活 · ${employee.name}` : '派活'"
    width="480px"
    append-to-body
    :close-on-click-modal="true"
    :close-on-press-escape="true"
    :show-fullscreen="false"
    :show-minimize="false"
    :draggable="false"
    :resizable="false"
    :z-index="20000"
    @close="close"
  >
    <template v-if="employee">
      <p class="emp-boundary ui-font">{{ employeeBoundarySummary(employee) }}</p>
      <p class="emp-boundary ui-font">将切换至脑槽：{{ employee.brainSlot }}</p>
      <p v-if="driveHint" class="emp-hint">{{ driveHint }}</p>

      <label class="emp-field ui-font">
        <span>任务说明</span>
        <FouInput
          v-model="task"
          type="textarea"
          :rows="5"
          placeholder="描述要做的事；系统会自动附加路径边界策略前缀"
        />
      </label>

      <p v-if="error" class="emp-error">{{ error }}</p>
    </template>

    <template #footer>
      <FouButton icon="close-line" native-type="button" @click="close">取消</FouButton>
      <FouButton
        type="primary"
        icon="play-line"
        native-type="button"
        :disabled="starting"
        @click="start"
      >
        {{ starting ? "切换模型…" : "开始（前往对话）" }}
      </FouButton>
    </template>
  </FouDialog>
</template>

<style scoped>
.emp-boundary {
  margin: 0 0 8px;
  font-size: 12px;
  color: var(--muted);
  word-break: break-all;
}
.emp-hint {
  margin: 0 0 10px;
  font-size: 12px;
  color: #b45309;
}
.emp-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 12px;
  font-size: 12px;
  color: var(--muted);
}
.emp-error {
  color: #b42318;
  font-size: 12px;
  margin: 0 0 8px;
}
</style>
