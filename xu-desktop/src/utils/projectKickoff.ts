/** Generate office layout + run project kickoff after create/save. */

import type { Router } from "vue-router";
import { onApiCatch } from "./userFacingError";
import { fouConfirmPromise, fouMsg } from "foucui";
import { buildThreeBayOfficeLayout } from "../office/threeBayLayout";
import { countLayoutSeats, isDeskKind, seatIndicesOnProp } from "../office/catalog";
import { findSeatForDeskIndex } from "../office/seatPlacement";
import { readCompanyName } from "./brandSettings";
import { loadEmployees, readEmployees, saveEmployeesBatch, type Employee } from "./employees";
import { saveOfficeLayout } from "./officeLayout";
import { writeDeskCount } from "./officeSettings";
import {
  PROJECT_TYPE_LABEL,
  resolveProjectEmployees,
  type XuProject,
} from "./projects";
import { allocateWorkLocal, announceStaffing } from "./projectStaffing";
import { saveProjectTheme, type ProjectTheme } from "./projectTheme";
import {
  allocateSoftwareKickoff,
  formatKickoffBrief,
} from "./softwareKickoff";
import { runBriefMatchedKickoff } from "../intent/briefMatchedKickoff";

export type KickoffOutcome = {
  message: string;
  suggestOffice: boolean;
  /** 敏捷分波：保存后引导去办公室首波 */
  agilePhased?: boolean;
};

/** Build three-bay office, seat project members, persist theme (no navigation). */
export async function generateProjectOffice(
  project: XuProject,
  employees?: Employee[],
): Promise<ProjectTheme> {
  const emps = resolveProjectEmployees(project, employees ?? (await loadEmployees().catch(() => readEmployees())));
  if (emps.length === 0) {
    throw new Error("请先为项目选择至少一名员工（选择角色）");
  }

  const headcount = emps.length;
  writeDeskCount(headcount);
  const layout = buildThreeBayOfficeLayout({
    headcount,
    companyName: readCompanyName(),
    projectId: project.id,
  });
  await saveOfficeLayout(layout);

  const seats: number[] = [];
  for (const p of layout.props) {
    if (!isDeskKind(p.kind)) continue;
    seats.push(...seatIndicesOnProp(p));
  }
  seats.sort((a, b) => a - b);
  const layoutSeatCount = countLayoutSeats(layout.props);
  if (seats.length !== headcount || layoutSeatCount !== headcount) {
    throw new Error(
      `工位数量不对：员工 ${headcount} 人，座位索引 ${seats.length}，布局容量 ${layoutSeatCount}`,
    );
  }

  const all = await loadEmployees().catch(() => readEmployees());
  const byId = new Map(all.map((e) => [e.id, e]));
  const bosses = emps.filter((e) => e.roleKind === "boss");
  const workers = emps.filter((e) => e.roleKind !== "boss");
  const ordered = [...bosses, ...workers];
  if (ordered.length !== headcount) {
    throw new Error("项目员工列表异常");
  }
  const seatedIds = new Set(ordered.map((e) => e.id));

  const batch: Employee[] = [];
  for (const e of all) {
    if (e.deskIndex != null && !seatedIds.has(e.id)) {
      batch.push({ ...e, deskIndex: null });
    }
  }
  for (let i = 0; i < ordered.length; i++) {
    const emp = ordered[i]!;
    const cur = byId.get(emp.id) ?? emp;
    batch.push({ ...cur, deskIndex: seats[i]! });
  }
  await saveEmployeesBatch(batch);
  const liveEmployees = await loadEmployees().catch(() => readEmployees());

  const missingSeat: string[] = [];
  for (const e of ordered) {
    const live = liveEmployees.find((x) => x.id === e.id);
    if (live?.deskIndex == null) {
      missingSeat.push(`${e.name}（未写入 deskIndex）`);
      continue;
    }
    if (!findSeatForDeskIndex(layout, live.deskIndex)) {
      missingSeat.push(`${e.name}（座位 ${live.deskIndex} 在布局中不可解析）`);
    }
  }
  if (missingSeat.length) {
    throw new Error(`入座校验失败：\n${missingSeat.join("\n")}`);
  }

  const assignments = allocateWorkLocal(
    {
      name: project.name,
      goal: `${project.name} · ${PROJECT_TYPE_LABEL[project.type]}`,
      brief: project.generatePath || project.docPath || "",
      phase: "build",
    },
    liveEmployees,
    project.employeeIds,
  );

  const theme: ProjectTheme = {
    id: project.id,
    name: project.name,
    goal: `${project.name} · 三开间 · ${headcount} 人已入座`,
    brief: `文档：${project.docPath || "—"}；生成：${project.generatePath || "—"}`,
    phase: "build",
    priority: "P1",
    progress: project.deliveryProgress?.overallPercent ?? 0,
    assignments,
    createdAt: project.createdAt,
    updatedAt: Date.now(),
    staffingSource: "local",
    runtimeStatus: "running",
    lastStartedAt: Date.now(),
  };
  await saveProjectTheme(theme);
  await announceStaffing(theme, liveEmployees, { dispatchTasks: false });
  return theme;
}

/** Full kickoff: office + dispatch/workflow; marks project as running. */
export async function runProjectKickoff(project: XuProject): Promise<KickoffOutcome> {
  if (project.type === "software" && !project.toolchain?.ide) {
    throw new Error("软件项目请先选择写码工具（Cursor / VS Code 等）");
  }
  if (project.type === "software" && !project.requirements?.playbookPath) {
    throw new Error("软件项目缺少 REQUIREMENTS_PLAYBOOK，请先完成需求步骤");
  }

  const emps = resolveProjectEmployees(project, await loadEmployees().catch(() => readEmployees()));
  if (emps.length === 0) {
    throw new Error("请先为项目选择至少一名员工");
  }

  await generateProjectOffice(project, emps);

  if (project.type === "software") {
    const mode = project.kickoffMode || "phased";
    if (mode === "strict") {
      const { startPlannerWorkflow } = await import("./workflowOrchestrator");
      void startPlannerWorkflow(project).catch((e) => {
        console.warn("[workflow] startPlannerWorkflow", e);
      });
      return {
        message: "已启动瀑布模式（计划→设计→技术方案→开发→Review→UAT），项目运行中。",
        suggestOffice: true,
      };
    }
    const result = await runBriefMatchedKickoff({
      project,
      brief: null,
      bossText: `【项目开工】${project.name}：请按波次在生成路径落盘交付物。`,
      quiet: false,
    });
    return {
      message: `已自动分波开工（${result.dispatched} 人派活）。请到办公室查看进度。`,
      suggestOffice: true,
      agilePhased: result.awaitingDesignConfirm,
    };
  }

  const assignments = allocateSoftwareKickoff(project, emps);
  const theme: ProjectTheme = {
    id: project.id,
    name: project.name,
    goal: `${project.name} · 老板下达开工`,
    brief: formatKickoffBrief(project),
    phase: "build",
    priority: "P0",
    progress: project.deliveryProgress?.overallPercent ?? 0,
    assignments,
    createdAt: project.createdAt,
    updatedAt: Date.now(),
    staffingSource: "local",
    runtimeStatus: "running",
    lastStartedAt: Date.now(),
  };
  await saveProjectTheme(theme);
  await announceStaffing(theme, emps, { dispatchTasks: true });
  return {
    message: "已下达开工并通知团队，项目运行中。",
    suggestOffice: true,
  };
}

/** After new project save: ask to run kickoff, optional navigate to office. */
export async function promptRunProjectAfterSave(
  project: XuProject,
  router: Router,
): Promise<void> {
  const action = await fouConfirmPromise(
    `项目「${project.name}」已保存。是否马上运行并启动团队？（将生成办公室并入座）`,
    "运行项目",
    { confirmButtonText: "马上运行", cancelButtonText: "稍后再说" },
  );
  if (action !== "confirm") {
    fouMsg.success("项目已保存，可在首页或项目页启动");
    return;
  }
  try {
    const outcome = await runProjectKickoff(project);
    fouMsg.success(outcome.message);
    if (outcome.suggestOffice) {
      const go = await fouConfirmPromise("是否前往办公室查看？", "前往办公室", {
        confirmButtonText: "去办公室",
        cancelButtonText: "留在当前页",
      });
      if (go === "confirm") {
        await router.push("/office");
      }
    }
  } catch (e) {
    void onApiCatch(e);
  }
}
