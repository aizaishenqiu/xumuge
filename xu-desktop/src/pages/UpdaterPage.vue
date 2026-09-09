<script setup lang="ts">
/**
 * @file UpdaterPage.vue 独立更新窗：下载进度 + 静默安装
 * @author qiuye <yjk150@qq.com>
 * @date 2026-09-05
 * @version 1.0.0
 * @category UI
 * @algo none
 */
import { onMounted, onUnmounted, ref } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { FouButton, fouAlert } from "foucui";
/** FouIcon 由 setupFoucui 全局注册；勿从 foucui 具名导入 */
import {
  clearPendingAppUpdate,
  loadPendingAppUpdate,
  UPDATE_START_EVENT,
  userFacingUpdateError,
  type PendingAppUpdate,
} from "../utils/appUpdateCheck";
import {
  closeUpdaterWindow,
  restoreBusinessWindowsAfterUpdate,
} from "../utils/windowManager";

const stage = ref("准备中…");
const received = ref(0);
const total = ref<number | null>(null);
const percent = ref(0);
const busy = ref(false);
const failed = ref(false);
let unlistenProgress: UnlistenFn | undefined;
let unlistenStart: UnlistenFn | undefined;
let started = false;

function applyProgress(p: {
  stage?: string;
  received?: number;
  total?: number | null;
  message?: string;
}) {
  if (p.message) stage.value = p.message;
  else if (p.stage) stage.value = p.stage;
  received.value = Number(p.received || 0);
  total.value = p.total == null ? null : Number(p.total);
  if (total.value && total.value > 0) {
    percent.value = Math.min(100, Math.round((received.value / total.value) * 100));
  } else if (p.stage === "done" || p.stage === "launching") {
    percent.value = 100;
  }
}

async function runJob(job: PendingAppUpdate) {
  if (started || busy.value) return;
  started = true;
  busy.value = true;
  failed.value = false;
  stage.value = "正在下载安装包…";
  try {
    const path = await invoke<string>("xu_app_update_download", {
      url: job.installerUrl,
      version: job.version,
      expectedSha256: job.expectedSha256 || null,
    });
    stage.value = "正在安装并准备重启…";
    percent.value = 100;
    clearPendingAppUpdate();
    await invoke("xu_app_update_launch", { path });
  } catch (e) {
    failed.value = true;
    busy.value = false;
    started = false;
    clearPendingAppUpdate();
    await fouAlert(userFacingUpdateError(e), "软件更新");
    await restoreBusinessWindowsAfterUpdate();
  }
}

async function onCancel() {
  clearPendingAppUpdate();
  await restoreBusinessWindowsAfterUpdate();
  await closeUpdaterWindow();
}

onMounted(() => {
  void (async () => {
    try {
      unlistenProgress = await listen<{
        stage?: string;
        received?: number;
        total?: number | null;
        message?: string;
      }>("xu:app-update-progress", (e) => applyProgress(e.payload || {}));
    } catch {
      /* ignore */
    }
    try {
      unlistenStart = await listen<PendingAppUpdate>(UPDATE_START_EVENT, (e) => {
        if (e.payload?.installerUrl) void runJob(e.payload);
      });
    } catch {
      /* ignore */
    }
    const pending = await loadPendingAppUpdate();
    if (pending) void runJob(pending);
  })();
});

onUnmounted(() => {
  try {
    unlistenProgress?.();
  } catch {
    /* ignore */
  }
  try {
    unlistenStart?.();
  } catch {
    /* ignore */
  }
});
</script>

<template>
  <div class="updater-page">
    <div class="updater-head">
      <FouIcon icon="download-cloud-2-line" size="22" />
      <div class="updater-title">软件更新</div>
    </div>
    <div class="updater-stage ui-font">{{ stage }}</div>
    <div class="updater-bar" role="progressbar" :aria-valuenow="percent" aria-valuemin="0" aria-valuemax="100">
      <div class="updater-bar-fill" :style="{ width: `${percent}%` }" />
    </div>
    <div class="updater-meta ui-font">
      <span v-if="total != null && total > 0">{{ percent }}%</span>
      <span v-else-if="busy">请稍候…</span>
      <span v-else-if="failed">更新失败</span>
    </div>
    <div v-if="failed" class="updater-actions">
      <FouButton icon="arrow-go-back-line" type="default" @click="onCancel">返回</FouButton>
    </div>
  </div>
</template>

<style scoped>
.updater-page {
  box-sizing: border-box;
  height: 100vh;
  padding: 20px 24px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  background: var(--fou-bg, #fff);
  color: var(--fou-text, #1a1a1a);
}
.updater-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.updater-title {
  font-size: 16px;
  font-weight: 600;
}
.updater-stage {
  font-size: 13px;
  opacity: 0.85;
  min-height: 1.4em;
}
.updater-bar {
  height: 8px;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.08);
  overflow: hidden;
}
.updater-bar-fill {
  height: 100%;
  background: #2f6bff;
  transition: width 0.2s ease;
}
.updater-meta {
  font-size: 12px;
  opacity: 0.7;
}
.updater-actions {
  margin-top: auto;
  display: flex;
  justify-content: flex-end;
}
</style>
