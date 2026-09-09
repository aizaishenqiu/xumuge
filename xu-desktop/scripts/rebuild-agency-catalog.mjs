/**
 * Fast rebuild: full agent markdown into catalog (Chinese shell + full body).
 * Body translated via Google gtx when --translate is passed.
 *
 * node scripts/rebuild-agency-catalog.mjs
 * node scripts/rebuild-agency-catalog.mjs --translate
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inferKickoffWaveForCatalog } from "./infer-kickoff-wave.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "src/office/agencyCatalog.generated.json");
const CACHE = path.join(ROOT, ".cache/agency-agents");
const TREE = path.join(ROOT, ".cache/agency-tree.json");
const RAW_BASE = "https://cdn.jsdelivr.net/gh/msitarzewski/agency-agents@main/";
const DO_TRANSLATE = process.argv.includes("--translate");

const EPOCH = 1_704_067_200_000;
const WORKER_ID = 1n;
const DATACENTER_ID = 1n;
const SEQUENCE_BITS = 12n;
const WORKER_BITS = 5n;
const DATACENTER_BITS = 5n;
const MAX_SEQUENCE = (1n << SEQUENCE_BITS) - 1n;

function fnv1a64(input) {
  let hash = 0xcbf29ce484222325n;
  for (let i = 0; i < input.length; i++) {
    hash ^= BigInt(input.charCodeAt(i));
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return hash;
}

function stableSnowflakeFromKey(key) {
  const h = fnv1a64(String(key).trim());
  const ts = BigInt(EPOCH) + (h % 8_640_000_000_000n);
  const seq = h & MAX_SEQUENCE;
  const id =
    ((ts - BigInt(EPOCH)) << (DATACENTER_BITS + WORKER_BITS + SEQUENCE_BITS)) |
    (DATACENTER_ID << (WORKER_BITS + SEQUENCE_BITS)) |
    (WORKER_ID << SEQUENCE_BITS) |
    seq;
  return id.toString();
}

const SKIP_BASE = new Set([
  "README.md",
  "CONTRIBUTING.md",
  "CONTRIBUTING_zh-CN.md",
  "SECURITY.md",
  "LICENSE.md",
  "CODE_OF_CONDUCT.md",
]);

const DIV_ZH = {
  academic: "学术",
  design: "设计",
  engineering: "工程",
  finance: "财务",
  "game-development": "游戏",
  gis: "GIS",
  healthcare: "医疗",
  marketing: "市场",
  "paid-media": "付费媒介",
  product: "产品",
  "project-management": "项目管理",
  sales: "销售",
  security: "安全",
  "spatial-computing": "空间计算",
  specialized: "专项",
  strategy: "战略",
  support: "支持",
  testing: "测试",
  integrations: "集成",
  "software-company": "软件公司",
};

const SOFTWARE_COMPANY_ROLE_IDS = [
  "product-manager",
  "product-trend-researcher",
  "engineering-frontend-developer",
  "engineering-backend-architect",
  "engineering-senior-developer",
  "engineering-software-architect",
  "engineering-ai-engineer",
  "engineering-mobile-app-builder",
  "engineering-devops-automator",
  "engineering-sre",
  "engineering-code-reviewer",
  "engineering-git-workflow-master",
  "engineering-database-optimizer",
  "engineering-api-platform-engineer",
  "engineering-technical-writer",
  "engineering-incident-response-commander",
  "design-ui-designer",
  "design-ux-researcher",
  "design-ux-architect",
  "design-brand-guardian",
  "testing-test-automation-engineer",
  "testing-api-tester",
  "testing-performance-benchmarker",
  "testing-evidence-collector",
  "security-appsec-engineer",
  "security-architect",
  "project-manager-senior",
  "project-management-project-shepherd",
  "project-management-jira-workflow-steward",
  "support-support-responder",
  "support-infrastructure-maintainer",
  "marketing-content-creator",
  "sales-engineer",
  "sales-outbound-strategist",
  "finance-bookkeeper-controller",
  "business-strategist",
  "agents-orchestrator",
  "engineering-feishu-integration-developer",
  "engineering-desktop-app-engineer",
  "engineering-wechat-mini-program-developer",
  "specialized-mcp-builder",
  "specialized-chief-of-staff",
  "data-privacy-officer",
  "hr-onboarding",
  "zk-steward",
];

const SECTION_MAP = [
  [/^#\s+(.+?)\s+Agent Personality\s*$/gim, "# $1 岗位人设"],
  [/^##\s+[^\n]*Identity & Memory\s*$/gim, "## 🧠 身份与记忆"],
  [/^##\s+[^\n]*Core Mission\s*$/gim, "## 🎯 核心使命"],
  [/^##\s+[^\n]*Critical Rules[^\n]*$/gim, "## 🚨 必须遵守的规则"],
  [/^##\s+[^\n]*Technical Deliverables\s*$/gim, "## 📋 技术交付物"],
  [/^##\s+[^\n]*Workflow Process\s*$/gim, "## 🔄 工作流程"],
  [/^##\s+[^\n]*Communication Style\s*$/gim, "## 💭 沟通风格"],
  [/^##\s+[^\n]*Learning & Memory\s*$/gim, "## 🔄 学习与记忆"],
  [/^##\s+[^\n]*Success Metrics\s*$/gim, "## 🎯 成功标准"],
  [/^##\s+[^\n]*Advanced Capabilities\s*$/gim, "## 🚀 进阶能力"],
  [/^You are\s+\*\*(.+?)\*\*/gim, "你是 **$1**"],
];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function loadNameZhMap() {
  try {
    const src = fs.readFileSync(path.join(__dirname, "localize-agency-catalog.mjs"), "utf8");
    const m = src.match(/const NAME_ZH = \{([\s\S]*?)\n\};/);
    if (!m) return {};
    return new Function(`return ({${m[1]}})`)();
  } catch {
    return {};
  }
}

function parseFrontmatter(raw) {
  if (!raw.startsWith("---")) return { meta: {}, body: raw };
  const end = raw.indexOf("\n---", 3);
  if (end < 0) return { meta: {}, body: raw };
  const fm = raw.slice(3, end).trim();
  const body = raw.slice(end + 4).replace(/^\s*\n/, "");
  const meta = {};
  for (const line of fm.split("\n")) {
    const m = line.match(/^(\w+):\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    meta[m[1]] = v;
  }
  return { meta, body };
}

function isAgentPath(p) {
  if (!p.endsWith(".md")) return false;
  const base = path.basename(p);
  if (SKIP_BASE.has(base)) return false;
  if (p.startsWith(".github/") || p.startsWith("examples/")) return false;
  if (p.startsWith("strategy/")) return false; // playbooks / runbooks, not agent personas
  if (p.startsWith("integrations/")) return false;
  return p.includes("/");
}

async function translateChunk(text) {
  const q = text.slice(0, 4500);
  if (!q.trim()) return q;
  const url =
    "https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=zh-CN&dt=t&q=" +
    encodeURIComponent(q);
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(String(res.status));
    const data = await res.json();
    return (data?.[0] || []).map((row) => row?.[0] || "").join("") || q;
  } catch {
    return q;
  }
}

async function maybeTranslateBody(body) {
  let s = body;
  for (const [re, repl] of SECTION_MAP) s = s.replace(re, repl);
  if (!DO_TRANSLATE) return s;
  const fenceRe = /```[\s\S]*?```/g;
  const segments = [];
  let last = 0;
  let m;
  while ((m = fenceRe.exec(s))) {
    if (m.index > last) segments.push({ type: "text", value: s.slice(last, m.index) });
    segments.push({ type: "code", value: m[0] });
    last = m.index + m[0].length;
  }
  if (last < s.length) segments.push({ type: "text", value: s.slice(last) });
  const out = [];
  for (const seg of segments) {
    if (seg.type === "code") {
      out.push(seg.value);
      continue;
    }
    const paras = seg.value.split(/\n\n+/);
    let buf = "";
    for (const p of paras) {
      if ((buf + "\n\n" + p).length > 3200 && buf) {
        out.push(await translateChunk(buf));
        await sleep(100);
        buf = p;
      } else buf = buf ? buf + "\n\n" + p : p;
    }
    if (buf) {
      out.push(await translateChunk(buf));
      await sleep(100);
    }
  }
  return out.join("");
}

async function download(rel) {
  const dest = path.join(CACHE, ...rel.split("/"));
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (fs.existsSync(dest) && fs.statSync(dest).size > 40) return fs.readFileSync(dest, "utf8");
  const res = await fetch(RAW_BASE + rel);
  if (!res.ok) throw new Error(`${rel} ${res.status}`);
  const text = await res.text();
  fs.writeFileSync(dest, text, "utf8");
  return text;
}

function inferBrain(division, id) {
  if (
    /orchestrat|chief-of-staff|incident-response-commander|meeting-notes|project-shepherd|project-manager-senior/i.test(
      id,
    )
  ) {
    return "command";
  }
  if (/security|audit|review|compliance/i.test(id)) return "command";
  if (/technical-writer|content-creator|translator|zk-steward/i.test(id)) return "work";
  if (
    division === "engineering" ||
    division === "testing" ||
    division === "game-development" ||
    division === "gis" ||
    division === "spatial-computing" ||
    /developer|engineer|architect|code|frontend|backend|devops|mobile/i.test(id)
  )
    return "code";
  return "work";
}

function inferKind(id) {
  // Word-boundary style: avoid matching "cto" inside injector/collector/refactoring
  if (/(^|[-_])(ceo|cfo|cto|coo|boss)([-_]|$)/i.test(id)) return "boss";
  if (/chief(?:-of-staff|-financial-officer)?/i.test(id)) return "boss";
  if (/reviewer|auditor|guardian|finish-gate|gate-reviewer/i.test(id)) return "reviewer";
  return "worker";
}

async function main() {
  const tree = JSON.parse(fs.readFileSync(TREE, "utf8"));
  const paths = (tree.tree || []).map((t) => t.path).filter(isAgentPath).sort();
  console.log("agents", paths.length, "translate", DO_TRANSLATE);
  const nameZhMap = loadNameZhMap();
  const roles = [];
  let i = 0;
  for (const rel of paths) {
    i++;
    if (i % 10 === 0 || i === 1) console.log(`[${i}/${paths.length}] ${rel}`);
    let raw;
    try {
      raw = await download(rel);
    } catch (e) {
      console.warn("skip", rel, e.message);
      continue;
    }
    const { meta, body } = parseFrontmatter(raw);
    const id = path.basename(rel, ".md");
    const division = rel.split("/")[0];
    const name = meta.name || id;
    let nameZh = nameZhMap[name] || nameZhMap[name.replace(/-/g, " ")];
    if (!nameZh || nameZh === name) {
      nameZh = DO_TRANSLATE ? await translateChunk(name) : name;
      if (DO_TRANSLATE) await sleep(60);
    }
    const emoji = meta.emoji || "💼";
    const divZh = DIV_ZH[division] || division;
    const vibe = meta.vibe || meta.description || "";
    let vibeZh = vibe;
    if (vibe && DO_TRANSLATE) {
      vibeZh = await translateChunk(vibe);
      await sleep(60);
    }
    const bodyZh = await maybeTranslateBody(body);
    const roleKind = inferKind(id);
    const brainSlot = inferBrain(division, id);
    const description = `${divZh} · ${nameZh}${vibeZh ? ` — ${vibeZh}` : ""}`.slice(0, 280);
    const prompt = [
      `你是「${nameZh}」。`,
      `所属部门：${divZh}。`,
      `请严格按下列完整岗位说明工作；默认用中文回复（除非用户要求其他语言）。`,
      `交付时说明假设、步骤与验收标准；不确定处先提问再动手。`,
      ``,
      `—— 完整岗位说明 ——`,
      bodyZh.trim(),
    ].join("\n");

    roles.push({
      id: stableSnowflakeFromKey(id),
      name,
      nameZh,
      emoji,
      division,
      divisionZh: divZh,
      description,
      roleKind,
      brainSlot,
      kickoffWave: inferKickoffWaveForCatalog(division, id),
      prompt,
      source: rel,
    });
  }

  const bySlug = new Map(
    roles.map((r) => [path.basename(r.source || "", ".md"), r]),
  );
  let soft = 0;
  for (const rid of SOFTWARE_COMPANY_ROLE_IDS) {
    const base = bySlug.get(rid);
    if (!base) continue;
    soft++;
    roles.push({
      ...base,
      id: stableSnowflakeFromKey(`software-company__${rid}`),
      division: "software-company",
      divisionZh: "软件公司",
      description: `软件公司编制 · ${base.nameZh}`,
      kickoffWave: inferKickoffWaveForCatalog("software-company", `software-company__${rid}`),
      prompt: base.prompt.replace(`所属部门：${base.divisionZh}`, "所属部门：软件公司"),
    });
  }

  fs.writeFileSync(
    OUT,
    JSON.stringify(
      {
        version: 2,
        source: "msitarzewski/agency-agents",
        localizedAt: new Date().toISOString().slice(0, 10),
        translated: DO_TRANSLATE,
        count: roles.length,
        roles,
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
  console.log("wrote", roles.length, "software-company", soft);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
