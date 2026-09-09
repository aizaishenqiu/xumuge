/**
 * @file 旧 MCP tips 兼容适配
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-31
 * @version 2.0.0
 * @category ToolPolicy
 * @algo legacy-adapter
 */
export {
  buildMcpTrainingHints,
  listMcpToolsFromRust,
  loadMcpTraining,
  saveMcpTraining,
  upsertMcpTrainingRecord,
  mcpOpenAiName,
  type McpHintContext,
  type McpToolRow,
  type McpToolTrainingRecord,
  type McpTrainingDoc,
  type McpScenario,
} from "./mcpTraining";

import { loadMcpTraining, saveMcpTraining, type McpToolTrainingRecord } from "./mcpTraining";

/** @deprecated Use McpToolTrainingRecord */
export type McpToolTip = Pick<
  McpToolTrainingRecord,
  "toolName" | "serverId" | "tool" | "whenToUse" | "example" | "notes"
>;

/** @deprecated Use McpTrainingDoc */
export type McpTipsDoc = {
  version: 1;
  updatedAt: string;
  tips: McpToolTip[];
};

export async function loadMcpTips(): Promise<McpTipsDoc> {
  const doc = await loadMcpTraining();
  return {
    version: 1,
    updatedAt: doc.updatedAt,
    tips: doc.tools.map((t) => ({
      toolName: t.toolName,
      serverId: t.serverId,
      tool: t.tool,
      whenToUse: t.whenToUse,
      example: t.example,
      notes: t.notes,
    })),
  };
}

export async function saveMcpTips(legacy: McpTipsDoc): Promise<void> {
  const doc = await loadMcpTraining();
  for (const tip of legacy.tips) {
    const existing = doc.tools.find((t) => t.toolName === tip.toolName);
    doc.tools = doc.tools.filter((t) => t.toolName !== tip.toolName);
    doc.tools.push({
      toolName: tip.toolName,
      version: existing?.version ?? 1,
      status: existing?.status ?? "active",
      serverId: tip.serverId,
      tool: tip.tool,
      priority: existing?.priority ?? 3,
      roleIds: existing?.roleIds ?? [],
      whenToUse: tip.whenToUse,
      example: tip.example,
      notes: tip.notes,
      antiPatterns: existing?.antiPatterns,
      workflowSteps: existing?.workflowSteps,
      playbookSteps: existing?.playbookSteps ?? [],
      scenarios: existing?.scenarios,
    });
  }
  await saveMcpTraining(doc);
}

export function upsertMcpTip(doc: McpTipsDoc, tip: McpToolTip): McpTipsDoc {
  const tips = [...doc.tips];
  const i = tips.findIndex((t) => t.toolName === tip.toolName);
  if (i >= 0) tips[i] = tip;
  else tips.push(tip);
  return { ...doc, tips };
}
