/**
 * Project embedding index — OpenAI-compatible /api/embeddings (Ollama nomic-embed-text, etc.)
 * Index: `.xu/embedding-index.json`
 */
import { invoke } from "@tauri-apps/api/core";
import { listDir, readTextFile, writeTextUnderWorkspace, type FsDirEntry } from "../utils/fsBridge";
import { resolveEndpoint, type ResolvedEndpoint } from "../utils/opsBrains";
import { loadCodeExecPrefs } from "../utils/codeExecPrefs";
import type { RequirementBrief } from "./briefTypes";
import { extractBriefSearchTerms } from "./projectContextPack";

export const EMBEDDING_INDEX_REL = ".xu/embedding-index.json";
const MAX_FILES = 40;
const MAX_FILE_BYTES = 24_000;
const CHUNK_SIZE = 680;
const CHUNK_STEP = 520;
const EMBED_BATCH = 8;

const CODE_EXT = /\.(ts|tsx|vue|js|jsx|md|rs|py|go|java|sql|json|yaml|yml)$/i;

export interface EmbeddingChunk {
  path: string;
  start: number;
  preview: string;
  vec: number[];
}

export interface EmbeddingIndexFile {
  briefVersion: number;
  builtAt: number;
  model: string;
  fileCount: number;
  chunks: EmbeddingChunk[];
}

function cosineFloat(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const va = a[i]!;
    const vb = b[i]!;
    dot += va * vb;
    na += va * va;
    nb += vb * vb;
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
      if (e.is_dir) queue.push(e.path);
      else if (CODE_EXT.test(name) && (e.size || 0) <= MAX_FILE_BYTES) {
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


async function collectChunksAsync(
  root: string,
  files: string[],
): Promise<Omit<EmbeddingChunk, "vec">[]> {
  const chunks: Omit<EmbeddingChunk, "vec">[] = [];
  for (const abs of files) {
    let text = "";
    try {
      text = await readTextFile(abs);
    } catch {
      continue;
    }
    if (text.length > MAX_FILE_BYTES) text = text.slice(0, MAX_FILE_BYTES);
    const rel = relPath(root, abs);
    const clean = text.replace(/\r\n/g, "\n");
    for (let i = 0; i < clean.length; i += CHUNK_STEP) {
      const slice = clean.slice(i, i + CHUNK_SIZE);
      if (slice.trim().length < 48) break;
      chunks.push({
        path: rel,
        start: i,
        preview: slice.trim().replace(/\s+/g, " ").slice(0, 160),
      });
      if (chunks.filter((c) => c.path === rel).length >= 5) break;
    }
    if (chunks.length >= 120) break;
  }
  return chunks;
}

export function resolveEmbeddingModel(ep: ResolvedEndpoint, override?: string): string {
  const o = (override || "").trim();
  if (o) return o;
  if (/11434|ollama/i.test(ep.baseUrl)) return "nomic-embed-text";
  if (/openai|api\.openai/i.test(ep.baseUrl)) return "text-embedding-3-small";
  return "text-embedding-3-small";
}

async function embedTexts(
  ep: ResolvedEndpoint,
  model: string,
  texts: string[],
): Promise<number[][]> {
  const vectors = await invoke<number[][]>("xu_embed_texts", {
    baseUrl: ep.baseUrl,
    model,
    apiKeyEnv: ep.apiKeyEnv || "",
    texts,
  });
  return vectors || [];
}

export async function rebuildEmbeddingIndex(opts: {
  workspaceRoot: string;
  brief: RequirementBrief;
}): Promise<EmbeddingIndexFile | null> {
  const root = opts.workspaceRoot.replace(/[/\\]+$/, "");
  const ep = await resolveEndpoint({ slot: "work" });
  if (!ep.baseUrl || !ep.model) return null;

  const prefs = await loadCodeExecPrefs();
  const model = resolveEmbeddingModel(ep, prefs.embeddingModel);

  const files = await walkCodeFiles(root);
  const rawChunks = await collectChunksAsync(root, files);
  if (!rawChunks.length) return null;

  const embedded: EmbeddingChunk[] = [];
  for (let i = 0; i < rawChunks.length; i += EMBED_BATCH) {
    const batch = rawChunks.slice(i, i + EMBED_BATCH);
    const texts = batch.map((c) => `${c.path}\n${c.preview}`);
    try {
      const vecs = await embedTexts(ep, model, texts);
      for (let j = 0; j < batch.length; j++) {
        const vec = vecs[j];
        if (!vec?.length) continue;
        embedded.push({ ...batch[j]!, vec });
      }
    } catch {
      break;
    }
  }

  if (!embedded.length) return null;

  const index: EmbeddingIndexFile = {
    briefVersion: opts.brief.version || 0,
    builtAt: Date.now(),
    model,
    fileCount: files.length,
    chunks: embedded,
  };
  await writeTextUnderWorkspace(root, EMBEDDING_INDEX_REL, JSON.stringify(index));
  return index;
}

async function loadEmbeddingIndex(workspaceRoot: string): Promise<EmbeddingIndexFile | null> {
  const root = workspaceRoot.replace(/[/\\]+$/, "");
  try {
    const raw = await readTextFile(`${root}/${EMBEDDING_INDEX_REL}`.replace(/\\/g, "/"));
    return JSON.parse(raw) as EmbeddingIndexFile;
  } catch {
    return null;
  }
}

export async function searchEmbeddingIndex(opts: {
  workspaceRoot: string;
  brief: RequirementBrief;
  topK?: number;
}): Promise<{ hits: { path: string; start: number; preview: string; score: number }[]; pack: string }> {
  const root = opts.workspaceRoot.replace(/[/\\]+$/, "");
  let index = await loadEmbeddingIndex(root);
  if (!index?.chunks.length) {
    index = await rebuildEmbeddingIndex({ workspaceRoot: root, brief: opts.brief });
  }
  if (!index?.chunks.length) return { hits: [], pack: "" };

  const ep = await resolveEndpoint({ slot: "work" });
  if (!ep.baseUrl) return { hits: [], pack: "" };

  const terms = extractBriefSearchTerms(opts.brief);
  const queryText = [opts.brief.goal, ...terms, opts.brief.architectureNotes || ""].join("\n");
  let qVec: number[] = [];
  try {
    const model = resolveEmbeddingModel(ep, (await loadCodeExecPrefs()).embeddingModel);
    const vecs = await embedTexts(ep, model, [queryText]);
    qVec = vecs[0] || [];
  } catch {
    return { hits: [], pack: "" };
  }
  if (!qVec.length) return { hits: [], pack: "" };

  const scored = index.chunks
    .map((c) => ({ ...c, score: cosineFloat(qVec, c.vec) }))
    .filter((c) => c.score > 0.15)
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
          `EMBEDDING_CONTEXT_PACK（向量检索 · ${index.model}）:`,
          ...hits.map((h) => `  ${h.path}@${h.start} score=${h.score} ${h.preview}`),
        ].join("\n")
      : "";

  return { hits, pack };
}
