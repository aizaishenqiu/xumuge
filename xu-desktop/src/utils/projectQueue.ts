/**
 * @file 严格顺序项目队列：持久化、排序与当前项
 * @author qiuye <yjk150@qq.com>
 * @date 2026-09-02
 * @version 1.0.0
 * @category Config
 * @algo sequential-project-queue
 */

import { invoke } from "@tauri-apps/api/core";

export const PROJECT_QUEUE_SETTING_KEY = "xu.project.queue";
export const PROJECT_QUEUE_CACHE_KEY = "xu.project.queue.cache";

export type ProjectQueueMode = "sequential";

export type ProjectQueueState = {
  enabled: boolean;
  mode: ProjectQueueMode;
  orderedProjectIds: string[];
  currentProjectId: string | null;
  autoAdvance: boolean;
};

export type AdvanceQueueResult = {
  ok: boolean;
  previousId: string | null;
  nextId: string | null;
  message: string;
};

export const DEFAULT_PROJECT_QUEUE: ProjectQueueState = {
  enabled: false,
  mode: "sequential",
  orderedProjectIds: [],
  currentProjectId: null,
  autoAdvance: true,
};

function normalizeQueue(raw: Partial<ProjectQueueState> | null | undefined): ProjectQueueState {
  const base = { ...DEFAULT_PROJECT_QUEUE, ...(raw || {}) };
  const ids = Array.isArray(base.orderedProjectIds)
    ? [...new Set(base.orderedProjectIds.map(String).filter(Boolean))]
    : [];
  const current = base.currentProjectId ? String(base.currentProjectId) : null;
  return {
    enabled: base.enabled === true,
    mode: "sequential",
    orderedProjectIds: ids,
    currentProjectId: current && ids.includes(current) ? current : ids[0] ?? null,
    autoAdvance: base.autoAdvance !== false,
  };
}

function writeCache(state: ProjectQueueState): void {
  try {
    localStorage.setItem(PROJECT_QUEUE_CACHE_KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

function readCache(): ProjectQueueState | null {
  try {
    const raw = localStorage.getItem(PROJECT_QUEUE_CACHE_KEY);
    if (!raw) return null;
    return normalizeQueue(JSON.parse(raw) as Partial<ProjectQueueState>);
  } catch {
    return null;
  }
}

function emitQueueChanged(state: ProjectQueueState): void {
  window.dispatchEvent(
    new CustomEvent("xu-project-queue-changed", { detail: state }),
  );
}

/** Sync read for concurrency gate (mirrored on save). */
export function readProjectQueueSync(): ProjectQueueState {
  return readCache() ?? { ...DEFAULT_PROJECT_QUEUE };
}

/** Queue enabled and has a current project — sequential mode active. */
export function isSequentialQueueRunning(): boolean {
  const q = readProjectQueueSync();
  return q.enabled && q.orderedProjectIds.length > 0 && Boolean(q.currentProjectId);
}

export async function loadProjectQueue(): Promise<ProjectQueueState> {
  try {
    const raw = await invoke<string | null>("xu_get_setting", { key: PROJECT_QUEUE_SETTING_KEY });
    if (!raw) {
      const cached = readCache();
      return cached ?? { ...DEFAULT_PROJECT_QUEUE };
    }
    const state = normalizeQueue(JSON.parse(raw) as Partial<ProjectQueueState>);
    writeCache(state);
    return state;
  } catch {
    return readCache() ?? { ...DEFAULT_PROJECT_QUEUE };
  }
}

export async function saveProjectQueue(
  patch: Partial<ProjectQueueState>,
): Promise<ProjectQueueState> {
  const merged = normalizeQueue({ ...(await loadProjectQueue()), ...patch });
  await invoke("xu_set_setting", {
    key: PROJECT_QUEUE_SETTING_KEY,
    value: JSON.stringify(merged),
  });
  writeCache(merged);
  emitQueueChanged(merged);
  return merged;
}

export async function enqueueProjects(projectIds: string[]): Promise<ProjectQueueState> {
  const q = await loadProjectQueue();
  const add = projectIds.map(String).filter(Boolean);
  const merged = [...q.orderedProjectIds];
  for (const id of add) {
    if (!merged.includes(id)) merged.push(id);
  }
  const current = q.currentProjectId && merged.includes(q.currentProjectId)
    ? q.currentProjectId
    : merged[0] ?? null;
  return saveProjectQueue({
    orderedProjectIds: merged,
    currentProjectId: current,
    enabled: merged.length > 0 ? true : q.enabled,
  });
}

export async function removeFromQueue(projectId: string): Promise<ProjectQueueState> {
  const q = await loadProjectQueue();
  const merged = q.orderedProjectIds.filter((id) => id !== projectId);
  let current = q.currentProjectId;
  if (current === projectId) {
    current = merged[0] ?? null;
  } else if (current && !merged.includes(current)) {
    current = merged[0] ?? null;
  }
  return saveProjectQueue({
    orderedProjectIds: merged,
    currentProjectId: current,
    enabled: merged.length > 0 && q.enabled,
  });
}

export async function reorderQueue(projectIds: string[]): Promise<ProjectQueueState> {
  const q = await loadProjectQueue();
  const allowed = new Set(q.orderedProjectIds);
  const next = projectIds.filter((id) => allowed.has(id));
  for (const id of q.orderedProjectIds) {
    if (!next.includes(id)) next.push(id);
  }
  const current =
    q.currentProjectId && next.includes(q.currentProjectId)
      ? q.currentProjectId
      : next[0] ?? null;
  return saveProjectQueue({ orderedProjectIds: next, currentProjectId: current });
}

export async function moveQueueItem(projectId: string, dir: -1 | 1): Promise<ProjectQueueState> {
  const q = await loadProjectQueue();
  const idx = q.orderedProjectIds.indexOf(projectId);
  if (idx < 0) return q;
  const next = [...q.orderedProjectIds];
  const j = idx + dir;
  if (j < 0 || j >= next.length) return q;
  [next[idx], next[j]] = [next[j]!, next[idx]!];
  return reorderQueue(next);
}

export async function setCurrentQueueProject(projectId: string | null): Promise<ProjectQueueState> {
  const q = await loadProjectQueue();
  if (projectId && !q.orderedProjectIds.includes(projectId)) {
    throw new Error("该项目不在队列中");
  }
  return saveProjectQueue({ currentProjectId: projectId });
}

export async function clearProjectQueue(): Promise<ProjectQueueState> {
  return saveProjectQueue({
    enabled: false,
    orderedProjectIds: [],
    currentProjectId: null,
  });
}

export function queuePosition(state: ProjectQueueState, projectId: string): number {
  const idx = state.orderedProjectIds.indexOf(projectId);
  return idx < 0 ? -1 : idx + 1;
}

/** Pop current and set next as current (does not start kickoff). */
export async function advanceQueuePointer(): Promise<AdvanceQueueResult> {
  const q = await loadProjectQueue();
  const prev = q.currentProjectId;
  if (!prev || !q.orderedProjectIds.length) {
    return { ok: false, previousId: prev, nextId: null, message: "队列为空" };
  }
  const idx = q.orderedProjectIds.indexOf(prev);
  const rest = q.orderedProjectIds.filter((id) => id !== prev);
  const nextId = idx >= 0 && idx + 1 < q.orderedProjectIds.length
    ? q.orderedProjectIds[idx + 1]!
    : rest[0] ?? null;
  await saveProjectQueue({
    orderedProjectIds: rest,
    currentProjectId: nextId,
    enabled: rest.length > 0,
  });
  return {
    ok: true,
    previousId: prev,
    nextId,
    message: nextId ? "已切换到下一项" : "队列已全部完成",
  };
}
