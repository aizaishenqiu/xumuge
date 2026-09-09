import { ref } from "vue";

export type SimpleTrainingTab = "employee" | "mcp";

const visible = ref(false);
const tab = ref<SimpleTrainingTab>("employee");

export function useSimpleTraining() {
  return { visible, tab };
}

export function openSimpleTraining(initial: SimpleTrainingTab = "employee"): void {
  tab.value = initial;
  visible.value = true;
}

export function closeSimpleTraining(): void {
  visible.value = false;
}
