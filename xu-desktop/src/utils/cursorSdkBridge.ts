/**
 * @file Cursor SDK / CLI 探测与编码驾驶就绪状态
 * @author qiuye <yjk150@qq.com>
 * @date 2026-09-02
 * @version 1.0.0
 * @category Network
 * @algo cursor-cli-probe
 */
import { invoke } from "@tauri-apps/api/core";
import { readDriveSettings, type DriveSettings } from "./driveSettings";

export const CURSOR_API_KEY_ENV = "CURSOR_API_KEY";

export type CursorSdkProbe = {
  cliAvailable: boolean;
  apiKeyConfigured: boolean;
  sdkAgentReady: boolean;
  sdkReady: boolean;
  cliPath: string;
  detail: string;
};

let cachedProbe: CursorSdkProbe | null = null;
let cachedAt = 0;
const CACHE_MS = 30_000;

export async function probeCursorSdk(force = false): Promise<CursorSdkProbe> {
  const now = Date.now();
  if (!force && cachedProbe && now - cachedAt < CACHE_MS) {
    return cachedProbe;
  }
  const probe = await invoke<CursorSdkProbe>("xu_probe_cursor_sdk");
  cachedProbe = probe;
  cachedAt = now;
  return probe;
}

/** SDK 驾驶是否真正可用（须全局开关 + CLI 探测通过）。 */
export async function canUseSdkDriveAsync(
  settings: DriveSettings = readDriveSettings(),
): Promise<boolean> {
  if (!settings.enabled || !(settings.useSdk || settings.mode === "sdk")) {
    return false;
  }
  const probe = await probeCursorSdk();
  return probe.sdkReady;
}

export async function runCursorSdkPrompt(
  cwd: string,
  prompt: string,
  model?: string,
): Promise<string> {
  return invoke<string>("xu_cursor_sdk_run_prompt", { cwd, prompt, model: model ?? null });
}

export async function syncDriveUseSdkToDb(enabled: boolean): Promise<void> {
  await invoke("xu_set_drive_use_sdk", { enabled });
}

export async function openCursorWorkspace(path: string): Promise<string> {
  return invoke<string>("xu_cursor_sdk_open_workspace", { path });
}
