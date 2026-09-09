import { invoke } from "@tauri-apps/api/core";
import { appendFouMessage } from "./employees";

export type NotifyChannelId = "feishu" | "wecom" | "dingtalk" | "slack" | "telegram" | "os";

export interface ChannelPlatformStatus {
  id: string;
  label: string;
  notifyTarget: string;
  listed: boolean;
  desktopReady: boolean;
  note: string;
  webhookConfigured?: boolean;
  enabled?: boolean;
  supportsNotify?: boolean;
  supportsChat?: boolean;
}

export interface ChannelHubStatus {
  notifyReady: boolean;
  gatewayRunning: boolean;
  gatewayDetail: string;
  tokenHint: boolean;
  dashboardUp: boolean;
  preferredChannel: string;
  platforms: ChannelPlatformStatus[];
  sendListRaw: string;
  runtime?: string;
}

export interface ChannelEndpointView {
  id: string;
  enabled: boolean;
  kind: string;
  api: string;
  key: string;
  webhookUrl: string;
  secretRef: string;
  hasUrl: boolean;
  envFallback: string;
  apiHint: string;
  keyHint: string;
  docsHint: string;
  mode?: string;
  receiveId?: string;
  meetingSync?: boolean;
  kfSync?: boolean;
  kfOpenKfid?: string;
  kfCorpId?: string;
}

export interface FeishuWsStatus {
  state: string;
  lastError: string;
  boundChatId: string;
  lastHeartbeatMs: number;
  lastInboundMs?: number;
  meetingSync: boolean;
  pid?: number | null;
}

export interface FeishuRecentSender {
  openId: string;
  name: string;
  lastAt: number;
  isBoss: boolean;
}

export interface ChannelProbeResult {
  ok: boolean;
  message: string;
  botName?: string | null;
}

export interface NotifyBossResult {
  ok: boolean;
  throttled: boolean;
  channel: string;
  osNotified: boolean;
  gatewaySent: boolean;
  webhookSent?: boolean;
  message: string;
}

export interface FeishuDocResult {
  ok: boolean;
  localPath: string;
  summary: string;
  message: string;
}

export type BossNotifyKind =
  | "test"
  | "awaiting_boss"
  | "quota_hard"
  | "health_down"
  | "blocked"
  | "general";

const OFFICE_SESSION = "office-floor";

export async function loadChannelStatus(): Promise<ChannelHubStatus> {
  return invoke<ChannelHubStatus>("xu_channel_status");
}

export async function setPreferredNotifyChannel(channel: string): Promise<void> {
  await invoke("xu_set_notify_channel", { channel });
}

export async function getChannelEndpoint(id: string): Promise<ChannelEndpointView> {
  return invoke<ChannelEndpointView>("xu_get_channel_endpoint", { id });
}

export async function setChannelEndpoint(input: {
  id: string;
  enabled?: boolean;
  api?: string;
  key?: string;
  webhookUrl?: string;
  secretRef?: string;
  mode?: string;
  receiveId?: string;
  meetingSync?: boolean;
  kfSync?: boolean;
  kfOpenKfid?: string;
  kfCorpId?: string;
}): Promise<void> {
  await invoke("xu_set_channel_endpoint", {
    payload: {
      id: input.id,
      enabled: input.enabled,
      api: input.api ?? input.webhookUrl,
      key: input.key ?? input.secretRef,
      webhookUrl: input.webhookUrl,
      secretRef: input.secretRef,
      mode: input.mode,
      receiveId: input.receiveId,
      meetingSync: input.meetingSync,
      kfSync: input.kfSync,
      kfOpenKfid: input.kfOpenKfid,
      kfCorpId: input.kfCorpId,
    },
  });
}

export interface WecomKfStatus {
  state: string;
  lastError: string;
  kfSync: boolean;
  openKfid: string;
  lastInboundMs: number;
  pid?: number | null;
  pendingDrafts: number;
}

export interface WecomKfDraft {
  msgId: string;
  externalUserid: string;
  openKfid: string;
  customerText: string;
  draftReply: string;
  updatedAt: number;
}

export async function getWecomKfStatus(): Promise<WecomKfStatus> {
  return invoke<WecomKfStatus>("xu_wecom_kf_status");
}

export async function setWecomKfEnabled(enabled: boolean): Promise<WecomKfStatus> {
  return invoke<WecomKfStatus>("xu_wecom_kf_set_enabled", { enabled });
}

export async function listWecomKfDrafts(): Promise<WecomKfDraft[]> {
  return invoke<WecomKfDraft[]>("xu_wecom_kf_list_drafts");
}

export async function saveWecomKfDraft(msgId: string, draftReply: string): Promise<WecomKfDraft> {
  return invoke<WecomKfDraft>("xu_wecom_kf_save_draft", { msgId, draftReply });
}

export async function approveWecomKfSend(msgId: string): Promise<void> {
  await invoke("xu_wecom_kf_approve_send", { msgId });
}

export async function getWecomKfDefaultEmployee(): Promise<string | null> {
  return invoke<string | null>("xu_wecom_kf_get_default_employee");
}

export async function setWecomKfDefaultEmployee(employeeId: string): Promise<void> {
  await invoke("xu_wecom_kf_set_default_employee", { employeeId: employeeId || null });
}

export async function getFeishuWsStatus(): Promise<FeishuWsStatus> {
  return invoke<FeishuWsStatus>("xu_feishu_ws_status");
}

export async function setFeishuMeetingSync(enabled: boolean): Promise<FeishuWsStatus> {
  return invoke<FeishuWsStatus>("xu_feishu_meeting_sync_set", { enabled });
}

export async function ensureFeishuWs(): Promise<FeishuWsStatus> {
  return invoke<FeishuWsStatus>("xu_feishu_ws_ensure");
}

export async function restartFeishuWs(): Promise<FeishuWsStatus> {
  return invoke<FeishuWsStatus>("xu_feishu_ws_restart");
}

export async function listFeishuRecentSenders(): Promise<FeishuRecentSender[]> {
  return invoke<FeishuRecentSender[]>("xu_feishu_list_recent_senders");
}

export async function setFeishuBossOpenId(
  openId: string,
  enabled: boolean,
): Promise<FeishuRecentSender[]> {
  return invoke<FeishuRecentSender[]>("xu_feishu_set_boss_open_id", {
    openId,
    enabled,
  });
}

export async function probeChannel(id: string): Promise<ChannelProbeResult> {
  return invoke<ChannelProbeResult>("xu_channel_probe", { id });
}

export async function sendChannelChat(channel: string, text: string): Promise<NotifyBossResult> {
  return invoke<NotifyBossResult>("xu_channel_send_chat", { channel, text });
}

export async function notifyBoss(input: {
  kind: BossNotifyKind | string;
  title: string;
  body?: string;
  channel?: string;
  force?: boolean;
  mirrorOffice?: boolean;
}): Promise<NotifyBossResult> {
  const result = await invoke<NotifyBossResult>("xu_notify_boss", {
    kind: input.kind,
    title: input.title,
    body: input.body ?? "",
    channel: input.channel ?? null,
    force: input.force ?? false,
  });
  if (input.mirrorOffice !== false && !result.throttled) {
    await appendFouMessage({
      sessionTag: OFFICE_SESSION,
      role: "notify",
      content: `[${input.title}] ${input.body ?? result.message}`.trim(),
    });
  }
  return result;
}

export async function analyzeFeishuDoc(url: string): Promise<FeishuDocResult> {
  return invoke<FeishuDocResult>("xu_feishu_doc_analyze", { url });
}

export function emitBossNotify(detail: {
  kind: BossNotifyKind | string;
  title: string;
  body?: string;
  channel?: string;
  force?: boolean;
}) {
  window.dispatchEvent(new CustomEvent("xu-boss-notify", { detail }));
}

export function statusLabel(p: ChannelPlatformStatus, _hub: ChannelHubStatus): string {
  if (p.id === "os") return "可用";
  if (p.webhookConfigured) return "已连接";
  return "待配置";
}
