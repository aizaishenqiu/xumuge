<script setup lang="ts">
/**
 * @file HomePage.vue 桌面首页（嵌入对话）+ 首发公告
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-20
 * @updated 2026-09-04
 * @version 1.1.0
 * @category Layout
 * @algo none
 */
import { onMounted, ref } from "vue";
import ChatPage from "./ChatPage.vue";
import ReleaseNoticeDialog from "../components/ReleaseNoticeDialog.vue";
import { RELEASE_NOTICE_STORAGE_KEY } from "../utils/releaseNotice";
import { clearStuckUiBlockers } from "../utils/clearStuckUiBlockers";

const releaseNoticeOpen = ref(false);

function shouldShowReleaseNotice(): boolean {
  try {
    return localStorage.getItem(RELEASE_NOTICE_STORAGE_KEY) !== "1";
  } catch {
    return true;
  }
}

onMounted(() => {
  clearStuckUiBlockers();
  if (shouldShowReleaseNotice()) {
    releaseNoticeOpen.value = true;
  }
});
</script>

<template>
  <div class="home-page">
    <ChatPage embedded home-mode />
    <ReleaseNoticeDialog v-model="releaseNoticeOpen" />
  </div>
</template>

<style scoped>
.home-page {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--surface-base, #f8fafc);
}
</style>
