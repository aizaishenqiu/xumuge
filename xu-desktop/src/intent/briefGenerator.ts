/**
 * @file LLM/启发式 Brief 更新与有依据字段合并
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-30
 * @updated 2026-08-31
 * @version 4.0.0
 * @category AgentLoop
 * @algo gap-bounded-clarification
 */
import { invoke } from "@tauri-apps/api/core";
import { resolveEndpoint } from "../utils/opsBrains";
import {
  createStructuredRequirement,
  emptyBrief,
  migrateLegacyRequirements,
  stableRequirementId,
  type RequirementBrief,
  type RequirementDimension,
  type RequirementPriority,
  type StructuredRequirement,
} from "./briefTypes";
import {
  absorbUserTextIntoBrief,
  briefGapsOptsFromBrief,
  computeBriefGapScore,
  computeBriefGaps,
  findGapByQuestion,
  formatGapDrivenReply,
  gapsToQuestions,
  groundCoreBriefToUserText,
  type BriefGapsOpts,
} from "./briefGaps";

/** Compatibility export only; clarification never auto-passes at this limit. */
const MAX_CLARIFY_ROUNDS = 5;
const MAX_QUESTIONS = 3;

export interface BriefGenerateResult {
  brief: RequirementBrief;
  reply: string;
  questionsToAsk: string[];
}

function mergeUnique(a: string[], b: string[], cap = 12): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of [...a, ...b]) {
    const text = value.trim();
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= cap) break;
  }
  return out;
}

function parseJsonObject(raw: string): Record<string, unknown> | null {
  const text = raw.trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

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

type EvidenceKey =
  | "goal"
  | "industry"
  | "acceptance"
  | "scopeIn"
  | "must"
  | "wont"
  | "uxNotes"
  | "audience"
  | "architectureNotes"
  | "constraints"
  | RequirementDimension;

const FIELD_PATTERNS: Array<[EvidenceKey, RegExp]> = [
  ["goal", /我想做|帮我做|开发一个|做一个|目标|做什么|给谁用/i],
  ["industry", /行业|场景|领域|业务|电商|教务|教育|医疗|金融|制造|物流|幼儿园|收费/i],
  ["acceptance", /验收|标准|算做完|必须能|通过|完成条件/i],
  ["scopeIn", /本期|范围内|模块|小程序|管理端|管理后台|网页|网站|H5|App|安卓|iOS|桌面端|前端|后端|API/i],
  ["must", /\bmust\b|必须交付|必须做|本期必须/i],
  ["wont", /\bwon'?t\b|不做|以后迭代|范围外|先不做|暂不/i],
  ["uxNotes", /UI|UX|界面|视觉|风格|主色|配色|设计稿|原型|竞品/i],
  ["audience", /目标用户|用户量|并发|日活|DAU|受众|家长|老师|学生|管理员/i],
  ["architectureNotes", /系统边界|架构|微服务|单体|前后端|C\s*端|B\s*端/i],
  ["constraints", /硬性约束|约束|禁止|必须用|技术栈|合规|交付语言|只能用|不能用/i],
  ["data_lifecycle", /数据实体|数据模型|生命周期|创建|变更|归档|删除/i],
  ["external_api", /外部\s*API|系统契约|第三方|webhook|支付接口|鉴权|超时/i],
  ["roles_threats", /角色|权限边界|越权|滥用|攻击|威胁/i],
  ["privacy_compliance", /隐私|合规|个人信息|敏感数据|保留|脱敏|授权/i],
  ["performance_sla", /性能|容量|SLA|并发|数据量|响应时间|可用性/i],
  ["deployment_rollback", /部署环境|发布方式|回滚|灰度/i],
  ["observability", /日志|指标|链路|告警|审计/i],
  ["compatibility", /兼容|操作系统|浏览器|设备|旧数据|API\s*版本/i],
  ["i18n_a11y", /国际化|多语言|时区|无障碍|键盘|读屏/i],
  ["test_acceptance_env", /测试数据|验收环境|通过标准|证据形式/i],
];

function collectAnswerEvidence(userText: string): {
  keys: Set<EvidenceKey>;
  answerText: string;
} {
  const keys = new Set<EvidenceKey>();
  const answers: string[] = [];
  const pairRe = /^\s*\d+\.\s*(.+)\r?\n\s*答[：:]\s*(.+)\s*$/gm;
  let match: RegExpExecArray | null;
  while ((match = pairRe.exec(userText)) !== null) {
    const gap = findGapByQuestion(match[1]!.trim());
    if (gap) keys.add(gap.id as EvidenceKey);
    answers.push(match[2]!.trim());
  }
  const answerText = answers.length ? answers.join("\n") : userText.trim();
  for (const [key, pattern] of FIELD_PATTERNS) {
    if (pattern.test(answerText)) keys.add(key);
  }
  return { keys, answerText };
}

function permitsStructuredDimension(
  dimension: RequirementDimension,
  evidence: Set<EvidenceKey>,
): boolean {
  if (dimension === "goal_scope") {
    return ["goal", "scopeIn", "must", "wont", "constraints"].some((key) =>
      evidence.has(key as EvidenceKey),
    );
  }
  return evidence.has(dimension);
}

function candidateGrounded(candidate: string, answerText: string): boolean {
  const candidateNorm = candidate.toLowerCase().replace(/\s+/g, "");
  const answerNorm = answerText.toLowerCase().replace(/\s+/g, "");
  if (!candidateNorm || !answerNorm) return false;
  if (answerNorm.includes(candidateNorm) || candidateNorm.includes(answerNorm)) return true;

  const latinTokens = candidateNorm.match(/[a-z][a-z0-9+.#_-]{1,}|\d+(?:\.\d+)?/g) || [];
  if (latinTokens.some((token) => answerNorm.includes(token))) return true;

  const chinese = candidateNorm.replace(/[^\u3400-\u9fff]/g, "");
  for (let index = 0; index + 1 < chinese.length; index += 1) {
    if (answerNorm.includes(chinese.slice(index, index + 2))) return true;
  }
  return false;
}

function generatedRequirements(
  raw: unknown,
  previous: StructuredRequirement[],
  evidence: Set<EvidenceKey>,
  answerText: string,
): StructuredRequirement[] {
  if (!Array.isArray(raw)) return previous;
  const byId = new Map(previous.map((item) => [item.id, item]));
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const value = item as Record<string, unknown>;
    const dimension = String(value.dimension || "") as RequirementDimension;
    const detail = String(value.detail || "").trim();
    if (
      !STRUCTURED_DIMENSIONS.has(dimension) ||
      !detail ||
      !permitsStructuredDimension(dimension, evidence) ||
      !candidateGrounded(detail, answerText)
    ) {
      continue;
    }
    const id = stableRequirementId(dimension, detail);
    const acceptance = Array.isArray(value.acceptanceCriteria)
      ? value.acceptanceCriteria.map(String).map((text) => text.trim()).filter(Boolean)
      : [];
    const priorityRaw = String(value.priority || "must");
    const priority: RequirementPriority =
      priorityRaw === "should" || priorityRaw === "could" || priorityRaw === "wont"
        ? priorityRaw
        : "must";
    const next = createStructuredRequirement({
      id,
      dimension,
      title: String(value.title || detail).trim().slice(0, 120),
      detail,
      source: "analyst",
      priority,
      acceptance,
      conflicts: Array.isArray(value.conflicts) ? value.conflicts.map(String) : [],
    });
    const existing = byId.get(id);
    const previousCriteria = new Map(
      (existing?.acceptanceCriteria || []).map((criterion) => [criterion.id, criterion]),
    );
    byId.set(
      id,
      existing
        ? {
            ...next,
            status: existing.status,
            acceptanceCriteria: next.acceptanceCriteria.map(
              (criterion) => previousCriteria.get(criterion.id) || criterion,
            ),
          }
        : next,
    );
  }
  return [...byId.values()];
}

function finalizeWithGaps(
  brief: RequirementBrief,
  opts?: {
    blockedKickoff?: boolean;
    preferReply?: string;
    software?: boolean;
    gapOpts?: BriefGapsOpts;
  },
): BriefGenerateResult {
  const gapOpts = opts?.gapOpts ?? { software: opts?.software };
  const gaps = computeBriefGaps(brief, gapOpts);
  const gapScore = computeBriefGapScore(brief, gapOpts);
  const ask = gapsToQuestions(gaps, MAX_QUESTIONS);
  brief.openQuestions = ask;
  brief.pendingGapQuestions = gaps.map((g) => g.question);
  brief.requirements = migrateLegacyRequirements(brief);
  brief.requirementGapScore = gapScore.score;
  brief.requirementsConfirmedAt = undefined;
  brief.status = "gathering";

  if (ask.length === 0) {
    const reply = [
      opts?.preferReply?.trim() ||
        "标准需求项已齐。请回复或点击「确认需求」；确认后再打开「开始项目」。",
      brief.goal ? `当前目标：${brief.goal}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    return { brief, reply, questionsToAsk: ask };
  }

  const gapReply = formatGapDrivenReply(brief, gaps, {
    blockedKickoff: opts?.blockedKickoff,
  });
  const reply = opts?.preferReply?.trim()
    ? `${opts.preferReply.trim()}\n\n${gapReply}`
    : gapReply;
  return { brief, reply, questionsToAsk: ask };
}

/** 弹窗答卷 / 带「答：」的补充，不是新立项。 */
function isClarifyAnswerBody(userText: string): boolean {
  const t = userText.trim();
  if (!t) return false;
  if (t.includes("【需求补充")) return true;
  if (/答[：:]/.test(t) && /^\s*\d+\./m.test(t)) return true;
  return false;
}

/** 新立项话术：丢掉当前会话草稿里的旧 Brief，重新只吸收本句。 */
function isFreshProductPitch(userText: string): boolean {
  if (isClarifyAnswerBody(userText)) return false;
  const text = userText.trim();
  return (
    /^(?:我想|我要|请|帮我|麻烦).{0,20}(?:做|开发|写|实现|创建|搭建)(?:一个|个|一款|一份)?/u.test(
      text,
    ) ||
    /^(?:做一个|开发一个|写一个|新建一个项目|新建项目|立项|产品需求[：:])/u.test(text)
  );
}

function baseBriefForUpdate(prev: RequirementBrief, userText: string): RequirementBrief {
  if (!isFreshProductPitch(userText)) return prev;
  return {
    ...emptyBrief(prev.projectId),
    version: prev.version || 0,
  };
}

function heuristicUpdate(
  prev: RequirementBrief,
  userText: string,
  blockedKickoff?: boolean,
  gapOpts?: BriefGapsOpts,
): BriefGenerateResult {
  const base = baseBriefForUpdate(prev, userText);
  let brief = absorbUserTextIntoBrief({ ...base, updatedAt: Date.now() }, userText);
  brief = groundCoreBriefToUserText(base, brief, userText);
  brief.clarifyRound = (prev.clarifyRound || 0) + 1;
  return finalizeWithGaps(brief, { blockedKickoff, gapOpts });
}

/**
 * 合并用户话到 Brief：指挥脑负责理解自然语言，启发式负责兜底。
 * 模型输出使用独立内部会话，且只有本轮用户答案有依据的字段才允许写入。
 */
export async function generateBriefUpdate(opts: {
  projectId: string;
  prev: RequirementBrief | null;
  userText: string;
  projectName?: string;
  projectType?: string;
  blockedKickoff?: boolean;
  streamSessionId?: string;
  streamRunId?: string;
  gapOpts?: BriefGapsOpts;
}): Promise<BriefGenerateResult> {
  // Brief JSON 只允许留在内部会话，禁止复用主聊天 streamSessionId/runId。
  void opts.streamSessionId;
  void opts.streamRunId;
  const stored = opts.prev?.projectId ? opts.prev : emptyBrief(opts.projectId);
  const prev = baseBriefForUpdate(stored, opts.userText);
  const gapOpts =
    opts.gapOpts ?? briefGapsOptsFromBrief(prev, null);
  const evidence = collectAnswerEvidence(opts.userText);
  let heuristic = absorbUserTextIntoBrief(
    { ...prev, projectId: opts.projectId, updatedAt: Date.now() },
    opts.userText,
  );
  heuristic = groundCoreBriefToUserText(prev, heuristic, opts.userText);

  try {
    const endpoint = await resolveEndpoint({ slot: "command" });
    if (!endpoint.model || !endpoint.baseUrl) {
      heuristic.clarifyRound = (stored.clarifyRound || 0) + 1;
      return finalizeWithGaps(heuristic, {
        blockedKickoff: opts.blockedKickoff,
        gapOpts,
      });
    }

    const openGaps = computeBriefGaps(heuristic, gapOpts);
    const allowed = [...evidence.keys].join(", ") || "（无）";
    const system = `你是虚募阁需求分析员。只整理用户本轮明确提供的信息，禁止猜测或补齐。
只输出一个 JSON 对象（不要 markdown）：
{"goal":"","industry":"","constraints":[],"decisions":[],"acceptance":[],"scopeIn":[],"scopeOut":[],"must":[],"should":[],"could":[],"wont":[],"uxNotes":"","audience":"","architectureNotes":"","requirements":[{"dimension":"data_lifecycle|external_api|roles_threats|privacy_compliance|performance_sla|deployment_rollback|observability|compatibility|i18n_a11y|test_acceptance_env","title":"","detail":"","priority":"must|should|could|wont","acceptanceCriteria":["可验证标准"],"conflicts":[]}]}
规则：
1. 只填写用户本轮答案直接支持的字段；允许字段/维度：${allowed}。
2. 不得根据常识补出验收、技术栈、模块、Gitee、uniapp、角色、SLA 或其它 NFR。
3. 用户回答“无/暂无/本期不适用”时，只对应当前问题，不得批量填其它字段。
4. 当前仍缺：${openGaps.map((gap) => gap.id).join(", ") || "（无）"}。缺口必须保持缺失，不得代答。`;
    const user = JSON.stringify({
      projectName: opts.projectName || "",
      projectType: opts.projectType || "",
      previousBrief: prev,
      currentQuestions: (prev.openQuestions || []).slice(0, MAX_QUESTIONS),
      userAnswer: evidence.answerText,
      allowedFields: [...evidence.keys],
    });

    const answer = await invoke<string>("xu_agent_stream", {
      request: {
        sessionId: `brief_internal_${opts.projectId}_${Date.now()}`,
        endpoint: {
          provider: endpoint.provider || "custom",
          model: endpoint.model,
          baseUrl: endpoint.baseUrl,
          apiKeyEnv: endpoint.apiKeyEnv || "",
          apiFormat: endpoint.apiFormat ?? "openai",
          presetId: endpoint.presetId ?? "",
        },
        messages: [
          { role: "system", content: system, images: null },
          { role: "user", content: user, images: null },
        ],
        workspaceRoot: null,
        enableTools: false,
        toolMode: "readonly",
        requireWrite: false,
        projectId: opts.projectId || null,
        memoryScope: "project",
        memoryScopeId: opts.projectId || null,
        memoryTaskHint: opts.userText.slice(0, 80),
      },
    });
    const parsed = parseJsonObject(answer);
    if (!parsed) {
      heuristic.clarifyRound = (stored.clarifyRound || 0) + 1;
      return finalizeWithGaps(heuristic, {
        blockedKickoff: opts.blockedKickoff,
        gapOpts,
      });
    }

    const stringArray = (key: string): string[] =>
      Array.isArray(parsed[key])
        ? (parsed[key] as unknown[]).map(String).map((text) => text.trim()).filter(Boolean)
        : [];
    const stringField = (key: EvidenceKey, fallback: string): string => {
      const candidate = String(parsed[key] || "").trim();
      return evidence.keys.has(key) && candidateGrounded(candidate, evidence.answerText)
        ? candidate
        : fallback;
    };
    const arrayField = (key: EvidenceKey, fallback: string[]): string[] => {
      if (!evidence.keys.has(key)) return fallback;
      const grounded = stringArray(key).filter((candidate) =>
        candidateGrounded(candidate, evidence.answerText),
      );
      return mergeUnique(fallback, grounded);
    };

    let brief: RequirementBrief = {
      ...heuristic,
      goal: stringField("goal", heuristic.goal || ""),
      industry: stringField("industry", heuristic.industry || ""),
      constraints: arrayField("constraints", heuristic.constraints),
      decisions: heuristic.decisions,
      acceptance: arrayField("acceptance", heuristic.acceptance),
      scopeIn: arrayField("scopeIn", heuristic.scopeIn),
      scopeOut: arrayField("wont", heuristic.scopeOut),
      must: arrayField("must", heuristic.must || []),
      should: evidence.keys.has("must")
        ? mergeUnique(
            heuristic.should || [],
            stringArray("should").filter((candidate) =>
              candidateGrounded(candidate, evidence.answerText),
            ),
          )
        : heuristic.should || [],
      could: evidence.keys.has("must")
        ? mergeUnique(
            heuristic.could || [],
            stringArray("could").filter((candidate) =>
              candidateGrounded(candidate, evidence.answerText),
            ),
          )
        : heuristic.could || [],
      wont: arrayField("wont", heuristic.wont || []),
      uxNotes: stringField("uxNotes", heuristic.uxNotes || ""),
      audience: stringField("audience", heuristic.audience || ""),
      architectureNotes: stringField(
        "architectureNotes",
        heuristic.architectureNotes || "",
      ),
      requirements: generatedRequirements(
        parsed.requirements,
        migrateLegacyRequirements(heuristic),
        evidence.keys,
        evidence.answerText,
      ),
      requirementsConfirmedAt: undefined,
      clarifyRound: (stored.clarifyRound || 0) + 1,
      status: "gathering",
      updatedAt: Date.now(),
    };
    brief = groundCoreBriefToUserText(prev, brief, opts.userText);
    return finalizeWithGaps(brief, {
      blockedKickoff: opts.blockedKickoff,
      gapOpts,
    });
  } catch {
    heuristic.clarifyRound = (stored.clarifyRound || 0) + 1;
    return finalizeWithGaps(heuristic, {
      blockedKickoff: opts.blockedKickoff,
      gapOpts,
    });
  }
}

export { MAX_CLARIFY_ROUNDS };
