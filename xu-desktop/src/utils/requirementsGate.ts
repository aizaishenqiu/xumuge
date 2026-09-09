/**
 * @file 持久化需求验收门禁与 Review/QA 回写
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-30
 * @version 1.0.0
 * @category Parse
 * @algo requirement-acceptance-join
 */
import { exists, readTextFile } from "@tauri-apps/plugin-fs";
import {
  migrateLegacyRequirements,
  type RequirementBrief,
  type RequirementStatus,
} from "../intent/briefTypes";
import { loadBrief, saveBrief } from "../intent/briefStore";
import type { XuProject } from "./projects";
import { mkdirRecursive, writeTextUnderWorkspace } from "./fsBridge";

export const REQUIREMENTS_GATE_REL = ".xu/requirements-gate.json";

export type RequirementCheckStatus = "pending" | "passed" | "failed" | "waived";

export interface RequirementGateCriterion {
  id: string;
  status: RequirementCheckStatus;
  evidence?: string;
}

export interface RequirementGateItem {
  requirementId: string;
  status: RequirementCheckStatus;
  acceptance: RequirementGateCriterion[];
  reviewer?: string;
  notes?: string;
}

export interface RequirementsGateFile {
  briefVersion: number;
  requirements: RequirementGateItem[];
  updatedAt: number;
}

export interface RequirementsCompletionResult {
  ok: boolean;
  pendingRequirementIds: string[];
  message: string;
}

function gatePath(root: string): string {
  return `${root.replace(/[/\\]+$/, "")}/${REQUIREMENTS_GATE_REL}`;
}

function checkStatus(raw: unknown): RequirementCheckStatus {
  return raw === "passed" || raw === "failed" || raw === "waived" ? raw : "pending";
}

/** 解析持久化需求门禁；格式损坏时返回空门禁并保持结项阻断。 */
export function parseRequirementsGate(raw: string): RequirementsGateFile {
  try {
    const parsed = JSON.parse(raw) as Partial<RequirementsGateFile>;
    const requirements = Array.isArray(parsed.requirements)
      ? parsed.requirements
          .map((item): RequirementGateItem | null => {
            const requirementId = String(item?.requirementId || "").trim();
            if (!requirementId) return null;
            return {
              requirementId,
              status: checkStatus(item.status),
              acceptance: Array.isArray(item.acceptance)
                ? item.acceptance
                    .map((criterion): RequirementGateCriterion | null => {
                      const id = String(criterion?.id || "").trim();
                      if (!id) return null;
                      return {
                        id,
                        status: checkStatus(criterion.status),
                        evidence: String(criterion.evidence || "").trim() || undefined,
                      };
                    })
                    .filter((x): x is RequirementGateCriterion => Boolean(x))
                : [],
              reviewer: String(item.reviewer || "").trim() || undefined,
              notes: String(item.notes || "").trim() || undefined,
            };
          })
          .filter((x): x is RequirementGateItem => Boolean(x))
      : [];
    return {
      briefVersion: Number.isFinite(parsed.briefVersion)
        ? Math.max(0, Math.floor(parsed.briefVersion!))
        : 0,
      requirements,
      updatedAt: Number(parsed.updatedAt) || 0,
    };
  } catch {
    return { briefVersion: 0, requirements: [], updatedAt: 0 };
  }
}

/** 由 Brief 创建逐项 pending 门禁；依赖稳定 requirement/acceptance ID。 */
export function createRequirementsGateDraft(brief: RequirementBrief): RequirementsGateFile {
  return {
    briefVersion: brief.version || 0,
    requirements: migrateLegacyRequirements(brief).map((requirement) => ({
      requirementId: requirement.id,
      status:
        requirement.status === "passed" || requirement.status === "waived"
          ? requirement.status
          : "pending",
      acceptance: requirement.acceptanceCriteria.map((criterion) => ({
        id: criterion.id,
        status: checkStatus(criterion.status),
        evidence: criterion.evidence,
      })),
    })),
    updatedAt: Date.now(),
  };
}

/** 合并新 Brief 与已有门禁；同 ID 结果保留，新需求保持 pending，删除的旧项不再参与。 */
export function mergeRequirementsGate(
  brief: RequirementBrief,
  previous: RequirementsGateFile,
): RequirementsGateFile {
  const draft = createRequirementsGateDraft(brief);
  const previousById = new Map(previous.requirements.map((item) => [item.requirementId, item]));
  return {
    ...draft,
    requirements: draft.requirements.map((item) => {
      const old = previousById.get(item.requirementId);
      if (!old) return item;
      const oldAcceptance = new Map(old.acceptance.map((criterion) => [criterion.id, criterion]));
      return {
        ...item,
        status: old.status,
        reviewer: old.reviewer,
        notes: old.notes,
        acceptance: item.acceptance.map((criterion) => oldAcceptance.get(criterion.id) || criterion),
      };
    }),
  };
}

/** 检查结项需求门禁；Must、冲突和逐项验收任一未通过都会阻断 completed。 */
export function evaluateRequirementsCompletion(
  brief: RequirementBrief,
  gate: RequirementsGateFile | null,
): RequirementsCompletionResult {
  const must = migrateLegacyRequirements(brief).filter((item) => item.priority === "must");
  const gateById = new Map((gate?.requirements || []).map((item) => [item.requirementId, item]));
  const pendingRequirementIds = must
    .filter((requirement) => {
      if (requirement.conflicts.length) return true;
      const result = gateById.get(requirement.id);
      if (!result || !["passed", "waived"].includes(result.status)) return true;
      const acceptanceById = new Map(result.acceptance.map((item) => [item.id, item]));
      return requirement.acceptanceCriteria.some((criterion) => {
        const resultCriterion = acceptanceById.get(criterion.id);
        return !resultCriterion || !["passed", "waived"].includes(resultCriterion.status);
      });
    })
    .map((item) => item.id);
  return {
    ok: pendingRequirementIds.length === 0 && must.length > 0,
    pendingRequirementIds,
    message:
      must.length === 0
        ? "没有可追踪的 Must 需求，禁止结项。"
        : pendingRequirementIds.length
          ? `以下 Must/行业必需项或验收尚未通过：${pendingRequirementIds.join(", ")}`
          : "",
  };
}

/** 读取项目需求门禁；文件不存在或不可读时返回 null，由调用方阻断结项。 */
export async function readRequirementsGate(root: string): Promise<RequirementsGateFile | null> {
  const path = gatePath(root);
  try {
    if (!(await exists(path))) return null;
    return parseRequirementsGate(await readTextFile(path));
  } catch {
    return null;
  }
}

/** 创建或迁移需求门禁文件；保留同稳定 ID 的 Review/QA 结果。 */
export async function ensureRequirementsGate(
  project: XuProject,
  brief: RequirementBrief,
): Promise<RequirementsGateFile | null> {
  const root = (project.generatePath || "").trim();
  if (!root) return null;
  const previous = await readRequirementsGate(root);
  const next = mergeRequirementsGate(
    brief,
    previous || { briefVersion: 0, requirements: [], updatedAt: 0 },
  );
  await mkdirRecursive(root, ".xu");
  await writeTextUnderWorkspace(root, REQUIREMENTS_GATE_REL, JSON.stringify(next, null, 2));
  return next;
}

function requirementStatus(status: RequirementCheckStatus): RequirementStatus {
  if (status === "passed" || status === "failed" || status === "waived") return status;
  return "in_progress";
}

/** 将 Review/QA 文件结果逐项回写 Brief；缺失结果保持原状态，不会误报通过。 */
export async function syncRequirementsGateToBrief(project: XuProject): Promise<RequirementBrief> {
  const brief = await loadBrief(project.id);
  const gate = await readRequirementsGate(project.generatePath || "");
  if (!gate) return brief;
  const byId = new Map(gate.requirements.map((item) => [item.requirementId, item]));
  brief.requirements = migrateLegacyRequirements(brief).map((requirement) => {
    const result = byId.get(requirement.id);
    if (!result) return requirement;
    const criteria = new Map(result.acceptance.map((item) => [item.id, item]));
    return {
      ...requirement,
      status: requirementStatus(result.status),
      acceptanceCriteria: requirement.acceptanceCriteria.map((criterion) => {
        const checked = criteria.get(criterion.id);
        return checked
          ? { ...criterion, status: checked.status, evidence: checked.evidence }
          : criterion;
      }),
    };
  });
  return saveBrief(brief);
}
