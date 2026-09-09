<script setup lang="ts">
import { onUnmounted, watch } from "vue";

export type ComposerCtxAction = "copy" | "paste" | "cut" | "undo" | "redo" | "selectAll";

const props = defineProps<{
  visible: boolean;
  x: number;
  y: number;
  canCopy: boolean;
  canPaste: boolean;
  canCut: boolean;
  canUndo: boolean;
  canRedo: boolean;
}>();

const emit = defineEmits<{
  action: [ComposerCtxAction];
  close: [];
}>();

const items: { id: ComposerCtxAction; label: string; icon: string; sepBefore?: boolean }[] = [
  { id: "undo", label: "恢复", icon: "arrow-go-back-line" },
  { id: "redo", label: "重做", icon: "arrow-go-forward-line", sepBefore: true },
  { id: "cut", label: "剪切", icon: "scissors-cut-line" },
  { id: "copy", label: "复制", icon: "file-copy-line" },
  { id: "paste", label: "粘贴", icon: "clipboard-line" },
  { id: "selectAll", label: "全选", icon: "select-all-line", sepBefore: true },
];

function isDisabled(id: ComposerCtxAction): boolean {
  switch (id) {
    case "copy":
      return !props.canCopy;
    case "paste":
      return !props.canPaste;
    case "cut":
      return !props.canCut;
    case "undo":
      return !props.canUndo;
    case "redo":
      return !props.canRedo;
    default:
      return false;
  }
}

function onDoc(e: MouseEvent) {
  if (!props.visible) return;
  const t = e.target as HTMLElement;
  if (t.closest(".qiu-composer-ctx-menu")) return;
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

function run(id: ComposerCtxAction) {
  if (isDisabled(id)) return;
  emit("action", id);
  emit("close");
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="visible"
      class="qiu-composer-ctx-menu ui-font"
      :style="{ left: `${x}px`, top: `${y}px` }"
      role="menu"
      @contextmenu.prevent
    >
      <template v-for="item in items" :key="item.id">
        <div v-if="item.sepBefore" class="qiu-composer-ctx-sep" role="separator" />
        <button
          type="button"
          role="menuitem"
          :disabled="isDisabled(item.id)"
          @click="run(item.id)"
        >
          <FouIcon :icon="item.icon" size="14" />
          {{ item.label }}
        </button>
      </template>
    </div>
  </Teleport>
</template>
