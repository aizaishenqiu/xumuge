<script setup lang="ts">
/**
 * @file 桌面指挥/工作/代码模型配置区
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-31
 * @version 1.0.0
 * @category Config
 * @algo none
 */
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { FouButton, FouInput } from "foucui";
import BrainModelField from "../BrainModelField.vue";
import {
  defaultOpsBrains,
  loadOpsBrains,
  loadEmployeeWorkApiSource,
  OLLAMA_DEFAULT_BASE,
  probeBrain,
  sanitizeApiKeyEnv,
  saveEmployeeWorkApiSource,
  saveOpsBrains,
  type BrainSlotConfig,
  type BrainSource,
  type GlobalEmployeeApiSource,
  type OpsBrains,
} from "../../utils/opsBrains";
import {
  GLOBAL_MODEL_PROFILES_CHANGED,
  loadGlobalModelProfiles,
  type RemoteModelPreset,
} from "../../utils/globalModelProfiles";
import { isApiKeyConfigured } from "../../utils/apiKeys";
import {
  loadAgentPrefs,
  saveAgentPrefs,
  type AgentPrefs,
} from "../../utils/agentPrefs";
import { reconcileRemotePresetBinding } from "../../utils/opsBrainPreset";
import { toUserError } from "../../utils/userFacingError";

const props = defineProps<{
  employeeWorkApi: GlobalEmployeeApiSource;
}>();

const emit = defineEmits<{
  "update:employeeWorkApi": [GlobalEmployeeApiSource];
  saved: [];
}>();

const brains = ref<OpsBrains>(defaultOpsBrains());
const brainProbe = ref<Record<string, string>>({});
const savingBrains = ref(false);
const keyStatus = ref<Record<string, boolean>>({});
const agentPrefs = ref<AgentPrefs>({
  localStream: true,
  llmCompact: false,
  execPolicy: "standard",
  chatMode: "agent",
  temperature: 0.2,
  bulkReadWarnEnabled: true,
  bulkReadFileThreshold: 40,
  bulkReadBytesThreshold: 1_572_864,
  ideReleaseGateEnabled: false,
});
const smartnessTier = ref<"fast" | "balanced" | "strong" | "">("");
const smartnessMsg = ref("");
const savingSmartness = ref(false);
const remotePresetsCache = ref<RemoteModelPreset[]>([]);

const SLOTS = ["command", "work", "code"] as const;
const SLOT_LABEL: Record<(typeof SLOTS)[number], string> = {
  command: "指挥脑",
  work: "工作脑",
  code: "代码脑",
};

const TIER_LABEL = {
  fast: "快",
  balanced: "均衡",
  strong: "强",
} as const;

/** Force local/remote from employee work API default */
const forcedSource = computed<BrainSource | null>(() => {
  if (props.employeeWorkApi === "local") return "local";
  if (props.employeeWorkApi === "remote") return "remote";
  return null;
});

function patchBrain(slot: keyof OpsBrains, patch: Partial<BrainSlotConfig>) {
  const next = { ...brains.value[slot], ...patch };
  if (patch.apiKeyEnv != null) {
    next.apiKeyEnv = sanitizeApiKeyEnv(patch.apiKeyEnv);
  }
  brains.value = { ...brains.value, [slot]: next };
  if (next.apiKeyEnv) void refreshKeyStatus(slot);
}

async function refreshKeyStatus(slot: keyof OpsBrains) {
  const env = sanitizeApiKeyEnv(brains.value[slot].apiKeyEnv);
  keyStatus.value = {
    ...keyStatus.value,
    [slot]: env ? await isApiKeyConfigured(env) : false,
  };
}

async function persistBrains() {
  savingBrains.value = true;
  try {
    // Apply force source onto slots before save for consistency
    const force = forcedSource.value;
    let next = brains.value;
    if (force) {
      next = {
        command: { ...next.command, source: force },
        work: { ...next.work, source: force },
        code: { ...next.code, source: force },
      };
      brains.value = next;
    }
    await saveOpsBrains(next);
    await saveEmployeeWorkApiSource(props.employeeWorkApi);
    emit("saved");
  } finally {
    savingBrains.value = false;
  }
}

function effectiveSlot(slot: keyof OpsBrains): BrainSlotConfig {
  const cfg = brains.value[slot];
  const force = forcedSource.value;
  if (!force || cfg.source === force) return cfg;
  return { ...cfg, source: force };
}

async function runProbe(slot: keyof OpsBrains) {
  let cfg = effectiveSlot(slot);
  brainProbe.value = { ...brainProbe.value, [slot]: "测通中…" };

  try {
    // Prefer bound remote preset credentials
    if (cfg.source !== "local") {
      const pid = (cfg.remotePresetId || "").trim();
      if (!pid) {
        brainProbe.value = {
          ...brainProbe.value,
          [slot]:
            "请先在下拉中选择「模型配置」里的远程预设（URL / Key 只在下方模型配置中填写）。",
        };
        return;
      }
      const profiles = await loadGlobalModelProfiles();
      const preset = profiles.remotePresets.find((p) => p.id === pid) || null;
      if (!preset) {
        brainProbe.value = {
          ...brainProbe.value,
          [slot]: "所选远程预设已不存在，请到「模型配置」重建或另选预设。",
        };
        return;
      }
      cfg = {
        ...cfg,
        baseUrl: preset.baseUrl,
        model: preset.textModel,
        apiKeyEnv: sanitizeApiKeyEnv(preset.apiKeyEnv),
        provider: preset.provider,
      };
      patchBrain(slot, {
        baseUrl: cfg.baseUrl,
        model: cfg.model,
        apiKeyEnv: cfg.apiKeyEnv,
        provider: cfg.provider,
        remotePresetId: pid,
        source: "remote",
      });
      const env = sanitizeApiKeyEnv(cfg.apiKeyEnv);
      if (!env) {
        brainProbe.value = {
          ...brainProbe.value,
          [slot]:
            "该远程预设未配置 API Key。请到下方「模型配置 → 远程」编辑预设并保存 Key 后再测通。",
        };
        return;
      }
      const ok = await isApiKeyConfigured(env);
      if (!ok) {
        brainProbe.value = {
          ...brainProbe.value,
          [slot]: `未配置 API Key：请在「模型配置 → 远程」为环境变量 ${env} 填写 Key 并保存后再试。`,
        };
        return;
      }
      brainProbe.value = {
        ...brainProbe.value,
        [slot]: await probeBrain(cfg.baseUrl, { apiKeyEnv: env, model: cfg.model }),
      };
      return;
    }

    const baseUrl = cfg.baseUrl.trim() || OLLAMA_DEFAULT_BASE;
    brainProbe.value = {
      ...brainProbe.value,
      [slot]: await probeBrain(baseUrl, { apiKeyEnv: "", model: cfg.model }),
    };
  } catch (e) {
    brainProbe.value = { ...brainProbe.value, [slot]: toUserError(e) };
  }
}

function scorePresetForTier(p: RemoteModelPreset, tier: "fast" | "balanced" | "strong"): number {
  const m = `${p.label} ${p.textModel}`.toLowerCase();
  if (tier === "strong") {
    if (/reasoner|r1|pro|opus|ultra|72b|70b|32b|qwq/.test(m)) return 100;
    if (/plus|large|max/.test(m)) return 70;
    return 20;
  }
  if (tier === "fast") {
    if (/flash|mini|tiny|haiku|lite|1\.5|3b|7b|8b|nano/.test(m)) return 100;
    if (/chat(?!.*reason)/.test(m)) return 50;
    return 20;
  }
  // balanced
  if (/chat|sonnet|medium|14b|instruct/.test(m) && !/reasoner|r1|flash|mini/.test(m)) return 90;
  return 40;
}

function pickPreset(
  presets: RemoteModelPreset[],
  tier: "fast" | "balanced" | "strong",
): RemoteModelPreset | null {
  if (!presets.length) return null;
  let best = presets[0];
  let bestScore = -1;
  for (const p of presets) {
    if (!p.textModel.trim()) continue;
    const s = scorePresetForTier(p, tier);
    if (s > bestScore) {
      best = p;
      bestScore = s;
    }
  }
  return best?.textModel ? best : null;
}

async function applySmartnessTier(tier: "fast" | "balanced" | "strong") {
  smartnessTier.value = tier;
  savingSmartness.value = true;
  smartnessMsg.value = "";
  try {
    const profiles = await loadGlobalModelProfiles();
    const force = forcedSource.value;
    const useLocal = force === "local" || (force == null && profiles.defaultSource === "local");
    if (useLocal) {
      const text = profiles.local.textModel.trim();
      if (!text) {
        smartnessMsg.value = "请先在「本地」配置文本模型";
        return;
      }
      for (const slot of SLOTS) {
        patchBrain(slot, {
          source: "local",
          model: text,
          visionModel: profiles.local.visionModel || text,
          baseUrl: profiles.local.baseUrl || OLLAMA_DEFAULT_BASE,
          displayName: profiles.local.displayName || text,
          remotePresetId: "",
        });
      }
      smartnessMsg.value = `已将三脑设为本地「${text}」（本地档位共用同一模型）`;
    } else {
      const pick = pickPreset(profiles.remotePresets, tier);
      if (!pick) {
        smartnessMsg.value = "请先添加远程模型预设";
        return;
      }
      for (const slot of SLOTS) {
        patchBrain(slot, {
          source: "remote",
          model: pick.textModel,
          visionModel: pick.visionModel || pick.textModel,
          baseUrl: pick.baseUrl,
          apiKeyEnv: sanitizeApiKeyEnv(pick.apiKeyEnv),
          provider: pick.provider,
          remotePresetId: pick.id,
          displayName: pick.label || pick.textModel,
        });
      }
      smartnessMsg.value = `已换档「${TIER_LABEL[tier]}」→ ${pick.label || pick.textModel}（三脑）`;
    }
    await persistBrains();
  } catch (e) {
    smartnessMsg.value = toUserError(e);
  } finally {
    savingSmartness.value = false;
  }
}

async function persistTemperature() {
  savingSmartness.value = true;
  try {
    const t = Number(agentPrefs.value.temperature);
    agentPrefs.value = {
      ...agentPrefs.value,
      temperature: Number.isFinite(t) ? Math.min(1.5, Math.max(0, t)) : 0.2,
    };
    await saveAgentPrefs(agentPrefs.value);
    smartnessMsg.value = `温度已保存：${agentPrefs.value.temperature}`;
  } catch (e) {
    smartnessMsg.value = toUserError(e);
  } finally {
    savingSmartness.value = false;
  }
}

function patchBrainSlot(slot: keyof OpsBrains, patch: Partial<BrainSlotConfig>) {
  patchBrain(slot, patch);
}

watch(
  () => props.employeeWorkApi,
  (v) => {
    if (v === "local" || v === "remote") {
      for (const slot of SLOTS) {
        if (brains.value[slot].source !== v) {
          patchBrain(slot, { source: v });
        }
      }
    }
  },
);

function setEmployeeWorkApi(api: GlobalEmployeeApiSource) {
  emit("update:employeeWorkApi", api);
}

async function refreshRemotePresetsCache(reconcile = false) {
  const profiles = await loadGlobalModelProfiles();
  remotePresetsCache.value = profiles.remotePresets;
  if (!reconcile) return;
  let rebinding = false;
  const next = { ...brains.value };
  for (const slot of SLOTS) {
    const { cfg, changed } = reconcileRemotePresetBinding(next[slot], remotePresetsCache.value);
    if (changed) {
      next[slot] = cfg;
      rebinding = true;
    }
  }
  if (rebinding) {
    brains.value = next;
    await saveOpsBrains(next);
  }
}

function onGlobalProfilesChanged() {
  void refreshRemotePresetsCache(true);
}

onMounted(async () => {
  window.addEventListener(GLOBAL_MODEL_PROFILES_CHANGED, onGlobalProfilesChanged);
  try {
    brains.value = await loadOpsBrains();
    const api = await loadEmployeeWorkApiSource();
    emit("update:employeeWorkApi", api);
    agentPrefs.value = await loadAgentPrefs();
    await refreshRemotePresetsCache(true);
    for (const slot of SLOTS) {
      await refreshKeyStatus(slot);
    }
  } catch {
    /* ignore */
  }
});

onUnmounted(() => {
  window.removeEventListener(GLOBAL_MODEL_PROFILES_CHANGED, onGlobalProfilesChanged);
});
</script>

<template>
  <section class="settings-section settings-section--highlight">
    <div class="settings-section-header">
      <div>
        <h2 class="settings-section-title ui-font">聪明度</h2>
        <p class="settings-section-desc">
          <strong>主开关 = 三脑选用的模型</strong>。一键换档会把指挥/工作/代码三脑切到对应预设；温度影响创造性（默认 0.2）。
        </p>
      </div>
    </div>
    <div class="settings-row">
      <div class="settings-row-label">
        <span class="ui-font">一键换档</span>
        <span class="settings-row-desc">快 / 均衡 / 强 → 映射已配置的远程预设（或本地模型）</span>
      </div>
      <div class="brain-source-row">
        <FouButton
          icon="flashlight-line"
          size="small"
          native-type="button"
          :loading="savingSmartness && smartnessTier === 'fast'"
          :type="smartnessTier === 'fast' ? 'primary' : 'default'"
          @click="void applySmartnessTier('fast')"
        >
          快
        </FouButton>
        <FouButton
          icon="scales-3-line"
          size="small"
          native-type="button"
          :loading="savingSmartness && smartnessTier === 'balanced'"
          :type="smartnessTier === 'balanced' ? 'primary' : 'default'"
          @click="void applySmartnessTier('balanced')"
        >
          均衡
        </FouButton>
        <FouButton
          icon="magic-line"
          size="small"
          native-type="button"
          :loading="savingSmartness && smartnessTier === 'strong'"
          :type="smartnessTier === 'strong' ? 'primary' : 'default'"
          @click="void applySmartnessTier('strong')"
        >
          强
        </FouButton>
      </div>
    </div>
    <div class="settings-row">
      <div class="settings-row-label">
        <span class="ui-font">温度</span>
        <span class="settings-row-desc">0 更稳，越高越发散（0–1.5）。对话模式只影响风格，不等于换模型。</span>
      </div>
      <div class="brain-source-row" style="align-items: center; gap: 10px">
        <FouInput
          type="number"
          style="width: 88px"
          :model-value="String(agentPrefs.temperature)"
          @update:model-value="(v: string) => (agentPrefs.temperature = Number(v))"
        />
        <FouButton
          icon="save-line"
          size="small"
          :loading="savingSmartness"
          @click="void persistTemperature()"
        >
          保存温度
        </FouButton>
      </div>
    </div>
    <p v-if="smartnessMsg" class="settings-row-desc">{{ smartnessMsg }}</p>
    <ul class="settings-row-desc" style="margin: 8px 0 0; padding-left: 1.2em">
      <li v-for="slot in SLOTS" :key="slot">
        {{ SLOT_LABEL[slot] }}：{{ brains[slot].displayName || brains[slot].model || "未配置" }}
        （{{ brains[slot].source === "local" ? "本地" : "远程" }}）
      </li>
    </ul>
  </section>

  <section class="settings-section">
    <div class="settings-section-header">
      <div>
        <h2 class="settings-section-title ui-font">三脑（OpsBrains）</h2>
        <p class="settings-section-desc">
          三脑只<strong>选用</strong>下方「模型配置」里已配好的本地 / 远程模型；不在此填写 Base URL 或 Key。
        </p>
      </div>
      <FouButton
        type="primary"
        icon="save-line"
        size="small"
        :loading="savingBrains"
        @click="void persistBrains()"
      >
        保存
      </FouButton>
    </div>
    <div v-for="slot in SLOTS" :key="slot" class="brain-slot-block">
      <div class="brain-slot-title ui-font">{{ SLOT_LABEL[slot] }}</div>
      <div class="brain-slot-fields">
        <BrainModelField
          :config="brains[slot]"
          :forced-source="forcedSource"
          @change="(p) => patchBrainSlot(slot, p)"
        />
        <FouButton icon="radar-line" size="small" @click="void runProbe(slot)">测通</FouButton>
      </div>
      <p
        v-if="
          effectiveSlot(slot).source !== 'local' &&
          (keyStatus[slot] === true || (brains[slot].remotePresetId || '').trim())
        "
        class="settings-row-desc"
      >
        Key 已就绪（来自模型配置）
      </p>
      <p
        v-if="brainProbe[slot]"
        class="settings-row-desc"
        :class="{ 'brain-probe-err': !brainProbe[slot].startsWith('OK') && brainProbe[slot] !== '测通中…' }"
      >
        {{ brainProbe[slot] }}
      </p>
    </div>
    <div class="settings-row" style="margin-top: 10px">
      <div class="settings-row-label">
        <span class="ui-font">员工工作 API 默认</span>
        <span class="settings-row-desc">员工未单独设置时：跟随脑槽 / 强制本地 / 强制远程（强制时三脑测通也走对应源）</span>
      </div>
      <div class="brain-source-row">
        <FouButton
          icon="link-m"
          size="small"
          native-type="button"
          :type="employeeWorkApi === 'follow' ? 'primary' : 'default'"
          @click="setEmployeeWorkApi('follow')"
        >
          跟随脑槽
        </FouButton>
        <FouButton
          icon="computer-line"
          size="small"
          native-type="button"
          :type="employeeWorkApi === 'local' ? 'primary' : 'default'"
          @click="setEmployeeWorkApi('local')"
        >
          强制本地
        </FouButton>
        <FouButton
          icon="cloud-line"
          size="small"
          native-type="button"
          :type="employeeWorkApi === 'remote' ? 'primary' : 'default'"
          @click="setEmployeeWorkApi('remote')"
        >
          强制远程
        </FouButton>
      </div>
    </div>
    <p class="settings-row-desc">
      推荐：① 下方「模型配置」添加本地 / 远程预设并测通存 Key → ② 三脑下拉选用 → ③ 点保存。
    </p>
  </section>
</template>

<style scoped>
.brain-slot-block {
  margin-bottom: 14px;
  padding: 12px;
  border: 1px solid var(--hairline);
  border-radius: var(--radius);
  background: var(--surface-card);
}
.brain-slot-title {
  font-weight: 600;
  margin-bottom: 8px;
  color: var(--ink);
}
.brain-slot-fields {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}
.brain-source-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.brain-probe-err {
  color: #b91c1c;
}
</style>
