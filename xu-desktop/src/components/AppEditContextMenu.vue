<script setup lang="ts">
/**
 * @file AppEditContextMenu.vue 正式包全局右键：复制/粘贴/剪切/刷新
 * @author qiuye <yjk150@qq.com>
 * @date 2026-09-04
 * @version 1.0.0
 * @category UI
 * @algo none
 */
import { onUnmounted, watch } from "vue";
import { FouButton } from "foucui";

export type AppEditCtxAction = "copy" | "paste" | "cut" | "reload";

const props = defineProps<{
  visible: boolean;
  x: number;
  y: number;
  canCopy: boolean;
  canPaste: boolean;
  canCut: boolean;
}>();

const emit = defineEmits<{
  action: [AppEditCtxAction];
  close: [];
}>();

const items: { id: AppEditCtxAction; label: string; icon: string; sepBefore?: boolean }[] = [
  { id: "cut", label: "剪切", icon: "scissors-cut-line" },
  { id: "copy", label: "复制", icon: "file-copy-line" },
  { id: "paste", label: "粘贴", icon: "clipboard-line" },
  { id: "reload", label: "刷新", icon: "refresh-line", sepBefore: true },
];

function isDisabled(id: AppEditCtxAction): boolean {
  switch (id) {
    case "copy":
      return !props.canCopy;
    case "paste":
      return !props.canPaste;
    case "cut":
      return !props.canCut;
    default:
      return false;
  }
}

function onDoc(e: MouseEvent) {
  if (!props.visible) return;
  const t = e.target as HTMLElement;
  if (t.closest(".xu-app-edit-ctx")) return;
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

function run(id: AppEditCtxAction) {
  if (isDisabled(id)) return;
  emit("action", id);
  emit("close");
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="visible"
      class="xu-app-edit-ctx ui-font"
      :style="{ left: `${x}px`, top: `${y}px` }"
      role="menu"
      @contextmenu.prevent
    >
      <template v-for="item in items" :key="item.id">
        <div v-if="item.sepBefore" class="xu-app-edit-ctx-sep" role="separator" />
        <FouButton
          class="xu-app-edit-ctx-item"
          :icon="item.icon"
          text
          native-type="button"
          :disabled="isDisabled(item.id)"
          role="menuitem"
          @click="run(item.id)"
        >
          {{ item.label }}
        </FouButton>
      </template>
    </div>
  </Teleport>
</template>

<style scoped>
.xu-app-edit-ctx {
  position: fixed;
  z-index: 40000;
  min-width: 160px;
  padding: 4px 0;
  border-radius: 8px;
  border: 1px solid var(--hairline, #e2e8f0);
  background: var(--surface-card, #fff);
  box-shadow: var(--shadow-md, 0 8px 24px rgba(15, 23, 42, 0.12));
  display: flex;
  flex-direction: column;
}
.xu-app-edit-ctx :deep(.xu-app-edit-ctx-item.fou-button) {
  justify-content: flex-start;
  width: 100%;
  border-radius: 0;
  padding: 8px 12px;
}
.xu-app-edit-ctx :deep(.xu-app-edit-ctx-item.fou-button:hover:not(:disabled)) {
  background: var(--surface-soft, #f1f5f9);
}
.xu-app-edit-ctx-sep {
  height: 1px;
  margin: 4px 0;
  background: var(--hairline, #e2e8f0);
}
</style>
