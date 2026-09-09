/**
 * Feishu outbound sync level for office-floor employee messages.
 */

export type FeishuSyncLevel = "all" | "boss_only" | "meeting_only";

const LS = "xu.feishu.syncLevel";
const DB_KEY = "feishu_sync_level";

export function readFeishuSyncLevel(): FeishuSyncLevel {
  try {
    const v = localStorage.getItem(LS);
    if (v === "all" || v === "boss_only" || v === "meeting_only") return v;
  } catch {
    /* ignore */
  }
  return "all";
}

export async function loadFeishuSyncLevel(): Promise<FeishuSyncLevel> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const v = await invoke<string | null>("xu_get_setting", { key: DB_KEY });
    if (v === "all" || v === "boss_only" || v === "meeting_only") {
      localStorage.setItem(LS, v);
      return v;
    }
  } catch {
    /* ignore */
  }
  return readFeishuSyncLevel();
}

export async function saveFeishuSyncLevel(level: FeishuSyncLevel): Promise<void> {
  localStorage.setItem(LS, level);
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("xu_set_setting", { key: DB_KEY, value: level });
  } catch {
    /* ignore */
  }
}
