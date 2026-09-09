/**
 * @file 软件自动驾驶：队列模式下自动过 workflow 闸门
 * @author qiuye <yjk150@qq.com>
 * @date 2026-09-02
 * @version 1.0.0
 * @category Schedule
 * @algo queue-gated-autopilot
 */

import {
  confirmAcceptance,
  confirmPlanAndDispatch,
  confirmTechAndDispatch,
  confirmDesignAndDispatch,
} from "./workflowOrchestrator";
import { loadProjects } from "./projects";
import { loadProjectQueue } from "./projectQueue";
import {
  isSoftwareAutopilotEnabled,
  loadSoftwareAutopilotPrefs,
} from "./softwareAutopilot";
import { hasDesignArtifacts } from "../intent/designArtifacts";

async function shouldAutopilotForQueue(projectId: string): Promise<boolean> {
  const prefs = await loadSoftwareAutopilotPrefs();
  if (!isSoftwareAutopilotEnabled(prefs)) return false;
  const q = await loadProjectQueue();
  return q.enabled && q.autoAdvance && q.currentProjectId === projectId;
}

/** Auto-pass workflow gates when queue + autopilot enabled. */
export async function trySoftwareAutopilotGates(projectId: string): Promise<boolean> {
  if (!(await shouldAutopilotForQueue(projectId))) return false;
  const project = (await loadProjects()).find((p) => p.id === projectId);
  if (!project || project.type !== "software") return false;
  const state = project.workflow?.state;
  if (!state) return false;

  try {
    if (state === "plan_review") {
      await confirmPlanAndDispatch(projectId);
      return true;
    }
    if (state === "design_review") {
      const ok = await hasDesignArtifacts(project);
      if (!ok) return false;
      await confirmDesignAndDispatch(projectId);
      return true;
    }
    if (state === "tech_review") {
      await confirmTechAndDispatch(projectId);
      return true;
    }
    if (state === "acceptance") {
      await confirmAcceptance(projectId);
      return true;
    }
  } catch (e) {
    console.warn("[autopilot] gate", e);
  }
  return false;
}
