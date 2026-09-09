<script setup lang="ts">
/**
 * @file RolePackCatalogBanner.vue 岗位数据状态横幅（试用已内嵌全量时默认不打扰）
 * @author qiuye <yjk150@qq.com>
 * @date 2026-09-04
 * @version 1.0.1
 * @category UI
 * @algo none
 */
import { onApiCatch } from "../utils/userFacingError";
import { FouButton, fouMsg } from "foucui";
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { cachedSession } from "../utils/auth";
import {
  ROLE_PACK_STORE_URL,
  checkRolePackUpdates,
  getRolePackCatalogStatus,
  type RolePackCatalogStatus,
} from "../office/rolePackApi";
import { open } from "@tauri-apps/plugin-shell";

const router = useRouter();
const status = ref<RolePackCatalogStatus | null>(null);
const busy = ref(false);
const canDownload = ref(false);

async function load() {
  try {
    status.value = await getRolePackCatalogStatus();
  } catch {
    status.value = null;
  }
  try {
    const session = cachedSession();
    canDownload.value = Boolean(session?.permissions?.full);
  } catch {
    canDownload.value = false;
  }
}

async function onDownload() {
  if (!canDownload.value) return;
  busy.value = true;
  try {
    const updates = await checkRolePackUpdates();
    const url = updates.find((u) => u.downloadUrl)?.downloadUrl;
    if (url) {
      await open(url);
      fouMsg.success("已在浏览器打开下载页");
      return;
    }
    await open(ROLE_PACK_STORE_URL);
    fouMsg.info("请在商店下载完整岗位数据包，下载后到设置 → 岗位数据导入");
  } catch (e) {
    void onApiCatch(e);
  } finally {
    busy.value = false;
  }
}

function goSettings() {
  void router.push("/settings?group=role-packs");
}

onMounted(() => void load());
</script>

<template>
  <!-- 试用阶段安装包已含全量岗：仅在仍是演示小包时提示 -->
  <div v-if="status && status.isDemoCatalog" class="role-pack-banner ui-font">
    <span class="role-pack-banner-text">
      当前为测试岗位数据（{{ status.roleCount }} 岗）
      <template v-if="canDownload"> · 可下载完整数据包</template>
      <template v-else> · 请更新安装包或到设置查看岗位数据</template>
    </span>
    <div class="role-pack-banner-actions">
      <FouButton
        v-if="canDownload"
        icon="download-line"
        size="small"
        type="primary"
        native-type="button"
        :loading="busy"
        @click="onDownload"
      >
        下载岗位数据
      </FouButton>
      <FouButton
        v-else
        icon="information-line"
        size="small"
        text
        native-type="button"
        @click="goSettings"
      >
        了解岗位数据
      </FouButton>
    </div>
  </div>
</template>

<style scoped>
.role-pack-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  padding: 8px 12px;
  margin-bottom: 12px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--primary, #2dd4bf) 12%, var(--surface-card, #fff));
  border: 1px solid color-mix(in srgb, var(--primary, #2dd4bf) 35%, var(--hairline, #e2e8f0));
  font-size: 13px;
}
.role-pack-banner-text {
  color: var(--text-secondary, #64748b);
}
.role-pack-banner-actions {
  display: flex;
  gap: 6px;
}
</style>
