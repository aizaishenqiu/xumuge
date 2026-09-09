import { invoke } from "@tauri-apps/api/core";
import { appendFouMessage } from "../employee";
import { BRAND_NAME_ZH } from "./brandSettings";
import { notifyBoss } from "./channelConnections";
import { OFFICE_FLOOR } from "./officeComms";

const PENDING_KEY = "xu.reset.pending";
const TTL_MS = 10 * 60 * 1000;

export type ResetPendingStage = "await_clear_intent" | "await_delete_phrase";

export type ResetReplanSource =
  | "feishu"
  | "wecom"
  | "dingtalk"
  | "slack"
  | "telegram"
  | "other";

export interface ResetReplanPending {
  text: string;
  playbookPath?: string;
  projectId?: string;
  at: number;
  source: ResetReplanSource;
  stage: ResetPendingStage;
}

const IM_SOURCES = new Set<ResetReplanSource>([
  "feishu",
  "wecom",
  "dingtalk",
  "slack",
  "telegram",
]);

export function isImResetSource(source?: string): source is ResetReplanSource {
  return Boolean(source && IM_SOURCES.has(source as ResetReplanSource));
}

export async function loadResetReplanPending(): Promise<ResetReplanPending | null> {
  const raw = await invoke<string | null>("xu_get_setting", { key: PENDING_KEY });
  if (!raw?.trim()) return null;
  try {
    const p = JSON.parse(raw) as ResetReplanPending;
    if (!p?.text || Date.now() - (p.at ?? 0) > TTL_MS) {
      await clearResetReplanPending();
      return null;
    }
    if (!p.stage) p.stage = "await_clear_intent";
    return p;
  } catch {
    return null;
  }
}

export async function saveResetReplanPending(
  input: Omit<ResetReplanPending, "at">,
): Promise<void> {
  const full: ResetReplanPending = { ...input, at: Date.now() };
  await invoke("xu_set_setting", { key: PENDING_KEY, value: JSON.stringify(full) });
}

export async function clearResetReplanPending(): Promise<void> {
  await invoke("xu_set_setting", { key: PENDING_KEY, value: "" });
}

export async function requestRemoteResetConfirm(
  text: string,
  opts?: { playbookPath?: string; projectId?: string; source?: ResetReplanSource },
): Promise<void> {
  await saveResetReplanPending({
    text,
    playbookPath: opts?.playbookPath,
    projectId: opts?.projectId,
    source: opts?.source ?? "feishu",
    stage: "await_clear_intent",
  });
  const preview = text.length > 80 ? `${text.slice(0, 80)}…` : text;
  await notifyBoss({
    kind: "awaiting_boss",
    title: `${BRAND_NAME_ZH} · 清理重规划待确认`,
    body: [
      "⚠️ 收到远程清理重规划指令，尚未执行：",
      preview,
      "",
      "这会：全员停工、**删除生成路径全部内容**后重新规划。",
      "第一步：请回复「确认清除」继续；或「取消」放弃（10 分钟内有效）。",
    ].join("\n"),
    force: true,
  });
  await appendFouMessage({
    sessionTag: OFFICE_FLOOR,
    role: "system",
    content:
      "⏳ 收到远程清理口令，已推送第一次确认。请 Boss 回复「确认清除」或「取消」。",
  });
}

export async function advanceToDeletePhraseConfirm(
  pending: ResetReplanPending,
): Promise<void> {
  await saveResetReplanPending({
    ...pending,
    stage: "await_delete_phrase",
  });
  await notifyBoss({
    kind: "awaiting_boss",
    title: `${BRAND_NAME_ZH} · 清理重规划二次确认`,
    body: [
      "⚠️ 已确认清除意图。",
      "",
      "第二步：请精确回复「确认删除」以执行（将删除生成目录全部内容，不可恢复）。",
      "回复「取消」可放弃。",
    ].join("\n"),
    force: true,
  });
  await appendFouMessage({
    sessionTag: OFFICE_FLOOR,
    role: "system",
    content: "⏳ 请 Boss 在 IM 中精确输入「确认删除」以执行清理。",
  });
}

export async function takeConfirmedRemoteReset(): Promise<ResetReplanPending | null> {
  const p = await loadResetReplanPending();
  if (!p || p.stage !== "await_delete_phrase") return null;
  await clearResetReplanPending();
  return p;
}
