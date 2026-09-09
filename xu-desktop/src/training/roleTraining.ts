/**
 * @file 岗位课程版本、晋级与回滚规则
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-31
 * @version 1.0.0
 * @category AgentLoop
 * @algo baseline-gated-promotion
 */
import {
  saveCurriculum,
  type CurriculumDoc,
  type CurriculumEntry,
} from "../commerce/trainingLocal";
import { latestEvalRunForVersion, type EvalMetrics } from "./roleTrainingEval";

export type PromotionDecision = {
  allowed: boolean;
  reason: string;
  baseline?: EvalMetrics;
  candidate?: EvalMetrics;
};

/** 统一晋级判定：成功率必须严格提升，违规率不得增加。 */
export function isMetricsPromotion(
  baseline: EvalMetrics,
  candidate: EvalMetrics,
): boolean {
  return (
    candidate.successRate > baseline.successRate &&
    candidate.violationRate <= baseline.violationRate
  );
}

export function curriculumScopeKey(entry: Pick<CurriculumEntry, "scope" | "roleId" | "employeeId">): string {
  return entry.scope === "employee"
    ? `employee:${entry.employeeId || ""}`
    : `role:${entry.roleId}`;
}

/** 新建不可直接生效的课程版本；依赖已有文档，保存失败向 UI 抛错。 */
export async function createCurriculumVersion(
  doc: CurriculumDoc,
  draft: Omit<CurriculumEntry, "id" | "version" | "status" | "createdAt">,
): Promise<CurriculumEntry> {
  const key =
    draft.scope === "employee" ? `employee:${draft.employeeId || ""}` : `role:${draft.roleId}`;
  const versions = doc.entries
    .filter((entry) => curriculumScopeKey(entry) === key)
    .map((entry) => entry.version);
  const version = Math.max(0, ...versions) + 1;
  const entry: CurriculumEntry = {
    ...draft,
    id: `${key.replace(":", "_")}_v${version}_${Date.now()}`,
    version,
    status: "draft",
    createdAt: new Date().toISOString(),
  };
  doc.entries = [...doc.entries, entry];
  await saveCurriculum(doc);
  return entry;
}

/** 候选课程必须成功率高于当前基线且违规率不增加，才允许晋级。 */
export async function canPromoteCurriculum(
  doc: CurriculumDoc,
  candidate: CurriculumEntry,
): Promise<PromotionDecision> {
  const key = curriculumScopeKey(candidate);
  const activeVersion = doc.activeVersions[key];
  const candidateRun = await latestEvalRunForVersion(candidate.roleId, candidate.version, candidate.employeeId);
  if (!candidateRun) {
    return { allowed: false, reason: "候选版本尚未运行固定评测套件" };
  }
  if (!activeVersion) {
    return {
      allowed: candidateRun.metrics.violationRate === 0,
      reason:
        candidateRun.metrics.violationRate === 0
          ? "首个版本评测无违规，可晋级"
          : "首个版本仍有违规，不能晋级",
      candidate: candidateRun.metrics,
    };
  }
  const baselineRun = await latestEvalRunForVersion(
    candidate.roleId,
    activeVersion,
    candidate.employeeId,
  );
  if (!baselineRun) {
    return { allowed: false, reason: "当前基线缺少固定评测结果，无法比较" };
  }
  const successImproved = candidateRun.metrics.successRate > baselineRun.metrics.successRate;
  const violationSafe = candidateRun.metrics.violationRate <= baselineRun.metrics.violationRate;
  return {
    allowed: isMetricsPromotion(baselineRun.metrics, candidateRun.metrics),
    reason: !successImproved
      ? "成功率未相对基线提升"
      : !violationSafe
        ? "违规率高于基线"
        : "成功率提升且违规率未增加",
    baseline: baselineRun.metrics,
    candidate: candidateRun.metrics,
  };
}

/** 晋级已通过评测门禁的课程版本；失败时不改变 activeVersions。 */
export async function promoteCurriculum(
  doc: CurriculumDoc,
  candidateId: string,
): Promise<PromotionDecision> {
  const candidate = doc.entries.find((entry) => entry.id === candidateId);
  if (!candidate) return { allowed: false, reason: "候选课程不存在" };
  const decision = await canPromoteCurriculum(doc, candidate);
  if (!decision.allowed) return decision;
  const key = curriculumScopeKey(candidate);
  doc.entries = doc.entries.map((entry) =>
    curriculumScopeKey(entry) !== key
      ? entry
      : { ...entry, status: entry.id === candidate.id ? "active" : "retired" },
  );
  doc.activeVersions[key] = candidate.version;
  await saveCurriculum(doc);
  return decision;
}

/** 回滚到同作用域的历史版本；仅切换指针，不删除后续版本。 */
export async function rollbackCurriculum(
  doc: CurriculumDoc,
  entryId: string,
): Promise<CurriculumEntry> {
  const target = doc.entries.find((entry) => entry.id === entryId);
  if (!target) throw new Error("回滚版本不存在");
  const key = curriculumScopeKey(target);
  doc.entries = doc.entries.map((entry) =>
    curriculumScopeKey(entry) !== key
      ? entry
      : { ...entry, status: entry.id === target.id ? "active" : "retired" },
  );
  doc.activeVersions[key] = target.version;
  await saveCurriculum(doc);
  return target;
}
