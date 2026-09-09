/**
 * @file Native Agent 偏好、上下文压缩与运行辅助 API
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-30
 * @updated 2026-09-05
 * @version 1.1.0
 * @category AgentLoop
 * @algo none
 */

import { invoke } from "@tauri-apps/api/core";

export type ExecPolicy = "readonly" | "standard" | "trusted";

export type ChatMode = "agent" | "plan" | "ask" | "debug" | "multitask";

export type AgentPrefs = {
  localStream: boolean;
  llmCompact: boolean;
  execPolicy: ExecPolicy;
  chatMode: ChatMode;
  /** Main agent sampling temperature (0–1.5). Default 0.2. */
  temperature: number;
  /** Warn when many files are read in one session (suspected whole-project upload). */
  bulkReadWarnEnabled: boolean;
  bulkReadFileThreshold: number;
  bulkReadBytesThreshold: number;
  /** Fail-closed IDE completion evidence gate; experimental and off by default. */
  ideReleaseGateEnabled: boolean;
};

export const CHAT_MODE_OPTIONS: Array<{
  id: ChatMode;
  label: string;
  description: string;
  icon: string;
}> = [
  { id: "agent", label: "智能体", description: "可读写文件、执行工具", icon: "robot-2-line" },
  { id: "plan", label: "计划", description: "只读分析并输出计划，禁止写盘", icon: "list-check-2" },
  { id: "ask", label: "问询", description: "纯问答，不启用工具", icon: "question-answer-line" },
  { id: "debug", label: "漏洞", description: "只读诊断 bug，先根因后方案", icon: "bug-line" },
  { id: "multitask", label: "多任务", description: "多会话并行 Agent", icon: "stack-line" },
];

export function normalizeChatMode(raw?: string | null): ChatMode {
  const ids = CHAT_MODE_OPTIONS.map((m) => m.id);
  if (raw && ids.includes(raw as ChatMode)) return raw as ChatMode;
  return "agent";
}

export function chatModeLabel(mode: ChatMode): string {
  return CHAT_MODE_OPTIONS.find((m) => m.id === mode)?.label ?? mode;
}

export const EXEC_POLICY_OPTIONS: Array<{
  id: ExecPolicy;
  label: string;
  description: string;
}> = [
  { id: "readonly", label: "只读", description: "只看项目文件（列出/读取/搜索），不改文件、不跑命令" },
  {
    id: "standard",
    label: "标准",
    description: "可在本项目里改文件、跑检查命令；删文件、危险命令、Git 推送仍需你点头",
  },
  {
    id: "trusted",
    label: "信任",
    description: "本项目内少打断、连续改文件；仍不能改到项目外，也不能外传代码",
  },
];

export async function loadAgentPrefs(): Promise<AgentPrefs> {
  const raw = await invoke<Partial<AgentPrefs> & Record<string, unknown>>("xu_agent_get_prefs");
  const t = Number(raw.temperature);
  return {
    localStream: Boolean(raw.localStream ?? true),
    llmCompact: Boolean(raw.llmCompact ?? false),
    execPolicy: (raw.execPolicy as ExecPolicy) || "standard",
    chatMode: normalizeChatMode(raw.chatMode as string),
    temperature: Number.isFinite(t) ? Math.min(1.5, Math.max(0, t)) : 0.2,
    bulkReadWarnEnabled: raw.bulkReadWarnEnabled !== false,
    bulkReadFileThreshold: Number(raw.bulkReadFileThreshold) > 0 ? Number(raw.bulkReadFileThreshold) : 40,
    bulkReadBytesThreshold:
      Number(raw.bulkReadBytesThreshold) > 0 ? Number(raw.bulkReadBytesThreshold) : 1_572_864,
    ideReleaseGateEnabled: raw.ideReleaseGateEnabled === true,
  };
}

export async function saveAgentPrefs(prefs: AgentPrefs): Promise<void> {
  await invoke("xu_agent_set_prefs", { prefs });
}

export async function compactAgentMessages(
  messages: Array<{ role: string; content: string }>,
  sessionId?: string,
): Promise<{
  messages: Array<{ role: string; content: string }>;
  before: number;
  after: number;
  compacted: boolean;
  max: number;
}> {
  return invoke("xu_agent_compact_messages", { messages, sessionId: sessionId || null });
}

export async function sessionContextUsage(sessionId: string): Promise<import("../types").ContextUsage> {
  return invoke("xu_session_context_usage", { sessionId });
}

export async function undoAgentWorkspace(workspaceRoot: string): Promise<string> {
  return invoke<string>("xu_agent_undo_workspace", { workspaceRoot });
}

export type PlaywrightStatus = {
  nodeOk: boolean;
  nodeVersion: string;
  npmOk: boolean;
  playwrightInstalled: boolean;
  qaScriptOk: boolean;
  ready: boolean;
  projectRoot?: string;
  qaHome?: string;
  browsersPath?: string;
  browsersReady?: boolean;
  error?: string;
};

export async function getAppRepoRoot(): Promise<string> {
  return invoke<string>("xu_app_repo_root");
}

/** Duty: probe Playwright under `{XU_HOME}/qa` (projectRoot arg ignored; kept for API compat). */
export async function probePlaywrightStatus(
  _projectRoot?: string,
): Promise<PlaywrightStatus> {
  return invoke<PlaywrightStatus>("xu_qa_playwright_status", {
    projectRoot: null,
  });
}

/** Duty: install Playwright + Chromium into `{XU_HOME}/qa`. */
export async function installPlaywright(_projectRoot?: string): Promise<string> {
  return invoke<string>("xu_qa_playwright_install", {
    projectRoot: null,
  });
}
