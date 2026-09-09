/**
 * Shared checks before direct team kickoff (office / force-all).
 * 「开始项目」弹窗路径仍负责首次 techStack + 双模型持久化。
 */
import { probeBrain, resolveEndpoint } from "../utils/opsBrains";
import type { XuProject } from "../utils/projects";
import { softwareCodingSurfaceChosen } from "../utils/codingSurfacePrefs";
import type { RequirementBrief } from "./briefTypes";
import { briefGapsOptsFromBrief, computeBriefGaps, gapsToQuestions } from "./briefGaps";
import { toUserError } from "../utils/userFacingError";

export type KickoffPreflight = {
  ok: boolean;
  reason?: string;
  /** Open 「开始项目」弹窗补齐 techStack / 模型等 */
  openProjectStart?: boolean;
  gapQuestions?: string[];
};

export function isSoftwareProject(project: XuProject): boolean {
  return project.type === "software" || project.industryId === "software";
}

export function softwareHasTechStack(project: XuProject): boolean {
  if ((project.toolchain?.languages?.length ?? 0) > 0) return true;
  const sp = project.stackProfile;
  if (!sp) return false;
  if (sp.enabled && Object.values(sp.enabled).some(Boolean)) return true;
  return Boolean(
    sp.frontendDir || sp.backendDir || sp.uiDir || sp.desktopDir || sp.appDir,
  );
}

export async function checkKickoffPreflight(
  project: XuProject,
  brief: RequirementBrief | null,
): Promise<KickoffPreflight> {
  const gen = (project.generatePath || "").trim();
  if (!gen) {
    return {
      ok: false,
      reason: "当前项目未设置「生成路径」。",
      openProjectStart: true,
    };
  }

  if (brief && brief.status !== "executing") {
    const gapOpts = briefGapsOptsFromBrief(brief, project);
    const gaps = computeBriefGaps(brief, gapOpts);
    if (gaps.length) {
      return {
        ok: false,
        reason: "Brief 仍有缺口未补齐",
        gapQuestions: gapsToQuestions(gaps, 3),
        openProjectStart: false,
      };
    }
  }

  if (isSoftwareProject(project) && !softwareCodingSurfaceChosen(project)) {
    return {
      ok: false,
      reason: "软件项目尚未选择写码表面（内置虚募阁 IDE 或本机已安装的 IDE）。",
      openProjectStart: true,
    };
  }

  if (isSoftwareProject(project) && !softwareHasTechStack(project)) {
    return {
      ok: false,
      reason: "软件项目尚未配置技术栈（请在「开始项目」弹窗选择语言/框架）。",
      openProjectStart: true,
    };
  }

  try {
    const ep = await resolveEndpoint({ slot: "work" });
    if (!ep.model?.trim() || !ep.baseUrl?.trim()) {
      return {
        ok: false,
        reason: "员工脑槽未配置模型（请在「开始项目」弹窗或设置 → 模型配置三脑）。",
        openProjectStart: true,
      };
    }
    await probeBrain(ep.baseUrl, { apiKeyEnv: ep.apiKeyEnv, model: ep.model });
  } catch (e) {
    return {
      ok: false,
      reason: `模型接口不可用：${toUserError(e).slice(0, 140)}`,
      openProjectStart: true,
    };
  }

  return { ok: true };
}
