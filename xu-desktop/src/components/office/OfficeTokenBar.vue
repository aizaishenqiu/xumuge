<script setup lang="ts">
/**
 * @file OfficeTokenBar.vue 办公室底座：Token 实时已用 + 设置中的套餐额度
 * @author qiuye <yjk150@qq.com>
 * @date 2026-09-08
 * @version 1.0.0
 * @category Layout
 * @algo none
 */
import { computed, onMounted, onUnmounted, ref } from "vue";
import { FouButton } from "foucui";
import { formatTokenCount, tokenPackageStatus, type TokenPackageStatus } from "../../utils/billing";
import { openAppSettings } from "../../utils/openAppSettings";

const tokenPkg = ref<TokenPackageStatus | null>(null);
let pollTimer: number | null = null;

const usedLabel = computed(() => formatTokenCount(tokenPkg.value?.usedTokens ?? 0));
const limitLabel = computed(() => formatTokenCount(tokenPkg.value?.hardLimit ?? 0));
const remainLabel = computed(() => formatTokenCount(tokenPkg.value?.remaining ?? 0));
const pct = computed(() => {
  const lim = tokenPkg.value?.hardLimit ?? 0;
  if (lim <= 0) return 0;
  return Math.min(100, Math.round(((tokenPkg.value?.usedTokens ?? 0) / lim) * 100));
});
const warnClass = computed(() => {
  if (tokenPkg.value?.hardHit) return "is-hard";
  if (tokenPkg.value?.softHit) return "is-soft";
  return "";
});

async function refresh() {
  try {
    tokenPkg.value = await tokenPackageStatus();
  } catch {
    /* keep last */
  }
}

function openTokenSettings() {
  void openAppSettings(undefined, "models");
}

function onOfficeNotify() {
  void refresh();
}

onMounted(() => {
  void refresh();
  pollTimer = window.setInterval(() => void refresh(), 4000);
  window.addEventListener("xu-office-notify", onOfficeNotify);
  window.addEventListener("xu-employees-changed", onOfficeNotify);
  window.addEventListener("xu-employee-live", onOfficeNotify);
  window.addEventListener("focus", onOfficeNotify);
});

onUnmounted(() => {
  if (pollTimer != null) window.clearInterval(pollTimer);
  pollTimer = null;
  window.removeEventListener("xu-office-notify", onOfficeNotify);
  window.removeEventListener("xu-employees-changed", onOfficeNotify);
  window.removeEventListener("xu-employee-live", onOfficeNotify);
  window.removeEventListener("focus", onOfficeNotify);
});
</script>

<template>
  <div
    class="office-token-base ui-font"
    :class="warnClass"
    role="status"
    :title="tokenPkg?.message || 'Token 套餐用量（与设置 → 模型 → Token 套餐一致）'"
  >
    <FouIcon icon="coin-line" size="16" class="otb-icon" />
    <div class="otb-text">
      <strong>Token</strong>
      <span>
        已用 {{ usedLabel }} / 额度 {{ limitLabel }}
        <template v-if="tokenPkg"> · 剩余 {{ remainLabel }}</template>
      </span>
      <span v-if="tokenPkg?.hardHit" class="otb-flag">已达硬限</span>
      <span v-else-if="tokenPkg?.softHit" class="otb-flag">接近软限</span>
    </div>
    <div class="otb-track" aria-hidden="true">
      <div class="otb-fill" :style="{ width: `${pct}%` }" />
    </div>
    <span class="otb-pct">{{ pct }}%</span>
    <FouButton
      icon="settings-3-line"
      size="small"
      text
      native-type="button"
      title="打开 Token 套餐设置"
      aria-label="打开 Token 套餐设置"
      @click="openTokenSettings"
    >
      额度设置
    </FouButton>
  </div>
</template>

<style scoped>
.office-token-base {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  flex-shrink: 0;
  padding: 6px 12px;
  border-radius: 8px;
  border: 1px solid var(--hairline, rgba(42, 53, 64, 0.35));
  background: color-mix(in srgb, var(--surface-card, #1a222c) 92%, transparent);
  font-size: 12px;
  color: var(--muted, #8b9aab);
}
.otb-icon {
  flex-shrink: 0;
  opacity: 0.9;
}
.otb-text {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  min-width: 0;
}
.otb-text strong {
  color: var(--body-strong, #e8eef4);
  font-weight: 600;
}
.otb-flag {
  color: #b45309;
  font-weight: 600;
}
.office-token-base.is-soft {
  border-color: rgba(180, 83, 9, 0.35);
  background: rgba(180, 83, 9, 0.08);
}
.office-token-base.is-hard {
  border-color: rgba(185, 28, 28, 0.4);
  background: rgba(185, 28, 28, 0.1);
}
.office-token-base.is-hard .otb-flag {
  color: #dc2626;
}
.otb-track {
  flex: 1 1 120px;
  min-width: 80px;
  max-width: 220px;
  height: 6px;
  border-radius: 999px;
  background: rgba(127, 140, 155, 0.25);
  overflow: hidden;
}
.otb-fill {
  height: 100%;
  border-radius: inherit;
  background: var(--primary, #3b82f6);
  transition: width 0.25s ease;
}
.is-soft .otb-fill {
  background: #d97706;
}
.is-hard .otb-fill {
  background: #dc2626;
}
.otb-pct {
  font-variant-numeric: tabular-nums;
  min-width: 2.5em;
  text-align: right;
}
</style>
