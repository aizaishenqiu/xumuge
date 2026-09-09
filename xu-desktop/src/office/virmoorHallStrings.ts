/**
 * @file virmoorHallStrings.ts 办公室 3D 大厅 HUD / 分区文案
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-30
 * @version 1.1.0
 * @category UI
 * @algo i18n-static
 */

import type { EmployeeStatus } from "../utils/employees";

export const hallStrings = {
  ask: "问询",
  plan: "计划",
  agent: "智能体",
  approve: "等你批准",
  zoneTea: "茶水区",
  zoneLounge: "休息区",
  zoneMeeting: "会议区",
  zoneFront: "前台",
} as const;

export type EmployeeBubbleView = {
  title: string;
  status: string;
  busy: boolean;
};

/** 职务 + 名字（第一行） */
export function employeeBubbleTitle(role: string, name: string): string {
  const r = role.trim();
  const n = name.trim() || "未命名";
  if (!r) return n;
  if (n === r) return r;
  return `${r} · ${n}`;
}

/** 是否处于忙碌（工作中 / 开会等） */
export function isEmployeeBusy(
  status: EmployeeStatus,
  liveState?: string | null,
): boolean {
  return (
    status === "working" ||
    status === "meeting" ||
    liveState === "working" ||
    liveState === "meeting" ||
    liveState === "running" ||
    liveState === "need_confirm"
  );
}

/** 员工头顶气泡：职务+名字 / 工作中|休闲中 */
export function employeeBubbleView(
  role: string,
  name: string,
  status: EmployeeStatus,
  liveState?: string | null,
): EmployeeBubbleView {
  const busy = isEmployeeBusy(status, liveState);
  return {
    title: employeeBubbleTitle(role, name),
    status: busy ? "工作中" : "休闲中",
    busy,
  };
}

/** @deprecated 使用 employeeBubbleView */
export function idleBubbleFor(name: string, role: string): string {
  return employeeBubbleTitle(role, name);
}

/** @deprecated 使用 employeeBubbleView */
export function workingBubbleFor(name: string, liveMsg?: string | null): string {
  const msg = liveMsg?.trim();
  if (msg) return msg.length > 48 ? `${msg.slice(0, 45)}…` : msg;
  return `${employeeBubbleTitle("", name)} · 工作中`;
}
