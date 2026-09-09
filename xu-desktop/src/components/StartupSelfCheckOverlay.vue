<!--
  @file 登录后非阻塞自检：右下角卡片，不挡操作；失败不挡进入系统
  @author qiuye <yjk150@qq.com>
  @date 2026-09-01
  @updated 2026-09-01
  @version 1.1.0
  @category Layout
  @algo soft-startup-probe
-->
<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import { FouButton } from "foucui";
import {
  markStartupSelfCheckDone,
  runStartupSelfCheck,
  type SelfCheckItem,
  type SelfCheckStatus,
} from "../utils/startupSelfCheck";

const emit = defineEmits<{ done: [] }>();

const visible = ref(true);
const items = ref<SelfCheckItem[]>([]);
const finished = ref(false);
let autoCloseTimer: ReturnType<typeof setTimeout> | null = null;

function statusLabel(s: SelfCheckStatus): string {
  switch (s) {
    case "pending":
      return "等待";
    case "running":
      return "进行中";
    case "ok":
      return "成功";
    case "fail":
      return "失败";
    case "skip":
      return "跳过";
    default:
      return "";
  }
}

function dismiss() {
  visible.value = false;
  markStartupSelfCheckDone();
  if (autoCloseTimer) {
    clearTimeout(autoCloseTimer);
    autoCloseTimer = null;
  }
  emit("done");
}

onMounted(async () => {
  markStartupSelfCheckDone();
  await runStartupSelfCheck((next) => {
    items.value = next;
  });
  finished.value = true;
  autoCloseTimer = setTimeout(() => {
    dismiss();
  }, 2500);
});

onUnmounted(() => {
  if (autoCloseTimer) clearTimeout(autoCloseTimer);
});
</script>

<template>
  <div v-if="visible" class="startup-selfcheck" role="status" aria-live="polite">
    <div class="startup-selfcheck-panel">
      <div class="startup-selfcheck-head">
        <h2 class="startup-selfcheck-title ui-font">启动自检</h2>
        <FouButton icon="close-line" size="small" text aria-label="关闭" @click="dismiss" />
      </div>
      <p class="startup-selfcheck-sub ui-font">不挡操作；Cosy 将延后后台启动，避免抢显卡黑屏。</p>
      <ul class="startup-selfcheck-list">
        <li
          v-for="it in items"
          :key="it.id"
          class="startup-selfcheck-row"
          :class="`is-${it.status}`"
        >
          <span class="startup-selfcheck-name ui-font">{{ it.title }}</span>
          <span class="startup-selfcheck-badge ui-font">{{ statusLabel(it.status) }}</span>
          <span class="startup-selfcheck-detail ui-font">{{ it.detail }}</span>
        </li>
      </ul>
      <div class="startup-selfcheck-footer">
        <FouButton icon="check-line" type="primary" size="small" @click="dismiss">
          知道了
        </FouButton>
      </div>
    </div>
  </div>
</template>

<style scoped>
.startup-selfcheck {
  position: fixed;
  right: 16px;
  bottom: 16px;
  z-index: 9200;
  pointer-events: none;
}

.startup-selfcheck-panel {
  pointer-events: auto;
  width: min(360px, calc(100vw - 32px));
  padding: 14px 14px 12px;
  border-radius: 10px;
  background: #1a1f2a;
  color: #e8eaed;
  border: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.35);
}

.startup-selfcheck-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.startup-selfcheck-title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
}

.startup-selfcheck-sub {
  margin: 6px 0 12px;
  font-size: 12px;
  color: #9aa0a6;
  line-height: 1.4;
}

.startup-selfcheck-list {
  list-style: none;
  margin: 0 0 12px;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 200px;
  overflow: auto;
}

.startup-selfcheck-row {
  display: grid;
  grid-template-columns: 1fr auto;
  grid-template-rows: auto auto;
  gap: 2px 10px;
  padding: 8px 10px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.04);
}

.startup-selfcheck-name {
  font-size: 13px;
  font-weight: 500;
}

.startup-selfcheck-badge {
  font-size: 11px;
  justify-self: end;
}

.startup-selfcheck-detail {
  grid-column: 1 / -1;
  font-size: 11px;
  color: #9aa0a6;
  word-break: break-word;
}

.is-running .startup-selfcheck-badge {
  color: #f0c14a;
}

.is-ok .startup-selfcheck-badge {
  color: #34d399;
}

.is-fail .startup-selfcheck-badge {
  color: #f87171;
}

.is-skip .startup-selfcheck-badge,
.is-skip .startup-selfcheck-detail {
  color: #9aa0a6;
}

.startup-selfcheck-footer {
  display: flex;
  justify-content: flex-end;
}
</style>
