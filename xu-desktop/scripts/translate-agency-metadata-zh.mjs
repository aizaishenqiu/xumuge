/**
 * 翻译岗位 catalog 中仍含英文的 description 与 prompt 正文（围栏外 prose）。
 * 与 translate-agency-fences-zh.mjs 互补：围栏内已由后者处理。
 *
 * node scripts/translate-agency-metadata-zh.mjs
 * node scripts/translate-agency-metadata-zh.mjs --descriptions-only
 * node scripts/translate-agency-metadata-zh.mjs --prompts-only --limit=20
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const CATALOG = path.join(ROOT, "src/office/agencyCatalog.generated.json");
const WORK = path.join(ROOT, ".cache/agency-zh-work/metadata-translate");
const PROGRESS = path.join(WORK, "_progress.json");

fs.mkdirSync(WORK, { recursive: true });

const args = process.argv.slice(2);
const LIMIT = Number(args.find((a) => a.startsWith("--limit="))?.split("=")[1] || Infinity);
const ONLY_ROLE = args.find((a) => a.startsWith("--role="))?.split("=")[1] || null;
const DESC_ONLY = args.includes("--descriptions-only");
const PROMPT_ONLY = args.includes("--prompts-only");
const FORCE = args.includes("--force");

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

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function enRatio(s) {
  const zh = (s.match(/[\u4e00-\u9fff]/g) || []).length;
  const en = (s.match(/[A-Za-z]/g) || []).length;
  return en + zh ? en / (en + zh) : 0;
}

function needsEnglishWork(s) {
  if (!s?.trim()) return false;
  const words = (s.match(/\b[A-Za-z]{4,}\b/g) || []).length;
  const zh = (s.match(/[\u4e00-\u9fff]/g) || []).length;
  return words >= 2 && (words > zh * 0.35 || enRatio(s) > 0.28);
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
    [/\b[a-z]{1,3}-[a-z0-9-]+\b/gi],
    [/\b[A-Z]{2,}\b/g],
    [/\b(?:id|API|UI|UX|CSS|HTML|JSON|SQL|Git|CI|CD|SDK|MCP)\b/g],
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

async function translateText(text, attempt = 0) {
  const q = text.trim();
  if (!q || !needsEnglishWork(q)) return text;

  const chunk = q.slice(0, CHUNK_MAX);
  const { out, map } = protect(chunk);

  let lastErr;
  for (const backend of BACKENDS) {
    try {
      await throttle();
      const tr = restore(await backend.fetch(out), map);
      consecutive502 = 0;
      const rest = q.length > CHUNK_MAX ? await translateText(q.slice(CHUNK_MAX), 0) : "";
      return tr + rest;
    } catch (e) {
      lastErr = e;
      const msg = String(e.message || e);
      if (/502|503|429|431/.test(msg)) consecutive502++;
    }
  }

  if (attempt < 10) {
    const base = /502|503|429|431/.test(String(lastErr?.message || lastErr)) ? 4000 : 1500;
    if (consecutive502 >= 4) {
      console.warn("\n  ⏸ API 限流，冷却 45s…");
      await sleep(45000);
      consecutive502 = 0;
    } else {
      await sleep(base * (attempt + 1) + Math.floor(Math.random() * 2000));
    }
    return translateText(text, attempt + 1);
  }
  throw lastErr || new Error("translate failed");
}

async function localizeDescription(desc) {
  if (!desc || !needsEnglishWork(desc)) return { text: desc, changed: false };
  const m = desc.match(/^(.+?[·][^—–-]+)\s*[—–-]\s*(.+)$/s);
  if (m) {
    const prefix = m[1].trim();
    const tail = m[2].trim();
    if (!needsEnglishWork(tail)) return { text: desc, changed: false };
    const zh = await translateText(tail);
    return { text: `${prefix} — ${zh}`.slice(0, 280), changed: zh !== tail };
  }
  if (needsEnglishWork(desc)) {
    const zh = await translateText(desc);
    return { text: zh.slice(0, 280), changed: zh !== desc };
  }
  return { text: desc, changed: false };
}

async function translateProseBlock(inner) {
  const paras = inner.split(/\n\n+/);
  const out = [];
  let changed = false;
  for (const p of paras) {
    if (!needsEnglishWork(p)) {
      out.push(p);
      continue;
    }
    const zh = await translateText(p);
    if (zh !== p) changed = true;
    out.push(zh);
    await sleep(120);
  }
  return { text: out.join("\n\n"), changed };
}

async function localizePromptOutsideFences(prompt) {
  const re = /```[\s\S]*?```/g;
  const parts = [];
  let last = 0;
  let m;
  let changed = 0;
  while ((m = re.exec(prompt))) {
    const segment = prompt.slice(last, m.index);
    if (segment && needsEnglishWork(segment)) {
      const { text, changed: c } = await translateProseBlock(segment);
      parts.push(text);
      if (c) changed++;
    } else {
      parts.push(segment);
    }
    parts.push(m[0]);
    last = m.index + m[0].length;
  }
  const tail = prompt.slice(last);
  if (tail && needsEnglishWork(tail)) {
    const { text, changed: c } = await translateProseBlock(tail);
    parts.push(text);
    if (c) changed++;
  } else {
    parts.push(tail);
  }
  return { text: parts.join(""), changed };
}

function loadProgress() {
  try {
    return JSON.parse(fs.readFileSync(PROGRESS, "utf8"));
  } catch {
    return { descDone: [], promptDone: [], failed: [] };
  }
}

function saveProgress(p) {
  fs.writeFileSync(PROGRESS, JSON.stringify(p, null, 2) + "\n", "utf8");
}

function hash(s) {
  return crypto.createHash("sha1").update(s).digest("hex").slice(0, 12);
}

function syncSoftwareMirror(catalog, role) {
  const mir = catalog.roles.find((x) => x.id === `software-company__${role.id}`);
  if (!mir) return;
  if (role.description?.startsWith("软件公司编制")) return;
  mir.prompt = role.prompt
    .replace(`岗位 id：${role.id}`, `岗位 id：software-company__${role.id}`)
    .replace(/所属部门：[^\n]+/, "所属部门：软件公司");
}

async function main() {
  let catalog = JSON.parse(fs.readFileSync(CATALOG, "utf8"));
  const progress = loadProgress();
  const descDone = new Set(FORCE ? [] : progress.descDone || progress.done || []);
  const promptDone = new Set(FORCE ? [] : progress.promptDone || []);

  let roles = catalog.roles.filter((r) => !r.id.startsWith("software-company__"));
  if (ONLY_ROLE) roles = roles.filter((r) => r.id === ONLY_ROLE);
  if (DESC_ONLY) roles = roles.filter((r) => !descDone.has(r.id));
  else if (PROMPT_ONLY) roles = roles.filter((r) => !promptDone.has(r.id));
  else roles = roles.filter((r) => !descDone.has(r.id) || !promptDone.has(r.id));

  let processed = 0;
  let descChanged = 0;
  let promptChanged = 0;

  for (const role of roles) {
    if (processed >= LIMIT) break;
    process.stdout.write(`→ ${role.id} … `);
    try {
      let roleChanged = false;

      if (!PROMPT_ONLY) {
        const { text, changed } = await localizeDescription(role.description || "");
        if (changed) {
          role.description = text;
          descChanged++;
          roleChanged = true;
        }
        descDone.add(role.id);
      }

      if (!DESC_ONLY && role.prompt) {
        const { text, changed } = await localizePromptOutsideFences(role.prompt);
        if (changed > 0) {
          role.prompt = text;
          promptChanged += changed;
          roleChanged = true;
        }
        promptDone.add(role.id);
      }

      if (roleChanged) {
        syncSoftwareMirror(catalog, role);
        catalog.metadataTranslatedAt = new Date().toISOString();
        fs.writeFileSync(CATALOG, JSON.stringify(catalog, null, 2) + "\n", "utf8");
      }

      progress.descDone = [...descDone];
      progress.promptDone = [...promptDone];
      progress.failed = (progress.failed || []).filter((f) => f.id !== role.id);
      progress.hashes = progress.hashes || {};
      progress.hashes[role.id] = hash(
        (role.description || "") + "\n" + (role.prompt || "").slice(0, 2000),
      );
      saveProgress(progress);
      console.log(`✓ desc=${roleChanged && !PROMPT_ONLY ? "y" : "-"} prompt=${roleChanged && !DESC_ONLY ? "y" : "-"}`);
      processed++;
      await sleep(80);
    } catch (e) {
      console.warn("✗", role.id, e.message || e);
      progress.failed = progress.failed || [];
      progress.failed.push({ id: role.id, at: new Date().toISOString(), reason: String(e.message || e) });
      saveProgress(progress);
      await sleep(2500);
    }
  }

  console.log(
    JSON.stringify(
      { processed, descChanged, promptChanged, descDoneTotal: descDone.size, promptDoneTotal: promptDone.size, failed: (progress.failed || []).length },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
