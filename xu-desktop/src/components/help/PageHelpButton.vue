<script setup lang="ts">
import { FouButton } from "foucui";
import { openHelp } from "../../composables/useHelp";

const props = withDefaults(
  defineProps<{
    topic?: string;
    label?: string;
    size?: "small" | "default" | "large";
  }>(),
  {
    label: "帮助",
    size: "small",
  },
);

function onClick() {
  openHelp(props.topic);
}
</script>

<template>
  <FouButton
    icon="question-line"
    text
    native-type="button"
    :size="size"
    :title="label"
    :aria-label="label"
    @click="onClick"
  >
    {{ label }}
  </FouButton>
</template>
