import {
  countLayoutSeats,
  isDeskKind,
  newPropId,
  nextDeskSeatIndex,
  seatCapacityOfKind,
  seatIndicesOnProp,
  type OfficeLayout,
  type OfficeProp,
} from "./catalog";
import { furnishRooms, computeFloorGeometry, resolveAreaMeta, resolveFloorRooms } from "./floorPlan";
import { OFFICE_DESK_DEFAULT } from "../utils/officeSettings";
import { DEFAULT_COMPANY_NAME, readCompanyName } from "../utils/brandSettings";
import { buildThreeBayOfficeLayout } from "./threeBayLayout";
// AgencyDivision is free-form string from full agency catalog

export type SyncDeskCountResult = {
  layout: OfficeLayout;
  removedSeats: number[];
};

/** 默认：传统三开间（左老板 · 中员工 · 右茶水）。 */
export function buildDefaultOfficeLayout(deskCount = OFFICE_DESK_DEFAULT): OfficeLayout {
  const headcount = Math.max(1, Math.min(40, Math.floor(deskCount)));
  let companyName = DEFAULT_COMPANY_NAME;
  try {
    companyName = readCompanyName();
  } catch {
    /* ignore */
  }
  return buildThreeBayOfficeLayout({ headcount, companyName });
}

export type StaffedRoomKind =
  | "room_finance"
  | "room_sales"
  | "room_tech"
  | "room_procure"
  | "room_code";

const ROOM_LABEL: Record<StaffedRoomKind, string> = {
  room_tech: "技术部",
  room_code: "代码部门",
  room_sales: "销售部",
  room_finance: "财务室",
  room_procure: "采购部",
};

/**
 * Build a staffed office floor: one physical office per selected department (+ boss + tea).
 */
export function buildStaffedOfficeLayout(opts: {
  deskCount: number;
  rooms: StaffedRoomKind[];
}): OfficeLayout {
  const deskCount = Math.max(1, Math.min(16, Math.floor(opts.deskCount)));
  const depts = opts.rooms.filter((r, i, a) => a.indexOf(r) === i);
  return furnishRooms(
    [
      {
        id: "open",
        name: "开敞工位区",
        weight: 2,
        zone: "open",
        allowedDivisions: ["engineering", "product", "design", "testing", "project-management", "software-company"],
      },
      {
        id: "boss",
        name: "老板办公室",
        weight: 1.2,
        zone: "perimeter",
        allowedDivisions: ["strategy", "specialized"],
      },
      ...depts.map((kind) => ({
        id: kind,
        name: ROOM_LABEL[kind],
        weight: 1.1,
        kind,
        zone: "perimeter" as const,
        allowedDivisions: DIVISION_ROOMS_REVERSE[kind] ?? [],
      })),
      { id: "tea", name: "茶水室", weight: 0.95, zone: "perimeter" },
    ],
    deskCount,
    {
      companyName: DEFAULT_COMPANY_NAME,
      area: { floorWidth: 26, floorDepth: 20, layoutMode: "surround" },
    },
  ).layout;
}

const DIVISION_ROOMS_REVERSE: Record<string, string[]> = {
  room_tech: ["engineering", "testing", "software-company"],
  room_code: ["engineering", "testing", "software-company"],
  room_sales: ["sales", "marketing", "paid-media"],
  room_finance: ["finance"],
  room_procure: ["support", "finance"],
};

export type DivisionSeatHint = {
  agentRoleId: string;
  preferredRooms: StaffedRoomKind[];
};

const DIVISION_ROOMS: Record<string, StaffedRoomKind[]> = {
  engineering: ["room_tech", "room_code"],
  design: ["room_tech", "room_code"],
  product: ["room_sales"],
  "project-management": ["room_sales"],
  project: ["room_sales"],
  testing: ["room_tech", "room_code"],
  qa: ["room_tech", "room_code"],
  security: ["room_tech", "room_code"],
  support: ["room_finance", "room_procure"],
  ops: ["room_finance", "room_procure"],
  finance: ["room_finance", "room_procure"],
  sales: ["room_sales"],
  marketing: ["room_sales"],
  specialized: ["room_tech", "room_code"],
};

export type RoomSeatStats = {
  roomId: string;
  name: string;
  zone?: "open" | "perimeter";
  allowedDivisions?: string[];
  total: number;
  occupied: number;
  free: number;
  freeSeats: number[];
  allSeats: number[];
};

/** Per-room seat inventory from layout + occupied desk indices. */
export function listRoomSeatStats(
  layout: OfficeLayout,
  occupied: ReadonlySet<number> = new Set(),
): RoomSeatStats[] {
  const geo = computeFloorGeometry(resolveFloorRooms(layout), resolveAreaMeta(layout));
  return geo.rects.map((room) => {
    const seats = layout.props
      .filter((p) => isDeskKind(p.kind) && p.meta?.deskIndex != null)
      .filter((p) => {
        if (p.meta?.roomId) return p.meta.roomId === room.id;
        return p.x >= room.xMin && p.x <= room.xMax && p.z >= room.zMin && p.z <= room.zMax;
      })
      .map((p) => p.meta!.deskIndex as number)
      .sort((a, b) => a - b);
    const freeSeats = seats.filter((s) => !occupied.has(s));
    return {
      roomId: room.id,
      name: room.name,
      zone: room.zone,
      allowedDivisions: room.allowedDivisions,
      total: seats.length,
      occupied: seats.length - freeSeats.length,
      free: freeSeats.length,
      freeSeats,
      allSeats: seats,
    };
  });
}

/**
 * Pick first free seat in rooms that allow the division (or preferred roomId).
 */
export function pickSeatForDivision(
  layout: OfficeLayout,
  division: string | undefined,
  occupied: ReadonlySet<number>,
  preferredRoomId?: string | null,
): number | null {
  const stats = listRoomSeatStats(layout, occupied);
  const ordered = preferredRoomId
    ? [
        ...stats.filter((s) => s.roomId === preferredRoomId),
        ...stats.filter((s) => s.roomId !== preferredRoomId),
      ]
    : stats;
  for (const s of ordered) {
    if (s.freeSeats.length === 0) continue;
    if (division && s.allowedDivisions && s.allowedDivisions.length > 0) {
      if (!s.allowedDivisions.includes(division)) continue;
    }
    return s.freeSeats[0] ?? null;
  }
  for (const s of ordered) {
    if (s.freeSeats.length > 0) return s.freeSeats[0]!;
  }
  return null;
}

/**
 * Assign deskIndex preferring seats in rooms that allow this division.
 * Never place finance into tech room etc. when allowedDivisions is set.
 */
export function assignDesksByDivision(
  layout: OfficeLayout,
  roleIds: string[],
  getDivision: (roleId: string) => string | undefined,
): Array<number | null> {
  const geo = computeFloorGeometry(resolveFloorRooms(layout), resolveAreaMeta(layout));
  const roomById = new Map(geo.rects.map((r) => [r.id, r]));

  const desks = layout.props
    .filter((p) => isDeskKind(p.kind) && p.meta?.deskIndex != null)
    .map((p) => {
      const roomId =
        p.meta?.roomId ??
        geo.rects.find((r) => p.x >= r.xMin && p.x <= r.xMax && p.z >= r.zMin && p.z <= r.zMax)?.id;
      return {
        index: p.meta!.deskIndex as number,
        x: p.x,
        z: p.z,
        roomId,
        room: roomId ? roomById.get(roomId) : undefined,
      };
    })
    .sort((a, b) => a.index - b.index);

  const used = new Set<number>();
  const out: Array<number | null> = [];

  for (const roleId of roleIds) {
    const div = getDivision(roleId);
    const candidates = desks.filter((d) => {
      if (used.has(d.index)) return false;
      if (!div) return true;
      const allowed = d.room?.allowedDivisions;
      if (allowed && allowed.length > 0) {
        return allowed.includes(div);
      }
      // Legacy fallback via room kind
      if (d.room?.kind) {
        const preferred = DIVISION_ROOMS[div] ?? [];
        return preferred.includes(d.room.kind as StaffedRoomKind);
      }
      // Open plaza without restrictions accepts most
      return d.room?.zone === "open" || !d.room;
    });

    let best: (typeof desks)[0] | null = candidates[0] ?? null;
    if (candidates.length > 1 && div) {
      const preferredKinds = DIVISION_ROOMS[div] ?? [];
      const scored = candidates
        .map((d) => {
          const kindHit = d.room?.kind && preferredKinds.includes(d.room.kind as StaffedRoomKind) ? 0 : 1;
          const periBonus = d.room?.zone === "perimeter" && preferredKinds.length ? 0 : 1;
          return { d, score: kindHit + periBonus };
        })
        .sort((a, b) => a.score - b.score);
      best = scored[0]?.d ?? best;
    }

    if (!best) {
      // Strict: do not fall back into disallowed rooms
      const anyOpen = desks.find(
        (d) => !used.has(d.index) && (d.room?.zone === "open" || !d.room?.allowedDivisions?.length),
      );
      best = anyOpen ?? null;
    }
    if (best) {
      used.add(best.index);
      out.push(best.index);
    } else {
      out.push(null);
    }
  }
  return out;
}

/**
 * Sync layout seat capacity with settings deskCount.
 * Seat numbers stay stable (never re-index 0..n-1).
 * Returns seats removed from the layout so callers can unbind employees.
 */
export function syncDeskCount(
  layout: OfficeLayout,
  deskCount: number,
  occupiedSeats: ReadonlySet<number> = new Set(),
): SyncDeskCountResult {
  const target = Math.max(0, Math.floor(deskCount));
  let props = layout.props.slice();
  const removedSeats: number[] = [];

  const capacity = () => countLayoutSeats(props);

  while (capacity() < target) {
    const seat = nextDeskSeatIndex(props);
    const pos = { x: (seat % 4) * 1.55 - 2, z: Math.floor(seat / 4) * 1.7 };
    props.push({
      id: newPropId("desk"),
      kind: "desk",
      x: pos.x,
      y: 0,
      z: pos.z,
      rotY: 0,
      meta: { deskIndex: seat, lit: false },
    });
  }

  while (capacity() > target) {
    const excess = capacity() - target;
    const desks = props.filter((p) => isDeskKind(p.kind));
    if (desks.length === 0) break;

    const score = (p: OfficeProp) => {
      const seats = seatIndicesOnProp(p);
      const contrib = seats.length > 0 ? seats.length : seatCapacityOfKind(p.kind);
      const occupied = seats.some((s) => occupiedSeats.has(s));
      const maxSeat = seats.length > 0 ? Math.max(...seats) : -1;
      return { seats, contrib, occupied, maxSeat };
    };

    desks.sort((a, b) => {
      const sa = score(a);
      const sb = score(b);
      if (sa.occupied !== sb.occupied) return sa.occupied ? 1 : -1;
      const fitA = sa.contrib <= excess ? 0 : 1;
      const fitB = sb.contrib <= excess ? 0 : 1;
      if (fitA !== fitB) return fitA - fitB;
      if (sa.contrib !== sb.contrib) return sa.contrib - sb.contrib;
      return sb.maxSeat - sa.maxSeat;
    });

    const victim = desks[0];
    removedSeats.push(...score(victim).seats);
    props = props.filter((p) => p.id !== victim.id);
  }

  return {
    layout: { version: 1, rooms: layout.rooms, meta: layout.meta, props },
    removedSeats: [...new Set(removedSeats)],
  };
}
