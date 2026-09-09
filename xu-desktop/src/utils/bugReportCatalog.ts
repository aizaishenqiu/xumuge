/**
 * @file 问题反馈栏目与严重度枚举
 * @author qiuye <yjk150@qq.com>
 * @date 2026-09-01
 * @updated 2026-09-04
 * @version 1.1.0
 * @category Config
 * @algo none
 */

export type BugSectionId =
  | "home_chat"
  | "voice_call"
  | "voice_settings"
  | "settings_model"
  | "settings_other"
  | "office"
  | "projects"
  | "team"
  | "memory"
  | "connections"
  | "account"
  | "packaging"
  | "other";

export type BugSeverity = "blocker" | "major" | "minor";

/** 库内仍可能出现历史 fixed；界面两态为 open / triaged */
export type BugReportStatus = "open" | "triaged" | "fixed";

export interface BugSectionOption {
  id: BugSectionId;
  label: string;
  icon: string;
}

export interface BugSeverityOption {
  id: BugSeverity;
  label: string;
  icon: string;
}

export interface BugStatusOption {
  id: BugReportStatus;
  label: string;
  icon: string;
}

/** 可直接点选的产品栏目。 */
export const BUG_SECTIONS: BugSectionOption[] = [
  { id: "home_chat", label: "首页 / 对话", icon: "home-4-line" },
  { id: "voice_call", label: "语音通话", icon: "phone-line" },
  { id: "voice_settings", label: "设置 · 语音与朗读", icon: "voiceprint-line" },
  { id: "settings_model", label: "设置 · 模型", icon: "brain-line" },
  { id: "settings_other", label: "设置 · 其它", icon: "settings-3-line" },
  { id: "office", label: "办公室", icon: "building-4-line" },
  { id: "projects", label: "项目", icon: "folder-3-line" },
  { id: "team", label: "团队 / 专家", icon: "team-line" },
  { id: "memory", label: "记忆", icon: "brain-line" },
  { id: "connections", label: "连接", icon: "links-line" },
  { id: "account", label: "个人中心 / 授权", icon: "user-3-line" },
  { id: "packaging", label: "安装包 / 启动", icon: "install-line" },
  { id: "other", label: "其它", icon: "more-line" },
];

export const BUG_SEVERITIES: BugSeverityOption[] = [
  { id: "blocker", label: "阻塞", icon: "error-warning-line" },
  { id: "major", label: "影响使用", icon: "alert-line" },
  { id: "minor", label: "体验", icon: "emotion-normal-line" },
];

/** 筛选/展示两态；旧 fixed 经 bugStatusLabel 显示为已处理 */
export const BUG_STATUSES: BugStatusOption[] = [
  { id: "open", label: "未处理", icon: "time-line" },
  { id: "triaged", label: "已处理", icon: "checkbox-circle-line" },
];

/** Duty: 栏目 id → 显示名；未知 id 回退原文。 */
export function bugSectionLabel(id: string): string {
  return BUG_SECTIONS.find((s) => s.id === id)?.label ?? id;
}

/** Duty: 严重度 → 显示名。 */
export function bugSeverityLabel(id: string): string {
  return BUG_SEVERITIES.find((s) => s.id === id)?.label ?? id;
}

/** Duty: 是否已处理（含历史 fixed）。 */
export function isBugProcessed(status: string): boolean {
  const s = String(status || "").trim();
  return s === "triaged" || s === "fixed";
}

/** Duty: 状态 → 显示名。 */
export function bugStatusLabel(id: string): string {
  if (isBugProcessed(id)) return "已处理";
  if (id === "open") return "未处理";
  return BUG_STATUSES.find((s) => s.id === id)?.label ?? id;
}
