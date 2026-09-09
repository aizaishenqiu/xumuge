import { listEnabledPacks, loadCapabilityPackState } from "./store";
import { skillAppliesTo } from "../skills/skillBind";

export async function buildAgentCapabilityHints(): Promise<string> {
  const state = await loadCapabilityPackState();
  const hints = listEnabledPacks(state)
    .filter((p) => !p.manifest.roleId && !p.manifest.employeeId)
    .map((p) => p.manifest.agentToolHints?.trim())
    .filter(Boolean);
  let block = hints.length ? `\n\n${hints.join("\n\n")}` : "";
  try {
    const { buildAntiDistillPrompt } = await import("../utils/antiDistill");
    const ad = buildAntiDistillPrompt();
    if (ad) block = `\n\n${ad}${block}`;
  } catch {
    /* ignore */
  }
  try {
    const { buildMcpTrainingHints } = await import("../training/mcpTips");
    const mcp = await buildMcpTrainingHints();
    if (mcp) block = `${block}\n\n${mcp}`;
  } catch {
    /* ignore */
  }
  return block;
}

/** Capability + user skills for an employee (role-bound + global). No anti-distill/MCP (dispatch adds those). */
export async function buildDispatchCapabilityHints(
  roleId?: string | null,
  employeeId?: string | null,
): Promise<string> {
  const state = await loadCapabilityPackState();
  const hints = listEnabledPacks(state)
    .filter((p) => skillAppliesTo(p.manifest, roleId, employeeId))
    .map((p) => p.manifest.agentToolHints?.trim())
    .filter(Boolean);
  return hints.length ? hints.join("\n\n") : "";
}

export function extensionLabelForFile(
  filename: string,
  state: Awaited<ReturnType<typeof loadCapabilityPackState>>,
): string | null {
  const lower = filename.toLowerCase();
  for (const pack of listEnabledPacks(state)) {
    for (const ext of pack.manifest.fileExtensions ?? []) {
      if (lower.endsWith(ext.toLowerCase())) return pack.manifest.name;
    }
  }
  return null;
}
