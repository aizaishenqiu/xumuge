/**
 * Kickoff model keys: "" | "local:{model}" | "remote:{presetId}"
 * Shared by office strip + start-project dialog.
 */
import type { Employee } from "../utils/employees";
import {
  listLocalModels,
  loadOpsBrains,
  OLLAMA_DEFAULT_BASE,
  saveOpsBrains,
  type BrainSlotConfig,
  type OpsBrains,
} from "../utils/opsBrains";
import {
  loadGlobalModelProfiles,
  type RemoteModelPreset,
} from "../utils/globalModelProfiles";

export type KickoffModelOptions = {
  localModels: string[];
  localBase: string;
  remotePresets: RemoteModelPreset[];
};

export async function loadKickoffModelOptions(): Promise<KickoffModelOptions> {
  const profiles = await loadGlobalModelProfiles();
  const localBase = profiles.local.baseUrl || OLLAMA_DEFAULT_BASE;
  const remotePresets = profiles.remotePresets.filter((p) => p.textModel.trim());
  let localModels: string[] = [];
  try {
    localModels = await listLocalModels(localBase);
  } catch {
    localModels = [];
  }
  if (!localModels.length && profiles.local.textModel) {
    localModels = [profiles.local.textModel];
  }
  return { localModels, localBase, remotePresets };
}

export function kickoffModelKeyLabel(
  key: string,
  opts: KickoffModelOptions,
): string {
  if (!key) return "";
  if (key.startsWith("local:")) return `本地 · ${key.slice(6)}`;
  if (key.startsWith("remote:")) {
    const id = key.slice(7);
    const p = opts.remotePresets.find((x) => x.id === id);
    return p ? `远程 · ${p.label} · ${p.textModel}` : "";
  }
  return "";
}

/** Prefer current ops-brain remote preset / local model as default select value. */
export function defaultKickoffModelKey(
  slot: BrainSlotConfig,
  opts: KickoffModelOptions,
): string {
  if (slot.source === "local" && slot.model?.trim()) {
    return `local:${slot.model.trim()}`;
  }
  const pid = (slot.remotePresetId || "").trim();
  if (pid && opts.remotePresets.some((p) => p.id === pid)) {
    return `remote:${pid}`;
  }
  const hit = opts.remotePresets.find(
    (p) => p.textModel === slot.model && (!slot.baseUrl || p.baseUrl === slot.baseUrl),
  );
  if (hit) return `remote:${hit.id}`;
  if (slot.source === "local" && opts.localModels[0]) {
    return `local:${opts.localModels[0]}`;
  }
  if (opts.remotePresets[0]) return `remote:${opts.remotePresets[0].id}`;
  if (opts.localModels[0]) return `local:${opts.localModels[0]}`;
  return "";
}

export function applyKickoffModelKeyToEmployee(
  emp: Employee,
  key: string,
  opts: KickoffModelOptions,
): Employee {
  if (!key) return emp;
  if (key.startsWith("local:")) {
    const model = key.slice("local:".length);
    return {
      ...emp,
      aiModel: model,
      aiBaseUrl: opts.localBase,
      apiSource: "local",
      remotePresetId: "",
    };
  }
  if (key.startsWith("remote:")) {
    const preset = opts.remotePresets.find((p) => p.id === key.slice("remote:".length));
    if (!preset) return emp;
    return {
      ...emp,
      aiModel: preset.textModel,
      aiBaseUrl: preset.baseUrl,
      aiVisionModel: preset.visionModel,
      apiSource: "remote",
      remotePresetId: preset.id,
    };
  }
  return emp;
}

function patchBrainSlotFromKey(
  slot: BrainSlotConfig,
  key: string,
  opts: KickoffModelOptions,
): BrainSlotConfig {
  if (!key) return slot;
  if (key.startsWith("local:")) {
    const model = key.slice("local:".length);
    return {
      ...slot,
      source: "local",
      model,
      baseUrl: opts.localBase,
      remotePresetId: "",
      provider: "ollama",
      apiKeyEnv: "",
    };
  }
  if (key.startsWith("remote:")) {
    const preset = opts.remotePresets.find((p) => p.id === key.slice("remote:".length));
    if (!preset) return slot;
    return {
      ...slot,
      source: "remote",
      model: preset.textModel,
      baseUrl: preset.baseUrl,
      apiKeyEnv: preset.apiKeyEnv,
      provider: preset.provider || "openai",
      remotePresetId: preset.id,
      visionModel: preset.visionModel || slot.visionModel,
      remoteSnapshot: {
        baseUrl: preset.baseUrl,
        model: preset.textModel,
        apiKeyEnv: preset.apiKeyEnv,
        provider: preset.provider || "openai",
      },
    };
  }
  return slot;
}

/** Persist command/code (and work←command) so 智脑 / 写码分工生效. */
export async function persistKickoffModelsToOpsBrains(
  commandKey: string,
  codeKey: string,
  opts: KickoffModelOptions,
): Promise<OpsBrains> {
  const brains = await loadOpsBrains();
  const next: OpsBrains = {
    command: patchBrainSlotFromKey(brains.command, commandKey, opts),
    work: patchBrainSlotFromKey(brains.work, commandKey || codeKey, opts),
    code: patchBrainSlotFromKey(brains.code, codeKey || commandKey, opts),
  };
  await saveOpsBrains(next);
  return next;
}

export function mapEmployeeForKickoffModels(
  emp: Employee,
  commandKey: string,
  codeKey: string,
  opts: KickoffModelOptions,
  complexity?: { level?: "low" | "high" },
): Employee {
  let slot = emp.brainSlot || "work";
  if (complexity?.level === "high" && slot !== "code") {
    slot = "command";
  }
  const key =
    slot === "code"
      ? codeKey || commandKey
      : commandKey || codeKey;
  const patched = applyKickoffModelKeyToEmployee(emp, key, opts);
  return slot === emp.brainSlot ? patched : { ...patched, brainSlot: slot as Employee["brainSlot"] };
}
