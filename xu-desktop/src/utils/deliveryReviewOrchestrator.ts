/**
 * Post-dispatch delivery alignment: peer discussion → boss escalation.
 */

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { fouMsg, fouAlert} from "foucui";
import { dispatchEmployeeTask } from "../employee/dispatch";
import { loadEmployees, readEmployees, type Employee } from "./employees";
import { notifyBoss } from "./channelConnections";
import {
  loadProjectTheme,
  saveProjectTheme,
  type ProjectAssignment,
  type ProjectTheme,
} from "./projectTheme";

export type DeliveryDisputeStatus = "open" | "discussing" | "resolved" | "escalated";

export type DeliveryDispute = {
  id: string;
  employeeId: string;
  employeeName: string;
  projectId: string;
  projectName: string;
  taskText: string;
  deliveryBody: string;
  gaps: string[];
  status: DeliveryDisputeStatus;
  discussionSummary?: string;
  createdAt: number;
  updatedAt: number;
};

const LS_KEY = "xu.deliveryDisputes";
const EVENT = "xu-delivery-disputes-changed";

let unlisten: UnlistenFn | null = null;
let bridgeStarted = false;

function readDisputes(): DeliveryDispute[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw) as DeliveryDispute[];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function writeDisputes(list: DeliveryDispute[]) {
  const trimmed = list.slice(0, 80);
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(trimmed));
  } catch {
    /* ignore */
  }
  void invoke("xu_set_delivery_disputes", { disputesJson: JSON.stringify(trimmed) }).catch(
    () => undefined,
  );
  window.dispatchEvent(new CustomEvent(EVENT));
}

export function getDeliveryDisputes(): DeliveryDispute[] {
  return readDisputes();
}

export function getOpenDisputeForEmployee(employeeId: string): DeliveryDispute | undefined {
  return readDisputes().find(
    (d) => d.employeeId === employeeId && (d.status === "open" || d.status === "discussing"),
  );
}

function detectGaps(duty: string, checklist: string[], deliveryBody: string): string[] {
  const gaps: string[] = [];
  const body = deliveryBody.toLowerCase();
  const dutyTrim = duty.trim();
  if (dutyTrim.length > 12 && !body.includes(dutyTrim.slice(0, 8).toLowerCase())) {
    gaps.push(`交付摘要未体现任务要求：${dutyTrim.slice(0, 120)}`);
  }
  for (const item of checklist) {
    const t = item.trim();
    if (t.length < 4) continue;
    const token = t.slice(0, Math.min(12, t.length)).toLowerCase();
    if (!body.includes(token)) {
      gaps.push(`清单项可能未覆盖：${t}`);
    }
  }
  if (deliveryBody.trim().length < 40 && checklist.length > 0) {
    gaps.push("交付说明过短，可能未完成要求");
  }
  return gaps.slice(0, 5);
}

function pickPeerReviewers(
  project: ProjectTheme,
  employees: Employee[],
  assigneeId: string,
): Employee[] {
  const pool = employees.filter(
    (e) =>
      project.assignments.some((a) => a.employeeId === e.id) &&
      e.id !== assigneeId &&
      e.roleKind !== "boss",
  );
  const reviewers = pool.filter(
    (e) =>
      e.roleKind === "reviewer" ||
      /审核|测试|质检|review|qa/i.test(e.role) ||
      /审核|测试|质检|review|qa/i.test(e.agentRoleId || ""),
  );
  const pick = (reviewers.length ? reviewers : pool).slice(0, 2);
  return pick;
}

async function markAssignment(
  project: ProjectTheme,
  employeeId: string,
  status: ProjectAssignment["status"],
) {
  const next: ProjectTheme = {
    ...project,
    assignments: project.assignments.map((a) =>
      a.employeeId === employeeId ? { ...a, status } : a,
    ),
    updatedAt: Date.now(),
  };
  await saveProjectTheme(next);
}

async function runPeerDiscussion(
  project: ProjectTheme,
  assignee: Employee,
  peers: Employee[],
  gaps: string[],
  disputeId: string,
) {
  const gapText = gaps.join("\n- ");
  for (const peer of peers) {
    const msg = [
      `【交付复核 · ${project.name}】`,
      `同事 ${assignee.name} 的交付可能与任务要求不一致：`,
      `- ${gapText}`,
      "",
      "请用中文简要说明：问题在哪、建议如何修正。不要改文件，只输出讨论结论（200 字内）。",
    ].join("\n");
    await dispatchEmployeeTask(peer, {
      task: msg,
      workspaceRoot: peer.workspaceRoot || assignee.workspaceRoot,
      projectId: project.id,
      qaMode: true,
      forceNewSession: true,
    });
  }
  const list = readDisputes();
  const idx = list.findIndex((d) => d.id === disputeId);
  if (idx >= 0) {
    list[idx] = {
      ...list[idx]!,
      status: "discussing",
      discussionSummary: `已请 ${peers.map((p) => p.name).join("、")} 复核`,
      updatedAt: Date.now(),
    };
    writeDisputes(list);
  }
}

async function escalateToBoss(project: ProjectTheme, assignee: Employee, gaps: string[]) {
  const text = [
    `【交付争议 · ${project.name}】`,
    `员工 ${assignee.name} 的交付与任务要求可能不一致：`,
    gaps.map((g) => `- ${g}`).join("\n"),
    "",
    "同事讨论未能自动消除分歧，请老板拍板或重新派活。",
  ].join("\n");
  await notifyBoss({
    kind: "delivery-review",
    title: `交付争议 · ${project.name}`,
    body: text,
    mirrorOffice: true,
  });
  void fouAlert(`已通知老板处理：${assignee.name} 交付争议`, "提示");
}

export async function handleDeliveryReviewRequest(payload: {
  employeeId: string;
  taskText: string;
  deliveryBody: string;
}): Promise<void> {
  const theme = await loadProjectTheme();
  if (!theme || theme.runtimeStatus !== "running") return;
  if (!theme.assignments?.length) return;

  const employees = await loadEmployees().catch(() => readEmployees());
  const assignee = employees.find((e) => e.id === payload.employeeId);
  const assignment = theme.assignments.find((a) => a.employeeId === payload.employeeId);
  if (!assignee || !assignment) return;

  const gaps = detectGaps(assignment.duty, assignment.checklist, payload.deliveryBody);
  if (!gaps.length) return;

  const dispute: DeliveryDispute = {
    id: `dr_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    employeeId: assignee.id,
    employeeName: assignee.name,
    projectId: theme.id,
    projectName: theme.name,
    taskText: payload.taskText,
    deliveryBody: payload.deliveryBody,
    gaps,
    status: "open",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  writeDisputes([dispute, ...readDisputes()]);
  await markAssignment(theme, assignee.id, "error");

  const peers = pickPeerReviewers(theme, employees, assignee.id);
  if (peers.length) {
    await runPeerDiscussion(theme, assignee, peers, gaps, dispute.id);
    fouMsg.info(`${assignee.name} 交付待复核，已发起同事讨论`);
    return;
  }

  await escalateToBoss(theme, assignee, gaps);
  const list = readDisputes();
  const idx = list.findIndex((d) => d.id === dispute.id);
  if (idx >= 0) {
    list[idx] = { ...list[idx]!, status: "escalated", updatedAt: Date.now() };
    writeDisputes(list);
  }
}

export async function ensureDeliveryReviewBridge(): Promise<void> {
  if (bridgeStarted) return;
  bridgeStarted = true;
  unlisten = await listen<{
    employeeId: string;
    taskText: string;
    deliveryBody: string;
  }>("xu:delivery-review-request", (ev) => {
    const p = ev.payload;
    if (!p?.employeeId) return;
    void handleDeliveryReviewRequest(p).catch((e) => {
      console.warn("[delivery-review]", e);
    });
  });
}

export function stopDeliveryReviewBridge() {
  unlisten?.();
  unlisten = null;
  bridgeStarted = false;
}

/** MCP / 工具：手动升级老板 */
export async function escalateDeliveryDispute(disputeId: string): Promise<void> {
  const list = readDisputes();
  const d = list.find((x) => x.id === disputeId);
  if (!d) return;
  const employees = readEmployees();
  const assignee = employees.find((e) => e.id === d.employeeId);
  if (!assignee) return;
  const theme = await loadProjectTheme();
  if (!theme) return;
  await escalateToBoss(theme, assignee, d.gaps);
  d.status = "escalated";
  d.updatedAt = Date.now();
  writeDisputes(list);
}
