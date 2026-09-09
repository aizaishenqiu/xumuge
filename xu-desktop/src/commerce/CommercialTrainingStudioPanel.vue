<script setup lang="ts">
/**
 * Training Studio shell: gray without training.ingest; panel from plugin.
 */
import { computed, onMounted, ref, shallowRef, type Component } from "vue";
import { showCommerceUi } from "../utils/v1ProductSurface";
import { useRouter } from "vue-router";
import { openHelp } from "../composables/useHelp";
import {
  createCommercialHostContext,
  findPluginForEntitlement,
  hasEntitlement,
  listLicenseEntitlements,
  activateCommercialPlugin,
  releaseHeavyModule,
} from "../commerce";
import { ensureBuiltinCommercePlugins } from "./builtinPlugins";

const entitled = ref(false);
const loading = ref(true);
const entitlements = ref<string[]>([]);
const panelComp = shallowRef<Component | null>(null);
const router = useRouter();

const stateLabel = computed(() => {
  if (loading.value) return "检查许可证…";
  if (!entitled.value) return showCommerceUi() ? "商业版 · 未开通" : "训练工作室 · 未配置";
  if (!panelComp.value) return "已授权 · 待安装插件";
  return "训练工作室";
});

async function refresh() {
  loading.value = true;
  panelComp.value = null;
  ensureBuiltinCommercePlugins();
  try {
    const info = await listLicenseEntitlements(true);
    entitlements.value = info.entitlements;
    entitled.value = await hasEntitlement("training.ingest");
    if (!entitled.value) return;
    const plugin = findPluginForEntitlement("training.ingest");
    if (!plugin?.getTrainingStudioPanel) return;
    const ctx = await createCommercialHostContext();
    await activateCommercialPlugin(plugin.id, async (p) => {
      await p.activate(ctx);
    });
    panelComp.value = plugin.getTrainingStudioPanel();
  } catch (e) {
    panelComp.value = null;
    releaseHeavyModule();
    console.warn("[xu] training studio activate", e);
  } finally {
    loading.value = false;
  }
}

function goRolePacks() {
  void router.push({ path: "/settings", query: { group: "role-packs" } });
}

function goHelp() {
  openHelp("settings.flow-and-training");
}

onMounted(() => {
  void refresh();
});
</script>

<template>
  <div class="commerce-trs-panel ui-font">
    <header class="ctp-header">
      <FouIcon icon="graduation-cap-line" class="ctp-icon" />
      <div class="ctp-titles">
        <strong>训练工作室</strong>
        <span class="ctp-sub">{{ stateLabel }}</span>
      </div>
      <FouButton
        icon="refresh-line"
        size="small"
        text
        native-type="button"
        aria-label="刷新"
        :loading="loading"
        @click="refresh"
      />
    </header>

    <component :is="panelComp" v-if="panelComp" class="ctp-live" />

    <div v-else class="ctp-gate">
      <p v-if="!entitled" class="ctp-desc">
        样本浏览 / 课程编辑 / 上传 ingest 需 <code>training.ingest</code>。未开通时采集为空操作。
      </p>
      <p v-else class="ctp-desc">
        已具备授权，但尚未激活对应插件。开发态可设
        <code>xu.dev.entitlements=training.ingest</code>。
      </p>
      <p v-if="entitlements.length" class="ctp-ents">
        当前 entitlement：{{ entitlements.join("、") }}
      </p>
      <div class="ctp-actions">
        <FouButton icon="key-2-line" type="primary" size="small" @click="goRolePacks">
          导入许可证
        </FouButton>
        <FouButton icon="question-line" size="small" @click="goHelp">流程与训练说明</FouButton>
      </div>
    </div>
  </div>
</template>

<style scoped>
.commerce-trs-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--surface, #fff);
}
.ctp-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--hairline);
  flex-shrink: 0;
}
.ctp-icon {
  font-size: 18px;
  color: var(--primary);
  opacity: 0.85;
}
.ctp-titles {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.ctp-sub {
  font-size: 12px;
  color: var(--muted, #888);
}
.ctp-gate {
  flex: 1;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.ctp-desc {
  margin: 0;
  font-size: 13px;
  line-height: 1.55;
  color: var(--text-secondary, #555);
}
.ctp-ents {
  margin: 0;
  font-size: 12px;
}
.ctp-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.ctp-live {
  flex: 1;
  min-height: 0;
  overflow: auto;
}
</style>
