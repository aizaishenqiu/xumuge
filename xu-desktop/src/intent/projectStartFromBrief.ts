/**
 * @file Brief 就绪后保存/创建项目、入职并可选开工
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-31
 * @updated 2026-09-02
 * @version 1.2.0
 * @category AgentLoop
 * @algo brief-to-project-kickoff
 */
import { invoke } from "@tauri-apps/api/core";
import { ensureEmployeesForRoleIds } from "../utils/employees";
import {
  defaultProjectToolPolicy,
  upsertProject,
  type XuProject,
  type ProjectKickoffMode,
  type ProjectToolPolicy,
} from "../utils/projects";
import { probeBrain, resolveEndpoint } from "../utils/opsBrains";
import { buildKickoffSoftwareStack } from "../utils/projectStack";
import type { StackEndKey } from "../utils/projectStack";
import { sanitizeDirName, suggestStackEndDirs } from "../utils/devWorkspace";
import {
  alignStackDirsToScaffold,
  scaffoldDeliveryWorkspace,
  scaffoldProjectWorkspace,
} from "../utils/projectWorkspaceScaffold";
import { briefSettingKey, type RequirementBrief } from "./briefTypes";
import { loadBrief, saveBrief } from "./briefStore";
import { runBriefMatchedKickoff } from "./briefMatchedKickoff";
import {
  loadKickoffModelOptions,
  mapEmployeeForKickoffModels,
  persistKickoffModelsToOpsBrains,
  type KickoffModelOptions,
} from "./kickoffModelPick";
import type { IndustryId } from "../project/industryProfiles";
import { industryToProjectType } from "../project/industryWizards";
import { scoreBriefComplexity } from "../utils/complexityRoute";
import { toUserError } from "../utils/userFacingError";
import { isSoftwareBriefWorkMode } from "./workModeClassifier";

function countBriefGaps(brief: RequirementBrief): number {
  let n = 0;
  if (!(brief.goal || "").trim()) n += 1;
  if (!(brief.must || []).length && !(brief.acceptance || []).length) n += 1;
  if (!(brief.acceptance || []).length) n += 1;
  if ((brief.openQuestions || []).length >= 2) n += 2;
  else if ((brief.openQuestions || []).length) n += 1;
  if (!(brief.constraints || []).length) n += 1;
  return n;
}

export type ProjectStartMode = "save_and_kickoff" | "save_only";

export type ProjectStartFromBriefInput = {
  brief: RequirementBrief;
  /** Existing project to update; omit to create software project. */
  project?: XuProject | null;
  name: string;
  generatePath: string;
  mode: ProjectStartMode;
  bossText?: string;
  /** If set, only these roles are hired / dispatched */
  roleIds?: string[];
  /** 智脑 / 规划分配任务模型 key */
  commandModelKey?: string;
  /** 写码模型 key */
  codeModelKey?: string;
  /** 软件项目：语言/框架多选 */
  techStack?: string[];
  /** Git 远程 URL（可选） */
  gitRemoteUrl?: string;
  /** 默认分支，默认 main */
  gitDefaultBranch?: string;
  /** 软件：敏捷 phased / 瀑布 strict */
  kickoffMode?: ProjectKickoffMode;
  /** 软件：内置 / 本机 IDE */
  codeEditorSurface?: "builtin" | "external";
  /** 本机 IDE 种类 */
  toolchainIde?: "cursor" | "vscode" | "trae" | "qoder" | "jetbrains" | "windsurf" | "zed" | "other";
  /** Agent 工具权限（向导选择） */
  toolPolicy?: ProjectToolPolicy;
  /** 端勾选覆盖（向导步骤 3） */
  stackEndOverrides?: Partial<Record<StackEndKey, boolean>>;
  /** 非软件 Brief：行业（8 类） */
  industryId?: IndustryId;
};

export type ProjectStartFromBriefResult = {
  project: XuProject;
  brief: RequirementBrief;
  hiredCount: number;
  kickedOff: boolean;
  dispatched?: number;
  awaitingDesignConfirm?: boolean;
};

/** Software-friendly policy so kickoff agents can write. */
export function softwareStartToolPolicy(): ProjectToolPolicy {
  return {
    ...defaultProjectToolPolicy(),
    readFiles: true,
    writeFiles: true,
    shell: true,
    ide: true,
  };
}

/** 从 Brief 目标提炼适合做文件夹名的项目名（保留中文，不转拼音/英文）。 */
export function suggestProjectNameFromBrief(brief: RequirementBrief | null | undefined): string {
  let goal = (brief?.goal || "").trim().replace(/\s+/g, " ");
  if (!goal) return "未命名项目";
  // 剥口语前缀，便于「幼儿园收费小程序」这类中文目录名
  goal = goal
    .replace(
      /^(我想|我要|帮我|请|麻烦)?(做|开发|写|实现|创建|搭建|搞)(一个|个|一款|一份)?/u,
      "",
    )
    .replace(/[。.!！？?\s]+$/u, "")
    .trim();
  if (!goal) goal = (brief?.goal || "").trim();
  return sanitizeDirName(goal);
}

async function migrateBriefToProject(
  brief: RequirementBrief,
  newProjectId: string,
): Promise<RequirementBrief> {
  if (brief.projectId === newProjectId) {
    return saveBrief({ ...brief, projectId: newProjectId });
  }
  const next: RequirementBrief = {
    ...brief,
    projectId: newProjectId,
    updatedAt: Date.now(),
  };
  const saved = await saveBrief(next);
  const oldKey = briefSettingKey(brief.projectId);
  if (brief.projectId && brief.projectId !== newProjectId) {
    try {
      await invoke("xu_set_setting", { key: oldKey, value: "" });
    } catch {
      /* ignore */
    }
  }
  return saved;
}

async function assertKickoffLlmReady(): Promise<void> {
  const ep = await resolveEndpoint({ slot: "work" });
  if (!ep.model?.trim() || !ep.baseUrl?.trim()) {
    throw new Error(
      "员工脑槽未配置模型。请在开工弹窗选择「智脑 / 写码」模型，或到设置 → 模型配置三脑。",
    );
  }
  try {
    await probeBrain(ep.baseUrl, { apiKeyEnv: ep.apiKeyEnv, model: ep.model });
  } catch (e) {
    throw new Error(`模型接口不可用（${ep.baseUrl}）：${toUserError(e).slice(0, 160)}`);
  }
}

export async function projectStartFromBrief(
  input: ProjectStartFromBriefInput,
): Promise<ProjectStartFromBriefResult> {
  const name = input.name.trim();
  const generatePath = input.generatePath.trim();
  if (!name) throw new Error("请填写项目名称");
  if (!generatePath) throw new Error("请选择生成路径");

  const resolvedToolPolicy =
    input.toolPolicy ||
    (input.project?.toolPolicy && "readFiles" in input.project.toolPolicy
      ? input.project.toolPolicy
      : softwareStartToolPolicy());

  let modelOpts: KickoffModelOptions | null = null;
  const commandKey = (input.commandModelKey || "").trim();
  const codeKey = (input.codeModelKey || "").trim();

  if (input.mode === "save_and_kickoff") {
    if (!commandKey && !codeKey) {
      throw new Error("请选择智脑模型与写码模型后再开工");
    }
    modelOpts = await loadKickoffModelOptions();
    await persistKickoffModelsToOpsBrains(commandKey, codeKey, modelOpts);
    await assertKickoffLlmReady();
  }

  let project = input.project || null;
  const isSoftware = isSoftwareBriefWorkMode(input.brief, project);
  const tech = (input.techStack || []).map((s) => s.trim()).filter(Boolean);
  if (isSoftware && !tech.length) {
    throw new Error("软件项目请至少选择一种语言或框架");
  }

  let stackPatch: ReturnType<typeof buildKickoffSoftwareStack> | null = null;
  if (isSoftware && tech.length) {
    stackPatch = buildKickoffSoftwareStack(name, tech, input.stackEndOverrides);
    stackPatch.stackProfile = suggestStackEndDirs(name, stackPatch.stackProfile);
    stackPatch.stackProfile = alignStackDirsToScaffold(stackPatch.stackProfile);
  }

  if (isSoftware && stackPatch) {
    try {
      await scaffoldProjectWorkspace({
        generatePath,
        projectName: name,
        briefGoal: input.brief.goal,
        stack: stackPatch.stackProfile,
      });
    } catch (e) {
      throw new Error(`创建工作区目录失败：${toUserError(e)}`);
    }
  } else if (!isSoftware) {
    try {
      await scaffoldDeliveryWorkspace({
        generatePath,
        projectName: name,
        briefGoal: input.brief.goal,
      });
    } catch (e) {
      throw new Error(`创建工作区目录失败：${toUserError(e)}`);
    }
  }

  const gitRemoteUrl = (input.gitRemoteUrl || "").trim();
  const gitDefaultBranch = (input.gitDefaultBranch || "main").trim() || "main";
  const gitPatch =
    gitRemoteUrl || input.gitDefaultBranch
      ? {
          remoteUrl: gitRemoteUrl || undefined,
          defaultBranch: gitDefaultBranch,
          pushRemote: "origin" as const,
        }
      : undefined;

  const deliveryIndustry = (input.industryId || "consulting") as IndustryId;
  const deliveryType = industryToProjectType(deliveryIndustry);
  const deliveryFields =
    !isSoftware
      ? ({
          type: deliveryType,
          categoryId: deliveryType === "software" ? ("cat_product" as const) : ("cat_delivery" as const),
          industryId: deliveryIndustry,
        } as const)
      : {};

  try {
    if (project?.id) {
      project = await upsertProject({
        ...project,
        name,
        generatePath,
        employeeIds: [...(project.employeeIds || [])],
        ...deliveryFields,
        toolPolicy:
          project.toolPolicy && "readFiles" in project.toolPolicy
            ? {
                ...resolvedToolPolicy,
                writeFiles:
                  resolvedToolPolicy.writeFiles || input.mode === "save_and_kickoff",
              }
            : resolvedToolPolicy,
        ...(gitPatch ? { git: { ...project.git, ...gitPatch } } : {}),
        ...(input.kickoffMode ? { kickoffMode: input.kickoffMode } : {}),
        ...(stackPatch
          ? {
              type: "software" as const,
              industryId: project.industryId || "software",
              toolchain: {
                ide: input.toolchainIde || project.toolchain?.ide || "cursor",
                codeEditorSurface:
                  input.codeEditorSurface ||
                  project.toolchain?.codeEditorSurface ||
                  "builtin",
                languages: stackPatch.languages,
                packageManager:
                  stackPatch.packageManager || project.toolchain?.packageManager || "pnpm",
                repoStyle: project.toolchain?.repoStyle || "app",
              },
              stackProfile: stackPatch.stackProfile,
            }
          : {}),
      });
    } else if (isSoftware) {
      if (!stackPatch) {
        throw new Error("软件项目请至少选择一种语言或框架");
      }
      project = await upsertProject({
        name,
        categoryId: "cat_product",
        industryId: "software",
        type: "software",
        employeeIds: [],
        employeeNotes: {},
        docPath: "",
        generatePath,
        kickoffMode: input.kickoffMode || "phased",
        toolPolicy: resolvedToolPolicy,
        toolchain: {
          ide: input.toolchainIde || "cursor",
          codeEditorSurface: input.codeEditorSurface || "builtin",
          languages: stackPatch.languages,
          packageManager: stackPatch.packageManager,
          repoStyle: "app",
        },
        stackProfile: stackPatch.stackProfile,
        git: gitPatch || null,
      });
    } else {
      project = await upsertProject({
        name,
        categoryId: deliveryType === "internal" ? "cat_ops" : "cat_delivery",
        industryId: deliveryIndustry,
        type: deliveryType,
        employeeIds: [],
        employeeNotes: {},
        docPath: "",
        generatePath,
        kickoffMode: deliveryType === "software" ? "phased" : null,
        toolPolicy: resolvedToolPolicy,
        git: null,
      });
    }
  } catch (e) {
    throw new Error(`保存项目失败：${toUserError(e)}`);
  }

  let brief = await migrateBriefToProject(input.brief, project.id);
  brief = await loadBrief(project.id);
  if (!brief.goal && input.brief.goal) {
    brief = await saveBrief({ ...input.brief, ...brief, projectId: project.id });
  }

  const selected =
    input.roleIds?.map((id) => id.trim()).filter(Boolean) ??
    (brief.matchedRoleIds?.length
      ? brief.matchedRoleIds
      : brief.matchPlan.map((m) => m.roleId).filter(Boolean));

  if (selected.length && brief.matchPlan.length) {
    const allow = new Set(selected);
    brief = await saveBrief({
      ...brief,
      matchedRoleIds: selected,
      matchPlan: brief.matchPlan.filter((m) => allow.has(m.roleId)),
    });
  } else if (selected.length) {
    brief = await saveBrief({
      ...brief,
      matchedRoleIds: selected,
    });
  }

  let hiredCount = 0;
  const roleIds = brief.matchedRoleIds?.length
    ? brief.matchedRoleIds
    : brief.matchPlan.map((m) => m.roleId).filter(Boolean);
  if (roleIds.length) {
    const matched = await ensureEmployeesForRoleIds(roleIds);
    hiredCount = matched.length;
    if (!matched.length) {
      throw new Error(
        `勾选的 ${roleIds.length} 个岗位未能入职（岗位库中找不到对应角色）。请重新确认需求生成派岗表，或到「岗位库」检查。项目已保存为「${project.name}」。`,
      );
    }
    const idSet = new Set(project.employeeIds);
    for (const e of matched) idSet.add(e.id);
    project = await upsertProject({
      ...project,
      employeeIds: [...idSet],
    });
  }

  window.dispatchEvent(new CustomEvent("xu-projects-changed"));
  window.dispatchEvent(new CustomEvent("xu-employees-changed"));
  window.dispatchEvent(
    new CustomEvent("xu-project-start-from-brief", {
      detail: { projectId: project.id, mode: input.mode },
    }),
  );

  if (input.mode === "save_only") {
    return { project, brief, hiredCount, kickedOff: false };
  }

  if (!hiredCount && !roleIds.length) {
    throw new Error(
      `项目「${project.name}」已保存，但没有可派岗员工。请勾选岗位或先确认需求生成派岗表。`,
    );
  }

  const opts = modelOpts || (await loadKickoffModelOptions());
  const stackLine =
    project.toolchain?.languages?.length
      ? `【技术栈】${project.toolchain.languages.join("、")}`
      : "";
  try {
    const kick = await runBriefMatchedKickoff({
      project,
      brief,
      bossText:
        input.bossText ||
        [
          `【全体开工】项目「${project.name}」按派岗表执行：${brief.goal || name}`,
          stackLine,
        ]
          .filter(Boolean)
          .join("\n"),
      forceAll: false,
      skipWaveWait: false,
      pauseForDesignConfirm: isSoftwareBriefWorkMode(brief, project),
      mapEmployee: (emp) => {
        const cx = scoreBriefComplexity({
          briefGapCount: countBriefGaps(brief),
          crossModule: /跨模块|XU_CROSS_MODULE/i.test(
            `${brief.goal || ""}\n${input.bossText || ""}`,
          ),
          briefText: `${brief.goal || ""}\n${(brief.must || []).join("\n")}`,
          codeSurfaceHint: Boolean(project.toolchain?.languages?.length),
        });
        return mapEmployeeForKickoffModels(emp, commandKey, codeKey, opts, {
          level: cx.level,
        });
      },
    });
    return {
      project: kick.project,
      brief: await loadBrief(project.id),
      hiredCount,
      kickedOff: true,
      dispatched: kick.dispatched,
      awaitingDesignConfirm: kick.awaitingDesignConfirm,
    };
  } catch (e) {
    throw new Error(
      `项目「${project.name}」已保存（入职 ${hiredCount} 人），但开工派活失败：${toUserError(e)}`,
    );
  }
}
