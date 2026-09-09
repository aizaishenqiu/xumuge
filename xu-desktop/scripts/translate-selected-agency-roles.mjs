/**
 * Fully translate selected agency role bodies to zh-CN and update
 * src/office/agencyCatalog.generated.json prompts (incl. software-company__*).
 *
 * node scripts/translate-selected-agency-roles.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "src/office/agencyCatalog.generated.json");
const CACHE = path.join(ROOT, ".cache/agency-agents");

const ROLE_IDS = [
  "product-manager",
  "engineering-frontend-developer",
  "engineering-backend-architect",
  "engineering-senior-developer",
  "engineering-ai-engineer",
  "engineering-devops-automator",
  "engineering-code-reviewer",
  "engineering-sre",
  "engineering-technical-writer",
  "design-ui-designer",
  "design-ux-researcher",
  "testing-test-automation-engineer",
  "testing-api-tester",
  "security-appsec-engineer",
  "project-manager-senior",
  "support-support-responder",
  "academic-anthropologist",
];

const SECTION_MAP = [
  [/^#\s+(.+?)\s+Agent Personality\s*$/gim, "# $1 岗位人设"],
  [/^#\s+(.+?)\s+Agent\s*$/gim, "# $1 岗位"],
  [/^##\s+[^\n]*Identity & Memory\s*$/gim, "## 🧠 身份与记忆"],
  [/^##\s+[^\n]*Core Mission\s*$/gim, "## 🎯 核心使命"],
  [/^##\s+[^\n]*Core Responsibilities\s*$/gim, "## 📋 核心职责"],
  [/^##\s+[^\n]*Critical Rules[^\n]*$/gim, "## 🚨 必须遵守的规则"],
  [/^##\s+[^\n]*Technical Deliverables\s*$/gim, "## 📋 技术交付物"],
  [/^##\s+[^\n]*Workflow Process\s*$/gim, "## 🔄 工作流程"],
  [/^##\s+[^\n]*Communication Style\s*$/gim, "## 💭 沟通风格"],
  [/^##\s+[^\n]*Learning & Memory\s*$/gim, "## 🔄 学习与记忆"],
  [/^##\s+[^\n]*Learning & Improvement\s*$/gim, "## 🔄 学习与改进"],
  [/^##\s+[^\n]*Success Metrics\s*$/gim, "## 🎯 成功标准"],
  [/^##\s+[^\n]*Success Criteria\s*$/gim, "## 🎯 成功标准"],
  [/^##\s+[^\n]*Advanced Capabilities\s*$/gim, "## 🚀 进阶能力"],
  [/^##\s+[^\n]*Development Philosophy\s*$/gim, "## 🎨 开发哲学"],
  [/^##\s+[^\n]*Implementation Process\s*$/gim, "## 🛠️ 实现流程"],
  [/^##\s+[^\n]*Technical Stack Expertise\s*$/gim, "## 💻 技术栈专长"],
  [/^##\s+[^\n]*Review Checklist\s*$/gim, "## 📋 审查清单"],
  [/^##\s+[^\n]*Review Comment Format\s*$/gim, "## 📝 审查评论格式"],
  [/^##\s+[^\n]*SLO Framework\s*$/gim, "## 📋 SLO 框架"],
  [/^##\s+[^\n]*Observability Stack\s*$/gim, "## 🔭 可观测性栈"],
  [/^##\s+[^\n]*Incident Response Integration\s*$/gim, "## 🔥 事件响应集成"],
  [/^You are\s+\*\*(.+?)\*\*/gim, "你是 **$1**"],
];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function parseFrontmatter(raw) {
  if (!raw.startsWith("---")) return { body: raw };
  const end = raw.indexOf("\n---", 3);
  if (end < 0) return { body: raw };
  const body = raw.slice(end + 4).replace(/^\s*\n/, "");
  return { body };
}

async function translateChunk(text) {
  const q = text.slice(0, 4500);
  if (!q.trim()) return q;
  const url =
    "https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=zh-CN&dt=t&q=" +
    encodeURIComponent(q);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`translate HTTP ${res.status}`);
  const data = await res.json();
  return (data?.[0] || []).map((row) => row?.[0] || "").join("") || q;
}

async function translateBody(body) {
  let s = body;
  for (const [re, repl] of SECTION_MAP) s = s.replace(re, repl);

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
        await sleep(120);
        buf = p;
      } else buf = buf ? buf + "\n\n" + p : p;
    }
    if (buf) {
      out.push(await translateChunk(buf));
      await sleep(120);
    }
  }
  return out.join("");
}

function stripSourceUrls(text) {
  return text
    .replace(/\n*##?\s*参考来源[\s\S]*$/m, "")
    .replace(/\n*##?\s*Sources?\s*\n[\s\S]*$/im, "")
    .replace(/\n*参考来源[：:].*$/gm, "")
    .trim();
}

function buildPrompt({ nameZh, id, divisionZh, bodyZh }) {
  return [
    `你是「${nameZh}」（岗位 id：${id}）。`,
    `所属部门：${divisionZh}。`,
    `请严格按下列完整岗位说明工作；默认用中文回复（除非用户要求其他语言）。`,
    `交付时说明假设、步骤与验收标准；不确定处先提问再动手。`,
    ``,
    `—— 完整岗位说明 ——`,
    bodyZh.trim(),
  ].join("\n");
}

function looksMostlyChinese(text) {
  const sample = text.replace(/```[\s\S]*?```/g, "").slice(0, 2000);
  const zh = (sample.match(/[\u4e00-\u9fff]/g) || []).length;
  const en = (sample.match(/[A-Za-z]/g) || []).length;
  return zh > en * 0.4 && zh > 80;
}

async function main() {
  const catalog = JSON.parse(fs.readFileSync(OUT, "utf8"));
  const byId = new Map(catalog.roles.map((r) => [r.id, r]));
  let ok = 0;
  const failed = [];

  for (const id of ROLE_IDS) {
    const role = byId.get(id);
    if (!role) {
      failed.push({ id, reason: "missing role" });
      continue;
    }
    const srcRel = role.source;
    const mdPath = path.join(CACHE, ...srcRel.split("/"));
    if (!fs.existsSync(mdPath)) {
      failed.push({ id, reason: `missing md ${srcRel}` });
      continue;
    }
    console.log(`translating ${id} ...`);
    const raw = fs.readFileSync(mdPath, "utf8");
    const { body } = parseFrontmatter(raw);
    let bodyZh;
    try {
      bodyZh = stripSourceUrls(await translateBody(body));
    } catch (e) {
      failed.push({ id, reason: String(e.message || e) });
      continue;
    }
    if (!looksMostlyChinese(bodyZh)) {
      failed.push({ id, reason: "translation quality check failed (not mostly Chinese)" });
      continue;
    }

    role.prompt = buildPrompt({
      nameZh: role.nameZh || role.name,
      id: role.id,
      divisionZh: role.divisionZh,
      bodyZh,
    });

    const scId = `software-company__${id}`;
    const sc = byId.get(scId);
    if (sc) {
      sc.prompt = buildPrompt({
        nameZh: sc.nameZh || role.nameZh || role.name,
        id: sc.id,
        divisionZh: "软件公司",
        bodyZh,
      });
    }

    ok++;
    console.log(`  ok ${id}${sc ? " + " + scId : ""} (body ${bodyZh.length} chars)`);
  }

  catalog.localizedAt = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(OUT, JSON.stringify(catalog, null, 2) + "\n", "utf8");
  console.log(JSON.stringify({ ok, failed, totalRequested: ROLE_IDS.length }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
