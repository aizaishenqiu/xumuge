<script setup lang="ts">
/**
 * @file 帮助完整页：主题与路由 query.t 同步
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-30
 * @updated 2026-09-02
 * @version 1.1.0
 * @category Layout
 * @algo none
 */
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { FouButton, fouMsg } from "foucui";
import HelpShell from "../components/help/HelpShell.vue";
import { resolveHelpTopicId } from "../help/helpManifest";

const route = useRoute();
const router = useRouter();

const topicId = computed({
  get: () => {
    const raw = route.query.t;
    const id = typeof raw === "string" ? raw : Array.isArray(raw) ? raw[0] : "";
    return resolveHelpTopicId(id || undefined);
  },
  set: (id: string) => {
    const next = resolveHelpTopicId(id);
    const cur =
      typeof route.query.t === "string"
        ? route.query.t
        : Array.isArray(route.query.t)
          ? route.query.t[0]
          : "";
    if (cur === next) return;
    void router.replace({ path: "/help", query: { t: next } });
  },
});

async function copyHelpLink() {
  const url = `${window.location.origin}${window.location.pathname}#/help?t=${topicId.value}`;
  try {
    await navigator.clipboard.writeText(url);
    fouMsg.success("链接已复制");
  } catch {
    fouMsg.info("复制失败，请手动分享当前帮助页");
  }
}
</script>

<template>
  <div class="vue-page help-page">
    <header class="vue-page-header">
      <div>
        <h1 class="ui-font">帮助</h1>
        <p class="ui-font muted">功能说明与配置指南 · 左侧选择主题</p>
      </div>
      <div class="vue-page-actions">
        <FouButton icon="link" native-type="button" @click="copyHelpLink">复制链接</FouButton>
      </div>
    </header>
    <main class="help-page-main">
      <HelpShell v-model:topic-id="topicId" />
    </main>
  </div>
</template>

<style scoped>
.help-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
.help-page-main {
  flex: 1;
  min-height: 0;
  padding: 0 16px 16px;
  display: flex;
  flex-direction: column;
}
.vue-page-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 20px 8px;
}
.vue-page-header h1 {
  margin: 0;
  font-size: 1.35rem;
}
.vue-page-header .muted {
  margin: 4px 0 0;
  font-size: 13px;
  color: var(--muted);
}
.vue-page-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}
</style>
