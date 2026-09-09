/**
 * @file GUI 自动化同意、实验灰度与急停桥接
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-31
 * @version 1.0.0
 * @category ToolPolicy
 * @algo fail-closed-local-marker
 */

import { mkdir, writeTextFile, remove, exists } from "@tauri-apps/plugin-fs";
import { invoke } from "@tauri-apps/api/core";

const LS = "xu.gui.consent";
const EXPERIMENTAL_LS = "xu.gui.experimental";

export function readGuiConsentLocal(): boolean {
  try {
    return localStorage.getItem(LS) === "1";
  } catch {
    return false;
  }
}

export async function writeGuiConsent(
  accepted: boolean,
  workspaceRoot?: string | null,
): Promise<void> {
  localStorage.setItem(LS, accepted ? "1" : "0");
  const root = workspaceRoot?.trim();
  if (!root) return;
  const dir = `${root.replace(/[/\\]$/, "")}/.xu`;
  const file = `${dir}/gui-consent`;
  if (accepted) {
    try {
      await mkdir(dir, { recursive: true });
    } catch {
      /* exists */
    }
    await writeTextFile(file, "1\n");
  } else {
    try {
      if (await exists(file)) await remove(file);
    } catch {
      /* ignore */
    }
  }
}

export function readGuiExperimentalLocal(): boolean {
  try {
    return localStorage.getItem(EXPERIMENTAL_LS) === "1";
  } catch {
    return false;
  }
}

/** Persists the independent experimental rollout marker; errors must be shown with fouAlert by caller. */
export async function writeGuiExperimental(
  enabled: boolean,
  workspaceRoot?: string | null,
  windowAllowlist: string[] = ["Cursor"],
): Promise<void> {
  localStorage.setItem(EXPERIMENTAL_LS, enabled ? "1" : "0");
  const root = workspaceRoot?.trim();
  if (!root) return;
  const dir = `${root.replace(/[/\\]$/, "")}/.xu`;
  const file = `${dir}/gui-experimental`;
  if (enabled) {
    await mkdir(dir, { recursive: true }).catch(() => undefined);
    await writeTextFile(file, "experimental\n");
    await writeTextFile(
      `${dir}/gui-policy.json`,
      `${JSON.stringify({ windowAllowlist: windowAllowlist.filter(Boolean) }, null, 2)}\n`,
    );
  } else if (await exists(file)) {
    await remove(file);
  }
}

/** Latches the Rust-side emergency stop; no real input is injected. */
export async function emergencyStopGui(): Promise<void> {
  await invoke("xu_gui_emergency_stop");
}

/** Resets the emergency stop only after explicit user action. */
export async function resetGuiEmergencyStop(): Promise<void> {
  await invoke("xu_gui_reset_emergency_stop");
}

/** Arms Windows physical-input detection without injecting keyboard or mouse events. */
export async function armGuiInputMonitor(): Promise<void> {
  await invoke("xu_gui_arm_input_monitor");
}
