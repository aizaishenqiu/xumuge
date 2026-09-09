import { invoke } from "@tauri-apps/api/core";

export type CleanupChannel =
  | "desktop_button"
  | "desktop_command"
  | "feishu"
  | "wecom"
  | "dingtalk"
  | "slack"
  | "telegram"
  | "other";

export interface WipeGeneratePathResult {
  deletedFiles: number;
  deletedDirs: number;
  bytes: number;
  errors: string[];
}

export interface CleanupAuditEntry {
  ts: number;
  projectId?: string | null;
  projectName?: string | null;
  generatePath: string;
  channel: CleanupChannel;
  commandText: string;
  operatorHint?: string | null;
  wipeResult?: WipeGeneratePathResult | null;
  dispatchedEmployees?: number | null;
  outcome: string;
}

export async function wipeProjectGeneratePath(
  generatePath: string,
  mode: "full" = "full",
): Promise<WipeGeneratePathResult> {
  return invoke<WipeGeneratePathResult>("xu_wipe_project_generate_path", {
    generatePath,
    mode,
  });
}

export async function appendCleanupAudit(entry: CleanupAuditEntry): Promise<void> {
  await invoke("xu_append_cleanup_audit", { entry });
}

export async function listCleanupAudit(limit = 50): Promise<CleanupAuditEntry[]> {
  return invoke<CleanupAuditEntry[]>("xu_list_cleanup_audit", { limit });
}

export async function logCleanupAttempt(opts: {
  projectId?: string;
  projectName?: string;
  generatePath: string;
  channel: CleanupChannel;
  commandText: string;
  operatorHint?: string;
  wipeResult?: WipeGeneratePathResult | null;
  dispatchedEmployees?: number;
  outcome: string;
}): Promise<void> {
  await appendCleanupAudit({
    ts: Date.now(),
    projectId: opts.projectId ?? null,
    projectName: opts.projectName ?? null,
    generatePath: opts.generatePath,
    channel: opts.channel,
    commandText: opts.commandText,
    operatorHint: opts.operatorHint ?? null,
    wipeResult: opts.wipeResult ?? null,
    dispatchedEmployees: opts.dispatchedEmployees ?? null,
    outcome: opts.outcome,
  });
}
