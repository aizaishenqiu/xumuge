<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { FouButton, FouSelect } from "foucui";
import {
  applyBrainSource,
  listLocalModels,
  OLLAMA_DEFAULT_BASE,
  type BrainSlotConfig,
  type BrainSource,
} from "../utils/opsBrains";
import {
  GLOBAL_MODEL_PROFILES_CHANGED,
  loadGlobalModelProfiles,
  type RemoteModelPreset,
} from "../utils/globalModelProfiles";
import { toUserError } from "../utils/userFacingError";
import {
  patchFromRemotePreset,
  reconcileRemotePresetBinding,
} from "../utils/opsBrainPreset";

const props = defineProps<{
  config: BrainSlotConfig;
  /** When force local/remote, hide the opposite source toggle */
  forcedSource?: BrainSource | null;
}>();

const emit = defineEmits<{
  change: [patch: Partial<BrainSlotConfig>];
}>();

const remotePresets = ref<RemoteModelPreset[]>([]);
const localModels = ref<string[]>([]);
const localBaseUrl = ref(OLLAMA_DEFAULT_BASE);
const localBusy = ref(false);
const localErr = ref("");
const selectKey = ref("");

const isLocal = computed(() => {
  if (props.forcedSource === "local") return true;
  if (props.forcedSource === "remote") return false;
  return props.config.source === "local";
});

const presetOptions = computed(() => {
  const opts: { label: string; value: string }[] = remotePresets.value
    .filter((p) => p.textModel.trim() && p.baseUrl.trim())
    .map((p) => ({
      label: `${p.label} · ${p.textModel}${p.lastProbeOk ? " ✓" : ""}`,
      value: `preset:${p.id}`,
    }));
  return opts;
});

const localOptions = computed(() =>
  localModels.value.map((m) => ({ label: m, value: m })),
);

const orphanRemoteHint = computed(() => {
  if (isLocal.value) return "";
  const pid = (props.config.remotePresetId || "").trim();
  if (pid && remotePresets.value.some((p) => p.id === pid)) return "";
  if (props.config.model || props.config.baseUrl) {
    return "请从下拉选择「模型配置」中的远程预设（三脑不再支持手填 URL/Key）";
  }
  return "";
});

watch(
  () => [props.config.model, props.config.remotePresetId, props.config.source, remotePresets.value] as const,
  () => {
    if (isLocal.value) {
      selectKey.value = props.config.model || "";
      return;
    }
    const pid = (props.config.remotePresetId || "").trim();
    if (pid && remotePresets.value.some((p) => p.id === pid)) {
      selectKey.value = `preset:${pid}`;
      return;
    }
    const hit = remotePresets.value.find(
      (p) =>
        p.textModel === props.config.model &&
        (!props.config.baseUrl || p.baseUrl === props.config.baseUrl),
    );
    if (hit) {
      selectKey.value = `preset:${hit.id}`;
      if ((props.config.remotePresetId || "").trim() !== hit.id) {
        emit("change", patchFromRemotePreset(hit));
      }
    } else {
      selectKey.value = "";
    }
  },
  { immediate: true },
);

watch(
  () => props.config.source,
  (s) => {
    if (s === "local" || props.forcedSource === "local") void refreshLocal(false);
  },
);

function setSource(next: BrainSource) {
  if (props.forcedSource && props.forcedSource !== next) return;
  emit("change", applyBrainSource(props.config, next));
  if (next === "local") void refreshLocal(true);
}

function applyRemotePreset(p: RemoteModelPreset) {
  emit("change", {
    model: p.textModel,
    visionModel: p.visionModel || "",
    baseUrl: p.baseUrl,
    apiKeyEnv: p.apiKeyEnv,
    provider: p.provider || "custom",
    remotePresetId: p.id,
    source: "remote",
  });
}

function onRemoteSelect(v: string) {
  selectKey.value = v;
  if (!v.startsWith("preset:")) {
    if (!v) emit("change", { remotePresetId: "", model: "", baseUrl: "", apiKeyEnv: "" });
    return;
  }
  const id = v.slice("preset:".length);
  if (id === "custom") {
    // Custom URL/Key removed — force re-pick from model profiles.
    selectKey.value = "";
    emit("change", { remotePresetId: "", source: "remote" });
    return;
  }
  const p = remotePresets.value.find((x) => x.id === id);
  if (p) applyRemotePreset(p);
}

function onLocalModel(v: string) {
  emit("change", {
    model: v,
    baseUrl: localBaseUrl.value || OLLAMA_DEFAULT_BASE,
    provider: "custom",
    apiKeyEnv: "",
    remotePresetId: "",
    source: "local",
  });
}

function onVisionModel(v: string) {
  emit("change", { visionModel: v || "" });
}

async function refreshLocal(autoPick: boolean) {
  localBusy.value = true;
  localErr.value = "";
  try {
    const profiles = await loadGlobalModelProfiles();
    const url = profiles.local.baseUrl.trim() || OLLAMA_DEFAULT_BASE;
    localBaseUrl.value = url;
    localModels.value = await listLocalModels(url);
    const textFallback = profiles.local.textModel.trim();
    if (!localModels.value.length && textFallback) {
      localModels.value = [textFallback];
    }
    emit("change", {
      baseUrl: url,
      provider: "custom",
      source: "local",
      remotePresetId: "",
      apiKeyEnv: "",
    });
    if (!localModels.value.length) {
      localErr.value = "未发现本地模型，请确认 Ollama 已启动或到「模型」页配置本地预设";
    } else if (autoPick && !props.config.model) {
      emit("change", { model: localModels.value[0] });
    }
  } catch (e) {
    localErr.value = toUserError(e);
    localModels.value = [];
  } finally {
    localBusy.value = false;
  }
}

async function loadRemotes() {
  try {
    const profiles = await loadGlobalModelProfiles();
    remotePresets.value = profiles.remotePresets.filter((p) => p.textModel.trim() && p.baseUrl.trim());
    localBaseUrl.value = profiles.local.baseUrl.trim() || OLLAMA_DEFAULT_BASE;
  } catch {
    remotePresets.value = [];
  }
}

function reconcilePresetBinding() {
  if (isLocal.value || !remotePresets.value.length) return;
  const { cfg, changed } = reconcileRemotePresetBinding(props.config, remotePresets.value);
  if (!changed) return;
  const hit = remotePresets.value.find((p) => p.id === cfg.remotePresetId);
  if (hit) emit("change", patchFromRemotePreset(hit));
}

async function onGlobalProfilesChanged() {
  await loadRemotes();
  reconcilePresetBinding();
}

onMounted(async () => {
  window.addEventListener(GLOBAL_MODEL_PROFILES_CHANGED, onGlobalProfilesChanged);
  await loadRemotes();
  reconcilePresetBinding();
  if (isLocal.value) void refreshLocal(false);
});

onUnmounted(() => {
  window.removeEventListener(GLOBAL_MODEL_PROFILES_CHANGED, onGlobalProfilesChanged);
});
</script>

<template>
  <div class="brain-model-field">
    <div v-if="!forcedSource" class="brain-source-row">
      <FouButton
        icon="computer-line"
        size="small"
        native-type="button"
        :type="isLocal ? 'primary' : 'default'"
        @click="setSource('local')"
      >
        本地
      </FouButton>
      <FouButton
        icon="cloud-line"
        size="small"
        native-type="button"
        :type="!isLocal ? 'primary' : 'default'"
        @click="setSource('remote')"
      >
        远程
      </FouButton>
    </div>
    <span v-else class="brain-forced-hint ui-font">
      {{ forcedSource === "local" ? "已强制本地" : "已强制远程" }}
    </span>

    <template v-if="isLocal">
      <FouSelect
        :model-value="config.model"
        placeholder="本地模型（来自 Ollama / 本地预设）"
        filterable
        style="min-width: 140px; flex: 1"
        :options="localOptions"
        @update:model-value="(v: string) => onLocalModel(v || '')"
      />
      <FouSelect
        :model-value="config.visionModel"
        placeholder="视觉模型（可选）"
        filterable
        clearable
        style="min-width: 140px; flex: 1"
        :options="localOptions"
        @update:model-value="(v: string) => onVisionModel(v || '')"
      />
      <FouButton
        icon="refresh-line"
        size="small"
        native-type="button"
        :disabled="localBusy"
        @click="refreshLocal(false)"
      >
        {{ localBusy ? "…" : "刷新" }}
      </FouButton>
      <span class="brain-url-readonly ui-font">{{ localBaseUrl }}</span>
      <p v-if="localErr" class="brain-model-err ui-font">{{ localErr }}</p>
    </template>

    <template v-else>
      <FouSelect
        :model-value="selectKey"
        placeholder="选择已配置的远程预设"
        filterable
        clearable
        style="min-width: 200px; flex: 1.4"
        :options="presetOptions"
        @update:model-value="(v: string) => onRemoteSelect(v || '')"
      />
      <FouButton
        icon="refresh-line"
        size="small"
        native-type="button"
        title="刷新远程预设列表"
        @click="onGlobalProfilesChanged"
      >
        刷新
      </FouButton>
      <span v-if="config.baseUrl && selectKey" class="brain-url-readonly ui-font">{{ config.baseUrl }}</span>
      <p v-if="orphanRemoteHint" class="brain-model-err ui-font">{{ orphanRemoteHint }}</p>
      <p v-if="!presetOptions.length" class="brain-model-err ui-font">
        暂无远程预设，请先到下方「模型配置」添加并保存
      </p>
    </template>
  </div>
</template>

<style scoped>
.brain-model-field {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
  flex: 1.4;
  min-width: 280px;
}
.brain-source-row {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}
.brain-forced-hint {
  font-size: 12px;
  color: var(--muted);
  flex-shrink: 0;
}
.brain-url-readonly {
  font-size: 11px;
  color: var(--muted);
  max-width: 280px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.brain-model-err {
  width: 100%;
  margin: 0;
  font-size: 11px;
  color: #b91c1c;
}
</style>
