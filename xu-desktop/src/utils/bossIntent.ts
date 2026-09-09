/**
 * Parse Boss replies for plan approval, acceptance, and computer-control delegation.
 */

export type BossIntent =
  | { kind: "plan_approve" }
  | { kind: "design_approve" }
  | { kind: "tech_approve" }
  | { kind: "design_unfreeze" }
  | { kind: "acceptance_approve" }
  | { kind: "gui_delegate" }
  | { kind: "cross_module_approve" }
  | { kind: "meeting_reply" };

const PLAN_APPROVE =
  /同意|批准|开始开发|按计划|可以开始|确认计划|ok|OK|没问题|开干|开工/i;
const DESIGN_APPROVE = /确认设计|设计通过|采用设计|线框确认|设计已确认/i;
const TECH_APPROVE = /确认技术方案|技术方案通过|方案确认|确认架构/i;
const DESIGN_UNFREEZE = /解冻设计|重新确认设计|需求变更|改设计/i;
const ACCEPT_APPROVE = /验收通过|验收完成|通过验收|可以交付|上线|结项/i;
const GUI_DELEGATE =
  /可以操作电脑|允许键鼠|同意\s*GUI|可以操控|放权|允许操作电脑|可以控制电脑|键鼠授权/i;
const CROSS_MODULE_APPROVE = /确认跨模块|跨模块开写|跨模块通过|确认开写|允许跨模块/;

export function parseBossIntent(text: string, workflowState?: string | null): BossIntent {
  const t = (text || "").trim();
  if (!t) return { kind: "meeting_reply" };
  if (GUI_DELEGATE.test(t)) return { kind: "gui_delegate" };
  if (CROSS_MODULE_APPROVE.test(t)) return { kind: "cross_module_approve" };
  if (DESIGN_UNFREEZE.test(t)) return { kind: "design_unfreeze" };
  if (workflowState === "acceptance" && ACCEPT_APPROVE.test(t)) {
    return { kind: "acceptance_approve" };
  }
  if (workflowState === "tech_review" && TECH_APPROVE.test(t)) {
    return { kind: "tech_approve" };
  }
  if (workflowState === "design_review" && DESIGN_APPROVE.test(t)) {
    return { kind: "design_approve" };
  }
  if (DESIGN_APPROVE.test(t) && workflowState === "design_review") {
    return { kind: "design_approve" };
  }
  if (
    (workflowState === "plan_review" || !workflowState) &&
    PLAN_APPROVE.test(t)
  ) {
    return { kind: "plan_approve" };
  }
  if (ACCEPT_APPROVE.test(t)) return { kind: "acceptance_approve" };
  if (PLAN_APPROVE.test(t)) return { kind: "plan_approve" };
  if (TECH_APPROVE.test(t)) return { kind: "tech_approve" };
  if (DESIGN_APPROVE.test(t)) return { kind: "design_approve" };
  return { kind: "meeting_reply" };
}
