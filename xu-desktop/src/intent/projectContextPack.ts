/**
 * Project-local context pack — lightweight grep retrieval from Brief keywords.
 * No vector RAG; aligns with local-context-router Skill.
 */
import { invoke } from "@tauri-apps/api/core";
import type { RequirementBrief } from "./briefTypes";
import { searchSemanticIndex } from "./projectSemanticIndex";
import { searchEmbeddingIndex } from "./projectEmbeddingIndex";

const memCache = new Map<string, { at: number; pack: string }>();
const CACHE_TTL_MS = 5 * 60 * 1000;

const STOP_WORDS = new Set([
  "项目",
  "系统",
  "功能",
  "完成",
  "需要",
  "实现",
  "用户",
  "可以",
  "进行",
  "一个",
  "我们",
  "the",
  "and",
  "for",
]);

/** Pull 3–5 grep-friendly terms from Brief (no LLM). */
export function extractBriefSearchTerms(brief: RequirementBrief): string[] {
  const raw = [
    brief.goal,
    brief.industry,
    brief.uxNotes,
    brief.audience,
    brief.architectureNotes,
    ...brief.scopeIn.slice(0, 4),
    ...brief.acceptance.slice(0, 3),
  ]
    .filter(Boolean)
    .join("\n");

  const terms: string[] = [];
  const seen = new Set<string>();
  const matches = raw.match(/[\u4e00-\u9fa5]{2,10}|[A-Za-z][A-Za-z0-9_.-]{2,24}/g) || [];
  for (const w of matches) {
    const k = w.toLowerCase();
    if (STOP_WORDS.has(w) || STOP_WORDS.has(k)) continue;
    if (seen.has(k)) continue;
    seen.add(k);
    terms.push(w);
    if (terms.length >= 5) break;
  }
  return terms;
}

function parseGrepLines(raw: string, workspace: string): { path: string; line: number; text: string }[] {
  const ws = workspace.replace(/\\/g, "/").replace(/\/$/, "");
  const out: { path: string; line: number; text: string }[] = [];
  for (const row of raw.split(/\r?\n/)) {
    if (!row.trim()) continue;
    const m = row.match(/^(.+?):(\d+):(.*)$/);
    if (!m) continue;
    let p = m[1]!;
    if (!/^[A-Za-z]:/.test(p) && !p.startsWith("/")) {
      p = `${ws}/${p.replace(/^\.\//, "")}`;
    }
    out.push({
      path: p.replace(/\\/g, "/"),
      line: Number(m[2]),
      text: (m[3] || "").trim().slice(0, 120),
    });
  }
  return out;
}

function relPath(workspace: string, abs: string): string {
  const w = workspace.replace(/\\/g, "/").replace(/\/$/, "");
  const a = abs.replace(/\\/g, "/");
  if (a.startsWith(w + "/")) return a.slice(w.length + 1);
  return a;
}

async function grepTerm(workspace: string, term: string, maxHits = 12): Promise<string[]> {
  try {
    const raw = await invoke<string>("grep_workspace", {
      workspace,
      pattern: term,
      maxHits,
    });
    const rows = parseGrepLines(raw, workspace);
    return rows.map((r) => `${relPath(workspace, r.path)}:${r.line} ${r.text}`);
  } catch {
    return [];
  }
}

export type ProjectContextPackResult = {
  terms: string[];
  lines: string[];
  pack: string;
};

/**
 * Build a compact LOCAL_CONTEXT_PACK for dispatch injection.
 * Cached per project + brief version + terms (memory, 5 min).
 */
export async function buildProjectContextPack(opts: {
  workspaceRoot: string;
  brief: RequirementBrief;
  /** When true, merge semantic-lite index hits (PoC) */
  includeSemantic?: boolean;
  /** When true, merge embedding vector hits */
  includeEmbedding?: boolean;
}): Promise<ProjectContextPackResult> {
  const root = opts.workspaceRoot.replace(/[/\\]+$/, "");
  const terms = extractBriefSearchTerms(opts.brief);
  const cacheKey = `${opts.brief.projectId}:v${opts.brief.version || 0}:${terms.join("|")}`;
  const hit = memCache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return { terms, lines: hit.pack.split("\n").filter(Boolean), pack: hit.pack };
  }

  if (!root || !terms.length) {
    const pack = "（Brief 关键词不足，派活后请员工自行 list_dir / grep_search）";
    return { terms, lines: [], pack };
  }

  const lines: string[] = [];
  for (const term of terms.slice(0, 4)) {
    const hits = await grepTerm(root, term, 10);
    if (!hits.length) continue;
    lines.push(`- term「${term}」:`);
    for (const h of hits.slice(0, 6)) {
      lines.push(`  ${h}`);
    }
    if (lines.length >= 24) break;
  }

  const packParts: string[] = [];
  if (lines.length > 0) {
    packParts.push(["LOCAL_CONTEXT_PACK（本地预检索 · grep）:", ...lines].join("\n"));
  } else if (!opts.includeSemantic) {
    packParts.push("LOCAL_CONTEXT_PACK: （未命中文件，请先 list_dir 再 grep_search）");
  }

  if (opts.includeSemantic) {
    try {
      const sem = await searchSemanticIndex({
        workspaceRoot: root,
        brief: opts.brief,
        rebuildIfStale: false,
      });
      if (sem.pack) packParts.push(sem.pack);
    } catch {
      /* ignore */
    }
  }

  if (opts.includeEmbedding) {
    try {
      const emb = await searchEmbeddingIndex({
        workspaceRoot: root,
        brief: opts.brief,
      });
      if (emb.pack) packParts.push(emb.pack);
    } catch {
      /* ignore */
    }
  }

  const pack =
    packParts.length > 0
      ? packParts.join("\n\n")
      : "LOCAL_CONTEXT_PACK: （未命中；请 list_dir / 开启语义索引后确认 Brief 重建）";

  memCache.set(cacheKey, { at: Date.now(), pack });
  return { terms, lines, pack };
}

/** Invalidate cache when Brief version bumps (optional call from briefStore). */
export function invalidateProjectContextCache(projectId?: string): void {
  if (!projectId) {
    memCache.clear();
    return;
  }
  for (const k of memCache.keys()) {
    if (k.startsWith(`${projectId}:`)) memCache.delete(k);
  }
}
