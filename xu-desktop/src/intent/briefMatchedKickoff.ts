/**
 * Shared Brief-matched team kickoff (Chat + Office).
 * Hire matched roles, bind workspace, phased/all-at-once dispatch.
 */
import { invoke } from "@tauri-apps/api/core";
import { appendFouMessage, dispatchEmployeeTask, type Employee } from "../employee";
import { resolveLegacyAgencyRoleId } from "../office/agencyRoleIdMap";
import { ensureEmployeesForRoleIds, saveEmployeesBatch } from "../utils/employees";
import {
  ensureProjectScaffold,
  kickoffPlanningSteps,
} from "../utils/projectDispatchHints";
import { bumpAssignmentProgress } from "../utils/projectStaffing";
import { loadProjectTheme, saveProjectTheme, type ProjectTheme } from "../utils/projectTheme";
import { upsertProject, type XuProject } from "../utils/projects";
import { readKickoffParallel } from "../utils/concurrencySlots";
import { isTeamResetKickoffTask, notifyResetReplanComplete } from "../utils/teamReset";
import { startPlannerWorkflow, syncSoftwareWorkflowState } from "../utils/workflowOrchestrator";
import {
  buildWaveAssignmentSummary,
  buildWaveTask,
  designWaveNeedsConfirmGate,
  groupEmployeesByWave,
  hasDevArtifacts,
  isStrictKickoff,
  kickoffWaveOrder,
  qaWaveNeedsDevGate,
  shouldUsePhasedKickoff,
  waitForEmployeesDone,
  waveLabel,
  type KickoffWave,
} from "../utils/kickoffOrchestrator";
import type { RequirementBrief } from "./briefTypes";
import { formatArchitectureConstraintLine } from "./briefTypes";
import { loadBrief, markBriefExecuting } from "./briefStore";
import {
  ensureDesignScaffold,
  XU_DESIGN_CONFIRM_NEEDED,
  hasDesignArtifacts,
} from "./designArtifacts";
import { loadProjects } from "../utils/projects";
import { readCodeReviewGate } from "../utils/codeReviewGate";
import { toUserError } from "../utils/userFacingError";

const OFFICE_SESSION = "office-floor";

export type BriefMatchedKickoffResult = {
  dispatched: number;
  skipped: number;
  notes: string[];
  project: XuProject;
  /** Software: stopped after design; waiting for user confirm before code. */
  awaitingDesignConfirm?: boolean;
};

export type BriefMatchedKickoffOpts = {
  project: XuProject;
  brief: RequirementBrief | null;
  bossText: string;
  forceAll?: boolean;
  /** Override employee model (office unified kickoff model). */
  mapEmployee?: (emp: Employee) => Employee;
  sessionTag?: string;
  quiet?: boolean;
  /**
   * When true, do not wait for planning/dev waves to finish (dialog / fire-and-forget).
   * Waves still dispatch; subsequent waves may run without prior wave completion.
   */
  skipWaveWait?: boolean;
  /** Only dispatch these waves (e.g. resume after design confirm). */
  wavesOnly?: KickoffWave[];
  /** Default true for software: pause after design until user confirms. */
  pauseForDesignConfirm?: boolean;
};

async function systemMsg(sessionTag: string, content: string, quiet?: boolean) {
  if (quiet) return;
  try {
    await appendFouMessage({ sessionTag, role: "system", content });
  } catch {
    /* ignore */
  }
}

export async function runBriefMatchedKickoff(
  opts: BriefMatchedKickoffOpts,
): Promise<BriefMatchedKickoffResult> {
  const sessionTag = opts.sessionTag || OFFICE_SESSION;
  const bossText =
    (opts.bossText || "").trim() ||
    "【全体开工】请按各自职责立刻在生成路径落盘可交付内容，禁止只回复计划。";
  const forceAll = opts.forceAll === true;
  const notes: string[] = [];
  let project = opts.project;
  let brief = opts.brief;
  const genPath = (project.generatePath || "").trim();
  if (!genPath) {
    throw new Error("当前项目未设置「生成路径」，无法开工。");
  }
  const industry = project.type || "software";
  const { resolveIndustryWorkflow } = await import("../office/industryWorkflows");
  await resolveIndustryWorkflow(industry);

  let targets: Employee[] = [];
  if (!forceAll && brief?.matchedRoleIds?.length) {
    const matched = await ensureEmployeesForRoleIds(brief.matchedRoleIds);
    targets = matched.filter((e) => e.roleKind !== "boss");
    const idSet = new Set(project.employeeIds);
    let changed = false;
    for (const e of matched) {
      if (!idSet.has(e.id)) {
        idSet.add(e.id);
        changed = true;
      }
    }
    if (changed) {
      project = await upsertProject({
        ...project,
        employeeIds: [...idSet],
      });
      window.dispatchEvent(new CustomEvent("xu-employees-changed"));
      window.dispatchEvent(new CustomEvent("xu-projects-changed"));
    }
  } else {
    const { resolveProjectEmployees } = await import("../utils/projects");
    const { loadEmployees, readEmployees } = await import("../utils/employees");
    targets = resolveProjectEmployees(
      project,
      await loadEmployees().catch(() => readEmployees()),
    ).filter((e) => e.roleKind !== "boss");
  }

  if (!targets.length) {
    throw new Error("花名册为空或匹配岗位无人，无法开工。");
  }

  let theme: ProjectTheme | null = null;
  try {
    theme = await loadProjectTheme();
    if (theme && theme.id !== project.id) theme = null;
  } catch {
    theme = null;
  }

  const ordered: Employee[] = (() => {
    const byId = new Map(targets.map((e) => [e.id, e]));
    const seen = new Set<string>();
    const out: Employee[] = [];
    const pushId = (id: string) => {
      if (seen.has(id)) return;
      const e = byId.get(id);
      if (!e) return;
      seen.add(id);
      out.push(e);
    };
    for (const id of project.employeeIds) pushId(id);
    for (const a of theme?.assignments ?? []) pushId(a.employeeId);
    for (const e of targets) pushId(e.id);

    if (!forceAll && brief?.matchedRoleIds?.length) {
      const allow = new Set(
        brief.matchedRoleIds.map((id) => resolveLegacyAgencyRoleId(id)).filter(Boolean),
      );
      const filtered = out.filter((e) => {
        const rid = resolveLegacyAgencyRoleId(e.agentRoleId || "");
        return rid && allow.has(rid);
      });
      if (filtered.length) return filtered;
    }
    return out;
  })();

  try {
    await invoke("xu_reset_busy_employees");
    window.dispatchEvent(new CustomEvent("xu-employees-changed"));
  } catch {
    /* ignore */
  }

  const rootBindBatch: Employee[] = [];
  for (const emp of ordered) {
    if (!(emp.workspaceRoot || "").trim() && genPath) {
      rootBindBatch.push({ ...emp, workspaceRoot: genPath, status: "idle" });
    }
  }
  if (rootBindBatch.length) {
    try {
      await saveEmployeesBatch(rootBindBatch);
    } catch {
      /* ignore */
    }
  }

  let playbookPath = project.requirements?.playbookPath?.trim() || "";
  try {
    playbookPath = await ensureProjectScaffold(project);
  } catch (e) {
    console.warn("[xu] ensureProjectScaffold", e);
  }

  if (industry === "software") {
    try {
      const b = brief || (await loadBrief(project.id));
      brief = await ensureDesignScaffold(project, b);
    } catch (e) {
      console.warn("[xu] ensureDesignScaffold", e);
    }
  }

  const yieldUi = () => new Promise<void>((r) => window.setTimeout(r, 16));
  const DISPATCH_CHUNK = readKickoffParallel();
  const usePhased = shouldUsePhasedKickoff(project);
  const mapEmp = opts.mapEmployee || ((e: Employee) => e);
  const pauseDesign =
    opts.pauseForDesignConfirm !== false &&
    brief?.workMode !== "delivery" &&
    brief?.workMode !== "operation" &&
    designWaveNeedsConfirmGate(project) &&
    !opts.wavesOnly?.length;

  if (isStrictKickoff(project) && !opts.wavesOnly?.length) {
    try {
      await startPlannerWorkflow(project);
      await systemMsg(
        sessionTag,
        "📐 瀑布模式：已派规划师出计划。Boss 确认计划 → 设计 → 技术方案后再写码。",
        opts.quiet,
      );
      await markBriefExecuting(project.id).catch(() => null);
      return { dispatched: 1, skipped: 0, notes: ["strict workflow started"], project };
    } catch (e) {
      throw new Error(`瀑布模式启动失败：${toUserError(e)}`);
    }
  }

  const grouped = usePhased ? groupEmployeesByWave(ordered, industry) : null;
  if (usePhased && grouped) {
    await systemMsg(sessionTag, await buildWaveAssignmentSummary(ordered, industry), opts.quiet);
  }

  const workingBatch: Employee[] = [];
  let dispatched = 0;
  let skipped = 0;
  let awaitingDesignConfirm = false;
  const projectId = project.id;

  async function dispatchOne(
    emp: Employee,
    wave: KickoffWave = "other",
    qaReady = false,
  ): Promise<void> {
    let root = (emp.workspaceRoot || "").trim() || genPath;
    if (!(emp.workspaceRoot || "").trim() && genPath) root = genPath;
    const duty = theme?.assignments?.find((a) => a.employeeId === emp.id)?.duty;
    const planRow = brief?.matchPlan?.find(
      (m) => resolveLegacyAgencyRoleId(m.roleId) === resolveLegacyAgencyRoleId(emp.agentRoleId || ""),
    );
    const task =
      usePhased && project
        ? await buildWaveTask(wave, {
            bossText,
            playbookPath,
            project,
            emp,
            duty: duty || planRow?.task,
            root,
            qaReady,
          })
        : [
            "【Boss 开工指令 · 先规划再落盘】",
            project.type === "software" && brief
              ? formatArchitectureConstraintLine(brief)
              : "",
            bossText.slice(0, 1800),
            planRow?.task
              ? `【派岗任务】${planRow.task}`
              : duty
                ? `【你的职责】${duty}`
                : `【你的角色】${emp.role}——按岗位产出可交付内容`,
            planRow?.acceptance?.length
              ? `【验收】${planRow.acceptance.join("；")}`
              : "",
            `【可写目录】${root}`,
            project.docPath ? `【只读参考文档】${project.docPath}` : "",
            kickoffPlanningSteps(playbookPath),
            "实现阶段：文本用 write_file；Word 用 office_write_docx；Excel 用 office_write_xlsx。文件必须落在岗位建议子目录内，禁止根目录散落。",
          ]
            .filter(Boolean)
            .join("\n");

    if (wave === "dev" && project.type === "software") {
      const { ensureFeatureGitBranch } = await import("../utils/gitBranchPolicy");
      await ensureFeatureGitBranch(root, emp.id);
    }
    try {
      const result = await dispatchEmployeeTask(mapEmp({ ...emp, workspaceRoot: root }), {
        task,
        projectId,
        directImplement: false,
        workspaceRoot: root,
      });
      if (result.queuedOnly) {
        notes.push(`${emp.name}：未真正执行（${result.message}）`);
        skipped += 1;
        return;
      }
      workingBatch.push({ ...emp, workspaceRoot: root, status: "working" });
      dispatched += 1;
      notes.push(
        result.waitingForSlot
          ? `${emp.name}：等待本机槽`
          : `${emp.name}：已排队派活`,
      );
    } catch (e) {
      skipped += 1;
      notes.push(`${emp.name}：派活失败 — ${toUserError(e)}`);
    }
  }

  async function dispatchChunk(emps: Employee[], wave: KickoffWave, qaReady: boolean) {
    for (let i = 0; i < emps.length; i += DISPATCH_CHUNK) {
      const chunk = emps.slice(i, i + DISPATCH_CHUNK);
      await Promise.all(chunk.map((emp) => dispatchOne(emp, wave, qaReady)));
      await yieldUi();
    }
  }

  if (usePhased && grouped) {
    if (industry === "software") {
      await syncSoftwareWorkflowState(projectId, "planning");
    }
    const waveOrder = opts.wavesOnly?.length
      ? opts.wavesOnly
      : kickoffWaveOrder(industry);
    for (const wave of waveOrder) {
      const batch = grouped[wave] || [];
      let qaReady = false;
      if (wave === "qa" && qaWaveNeedsDevGate(project)) {
        qaReady = await hasDevArtifacts(project);
        if (!qaReady) {
          notes.push(`测试波次跳过（尚无源码）：${batch.map((e) => e.name).join("、") || "—"}`);
          await systemMsg(
            sessionTag,
            `⏸ ${waveLabel(wave, industry)}待命 — 开发源码未就绪，暂不派测试报告任务。`,
            opts.quiet,
          );
          continue;
        }
      }

      if (wave === "security" && industry === "software") {
        qaReady = await hasDevArtifacts(project);
        if (!qaReady) {
          notes.push(`安全波次跳过（尚无源码）：${batch.map((e) => e.name).join("、") || "—"}`);
          await systemMsg(
            sessionTag,
            `⏸ ${waveLabel(wave, industry)}待命 — 开发源码未就绪，暂不派安全审查。`,
            opts.quiet,
          );
          continue;
        }
        const { ensureSecurityChecklistDraft } = await import("../utils/securityGate");
        await ensureSecurityChecklistDraft(project);
        if (!batch.length) {
          notes.push("安全波次：无安全岗，已创建清单草稿");
          await systemMsg(
            sessionTag,
            "▶ 安全审查：花名册无安全岗，已创建 `.xu/security/RELEASE_CHECKLIST.md` 草稿，请 QA/架构师兼审并勾选。",
            opts.quiet,
          );
          continue;
        }
      }

      if (wave === "dev" && designWaveNeedsConfirmGate(project)) {
        const { canDispatchDevAfterDesign } = await import("./designArtifacts");
        const ok = await canDispatchDevAfterDesign(project);
        if (!ok) {
          notes.push("开发波次跳过：设计未确认或未冻结");
          if (industry === "software") await syncSoftwareWorkflowState(projectId, "design_review");
          await systemMsg(
            sessionTag,
            "⏸ 开发待命：请先确认设计（并冻结）。若已解冻，请重新确认设计后再写码。",
            opts.quiet,
          );
          continue;
        }
      }

      if (wave === "design" && designWaveNeedsConfirmGate(project)) {
        if (batch.length) {
          await systemMsg(
            sessionTag,
            `▶ ${waveLabel(wave, industry)}波次开工（${batch.length} 人）…`,
            opts.quiet,
          );
          await dispatchChunk(batch, wave, false);
          if (!opts.skipWaveWait) {
            const { timedOut } = await waitForEmployeesDone(
              batch.map((e) => e.id),
              15 * 60 * 1000,
            );
            if (timedOut) notes.push("设计波次：部分员工超时");
          }
        } else {
          notes.push("无设计岗员工：使用占位线框，请用户确认");
          try {
            const b = brief || (await loadBrief(project.id));
            brief = await ensureDesignScaffold(project, b);
          } catch (e) {
            console.warn("[xu] ensureDesignScaffold (no design staff)", e);
          }
          await systemMsg(
            sessionTag,
            "▶ 设计波次：花名册无设计岗，已准备占位线框供你确认。",
            opts.quiet,
          );
        }

        const designed = await hasDesignArtifacts(project);
        if (!designed && pauseDesign) {
          awaitingDesignConfirm = true;
          window.dispatchEvent(
            new CustomEvent(XU_DESIGN_CONFIRM_NEEDED, {
              detail: { projectId: project.id },
            }),
          );
          await systemMsg(
            sessionTag,
            "🎨 请确认各页设计线框（弹窗或办公室「确认设计」）。确认后才会开始写代码。",
            opts.quiet,
          );
          notes.push("awaiting_design_confirm");
          if (industry === "software") await syncSoftwareWorkflowState(projectId, "design_review");
          break;
        }
        continue;
      }

      if (wave === "dev" && industry === "software") {
        const { isTechDesignConfirmed } = await import("../utils/techDesignGate");
        if (!(await isTechDesignConfirmed(project))) {
          notes.push("开发波次跳过：技术方案未确认");
          await syncSoftwareWorkflowState(projectId, "tech_review");
          await systemMsg(
            sessionTag,
            "⏸ 开发待命：请先确认技术方案（办公室回复「确认技术方案」）。",
            opts.quiet,
          );
          continue;
        }
        await syncSoftwareWorkflowState(projectId, "developing");
        const { maybeOpenExternalIdeForDev } = await import("../utils/codingSurfacePrefs");
        await maybeOpenExternalIdeForDev(project);
      }
      if (wave === "qa" && industry === "software") {
        await syncSoftwareWorkflowState(projectId, "qa");
      }
      if (wave === "ops" && industry === "software") {
        await syncSoftwareWorkflowState(projectId, "acceptance");
      }
      if (wave === "design" && industry === "software") {
        await syncSoftwareWorkflowState(projectId, "design_review");
      }

      if (!batch.length) continue;

      await systemMsg(
        sessionTag,
        `▶ ${waveLabel(wave, industry)}波次开工（${batch.length} 人）…`,
        opts.quiet,
      );
      await dispatchChunk(batch, wave, qaReady);
      if (
        !opts.skipWaveWait &&
        (wave === "planning" || wave === "dev" || wave === "design")
      ) {
        const { timedOut } = await waitForEmployeesDone(
          batch.map((e) => e.id),
          wave === "planning" || wave === "design" ? 20 * 60 * 1000 : 35 * 60 * 1000,
        );
        if (timedOut) {
          notes.push(`${waveLabel(wave, industry)}波次：部分员工超时，继续下一波`);
        }
      }
      if (wave === "planning" && industry === "software") {
        const { readEmployees } = await import("../utils/employees");
        const { surgeIdleAfterPlanning } = await import("../utils/idleSurge");
        await surgeIdleAfterPlanning({
          project,
          roster: readEmployees(),
          excludeIds: batch.map((e) => e.id),
          bossText,
          playbookPath,
          mapEmployee: mapEmp,
          sessionTag,
          quiet: opts.quiet,
        });
      }
      if (wave === "dev" && industry === "software") {
        await syncSoftwareWorkflowState(projectId, "code_review");
        const { readEmployees } = await import("../utils/employees");
        const { surgeIdleReviewers } = await import("../utils/idleSurge");
        const reviewSent = await surgeIdleReviewers({
          project,
          roster: readEmployees(),
          excludeIds: batch.map((e) => e.id),
          mapEmployee: mapEmp,
          sessionTag,
          quiet: opts.quiet,
        });
        if (reviewSent.length) {
          if (!opts.skipWaveWait) {
            const { timedOut } = await waitForEmployeesDone(
              reviewSent.map((e) => e.id),
              20 * 60 * 1000,
            );
            if (timedOut) notes.push("代码 Review：部分员工超时");
          }
        } else {
          notes.push("无审核/测试岗：代码 Review 未执行，有代码问题仍禁止合入 dev");
          await systemMsg(
            sessionTag,
            "⚠ 无审核/测试岗，代码 Review 未执行。有代码问题禁止合入 dev。",
            opts.quiet,
          );
        }
        const gate = await readCodeReviewGate(genPath);
        if (gate.status === "fail") {
          notes.push(`代码 Review 未通过：${gate.summary || gate.issues[0] || "有阻断问题"}`);
          await systemMsg(
            sessionTag,
            `⛔ 代码 Review 未通过，禁止合入 dev：${gate.summary || gate.issues[0] || "请先修好"}`,
            opts.quiet,
          );
        }
      }
      void import("../commerce").then(({ enqueueTrainingSample, warnTrainingSampleSkipped }) =>
        enqueueTrainingSample({
          kind: "kickoff_wave_end",
          industry,
          projectId,
          wave,
          summary: `${waveLabel(wave, industry)} · ${batch.length} 人`,
          meta: { roleIds: batch.map((e) => e.agentRoleId || e.id).slice(0, 20) },
        }).then(warnTrainingSampleSkipped),
      ).catch((e) => console.warn("[xu] training sample", e));
    }
  } else {
    for (let i = 0; i < ordered.length; i += DISPATCH_CHUNK) {
      const chunk = ordered.slice(i, i + DISPATCH_CHUNK);
      await Promise.all(chunk.map((emp) => dispatchOne(emp)));
      await yieldUi();
    }
  }

  if (theme?.assignments?.length && workingBatch.length) {
    let next = theme;
    for (const emp of workingBatch) {
      if (!next.assignments.some((a) => a.employeeId === emp.id)) continue;
      next = bumpAssignmentProgress(
        next,
        emp.id,
        Math.max(next.assignments.find((a) => a.employeeId === emp.id)?.progress ?? 0, 8),
        "working",
      );
    }
    try {
      await saveProjectTheme(next);
      window.dispatchEvent(new CustomEvent("xu-project-changed"));
    } catch {
      /* ignore */
    }
  }

  await systemMsg(
    sessionTag,
    [
      awaitingDesignConfirm
        ? `🎨 设计阶段已受理（${dispatched} 人派活）。请确认线框后再写码。`
        : `✅ 已受理开工 ${dispatched}/${ordered.length} 人（写入：${genPath}）`,
      usePhased
        ? awaitingDesignConfirm
          ? "· 模式：敏捷 · 规划 → 设计 → 技术方案 → 开发 → Review → 测试 → 安全 → UAT"
          : "· 模式：敏捷 Scrum（需求→设计→技术方案→开发→Review→测试→安全审查→UAT→运维）"
        : "",
      workingBatch.length
        ? `· 工作中：${
            workingBatch.length <= 8
              ? workingBatch.map((e) => e.name).join("、")
              : `${workingBatch
                  .slice(0, 8)
                  .map((e) => e.name)
                  .join("、")} 等 ${workingBatch.length} 人`
          }`
        : "· 无人进入工作中（请检查脑槽/工作区）",
      skipped ? `· ${skipped} 人失败/跳过` : "",
      notes.length
        ? `\n明细：\n${notes.slice(0, 8).join("\n")}${notes.length > 8 ? `\n…另有 ${notes.length - 8} 条` : ""}`
        : "",
    ]
      .filter(Boolean)
      .join("\n"),
    opts.quiet,
  );

  if (isTeamResetKickoffTask(bossText) && workingBatch.length > 0) {
    await systemMsg(
      sessionTag,
      "⏳ 清理重整进行中…全员完成后将通知飞书/已配置 IM。",
      opts.quiet,
    );
    const { done, timedOut } = await waitForEmployeesDone(
      workingBatch.map((e) => e.id),
      45 * 60 * 1000,
    );
    try {
      await notifyResetReplanComplete({
        projectName: project.name,
        generatePath: genPath,
        dispatched,
        completed: done.length,
        timedOut,
      });
      await systemMsg(
        sessionTag,
        timedOut
          ? `📨 清理重整：${done.length}/${workingBatch.length} 人已完成，已通知 Boss（部分超时）。`
          : `📨 清理重整已完成（${done.length} 人），已通知飞书/已配置 IM。`,
        opts.quiet,
      );
    } catch (e) {
      await systemMsg(
        sessionTag,
        `⚠️ 清理重整已完成，但 IM 通知失败：${toUserError(e).slice(0, 200)}`,
        opts.quiet,
      );
    }
  }

  try {
    await markBriefExecuting(project.id);
  } catch {
    /* ignore */
  }

  window.dispatchEvent(new CustomEvent("xu-employees-changed"));
  return { dispatched, skipped, notes, project, awaitingDesignConfirm };
}

/** After user confirms designs: dispatch dev → qa → … */
export async function dispatchDevAfterDesign(opts: {
  projectId: string;
  bossText?: string;
  mapEmployee?: (emp: Employee) => Employee;
  sessionTag?: string;
  quiet?: boolean;
  skipWaveWait?: boolean;
}): Promise<BriefMatchedKickoffResult> {
  const projects = await loadProjects();
  const project = projects.find((p) => p.id === opts.projectId);
  if (!project) throw new Error("项目不存在");
  const { assertDevDispatchAllowed } = await import("../utils/releaseGate");
  await assertDevDispatchAllowed(project);
  const brief = await loadBrief(project.id);
  const result = await runBriefMatchedKickoff({
    project,
    brief,
    bossText:
      opts.bossText ||
      `【设计已确认并冻结 · 开始写码】请严格按 .xu/design/approved/ 定稿实现。`,
    forceAll: false,
    mapEmployee: opts.mapEmployee,
    sessionTag: opts.sessionTag,
    quiet: opts.quiet,
    skipWaveWait: opts.skipWaveWait ?? false,
    wavesOnly: ["dev", "qa", "security", "ops", "other"],
    pauseForDesignConfirm: false,
  });
  const { surgeIdleEngineers } = await import("../utils/idleSurge");
  const { readEmployees } = await import("../utils/employees");
  const roster = readEmployees();
  await surgeIdleEngineers({
    project: result.project,
    roster,
    excludeIds: roster.filter((e) => e.status !== "idle").map((e) => e.id),
    mapEmployee: opts.mapEmployee,
    sessionTag: opts.sessionTag,
    quiet: opts.quiet,
  });
  return result;
}
