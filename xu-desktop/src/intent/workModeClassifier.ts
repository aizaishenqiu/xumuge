/**
 * @file 工作模式分类：软件立项 / 交付 / 操作 / 问答（规则优先）
 * @author qiuye <yjk150@qq.com>
 * @date 2026-09-02
 * @version 1.3.0
 * @category Parse
 * @algo rule-priority-work-mode
 */
import type { RequirementBrief, DeliveryComplexity, WorkMode } from "./briefTypes";
import type { XuProject } from "../utils/projects";
import { isProtectedProductAsk } from "../utils/antiDistill";
import {
  isQuestionTurn,
  isStrongBuildTurn,
  isOperationTurn,
  isStrongBuildObjectTurn,
} from "./turnKind";

const FINANCE_DELIVERY_RE =
  /出纳|日清月结|报税|增值税|税务筹划|税筹|筹划|汇算清缴|加计扣除|出口退税|个税|社保公积金|内审|年审|土增税/;

const LEADS_DELIVERY_RE = /获客|找客户|写外联|外联草稿|冷邮件|线索名单|理想客户/;

export type { WorkMode, DeliveryComplexity };

export type WorkModeClassification = {
  mode: WorkMode;
  complexity?: DeliveryComplexity;
};

const DELIVERY_COMPLEX_RE =
  /方案|报告|全套|分阶段|验收标准|多页|调研|白皮书|商业计划|交付物|可验收|PPT|ppt|标书|策划案/i;

const DELIVERY_DOC_RE =
  /方案|报告|调研|白皮书|商业计划|标书|策划案|文档|汇报|PPT|ppt/i;

const DELIVERY_WEAK_RE = /交付|验收|文档|说明|材料/i;

const PRODUCT_OBJECT_RE =
  /小程序|App|APP|网站|系统|SaaS|saas|平台|工具|软件|程序/i;

const DELIVERY_SIMPLE_RE =
  /改一|修改一|调整一|润色|校对|翻译一|写一段|写几句|单页|一页/i;

/**
 * 规则优先分类用户本轮意图；已有 Brief.workMode 时在收集中保持连贯。
 */
export function classifyWorkMode(
  text: string,
  brief?: RequirementBrief | null,
  project?: XuProject | null,
): WorkModeClassification {
  const t = text.trim();
  if (!t) return { mode: "question" };

  if (/^【需求补充/.test(t)) {
    const mode = brief?.workMode || inferModeFromProject(project);
    return {
      mode,
      complexity: brief?.deliveryComplexity || deliveryComplexity(t),
    };
  }

  if (isProtectedProductAsk(t) || isQuestionTurn(t)) {
    return { mode: "question" };
  }

  if (isOperationTurn(t) && !isStrongBuildObjectTurn(t) && !isStrongBuildTurn(t)) {
    return { mode: "operation" };
  }

  if (
    (FINANCE_DELIVERY_RE.test(t) || LEADS_DELIVERY_RE.test(t)) &&
    !/小程序|App|APP|网站|SaaS|saas/.test(t)
  ) {
    return { mode: "delivery", complexity: deliveryComplexity(t) };
  }

  if (isStrongBuildObjectTurn(t) || project?.type === "software") {
    return { mode: "software_build" };
  }

  if (isStrongBuildTurn(t)) {
    const complexity = deliveryComplexity(t);
    return { mode: "delivery", complexity };
  }

  if (
    brief?.status === "gathering" &&
    brief.workMode &&
    brief.workMode !== "question" &&
    brief.workMode !== "operation"
  ) {
    return {
      mode: brief.workMode,
      complexity: brief.deliveryComplexity,
    };
  }

  return { mode: "question" };
}

function inferModeFromProject(project?: XuProject | null): WorkMode {
  if (project?.type === "software") return "software_build";
  if (project?.type && project.type !== "other") return "delivery";
  return "delivery";
}

/** 交付任务复杂度：复杂才弹轻量 Brief。 */
export function deliveryComplexity(text: string): DeliveryComplexity {
  const t = text.trim();
  if (!t) return "simple";
  if (DELIVERY_SIMPLE_RE.test(t) && t.length < 40) return "simple";
  if (t.length >= 80) return "complex";
  if (DELIVERY_COMPLEX_RE.test(t)) return "complex";
  return "simple";
}

/** 是否需要挂 Brief 收集（软件全量或复杂交付）。 */
export function needsBriefCollection(classification: WorkModeClassification): boolean {
  if (classification.mode === "software_build") return true;
  if (classification.mode === "delivery" && classification.complexity === "complex") {
    return true;
  }
  return false;
}

/** 收集中是否应弹澄清窗（手动补充始终可弹）。 */
export function shouldCollectViaDialog(
  classification: WorkModeClassification,
  reason?: "manual" | "kickoff_preflight" | string,
): boolean {
  if (reason === "manual" || reason === "kickoff_preflight") return true;
  return needsBriefCollection(classification);
}

export function mergeWorkModeIntoBrief(
  brief: RequirementBrief,
  classification: WorkModeClassification,
): RequirementBrief {
  return {
    ...brief,
    workMode: classification.mode,
    deliveryComplexity:
      classification.mode === "delivery"
        ? classification.complexity || brief.deliveryComplexity || "simple"
        : brief.deliveryComplexity,
  };
}

/** Brief / 项目是否按软件立项走完整向导与开工波次。 */
export function isSoftwareBriefWorkMode(
  brief?: RequirementBrief | null,
  project?: XuProject | null,
): boolean {
  if (brief?.workMode === "software_build") return true;
  if (brief?.workMode === "delivery" || brief?.workMode === "operation") return false;
  if (!project) return false;
  return project.type === "software" || project.industryId === "software";
}

/**
 * 规则分类结果是否模糊，需要 LLM 单次补判（收集中已有 workMode 则不再补判）。
 */
export function isWorkModeAmbiguous(
  text: string,
  brief?: RequirementBrief | null,
  project?: XuProject | null,
): boolean {
  const t = text.trim();
  if (!t || /^【需求补充/.test(t)) return false;
  if (isProtectedProductAsk(t) || isQuestionTurn(t)) return false;

  if (
    brief?.status === "gathering" &&
    brief.workMode &&
    brief.workMode !== "question" &&
    brief.workMode !== "operation"
  ) {
    return false;
  }

  const op = isOperationTurn(t);
  const strongBuild = isStrongBuildTurn(t);
  const strongObject = isStrongBuildObjectTurn(t);

  if (op && (strongBuild || strongObject)) return true;

  if (strongBuild && !strongObject && !op) {
    const hasDeliveryDoc = DELIVERY_DOC_RE.test(t);
    const hasProduct = PRODUCT_OBJECT_RE.test(t);
    if (!hasDeliveryDoc && !hasProduct) return true;
  }

  const ruled = classifyWorkMode(t, brief, project);
  if (ruled.mode === "question" && (strongBuild || op)) return true;

  if (strongBuild && !strongObject && ruled.mode === "delivery" && ruled.complexity === "simple") {
    if (t.length >= 40 || DELIVERY_WEAK_RE.test(t)) return true;
  }

  return false;
}
