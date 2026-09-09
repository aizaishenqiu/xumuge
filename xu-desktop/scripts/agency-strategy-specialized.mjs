/**
 * P3: carve out `strategy` division + tag remaining `specialized` roles.
 * Idempotent — safe to re-run after china-upgrade / polish.
 *
 * node scripts/agency-strategy-specialized.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const CATALOG = path.join(ROOT, "src/office/agencyCatalog.generated.json");

const STRATEGY_IDS = new Set([
  "business-strategist",
  "specialized-chief-of-staff",
  "agents-orchestrator",
  "specialized-strategy-duel-agent",
  "specialized-cultural-intelligence-strategist",
  "supply-chain-strategist",
  "change-management-consultant",
  "ma-integration-manager",
  "xu-boss-assistant",
  "esg-sustainability-officer",
  "specialized-pricing-analyst",
  "operations-manager",
]);

/** id → tags (also applied when still under specialized / after move). */
const TAG_RULES = [
  { tag: "战略指挥", test: (id) => STRATEGY_IDS.has(id) },
  { tag: "法务合规", test: (id) => /^(legal-|data-privacy|specialized-fedramp|healthcare-marketing-compliance)/.test(id) },
  { tag: "人力组织", test: (id) => /^(hr-|recruitment-|resume-|organizational-|corporate-training|personal-growth)/.test(id) },
  { tag: "医疗健康", test: (id) => /^(healthcare-|medical-|aging)/.test(id) },
  { tag: "财务运营", test: (id) => /^(accounts-payable|loan-officer|chief-financial|grant-writer|legal-billing)/.test(id) },
  { tag: "客户成功", test: (id) => /^(customer-|hospitality-|retail-)/.test(id) },
  { tag: "智能体平台", test: (id) => /^(agentic-|agents-|automation-|identity-graph|specialized-mcp|specialized-model|specialized-workflow|lsp-index)/.test(id) },
  { tag: "销售售前", test: (id) => /^(sales-outreach|sales-data|government-digital)/.test(id) },
  { tag: "知识文档", test: (id) => /^(zk-steward|specialized-document|language-translator|report-distribution|data-consolidation)/.test(id) },
  { tag: "工程专项", test: (id) => /^(specialized-codebase|specialized-developer|specialized-civil|specialized-salesforce)/.test(id) },
  { tag: "区域出海", test: (id) => /^(specialized-french|specialized-korean|study-abroad)/.test(id) },
  { tag: "房产置业", test: (id) => /^real-estate-/.test(id) },
];

const DIV_ZH = {
  strategy: "战略",
  specialized: "专项",
  finance: "财务",
};

function baseId(id) {
  return String(id || "").replace(/^software-company__/, "");
}

function tagsFor(id, { allowOther = false } = {}) {
  const bid = baseId(id);
  const tags = [];
  for (const rule of TAG_RULES) {
    if (rule.test(bid)) tags.push(rule.tag);
  }
  if (tags.length === 0 && allowOther) {
    tags.push("其他专项");
  }
  return [...new Set(tags)];
}

function patchShellDivision(prompt, divisionZh) {
  if (!prompt) return prompt;
  return prompt.replace(/所属部门：[^\n]+/, `所属部门：${divisionZh}。`);
}

function patchDescriptionDivision(desc, oldZh, newZh) {
  if (!desc) return desc;
  if (oldZh && desc.startsWith(`${oldZh} ·`)) {
    return desc.replace(`${oldZh} ·`, `${newZh} ·`);
  }
  return desc;
}

const catalog = JSON.parse(fs.readFileSync(CATALOG, "utf8"));
let moved = 0;
let tagged = 0;
let financeMoved = 0;

for (const role of catalog.roles) {
  const bid = baseId(role.id);
  const isMirror = role.division === "software-company" || role.id.startsWith("software-company__");

  // CFO → finance (cleaner than dumping in specialized)
  if (!isMirror && bid === "chief-financial-officer" && role.division !== "finance") {
    const oldZh = role.divisionZh || "专项";
    role.division = "finance";
    role.divisionZh = DIV_ZH.finance;
    role.description = patchDescriptionDivision(role.description, oldZh, DIV_ZH.finance);
    role.prompt = patchShellDivision(role.prompt, DIV_ZH.finance);
    financeMoved += 1;
  }

  // Strategy carve-out (independent roles only; mirrors stay software-company)
  if (!isMirror && STRATEGY_IDS.has(bid) && role.division !== "strategy") {
    const oldZh = role.divisionZh || role.division;
    role.division = "strategy";
    role.divisionZh = DIV_ZH.strategy;
    role.description = patchDescriptionDivision(role.description, oldZh, DIV_ZH.strategy);
    role.prompt = patchShellDivision(role.prompt, DIV_ZH.strategy);
    moved += 1;
  }

  // Tags: specialized / strategy; mirrors only when base has real facet tags
  if (role.division === "specialized" || role.division === "strategy") {
    const next = tagsFor(bid, { allowOther: role.division === "specialized" });
    const prev = Array.isArray(role.tags) ? role.tags.join("|") : "";
    role.tags = next.length ? next : undefined;
    if ((role.tags || []).join("|") !== prev) tagged += 1;
  } else if (isMirror) {
    const next = tagsFor(bid, { allowOther: false });
    if (next.length) {
      const prev = Array.isArray(role.tags) ? role.tags.join("|") : "";
      role.tags = next;
      if (next.join("|") !== prev) tagged += 1;
    } else if (role.tags) {
      delete role.tags;
      tagged += 1;
    }
  } else if (role.tags) {
    delete role.tags;
  }
}

catalog.localizedAt = new Date().toISOString().slice(0, 10);
fs.writeFileSync(CATALOG, JSON.stringify(catalog, null, 2) + "\n", "utf8");

const byDiv = {};
const tagHist = {};
for (const r of catalog.roles) {
  byDiv[r.division] = (byDiv[r.division] || 0) + 1;
  for (const t of r.tags || []) tagHist[t] = (tagHist[t] || 0) + 1;
}

console.log(
  JSON.stringify(
    {
      movedToStrategy: moved,
      movedToFinance: financeMoved,
      tagged,
      strategyCount: byDiv.strategy || 0,
      specializedCount: byDiv.specialized || 0,
      tagHist,
    },
    null,
    2,
  ),
);
