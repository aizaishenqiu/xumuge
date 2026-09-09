/**
 * @file 需求澄清、显式确认与开工门禁编排
 * @author qiuye <yjk150@qq.com>
 * @updated 2026-09-06
 * @version 1.2.0
 * @category AgentLoop
 * @algo requirements-gate
 */
import { appendFouMessage } from "../employee";
import { OFFICE_FLOOR, peerSessionTag, BOSS_PEER_ID } from "../utils/officeComms";
import { writeTextUnderWorkspace, readTextFile } from "../utils/fsBridge";
import type { XuProject } from "../utils/projects";
import {
  formatBriefSummary,
  formatMatchPlanSummary,
  migrateLegacyRequirements,
  type RequirementBrief,
} from "./briefTypes";
import { loadBrief, markBriefExecuting, saveBrief } from "./briefStore";
import { generateBriefUpdate } from "./briefGenerator";
import { buildMatchPlanForBrief, enrichMatchPlanNames } from "./roleMatcher";
import { routeBossIntent } from "./intentRouter";
import { scaffoldSoftwareSkills } from "./softwareSkillScaffold";
import { scaffoldRoleSkillsForBrief } from "./roleSkillScaffold";
import { scaffoldCopywritingSkills } from "./copywritingSkillScaffold";
import { handleAcceptanceRework } from "./acceptanceRework";
import { generateAndWriteArchitectureBrief } from "./architectureBriefGenerator";
import { rebuildSemanticIndex } from "./projectSemanticIndex";
import { rebuildEmbeddingIndex } from "./projectEmbeddingIndex";
import { dispatchArchitectureBriefReview } from "./architectureBriefReview";
import { loadCodeExecPrefs } from "../utils/codeExecPrefs";
import { isWorkKickoff } from "../utils/bossStopIntent";
import {
  assessRequirementGate,
  computeBriefGaps,
  gapsToQuestions,
  briefGapsOptsFromBrief,
  type BriefGapsOpts,
} from "./briefGaps";
import { GAPS_FILLED_HINT, formatPendingClarifyNotice } from "./clarifyUi";
import { appendActivityLog } from "../utils/activityLog";
import { toUserError } from "../utils/userFacingError";
import {
  mergeWorkModeIntoBrief,
} from "./workModeClassifier";
import { resolveWorkModeWithAssist } from "./workModeClassifierAssist";

const OFFICE_SESSION = peerSessionTag(BOSS_PEER_ID, OFFICE_FLOOR);

function gapOptsFor(brief: RequirementBrief, project: XuProject | null | undefined): BriefGapsOpts {
  return briefGapsOptsFromBrief(brief, project);
}

function isSoftwareBriefFlow(brief: RequirementBrief, project: XuProject | null | undefined): boolean {
  return gapOptsFor(brief, project).profile === "software";
}

function logGateActivity(opts: {
  kind: "clarify" | "gate";
  title: string;
  detail: string;
  projectId?: string;
}) {
  void appendActivityLog({
    kind: opts.kind,
    title: opts.title,
    detail: opts.detail.slice(0, 1200),
    projectId: opts.projectId ?? null,
    outcome: "ok",
  }).catch(() => {});
}

/** Mirror Brief/clarify turns from main chat into the office floor session. */
export async function mirrorClarifyTurnToOffice(opts: {
  bossText?: string;
  systemText?: string;
}): Promise<void> {
  const boss = (opts.bossText || "").trim();
  if (boss) {
    await appendFouMessage({
      sessionTag: OFFICE_SESSION,
      role: "boss",
      content: boss,
    });
  }
  const sys = (opts.systemText || "").trim();
  if (sys) {
    await appendFouMessage({
      sessionTag: OFFICE_SESSION,
      role: "system",
      content: sys,
    });
  }
  if (boss || sys) {
    window.dispatchEvent(new CustomEvent("xu-office-notify"));
    window.dispatchEvent(new CustomEvent("xu-clarify-pending"));
  }
}

function joinPath(root: string, rel: string): string {
  return `${root.replace(/[/\\]+$/, "")}/${rel.replace(/^[/\\]+/, "")}`.replace(/\\/g, "/");
}

export type ClarifyGateResult = {
  runKickoff: boolean;
  forceAll: boolean;
  /** Single-employee dispatch allowed only when brief ready/executing or force. */
  allowSingleDispatch: boolean;
  brief: RequirementBrief | null;
  systemMessage: string | null;
};

export async function appendBriefDialogueToPlaybook(
  project: XuProject,
  brief: RequirementBrief,
): Promise<void> {
  const gen = (project.generatePath || "").trim();
  if (!gen) return;
  const rel = "REQUIREMENTS_PLAYBOOK.md";
  let prev = "";
  try {
    prev = await readTextFile(joinPath(gen, rel));
  } catch {
    prev = "";
  }
  const section = [
    "",
    "## 对话确认区（Brief）",
    "",
    formatBriefSummary(brief),
    "",
    `_更新于 ${new Date(brief.updatedAt).toLocaleString()} · v${brief.version || 0}_`,
    "",
  ].join("\n");
  const marker = "## 对话确认区（Brief）";
  let next: string;
  if (prev.includes(marker)) {
    const i = prev.indexOf(marker);
    const rest = prev.slice(i + marker.length);
    const nextH = rest.search(/\n## /);
    const before = prev.slice(0, i);
    const after = nextH >= 0 ? rest.slice(nextH) : "";
    next = before + section + after;
  } else {
    next = (prev.trimEnd() + "\n" + section).trimStart();
  }
  await writeTextUnderWorkspace(gen, rel, next);
}

async function applyMatchAndSkills(
  _project: XuProject,
  briefIn: RequirementBrief,
): Promise<{ brief: RequirementBrief; skillPaths: string[]; planSummary: string }> {
  const plan = enrichMatchPlanNames(
    await buildMatchPlanForBrief(briefIn, {
      projectType: _project.type,
      limit: 8,
    }),
  );
  const brief = {
    ...briefIn,
    matchPlan: plan,
    matchedRoleIds: plan.map((p) => p.roleId),
    status: "ready" as const,
    openQuestions: [] as string[],
  };
  return {
    brief,
    skillPaths: [],
    planSummary: formatMatchPlanSummary(plan),
  };
}

/** Architecture brief + optional semantic index after Brief confirm. */
async function finalizeSoftwareBriefArtifacts(
  project: XuProject,
  brief: RequirementBrief,
): Promise<string[]> {
  const gen = (project.generatePath || "").trim();
  if (!gen || project.type !== "software") return [];

  const prefs = await loadCodeExecPrefs();
  const extra: string[] = [];
  let archGenerated = false;

  try {
    const { ensureRequirementsGate, REQUIREMENTS_GATE_REL } = await import(
      "../utils/requirementsGate"
    );
    if (await ensureRequirementsGate(project, brief)) {
      extra.push(`${gen}/${REQUIREMENTS_GATE_REL}`);
    }
  } catch {
    /* release gate will keep completion blocked if persistence failed */
  }

  if (prefs.architectureBriefOnConfirm) {
    try {
      const arch = await generateAndWriteArchitectureBrief({ project, brief });
      if (arch) {
        archGenerated = true;
        extra.push(
          `${arch.absolutePath}${arch.usedLlm ? "（LLM）" : "（模板）"}`,
        );
      }
    } catch {
      /* ignore */
    }
  }

  if (prefs.projectSemanticIndexEnabled) {
    try {
      await rebuildSemanticIndex({ workspaceRoot: gen, brief });
      extra.push(`${gen}/.xu/semantic-index.json`);
    } catch {
      /* ignore */
    }
  }

  if (prefs.projectEmbeddingIndexEnabled) {
    try {
      const emb = await rebuildEmbeddingIndex({ workspaceRoot: gen, brief });
      if (emb) extra.push(`${gen}/.xu/embedding-index.json（${emb.model}）`);
    } catch {
      /* ignore */
    }
  }

  if (archGenerated && prefs.architectureReviewOnConfirm) {
    try {
      await dispatchArchitectureBriefReview({ project, brief });
    } catch {
      /* ignore */
    }
  }

  return extra;
}

/**
 * Core clarify / confirm / kickoff gate. Does not append office messages —
 * callers decide where to show `systemMessage`.
 */
export async function processClarifyGate(opts: {
  text: string;
  project: XuProject | null;
  /** Treat as kickoff even without keywords (e.g. 「派活」「全体开工」按钮). */
  treatAsKickoff?: boolean;
  /** 主对话流式：让需求分析员的思考出现在当前气泡 */
  streamSessionId?: string;
  streamRunId?: string;
}): Promise<ClarifyGateResult> {
  const text = opts.treatAsKickoff && !isWorkKickoff(opts.text)
    ? `【全体开工】${opts.text}`
    : opts.text;
  const project = opts.project;
  const projectId = project?.id || "";

  if (!projectId) {
    const intent = routeBossIntent(text, null);
    if (intent.kind === "clarify" && intent.blockedKickoff) {
      return {
        runKickoff: false,
        forceAll: false,
        allowSingleDispatch: false,
        brief: null,
        systemMessage: "请先选择/绑定项目（或把工作区切到项目生成路径），再澄清需求后开工。",
      };
    }
    const readyKick = intent.kind === "kickoff_ready" || intent.kind === "force_all_kickoff";
    return {
      runKickoff: readyKick,
      forceAll: intent.kind === "force_all_kickoff",
      allowSingleDispatch: readyKick,
      brief: null,
      systemMessage: readyKick
        ? "未绑定项目：无法按 Brief 派岗。请到办公室绑定项目后再开工。"
        : null,
    };
  }

  let brief = await loadBrief(projectId);
  const intent = routeBossIntent(text, brief);

  if (intent.kind === "ops_stop" || intent.kind === "ops_reset") {
    return {
      runKickoff: false,
      forceAll: false,
      allowSingleDispatch: false,
      brief,
      systemMessage: null,
    };
  }

  if (intent.kind === "acceptance_rework") {
    if (!project) {
      return {
        runKickoff: false,
        forceAll: false,
        allowSingleDispatch: false,
        brief,
        systemMessage: "请先绑定项目，再使用「验收返工」。",
      };
    }
    const rework = await handleAcceptanceRework({ project, bossText: text });
    return {
      runKickoff: false,
      forceAll: false,
      allowSingleDispatch: true,
      brief,
      systemMessage: rework.message,
    };
  }

  if (intent.kind === "confirm_brief") {
    try {
      let briefNext = await loadBrief(projectId);
      const gapOpts = gapOptsFor(briefNext, project);
      const gaps = computeBriefGaps(briefNext, gapOpts);
      if (gaps.length) {
        logGateActivity({
          kind: "gate",
          title: "需求尚未齐，无法确认",
          detail: gaps.map((g) => g.question).join("\n"),
          projectId,
        });
        return {
          runKickoff: false,
          forceAll: false,
          allowSingleDispatch: false,
          brief: briefNext,
          systemMessage: [
            "⛔ 需求尚未齐，还不能确认。",
            formatPendingClarifyNotice(briefNext, gapOpts) || "请点「补充需求」在弹窗中继续作答。",
            "补全后可再回复「确认需求」。",
          ].join("\n"),
        };
      }
      briefNext.requirements = migrateLegacyRequirements(briefNext).map((requirement) => ({
        ...requirement,
        status: requirement.status === "draft" ? ("confirmed" as const) : requirement.status,
      }));
      briefNext.requirementsConfirmedAt = Date.now();
      briefNext.requirementGapScore = 100;
      briefNext.status = "ready";
      briefNext.openQuestions = [];
      briefNext.pendingGapQuestions = [];
      const { brief: next, skillPaths, planSummary } = await applyMatchAndSkills(project!, briefNext);
      // applyMatchAndSkills saves; bump version once here
      brief = await saveBrief(next, { bumpVersion: true });
      // rewrite skills with final version
      let paths = skillPaths;
      if (project && (project.generatePath || "").trim()) {
        const gen = project.generatePath!.trim();
        if (isSoftwareBriefFlow(brief, project)) {
          paths = await scaffoldSoftwareSkills(gen, brief);
          const rolePaths = await scaffoldRoleSkillsForBrief(gen, brief);
          paths = [...paths, ...rolePaths];
          const artifactPaths = await finalizeSoftwareBriefArtifacts(project, brief);
          paths = [...paths, ...artifactPaths];
          await appendBriefDialogueToPlaybook(project, brief);
        }
        const copyPaths = await scaffoldCopywritingSkills(gen, brief);
        paths = [...paths, ...copyPaths];
      }
      const msg = [
        `✅ 需求已确认（Brief ready · v${brief.version}）。`,
        formatBriefSummary(brief),
        planSummary,
        paths.length
          ? `已按最新 Brief 重写项目 Skills：\n${paths.map((path) => `· ${path}`).join("\n")}`
          : "",
        `匹配 ${brief.matchedRoleIds.length} 岗。将弹出「开始项目」确认名称与生成路径；也可稍后回复「全体开工」。要全员请说「强制全员」。`,
      ]
        .filter(Boolean)
        .join("\n");
      void import("../commerce")
        .then(({ enqueueTrainingSample, warnTrainingSampleSkipped }) =>
          enqueueTrainingSample({
            kind: "clarify_confirm",
            industry: brief.industry || project?.type,
            projectId,
            summary: (brief.goal || "").slice(0, 400),
            meta: {
              acceptanceCount: brief.acceptance?.length ?? 0,
              matchedRoles: brief.matchedRoleIds?.length ?? 0,
            },
          }).then(warnTrainingSampleSkipped),
        )
        .catch((e) => console.warn("[xu] training sample", e));
      logGateActivity({
        kind: "gate",
        title: "需求已确认（Brief ready）",
        detail: msg,
        projectId,
      });
      return {
        runKickoff: false,
        forceAll: false,
        allowSingleDispatch: true,
        brief,
        systemMessage: msg,
      };
    } catch (e) {
      brief = await loadBrief(projectId);
      return {
        runKickoff: false,
        forceAll: false,
        allowSingleDispatch: false,
        brief,
        systemMessage: `❌ 确认需求失败：${toUserError(e)}。请补全 Brief 后重试。`,
      };
    }
  }

  if (intent.kind === "force_all_kickoff") {
    const gapOpts = gapOptsFor(brief, project);
    if (brief.status !== "ready" && brief.status !== "executing") {
      const gaps = computeBriefGaps(brief, gapOpts);
      if (gaps.length) {
        return {
          runKickoff: false,
          forceAll: false,
          allowSingleDispatch: false,
          brief,
          systemMessage: [
            "⛔ 强制全员前请先补齐需求。",
            formatPendingClarifyNotice(brief, gapOpts) || "请点「补充需求」继续。",
            "或先「确认需求」后再强制全员。",
          ].join("\n"),
        };
      }
      if (!brief.requirementsConfirmedAt) {
        return {
          runKickoff: false,
          forceAll: false,
          allowSingleDispatch: false,
          brief,
          systemMessage:
            "⛔ 缺口已补齐，但「强制全员」不能代替需求确认。请先显式回复「确认需求」。",
        };
      }
      try {
        brief.requirements = migrateLegacyRequirements(brief).map((requirement) => ({
          ...requirement,
          status: requirement.status === "draft" ? ("confirmed" as const) : requirement.status,
        }));
        brief.requirementsConfirmedAt = Date.now();
        brief.requirementGapScore = 100;
        const { brief: next } = await applyMatchAndSkills(project!, {
          ...brief,
          status: "ready",
          openQuestions: [],
        });
        brief = await saveBrief(next, { bumpVersion: true });
        if (project && (project.generatePath || "").trim()) {
          const gen = project.generatePath!.trim();
          if (isSoftwareBriefFlow(brief, project)) {
            await scaffoldSoftwareSkills(gen, brief);
            await scaffoldRoleSkillsForBrief(gen, brief);
            await finalizeSoftwareBriefArtifacts(project, brief);
            await appendBriefDialogueToPlaybook(project, brief);
          }
          await scaffoldCopywritingSkills(gen, brief);
        }
      } catch (e) {
        return {
          runKickoff: false,
          forceAll: false,
          allowSingleDispatch: false,
          brief,
          systemMessage: `❌ 强制全员准备失败：${toUserError(e)}。请补全 Brief 后重试。`,
        };
      }
    } else {
      const gaps = computeBriefGaps(brief, gapOpts);
      if (gaps.length) {
        return {
          runKickoff: false,
          forceAll: false,
          allowSingleDispatch: false,
          brief,
          systemMessage: [
            "⛔ 强制全员前请先补齐需求。",
            formatPendingClarifyNotice(brief, gapOpts) || "请点「补充需求」继续。",
            "或先「确认需求」后再强制全员。",
          ].join("\n"),
        };
      }
    }
    const forceGate = assessRequirementGate(brief, { gapOpts });
    if (!forceGate.ok) {
      return {
        runKickoff: false,
        forceAll: false,
        allowSingleDispatch: false,
        brief,
        systemMessage: `⛔ 需求门禁未通过（完整度 ${forceGate.score}%）：${forceGate.reasons.join("；")}`,
      };
    }
    await markBriefExecuting(projectId);
    return {
      runKickoff: true,
      forceAll: true,
      allowSingleDispatch: true,
      brief,
      systemMessage: null,
    };
  }

  if (intent.kind === "kickoff_ready") {
    const gapOpts = gapOptsFor(brief, project);
    if (brief.status !== "ready" && brief.status !== "executing") {
      const gaps = computeBriefGaps(brief, gapOpts);
      if (gaps.length) {
        return {
          runKickoff: false,
          forceAll: false,
          allowSingleDispatch: false,
          brief,
          systemMessage: [
            "⛔ 开工前请先补齐需求。",
            formatPendingClarifyNotice(brief, gapOpts) || "请点「补充需求」继续。",
            "补全后可点「确认需求」或「开始项目」。",
          ].join("\n"),
        };
      }
    } else {
      const gaps = computeBriefGaps(brief, gapOpts);
      if (gaps.length && brief.status !== "executing") {
        return {
          runKickoff: false,
          forceAll: false,
          allowSingleDispatch: false,
          brief,
          systemMessage: [
            "⛔ Brief 标记就绪但仍有缺口。",
            formatPendingClarifyNotice(brief, gapOpts) || "请点「补充需求」继续。",
            "请先补充后再开工。",
          ].join("\n"),
        };
      }
    }
    const kickoffGate = assessRequirementGate(brief, { gapOpts });
    if (!kickoffGate.ok && brief.status !== "executing") {
      return {
        runKickoff: false,
        forceAll: false,
        allowSingleDispatch: false,
        brief,
        systemMessage: `⛔ 需求门禁未通过（完整度 ${kickoffGate.score}%）：${kickoffGate.reasons.join("；")}`,
      };
    }
    // Keep Skills fresh if version drifted
    if (project && (project.generatePath || "").trim() && (brief.version || 0) > 0) {
      try {
        const gen = project.generatePath!.trim();
        if (isSoftwareBriefFlow(brief, project)) {
          await scaffoldSoftwareSkills(gen, brief);
        }
        await scaffoldCopywritingSkills(gen, brief);
      } catch {
        /* ignore */
      }
    }
    if (brief.status === "executing") {
      await markBriefExecuting(projectId);
      return {
        runKickoff: true,
        forceAll: false,
        allowSingleDispatch: true,
        brief,
        systemMessage: null,
      };
    }
    return {
      runKickoff: false,
      forceAll: false,
      allowSingleDispatch: true,
      brief,
      systemMessage:
        "✅ 需求已就绪。请在「开始项目」弹窗确认技术栈与智脑/写码模型后再开工；也可稍后回复「全体开工」。",
    };
  }

  if (intent.kind === "clarify" || intent.blockedKickoff) {
    brief = mergeWorkModeIntoBrief(
      brief,
      await resolveWorkModeWithAssist({
        text: opts.text,
        brief,
        project,
        projectId,
      }),
    );
    const gapOpts = gapOptsFor(brief, project);
    const result = await generateBriefUpdate({
      projectId,
      prev: brief,
      userText: opts.text,
      projectName: project?.name,
      projectType: project?.type,
      blockedKickoff: intent.blockedKickoff,
      streamSessionId: opts.streamSessionId,
      streamRunId: opts.streamRunId,
      gapOpts,
    });
    brief = await saveBrief(result.brief);
    const gaps = computeBriefGaps(brief, gapOpts);
    // 问题与完整度已在 result.reply；不再二次粘贴问题列表
    const msg = [
      intent.blockedKickoff ? "先把下面几件事说清楚，再开始做。" : "",
      result.reply,
      !gaps.length &&
      brief.goal?.trim() &&
      !result.reply.includes("标准需求项已齐") &&
      !result.reply.includes("开始项目")
        ? GAPS_FILLED_HINT
        : "",
    ]
      .filter(Boolean)
      .join("\n");
    logGateActivity({
      kind: "clarify",
      title: intent.blockedKickoff ? "开工已拦截，待澄清" : "需求澄清",
      detail: msg,
      projectId,
    });
    return {
      runKickoff: false,
      forceAll: false,
      allowSingleDispatch: false,
      brief,
      systemMessage: msg,
    };
  }

  const ready = brief.status === "ready" || brief.status === "executing";
  return {
    runKickoff: false,
    forceAll: false,
    allowSingleDispatch: ready,
    brief,
    systemMessage: null,
  };
}

/**
 * Office @所有人 path: process gate + append system message to office session.
 */
export async function handleOfficeClarifyGate(opts: {
  text: string;
  project: XuProject | null;
  treatAsKickoff?: boolean;
}): Promise<{
  runKickoff: boolean;
  forceAll: boolean;
  allowSingleDispatch: boolean;
  brief: RequirementBrief | null;
}> {
  const r = await processClarifyGate(opts);
  if (r.systemMessage) {
    await appendFouMessage({
      sessionTag: OFFICE_SESSION,
      role: "system",
      content: r.systemMessage,
    });
    window.dispatchEvent(new CustomEvent("xu-office-notify"));
    // 仅在明确需要补缺口时通知；办公室监听后按 blocked_kickoff 打开（可被「稍后/停工」抑制）
    if (r.brief?.status === "gathering" && !r.runKickoff) {
      window.dispatchEvent(new CustomEvent("xu-clarify-pending"));
    }
  }
  return {
    runKickoff: r.runKickoff,
    forceAll: r.forceAll,
    allowSingleDispatch: r.allowSingleDispatch,
    brief: r.brief,
  };
}

/**
 * Gate for single-employee dispatch. Blocks when brief not ready.
 * Confirm/clarify turns never dispatch in the same message.
 */
export async function handleSingleDispatchClarifyGate(opts: {
  text: string;
  project: XuProject | null;
}): Promise<{
  allowDispatch: boolean;
  brief: RequirementBrief | null;
}> {
  const projectId = opts.project?.id || "";
  if (!projectId) {
    await appendFouMessage({
      sessionTag: OFFICE_SESSION,
      role: "system",
      content: "请先绑定项目，再澄清需求后派活。",
    });
    return { allowDispatch: false, brief: null };
  }

  const brief0 = await loadBrief(projectId);
  const intent = routeBossIntent(opts.text, brief0);

  if (
    intent.kind === "confirm_brief" ||
    intent.kind === "clarify" ||
    intent.kind === "acceptance_rework" ||
    intent.blockedKickoff
  ) {
    const r = await handleOfficeClarifyGate({
      text: opts.text,
      project: opts.project,
      treatAsKickoff: intent.blockedKickoff || intent.kind === "clarify",
    });
    return { allowDispatch: false, brief: r.brief };
  }

  if (brief0.status === "ready" || brief0.status === "executing") {
    return { allowDispatch: true, brief: brief0 };
  }

  // Not ready and message looks like work → clarify
  const r = await handleOfficeClarifyGate({
    text: opts.text,
    project: opts.project,
    treatAsKickoff: true,
  });
  return { allowDispatch: false, brief: r.brief };
}

/** 从 UI 触发显式需求确认；依赖已绑定项目，失败由办公室门禁消息展示。 */
export async function confirmBriefFromUi(project: XuProject | null): Promise<RequirementBrief | null> {
  if (!project?.id) return null;
  const r = await handleOfficeClarifyGate({ text: "确认需求", project });
  return r.brief;
}
