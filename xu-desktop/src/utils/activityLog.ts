import { invoke } from "@tauri-apps/api/core";

export type ActivityLogKind =
  | "clarify"
  | "gate"
  | "tool"
  | "bulk_read"
  | "file_change"
  | "halt"
  | "kickoff"
  | "approval"
  | "system";

export interface ActivityLogEntry {
  ts: number;
  kind: ActivityLogKind | string;
  title: string;
  detail: string;
  projectId?: string | null;
  sessionId?: string | null;
  employeeId?: string | null;
  paths?: string[] | null;
  bytes?: number | null;
  stopped?: boolean | null;
  outcome?: string | null;
}

export async function appendActivityLog(
  entry: Omit<ActivityLogEntry, "ts"> & { ts?: number },
): Promise<void> {
  await invoke("xu_append_activity_log", {
    entry: {
      ts: entry.ts ?? Date.now(),
      kind: entry.kind,
      title: entry.title,
      detail: entry.detail,
      projectId: entry.projectId ?? null,
      sessionId: entry.sessionId ?? null,
      employeeId: entry.employeeId ?? null,
      paths: entry.paths ?? null,
      bytes: entry.bytes ?? null,
      stopped: entry.stopped ?? null,
      outcome: entry.outcome ?? null,
    },
  });
}

export async function listActivityLog(limit = 200): Promise<ActivityLogEntry[]> {
  return invoke<ActivityLogEntry[]>("xu_list_activity_log", { limit });
}

export type ActivityLogFilter = "all" | "file_change" | "bulk_read" | "halt";

export function filterActivityLog(
  rows: ActivityLogEntry[],
  filter: ActivityLogFilter,
): ActivityLogEntry[] {
  if (filter === "all") return rows;
  if (filter === "file_change") {
    return rows.filter(
      (e) =>
        e.kind === "file_change" ||
        (e.kind === "tool" && /写|修改|patch|delete|shell/i.test(`${e.title} ${e.detail}`)),
    );
  }
  if (filter === "bulk_read") {
    return rows.filter((e) => e.kind === "bulk_read" || /read_file|glob|grep|list_dir/i.test(e.detail));
  }
  if (filter === "halt") {
    return rows.filter(
      (e) => e.kind === "halt" || e.stopped === true || e.outcome === "denied" || e.outcome === "blocked",
    );
  }
  return rows;
}

export function activityLogToJsonl(rows: ActivityLogEntry[]): string {
  return rows.map((e) => JSON.stringify(e)).join("\n");
}
