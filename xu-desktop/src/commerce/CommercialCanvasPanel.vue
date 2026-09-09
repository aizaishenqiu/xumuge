<script setup lang="ts">
/**
 * Built-in Canvas Studio host. Base board is always available (no entitlement gate).
 * canvas.studio remains a future paid-enhancement SKU only.
 */
import CanvasStudioPanel from "../components/canvas/CanvasStudioPanel.vue";

defineProps<{
  workspace?: string | null;
}>();

const emit = defineEmits<{
  pickWorkspace: [];
}>();
</script>

<template>
  <CanvasStudioPanel :workspace="workspace" @pick-workspace="emit('pickWorkspace')" />
</template>
