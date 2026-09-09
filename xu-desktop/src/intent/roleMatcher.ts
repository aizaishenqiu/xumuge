/**
 * @file 按需求 Brief 匹配岗位并生成派活任务
 * @author qiuye <yjk150@qq.com>
 * @date 2026-09-05
 * @version 1.3.0
 * @category Parse
 * @algo domain-lexicon-role-match
 */
import { ensureAgencyCatalog, getAgencyRole, listAgencyRoles, type AgencyRole } from "../office/agencyRoles";
import type { RequirementBrief, RoleMatchItem } from "./briefTypes";

const SOFTWARE_CORE = [
  /product|规划|产品|pm|orchestrator|需求分析/i,
  /frontend|前端|ui/i,
  /backend|后端|api/i,
  /qa|测试|质检/i,
];

const SOFTWARE_ROLE_RE = /frontend|前端|backend|后端|engineering|软件研发|小程序开发|vue|react/i;

const INVEST_RE = /A股|选股|K线|MACD|筹码|行情|投研|路演|新股专家|均线/;

const FINANCE_WORK_RE =
  /出纳|日清月结|报税|增值税|税务筹划|税筹|筹划|汇算清缴|加计扣除|出口退税|个税|社保公积金|五险一金|往来会计|费用会计|费用报销|内审|内部审计|函证|年审|外审|土增税|土地增值税|转让定价|消费税|存货核算|项目核算|建筑业财税|数电票|企业所得税/;

const LEADS_WORK_RE =
  /获客|找客户|找线索|外联|冷邮件|冷拜访|线索名单|理想客户/;

const CORP_FINANCE_RE =
  /企业财务|出纳|税务|核算|审计|往来|费用会计|汇算|加计|退税|数电票|资金管理|总账|内审/;

type DomainHint = {
  re: RegExp;
  slugs: string[];
  nameHints: string[];
};

const DOMAIN_HINTS: DomainHint[] = [
  { re: /出纳|日清月结|现金盘点|银行余额调节/, slugs: ["finance-cashier"], nameHints: ["出纳"] },
  { re: /税务筹划|税筹|合法筹划|增值税筹划/, slugs: ["finance-tax-planning"], nameHints: ["税务筹划"] },
  { re: /汇算清缴|企业所得税汇算/, slugs: ["finance-cit-annual-settlement"], nameHints: ["汇算清缴"] },
  { re: /加计扣除|研发费用加计/, slugs: ["finance-rd-super-deduction"], nameHints: ["加计扣除"] },
  { re: /出口退税|免抵退/, slugs: ["finance-export-tax-rebate"], nameHints: ["出口退税"] },
  { re: /个税|薪酬核算|工资个税/, slugs: ["finance-payroll-iit"], nameHints: ["个税"] },
  { re: /社保公积金|五险一金/, slugs: ["finance-social-security-accountant"], nameHints: ["社保公积金"] },
  { re: /往来会计|账龄|函证/, slugs: ["finance-current-accountant", "finance-credit-risk-specialist"], nameHints: ["往来"] },
  { re: /费用会计|费用报销/, slugs: ["finance-expense-accountant"], nameHints: ["费用会计"] },
  { re: /内部审计|内审(?!总监)/, slugs: ["finance-internal-auditor"], nameHints: ["内部审计"] },
  { re: /年审|外审|事务所/, slugs: ["finance-external-audit-coord"], nameHints: ["外审"] },
  { re: /IT审计|信息系统审计|ERP权限/, slugs: ["finance-it-auditor"], nameHints: ["IT审计"] },
  { re: /工程审计|造价审计|基建审计/, slugs: ["finance-construction-auditor"], nameHints: ["工程"] },
  { re: /经济责任审计|离任审计/, slugs: ["finance-economic-responsibility-auditor"], nameHints: ["经济责任"] },
  { re: /反舞弊|舞弊/, slugs: ["finance-anti-fraud"], nameHints: ["反舞弊"] },
  { re: /土增税|土地增值税/, slugs: ["finance-land-vat"], nameHints: ["土地增值税"] },
  { re: /消费税/, slugs: ["finance-consumption-tax"], nameHints: ["消费税"] },
  { re: /转让定价|关联交易定价/, slugs: ["finance-transfer-pricing"], nameHints: ["转让定价"] },
  { re: /存货核算/, slugs: ["finance-inventory-accountant"], nameHints: ["存货"] },
  { re: /项目核算|项目会计/, slugs: ["finance-project-accountant"], nameHints: ["项目核算"] },
  { re: /建筑业财税|建筑服务.*税/, slugs: ["finance-construction-tax"], nameHints: ["建筑业财税"] },
  { re: /增值税|报税|申报/, slugs: ["finance-tax-accountant"], nameHints: ["税务会计"] },
  { re: /标书|招投标|招标/, slugs: ["sales-bid-proposal-writer"], nameHints: ["招投标"] },
  { re: /获客|找客户|写外联|外联草稿|冷邮件|线索名单|理想客户/, slugs: ["sales-outreach"], nameHints: ["外联"] },
];

const LEXICON = [
  "出纳",
  "日清",
  "报税",
  "增值税",
  "税务筹划",
  "税筹",
  "汇算",
  "加计扣除",
  "退税",
  "个税",
  "社保",
  "公积金",
  "往来",
  "费用",
  "内审",
  "函证",
  "年审",
  "外审",
  "土增税",
  "土地增值税",
  "消费税",
  "转让定价",
  "存货",
  "标书",
  "招投标",
  "获客",
  "外联",
  "线索",
  "ICP",
  "小程序",
  "前端",
  "后端",
  "测试",
];

function briefBlob(brief: RequirementBrief): string {
  return [
    brief.goal,
    brief.industry,
    ...(brief.scopeIn || []),
    ...(brief.acceptance || []),
    ...(brief.constraints || []),
  ]
    .join(" ")
    .toLowerCase();
}

export function extractLexiconHits(text: string): string[] {
  const t = (text || "").toLowerCase();
  return LEXICON.filter((w) => t.includes(w.toLowerCase()));
}

function isSoftwareishBrief(brief: RequirementBrief, projectType?: string, blob?: string): boolean {
  const b = blob ?? briefBlob(brief);
  if (projectType === "software") return true;
  if (brief.workMode === "software_build") return true;
  return /小程序|app\b|saas|网站开发|软件开发|写代码/.test(b);
}

function roleHay(role: AgencyRole): string {
  return `${role.nameZh} ${role.name} ${role.id} ${role.division} ${role.divisionZh || ""} ${(role.tags || []).join(" ")} ${role.description || ""}`.toLowerCase();
}

export function scoreRoleAgainstBrief(
  role: AgencyRole,
  brief: RequirementBrief,
  opts?: { projectType?: string },
): number {
  let s = 0;
  const hay = roleHay(role);
  const blob = briefBlob(brief);
  const softwareish = isSoftwareishBrief(brief, opts?.projectType, blob);
  const financeWork = FINANCE_WORK_RE.test(blob);
  const leadsWork = LEADS_WORK_RE.test(blob);

  if (role.kickoffWave === "planning") s += 5;
  else if (role.kickoffWave === "dev") s += 4;
  else if (role.kickoffWave === "qa") s += 4;
  else if (role.kickoffWave === "ops") s += 3;

  for (const w of extractLexiconHits(blob)) {
    if (hay.includes(w.toLowerCase())) s += 18;
  }

  for (const hint of DOMAIN_HINTS) {
    if (!hint.re.test(blob)) continue;
    if (hint.slugs.includes(role.id) || hint.slugs.some((id) => role.id.endsWith(id))) s += 80;
    if (hint.nameHints.some((h) => (role.nameZh || "").includes(h))) s += 40;
  }

  if (softwareish) {
    for (const re of SOFTWARE_CORE) {
      if (re.test(hay)) s += 20;
    }
  } else if (SOFTWARE_ROLE_RE.test(hay) || role.division === "engineering") {
    s -= 40;
  }

  if (financeWork) {
    if (role.division === "finance" && CORP_FINANCE_RE.test(hay)) s += 35;
    if (INVEST_RE.test(role.nameZh || "") || INVEST_RE.test(hay)) s -= 50;
    if (role.division === "finance" && !CORP_FINANCE_RE.test(hay) && INVEST_RE.test(hay)) s -= 30;
  }

  if (leadsWork) {
    if (/外联|获客|销售售前/.test(hay) || role.id === "sales-outreach") s += 35;
    if (INVEST_RE.test(role.nameZh || "")) s -= 50;
  }

  if (brief.industry) {
    const ind = brief.industry.toLowerCase();
    if (hay.includes(ind)) s += 20;
  }

  return s;
}

export function rankRolesForBrief(
  roles: AgencyRole[],
  brief: RequirementBrief,
  opts?: { projectType?: string; limit?: number },
): RoleMatchItem[] {
  const limit = opts?.limit ?? 8;
  const ranked = roles
    .filter((r) => r.roleKind !== "boss")
    .map((r) => ({ role: r, score: scoreRoleAgainstBrief(r, brief, opts) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  const out: RoleMatchItem[] = [];
  const seen = new Set<string>();
  for (const x of ranked) {
    if (seen.has(x.role.id)) continue;
    seen.add(x.role.id);
    out.push({
      roleId: x.role.id,
      roleNameZh: x.role.nameZh || x.role.name,
      task: taskForRole(x.role, brief),
      acceptance: acceptanceForRole(x.role, brief),
    });
    if (out.length >= limit) break;
  }

  if (!out.length && isSoftwareishBrief(brief, opts?.projectType)) {
    for (const r of roles) {
      if (SOFTWARE_CORE.some((re) => re.test(`${r.id} ${r.nameZh}`))) {
        if (seen.has(r.id)) continue;
        seen.add(r.id);
        out.push({
          roleId: r.id,
          roleNameZh: r.nameZh || r.name,
          task: taskForRole(r, brief),
          acceptance: acceptanceForRole(r, brief),
        });
        if (out.length >= 4) break;
      }
    }
  }
  return out;
}

function taskForRole(role: AgencyRole, brief: RequirementBrief): string {
  const goal = brief.goal || "本期目标";
  const scope = (brief.scopeIn || []).slice(0, 2).join("、");
  const hay = `${role.nameZh} ${role.id} ${role.kickoffWave || ""}`;
  if (/税务筹划|税筹/.test(hay)) {
    return `在合法适用前提下做税务筹划备忘（依据、测算、风险、备案）：${goal}`;
  }
  if (/出纳/.test(hay)) {
    return `完成资金收付与日清月结相关交付：${goal}`;
  }
  if (/汇算|加计|退税|税务会计|个税|社保公积金/.test(hay)) {
    return `按税法与申报日历推进税务/薪酬核算交付：${goal}${scope ? ` · ${scope}` : ""}`;
  }
  if (/审计|内审|外审|反舞弊/.test(hay)) {
    return `按独立性要求输出审计发现与证据索引：${goal}`;
  }
  if (/外联|获客/.test(hay) || role.id === "sales-outreach") {
    return `起草个性化外联草稿与跟进节奏（发出前须用户确认，禁止群发骚扰）：${goal}`;
  }
  if (/product|规划|产品|pm|需求分析/i.test(hay) && !FINANCE_WORK_RE.test(briefBlob(brief)) && !LEADS_WORK_RE.test(briefBlob(brief))) {
    return `澄清并固化需求：${goal}${scope ? `（范围：${scope}）` : ""}，更新 playbook / Skills`;
  }
  if (/frontend|前端|ui|ux/i.test(hay)) {
    return `按验收实现前端/界面交付：${goal}${scope ? ` · ${scope}` : ""}`;
  }
  if (/backend|后端|api|服务/i.test(hay)) {
    return `按验收实现后端/API：${goal}${scope ? ` · ${scope}` : ""}`;
  }
  if (/qa|测试|质检/i.test(hay) && !/审计/.test(hay)) {
    return `按验收标准验证：${(brief.acceptance || []).slice(0, 3).join("；") || goal}`;
  }
  if (/运维|devops|部署|ops/i.test(hay)) {
    return `部署与运行保障，对齐约束：${(brief.constraints || []).slice(0, 2).join("；") || goal}`;
  }
  return `按岗位职责推进：${goal}`;
}

function acceptanceForRole(role: AgencyRole, brief: RequirementBrief): string[] {
  const all = (brief.acceptance || []).slice(0, 5);
  if (!all.length) return [];
  const hay = `${role.nameZh} ${role.id}`;
  if (/qa|测试|质检/i.test(hay) && !/审计/.test(hay)) return all;
  if (/frontend|前端|ui/i.test(hay)) {
    const hit = all.filter((a) => /界面|前端|页面|交互|UI|UX/i.test(a));
    return hit.length ? hit : all.slice(0, 2);
  }
  if (/backend|后端|api/i.test(hay)) {
    const hit = all.filter((a) => /接口|API|后端|数据|服务/i.test(a));
    return hit.length ? hit : all.slice(0, 2);
  }
  return all.slice(0, 2);
}

export async function buildMatchPlanForBrief(
  brief: RequirementBrief,
  opts?: { projectType?: string; limit?: number },
): Promise<RoleMatchItem[]> {
  await ensureAgencyCatalog();
  return rankRolesForBrief(listAgencyRoles(), brief, opts);
}

export async function matchRolesForBrief(
  brief: RequirementBrief,
  opts?: { projectType?: string; limit?: number },
): Promise<string[]> {
  const plan = await buildMatchPlanForBrief(brief, opts);
  return plan.map((p) => p.roleId);
}

export function enrichMatchPlanNames(plan: RoleMatchItem[]): RoleMatchItem[] {
  return plan.map((row) => {
    if (row.roleNameZh && row.roleNameZh !== row.roleId) return row;
    const role = getAgencyRole(row.roleId);
    return {
      ...row,
      roleNameZh: role?.nameZh || role?.name || row.roleNameZh || row.roleId,
    };
  });
}
