<script setup lang="ts">
import { computed, onUnmounted, watch } from "vue";
import { FouButton } from "foucui";
import type { ContextUsage } from "../../types";
import type { SessionBillingRound } from "../../utils/billing";
import { formatCnyMicros, formatTokenCount } from "../../utils/billing";

const props = defineProps<{
  visible: boolean;
  panelStyle?: Record<string, string>;
  usage: ContextUsage | null;
  sessionCostLabel?: string;
  modelLabel?: string;
  sessionRounds?: SessionBillingRound[];
}>();

const emit = defineEmits<{
  "update:visible": [boolean];
}>();

const pct = computed(() => props.usage?.pct ?? 0);
const usedLabel = computed(() => formatTokenCount(props.usage?.used ?? 0));
const maxLabel = computed(() => formatTokenCount(props.usage?.max ?? 200_000));

type Row = { key: string; label: string; color: string; tokens: number };

const rows = computed((): Row[] => {
  const u = props.usage;
  const total = Math.max(u?.used ?? 1, 1);
  const b = u?.breakdown;
  const items: Row[] = [
    { key: "system", label: "系统提示词", color: "#14b8a6", tokens: b?.systemPrompt ?? 0 },
    { key: "tools", label: "工具及子智能体", color: "#d4a574", tokens: b?.tools ?? 0 },
    { key: "messages", label: "对话消息", color: "#8b5cf6", tokens: b?.messages ?? u?.used ?? 0 },
    { key: "mcp", label: "连接器及 MCP", color: "#38bdf8", tokens: b?.connectorsMcp ?? 0 },
    { key: "skills", label: "技能", color: "#3b82f6", tokens: b?.skills ?? 0 },
  ];
  return items.map((r) => ({
    ...r,
    pct: Math.round((r.tokens / total) * 1000) / 10,
  })) as Row[];
});

const barSegments = computed(() => {
  const total = Math.max(props.usage?.used ?? 0, 1);
  return rows.value
    .filter((r) => r.tokens > 0)
    .map((r) => ({
      color: r.color,
      width: `${Math.max(0.5, (r.tokens / total) * 100)}%`,
    }));
});

const modelRoundGroups = computed(() => {
  const map = new Map<
    string,
    { model: string; rounds: SessionBillingRound[]; totalTokens: number; totalCost: number }
  >();
  for (const r of props.sessionRounds ?? []) {
    const key = r.model || r.presetId || "unknown";
    const hit = map.get(key) ?? { model: key, rounds: [], totalTokens: 0, totalCost: 0 };
    hit.rounds.push(r);
    hit.totalTokens += r.promptTokens + r.completionTokens;
    hit.totalCost += r.costCnyMicros;
    map.set(key, hit);
  }
  return [...map.values()];
});

function onOutsidePointer(e: PointerEvent) {
  if (!props.visible) return;
  const t = e.target as Node;
  const panel = document.querySelector(".ctx-pop.ui-font");
  if (panel?.contains(t)) return;
  emit("update:visible", false);
}

watch(
  () => props.visible,
  (open) => {
    if (open) {
      document.addEventListener("pointerdown", onOutsidePointer, true);
    } else {
      document.removeEventListener("pointerdown", onOutsidePointer, true);
    }
  },
);

onUnmounted(() => {
  document.removeEventListener("pointerdown", onOutsidePointer, true);
});
</script>

<template>
  <Teleport to="body">
    <div
      v-if="visible"
      class="ctx-pop ui-font"
      role="dialog"
      aria-label="上下文用量"
      :style="panelStyle"
      @click.stop
    >
      <header class="ctx-pop-head">
        <strong>上下文用量</strong>
        <FouButton
          icon="close-line"
          size="small"
          text
          native-type="button"
          aria-label="关闭"
          @click="emit('update:visible', false)"
        />
      </header>
      <div class="ctx-pop-summary">
        <span class="ctx-pop-pct">{{ pct.toFixed(1) }}%</span>
        <span class="ctx-pop-sub">已使用 {{ usedLabel }}/ {{ maxLabel }}</span>
      </div>
      <div v-if="sessionCostLabel" class="ctx-pop-cost">
        <span class="cost-label">共消耗</span>
        <span class="cost-diamond">◇</span>
        <span class="cost-val">{{ sessionCostLabel }}</span>
        <span v-if="modelLabel" class="cost-model">{{ modelLabel }}</span>
      </div>
      <div class="ctx-bar">
        <i
          v-for="(seg, i) in barSegments"
          :key="i"
          class="ctx-bar-seg"
          :style="{ width: seg.width, background: seg.color }"
        />
      </div>
      <ul class="ctx-rows">
        <li v-for="r in rows" :key="r.key">
          <span class="dot" :style="{ background: r.color }" />
          <span class="lbl">{{ r.label }}</span>
          <span class="pct">{{
            ((r.tokens / Math.max(usage?.used ?? 1, 1)) * 100).toFixed(1)
          }}%</span>
        </li>
      </ul>

      <section v-if="modelRoundGroups.length" class="ctx-rounds">
        <h4>本对话 · 按模型/轮次</h4>
        <div v-for="g in modelRoundGroups" :key="g.model" class="ctx-model-block">
          <div class="ctx-model-head">
            <span class="ctx-model-name">{{ g.model }}</span>
            <span class="ctx-model-sum">
              {{ g.rounds.length }} 轮 · {{ formatTokenCount(g.totalTokens) }}
              <template v-if="g.totalCost"> · {{ formatCnyMicros(g.totalCost) }}</template>
            </span>
          </div>
          <ul class="ctx-round-list">
            <li v-for="r in g.rounds" :key="r.roundIndex">
              <span>第 {{ r.roundIndex }} 轮</span>
              <span>{{ formatTokenCount(r.promptTokens + r.completionTokens) }}</span>
              <span v-if="r.costCnyMicros">{{ formatCnyMicros(r.costCnyMicros) }}</span>
            </li>
          </ul>
        </div>
      </section>

      <p class="ctx-note">Token 为本地估算/汇总，仅供参考；实际计费以模型厂商账单为准。</p>
    </div>
  </Teleport>
</template>

<style scoped>
.ctx-pop {
  position: fixed;
  z-index: 9999;
  width: min(360px, calc(100vw - 24px));
  background: var(--chrome-bar, var(--surface-soft));
  border: 1px solid var(--hairline);
  border-radius: 14px;
  box-shadow: var(--shadow-lg);
  padding: 14px 16px 12px;
}
.ctx-pop-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}
.ctx-pop-head strong {
  font-size: 15px;
  color: var(--body-strong);
}
.ctx-pop-summary {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 8px;
}
.ctx-pop-pct {
  font-size: 22px;
  font-weight: 700;
  color: var(--ink);
}
.ctx-pop-sub {
  font-size: 12px;
  color: var(--muted);
}
.ctx-pop-cost {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--muted);
  margin-bottom: 10px;
}
.cost-diamond {
  color: var(--primary);
  font-size: 10px;
}
.cost-val {
  font-weight: 600;
  color: var(--body-strong);
}
.cost-model {
  margin-left: 4px;
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--canvas);
  color: var(--muted);
  font-size: 11px;
}
.ctx-bar {
  display: flex;
  height: 8px;
  border-radius: 999px;
  overflow: hidden;
  background: var(--hairline);
  margin-bottom: 12px;
}
.ctx-bar-seg {
  display: block;
  height: 100%;
  min-width: 2px;
}
.ctx-rows {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.ctx-rows li {
  display: grid;
  grid-template-columns: 10px 1fr auto;
  gap: 8px;
  align-items: center;
  font-size: 12px;
}
.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}
.lbl {
  color: var(--body);
}
.pct {
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}
.ctx-rounds {
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px solid var(--hairline);
}
.ctx-rounds h4 {
  margin: 0 0 8px;
  font-size: 12px;
  font-weight: 600;
  color: var(--body-strong);
}
.ctx-model-block + .ctx-model-block {
  margin-top: 8px;
}
.ctx-model-head {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-size: 11px;
  color: var(--muted);
  margin-bottom: 4px;
}
.ctx-model-name {
  color: var(--body-strong);
  font-weight: 600;
}
.ctx-round-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.ctx-round-list li {
  display: grid;
  grid-template-columns: 56px 1fr auto;
  gap: 6px;
  font-size: 11px;
  color: var(--muted);
}
.ctx-note {
  margin: 10px 0 0;
  font-size: 10px;
  color: var(--muted-soft);
  line-height: 1.4;
}
</style>
