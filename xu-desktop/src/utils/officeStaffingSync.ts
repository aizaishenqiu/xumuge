/**
 * @file officeStaffingSync.ts 项目团队与工位/分区自动对齐
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-30
 * @version 1.0.0
 * @category UI
 * @algo roster-desk-sync
 */

import {
  loadEmployees,
  nextFreeDeskIndex,
  readEmployees,
  saveEmployeesBatch,
  type Employee,
} from "./employees";
import type { XuProject } from "./projects";
import {
  applyHallZoneMode,
  readOfficeHallLayout,
  writeOfficeHallLayout,
  type HallZoneMode,
} from "./officeHallLayout";
import { clampDeskCount, readDeskCount, writeDeskCount } from "./officeSettings";

export const OFFICE_AUTO_SYNC_DESK_KEY = "xu.office.autoSyncDesk";

export type StaffingSyncResult = {
  deskCount: number;
  zoneMode: HallZoneMode;
  assigned: number;
  expanded: boolean;
};

/** 是否默认自动同步工位 */
export function readAutoSyncDesk(): boolean {
  try {
    const raw = localStorage.getItem(OFFICE_AUTO_SYNC_DESK_KEY);
    if (raw == null) return true;
    return raw === "1" || raw === "true";
  } catch {
    return true;
  }
}

export function writeAutoSyncDesk(enabled: boolean): void {
  try {
    localStorage.setItem(OFFICE_AUTO_SYNC_DESK_KEY, enabled ? "1" : "0");
  } catch {
    /* ignore */
  }
}

/** 按项目类型推荐分区模式 */
export function zoneModeForProject(project?: XuProject | null): HallZoneMode {
  if (!project) return "studio_full";
  if (project.type === "software") return "rd_collab";
  if (project.type === "consulting" || project.type === "delivery") return "open_startup";
  return "studio_full";
}

/** 将工位数与分区对齐到项目团队 */
export async function syncOfficeToProjectTeam(opts: {
  employeeIds: string[];
  project?: XuProject | null;
  presetHint?: HallZoneMode;
  autoAssignDesks?: boolean;
}): Promise<StaffingSyncResult> {
  const ids = [...new Set(opts.employeeIds.filter(Boolean))];
  const needed = clampDeskCount(Math.max(2, ids.length));
  const prevCount = readDeskCount();
  const expanded = needed > prevCount;
  if (expanded) writeDeskCount(needed);

  const zoneMode = opts.presetHint ?? zoneModeForProject(opts.project);
  applyHallZoneMode(zoneMode);
  writeOfficeHallLayout({ deskCount: needed });

  let assigned = 0;
  if (opts.autoAssignDesks !== false) {
    const roster = await loadEmployees().catch(() => readEmployees());
    const members = roster.filter((e) => ids.includes(e.id));
    const changed: Employee[] = [];
    let deskCount = readDeskCount();
    for (const emp of members) {
      if (emp.deskIndex != null && emp.deskIndex < deskCount) continue;
      const idx = nextFreeDeskIndex(deskCount, [...roster, ...changed]);
      if (idx == null) break;
      changed.push({ ...emp, deskIndex: idx });
      assigned += 1;
    }
    if (changed.length) {
      await saveEmployeesBatch(changed);
      window.dispatchEvent(new CustomEvent("xu-employees-changed"));
    }
  }

  return { deskCount: needed, zoneMode, assigned, expanded };
}

/** 花名册超过工位时一键补齐 */
export async function expandDesksToRoster(rosterCount?: number): Promise<number> {
  const roster = rosterCount ?? readEmployees().length;
  const needed = clampDeskCount(Math.max(readDeskCount(), roster));
  writeDeskCount(needed);
  writeOfficeHallLayout({ deskCount: needed });
  return needed;
}

/** 构建推荐文案（切换项目后提示用） */
export function staffingRecommendText(teamSize: number, zoneMode: HallZoneMode): string {
  const layout = readOfficeHallLayout();
  const labels: Record<HallZoneMode, string> = {
    studio_full: "标准大厅",
    meeting_first: "会议优先",
    open_startup: "创业大开间",
    rd_collab: "研发协作",
  };
  return `已为 ${teamSize} 人推荐 ${neededDeskLabel(teamSize)} 工位 · ${labels[zoneMode]} 分区（当前 ${layout.deskCount} 席）`;
}

function neededDeskLabel(n: number): string {
  return `${clampDeskCount(Math.max(2, n))}`;
}
