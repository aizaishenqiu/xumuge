/**
 * fou-brains: resolve LLM endpoints from xu.db OpsBrains + employee overrides.
 * NEVER calls set_hermes_model / writes config.yaml.
 */
import {
  defaultOpsBrains,
  loadOpsBrains,
  saveOpsBrains,
  probeBrain,
  resolveEndpoint,
  type BrainSlotConfig,
  type OpsBrains,
} from "../utils/opsBrains";
import type { BrainSlot, EmployeeEndpoint } from "./types";

export type { BrainSlotConfig, OpsBrains };
export { defaultOpsBrains, loadOpsBrains, saveOpsBrains, probeBrain, resolveEndpoint };

/**
 * Resolve the endpoint an employee should use for 虚募阁 Native Agent.
 * Does not mutate any Hermes config.
 */
export async function resolveEmployeeEndpoint(
  emp: {
    id?: string;
    brainSlot: BrainSlot;
    aiModel?: string;
    aiBaseUrl?: string;
    aiVisionModel?: string;
    apiSource?: string;
    remotePresetId?: string;
  },
  opts?: { hasImage?: boolean; preferRemote?: boolean },
): Promise<EmployeeEndpoint> {
  const preferRemote = opts?.preferRemote ?? emp.brainSlot === "code";
  const ep = await resolveEndpoint({
    slot: emp.brainSlot,
    emp,
    hasImage: opts?.hasImage,
    preferRemote,
  });
  return {
    provider: ep.provider,
    model: ep.model,
    baseUrl: ep.baseUrl,
    apiKeyEnv: ep.apiKeyEnv,
    brainSlot: emp.brainSlot,
  };
}

/**
 * @deprecated Hermes path — do not use in new employee code.
 * Kept only so legacy ChatPage can migrate gradually; prefer resolveEmployeeEndpoint.
 */
export async function applyEmployeeBrainLegacyYaml(emp: {
  brainSlot: BrainSlot;
  aiModel?: string;
  aiBaseUrl?: string;
  apiSource?: string;
}): Promise<void> {
  void emp;
}
