/**
 * Semantic-lite project index (PoC) — TF cosine on token bags, no external embedding API.
 * Optional; default off. Index stored at `.xu/semantic-index.json`.
 */
import { listDir, readTextFile, writeTextUnderWorkspace, type FsDirEntry } from "../utils/fsBridge";
import type { RequirementBrief } from "./briefTypes";
import { extractBriefSearchTerms } from "./projectContextPack";

const INDEX_REL = ".xu/semantic-index.json";
const MAX_FILES = 48;
const MAX_FILE_BYTES = 28_000;
const CHUNK_SIZE = 720;
const CHUNK_STEP = 560;

const CODE_EXT = /\.(ts|tsx|vue|js|jsx|md|rs|py|go|java|kt|sql|json|yaml|yml)$/i;

export interface SemanticChunk {
  path: string;
  start: number;
  preview: string;
  /** Normalized term-frequency vector */
  vec: Record<string, number>;
}

export interface SemanticIndexFile {
  briefVersion: number;
  builtAt: number;
  fileCount: number;
  chunks: SemanticChunk[];
}

function tokenize(text: string): string[] {
  const out: string[] = [];
  const matches = text.toLowerCase().match(/[\u4e00-\u9fa5]{2,8}|[a-z][a-z0-9_.-]{2,24}/g) || [];
  for (const t of matches) {
    if (t.length < 2) continue;
    out.push(t);
  }
  return out;
}

function termFreq(tokens: string[]): Record<string, number> {
  const tf: Record<string, number> = {};
  for (const t of tokens) {
    tf[t] = (tf[t] || 0) + 1;
  }
  const n = tokens.length || 1;
  for (const k of Object.keys(tf)) {
    tf[k] = tf[k]! / n;
  }
  return tf;
}

function cosine(a: Record<string, number>, b: Record<string, number>): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const v of Object.values(a)) na += v * v;
  for (const v of Object.values(b)) nb += v * v;
  for (const [k, va] of Object.entries(a)) {
    const vb = b[k];
    if (vb) dot += va * vb;
  }
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

async function walkCodeFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  const queue = [root];
  while (queue.length && out.length < MAX_FILES) {
    const dir = queue.shift()!;
    let entries: FsDirEntry[] = [];
    try {
      entries = await listDir(dir, false);
    } catch {
      continue;
    }
    for (const e of entries) {
      if (out.length >= MAX_FILES) break;
      const name = e.name || "";
      if (/node_modules|\.git|dist|target|\.fou|coverage|build/i.test(name)) continue;
      if (e.is_dir) {
        queue.push(e.path);
      } else if (CODE_EXT.test(name) && (e.size || 0) <= MAX_FILE_BYTES) {
        out.push(e.path.replace(/\\/g, "/"));
      }
    }
  }
  return out;
}

function relPath(workspace: string, abs: string): string {
  const w = workspace.replace(/\\/g, "/").replace(/\/$/, "");
  const a = abs.replace(/\\/g, "/");
  if (a.startsWith(w + "/")) return a.slice(w.length + 1);
  return a;
}

function chunkFile(rel: string, text: string): SemanticChunk[] {
  const chunks: SemanticChunk[] = [];
  const clean = text.replace(/\r\n/g, "\n");
  for (let i = 0; i < clean.length; i += CHUNK_STEP) {
    const slice = clean.slice(i, i + CHUNK_SIZE);
    if (slice.trim().length < 40) break;
    const tokens = tokenize(slice);
    if (!tokens.length) continue;
    chunks.push({
      path: rel,
      start: i,
      preview: slice.trim().replace(/\s+/g, " ").slice(0, 160),
      vec: termFreq(tokens),
    });
    if (chunks.length >= 6) break;
  }
  return chunks;
}

export async function rebuildSemanticIndex(opts: {
  workspaceRoot: string;
  brief: RequirementBrief;
}): Promise<SemanticIndexFile> {
  const root = opts.workspaceRoot.replace(/[/\\]+$/, "");
  const files = await walkCodeFiles(root);
  const chunks: SemanticChunk[] = [];
  for (const abs of files) {
    let text = "";
    try {
      text = await readTextFile(abs);
    } catch {
      continue;
    }
    if (text.length > MAX_FILE_BYTES) text = text.slice(0, MAX_FILE_BYTES);
    chunks.push(...chunkFile(relPath(root, abs), text));
    if (chunks.length >= 220) break;
  }
  const index: SemanticIndexFile = {
    briefVersion: opts.brief.version || 0,
    builtAt: Date.now(),
    fileCount: files.length,
    chunks,
  };
  await writeTextUnderWorkspace(root, INDEX_REL, JSON.stringify(index, null, 2));
  return index;
}

async function loadSemanticIndex(workspaceRoot: string): Promise<SemanticIndexFile | null> {
  const root = workspaceRoot.replace(/[/\\]+$/, "");
  try {
    const raw = await readTextFile(`${root}/${INDEX_REL}`.replace(/\\/g, "/"));
    return JSON.parse(raw) as SemanticIndexFile;
  } catch {
    return null;
  }
}

export async function searchSemanticIndex(opts: {
  workspaceRoot: string;
  brief: RequirementBrief;
  topK?: number;
  rebuildIfStale?: boolean;
}): Promise<{ hits: { path: string; start: number; preview: string; score: number }[]; pack: string }> {
  const root = opts.workspaceRoot.replace(/[/\\]+$/, "");
  let index = await loadSemanticIndex(root);
  const ver = opts.brief.version || 0;
  if (!index || (opts.rebuildIfStale && index.briefVersion !== ver)) {
    index = await rebuildSemanticIndex({ workspaceRoot: root, brief: opts.brief });
  }
  if (!index?.chunks.length) {
    return { hits: [], pack: "" };
  }

  const terms = extractBriefSearchTerms(opts.brief);
  const queryText = [opts.brief.goal, ...terms, opts.brief.architectureNotes || ""].join(" ");
  const qVec = termFreq(tokenize(queryText));
  const scored = index.chunks
    .map((c) => ({ ...c, score: cosine(qVec, c.vec) }))
    .filter((c) => c.score > 0.02)
    .sort((a, b) => b.score - a.score)
    .slice(0, opts.topK ?? 8);

  const hits = scored.map((c) => ({
    path: c.path,
    start: c.start,
    preview: c.preview,
    score: Math.round(c.score * 1000) / 1000,
  }));

  const pack =
    hits.length > 0
      ? [
          "SEMANTIC_CONTEXT_PACK（语义-lite 索引 PoC · TF 余弦，非 embedding API）:",
          ...hits.map((h) => `  ${h.path}@${h.start} score=${h.score} ${h.preview}`),
        ].join("\n")
      : "";

  return { hits, pack };
}

export function semanticIndexRelPath(): string {
  return INDEX_REL;
}
