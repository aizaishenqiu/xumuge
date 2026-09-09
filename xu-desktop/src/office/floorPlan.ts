/**
 * Surround floor plan: large central open desk area + perimeter enclosed rooms.
 * Shell walls / door headers / seating zones derive from layout.rooms + meta.
 */

import {
  isRoomKind,
  ROOM_DEFAULT_LABEL,
  type OfficeLayout,
  type OfficeProp,
  type PropKind,
} from "./catalog";
import { BRAND_NAME_ZH } from "../utils/brandSettings";

export type FloorAreaMeta = {
  floorWidth?: number;
  floorDepth?: number;
  ringDepth?: number;
  /** surround = open center + ring rooms; open_hall = mostly open; blank = empty shell */
  layoutMode?: "surround" | "open_hall" | "blank";
};

export type FloorRoomDef = {
  id: string;
  name: string;
  weight?: number;
  kind?: PropKind | string;
  /** Agency divisions allowed to sit here */
  allowedDivisions?: string[];
  /** open = central plaza; perimeter = enclosed ring room */
  zone?: "open" | "perimeter";
};

export type FloorRoomRect = FloorRoomDef & {
  xMin: number;
  xMax: number;
  zMin: number;
  zMax: number;
  centerX: number;
  centerZ: number;
  /** Inner wall facing the open plaza (for door) */
  doorWall: "x" | "z";
  doorX: number;
  doorZ: number;
  leftWallX: number | null;
};

export type FloorGeometry = {
  xLeft: number;
  xRight: number;
  zBack: number;
  zFront: number;
  ringDepth: number;
  open: { xMin: number; xMax: number; zMin: number; zMax: number };
  /** Vertical partition X positions (between rooms / ring) */
  partitions: number[];
  /** Horizontal partition Z positions */
  partitionsZ: number[];
  rects: FloorRoomRect[];
  mainEntrance: { x: number; z: number; half: number };
  layoutMode: "surround" | "open_hall" | "blank";
};

export const FLOOR_DOOR_HALF = 0.55;
export const MAIN_ENTRANCE_HALF = 0.95;
export const DEFAULT_FLOOR_WIDTH = 24;
export const DEFAULT_FLOOR_DEPTH = 18;
export const DEFAULT_RING_DEPTH = 4.2;
/** shellRev 3: default = single open hall (no room-in-room) */
export const SHELL_REV = 3;

/** @deprecated use geometry from computeFloorGeometry */
export const FLOOR_Z_BACK = -DEFAULT_FLOOR_DEPTH / 2;
export const FLOOR_Z_FRONT = DEFAULT_FLOOR_DEPTH / 2;
export const FLOOR_DOOR_Z = 2.2;

/** Default: one big open office — user partitions with furniture. */
const DEFAULT_ROOMS: FloorRoomDef[] = [
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
];

export function defaultFloorRooms(): FloorRoomDef[] {
  return DEFAULT_ROOMS.map((r) => ({
    ...r,
    allowedDivisions: r.allowedDivisions ? [...r.allowedDivisions] : undefined,
  }));
}

export function resolveAreaMeta(layout: OfficeLayout | null | undefined): Required<FloorAreaMeta> & {
  shellRev: number;
} {
  const m = layout?.meta ?? {};
  const mode = m.layoutMode ?? "open_hall";
  return {
    floorWidth: Math.max(16, Math.min(48, m.floorWidth ?? DEFAULT_FLOOR_WIDTH)),
    floorDepth: Math.max(12, Math.min(36, m.floorDepth ?? DEFAULT_FLOOR_DEPTH)),
    ringDepth: Math.max(3.2, Math.min(6, m.ringDepth ?? DEFAULT_RING_DEPTH)),
    layoutMode: mode,
    shellRev: m.shellRev ?? 0,
  };
}

export function resolveFloorRooms(layout: OfficeLayout | null | undefined): FloorRoomDef[] {
  if (layout?.rooms && layout.rooms.length > 0) {
    return layout.rooms.map((r) => ({
      id: r.id,
      name: r.name,
      weight: r.weight ?? 1,
      kind: r.kind,
      allowedDivisions: r.allowedDivisions,
      zone: r.zone ?? inferZone(r),
    }));
  }
  const fromProps =
    layout?.props.filter((p) => isRoomKind(p.kind)).map((p) => ({
      id: p.id,
      name: p.meta?.roomLabel || p.meta?.text || ROOM_DEFAULT_LABEL[p.kind] || p.kind,
      weight: 1,
      kind: p.kind,
      zone: "perimeter" as const,
      allowedDivisions: divisionsForRoomKind(p.kind),
    })) ?? [];
  if (fromProps.length > 0) {
    return [
      {
        id: "open",
        name: "开敞工位区",
        weight: 2,
        zone: "open",
        allowedDivisions: ["engineering", "product", "design", "testing", "project-management", "software-company"],
      },
      ...fromProps,
    ];
  }
  return defaultFloorRooms();
}

function inferZone(r: { id: string; name: string; zone?: string }): "open" | "perimeter" {
  if (r.zone === "open" || r.zone === "perimeter") return r.zone;
  if (/开敞|综合|工位|open|staff|ops/i.test(r.id + r.name)) return "open";
  return "perimeter";
}

export function divisionsForRoomKind(kind: string): string[] {
  switch (kind) {
    case "room_finance":
      return ["finance"];
    case "room_sales":
      return ["sales", "marketing", "paid-media"];
    case "room_tech":
    case "room_code":
      return ["engineering", "testing", "software-company"];
    case "room_procure":
      return ["support", "finance"];
    default:
      return [];
  }
}

export function computeFloorGeometry(
  rooms: FloorRoomDef[],
  area?: FloorAreaMeta,
): FloorGeometry {
  const meta: Required<FloorAreaMeta> = {
    floorWidth: area?.floorWidth ?? DEFAULT_FLOOR_WIDTH,
    floorDepth: area?.floorDepth ?? DEFAULT_FLOOR_DEPTH,
    ringDepth: area?.ringDepth ?? DEFAULT_RING_DEPTH,
    layoutMode: area?.layoutMode ?? "open_hall",
  };
  const xLeft = -meta.floorWidth / 2;
  const xRight = meta.floorWidth / 2;
  const zBack = -meta.floorDepth / 2;
  const zFront = meta.floorDepth / 2;
  // open_hall / blank: no ring — whole floor is one office
  const R = meta.layoutMode === "surround" ? meta.ringDepth : 0.12;
  const open = {
    xMin: xLeft + R,
    xMax: xRight - R,
    zMin: zBack + R,
    zMax: zFront - R,
  };
  const mainEntrance = { x: 0, z: zFront, half: MAIN_ENTRANCE_HALF };

  const list = rooms.length > 0 ? rooms : defaultFloorRooms();
  let openDefs = list.filter((r) => (r.zone ?? inferZone(r)) === "open");
  let periDefs = list.filter((r) => (r.zone ?? inferZone(r)) === "perimeter");
  if (meta.layoutMode === "blank") {
    return {
      xLeft,
      xRight,
      zBack,
      zFront,
      ringDepth: R,
      open: { xMin: xLeft + 0.2, xMax: xRight - 0.2, zMin: zBack + 0.2, zMax: zFront - 0.2 },
      partitions: [],
      partitionsZ: [],
      rects: [
        {
          id: "open",
          name: "空白场地",
          zone: "open",
          xMin: xLeft + 0.2,
          xMax: xRight - 0.2,
          zMin: zBack + 0.2,
          zMax: zFront - 0.2,
          centerX: 0,
          centerZ: 0,
          doorWall: "z",
          doorX: 0,
          doorZ: zFront - 0.5,
          leftWallX: null,
        },
      ],
      mainEntrance,
      layoutMode: "blank",
    };
  }
  if (openDefs.length === 0) {
    openDefs = [
      {
        id: "open",
        name: "开敞工位区",
        weight: 2,
        zone: "open",
        allowedDivisions: ["engineering", "product", "design", "testing", "project-management", "software-company"],
      },
    ];
  }
  if (meta.layoutMode === "open_hall") {
    periDefs = [];
  }

  const rects: FloorRoomRect[] = [];
  const partitions: number[] = [];
  const partitionsZ: number[] = [];

  // Open plaza rect
  const openDef = openDefs[0];
  rects.push({
    ...openDef,
    zone: "open",
    xMin: open.xMin,
    xMax: open.xMax,
    zMin: open.zMin,
    zMax: open.zMax,
    centerX: (open.xMin + open.xMax) / 2,
    centerZ: (open.zMin + open.zMax) / 2,
    doorWall: "z",
    doorX: 0,
    doorZ: open.zMax - 0.4,
    leftWallX: null,
  });

  if (periDefs.length === 0 || R < 0.5) {
    return {
      xLeft,
      xRight,
      zBack,
      zFront,
      ringDepth: R,
      open,
      partitions,
      partitionsZ,
      rects,
      mainEntrance,
      layoutMode: meta.layoutMode,
    };
  }

  // Distribute perimeter rooms: prefer back wall, then left, then right
  const n = periDefs.length;
  const backN = Math.ceil(n / 2);
  const sideN = n - backN;
  const leftN = Math.ceil(sideN / 2);
  const rightN = sideN - leftN;

  const backRooms = periDefs.slice(0, backN);
  const leftRooms = periDefs.slice(backN, backN + leftN);
  const rightRooms = periDefs.slice(backN + leftN);

  // Inner ring wall Z (back)
  partitionsZ.push(open.zMin);
  // Inner ring wall Z (front sides leave entrance)
  partitionsZ.push(open.zMax);
  partitions.push(open.xMin);
  partitions.push(open.xMax);

  // Back rooms along north strip
  {
    const span = open.xMax - open.xMin;
    let cursor = open.xMin;
    const weights = backRooms.map((r) => Math.max(0.5, r.weight ?? 1));
    const sum = weights.reduce((a, b) => a + b, 0) || 1;
    for (let i = 0; i < backRooms.length; i++) {
      const w = (weights[i] / sum) * span;
      const xMin = cursor;
      const xMax = cursor + w;
      if (i > 0) partitions.push(xMin);
      const cx = (xMin + xMax) / 2;
      rects.push({
        ...backRooms[i],
        zone: "perimeter",
        xMin,
        xMax,
        zMin: zBack + 0.15,
        zMax: open.zMin,
        centerX: cx,
        centerZ: (zBack + open.zMin) / 2,
        doorWall: "z",
        doorX: cx,
        doorZ: open.zMin,
        leftWallX: i > 0 ? xMin : null,
      });
      cursor = xMax;
    }
  }

  // Left rooms along west strip
  {
    const span = open.zMax - open.zMin;
    let cursor = open.zMin;
    const weights = leftRooms.map((r) => Math.max(0.5, r.weight ?? 1));
    const sum = weights.reduce((a, b) => a + b, 0) || 1;
    for (let i = 0; i < leftRooms.length; i++) {
      const h = (weights[i] / sum) * span;
      const zMin = cursor;
      const zMax = cursor + h;
      if (i > 0) partitionsZ.push(zMin);
      const cz = (zMin + zMax) / 2;
      rects.push({
        ...leftRooms[i],
        zone: "perimeter",
        xMin: xLeft + 0.15,
        xMax: open.xMin,
        zMin,
        zMax,
        centerX: (xLeft + open.xMin) / 2,
        centerZ: cz,
        doorWall: "x",
        doorX: open.xMin,
        doorZ: cz,
        leftWallX: open.xMin,
      });
      cursor = zMax;
    }
  }

  // Right rooms along east strip
  {
    const span = open.zMax - open.zMin;
    let cursor = open.zMin;
    const weights = rightRooms.map((r) => Math.max(0.5, r.weight ?? 1));
    const sum = weights.reduce((a, b) => a + b, 0) || 1;
    for (let i = 0; i < rightRooms.length; i++) {
      const h = (weights[i] / sum) * span;
      const zMin = cursor;
      const zMax = cursor + h;
      if (i > 0) partitionsZ.push(zMin);
      const cz = (zMin + zMax) / 2;
      rects.push({
        ...rightRooms[i],
        zone: "perimeter",
        xMin: open.xMax,
        xMax: xRight - 0.15,
        zMin,
        zMax,
        centerX: (open.xMax + xRight) / 2,
        centerZ: cz,
        doorWall: "x",
        doorX: open.xMax,
        doorZ: cz,
        leftWallX: open.xMax,
      });
      cursor = zMax;
    }
  }

  return {
    xLeft,
    xRight,
    zBack,
    zFront,
    ringDepth: R,
    open,
    partitions: [...new Set(partitions)].sort((a, b) => a - b),
    partitionsZ: [...new Set(partitionsZ)].sort((a, b) => a - b),
    rects,
    mainEntrance,
    layoutMode: meta.layoutMode,
  };
}

export function roomAtPoint(rects: FloorRoomRect[], x: number, z: number): FloorRoomRect | null {
  return rects.find((r) => x >= r.xMin && x <= r.xMax && z >= r.zMin && z <= r.zMax) ?? null;
}

export function roomAtX(rects: FloorRoomRect[], x: number): FloorRoomRect | null {
  return rects.find((r) => x >= r.xMin && x <= r.xMax) ?? null;
}

function listToRooms(rooms: FloorRoomDef[]): NonNullable<OfficeLayout["rooms"]> {
  return rooms.map((r, i) => ({
    id: r.id || `room_${i}`,
    name: r.name,
    weight: r.weight ?? 1,
    kind: r.kind,
    allowedDivisions: r.allowedDivisions,
    zone: r.zone ?? inferZone(r),
  }));
}

/** Build furniture + doors for surround / open_hall layouts. */
export function furnishRooms(
  rooms: FloorRoomDef[],
  deskCount: number,
  opts?: { companyName?: string; area?: FloorAreaMeta; receptionKind?: PropKind },
): { layout: OfficeLayout; rects: FloorRoomRect[] } {
  const area = opts?.area ?? {};
  const mode = area.layoutMode ?? "open_hall";
  const normalized = rooms.map((r) => ({ ...r, zone: r.zone ?? inferZone(r) }));
  const geo = computeFloorGeometry(normalized, { ...area, layoutMode: mode });
  const props: OfficeProp[] = [];
  let seat = 0;
  const company = opts?.companyName || BRAND_NAME_ZH;
  const receptionKind = (opts?.receptionKind || "reception_marble") as PropKind;

  // Main double glass entrance — single continuous opening, no gaps
  props.push({
    id: "door_main_entrance",
    kind: "door_double_glass",
    x: geo.mainEntrance.x,
    y: 0,
    z: geo.zFront - 0.08,
    rotY: -Math.PI / 2,
    meta: { wall: true, text: "公司大门", roomLabel: "正门" },
  });

  const areaMeta = {
    floorWidth: geo.xRight - geo.xLeft,
    floorDepth: geo.zFront - geo.zBack,
    ringDepth: geo.ringDepth,
    layoutMode: mode,
    shellRev: SHELL_REV,
  };

  if (mode === "blank") {
    return {
      layout: {
        version: 1,
        rooms: listToRooms(normalized),
        meta: areaMeta,
        props,
      },
      rects: geo.rects,
    };
  }

  // Reception left of entrance + brand wall (not blocking the door)
  const recvX = -2.4;
  const recvZ = geo.open.zMax - (mode === "open_hall" ? 1.8 : 1.35);
  props.push({
    id: "reception_main",
    kind: receptionKind,
    x: recvX,
    y: 0,
    z: recvZ,
    rotY: Math.PI,
    meta: { text: `欢迎来到 ${company}` },
  });
  props.push({
    id: "banner_brand",
    kind: "banner",
    x: recvX,
    y: 0.35,
    z: geo.zFront - 0.28,
    rotY: -Math.PI / 2,
    meta: { text: company, wall: true },
  });

  for (const rect of geo.rects) {
    if (rect.zone === "open") {
      const n = Math.max(2, Math.min(16, deskCount));
      const cols = Math.min(4, Math.max(2, Math.ceil(Math.sqrt(n))));
      const rows = Math.ceil(n / cols);
      const usableW = rect.xMax - rect.xMin - 2.8;
      const usableD = Math.max(2, rect.zMax - rect.zMin - (mode === "open_hall" ? 4.2 : 3.2));
      for (let i = 0; i < n; i++) {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const x =
          rect.xMin +
          1.4 +
          (cols === 1 ? usableW / 2 : (col / Math.max(1, cols - 1)) * usableW);
        const z =
          rect.zMin +
          1.2 +
          (rows === 1 ? usableD / 2 : (row / Math.max(1, rows - 1)) * usableD);
        props.push({
          id: `desk_open_${i}`,
          kind: "desk",
          x,
          y: 0,
          z,
          rotY: 0,
          meta: { deskIndex: seat++, seatCount: 1, lit: false, roomId: rect.id },
        });
      }
      continue;
    }

    // Perimeter room: inner door toward plaza
    if (rect.doorWall === "z") {
      props.push({
        id: `door_${rect.id}`,
        kind: "door",
        x: rect.doorX,
        y: 0,
        z: rect.doorZ,
        rotY: -Math.PI / 2,
        meta: { wall: true, text: rect.name, roomLabel: rect.name },
      });
    } else {
      props.push({
        id: `door_${rect.id}`,
        kind: "door",
        x: rect.doorX,
        y: 0,
        z: rect.doorZ,
        rotY: 0,
        meta: { wall: true, text: rect.name, roomLabel: rect.name },
      });
    }

    const name = rect.name;
    const isBoss = /老板|总裁|高管|董事|经理室|总经理/.test(name);
    const isTea = /茶水|休息|会客|接待/.test(name);
    const isMeeting = /会议/.test(name);

    if (isBoss) {
      props.push({
        id: `exec_${rect.id}`,
        kind: "desk_exec",
        x: rect.centerX,
        y: 0,
        z: rect.centerZ - 0.3,
        rotY: Math.PI,
        meta: { lit: true, roomId: rect.id },
      });
      props.push({
        id: `chair_${rect.id}`,
        kind: "chair_exec",
        x: rect.centerX,
        y: 0,
        z: rect.centerZ + 0.55,
        rotY: 0,
      });
    } else if (isTea) {
      props.push({
        id: `sofa_${rect.id}`,
        kind: "sofa_large",
        x: rect.centerX,
        y: 0,
        z: rect.centerZ - 0.4,
        rotY: 0,
      });
      props.push({
        id: `water_${rect.id}`,
        kind: "water_dispenser",
        x: rect.xMax - 0.5,
        y: 0,
        z: rect.zMax - 0.5,
        rotY: 0,
      });
    } else if (isMeeting) {
      props.push({
        id: `bench_${rect.id}`,
        kind: "desk_bench",
        x: rect.centerX,
        y: 0,
        z: rect.centerZ,
        rotY: 0,
        meta: { deskIndex: seat, deskIndex2: seat + 1, seatCount: 2, lit: true, roomId: rect.id },
      });
      seat += 2;
      props.push({
        id: `wb_${rect.id}`,
        kind: "whiteboard",
        x: rect.centerX,
        y: 0.35,
        z: rect.zMin + 0.25,
        rotY: 0,
        meta: { wall: true },
      });
    } else {
      const n = 2;
      for (let i = 0; i < n; i++) {
        props.push({
          id: `desk_${rect.id}_${i}`,
          kind: "desk",
          x: rect.centerX + (i === 0 ? -0.7 : 0.7),
          y: 0,
          z: rect.centerZ,
          rotY: 0,
          meta: { deskIndex: seat++, seatCount: 1, lit: false, roomId: rect.id },
        });
      }
    }

    props.push({
      id: `banner_${rect.id}`,
      kind: "banner",
      x: rect.centerX,
      y: 0.35,
      z: rect.doorWall === "z" ? rect.zMin + 0.2 : rect.centerZ,
      rotY: rect.doorWall === "z" ? -Math.PI / 2 : Math.PI / 2,
      meta: { text: name, wall: true },
    });
  }

  return {
    layout: {
      version: 1,
      rooms: listToRooms(normalized),
      meta: areaMeta,
      props,
    },
    rects: geo.rects,
  };
}

export function withRooms(layout: OfficeLayout, rooms: FloorRoomDef[]): OfficeLayout {
  return { ...layout, rooms: listToRooms(rooms) };
}

/** 环绕总部：中央开敞 + 周边贴外墙封闭房（参考平面图） */
export function surroundHqRooms(): FloorRoomDef[] {
  return [
    {
      id: "open",
      name: "开敞工位区",
      weight: 2.4,
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
      ],
    },
    {
      id: "meeting",
      name: "会议室",
      weight: 1.2,
      zone: "perimeter",
      allowedDivisions: ["product", "project-management", "engineering", "design"],
    },
    {
      id: "boss",
      name: "总经理办公室",
      weight: 1.15,
      zone: "perimeter",
      allowedDivisions: ["strategy", "specialized"],
    },
    {
      id: "tea",
      name: "茶水室",
      weight: 0.95,
      zone: "perimeter",
    },
    {
      id: "tech",
      name: "技术部",
      weight: 1.1,
      kind: "room_tech",
      zone: "perimeter",
      allowedDivisions: ["engineering", "testing", "software-company"],
    },
    {
      id: "finance",
      name: "财务部",
      weight: 1,
      kind: "room_finance",
      zone: "perimeter",
      allowedDivisions: ["finance"],
    },
    {
      id: "sales",
      name: "销售部",
      weight: 1.05,
      kind: "room_sales",
      zone: "perimeter",
      allowedDivisions: ["sales", "marketing", "paid-media"],
    },
    {
      id: "hr",
      name: "人事部",
      weight: 0.95,
      zone: "perimeter",
      allowedDivisions: ["support", "project-management"],
    },
  ];
}

/** 图10 经典环绕：前台/会议/行政财务/董事长 + 中央工位 */
export function surroundPlan10Rooms(): FloorRoomDef[] {
  return [
    {
      id: "open",
      name: "开敞工位区",
      weight: 2.6,
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
      ],
    },
    { id: "meeting", name: "会议室", weight: 1.25, zone: "perimeter" },
    { id: "archive", name: "档案室", weight: 0.85, zone: "perimeter" },
    {
      id: "chairman",
      name: "董事长室",
      weight: 1.3,
      zone: "perimeter",
      allowedDivisions: ["strategy", "specialized"],
    },
    {
      id: "manager",
      name: "经理室",
      weight: 1.05,
      zone: "perimeter",
      allowedDivisions: ["strategy", "product", "project-management"],
    },
    {
      id: "admin",
      name: "行政部",
      weight: 0.95,
      zone: "perimeter",
      allowedDivisions: ["support", "project-management"],
    },
    {
      id: "finance",
      name: "财务室",
      weight: 1,
      kind: "room_finance",
      zone: "perimeter",
      allowedDivisions: ["finance"],
    },
    { id: "rest", name: "休息室", weight: 0.9, zone: "perimeter" },
    { id: "storage", name: "杂物间", weight: 0.75, zone: "perimeter" },
  ];
}
