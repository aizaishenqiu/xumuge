/**
 * @file 桌面端会话、消息与流事件共享类型
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-30
 * @version 1.0.0
 * @category Stream
 * @algo run-id-routing
 */

// ─── Session ──────────────────────────────────────────────────────────────────

export interface Session {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  message_count?: number;
  cost?: number;
  model?: string;
  /** Latest user message, shown as the sidebar subtitle. Absent for single-turn sessions. */
  last_message?: string;
}

// ─── Message Blocks ───────────────────────────────────────────────────────────

export interface TextBlock {
  type: "text";
  content: string;
}

export interface ThinkBlock {
  type: "think";
  content: string;
}

export interface ToolCallBlock {
  type: "tool";
  name: string;
  input: string;
  output: string;
  outputDone: boolean;
}

export interface ImageBlock {
  type: "image";
  dataUrl: string;
  filename?: string;
}

export interface ChatAttachment {
  id: string;
  sessionId: string;
  messageId?: string | null;
  filename: string;
  storedPath: string;
  mime: string;
  kind: "image" | "audio" | "text" | "document" | "office" | "office-legacy" | "archive";
  sizeBytes: number;
  extractedText: string;
  extractionStatus: "ready" | "limited";
  warning?: string | null;
  createdAt: number;
  /** Ephemeral UI preview; persisted source remains storedPath. */
  previewDataUrl?: string;
}

export interface AttachmentBlock {
  type: "attachment";
  attachment: ChatAttachment;
}

export type MessageBlock = TextBlock | ThinkBlock | ToolCallBlock | ImageBlock | AttachmentBlock;

// ─── Messages ─────────────────────────────────────────────────────────────────

export interface Message {
  id: string;
  role: "user" | "assistant";
  blocks: MessageBlock[];
  rawOutput?: string;
  timestamp: string;
  status?: "streaming" | "done" | "error";
  /** Random thinking phrase for this stream turn */
  thinkPhrase?: string;
  /** Epoch ms when streaming/thinking started */
  thinkStartedAt?: number;
  /** Epoch ms when stream finished (freeze timer) */
  thinkEndedAt?: number;
  /** Latest status line from stream (model round, prefetch, etc.) */
  statusLine?: string;
}

// ─── Stream ───────────────────────────────────────────────────────────────────

export interface StreamChunk {
  kind:
    | "text"
    | "token"
    | "think"
    | "think_start"
    | "think_end"
    | "tool_name"
    | "tool_input"
    | "tool_output"
    | "tool_output_end"
    | "status"
    | "ctx_stat"
    | "session_stat"
    | "done"
    | "error"
    | "new_session_id"
    | "raw";
  content: string;
  session_id: string;
  run_id: string;
}

// ─── App State ────────────────────────────────────────────────────────────────

export interface ContextUsageBreakdown {
  systemPrompt: number;
  tools: number;
  messages: number;
  connectorsMcp: number;
  skills: number;
}

export interface ContextUsage {
  used: number;
  max: number;
  pct: number;
  breakdown?: ContextUsageBreakdown;
}

export interface StreamStatusInfo {
  model: string;
  tokensUsed: string;
  tokensMax: string;
  cost: string;
  duration: string;
  msgCount: string;
  raw: string;
}
