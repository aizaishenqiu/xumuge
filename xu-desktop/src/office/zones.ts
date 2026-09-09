/** Office floor zones + door-aware pathing (surround open + perimeter rooms). */

import {
  computeFloorGeometry,
  FLOOR_DOOR_Z,
  resolveAreaMeta,
  resolveFloorRooms,
  roomAtPoint,
  type FloorRoomRect,
} from "./floorPlan";
import type { OfficeLayout } from "./catalog";

export type ZoneId = string;

/** @deprecated fixed 3-bay constants — prefer resolveLayoutZones */
export const WALL_BOSS_STAFF = -3.6;
export const WALL_STAFF_TEA = 4.9;
export const DOOR_Z = FLOOR_DOOR_Z;
export const DOOR_HALF = 0.55;

export const ZONE_BOUNDS: Record<"boss" | "staff" | "tea", { xMin: number; xMax: number; zMin: number; zMax: number }> = {
  boss: { xMin: -8.4, xMax: -3.85, zMin: -3.7, zMax: 3.7 },
  staff: { xMin: -3.35, xMax: 4.65, zMin: -3.7, zMax: 3.7 },
  tea: { xMin: 5.15, xMax: 8.85, zMin: -3.7, zMax: 3.7 },
};

let cachedRects: FloorRoomRect[] = computeFloorGeometry(resolveFloorRooms(null)).rects;
let cachedLayout: OfficeLayout | null = null;

export function syncZonesFromLayout(layout: OfficeLayout | null | undefined) {
  cachedLayout = layout ?? null;
  const geo = computeFloorGeometry(resolveFloorRooms(layout), resolveAreaMeta(layout));
  cachedRects = geo.rects;
}

export function currentRoomRects(): FloorRoomRect[] {
  return cachedRects;
}

export function zoneAt(x: number, z: number): ZoneId {
  const hit = roomAtPoint(cachedRects, x, z);
  if (hit) return hit.id;
  // Fallback: nearest room center
  let best = cachedRects[0];
  let bestD = Infinity;
  for (const r of cachedRects) {
    const d = (r.centerX - x) ** 2 + (r.centerZ - z) ** 2;
    if (d < bestD) {
      bestD = d;
      best = r;
    }
  }
  return best?.id ?? "open";
}

export function clampToZone(zone: ZoneId, x: number, z: number): { x: number; z: number } {
  const b =
    cachedRects.find((r) => r.id === zone) ??
    cachedRects.find((r) => r.zone === "open") ??
    cachedRects[0];
  if (!b) return { x, z };
  return {
    x: Math.min(b.xMax - 0.35, Math.max(b.xMin + 0.35, x)),
    z: Math.min(b.zMax - 0.35, Math.max(b.zMin + 0.35, z)),
  };
}

export function randomPointInZone(zone: ZoneId, rng = Math.random): { x: number; z: number } {
  const b = cachedRects.find((r) => r.id === zone) ?? cachedRects.find((r) => r.zone === "open") ?? cachedRects[0];
  if (!b) return { x: 0, z: 0 };
  return {
    x: b.xMin + 0.4 + rng() * Math.max(0.2, b.xMax - b.xMin - 0.8),
    z: b.zMin + 0.4 + rng() * Math.max(0.2, b.zMax - b.zMin - 0.8),
  };
}

function isBossZone(id: ZoneId): boolean {
  const r = cachedRects.find((x) => x.id === id);
  return /boss|老板|总裁/.test(id) || r?.name.includes("老板") === true;
}

function openZoneId(): ZoneId {
  return cachedRects.find((r) => r.zone === "open")?.id ?? cachedRects[0]?.id ?? "open";
}

/** Approach a room's door from the open-plaza side or room side. */
function doorSides(room: FloorRoomRect): { plaza: { x: number; z: number }; inside: { x: number; z: number } } {
  const pad = 0.5;
  if (room.doorWall === "z") {
    const plazaSide = room.doorZ >= room.centerZ ? 1 : -1;
    return {
      plaza: { x: room.doorX, z: room.doorZ + plazaSide * pad },
      inside: { x: room.doorX, z: room.doorZ - plazaSide * pad },
    };
  }
  const plazaSide = room.doorX >= room.centerX ? 1 : -1;
  return {
    plaza: { x: room.doorX + plazaSide * pad, z: room.doorZ },
    inside: { x: room.doorX - plazaSide * pad, z: room.doorZ },
  };
}

/**
 * Path via open plaza + room doors (not 1D bay hopping).
 */
export function buildDoorPath(
  from: { x: number; z: number },
  to: { x: number; z: number },
  opts?: { allowBoss?: boolean },
): Array<{ x: number; z: number }> {
  const allowBoss = opts?.allowBoss === true;
  let start = { ...from };
  let end = { ...to };

  let startZone = zoneAt(start.x, start.z);
  let endZone = zoneAt(end.x, end.z);
  const openId = openZoneId();

  if (!allowBoss && isBossZone(startZone)) {
    start = randomPointInZone(openId);
    startZone = openId;
  }
  if (!allowBoss && isBossZone(endZone)) {
    end = randomPointInZone(openId);
    endZone = openId;
  }

  start = clampToZone(startZone, start.x, start.z);
  end = clampToZone(endZone, end.x, end.z);

  if (startZone === endZone) {
    return [start, end];
  }

  const startRect = cachedRects.find((r) => r.id === startZone);
  const endRect = cachedRects.find((r) => r.id === endZone);
  const pts: Array<{ x: number; z: number }> = [start];

  // Leave perimeter room → plaza
  if (startRect && startRect.zone === "perimeter") {
    const d = doorSides(startRect);
    pts.push(d.inside, d.plaza);
  }

  // Cross plaza toward destination door
  if (endRect && endRect.zone === "perimeter") {
    const d = doorSides(endRect);
    pts.push(d.plaza, d.inside);
  } else if (endRect && endRect.zone === "open") {
    pts.push({ x: endRect.centerX, z: endRect.centerZ });
  }

  pts.push(end);
  void cachedLayout;
  return pts;
}

export function stepAlongPath(
  from: { x: number; z: number },
  to: { x: number; z: number },
  speed: number,
  dt: number,
): { x: number; z: number; facing: number; arrived: boolean } {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const dist = Math.hypot(dx, dz);
  // Person mesh faces local −Z (eyes on −Z); yaw so −Z aligns with travel.
  const facing = walkFacingYaw(dx, dz);
  if (dist < 0.04) {
    return { x: to.x, z: to.z, facing, arrived: true };
  }
  const step = Math.min(dist, speed * dt);
  return {
    x: from.x + (dx / dist) * step,
    z: from.z + (dz / dist) * step,
    facing,
    arrived: step >= dist - 0.02,
  };
}

/** Yaw so character forward (−Z) points along world (dx, dz). */
export function walkFacingYaw(dx: number, dz: number): number {
  if (Math.hypot(dx, dz) < 1e-6) return 0;
  return Math.atan2(-dx, -dz);
}
