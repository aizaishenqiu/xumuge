<script setup lang="ts">
/**
 * @author qiuye <yjk150@qq.com>
 */
import ScreenshotCaptureOverlay from "../components/ScreenshotCaptureOverlay.vue";
</script>

<template>
  <ScreenshotCaptureOverlay standalone auto-start />
</template>

<style scoped>
:global(html),
:global(body),
:global(#root) {
  margin: 0;
  padding: 0;
  overflow: hidden;
  background: #000;
}
</style>
