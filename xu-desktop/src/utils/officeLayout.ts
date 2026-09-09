import { invoke } from "@tauri-apps/api/core";
import { buildDefaultOfficeLayout, syncDeskCount } from "../office/defaultLayout";
import { isRoomKind, type OfficeLayout } from "../office/catalog";
import {
  defaultFloorRooms,
  resolveAreaMeta,
  resolveFloorRooms,
  SHELL_REV,
} from "../office/floorPlan";
import { listOccupiedDeskIndices, unbindEmployeesFromDesks } from "./employees";
import { readDeskCount } from "./officeSettings";
import { applyDeskHeal } from "../office/healDesks";

function occupiedSeatSet(): Set<number> {
  return new Set(listOccupiedDeskIndices());
}

/** Ensure layout.rooms drives the shell; strip indoor room_* markers; upgrade old shells. */
function migrateRooms(layout: OfficeLayout): OfficeLayout {
  let props = layout.props.filter((p) => !isRoomKind(p.kind));
  let rooms = layout.rooms?.length
    ? layout.rooms
    : resolveFloorRooms({ ...layout, props: layout.props }).map((r) => ({
        id: r.id,
        name: r.name,
        weight: r.weight,
        kind: r.kind,
        allowedDivisions: r.allowedDivisions,
        zone: r.zone,
      }));
  if (!rooms.length) rooms = defaultFloorRooms();

  const normalized = resolveFloorRooms({ ...layout, rooms, props }).map((r) => ({
    id: r.id,
    name: r.name,
    weight: r.weight,
    kind: r.kind,
    allowedDivisions: r.allowedDivisions,
    zone: r.zone,
  }));

  const shellRev = layout.meta?.shellRev ?? 0;
  // Never replace a locked project three-bay with the default open hall
  if (shellRev < SHELL_REV && !layout.meta?.lockSeats) {
    // One-time: drop room-in-room default → single open hall
    return buildDefaultOfficeLayout(
      Math.max(
        readDeskCount(),
        props.filter((p) => String(p.kind).startsWith("desk")).length || 0,
      ) || readDeskCount(),
    );
  }

  return {
    ...layout,
    rooms: normalized,
    props,
    meta: {
      ...layout.meta,
      floorWidth: layout.meta?.floorWidth ?? 24,
      floorDepth: layout.meta?.floorDepth ?? 18,
      ringDepth: layout.meta?.ringDepth ?? 4.2,
      layoutMode: layout.meta?.layoutMode ?? "open_hall",
      shellRev: SHELL_REV,
    },
  };
}

export async function loadOfficeLayout(): Promise<OfficeLayout> {
  try {
    const raw = await invoke<string | null>("xu_get_office_layout");
    if (raw) {
      const parsed = JSON.parse(raw) as OfficeLayout;
      if (parsed?.version === 1 && Array.isArray(parsed.props)) {
        const migrated = migrateRooms(parsed);
        let working = migrated;
        let removedSeats: number[] = [];
        if (!migrated.meta?.lockSeats) {
          const synced = syncDeskCount(
            migrated,
            readDeskCount(),
            occupiedSeatSet(),
          );
          working = synced.layout;
          removedSeats = synced.removedSeats;
        }
        if (removedSeats.length > 0) {
          await unbindEmployeesFromDesks(removedSeats);
        }
        // Locked project layouts: do not heal/spread (keeps bay walls + furniture)
        const { layout, changed: healed } = migrated.meta?.lockSeats
          ? { layout: working, changed: false }
          : applyDeskHeal(working);
        const shouldPersist =
          healed || (parsed.meta?.shellRev ?? 0) < SHELL_REV;
        if (shouldPersist) {
          try {
            await invoke("xu_set_office_layout", { layoutJson: JSON.stringify(layout) });
          } catch {
            /* soft */
          }
        }
        return layout;
      }
    }
  } catch {
    /* fall through */
  }
  return buildDefaultOfficeLayout(readDeskCount());
}

export async function saveOfficeLayout(layout: OfficeLayout): Promise<void> {
  // Ensure shellRev stamped; do not force-rebuild user surround presets
  const stamped: OfficeLayout = {
    ...layout,
    meta: {
      ...layout.meta,
      shellRev: Math.max(layout.meta?.shellRev ?? 0, SHELL_REV),
      layoutMode: layout.meta?.layoutMode ?? "open_hall",
    },
  };
  await invoke("xu_set_office_layout", {
    layoutJson: JSON.stringify(stamped),
  });
  window.dispatchEvent(new CustomEvent("xu-office-layout-changed", { detail: stamped }));
}

export async function resetOfficeLayout(): Promise<OfficeLayout> {
  const next = buildDefaultOfficeLayout(readDeskCount());
  await saveOfficeLayout(next);
  return next;
}

export { resolveAreaMeta };
