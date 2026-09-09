<script setup lang="ts">
/**
 * 全局页脚作者署名（挂载于 App 壳层，各路由页面均可见）
 *
 * @author qiuye <yjk150@qq.com>
 */
import { APP_AUTHOR_LABEL } from "../constants/author";
</script>

<template>
  <footer class="qiu-page-author ui-font" aria-label="作者信息">
    {{ APP_AUTHOR_LABEL }}
  </footer>
</template>

<style scoped>
.qiu-page-author {
  flex-shrink: 0;
  padding: 4px 12px 6px;
  text-align: center;
  font-size: 10px;
  color: var(--muted-soft, var(--muted));
  opacity: 0.72;
  user-select: none;
}
</style>
