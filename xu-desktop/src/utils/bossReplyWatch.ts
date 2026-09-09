/**
 * @file 老板长时间未答复开会事项：提醒音 + IM + 可选语音
 * @author qiuye <yjk150@qq.com>
 * @updated 2026-09-02
 * @version 1.1.0
 * @category Schedule
 * @algo awaiting-confirm-idle-watch
 */

import { invoke } from "@tauri-apps/api/core";
import { loadEmployees, type Employee } from "./employees";
import { notifyBoss } from "./channelConnections";
import { playAttentionBeep, speakAttentionLine } from "./alertSound";

export const BOSS_REPLY_WATCH_KEY = "xu.boss.reply.watch.settings";
const REMIND_STATE_PREFIX = "xu.boss.reply.remind.";

export type BossReplyWatchSettings = {
  enabled: boolean;
  /** Seconds without boss reply before first alert. Default 600 (10 min). */
  noReplySec: number;
  /** Minimum gap between repeat alerts for same employee. Default 300. */
  repeatSec: number;
  playSound: boolean;
  voicePrompt: boolean;
  imNotify: boolean;
};

export type AwaitingBossItem = {
  employeeId: string;
  employeeName: string;
  at: number;
  questions: string[];
  elapsedSec: number;
};

export const DEFAULT_BOSS_REPLY_WATCH: BossReplyWatchSettings = {
  enabled: true,
  noReplySec: 600,
  repeatSec: 300,
  playSound: true,
  voicePrompt: false,
  imNotify: true,
};

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

/** Normalize user settings. */
export function normalizeBossReplyWatchSettings(
  raw: Partial<BossReplyWatchSettings> | null | undefined,
): BossReplyWatchSettings {
  const base = { ...DEFAULT_BOSS_REPLY_WATCH, ...(raw || {}) };
  return {
    enabled: base.enabled !== false,
    noReplySec: Math.max(60, Math.min(86_400, Math.floor(Number(base.noReplySec) || 600))),
    repeatSec: Math.max(60, Math.min(86_400, Math.floor(Number(base.repeatSec) || 300))),
    playSound: base.playSound !== false,
    voicePrompt: base.voicePrompt === true,
    imNotify: base.imNotify !== false,
  };
}

export function readBossReplyWatchSettings(): BossReplyWatchSettings {
  const raw = readJson<Partial<BossReplyWatchSettings>>(BOSS_REPLY_WATCH_KEY);
  return normalizeBossReplyWatchSettings(raw);
}

export function writeBossReplyWatchSettings(
  patch: Partial<BossReplyWatchSettings>,
): BossReplyWatchSettings {
  const merged = normalizeBossReplyWatchSettings({ ...readBossReplyWatchSettings(), ...patch });
  writeJson(BOSS_REPLY_WATCH_KEY, merged);
  return merged;
}

function remindKey(employeeId: string): string {
  return REMIND_STATE_PREFIX + employeeId;
}

function readLastRemindMs(employeeId: string): number {
  const raw = localStorage.getItem(remindKey(employeeId));
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

function writeLastRemindMs(employeeId: string, at: number): void {
  try {
    localStorage.setItem(remindKey(employeeId), String(at));
  } catch {
    /* ignore */
  }
}

/** Clear remind throttle when boss replies (resume after confirm). */
export function clearBossReplyRemind(employeeId: string): void {
  const id = (employeeId || "").trim();
  if (!id) return;
  try {
    localStorage.removeItem(remindKey(id));
  } catch {
    /* ignore */
  }
}

type DispatchCheckpoint = {
  state?: string;
  at?: number;
  questions?: string[];
  analysis?: string;
};

let awaitingCache: {
  key: string;
  at: number;
  items: AwaitingBossItem[];
} | null = null;
const AWAITING_CACHE_MS = 2_500;

/** List employees waiting for boss confirmation（短缓存，避免 N 次 IPC 风暴）. */
export async function listAwaitingBossConfirm(
  employees?: Employee[],
): Promise<AwaitingBossItem[]> {
  const list = employees ?? (await loadEmployees());
  const meetingIds = list
    .filter((e) => e.status === "meeting")
    .map((e) => e.id)
    .sort()
    .join(",");
  const now = Date.now();
  if (
    awaitingCache &&
    awaitingCache.key === meetingIds &&
    now - awaitingCache.at < AWAITING_CACHE_MS
  ) {
    return awaitingCache.items.map((it) => ({
      ...it,
      elapsedSec: Math.max(0, Math.floor((now - it.at) / 1000)),
    }));
  }

  const out: AwaitingBossItem[] = [];
  for (const emp of list) {
    if (emp.status !== "meeting") continue;
    let raw = "{}";
    try {
      raw = await invoke<string>("xu_emp_dispatch_status", { employeeId: emp.id });
    } catch {
      continue;
    }
    let cp: DispatchCheckpoint = {};
    try {
      cp = JSON.parse(raw) as DispatchCheckpoint;
    } catch {
      continue;
    }
    if (cp.state !== "awaiting_confirm") continue;
    const at = Number(cp.at) || now;
    const questions = Array.isArray(cp.questions)
      ? cp.questions.filter((q): q is string => typeof q === "string")
      : [];
    out.push({
      employeeId: emp.id,
      employeeName: emp.name,
      at,
      questions,
      elapsedSec: Math.max(0, Math.floor((now - at) / 1000)),
    });
  }
  out.sort((a, b) => a.at - b.at);
  awaitingCache = { key: meetingIds, at: now, items: out };
  return out;
}

async function remindBossForItem(
  item: AwaitingBossItem,
  settings: BossReplyWatchSettings,
): Promise<void> {
  const qs = item.questions.slice(0, 2).join("；") || "开会待拍板";
  const title = `虚募阁 · ${item.employeeName} 等您拍板`;
  const body = `已等待约 ${Math.floor(item.elapsedSec / 60)} 分钟。\n${qs}`;

  if (settings.playSound) {
    playAttentionBeep();
  }
  if (settings.voicePrompt) {
    speakAttentionLine(`${item.employeeName}开会等您拍板，请到办公室协作条回复。`);
  }
  if (settings.imNotify) {
    await notifyBoss({
      kind: "awaiting_boss",
      title,
      body,
      force: true,
      mirrorOffice: true,
    }).catch(() => {});
  }
  writeLastRemindMs(item.employeeId, Date.now());
}

let watchTimer: number | null = null;
let watchRunning = false;

/** Start global boss-no-reply watchdog (singleton). */
export function startBossReplyWatch(intervalMs = 30_000): void {
  if (watchTimer != null) return;
  watchTimer = window.setInterval(() => {
    void tickBossReplyWatch();
  }, intervalMs);
  void tickBossReplyWatch();
}

/** Stop watchdog. */
export function stopBossReplyWatch(): void {
  if (watchTimer != null) {
    window.clearInterval(watchTimer);
    watchTimer = null;
  }
}

/** One poll cycle; safe to call manually. */
export async function tickBossReplyWatch(): Promise<AwaitingBossItem[]> {
  if (watchRunning) return [];
  watchRunning = true;
  try {
    const settings = readBossReplyWatchSettings();
    if (!settings.enabled) return [];
    const pending = await listAwaitingBossConfirm();
    const now = Date.now();
    for (const item of pending) {
      if (item.elapsedSec < settings.noReplySec) continue;
      const last = readLastRemindMs(item.employeeId);
      if (last > 0 && now - last < settings.repeatSec * 1000) continue;
      await remindBossForItem(item, settings);
    }
    return pending;
  } finally {
    watchRunning = false;
  }
}

/** Manual nudge from UI ("催老板"). */
export async function nudgeBossNow(item: AwaitingBossItem): Promise<void> {
  const settings = readBossReplyWatchSettings();
  await remindBossForItem(item, settings);
}
