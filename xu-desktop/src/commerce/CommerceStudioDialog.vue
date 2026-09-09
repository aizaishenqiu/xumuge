<script setup lang="ts">
import { computed } from "vue";
import { FouButton } from "foucui";
import CommercialWorkflowStudioPanel from "./CommercialWorkflowStudioPanel.vue";
import CommercialTrainingStudioPanel from "./CommercialTrainingStudioPanel.vue";
import { useCommerceStudio } from "./openStudio";
import { deactivateActiveCommercialPlugin } from "./registry";

const { openKind, closeStudio } = useCommerceStudio();

const visible = computed({
  get: () => openKind.value != null,
  set: (v: boolean) => {
    if (!v) {
      closeStudio();
      void deactivateActiveCommercialPlugin();
    }
  },
});

const title = computed(() =>
  openKind.value === "training" ? "训练工作室" : "流程工作室",
);
</script>

<template>
  <FouDialog
    v-model="visible"
    :title="title"
    width="920px"
    append-to-body
    destroy-on-close
  >
    <div class="studio-body">
      <CommercialWorkflowStudioPanel v-if="openKind === 'workflow'" />
      <CommercialTrainingStudioPanel v-else-if="openKind === 'training'" />
    </div>
    <template #footer>
      <FouButton icon="close-line" @click="visible = false">关闭</FouButton>
    </template>
  </FouDialog>
</template>

<style scoped>
.studio-body {
  height: min(70vh, 640px);
  min-height: 360px;
  overflow: hidden;
}
</style>
