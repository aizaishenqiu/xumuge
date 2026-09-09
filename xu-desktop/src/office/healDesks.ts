/** Spread desk props that AABB-overlap (old 连体 batch pitch was too tight). */

import { isDeskKind, type OfficeLayout, type OfficeProp } from "./catalog";
import { footprintFor, type Aabb2 } from "./collision";

export const DESK_HEAL_REV = 2;

function aabbOverlap(a: Aabb2, b: Aabb2, pad = 0.12): boolean {
  return !(
    a.xMax + pad < b.xMin ||
    b.xMax + pad < a.xMin ||
    a.zMax + pad < b.zMin ||
    b.zMax + pad < a.zMin
  );
}

function minCenterDist(kindA: string, kindB: string, seatsA: number, seatsB: number): number {
  const pitch = (k: string) =>
    k === "desk_l" || k === "desk_corner" || k === "desk_exec_l" ? 2.1 : 1.6;
  const half = (k: string, n: number) => {
    const p = pitch(k);
    const seats = Math.max(1, n);
    if (k === "desk_bench") return (Math.ceil(seats / 2) * 1.45) / 2 + 0.2;
    if (seats <= 1) return p * 0.55;
    return ((seats - 1) * p) / 2 + p * 0.55;
  };
  return half(kindA, seatsA) + half(kindB, seatsB) + 0.35;
}

/** Push overlapping desks apart until footprints clear. */
export function healOverlappingDesks(props: OfficeProp[]): OfficeProp[] {
  const next = props.map((p) => ({
    ...p,
    meta: p.meta ? { ...p.meta } : undefined,
  }));
  const idxs = next.map((_, i) => i).filter((i) => isDeskKind(next[i].kind));

  for (let pass = 0; pass < 16; pass++) {
    let moved = false;
    for (let ai = 0; ai < idxs.length; ai++) {
      for (let bi = ai + 1; bi < idxs.length; bi++) {
        const i = idxs[ai]!;
        const j = idxs[bi]!;
        const a = next[i]!;
        const b = next[j]!;
        const sa = a.meta?.seatCount ?? 1;
        const sb = b.meta?.seatCount ?? 1;
        const fa = footprintFor(a.kind, a.x, a.z, a.rotY ?? 0, a.scale ?? 1, sa);
        const fb = footprintFor(b.kind, b.x, b.z, b.rotY ?? 0, b.scale ?? 1, sb);
        if (!fa || !fb || !aabbOverlap(fa, fb)) continue;

        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const dist = Math.hypot(dx, dz);
        const need = minCenterDist(a.kind, b.kind, sa, sb);

        if (dist < 1e-3) {
          const c = Math.cos(a.rotY ?? 0);
          const s = Math.sin(a.rotY ?? 0);
          a.x -= c * (need / 2);
          a.z += s * (need / 2);
          b.x += c * (need / 2);
          b.z -= s * (need / 2);
        } else {
          const push = (need - dist) / 2 + 0.1;
          const nx = dx / dist;
          const nz = dz / dist;
          a.x -= nx * push;
          a.z -= nz * push;
          b.x += nx * push;
          b.z += nz * push;
        }
        moved = true;
      }
    }
    if (!moved) break;
  }
  return next;
}

export function applyDeskHeal(layout: OfficeLayout): { layout: OfficeLayout; changed: boolean } {
  const props = healOverlappingDesks(layout.props);
  const moved = props.some(
    (p, i) =>
      Math.abs(p.x - (layout.props[i]?.x ?? 0)) > 1e-3 ||
      Math.abs(p.z - (layout.props[i]?.z ?? 0)) > 1e-3,
  );
  if (!moved && (layout.meta?.deskHealRev ?? 0) >= DESK_HEAL_REV) {
    return { layout, changed: false };
  }
  return {
    layout: {
      ...layout,
      props: moved ? props : layout.props,
      meta: { ...layout.meta, deskHealRev: DESK_HEAL_REV },
    },
    changed: true,
  };
}
