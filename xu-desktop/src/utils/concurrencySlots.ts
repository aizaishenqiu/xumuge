/**
 * Multi-project concurrency: warm-start from cached host profile;
 * local (VRAM) vs remote (UI stream) slots counted separately.
 */

import { invoke } from "@tauri-apps/api/core";
import { getLivePatch } from "../employee/events";
import { readEmployees, type Employee } from "./employees";

const LS_GLOBAL = "xu.concurrency.globalSlots";
const LS_PER_PROJECT = "xu.concurrency.perProjectSlots";
const LS_MODE = "xu.concurrency.mode";
const LS_KICKOFF_PARALLEL = "xu.concurrency.kickoffParallel";
const LS_KICKOFF_MAX = "xu.concurrency.kickoffMaxEmployees";
const LS_REMOTE_UNLIMITED = "xu.concurrency.remoteUnlimited";
const LS_REMOTE_SLOTS = "xu.concurrency.remoteSlots";
const LS_HOST_PROFILE = "xu.host.profile";
const DB_GLOBAL = "employee_slots";
const DB_PER_PROJECT = "project_slots";
const DB_MODE = "employee_slots_mode";
const DB_KICKOFF_PARALLEL = "kickoff_parallel";
const DB_KICKOFF_MAX = "kickoff_max_employees";
const DB_REMOTE_UNLIMITED = "kickoff_remote_unlimited";
const DB_REMOTE_SLOTS = "remote_slots";
const DB_HOST_PROFILE = "xu.host.profile";

/** 0 = 单次开工不限制总人数（仅受并行数约束）。自动探测后不再写入 0。 */
export const KICKOFF_MAX_UNLIMITED = 0;
const DEFAULT_KICKOFF_PARALLEL = 1;
const MIN_KICKOFF_PARALLEL = 1;
const MAX_KICKOFF_PARALLEL = 128;
const DEFAULT_REMOTE_SLOTS = 2;
/** Reuse host probe for 7 days so warm start skips nvidia-smi. */
export const HOST_PROFILE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type ConcurrencyMode = "auto" | "manual";

export interface ConcurrencyConfig {
  mode: ConcurrencyMode;
  globalSlots: number;
  perProjectSlots: number;
  /** 全体开工时每批并行派活人数 */
  kickoffParallel: number;
  /** 单次开工最多受理人数；0 = 不限制 */
  kickoffMaxEmployees: number;
  /**
   * Advanced: when true, remote API endpoints skip remote slot gate.
   * Default false — many simultaneous streams still freeze the office UI.
   */
  remoteUnlimited: boolean;
  /** Simultaneous remote-API employee streams (not VRAM). */
  remoteSlots: number;
}

export interface HostCapacity {
  cpuLogical: number;
  ramGb: number;
  gpuVramGb?: number | null;
  recommendedGlobalSlots: number;
  recommendedPerProject: number;
  recommendedLocalLlmSlots: number;
  recommendedLocalQps: number;
  recommendedRemoteSlots?: number;
  recommendedKickoffParallel?: number;
  recommendedKickoffMax?: number;
  probedAtMs?: number;
  rationale: string;
  remoteUnlimited: boolean;
}

export interface HostProfile {
  cpuLogical: number;
  ramGb: number;
  gpuVramGb?: number | null;
  probedAtMs: number;
  recommendedGlobalSlots: number;
  recommendedPerProject: number;
  recommendedLocalLlmSlots: number;
  recommendedLocalQps: number;
  recommendedRemoteSlots: number;
  recommendedKickoffParallel: number;
  recommendedKickoffMax: number;
  rationale: string;
}

function clampKickoffParallel(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_KICKOFF_PARALLEL;
  return Math.min(MAX_KICKOFF_PARALLEL, Math.max(MIN_KICKOFF_PARALLEL, Math.floor(n)));
}

function clampKickoffMaxEmployees(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return KICKOFF_MAX_UNLIMITED;
  return Math.min(999, Math.floor(n));
}

function clampRemoteSlots(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_REMOTE_SLOTS;
  return Math.min(4, Math.max(1, Math.floor(n)));
}

import { isSequentialQueueRunning } from "./projectQueue";

export function readKickoffParallel(): number {
  if (isSequentialQueueRunning()) return 1;
  return readConcurrencyConfig().kickoffParallel;
}

export function readKickoffMaxEmployees(): number {
  return readConcurrencyConfig().kickoffMaxEmployees;
}

export function isLocalLlmEndpoint(baseUrl: string | null | undefined): boolean {
  const u = (baseUrl || "").toLowerCase();
  return (
    u.includes("11434") ||
    u.includes("ollama") ||
    u.includes("localhost") ||
    u.includes("127.0.0.1") ||
    u.includes("0.0.0.0")
  );
}

export function isEmployeeLocalLlm(
  emp: Pick<Employee, "apiSource" | "aiBaseUrl">,
): boolean {
  if (emp.apiSource === "local") return true;
  if (emp.apiSource === "remote") return false;
  return isLocalLlmEndpoint(emp.aiBaseUrl);
}

export function isHostProfileFresh(probedAtMs: number, now = Date.now()): boolean {
  if (!Number.isFinite(probedAtMs) || probedAtMs <= 0) return false;
  return now - probedAtMs < HOST_PROFILE_TTL_MS;
}

export function hostCapacityToProfile(cap: HostCapacity): HostProfile {
  return {
    cpuLogical: cap.cpuLogical,
    ramGb: cap.ramGb,
    gpuVramGb: cap.gpuVramGb ?? null,
    probedAtMs: cap.probedAtMs && cap.probedAtMs > 0 ? cap.probedAtMs : Date.now(),
    recommendedGlobalSlots: Math.min(4, Math.max(1, cap.recommendedGlobalSlots || 1)),
    recommendedPerProject: Math.min(4, Math.max(1, cap.recommendedPerProject || 1)),
    recommendedLocalLlmSlots: Math.min(2, Math.max(1, cap.recommendedLocalLlmSlots || 1)),
    recommendedLocalQps: Math.max(1, cap.recommendedLocalQps || 1),
    recommendedRemoteSlots: clampRemoteSlots(cap.recommendedRemoteSlots ?? DEFAULT_REMOTE_SLOTS),
    recommendedKickoffParallel: clampKickoffParallel(cap.recommendedKickoffParallel ?? 1),
    recommendedKickoffMax: cap.recommendedKickoffMax && cap.recommendedKickoffMax > 0
      ? clampKickoffMaxEmployees(cap.recommendedKickoffMax)
      : 8,
    rationale: cap.rationale || "",
  };
}

export function hostProfileToCapacity(profile: HostProfile): HostCapacity {
  return {
    cpuLogical: profile.cpuLogical,
    ramGb: profile.ramGb,
    gpuVramGb: profile.gpuVramGb,
    recommendedGlobalSlots: profile.recommendedGlobalSlots,
    recommendedPerProject: profile.recommendedPerProject,
    recommendedLocalLlmSlots: profile.recommendedLocalLlmSlots,
    recommendedLocalQps: profile.recommendedLocalQps,
    recommendedRemoteSlots: profile.recommendedRemoteSlots,
    recommendedKickoffParallel: profile.recommendedKickoffParallel,
    recommendedKickoffMax: profile.recommendedKickoffMax,
    probedAtMs: profile.probedAtMs,
    rationale: profile.rationale,
    remoteUnlimited: false,
  };
}

function parseHostProfile(raw: unknown): HostProfile | null {
  if (raw == null) return null;
  let obj: Record<string, unknown>;
  if (typeof raw === "string") {
    const t = raw.trim();
    if (!t) return null;
    try {
      obj = JSON.parse(t) as Record<string, unknown>;
    } catch {
      return null;
    }
  } else if (typeof raw === "object") {
    obj = raw as Record<string, unknown>;
  } else {
    return null;
  }
  const probedAtMs = Number(obj.probedAtMs ?? obj.probed_at_ms ?? 0);
  const global = Number(obj.recommendedGlobalSlots ?? obj.recommended_global_slots ?? 0);
  if (!Number.isFinite(global) || global < 1) return null;
  return hostCapacityToProfile({
    cpuLogical: Number(obj.cpuLogical ?? obj.cpu_logical ?? 0) || 0,
    ramGb: Number(obj.ramGb ?? obj.ram_gb ?? 0) || 0,
    gpuVramGb: (obj.gpuVramGb ?? obj.gpu_vram_gb) as number | null | undefined,
    recommendedGlobalSlots: global,
    recommendedPerProject: Number(obj.recommendedPerProject ?? obj.recommended_per_project ?? 1),
    recommendedLocalLlmSlots: Number(
      obj.recommendedLocalLlmSlots ?? obj.recommended_local_llm_slots ?? 1,
    ),
    recommendedLocalQps: Number(obj.recommendedLocalQps ?? obj.recommended_local_qps ?? 1),
    recommendedRemoteSlots: Number(
      obj.recommendedRemoteSlots ?? obj.recommended_remote_slots ?? DEFAULT_REMOTE_SLOTS,
    ),
    recommendedKickoffParallel: Number(
      obj.recommendedKickoffParallel ?? obj.recommended_kickoff_parallel ?? 1,
    ),
    recommendedKickoffMax: Number(obj.recommendedKickoffMax ?? obj.recommended_kickoff_max ?? 8),
    probedAtMs,
    rationale: String(obj.rationale ?? ""),
    remoteUnlimited: false,
  });
}

export function readHostProfileSync(): HostProfile | null {
  try {
    return parseHostProfile(localStorage.getItem(LS_HOST_PROFILE));
  } catch {
    return null;
  }
}

export async function loadHostProfile(): Promise<HostProfile | null> {
  const fromLs = readHostProfileSync();
  if (fromLs) return fromLs;
  try {
    const raw = await invoke<string | null>("xu_get_setting", { key: DB_HOST_PROFILE });
    const parsed = parseHostProfile(raw);
    if (parsed) {
      try {
        localStorage.setItem(LS_HOST_PROFILE, JSON.stringify(parsed));
      } catch {
        /* ignore */
      }
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function persistHostProfile(profile: HostProfile): Promise<void> {
  const json = JSON.stringify(profile);
  try {
    localStorage.setItem(LS_HOST_PROFILE, json);
  } catch {
    /* ignore */
  }
  try {
    await invoke("xu_set_setting", { key: DB_HOST_PROFILE, value: json });
  } catch {
    /* ignore */
  }
}

export function formatHostProbeTime(probedAtMs: number): string {
  if (!Number.isFinite(probedAtMs) || probedAtMs <= 0) return "尚未探测";
  const d = new Date(probedAtMs);
  if (Number.isNaN(d.getTime())) return "尚未探测";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function readRemoteUnlimitedFlag(): boolean {
  try {
    return localStorage.getItem(LS_REMOTE_UNLIMITED) === "1";
  } catch {
    return false;
  }
}

export function readConcurrencyConfig(): ConcurrencyConfig {
  let globalSlots = 1;
  let perProjectSlots = 1;
  let mode: ConcurrencyMode = "auto";
  try {
    const m = localStorage.getItem(LS_MODE);
    if (m === "manual" || m === "auto") mode = m;
  } catch {
    /* ignore */
  }
  try {
    const g = Number(localStorage.getItem(LS_GLOBAL));
    if (Number.isFinite(g) && g >= 1 && g <= 4) globalSlots = Math.floor(g);
  } catch {
    /* ignore */
  }
  try {
    const p = Number(localStorage.getItem(LS_PER_PROJECT));
    if (Number.isFinite(p) && p >= 1 && p <= 4) perProjectSlots = Math.floor(p);
  } catch {
    /* ignore */
  }
  let kickoffParallel = DEFAULT_KICKOFF_PARALLEL;
  let kickoffMaxEmployees = KICKOFF_MAX_UNLIMITED;
  let remoteSlots = DEFAULT_REMOTE_SLOTS;
  try {
    const kp = Number(localStorage.getItem(LS_KICKOFF_PARALLEL));
    if (Number.isFinite(kp)) kickoffParallel = clampKickoffParallel(kp);
  } catch {
    /* ignore */
  }
  try {
    const km = Number(localStorage.getItem(LS_KICKOFF_MAX));
    if (Number.isFinite(km)) kickoffMaxEmployees = clampKickoffMaxEmployees(km);
  } catch {
    /* ignore */
  }
  try {
    const rs = Number(localStorage.getItem(LS_REMOTE_SLOTS));
    if (Number.isFinite(rs)) remoteSlots = clampRemoteSlots(rs);
  } catch {
    /* ignore */
  }
  return {
    mode,
    globalSlots,
    perProjectSlots,
    kickoffParallel,
    kickoffMaxEmployees,
    remoteUnlimited: readRemoteUnlimitedFlag(),
    remoteSlots,
  };
}

async function applyRuntimeSlots(
  cfg: Pick<ConcurrencyConfig, "globalSlots" | "perProjectSlots" | "remoteSlots" | "remoteUnlimited">,
  localLlmSlots: number,
): Promise<void> {
  await invoke("xu_apply_cached_employee_slots", {
    globalSlots: cfg.globalSlots,
    perProject: cfg.perProjectSlots,
    localLlmSlots: Math.min(2, Math.max(1, localLlmSlots)),
    remoteSlots: cfg.remoteSlots,
  });
  await invoke("xu_set_remote_unlimited", { unlimited: Boolean(cfg.remoteUnlimited) });
}

function writeSlotLocalStorage(cfg: ConcurrencyConfig): void {
  localStorage.setItem(LS_MODE, cfg.mode);
  localStorage.setItem(LS_GLOBAL, String(cfg.globalSlots));
  localStorage.setItem(LS_PER_PROJECT, String(cfg.perProjectSlots));
  localStorage.setItem(LS_KICKOFF_PARALLEL, String(cfg.kickoffParallel));
  localStorage.setItem(LS_KICKOFF_MAX, String(cfg.kickoffMaxEmployees));
  localStorage.setItem(LS_REMOTE_UNLIMITED, cfg.remoteUnlimited ? "1" : "0");
  localStorage.setItem(LS_REMOTE_SLOTS, String(cfg.remoteSlots));
}

async function writeSlotDb(cfg: ConcurrencyConfig, localLlmSlots?: number, localQps?: number): Promise<void> {
  await invoke("xu_set_setting", { key: DB_MODE, value: cfg.mode });
  await invoke("xu_set_setting", { key: DB_GLOBAL, value: String(cfg.globalSlots) });
  await invoke("xu_set_setting", { key: DB_PER_PROJECT, value: String(cfg.perProjectSlots) });
  await invoke("xu_set_setting", { key: DB_KICKOFF_PARALLEL, value: String(cfg.kickoffParallel) });
  await invoke("xu_set_setting", { key: DB_KICKOFF_MAX, value: String(cfg.kickoffMaxEmployees) });
  await invoke("xu_set_setting", {
    key: DB_REMOTE_UNLIMITED,
    value: cfg.remoteUnlimited ? "1" : "0",
  });
  await invoke("xu_set_setting", { key: DB_REMOTE_SLOTS, value: String(cfg.remoteSlots) });
  if (localLlmSlots != null) {
    await invoke("xu_set_setting", { key: "local_llm_slots", value: String(localLlmSlots) });
  }
  if (localQps != null) {
    await invoke("xu_set_setting", { key: "local_llm_qps", value: String(localQps) });
  }
}

export async function probeHostCapacity(modelHint?: string | null): Promise<HostCapacity> {
  return invoke<HostCapacity>("xu_probe_host_capacity", {
    modelHint: modelHint?.trim() || null,
  });
}

/** Probe host (nvidia-smi) and persist profile + kickoff caps. Use from Settings「探测并自动」. */
export async function applyAutoEmployeeSlots(modelHint?: string | null): Promise<HostCapacity> {
  const cap = await invoke<HostCapacity>("xu_apply_auto_employee_slots", {
    modelHint: modelHint?.trim() || null,
  });
  const profile = hostCapacityToProfile(cap);
  const cfg: ConcurrencyConfig = {
    mode: "auto",
    globalSlots: profile.recommendedGlobalSlots,
    perProjectSlots: profile.recommendedPerProject,
    kickoffParallel: profile.recommendedKickoffParallel,
    kickoffMaxEmployees: profile.recommendedKickoffMax,
    remoteUnlimited: readRemoteUnlimitedFlag(),
    remoteSlots: profile.recommendedRemoteSlots,
  };
  writeSlotLocalStorage(cfg);
  await persistHostProfile(profile);
  try {
    await writeSlotDb(cfg, profile.recommendedLocalLlmSlots, profile.recommendedLocalQps);
    await invoke("xu_set_remote_unlimited", { unlimited: cfg.remoteUnlimited });
  } catch {
    /* ignore */
  }
  return hostProfileToCapacity(profile);
}

async function modelHintFromBrains(): Promise<string | undefined> {
  try {
    const { loadOpsBrains } = await import("./opsBrains");
    const brains = await loadOpsBrains();
    return brains.work?.model || brains.code?.model;
  } catch {
    return undefined;
  }
}

/** Apply auto concurrency on app start: cache first, probe only when stale. */
export async function bootstrapConcurrency(): Promise<void> {
  try {
    const cfg = await loadConcurrencyConfig();
    const profile = await loadHostProfile();
    const localLlm = profile?.recommendedLocalLlmSlots ?? 1;

    if (cfg.mode !== "auto") {
      await applyRuntimeSlots(cfg, localLlm);
      return;
    }

    if (profile && isHostProfileFresh(profile.probedAtMs)) {
      const warm: ConcurrencyConfig = {
        ...cfg,
        globalSlots: profile.recommendedGlobalSlots,
        perProjectSlots: profile.recommendedPerProject,
        remoteSlots: profile.recommendedRemoteSlots,
      };
      writeSlotLocalStorage(warm);
      await applyRuntimeSlots(warm, profile.recommendedLocalLlmSlots);
      return;
    }

    if (profile) {
      const stale: ConcurrencyConfig = {
        ...cfg,
        globalSlots: profile.recommendedGlobalSlots,
        perProjectSlots: profile.recommendedPerProject,
        remoteSlots: profile.recommendedRemoteSlots,
      };
      await applyRuntimeSlots(stale, profile.recommendedLocalLlmSlots);
    }

    const hint = await modelHintFromBrains();
    window.setTimeout(() => {
      void applyAutoEmployeeSlots(hint).catch((e) => console.warn("bootstrapConcurrency probe", e));
    }, 0);
  } catch (e) {
    console.warn("bootstrapConcurrency", e);
  }
}

export async function loadConcurrencyConfig(): Promise<ConcurrencyConfig> {
  const local = readConcurrencyConfig();
  try {
    const g = await invoke<string | null>("xu_get_setting", { key: DB_GLOBAL });
    const p = await invoke<string | null>("xu_get_setting", { key: DB_PER_PROJECT });
    const m = await invoke<string | null>("xu_get_setting", { key: DB_MODE });
    const gn = g != null ? Number(g) : local.globalSlots;
    const pn = p != null ? Number(p) : local.perProjectSlots;
    const kpRaw = await invoke<string | null>("xu_get_setting", { key: DB_KICKOFF_PARALLEL });
    const kmRaw = await invoke<string | null>("xu_get_setting", { key: DB_KICKOFF_MAX });
    const ruRaw = await invoke<string | null>("xu_get_setting", { key: DB_REMOTE_UNLIMITED });
    const rsRaw = await invoke<string | null>("xu_get_setting", { key: DB_REMOTE_SLOTS });
    const mode: ConcurrencyMode =
      m === "manual" || m === "auto" ? m : local.mode === "manual" ? "manual" : "auto";
    const kp = kpRaw != null ? Number(kpRaw) : local.kickoffParallel;
    const km = kmRaw != null ? Number(kmRaw) : local.kickoffMaxEmployees;
    const rs = rsRaw != null ? Number(rsRaw) : local.remoteSlots;
    const remoteUnlimited =
      ruRaw === "1" || ruRaw === "true" ? true : ruRaw === "0" ? false : local.remoteUnlimited;
    return {
      mode,
      globalSlots: Number.isFinite(gn) ? Math.min(4, Math.max(1, Math.floor(gn))) : local.globalSlots,
      perProjectSlots: Number.isFinite(pn)
        ? Math.min(4, Math.max(1, Math.floor(pn)))
        : local.perProjectSlots,
      kickoffParallel: Number.isFinite(kp) ? clampKickoffParallel(kp) : local.kickoffParallel,
      kickoffMaxEmployees: Number.isFinite(km)
        ? clampKickoffMaxEmployees(km)
        : local.kickoffMaxEmployees,
      remoteUnlimited,
      remoteSlots: Number.isFinite(rs) ? clampRemoteSlots(rs) : local.remoteSlots,
    };
  } catch {
    return local;
  }
}

export async function saveConcurrencyConfig(cfg: ConcurrencyConfig): Promise<void> {
  const mode: ConcurrencyMode = cfg.mode === "manual" ? "manual" : "auto";
  let globalSlots = Math.min(4, Math.max(1, Math.floor(cfg.globalSlots)));
  let perProjectSlots = Math.min(4, Math.max(1, Math.floor(cfg.perProjectSlots)));
  const kickoffParallel = clampKickoffParallel(cfg.kickoffParallel);
  const kickoffMaxEmployees = clampKickoffMaxEmployees(cfg.kickoffMaxEmployees);
  const remoteUnlimited = Boolean(cfg.remoteUnlimited);
  let remoteSlots = clampRemoteSlots(cfg.remoteSlots);
  const profile = await loadHostProfile();

  if (mode === "auto") {
    if (profile) {
      globalSlots = profile.recommendedGlobalSlots;
      perProjectSlots = profile.recommendedPerProject;
      remoteSlots = profile.recommendedRemoteSlots;
    }
  }

  const next: ConcurrencyConfig = {
    mode,
    globalSlots,
    perProjectSlots,
    kickoffParallel,
    kickoffMaxEmployees,
    remoteUnlimited,
    remoteSlots,
  };

  try {
    await applyRuntimeSlots(next, profile?.recommendedLocalLlmSlots ?? 1);
  } catch (e) {
    console.warn("saveConcurrencyConfig runtime", e);
    try {
      await invoke("xu_set_employee_slots", {
        slots: globalSlots,
        perProject: perProjectSlots,
      });
    } catch {
      /* ignore */
    }
  }

  writeSlotLocalStorage(next);
  try {
    await writeSlotDb(next, profile?.recommendedLocalLlmSlots, profile?.recommendedLocalQps);
  } catch (e) {
    console.warn("saveConcurrencyConfig settings", e);
  }
}

function isEmployeeInFlight(e: Employee): boolean {
  if (e.roleKind === "boss") return false;
  if (e.status === "working" || e.status === "meeting") return true;
  const p = getLivePatch(e.id);
  return Boolean(p && (p.state === "working" || p.state === "tool" || p.state === "thinking"));
}

/** Count in-flight employee tasks (working/meeting with live patch). */
export function countActiveGlobalTasks(): number {
  return readEmployees().filter(isEmployeeInFlight).length;
}

export function countActiveLocalTasks(): number {
  return readEmployees().filter((e) => isEmployeeInFlight(e) && isEmployeeLocalLlm(e)).length;
}

export function countActiveRemoteTasks(): number {
  return readEmployees().filter((e) => isEmployeeInFlight(e) && !isEmployeeLocalLlm(e)).length;
}

/** Count active tasks attributed to a project (via live projectId). */
export function countActiveProjectTasks(projectId: string): number {
  if (!projectId) return 0;
  let n = 0;
  for (const e of readEmployees()) {
    if (e.roleKind === "boss") continue;
    if (e.status !== "working" && e.status !== "meeting") continue;
    const p = getLivePatch(e.id);
    if (p?.projectId === projectId) n += 1;
  }
  return n;
}

export type SlotGateResult =
  | { ok: true }
  | { ok: false; reason: "local" | "remote" | "project"; message: string };

export function evaluateDispatchSlotGate(input: {
  localEndpoint: boolean;
  remoteUnlimited: boolean;
  localActive: number;
  remoteActive: number;
  localSlots: number;
  remoteSlots: number;
  projectActive?: number;
  perProjectSlots?: number;
}): SlotGateResult {
  if (input.remoteUnlimited && !input.localEndpoint) {
    return { ok: true };
  }
  if (input.localEndpoint) {
    if (input.localActive >= input.localSlots) {
      return {
        ok: false,
        reason: "local",
        message: `等待本机槽（${input.localActive}/${input.localSlots}；本地模型吃显存/内存，勿一次开满）…`,
      };
    }
  } else if (input.remoteActive >= input.remoteSlots) {
    return {
      ok: false,
      reason: "remote",
      message: `等待远程流式槽（${input.remoteActive}/${input.remoteSlots}；远程不占显存，但仍限同时流式以免界面卡顿）…`,
    };
  }
  if (
    input.perProjectSlots != null &&
    input.projectActive != null &&
    input.projectActive >= input.perProjectSlots
  ) {
    return {
      ok: false,
      reason: "project",
      message: `等待项目执行槽（${input.projectActive}/${input.perProjectSlots}）…`,
    };
  }
  return { ok: true };
}

/**
 * Advisory gate: full slots mean wait/queue, not failure.
 * Remote unlimited skips only remote endpoints.
 */
export function checkDispatchSlots(
  projectId?: string | null,
  opts?: { baseUrl?: string | null },
): SlotGateResult {
  const cfg = readConcurrencyConfig();
  const localEndpoint = isLocalLlmEndpoint(opts?.baseUrl);
  return evaluateDispatchSlotGate({
    localEndpoint,
    remoteUnlimited: cfg.remoteUnlimited,
    localActive: countActiveLocalTasks(),
    remoteActive: countActiveRemoteTasks(),
    localSlots: cfg.globalSlots,
    remoteSlots: cfg.remoteSlots,
    projectActive: projectId ? countActiveProjectTasks(projectId) : undefined,
    perProjectSlots: projectId ? cfg.perProjectSlots : undefined,
  });
}
