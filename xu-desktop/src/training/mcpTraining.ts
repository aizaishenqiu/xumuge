/**
 * @file MCP playbook：有序步骤、参数模板、触发与失败修复
 * @author qiuye <yjk150@qq.com>
 * @updated 2026-09-02
 * @version 3.1.0
 * @category ToolPolicy
 * @algo role-aware-ordered-playbook
 */
import { invoke } from "@tauri-apps/api/core";
import {
  ensureTrainingDirsAt,
  legacyMcpTipsPath,
  mcpTrainingPath,
  readTrainingRootOrThrow,
  readTrainingText,
  touchTrainingManifest,
  writeTrainingText,
} from "./trainingStore";
import { sanitizeTrainingTrace } from "./outcomes";

export type McpScenario = {
  id: string;
  title: string;
  /** What the user / Boss typically asks */
  userIntent: string;
  /** Ordered tool names (mcp__server__tool) */
  toolChain: string[];
  expectedOutcome: string;
};

export type PlaybookStep = {
  id: string;
  order: number;
  toolName: string;
  parameterTemplate: string;
  trigger: string;
  failureRecovery: string;
};

export type McpToolTrainingRecord = {
  toolName: string;
  version: number;
  status: "draft" | "active" | "retired";
  serverId: string;
  tool: string;
  /** 1 (low) – 5 (high), default 3 */
  priority: number;
  /** Empty = all employees; else only these agency role ids */
  roleIds: string[];
  whenToUse: string;
  example: string;
  notes?: string;
  /** When the agent must NOT call this tool */
  antiPatterns?: string;
  /** Step-by-step workflow bullets */
  workflowSteps?: string[];
  /** Executable ordered playbook; secrets must use references such as ${API_KEY_ENV}. */
  playbookSteps: PlaybookStep[];
  scenarios?: McpScenario[];
};

export type McpTrainingDoc = {
  version: 3;
  updatedAt: string;
  tools: McpToolTrainingRecord[];
};

export type McpHintContext = {
  roleId?: string | null;
  taskHint?: string | null;
};

type LegacyTip = {
  toolName: string;
  serverId: string;
  tool: string;
  whenToUse: string;
  example: string;
  notes?: string;
};

function emptyDoc(): McpTrainingDoc {
  return { version: 3, updatedAt: new Date().toISOString(), tools: [] };
}

function normalizeRecord(raw: Partial<McpToolTrainingRecord>): McpToolTrainingRecord | null {
  const toolName = String(raw.toolName || "").trim();
  if (!toolName) return null;
  const parts = toolName.replace(/^mcp__/, "").split("__");
  const legacySteps = Array.isArray(raw.workflowSteps)
    ? raw.workflowSteps.map((step, index) => ({
        id: `legacy_step_${index + 1}`,
        order: index + 1,
        toolName,
        parameterTemplate: "{}",
        trigger: index === 0 ? String(raw.whenToUse || "").trim() : "上一步成功",
        failureRecovery: String(raw.antiPatterns || "停止并向用户说明失败").trim(),
      }))
    : [];
  const playbookSteps = Array.isArray(raw.playbookSteps)
    ? raw.playbookSteps
        .map((step, index) => ({
          id: String(step?.id || `step_${index + 1}`),
          order: Math.max(1, Number(step?.order) || index + 1),
          toolName: String(step?.toolName || toolName).trim(),
          parameterTemplate: String(step?.parameterTemplate || "{}").trim(),
          trigger: String(step?.trigger || "上一步成功").trim(),
          failureRecovery: String(step?.failureRecovery || "停止并报告失败").trim(),
        }))
        .sort((a, b) => a.order - b.order)
    : legacySteps;
  return {
    toolName,
    version: Math.max(1, Math.floor(Number(raw.version) || 1)),
    status: raw.status === "draft" || raw.status === "retired" ? raw.status : "active",
    serverId: String(raw.serverId || parts[0] || "").trim(),
    tool: String(raw.tool || parts.slice(1).join("__") || "").trim(),
    priority: Math.min(5, Math.max(1, Number(raw.priority) || 3)),
    roleIds: Array.isArray(raw.roleIds)
      ? raw.roleIds.map((r) => String(r).trim()).filter(Boolean)
      : [],
    whenToUse: String(raw.whenToUse || "").trim(),
    example: String(raw.example || "").trim(),
    notes: raw.notes?.trim() || undefined,
    antiPatterns: raw.antiPatterns?.trim() || undefined,
    workflowSteps: Array.isArray(raw.workflowSteps)
      ? raw.workflowSteps.map((s) => String(s).trim()).filter(Boolean)
      : undefined,
    playbookSteps,
    scenarios: Array.isArray(raw.scenarios)
      ? raw.scenarios
          .map((s) => ({
            id: String(s?.id || `sc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`).trim(),
            title: String(s?.title || "").trim(),
            userIntent: String(s?.userIntent || "").trim(),
            toolChain: Array.isArray(s?.toolChain)
              ? s.toolChain.map((t) => String(t).trim()).filter(Boolean)
              : [],
            expectedOutcome: String(s?.expectedOutcome || "").trim(),
          }))
          .filter((s) => s.title || s.userIntent)
      : undefined,
  };
}

function legacyToRecord(t: LegacyTip): McpToolTrainingRecord {
  return normalizeRecord({
    ...t,
    priority: 3,
    roleIds: [],
  })!;
}

function roleMatches(roleId: string, roleIds: string[]): boolean {
  if (!roleIds.length) return true;
  const rid = roleId.trim();
  const base = rid.replace(/^software-company__/, "");
  return roleIds.some((id) => {
    const x = id.trim();
    return x === rid || x === base || rid.endsWith(x) || x.endsWith(base);
  });
}

function recordHasContent(t: McpToolTrainingRecord): boolean {
  return Boolean(
    t.whenToUse ||
      t.example ||
      t.notes ||
      t.antiPatterns ||
      t.workflowSteps?.length ||
      t.playbookSteps?.length ||
      t.scenarios?.length,
  );
}

async function loadLegacyTips(root: string): Promise<LegacyTip[]> {
  try {
    const raw = await readTrainingText(legacyMcpTipsPath(root));
    const o = JSON.parse(raw) as { tips?: LegacyTip[] };
    return Array.isArray(o.tips) ? o.tips : [];
  } catch {
    return [];
  }
}

/** 读取 playbook 版本库并迁移 v1/v2；文件缺失返回空库。 */
export async function loadMcpTraining(): Promise<McpTrainingDoc> {
  let root = "";
  try {
    root = await readTrainingRootOrThrow();
  } catch {
    return emptyDoc();
  }
  try {
    const raw = await readTrainingText(mcpTrainingPath(root));
    const o = JSON.parse(raw) as Partial<McpTrainingDoc>;
    const tools = Array.isArray(o.tools)
      ? (o.tools.map((t) => normalizeRecord(t)).filter(Boolean) as McpToolTrainingRecord[])
      : [];
    return {
      version: 3,
      updatedAt: typeof o.updatedAt === "string" ? o.updatedAt : new Date().toISOString(),
      tools,
    };
  } catch {
    const legacy = await loadLegacyTips(root);
    if (!legacy.length) return emptyDoc();
    const migrated: McpTrainingDoc = {
      version: 3,
      updatedAt: new Date().toISOString(),
      tools: legacy.map(legacyToRecord),
    };
    await saveMcpTraining(migrated);
    return migrated;
  }
}

/** 脱敏并保存 playbook 版本库；依赖训练目录，失败向 UI 抛错。 */
export async function saveMcpTraining(doc: McpTrainingDoc): Promise<void> {
  const root = await readTrainingRootOrThrow();
  const sanitized = doc.tools.map((tool) => {
    const encoded = sanitizeTrainingTrace(JSON.stringify(tool)).text;
    try {
      return JSON.parse(encoded) as McpToolTrainingRecord;
    } catch {
      return tool;
    }
  });
  const next: McpTrainingDoc = {
    version: 3,
    updatedAt: new Date().toISOString(),
    tools: sanitized.map((t) => normalizeRecord(t)).filter(Boolean) as McpToolTrainingRecord[],
  };
  await writeTrainingText(root, mcpTrainingPath(root), JSON.stringify(next, null, 2));
  await touchTrainingManifest(root);
}

/** 将编辑内容追加为新 draft 版本，不覆盖已生效/历史版本。 */
export function upsertMcpTrainingRecord(
  doc: McpTrainingDoc,
  record: McpToolTrainingRecord,
): McpTrainingDoc {
  const norm = normalizeRecord(record);
  if (!norm) return doc;
  const tools = [...doc.tools];
  const versions = tools
    .filter((item) => item.toolName === norm.toolName)
    .map((item) => item.version);
  norm.version = Math.max(0, ...versions) + 1;
  norm.status = "draft";
  tools.push(norm);
  return { ...doc, tools };
}

export type PlaybookPromotionDecision = {
  allowed: boolean;
  reason: string;
  baselineScore: number;
  candidateScore: number;
  violationRate: number;
};

function playbookQuality(record: McpToolTrainingRecord): number {
  const steps = record.playbookSteps || [];
  if (!steps.length) return 0;
  const stepScore = steps.reduce((sum, step) => {
    return (
      sum +
      (step.toolName ? 5 : 0) +
      (step.parameterTemplate && step.parameterTemplate !== "{}" ? 5 : 0) +
      (step.trigger ? 5 : 0) +
      (step.failureRecovery ? 5 : 0)
    );
  }, 0);
  return Math.min(
    100,
    stepScore +
      (record.whenToUse ? 8 : 0) +
      (record.antiPatterns ? 8 : 0) +
      (record.scenarios?.length ? 8 : 0),
  );
}

/** 评估 playbook 候选相对生效基线的结构提升与真实轨迹违规率。 */
export async function evaluateMcpPlaybook(
  doc: McpTrainingDoc,
  candidate: McpToolTrainingRecord,
): Promise<PlaybookPromotionDecision> {
  const active = doc.tools
    .filter((item) => item.toolName === candidate.toolName && item.status === "active")
    .sort((a, b) => b.version - a.version)[0];
  const baselineScore = active ? playbookQuality(active) : 0;
  const candidateScore = playbookQuality(candidate);
  const { loadTrainingOutcomes } = await import("./outcomes");
  const relevant = (await loadTrainingOutcomes()).outcomes.filter((outcome) =>
    outcome.tools.some((tool) => tool.name === candidate.toolName),
  );
  const violationRate = relevant.length
    ? relevant.filter((outcome) => outcome.violations.length > 0).length / relevant.length
    : 0;
  const allowed =
    candidate.status === "draft" &&
    candidateScore > baselineScore &&
    violationRate === 0;
  return {
    allowed,
    reason:
      candidate.status !== "draft"
        ? "只有候选版本可以晋级"
        : candidateScore <= baselineScore
          ? "playbook 完整度未相对基线提升"
          : violationRate > 0
            ? "关联真实轨迹存在违规，不能晋级"
            : "playbook 完整度提升且未增加违规",
    baselineScore,
    candidateScore,
    violationRate,
  };
}

/** 晋级 playbook 候选；门禁失败时不改变当前生效版本。 */
export async function promoteMcpPlaybook(
  doc: McpTrainingDoc,
  candidate: McpToolTrainingRecord,
): Promise<PlaybookPromotionDecision> {
  const decision = await evaluateMcpPlaybook(doc, candidate);
  if (!decision.allowed) return decision;
  doc.tools = doc.tools.map((item) =>
    item.toolName !== candidate.toolName
      ? item
      : {
          ...item,
          status: item.version === candidate.version ? "active" : "retired",
        },
  );
  await saveMcpTraining(doc);
  return decision;
}

function scoreRecord(t: McpToolTrainingRecord, ctx: McpHintContext): number {
  let score = t.priority ?? 3;
  const roleId = ctx.roleId?.trim();
  if (roleId) {
    if (t.roleIds.length === 0) score += 1;
    else if (roleMatches(roleId, t.roleIds)) score += 12;
    else score -= 8;
  }
  const hint = ctx.taskHint?.trim().toLowerCase();
  if (hint && hint.length >= 4) {
    const blob = `${t.whenToUse} ${t.notes || ""} ${t.antiPatterns || ""}`.toLowerCase();
    if (blob.includes(hint.slice(0, 24))) score += 3;
    for (const s of t.scenarios || []) {
      if (s.userIntent.toLowerCase().includes(hint.slice(0, 16))) score += 4;
    }
  }
  return score;
}

/** Rich MCP block for chat / dispatch — role & task aware. */
export async function buildMcpTrainingHints(ctx: McpHintContext = {}): Promise<string> {
  const doc = await loadMcpTraining();
  const usable = doc.tools.filter((tool) => tool.status === "active" && recordHasContent(tool));
  if (!usable.length) return "";

  const ranked = [...usable]
    .map((t) => ({ t, score: scoreRecord(t, ctx) }))
    .filter(({ score }) => score > -4)
    .sort((a, b) => b.score - a.score)
    .slice(0, 48)
    .map(({ t }) => t);

  if (!ranked.length) return "";

  const lines = [
    "【MCP 完整训练 · 本机永久库】",
    "以下为用户在本机训练目录中编写的 MCP 用法（不含软件内置岗位/插件数据）；升级软件不会覆盖。优先按优先级、岗位与场景选择工具。",
  ];

  if (ctx.roleId?.trim()) {
    lines.push(`当前员工岗位：${ctx.roleId.trim()}（已优先匹配绑定此岗的工具条目）。`);
  }

  for (const t of ranked) {
    lines.push(`- \`${t.toolName}\`（优先级 ${t.priority}/5）`);
    if (t.roleIds.length) lines.push(`  绑定岗位：${t.roleIds.join("、")}`);
    if (t.whenToUse.trim()) lines.push(`  何时用：${t.whenToUse.trim().slice(0, 360)}`);
    if (t.antiPatterns?.trim()) lines.push(`  勿用：${t.antiPatterns.trim().slice(0, 200)}`);
    if (t.workflowSteps?.length) {
      lines.push(`  流程：${t.workflowSteps.slice(0, 6).join(" → ")}`.slice(0, 320));
    }
    for (const step of t.playbookSteps.slice(0, 8)) {
      lines.push(`  ${step.order}. ${step.toolName}`);
      if (step.trigger) lines.push(`     触发：${step.trigger.slice(0, 180)}`);
      if (step.parameterTemplate) {
        lines.push(`     参数模板：${step.parameterTemplate.slice(0, 220)}`);
      }
      if (step.failureRecovery) {
        lines.push(`     失败修复：${step.failureRecovery.slice(0, 180)}`);
      }
    }
    if (t.example.trim()) lines.push(`  示例：${t.example.trim().slice(0, 280)}`);
    if (t.notes?.trim()) lines.push(`  备注：${t.notes.trim().slice(0, 180)}`);
    const scen = (t.scenarios || []).slice(0, 2);
    for (const s of scen) {
      lines.push(
        `  场景「${s.title || "未命名"}」：${s.userIntent.slice(0, 120)} → ${s.expectedOutcome.slice(0, 120)}`,
      );
    }
  }

  return lines.join("\n");
}

export type McpToolRow = {
  server_id: string;
  name: string;
  description: string;
};

export function mcpOpenAiName(serverId: string, tool: string): string {
  return `mcp__${serverId}__${tool}`;
}

/**
 * Duty: 合并 live MCP 工具与本机 mcp-training 记录（含草稿演示），按 toolName 去重。
 * 依赖: live 列表可为空；doc.tools 仍应出现在训练左侧。
 */
export function mergeMcpToolRows(live: McpToolRow[], doc: McpTrainingDoc): McpToolRow[] {
  const map = new Map<string, McpToolRow>();
  for (const t of live) {
    const key = mcpOpenAiName(t.server_id, t.name);
    map.set(key, t);
  }
  for (const rec of doc.tools || []) {
    const key = String(rec.toolName || "").trim();
    if (!key || map.has(key)) continue;
    const parts = key.replace(/^mcp__/, "").split("__");
    map.set(key, {
      server_id: String(rec.serverId || parts[0] || "local").trim() || "local",
      name: String(rec.tool || parts.slice(1).join("__") || key).trim() || key,
      description:
        rec.status === "draft"
          ? "本机草稿 / 演示"
          : String(rec.whenToUse || rec.notes || "").trim() || "本机训练记录",
    });
  }
  return [...map.values()].sort((a, b) =>
    mcpOpenAiName(a.server_id, a.name).localeCompare(mcpOpenAiName(b.server_id, b.name)),
  );
}

/** Duty: 列出已启用 MCP 的工具；失败抛错（由调用方弹窗）。 */
export async function listMcpToolsFromRust(): Promise<McpToolRow[]> {
  return await invoke<McpToolRow[]>("xu_mcp_list_tools");
}
