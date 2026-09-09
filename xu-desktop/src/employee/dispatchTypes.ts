import type { BrainSlot, EmployeeEndpoint } from "./types";

export interface PendingDispatchJob {
  jobId: string;
  employeeId: string;
  employeeName: string;
  workspaceRoot: string;
  /** Policy + task message ready for agent. */
  message: string;
  brainSlot: BrainSlot;
  endpoint: EmployeeEndpoint;
  forceNewSession?: boolean;
  createdAt: number;
}

export type { DispatchTaskInput, DispatchTaskResult } from "./types";
