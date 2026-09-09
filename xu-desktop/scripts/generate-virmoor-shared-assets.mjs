/**
 * @file generate-virmoor-shared-assets.mjs
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-30
 * @version 1.0.0
 * @category role-pack
 * @algo 从 *-basics.md 生成 virmoor snippets + PM 派活映射初稿
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseFrontmatter, walkMdFiles } from "./lib/virmoor-role-debrand.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const SHARED = path.join(ROOT, "role-packs-src", "_shared");
const SNIPPETS = path.join(SHARED, "virmoor-basics-snippets");
const VIRMoor = path.join(ROOT, "role-packs-src", "zh-CN-virmoor");

const DIVISION_BASICS = {
  product: "product-basics.md",
  engineering: "engineering-basics.md",
  testing: "testing-basics.md",
  design: "design-basics.md",
  security: "security-basics.md",
  "project-management": "project-management-basics.md",
  specialized: "specialized-basics.md",
  finance: "finance-basics.md",
  marketing: "marketing-basics.md",
  sales: "sales-basics.md",
  support: "support-basics.md",
  strategy: "strategy-basics.md",
  consulting: "consulting-basics.md",
  education: "education-basics.md",
  healthcare: "healthcare-basics.md",
};

function extractBullets(sectionText, max = 5) {
  const lines = sectionText.split(/\r?\n/);
  const bullets = [];
  for (const line of lines) {
    const m = line.match(/^[-*]\s+(.+)$/);
    if (m && m[1].length > 4) bullets.push(m[1].trim());
    const t = line.match(/^\|\s*\d+\s*\|\s*(.+?)\s*\|/);
    if (t && t[1].length > 4 && !t[1].startsWith("---")) bullets.push(t[1].trim());
  }
  return bullets.slice(0, max);
}

function extractSection(md, heading) {
  const re = new RegExp(`##\\s*${heading}[\\s\\S]*?(?=\\n##\\s|$)`, "m");
  const m = md.match(re);
  return m ? m[0] : "";
}

function buildSnippet(division, basicsFile) {
  const p = path.join(SHARED, basicsFile);
  if (!fs.existsSync(p)) return null;
  const md = fs.readFileSync(p, "utf8");
  const red = extractBullets(extractSection(md, "一、.*合规红线"), 5);
  const base = extractBullets(extractSection(md, "二、.*底座"), 5);
  const risk = extractBullets(extractSection(md, "四、.*风险自检"), 5);
  const know = extractBullets(extractSection(md, "五、.*知识库"), 8);
  const lines = [
    `# ${division} 要点摘要（构建注入，非完整 basics）`,
    "",
    "## 合规红线（Top 5）",
    ...red.map((b) => `- ${b}`),
    "",
    "## 质量底座（Top 5）",
    ...base.map((b) => `- ${b}`),
    "",
    "## 风险自检（Top 5）",
    ...risk.map((b) => `- ${b}`),
    "",
    "## 领域知识（Top 8）",
    ...know.map((b) => `- ${b}`),
    "",
  ];
  return lines.join("\n").slice(0, 2500);
}

function buildDispatchMatrix() {
  const files = walkMdFiles(VIRMoor).filter((f) => !f.includes("_"));
  const byCat = new Map();
  for (const f of files) {
    const { meta } = parseFrontmatter(fs.readFileSync(f, "utf8"));
    const cat = meta.positionCategory || meta.division || "?";
    if (!byCat.has(cat)) byCat.set(cat, []);
    byCat.get(cat).push({
      slug: meta.slug,
      nameZh: meta.nameZh,
      division: meta.division,
      positionId: meta.positionId,
    });
  }
  const staticRows = [
    ["功能/API/后端", "engineering", "backend-engineer", "engineering-backend-architect, engineering-go-backend-engineer"],
    ["前端/UI", "engineering", "frontend-engineer", "engineering-frontend-architect"],
    ["测试/QA", "testing", "qa-engineer", "testing-test-automation-engineer"],
    ["安全/合规", "security", "security-architect", "security-appsec-engineer"],
    ["产品设计/PRD", "product", "product-manager", "product-manager, product-sprint-prioritizer"],
    ["项目管理", "management", "project-manager", "project-management-project-shepherd"],
    ["数据/分析", "engineering", "data-engineer", "engineering-data-analytics-ppt-specialist"],
    ["内容/文案", "marketing", "marketing-manager", "marketing-content-creator"],
    ["财务", "finance", "cost-accountant", "finance-tax-accountant"],
    ["法务", "support", "legal-advisor", "legal-client-intake"],
  ];
  let md = `# virmoor PM 派活映射表（初稿）

> 真源维护：产品经理 + product-basics.md 第五节。构建/enrich 引用，非运行时注入全文。

## 需求类型 → 岗位

| 需求类型 | division | positionId | 典型 slug（virmoor） |
|----------|----------|------------|----------------------|
`;
  for (const [type, div, pid, slugs] of staticRows) {
    md += `| ${type} | ${div} | ${pid} | ${slugs} |\n`;
  }
  md += "\n## 按 positionCategory 统计（catalog 快照）\n\n";
  for (const [cat, roles] of [...byCat.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 20)) {
    const sample = roles.slice(0, 3).map((r) => r.slug).join(", ");
    md += `- **${cat}**（${roles.length}）：${sample}\n`;
  }
  md += "\n## PM 派活硬规则\n\n";
  md += "1. 先读用户原文，缺口列清单追问。\n";
  md += "2. 清点已配置岗位（edition active_role_ids / 全库列表）。\n";
  md += "3. 按上表映射拆分工作包；无对口岗标记「待补岗」交用户。\n";
  md += "4. 每包附：用户原文 + 任务 + 约束 + 验收标准。\n";
  md += "5. 阶段闸门：需求→设计→开发→自测→测试→发布。\n";
  return md;
}

function main() {
  fs.mkdirSync(SNIPPETS, { recursive: true });
  let snippetCount = 0;
  for (const [div, file] of Object.entries(DIVISION_BASICS)) {
    const snippet = buildSnippet(div, file);
    if (!snippet) continue;
    fs.writeFileSync(path.join(SNIPPETS, `${div}.md`), snippet + "\n", "utf8");
    snippetCount++;
  }
  fs.writeFileSync(path.join(SHARED, "virmoor-pm-dispatch-matrix.md"), buildDispatchMatrix(), "utf8");
  console.log(`[generate-virmoor-shared-assets] snippets=${snippetCount} matrix=virmoor-pm-dispatch-matrix.md`);
}

main();
