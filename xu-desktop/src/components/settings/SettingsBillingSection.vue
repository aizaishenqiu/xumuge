<script setup lang="ts">
/**
 * @file 设置账单与用量：统一时间区间的模型 Token、费用图表与表格
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-31
 * @version 1.0.0
 * @category UI
 * @algo disposed-listener-guard
 */
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import * as echarts from "echarts";
import { FouButton } from "foucui";
import PageHelpButton from "../help/PageHelpButton.vue";
import { listen } from "@tauri-apps/api/event";
import {
  formatBillTime,
  formatCnyMicros,
  formatTokenCount,
  listTokenBillsInRange,
  tokenBillingModelSeries,
  tokenBillingSeries,
  type BillingGranularity,
  type ModelBillingSeriesPoint,
  type TokenBillRow,
  type TokenBillingBucket,
} from "../../utils/billing";
import { loadGlobalModelProfiles, type RemoteModelPreset } from "../../utils/globalModelProfiles";

type RangePreset = "day" | "week" | "month" | "halfYear" | "year" | "custom";
type DateRangeValue = [string, string] | string | null;
type ChartSeriesKind = "bar" | "line";

const loading = ref(false);
const bills = ref<TokenBillRow[]>([]);
const series = ref<TokenBillingBucket[]>([]);
const modelSeries = ref<ModelBillingSeriesPoint[]>([]);
const remotePresets = ref<RemoteModelPreset[]>([]);
const selectedPresetId = ref<string>("");
const granularity = ref<BillingGranularity>("day");
const rangePreset = ref<RangePreset>("week");
const customRange = ref<DateRangeValue>(null);
const chartSeriesKind = ref<ChartSeriesKind>("bar");
const billPage = ref(1);
const billPageSize = ref(20);

const chartEl = ref<HTMLElement | null>(null);
let chart: echarts.ECharts | null = null;
let chartOptionSnapshot: echarts.EChartsOption | null = null;
let unlisten: (() => void) | undefined;
let disposed = false;

const presetOptions = computed(() => [
  { id: "", label: "全部远程模型" },
  ...remotePresets.value.map((r) => ({
    id: r.id,
    label: r.label?.trim() || r.textModel || r.id,
  })),
]);

/** 默认自定义区间：最近 7 天 */
function defaultCustomRange(): [string, string] {
  const end = new Date();
  const start = new Date(end.getTime() - 7 * 86400000);
  return [start.toISOString().slice(0, 10), end.toISOString().slice(0, 10)];
}

/** 将当前 rangePreset / customRange 转为毫秒区间 [from, to] */
function rangeMs(): { from: number; to: number } {
  const now = Date.now();
  if (rangePreset.value === "custom") {
    const raw = customRange.value;
    const pair = Array.isArray(raw) ? raw : null;
    if (pair?.[0] && pair?.[1]) {
      const from = new Date(pair[0]).getTime();
      const to = new Date(pair[1]).getTime() + 86400000 - 1;
      return { from, to: Math.max(from, to) };
    }
  }
  const days =
    rangePreset.value === "day"
      ? 1
      : rangePreset.value === "week"
        ? 7
        : rangePreset.value === "month"
          ? 30
          : rangePreset.value === "halfYear"
            ? 180
            : rangePreset.value === "year"
              ? 365
              : 7;
  return { from: now - days * 86400000, to: now };
}

/** 表格/图表标题用的人类可读区间文案 */
const rangeLabel = computed(() => {
  const { from, to } = rangeMs();
  const fmt = (ms: number) => {
    const d = new Date(ms);
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  };
  const preset =
    rangePreset.value === "day"
      ? "近 1 日"
      : rangePreset.value === "week"
        ? "近 7 日"
        : rangePreset.value === "month"
          ? "近 30 日"
          : rangePreset.value === "halfYear"
            ? "近半年"
            : rangePreset.value === "year"
              ? "近 1 年"
              : "自定义";
  return `${preset} · ${fmt(from)} — ${fmt(to)}`;
});

/** 区间内各次调用合计（表格底部汇总行） */
const rangeTotals = computed(() => {
  let prompt = 0;
  let completion = 0;
  let cached = 0;
  let cost = 0;
  for (const b of bills.value) {
    prompt += b.promptTokens;
    completion += b.completionTokens;
    cached += b.cachedTokens;
    cost += b.costCnyMicros;
  }
  return { prompt, completion, cached, cost, calls: bills.value.length };
});

/** 当前页明细（默认每页 20 条） */
const pagedBills = computed(() => {
  const start = (billPage.value - 1) * billPageSize.value;
  return bills.value.slice(start, start + billPageSize.value);
});

function onBillPageChange(page: number) {
  billPage.value = page;
}

function onBillPageSizeChange(size: number) {
  billPageSize.value = size;
  billPage.value = 1;
}

/** 切换日/周/月/半年/年/时间段并刷新数据 */
function pickRange(preset: RangePreset) {
  rangePreset.value = preset;
  if (preset === "custom") {
    if (!Array.isArray(customRange.value)) customRange.value = defaultCustomRange();
    granularity.value = "day";
    void refresh();
    return;
  }
  // 半年/年用周桶，避免柱子过密；其余按日
  granularity.value =
    preset === "halfYear" || preset === "year" ? "week" : "day";
  void refresh();
}

/** 自定义日期变更后刷新 */
function onCustomRangeChange() {
  if (rangePreset.value === "custom") void refresh();
}

/**
 * 拉取当前时间区间内的图表序列与每次调用明细（二者区间一致）
 */
async function refresh() {
  loading.value = true;
  try {
    const { from, to } = rangeMs();
    bills.value = await listTokenBillsInRange(
      from,
      to,
      selectedPresetId.value || undefined,
      500,
    );
    billPage.value = 1;
    if (selectedPresetId.value) {
      series.value = await tokenBillingSeries(from, to, granularity.value, selectedPresetId.value);
      modelSeries.value = [];
    } else {
      series.value = [];
      modelSeries.value = await tokenBillingModelSeries(from, to, granularity.value);
    }
    await nextTick();
    renderChart();
  } catch (e) {
    console.warn("billing section", e);
  } finally {
    loading.value = false;
  }
}

/** 单个分桶的总 Token（输入 + 输出） */
function totalTokens(b: TokenBillingBucket) {
  return b.promptTokens + b.completionTokens;
}

/** 读取主题 muted 色作为图表文字色 */
function chartTextColor() {
  return getComputedStyle(document.documentElement).getPropertyValue("--muted").trim() || "#94a3b8";
}

/** 构建 ECharts 配置（不使用内置 toolbox，避免与 Y 轴重叠） */
function buildChartOption(): echarts.EChartsOption {
  const textColor = chartTextColor();
  const axisCommon = {
    axisLabel: { color: textColor, fontSize: 11 },
    axisLine: { lineStyle: { color: "rgba(148,163,184,0.35)" } },
    splitLine: { lineStyle: { color: "rgba(148,163,184,0.12)" } },
  };
  const legendBase = {
    bottom: 4,
    left: "center" as const,
    type: "scroll" as const,
    textStyle: { color: textColor, fontSize: 11 },
    itemGap: 12,
  };
  const gridBase = { left: 48, right: 16, top: 16, bottom: 52, containLabel: true };
  const kind = chartSeriesKind.value;

  if (!selectedPresetId.value && modelSeries.value.length) {
    const labels = [...new Set(modelSeries.value.map((p) => p.label))];
    const models = [...new Set(modelSeries.value.map((p) => p.model))];
    const palette = ["#8b5cf6", "#14b8a6", "#f59e0b", "#38bdf8", "#ec4899", "#84cc16"];
    return {
      color: palette,
      tooltip: { trigger: "axis" },
      legend: { ...legendBase, data: models },
      grid: gridBase,
      xAxis: {
        type: "category",
        data: labels,
        ...axisCommon,
        axisLabel: { ...axisCommon.axisLabel, rotate: labels.length > 8 ? 32 : 0 },
      },
      yAxis: {
        type: "value",
        name: "Token",
        nameLocation: "end",
        nameGap: 6,
        nameTextStyle: { color: textColor, fontSize: 11 },
        ...axisCommon,
      },
      series: models.map((model) => ({
        name: model,
        type: kind,
        stack: kind === "bar" ? "tokens" : undefined,
        emphasis: { focus: "series" },
        data: labels.map((lbl) => {
          const hit = modelSeries.value.find((p) => p.label === lbl && p.model === model);
          return hit ? hit.promptTokens + hit.completionTokens : 0;
        }),
      })),
    };
  }

  const labels = series.value.map((b) => b.label);
  const tokens = series.value.map((b) => totalTokens(b));
  const cached = series.value.map((b) => b.cachedTokens);
  const costs = series.value.map((b) => b.costCnyMicros / 1_000_000);

  return {
    color: ["#8b5cf6", "#14b8a6", "#f59e0b"],
    tooltip: { trigger: "axis" },
    legend: { ...legendBase, data: ["Token", "缓存", "费用(¥)"] },
    grid: { ...gridBase, right: kind === "line" ? 16 : 40 },
    xAxis: {
      type: "category",
      data: labels,
      ...axisCommon,
      axisLabel: {
        ...axisCommon.axisLabel,
        rotate: labels.length > 10 ? 32 : 0,
      },
    },
    yAxis: [
      {
        type: "value",
        name: "Token",
        nameLocation: "end",
        nameGap: 6,
        nameTextStyle: { color: textColor, fontSize: 11 },
        ...axisCommon,
      },
      {
        type: "value",
        name: "¥",
        nameLocation: "end",
        nameGap: 6,
        nameTextStyle: { color: textColor, fontSize: 11 },
        splitLine: { show: false },
        axisLabel: { color: textColor, fontSize: 11 },
      },
    ],
    series: [
      { name: "Token", type: kind, data: tokens, yAxisIndex: 0 },
      { name: "缓存", type: kind, data: cached, yAxisIndex: 0 },
      { name: "费用(¥)", type: "line", yAxisIndex: 1, data: costs },
    ],
  };
}

/** 渲染或更新图表 */
function renderChart() {
  if (!chartEl.value) return;
  if (!chart) chart = echarts.init(chartEl.value);
  const opt = buildChartOption();
  chartOptionSnapshot = opt;
  chart.setOption(opt, true);
}

/** 切换柱状/曲线展示 */
function setChartSeriesKind(kind: ChartSeriesKind) {
  chartSeriesKind.value = kind;
  renderChart();
}

/** 还原为上次 refresh 生成的配置 */
function resetChart() {
  if (!chart || !chartOptionSnapshot) return;
  chart.setOption(chartOptionSnapshot, true);
}

/** 将当前图表导出为 PNG */
function saveChartImage() {
  if (!chart) return;
  const url = chart.getDataURL({ type: "png", pixelRatio: 2, backgroundColor: "transparent" });
  const a = document.createElement("a");
  a.href = url;
  a.download = `xu-billing-${Date.now()}.png`;
  a.click();
}

/** 窗口尺寸变化时重绘图表 */
function onResize() {
  chart?.resize();
}

watch([series, modelSeries, selectedPresetId, chartSeriesKind], () => renderChart());

watch(selectedPresetId, () => {
  void refresh();
});

onMounted(async () => {
  disposed = false;
  try {
    const p = await loadGlobalModelProfiles();
    remotePresets.value = p.remotePresets.filter((r) => r.textModel.trim());
  } catch {
    remotePresets.value = [];
  }
  customRange.value = defaultCustomRange();
  await refresh();
  if (disposed) return;
  window.addEventListener("resize", onResize);
  const stop = await listen("xu:billing-updated", () => {
    if (disposed) return;
    void refresh();
  });
  if (disposed) {
    stop();
    window.removeEventListener("resize", onResize);
    return;
  }
  unlisten = stop;
});

onUnmounted(() => {
  disposed = true;
  window.removeEventListener("resize", onResize);
  unlisten?.();
  chart?.dispose();
  chart = null;
});
</script>

<template>
  <div class="billing-settings qiu-billing-root ui-font">
    <div class="billing-settings-head">
      <div>
        <h2 class="settings-section-title">账单与用量</h2>
        <p class="settings-section-desc">
          已配置远程模型的 Token、缓存与参考费用。统计仅供参考，实际用量与扣费以各模型厂商控制台账单为准。
        </p>
      </div>
      <PageHelpButton topic="settings.billing" label="帮助" />
    </div>

    <div class="billing-disclaimer">
      <FouIcon icon="information-line" size="16" />
      <span>
        本地账单仅供参考：基于 API 返回的 usage（含缓存命中 cached_tokens）与本地价目估算。
        实际用量与扣费以各模型厂商控制台账单为准。不清零则永久保存在本机；「清零用量」会删除本地记录。
      </span>
    </div>

    <div class="billing-toolbar qiu-billing-toolbar">
      <div class="qiu-billing-select-wrap">
        <FouSelect
          v-model="selectedPresetId"
          :options="presetOptions.map((p) => ({ value: p.id, label: p.label }))"
          placeholder="选择模型"
          style="min-width: 180px"
        />
      </div>

      <FouButtonGroup size="small">
        <FouButton
          size="small"
          icon="calendar-line"
          :type="rangePreset === 'day' ? 'primary' : 'default'"
          native-type="button"
          @click="pickRange('day')"
        >
          日
        </FouButton>
        <FouButton
          size="small"
          icon="calendar-2-line"
          :type="rangePreset === 'week' ? 'primary' : 'default'"
          native-type="button"
          @click="pickRange('week')"
        >
          周
        </FouButton>
        <FouButton
          size="small"
          icon="calendar-check-line"
          :type="rangePreset === 'month' ? 'primary' : 'default'"
          native-type="button"
          @click="pickRange('month')"
        >
          月
        </FouButton>
        <FouButton
          size="small"
          icon="calendar-event-line"
          :type="rangePreset === 'halfYear' ? 'primary' : 'default'"
          native-type="button"
          @click="pickRange('halfYear')"
        >
          半年
        </FouButton>
        <FouButton
          size="small"
          icon="calendar-todo-line"
          :type="rangePreset === 'year' ? 'primary' : 'default'"
          native-type="button"
          @click="pickRange('year')"
        >
          年
        </FouButton>
        <FouButton
          size="small"
          icon="calendar-schedule-line"
          :type="rangePreset === 'custom' ? 'primary' : 'default'"
          native-type="button"
          @click="pickRange('custom')"
        >
          时间段
        </FouButton>
      </FouButtonGroup>

      <FouDate
        v-if="rangePreset === 'custom'"
        v-model="customRange"
        type="daterange"
        size="small"
        range-separator="—"
        value-format="YYYY-MM-DD"
        start-placeholder="开始日期"
        end-placeholder="结束日期"
        :clearable="false"
        @change="onCustomRangeChange"
      />

      <FouButton icon="refresh-line" size="small" :loading="loading" @click="void refresh()">
        刷新
      </FouButton>
    </div>

    <div class="qiu-billing-chart-wrap">
      <div class="qiu-billing-chart-toolbar">
        <span class="qiu-billing-range-label">{{ rangeLabel }}</span>
        <div class="qiu-billing-chart-actions">
          <FouButtonGroup size="small">
            <FouButton
              size="small"
              icon="bar-chart-2-line"
              :type="chartSeriesKind === 'bar' ? 'primary' : 'default'"
              native-type="button"
              @click="setChartSeriesKind('bar')"
            >
              柱状
            </FouButton>
            <FouButton
              size="small"
              icon="line-chart-line"
              :type="chartSeriesKind === 'line' ? 'primary' : 'default'"
              native-type="button"
              @click="setChartSeriesKind('line')"
            >
              曲线
            </FouButton>
          </FouButtonGroup>
          <FouButton
            icon="refresh-line"
            size="small"
            native-type="button"
            title="还原图表"
            @click="resetChart"
          >
            还原
          </FouButton>
          <FouButton
            icon="download-line"
            size="small"
            native-type="button"
            title="保存图片"
            @click="saveChartImage"
          >
            保存
          </FouButton>
        </div>
      </div>
      <div ref="chartEl" class="billing-chart qiu-billing-chart" />
    </div>

    <p v-if="bills.length" class="billing-range-hint">
      下表为所选区间内<strong>每次 API 调用</strong>的明细（按时间倒序，共 {{ bills.length }} 条，每页
      {{ billPageSize }} 条）。
    </p>

    <table v-if="bills.length" class="billing-table billing-table-records">
      <thead>
        <tr>
          <th>时间</th>
          <th>模型</th>
          <th>输入 Token</th>
          <th>输出 Token</th>
          <th>缓存</th>
          <th>参考费用</th>
          <th>来源</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="b in pagedBills" :key="b.id">
          <td class="billing-time">{{ formatBillTime(b.createdAt) }}</td>
          <td>{{ b.model || b.presetId }}</td>
          <td>{{ formatTokenCount(b.promptTokens) }}</td>
          <td>{{ formatTokenCount(b.completionTokens) }}</td>
          <td>{{ formatTokenCount(b.cachedTokens) }}</td>
          <td>{{ formatCnyMicros(b.costCnyMicros) }}</td>
          <td>{{ b.source || "—" }}</td>
        </tr>
        <tr v-if="bills.length > 1" class="billing-table-total">
          <td>合计（{{ rangeTotals.calls }} 次）</td>
          <td>—</td>
          <td>{{ formatTokenCount(rangeTotals.prompt) }}</td>
          <td>{{ formatTokenCount(rangeTotals.completion) }}</td>
          <td>{{ formatTokenCount(rangeTotals.cached) }}</td>
          <td>{{ formatCnyMicros(rangeTotals.cost) }}</td>
          <td>—</td>
        </tr>
      </tbody>
    </table>

    <footer v-if="bills.length" class="billing-pager">
      <FouPagination
        :total="bills.length"
        :current-page="billPage"
        :page-size="billPageSize"
        :page-sizes="[20, 50, 100]"
        :pager-count="7"
        layout="total, sizes, prev, pager, next"
        background
        small
        @current-change="onBillPageChange"
        @update:current-page="onBillPageChange"
        @size-change="onBillPageSizeChange"
        @update:page-size="onBillPageSizeChange"
      />
    </footer>

    <p v-if="!bills.length" class="billing-empty">所选时间区间内暂无远程模型调用记录。</p>
  </div>
</template>

<style scoped>
.billing-settings-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 12px;
}
.billing-disclaimer {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  padding: 10px 12px;
  border-radius: 10px;
  background: color-mix(in srgb, var(--primary) 8%, var(--surface-soft));
  border: 1px solid var(--hairline);
  font-size: 12px;
  color: var(--muted);
  line-height: 1.45;
  margin-bottom: 12px;
}
.billing-toolbar {
  margin-bottom: 10px;
}
.qiu-billing-chart-wrap {
  border: 1px solid var(--hairline);
  border-radius: 12px;
  background: var(--chrome-bar, var(--surface-soft));
  margin-bottom: 12px;
  overflow: hidden;
}
.qiu-billing-chart-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--hairline);
}
.qiu-billing-range-label {
  font-size: 11px;
  color: var(--muted);
}
.qiu-billing-chart-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.billing-chart {
  width: 100%;
  height: 300px;
}
.billing-range-hint {
  font-size: 11px;
  color: var(--muted);
  margin: 0 0 8px;
}
.billing-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}
.billing-table th,
.billing-table td {
  padding: 8px 10px;
  border-bottom: 1px solid var(--hairline);
  text-align: left;
}
.billing-table th {
  color: var(--muted);
  font-weight: 600;
}
.billing-table-total td {
  font-weight: 600;
  color: var(--body-strong);
  border-top: 1px solid var(--hairline);
}
.billing-table-records .billing-time {
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
  font-size: 11px;
}
.billing-pager {
  display: flex;
  justify-content: flex-end;
  margin: 10px 0 4px;
}
.billing-empty {
  font-size: 12px;
  color: var(--muted);
}
</style>
