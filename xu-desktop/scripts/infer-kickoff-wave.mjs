/**
 * Shared kickoff wave inference (mirrors src/office/industryWorkflows.ts).
 * Used by tag-kickoff-waves.mjs and rebuild-agency-catalog.mjs.
 */

const SOFTWARE_DIVISION_DEFAULT = {
  product: "planning",
  design: "planning",
  "project-management": "planning",
  strategy: "planning",
  academic: "planning",
  engineering: "dev",
  "software-company": "dev",
  "game-development": "dev",
  gis: "dev",
  "spatial-computing": "dev",
  integrations: "dev",
  testing: "qa",
  security: "planning",
  marketing: "other",
  sales: "other",
  finance: "other",
  support: "other",
  healthcare: "other",
  "paid-media": "other",
  specialized: "other",
};

const SOFTWARE_ROLE_OVERRIDES = {
  "engineering-technical-writer": "planning",
  "engineering-code-reviewer": "qa",
  "engineering-devops-automator": "ops",
  "engineering-sre": "ops",
  "engineering-software-architect": "planning",
  "engineering-backend-architect": "planning",
  "engineering-autonomous-optimization-architect": "planning",
  "engineering-incident-response-commander": "ops",
  "security-appsec-engineer": "qa",
  "security-penetration-tester": "qa",
  "project-manager-senior": "planning",
  "project-management-project-shepherd": "planning",
  "design-ux-architect": "planning",
  "design-ux-researcher": "planning",
};

function inferKickoffWaveFromText(hay) {
  const QA_RE = /测试|qa\b|quality|质检|质量|reviewer|审核/i;
  const DEV_RE =
    /工程|开发|前端|后端|全栈|工程师|developer|architect|desktop|tauri|flutter|android|ios|服务端|api/i;
  const PLANNING_RE =
    /产品|需求|pm\b|规划|项目经理|编排|设计|ux|ui\b|视觉|原型|prd|文档|writer/i;
  const OPS_RE = /运维|devops|部署|secops|sre/i;
  if (QA_RE.test(hay)) return "qa";
  if (DEV_RE.test(hay)) return "dev";
  if (PLANNING_RE.test(hay)) return "planning";
  if (OPS_RE.test(hay)) return "ops";
  return "other";
}

export function inferKickoffWaveForCatalog(division, roleId) {
  if (SOFTWARE_ROLE_OVERRIDES[roleId]) return SOFTWARE_ROLE_OVERRIDES[roleId];
  const baseId = roleId.replace(/^software-company__/, "");
  if (SOFTWARE_ROLE_OVERRIDES[baseId]) return SOFTWARE_ROLE_OVERRIDES[baseId];

  const div = SOFTWARE_DIVISION_DEFAULT[division];
  if (div) return div;

  return inferKickoffWaveFromText(`${division} ${roleId}`);
}
