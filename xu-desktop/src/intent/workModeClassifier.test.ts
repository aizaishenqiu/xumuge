/**
 * @file workModeClassifier 规则与模糊边界单测（无 LLM）
 * @author qiuye <yjk150@qq.com>
 * @date 2026-09-02
 * @version 1.0.0
 * @category Parse
 * @algo rule-priority-work-mode
 */
import { describe, expect, it } from "vitest";
import {
  classifyWorkMode,
  deliveryComplexity,
  isSoftwareBriefWorkMode,
  isWorkModeAmbiguous,
  needsBriefCollection,
} from "./workModeClassifier";
import type { RequirementBrief } from "./briefTypes";

function brief(partial: Partial<RequirementBrief>): RequirementBrief {
  return {
    projectId: "p1",
    status: "gathering",
    goal: "",
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
    ...partial,
  };
}

describe("classifyWorkMode", () => {
  it("treats改按钮 as operation", () => {
    expect(classifyWorkMode("帮我改登录按钮").mode).toBe("operation");
  });

  it("treats收费小程序 as software_build", () => {
    expect(classifyWorkMode("我想做一个收费小程序").mode).toBe("software_build");
  });

  it("treats竞品报告 as delivery complex", () => {
    const r = classifyWorkMode("我想做一份竞品调研报告，要可验收");
    expect(r.mode).toBe("delivery");
    expect(r.complexity).toBe("complex");
  });
});

describe("isWorkModeAmbiguous", () => {
  it("is false for clear operation", () => {
    expect(isWorkModeAmbiguous("帮我改登录按钮")).toBe(false);
  });

  it("is true when operation and build both match", () => {
    expect(isWorkModeAmbiguous("帮我做一个登录功能并改现有按钮")).toBe(true);
  });

  it("is true for vague 做一个东西", () => {
    expect(isWorkModeAmbiguous("我想做一个东西")).toBe(true);
  });

  it("is false when gathering brief already has workMode", () => {
    expect(
      isWorkModeAmbiguous("继续补充", brief({ workMode: "delivery", status: "gathering" })),
    ).toBe(false);
  });
});

describe("isSoftwareBriefWorkMode", () => {
  it("prefers brief.workMode over project type", () => {
    expect(
      isSoftwareBriefWorkMode(brief({ workMode: "delivery" }), {
        id: "x",
        type: "software",
      } as never),
    ).toBe(false);
  });

  it("falls back to project type when brief has no workMode", () => {
    expect(
      isSoftwareBriefWorkMode(brief({}), { id: "x", type: "software" } as never),
    ).toBe(true);
  });
});

describe("needsBriefCollection", () => {
  it("requires brief for software_build", () => {
    expect(needsBriefCollection({ mode: "software_build" })).toBe(true);
  });

  it("requires brief for delivery complex only", () => {
    expect(needsBriefCollection({ mode: "delivery", complexity: "complex" })).toBe(true);
    expect(needsBriefCollection({ mode: "delivery", complexity: "simple" })).toBe(false);
  });
});

describe("deliveryComplexity", () => {
  it("marks long text as complex", () => {
    expect(deliveryComplexity("x".repeat(80))).toBe("complex");
  });
});
