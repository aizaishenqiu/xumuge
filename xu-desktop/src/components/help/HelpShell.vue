<script setup lang="ts">
/**
 * @file 帮助壳：左侧目录 + 正文；拦截相对 .md 内链切主题
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-30
 * @updated 2026-09-02
 * @version 1.1.0
 * @category Layout
 * @algo none
 */
import { computed } from "vue";
import ChatMarkdown from "../chat/ChatMarkdown.vue";
import HelpNavTree from "./HelpNavTree.vue";
import {
  findHelpNode,
  firstDocTopicId,
  helpTopicIdForDocRel,
  resolveHelpTopicId,
} from "../../help/helpManifest";
import { loadHelpMarkdown } from "../../help/helpDocs";

const props = withDefaults(
  defineProps<{
    topicId?: string;
    compact?: boolean;
  }>(),
  {
    topicId: "",
    compact: false,
  },
);

const emit = defineEmits<{
  "update:topicId": [id: string];
}>();

const activeId = computed({
  get: () => resolveHelpTopicId(props.topicId || firstDocTopicId()),
  set: (id: string) => emit("update:topicId", id),
});

const activeNode = computed(() => findHelpNode(activeId.value));

const markdown = computed(() => loadHelpMarkdown(activeNode.value?.doc));

/** Duty: 正文内相对 .md 链接改为切帮助主题；http(s) 不拦截。 */
function onHelpMdClick(e: MouseEvent) {
  const a = (e.target as HTMLElement | null)?.closest?.("a") as HTMLAnchorElement | null;
  if (!a || !e.currentTarget || !(e.currentTarget as HTMLElement).contains(a)) return;
  const href = (a.getAttribute("href") || "").trim();
  if (!href || /^https?:\/\//i.test(href) || href.startsWith("mailto:")) return;
  if (!/\.md($|[?#])/i.test(href) && !href.endsWith(".md")) return;
  e.preventDefault();
  e.stopPropagation();
  const id = helpTopicIdForDocRel(href, activeNode.value?.doc);
  if (id) activeId.value = id;
}
</script>

<template>
  <div class="help-shell" :class="{ compact }">
    <aside class="help-tree-pane ui-font" aria-label="帮助目录">
      <HelpNavTree v-model:topic-id="activeId" />
    </aside>
    <article class="help-article ui-font">
      <header v-if="activeNode" class="help-article-head">
        <h1>{{ activeNode.title }}</h1>
      </header>
      <div class="help-md" @click="onHelpMdClick">
        <ChatMarkdown :content="markdown" />
      </div>
    </article>
  </div>
</template>

<style scoped>
.help-shell {
  display: flex;
  min-height: 0;
  flex: 1;
  gap: 0;
  border: 1px solid var(--hairline);
  border-radius: 12px;
  overflow: hidden;
  background: var(--surface-card);
}
.help-shell.compact {
  border-radius: 0;
  border: none;
}
.help-tree-pane {
  width: 240px;
  flex-shrink: 0;
  border-right: 1px solid var(--hairline);
  padding: 12px 8px;
  overflow: auto;
  background: var(--surface-soft);
}
.help-article {
  flex: 1;
  min-width: 0;
  overflow: auto;
  padding: 20px 24px 32px;
}
.help-article-head h1 {
  margin: 0 0 16px;
  font-size: 1.35rem;
  font-weight: 600;
}
.help-md :deep(.chat-md) {
  font-size: 14px;
  line-height: 1.65;
}
.help-md :deep(h1) {
  display: none;
}
.help-md :deep(h2) {
  margin: 1.4em 0 0.6em;
  font-size: 1.1rem;
}
.help-md :deep(table) {
  border-collapse: collapse;
  width: 100%;
  margin: 12px 0;
}
.help-md :deep(th),
.help-md :deep(td) {
  border: 1px solid var(--hairline);
  padding: 6px 10px;
  text-align: left;
}
.help-md :deep(a) {
  cursor: pointer;
}
</style>
