/**
 * Translate agencyCatalog prompts to zh-CN via MyMemory (network-reachable).
 * Resumable; skips bodies already mostly Chinese.
 *
 * node scripts/translate-agency-catalog.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "../src/office/agencyCatalog.generated.json");
const CONCURRENCY = 3;
const MARKER = "—— 完整岗位说明 ——";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function zhRatio(s) {
  const zh = (s.match(/[\u4e00-\u9fff]/g) || []).length;
  const letters = (s.match(/[A-Za-z\u4e00-\u9fff]/g) || []).length || 1;
  return zh / letters;
}

async function translateChunk(text) {
  const q = text.slice(0, 450).trim();
  if (!q) return q;
  // Skip pure code / ascii tables lightly
  if (/^```/.test(q) || /^[\s|=\-_+.0-9A-Za-z\[\]:\/\\]+$/.test(q) && q.length > 80 && zhRatio(q) === 0) {
    // still try translate for prose-looking
  }
  const url =
    "https://api.mymemory.translated.net/get?langpair=en%7Czh-CN&q=" + encodeURIComponent(q);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const out = data?.responseData?.translatedText;
  if (!out || data.responseStatus !== 200) throw new Error(data?.responseDetails || "empty");
  // MyMemory sometimes returns QUOTA EXCEEDED as translatedText
  if (/MYMEMORY WARNING|QUOTA EXCEEDED/i.test(out)) throw new Error(out.slice(0, 80));
  return out;
}

async function translateLong(text) {
  const fenceRe = /```[\s\S]*?```/g;
  const segments = [];
  let last = 0;
  let m;
  while ((m = fenceRe.exec(text))) {
    if (m.index > last) segments.push({ type: "text", value: text.slice(last, m.index) });
    segments.push({ type: "code", value: m[0] });
    last = m.index + m[0].length;
  }
  if (last < text.length) segments.push({ type: "text", value: text.slice(last) });

  const out = [];
  for (const seg of segments) {
    if (seg.type === "code") {
      out.push(seg.value);
      continue;
    }
    // sentence / line chunks ~400 chars
    const parts = seg.value.split(/(?<=\n)|(?<=[.!?。！？])\s+/);
    let buf = "";
    for (const p of parts) {
      if ((buf + p).length > 400 && buf) {
        out.push(await translateChunk(buf));
        await sleep(120);
        buf = p;
      } else buf += p;
    }
    if (buf.trim()) {
      out.push(await translateChunk(buf));
      await sleep(120);
    }
  }
  return out.join("");
}

async function mapPool(items, limit, fn) {
  const ret = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      ret[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: limit }, () => worker()));
  return ret;
}

async function main() {
  const data = JSON.parse(fs.readFileSync(OUT, "utf8"));
  const roles = data.roles.filter((r) => !String(r.id).startsWith("software-company__"));
  console.log("base roles", roles.length);

  let done = 0;
  let failed = 0;
  await mapPool(roles, CONCURRENCY, async (r) => {
    const i = r.prompt.indexOf(MARKER);
    if (i < 0) return;
    const head = r.prompt.slice(0, i + MARKER.length);
    let body = r.prompt.slice(i + MARKER.length).trim();
    if (zhRatio(body) > 0.5) {
      done++;
      return;
    }
    try {
      body = await translateLong(body);
      r.prompt = `${head}\n${body}`;
      // sync software-company mirrors
      for (const s of data.roles) {
        if (s.id === `software-company__${r.id}`) {
          s.prompt = r.prompt.replace(`所属部门：${r.divisionZh}`, "所属部门：软件公司");
        }
      }
      done++;
      if (done % 3 === 0) {
        console.log(`[${done}/${roles.length}] ${r.id}`);
        data.translated = true;
        fs.writeFileSync(OUT, JSON.stringify(data, null, 2) + "\n", "utf8");
      }
    } catch (e) {
      failed++;
      console.warn("fail", r.id, e.message);
      await sleep(800);
    }
  });

  data.translated = true;
  data.localizedAt = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(OUT, JSON.stringify(data, null, 2) + "\n", "utf8");
  console.log("done", done, "failed", failed);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
