import { invoke } from "@tauri-apps/api/core";
import { BUNDLED_CAPABILITY_PACKS, getBundledPack } from "./bundled";
import type { CapabilityPackManifest, CapabilityPackState, InstalledCapabilityPack } from "./types";

export const CAPABILITY_PACKS_KEY = "xu.capability_packs";

let cached: CapabilityPackState | null = null;

function normalizeManifest(raw: Partial<CapabilityPackManifest>): CapabilityPackManifest | null {
  const id = (raw.id ?? "").trim();
  const name = (raw.name ?? "").trim();
  if (!id || !name) return null;
  return {
    id,
    name,
    description: (raw.description ?? "").trim(),
    version: (raw.version ?? "1.0.0").trim(),
    agentToolHints: (raw.agentToolHints ?? "").trim() || undefined,
    fileExtensions: Array.isArray(raw.fileExtensions)
      ? raw.fileExtensions.map((ext) => String(ext).trim()).filter(Boolean)
      : undefined,
    officeTools: raw.officeTools === true,
    helpDoc: (raw.helpDoc ?? "").trim() || undefined,
    roleId: (raw.roleId ?? "").trim() || undefined,
    employeeId: (raw.employeeId ?? "").trim() || undefined,
    sourcePath: (raw.sourcePath ?? "").trim() || undefined,
  };
}

function mergeWithBundled(state: CapabilityPackState): InstalledCapabilityPack[] {
  const byId = new Map(state.installed.map((p) => [p.manifest.id, p]));
  const merged: InstalledCapabilityPack[] = [];
  for (const bundled of BUNDLED_CAPABILITY_PACKS) {
    const existing = byId.get(bundled.id);
    merged.push({
      manifest: bundled,
      enabled: existing?.enabled ?? false,
      bundled: true,
    });
    byId.delete(bundled.id);
  }
  for (const extra of byId.values()) {
    merged.push(extra);
  }
  return merged;
}

export function defaultCapabilityPackState(): CapabilityPackState {
  return {
    installed: BUNDLED_CAPABILITY_PACKS.map((manifest) => ({
      manifest,
      enabled: false,
      bundled: true,
    })),
  };
}

export async function loadCapabilityPackState(force = false): Promise<CapabilityPackState> {
  if (cached && !force) return cached;
  let installed: InstalledCapabilityPack[] = defaultCapabilityPackState().installed;
  try {
    const raw = await invoke<string | null>("xu_get_setting", { key: CAPABILITY_PACKS_KEY });
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<CapabilityPackState>;
      installed = (parsed.installed ?? [])
        .map((row) => {
          const manifest = normalizeManifest(row?.manifest ?? {});
          if (!manifest) return null;
          const pack: InstalledCapabilityPack = {
            manifest,
            enabled: row?.enabled === true,
          };
          if (row?.bundled === true) pack.bundled = true;
          if (row?.userOwned === true) pack.userOwned = true;
          return pack;
        })
        .filter((x): x is InstalledCapabilityPack => x !== null);
      installed = mergeWithBundled({ installed });
    }
  } catch {
    /* migrate */
  }
  try {
    const { scanUserSkills } = await import("../skills/userSkillsDir");
    const userSkills = await scanUserSkills();
    const diskIds = new Set(userSkills.map((p) => p.manifest.id));
    installed = [...installed.filter((p) => p.bundled || !diskIds.has(p.manifest.id)), ...userSkills];
  } catch {
    /* skills dir optional */
  }
  cached = { installed };
  return cached;
}

export async function saveCapabilityPackState(state: CapabilityPackState): Promise<void> {
  const merged = mergeWithBundled(state);
  const forDb: CapabilityPackState = {
    installed: merged.filter((p) => !p.userOwned),
  };
  try {
    const { scanUserSkills } = await import("../skills/userSkillsDir");
    const userSkills = await scanUserSkills();
    cached = { installed: [...forDb.installed.filter((p) => p.bundled || !userSkills.some((u) => u.manifest.id === p.manifest.id)), ...userSkills] };
  } catch {
    cached = { installed: forDb.installed };
  }
  await invoke("xu_set_setting", {
    key: CAPABILITY_PACKS_KEY,
    value: JSON.stringify(forDb),
  });
}

export async function setCapabilityPackEnabled(id: string, enabled: boolean): Promise<void> {
  const state = await loadCapabilityPackState(true);
  const pack = state.installed.find((p) => p.manifest.id === id);
  if (pack?.userOwned) {
    const { setUserSkillEnabled } = await import("../skills/userSkillsDir");
    await setUserSkillEnabled(id, enabled);
    cached = null;
    await loadCapabilityPackState(true);
    return;
  }
  const next = state.installed.map((p) =>
    p.manifest.id === id ? { ...p, enabled } : p,
  );
  await saveCapabilityPackState({ installed: next });
}

export async function importCapabilityPackManifest(
  manifest: Partial<CapabilityPackManifest>,
): Promise<InstalledCapabilityPack> {
  const normalized = normalizeManifest(manifest);
  if (!normalized) throw new Error("能力包 manifest 无效：缺少 id 或 name");
  const bundled = getBundledPack(normalized.id);
  const finalManifest = bundled ? { ...bundled, ...normalized, id: bundled.id } : normalized;
  const state = await loadCapabilityPackState(true);
  const existing = state.installed.find((p) => p.manifest.id === finalManifest.id);
  const row: InstalledCapabilityPack = {
    manifest: finalManifest,
    enabled: existing?.enabled ?? true,
    bundled: Boolean(bundled),
  };
  const next = [...state.installed.filter((p) => p.manifest.id !== finalManifest.id), row];
  await saveCapabilityPackState({ installed: next });
  return row;
}

export function listEnabledPacks(state: CapabilityPackState): InstalledCapabilityPack[] {
  return state.installed.filter((p) => p.enabled);
}
