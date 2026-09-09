/**
 * Worker: translate one shard of role ids to .cache/agency-zh-work/remaining/{id}.prose-zh.md
 * Usage: node scripts/_translate-shard-worker.mjs .cache/agency-zh-work/remaining/shards/shard-0.json
 *
 * @author qiuye
 * @email yjk150@qq.com
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const CATALOG = path.join(ROOT, "src/office/agencyCatalog.generated.json");
const WORK = path.join(ROOT, ".cache/agency-zh-work/remaining");

const shardPath = process.argv[2];
if (!shardPath) {
  console.error("usage: shard json path");
  process.exit(1);
}
const ids = JSON.parse(fs.readFileSync(shardPath, "utf8"));
const shardName = path.basename(shardPath);

const SECTION_MAP = [
  [/^#\s+(.+?)\s+Agent Personality\s*$/gim, "# $1 岗位人设"],
  [/^#\s+(.+?)\s+Agent\s*$/gim, "# $1 岗位"],
  [/^##\s+[^\n]*Identity & Memory\s*$/gim, "## 🧠 身份与记忆"],
  [/^##\s+[^\n]*Your Identity & Memory\s*$/gim, "## 🧠 身份与记忆"],
  [/^##\s+[^\n]*Core Mission\s*$/gim, "## 🎯 核心使命"],
  [/^##\s+[^\n]*Your Core Mission\s*$/gim, "## 🎯 核心使命"],
  [/^##\s+[^\n]*Core Responsibilities\s*$/gim, "## 📋 核心职责"],
  [/^##\s+[^\n]*Critical Rules[^\n]*$/gim, "## 🚨 必须遵守的规则"],
  [/^##\s+[^\n]*Technical Deliverables\s*$/gim, "## 📋 技术交付物"],
  [/^##\s+[^\n]*Your Technical Deliverables\s*$/gim, "## 📋 技术交付物"],
  [/^##\s+[^\n]*Workflow Process\s*$/gim, "## 🔄 工作流程"],
  [/^##\s+[^\n]*Communication Style\s*$/gim, "## 💭 沟通风格"],
  [/^##\s+[^\n]*Learning & Memory\s*$/gim, "## 🔄 学习与记忆"],
  [/^##\s+[^\n]*Learning & Improvement\s*$/gim, "## 🔄 学习与改进"],
  [/^##\s+[^\n]*Success Metrics\s*$/gim, "## 🎯 成功标准"],
  [/^##\s+[^\n]*Success Criteria\s*$/gim, "## 🎯 成功标准"],
  [/^##\s+[^\n]*Advanced Capabilities\s*$/gim, "## 🚀 进阶能力"],
  [/^##\s+[^\n]*When Invoked\s*$/gim, "## 何时调用"],
  [/^##\s+[^\n]*Deliverables\s*$/gim, "## 交付物"],
  [/^##\s+[^\n]*Constraints?\s*$/gim, "## 约束"],
  [/^##\s+[^\n]*Examples?\s*$/gim, "## 示例"],
  [/^You are\s+\*\*(.+?)\*\*/gim, "你是 **$1**"],
  [/^You are an?\s+\*\*(.+?)\*\*/gim, "你是一位 **$1**"],
];

const PHRASE_CN = [
  [/Google Ads/gi, "百度推广/巨量与腾讯广告（对照 Google Ads）"],
  [/Instagram/gi, "小红书/视频号（对照 Instagram）"],
  [/TikTok/gi, "抖音/TikTok"],
  [/\bTwitter\b|\bX\.com\b/gi, "微博/X"],
  [/LinkedIn/gi, "脉脉/招聘与 B2B 渠道（对照 LinkedIn）"],
  [/YouTube/gi, "B站/视频号（对照 YouTube）"],
  [/\bSlack\b/g, "飞书/企业微信"],
  [/\bJira\b/g, "飞书项目/禅道/Jira"],
  [/HIPAA/g, "《个人信息保护法》与医疗数据合规"],
  [/GDPR/g, "《个人信息保护法》"],
  [/401\(k\)/gi, "企业年金/公积金"],
];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function zhRatio(s) {
  const sample = (s || "").replace(/```[\s\S]*?```/g, "").replace(/<<<FENCE_\d+>>>/g, "");
  const zh = (sample.match(/[\u4e00-\u9fff]/g) || []).length;
  const en = (sample.match(/[A-Za-z]/g) || []).length;
  return zh + en ? zh / (zh + en) : 0;
}

function extractBody(prompt) {
  const marker = "—— 完整岗位说明 ——";
  const i = (prompt || "").indexOf(marker);
  if (i >= 0) return prompt.slice(i + marker.length).replace(/^\s*\n/, "");
  return prompt || "";
}

function extractFences(md) {
  const fences = [];
  const prose = md.replace(/```[\s\S]*?```/g, (m) => {
    const idx = fences.length;
    fences.push(m);
    return `\n\n<<<FENCE_${idx}>>>\n\n`;
  });
  return { prose, fences };
}

function restoreFences(prose, fences) {
  return prose.replace(/<<<FENCE_(\d+)>>>/g, (_, n) => fences[Number(n)] || "");
}

function preprocess(s) {
  let out = s;
  for (const [re, repl] of SECTION_MAP) out = out.replace(re, repl);
  return out;
}

function postChina(s) {
  let out = s;
  for (const [re, to] of PHRASE_CN) out = out.replace(re, to);
  return out
    .replace(/\n*##?\s*参考来源[\s\S]*$/m, "")
    .replace(/\n*##?\s*Sources?\s*\n[\s\S]*$/im, "")
    .replace(/https?:\/\/\S+/g, "")
    .trim();
}

async function translateChunk(text, attempt = 0) {
  // Strip invalid lone surrogates that break encodeURIComponent
  const q = text
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, "")
    .replace(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "")
    .slice(0, 1200);
  if (!q.trim()) return q;
  if (/^<<<FENCE_\d+>>>$/.test(q.trim())) return text;
  let url;
  try {
    url =
      "https://simplytranslate.org/api/translate?engine=google&from=en&to=zh-CN&text=" +
      encodeURIComponent(q);
  } catch {
    return q;
  }
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const out = data?.translated_text;
    if (!out) throw new Error("empty");
    return out;
  } catch (e) {
    if (attempt < 6) {
      await sleep(1000 * (attempt + 1));
      return translateChunk(text, attempt + 1);
    }
    throw e;
  }
}

async function translateProse(prose) {
  const s = preprocess(prose);
  const parts = s.split(/\n\n+/);
  const out = [];
  let buf = "";
  for (const p of parts) {
    if (/<<<FENCE_\d+>>>/.test(p) && p.trim().length < 40) {
      if (buf) {
        out.push(await translateChunk(buf));
        await sleep(80);
        buf = "";
      }
      out.push(p);
      continue;
    }
    if ((buf + "\n\n" + p).length > 900 && buf) {
      out.push(await translateChunk(buf));
      await sleep(80);
      buf = p;
    } else {
      buf = buf ? buf + "\n\n" + p : p;
    }
  }
  if (buf) out.push(await translateChunk(buf));
  return out.join("\n\n");
}

const catalog = JSON.parse(fs.readFileSync(CATALOG, "utf8"));
const byId = new Map(catalog.roles.map((r) => [r.id, r]));

let ok = 0;
let fail = 0;
for (const id of ids) {
  const zhPath = path.join(WORK, `${id}.prose-zh.md`);
  if (fs.existsSync(zhPath) && zhRatio(fs.readFileSync(zhPath, "utf8")) >= 0.45) {
    console.log(shardName, "skip", id);
    ok++;
    continue;
  }
  const role = byId.get(id);
  if (!role) {
    console.warn(shardName, "missing", id);
    fail++;
    continue;
  }
  console.log(shardName, `[${ok + fail + 1}/${ids.length}]`, id);
  try {
    const body = extractBody(role.prompt);
    const { prose, fences } = extractFences(body);
    fs.writeFileSync(path.join(WORK, `${id}.prose-en.md`), prose, "utf8");
    fs.writeFileSync(path.join(WORK, `${id}.fences.json`), JSON.stringify(fences), "utf8");
    let zh = await translateProse(prose);
    zh = postChina(zh);
    const ratio = zhRatio(zh);
    if (ratio < 0.32) {
      fs.writeFileSync(path.join(WORK, `${id}.prose-zh.partial.md`), zh, "utf8");
      console.warn(shardName, "low", id, ratio.toFixed(2));
      fail++;
      continue;
    }
    const bodyZh = restoreFences(zh, fences);
    fs.writeFileSync(zhPath, bodyZh + "\n", "utf8");
    ok++;
    console.log(shardName, "ok", id, ratio.toFixed(2));
  } catch (e) {
    console.warn(shardName, "fail", id, e.message || e);
    fail++;
    await sleep(1500);
  }
}

console.log(shardName, "done", { ok, fail, total: ids.length });
if (fail > 0 && ok === 0) process.exit(1);
