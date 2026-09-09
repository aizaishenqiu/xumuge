/**
 * Software project autopilot — auto-advance workflow waves without Boss at each gate.
 * Default OFF; enabling requires explicit risk acknowledgment.
 */
import { invoke } from "@tauri-apps/api/core";

const SETTING_KEY = "xu.software_autopilot";

export type SoftwareAutopilotPrefs = {
  /** Master switch — default false */
  enabled: boolean;
  /** User read risk copy and accepts consequences */
  riskAcknowledged: boolean;
};

export function defaultSoftwareAutopilotPrefs(): SoftwareAutopilotPrefs {
  return { enabled: false, riskAcknowledged: false };
}

export async function loadSoftwareAutopilotPrefs(): Promise<SoftwareAutopilotPrefs> {
  const d = defaultSoftwareAutopilotPrefs();
  try {
    const raw = await invoke<string | null>("xu_get_setting", { key: SETTING_KEY });
    if (!raw) return d;
    const p = JSON.parse(raw) as Partial<SoftwareAutopilotPrefs>;
    return {
      enabled: p.enabled === true,
      riskAcknowledged: p.riskAcknowledged === true,
    };
  } catch {
    return d;
  }
}

export async function saveSoftwareAutopilotPrefs(prefs: SoftwareAutopilotPrefs): Promise<void> {
  const next: SoftwareAutopilotPrefs = {
    enabled: prefs.enabled === true && prefs.riskAcknowledged === true,
    riskAcknowledged: prefs.riskAcknowledged === true,
  };
  await invoke("xu_set_setting", { key: SETTING_KEY, value: JSON.stringify(next) });
}

export function isSoftwareAutopilotEnabled(prefs: SoftwareAutopilotPrefs): boolean {
  return prefs.enabled === true && prefs.riskAcknowledged === true;
}
