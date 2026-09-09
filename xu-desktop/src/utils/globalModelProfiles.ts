import { invoke } from "@tauri-apps/api/core";
import { findPresetByModel, listModelPresets, type ModelPreset } from "./modelCatalog";
import type { ApiFormat } from "./modelCatalog";
import { loadOpsBrains, OLLAMA_DEFAULT_BASE, type BrainSlotConfig } from "./opsBrains";

export const GLOBAL_MODEL_PROFILES_KEY = "xu.global_model_profiles";

/** Fired after remote/local presets are saved (Settings → 模型). */
export const GLOBAL_MODEL_PROFILES_CHANGED = "xu-global-model-profiles-changed";

export interface LocalModelProfile {
  textModel: string;
  visionModel: string;
  baseUrl: string;
  /** Shown in chat instead of "虚募阁" */
  displayName?: string;
}

export interface RemoteModelPreset {
  id: string;
  label: string;
  textModel: string;
  visionModel: string;
  baseUrl: string;
  apiKeyEnv: string;
  provider: string;
  apiFormat?: ApiFormat;
  lastProbeOk?: boolean;
  isDefault?: boolean;
}

export interface GlobalModelProfiles {
  version: 1;
  defaultSource: "local" | "remote";
  /** When true, all LLM calls are forced to local Ollama; remote presets disabled. */
  localOnly?: boolean;
  local: LocalModelProfile;
  remotePresets: RemoteModelPreset[];
}

function newId(): string {
  return crypto.randomUUID();
}

function emptyLocal(): LocalModelProfile {
  return {
    textModel: "",
    visionModel: "",
    baseUrl: OLLAMA_DEFAULT_BASE,
    displayName: "",
  };
}

function presetFromCatalog(p: ModelPreset, label?: string): RemoteModelPreset {
  return {
    id: newId(),
    label: label || p.label,
    textModel: p.model,
    visionModel: p.model,
    baseUrl: p.baseUrl,
    apiKeyEnv: p.apiKeyEnv,
    provider: p.provider,
    apiFormat: p.apiFormat ?? (p.provider === "anthropic" ? "anthropic" : "openai"),
    isDefault: true,
  };
}

function slotToRemotePreset(slot: BrainSlotConfig, label: string): RemoteModelPreset {
  const preset = slot.model ? findPresetByModel(slot.model) : undefined;
  return {
    id: newId(),
    label,
    textModel: slot.model,
    visionModel: slot.visionModel.trim() || slot.model,
    baseUrl: slot.baseUrl || preset?.baseUrl || "",
    apiKeyEnv: slot.apiKeyEnv || preset?.apiKeyEnv || "",
    provider: slot.provider || preset?.provider || "custom",
    isDefault: true,
  };
}

export function defaultGlobalModelProfiles(): GlobalModelProfiles {
  const cloud = listModelPresets().find((p) => !p.custom && p.model);
  return {
    version: 1,
    defaultSource: "remote",
    local: emptyLocal(),
    remotePresets: cloud ? [presetFromCatalog(cloud)] : [],
  };
}

function normalizeRemotePreset(raw: Partial<RemoteModelPreset>): RemoteModelPreset {
  return {
    id: (raw.id || newId()).trim(),
    label: (raw.label || "远程预设").trim() || "远程预设",
    textModel: (raw.textModel || "").trim(),
    visionModel: (raw.visionModel || "").trim(),
    baseUrl: (raw.baseUrl || "").trim(),
    apiKeyEnv: (raw.apiKeyEnv || "").trim(),
    provider: (raw.provider || "custom").trim() || "custom",
    apiFormat: raw.apiFormat === "anthropic" || raw.apiFormat === "ollama" ? raw.apiFormat : "openai",
    lastProbeOk: raw.lastProbeOk === true,
    isDefault: raw.isDefault === true,
  };
}

export function normalizeGlobalModelProfiles(raw: Partial<GlobalModelProfiles> | null): GlobalModelProfiles {
  const base = defaultGlobalModelProfiles();
  if (!raw) return base;
  const presets = Array.isArray(raw.remotePresets)
    ? raw.remotePresets.map((p) => normalizeRemotePreset(p))
    : base.remotePresets;
  if (!presets.length) {
    presets.push(...base.remotePresets);
  }
  let defaultMarked = false;
  for (const p of presets) {
    if (p.isDefault) {
      if (defaultMarked) p.isDefault = false;
      else defaultMarked = true;
    }
  }
  if (!defaultMarked && presets[0]) presets[0].isDefault = true;

  const local = raw.local
    ? {
        textModel: (raw.local.textModel || "").trim(),
        visionModel: (raw.local.visionModel || "").trim(),
        baseUrl: (raw.local.baseUrl || OLLAMA_DEFAULT_BASE).trim() || OLLAMA_DEFAULT_BASE,
        displayName: (raw.local.displayName || "").trim(),
      }
    : base.local;

  return {
    version: 1,
    defaultSource: raw.defaultSource === "local" ? "local" : "remote",
    localOnly: raw.localOnly === true,
    local,
    remotePresets: presets,
  };
}

async function migrateFromOpsBrains(): Promise<GlobalModelProfiles> {
  const brains = await loadOpsBrains();
  const work = brains.work;
  const local: LocalModelProfile = {
    textModel: work.source === "local" ? work.model : brains.command.source === "local" ? brains.command.model : "",
    visionModel:
      work.source === "local"
        ? work.visionModel
        : brains.command.source === "local"
          ? brains.command.visionModel
          : "",
    baseUrl: OLLAMA_DEFAULT_BASE,
    displayName:
      (work.source === "local" ? work.displayName : brains.command.displayName)?.trim() || "",
  };
  const remoteSlot =
    work.source === "remote" && (work.model || work.baseUrl)
      ? work
      : brains.command.source === "remote" && (brains.command.model || brains.command.baseUrl)
        ? brains.command
        : work;
  const remotePresets: RemoteModelPreset[] = [];
  if (remoteSlot.model || remoteSlot.baseUrl) {
    const label = (remoteSlot.displayName ?? "").trim() || "默认远程";
    remotePresets.push(slotToRemotePreset(remoteSlot, label));
  } else {
    const cloud = listModelPresets().find((p) => !p.custom && p.model);
    if (cloud) remotePresets.push(presetFromCatalog(cloud));
  }
  const defaultSource: "local" | "remote" =
    work.source === "local" || brains.command.source === "local" ? "local" : "remote";
  return normalizeGlobalModelProfiles({
    version: 1,
    defaultSource,
    local,
    remotePresets,
  });
}

let cachedProfiles: GlobalModelProfiles | null = null;

export async function loadGlobalModelProfiles(force = false): Promise<GlobalModelProfiles> {
  if (cachedProfiles && !force) return cachedProfiles;
  try {
    const raw = await invoke<string | null>("xu_get_setting", { key: GLOBAL_MODEL_PROFILES_KEY });
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<GlobalModelProfiles>;
      cachedProfiles = normalizeGlobalModelProfiles(parsed);
      return cachedProfiles;
    }
  } catch {
    /* migrate */
  }
  const migrated = await migrateFromOpsBrains();
  cachedProfiles = migrated;
  try {
    await saveGlobalModelProfiles(migrated);
  } catch {
    /* ignore */
  }
  return migrated;
}

export async function saveGlobalModelProfiles(profiles: GlobalModelProfiles): Promise<void> {
  const normalized = normalizeGlobalModelProfiles(profiles);
  cachedProfiles = normalized;
  await invoke("xu_set_setting", {
    key: GLOBAL_MODEL_PROFILES_KEY,
    value: JSON.stringify(normalized),
  });
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(GLOBAL_MODEL_PROFILES_CHANGED));
  }
}

export function getDefaultRemotePreset(profiles: GlobalModelProfiles): RemoteModelPreset | null {
  return profiles.remotePresets.find((p) => p.isDefault) || profiles.remotePresets[0] || null;
}

export function getRemotePresetById(
  profiles: GlobalModelProfiles,
  id?: string | null,
): RemoteModelPreset | null {
  const trimmed = (id ?? "").trim();
  if (!trimmed) return getDefaultRemotePreset(profiles);
  return profiles.remotePresets.find((p) => p.id === trimmed) || getDefaultRemotePreset(profiles);
}

export function remotePresetFromCatalog(p: ModelPreset, label?: string): RemoteModelPreset {
  return normalizeRemotePreset(presetFromCatalog(p, label));
}

export function setDefaultRemotePreset(
  profiles: GlobalModelProfiles,
  id: string,
): GlobalModelProfiles {
  return normalizeGlobalModelProfiles({
    ...profiles,
    remotePresets: profiles.remotePresets.map((p) => ({
      ...p,
      isDefault: p.id === id,
    })),
  });
}

export function upsertRemotePreset(
  profiles: GlobalModelProfiles,
  preset: RemoteModelPreset,
): GlobalModelProfiles {
  const normalized = normalizeRemotePreset(preset);
  const idx = profiles.remotePresets.findIndex((p) => p.id === normalized.id);
  const next = [...profiles.remotePresets];
  if (idx >= 0) next[idx] = normalized;
  else next.push(normalized);
  return normalizeGlobalModelProfiles({ ...profiles, remotePresets: next });
}

export function removeRemotePreset(
  profiles: GlobalModelProfiles,
  id: string,
): GlobalModelProfiles {
  if (profiles.remotePresets.length <= 1) return profiles;
  const next = profiles.remotePresets.filter((p) => p.id !== id);
  return normalizeGlobalModelProfiles({ ...profiles, remotePresets: next });
}

export function invalidateGlobalModelProfilesCache(): void {
  cachedProfiles = null;
}

export function isLocalOnlyProfiles(profiles: GlobalModelProfiles): boolean {
  return profiles.localOnly === true;
}

export async function isLocalOnlyMode(): Promise<boolean> {
  const profiles = await loadGlobalModelProfiles();
  return isLocalOnlyProfiles(profiles);
}
