/**
 * @file 办公室开会熔断：最大轮次与墙钟超时，强制升级老板拍板
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-31
 * @version 1.0.0
 * @category Schedule
 * @algo wall-clock-and-round-fuse
 */

export const MEETING_FUSE_SETTINGS_KEY = "xu.meeting.fuse.settings";
const FUSE_STATE_PREFIX = "xu.meeting.fuse.";

export type MeetingFuseSettings = {
  enabled: boolean;
  maxRounds: number;
  timeoutSec: number;
};

export type MeetingFuseState = {
  startedAt: number;
  roundCount: number;
  meetingId?: string;
};

export type MeetingFuseCheck = "ok" | "rounds_exceeded" | "timed_out";

export const DEFAULT_MEETING_FUSE_SETTINGS: MeetingFuseSettings = {
  enabled: true,
  maxRounds: 6,
  timeoutSec: 900,
};

function readJson<T>(key: string): unknown {
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

/** Normalize and clamp user settings. */
export function normalizeMeetingFuseSettings(
  raw: Partial<MeetingFuseSettings> | null | undefined,
): MeetingFuseSettings {
  const base = { ...DEFAULT_MEETING_FUSE_SETTINGS, ...(raw || {}) };
  const maxRounds = Math.max(1, Math.min(50, Math.floor(Number(base.maxRounds) || 6)));
  const timeoutSec = Math.max(60, Math.min(86_400, Math.floor(Number(base.timeoutSec) || 900)));
  return {
    enabled: base.enabled !== false,
    maxRounds,
    timeoutSec,
  };
}

export function readMeetingFuseSettings(): MeetingFuseSettings {
  const raw = readJson<Partial<MeetingFuseSettings>>(MEETING_FUSE_SETTINGS_KEY);
  return normalizeMeetingFuseSettings(
    raw && typeof raw === "object" ? (raw as Partial<MeetingFuseSettings>) : null,
  );
}

export function writeMeetingFuseSettings(next: Partial<MeetingFuseSettings>): MeetingFuseSettings {
  const merged = normalizeMeetingFuseSettings({ ...readMeetingFuseSettings(), ...next });
  writeJson(MEETING_FUSE_SETTINGS_KEY, merged);
  return merged;
}

function stateKey(employeeId: string): string {
  return FUSE_STATE_PREFIX + employeeId;
}

export function readMeetingFuseState(employeeId: string): MeetingFuseState | null {
  const id = (employeeId || "").trim();
  if (!id) return null;
  const raw = readJson<MeetingFuseState>(stateKey(id));
  if (!raw || typeof raw !== "object") return null;
  const startedAt = Number((raw as MeetingFuseState).startedAt);
  const roundCount = Number((raw as MeetingFuseState).roundCount);
  if (!Number.isFinite(startedAt) || !Number.isFinite(roundCount)) return null;
  return {
    startedAt,
    roundCount: Math.max(0, Math.floor(roundCount)),
    meetingId: (raw as MeetingFuseState).meetingId,
  };
}

export function clearMeetingFuse(employeeId: string): void {
  const id = (employeeId || "").trim();
  if (!id) return;
  try {
    localStorage.removeItem(stateKey(id));
  } catch {
    /* ignore */
  }
}

/** Start or refresh fuse clock when entering meeting / need_confirm. */
export function beginMeetingFuse(
  employeeId: string,
  opts?: { meetingId?: string; now?: number },
): MeetingFuseState | null {
  const id = (employeeId || "").trim();
  if (!id) return null;
  const existing = readMeetingFuseState(id);
  if (existing) return existing;
  const state: MeetingFuseState = {
    startedAt: opts?.now ?? Date.now(),
    roundCount: 0,
    meetingId: opts?.meetingId,
  };
  writeJson(stateKey(id), state);
  return state;
}

/** Count one debate turn (employee or manager reply in meeting). */
export function bumpMeetingRound(
  employeeId: string,
  opts?: { now?: number },
): MeetingFuseState | null {
  const id = (employeeId || "").trim();
  if (!id) return null;
  const cur = readMeetingFuseState(id) || beginMeetingFuse(id, { now: opts?.now });
  if (!cur) return null;
  const next: MeetingFuseState = {
    ...cur,
    roundCount: cur.roundCount + 1,
  };
  writeJson(stateKey(id), next);
  return next;
}

export function checkMeetingFuse(
  employeeId: string,
  opts?: { settings?: MeetingFuseSettings; now?: number },
): MeetingFuseCheck {
  const settings = opts?.settings ?? readMeetingFuseSettings();
  if (!settings.enabled) return "ok";
  const state = readMeetingFuseState(employeeId);
  if (!state) return "ok";
  const now = opts?.now ?? Date.now();
  if (state.roundCount >= settings.maxRounds) return "rounds_exceeded";
  if (now - state.startedAt >= settings.timeoutSec * 1000) return "timed_out";
  return "ok";
}

/** Human-readable fuse trip reason for office system message. */
export function formatMeetingFuseConclusion(
  check: Exclude<MeetingFuseCheck, "ok">,
  employeeId: string,
  settings?: MeetingFuseSettings,
): string {
  const s = settings ?? readMeetingFuseSettings();
  const state = readMeetingFuseState(employeeId);
  const rounds = state?.roundCount ?? 0;
  const elapsedSec = state ? Math.max(0, Math.floor((Date.now() - state.startedAt) / 1000)) : 0;
  if (check === "rounds_exceeded") {
    return `⏱ 开会熔断：已辩论 ${rounds} 轮（上限 ${s.maxRounds}），强制升级老板拍板。请老板明确答复后继续。`;
  }
  return `⏱ 开会熔断：已开会约 ${elapsedSec} 秒（上限 ${s.timeoutSec} 秒），强制升级老板拍板。请老板明确答复后继续。`;
}
