import { invoke } from "@tauri-apps/api/core";
import { loadBrief } from "../intent/briefStore";
import { readLs } from "../utils/xuStorage";
import { loadProjects } from "../utils/projects";
import { hasEntitlement } from "./entitlements";
import type { CommercialHostContext } from "./types";

async function resolveXuHome(): Promise<string> {
  try {
    return await invoke<string>("xu_get_home");
  } catch {
    return "";
  }
}

export async function createCommercialHostContext(): Promise<CommercialHostContext> {
  const xuHome = await resolveXuHome();
  return {
    hasEntitlement,
    xuHome,
    getActiveGeneratePath(): string | null {
      const wd = readLs("xu.chat.workingDir", "hermes_working_dir")?.trim();
      if (wd) return wd;
      return null;
    },
    async getBriefSummary(projectId: string): Promise<Record<string, unknown> | null> {
      const id = projectId.trim();
      if (!id) return null;
      try {
        const brief = await loadBrief(id);
        const projects = await loadProjects();
        const proj = projects.find((p) => p.id === id);
        return {
          projectId: brief.projectId,
          goal: brief.goal,
          industry: brief.industry,
          status: brief.status,
          version: brief.version,
          generatePath: proj?.generatePath ?? null,
        };
      } catch {
        return null;
      }
    },
  };
}
