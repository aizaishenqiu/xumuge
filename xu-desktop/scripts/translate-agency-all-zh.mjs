/**
 * 岗位 catalog 全字段中文化（用户可见文案）。
 * - name ← nameZh
 * - description 全中文
 * - prompt：围栏外逐段/逐行 + 围栏内模板/注释 + 双语格式清理
 *
 * node scripts/translate-agency-all-zh.mjs
 * node scripts/translate-agency-all-zh.mjs --scrub-only   # 仅 name 同步 + 正则清理（无 API）
 * node scripts/translate-agency-all-zh.mjs --descriptions-only
 * node scripts/translate-agency-all-zh.mjs --prompts-only
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const CATALOG = path.join(ROOT, "src/office/agencyCatalog.generated.json");
const WORK = path.join(ROOT, ".cache/agency-zh-work/all-translate");
const PROGRESS = path.join(WORK, "_progress.json");

fs.mkdirSync(WORK, { recursive: true });

const args = process.argv.slice(2);
const LIMIT = Number(args.find((a) => a.startsWith("--limit="))?.split("=")[1] || Infinity);
const ONLY_ROLE = args.find((a) => a.startsWith("--role="))?.split("=")[1] || null;
const SCRUB_ONLY = args.includes("--scrub-only");
const DESC_ONLY = args.includes("--descriptions-only");
const PROMPT_ONLY = args.includes("--prompts-only");
const FORCE = args.includes("--force");

/** 与 pnpm tauri dev 同时跑会每写一次 catalog 触发全应用 HMR「假重启」 */
async function assertDevNotRunning() {
  if (process.env.XU_ALLOW_CATALOG_WRITE === "1") return;
  try {
    const res = await fetch("http://127.0.0.1:1420/", { signal: AbortSignal.timeout(800) });
    if (res.ok) {
      console.error(
        "[translate-agency] 检测到 Vite 开发服 (1420) 正在运行。请先停止 pnpm tauri dev，或设置 XU_ALLOW_CATALOG_WRITE=1 强制写入。",
      );
      process.exit(2);
    }
  } catch {
    /* dev server not up */
  }
}

const CHUNK_MAX = 480;
const MIN_GAP_MS = 260;
let consecutive502 = 0;
let lastRequestAt = 0;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function throttle() {
  const gap = MIN_GAP_MS + Math.floor(Math.random() * 100);
  const wait = lastRequestAt + gap - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();
}

function enRatio(s) {
  const zh = (s.match(/[\u4e00-\u9fff]/g) || []).length;
  const en = (s.match(/[A-Za-z]/g) || []).length;
  return en + zh ? en / (en + zh) : 0;
}

function hasEnglishWords(s, minLen = 3) {
  return new RegExp(`\\b[A-Za-z]{${minLen},}\\b`).test(s || "");
}

function needsEnglishWork(s) {
  if (!s?.trim()) return false;
  const words = (s.match(/\b[A-Za-z]{3,}\b/g) || []).length;
  const zh = (s.match(/[\u4e00-\u9fff]/g) || []).length;
  return words >= 1 && (zh < 4 || words >= 2 || enRatio(s) > 0.22);
}

function lineNeedsWork(line) {
  const t = line.trim();
  if (!t) return false;
  if (/^岗位 id：/.test(t)) return false;
  if (/^——/.test(t)) return false;
  if (!hasEnglishWords(t, 3)) return false;
  const zh = (t.match(/[\u4e00-\u9fff]/g) || []).length;
  const words = (t.match(/\b[A-Za-z]{3,}\b/g) || []).length;
  if (words === 1 && t.length > 20 && zh > 8) {
    const w = t.match(/\b[A-Za-z]{3,}\b/)[0];
    if (w.length <= 5) return false;
  }
  return words >= 1 && (zh < 6 || words >= 2);
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
    [/\b(?:id|API|UI|UX|CSS|HTML|JSON|SQL|Git|CI|CD|SDK|MCP|GIS|PHP|URL|HTTP|HTTPS|OAuth|JWT|SSO|VAT|ICP|SOX|GDPR|HIPAA|FedRAMP|PCRE|SSE|AVX|JIT|npm|Node|Vue|Rust|Tauri|Windows|Linux|macOS|Drupal|WordPress|Playwright|Ollama|SQLite|PostgreSQL|MySQL|Redis|Kubernetes|Docker|AWS|GCP|Azure)\b/g],
    [/\bacademic-[a-z0-9-]+\b/g],
    [/\bengineering-[a-z0-9-]+\b/g],
    [/\bsoftware-company__[a-z0-9-]+\b/g],
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
      if (/502|503|429|431/.test(String(e.message || e))) consecutive502++;
    }
  }

  if (attempt < 12) {
    if (consecutive502 >= 4) {
      console.warn("\n  ⏸ API 限流，冷却 45s…");
      await sleep(45000);
      consecutive502 = 0;
    } else {
      await sleep(1500 * (attempt + 1));
    }
    return translateText(text, attempt + 1);
  }
  throw lastErr || new Error("translate failed");
}

/** 去掉「English（中文）」双语残留，保留中文 */
export function scrubBilingual(text) {
  if (!text) return text;
  let out = text;
  out = out.replace(/\*\*The\s+([^*（\n]+?)（([^）\n]+)）\*\*/g, "**$2**");
  out = out.replace(/\*\*([A-Za-z][^*（\n]{0,160}?)（([^）\n]+)）\*\*/g, "**$2**");
  out = out.replace(/`([A-Za-z][^`（\n]{0,120}?)（([^）\n]+)）`/g, "`$2`");
  out = out.replace(
    /(?<![\u4e00-\u9fffA-Za-z/])([A-Z][A-Za-z]+(?:\s+[A-Za-z]+){0,8})（([^）\n]{2,80})）/g,
    "$2",
  );
  out = out.replace(/^#+\s*([A-Za-z][^\n（]+)$/gm, (line, en) => {
    if (!hasEnglishWords(en, 4)) return line;
    return line;
  });
  return out;
}

function syncStaticFields(role) {
  let changed = false;
  if (role.nameZh && role.name !== role.nameZh) {
    role.name = role.nameZh;
    changed = true;
  }
  const scrubbed = scrubBilingual(role.prompt || "");
  if (scrubbed !== role.prompt) {
    role.prompt = scrubbed;
    changed = true;
  }
  const descScrub = scrubBilingual(role.description || "");
  if (descScrub !== role.description) {
    role.description = descScrub;
    changed = true;
  }
  return changed;
}

async function localizeDescription(desc) {
  if (!desc || !hasEnglishWords(desc, 3)) return { text: desc, changed: false };
  const cleaned = scrubBilingual(desc);
  if (cleaned !== desc && !hasEnglishWords(cleaned, 4)) {
    return { text: cleaned.slice(0, 280), changed: true };
  }
  const m = cleaned.match(/^(.+?[·][^—–-]+)\s*[—–-]\s*(.+)$/s);
  if (m) {
    const prefix = m[1].trim();
    let tail = m[2].trim();
    if (hasEnglishWords(tail, 3)) {
      tail = await translateText(tail);
    }
    return { text: `${prefix} — ${tail}`.slice(0, 280), changed: true };
  }
  if (hasEnglishWords(cleaned, 3)) {
    const zh = await translateText(cleaned);
    return { text: zh.slice(0, 280), changed: zh !== desc };
  }
  return { text: cleaned, changed: cleaned !== desc };
}

function isCodeLang(lang, inner) {
  const l = (lang || "").trim().toLowerCase();
  if (
    ["typescript", "javascript", "js", "python", "bash", "sh", "css", "scss", "json", "yaml", "sql", "rust", "go", "java", "powershell", "php", "ruby", "html", "vue"].includes(l)
  )
    return true;
  return /^\s*(import |export |const |let |var |function |class |def |#include|:root\b)/m.test(inner);
}

async function translateCommentsOnly(inner) {
  const lines = inner.split("\n");
  const out = [];
  let changed = false;
  for (const line of lines) {
    let nl = line;
    const block = nl.match(/^(\s*\/\*\s*)(.+?)(\s*\*\/\s*)$/);
    if (block && needsEnglishWork(block[2])) {
      nl = block[1] + (await translateText(block[2])) + block[3];
      changed = true;
      await sleep(40);
    }
    const lineComment = nl.match(/^(\s*\/\/\s*)(.+)$/);
    if (lineComment && needsEnglishWork(lineComment[2])) {
      nl = lineComment[1] + (await translateText(lineComment[2]));
      changed = true;
      await sleep(30);
    }
    const hashComment = nl.match(/^(\s*#\s*)(.+)$/);
    if (hashComment && !nl.trim().startsWith("#!") && needsEnglishWork(hashComment[2])) {
      nl = hashComment[1] + (await translateText(hashComment[2]));
      changed = true;
      await sleep(30);
    }
    out.push(nl);
  }
  return { text: out.join("\n"), changed };
}

async function translateProseLines(inner) {
  const lines = inner.split("\n");
  const out = [];
  let changed = false;
  let buf = [];

  async function flushBuf() {
    if (!buf.length) return;
    const block = buf.join("\n");
    buf = [];
    if (needsEnglishWork(block)) {
      const zh = await translateText(block);
      if (zh !== block) changed = true;
      out.push(zh);
      await sleep(80);
    } else {
      out.push(block);
    }
  }

  for (const raw of lines) {
    let line = scrubBilingual(raw);
    if (line !== raw) changed = true;
    if (lineNeedsWork(line) && line.length < 240) {
      await flushBuf();
      const zh = await translateText(line);
      if (zh !== line) changed = true;
      out.push(zh);
      await sleep(60);
    } else {
      buf.push(line);
      if (buf.length >= 6) await flushBuf();
    }
  }
  await flushBuf();
  return { text: out.join("\n"), changed };
}

async function translateFenceInner(inner, lang) {
  if (!needsEnglishWork(inner)) return { text: inner, changed: false };
  if (isCodeLang(lang, inner)) return translateCommentsOnly(inner);
  return translateProseLines(inner);
}

async function localizePromptFull(prompt) {
  const marker = "—— 完整岗位说明 ——";
  const i = prompt.indexOf(marker);
  if (i < 0) {
    let changed = 0;
    let text = scrubBilingual(prompt);
    if (text !== prompt) changed++;
    const { text: zh, changed: c } = await translateProseLines(text);
    return { text: zh, changed: changed + (c ? 1 : 0) };
  }
  const shell = prompt.slice(0, i);
  let body = prompt.slice(i);
  body = scrubBilingual(body);
  let changed = body !== prompt.slice(i) ? 1 : 0;

  const re = /```([^\n`]*)\n?([\s\S]*?)```/g;
  const parts = [];
  let last = 0;
  let m;
  while ((m = re.exec(body))) {
    const segment = body.slice(last, m.index);
    if (segment && needsEnglishWork(segment)) {
      const { text: zh, changed: c } = await translateProseLines(segment);
      parts.push(zh);
      if (c) changed++;
    } else {
      parts.push(segment);
    }
    const lang = (m[1] || "").trim();
    const inner = m[2];
    const { text: zhInner, changed: c } = await translateFenceInner(inner, lang);
    const fenceBody = zhInner.endsWith("\n") ? zhInner : zhInner + "\n";
    parts.push("```" + (lang ? lang + "\n" : "") + fenceBody.replace(/^\n/, "") + "```");
    if (c) changed++;
    last = m.index + m[0].length;
  }
  const tail = body.slice(last);
  if (tail && needsEnglishWork(tail)) {
    const { text: zh, changed: c } = await translateProseLines(tail);
    parts.push(zh);
    if (c) changed++;
  } else {
    parts.push(tail);
  }
  return { text: shell + parts.join(""), changed };
}

function loadProgress() {
  try {
    return JSON.parse(fs.readFileSync(PROGRESS, "utf8"));
  } catch {
    return { scrubDone: false, descDone: [], promptDone: [], failed: [] };
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
  mir.name = role.name;
  mir.nameZh = role.nameZh;
  if (!mir.description?.startsWith("软件公司编制")) {
    mir.description = role.description;
  }
  mir.prompt = role.prompt
    .replace(`岗位 id：${role.id}`, `岗位 id：software-company__${role.id}`)
    .replace(/所属部门：[^\n]+/, "所属部门：软件公司");
}

function writeCatalog(catalog) {
  catalog.allFieldsLocalizedAt = new Date().toISOString();
  catalog.translated = true;
  fs.writeFileSync(CATALOG, JSON.stringify(catalog, null, 2) + "\n", "utf8");
}

async function scrubAllRoles(catalog) {
  let n = 0;
  for (const role of catalog.roles) {
    if (syncStaticFields(role)) n++;
    if (!role.id.startsWith("software-company__")) syncSoftwareMirror(catalog, role);
  }
  writeCatalog(catalog);
  return n;
}

async function main() {
  await assertDevNotRunning();
  let catalog = JSON.parse(fs.readFileSync(CATALOG, "utf8"));
  const progress = loadProgress();

  if (SCRUB_ONLY || (!DESC_ONLY && !PROMPT_ONLY && !progress.scrubDone)) {
    const n = await scrubAllRoles(catalog);
    progress.scrubDone = true;
    saveProgress(progress);
    console.log(`scrub: ${n} roles updated (name + 双语清理)`);
    if (SCRUB_ONLY) return;
    catalog = JSON.parse(fs.readFileSync(CATALOG, "utf8"));
  }

  const descDone = new Set(FORCE ? [] : progress.descDone || []);
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
      syncStaticFields(role);

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
        const { text, changed } = await localizePromptFull(role.prompt);
        if (changed > 0) {
          role.prompt = text;
          promptChanged += changed;
          roleChanged = true;
        }
        promptDone.add(role.id);
      }

      syncSoftwareMirror(catalog, role);
      if (roleChanged || syncStaticFields(role)) {
        writeCatalog(catalog);
      }

      progress.descDone = [...descDone];
      progress.promptDone = [...promptDone];
      progress.failed = (progress.failed || []).filter((f) => f.id !== role.id);
      progress.hashes = progress.hashes || {};
      progress.hashes[role.id] = hash((role.description || "") + (role.prompt || "").slice(0, 3000));
      saveProgress(progress);
      console.log("✓");
      processed++;
      await sleep(50);
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
      {
        processed,
        descChanged,
        promptChanged,
        descDoneTotal: descDone.size,
        promptDoneTotal: promptDone.size,
        failed: (progress.failed || []).length,
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
