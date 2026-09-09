<script setup lang="ts">
/**
 * Workflow Studio shell: gray CTA without entitlement; panel from registered plugin.
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
  if (!entitled.value) return showCommerceUi() ? "商业版 · 未开通" : "流程工作室 · 未配置";
  if (!panelComp.value) return "已授权 · 待安装插件";
  return "流程工作室";
});

async function refresh() {
  loading.value = true;
  panelComp.value = null;
  ensureBuiltinCommercePlugins();
  try {
    const info = await listLicenseEntitlements(true);
    entitlements.value = info.entitlements;
    entitled.value = await hasEntitlement("workflow.studio");
    if (!entitled.value) return;
    const plugin = findPluginForEntitlement("workflow.studio");
    if (!plugin?.getWorkflowStudioPanel) return;
    const ctx = await createCommercialHostContext();
    await activateCommercialPlugin(plugin.id, async (p) => {
      await p.activate(ctx);
    });
    panelComp.value = plugin.getWorkflowStudioPanel();
  } catch (e) {
    panelComp.value = null;
    releaseHeavyModule();
    console.warn("[xu] workflow studio activate", e);
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
  <div class="commerce-wfs-panel ui-font">
    <header class="cwp-header">
      <FouIcon icon="organization-chart" class="cwp-icon" />
      <div class="cwp-titles">
        <strong>流程工作室</strong>
        <span class="cwp-sub">{{ stateLabel }}</span>
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

    <component :is="panelComp" v-if="panelComp" class="cwp-live" />

    <div v-else class="cwp-gate">
      <p v-if="!entitled" class="cwp-desc">
        行业波次可视化编辑（拖拽泳道 / 角色归属）需 <code>workflow.studio</code> 授权。未开通时不会加载工作室。
      </p>
      <p v-else class="cwp-desc">
        已具备授权，但尚未激活对应插件。开发态可设 localStorage <code>xu.dev.entitlements=workflow.studio</code>。
      </p>
      <p v-if="entitlements.length" class="cwp-ents">
        当前 entitlement：{{ entitlements.join("、") }}
      </p>
      <div class="cwp-actions">
        <FouButton icon="key-2-line" type="primary" size="small" @click="goRolePacks">
          导入许可证
        </FouButton>
        <FouButton icon="question-line" size="small" @click="goHelp">流程与训练说明</FouButton>
      </div>
    </div>
  </div>
</template>

<style scoped>
.commerce-wfs-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--surface, #fff);
}
.cwp-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--hairline);
  flex-shrink: 0;
}
.cwp-icon {
  font-size: 18px;
  color: var(--primary);
  opacity: 0.85;
}
.cwp-titles {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.cwp-sub {
  font-size: 12px;
  color: var(--muted, #888);
}
.cwp-gate {
  flex: 1;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.cwp-desc {
  margin: 0;
  font-size: 13px;
  line-height: 1.55;
  color: var(--text-secondary, #555);
}
.cwp-ents {
  margin: 0;
  font-size: 12px;
}
.cwp-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.cwp-live {
  flex: 1;
  min-height: 0;
  overflow: auto;
}
</style>
