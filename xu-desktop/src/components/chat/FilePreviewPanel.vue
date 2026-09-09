<script setup lang="ts">
import FileEditorPanel from "./FileEditorPanel.vue";

type FileViewTab = "preview" | "edit" | "diff";

defineProps<{
  path: string | null;
  workingDir: string | null;
  collapsed?: boolean;
  hidePathTitle?: boolean;
  viewTab?: FileViewTab;
}>();

defineEmits<{
  close: [];
  "add-to-chat": [text: string];
  collapse: [];
  "dirty-change": [dirty: boolean];
  "update:viewTab": [tab: FileViewTab];
}>();
</script>

<template>
  <FileEditorPanel
    variant="drawer"
    :path="path"
    :working-dir="workingDir"
    :collapsed="collapsed"
    :hide-path-title="hidePathTitle"
    :view-tab="viewTab"
    @close="$emit('close')"
    @add-to-chat="$emit('add-to-chat', $event)"
    @collapse="$emit('collapse')"
    @dirty-change="$emit('dirty-change', $event)"
    @update:view-tab="$emit('update:viewTab', $event)"
  />
</template>
