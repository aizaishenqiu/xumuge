import { computed, onMounted, onUnmounted, ref } from "vue";
import { fouMsg, fouAlert} from "foucui";
import {
  listLocalModels,
  loadOpsBrains,
  OLLAMA_DEFAULT_BASE,
  probeBrain,
  saveOpsBrains,
  type BrainSource,
} from "../utils/opsBrains";
import {
  getDefaultRemotePreset,
  loadGlobalModelProfiles,
  saveGlobalModelProfiles,
  setDefaultRemotePreset,
  type GlobalModelProfiles,
  type RemoteModelPreset,
} from "../utils/globalModelProfiles";
import { toUserError } from "../utils/userFacingError";
import {
  filterVerifiedLocalModels,
  filterVerifiedRemotePresets,
} from "../utils/modelProbe";

export function useBrainPicker(onChanged?: () => void) {
  const panelOpen = ref(false);
  const profiles = ref<GlobalModelProfiles | null>(null);
  const source = ref<BrainSource>("remote");
  const localModels = ref<string[]>([]);
  const verifiedLocalModels = ref<string[]>([]);
  const verifiedRemotePresets = ref<RemoteModelPreset[]>([]);
  const listLoading = ref(false);
  const showAdvanced = ref(false);
  const probeStatus = ref<"idle" | "ok" | "fail" | "probing">("idle");
  const probeMsg = ref("");
  const saving = ref(false);
  const panelAnchor = ref<HTMLElement | null>(null);
  const panelStyle = ref<Record<string, string>>({});
  const displayName = ref("");
  const model = ref("");
  const baseUrl = ref("");
  const apiKeyEnv = ref("");
  const provider = ref("custom");
  const activeRemoteId = ref<string | null>(null);
  let listsReady = false;

  const command = computed(() => ({
    source: source.value,
    model: model.value,
    baseUrl: baseUrl.value,
    apiKeyEnv: apiKeyEnv.value,
    provider: provider.value,
    displayName: displayName.value,
  }));

  const pillLabel = computed(() => {
    const src = source.value === "local" ? "本地" : "远程";
    const name = displayName.value.trim() || model.value.trim();
    if (!name) return "";
    const full = `${src} · ${name}`;
    return full.length > 18 ? `${full.slice(0, 17)}…` : full;
  });

  function syncFieldsFromProfiles(p: GlobalModelProfiles, src: BrainSource) {
    source.value = src;
    if (src === "local") {
      model.value = p.local.textModel;
      baseUrl.value = p.local.baseUrl || OLLAMA_DEFAULT_BASE;
      apiKeyEnv.value = "";
      provider.value = "custom";
      displayName.value = p.local.displayName ?? "";
      activeRemoteId.value = null;
    } else {
      const preset = getDefaultRemotePreset(p);
      if (preset) {
        activeRemoteId.value = preset.id;
        model.value = preset.textModel;
        baseUrl.value = preset.baseUrl;
        apiKeyEnv.value = preset.apiKeyEnv;
        provider.value = preset.provider;
        displayName.value = preset.label;
      }
    }
  }

  function placePanel() {
    const el = panelAnchor.value;
    if (!el) return;
    const r = el.getBoundingClientRect();
    panelStyle.value = {
      position: "fixed",
      top: `${Math.round(r.top - 8)}px`,
      left: `${Math.round(Math.min(r.left, window.innerWidth - 340))}px`,
      width: "320px",
      transform: "translateY(-100%)",
      zIndex: "9999",
    };
  }

  async function refreshLocalModels() {
    try {
      const base = baseUrl.value.trim() || OLLAMA_DEFAULT_BASE;
      localModels.value = await listLocalModels(base);
    } catch {
      localModels.value = [];
    }
  }

  async function refreshVerifiedLists() {
    if (!profiles.value) return;
    listLoading.value = true;
    try {
      const base = baseUrl.value.trim() || profiles.value.local.baseUrl || OLLAMA_DEFAULT_BASE;
      verifiedLocalModels.value = await filterVerifiedLocalModels(base);
      verifiedRemotePresets.value = await filterVerifiedRemotePresets(profiles.value.remotePresets);
      profiles.value = {
        ...profiles.value,
        remotePresets: profiles.value.remotePresets.map((p) => {
          const hit = verifiedRemotePresets.value.find((v) => v.id === p.id);
          return hit ? { ...p, lastProbeOk: true } : p;
        }),
      };
      if (source.value === "remote" && activeRemoteId.value) {
        const still = verifiedRemotePresets.value.some((p) => p.id === activeRemoteId.value);
        if (!still && verifiedLocalModels.value.length) {
          void fouAlert("远程模型未配置或未测通，已切换到本地模型", "提示");
          syncFieldsFromProfiles(profiles.value, "local");
          model.value = verifiedLocalModels.value[0] ?? profiles.value.local.textModel;
        }
      }
    } catch {
      verifiedLocalModels.value = [];
      verifiedRemotePresets.value = [];
    } finally {
      listLoading.value = false;
    }
  }

  async function runProbe() {
    if (!baseUrl.value.trim()) {
      probeStatus.value = "fail";
      probeMsg.value = "未配置 Base URL";
      return;
    }
    probeStatus.value = "probing";
    probeMsg.value = "探测中…";
    try {
      const msg = await probeBrain(baseUrl.value, {
        apiKeyEnv: apiKeyEnv.value || undefined,
        model: model.value || undefined,
      });
      probeStatus.value = "ok";
      probeMsg.value = msg || "已联通";
    } catch (e) {
      probeStatus.value = "fail";
      probeMsg.value = toUserError(e);
    }
  }

  function applyVerifiedFromProfiles(p: GlobalModelProfiles) {
    verifiedRemotePresets.value = p.remotePresets.filter(
      (preset) => preset.lastProbeOk && preset.baseUrl.trim() && preset.textModel.trim(),
    );
    const localModel = p.local.textModel.trim();
    verifiedLocalModels.value = localModel ? [localModel] : [];
  }

  async function openPanel() {
    const next = !panelOpen.value;
    panelOpen.value = next;
    if (!next) return;
    placePanel();
    if (!profiles.value) {
      profiles.value = await loadGlobalModelProfiles();
      const src = profiles.value.localOnly ? "local" : profiles.value.defaultSource;
      syncFieldsFromProfiles(profiles.value, src);
    }
    applyVerifiedFromProfiles(profiles.value);
    if (!listsReady) {
      await refreshLocalModels();
      await refreshVerifiedLists();
      listsReady = true;
    } else if (probeStatus.value === "idle") {
      void runProbe();
    }
  }

  function closePanel() {
    panelOpen.value = false;
    // 关闭时与已保存配置对齐，避免只点「本地/远程」未保存时底栏「假切换」
    if (profiles.value) {
      const src = profiles.value.localOnly ? "local" : profiles.value.defaultSource;
      syncFieldsFromProfiles(profiles.value, src);
    }
  }

  async function setSource(next: BrainSource) {
    if (!profiles.value) return;
    if (next === "remote" && profiles.value.localOnly) {
      void fouAlert("已开启「仅本地模型」，无法切换远程", "提示");
      return;
    }
    if (source.value === next) return;
    syncFieldsFromProfiles(profiles.value, next);
    // 必须立刻落盘：否则底栏显示已变，发送仍走旧远程
    await saveBrain(true, { skipListRefresh: true, skipProbe: true });
    fouMsg.success(next === "local" ? "已切换并保存为本地模型" : "已切换并保存为远程模型");
  }

  function setDisplayName(v: string) {
    displayName.value = v;
  }

  function setModel(v: string) {
    model.value = v;
  }

  function setBaseUrl(v: string) {
    baseUrl.value = v;
  }

  async function pickLocalModel(m: string) {
    if (!profiles.value) return;
    if (source.value === "local" && model.value === m) {
      closePanel();
      return;
    }
    source.value = "local";
    model.value = m;
    baseUrl.value = baseUrl.value || profiles.value.local.baseUrl || OLLAMA_DEFAULT_BASE;
    apiKeyEnv.value = "";
    provider.value = "custom";
    const remoteLabels = profiles.value.remotePresets.map((p) => p.label.trim()).filter(Boolean);
    const oldDisplay = (profiles.value.local.displayName ?? "").trim();
    if (!oldDisplay || remoteLabels.includes(oldDisplay) || oldDisplay !== m) {
      displayName.value = m;
    }
    await saveBrain(true, { skipListRefresh: true, skipProbe: true });
  }

  async function pickRemotePreset(preset: RemoteModelPreset) {
    if (!profiles.value) return;
    if (
      activeRemoteId.value === preset.id &&
      model.value === preset.textModel &&
      baseUrl.value === preset.baseUrl
    ) {
      closePanel();
      return;
    }
    if (profiles.value.localOnly) {
      void fouAlert("已开启「仅本地模型」，无法使用远程预设", "提示");
      return;
    }
    if (!preset.baseUrl.trim() || !preset.textModel.trim()) {
      void fouAlert("该远程预设未配置完整", "提示");
      return;
    }
    source.value = "remote";
    activeRemoteId.value = preset.id;
    model.value = preset.textModel;
    baseUrl.value = preset.baseUrl;
    apiKeyEnv.value = preset.apiKeyEnv;
    provider.value = preset.provider;
    displayName.value = preset.label;
    await saveBrain(true, { skipListRefresh: true, skipProbe: true });
  }

  async function saveBrain(
    keepOpen = false,
    opts?: { skipListRefresh?: boolean; skipProbe?: boolean },
  ) {
    if (!profiles.value) return;
    saving.value = true;
    try {
      if (profiles.value.localOnly && source.value === "remote") {
        source.value = "local";
      }
      let next = {
        ...profiles.value,
        defaultSource: profiles.value.localOnly ? "local" : source.value,
      };
      if (source.value === "local" && model.value.trim()) {
        next.local = {
          ...next.local,
          textModel: model.value.trim(),
          baseUrl: baseUrl.value.trim() || next.local.baseUrl,
          displayName: displayName.value.trim() || model.value.trim() || next.local.displayName,
        };
      } else if (source.value === "remote" && model.value.trim()) {
        const id = activeRemoteId.value ?? getDefaultRemotePreset(next)?.id;
        if (id) {
          next = setDefaultRemotePreset(next, id);
          next.remotePresets = next.remotePresets.map((p) =>
            p.id === id
              ? {
                  ...p,
                  textModel: model.value.trim(),
                  baseUrl: baseUrl.value.trim() || p.baseUrl,
                  apiKeyEnv: apiKeyEnv.value || p.apiKeyEnv,
                  provider: provider.value || p.provider,
                  label: displayName.value.trim() || p.label,
                  isDefault: true,
                  lastProbeOk: opts?.skipProbe || probeStatus.value === "ok" ? true : p.lastProbeOk,
                }
              : { ...p, isDefault: false },
          );
        }
      }
      await saveGlobalModelProfiles(next);
      profiles.value = next;
      // 同步指挥脑槽，避免对话用 profiles、派活仍读旧三脑远程
      try {
        const brains = await loadOpsBrains();
        if (source.value === "local") {
          await saveOpsBrains({
            ...brains,
            command: {
              ...brains.command,
              source: "local",
              model: model.value.trim() || brains.command.model,
              baseUrl: baseUrl.value.trim() || next.local.baseUrl || OLLAMA_DEFAULT_BASE,
              apiKeyEnv: "",
              remotePresetId: "",
              displayName: displayName.value.trim() || model.value.trim(),
              provider: "custom",
            },
          });
        } else if (activeRemoteId.value) {
          await saveOpsBrains({
            ...brains,
            command: {
              ...brains.command,
              source: "remote",
              model: model.value.trim() || brains.command.model,
              baseUrl: baseUrl.value.trim() || brains.command.baseUrl,
              apiKeyEnv: apiKeyEnv.value || brains.command.apiKeyEnv,
              remotePresetId: activeRemoteId.value,
              displayName: displayName.value.trim() || brains.command.displayName,
              provider: provider.value || brains.command.provider,
            },
          });
        }
      } catch (e) {
        console.warn("[brain-picker] sync command slot", e);
      }
      applyVerifiedFromProfiles(next);
      if (!opts?.skipProbe) {
        await runProbe();
      } else {
        probeStatus.value = "ok";
        probeMsg.value = "已保存";
      }
      if (!opts?.skipListRefresh) {
        listsReady = false;
        await refreshVerifiedLists();
        listsReady = true;
      }
      onChanged?.();
      if (!keepOpen) panelOpen.value = false;
    } catch (e) {
      probeMsg.value = toUserError(e);
      probeStatus.value = "fail";
    } finally {
      saving.value = false;
    }
  }

  function onDocClick(e: MouseEvent) {
    if (!panelOpen.value) return;
    const t = e.target as Node;
    if (panelAnchor.value?.contains(t)) return;
    const panel = document.getElementById("xu-brain-panel-footer");
    if (panel?.contains(t)) return;
    closePanel();
  }

  onMounted(() => {
    document.addEventListener("click", onDocClick, true);
    window.addEventListener("resize", placePanel);
  });

  onUnmounted(() => {
    document.removeEventListener("click", onDocClick, true);
    window.removeEventListener("resize", placePanel);
  });

  return {
    panelOpen,
    brains: profiles,
    localModels,
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
  };
}
