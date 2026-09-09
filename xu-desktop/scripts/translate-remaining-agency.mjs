/**
 * Translate remaining agency role bodies (English under Chinese shell) to zh-CN.
 * Extracts code fences, translates prose via Google gtx, applies China phrase map,
 * writes catalog + progress under .cache/agency-zh-work/remaining/
 *
 * Resume-safe. Usage:
 *   node scripts/translate-remaining-agency.mjs
 *   node scripts/translate-remaining-agency.mjs --limit=20
 *   node scripts/translate-remaining-agency.mjs --div=marketing
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
const PROGRESS = path.join(WORK, "_progress.json");

fs.mkdirSync(WORK, { recursive: true });

const args = process.argv.slice(2);
const limitArg = args.find((a) => a.startsWith("--limit="));
const divArg = args.find((a) => a.startsWith("--div="));
const LIMIT = limitArg ? Number(limitArg.split("=")[1]) : Infinity;
const ONLY_DIV = divArg ? divArg.split("=")[1] : null;

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
        await sleep(120);
        buf = "";
      }
      out.push(p);
      continue;
    }
    if ((buf + "\n\n" + p).length > 900 && buf) {
      out.push(await translateChunk(buf));
      await sleep(180);
      buf = p;
    } else {
      buf = buf ? buf + "\n\n" + p : p;
    }
  }
  if (buf) out.push(await translateChunk(buf));
  return out.join("\n\n");
}

function buildPrompt(role, bodyZh) {
  const china =
    role.prompt?.includes("中国工作语境（强制）")
      ? ""
      : ""; // already injected by upgrade; keep existing shell pieces
  const shellParts = (role.prompt || "").split("—— 完整岗位说明 ——")[0].trim();
  const shell =
    shellParts ||
    [
      `你是「${role.nameZh}」（岗位 id：${role.id}）。`,
      `所属部门：${role.divisionZh || role.division}。`,
      `请严格按下列完整岗位说明工作；默认用中文回复（除非用户要求其他语言）。`,
      `交付时说明假设、步骤与验收标准；不确定处先提问再动手。`,
    ].join("\n");
  return `${shell}\n\n—— 完整岗位说明 ——\n${bodyZh.trim()}`;
}

function loadProgress() {
  try {
    return JSON.parse(fs.readFileSync(PROGRESS, "utf8"));
  } catch {
    return { done: [], failed: [] };
  }
}

function saveProgress(p) {
  fs.writeFileSync(PROGRESS, JSON.stringify(p, null, 2) + "\n", "utf8");
}

function needsTranslate(role) {
  if (role.id.startsWith("software-company__")) return false;
  const body = extractBody(role.prompt);
  return zhRatio(body) < 0.45;
}

async function main() {
  let catalog = JSON.parse(fs.readFileSync(CATALOG, "utf8"));
  const progress = loadProgress();
  const doneSet = new Set(progress.done || []);

  let candidates = catalog.roles.filter(needsTranslate);
  if (ONLY_DIV) candidates = candidates.filter((r) => r.division === ONLY_DIV);
  // Priority order: marketing CN-ish, security, testing, pm, sales, support, product, specialized, rest
  const pri = {
    marketing: 0,
    security: 1,
    testing: 2,
    "project-management": 3,
    sales: 4,
    support: 5,
    product: 6,
    specialized: 7,
    "game-development": 8,
    gis: 9,
    "spatial-computing": 10,
  };
  candidates.sort((a, b) => (pri[a.division] ?? 20) - (pri[b.division] ?? 20) || a.id.localeCompare(b.id));
  candidates = candidates.filter((r) => !doneSet.has(r.id)).slice(0, LIMIT);

  console.log("to translate", candidates.length, "limit", LIMIT, "div", ONLY_DIV || "all");

  let ok = 0;
  for (const role of candidates) {
    console.log(`[${ok + 1}/${candidates.length}]`, role.id, role.division);
    try {
      const body = extractBody(role.prompt);
      const { prose, fences } = extractFences(body);
      fs.writeFileSync(path.join(WORK, `${role.id}.prose-en.md`), prose, "utf8");
      fs.writeFileSync(path.join(WORK, `${role.id}.fences.json`), JSON.stringify(fences), "utf8");

      let zh = await translateProse(prose);
      zh = postChina(zh);
      const ratio = zhRatio(zh);
      if (ratio < 0.32) {
        fs.writeFileSync(path.join(WORK, `${role.id}.prose-zh.partial.md`), zh, "utf8");
        progress.failed.push({ id: role.id, reason: `low ratio ${ratio.toFixed(2)}` });
        saveProgress(progress);
        console.warn("  low ratio", ratio.toFixed(2));
        continue;
      }
      const bodyZh = restoreFences(zh, fences);
      fs.writeFileSync(path.join(WORK, `${role.id}.prose-zh.md`), bodyZh + "\n", "utf8");

      // re-read catalog before write to reduce race
      catalog = JSON.parse(fs.readFileSync(CATALOG, "utf8"));
      const r = catalog.roles.find((x) => x.id === role.id);
      if (!r) throw new Error("role missing in catalog");
      r.prompt = buildPrompt(r, bodyZh);
      const mir = catalog.roles.find((x) => x.id === `software-company__${role.id}`);
      if (mir) {
        mir.prompt = r.prompt
          .replace(`岗位 id：${role.id}`, `岗位 id：software-company__${role.id}`)
          .replace(/所属部门：[^\n]+/, "所属部门：软件公司");
      }
      catalog.localizedAt = new Date().toISOString().slice(0, 10);
      fs.writeFileSync(CATALOG, JSON.stringify(catalog, null, 2) + "\n", "utf8");

      doneSet.add(role.id);
      progress.done = [...doneSet];
      saveProgress(progress);
      ok++;
      console.log("  ok ratio", ratio.toFixed(2), "chars", bodyZh.length);
      await sleep(200);
    } catch (e) {
      console.warn("  fail", e.message || e);
      progress.failed.push({ id: role.id, reason: String(e.message || e) });
      saveProgress(progress);
      await sleep(1500);
    }
  }

  console.log(JSON.stringify({ translated: ok, doneTotal: doneSet.size, failed: progress.failed.length }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
