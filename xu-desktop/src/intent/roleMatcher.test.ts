/**
 * @file roleMatcher 领域词典匹配单测
 * @author qiuye <yjk150@qq.com>
 * @date 2026-09-05
 * @version 1.0.0
 * @category Parse
 * @algo domain-lexicon-role-match
 */
import { describe, expect, it } from "vitest";
import type { AgencyRole } from "../office/agencyRoles";
import type { RequirementBrief } from "./briefTypes";
import { rankRolesForBrief } from "./roleMatcher";
import { classifyWorkMode } from "./workModeClassifier";

function role(partial: Partial<AgencyRole> & { id: string; nameZh: string; division: string }): AgencyRole {
  return {
    name: partial.id,
    emoji: "🧠",
    description: partial.description || partial.nameZh,
    roleKind: "worker",
    brainSlot: "work",
    prompt: "",
    source: "test",
    kickoffWave: "planning",
    tags: [],
    ...partial,
  };
}

function brief(goal: string, extra?: Partial<RequirementBrief>): RequirementBrief {
  return {
    projectId: "p1",
    status: "ready",
    goal,
    industry: "",
    constraints: [],
    decisions: [],
    acceptance: [],
    scopeIn: [],
    scopeOut: [],
    openQuestions: [],
    pendingGapQuestions: [],
    matchedRoleIds: [],
    matchPlan: [],
    clarifyRound: 0,
    updatedAt: 0,
    version: 1,
    ...extra,
  };
}

const POOL: AgencyRole[] = [
  role({ id: "finance-tax-planning", nameZh: "财务 · 税务筹划", division: "finance", tags: ["税务筹划", "企业财务"] }),
  role({ id: "finance-cashier", nameZh: "财务 · 出纳", division: "finance", tags: ["出纳", "企业财务"] }),
  role({ id: "finance-role-an82rxpycl", nameZh: "财务 · 自然语言A股条件选股", division: "finance", tags: ["A股", "选股"] }),
  role({
    id: "engineering-wechat-mini-program-developer",
    nameZh: "软件研发 · 微信小程序开发",
    division: "engineering",
    kickoffWave: "dev",
    tags: ["前端"],
  }),
  role({ id: "product-manager", nameZh: "产品 · 产品经理", division: "product", tags: ["产品"] }),
  role({
    id: "sales-outreach",
    nameZh: "客户成功 · 外联专员",
    division: "specialized",
    tags: ["销售售前"],
  }),
];

describe("rankRolesForBrief", () => {
  it("matches tax planning not 选股 or frontend", () => {
    const plan = rankRolesForBrief(POOL, brief("帮我做增值税筹划"));
    expect(plan[0]?.roleId).toBe("finance-tax-planning");
    expect(plan.map((p) => p.roleId)).not.toContain("engineering-wechat-mini-program-developer");
    expect(plan.map((p) => p.roleId)).not.toContain("finance-role-an82rxpycl");
  });

  it("matches cashier for 日清", () => {
    const plan = rankRolesForBrief(POOL, brief("做出纳日清"));
    expect(plan[0]?.roleId).toBe("finance-cashier");
  });

  it("prefers software core for mini program", () => {
    const plan = rankRolesForBrief(POOL, brief("我想做一个收费小程序"), { projectType: "software" });
    expect(plan.map((p) => p.roleId)).toContain("engineering-wechat-mini-program-developer");
    expect(plan[0]?.roleId).not.toBe("finance-cashier");
  });

  it("matches outreach for 获客 not frontend or 选股", () => {
    const plan = rankRolesForBrief(POOL, brief("帮我获客"));
    expect(plan[0]?.roleId).toBe("sales-outreach");
    expect(plan.map((p) => p.roleId)).not.toContain("engineering-wechat-mini-program-developer");
    expect(plan.map((p) => p.roleId)).not.toContain("finance-role-an82rxpycl");
  });
});

describe("classifyWorkMode finance", () => {
  it("treats tax planning as delivery", () => {
    expect(classifyWorkMode("帮我做增值税筹划").mode).toBe("delivery");
  });

  it("still treats mini program as software_build", () => {
    expect(classifyWorkMode("我想做一个收费小程序").mode).toBe("software_build");
  });

  it("treats 获客 as delivery", () => {
    expect(classifyWorkMode("帮我获客").mode).toBe("delivery");
  });
});
