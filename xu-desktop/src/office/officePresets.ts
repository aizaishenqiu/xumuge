/**
 * Office floor presets.
 * 默认 = 三开间（老板 / 员工 / 茶水）。
 * 大开间 / 环绕总部 = 其他可选模板。
 */

import type { OfficeLayout } from "./catalog";
import {
  furnishRooms,
  surroundHqRooms,
  surroundPlan10Rooms,
  type FloorRoomDef,
} from "./floorPlan";
import { OFFICE_DESK_DEFAULT } from "../utils/officeSettings";
import { DEFAULT_COMPANY_NAME, readCompanyName } from "../utils/brandSettings";
import { buildThreeBayOfficeLayout } from "./threeBayLayout";

export type OfficeLayoutPresetId =
  | "open_hall"
  | "hq_full"
  | "hq_plan10"
  | "blank"
  | "standard_three"
  | "sales_finance"
  | "rd_collab"
  | "startup_compact"
  | "meeting_first"
  | "exec_focus";

export interface OfficeLayoutPreset {
  id: OfficeLayoutPresetId;
  name: string;
  description: string;
  icon: string;
  build: (deskCount?: number) => OfficeLayout;
}

function buildFromRooms(
  rooms: FloorRoomDef[],
  deskCount: number,
  area?: { floorWidth?: number; floorDepth?: number; layoutMode?: "surround" | "open_hall" | "blank" },
): OfficeLayout {
  return furnishRooms(rooms, deskCount, {
    companyName: DEFAULT_COMPANY_NAME,
    area: {
      floorWidth: area?.floorWidth ?? 24,
      floorDepth: area?.floorDepth ?? 18,
      layoutMode: area?.layoutMode ?? "open_hall",
    },
  }).layout;
}

/** 默认：一整间大办公室，用户用家具自行分区 */
function buildOpenHall(deskCount = OFFICE_DESK_DEFAULT): OfficeLayout {
  return buildFromRooms(
    [
      {
        id: "open",
        name: "大办公室",
        weight: 3,
        zone: "open",
        allowedDivisions: [
          "engineering",
          "product",
          "design",
          "testing",
          "project-management",
          "software-company",
          "sales",
          "marketing",
          "finance",
          "strategy",
          "support",
        ],
      },
    ],
    deskCount,
    { floorWidth: 24, floorDepth: 18, layoutMode: "open_hall" },
  );
}

function buildHqFull(deskCount = 8): OfficeLayout {
  return buildFromRooms(surroundHqRooms(), deskCount, {
    floorWidth: 26,
    floorDepth: 20,
    layoutMode: "surround",
  });
}

function buildHqPlan10(deskCount = 12): OfficeLayout {
  return buildFromRooms(surroundPlan10Rooms(), deskCount, {
    floorWidth: 28,
    floorDepth: 22,
    layoutMode: "surround",
  });
}

function buildBlank(_deskCount = 0): OfficeLayout {
  return buildFromRooms([{ id: "open", name: "空白场地", weight: 1, zone: "open" }], 0, {
    floorWidth: 24,
    floorDepth: 18,
    layoutMode: "blank",
  });
}

function buildThreeBay(deskCount = OFFICE_DESK_DEFAULT): OfficeLayout {
  let companyName = DEFAULT_COMPANY_NAME;
  try {
    companyName = readCompanyName();
  } catch {
    /* ignore */
  }
  return buildThreeBayOfficeLayout({ headcount: deskCount, companyName });
}

function buildStandardThree(deskCount = OFFICE_DESK_DEFAULT): OfficeLayout {
  return buildThreeBay(deskCount);
}

function buildSalesFinance(deskCount = 6): OfficeLayout {
  return buildFromRooms(
    [
      {
        id: "open",
        name: "开敞工位区",
        weight: 2,
        zone: "open",
        allowedDivisions: ["engineering", "product", "design", "sales", "marketing"],
      },
      { id: "boss", name: "老板办公室", weight: 1.2, zone: "perimeter", allowedDivisions: ["strategy"] },
      {
        id: "sales",
        name: "销售部",
        weight: 1.15,
        kind: "room_sales",
        zone: "perimeter",
        allowedDivisions: ["sales", "marketing", "paid-media"],
      },
      {
        id: "finance",
        name: "财务部",
        weight: 1.1,
        kind: "room_finance",
        zone: "perimeter",
        allowedDivisions: ["finance"],
      },
      { id: "tea", name: "会客茶水室", weight: 1.0, zone: "perimeter" },
    ],
    deskCount,
    { layoutMode: "surround" },
  );
}

function buildRdCollab(deskCount = 8): OfficeLayout {
  return buildFromRooms(
    [
      {
        id: "open",
        name: "研发开敞区",
        weight: 2.2,
        zone: "open",
        allowedDivisions: ["engineering", "testing", "product", "design", "software-company"],
      },
      { id: "boss", name: "老板办公室", weight: 1.1, zone: "perimeter", allowedDivisions: ["strategy"] },
      {
        id: "eng",
        name: "研发封闭室",
        weight: 1.2,
        kind: "room_tech",
        zone: "perimeter",
        allowedDivisions: ["engineering", "testing"],
      },
      { id: "meeting", name: "协作会议室", weight: 1.2, zone: "perimeter" },
      { id: "tea", name: "茶水室", weight: 0.95, zone: "perimeter" },
    ],
    deskCount,
    { layoutMode: "surround" },
  );
}

function buildStartupCompact(deskCount = 4): OfficeLayout {
  return buildFromRooms(
    [
      {
        id: "open",
        name: "团队大办公室",
        weight: 3,
        zone: "open",
        allowedDivisions: ["engineering", "product", "design", "sales", "marketing"],
      },
    ],
    Math.max(3, deskCount),
    { floorWidth: 18, floorDepth: 14, layoutMode: "open_hall" },
  );
}

function buildMeetingFirst(deskCount = 6): OfficeLayout {
  return buildFromRooms(
    [
      {
        id: "open",
        name: "工位开敞区",
        weight: 1.8,
        zone: "open",
        allowedDivisions: ["engineering", "product", "design", "project-management"],
      },
      { id: "boss", name: "老板办公室", weight: 1.1, zone: "perimeter", allowedDivisions: ["strategy"] },
      { id: "meeting", name: "主会议室", weight: 1.35, zone: "perimeter" },
      { id: "tea", name: "茶水室", weight: 0.95, zone: "perimeter" },
    ],
    deskCount,
    { layoutMode: "surround" },
  );
}

function buildExecFocus(deskCount = 4): OfficeLayout {
  return buildFromRooms(
    [
      {
        id: "open",
        name: "秘书开敞区",
        weight: 1.5,
        zone: "open",
        allowedDivisions: ["support", "project-management", "product"],
      },
      { id: "boss", name: "总裁办", weight: 1.4, zone: "perimeter", allowedDivisions: ["strategy"] },
      {
        id: "finance",
        name: "财务会签",
        weight: 1.0,
        kind: "room_finance",
        zone: "perimeter",
        allowedDivisions: ["finance"],
      },
      { id: "tea", name: "会客茶水室", weight: 1.1, zone: "perimeter" },
    ],
    deskCount,
    { layoutMode: "surround" },
  );
}

export const OFFICE_LAYOUT_PRESETS: OfficeLayoutPreset[] = [
  {
    id: "standard_three",
    name: "三开间（默认）",
    description: "左老板办公室 · 中员工区 · 右茶水休息区",
    icon: "building-4-line",
    build: buildThreeBay,
  },
  {
    id: "open_hall",
    name: "大开间",
    description: "一整间大办公室，无内套墙；用隔断/家具自行分区",
    icon: "layout-masonry-line",
    build: buildOpenHall,
  },
  {
    id: "hq_full",
    name: "环绕总部",
    description: "中央开敞工位 + 周边贴外墙的会议/总经办/部门房",
    icon: "community-line",
    build: buildHqFull,
  },
  {
    id: "hq_plan10",
    name: "经典环绕",
    description: "前台形象区 + 会议/行政财务/董事长，中央工位（参考平面图）",
    icon: "building-4-line",
    build: buildHqPlan10,
  },
  {
    id: "blank",
    name: "空白自绘",
    description: "空壳场地，自行摆放墙门与家具",
    icon: "draft-line",
    build: buildBlank,
  },
  {
    id: "sales_finance",
    name: "销售财务型",
    description: "开敞区 + 销售部 + 财务部 + 会客",
    icon: "funds-line",
    build: buildSalesFinance,
  },
  {
    id: "rd_collab",
    name: "研发协作型",
    description: "研发开敞区 + 封闭研发室 + 会议室",
    icon: "code-box-line",
    build: buildRdCollab,
  },
  {
    id: "startup_compact",
    name: "创业紧凑",
    description: "较小占地的大开间",
    icon: "rocket-line",
    build: buildStartupCompact,
  },
  {
    id: "meeting_first",
    name: "会议优先",
    description: "开敞工位 + 主会议室",
    icon: "team-line",
    build: buildMeetingFirst,
  },
  {
    id: "exec_focus",
    name: "高管专注",
    description: "总裁办 + 秘书开敞 + 财务会签",
    icon: "vip-crown-line",
    build: buildExecFocus,
  },
];

export function getOfficeLayoutPreset(id: string): OfficeLayoutPreset | undefined {
  return OFFICE_LAYOUT_PRESETS.find((p) => p.id === id);
}
