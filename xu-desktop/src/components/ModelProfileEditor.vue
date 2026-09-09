<script setup lang="ts">

import { computed, onMounted, ref, watch } from "vue";

import { FouButton, FouTabBar, FouTabPane } from "foucui";

import { findModelPreset, listModelPresets } from "../utils/modelCatalog";

import {

  defaultGlobalModelProfiles,

  getDefaultRemotePreset,

  loadGlobalModelProfiles,

  remotePresetFromCatalog,

  removeRemotePreset,

  saveGlobalModelProfiles,

  setDefaultRemotePreset,

  upsertRemotePreset,

  type GlobalModelProfiles,

  type RemoteModelPreset,

} from "../utils/globalModelProfiles";

import { listLocalModels, OLLAMA_DEFAULT_BASE, probeBrain } from "../utils/opsBrains";
import { isApiKeyConfigured, setStoredApiKey } from "../utils/apiKeys";
import { isProbeSuccess } from "../utils/modelProbe";
import { toUserError } from "../utils/userFacingError";



const props = defineProps<{

  employeeWorkApi: "follow" | "local" | "remote";

}>();



const emit = defineEmits<{

  "update:employeeWorkApi": [v: "follow" | "local" | "remote"];

  saved: [];

}>();



const profiles = ref<GlobalModelProfiles>(defaultGlobalModelProfiles());

const saving = ref(false);

const localModels = ref<string[]>([]);

const localBusy = ref(false);

const localErr = ref("");

const localProbeMsg = ref("");

const remoteProbeMsg = ref("");

const probeBusy = ref(false);

const activeTab = ref<"local" | "remote">("local");



const presetDialogOpen = ref(false);

const editingPreset = ref<RemoteModelPreset | null>(null);

const presetCatalogId = ref("");

const editingApiKey = ref("");

const editingApiKeyConfigured = ref(false);



const cloudPresets = computed(() =>

  listModelPresets().filter((p) => !p.custom && p.id !== "ollama-local"),

);



const localModelSelectOptions = computed(() =>

  localModels.value.map((m) => ({ value: m, label: m })),

);



const cloudPresetSelectOptions = computed(() => [

  ...cloudPresets.value.map((p) => ({ value: p.id, label: p.label })),

  { value: "custom", label: "自定义" },

]);



const apiFormatOptions = [

  { value: "openai", label: "OpenAI 兼容" },

  { value: "ollama", label: "Ollama" },

  { value: "anthropic", label: "Anthropic" },

];



const defaultRemote = computed(() => getDefaultRemotePreset(profiles.value));



onMounted(() => {

  void refresh();

});



async function refresh() {

  profiles.value = await loadGlobalModelProfiles(true);

  if (profiles.value.local.textModel || profiles.value.defaultSource === "local") {

    void refreshLocalModels(false);

  }

}



async function refreshLocalModels(autoPick: boolean) {

  localBusy.value = true;

  localErr.value = "";

  try {

    localModels.value = await listLocalModels(OLLAMA_DEFAULT_BASE);

    if (!localModels.value.length) {

      localErr.value = "未发现本地模型，请确认 Ollama 已启动";

    } else if (autoPick && !profiles.value.local.textModel) {

      profiles.value = {

        ...profiles.value,

        local: { ...profiles.value.local, textModel: localModels.value[0] },

      };

    }

  } catch (e) {

    localErr.value = toUserError(e);

    localModels.value = [];

  } finally {

    localBusy.value = false;

  }

}



async function persist() {

  saving.value = true;

  try {

    let next = { ...profiles.value };

    if (next.localOnly) {

      next = { ...next, defaultSource: "local" };

      if (props.employeeWorkApi === "remote") {

        emit("update:employeeWorkApi", "local");

      }

    }

    await saveGlobalModelProfiles(next);

    profiles.value = next;

    emit("saved");

  } finally {

    saving.value = false;

  }

}



function setLocalOnly(enabled: boolean) {

  void (async () => {

    const next = { ...profiles.value, localOnly: enabled };

    if (enabled) {

      next.defaultSource = "local";

      activeTab.value = "local";

      if (props.employeeWorkApi === "remote") {

        emit("update:employeeWorkApi", "local");

      }

    }

    profiles.value = next;

    await saveGlobalModelProfiles(next);

    emit("saved");

  })();

}



async function probeLocal() {

  probeBusy.value = true;

  localProbeMsg.value = "";

  try {

    const msg = await probeBrain(profiles.value.local.baseUrl, {

      model: profiles.value.local.textModel || undefined,

    });

    localProbeMsg.value = msg;

  } catch (e) {

    localProbeMsg.value = toUserError(e);

  } finally {

    probeBusy.value = false;

  }

}



async function probeRemote(preset: RemoteModelPreset) {

  probeBusy.value = true;

  remoteProbeMsg.value = "";

  try {

    const msg = await probeBrain(preset.baseUrl, {

      model: preset.textModel || undefined,

      apiKeyEnv: preset.apiKeyEnv || undefined,

    });

    remoteProbeMsg.value = msg;

    const ok = isProbeSuccess(msg);

    const presets = profiles.value.remotePresets.map((p) =>

      p.id === preset.id ? { ...p, lastProbeOk: ok } : p,

    );

    profiles.value = { ...profiles.value, remotePresets: presets };

    if (ok) await saveGlobalModelProfiles(profiles.value);

  } catch (e) {

    remoteProbeMsg.value = toUserError(e);

    const presets = profiles.value.remotePresets.map((p) =>

      p.id === preset.id ? { ...p, lastProbeOk: false } : p,

    );

    profiles.value = { ...profiles.value, remotePresets: presets };

  } finally {

    probeBusy.value = false;

  }

}



function openNewPreset() {

  const first = cloudPresets.value[0];

  editingApiKey.value = "";

  editingApiKeyConfigured.value = false;

  editingPreset.value = first

    ? remotePresetFromCatalog(first)

    : {

        id: crypto.randomUUID(),

        label: "新远程预设",

        textModel: "",

        visionModel: "",

        baseUrl: "",

        apiKeyEnv: "",

        provider: "custom",

      };

  presetCatalogId.value = first?.id || "";

  presetDialogOpen.value = true;

}



function openEditPreset(p: RemoteModelPreset) {

  editingPreset.value = { ...p };

  editingApiKey.value = "";

  void refreshEditingApiKeyStatus();

  const hit = cloudPresets.value.find(

    (c) => c.model === p.textModel && c.baseUrl === p.baseUrl,

  );

  presetCatalogId.value = hit?.id || "custom";

  presetDialogOpen.value = true;

}



function applyCatalogToEditing(id: string) {

  presetCatalogId.value = id;

  const p = findModelPreset(id);

  if (!p || !editingPreset.value) return;

  editingPreset.value = {

    ...editingPreset.value,

    label: p.label,

    textModel: p.model,

    visionModel: p.model,

    baseUrl: p.baseUrl,

    apiKeyEnv: p.apiKeyEnv,

    provider: p.provider,

    apiFormat: p.apiFormat ?? (p.provider === "anthropic" ? "anthropic" : "openai"),

  };

}



async function refreshEditingApiKeyStatus() {

  const env = editingPreset.value?.apiKeyEnv?.trim();

  if (!env) {

    editingApiKeyConfigured.value = false;

    return;

  }

  editingApiKeyConfigured.value = await isApiKeyConfigured(env);

}



function confirmPresetDialog() {

  if (!editingPreset.value) return;

  const preset = editingPreset.value;

  const key = editingApiKey.value.trim();

  void (async () => {

    if (key && preset.apiKeyEnv?.trim()) {

      await setStoredApiKey(preset.apiKeyEnv, key);

      editingApiKey.value = "";

      editingApiKeyConfigured.value = true;

    }

    profiles.value = upsertRemotePreset(profiles.value, preset);

    presetDialogOpen.value = false;

    editingPreset.value = null;

    await saveGlobalModelProfiles(profiles.value);

  })();

}



function deletePreset(id: string) {

  profiles.value = removeRemotePreset(profiles.value, id);

}



function makeDefault(id: string) {

  profiles.value = setDefaultRemotePreset(profiles.value, id);

}



function onTabChange(tab: "local" | "remote") {

  if (tab === "remote" && profiles.value.localOnly) return;

  activeTab.value = tab;

  if (tab === "local" && !localModels.value.length && !localBusy.value) {

    void refreshLocalModels(false);

  }

}



watch(

  () => profiles.value.defaultSource,

  (s) => {

    if (s === "local") void refreshLocalModels(false);

  },

);

</script>



<template>

  <section class="settings-section model-profile-editor">

    <div class="settings-section-header">

      <div>

        <h2 class="settings-section-title ui-font">模型配置</h2>

        <p class="settings-section-desc">

          本地与远程分 Tab 配置；指挥/工作/代码脑与员工均继承此处。岗位 brainSlot 只区分任务类型，不再单独选模型。

        </p>

      </div>

      <div class="settings-section-actions">

        <FouButton icon="refresh-line" size="small" :loading="localBusy" @click="refresh">

          刷新

        </FouButton>

        <FouButton type="primary" icon="save-line" size="small" :loading="saving" @click="persist">

          保存

        </FouButton>

      </div>

    </div>



    <FouTabBar
      :model-value="activeTab"
      type="border-card"
      class="model-profile-tabs"
      @update:model-value="(v: string | number) => onTabChange(String(v) as 'local' | 'remote')"
    >
      <FouTabPane name="local" label="本地">
        <div class="model-profile-tab-panel">
      <div class="settings-row settings-row--stacked">

        <div class="settings-row-label">

          <span class="ui-font">显示名称（别名）</span>

          <span class="settings-row-desc">对话中显示，留空则用模型 ID</span>

        </div>

        <FouInput

          :model-value="profiles.local.displayName ?? ''"

          class="settings-row-control"

          maxlength="40"

          placeholder="如 Qwen3 助手"

          @update:model-value="(v: string) => (profiles.local.displayName = v || '')"

        />

      </div>

      <div class="settings-row settings-row--stacked">

        <div class="settings-row-label">

          <span class="ui-font">文本模型</span>

        </div>

        <FouSelect

          :model-value="profiles.local.textModel"

          class="settings-row-control"

          filterable

          placeholder="选择 Ollama 模型"

          :options="localModelSelectOptions"

          @update:model-value="(v: string) => (profiles.local.textModel = v || '')"

        />

      </div>

      <div class="settings-row settings-row--stacked">

        <div class="settings-row-label">

          <span class="ui-font">视觉模型</span>

          <span class="settings-row-desc">留空则回退文本模型</span>

        </div>

        <FouSelect

          :model-value="profiles.local.visionModel"

          class="settings-row-control"

          filterable

          clearable

          placeholder="可选"

          :options="localModelSelectOptions"

          @update:model-value="(v: string) => (profiles.local.visionModel = v || '')"

        />

      </div>

      <div class="settings-row settings-row--actions">

        <FouButton

          icon="refresh-line"

          size="small"

          :loading="localBusy"

          @click="refreshLocalModels(true)"

        >

          刷新本地列表

        </FouButton>

        <FouButton icon="radar-line" size="small" :loading="probeBusy" @click="probeLocal">

          测通本地

        </FouButton>

      </div>

      <p class="settings-row-desc ui-font">{{ OLLAMA_DEFAULT_BASE }}</p>

      <p v-if="localErr" class="settings-row-desc model-profile-err">{{ localErr }}</p>

      <p v-if="localProbeMsg" class="settings-row-desc ui-font">{{ localProbeMsg }}</p>

    
        </div>
      </FouTabPane>
      <FouTabPane name="remote" label="远程">
        <div class="model-profile-tab-panel">
      <p class="model-profile-privacy-warn ui-font">

        远程 API 会将对话中的文字、代码片段与工具读取结果发送至服务商；是否用于训练取决于厂商条款。敏感代码请开启下方「仅本地模型」或默认来源选本地。

      </p>

      <div class="model-profile-block-head">

        <span class="settings-row-desc ui-font">可添加多条远程 API 预设，其中一条为默认。</span>

        <FouButton icon="add-line" size="small" @click="openNewPreset">新增</FouButton>

      </div>

      <ul v-if="profiles.remotePresets.length" class="remote-preset-list">

        <li v-for="p in profiles.remotePresets" :key="p.id" class="remote-preset-item">

          <div class="remote-preset-main">

            <span class="ui-font remote-preset-label">

              {{ p.label }}

              <span v-if="p.isDefault" class="remote-preset-badge">默认</span>

            </span>

            <span class="settings-row-desc">

              {{ p.textModel }}

              <template v-if="p.visionModel && p.visionModel !== p.textModel">

                · 视觉 {{ p.visionModel }}

              </template>

            </span>

            <span class="settings-row-desc">{{ p.baseUrl || "（默认 Base URL）" }}</span>

          </div>

          <div class="remote-preset-actions">

            <FouButton

              v-if="!p.isDefault"

              icon="star-line"

              size="small"

              text

              @click="makeDefault(p.id)"

            >

              设为默认

            </FouButton>

            <FouButton icon="edit-line" size="small" text @click="openEditPreset(p)">编辑</FouButton>

            <FouButton icon="radar-line" size="small" text @click="probeRemote(p)">测通</FouButton>

            <FouButton

              icon="delete-bin-line"

              size="small"

              text

              :disabled="profiles.remotePresets.length <= 1"

              @click="deletePreset(p.id)"

            >

              删除

            </FouButton>

          </div>

        </li>

      </ul>

      <p v-else class="settings-row-desc ui-font">暂无远程预设，请新增。</p>

      <p v-if="defaultRemote" class="settings-row-desc ui-font">

        当前默认远程：{{ defaultRemote.label }}（{{ defaultRemote.textModel }}）

      </p>

      <p v-if="remoteProbeMsg" class="settings-row-desc ui-font">{{ remoteProbeMsg }}</p>

    
        </div>
      </FouTabPane>
    </FouTabBar>




    <div class="model-profile-inherit">

      <h3 class="model-profile-inherit-title ui-font">继承规则</h3>

      <div class="settings-row">

        <div class="settings-row-label">

          <span class="ui-font">仅本地模型（硬隔离）</span>

          <span class="settings-row-desc">开启后对话与派活一律走本机 Ollama，禁止远程 API</span>

        </div>

        <FouCheckbox :model-value="profiles.localOnly === true" @update:model-value="setLocalOnly">

          仅本地模型

        </FouCheckbox>

      </div>

      <div class="settings-row">

        <div class="settings-row-label">

          <span class="ui-font">默认来源</span>

          <span class="settings-row-desc">员工「继承」且全局「继承默认」时使用</span>

        </div>

        <div class="brain-source-row">

          <FouButton

            icon="computer-line"

            size="small"

            native-type="button"

            :type="profiles.defaultSource === 'local' ? 'primary' : 'default'"

            @click="profiles = { ...profiles, defaultSource: 'local' }"

          >

            本地

          </FouButton>

          <FouButton

            icon="cloud-line"

            size="small"

            native-type="button"

            :type="profiles.defaultSource === 'remote' ? 'primary' : 'default'"

            :disabled="profiles.localOnly === true"

            @click="profiles = { ...profiles, defaultSource: 'remote' }"

          >

            远程

          </FouButton>

        </div>

      </div>

      <div class="settings-row">

        <div class="settings-row-label">

          <span class="ui-font">员工工作 API 默认</span>

          <span class="settings-row-desc">未单独设置的员工：继承默认 / 强制本地 / 强制远程</span>

        </div>

        <div class="brain-source-row">

          <FouButton

            icon="link-m"

            size="small"

            native-type="button"

            :type="employeeWorkApi === 'follow' ? 'primary' : 'default'"

            @click="emit('update:employeeWorkApi', 'follow')"

          >

            继承默认

          </FouButton>

          <FouButton

            icon="computer-line"

            size="small"

            native-type="button"

            :type="employeeWorkApi === 'local' ? 'primary' : 'default'"

            @click="emit('update:employeeWorkApi', 'local')"

          >

            强制本地

          </FouButton>

          <FouButton

            icon="cloud-line"

            size="small"

            native-type="button"

            :type="employeeWorkApi === 'remote' ? 'primary' : 'default'"

            :disabled="profiles.localOnly === true"

            @click="emit('update:employeeWorkApi', 'remote')"

          >

            强制远程

          </FouButton>

        </div>

      </div>

    </div>



    <FouDialog v-model="presetDialogOpen" title="远程预设" width="520px" append-to-body>

      <template v-if="editingPreset">

        <div class="preset-dialog-form">

          <label class="preset-field">

            <span class="ui-font">从目录快速填充</span>

            <FouSelect

              :model-value="presetCatalogId"

              filterable

              :options="cloudPresetSelectOptions"

              @update:model-value="(v: string) => applyCatalogToEditing(v)"

            />

          </label>

          <label class="preset-field">

            <span class="ui-font">显示名称</span>

            <FouInput v-model="editingPreset.label" maxlength="40" />

          </label>

          <label class="preset-field">

            <span class="ui-font">文本模型</span>

            <FouInput v-model="editingPreset.textModel" maxlength="80" />

          </label>

          <label class="preset-field">

            <span class="ui-font">视觉模型</span>

            <FouInput v-model="editingPreset.visionModel" maxlength="80" placeholder="默认同文本" />

          </label>

          <label class="preset-field">

            <span class="ui-font">Base URL</span>

            <FouInput v-model="editingPreset.baseUrl" maxlength="200" />

          </label>

          <label class="preset-field">

            <span class="ui-font">API Key 环境变量</span>

            <FouInput v-model="editingPreset.apiKeyEnv" maxlength="64" placeholder="可选，用于从环境变量读取" @change="refreshEditingApiKeyStatus" />

          </label>

          <label class="preset-field">

            <span class="ui-font">API Key</span>

            <FouInput

              v-model="editingApiKey"

              type="password"

              maxlength="256"

              :placeholder="editingApiKeyConfigured ? '已保存（留空不修改）' : '粘贴服务商 Key，保存后写入本机'"

            />

            <span class="preset-hint muted ui-font">

              密钥仅保存在本机，仅当前用户使用。也可在系统环境变量中配置 API 密钥。

            </span>

          </label>

          <label class="preset-field">

            <span class="ui-font">API 格式</span>

            <FouSelect v-model="editingPreset.apiFormat" :options="apiFormatOptions" />

          </label>

        </div>

      </template>

      <template #footer>

        <FouButton icon="close-line" @click="presetDialogOpen = false">取消</FouButton>

        <FouButton type="primary" icon="check-line" @click="confirmPresetDialog">确定</FouButton>

      </template>

    </FouDialog>

  </section>

</template>



<style scoped>

.model-profile-tabs {
  margin-bottom: 12px;
}
.model-profile-tabs :deep(.fou-tab-bar__content) {
  padding-top: 12px;
}

.model-profile-tab-panel {

  min-height: 0;

  padding-bottom: 4px;

}

.model-profile-inherit {

  margin-top: 14px;

  padding-top: 12px;

  border-top: 1px solid var(--hairline);

}

.model-profile-inherit-title {

  margin: 0 0 10px;

  font-size: 12px;

  font-weight: 650;

  color: var(--ink);

}

.model-profile-err {

  color: var(--error);

}

.model-profile-privacy-warn {

  margin: 0 0 10px;

  padding: 8px 10px;

  border-radius: 8px;

  font-size: 12px;

  line-height: 1.5;

  color: var(--ink-muted, #5c6570);

  background: color-mix(in srgb, var(--warning, #f59e0b) 12%, transparent);

  border: 1px solid color-mix(in srgb, var(--warning, #f59e0b) 35%, var(--hairline));

}

.model-profile-block-head {

  display: flex;

  align-items: center;

  justify-content: space-between;

  gap: 8px;

  margin-bottom: 8px;

}

.remote-preset-list {

  list-style: none;

  margin: 0;

  padding: 0;

  display: flex;

  flex-direction: column;

  gap: 8px;

}

.remote-preset-item {

  display: flex;

  flex-wrap: wrap;

  align-items: flex-start;

  justify-content: space-between;

  gap: 8px;

  padding: 8px 10px;

  border: 1px solid var(--hairline);

  border-radius: var(--radius);

  background: var(--canvas);

}

.remote-preset-main {

  display: flex;

  flex-direction: column;

  gap: 2px;

  min-width: 0;

  flex: 1;

}

.remote-preset-label {

  font-weight: 600;

  display: flex;

  align-items: center;

  gap: 6px;

}

.remote-preset-badge {

  font-size: 10px;

  font-weight: 600;

  color: var(--primary);

  background: var(--primary-glow);

  padding: 1px 6px;

  border-radius: 4px;

}

.remote-preset-actions {

  display: flex;

  flex-wrap: wrap;

  gap: 4px;

}

.preset-dialog-form {

  display: flex;

  flex-direction: column;

  gap: 10px;

}

.preset-field {

  display: flex;

  flex-direction: column;

  gap: 4px;

}

.preset-hint {

  font-size: 11px;

  line-height: 1.35;

}

</style>


