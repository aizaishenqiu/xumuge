/** Current project theme + assignment progress (office collaboration strip). */

import type { XuProject } from "./projects";

export type ProjectPhase = "discovery" | "build" | "polish" | "hotfix";

/** 项目在聊天界面里是否实际在跑（start/stop 对应真实状态）。 */
export type ProjectRuntimeStatus = "idle" | "running" | "paused" | "error";

export interface ProjectAssignment {
  employeeId: string;
  employeeName: string;
  role: string;
  duty: string;
  checklist: string[];
  /** 0–100 */
  progress: number;
  status: "pending" | "working" | "done" | "error";
}

export interface ProjectTheme {
  id: string;
  name: string;
  goal: string;
  brief: string;
  phase: ProjectPhase;
  priority: "P0" | "P1" | "P2";
  /** Overall 0–100 */
  progress: number;
  assignments: ProjectAssignment[];
  createdAt: number;
  updatedAt: number;
  /** local = template split; remote = Hermes meta-split queued */
  staffingSource: "local" | "hybrid";
  /** 实际运行状态：聊天界面的「启动/停止」据此切换并持久化 */
  runtimeStatus: ProjectRuntimeStatus;
  /** 最近一次启动时间戳 */
  lastStartedAt?: number | null;
}

const LS_KEY = "xu.projectTheme";

export function emptyProject(): ProjectTheme | null {
  return null;
}

export function readProjectThemeLocal(): ProjectTheme | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as ProjectTheme;
    if (!p?.name) return null;
    return p;
  } catch {
    return null;
  }
}

export function writeProjectThemeLocal(project: ProjectTheme | null) {
  try {
    if (!project) localStorage.removeItem(LS_KEY);
    else localStorage.setItem(LS_KEY, JSON.stringify(project));
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new CustomEvent("xu-project-changed", { detail: project }));
}

export async function clearProjectTheme(): Promise<void> {
  writeProjectThemeLocal(null);
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("xu_clear_project_theme");
  } catch (e) {
    console.warn("clearProjectTheme remote", e);
  }
}

/** Drop theme when project id missing from list (or list empty). */
export async function reconcileProjectTheme(
  projects: XuProject[],
  themeIn?: ProjectTheme | null,
): Promise<ProjectTheme | null> {
  const theme = themeIn ?? readProjectThemeLocal();
  if (!theme?.id) {
    if (theme) await clearProjectTheme();
    return null;
  }
  if (!projects.length || !projects.some((p) => p.id === theme.id)) {
    await clearProjectTheme();
    return null;
  }
  return theme;
}

export async function loadProjectTheme(): Promise<ProjectTheme | null> {
  let remote: ProjectTheme | null = null;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const raw = await invoke<string | null>("xu_get_project_theme");
    if (raw) {
      const p = JSON.parse(raw) as ProjectTheme;
      if (p?.name) {
        writeProjectThemeLocal(p);
        remote = p;
      }
    }
  } catch {
    /* fallback local */
  }
  const theme = remote ?? readProjectThemeLocal();
  if (!theme) return null;
  try {
    const { loadProjects } = await import("./projects");
    const projects = await loadProjects();
    return reconcileProjectTheme(projects, theme);
  } catch {
    return theme;
  }
}

export async function saveProjectTheme(project: ProjectTheme): Promise<void> {
  project.updatedAt = Date.now();
  writeProjectThemeLocal(project);
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("xu_set_project_theme", { themeJson: JSON.stringify(project) });
  } catch (e) {
    console.warn("saveProjectTheme remote", e);
  }
}

export function recomputeOverallProgress(project: ProjectTheme): number {
  if (!project.assignments.length) return project.progress || 0;
  const sum = project.assignments.reduce((a, x) => a + (x.progress || 0), 0);
  return Math.round(sum / project.assignments.length);
}

export function countRunningProjects(
  projects: XuProject[],
  theme: ProjectTheme | null,
): number {
  if (!theme || theme.runtimeStatus !== "running") return 0;
  return projects.some((p) => p.id === theme.id) ? 1 : 0;
}
