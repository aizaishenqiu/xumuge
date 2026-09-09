/**
 * 传统三开间：左老板 · 中员工对坐 · 右茶水
 * 座位数 = headcount（每人一席，含老板大班台）。
 */

import {
  countLayoutSeats,
  newPropId,
  type OfficeLayout,
  type OfficeProp,
} from "./catalog";
import { SHELL_REV } from "./floorPlan";
import { DEFAULT_COMPANY_NAME } from "../utils/brandSettings";

export function buildThreeBayOfficeLayout(opts: {
  headcount: number;
  companyName?: string;
  projectId?: string;
}): OfficeLayout {
  const headcount = Math.max(1, Math.min(40, Math.floor(opts.headcount)));
  const staffSeats = headcount - 1; // seat 0 = boss
  const pairBenches = Math.floor(staffSeats / 2);
  const oddSingle = staffSeats % 2; // 0 or 1
  const company = opts.companyName?.trim() || DEFAULT_COMPANY_NAME;

  // Wider / deeper with team size so three bays stay readable
  const W = Math.min(36, Math.max(22, 20 + pairBenches * 0.6));
  const D = Math.min(24, Math.max(15, 13 + Math.ceil(pairBenches / 2) * 0.85));
  const xL = -W / 2;
  const xR = W / 2;
  const zB = -D / 2;
  const zF = D / 2;
  // Bay splits: ~28% boss | ~44% staff | ~28% tea
  const x1 = xL + W * 0.28;
  const x2 = xL + W * 0.72;
  const wallLen = D - 0.5;

  const props: OfficeProp[] = [];

  const push = (p: Omit<OfficeProp, "id"> & { kind: OfficeProp["kind"] }) => {
    props.push({ ...p, id: newPropId(p.kind) });
  };

  // Entrance
  push({
    kind: "door_double_glass",
    x: 0,
    y: 0,
    z: zF - 0.08,
    rotY: -Math.PI / 2,
    meta: { wall: true, text: "公司大门", roomLabel: "正门" },
  });

  // Bay divider walls (these ARE the boss / staff / tea rooms)
  push({
    kind: "wall",
    x: x1,
    y: 0,
    z: 0,
    rotY: 0,
    meta: { length: wallLen, height: 2.5 },
  });
  push({
    kind: "wall",
    x: x2,
    y: 0,
    z: 0,
    rotY: 0,
    meta: { length: wallLen, height: 2.5 },
  });
  push({
    kind: "door",
    x: x1,
    y: 0,
    z: zF * 0.25,
    rotY: 0,
    meta: { wall: true, cutHalf: 0.55 },
  });
  push({
    kind: "door",
    x: x2,
    y: 0,
    z: zF * 0.25,
    rotY: 0,
    meta: { wall: true, cutHalf: 0.55 },
  });

  const bossCx = (xL + x1) / 2;
  const staffCx = (x1 + x2) / 2;
  const teaCx = (x2 + xR) / 2;

  // —— 左：老板办公室 ——
  push({
    kind: "banner",
    x: bossCx,
    y: 0.4,
    z: zB + 0.32,
    rotY: Math.PI / 2,
    meta: { text: "老板办公室", wall: true, roomId: "boss" },
  });
  push({
    kind: "desk_exec",
    x: bossCx,
    y: 0,
    z: -0.35,
    rotY: Math.PI,
    meta: { deskIndex: 0, seatCount: 1, lit: true, roomId: "boss" },
  });
  push({
    kind: "chair_exec",
    x: bossCx,
    y: 0,
    z: 0.75,
    rotY: 0,
    meta: { roomId: "boss" },
  });
  push({
    kind: "plant_large",
    x: bossCx - Math.min(1.4, (x1 - xL) * 0.35),
    y: 0,
    z: zB + 1.15,
    rotY: 0,
    meta: { roomId: "boss" },
  });
  push({
    kind: "cabinet",
    x: bossCx + Math.min(1.35, (x1 - xL) * 0.32),
    y: 0,
    z: zB + 1.05,
    rotY: Math.PI / 2,
    meta: { roomId: "boss" },
  });

  // —— 中：员工区（对坐，每人一席） ——
  push({
    kind: "banner",
    x: staffCx,
    y: 0.4,
    z: zB + 0.32,
    rotY: Math.PI / 2,
    meta: { text: "员工区", wall: true, roomId: "staff" },
  });
  push({
    kind: "reception_marble",
    x: staffCx,
    y: 0,
    z: zF - 1.9,
    rotY: Math.PI,
    meta: { text: `欢迎来到 ${company}`, roomId: "staff" },
  });

  const unitCount = pairBenches + oddSingle;
  const cols = unitCount <= 2 ? 1 : 2;
  const rows = Math.max(1, Math.ceil(unitCount / cols));
  const bayW = Math.max(2.5, x2 - x1 - 2.4);
  const bayD = Math.max(3.5, D - 5.0);
  let nextSeat = 1;
  let unitIdx = 0;

  for (let i = 0; i < pairBenches; i++) {
    const col = unitIdx % cols;
    const row = Math.floor(unitIdx / cols);
    unitIdx += 1;
    const x = cols === 1 ? staffCx : x1 + 1.3 + (bayW * (col + 0.5)) / cols;
    const z = zB + 2.2 + (bayD * (row + 0.5)) / rows;
    push({
      kind: "desk_bench",
      x,
      y: 0,
      z,
      rotY: 0,
      meta: {
        deskIndex: nextSeat,
        seatCount: 2,
        lit: true,
        roomId: "staff",
      },
    });
    nextSeat += 2;
  }

  if (oddSingle === 1) {
    const col = unitIdx % cols;
    const row = Math.floor(unitIdx / cols);
    const x = cols === 1 ? staffCx : x1 + 1.3 + (bayW * (col + 0.5)) / cols;
    const z = zB + 2.2 + (bayD * (row + 0.5)) / rows;
    push({
      kind: "desk",
      x,
      y: 0,
      z,
      rotY: 0,
      meta: {
        deskIndex: nextSeat,
        seatCount: 1,
        lit: true,
        roomId: "staff",
      },
    });
    nextSeat += 1;
  }

  // —— 右：茶水休息区 ——
  push({
    kind: "banner",
    x: teaCx,
    y: 0.4,
    z: zB + 0.32,
    rotY: Math.PI / 2,
    meta: { text: "茶水休息区", wall: true, roomId: "tea" },
  });
  push({
    kind: "sofa_large",
    x: teaCx,
    y: 0,
    z: -0.9,
    rotY: 0,
    meta: { roomId: "tea" },
  });
  push({
    kind: "coffee_table",
    x: teaCx,
    y: 0,
    z: 0.35,
    rotY: 0,
    meta: { roomId: "tea" },
  });
  push({
    kind: "water_dispenser",
    x: teaCx + Math.min(1.4, (xR - x2) * 0.3),
    y: 0,
    z: zF - 1.9,
    rotY: 0,
    meta: { roomId: "tea" },
  });
  push({
    kind: "coffee",
    x: teaCx - Math.min(1.35, (xR - x2) * 0.28),
    y: 0,
    z: zF - 1.9,
    rotY: 0,
    meta: { roomId: "tea" },
  });
  push({
    kind: "plant",
    x: teaCx - Math.min(1.5, (xR - x2) * 0.32),
    y: 0,
    z: zB + 1.25,
    rotY: 0,
    meta: { roomId: "tea" },
  });
  push({
    kind: "rug",
    x: teaCx,
    y: 0,
    z: -0.25,
    rotY: 0,
    scale: 1.25,
    meta: { roomId: "tea" },
  });

  const layout: OfficeLayout = {
    version: 1,
    rooms: [
      {
        id: "boss",
        name: "老板办公室",
        weight: 1,
        zone: "perimeter",
        allowedDivisions: ["strategy", "specialized"],
      },
      {
        id: "staff",
        name: "员工区",
        weight: 2,
        zone: "open",
        allowedDivisions: [
          "engineering",
          "product",
          "design",
          "testing",
          "project-management",
          "software-company",
        ],
      },
      {
        id: "tea",
        name: "茶水休息区",
        weight: 1,
        zone: "perimeter",
        allowedDivisions: ["support"],
      },
    ],
    meta: {
      floorWidth: W,
      floorDepth: D,
      ringDepth: 0.12,
      layoutMode: "open_hall",
      shellRev: SHELL_REV,
      deskHealRev: 99,
      lockSeats: true,
      projectId: opts.projectId,
    },
    props,
  };

  const seats = countLayoutSeats(props);
  if (seats !== headcount) {
    throw new Error(`三开间座位校验失败：需要 ${headcount}，实际 ${seats}`);
  }
  return layout;
}

/** 是否为产品默认三开间（老板 / 员工 / 茶水）。 */
export function isThreeBayOffice(layout: OfficeLayout | null | undefined): boolean {
  if (!layout?.rooms?.length) return false;
  const ids = new Set(layout.rooms.map((r) => r.id));
  return ids.has("boss") && ids.has("staff") && ids.has("tea");
}
