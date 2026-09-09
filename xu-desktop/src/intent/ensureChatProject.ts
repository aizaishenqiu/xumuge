/**
 * @file Ensure Chat has a XuProject to hang Brief on (match by cwd or create draft).
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-30
 * @updated 2026-09-02
 * @version 1.1.0
 * @category Config
 * @algo cwd-match-or-draft
 */
import {
  loadProjects,
  upsertProject,
  defaultProjectToolPolicy,
  type XuProject,
} from "../utils/projects";
import type { WorkMode } from "./briefTypes";
import { needsBriefCollection, type WorkModeClassification } from "./workModeClassifier";

export type EnsureChatProjectOpts = {
  workingDir?: string | null;
  goalHint?: string;
  /** Reuse in-session draft if still exists */
  preferProjectId?: string | null;
  /** 工作模式：仅 software_build / delivery+complex 才新建草稿 */
  classification?: WorkModeClassification;
};

export type EnsureChatProjectResult = {
  project: XuProject;
  created: boolean;
};

export function shouldCreateBriefProject(classification: WorkModeClassification): boolean {
  return needsBriefCollection(classification);
}

function normPath(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

export function findProjectByWorkingDir(
  projects: XuProject[],
  workingDir: string,
): XuProject | null {
  const norm = normPath(workingDir);
  if (!norm) return null;
  return (
    projects.find((p) => {
      const gp = normPath(p.generatePath || "");
      return gp && (norm === gp || norm.startsWith(`${gp}/`) || gp.startsWith(`${norm}/`));
    }) || null
  );
}

function draftName(goalHint?: string): string {
  const g = (goalHint || "").trim().replace(/\s+/g, " ");
  if (!g) return "未命名项目";
  const short = g.length > 28 ? `${g.slice(0, 28)}…` : g;
  return `未命名·${short}`;
}

function draftToolPolicy() {
  return {
    ...defaultProjectToolPolicy(),
    readFiles: true,
    writeFiles: true,
    shell: true,
    ide: true,
  };
}

function draftProjectFields(mode: WorkMode): Pick<XuProject, "categoryId" | "industryId" | "type"> {
  if (mode === "software_build") {
    return {
      categoryId: "cat_product",
      industryId: "software",
      type: "software",
    };
  }
  return {
    categoryId: "cat_delivery",
    industryId: "consulting",
    type: "delivery",
  };
}

export async function ensureChatProject(
  opts: EnsureChatProjectOpts,
): Promise<EnsureChatProjectResult> {
  const list = await loadProjects();
  const prefer = (opts.preferProjectId || "").trim();
  if (prefer) {
    const hit = list.find((p) => p.id === prefer);
    if (hit) return { project: hit, created: false };
  }

  const ws = (opts.workingDir || "").trim();
  if (ws) {
    const matched = findProjectByWorkingDir(list, ws);
    if (matched) return { project: matched, created: false };
  }

  const classification = opts.classification;
  if (classification && !shouldCreateBriefProject(classification)) {
    throw new Error("当前消息不需要立项草稿项目");
  }

  const mode = classification?.mode ?? "software_build";
  const fields = draftProjectFields(mode);

  const project = await upsertProject({
    name: draftName(opts.goalHint),
    ...fields,
    employeeIds: [],
    employeeNotes: {},
    docPath: "",
    generatePath: ws,
    kickoffMode: "phased",
    toolPolicy: draftToolPolicy(),
  });
  window.dispatchEvent(new CustomEvent("xu-projects-changed"));
  return { project, created: true };
}
