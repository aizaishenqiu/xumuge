/**
 * @file Brief 复杂度启发式 → 脑槽/模型路由
 * @author qiuye <yjk150@qq.com>
 * @date 2026-09-01
 * @version 1.0.0
 * @category Schedule
 * @algo brief-complexity-score
 */
import type { BrainSlot } from "./employees";

export type ComplexitySignals = {
  briefGapCount?: number;
  crossModule?: boolean;
  codeSurfaceHint?: boolean;
  briefText?: string;
};

export type ComplexityLevel = "low" | "high";

/**
 * Score Brief/kickoff complexity.
 * High → prefer command brain; low → work (or code if code surface).
 */
export function scoreBriefComplexity(signals: ComplexitySignals): {
  level: ComplexityLevel;
  score: number;
  reasons: string[];
} {
  let score = 0;
  const reasons: string[] = [];
  const gaps = Math.max(0, Math.floor(Number(signals.briefGapCount) || 0));
  if (gaps >= 3) {
    score += 3;
    reasons.push(`Brief 缺口 ${gaps}`);
  } else if (gaps >= 1) {
    score += 1;
    reasons.push(`Brief 缺口 ${gaps}`);
  }
  if (signals.crossModule) {
    score += 2;
    reasons.push("跨模块");
  }
  const text = signals.briefText || "";
  if (/跨模块|XU_CROSS_MODULE|发布|上线|等保|付款/i.test(text)) {
    score += 2;
    reasons.push("高风险关键词");
  }
  if (signals.codeSurfaceHint || /改码|仓库|PR|重构|架构/i.test(text)) {
    score += 1;
    reasons.push("改码面");
  }
  const level: ComplexityLevel = score >= 3 ? "high" : "low";
  return { level, score, reasons };
}

/** Pick preferred brain slot for kickoff mapping. */
export function preferredBrainSlotForComplexity(
  level: ComplexityLevel,
  current?: BrainSlot | string | null,
): BrainSlot {
  if (current === "code") return "code";
  if (level === "high") return "command";
  return current === "command" ? "command" : "work";
}
