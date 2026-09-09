/** Small-team Git: feature → dev, never commit on main. */

import { invoke } from "@tauri-apps/api/core";

export function isProtectedMainBranch(name: string | null | undefined): boolean {
  const b = (name || "").trim().toLowerCase();
  return b === "main" || b === "master";
}

export function isHotfixBranch(name: string | null | undefined): boolean {
  return (name || "").trim().toLowerCase().startsWith("hotfix/");
}

export function canCommitOnBranch(name: string | null | undefined): boolean {
  if (isHotfixBranch(name)) return true;
  return !isProtectedMainBranch(name);
}

export function featureBranchName(taskId: string): string {
  const slug = (taskId || "slice")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `feature/${slug || "slice"}`;
}

export function mainCommitBlockReason(branch: string | null | undefined): string | null {
  if (canCommitOnBranch(branch)) return null;
  return "main 禁止直接提交或推送，请在 feature/* 开发，Review 通过后合入 dev。";
}

export async function ensureFeatureGitBranch(
  workspace: string,
  taskId: string,
): Promise<string | null> {
  const ws = workspace.trim();
  if (!ws) return null;
  const branch = featureBranchName(taskId);
  try {
    await invoke("git_workspace", { workspace: ws, action: "branch_ensure", branch });
    return branch;
  } catch {
    return null;
  }
}
