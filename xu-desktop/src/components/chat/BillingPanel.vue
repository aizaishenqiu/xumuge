<script setup lang="ts">
/**
 * @file 对话账单明细与额度状态面板
 * @author qiuye <yjk150@qq.com>
 * @updated 2026-09-07
 * @version 1.1.0
 * @category UI
 * @algo disposed-listener-guard
 */
import { onApiCatch } from "../../utils/userFacingError";
import { FouButton, fouMsg } from "foucui";
import { listen } from "@tauri-apps/api/event";
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import {
  formatCnyMicros,
  formatTokenCount,
  getPresetQuota,
  listTokenBills,
  pricingSyncDue,
  syncModelPricing,
  tokenBillingSummary,
  tokenPackageStatus,
  type PresetQuotaStatus,
  type TokenBillRow,
  type TokenBillingSummary,
  type TokenPackageStatus,
} from "../../utils/billing";
import { openAppSettings } from "../../utils/openAppSettings";
import { router } from "../../router";

const props = defineProps<{
  presetId: string;
  modelLabel: string;
  /** 个人中心等场景：始终展开明细 */
  alwaysExpanded?: boolean;
}>();

const expanded = ref(false);
const loading = ref(false);
const syncing = ref(false);
const summary = ref<TokenBillingSummary | null>(null);
const bills = ref<TokenBillRow[]>([]);
const quota = ref<PresetQuotaStatus | null>(null);
const tokenPkg = ref<TokenPackageStatus | null>(null);

const effectivePresetId = computed(() => {
  const id = props.presetId?.trim();
  if (id) return id;
  return "local";
});

const headerCost = computed(() => formatCnyMicros(summary.value?.costCnyMicros ?? 0));

const quotaPct = computed(() => {
  const q = quota.value;
  if (!q || q.hardLimitCnyMicros <= 0) return 0;
  return Math.min(100, Math.round((q.usedCnyMicros / q.hardLimitCnyMicros) * 100));
});

function formatTime(ts: number): string {
  try {
    const d = new Date(ts);
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  } catch {
    return "";
  }
}

function sourceLabel(source: string): string {
  if (source === "chat") return "对话";
  if (source.startsWith("employee")) return "派活";
  return source;
}

async function refresh() {
  const pid = effectivePresetId.value;
  loading.value = true;
  try {
    const rows = await tokenBillingSummary(pid);
    if (rows.length) {
      summary.value = rows.reduce(
        (acc, r) => ({
          presetId: pid,
          model: r.model || props.modelLabel,
          provider: r.provider,
          callCount: acc.callCount + r.callCount,
          promptTokens: acc.promptTokens + r.promptTokens,
          completionTokens: acc.completionTokens + r.completionTokens,
          cachedTokens: acc.cachedTokens + r.cachedTokens,
          costCnyMicros: acc.costCnyMicros + r.costCnyMicros,
        }),
        {
          presetId: pid,
          model: props.modelLabel,
          provider: "",
          callCount: 0,
          promptTokens: 0,
          completionTokens: 0,
          cachedTokens: 0,
          costCnyMicros: 0,
        } satisfies TokenBillingSummary,
      );
    } else {
      summary.value = {
        presetId: pid,
        model: props.modelLabel,
        provider: "",
        callCount: 0,
        promptTokens: 0,
        completionTokens: 0,
        cachedTokens: 0,
        costCnyMicros: 0,
      };
    }
    bills.value = await listTokenBills(pid, 20);
    tokenPkg.value = await tokenPackageStatus().catch(() => null);
    if (pid && pid !== "local") {
      quota.value = await getPresetQuota(pid).catch(() => null);
    } else {
      quota.value = null;
    }
  } catch (e) {
    console.warn("billing refresh", e);
  } finally {
    loading.value = false;
  }
}

async function onSyncPricing() {
  syncing.value = true;
  try {
    await syncModelPricing();
    fouMsg.success("价格已同步");
    await refresh();
  } catch (e) {
    void onApiCatch(e);
  } finally {
    syncing.value = false;
  }
}

async function maybeAutoSyncPricing() {
  try {
    const due = await pricingSyncDue();
    if (due) await syncModelPricing();
  } catch {
    /* optional remote manifest */
  }
}

let unlistenBilling: (() => void) | undefined;
let pollTimer: ReturnType<typeof setInterval> | undefined;
let disposed = false;

onMounted(async () => {
  disposed = false;
  await maybeAutoSyncPricing();
  if (disposed) return;
  await refresh();
  if (disposed) return;
  const stop = await listen("xu:billing-updated", () => {
    if (disposed) return;
    void refresh();
  });
  if (disposed) {
    stop();
    return;
  }
  unlistenBilling = stop;
  pollTimer = setInterval(() => {
    void refresh();
  }, 5000);
});

onUnmounted(() => {
  disposed = true;
  unlistenBilling?.();
  if (pollTimer) clearInterval(pollTimer);
});

watch(
  () => [props.presetId, props.modelLabel],
  () => {
    void refresh();
  },
);

function toggleExpanded() {
  expanded.value = !expanded.value;
}

function openTokenSettings() {
  void openAppSettings(router.currentRoute.value.path, "models");
}
</script>

<template>
  <section class="billing-panel ui-font" :class="{ expanded: alwaysExpanded || expanded }">
    <FouButton
      v-if="!alwaysExpanded"
      class="billing-header"
      icon="money-cny-box-line"
      text
      native-type="button"
      @click="toggleExpanded"
    >
      <span class="billing-title">账单</span>
      <span class="billing-model" :title="modelLabel">{{ modelLabel || "未选模型" }}</span>
      <span
        v-if="tokenPkg"
        class="billing-token"
        :class="{ warn: tokenPkg.softHit || tokenPkg.hardHit }"
        :title="tokenPkg.message"
      >
        Token {{ formatTokenCount(tokenPkg.usedTokens) }}/{{ formatTokenCount(tokenPkg.hardLimit) }}
      </span>
      <span class="billing-cost">{{ headerCost }}</span>
      <FouIcon :icon="expanded ? 'arrow-down-s-line' : 'arrow-up-s-line'" size="14" class="chevron" />
    </FouButton>

    <div v-if="alwaysExpanded || expanded" class="billing-body">
      <div v-if="loading" class="billing-hint">加载中…</div>
      <template v-else>
        <div
          v-if="tokenPkg"
          class="token-pkg"
          :class="{ hard: tokenPkg.hardHit, soft: tokenPkg.softHit && !tokenPkg.hardHit }"
        >
          <div class="token-pkg-row">
            <span>Token 套餐</span>
            <strong
              >{{ formatTokenCount(tokenPkg.usedTokens) }} / {{ formatTokenCount(tokenPkg.hardLimit) }}</strong
            >
          </div>
          <p class="token-pkg-msg">{{ tokenPkg.message }}</p>
          <FouButton
            icon="settings-3-line"
            size="small"
            text
            native-type="button"
            title="设置 Token 限额"
            aria-label="设置 Token 限额"
            @click="openTokenSettings"
          >
            设置限额
          </FouButton>
        </div>
        <div class="billing-stats">
          <div class="stat-row">
            <span>输入</span>
            <strong>{{ formatTokenCount(summary?.promptTokens ?? 0) }}</strong>
          </div>
          <div class="stat-row">
            <span>输出</span>
            <strong>{{ formatTokenCount(summary?.completionTokens ?? 0) }}</strong>
          </div>
          <div class="stat-row">
            <span>缓存命中</span>
            <strong>{{ formatTokenCount(summary?.cachedTokens ?? 0) }}</strong>
          </div>
          <div class="stat-row total">
            <span>参考费用</span>
            <strong>{{ formatCnyMicros(summary?.costCnyMicros ?? 0) }}</strong>
          </div>
          <div class="stat-row muted">
            <span>调用次数</span>
            <strong>{{ summary?.callCount ?? 0 }}</strong>
          </div>
        </div>

        <div v-if="quota && quota.hardLimitCnyMicros > 0" class="quota-bar">
          <div class="quota-label">
            限额 {{ formatCnyMicros(quota.usedCnyMicros) }} / {{ formatCnyMicros(quota.hardLimitCnyMicros) }}
          </div>
          <div class="quota-track">
            <div class="quota-fill" :style="{ width: `${quotaPct}%` }" />
          </div>
        </div>

        <ul v-if="bills.length" class="bill-list">
          <li v-for="b in bills" :key="b.id" class="bill-item">
            <span class="bill-time">{{ formatTime(b.createdAt) }}</span>
            <span class="bill-src">{{ sourceLabel(b.source) }}</span>
            <span class="bill-tokens">
              ↑{{ formatTokenCount(b.promptTokens) }} ↓{{ formatTokenCount(b.completionTokens) }}
              <template v-if="b.cachedTokens"> · 缓存{{ formatTokenCount(b.cachedTokens) }}</template>
            </span>
            <span class="bill-cost">{{ formatCnyMicros(b.costCnyMicros) }}</span>
          </li>
        </ul>
        <p v-else class="billing-hint">暂无调用记录</p>

        <FouButton
          icon="refresh-line"
          size="small"
          text
          :loading="syncing"
          native-type="button"
          @click="onSyncPricing"
        >
          同步最新价格
        </FouButton>
        <p class="billing-note">参考价，以厂商账单为准；缓存仅统计 API 返回的 usage 字段。</p>
      </template>
    </div>
  </section>
</template>

<style scoped>
.billing-panel {
  flex-shrink: 0;
  border-top: 1px solid var(--hairline);
  background: var(--surface-card);
}
.billing-header {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 12px;
  color: var(--ink);
}
.billing-header:hover {
  background: var(--surface-soft);
}
.billing-title {
  font-weight: 600;
}
.billing-model {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--muted);
  font-size: 11px;
}
.billing-token {
  flex-shrink: 0;
  font-size: 11px;
  color: var(--muted);
}
.billing-token.warn {
  color: #b45309;
  font-weight: 600;
}
.token-pkg {
  margin-bottom: 10px;
  padding: 8px;
  border-radius: 8px;
  background: var(--surface-soft);
  border: 1px solid var(--hairline);
}
.token-pkg.soft {
  border-color: #f59e0b;
}
.token-pkg.hard {
  border-color: #dc2626;
  background: rgba(220, 38, 38, 0.06);
}
.token-pkg-row {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-size: 12px;
}
.token-pkg-msg {
  margin: 6px 0;
  font-size: 12px;
  color: var(--muted);
  line-height: 1.4;
}
.billing-cost {
  font-weight: 600;
  color: var(--primary);
  font-size: 11px;
}
.chevron {
  color: var(--muted);
}
.billing-body {
  padding: 0 10px 10px;
  max-height: 220px;
  overflow: auto;
}
.billing-stats {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px 8px;
  margin-bottom: 8px;
  font-size: 11px;
}
.stat-row {
  display: flex;
  justify-content: space-between;
  gap: 4px;
  color: var(--muted);
}
.stat-row strong {
  color: var(--ink);
  font-weight: 600;
}
.stat-row.total strong {
  color: var(--primary);
}
.stat-row.muted {
  grid-column: 1 / -1;
}
.quota-bar {
  margin-bottom: 8px;
}
.quota-label {
  font-size: 10px;
  color: var(--muted);
  margin-bottom: 4px;
}
.quota-track {
  height: 4px;
  border-radius: 2px;
  background: var(--hairline);
  overflow: hidden;
}
.quota-fill {
  height: 100%;
  background: var(--primary);
  border-radius: 2px;
}
.bill-list {
  list-style: none;
  margin: 0 0 8px;
  padding: 0;
}
.bill-item {
  display: grid;
  grid-template-columns: auto auto 1fr auto;
  gap: 4px 6px;
  font-size: 10px;
  padding: 4px 0;
  border-bottom: 1px solid var(--hairline);
  align-items: center;
}
.bill-time {
  color: var(--muted-soft);
}
.bill-src {
  color: var(--muted);
}
.bill-tokens {
  color: var(--ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.bill-cost {
  font-weight: 600;
  color: var(--primary);
}
.billing-hint {
  font-size: 11px;
  color: var(--muted);
  margin: 4px 0 8px;
}
.billing-note {
  margin: 6px 0 0;
  font-size: 10px;
  color: var(--muted-soft);
  line-height: 1.4;
}
</style>
