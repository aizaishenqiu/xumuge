/** Built-in 虚募阁 IDE vs external CLI (Cursor / VS Code). */

import type { IdeKind } from "./ideCli";
import { cliForIde, IDE_OPTIONS } from "./ideCli";
import type { XuProject } from "./projects";

export type CodeEditorSurface = "builtin" | "external" | "inherit";

export interface CodingSurfacePrefs {
  /** Global default when employee/project inherit */
  defaultSurface: "builtin" | "external";
  externalIde: IdeKind;
}

const STORAGE_KEY = "xu.coding.surface";

function normalizePrefs(raw: unknown): CodingSurfacePrefs {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const defaultSurface = o.defaultSurface === "external" ? "external" : "builtin";
  const ide = String(o.externalIde ?? "cursor");
  const externalIde = IDE_OPTIONS.some((x) => x.id === ide) ? (ide as IdeKind) : "cursor";
  return { defaultSurface, externalIde };
}

export function readCodingSurfacePrefs(): CodingSurfacePrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return normalizePrefs(JSON.parse(raw));
  } catch {
    /* ignore */
  }
  return { defaultSurface: "builtin", externalIde: "cursor" };
}

export function writeCodingSurfacePrefs(prefs: CodingSurfacePrefs) {
  const next = normalizePrefs(prefs);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  void syncCodingSurfaceToRust(next);
  if (next.defaultSurface === "external") {
    void import("./ideCli").then(({ writeIdeCliOverride }) => {
      writeIdeCliOverride(cliForIde(next.externalIde));
    });
  }
}

export function syncCodingSurfaceToRust(prefs = readCodingSurfacePrefs()) {
  const surface = prefs.defaultSurface;
  void import("@tauri-apps/api/core")
    .then(({ invoke }) => invoke("xu_set_coding_surface", { surface }))
    .catch(() => {
      /* ignore when not in Tauri */
    });
}

export function resolveProjectCodeEditorSurface(
  project?: XuProject | null,
): "builtin" | "external" | null {
  const projSurf = project?.toolchain?.codeEditorSurface;
  if (projSurf === "builtin" || projSurf === "external") return projSurf;
  return null;
}

/** Software projects must pick builtin vs local IDE before kickoff / dev dispatch. */
export function softwareCodingSurfaceChosen(project: XuProject): boolean {
  if (project.type !== "software" && project.industryId !== "software") return true;
  return resolveProjectCodeEditorSurface(project) !== null;
}

export function assertCodingSurfaceChosen(project: XuProject): void {
  if (softwareCodingSurfaceChosen(project)) {
    if (resolveProjectCodeEditorSurface(project) === "external" && !project.toolchain?.ide) {
      throw new Error("已选本机 IDE，请指定 Cursor / VS Code / Trae / Qoder / JetBrains / Windsurf / Zed 或「其他」。");
    }
    return;
  }
  throw new Error("请先在项目详情或开工确认中选择写码表面（内置虚募阁 IDE 或本机已安装的 IDE）。");
}

const openedIdeForProject = new Set<string>();

/** Open the chosen local IDE once per project when a dev wave starts. */
export async function maybeOpenExternalIdeForDev(project: XuProject): Promise<void> {
  if (resolveProjectCodeEditorSurface(project) !== "external") return;
  const root = (project.generatePath || "").trim();
  if (!root) return;
  if (openedIdeForProject.has(project.id)) return;
  openedIdeForProject.add(project.id);
  try {
    const { openWorkspaceInExternalIde } = await import("./ideProbe");
    await openWorkspaceInExternalIde(root, project.toolchain?.ide);
  } catch (e) {
    console.warn("[xu] open external IDE", e);
  }
}

export function resolveCodeEditorSurface(
  emp: { codeEditorSurface?: CodeEditorSurface },
  project?: XuProject | null,
): "builtin" | "external" {
  if (emp.codeEditorSurface === "builtin" || emp.codeEditorSurface === "external") {
    return emp.codeEditorSurface;
  }
  const projSurf = project?.toolchain?.codeEditorSurface;
  if (projSurf === "builtin" || projSurf === "external") return projSurf;
  const prefs = readCodingSurfacePrefs();
  return prefs.defaultSurface;
}

export function buildCodingSurfaceDispatchHint(surface: "builtin" | "external"): string {
  if (surface === "builtin") {
    return "【写码方式】内置 虚募阁 IDE：改码用 write_file / patch_file；系统会在应用内编辑器自动打开文件，勿调用 ide_open 打开外部 IDE。";
  }
  return "【写码方式】本机 IDE：需要查看或定位代码时调用 ide_open（Cursor / VS Code CLI）。";
}

export function ideOpenPolicyLine(surface: "builtin" | "external"): string {
  if (surface === "builtin") {
    return "6. 改码请用 write_file / patch_file；查看代码时系统会在应用内编辑器自动打开，勿调用 ide_open 打开外部 IDE。";
  }
  return "6. 需要在本机 IDE 打开文件时，调用 ide_open；勿空口声称已在 IDE 保存。";
}
