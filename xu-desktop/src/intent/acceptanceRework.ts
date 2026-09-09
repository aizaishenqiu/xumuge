import { invoke } from "@tauri-apps/api/core";
import { appendFouMessage } from "../utils/employees";
import { dispatchEmployeeTask } from "../employee/dispatch";
import { ensureEmployeesForRoleIds } from "../utils/employees";
import type { XuProject } from "../utils/projects";
import { OFFICE_FLOOR, peerSessionTag, BOSS_PEER_ID } from "../utils/officeComms";
import type { AcceptanceReviewResult } from "./acceptanceReview";
import { findQaRoleIdForRework } from "./roleSkillScaffold";
import { loadCodeExecPrefs } from "../utils/codeExecPrefs";

const OFFICE_SESSION = peerSessionTag(BOSS_PEER_ID, OFFICE_FLOOR);

const autoReworkCooldown = new Map<string, number>();
const AUTO_REWORK_COOLDOWN_MS = 15 * 60 * 1000;

export function acceptanceReviewSettingKey(projectId: string): string {
  return `xu.acceptance_review.${projectId}`;
}

export async function saveAcceptanceReviewSnapshot(
  projectId: string,
  result: AcceptanceReviewResult,
): Promise<void> {
  await invoke("xu_set_setting", {
    key: acceptanceReviewSettingKey(projectId),
    value: JSON.stringify({ ...result, savedAt: Date.now() }),
  });
}

export async function loadAcceptanceReviewSnapshot(
  projectId: string,
): Promise<(AcceptanceReviewResult & { savedAt?: number }) | null> {
  try {
    const raw = await invoke<string | null>("xu_get_setting", {
      key: acceptanceReviewSettingKey(projectId),
    });
    if (!raw) return null;
    return JSON.parse(raw) as AcceptanceReviewResult & { savedAt?: number };
  } catch {
    return null;
  }
}

/**
 * Dispatch rework for weak acceptance items (Boss manual or auto).
 */
async function dispatchAcceptanceRework(opts: {
  project: XuProject;
  weak: string[];
  trigger: "boss" | "auto";
  bossText?: string;
  preferEmployeeId?: string;
}): Promise<{ ok: boolean; message: string }> {
  const weak = opts.weak.slice(0, 8);
  if (!weak.length) {
    return { ok: false, message: "无弱项可返工。" };
  }

  const gen = (opts.project.generatePath || "").trim();
  if (!gen) {
    return { ok: false, message: "项目未设生成路径，无法派返工。" };
  }

  const qaRoleId = findQaRoleIdForRework();
  const roleIds = qaRoleId ? [qaRoleId] : [];
  let employees = roleIds.length ? await ensureEmployeesForRoleIds(roleIds) : [];
  if (!employees.length && opts.preferEmployeeId) {
    const { readEmployees } = await import("../utils/employees");
    const emp = readEmployees().find((e) => e.id === opts.preferEmployeeId);
    if (emp) employees = [emp];
  }
  if (!employees.length) {
    return {
      ok: false,
      message: "未找到 QA 岗位或目标员工，请手动派活。弱项：" + weak.join("；"),
    };
  }

  const emp = employees[0]!;
  const header =
    opts.trigger === "auto"
      ? "【自动验收返工 · 速检弱项】"
      : "【验收返工 · Boss 指令】";
  const task = [
    header,
    opts.bossText?.trim().slice(0, 500) || "",
    "",
    "上次验收速检弱项（必须逐条处理）：",
    ...weak.map((w, i) => `${i + 1}. ${w}`),
    "",
    "请 read_file Brief/playbook 与 local-context-router Skill，对照弱项补交付或测试报告，文末输出 XU_ACCEPTANCE_REPORT。",
  ]
    .filter((line, i, arr) => !(i > 0 && line === "" && arr[i - 1] === ""))
    .join("\n");

  await dispatchEmployeeTask(
    { ...emp, workspaceRoot: emp.workspaceRoot || gen },
    {
      task,
      projectId: opts.project.id,
      directImplement: true,
      workspaceRoot: emp.workspaceRoot || gen,
    },
  );

  const prefix = opts.trigger === "auto" ? "🤖 自动" : "♻️";
  const msg = `${prefix} 已派 ${emp.name} 按验收弱项返工（${weak.length} 条）。`;
  await appendFouMessage({
    sessionTag: OFFICE_SESSION,
    employeeId: emp.id,
    role: "system",
    content: msg,
  });
  return { ok: true, message: msg };
}

/**
 * Boss says「验收返工」→ 按上次速检弱项派 QA（或上次员工）返工。
 */
export async function handleAcceptanceRework(opts: {
  project: XuProject;
  bossText: string;
}): Promise<{ ok: boolean; message: string }> {
  const snap = await loadAcceptanceReviewSnapshot(opts.project.id);
  if (!snap || (!snap.miss.length && !snap.selfReportOpen.length)) {
    return {
      ok: false,
      message: "暂无验收速检弱项记录。请先让员工交活并开启「交活后验收速检」，或手动描述返工项。",
    };
  }

  const weak = [...new Set([...snap.miss, ...snap.selfReportOpen])];
  return dispatchAcceptanceRework({
    project: opts.project,
    weak,
    trigger: "boss",
    bossText: opts.bossText,
    preferEmployeeId: snap.employeeId,
  });
}

/**
 * After acceptance review: optionally auto-dispatch QA (15 min cooldown per project).
 */
export async function maybeAutoAcceptanceRework(opts: {
  project: XuProject;
  result: AcceptanceReviewResult;
}): Promise<string | null> {
  const prefs = await loadCodeExecPrefs();
  if (!prefs.acceptanceAutoReworkOnMiss) return null;

  const weak = [...new Set([...opts.result.miss, ...opts.result.selfReportOpen])];
  if (!weak.length) return null;

  const now = Date.now();
  const cdKey = opts.project.id;
  if ((autoReworkCooldown.get(cdKey) || 0) + AUTO_REWORK_COOLDOWN_MS > now) {
    return null;
  }

  const r = await dispatchAcceptanceRework({
    project: opts.project,
    weak,
    trigger: "auto",
    preferEmployeeId: opts.result.employeeId,
  });
  if (r.ok) autoReworkCooldown.set(cdKey, now);
  return r.ok ? r.message : null;
}
