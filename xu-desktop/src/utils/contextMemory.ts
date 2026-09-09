/**
 * @file Native Agent 上下文组装、跨会话搜索与增量代码索引桥接
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-30
 * @version 1.0.0
 * @category AgentLoop
 * @algo token-budgeted-context
 */

import { invoke } from "@tauri-apps/api/core";

export type ChatSearchHit = {
  sessionId: string;
  sessionTitle: string;
  messageId: string;
  role: string;
  snippet: string;
  createdAt: number;
  backend: "fts5" | "like";
};

export type ContextMessage = {
  role: string;
  content: string;
  images?: string[] | null;
};

export type IdeContextInput = {
  openFiles: string[];
  activeFile?: string | null;
  activeContent?: string | null;
  selection?: string | null;
  cursorLine?: number | null;
  cursorColumn?: number | null;
  diagnostics: unknown[];
  gitDiff?: string | null;
};

export type AssembleContextRequest = {
  sessionId: string;
  messages: ContextMessage[];
  systemRules: string;
  brief?: string | null;
  ide?: IdeContextInput | null;
  workspaceRoot?: string | null;
  projectId?: string | null;
  employeeId?: string | null;
  query: string;
  modelWindow?: number;
  reserveOutput?: number;
};

export type AssembleContextResult = {
  messages: ContextMessage[];
  usedTokens: number;
  inputBudget: number;
  breakdown: Record<string, number>;
};

/** 跨全部会话检索正文；后端自动选择 FTS5 或 LIKE fallback，失败交由页面 fouAlert。 */
export function searchChatMessages(query: string, limit = 30): Promise<ChatSearchHit[]> {
  return invoke("xu_search_chat_messages", { query, limit });
}

/**
 * 按模型窗口预算组装规则、Brief、IDE、代码、摘要、记忆和近期对话。
 * 依赖 xu.db；失败交由页面统一错误弹窗处理。
 */
export function assembleAgentContext(request: AssembleContextRequest): Promise<AssembleContextResult> {
  return invoke("xu_assemble_context", { request });
}

/**
 * 以 mtime+SHA-256 增量更新路径与轻量符号索引。
 * 当前是 Regex provider 边界，不代表完整 Tree-sitter/LSP 索引。
 */
export function indexWorkspaceContext(workspaceRoot: string, maxFiles = 5_000): Promise<{
  scanned: number;
  updated: number;
  unchanged: number;
  removed: number;
  extractor: string;
}> {
  return invoke("xu_index_workspace_context", { workspaceRoot, maxFiles });
}
