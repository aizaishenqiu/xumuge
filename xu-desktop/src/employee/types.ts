/** Shared types for Xu AI employees (no Hermes types). */

export type EmployeeStatus = "idle" | "working" | "meeting" | "away";
export type DriveMode = "off" | "sdk" | "input_control";
export type Gender = "male" | "female";
export type RoleKind = "worker" | "reviewer" | "boss";
export type BrainSlot = "command" | "work" | "code";

/** Resolved LLM endpoint for Native Agent — never written to Hermes config.yaml. */
export interface EmployeeEndpoint {
  provider: string;
  model: string;
  baseUrl: string;
  apiKeyEnv: string;
  brainSlot: BrainSlot;
}

export interface DispatchTaskInput {
  employeeId: string;
  task: string;
  forceNewSession?: boolean;
  projectId?: string | null;
  /** Boss 深派活：跳过分析确认，直接在工作区写文件 */
  directImplement?: boolean;
  /** 办公室轻量问答：必须回复，不上全量实现 */
  qaMode?: boolean;
  /** Override employee.workspaceRoot (e.g. project generatePath) */
  workspaceRoot?: string | null;
}

export interface DispatchTaskResult {
  jobId: string;
  sessionId: string;
  /** true when only queued locally; Native Agent not yet running */
  queuedOnly: boolean;
  message: string;
  /** Slot full: Rust waits; kickoff should note「等待本机槽」not failure. */
  waitingForSlot?: boolean;
}

export interface EmployeeSessionBinding {
  employeeId: string;
  /** Xu chat_sessions.id (not Hermes state.db id). */
  sessionId: string | null;
}
