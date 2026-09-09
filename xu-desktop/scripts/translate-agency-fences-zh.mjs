/**
 * 将岗位 prompt 围栏内用户可见英文译为中文。
 * - 模板/markdown 围栏：翻译说明文字，保护占位符与 css 变量名
 * - 代码围栏：仅翻译行注释与块注释，不改动标识符与语法
 *
 * node scripts/translate-agency-fences-zh.mjs [--limit=N] [--role=id] [--force]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const CATALOG = path.join(ROOT, "src/office/agencyCatalog.generated.json");
const WORK = path.join(ROOT, ".cache/agency-zh-work/fence-translate");
const PROGRESS = path.join(WORK, "_progress.json");

fs.mkdirSync(WORK, { recursive: true });

const args = process.argv.slice(2);
const LIMIT = Number(args.find((a) => a.startsWith("--limit="))?.split("=")[1] || Infinity);
const ONLY_ROLE = args.find((a) => a.startsWith("--role="))?.split("=")[1] || null;
const FORCE = args.includes("--force");
const RETRY_FAILED = args.includes("--retry-failed");

/** 单段最大字符，避免 431；502 时靠降速 + 备用 API */
const CHUNK_MAX = 480;
const MIN_GAP_MS = 280;

let consecutive502 = 0;
let lastRequestAt = 0;

async function throttle() {
  const gap = MIN_GAP_MS + Math.floor(Math.random() * 120);
  const wait = lastRequestAt + gap - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();
}

async function fetchSimply(text) {
  const url =
    "https://simplytranslate.org/api/translate?engine=google&from=en&to=zh-CN&text=" +
    encodeURIComponent(text);
  const res = await fetch(url, { signal: AbortSignal.timeout(35000) });
  if (!res.ok) throw new Error(`simply HTTP ${res.status}`);
  const data = await res.json();
  const out = data?.translated_text?.trim();
  if (!out) throw new Error("simply empty");
  return out;
}

async function fetchMyMemory(text) {
  const url =
    "https://api.mymemory.translated.net/get?langpair=en%7Czh-CN&q=" + encodeURIComponent(text);
  const res = await fetch(url, { signal: AbortSignal.timeout(35000) });
  if (!res.ok) throw new Error(`mymemory HTTP ${res.status}`);
  const data = await res.json();
  const out = data?.responseData?.translatedText?.trim();
  if (!out || data.responseStatus !== 200) throw new Error(data?.responseDetails || "mymemory empty");
  if (/MYMEMORY WARNING|QUOTA EXCEEDED/i.test(out)) throw new Error("mymemory quota");
  return out;
}

const BACKENDS = [
  { name: "simply", fetch: fetchSimply },
  { name: "mymemory", fetch: fetchMyMemory },
];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function enRatio(s) {
  const zh = (s.match(/[\u4e00-\u9fff]/g) || []).length;
  const en = (s.match(/[A-Za-z]/g) || []).length;
  return en + zh ? en / (en + zh) : 0;
}

function fenceNeedsWork(inner) {
  const ew = (inner.match(/\b[A-Za-z]{3,}\b/g) || []).length;
  const zh = (inner.match(/[\u4e00-\u9fff]/g) || []).length;
  return ew > 3 && ew > zh * 0.6;
}

function hash(s) {
  return crypto.createHash("sha1").update(s).digest("hex").slice(0, 12);
}


function protect(s) {
  const map = new Map();
  let out = s;
  let n = 0;
  const patterns = [
    [/`[^`\n]+`/g],
    [/\[[a-zA-Z0-9_./-]+\]/g],
    [/--[a-zA-Z0-9_-]+/g],
    [/\bvar\(--[a-zA-Z0-9_-]+\)/g],
    [/:\s*root\b/g],
    [/\b[a-z]{1,3}-[a-z0-9-]+\b/gi],
  ];
  for (const [re] of patterns) {
    out = out.replace(re, (m) => {
      const k = `⟦${n++}⟧`;
      map.set(k, m);
      return k;
    });
  }
  return { out, map };
}

function restore(s, map) {
  let out = s;
  for (const [k, v] of map) out = out.split(k).join(v);
  return out;
}

async function translateText(text, attempt = 0, backendIdx = 0) {
  const q = text.trim();
  if (!q || enRatio(q) < 0.22) return text;

  const chunk = q.slice(0, CHUNK_MAX);
  const { out, map } = protect(chunk);

  let lastErr;
  for (let bi = backendIdx; bi < BACKENDS.length; bi++) {
    try {
      await throttle();
      const tr = restore(await BACKENDS[bi].fetch(out), map);
      consecutive502 = 0;
      const rest = q.length > CHUNK_MAX ? await translateText(q.slice(CHUNK_MAX), 0, 0) : "";
      return tr + rest;
    } catch (e) {
      lastErr = e;
      const msg = String(e.message || e);
      if (/502|503|429|431/.test(msg)) consecutive502++;
    }
  }

  if (attempt < 10) {
    const base = /502|503|429|431/.test(String(lastErr?.message || lastErr)) ? 4000 : 1500;
    const wait = base * (attempt + 1) + Math.floor(Math.random() * 2000);
    if (consecutive502 >= 4) {
      console.warn("\n  ⏸ API 限流，冷却 45s…");
      await sleep(45000);
      consecutive502 = 0;
    } else {
      await sleep(wait);
    }
    return translateText(text, attempt + 1, 0);
  }
  throw lastErr || new Error("translate failed");
}

function isCodeLang(lang, inner) {
  const l = (lang || "").trim().toLowerCase();
  if (["typescript", "javascript", "js", "python", "bash", "sh", "css", "scss", "json", "yaml", "sql", "rust", "go", "java", "powershell", "php", "ruby", "html", "vue"].includes(l))
    return true;
  return /^\s*(import |export |const |let |var |function |class |def |#include|:root\b)/m.test(inner);
}

function isMarkdownLang(lang, inner) {
  const l = (lang || "").trim().toLowerCase();
  if (["markdown", "md", "text", "txt", ""].includes(l)) return true;
  return /^#{1,6}\s/m.test(inner) || /^[\s>*-]/.test(inner);
}

async function translateCommentsOnly(inner) {
  const lines = inner.split("\n");
  const out = [];
  for (const line of lines) {
    let changed = false;
    let nl = line;

    const block = nl.match(/^(\s*\/\*\s*)(.+?)(\s*\*\/\s*)$/);
    if (block && enRatio(block[2]) > 0.25) {
      const zh = await translateText(block[2]);
      nl = block[1] + zh + block[3];
      changed = true;
      await sleep(90);
    }

    const lineComment = nl.match(/^(\s*\/\/\s*)(.+)$/);
    if (!changed && lineComment && enRatio(lineComment[2]) > 0.25) {
      const zh = await translateText(lineComment[2]);
      nl = lineComment[1] + zh;
      changed = true;
      await sleep(50);
    }

    const hashComment = nl.match(/^(\s*#\s*)(.+)$/);
    if (!changed && hashComment && !nl.trim().startsWith("#!") && enRatio(hashComment[2]) > 0.25) {
      const zh = await translateText(hashComment[2]);
      nl = hashComment[1] + zh;
      await sleep(50);
    }

    out.push(nl);
  }
  return out.join("\n");
}

async function translateProseBlock(inner) {
  const paras = inner.split(/\n\n+/);
  const out = [];
  for (const p of paras) {
    if (!fenceNeedsWork(p)) {
      out.push(p);
      continue;
    }
    out.push(await translateText(p));
    await sleep(200);
  }
  return out.join("\n\n");
}

async function translateFenceInner(inner, lang) {
  if (!fenceNeedsWork(inner)) return inner;
  if (isCodeLang(lang, inner)) return translateCommentsOnly(inner);
  if (isMarkdownLang(lang, inner)) return translateProseBlock(inner);
  if (/\[[^\]]+\]/.test(inner) || /^[A-Z][A-Z\s:—-]+$/m.test(inner)) return translateProseBlock(inner);
  return translateCommentsOnly(inner);
}

async function localizePromptFences(prompt) {
  const re = /```([^\n`]*)\n?([\s\S]*?)```/g;
  let changed = 0;
  const parts = [];
  let last = 0;
  let m;
  while ((m = re.exec(prompt))) {
    parts.push(prompt.slice(last, m.index));
    const lang = (m[1] || "").trim();
    const inner = m[2];
    if (fenceNeedsWork(inner)) {
      const zh = await translateFenceInner(inner, lang);
      if (zh !== inner) {
        changed++;
        const body = zh.endsWith("\n") ? zh : zh + "\n";
        parts.push("```" + (lang ? lang + "\n" : "") + body.replace(/^\n/, "") + "```");
      } else parts.push(m[0]);
    } else parts.push(m[0]);
    last = m.index + m[0].length;
  }
  parts.push(prompt.slice(last));
  return { text: parts.join(""), changed };
}

function loadProgress() {
  try {
    return JSON.parse(fs.readFileSync(PROGRESS, "utf8"));
  } catch {
    return { done: [], failed: [], fenceHashes: {} };
  }
}

function saveProgress(p) {
  fs.writeFileSync(PROGRESS, JSON.stringify(p, null, 2) + "\n", "utf8");
}

async function main() {
  let catalog = JSON.parse(fs.readFileSync(CATALOG, "utf8"));
  const progress = loadProgress();
  const doneSet = new Set(FORCE ? [] : progress.done || []);

  let roles = catalog.roles.filter((r) => !r.id.startsWith("software-company__"));
  if (ONLY_ROLE) roles = roles.filter((r) => r.id === ONLY_ROLE);
  const failedIds = new Set((progress.failed || []).map((f) => f.id));
  if (RETRY_FAILED) {
    roles = roles.filter((r) => failedIds.has(r.id));
  } else {
    roles = roles.filter((r) => !doneSet.has(r.id));
  }

  let processed = 0;
  let totalFences = 0;

  for (const role of roles) {
    if (processed >= LIMIT) break;
    process.stdout.write(`→ ${role.id} … `);
    try {
      const { text, changed } = await localizePromptFences(role.prompt || "");
      if (changed > 0) {
        role.prompt = text;
        const mir = catalog.roles.find((x) => x.id === `software-company__${role.id}`);
        if (mir) {
          mir.prompt = text
            .replace(`岗位 id：${role.id}`, `岗位 id：software-company__${role.id}`)
            .replace(/所属部门：[^\n]+/, "所属部门：软件公司");
        }
        catalog.fenceTranslatedAt = new Date().toISOString();
        fs.writeFileSync(CATALOG, JSON.stringify(catalog, null, 2) + "\n", "utf8");
      }
      totalFences += changed;
      doneSet.add(role.id);
      progress.done = [...doneSet];
      progress.fenceHashes = progress.fenceHashes || {};
      progress.fenceHashes[role.id] = hash(text);
      progress.failed = (progress.failed || []).filter((f) => f.id !== role.id);
      saveProgress(progress);
      console.log(`✓ ${role.id} fences=${changed}`);
      processed++;
      await sleep(60);
    } catch (e) {
      console.warn("✗", role.id, e.message || e);
      progress.failed = progress.failed || [];
      progress.failed.push({ id: role.id, at: new Date().toISOString(), reason: String(e.message || e) });
      saveProgress(progress);
      await sleep(2000);
    }
  }

  console.log(JSON.stringify({ processed, totalFences, doneTotal: doneSet.size }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
