<script setup lang="ts">
/**
 * @file 对话输入底栏：模式、权限、上下文、附件与语音操作
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-31
 * @updated 2026-09-05
 * @version 1.1.0
 * @category UI
 * @algo none
 */
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { FouButton } from "foucui";
import BrainModelPicker from "./BrainModelPicker.vue";
import ExpertRolePicker from "./ExpertRolePicker.vue";
import ContextUsagePopover from "./ContextUsagePopover.vue";
import type { ContextUsage } from "../../types";
import type { SessionBillingRound } from "../../utils/billing";
import {
  CHAT_MODE_OPTIONS,
  type ChatMode,
  type ExecPolicy,
} from "../../utils/agentPrefs";

const props = defineProps<{
  streaming: boolean;
  modelLabel: string;
  brainOk?: boolean | null;
  contextUsage: ContextUsage | null;
  sessionCostLabel?: string;
  modelShortLabel?: string;
  sessionRounds?: SessionBillingRound[];
  chatMode: ChatMode;
  execPolicy: ExecPolicy;
  expertRoleId: string | null;
  isRecording: boolean;
  speechOk: boolean;
  voiceActive?: boolean;
  canSend: boolean;
  planWriteWarning?: boolean;
  hideExpertRole?: boolean;
}>();

const emit = defineEmits<{
  stop: [];
  send: [];
  remember: [];
  attach: [];
  toggleVoiceCall: [];
  toggleMic: [];
  "update:chatMode": [ChatMode];
  "update:execPolicy": [ExecPolicy];
  "update:expertRoleId": [string | null];
  brainChanged: [];
  compress: [];
}>();

const modeOpen = ref(false);
const permOpen = ref(false);
const modeAnchor = ref<HTMLElement | null>(null);
const permAnchor = ref<HTMLElement | null>(null);
const modePanelStyle = ref<Record<string, string>>({});
const permPanelStyle = ref<Record<string, string>>({});

const fullAccess = computed({
  get: () => props.execPolicy === "trusted",
  set: (v: boolean) => {
    emit("update:execPolicy", v ? "trusted" : "standard");
    permOpen.value = false;
  },
});

const activeMode = computed(
  () => CHAT_MODE_OPTIONS.find((m) => m.id === props.chatMode) ?? CHAT_MODE_OPTIONS[0]!,
);

const ctxPct = computed(() => props.contextUsage?.pct ?? 0);
const ctxUsedLabel = computed(() => {
  const u = props.contextUsage?.used ?? 0;
  if (u >= 1000) return `${(u / 1000).toFixed(u >= 10000 ? 0 : 1)}K`;
  return String(u);
});
const ctxMaxLabel = computed(() => {
  const m = props.contextUsage?.max ?? 200_000;
  return m >= 1000 ? `${Math.round(m / 1000)}K` : String(m);
});
const ctxRingClass = computed(() => {
  if (ctxPct.value >= 95) return "danger";
  if (ctxPct.value >= 70) return "warn";
  return "";
});
const showCompress = computed(() => ctxPct.value >= 70);
const ctxPopoverOpen = ref(false);
const ctxAnchor = ref<HTMLElement | null>(null);
const ctxPanelStyle = ref<Record<string, string>>({});

function placeCtxPanel() {
  const el = ctxAnchor.value;
  if (!el) return;
  const r = el.getBoundingClientRect();
  const width = Math.min(360, window.innerWidth - 24);
  ctxPanelStyle.value = {
    position: "fixed",
    top: `${Math.round(r.top - 10)}px`,
    left: `${Math.round(Math.min(r.left, window.innerWidth - width - 12))}px`,
    width: `${width}px`,
    transform: "translateY(-100%)",
    zIndex: "9999",
  };
}

function toggleCtxPopover() {
  ctxPopoverOpen.value = !ctxPopoverOpen.value;
  if (ctxPopoverOpen.value) placeCtxPanel();
}

function placePanel(anchor: HTMLElement | null, styleRef: typeof modePanelStyle, width: number) {
  if (!anchor) return;
  const r = anchor.getBoundingClientRect();
  styleRef.value = {
    position: "fixed",
    top: `${Math.round(r.top - 8)}px`,
    left: `${Math.round(Math.min(r.left, window.innerWidth - width - 12))}px`,
    width: `${width}px`,
    transform: "translateY(-100%)",
    zIndex: "9999",
  };
}

function closeMenus() {
  modeOpen.value = false;
  permOpen.value = false;
}

function toggleMode() {
  const next = !modeOpen.value;
  modeOpen.value = next;
  if (next) {
    permOpen.value = false;
    placePanel(modeAnchor.value, modePanelStyle, 280);
  }
}

function togglePerm() {
  const next = !permOpen.value;
  permOpen.value = next;
  if (next) {
    modeOpen.value = false;
    placePanel(permAnchor.value, permPanelStyle, 280);
  }
}

function pickMode(id: ChatMode) {
  emit("update:chatMode", id);
  modeOpen.value = false;
}

function onDocClick(e: MouseEvent) {
  if (!modeOpen.value && !permOpen.value) return;
  const t = e.target as Node;
  if (modeAnchor.value?.contains(t)) return;
  if (permAnchor.value?.contains(t)) return;
  const modePanel = document.getElementById("xu-mode-panel");
  const permPanel = document.getElementById("xu-perm-panel");
  if (modePanel?.contains(t) || permPanel?.contains(t)) return;
  closeMenus();
}

onMounted(() => {
  document.addEventListener("click", onDocClick, true);
  window.addEventListener("resize", () => {
    if (modeOpen.value) placePanel(modeAnchor.value, modePanelStyle, 280);
    if (permOpen.value) placePanel(permAnchor.value, permPanelStyle, 280);
    if (ctxPopoverOpen.value) placeCtxPanel();
  });
});

onUnmounted(() => {
  document.removeEventListener("click", onDocClick, true);
});

watch(modeOpen, (open) => {
  if (open) placePanel(modeAnchor.value, modePanelStyle, 280);
});
watch(permOpen, (open) => {
  if (open) placePanel(permAnchor.value, permPanelStyle, 280);
});
watch(ctxPopoverOpen, (open) => {
  if (open) placeCtxPanel();
});
</script>

<template>
  <div class="composer-footer">
    <p v-if="planWriteWarning" class="plan-warn ui-font">
      计划模式不会写盘；请切换到智能体模式以修改文件。
    </p>
    <div class="footer-row ui-font">
      <div class="footer-left">
        <div ref="modeAnchor" class="mode-wrap">
          <FouButton
            class="footer-pill"
            :icon="activeMode.icon"
            size="small"
            text
            native-type="button"
            @click.stop="toggleMode"
          >
            {{ activeMode.label }}
            <span class="caret">▾</span>
          </FouButton>
          <Teleport to="body">
            <div
              v-if="modeOpen"
              id="xu-mode-panel"
              class="mode-menu fou-menu-panel ui-font"
              :style="modePanelStyle"
              @click.stop
            >
              <FouButton
                v-for="m in CHAT_MODE_OPTIONS"
                :key="m.id"
                class="mode-item"
                :class="{ active: chatMode === m.id }"
                :icon="m.icon"
                text
                native-type="button"
                @click="pickMode(m.id)"
              >
                <span class="mode-item-body">
                  <span class="mode-item-text">
                    <strong>{{ m.label }}</strong>
                    <small>{{ m.description }}</small>
                  </span>
                  <FouIcon
                    v-if="chatMode === m.id"
                    class="mode-item-check"
                    icon="check-line"
                    size="14"
                  />
                </span>
              </FouButton>
            </div>
          </Teleport>
        </div>

        <ExpertRolePicker
          v-if="!hideExpertRole"
          :role-id="expertRoleId"
          @update:role-id="emit('update:expertRoleId', $event)"
        />

        <div ref="permAnchor" class="perm-wrap">
          <FouButton
            class="footer-pill"
            icon="shield-check-line"
            size="small"
            text
            native-type="button"
            @click.stop="togglePerm"
          >
            {{ fullAccess ? "完全访问" : "默认权限" }}
            <span class="caret">{{ permOpen ? "▴" : "▾" }}</span>
          </FouButton>
          <Teleport to="body">
            <div
              v-if="permOpen"
              id="xu-perm-panel"
              class="perm-popover"
              :style="permPanelStyle"
              @click.stop
            >
              <p class="perm-desc">
                默认权限：可在本项目里改文件、跑检查；删文件、危险命令、Git 推送会先问你。打开完全访问后少打断，仍不能改到项目外。
              </p>
              <div class="perm-toggle-row">
                <span>允许完全访问</span>
                <FouSwitch v-model="fullAccess" />
              </div>
            </div>
          </Teleport>
        </div>

        <BrainModelPicker :label="modelLabel" :ok="brainOk" @changed="emit('brainChanged')" />

        <div ref="ctxAnchor" class="ctx-wrap">
          <button
            type="button"
            class="ctx-ring-btn"
            :title="`上下文 ${ctxUsedLabel} / ${ctxMaxLabel}`"
            :aria-label="`查看上下文用量：${ctxUsedLabel} / ${ctxMaxLabel}`"
            @click.stop="toggleCtxPopover"
          >
            <!-- 仅环形用量，勿再叠 pie-chart（会与圆环/数字重合） -->
            <div class="ctx-ring" :class="ctxRingClass">
              <svg viewBox="0 0 36 36" class="ctx-svg" aria-hidden="true">
                <path
                  class="ctx-bg"
                  d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                />
                <path
                  class="ctx-fill"
                  :stroke-dasharray="`${Math.min(ctxPct, 100)}, 100`"
                  d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                />
              </svg>
              <span class="ctx-label">{{ ctxUsedLabel }}</span>
            </div>
          </button>
          <button
            v-if="sessionCostLabel"
            type="button"
            class="ctx-cost-pill"
            title="本对话参考消耗"
            aria-label="查看本对话参考消耗"
            @click.stop="toggleCtxPopover"
          >
            <FouIcon icon="copper-coin-line" size="14" />
            <span class="muted">共消耗</span>
            <span class="diamond">◇</span>
            <span class="val">{{ sessionCostLabel }}</span>
            <span v-if="modelShortLabel" class="model">{{ modelShortLabel }}</span>
          </button>
          <FouButton
            v-if="showCompress"
            icon="compress-line"
            size="small"
            text
            native-type="button"
            title="压缩上下文"
            aria-label="压缩上下文"
            @click="emit('compress')"
          />
        </div>
        <ContextUsagePopover
          v-model:visible="ctxPopoverOpen"
          :panel-style="ctxPanelStyle"
          :usage="contextUsage"
          :session-cost-label="sessionCostLabel"
          :model-label="modelShortLabel"
          :session-rounds="sessionRounds"
        />
      </div>

      <div class="footer-right">
        <FouButton
          icon="attachment-2"
          size="small"
          text
          native-type="button"
          title="附件"
          aria-label="附件"
          @click.stop="emit('attach')"
        />
        <FouButton
          icon="customer-service-2-line"
          size="small"
          text
          native-type="button"
          :type="voiceActive ? 'primary' : 'default'"
          :disabled="streaming && !voiceActive"
          title="语音通话"
          aria-label="语音通话"
          @click="emit('toggleVoiceCall')"
        />
        <FouButton
          :icon="isRecording ? 'stop-circle-line' : 'mic-line'"
          size="small"
          text
          native-type="button"
          :type="isRecording ? 'primary' : 'default'"
          :disabled="streaming || voiceActive"
          :title="voiceActive ? '语音通话中不可用' : isRecording ? '听写中，点击停止' : '语音输入'"
          :aria-label="isRecording ? '停止听写' : '语音输入'"
          @click="emit('toggleMic')"
        />
        <FouButton
          icon="bookmark-3-line"
          size="small"
          text
          native-type="button"
          :disabled="!canSend || streaming"
          title="记住当前输入（写入记忆库，可用 /记住 话术）"
          aria-label="记住"
          @click="emit('remember')"
        />
        <FouButton
          v-if="streaming"
          icon="pause-circle-line"
          type="primary"
          size="small"
          text
          native-type="button"
          :disabled="!canSend"
          title="排队"
          aria-label="排队"
          @click="emit('send')"
        />
        <FouButton
          v-else
          type="primary"
          icon="send-plane-2-line"
          size="small"
          text
          native-type="button"
          :disabled="!canSend"
          title="发送"
          aria-label="发送"
          @click="emit('send')"
        />
        <FouButton
          v-if="streaming"
          class="emergency-stop"
          icon="stop-fill"
          size="small"
          text
          native-type="button"
          title="紧急停止"
          aria-label="紧急停止"
          @click="emit('stop')"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.composer-footer {
  border-top: 1px solid var(--hairline);
  padding: 6px 10px 8px;
  background: var(--chrome-bar, var(--surface-soft));
}
.plan-warn {
  margin: 0 0 6px;
  font-size: 11px;
  color: var(--warning, #b45309);
}
.footer-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: nowrap;
  overflow: hidden;
  scrollbar-width: none;
}
.footer-row::-webkit-scrollbar {
  display: none;
}
.footer-left,
.footer-right {
  display: flex;
  align-items: center;
  gap: 4px;
}
.footer-left {
  flex: 1;
  min-width: 0;
  flex-wrap: wrap;
}
.footer-right {
  flex-shrink: 0;
}
.footer-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border-radius: 999px;
  border: 1px solid var(--hairline);
  background: var(--canvas);
  color: var(--body-strong);
  font-family: inherit;
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
}
.caret {
  font-size: 10px;
  opacity: 0.6;
}
.mode-wrap,
.perm-wrap {
  position: relative;
}
.mode-menu.fou-menu-panel {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 268px;
  background: var(--chrome-bar, var(--surface-soft));
  border: 1px solid var(--hairline);
  border-radius: var(--radius);
  box-shadow: var(--shadow-lg);
  padding: 4px;
}
.mode-menu :deep(.mode-item.fou-button) {
  display: flex !important;
  flex-direction: row !important;
  align-items: flex-start !important;
  justify-content: flex-start !important;
  width: 100% !important;
  min-height: 44px;
  height: auto !important;
  padding: 8px 10px !important;
  border: none !important;
  border-radius: 8px;
  background: transparent !important;
  box-shadow: none !important;
  color: var(--body-strong);
  gap: 8px;
  text-align: left;
}
.mode-menu :deep(.mode-item.fou-button .fou-button__icon) {
  flex-shrink: 0;
  width: 16px;
  min-width: 16px;
  margin: 2px 0 0 !important;
  align-self: flex-start;
}
.mode-menu :deep(.mode-item.fou-button .fou-button__label) {
  flex: 1 1 auto;
  min-width: 0;
  display: block !important;
  width: 100%;
  text-align: left !important;
  justify-content: flex-start !important;
}
.mode-menu :deep(.mode-item.fou-button:hover),
.mode-menu :deep(.mode-item.fou-button.active) {
  background: var(--primary-glow) !important;
}
.mode-item-body {
  display: flex;
  align-items: flex-start;
  justify-content: flex-start;
  gap: 8px;
  width: 100%;
  text-align: left;
}
.mode-item-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  text-align: left;
}
.mode-item-text strong {
  font-size: 13px;
  font-weight: 600;
  line-height: 1.3;
}
.mode-item-text small {
  color: var(--muted);
  font-weight: 400;
  font-size: 11px;
  line-height: 1.35;
}
.mode-item-check {
  flex-shrink: 0;
  margin-top: 2px;
  color: var(--primary);
}
.perm-popover {
  background: var(--chrome-bar, var(--surface-soft));
  border: 1px solid var(--hairline);
  border-radius: var(--radius);
  box-shadow: var(--shadow-lg);
  padding: 10px;
}
.perm-desc {
  margin: 0 0 10px;
  font-size: 11px;
  color: var(--muted);
  line-height: 1.45;
}
.perm-toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
  padding-top: 8px;
  border-top: 1px solid var(--hairline);
}
.ctx-wrap {
  display: flex;
  align-items: center;
  gap: 4px;
}
.ctx-ring-btn {
  border: none;
  background: transparent;
  padding: 0;
  cursor: pointer;
}
.ctx-cost-pill {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 11px;
  color: var(--muted);
  padding: 2px 4px;
  border-radius: 6px;
}
.ctx-cost-pill:hover {
  background: var(--surface-soft);
}
.ctx-cost-pill .diamond {
  color: var(--primary);
  font-size: 9px;
}
.ctx-cost-pill .val {
  font-weight: 600;
  color: var(--body-strong);
}
.ctx-cost-pill .model {
  max-width: 72px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--muted-soft);
}
.ctx-ring {
  position: relative;
  width: 32px;
  height: 32px;
}
.ctx-svg {
  width: 32px;
  height: 32px;
  transform: rotate(-90deg);
}
.ctx-bg {
  fill: none;
  stroke: var(--hairline);
  stroke-width: 3;
}
.ctx-fill {
  fill: none;
  stroke: var(--success);
  stroke-width: 3;
  stroke-linecap: round;
}
.ctx-ring.warn .ctx-fill {
  stroke: #d97706;
}
.ctx-ring.danger .ctx-fill {
  stroke: var(--error);
}
.ctx-label {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 8px;
  font-weight: 600;
  color: var(--muted);
}
.emergency-stop {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: none;
  background: #111;
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  flex-shrink: 0;
}
.emergency-stop:hover {
  background: #333;
}
</style>
