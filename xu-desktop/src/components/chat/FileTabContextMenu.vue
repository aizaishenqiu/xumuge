<script setup lang="ts">
/**
 * @file 编辑器标签页右键菜单（Teleport）
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-31
 * @updated 2026-09-05
 * @version 1.1.0
 * @category UI
 * @algo outside-click-ignore-panel
 */
import { FouButton } from "foucui";
import { onUnmounted, watch } from "vue";
import type { OpenFileTab } from "../../composables/useOpenFileTabs";

const props = defineProps<{
  visible: boolean;
  x: number;
  y: number;
  tab: OpenFileTab | null;
}>();

const emit = defineEmits<{
  close: [];
  "close-tab": [];
  "close-others": [];
  "close-right": [];
  "close-saved": [];
  "close-all": [];
  "copy-path": [];
  "copy-rel-path": [];
  preview: [];
  reveal: [];
  "reveal-in-tree": [];
  "keep-open": [];
  pin: [];
  "find-refs": [];
}>();

function onDoc(e: MouseEvent) {
  if (!props.visible) return;
  const t = e.target as HTMLElement | null;
  if (t?.closest(".ftab-ctx")) return;
  emit("close");
}

function onKey(e: KeyboardEvent) {
  if (!props.visible) return;
  if (e.key === "Escape") emit("close");
}

watch(
  () => props.visible,
  (open) => {
    if (open) {
      document.addEventListener("mousedown", onDoc, true);
      document.addEventListener("keydown", onKey, true);
    } else {
      document.removeEventListener("mousedown", onDoc, true);
      document.removeEventListener("keydown", onKey, true);
    }
  },
  { immediate: true },
);

onUnmounted(() => {
  document.removeEventListener("mousedown", onDoc, true);
  document.removeEventListener("keydown", onKey, true);
});
</script>

<template>
  <Teleport to="body">
    <div
      v-if="visible && tab"
      class="ftab-ctx fou-menu-panel ui-font"
      :style="{ top: `${y}px`, left: `${x}px` }"
      @click.stop
      @contextmenu.prevent
    >
      <FouButton class="ftab-ctx-item" icon="close-line" text native-type="button" @click="emit('close-tab')">
        关闭
      </FouButton>
      <FouButton class="ftab-ctx-item" icon="close-circle-line" text native-type="button" @click="emit('close-others')">
        关闭其他
      </FouButton>
      <FouButton class="ftab-ctx-item" icon="arrow-right-line" text native-type="button" @click="emit('close-right')">
        关闭右侧标签页
      </FouButton>
      <FouButton class="ftab-ctx-item" icon="save-line" text native-type="button" @click="emit('close-saved')">
        关闭已保存
      </FouButton>
      <FouButton class="ftab-ctx-item" icon="delete-bin-line" text native-type="button" @click="emit('close-all')">
        全部关闭
      </FouButton>

      <div class="ftab-ctx-sep" />

      <FouButton class="ftab-ctx-item" icon="links-line" text native-type="button" @click="emit('copy-path')">
        复制路径
      </FouButton>
      <FouButton class="ftab-ctx-item" icon="link-m" text native-type="button" @click="emit('copy-rel-path')">
        复制相对路径
      </FouButton>

      <div class="ftab-ctx-sep" />

      <FouButton class="ftab-ctx-item" icon="eye-line" text native-type="button" @click="emit('preview')">
        打开预览
      </FouButton>

      <div class="ftab-ctx-sep" />

      <FouButton class="ftab-ctx-item" icon="external-link-line" text native-type="button" @click="emit('reveal')">
        在资源管理器中显示
      </FouButton>
      <FouButton class="ftab-ctx-item" icon="folder-open-line" text native-type="button" @click="emit('reveal-in-tree')">
        在文件树中显示
      </FouButton>

      <div class="ftab-ctx-sep" />

      <FouButton
        class="ftab-ctx-item"
        icon="pushpin-line"
        text
        native-type="button"
        :disabled="!tab.preview"
        @click="emit('keep-open')"
      >
        保持打开状态
      </FouButton>
      <FouButton
        class="ftab-ctx-item"
        :icon="tab.pinned ? 'pushpin-2-fill' : 'pushpin-2-line'"
        text
        native-type="button"
        @click="emit('pin')"
      >
        {{ tab.pinned ? "取消固定" : "固定" }}
      </FouButton>

      <div class="ftab-ctx-sep" />

      <FouButton class="ftab-ctx-item" icon="layout-row-line" text native-type="button" disabled title="即将支持">
        向上拆分
      </FouButton>
      <FouButton class="ftab-ctx-item" icon="layout-row-line" text native-type="button" disabled title="即将支持">
        向下拆分
      </FouButton>
      <FouButton class="ftab-ctx-item" icon="layout-column-line" text native-type="button" disabled title="即将支持">
        向左拆分
      </FouButton>
      <FouButton class="ftab-ctx-item" icon="layout-column-line" text native-type="button" disabled title="即将支持">
        向右拆分
      </FouButton>

      <div class="ftab-ctx-sep" />

      <FouButton class="ftab-ctx-item" icon="window-line" text native-type="button" disabled title="即将支持">
        移动到新窗口
      </FouButton>
      <FouButton class="ftab-ctx-item" icon="file-copy-line" text native-type="button" disabled title="即将支持">
        复制到新窗口
      </FouButton>

      <div class="ftab-ctx-sep" />

      <FouButton class="ftab-ctx-item" icon="search-line" text native-type="button" @click="emit('find-refs')">
        查找文件引用
      </FouButton>
    </div>
  </Teleport>
</template>

<style scoped>
.ftab-ctx {
  position: fixed;
  z-index: 10001;
  min-width: 220px;
  max-height: min(80vh, 640px);
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  padding: 4px 0;
  border-radius: 8px;
  border: 1px solid var(--hairline);
  background: var(--surface-card);
  box-shadow: var(--shadow-md);
}
.ftab-ctx :deep(.ftab-ctx-item.fou-button:hover:not(:disabled)) {
  background: var(--surface-soft, #f1f5f9);
}
.ftab-ctx :deep(.ftab-ctx-item.fou-button:disabled) {
  opacity: 0.45;
  cursor: not-allowed;
}
.ftab-ctx-sep {
  height: 1px;
  margin: 4px 0;
  background: var(--hairline);
}
</style>
