/** Remote preset binding helpers for OpsBrains / BrainModelField. */

import type { BrainSlotConfig } from "./opsBrains";
import type { RemoteModelPreset } from "./globalModelProfiles";

export function findMatchingRemotePreset(
  cfg: BrainSlotConfig,
  presets: RemoteModelPreset[],
): RemoteModelPreset | null {
  const pid = (cfg.remotePresetId || "").trim();
  if (pid) {
    const byId = presets.find((p) => p.id === pid);
    if (byId) return byId;
  }
  const model = (cfg.model || "").trim();
  if (!model) return null;
  const baseUrl = (cfg.baseUrl || "").trim();
  return (
    presets.find(
      (p) =>
        p.textModel === model && (!baseUrl || !p.baseUrl.trim() || p.baseUrl.trim() === baseUrl),
    ) ?? null
  );
}

export function isCustomRemoteBrain(
  cfg: BrainSlotConfig,
  presets: RemoteModelPreset[],
): boolean {
  if (cfg.source === "local") return false;
  if ((cfg.remotePresetId || "").trim()) return false;
  return findMatchingRemotePreset(cfg, presets) == null;
}

export function patchFromRemotePreset(p: RemoteModelPreset): Partial<BrainSlotConfig> {
  return {
    model: p.textModel,
    visionModel: p.visionModel || "",
    baseUrl: p.baseUrl,
    apiKeyEnv: p.apiKeyEnv,
    provider: p.provider || "custom",
    remotePresetId: p.id,
    source: "remote",
    displayName: p.label || p.textModel,
  };
}

export function reconcileRemotePresetBinding(
  cfg: BrainSlotConfig,
  presets: RemoteModelPreset[],
): { cfg: BrainSlotConfig; changed: boolean } {
  if (cfg.source === "local") return { cfg, changed: false };
  const pid = (cfg.remotePresetId || "").trim();
  if (pid && presets.some((p) => p.id === pid)) return { cfg, changed: false };
  const hit = findMatchingRemotePreset(cfg, presets);
  if (!hit) return { cfg, changed: false };
  return {
    cfg: { ...cfg, ...patchFromRemotePreset(hit) },
    changed: true,
  };
}
