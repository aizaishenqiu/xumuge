/**
 * @file virmoor-role-content-audit.mjs
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-30
 * @version 1.0.0
 * @category role-pack
 * @algo 岗位正文质量审计（九段式/协同块/货架残留/prompt 长度）
 */
import fs from "node:fs";
import path from "node:path";
import { buildFullPrompt } from "./role-prompt-shell.mjs";
import { parseFrontmatter } from "./virmoor-role-debrand.mjs";

export const MUST_SECTIONS = [
  { label: "身份与记忆", alts: ["身份与记忆", "🧠 身份"] },
  { label: "核心使命", alts: ["核心使命", "🎯 核心使命"] },
  { label: "必须遵守的规则", alts: ["必须遵守的规则", "🚨 必须遵守"] },
  { label: "技术交付物", alts: ["技术交付物", "📋 技术交付"] },
  { label: "工作流程", alts: ["工作流程", "🔄 工作"] },
  { label: "沟通风格", alts: ["沟通风格", "💬 沟通"] },
  { label: "学习与记忆", alts: ["学习与记忆", "📚 学习"] },
  { label: "成功标准", alts: ["成功标准", "🎯 成功标准"] },
  { label: "进阶能力", alts: ["进阶能力", "🚀 进阶"] },
];

export const SHELF_RESIDUE =
  /WorkBuddy|workbuddy|MOSS增长|MOSS公开|鹏城信息AI专家|企鹅教师助手|知文文|马滢老师/gi;

export const SOFTWARE_DIVISIONS = new Set([
  "product",
  "engineering",
  "testing",
  "design",
  "security",
  "project-management",
]);

export const S_TIER_SLUGS = new Set([
  "product-manager",
  "product-director",
  "engineering-backend-architect",
  "engineering-director",
  "project-management-project-shepherd",
]);

export function detectSections(body) {
  const present = [];
  const missing = [];
  for (const { label, alts } of MUST_SECTIONS) {
    if (alts.some((a) => body.includes(a))) present.push(label);
    else missing.push(label);
  }
  return { present, missing };
}

export function hasCollaborationBlock(body) {
  return /协同边界|交\s*`?product-manager`?|PM 拆分派活/.test(body);
}

export function hasAcceptanceBlock(body) {
  return /验收标准|Given-When-Then|可检查项/.test(body);
}

export function hasBasicsRef(body) {
  return /对照共享底座/.test(body);
}

export function auditRoleFile(filePath, kimiRoot) {
  const raw = fs.readFileSync(filePath, "utf8");
  const { meta, bodyMd } = parseFrontmatter(raw);
  const slug = meta.slug || path.basename(filePath, ".md");
  const division = meta.division || path.dirname(filePath).split(path.sep).pop();
  const { missing } = detectSections(bodyMd);
  const prompt = buildFullPrompt({
    nameZh: meta.nameZh || slug,
    division,
    divisionZh: meta.divisionZh,
    bodyMd,
  });
  const issues = [];
  if (missing.length) issues.push({ type: "九段式缺段", detail: missing.join(",") });
  if (SHELF_RESIDUE.test(bodyMd)) issues.push({ type: "货架残留", detail: "brand/nickname" });
  if (meta.roleKind === "worker" && SOFTWARE_DIVISIONS.has(division) && !hasCollaborationBlock(bodyMd)) {
    issues.push({ type: "缺协同边界", detail: division });
  }
  if (meta.roleKind === "worker" && SOFTWARE_DIVISIONS.has(division) && !hasAcceptanceBlock(bodyMd)) {
    issues.push({ type: "缺验收标准", detail: division });
  }
  if (!hasBasicsRef(bodyMd) && DIVISION_BASICS_MAP[division]) {
    issues.push({ type: "缺共享底座引用", detail: division });
  }
  if (prompt.length > 12000 && !S_TIER_SLUGS.has(slug)) {
    issues.push({ type: "prompt过长(告警)", detail: String(prompt.length) });
  }

  let kimiRatio = null;
  if (kimiRoot) {
    const kimiPath = path.join(kimiRoot, division, `${slug}.md`);
    if (fs.existsSync(kimiPath)) {
      const kimi = parseFrontmatter(fs.readFileSync(kimiPath, "utf8"));
      kimiRatio = bodyMd.length / Math.max(1, kimi.bodyMd.length);
    }
  }

  return {
    path: filePath,
    slug,
    nameZh: meta.nameZh,
    division,
    roleKind: meta.roleKind,
    bodyLen: bodyMd.length,
    promptLen: prompt.length,
    missingSections: missing,
    issues,
    kimiBodyRatio: kimiRatio,
    quickPromptCount: (meta.quickPrompts || []).length,
  };
}

export const DIVISION_BASICS_MAP = {
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
  tourism: "tourism-basics.md",
  "party-union": "party-union-basics.md",
  gis: "gis-basics.md",
  "game-development": "game-development-basics.md",
  retail: "retail-basics.md",
  hr: "hr-basics.md",
  operations: "operations-basics.md",
  "supply-chain": "supply-chain-basics.md",
  manufacturing: "manufacturing-basics.md",
  "real-estate": "real-estate-basics.md",
  procurement: "procurement-basics.md",
  media: "media-basics.md",
  nonprofit: "nonprofit-basics.md",
  nutrition: "nutrition-basics.md",
  academic: "academic-basics.md",
  admin: "admin-basics.md",
  agriculture: "agriculture-basics.md",
  energy: "energy-basics.md",
  ip: "ip-basics.md",
  "paid-media": "paid-media-basics.md",
  "board-office": "board-office-basics.md",
  "financial-services": "financial-services-basics.md",
  "risk-control": "risk-control-basics.md",
};

export function auditPack(root, kimiRoot) {
  const files = [];
  function walk(d) {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (ent.name.endsWith(".md") && !ent.name.startsWith("_")) files.push(p);
    }
  }
  walk(root);
  const results = files.map((f) => auditRoleFile(f, kimiRoot));
  const severe = results.filter((r) =>
    r.issues.some((i) => i.type !== "prompt过长(告警)"),
  );
  const byType = {};
  for (const r of results) {
    for (const i of r.issues) byType[i.type] = (byType[i.type] || 0) + 1;
  }
  return {
    scanned: results.length,
    severeCount: severe.length,
    byIssueType: byType,
    results,
  };
}
