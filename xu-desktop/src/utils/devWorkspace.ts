/**
 * @file 解析员工开发工作区与 IDE 焦点目录
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-31
 * @updated 2026-08-31
 * @version 1.2.0
 * @category Layout
 * @algo path-join-os-sep
 */
import type { Employee } from "./employees";
import type { XuProject } from "./projects";
import { STACK_ENDS, type StackProfile } from "./projectStack";
import { readLs } from "./xuStorage";
import { emitFocusIde, emitWorkingDirChanged } from "./crossWindowBus";
import { mkdirRecursive } from "./fsBridge";

const DEV_RE =
  /工程|开发|前端|后端|全栈|工程师|architect|desktop|tauri|flutter|code|api|服务端/i;

export function isDevRole(emp: Employee): boolean {
  const hay = `${emp.role} ${emp.agentRoleId || ""} ${emp.name}`;
  return DEV_RE.test(hay);
}

export function sanitizeDirName(name: string): string {
  // 仅剔除 Windows 非法文件名字符；中文 / 日文等原样保留，用作真实文件夹名
  let s = name
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/[.…]+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "")
    .slice(0, 60)
    .trim();
  return s || "未命名项目";
}

/**
 * 按父路径风格拼接本地目录（Windows 盘符 / 反斜杠 → `\`，否则 `/`）。
 * 避免出现 `E:\test/child` 这类混用分隔符。
 */
export function joinFsPath(dir: string, name: string): string {
  const d = dir.trim();
  const n = name.trim().replace(/^[/\\]+/, "");
  if (!d) return n;
  if (!n) {
    const useWinOnly = /^[a-zA-Z]:/.test(d) || d.includes("\\");
    return useWinOnly ? d.replace(/\//g, "\\").replace(/\\+$/, "") : d.replace(/[/\\]+$/, "");
  }
  const useWin = /^[a-zA-Z]:/.test(d) || d.includes("\\");
  const sep = useWin ? "\\" : "/";
  const base = useWin
    ? d.replace(/\//g, "\\").replace(/\\+$/, "")
    : d.replace(/[/\\]+$/, "");
  return `${base}${sep}${n}`;
}

/** Fill relative end dirs when empty or front/back share the same path. */
export function suggestStackEndDirs(projectName: string, stack: StackProfile): StackProfile {
  const base = sanitizeDirName(projectName);
  const next: StackProfile = { ...stack, enabled: { ...stack.enabled } };
  const feOn = Boolean(stack.enabled?.frontend);
  const beOn = Boolean(stack.enabled?.backend);
  const fe = String(stack.frontendDir || "").trim();
  const be = String(stack.backendDir || "").trim();

  if (feOn && beOn && (!fe || !be || fe === be)) {
    next.frontendDir = `${base}-前端`;
    next.backendDir = `${base}-后端`;
  }

  for (const e of STACK_ENDS) {
    if (!next.enabled?.[e.key]) continue;
    const dirKey = `${e.key}Dir` as keyof StackProfile;
    const cur = String(next[dirKey] || "").trim();
    if (cur) continue;
    const suffix =
      e.key === "frontend"
        ? "前端"
        : e.key === "backend"
          ? "后端"
          : e.key === "ui"
            ? "UI"
            : e.key === "desktop"
              ? "桌面"
              : "App";
    (next as unknown as Record<string, unknown>)[dirKey as string] = `${base}-${suffix}`;
  }
  return next;
}

function pathNorm(p: string): string {
  return p.replace(/\\/g, "/").toLowerCase().replace(/\/+$/, "");
}

function isUnderOrEqual(child: string, root: string): boolean {
  const c = pathNorm(child);
  const r = pathNorm(root);
  if (!c || !r) return false;
  return c === r || c.startsWith(`${r}/`);
}

function isAbsoluteDir(p: string): boolean {
  return /^[a-zA-Z]:[/\\]/.test(p) || p.startsWith("/") || p.startsWith("\\");
}

export function readCurrentIdeDir(): string | null {
  try {
    return readLs("xu.chat.workingDir", "hermes_working_dir")?.trim() || null;
  } catch {
    return null;
  }
}

export function resolveDevWorkspace(
  project: XuProject,
  emp: Employee,
  currentIdeDir?: string | null,
): { workspaceRoot: string; relativeDir?: string } {
  const genPath = (project.generatePath || "").trim();
  if (!genPath) throw new Error("项目未设置生成路径");

  const ideDir = (currentIdeDir ?? readCurrentIdeDir())?.trim() || "";
  let workspaceRoot = genPath;

  if (ideDir && (pathNorm(ideDir) === pathNorm(genPath) || isUnderOrEqual(ideDir, genPath))) {
    workspaceRoot = ideDir;
  }

  const stack = project.stackProfile;
  let relativeDir: string | undefined;
  if (stack) {
    const hay = `${emp.role} ${emp.agentRoleId || ""}`;
    if (/前端|frontend|fe\b|vue|react/i.test(hay) && stack.frontendDir) {
      relativeDir = stack.frontendDir.trim();
    } else if (/后端|backend|api|服务端|server/i.test(hay) && stack.backendDir) {
      relativeDir = stack.backendDir.trim();
    }
  }

  if (relativeDir) {
    const abs = isAbsoluteDir(relativeDir)
      ? relativeDir
      : joinFsPath(genPath, relativeDir);
    if (workspaceRoot === genPath || isUnderOrEqual(abs, workspaceRoot)) {
      workspaceRoot = abs;
    }
  }

  return { workspaceRoot, relativeDir };
}

/** Switch built-in IDE working dir and focus IDE window. */
export function applyDevWorkspaceToIde(workspaceRoot: string): void {
  const root = workspaceRoot.trim();
  if (!root) return;
  emitWorkingDirChanged(root);
  emitFocusIde();
}

export async function ensureStackDirsOnDisk(project: XuProject): Promise<void> {
  const genPath = project.generatePath?.trim();
  const stack = project.stackProfile;
  if (!genPath || !stack) return;
  for (const e of STACK_ENDS) {
    if (!stack.enabled?.[e.key]) continue;
    const dir = String(stack[`${e.key}Dir` as keyof StackProfile] || "").trim();
    if (!dir) continue;
    const abs = isAbsoluteDir(dir)
      ? dir
      : joinFsPath(genPath, dir);
    try {
      await mkdirRecursive(genPath, abs);
    } catch {
      /* may exist */
    }
  }
}

/** Resolve workspace for dev dispatch; optionally sync IDE. */
export async function prepareDevDispatchWorkspace(
  project: XuProject,
  emp: Employee,
  opts?: { syncIde?: boolean },
): Promise<string> {
  if (project.stackProfile) {
    await ensureStackDirsOnDisk(project);
  }
  const { workspaceRoot } = resolveDevWorkspace(project, emp);
  if (opts?.syncIde !== false && isDevRole(emp)) {
    applyDevWorkspaceToIde(workspaceRoot);
  }
  return workspaceRoot;
}
