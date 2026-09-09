/**
 * git init / remote / commit / push for software design-confirmed projects.
 */
import { invoke } from "@tauri-apps/api/core";
import { exists } from "@tauri-apps/plugin-fs";
import type { XuProject } from "./projects";
import { writeTextUnderWorkspace } from "./fsBridge";
import { toUserError } from "./userFacingError";

async function gitWorkspace(
  workspace: string,
  action: string,
  extra?: {
    path?: string;
    message?: string;
    remote?: string;
    branch?: string;
  },
): Promise<string> {
  return invoke<string>("git_workspace", {
    workspace,
    action,
    path: extra?.path ?? null,
    message: extra?.message ?? null,
    maxCount: null,
    remote: extra?.remote ?? null,
    branch: extra?.branch ?? null,
  });
}

const DEFAULT_GITIGNORE = `node_modules/
dist/
target/
.DS_Store
*.log
.env
.env.*
!.env.example
`;

/**
 * After design approve: ensure repo, commit design, set remote, try push.
 * Returns a short status string for UI (never throws for push failure).
 */
export async function bootstrapProjectGitAfterDesign(project: XuProject): Promise<string> {
  const root = (project.generatePath || "").trim();
  if (!root) return "跳过 Git（无生成路径）";

  const remoteUrl = (project.git?.remoteUrl || "").trim();
  const branch = (project.git?.defaultBranch || "main").trim() || "main";
  const remoteName = (project.git?.pushRemote || "origin").trim() || "origin";

  try {
    const gitDir = `${root.replace(/[/\\]+$/, "")}/.git`;
    if (!(await exists(gitDir))) {
      await gitWorkspace(root, "init");
    }
  } catch (e) {
    return `git init 失败：${toUserError(e).slice(0, 120)}`;
  }

  try {
    const gi = `${root.replace(/[/\\]+$/, "")}/.gitignore`;
    if (!(await exists(gi))) {
      await writeTextUnderWorkspace(root, ".gitignore", DEFAULT_GITIGNORE);
    }
  } catch {
    /* ignore */
  }

  try {
    await gitWorkspace(root, "add", { path: ".xu/design" });
    await gitWorkspace(root, "add", { path: ".gitignore" }).catch(() => "");
    try {
      await gitWorkspace(root, "commit", { message: "chore: design approved (wireframes)" });
    } catch (e) {
      const msg = toUserError(e);
      if (!/nothing to commit|无文件变更|clean/i.test(msg)) {
        /* may already committed */
      }
    }
  } catch (e) {
    return `提交设计失败：${toUserError(e).slice(0, 120)}`;
  }

  if (!remoteUrl) {
    return "本地已提交设计（未配置远程 URL）";
  }

  try {
    await gitWorkspace(root, "remote_set", { remote: remoteName, path: remoteUrl });
  } catch (e) {
    return `远程配置失败：${toUserError(e).slice(0, 120)}`;
  }

  try {
    await gitWorkspace(root, "branch_ensure", { branch });
  } catch {
    /* ignore */
  }

  try {
    await gitWorkspace(root, "push", { remote: remoteName, branch });
    return `已推送 ${remoteName}/${branch}`;
  } catch (e) {
    return `本地已提交；推送失败（请检查凭据/SSH）：${toUserError(e).slice(0, 100)}`;
  }
}

export type OAuthRemoteProvider = "gitee" | "github";

export type OAuthBootstrapPlan = {
  provider: OAuthRemoteProvider;
  /** Future: cloud OAuth + empty repo API; wired from settings/cloud-login. */
  status: "planned";
  note: string;
};

/**
 * P1: OAuth one-click empty repo (Gitee/GitHub) after design confirm.
 * Hook for `projectGitBootstrap` — implementation pending cloud auth endpoints.
 */
export function planOAuthRemoteBootstrap(
  provider: OAuthRemoteProvider,
  project: XuProject,
): OAuthBootstrapPlan {
  const name = (project.name || "project").replace(/\s+/g, "-").slice(0, 48);
  return {
    provider,
    status: "planned",
    note: `将创建远程空仓库并写入 ${name}（${provider}），替代手填 remoteUrl。`,
  };
}
