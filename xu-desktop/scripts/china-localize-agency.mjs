/**
 * Phase-3: China-localize remaining foreign/US-centric examples in agency catalog.
 * node scripts/china-localize-agency.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const CATALOG = path.join(ROOT, "src/office/agencyCatalog.generated.json");

const c = JSON.parse(fs.readFileSync(CATALOG, "utf8"));
const roles = c.roles;

function patch(id, fn) {
  const r = roles.find((x) => x.id === id);
  if (!r) {
    console.log("missing", id);
    return;
  }
  const before = r.prompt;
  r.prompt = fn(before);
  const mir = roles.find((x) => x.id === `software-company__${id}`);
  if (mir) {
    mir.prompt = r.prompt.replace(`岗位 id：${id}`, `岗位 id：software-company__${id}`);
  }
  console.log(id, before === r.prompt ? "NOCHANGE" : "OK");
}

patch("academic-anthropologist", (p) => {
  if (p.includes("中国语境可比案例")) return p;
  const inject = `

## 🇨🇳 中国语境可比案例（优先使用）
设计或评估文化系统时，优先引用中国可比案例，而非默认苏丹努尔人、特罗布里恩等外文田野范例：
- **亲属与宗族**：华北宗族、华南宗族与祠堂、凉山彝族家支
- **村社自治与规范**：黔东南侗族「款约」、传统乡约与村规民约
- **交换与互惠**：乡土社会礼物往来、赶集与市镇商帮、互助会（会）
- **仪式过程**：人生礼仪（出生、成年、婚丧）、节庆与庙会
- **国家与地方**：户籍与流动、单位制遗存、基层治理与人情面子
专有名词可保留双语（如 Geertz / 格尔茨），但举例与场景默认中国。
`;
  if (p.includes("## 📋 技术交付物")) {
    return p.replace("## 📋 技术交付物", `${inject}\n## 📋 技术交付物`);
  }
  return p + inject;
});

const replacements = [
  [/401\(k\)/g, "企业年金/公积金"],
  [/401k/gi, "企业年金/公积金"],
  [/\bW-2\b/g, "工资薪金所得扣缴"],
  [/\b1099\b/g, "劳务报酬/经营所得"],
  [/Medicare Advantage/g, "城乡居民/职工医保"],
  [/Sarbanes-Oxley/g, "中国上市公司内控与证券法要求"],
  [/\bHIPAA\b/g, "HIPAA/个人信息保护法与医疗数据合规"],
];

for (const id of [
  "hr-onboarding",
  "finance-bookkeeper-controller",
  "loan-officer-assistant",
  "medical-billing-coding-specialist",
  "legal-document-review",
  "data-privacy-officer",
  "healthcare-sovereign-health-systems-agent",
  "healthcare-aging-parent-care-companion",
  "engineering-voice-ai-integration-engineer",
  "security-appsec-engineer",
  "security-incident-responder",
]) {
  patch(id, (p) => {
    let out = p;
    for (const [re, to] of replacements) out = out.replace(re, to);
    return out;
  });
}

fs.writeFileSync(CATALOG, JSON.stringify(c, null, 2) + "\n");
console.log("written", CATALOG);
