/**
 * @file officeHallLayout.ts 3D 大厅工位布局与分区模式配置
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-30
 * @version 1.0.0
 * @category UI
 * @algo localStorage-kv
 */

import { clampDeskCount, readDeskCount, writeDeskCount } from "./officeSettings";

export const OFFICE_HALL_LAYOUT_KEY = "xu.office.hallLayout";

export type HallZoneMode =
  | "studio_full"
  | "meeting_first"
  | "open_startup"
  | "rd_collab";

export type HallZoneToggles = {
  tea: boolean;
  lounge: boolean;
  meeting: boolean;
  front: boolean;
};

export type OfficeHallLayoutConfig = {
  zoneMode: HallZoneMode;
  deskCount: number;
  zones: HallZoneToggles;
};

export const HALL_ZONE_MODE_LABELS: Record<
  HallZoneMode,
  { name: string; description: string; icon: string }
> = {
  studio_full: {
    name: "标准大厅",
    description: "16 工位环绕 + 茶歇/休息/会议/前台",
    icon: "building-4-line",
  },
  meeting_first: {
    name: "会议优先",
    description: "圆桌居中加大，工位环列",
    icon: "presentation-line",
  },
  open_startup: {
    name: "创业大开间",
    description: "工位集中，弱化休闲区",
    icon: "layout-grid-line",
  },
  rd_collab: {
    name: "研发协作",
    description: "双列工位 + 白板区强调",
    icon: "code-box-line",
  },
};

const DEFAULT_ZONES: Record<HallZoneMode, HallZoneToggles> = {
  studio_full: { tea: true, lounge: true, meeting: true, front: true },
  meeting_first: { tea: true, lounge: false, meeting: true, front: true },
  open_startup: { tea: false, lounge: false, meeting: true, front: true },
  rd_collab: { tea: true, lounge: false, meeting: false, front: true },
};

export const DEFAULT_OFFICE_HALL_LAYOUT: OfficeHallLayoutConfig = {
  zoneMode: "studio_full",
  deskCount: readDeskCount(),
  zones: { ...DEFAULT_ZONES.studio_full },
};

function normalizeZones(
  raw: Partial<HallZoneToggles> | null | undefined,
  mode: HallZoneMode,
): HallZoneToggles {
  const d = DEFAULT_ZONES[mode];
  return {
    tea: typeof raw?.tea === "boolean" ? raw.tea : d.tea,
    lounge: typeof raw?.lounge === "boolean" ? raw.lounge : d.lounge,
    meeting: typeof raw?.meeting === "boolean" ? raw.meeting : d.meeting,
    front: typeof raw?.front === "boolean" ? raw.front : d.front,
  };
}

/** 归一化大厅布局配置 */
export function normalizeOfficeHallLayout(
  raw: Partial<OfficeHallLayoutConfig> | null | undefined,
): OfficeHallLayoutConfig {
  const mode =
    raw?.zoneMode === "meeting_first" ||
    raw?.zoneMode === "open_startup" ||
    raw?.zoneMode === "rd_collab" ||
    raw?.zoneMode === "studio_full"
      ? raw.zoneMode
      : "studio_full";
  return {
    zoneMode: mode,
    deskCount: clampDeskCount(raw?.deskCount ?? readDeskCount()),
    zones: normalizeZones(raw?.zones, mode),
  };
}

/** 读取 3D 大厅布局配置 */
export function readOfficeHallLayout(): OfficeHallLayoutConfig {
  try {
    const raw = localStorage.getItem(OFFICE_HALL_LAYOUT_KEY);
    if (!raw) {
      return normalizeOfficeHallLayout({
        ...DEFAULT_OFFICE_HALL_LAYOUT,
        deskCount: readDeskCount(),
      });
    }
    return normalizeOfficeHallLayout(JSON.parse(raw) as Partial<OfficeHallLayoutConfig>);
  } catch {
    return normalizeOfficeHallLayout(DEFAULT_OFFICE_HALL_LAYOUT);
  }
}

/** 写入布局并广播 fou-office-layout */
export function writeOfficeHallLayout(patch: Partial<OfficeHallLayoutConfig>): OfficeHallLayoutConfig {
  const prev = readOfficeHallLayout();
  const next = normalizeOfficeHallLayout({ ...prev, ...patch });
  if (patch.deskCount != null) {
    writeDeskCount(next.deskCount);
  } else {
    next.deskCount = readDeskCount();
  }
  try {
    localStorage.setItem(OFFICE_HALL_LAYOUT_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new CustomEvent("xu-office-layout", { detail: next }));
  return next;
}

/** 切换分区模式并应用推荐 zone 开关 */
export function applyHallZoneMode(mode: HallZoneMode): OfficeHallLayoutConfig {
  return writeOfficeHallLayout({
    zoneMode: mode,
    zones: { ...DEFAULT_ZONES[mode] },
  });
}
