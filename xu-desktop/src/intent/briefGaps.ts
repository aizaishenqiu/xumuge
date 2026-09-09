/**
 * @file 缺口评分、按维度澄清与需求门禁判定（行业标准题库）
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-30
 * @updated 2026-08-31
 * @version 3.3.0
 * @category Parse
 * @algo weighted-gap-score
 */
import {
  createStructuredRequirement,
  inferIdentityModel,
  inferUsageScaleTier,
  isIdentityModelSpecified,
  isUsageScaleSpecified,
  migrateLegacyRequirements,
  parseIdentityModel,
  parseUsageScaleTier,
  type RequirementBrief,
  type RequirementDimension,
} from "./briefTypes";
import type { XuProject } from "../utils/projects";

export type BriefGapId =
  | "goal"
  | "industry"
  | "acceptance"
  | "scopeIn"
  | "usageScale"
  | "identityModel"
  | "uxNotes"
  | "audience"
  | "architectureNotes"
  | "constraints"
  | "must"
  | "wont"
  | RequirementDimension;

export interface BriefGap {
  id: BriefGapId;
  question: string;
  priority: number;
  /** Only asked for software projects */
  softwareOnly?: boolean;
  weight?: number;
}

/**
 * 行业标准题库（迁入桌面时原版口径）。
 * 每轮最多问 3 条；用户可答「暂无 / 本期不适用」。
 * 禁止再改成「白话替身」冲掉 Must/Won't/SLA 等标准项。
 */
const GAP_DEFS: BriefGap[] = [
  {
    id: "goal",
    priority: 10,
    question: "一句话目标是什么？（做什么、给谁用）",
  },
  {
    id: "industry",
    priority: 20,
    question: "这是哪个行业/业务场景？（如电商、教务、内部工具）",
  },
  {
    id: "acceptance",
    priority: 30,
    question: "怎样算做完？请给 1～3 条可验收标准。",
  },
  {
    id: "usageScale",
    priority: 32,
    softwareOnly: true,
    weight: 2,
    question:
      "预计同时使用人数/日活量级？（如 <50、几百、几千、多企业 SaaS；可先选档位再补一句）",
  },
  {
    id: "identityModel",
    priority: 34,
    softwareOnly: true,
    weight: 2,
    question:
      "登录与组织模型？（无登录 / 单组织账号 / C 端会员 / 多租户 B 端 / B+C 混合）",
  },
  {
    id: "scopeIn",
    priority: 40,
    question: "本期必须做哪些端或模块？（如 Web 管理端、小程序、API）",
  },
  {
    id: "must",
    priority: 41,
    softwareOnly: true,
    question: "Must：本期必须交付哪 1～3 条？（给谁用、解决什么问题）",
  },
  {
    id: "wont",
    priority: 42,
    softwareOnly: true,
    question: "Won't：哪些明确不做、留给以后迭代？（写清边界，避免后期加需求）",
  },
  {
    id: "uxNotes",
    priority: 46,
    softwareOnly: true,
    question: "UI/UX 偏好？（参考竞品、主色调、风格：简约/企业风等）",
  },
  {
    id: "audience",
    priority: 47,
    softwareOnly: true,
    question: "目标用户画像补充？（角色、使用场景；规模档位若已答可写「同上」）",
  },
  {
    id: "architectureNotes",
    priority: 48,
    softwareOnly: true,
    question:
      "系统边界与数据隔离？（C/B 端划分、是否多租户、会员/计费是否本期做、单体或微服务倾向）",
  },
  {
    id: "constraints",
    priority: 50,
    question: "有没有硬性约束？（技术栈、禁止事项、合规、交付语言等）",
  },
  {
    id: "data_lifecycle",
    priority: 60,
    softwareOnly: true,
    weight: 2,
    question:
      "核心数据实体有哪些？请说明创建、变更、归档/删除的生命周期（无则明确写无）。",
  },
  {
    id: "external_api",
    priority: 61,
    softwareOnly: true,
    weight: 2,
    question:
      "有哪些外部 API/系统契约？请说明输入输出、鉴权、错误与超时（无则明确写无）。",
  },
  {
    id: "roles_threats",
    priority: 62,
    softwareOnly: true,
    weight: 2,
    question: "有哪些角色与权限边界？主要越权、滥用或攻击威胁是什么？",
  },
  {
    id: "privacy_compliance",
    priority: 63,
    softwareOnly: true,
    weight: 2,
    question:
      "涉及哪些个人/敏感数据及隐私合规要求？保留、脱敏、授权如何处理（无则明确写无）。",
  },
  {
    id: "performance_sla",
    priority: 64,
    softwareOnly: true,
    weight: 2,
    question:
      "性能容量与 SLA 指标是什么？请给并发/数据量、响应时间、可用性目标。",
  },
  {
    id: "deployment_rollback",
    priority: 65,
    softwareOnly: true,
    weight: 2,
    question: "部署环境、发布方式和失败回滚方案是什么？",
  },
  {
    id: "observability",
    priority: 66,
    softwareOnly: true,
    weight: 2,
    question: "需要哪些日志、指标、链路、告警与审计记录？",
  },
  {
    id: "compatibility",
    priority: 67,
    softwareOnly: true,
    weight: 2,
    question: "需兼容哪些操作系统、浏览器、设备、旧数据或 API 版本？",
  },
  {
    id: "i18n_a11y",
    priority: 68,
    softwareOnly: true,
    weight: 2,
    question:
      "国际化与无障碍要求是什么？请说明语言、时区、键盘/读屏标准（无则明确写无）。",
  },
  {
    id: "test_acceptance_env",
    priority: 69,
    softwareOnly: true,
    weight: 3,
    question:
      "测试数据如何准备，在哪个验收环境执行？请给逐项通过标准与证据形式。",
  },
];

const STRUCTURED_DIMENSIONS = new Set<RequirementDimension>([
  "goal_scope",
  "data_lifecycle",
  "external_api",
  "roles_threats",
  "privacy_compliance",
  "performance_sla",
  "deployment_rollback",
  "observability",
  "compatibility",
  "i18n_a11y",
  "test_acceptance_env",
]);

const NA_ANSWER_RE =
  /^(暂无|无|没有|不适用|本期不适用|先不做|以后再说|不需要|无需|n\/?a)$/i;

/** 用户是否在表示「跳过/不适用」本项。 */
export function isNotApplicableAnswer(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (NA_ANSWER_RE.test(t)) return true;
  return /^(暂无|无|没有|不适用|本期不适用|先不做)([，,。.\s]|$)/.test(t);
}

export function isGapFilled(brief: RequirementBrief, id: BriefGapId): boolean {
  if (STRUCTURED_DIMENSIONS.has(id as RequirementDimension)) {
    return migrateLegacyRequirements(brief).some(
      (item) =>
        item.dimension === id &&
        (id !== "test_acceptance_env" || item.source !== "legacy") &&
        Boolean(item.detail.trim()) &&
        item.acceptanceCriteria.some((criterion) => criterion.text.trim()),
    );
  }
  switch (id) {
    case "goal":
      return Boolean(brief.goal?.trim());
    case "industry":
      return Boolean(brief.industry?.trim());
    case "acceptance":
      return brief.acceptance.length > 0;
    case "scopeIn":
      return brief.scopeIn.length > 0;
    case "usageScale":
      return (
        isUsageScaleSpecified(brief.usageScaleTier) ||
        Boolean(brief.audience?.trim() && !/^本期不适用$/i.test(brief.audience.trim()))
      );
    case "identityModel":
      return (
        isIdentityModelSpecified(brief.identityModel) ||
        Boolean(brief.architectureNotes?.trim() && !/^本期不适用$/i.test(brief.architectureNotes.trim()))
      );
    case "must":
      return (brief.must || []).length > 0;
    case "wont":
      return (brief.wont || []).length > 0 || brief.scopeOut.length > 0;
    case "uxNotes":
      return Boolean(brief.uxNotes?.trim());
    case "audience":
      return Boolean(brief.audience?.trim());
    case "architectureNotes":
      return Boolean(brief.architectureNotes?.trim());
    case "constraints":
      return brief.constraints.length > 0;
    default:
      return true;
  }
}

export interface BriefGapScore {
  score: number;
  filledWeight: number;
  totalWeight: number;
  remaining: BriefGap[];
}

export type BriefGapsOpts = {
  /** @deprecated 用 profile */
  software?: boolean;
  profile?: BriefGapProfile;
};

export type BriefGapProfile = "software" | "delivery" | "none";

const DELIVERY_GAP_IDS = new Set<BriefGapId>(["goal", "acceptance", "constraints"]);

function resolveGapProfile(opts?: BriefGapsOpts): BriefGapProfile {
  if (opts?.profile) return opts.profile;
  if (opts?.software === true) return "software";
  if (opts?.software === false) return "delivery";
  return "software";
}

function applicableGaps(opts?: BriefGapsOpts): BriefGap[] {
  const profile = resolveGapProfile(opts);
  if (profile === "none") return [];
  return GAP_DEFS.filter((gap) => {
    if (profile === "delivery") return DELIVERY_GAP_IDS.has(gap.id);
    if (gap.softwareOnly && profile !== "software") return false;
    return true;
  });
}

/** 计算加权缺口分；默认含全套行业标准题。 */
export function computeBriefGapScore(
  brief: RequirementBrief,
  opts?: BriefGapsOpts,
): BriefGapScore {
  const applicable = applicableGaps(opts);
  const remaining = computeBriefGaps(brief, opts);
  const missing = new Set(remaining.map((gap) => gap.id));
  const totalWeight = applicable.reduce((sum, gap) => sum + (gap.weight || 1), 0);
  const filledWeight = applicable.reduce(
    (sum, gap) => sum + (missing.has(gap.id) ? 0 : gap.weight || 1),
    0,
  );
  return {
    score: totalWeight ? Math.round((filledWeight / totalWeight) * 100) : 100,
    filledWeight,
    totalWeight,
    remaining,
  };
}

export interface RequirementGateAssessment {
  ok: boolean;
  score: number;
  reasons: string[];
  pendingRequirementIds: string[];
}

/** 判定确认或结项门禁；确认需零缺口+用户确认，结项还要求 Must/验收逐项通过且无冲突。 */
export function assessRequirementGate(
  brief: RequirementBrief,
  opts?: { software?: boolean; gapOpts?: BriefGapsOpts; phase?: "confirm" | "completion" },
): RequirementGateAssessment {
  const phase = opts?.phase || "confirm";
  const gapOpts = opts?.gapOpts ?? { software: opts?.software };
  const gap = computeBriefGapScore(brief, gapOpts);
  const requirements = migrateLegacyRequirements(brief);
  const reasons: string[] = [];
  if (gap.remaining.length) reasons.push(`仍有 ${gap.remaining.length} 个需求缺口`);
  if (!brief.requirementsConfirmedAt) reasons.push("用户尚未显式确认需求");
  const pendingRequirementIds =
    phase === "completion"
      ? requirements
          .filter(
            (item) =>
              item.priority === "must" &&
              (item.conflicts.length > 0 ||
                !["passed", "waived"].includes(item.status) ||
                item.acceptanceCriteria.some(
                  (criterion) => !["passed", "waived"].includes(criterion.status),
                )),
          )
          .map((item) => item.id)
      : [];
  if (pendingRequirementIds.length) {
    reasons.push(`Must/验收未逐项通过：${pendingRequirementIds.join(", ")}`);
  }
  return {
    ok: reasons.length === 0,
    score: gap.score,
    reasons,
    pendingRequirementIds,
  };
}

/** 仍开放的缺口（默认全套行业标准题）。 */
export function computeBriefGaps(
  brief: RequirementBrief,
  opts?: BriefGapsOpts,
): BriefGap[] {
  return applicableGaps(opts)
    .filter((g) => !isGapFilled(brief, g.id))
    .sort((a, b) => a.priority - b.priority);
}

export function gapsToQuestions(gaps: BriefGap[], max = 3): string[] {
  return gaps.slice(0, max).map((g) => g.question);
}

/** Progress for office stage chip。 */
export function countBriefGapProgress(
  brief: RequirementBrief,
  opts?: BriefGapsOpts,
): { filled: number; total: number; remaining: number } {
  const applicable = applicableGaps(opts);
  const gaps = computeBriefGaps(brief, opts);
  return {
    filled: applicable.length - gaps.length,
    total: applicable.length,
    remaining: gaps.length,
  };
}

/** 按题面文字找到 gap 定义（用于弹窗「不适用」）。 */
export function findGapByQuestion(question: string): BriefGap | undefined {
  const q = question.trim();
  if (!q) return undefined;
  return GAP_DEFS.find((g) => g.question === q || q.includes(g.question) || g.question.includes(q));
}

const NA_DETAIL = "本期不适用";
const NA_ACCEPT = "用户确认本期不适用";

/**
 * 将指定缺口标记为「本期不适用」并写盘可识别字段。
 * 职责：弹窗一键跳过 / absorb「无」；失败不抛（原 brief 原样返回语义由调用方保证）。
 */
export function applyNotApplicableToGap(
  brief: RequirementBrief,
  id: BriefGapId,
): RequirementBrief {
  const next = { ...brief };
  if (STRUCTURED_DIMENSIONS.has(id as RequirementDimension)) {
    const requirements = migrateLegacyRequirements(next);
    const requirement = createStructuredRequirement({
      dimension: id as RequirementDimension,
      title: String(id),
      detail: NA_DETAIL,
      source: "user",
      priority: "could",
      acceptance: [NA_ACCEPT],
    });
    const at = requirements.findIndex((item) => item.dimension === id);
    if (at >= 0) requirements[at] = { ...requirements[at], ...requirement, id: requirements[at].id };
    else requirements.push(requirement);
    next.requirements = requirements;
    return next;
  }
  switch (id) {
    case "goal":
      if (!next.goal?.trim()) next.goal = NA_DETAIL;
      break;
    case "industry":
      if (!next.industry?.trim()) next.industry = NA_DETAIL;
      break;
    case "acceptance":
      next.acceptance = mergeUnique(next.acceptance, [NA_ACCEPT]);
      break;
    case "scopeIn":
      next.scopeIn = mergeUnique(next.scopeIn, [NA_DETAIL]);
      break;
    case "must":
      next.must = mergeUnique(next.must || [], [NA_DETAIL]);
      break;
    case "wont":
      next.wont = mergeUnique(next.wont || [], [NA_DETAIL]);
      next.scopeOut = mergeUnique(next.scopeOut, [NA_DETAIL]);
      break;
    case "uxNotes":
      next.uxNotes = NA_DETAIL;
      break;
    case "usageScale":
      next.usageScaleTier = "unspecified";
      next.audience = NA_DETAIL;
      break;
    case "identityModel":
      next.identityModel = "unspecified";
      if (!next.architectureNotes?.trim()) next.architectureNotes = NA_DETAIL;
      break;
    case "audience":
      next.audience = NA_DETAIL;
      break;
    case "architectureNotes":
      next.architectureNotes = NA_DETAIL;
      break;
    case "constraints":
      next.constraints = mergeUnique(next.constraints, [NA_DETAIL]);
      break;
    default:
      break;
  }
  return next;
}

/** 将弹窗某题的实际答案写入对应字段，禁止把题面本身当作答案。 */
function applyAnswerToGap(
  brief: RequirementBrief,
  id: BriefGapId,
  answer: string,
): RequirementBrief {
  const next = { ...brief };
  const text = answer.trim();
  if (!text) return next;
  if (STRUCTURED_DIMENSIONS.has(id as RequirementDimension)) {
    const dimension = id as RequirementDimension;
    const requirements = migrateLegacyRequirements(next);
    const requirement = createStructuredRequirement({
      dimension,
      title: GAP_DEFS.find((gap) => gap.id === id)?.question.slice(0, 80) || text,
      detail: text.slice(0, 240),
      source: "user",
      priority: "must",
      acceptance: [text.slice(0, 240)],
    });
    const at = requirements.findIndex((item) => item.dimension === dimension);
    if (at >= 0) {
      requirements[at] = {
        ...requirements[at],
        ...requirement,
        id: requirements[at].id,
      };
    } else {
      requirements.push(requirement);
    }
    next.requirements = requirements;
    return next;
  }
  switch (id) {
    case "goal":
      next.goal = text.slice(0, 200);
      break;
    case "industry":
      next.industry = text.slice(0, 80);
      break;
    case "acceptance":
      next.acceptance = mergeUnique(next.acceptance, [text.slice(0, 240)]);
      break;
    case "scopeIn":
      next.scopeIn = mergeUnique(next.scopeIn, [text.slice(0, 240)]);
      break;
    case "must":
      next.must = mergeUnique(next.must || [], [text.slice(0, 240)]);
      break;
    case "wont":
      next.wont = mergeUnique(next.wont || [], [text.slice(0, 240)]);
      next.scopeOut = mergeUnique(next.scopeOut, [text.slice(0, 240)]);
      break;
    case "uxNotes":
      next.uxNotes = text.slice(0, 240);
      break;
    case "usageScale": {
      const tier = inferUsageScaleTier(text) || parseUsageScaleTier(text);
      next.usageScaleTier = tier !== "unspecified" ? tier : next.usageScaleTier || "unspecified";
      if (!next.audience?.trim() || next.audience === NA_DETAIL) {
        next.audience = text.slice(0, 240);
      }
      break;
    }
    case "identityModel": {
      const model = inferIdentityModel(text) || parseIdentityModel(text);
      next.identityModel = model !== "unspecified" ? model : next.identityModel || "unspecified";
      if (!next.architectureNotes?.trim() || next.architectureNotes === NA_DETAIL) {
        next.architectureNotes = text.slice(0, 240);
      }
      break;
    }
    case "audience":
      next.audience = text.slice(0, 240);
      break;
    case "architectureNotes":
      next.architectureNotes = text.slice(0, 240);
      break;
    case "constraints":
      next.constraints = mergeUnique(next.constraints, [text.slice(0, 240)]);
      break;
    default:
      break;
  }
  return next;
}

/** Soft extract answers from free text into brief fields. */
export function absorbUserTextIntoBrief(
  prev: RequirementBrief,
  userText: string,
): RequirementBrief {
  let brief = { ...prev };
  const t = userText.trim();
  if (!t) return brief;

  // 弹窗确认格式：题 +「答：」成对消化（含「本期不适用」）
  if (t.includes("【需求补充") && /答[：:]/.test(t)) {
    const questions: string[] = [];
    const answers: string[] = [];
    const re = /^\s*\d+\.\s*(.+)\r?\n\s*答[：:]\s*(.+)\s*$/gm;
    let m: RegExpExecArray | null;
    while ((m = re.exec(t)) !== null) {
      questions.push(m[1]!.trim());
      answers.push(m[2]!.trim());
    }
    if (questions.length) {
      return absorbClarifyAnswerPairs(brief, questions, answers);
    }
  }

  const lines = t
    .split(/[\n；;]+/)
    .map((x) => x.trim())
    .filter(Boolean);

  // 自由聊天只答一个“无”时，仅作用于当前第一题；禁止批量清空后续标准项。
  if (isNotApplicableAnswer(t) && lines.length === 1) {
    const current = findGapByQuestion(brief.openQuestions?.[0] || "");
    return current ? applyNotApplicableToGap(brief, current.id) : brief;
  }

  for (const line of lines) {
    if (!isNotApplicableAnswer(line)) continue;
    // 「约束：暂无」「本期不做：xxx」等
    const paired = GAP_DEFS.find((g) => line.includes(g.question.slice(0, 8)));
    if (paired) {
      brief = applyNotApplicableToGap(brief, paired.id);
    }
  }

  if (!brief.goal && t.length >= 4 && !isNotApplicableAnswer(t)) {
    brief.goal = t.slice(0, 200);
  }

  const industryHit = t.match(
    /(?:行业|场景|领域|业务)[是为:：\s]*([^\n，。；;]{2,20})|(电商|教务|教育|医疗|金融|制造|物流|内部工具|SaaS|saas|政务|幼儿园|收费)/i,
  );
  if (!brief.industry && industryHit) {
    brief.industry = (industryHit[1] || industryHit[2] || "").trim();
  }

  const accLines = lines.filter((l) =>
    /验收|做到|完成|必须能|通过标准|done when|算做完/i.test(l),
  );
  if (accLines.length) {
    brief.acceptance = mergeUnique(brief.acceptance, accLines.map((l) => l.slice(0, 120)));
  } else if (!brief.acceptance.length && /验收|做到|完成标准/.test(t) && t.length < 180) {
    brief.acceptance = mergeUnique(brief.acceptance, [t.slice(0, 120)]);
  }

  // 端/模块：只抽短标签，禁止把「我想做一个…小程序」整句塞进 scopeIn（否则误判缺口已齐）
  const END_TOKENS = [
    "小程序",
    "管理端",
    "管理后台",
    "网页",
    "网站",
    "H5",
    "App",
    "APP",
    "安卓",
    "iOS",
    "后台",
    "桌面端",
    "前端",
    "后端",
  ];
  const endHits = END_TOKENS.filter((tok) => t.includes(tok));
  if (endHits.length) {
    brief.scopeIn = mergeUnique(brief.scopeIn, endHits);
  }
  const scopeLines = lines.filter(
    (l) =>
      /本期要做|本期包含|模块包括|要做哪些端/i.test(l) ||
      (/^(本期|模块)[:：]/.test(l) && l.length <= 40),
  );
  if (scopeLines.length) {
    brief.scopeIn = mergeUnique(brief.scopeIn, scopeLines.map((l) => l.slice(0, 100)));
  }
  const mustLines = lines.filter((l) => /must|必须做|本期必须/i.test(l));
  if (mustLines.length) {
    brief.must = mergeUnique(brief.must || [], mustLines.map((l) => l.slice(0, 100)));
  }
  const wontLines = lines.filter(
    (l) => /won't|wont|不做|以后再|明确不做|范围外|先不做|暂不/i.test(l),
  );
  if (wontLines.length) {
    const texts = wontLines.map((l) =>
      isNotApplicableAnswer(l) ? NA_DETAIL : l.slice(0, 100),
    );
    brief.wont = mergeUnique(brief.wont || [], texts);
    brief.scopeOut = mergeUnique(brief.scopeOut, texts);
  }

  const uxHit = t.match(
    /(?:UI|UX|界面|视觉|风格|主色|配色|设计稿|原型|竞品)[是为:：\s]*([^\n]{4,120})/i,
  );
  if (!brief.uxNotes?.trim() && uxHit) {
    brief.uxNotes = uxHit[1]!.trim().slice(0, 200);
  } else if (!brief.uxNotes?.trim() && /简约|企业风|暗色|亮色|Material|Ant Design/i.test(t)) {
    brief.uxNotes = t.slice(0, 160);
  }

  const audHit = t.match(
    /(?:用户|受众|并发|日活|DAU|用户量|规模)[是为:：\s]*([^\n]{4,120})/i,
  );
  if (!brief.audience?.trim() && audHit) {
    brief.audience = audHit[1]!.trim().slice(0, 160);
  } else if (!brief.audience?.trim() && /(C端|B端|内部员工|管理员|学生|商家|家长|老师)/i.test(t)) {
    brief.audience = t.slice(0, 160);
  }
  const scaleInfer = inferUsageScaleTier(t);
  if (scaleInfer && !isUsageScaleSpecified(brief.usageScaleTier)) {
    brief.usageScaleTier = scaleInfer;
  }
  const idInfer = inferIdentityModel(t);
  if (idInfer && !isIdentityModelSpecified(brief.identityModel)) {
    brief.identityModel = idInfer;
  }

  const archHit = t.match(
    /(?:架构|微服务|单体|前后端|系统边界|技术选型|技术偏好)[是为:：\s]*([^\n]{4,160})/i,
  );
  if (!brief.architectureNotes?.trim() && archHit) {
    brief.architectureNotes = archHit[1]!.trim().slice(0, 200);
  } else if (
    !brief.architectureNotes?.trim() &&
    /(微服务|单体|前后端分离|SaaS|多租户)/i.test(t)
  ) {
    brief.architectureNotes = t.slice(0, 200);
  }

  const constraintLines = lines.filter((l) =>
    /约束|禁止|必须用|技术栈|语言|不能|不要|只用|硬性|限制/i.test(l),
  );
  if (constraintLines.length) {
    const texts = constraintLines.map((l) =>
      isNotApplicableAnswer(l.replace(/^[^:：]*[:：]/, "").trim()) || isNotApplicableAnswer(l)
        ? NA_DETAIL
        : l.slice(0, 100),
    );
    brief.constraints = mergeUnique(brief.constraints, texts);
  } else if (t.length > 8 && brief.goal && brief.goal !== t.slice(0, 200)) {
    brief.decisions = mergeUnique(brief.decisions, [t.slice(0, 160)]);
  }

  const dimensionRules: Array<[RequirementDimension, RegExp, string]> = [
    ["data_lifecycle", /数据实体|数据模型|生命周期|归档|删除|销毁/i, "业务数据"],
    ["external_api", /外部\s*api|接口|第三方|webhook|支付|对接/i, "外部对接"],
    ["roles_threats", /角色|权限|越权|威胁|登录/i, "角色权限"],
    ["privacy_compliance", /隐私|合规|个人信息|敏感数据|脱敏/i, "隐私与合规"],
    ["performance_sla", /性能|容量|并发|响应时间|可用性|速度/i, "性能要求"],
    ["deployment_rollback", /部署|发布|回滚|灰度|环境/i, "部署方式"],
    ["observability", /可观测|日志|指标|链路|告警|审计/i, "日志与告警"],
    ["compatibility", /兼容|浏览器|操作系统|旧数据|手机|电脑/i, "兼容范围"],
    ["i18n_a11y", /国际化|多语言|时区|无障碍|读屏|键盘/i, "多语言与无障碍"],
    ["test_acceptance_env", /测试数据|验收环境|验收标准|测试环境/i, "验收方式"],
  ];
  const requirements = migrateLegacyRequirements(brief);
  for (const [dimension, pattern, title] of dimensionRules) {
    const hit = lines.find((line) => pattern.test(line));
    if (!hit) continue;
    const na = isNotApplicableAnswer(hit) || /不适用|暂无|没有/.test(hit);
    const requirement = createStructuredRequirement({
      dimension,
      title,
      detail: na ? NA_DETAIL : hit.slice(0, 240),
      source: "user",
      priority: na ? "could" : "must",
      acceptance: [na ? NA_ACCEPT : hit.slice(0, 240)],
    });
    const at = requirements.findIndex((item) => item.id === requirement.id);
    if (at >= 0) requirements[at] = requirement;
    else requirements.push(requirement);
  }
  brief.requirements = requirements;

  return brief;
}

/**
 * 弹窗按题提交：把「本期不适用」落到对应缺口。
 * answers[i] 对应 questions[i]。
 */
export function absorbClarifyAnswerPairs(
  prev: RequirementBrief,
  questions: string[],
  answers: string[],
): RequirementBrief {
  let brief = { ...prev };
  for (let i = 0; i < questions.length; i++) {
    const q = (questions[i] || "").trim();
    const a = (answers[i] || "").trim();
    if (!q || !a) continue;
    const gap = findGapByQuestion(q);
    if (gap && isNotApplicableAnswer(a)) {
      brief = applyNotApplicableToGap(brief, gap.id);
      continue;
    }
    if (gap) {
      brief = applyAnswerToGap(brief, gap.id, a);
      continue;
    }
    brief = absorbUserTextIntoBrief(brief, a);
  }
  return brief;
}

function mergeUnique(a: string[], b: string[], cap = 12): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of [...a, ...b]) {
    const t = x.trim();
    if (!t) continue;
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
    if (out.length >= cap) break;
  }
  return out;
}

export function formatGapDrivenReply(
  brief: RequirementBrief,
  gaps: BriefGap[],
  opts?: { blockedKickoff?: boolean },
): string {
  const ask = gapsToQuestions(gaps, 3);
  if (!ask.length) {
    return [
      "标准需求项已齐。请回复或点击「确认需求」；确认后再打开「开始项目」。",
      brief.goal ? `当前目标：${brief.goal}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }
  return [
    opts?.blockedKickoff
      ? "开工前请先补齐下列标准需求项（每轮最多 3 问；无则写「无」或「本期不适用」）："
      : "还差下列标准需求项（每轮最多 3 问；无则写「无」或「本期不适用」）：",
    brief.goal ? `已理解：${brief.goal}` : "",
    "请回答：",
    ...ask.map((q, i) => `${i + 1}. ${q}`),
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * 丢掉 LLM 臆造的 core 字段：用户本轮话术里没提的验收/先不做/硬限制等不得算已填。
 * 立项一句「我想做一个…」只允许落 goal / 行业词 / 端名标签。
 */
export function groundCoreBriefToUserText(
  prev: RequirementBrief,
  next: RequirementBrief,
  userText: string,
): RequirementBrief {
  const t = (userText || "").trim();
  const out: RequirementBrief = {
    ...next,
    acceptance: [...(next.acceptance || [])],
    scopeIn: [...(next.scopeIn || [])],
    scopeOut: [...(next.scopeOut || [])],
    must: [...(next.must || [])],
    wont: [...(next.wont || [])],
    constraints: [...(next.constraints || [])],
  };

  if (!prev.acceptance.length) {
    if (!/(验收|标准|算做完|必须能|通过标准|做到)/.test(t)) {
      out.acceptance = [];
    }
  }

  if (!(prev.wont || []).length && !prev.scopeOut.length) {
    if (!/(先不做|以后再|明确不做|范围外|暂不|won't|wont)/i.test(t) && !isNotApplicableAnswer(t)) {
      out.wont = [];
      out.scopeOut = [];
    }
  }

  if (!prev.constraints.length) {
    if (
      !/(硬性|限制|禁止|必须用|只能用|指定|技术栈|uni-?app|vue|react|java|gitee|github|交付语言)/i.test(
        t,
      ) &&
      !isNotApplicableAnswer(t)
    ) {
      out.constraints = [];
    }
  }

  if (!prev.scopeIn.length) {
    const ends = [
      "小程序",
      "管理端",
      "管理后台",
      "网页",
      "网站",
      "H5",
      "App",
      "APP",
      "安卓",
      "iOS",
      "后台",
      "桌面端",
    ].filter((tok) => t.includes(tok));
    out.scopeIn = ends;
    if (!(prev.must || []).length) {
      out.must = ends.length ? [...ends] : [];
    }
  }

  if (!prev.architectureNotes?.trim()) {
    if (!/(架构|前后端|微服务|单体|技术选型|技术偏好|多租户|租户|会员)/.test(t)) {
      out.architectureNotes = "";
    }
  }

  if (!isUsageScaleSpecified(prev.usageScaleTier)) {
    if (!/(规模|并发|日活|用户量|几百|几千|saas|多租户|小团队)/i.test(t)) {
      out.usageScaleTier = "unspecified";
    }
  }

  if (!isIdentityModelSpecified(prev.identityModel)) {
    if (!/(登录|会员|租户|账号|无登录|multi.?tenant)/i.test(t)) {
      out.identityModel = "unspecified";
    }
  }

  if (!prev.uxNotes?.trim()) {
    if (!/(界面|UI|UX|主色|风格|简约|设计稿)/i.test(t)) {
      out.uxNotes = "";
    }
  }

  return out;
}

/** 由 Brief.workMode 与项目类型推导缺口 profile。 */
export function briefGapsOptsFromBrief(
  brief: RequirementBrief | null | undefined,
  project?: XuProject | null,
): BriefGapsOpts {
  const mode = brief?.workMode;
  if (mode === "operation" || mode === "question") return { profile: "none" };
  if (mode === "delivery") {
    if (brief?.deliveryComplexity === "simple") return { profile: "none" };
    return { profile: "delivery" };
  }
  if (mode === "software_build" || project?.type === "software") {
    return { profile: "software" };
  }
  const pt = project?.type;
  if (pt === "delivery" || pt === "consulting" || pt === "internal" || pt === "other") {
    return { profile: "delivery" };
  }
  return { profile: "none" };
}

/** 澄清弹窗：规模/身份题的快捷芯片选项 */
export function getClarifyChipOptions(question: string): string[] {
  const gap = findGapByQuestion(question);
  if (!gap) return [];
  if (gap.id === "usageScale") {
    return ["个人演示 <10", "小团队 10~200", "单组织 几百~几千", "多企业 SaaS"];
  }
  if (gap.id === "identityModel") {
    return ["无登录", "单组织账号", "C 端会员", "多租户 B 端", "B+C 混合"];
  }
  return [];
}

/** 芯片文案 → 结构化字段（供弹窗点击） */
export function applyClarifyChipToBrief(
  brief: RequirementBrief,
  question: string,
  chip: string,
): RequirementBrief {
  const gap = findGapByQuestion(question);
  if (!gap) return brief;
  return applyAnswerToGap(brief, gap.id, chip);
}

/** 测试/调试用：导出题库只读视图 */
export function listGapDefsForTests(): readonly BriefGap[] {
  return GAP_DEFS;
}
