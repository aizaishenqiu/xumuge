/**
 * @file 开工时创建 docs/UI/code 标准工作区目录树
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-31
 * @updated 2026-09-02
 * @version 1.2.0
 * @category Layout
 * @algo workspace-scaffold-mkdir
 */
import { exists } from "@tauri-apps/plugin-fs";
import type { StackEndKey, StackProfile } from "./projectStack";
import { STACK_ENDS } from "./projectStack";
import { joinFsPath } from "./devWorkspace";
import { mkdirRecursive, writeTextUnderWorkspace } from "./fsBridge";

const CODE_DIR_MAP: Partial<Record<StackEndKey, string>> = {
  frontend: "code/web",
  backend: "code/server",
  app: "code/mobile",
  desktop: "code/desktop",
};

function joinRoot(root: string, rel: string): string {
  // 相对段内部仍用 `/`（跨平台相对路径）；与根拼接时用 joinFsPath
  const cleanRel = rel.replace(/^[/\\]+/, "").replace(/\\/g, "/");
  const parts = cleanRel.split("/").filter(Boolean);
  let out = root.trim();
  for (const part of parts) {
    out = joinFsPath(out, part);
  }
  return out;
}

export function workspaceDirsForStack(stack: StackProfile): string[] {
  const dirs = ["docs", "UI", "code", ".xu"];
  for (const e of STACK_ENDS) {
    if (!stack.enabled?.[e.key]) continue;
    if (e.key === "ui") {
      dirs.push("UI");
      continue;
    }
    const codeRel = CODE_DIR_MAP[e.key];
    if (codeRel) dirs.push(codeRel);
  }
  return [...new Set(dirs)];
}

/** Align stack profile dirs with code/UI scaffold paths. */
export function alignStackDirsToScaffold(stack: StackProfile): StackProfile {
  const next: StackProfile = { ...stack, enabled: { ...stack.enabled } };
  for (const e of STACK_ENDS) {
    if (!next.enabled?.[e.key]) continue;
    const dirKey = `${e.key}Dir` as keyof StackProfile;
    if (e.key === "ui") {
      (next as unknown as Record<string, unknown>)[dirKey as string] = "UI";
    } else {
      const rel = CODE_DIR_MAP[e.key];
      if (rel) (next as unknown as Record<string, unknown>)[dirKey as string] = rel;
    }
  }
  return next;
}

export async function scaffoldProjectWorkspace(opts: {
  generatePath: string;
  projectName: string;
  briefGoal?: string;
  stack: StackProfile;
}): Promise<string[]> {
  const root = opts.generatePath.trim();
  if (!root) throw new Error("生成路径为空");
  const created: string[] = [];
  const dirs = workspaceDirsForStack(opts.stack);

  // 先创建项目根目录（否则 Rust canonicalize 工作区会失败）
  await mkdirRecursive(root, root);

  for (const rel of dirs) {
    const abs = joinRoot(root, rel);
    try {
      const had = await exists(abs);
      await mkdirRecursive(root, abs);
      if (!had) created.push(rel);
    } catch {
      await mkdirRecursive(root, abs);
      created.push(rel);
    }
  }

  const readmePath = "README.md";
  const readmeAbs = joinRoot(root, readmePath);
  if (!(await exists(readmeAbs))) {
    const body = [
      `# ${opts.projectName.trim() || "项目"}`,
      "",
      opts.briefGoal?.trim() ? `## 目标\n\n${opts.briefGoal.trim()}` : "",
      "",
      "## 目录",
      "",
      "- `docs/` — 需求、验收与会议纪要",
      "- `UI/` — 设计稿与线框",
      "- `code/` — 各端工程代码",
      "- `.xu/` — 虚募阁项目元数据与 Skills",
      "",
    ]
      .filter(Boolean)
      .join("\n");
    await writeTextUnderWorkspace(root, readmeAbs, body);
    created.push(readmePath);
  }

  const reqPath = "docs/REQUIREMENTS.md";
  const reqAbs = joinRoot(root, reqPath);
  if (!(await exists(reqAbs))) {
    await writeTextUnderWorkspace(
      root,
      reqAbs,
      `# 需求说明\n\n${opts.briefGoal?.trim() || "（待补充）"}\n`,
    );
    created.push(reqPath);
  }

  const uiReadme = "UI/README.md";
  const uiAbs = joinRoot(root, uiReadme);
  if (!(await exists(uiAbs))) {
    await writeTextUnderWorkspace(
      root,
      uiAbs,
      "# UI 设计资产\n\n放置线框、设计稿与界面说明。\n",
    );
    created.push(uiReadme);
  }

  const xuMarker = ".xu/.gitkeep";
  const xuAbs = joinRoot(root, xuMarker);
  if (!(await exists(xuAbs))) {
    await writeTextUnderWorkspace(root, xuAbs, "");
    created.push(".xu/");
  }

  return created;
}

/** 交付类项目：仅创建根目录与 docs（无 code/UI 软件栈）。 */
export async function scaffoldDeliveryWorkspace(opts: {
  generatePath: string;
  projectName: string;
  briefGoal?: string;
}): Promise<string[]> {
  const root = opts.generatePath.trim();
  if (!root) throw new Error("生成路径为空");
  const created: string[] = [];
  await mkdirRecursive(root, root);
  for (const rel of ["docs", ".xu"]) {
    const abs = joinRoot(root, rel);
    try {
      const had = await exists(abs);
      await mkdirRecursive(root, abs);
      if (!had) created.push(rel);
    } catch {
      await mkdirRecursive(root, abs);
      created.push(rel);
    }
  }
  const readmePath = "README.md";
  const readmeAbs = joinRoot(root, readmePath);
  if (!(await exists(readmeAbs))) {
    const body = [
      `# ${opts.projectName.trim() || "交付项目"}`,
      "",
      opts.briefGoal?.trim() ? `## 目标\n\n${opts.briefGoal.trim()}` : "",
      "",
      "## 目录",
      "",
      "- `docs/` — 交付物、验收与会议纪要",
      "- `.xu/` — 虚募阁项目元数据",
      "",
    ]
      .filter(Boolean)
      .join("\n");
    await writeTextUnderWorkspace(root, readmeAbs, body);
    created.push(readmePath);
  }
  const reqPath = "docs/REQUIREMENTS.md";
  const reqAbs = joinRoot(root, reqPath);
  if (!(await exists(reqAbs))) {
    await writeTextUnderWorkspace(
      root,
      reqAbs,
      `# 交付要求\n\n${opts.briefGoal?.trim() || "（待补充）"}\n`,
    );
    created.push(reqPath);
  }
  return created;
}
