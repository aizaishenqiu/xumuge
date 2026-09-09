<script setup lang="ts">
/**
 * Canvas 2D office — one paint surface, no per-desk DOM (fixes stutter with ~19 staff).
 */
import { onMounted, onUnmounted, ref, watch } from "vue";
import type { Employee, EmployeeStatus } from "../utils/employees";
import { getAvatar } from "../utils/employees";
import type { OfficeLayout, OfficeProp, PropKind } from "../office/catalog";
import {
  isDeskKind,
  isRoomKind,
  isWallCutKind,
  isWallMountKind,
  nextDeskSeatIndex,
  newPropId,
  ROOM_DEFAULT_LABEL,
  seatIndicesOnProp,
  wallCutSpanForProp,
} from "../office/catalog";
import { buildDefaultOfficeLayout } from "../office/defaultLayout";
import { findSeatForDeskIndex } from "../office/seatPlacement";
import { PROP_FOOTPRINT } from "../office/collision";
import {
  computeFloorGeometry,
  resolveAreaMeta,
  resolveFloorRooms,
} from "../office/floorPlan";
import { readCompanyName } from "../utils/brandSettings";
import {
  readOfficeDisplayPrefs,
  type OfficeDisplayPrefs,
} from "../utils/officeDisplayPrefs";
import {
  formatCompactLabel,
  formatPrimaryLine,
  statusLabel,
} from "../office/formatEmployeeLabel";

const UNIT = 48;

const props = withDefaults(
  defineProps<{
    deskCount?: number;
    employees?: Employee[];
    layout?: OfficeLayout | null;
    editMode?: boolean;
    placeKind?: PropKind | null;
    placeSeatCount?: number | null;
    placeColor?: string | null;
    selectedPropId?: string | null;
  }>(),
  {
    deskCount: 6,
    employees: () => [],
    layout: null,
    editMode: false,
    placeKind: null,
    placeSeatCount: null,
    placeColor: null,
    selectedPropId: null,
  },
);

const emit = defineEmits<{
  "update:layout": [layout: OfficeLayout];
  "update:selectedPropId": [id: string | null];
  "update:placeKind": [kind: PropKind | null];
  "desks-removed": [seats: number[]];
  "edit-employee": [employeeId: string];
}>();

const host = ref<HTMLDivElement | null>(null);
const canvas = ref<HTMLCanvasElement | null>(null);
const displayPrefs = ref<OfficeDisplayPrefs>(readOfficeDisplayPrefs());

function onDisplayPrefsChanged() {
  displayPrefs.value = readOfficeDisplayPrefs();
  queueDraw();
}

const STATUS: Record<EmployeeStatus, string> = {
  idle: "#94a3b8",
  working: "#22c55e",
  meeting: "#3b82f6",
  away: "#f59e0b",
};

let ctx: CanvasRenderingContext2D | null = null;
let zoom = 1;
let panX = 0;
let panY = 0;
let panning = false;
let panLast = { x: 0, y: 0 };
let draggingId: string | null = null;
let dragOrigin = { x: 0, z: 0 };
let spaceHeld = false;
let drawQueued = false;
let dpr = 1;

function activeLayout(): OfficeLayout {
  if (props.layout?.props && Array.isArray(props.layout.props)) return props.layout;
  return buildDefaultOfficeLayout(props.deskCount ?? 6);
}

function geoNow() {
  return computeFloorGeometry(resolveFloorRooms(activeLayout()), resolveAreaMeta(activeLayout()));
}

function footprint(kind: string, seatCount?: number) {
  const base = PROP_FOOTPRINT[kind] ?? { hx: 0.4, hz: 0.4 };
  if (isDeskKind(kind) && seatCount && seatCount > 1) {
    const pitch = kind === "desk_l" || kind === "desk_corner" ? 2.1 : 1.4;
    return { hx: Math.max(base.hx, (seatCount * pitch) / 2), hz: base.hz };
  }
  return base;
}

function deskColor(kind: string, color?: string) {
  if (color) return color;
  if (kind.startsWith("desk_exec")) return "#8b6914";
  if (isDeskKind(kind)) return "#a67c52";
  if (kind.includes("plant") || kind === "tree" || kind === "bush") return "#3d8b6e";
  if (kind.includes("sofa")) return "#5b6b8c";
  if (kind === "wall" || kind === "partition") return "#94a3b8";
  return "#64748b";
}

function worldToScreen(x: number, z: number, geo: ReturnType<typeof geoNow>) {
  return { x: (x - geo.xLeft) * UNIT, y: (z - geo.zBack) * UNIT };
}

function clientToWorld(clientX: number, clientY: number) {
  const el = host.value;
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  const geo = geoNow();
  const sx = (clientX - rect.left - panX) / zoom;
  const sy = (clientY - rect.top - panY) / zoom;
  return { x: sx / UNIT + geo.xLeft, z: sy / UNIT + geo.zBack };
}

function queueDraw() {
  if (drawQueued) return;
  drawQueued = true;
  requestAnimationFrame(() => {
    drawQueued = false;
    paint();
  });
}

function resizeCanvas() {
  const el = host.value;
  const c = canvas.value;
  if (!el || !c || !ctx) return;
  dpr = Math.min(window.devicePixelRatio || 1, 1.25);
  const w = el.clientWidth;
  const h = el.clientHeight;
  c.width = Math.max(1, Math.floor(w * dpr));
  c.height = Math.max(1, Math.floor(h * dpr));
  c.style.width = `${w}px`;
  c.style.height = `${h}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function fitView() {
  const el = host.value;
  if (!el) return;
  const geo = geoNow();
  const fw = (geo.xRight - geo.xLeft) * UNIT;
  const fh = (geo.zFront - geo.zBack) * UNIT;
  const rw = el.clientWidth;
  const rh = el.clientHeight;
  if (rw < 8 || rh < 8) return;
  zoom = Math.max(0.45, Math.min(rw / (fw + 64), rh / (fh + 64), 1.25) * 0.92);
  panX = (rw - fw * zoom) / 2;
  panY = (rh - fh * zoom) / 2;
  resizeCanvas();
  queueDraw();
}

function roundRect(
  c: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

function paint() {
  const el = host.value;
  if (!ctx || !el) return;
  const w = el.clientWidth;
  const h = el.clientHeight;
  const geo = geoNow();
  const fw = (geo.xRight - geo.xLeft) * UNIT;
  const fh = (geo.zFront - geo.zBack) * UNIT;
  const layout = activeLayout();
  const crowd = (props.employees?.length ?? 0) >= 12;

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#d5e0ea";
  ctx.fillRect(0, 0, w, h);

  ctx.save();
  ctx.translate(panX, panY);
  ctx.scale(zoom, zoom);

  roundRect(ctx, 0, 0, fw, fh, 12);
  ctx.fillStyle = "#f1f5f9";
  ctx.fill();
  ctx.strokeStyle = "#94a3b8";
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.fillStyle = "#0f172a";
  ctx.font = "600 13px system-ui,sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(readCompanyName(), 14, 22);
  ctx.fillStyle = "#64748b";
  ctx.font = "11px system-ui,sans-serif";
  ctx.fillText("Canvas 2D", 14, 38);

  for (const p of layout.props) {
    if (isRoomKind(p.kind)) {
      const fp = footprint(p.kind);
      const s = worldToScreen(p.x, p.z, geo);
      const pw = fp.hx * 2 * UNIT;
      const ph = fp.hz * 2 * UNIT;
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(-(p.rotY ?? 0));
      ctx.strokeStyle = "rgba(100,116,139,0.45)";
      ctx.setLineDash([5, 4]);
      ctx.strokeRect(-pw / 2, -ph / 2, pw, ph);
      ctx.setLineDash([]);
      ctx.fillStyle = "#475569";
      ctx.font = "600 11px system-ui,sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(p.meta?.text || ROOM_DEFAULT_LABEL[p.kind] || "", 0, 4);
      ctx.restore();
      continue;
    }
    if (crowd && !isDeskKind(p.kind) && p.kind !== "wall" && p.kind !== "partition") continue;

    const fp = footprint(p.kind, p.meta?.seatCount);
    const s = worldToScreen(p.x, p.z, geo);
    const pw = fp.hx * 2 * UNIT * Math.abs(p.sx ?? p.scale ?? 1);
    const ph = fp.hz * 2 * UNIT * Math.abs(p.sz ?? p.scale ?? 1);
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(-(p.rotY ?? 0));
    if (p.id === props.selectedPropId) {
      ctx.strokeStyle = "#0ea5e9";
      ctx.lineWidth = 3;
      ctx.strokeRect(-pw / 2 - 3, -ph / 2 - 3, pw + 6, ph + 6);
    }
    const fill = deskColor(p.kind, p.color);
    if (isDeskKind(p.kind)) {
      ctx.fillStyle = fill;
      roundRect(ctx, -pw * 0.42, -ph * 0.28, pw * 0.84, ph * 0.42, 4);
      ctx.fill();
      ctx.fillStyle = "#0f172a";
      ctx.fillRect(-pw * 0.18, -ph * 0.42, pw * 0.36, ph * 0.16);
      ctx.fillStyle = "#334155";
      roundRect(ctx, -pw * 0.16, ph * 0.18, pw * 0.32, ph * 0.22, 6);
      ctx.fill();
    } else if (p.kind === "wall" || p.kind === "partition") {
      ctx.fillStyle = "#94a3b8";
      ctx.fillRect(-pw * 0.1, -ph / 2, pw * 0.2, ph);
    } else {
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.ellipse(0, 0, Math.max(8, pw * 0.35), Math.max(8, ph * 0.35), 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  for (const emp of props.employees ?? []) {
    if (emp.deskIndex == null && emp.roleKind !== "boss") continue;
    let wx = 0;
    let wz = 0;
    if (emp.roleKind === "boss" && emp.deskIndex == null) {
      const chair = layout.props.find((p) => p.kind === "chair_exec");
      wx = chair?.x ?? -6.2;
      wz = chair?.z ?? 0.55;
    } else if (emp.deskIndex != null) {
      const seat = findSeatForDeskIndex(layout, emp.deskIndex);
      if (!seat) continue;
      wx = seat.x;
      wz = seat.z;
    } else continue;
    const s = worldToScreen(wx, wz, geo);
    const av = getAvatar(emp.avatarId);
    const prefs = displayPrefs.value;
    const statText = statusLabel(emp.status);
    const dotColor = prefs.showStatusDot ? (STATUS[emp.status] ?? "#94a3b8") : "#94a3b8";
    ctx.beginPath();
    ctx.arc(s.x, s.y, 13, 0, Math.PI * 2);
    ctx.fillStyle = dotColor;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(s.x, s.y, 10, 0, Math.PI * 2);
    ctx.fillStyle = av.shirt;
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.font = "700 11px system-ui,sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(emp.name.slice(0, 1), s.x, s.y + 0.5);
    const label = formatCompactLabel(emp, prefs, statText);
    ctx.font = "600 10px system-ui,sans-serif";
    const tw = ctx.measureText(label).width + 10;
    ctx.fillStyle = "rgba(15,23,42,0.88)";
    roundRect(ctx, s.x - tw / 2, s.y - 28, tw, 14, 6);
    ctx.fill();
    ctx.fillStyle = dotColor;
    ctx.fillText(label, s.x, s.y - 21);
    const nameOnly = formatPrimaryLine(emp, prefs);
    const nw = ctx.measureText(nameOnly).width + 8;
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    roundRect(ctx, s.x - nw / 2, s.y + 14, nw, 13, 6);
    ctx.fill();
    ctx.fillStyle = "#0f172a";
    ctx.fillText(nameOnly, s.x, s.y + 20.5);
  }

  ctx.restore();
}

function hitProp(worldX: number, worldZ: number): OfficeProp | null {
  const layout = activeLayout();
  for (let i = layout.props.length - 1; i >= 0; i--) {
    const p = layout.props[i]!;
    if (isRoomKind(p.kind) && !props.editMode) continue;
    const fp = footprint(p.kind, p.meta?.seatCount);
    const sx = Math.abs(p.sx ?? p.scale ?? 1);
    const sz = Math.abs(p.sz ?? p.scale ?? 1);
    if (Math.abs(worldX - p.x) <= fp.hx * sx && Math.abs(worldZ - p.z) <= fp.hz * sz) return p;
  }
  return null;
}

function hitEmployee(worldX: number, worldZ: number): string | null {
  const layout = activeLayout();
  for (const emp of props.employees ?? []) {
    if (emp.deskIndex == null && emp.roleKind !== "boss") continue;
    let wx = 0;
    let wz = 0;
    if (emp.roleKind === "boss" && emp.deskIndex == null) {
      const chair = layout.props.find((p) => p.kind === "chair_exec");
      wx = chair?.x ?? -6.2;
      wz = chair?.z ?? 0.55;
    } else if (emp.deskIndex != null) {
      const seat = findSeatForDeskIndex(layout, emp.deskIndex);
      if (!seat) continue;
      wx = seat.x;
      wz = seat.z;
    } else continue;
    const dx = (worldX - wx) * UNIT;
    const dz = (worldZ - wz) * UNIT;
    if (dx * dx + dz * dz < 16 * 16) return emp.id;
  }
  return null;
}

function patchLayout(mutator: (list: OfficeProp[]) => OfficeProp[]) {
  const cur = activeLayout();
  emit("update:layout", { version: 1, props: mutator(cur.props.map((p) => ({ ...p }))) });
}

function placeAt(x: number, z: number) {
  const kind = props.placeKind;
  if (!kind) return;
  const id = newPropId(kind);
  const meta: OfficeProp["meta"] = {};
  if (isDeskKind(kind)) {
    meta.deskIndex = nextDeskSeatIndex(activeLayout().props);
    if (props.placeSeatCount != null && props.placeSeatCount > 0) meta.seatCount = props.placeSeatCount;
  }
  if (isRoomKind(kind)) meta.text = ROOM_DEFAULT_LABEL[kind] || kind;
  if (isWallCutKind(kind) || isWallMountKind(kind)) meta.length = wallCutSpanForProp({ kind }).half * 2;
  patchLayout((list) => [
    ...list,
    {
      id,
      kind,
      x,
      y: 0,
      z,
      rotY: 0,
      scale: 1,
      ...(props.placeColor ? { color: props.placeColor } : {}),
      ...(Object.keys(meta).length ? { meta } : {}),
    },
  ]);
  emit("update:selectedPropId", id);
  emit("update:placeKind", null);
}

function startPan(e: PointerEvent) {
  panning = true;
  panLast = { x: e.clientX, y: e.clientY };
  host.value?.setPointerCapture(e.pointerId);
  e.preventDefault();
}

function onPointerDown(e: PointerEvent) {
  const world = clientToWorld(e.clientX, e.clientY);
  if (!world) return;

  if (!props.editMode) {
    if (e.button === 0) {
      const empId = hitEmployee(world.x, world.z);
      if (empId) {
        emit("edit-employee", empId);
        return;
      }
    }
    startPan(e);
    return;
  }

  if (spaceHeld || e.button === 1 || e.button === 2) {
    startPan(e);
    return;
  }

  const hit = hitProp(world.x, world.z);
  if (hit) {
    emit("update:selectedPropId", hit.id);
    emit("update:placeKind", null);
    draggingId = hit.id;
    dragOrigin = { x: world.x - hit.x, z: world.z - hit.z };
    host.value?.setPointerCapture(e.pointerId);
    queueDraw();
    return;
  }
  if (props.placeKind) {
    placeAt(world.x, world.z);
    return;
  }
  emit("update:selectedPropId", null);
  queueDraw();
}

function onPointerMove(e: PointerEvent) {
  if (panning) {
    panX += e.clientX - panLast.x;
    panY += e.clientY - panLast.y;
    panLast = { x: e.clientX, y: e.clientY };
    queueDraw();
    return;
  }
  if (!draggingId || !props.editMode) return;
  const world = clientToWorld(e.clientX, e.clientY);
  if (!world) return;
  patchLayout((list) =>
    list.map((p) =>
      p.id === draggingId ? { ...p, x: world.x - dragOrigin.x, z: world.z - dragOrigin.z } : p,
    ),
  );
}

function onPointerUp() {
  panning = false;
  draggingId = null;
}

function onWheel(e: WheelEvent) {
  e.preventDefault();
  zoom = Math.min(2.2, Math.max(0.4, zoom * (e.deltaY > 0 ? 0.92 : 1.08)));
  queueDraw();
}

function onContextMenu(e: MouseEvent) {
  if (!props.editMode) return;
  e.preventDefault();
  if (props.placeKind) emit("update:placeKind", null);
}

function onKeyDown(e: KeyboardEvent) {
  if (e.code === "Space") spaceHeld = true;
  if (!props.editMode) return;
  if (e.key === "Delete" || e.key === "Backspace") {
    const id = props.selectedPropId;
    if (!id) return;
    const victim = activeLayout().props.find((p) => p.id === id);
    const seats = victim && isDeskKind(victim.kind) ? seatIndicesOnProp(victim) : [];
    patchLayout((list) => list.filter((p) => p.id !== id));
    emit("update:selectedPropId", null);
    if (seats.length) emit("desks-removed", seats);
  }
  if (e.key === "Escape") {
    emit("update:placeKind", null);
    emit("update:selectedPropId", null);
  }
}

function onKeyUp(e: KeyboardEvent) {
  if (e.code === "Space") spaceHeld = false;
}

onMounted(() => {
  ctx = canvas.value?.getContext("2d", { alpha: false }) ?? null;
  fitView();
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("resize", fitView);
  window.addEventListener("xu-office-display", onDisplayPrefsChanged);
});

onUnmounted(() => {
  window.removeEventListener("keydown", onKeyDown);
  window.removeEventListener("keyup", onKeyUp);
  window.removeEventListener("resize", fitView);
  window.removeEventListener("xu-office-display", onDisplayPrefsChanged);
});

watch(
  () => [props.layout, props.employees, props.selectedPropId, props.editMode, props.deskCount] as const,
  () => queueDraw(),
);

defineExpose({
  rotateSelected() {},
  flipSelected() {},
  scaleSelected() {},
  copySelected() {},
});
</script>

<template>
  <div
    ref="host"
    class="office-2d-host"
    data-xu-context
    :class="{ editing: editMode, placing: Boolean(placeKind) }"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerUp"
    @wheel="onWheel"
    @contextmenu="onContextMenu"
  >
    <canvas ref="canvas" />
  </div>
</template>

<style scoped>
.office-2d-host {
  position: absolute;
  inset: 0;
  overflow: hidden;
  cursor: grab;
  touch-action: none;
  user-select: none;
  background: #d5e0ea;
}
.office-2d-host.editing {
  cursor: crosshair;
}
.office-2d-host.placing {
  cursor: copy;
}
.office-2d-host:active {
  cursor: grabbing;
}
.office-2d-host canvas {
  display: block;
  width: 100%;
  height: 100%;
}
</style>
