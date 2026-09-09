<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { FouButton } from "foucui";
import PatchDiffCard from "./chat/PatchDiffCard.vue";
import {
  ensureEmployeeLiveBridge,
  subscribeAgentLive,
  type AgentLiveEvent,
} from "../employee/events";
import { formatToolApprovalLabel, formatToolArgsSummary } from "../utils/toolApprovalLabels";
import { isPatchTool, parseToolPatch } from "../utils/patchDiff";
import { toUserError } from "../utils/userFacingError";

type Pending = {
  sessionId: string;
  callId: string;
  toolName: string;
  toolArgs: string;
  employeeId?: string | null;
};

const queue = ref<Pending[]>([]);
const busy = ref(false);
const error = ref("");
let unsub: (() => void) | null = null;

const visible = computed({
  get: () => queue.value.length > 0,
  set: (v: boolean) => {
    if (!v) queue.value = [];
  },
});

const pending = computed(() => queue.value[0] ?? null);
const queueHint = computed(() =>
  queue.value.length > 1 ? `（另有 ${queue.value.length - 1} 项排队）` : "",
);

const toolLabel = computed(() => {
  const p = pending.value;
  if (!p) return "";
  return formatToolApprovalLabel(p.toolName, p.toolArgs);
});

const isChatAgent = computed(() => !pending.value?.employeeId);

const patchChanges = computed(() => {
  const p = pending.value;
  if (!p || !isPatchTool(p.toolName)) return [];
  return parseToolPatch(p.toolName, p.toolArgs);
});

const isBulkReadWarning = computed(() => pending.value?.toolName === "bulk_read_warning");

const bulkReadReason = computed(() => {
  const p = pending.value;
  if (!p || p.toolName !== "bulk_read_warning") return "";
  try {
    const v = JSON.parse(p.toolArgs || "{}") as { reason?: string };
    return (v.reason || "").trim();
  } catch {
    return "";
  }
});

const argsSummary = computed(() => {
  const p = pending.value;
  if (!p || patchChanges.value.length || isBulkReadWarning.value) return "";
  return formatToolArgsSummary(p.toolName, p.toolArgs);
});

const dialogWidth = computed(() =>
  patchChanges.value.length > 0 ? "min(920px, 96vw)" : "480px",
);

const dialogTitle = computed(() =>
  isBulkReadWarning.value ? "疑似整仓上传到模型" : "工具调用审批",
);

function onAgent(ev: AgentLiveEvent) {
  if (ev.kind !== "awaiting_approval") return;
  const callId = ev.callId || "";
  if (!callId || !ev.sessionId) return;
  const item: Pending = {
    sessionId: ev.sessionId,
    callId,
    toolName: ev.toolName || "tool",
    toolArgs: ev.toolArgs || "",
    employeeId: ev.employeeId,
  };
  if (queue.value.some((q) => q.sessionId === item.sessionId && q.callId === item.callId)) {
    return;
  }
  queue.value = [...queue.value, item];
  error.value = "";
}

async function decide(allow: boolean) {
  const p = pending.value;
  if (!p || busy.value) return;
  busy.value = true;
  error.value = "";
  try {
    await invoke("xu_agent_approve_tool", {
      sessionId: p.sessionId,
      callId: p.callId,
      allow,
    });
    queue.value = queue.value.slice(1);
  } catch (e) {
    error.value = toUserError(e);
  } finally {
    busy.value = false;
  }
}

function onKeydown(e: KeyboardEvent) {
  if (!visible.value || busy.value) return;
  if (e.key === "Escape") {
    e.preventDefault();
    void decide(false);
  } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    void decide(true);
  }
}

onMounted(() => {
  void ensureEmployeeLiveBridge();
  unsub = subscribeAgentLive(onAgent);
  window.addEventListener("keydown", onKeydown);
});
onUnmounted(() => {
  unsub?.();
  unsub = null;
  window.removeEventListener("keydown", onKeydown);
});
</script>

<template>
  <FouDialog
    v-model="visible"
    class="tool-approval-dialog"
    :title="dialogTitle"
    :width="dialogWidth"
    :close-on-click-modal="false"
    :close-on-press-escape="false"
    append-to-body
    destroy-on-close
    :z-index="32000"
  >
    <div v-if="pending" class="appr ui-font">
      <p class="lead">
        <template v-if="isBulkReadWarning">
          {{ bulkReadReason || "检测到本会话读取文件过多，疑似将整个项目发送到模型。" }}
          继续可能导致源码外泄到远程 API。
        </template>
        <template v-else-if="isChatAgent">
          虚募阁请求执行工具，请查看变更后点「允许」或「拒绝」{{ queueHint }}。
        </template>
        <template v-else>
          员工 Agent 请求执行高危工具，请点「允许」或「拒绝」{{ queueHint }}。
          <strong>不操作会卡住所有相关派活（最多等 5 分钟）。</strong>
        </template>
      </p>
      <p class="tool"><strong>{{ toolLabel }}</strong></p>
      <p v-if="argsSummary && argsSummary !== toolLabel" class="args-summary">{{ argsSummary }}</p>
      <PatchDiffCard v-if="patchChanges.length" :changes="patchChanges" />
      <p class="hint">Esc 拒绝 · Ctrl+Enter 允许</p>
      <p v-if="error" class="err">{{ error }}</p>
    </div>
    <template #footer>
      <FouButton
        icon="stop-circle-line"
        native-type="button"
        :disabled="busy"
        @click="decide(false)"
      >
        {{ isBulkReadWarning ? "停止使用" : "拒绝" }}
      </FouButton>
      <FouButton
        icon="checkbox-circle-line"
        type="primary"
        native-type="button"
        :disabled="busy"
        @click="decide(true)"
      >
        {{ isBulkReadWarning ? "继续（风险自负）" : "允许" }}
      </FouButton>
    </template>
  </FouDialog>
</template>

<style scoped>
.appr {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.lead {
  margin: 0;
  color: var(--muted, #64748b);
  font-size: 13px;
  line-height: 1.45;
}
.lead strong {
  color: #b45309;
}
.tool {
  margin: 0;
  font-size: 15px;
}
.args-summary {
  margin: 0;
  font-size: 13px;
  color: var(--muted, #64748b);
  line-height: 1.45;
}
.hint {
  margin: 0;
  font-size: 11px;
  opacity: 0.65;
}
.err {
  margin: 0;
  color: #b91c1c;
  font-size: 12px;
}
</style>

<style>
.fou-dialog-root.tool-approval-dialog {
  z-index: 32000 !important;
}
</style>
