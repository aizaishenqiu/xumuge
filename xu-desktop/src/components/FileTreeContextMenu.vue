<script setup lang="ts">
/**
 * @file 文件树右键菜单（Teleport）
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-31
 * @updated 2026-09-05
 * @version 1.1.0
 * @category UI
 * @algo outside-click-ignore-panel
 */
import { FouButton } from "foucui";
import { onUnmounted, watch } from "vue";

export type FileTreeMenuEntry = {
  name: string;
  path: string;
  is_dir: boolean;
};

const props = defineProps<{
  visible: boolean;
  x: number;
  y: number;
  entry: FileTreeMenuEntry | null;
  canPaste: boolean;
}>();

const emit = defineEmits<{
  close: [];
  "new-file": [];
  "new-folder": [];
  reveal: [];
  terminal: [];
  cut: [];
  copy: [];
  paste: [];
  "copy-path": [];
  "copy-rel-path": [];
  rename: [];
  delete: [];
}>();

function onDoc(e: MouseEvent) {
  if (!props.visible) return;
  const t = e.target as HTMLElement | null;
  if (t?.closest(".ft-ctx")) return;
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
      v-if="visible"
      class="ft-ctx fou-menu-panel ui-font"
      :style="{ top: `${y}px`, left: `${x}px` }"
      @click.stop
      @contextmenu.prevent
    >
      <FouButton class="ft-ctx-item" icon="file-add-line" text native-type="button" @click="emit('new-file')">
        新建文件
      </FouButton>
      <FouButton class="ft-ctx-item" icon="folder-add-line" text native-type="button" @click="emit('new-folder')">
        新建文件夹
      </FouButton>

      <template v-if="entry">
        <div class="ft-ctx-sep" />
        <FouButton class="ft-ctx-item" icon="external-link-line" text native-type="button" @click="emit('reveal')">
          在资源管理器中显示
        </FouButton>
        <FouButton class="ft-ctx-item" icon="terminal-box-line" text native-type="button" @click="emit('terminal')">
          在集成终端中打开
        </FouButton>
        <div class="ft-ctx-sep" />
        <FouButton class="ft-ctx-item" icon="scissors-cut-line" text native-type="button" @click="emit('cut')">
          剪切
        </FouButton>
        <FouButton class="ft-ctx-item" icon="file-copy-line" text native-type="button" @click="emit('copy')">
          复制
        </FouButton>
        <FouButton
          v-if="canPaste"
          class="ft-ctx-item"
          icon="clipboard-line"
          text
          native-type="button"
          @click="emit('paste')"
        >
          粘贴
        </FouButton>
        <div class="ft-ctx-sep" />
        <FouButton class="ft-ctx-item" icon="links-line" text native-type="button" @click="emit('copy-path')">
          复制路径
        </FouButton>
        <FouButton class="ft-ctx-item" icon="link-m" text native-type="button" @click="emit('copy-rel-path')">
          复制相对路径
        </FouButton>
        <FouButton class="ft-ctx-item" icon="edit-line" text native-type="button" @click="emit('rename')">
          重命名
        </FouButton>
        <FouButton
          class="ft-ctx-item danger"
          type="danger"
          icon="delete-bin-line"
          text
          native-type="button"
          @click="emit('delete')"
        >
          删除
        </FouButton>
      </template>

      <template v-else-if="canPaste">
        <div class="ft-ctx-sep" />
        <FouButton class="ft-ctx-item" icon="clipboard-line" text native-type="button" @click="emit('paste')">
          粘贴
        </FouButton>
      </template>
    </div>
  </Teleport>
</template>

<style scoped>
.ft-ctx {
  position: fixed;
  z-index: 10000;
  min-width: 200px;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  padding: 4px 0;
  border-radius: 8px;
  border: 1px solid var(--hairline);
  background: var(--surface-card);
  box-shadow: var(--shadow-md);
}
.ft-ctx :deep(.ft-ctx-item.fou-button:hover:not(:disabled)) {
  background: var(--surface-soft, #f1f5f9);
}
.ft-ctx :deep(.ft-ctx-item.danger.fou-button) {
  color: var(--error, #dc2626);
}
.ft-ctx-sep {
  height: 1px;
  margin: 4px 0;
  background: var(--hairline);
}
</style>
