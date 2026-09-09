/** Axis-aligned blockers for agent walking (desks / furniture / walls). */

export interface Aabb2 {
  xMin: number;
  xMax: number;
  zMin: number;
  zMax: number;
}

/** Approximate footprint half-extents by prop kind (world units). */
export const PROP_FOOTPRINT: Record<string, { hx: number; hz: number }> = {
  desk: { hx: 0.7, hz: 0.65 },
  desk_duo: { hx: 1.45, hz: 0.7 },
  desk_l: { hx: 0.9, hz: 0.85 },
  desk_bench: { hx: 1.45, hz: 0.85 },
  desk_corner: { hx: 0.85, hz: 0.8 },
  desk_standing: { hx: 0.6, hz: 0.4 },
  desk_compact: { hx: 0.5, hz: 0.5 },
  desk_arc: { hx: 1.4, hz: 0.85 },
  desk_exec: { hx: 1.3, hz: 0.7 },
  desk_exec_l: { hx: 1.2, hz: 0.85 },
  desk_exec_arc: { hx: 1.4, hz: 0.9 },
  sofa_loveseat: { hx: 0.75, hz: 0.45 },
  sofa_corner: { hx: 1.2, hz: 1.0 },
  coffee_table_round: { hx: 0.5, hz: 0.5 },
  coffee_table_glass: { hx: 0.6, hz: 0.4 },
  room_finance: { hx: 1.45, hz: 1.25 },
  room_sales: { hx: 1.45, hz: 1.25 },
  room_tech: { hx: 1.45, hz: 1.25 },
  room_procure: { hx: 1.45, hz: 1.25 },
  room_code: { hx: 1.45, hz: 1.25 },
  chair_exec: { hx: 0.35, hz: 0.35 },
  cabinet: { hx: 0.5, hz: 0.28 },
  printer: { hx: 0.35, hz: 0.3 },
  plant: { hx: 0.22, hz: 0.22 },
  plant_large: { hx: 0.35, hz: 0.35 },
  tree: { hx: 0.4, hz: 0.4 },
  bush: { hx: 0.35, hz: 0.35 },
  flower: { hx: 0.3, hz: 0.3 },
  flower_pot: { hx: 0.22, hz: 0.22 },
  cooler: { hx: 0.28, hz: 0.28 },
  coffee: { hx: 0.28, hz: 0.28 },
  sofa: { hx: 0.9, hz: 0.45 },
  sofa_large: { hx: 1.3, hz: 0.55 },
  coffee_table: { hx: 0.6, hz: 0.4 },
  rug: { hx: 0.2, hz: 0.2 }, // walkable
  floor_lamp: { hx: 0.2, hz: 0.2 },
  partition: { hx: 0.9, hz: 0.12 },
  wall: { hx: 0.12, hz: 1.25 },
  opening: { hx: 0.12, hz: 0.6 },
  door: { hx: 0.15, hz: 0.55 },
  door_glass: { hx: 0.15, hz: 0.55 },
  door_double: { hx: 0.15, hz: 0.95 },
  door_double_glass: { hx: 0.15, hz: 0.95 },
  reception_desk: { hx: 1.3, hz: 0.7 },
  reception_glass: { hx: 1.35, hz: 0.45 },
  reception_split: { hx: 1.6, hz: 0.45 },
  reception_arch: { hx: 1.45, hz: 0.4 },
  reception_minimal: { hx: 1.4, hz: 0.4 },
  reception_marble: { hx: 1.5, hz: 0.4 },
  window: { hx: 0.12, hz: 0.7 },
  window_wide: { hx: 0.12, hz: 1.25 },
  banner: { hx: 0.1, hz: 0.1 },
  whiteboard: { hx: 0.9, hz: 0.12 },
  shelf: { hx: 0.55, hz: 0.25 },
  water_dispenser: { hx: 0.28, hz: 0.28 },
};

const WALKABLE = new Set(["rug", "banner"]);

export function footprintFor(
  kind: string,
  x: number,
  z: number,
  rotY = 0,
  scale = 1,
  seatCount = 1,
): Aabb2 | null {
  if (WALKABLE.has(kind)) return null;
  const fp = PROP_FOOTPRINT[kind] ?? { hx: 0.4, hz: 0.4 };
  const n = Math.max(1, Math.min(12, Math.round(seatCount || 1)));
  // Linked banks grow mainly along local X (matches meshes BANK / L pitch).
  let hxMul = 1;
  if (n > 1) {
    if (kind === "desk_bench") hxMul = Math.max(1, Math.ceil(n / 2) * 0.55);
    else if (kind === "desk_l" || kind === "desk_corner") hxMul = 0.55 + (n - 1) * 0.95;
    else hxMul = 0.5 + (n - 1) * 0.7;
  }
  const hx = fp.hx * scale * hxMul;
  const hz = fp.hz * scale;
  // Approximate rotation by swapping extents when near 90°
  const aligned = Math.abs(Math.sin(rotY)) > 0.7;
  const ex = aligned ? hz : hx;
  const ez = aligned ? hx : hz;
  return { xMin: x - ex, xMax: x + ex, zMin: z - ez, zMax: z + ez };
}

export function pointInAabb(x: number, z: number, b: Aabb2, pad = 0.12): boolean {
  return x >= b.xMin - pad && x <= b.xMax + pad && z >= b.zMin - pad && z <= b.zMax + pad;
}

/** True if segment from→to crosses or ends inside any blocker (prevents tunneling thin walls). */
export function segmentHitsAabb(
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  b: Aabb2,
  pad = 0.1,
): boolean {
  const minX = b.xMin - pad;
  const maxX = b.xMax + pad;
  const minZ = b.zMin - pad;
  const maxZ = b.zMax + pad;
  // Liang–Barsky style clip: if either end inside, hit
  if (pointInAabb(x0, z0, b, pad) || pointInAabb(x1, z1, b, pad)) return true;
  const dx = x1 - x0;
  const dz = z1 - z0;
  let t0 = 0;
  let t1 = 1;
  const clip = (p: number, q: number) => {
    if (Math.abs(p) < 1e-9) return q >= 0;
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
    return true;
  };
  if (!clip(-dx, x0 - minX)) return false;
  if (!clip(dx, maxX - x0)) return false;
  if (!clip(-dz, z0 - minZ)) return false;
  if (!clip(dz, maxZ - z0)) return false;
  return t0 <= t1;
}

function anySegmentHit(
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  blockers: Aabb2[],
): boolean {
  return blockers.some((b) => segmentHitsAabb(x0, z0, x1, z1, b));
}

/**
 * Move with sub-steps so thin walls cannot be tunneled.
 * No axis-slide — sliding was letting agents slip through door holes into rooms.
 */
export function resolveWalk(
  from: { x: number; z: number },
  to: { x: number; z: number },
  blockers: Aabb2[],
): { x: number; z: number } {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 1e-6) return from;

  const maxStep = 0.06;
  const n = Math.max(1, Math.ceil(dist / maxStep));
  let x = from.x;
  let z = from.z;
  for (let i = 1; i <= n; i++) {
    const tx = from.x + (dx * i) / n;
    const tz = from.z + (dz * i) / n;
    if (anySegmentHit(x, z, tx, tz, blockers)) break;
    x = tx;
    z = tz;
  }
  return { x, z };
}
