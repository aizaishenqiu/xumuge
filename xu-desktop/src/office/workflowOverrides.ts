/**
 * Local overrides for industry kickoff waves: {XU_HOME}/workflow-overrides/{industryId}.json
 */
import { invoke } from "@tauri-apps/api/core";
import type { ProjectType } from "../utils/projects";
import type { IndustryWorkflowTemplate, KickoffWave } from "./industryWorkflows";

const WAVES: KickoffWave[] = ["planning", "design", "dev", "qa", "security", "ops", "other"];

async function xuHome(): Promise<string> {
  try {
    return (await invoke<string>("xu_get_home")).trim();
  } catch {
    return "";
  }
}

function overridePath(home: string, industryId: string): string {
  const h = home.replace(/[/\\]+$/, "");
  return `${h}/workflow-overrides/${industryId}.json`;
}

function isKickoffWave(v: unknown): v is KickoffWave {
  return typeof v === "string" && (WAVES as string[]).includes(v);
}

/** Validate and normalize a partial override against the builtin template. */
export function mergeWorkflowOverride(
  builtin: IndustryWorkflowTemplate,
  raw: unknown,
): IndustryWorkflowTemplate {
  if (!raw || typeof raw !== "object") return { ...builtin };
  const o = raw as Record<string, unknown>;
  const wavesRaw = Array.isArray(o.waves) ? o.waves.filter(isKickoffWave) : [];
  const waves = wavesRaw.length ? (wavesRaw as KickoffWave[]) : [...builtin.waves];
  const labelsIn =
    o.waveLabels && typeof o.waveLabels === "object"
      ? (o.waveLabels as Record<string, string>)
      : {};
  const waveLabels = { ...builtin.waveLabels };
  for (const w of WAVES) {
    if (typeof labelsIn[w] === "string" && labelsIn[w].trim()) {
      waveLabels[w] = labelsIn[w].trim();
    }
  }
  const divisionDefault = { ...builtin.divisionDefault };
  if (o.divisionDefault && typeof o.divisionDefault === "object") {
    for (const [k, v] of Object.entries(o.divisionDefault as Record<string, unknown>)) {
      if (k && isKickoffWave(v)) divisionDefault[k] = v;
    }
  }
  const roleIdOverrides = { ...builtin.roleIdOverrides };
  if (o.roleIdOverrides && typeof o.roleIdOverrides === "object") {
    for (const [k, v] of Object.entries(o.roleIdOverrides as Record<string, unknown>)) {
      if (k && isKickoffWave(v)) roleIdOverrides[k] = v;
    }
  }
  return {
    id: builtin.id,
    nameZh: typeof o.nameZh === "string" && o.nameZh.trim() ? o.nameZh.trim() : builtin.nameZh,
    waves,
    waveLabels,
    divisionDefault,
    roleIdOverrides,
  };
}

export async function loadWorkflowOverrideFile(
  industryId: ProjectType,
): Promise<unknown | null> {
  const home = await xuHome();
  if (!home) return null;
  try {
    const raw = await invoke<string>("read_text_file", { path: overridePath(home, industryId) });
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

export async function saveWorkflowOverrideFile(
  tpl: IndustryWorkflowTemplate,
): Promise<void> {
  const home = await xuHome();
  if (!home) throw new Error("无法解析 XU_HOME");
  const dir = `${home.replace(/[/\\]+$/, "")}/workflow-overrides`;
  await invoke("create_workspace_path", {
    workspace: home,
    path: dir,
    isDir: true,
  });
  const path = overridePath(home, tpl.id);
  const body = JSON.stringify(
    {
      id: tpl.id,
      nameZh: tpl.nameZh,
      waves: tpl.waves,
      waveLabels: tpl.waveLabels,
      divisionDefault: tpl.divisionDefault,
      roleIdOverrides: tpl.roleIdOverrides,
    },
    null,
    2,
  );
  await invoke("write_text_file", { workspace: home, path, content: body });
}

export async function clearWorkflowOverrideFile(industryId: ProjectType): Promise<void> {
  const home = await xuHome();
  if (!home) return;
  const path = overridePath(home, industryId);
  try {
    await invoke("remove_path", { workspace: home, path });
  } catch {
    /* missing ok */
  }
}
