<script setup lang="ts">
/**
 * @file 帮助左侧目录树：分类展开 + 主题切换
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-30
 * @updated 2026-09-02
 * @version 1.1.1
 * @category Layout
 * @algo expanded-keys-array
 */
import { ref, watch } from "vue";
import { FouButton } from "foucui";
import {
  HELP_TREE,
  parentHelpTopicId,
  resolveHelpTopicId,
  type HelpTreeNode,
} from "../../help/helpManifest";

const activeId = defineModel<string>("topicId", { default: "" });

const expandedKeys = ref<string[]>([]);

function isExpanded(id: string): boolean {
  return expandedKeys.value.includes(id);
}

function toggleCategory(id: string) {
  if (expandedKeys.value.includes(id)) {
    expandedKeys.value = expandedKeys.value.filter((key) => key !== id);
  } else {
    expandedKeys.value = [...expandedKeys.value, id];
  }
}

function ensureExpanded(id: string) {
  if (!expandedKeys.value.includes(id)) {
    expandedKeys.value = [...expandedKeys.value, id];
  }
}

function onCategoryClick(cat: HelpTreeNode, event: MouseEvent) {
  event.stopPropagation();
  event.preventDefault();
  if (!cat.children?.length) return;
  toggleCategory(cat.id);
}

function onLeafClick(id: string, event: MouseEvent) {
  event.stopPropagation();
  const resolved = resolveHelpTopicId(id);
  activeId.value = resolved;
  const parent = parentHelpTopicId(resolved);
  if (parent) ensureExpanded(parent);
}

function syncExpandedForTopic(id: string) {
  const resolved = resolveHelpTopicId(id);
  const parent = parentHelpTopicId(resolved);
  if (parent) ensureExpanded(parent);
}

watch(
  activeId,
  (id) => {
    syncExpandedForTopic(id || "");
  },
  { immediate: true },
);
</script>

<template>
  <ul class="help-nav ui-font">
    <li v-for="cat in HELP_TREE" :key="cat.id" class="help-nav-group">
      <FouButton
        class="help-nav-cat"
        :class="{ expanded: isExpanded(cat.id) }"
        :icon="isExpanded(cat.id) ? 'arrow-down-s-line' : 'arrow-right-s-line'"
        text
        native-type="button"
        :aria-expanded="isExpanded(cat.id)"
        @click="onCategoryClick(cat, $event)"
      >
        {{ cat.title }}
      </FouButton>
      <ul v-show="isExpanded(cat.id) && cat.children?.length" class="help-nav-children">
        <li v-for="item in cat.children" :key="item.id" class="help-nav-leaf-row">
          <FouButton
            class="help-nav-leaf"
            :class="{ active: resolveHelpTopicId(activeId) === item.id }"
            icon="file-text-line"
            text
            native-type="button"
            @click="onLeafClick(item.id, $event)"
          >
            {{ item.title }}
          </FouButton>
        </li>
      </ul>
    </li>
  </ul>
</template>

<style scoped>
.help-nav {
  list-style: none;
  margin: 0;
  padding: 0;
  position: relative;
}
.help-nav-group {
  position: relative;
  isolation: isolate;
}
.help-nav-group + .help-nav-group {
  margin-top: 2px;
}
.help-nav-cat,
.help-nav-leaf {
  width: 100%;
  text-align: left;
}
.help-nav :deep(.help-nav-cat.fou-button),
.help-nav :deep(.help-nav-leaf.fou-button) {
  position: relative;
  z-index: 1;
  display: inline-flex;
  width: 100%;
  min-height: auto;
  margin: 0;
  padding: 0;
  border: none;
  border-radius: 8px;
  box-shadow: none;
  justify-content: flex-start !important;
  align-items: center;
  text-align: left;
  cursor: pointer;
  color: var(--ink);
  font-size: 13px;
  line-height: 1.35;
  background: transparent;
  gap: 6px;
  pointer-events: auto;
}
.help-nav :deep(.fou-button__icon) {
  margin: 0;
  flex-shrink: 0;
  pointer-events: none;
}
.help-nav :deep(.fou-button__label) {
  flex: 1 1 auto;
  text-align: left !important;
  justify-content: flex-start !important;
  pointer-events: none;
}
.help-nav-cat {
  font-weight: 600;
}
.help-nav :deep(.help-nav-cat.fou-button) {
  padding: 8px;
  z-index: 2;
}
.help-nav :deep(.help-nav-cat.fou-button:hover) {
  background: color-mix(in srgb, var(--primary) 8%, var(--surface-card));
}
.help-nav-children {
  list-style: none;
  margin: 0;
  padding: 0 0 4px 18px;
  position: relative;
  z-index: 1;
  overflow: hidden;
}
.help-nav-leaf-row {
  position: relative;
  z-index: 1;
}
.help-nav :deep(.help-nav-leaf.fou-button) {
  padding: 7px 10px;
  color: var(--muted);
}
.help-nav :deep(.help-nav-leaf.fou-button:hover) {
  color: var(--ink);
  background: color-mix(in srgb, var(--primary) 8%, var(--surface-card));
}
.help-nav :deep(.help-nav-leaf.active.fou-button) {
  color: var(--primary);
  background: color-mix(in srgb, var(--primary) 12%, var(--surface-card));
  font-weight: 600;
}
</style>
