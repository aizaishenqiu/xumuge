/**
 * Open Workflow / Training studio dialogs from Settings / Office (gray host panels).
 */
import { ref } from "vue";
import { deactivateActiveCommercialPlugin } from "./registry";

export type CommerceStudioKind = "workflow" | "training" | null;

const openKind = ref<CommerceStudioKind>(null);

async function switchKind(next: CommerceStudioKind) {
  if (openKind.value && openKind.value !== next) {
    try {
      await deactivateActiveCommercialPlugin();
    } catch {
      /* ignore */
    }
  }
  openKind.value = next;
}

export function useCommerceStudio() {
  return {
    openKind,
    openWorkflowStudio() {
      void switchKind("workflow");
    },
    openTrainingStudio() {
      void switchKind("training");
    },
    closeStudio() {
      openKind.value = null;
    },
  };
}

export function openWorkflowStudio(): void {
  void switchKind("workflow");
}

export function openTrainingStudio(): void {
  void switchKind("training");
}

export function closeCommerceStudio(): void {
  openKind.value = null;
}
