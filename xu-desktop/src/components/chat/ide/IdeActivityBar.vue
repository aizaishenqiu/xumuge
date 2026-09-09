<script setup lang="ts">
import { useRouter } from "vue-router";
import { FouButton } from "foucui";
import { IDE_VIEW_ITEMS, type IdeSideView } from "../../../composables/useIdeSideView";
import { canvasPanelLabel } from "../../../utils/v1ProductSurface";

defineProps<{
  active: IdeSideView;
}>();

const emit = defineEmits<{
  select: [view: IdeSideView];
}>();

const router = useRouter();

function openCanvasPage() {
  void router.push("/canvas");
}
</script>

<template>
  <nav class="ide-activity-bar ui-font" aria-label="IDE 活动栏">
    <FouButton
      v-for="item in IDE_VIEW_ITEMS"
      :key="item.id"
      :icon="item.icon"
      size="small"
      text
      native-type="button"
      class="activity-btn"
      :class="{ active: active === item.id }"
      :title="item.title"
      :aria-label="item.title"
      @click="emit('select', item.id)"
    />
    <span class="activity-spacer" />
    <FouButton
      icon="artboard-2-line"
      size="small"
      text
      native-type="button"
      class="activity-btn"
      :title="canvasPanelLabel() + '（独立页面）'"
      :aria-label="canvasPanelLabel()"
      @click="openCanvasPage"
    />
  </nav>
</template>

<style scoped>
.ide-activity-bar {
  width: 48px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 8px 4px;
  border-right: 1px solid var(--hairline);
  background: var(--surface-soft);
}
.activity-spacer {
  flex: 1;
}
.activity-btn {
  width: 36px;
  height: 36px;
  border-radius: 8px;
}
.activity-btn.active {
  background: var(--primary-glow);
  color: var(--primary);
}
</style>
