/**
 * 虚募阁 memories (scheme A) — Hermes MEMORY.md is not used at runtime.
 */
import { invoke } from "@tauri-apps/api/core";

export type MemoryScope = "global" | "employee" | "project";

export interface XuMemory {
  id: string;
  scope: MemoryScope | string;
  scopeId?: string | null;
  title: string;
  body: string;
  tags: string;
  source: string;
  pinned: boolean;
  createdAt: number;
  updatedAt: number;
}

export async function listMemories(opts?: {
  scope?: string;
  scopeId?: string;
  limit?: number;
}): Promise<XuMemory[]> {
  return invoke<XuMemory[]>("xu_list_memories", {
    scope: opts?.scope ?? null,
    scopeId: opts?.scopeId ?? null,
    limit: opts?.limit ?? 50,
  });
}

export async function upsertMemory(input: {
  id?: string;
  scope: string;
  scopeId?: string | null;
  title?: string;
  body: string;
  tags?: string;
  source?: string;
  pinned?: boolean;
}): Promise<XuMemory> {
  return invoke<XuMemory>("xu_upsert_memory", { payload: input });
}

export async function deleteMemory(id: string): Promise<void> {
  await invoke("xu_delete_memory", { id });
}

export async function buildMemoryPreamble(opts?: {
  employeeId?: string;
  employeeName?: string;
  projectId?: string;
  taskHint?: string;
}): Promise<string> {
  return invoke<string>("xu_build_memory_preamble", {
    employeeId: opts?.employeeId ?? null,
    employeeName: opts?.employeeName ?? null,
    projectId: opts?.projectId ?? null,
    taskHint: opts?.taskHint ?? null,
  });
}

export interface MemoryCorpusStats {
  usedTokens: number;
  maxTokens: number;
  memoryCount: number;
  chunkCount: number;
  injectMaxTokens: number;
}

export async function memoryCorpusStats(): Promise<MemoryCorpusStats> {
  return invoke<MemoryCorpusStats>("xu_memory_corpus_stats");
}

/** `/记住 …` / `/remember …` — body after command; null if not a remember command. */
export function parseRememberCommand(text: string): string | null {
  const t = text.trim();
  const m = t.match(/^\/(?:记住|remember)\s*[:：]?\s*([\s\S]+)$/i);
  if (!m) return null;
  const body = m[1].trim();
  return body.length ? body : null;
}

/** Manual remember: pin as pref/constraint-ish global or project memory. */
export async function rememberUserNote(opts: {
  body: string;
  projectId?: string | null;
  employeeId?: string | null;
  title?: string;
}): Promise<XuMemory> {
  const body = opts.body.trim();
  if (!body) throw new Error("请填写要记住的内容");
  const title =
    opts.title?.trim() ||
    `手动记忆：${body.slice(0, 36)}${body.length > 36 ? "…" : ""}`;
  const scope = opts.employeeId ? "employee" : opts.projectId ? "project" : "global";
  const scopeId = opts.employeeId || opts.projectId || null;
  const looksConstraint = /禁止|不要|别再|不得|never/i.test(body);
  return upsertMemory({
    scope,
    scopeId,
    title,
    body,
    tags: JSON.stringify([
      looksConstraint ? "constraint" : "pref",
      "manual",
      "structured",
    ]),
    source: "manual",
    pinned: true,
  });
}

export interface TokenPackageStatus {
  usedTokens: number;
  hardLimit: number;
  softLimit: number;
  remaining: number;
  softHit: boolean;
  hardHit: boolean;
  message: string;
}

export async function tokenPackageStatus(): Promise<TokenPackageStatus> {
  return invoke<TokenPackageStatus>("xu_token_package_status");
}

export async function setTokenPackage(opts: {
  hardLimit: number;
  softRatio?: number;
  resetUsage?: boolean;
}): Promise<TokenPackageStatus> {
  return invoke<TokenPackageStatus>("xu_set_token_package", {
    payload: {
      hardLimit: opts.hardLimit,
      softRatio: opts.softRatio ?? null,
      resetUsage: opts.resetUsage ?? false,
    },
  });
}
