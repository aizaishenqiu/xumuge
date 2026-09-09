/**
 * @file virmoorHallLayouts.ts 3D 大厅工位槽位与分区模式定义
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-30
 * @version 1.0.0
 * @category UI
 * @algo layout-slot-table
 */

import type { HallZoneMode } from "../utils/officeHallLayout";

export type DeskSlotDef = { x: number; z: number; rotY: number; deskIndex: number };

export type HallLayoutDef = {
  slots: DeskSlotDef[];
  meetingCenter?: { x: number; z: number };
};

/** 标准 16 工位（与原版 studio 一致） */
const STUDIO_SLOTS: DeskSlotDef[] = [
  ...[-9.0, -5.8, -2.6, 2.6, 5.8, 9.0].map((x, i) => ({ x, z: -6.2, rotY: 0, deskIndex: i })),
  ...[-3.2, -0.2, 2.8, 5.8, 8.8].map((z, i) => ({ x: -10.6, z, rotY: Math.PI / 2, deskIndex: 6 + i })),
  ...[-3.2, -0.2, 2.8, 5.8, 8.8].map((z, i) => ({ x: 10.6, z, rotY: -Math.PI / 2, deskIndex: 11 + i })),
];

/** 会议优先：环列 12 工位 */
const MEETING_FIRST_SLOTS: DeskSlotDef[] = Array.from({ length: 12 }, (_, i) => {
  const a = (i / 12) * Math.PI * 2 + Math.PI;
  const r = 7.8;
  return {
    x: Math.sin(a) * r,
    z: Math.cos(a) * r - 0.4,
    rotY: Math.atan2(-Math.sin(a), -Math.cos(a)),
    deskIndex: i,
  };
});

/** 创业大开间：前排 + 后排 */
const OPEN_STARTUP_SLOTS: DeskSlotDef[] = [
  ...[-8, -4, 0, 4, 8].map((x, i) => ({ x, z: -5.5, rotY: 0, deskIndex: i })),
  ...[-8, -4, 0, 4, 8].map((x, i) => ({ x, z: -2.5, rotY: 0, deskIndex: 5 + i })),
  ...[-6, -2, 2, 6].map((x, i) => ({ x, z: 0.5, rotY: 0, deskIndex: 10 + i })),
  ...[-4, 0, 4].map((x, i) => ({ x, z: 3.2, rotY: 0, deskIndex: 14 + i })),
];

/** 研发协作：双列 16 工位 */
const RD_COLLAB_SLOTS: DeskSlotDef[] = [
  ...[-3.2, -0.2, 2.8, 5.8, 8.8, 11.2].map((z, i) => ({ x: -9.5, z, rotY: Math.PI / 2, deskIndex: i })),
  ...[-3.2, -0.2, 2.8, 5.8, 8.8, 11.2].map((z, i) => ({ x: 9.5, z, rotY: -Math.PI / 2, deskIndex: 6 + i })),
  ...[-2, 2].map((x, i) => ({ x, z: -6.8, rotY: 0, deskIndex: 12 + i })),
  ...[-2, 2].map((x, i) => ({ x, z: 12.5, rotY: Math.PI, deskIndex: 14 + i })),
];

const LAYOUT_TABLE: Record<HallZoneMode, HallLayoutDef> = {
  studio_full: { slots: STUDIO_SLOTS, meetingCenter: { x: 0, z: 0.4 } },
  meeting_first: { slots: MEETING_FIRST_SLOTS, meetingCenter: { x: 0, z: 0.4 } },
  open_startup: { slots: OPEN_STARTUP_SLOTS, meetingCenter: { x: 0, z: -8.5 } },
  rd_collab: { slots: RD_COLLAB_SLOTS, meetingCenter: { x: 0, z: 10.5 } },
};

/** 按模式与工位数返回有效槽位（截取前 N 个） */
export function deskSlotsForMode(mode: HallZoneMode, deskCount: number): DeskSlotDef[] {
  const def = LAYOUT_TABLE[mode] ?? LAYOUT_TABLE.studio_full;
  return def.slots.slice(0, Math.max(0, Math.min(deskCount, def.slots.length)));
}

/** 会议圆桌中心坐标 */
export function meetingCenterForMode(mode: HallZoneMode): { x: number; z: number } {
  return LAYOUT_TABLE[mode]?.meetingCenter ?? { x: 0, z: 0.4 };
}
