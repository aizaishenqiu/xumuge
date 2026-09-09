<script setup lang="ts">
import { FouButton } from "foucui";
import { useRouter } from "vue-router";
import { useBrainPicker } from "../../composables/useBrainPicker";

const props = defineProps<{
  label: string;
  ok?: boolean | null;
}>();

const emit = defineEmits<{ changed: [] }>();

const router = useRouter();

const {
  panelOpen,
  verifiedLocalModels,
  verifiedRemotePresets,
  listLoading,
  showAdvanced,
  probeStatus,
  probeMsg,
  saving,
  panelAnchor,
  panelStyle,
  command,
  pillLabel,
  openPanel,
  closePanel,
  setSource,
  setDisplayName,
  setModel,
  setBaseUrl,
  pickLocalModel,
  pickRemotePreset,
  saveBrain,
  runProbe,
  refreshVerifiedLists,
} = useBrainPicker(() => emit("changed"));

const statusClass = () => {
  if (props.ok === true) return "ok";
  if (props.ok === false) return "fail";
  return "";
};

function goSettings() {
  closePanel();
  void router.push({ name: "settings", query: { group: "models" } });
}
</script>

<template>
  <div ref="panelAnchor" class="brain-picker">
    <FouButton
      class="model-pill ui-font"
      :class="statusClass()"
      icon="cpu-line"
      size="small"
      text
      native-type="button"
      @click.stop="openPanel"
    >
      <span class="model-pill-label">{{ pillLabel || label || "未配置" }}</span>
      <span class="model-pill-caret">▾</span>
    </FouButton>
    <Teleport to="body">
      <div
        v-if="panelOpen"
        id="xu-brain-panel-footer"
        class="brain-panel ui-font"
        :style="panelStyle"
        @click.stop
      >
        <div class="brain-panel-head">
          <strong>选择模型</strong>
          <FouButton icon="close-line" size="small" text native-type="button" @click="closePanel">
            关闭
          </FouButton>
        </div>
        <p class="probe-line" :class="probeStatus">
          {{
            probeStatus === "ok"
              ? "已联通"
              : probeStatus === "probing"
                ? "探测中…"
                : probeStatus === "fail"
                  ? "未联通"
                  : "—"
          }}
          · {{ probeMsg }}
        </p>
        <div class="src-row">
          <FouButton
            icon="computer-line"
            size="small"
            native-type="button"
            :type="command?.source === 'local' ? 'primary' : 'default'"
            @click="setSource('local')"
          >
            本地
          </FouButton>
          <FouButton
            icon="cloud-line"
            size="small"
            native-type="button"
            :type="command?.source === 'remote' ? 'primary' : 'default'"
            @click="setSource('remote')"
          >
            远程
          </FouButton>
          <FouButton
            icon="refresh-line"
            size="small"
            native-type="button"
            :loading="listLoading"
            @click="refreshVerifiedLists"
          >
            刷新
          </FouButton>
        </div>

        <p v-if="listLoading" class="list-hint">检测可用模型…</p>

        <div v-else-if="command?.source === 'local'" class="model-list">
          <FouButton
            v-for="m in verifiedLocalModels"
            :key="m"
            class="model-item"
            :class="{ active: command?.model === m }"
            icon="cpu-line"
            text
            native-type="button"
            @click="pickLocalModel(m)"
          >
            {{ m }}
          </FouButton>
          <p v-if="!verifiedLocalModels.length" class="empty-hint">
            暂无测通本地模型。
            <FouButton class="link-btn" icon="settings-3-line" text size="small" native-type="button" @click="goSettings">
              去设置测通
            </FouButton>
          </p>
        </div>
        <div v-else class="model-list">
          <FouButton
            v-for="p in verifiedRemotePresets"
            :key="p.id"
            class="model-item"
            :class="{ active: command?.model === p.textModel && command?.baseUrl === p.baseUrl }"
            icon="cloud-line"
            text
            native-type="button"
            @click="pickRemotePreset(p)"
          >
            {{ p.label || p.textModel }}
          </FouButton>
          <p v-if="!verifiedRemotePresets.length" class="empty-hint">
            暂无测通远程模型。
            <FouButton class="link-btn" icon="settings-3-line" text size="small" native-type="button" @click="goSettings">
              去设置测通
            </FouButton>
          </p>
        </div>

        <div class="panel-foot">
          <FouButton icon="add-line" size="small" type="primary" native-type="button" @click="goSettings">
            添加模型
          </FouButton>
        </div>

        <p class="pick-hint">点选上方模型即切换并保存；日常不必手填地址。</p>
        <FouButton
          class="advanced-toggle"
          :icon="showAdvanced ? 'arrow-up-s-line' : 'arrow-down-s-line'"
          text
          size="small"
          native-type="button"
          @click="showAdvanced = !showAdvanced"
        >
          {{ showAdvanced ? "收起调试项" : "调试（手改 ID/URL）" }}
        </FouButton>
        <template v-if="showAdvanced">
          <p class="pick-hint warn">仅排障用。正常请用列表选择或「添加模型」进设置。</p>
          <label class="field">
            <span>显示名称（别名）</span>
            <FouInput
              :model-value="command?.displayName ?? ''"
              placeholder="对话中显示"
              maxlength="40"
              size="small"
              @update:model-value="setDisplayName"
            />
          </label>
          <label class="field">
            <span>模型 ID</span>
            <FouInput
              :model-value="command?.model ?? ''"
              size="small"
              @update:model-value="setModel"
            />
          </label>
          <label class="field">
            <span>Base URL</span>
            <FouInput
              :model-value="command?.baseUrl ?? ''"
              size="small"
              @update:model-value="setBaseUrl"
            />
          </label>
          <div class="brain-actions">
            <FouButton icon="radar-line" size="small" text native-type="button" @click="runProbe">
              重测
            </FouButton>
            <FouButton
              icon="save-line"
              size="small"
              type="primary"
              native-type="button"
              :loading="saving"
              @click="saveBrain(false)"
            >
              保存
            </FouButton>
          </div>
        </template>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.brain-picker {
  position: relative;
}
.model-pill {
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
  max-width: 140px;
}
.model-pill.ok {
  border-color: var(--success);
}
.model-pill.fail {
  border-color: var(--error);
}
.model-pill-label {
  max-width: 96px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.model-pill-caret {
  opacity: 0.5;
  font-size: 10px;
}
.brain-panel {
  background: var(--surface-card);
  border: 1px solid var(--hairline);
  border-radius: var(--radius);
  box-shadow: var(--shadow-lg);
  padding: 12px;
  max-height: 70vh;
  overflow: auto;
}
.brain-panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}
.probe-line {
  font-size: 11px;
  color: var(--muted);
  margin: 0 0 8px;
}
.probe-line.ok {
  color: var(--success);
}
.probe-line.fail {
  color: var(--error);
}
.src-row {
  display: flex;
  gap: 6px;
  margin-bottom: 8px;
}
.list-hint,
.empty-hint {
  font-size: 12px;
  color: var(--muted);
  margin: 0 0 8px;
}
.pick-hint {
  font-size: 11px;
  color: var(--muted);
  margin: 0 0 8px;
  line-height: 1.4;
}
.pick-hint.warn {
  color: #b45309;
}
.link-btn {
  border: none;
  background: none;
  color: var(--primary);
  cursor: pointer;
  padding: 0;
  font-size: inherit;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 8px;
  font-size: 12px;
}
.native-input {
  padding: 6px 8px;
  border: 1px solid var(--hairline);
  border-radius: var(--radius);
  background: var(--canvas);
  font-size: 12px;
}
.model-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 160px;
  overflow: auto;
  margin-bottom: 8px;
}
.model-item {
  text-align: left;
  padding: 6px 8px;
  border: 1px solid var(--hairline);
  border-radius: var(--radius);
  background: var(--canvas);
  font-size: 12px;
  cursor: pointer;
}
.model-item.active {
  border-color: var(--primary);
  background: var(--primary-glow);
}
.panel-foot {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 8px;
}
.advanced-toggle {
  border: none;
  background: transparent;
  color: var(--muted);
  font-size: 11px;
  cursor: pointer;
  padding: 0;
  margin-bottom: 8px;
}
.brain-actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
}
</style>
