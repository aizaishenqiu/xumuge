<script setup lang="ts">
import { computed } from "vue";
import { FouButton } from "foucui";
import HelpShell from "./HelpShell.vue";
import { closeHelpPanel, goHelpPage, helpActiveTopic, helpPanelOpen } from "../../composables/useHelp";

const topicModel = computed({
  get: () => helpActiveTopic.value,
  set: (v: string) => {
    helpActiveTopic.value = v;
  },
});
</script>

<template>
  <FouDialog
    v-model="helpPanelOpen"
    title="帮助"
    width="min(920px, 96vw)"
    append-to-body
    destroy-on-close
    class="help-panel-dialog"
    @close="closeHelpPanel"
  >
    <div class="help-panel-body">
      <HelpShell v-model:topic-id="topicModel" compact />
    </div>
    <template #footer>
      <FouButton icon="book-open-line" native-type="button" @click="goHelpPage()">打开完整帮助页</FouButton>
      <FouButton type="primary" icon="check-line" native-type="button" @click="closeHelpPanel">
        关闭
      </FouButton>
    </template>
  </FouDialog>
</template>

<style scoped>
.help-panel-body {
  height: min(68vh, 640px);
  display: flex;
  flex-direction: column;
  min-height: 320px;
}
:deep(.help-panel-dialog .fou-dialog__body) {
  padding: 0 16px 8px;
}
</style>
