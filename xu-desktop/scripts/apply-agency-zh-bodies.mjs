/**
 * Apply pre-translated Chinese bodies from .cache/agency-zh/{id}.md
 * into src/office/agencyCatalog.generated.json prompts.
 *
 * node scripts/apply-agency-zh-bodies.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "src/office/agencyCatalog.generated.json");
const ZH_DIR = path.join(ROOT, ".cache/agency-zh");

const ROLE_IDS = fs.existsSync(ZH_DIR)
  ? fs
      .readdirSync(ZH_DIR)
      .filter((f) => f.endsWith(".md"))
      .map((f) => f.replace(/\.md$/, ""))
  : [
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
      "academic-historian",
      "academic-geographer",
      "academic-narratologist",
      "academic-psychologist",
      "academic-statistician",
    ];

function stripSourceUrls(text) {
  return text
    .replace(/\n*##?\s*参考来源[\s\S]*$/m, "")
    .replace(/\n*##?\s*Sources?\s*\n[\s\S]*$/im, "")
    .replace(/\n*参考来源[：:].*$/gm, "")
    .trim();
}

function looksMostlyChinese(text) {
  const sample = text.replace(/```[\s\S]*?```/g, "");
  const zh = (sample.match(/[\u4e00-\u9fff]/g) || []).length;
  const enWords = (sample.match(/\b[A-Za-z]{3,}\b/g) || []).length;
  return zh > 100 && zh > enWords * 0.35;
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

const catalog = JSON.parse(fs.readFileSync(OUT, "utf8"));
const byId = new Map(catalog.roles.map((r) => [r.id, r]));
let ok = 0;
const skipped = [];
const failed = [];

for (const id of ROLE_IDS) {
  const zhPath = path.join(ZH_DIR, `${id}.md`);
  if (!fs.existsSync(zhPath)) {
    skipped.push(id);
    continue;
  }
  const role = byId.get(id);
  if (!role) {
    failed.push({ id, reason: "missing role" });
    continue;
  }
  const bodyZh = stripSourceUrls(fs.readFileSync(zhPath, "utf8"));
  if (!looksMostlyChinese(bodyZh)) {
    failed.push({ id, reason: "not mostly Chinese" });
    continue;
  }
  role.prompt = buildPrompt({
    nameZh: role.nameZh || role.name,
    id: role.id,
    divisionZh: role.divisionZh,
    bodyZh,
  });
  const sc = byId.get(`software-company__${id}`);
  if (sc) {
    sc.prompt = buildPrompt({
      nameZh: sc.nameZh || role.nameZh || role.name,
      id: sc.id,
      divisionZh: "软件公司",
      bodyZh,
    });
  }
  ok++;
  console.log("applied", id, sc ? "+sc" : "", bodyZh.length);
}

catalog.localizedAt = new Date().toISOString().slice(0, 10);
fs.writeFileSync(OUT, JSON.stringify(catalog, null, 2) + "\n", "utf8");
console.log(JSON.stringify({ ok, skipped, failed }, null, 2));
