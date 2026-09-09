/**
 * Commercial plugin SPI — core app defines contracts only; heavy UI lives in .xubiz.
 */

import type { Component } from "vue";

/** Known commercial SKUs; string allows future entitlements. */
export type XuCommercialEntitlement =
  | "canvas.studio"
  | "training.ingest"
  | "workflow.studio"
  | (string & {});

export interface CommercialHostContext {
  hasEntitlement(id: XuCommercialEntitlement): Promise<boolean>;
  xuHome: string;
  getActiveGeneratePath(): string | null;
  getBriefSummary(projectId: string): Promise<Record<string, unknown> | null>;
}

export interface XuCommercialPlugin {
  id: string;
  version: string;
  entitlements: XuCommercialEntitlement[];
  activate(ctx: CommercialHostContext): Promise<void>;
  deactivate(): Promise<void>;
  /** Dynamic Vue panel; only call after activate + canvas.studio. */
  getCanvasPanel?(): Component;
  /** Industry wave swimlane editor; after activate + workflow.studio. */
  getWorkflowStudioPanel?(): Component;
  /** Training sample browser / curriculum; after activate + training.ingest. */
  getTrainingStudioPanel?(): Component;
  enqueueTrainingSample?(row: unknown): Promise<void>;
}

export type XuLicenseEntitlements = {
  machineId: string;
  entitlements: string[];
};
