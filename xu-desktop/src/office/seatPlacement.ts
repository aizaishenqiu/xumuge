/** Shared desk seat world placement (office scene + generate validation). */

import { isDeskKind, seatIndicesOnProp, type OfficeLayout } from "./catalog";

const CHAIR_Z = 0.5;

function localToWorldOffset(x: number, z: number, rotY: number, lx: number, lz: number) {
  const c = Math.cos(rotY);
  const s = Math.sin(rotY);
  return {
    x: x + lx * c + lz * s,
    z: z - lx * s + lz * c,
  };
}

export function findSeatForDeskIndex(
  layout: OfficeLayout,
  deskIndex: number,
): { x: number; z: number; rotY: number } | null {
  for (const p of layout.props) {
    if (!isDeskKind(p.kind)) continue;
    const seats = seatIndicesOnProp(p);
    const idx = seats.indexOf(deskIndex);
    if (idx < 0) continue;
    if (p.kind === "desk_arc" && seats.length > 1) {
      const t = (idx + 0.5) / seats.length;
      const ang = -Math.PI * 0.35 + t * Math.PI * 0.7;
      const lx = Math.sin(ang) * 0.55;
      const lz = Math.cos(ang) * 0.55 + 0.15;
      const o = localToWorldOffset(p.x, p.z, p.rotY ?? 0, lx, lz);
      return { ...o, rotY: (p.rotY ?? 0) + ang };
    }
    if (p.kind === "desk_bench" && seats.length > 1) {
      const pairs = Math.ceil(seats.length / 2);
      const pitch = 1.4;
      const pair = Math.floor(idx / 2);
      const side = idx % 2;
      const lx = -((pairs - 1) * pitch) / 2 + pair * pitch;
      const lz = side === 0 ? -0.55 : 0.55;
      const o = localToWorldOffset(p.x, p.z, p.rotY ?? 0, lx, lz);
      return { ...o, rotY: (p.rotY ?? 0) + (side === 0 ? Math.PI : 0) };
    }
    if (seats.length > 1) {
      const pitch = p.kind === "desk_l" || p.kind === "desk_corner" ? 2.1 : 1.4;
      const span = (seats.length - 1) * pitch;
      const lx = -span / 2 + idx * pitch;
      const lz = p.kind === "desk_l" ? 0.55 : CHAIR_Z;
      const o = localToWorldOffset(p.x, p.z, p.rotY ?? 0, lx, lz);
      return { ...o, rotY: p.rotY ?? 0 };
    }
    if (p.kind === "desk_exec" || p.kind === "desk_exec_l" || p.kind === "desk_exec_arc") {
      const o = localToWorldOffset(p.x, p.z, p.rotY ?? 0, 0, -CHAIR_Z);
      return { ...o, rotY: (p.rotY ?? 0) + Math.PI };
    }
    const o = localToWorldOffset(p.x, p.z, p.rotY ?? 0, 0, CHAIR_Z);
    return { ...o, rotY: p.rotY ?? 0 };
  }
  return null;
}
