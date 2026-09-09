/**
 * Built-in commercial SPI implementations (private-full / until .xubiz loader ships).
 * Heavy UI is gated by entitlement; OSS shell only registers these stubs when imported.
 */
import type { Component } from "vue";
import type { XuCommercialPlugin } from "./types";
import { registerCommercialPlugin, getCommercialPlugin } from "./registry";
import { appendLocalTrainingSample } from "./trainingLocal";
import WorkflowStudioEditor from "./WorkflowStudioEditor.vue";
import TrainingStudioEditor from "./TrainingStudioEditor.vue";

const WORKFLOW_ID = "xu.builtin.workflow-studio";
const TRAINING_ID = "xu.builtin.training";

function workflowPlugin(): XuCommercialPlugin {
  return {
    id: WORKFLOW_ID,
    version: "0.1.0",
    entitlements: ["workflow.studio"],
    async activate() {
      /* no-op */
    },
    async deactivate() {
      /* no-op */
    },
    getWorkflowStudioPanel(): Component {
      return WorkflowStudioEditor;
    },
  };
}

function trainingPlugin(): XuCommercialPlugin {
  return {
    id: TRAINING_ID,
    version: "0.1.0",
    entitlements: ["training.ingest"],
    async activate() {
      /* no-op */
    },
    async deactivate() {
      /* no-op */
    },
    getTrainingStudioPanel(): Component {
      return TrainingStudioEditor;
    },
    async enqueueTrainingSample(row: unknown) {
      await appendLocalTrainingSample(row);
    },
  };
}

/** Idempotent register of built-in workflow + training SPI plugins. */
export function ensureBuiltinCommercePlugins(): void {
  if (!getCommercialPlugin(WORKFLOW_ID)) {
    registerCommercialPlugin(workflowPlugin());
  }
  if (!getCommercialPlugin(TRAINING_ID)) {
    registerCommercialPlugin(trainingPlugin());
  }
}
