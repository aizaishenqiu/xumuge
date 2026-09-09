import type { Employee } from "./employees";
import { loadOfficeLayout, saveOfficeLayout } from "./officeLayout";
import { allocateWorkLocal } from "./projectStaffing";
import {
  loadProjectTheme,
  saveProjectTheme,
  type ProjectTheme,
} from "./projectTheme";
import {
  PROJECT_TYPE_LABEL,
  resolveProjectEmployees,
  type XuProject,
} from "./projects";

/** 绑定办公室到指定项目并同步 ProjectTheme（不重建三开间布局）。 */
export async function switchOfficeProject(
  project: XuProject,
  employees: Employee[],
): Promise<ProjectTheme> {
  const layout = await loadOfficeLayout();
  await saveOfficeLayout({
    ...layout,
    meta: { ...layout.meta, projectId: project.id },
  });

  const existing = await loadProjectTheme();
  if (existing?.id === project.id) {
    window.dispatchEvent(new CustomEvent("xu-project-changed", { detail: existing }));
    return existing;
  }

  const emps = resolveProjectEmployees(project, employees);
  const headcount = emps.length;
  const assignments = allocateWorkLocal(
    {
      name: project.name,
      goal: `${project.name} · ${PROJECT_TYPE_LABEL[project.type]}`,
      brief: project.generatePath || project.docPath || "",
      phase: "build",
    },
    employees,
    project.employeeIds,
  );

  const theme: ProjectTheme = {
    id: project.id,
    name: project.name,
    goal:
      headcount > 0
        ? `${project.name} · 三开间 · ${headcount} 人已入座`
        : `${project.name} · ${PROJECT_TYPE_LABEL[project.type]}`,
    brief: `文档：${project.docPath || "—"}；生成：${project.generatePath || "—"}`,
    phase: "build",
    priority: "P1",
    progress: project.deliveryProgress?.overallPercent ?? 0,
    assignments,
    createdAt: project.createdAt,
    updatedAt: Date.now(),
    staffingSource: "local",
    runtimeStatus: existing?.runtimeStatus ?? "idle",
    lastStartedAt: existing?.lastStartedAt ?? null,
  };

  await saveProjectTheme(theme);
  return theme;
}
