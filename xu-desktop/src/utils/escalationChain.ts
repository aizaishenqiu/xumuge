/**
 * @file Employee → Manager → Boss escalation for XU_NEED_CONFIRM meetings.
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-31
 * @updated 2026-08-31
 * @version 1.1.0
 * @category Schedule
 * @algo manager-then-boss-with-policy
 */
import type { Employee } from "./employees";
import { resolveLegacyAgencyRoleId } from "../office/agencyRoleIdMap";
import { classifyNeedConfirm, type NeedConfirmContext } from "./bossConfirmPolicy";
import { readOfficeTopology } from "./officeTopology";

const LS_PREFIX = "xu.escalation.stage.";

export type EscalationStage = "manager_review" | "boss_review";

export type ManagerIntent = "decide" | "escalate" | "unknown";

const MANAGER_ROLE_IDS = new Set([
  "project-manager-senior",
  "project-manager",
  "product-manager",
  "software-company__project-manager-senior",
]);

/** Prefer explicit id, else catalog / 经理 in role name. */
export function findManagerEmployee(
  employees: Employee[],
  opts?: { managerEmployeeId?: string | null },
): Employee | null {
  const forced = (opts?.managerEmployeeId || "").trim();
  if (forced) {
    const hit = employees.find((e) => e.id === forced && e.roleKind !== "boss");
    if (hit) return hit;
  }
  for (const e of employees) {
    if (e.roleKind === "boss") continue;
    const rid = resolveLegacyAgencyRoleId(e.agentRoleId || "");
    if (MANAGER_ROLE_IDS.has(rid) || /manager/i.test(rid)) return e;
    if (/经理|主管|负责人/.test(e.role || "") || /经理|主管/.test(e.name || "")) return e;
  }
  return null;
}

export function readEscalationStage(employeeId: string): EscalationStage | null {
  try {
    const v = localStorage.getItem(LS_PREFIX + employeeId);
    if (v === "manager_review" || v === "boss_review") return v;
  } catch {
    /* ignore */
  }
  return null;
}

export function writeEscalationStage(
  employeeId: string,
  stage: EscalationStage | null,
): void {
  try {
    if (!stage) localStorage.removeItem(LS_PREFIX + employeeId);
    else localStorage.setItem(LS_PREFIX + employeeId, stage);
  } catch {
    /* ignore */
  }
}

export type BeginEscalationOpts = {
  managerEmployeeId?: string | null;
  /** XU_NEED_CONFIRM body for policy classification */
  confirmText?: string;
  isCrossModule?: boolean;
  isRelease?: boolean;
};

/**
 * Duty: start escalation; high-risk policy → boss_review; else manager when present.
 * Deps: bossConfirmPolicy localStorage.
 * Failure: no manager → boss_review (never leave confirm unowned).
 */
export function beginEscalationForNeedConfirm(
  employeeId: string,
  employees: Employee[],
  opts?: BeginEscalationOpts,
): EscalationStage {
  const mgr = findManagerEmployee(employees, opts);
  const ctx: NeedConfirmContext = {
    hasManager: Boolean(mgr),
    isCrossModule: opts?.isCrossModule,
    isRelease: opts?.isRelease,
  };
  const klass = classifyNeedConfirm(opts?.confirmText || "", ctx);
  const topology = readOfficeTopology();
  let stage: EscalationStage;
  if (klass === "boss_required") {
    stage = "boss_review";
  } else if (topology === "mesh") {
    // Mesh: defer manager/boss until fuse or explicit escalate; clear stage for peer debate.
    writeEscalationStage(employeeId, null);
    return "manager_review";
  } else if (mgr) {
    stage = "manager_review";
  } else {
    // auto_continue without manager: still need a human owner → boss
    stage = "boss_review";
  }
  writeEscalationStage(employeeId, stage);
  return stage;
}

export function parseManagerIntent(text: string): ManagerIntent {
  const t = (text || "").trim();
  if (!t) return "unknown";
  if (/同意上报|上报老板|请老板|升级|escalat/i.test(t)) return "escalate";
  if (
    /自行裁决|我来定|按此执行|可以继续|同意方案|批准|拍板|就这样|开干|没问题/i.test(t)
  ) {
    return "decide";
  }
  return "unknown";
}

export function escalationHintForStage(
  stage: EscalationStage,
  managerName?: string | null,
): string {
  if (stage === "manager_review") {
    if (readOfficeTopology() === "mesh") {
      return "🕸 协作拓扑 · 同级互评：可继续辩论；开会熔断后升级老板，或经理回复「自行裁决／同意上报」。";
    }
    return `📋 待经理确认（${managerName || "经理"}）：可「自行裁决」继续员工工作，或回复「同意上报」请老板拍板。`;
  }
  return "📋 待老板拍板：请明确答复后员工继续。";
}
