<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from "vue";
import { listen } from "@tauri-apps/api/event";
import { FouButton } from "foucui";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  type Employee,
  type EmployeeStatus,
} from "../utils/employees";
import { makePerson } from "../office/personMesh";
import type { OfficeLayout, OfficeProp, PropKind } from "../office/catalog";
import {
  clampPropScale,
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
import { createPropMesh, type MeshTheme } from "../office/meshes";
import { preloadOfficeAssets } from "../office/assets/loadGltf";
import { buildDefaultOfficeLayout } from "../office/defaultLayout";
import { findSeatForDeskIndex } from "../office/seatPlacement";
import { readCompanyName } from "../utils/brandSettings";
import {
  readOfficeDisplayPrefs,
  type OfficeDisplayPrefs,
} from "../utils/officeDisplayPrefs";
import {
  formatPrimaryLine,
  formatSecondaryLine,
} from "../office/formatEmployeeLabel";
import {
  buildDoorPath,
  clampToZone,
  currentRoomRects,
  randomPointInZone,
  stepAlongPath,
  syncZonesFromLayout,
  walkFacingYaw,
  zoneAt,
  type ZoneId,
} from "../office/zones";
import {
  computeFloorGeometry,
  FLOOR_DOOR_HALF,
  resolveAreaMeta,
  resolveFloorRooms,
} from "../office/floorPlan";
import { footprintFor, resolveWalk, type Aabb2 } from "../office/collision";
import { readProjectThemeLocal } from "../utils/projectTheme";
import {
  getLivePatch,
  subscribeEmployeeLive,
  subscribeAgentLive,
  isAgentBubbleWorthy,
  agentBubbleText,
  mapEventState,
  type AgentLiveEvent,
  type EmployeeLiveEvent,
} from "../employee/events";
import {
  agentBubblePhase,
  bubbleSecondsForPhase,
  shouldReplaceBubble,
  type AgentBubblePhase,
} from "../utils/agentBubbleFsm";

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
  /** Seat numbers removed with a desk prop — parent should unbind employees only. */
  "desks-removed": [seats: number[]];
  "edit-employee": [employeeId: string];
}>();

function activeLayout(): OfficeLayout {
  if (props.layout?.props && Array.isArray(props.layout.props)) return props.layout;
  return buildDefaultOfficeLayout(props.deskCount ?? 6);
}

function floorGeo() {
  const layout = activeLayout();
  return computeFloorGeometry(resolveFloorRooms(layout), resolveAreaMeta(layout));
}

function partitionXs(): number[] {
  return floorGeo().partitions;
}

const host = ref<HTMLElement | null>(null);

let displayPrefs: OfficeDisplayPrefs = readOfficeDisplayPrefs();

function onDisplayPrefsChanged() {
  displayPrefs = readOfficeDisplayPrefs();
  for (const agent of agents) {
    refreshAgentLabel(agent);
  }
}

let renderer: THREE.WebGLRenderer | null = null;
let scene: THREE.Scene | null = null;
let camera: THREE.PerspectiveCamera | null = null;
let controls: OrbitControls | null = null;
let animId = 0;
let unlistenScreenshot: (() => void) | undefined;
let rebuildTimer: number | null = null;
let structureGroup: THREE.Group | null = null;
let propsGroup: THREE.Group | null = null;
let peopleGroup: THREE.Group | null = null;
let ghostMesh: THREE.Group | null = null;
let clock = new THREE.Timer();
let themeObserver: MutationObserver | null = null;
let resizeObserver: ResizeObserver | null = null;
let raycaster = new THREE.Raycaster();
let pointer = new THREE.Vector2();
let groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
let draggingId: string | null = null;
let dragOffset = new THREE.Vector3();
let dragLivePos: { x: number; z: number; y?: number; rotY?: number } = { x: 0, z: 0 };
let gridHelper: THREE.GridHelper | null = null;
/** Ghost yaw while placing. */
let ghostRotY = 0;
/** Space held → left-drag rotates the canvas in edit mode. */
let spaceOrbit = false;
/** Rotate-gizmo mode: ring + RMB drag to yaw selected prop. */
const rotateMode = ref(false);
const toolbarStyle = ref<{ left: string; top: string; display?: string } | null>(null);
let rotateGizmo: THREE.Group | null = null;
let rotateDragging = false;
let rotatePivot = new THREE.Vector3();
let rotateStartPointerAngle = 0;
let rotateStartRotY = 0;
let rotateLiveRotY = 0;

/** Desk chair seat offset (local +Z of desk mesh). */
const CHAIR_Z = 0.5;
/** Face monitors: character face/eyes are on local −Z; desk screens sit at −Z from chair. */
const FACE_DESK = 0;

interface FloorAgent {
  empId: string;
  emp: Employee;
  mesh: THREE.Group;
  mode: "sit" | "walk";
  pose: "sit" | "stand";
  path: Array<{ x: number; z: number }>;
  pathIdx: number;
  home: { x: number; z: number; rotY: number };
  sitUntil: number;
  isBoss: boolean;
  /** tea | snack | peer | home | none */
  purpose: "tea" | "snack" | "peer" | "home" | "none";
  visitTargetId: string | null;
  bubbleUntil: number;
  bubbleText: string | null;
  bubblePhase: AgentBubblePhase | null;
  awayUntil: number;
  /** simTime when current walk last made progress — abort if stuck */
  stuckSince: number;
  lastX: number;
  lastZ: number;
}

type DomBubble = { empId: string; text: string; left: number; top: number };
const domBubbles = ref<DomBubble[]>([]);

let agents: FloorAgent[] = [];
let simTime = 0;
/** Solid walls / partitions only — never desks (desks pinned walkers). */
let wallBlockers: Aabb2[] = [];
interface DoorActor {
  propId: string;
  x: number;
  z: number;
  baseRotY: number;
  closedBox: Aabb2;
  openUntil: number;
}
let doorActors: DoorActor[] = [];
const MAX_WALKERS = 1;
let unsubLive: (() => void) | null = null;
let unsubAgent: (() => void) | null = null;
let nextAmbientAt = 120;

const PEER_LINES: string[] = []; // 禁止假闲聊台词；冒泡只来自真实 live 事件

function pushWallSegmentsX(
  boxes: Aabb2[],
  wallX: number,
  z0: number,
  z1: number,
  holes: Array<[number, number]>,
  half = 0.12,
) {
  const spans = mergeIntervals(holes);
  let cursor = z0;
  for (const [a, b] of spans) {
    const lo = Math.max(a, z0);
    const hi = Math.min(b, z1);
    if (lo > cursor + 0.05) {
      boxes.push({ xMin: wallX - half, xMax: wallX + half, zMin: cursor, zMax: lo });
    }
    cursor = Math.max(cursor, hi);
  }
  if (z1 > cursor + 0.05) {
    boxes.push({ xMin: wallX - half, xMax: wallX + half, zMin: cursor, zMax: z1 });
  }
}

function pushWallSegmentsZ(
  boxes: Aabb2[],
  wallZ: number,
  x0: number,
  x1: number,
  holes: Array<[number, number]>,
  half = 0.12,
) {
  const spans = mergeIntervals(holes);
  let cursor = x0;
  for (const [a, b] of spans) {
    const lo = Math.max(a, x0);
    const hi = Math.min(b, x1);
    if (lo > cursor + 0.05) {
      boxes.push({ xMin: cursor, xMax: lo, zMin: wallZ - half, zMax: wallZ + half });
    }
    cursor = Math.max(cursor, hi);
  }
  if (x1 > cursor + 0.05) {
    boxes.push({ xMin: cursor, xMax: x1, zMin: wallZ - half, zMax: wallZ + half });
  }
}

function harvestWallBoxesFromObject(
  root: THREE.Object3D | null,
  boxes: Aabb2[],
  mode: "structure" | "prop",
) {
  if (!root) return;
  const tmp = new THREE.Box3();
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    let p: THREE.Object3D | null = o;
    while (p) {
      if (p.userData.doorLeaf || p.userData.hasDoorLeaf) return;
      if (String(p.userData.kind || "").startsWith("door")) return;
      p = p.parent;
    }
    if (mode === "structure" && o.userData.wall !== true) return;
    tmp.setFromObject(o);
    if (tmp.min.y > 0.45) return;
    if (tmp.max.y - tmp.min.y < 0.35) return;
    const hx = tmp.max.x - tmp.min.x;
    const hz = tmp.max.z - tmp.min.z;
    if (hx < 0.04 && hz < 0.04) return;
    boxes.push({
      xMin: tmp.min.x,
      xMax: tmp.max.x,
      zMin: tmp.min.z,
      zMax: tmp.max.z,
    });
  });
}

function rebuildWalkBlockers() {
  const layout = activeLayout();
  const geo = floorGeo();
  const boxes: Aabb2[] = [];
  const doors: DoorActor[] = [];
  const halfDoor = FLOOR_DOOR_HALF;
  const wallHalf = 0.18;

  // Match visible walls (structure + wall/partition props)
  harvestWallBoxesFromObject(structureGroup, boxes, "structure");
  if (propsGroup) {
    for (const child of propsGroup.children) {
      const kind = String(child.userData.kind || "");
      if (kind === "wall" || kind === "partition") harvestWallBoxesFromObject(child, boxes, "prop");
    }
  }

  // Analytic perimeter rooms (door hole only)
  for (const r of geo.rects) {
    if (r.zone !== "perimeter") continue;
    const doorHolesX: Array<[number, number]> =
      r.doorWall === "z" ? [[r.doorX - halfDoor, r.doorX + halfDoor]] : [];
    const doorHolesZ: Array<[number, number]> =
      r.doorWall === "x" ? [[r.doorZ - halfDoor, r.doorZ + halfDoor]] : [];
    pushWallSegmentsZ(
      boxes,
      r.zMin,
      r.xMin,
      r.xMax,
      r.doorWall === "z" && Math.abs(r.doorZ - r.zMin) < 0.25 ? doorHolesX : [],
      wallHalf,
    );
    pushWallSegmentsZ(
      boxes,
      r.zMax,
      r.xMin,
      r.xMax,
      r.doorWall === "z" && Math.abs(r.doorZ - r.zMax) < 0.25 ? doorHolesX : [],
      wallHalf,
    );
    pushWallSegmentsX(
      boxes,
      r.xMin,
      r.zMin,
      r.zMax,
      r.doorWall === "x" && Math.abs(r.doorX - r.xMin) < 0.25 ? doorHolesZ : [],
      wallHalf,
    );
    pushWallSegmentsX(
      boxes,
      r.xMax,
      r.zMin,
      r.zMax,
      r.doorWall === "x" && Math.abs(r.doorX - r.xMax) < 0.25 ? doorHolesZ : [],
      wallHalf,
    );
  }

  const zBack = geo.zBack + 0.1;
  const zFront = geo.zFront - 0.1;
  const xLeft = geo.xLeft + 0.1;
  const xRight = geo.xRight - 0.1;
  const ent = geo.mainEntrance;
  pushWallSegmentsZ(boxes, zBack, xLeft, xRight, [], wallHalf);
  pushWallSegmentsZ(boxes, zFront, xLeft, xRight, [[ent.x - ent.half, ent.x + ent.half]], wallHalf);
  pushWallSegmentsX(boxes, xLeft, zBack, zFront, [], wallHalf);
  pushWallSegmentsX(boxes, xRight, zBack, zFront, [], wallHalf);

  for (const p of layout.props) {
    if (!String(p.kind).startsWith("door")) continue;
    const box = footprintFor(p.kind, p.x, p.z, p.rotY ?? 0, p.scale ?? 1, 1);
    if (!box) continue;
    const pad = 0.08;
    doors.push({
      propId: p.id,
      x: p.x,
      z: p.z,
      baseRotY: p.rotY ?? 0,
      closedBox: {
        xMin: box.xMin - pad,
        xMax: box.xMax + pad,
        zMin: box.zMin - pad,
        zMax: box.zMax + pad,
      },
      openUntil: 0,
    });
  }

  const prevOpen = new Map(doorActors.map((d) => [d.propId, d.openUntil] as const));
  for (const d of doors) {
    const prev = prevOpen.get(d.propId);
    if (prev != null && prev > simTime) d.openUntil = prev;
  }
  wallBlockers = boxes;
  doorActors = doors;
}

function zoneCrossingAllowed(from: { x: number; z: number }, to: { x: number; z: number }): boolean {
  const a = zoneAt(from.x, from.z);
  const b = zoneAt(to.x, to.z);
  if (a === b) return true;
  // Crossing rooms only at a door; auto-open when the step is near a door.
  return doorActors.some((d) => {
    const midX = (from.x + to.x) * 0.5;
    const midZ = (from.z + to.z) * 0.5;
    const near =
      Math.hypot(d.x - midX, d.z - midZ) < 1.35 ||
      Math.hypot(d.x - from.x, d.z - from.z) < 1.1 ||
      Math.hypot(d.x - to.x, d.z - to.z) < 1.1;
    if (!near) return false;
    d.openUntil = Math.max(d.openUntil, simTime + 4.2);
    return true;
  });
}

function openDoorsNear(x: number, z: number, radius = 0.95) {
  for (const d of doorActors) {
    if (Math.hypot(d.x - x, d.z - z) <= radius) {
      d.openUntil = Math.max(d.openUntil, simTime + 3.8);
    }
  }
}

function effectiveWalkBlockers(): Aabb2[] {
  const openDoors = doorActors.filter((d) => simTime < d.openUntil);
  const boxes: Aabb2[] = [];
  for (const b of wallBlockers) {
    // 门已开：去掉与门洞重叠的薄墙段，避免「开了门仍进不去」
    if (openDoors.some((d) => wallSealsOpenDoor(b, d))) continue;
    boxes.push(b);
  }
  for (const d of doorActors) {
    if (simTime >= d.openUntil) boxes.push(d.closedBox);
  }
  return boxes;
}

/** Thin wall AABBs that still plug an open doorway. */
function wallSealsOpenDoor(b: Aabb2, d: DoorActor): boolean {
  const o = d.closedBox;
  const pad = 0.35;
  const ox0 = o.xMin - pad;
  const ox1 = o.xMax + pad;
  const oz0 = o.zMin - pad;
  const oz1 = o.zMax + pad;
  const overlapX = Math.min(b.xMax, ox1) - Math.max(b.xMin, ox0);
  const overlapZ = Math.min(b.zMax, oz1) - Math.max(b.zMin, oz0);
  if (overlapX <= 0 || overlapZ <= 0) return false;
  const bw = b.xMax - b.xMin;
  const bd = b.zMax - b.zMin;
  // Only carve thin wall pieces (not whole rooms)
  return bw < 1.2 || bd < 1.2;
}

function nearestDoor(x: number, z: number, maxDist = 1.6): DoorActor | null {
  let best: DoorActor | null = null;
  let bestD = maxDist;
  for (const d of doorActors) {
    const dist = Math.hypot(d.x - x, d.z - z);
    if (dist < bestD) {
      bestD = dist;
      best = d;
    }
  }
  return best;
}

/** Push agent through an open door toward destination side. */
function nudgeThroughNearestDoor(agent: FloorAgent): boolean {
  const x = agent.mesh.position.x;
  const z = agent.mesh.position.z;
  const door = nearestDoor(x, z, 1.7);
  if (!door) return false;
  door.openUntil = Math.max(door.openUntil, simTime + 5);
  const target = agent.path[agent.pathIdx] ?? agent.path[agent.path.length - 1];
  if (!target) return false;
  // Step from door center toward next waypoint / dest
  const dx = target.x - door.x;
  const dz = target.z - door.z;
  const len = Math.hypot(dx, dz) || 1;
  const nx = door.x + (dx / len) * 0.85;
  const nz = door.z + (dz / len) * 0.85;
  agent.mesh.position.x = nx;
  agent.mesh.position.z = nz;
  agent.lastX = nx;
  agent.lastZ = nz;
  agent.stuckSince = 0;
  // Skip waypoints that are still on the near side of the door
  while (
    agent.pathIdx < agent.path.length - 1 &&
    Math.hypot(agent.path[agent.pathIdx]!.x - door.x, agent.path[agent.pathIdx]!.z - door.z) < 0.55
  ) {
    agent.pathIdx += 1;
  }
  return true;
}

function updateDoorMeshes(dt: number) {
  if (!propsGroup) return;
  const speed = 3.6;
  for (const child of propsGroup.children) {
    const id = child.userData.propId as string | undefined;
    if (!id || !child.userData.hasDoorLeaf) continue;
    const door = doorActors.find((d) => d.propId === id);
    if (!door) continue;
    const open = simTime < door.openUntil;
    // Keep frame fixed — only swing leaf groups around hinge
    child.rotation.y = door.baseRotY;
    child.traverse((o) => {
      if (!o.userData.doorLeaf) return;
      const dir = (o.userData.doorLeafDir as number | undefined) ?? 1;
      const target = open ? dir * Math.PI * 0.82 : 0;
      const cur = o.rotation.y;
      let diff = target - cur;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      if (Math.abs(diff) < 0.012) {
        o.rotation.y = target;
        return;
      }
      o.rotation.y = cur + Math.sign(diff) * Math.min(Math.abs(diff), speed * dt);
    });
  }
}

const SNAP = 0.25;
const WALL_SNAP_DIST = 0.35;
const WALL_SNAP_ROOM = 0.55;
const WALL_GAP = 0.02;
const WALL_MOUNT_FALLBACK = 1.15;

type WallHole = { t0: number; t1: number; y0: number; y1: number };

function mergeIntervals(intervals: Array<[number, number]>): Array<[number, number]> {
  if (!intervals.length) return [];
  const sorted = [...intervals].sort((a, b) => a[0] - b[0]);
  const out: Array<[number, number]> = [[sorted[0][0], sorted[0][1]]];
  for (let i = 1; i < sorted.length; i++) {
    const last = out[out.length - 1];
    if (sorted[i][0] <= last[1] + 0.02) last[1] = Math.max(last[1], sorted[i][1]);
    else out.push([sorted[i][0], sorted[i][1]]);
  }
  return out;
}

/** Align prop local +X (thickness) with wall normal — fixes 90° mis-orientation. */
function wallMountRotY(normal: THREE.Vector3): number {
  return Math.atan2(-normal.z, normal.x);
}

function holesOnWallX(wallX: number, list: OfficeProp[]): WallHole[] {
  const out: WallHole[] = [];
  for (const p of list) {
    if (!isWallCutKind(p.kind)) continue;
    if (Math.abs(p.x - wallX) > 0.45) continue;
    const { half, y0, y1 } = wallCutSpanForProp(p);
    out.push({ t0: p.z - half, t1: p.z + half, y0, y1 });
  }
  return out;
}

function holesOnWallZ(wallZ: number, list: OfficeProp[]): WallHole[] {
  const out: WallHole[] = [];
  for (const p of list) {
    if (!isWallCutKind(p.kind)) continue;
    if (Math.abs(p.z - wallZ) > 0.45) continue;
    const { half, y0, y1 } = wallCutSpanForProp(p);
    out.push({ t0: p.x - half, t1: p.x + half, y0, y1 });
  }
  return out;
}

function snap(v: number): number {
  return Math.round(v / SNAP) * SNAP;
}

function shouldWallSnap(kind: string): boolean {
  return (
    !kind.startsWith("door") &&
    !kind.startsWith("window") &&
    kind !== "banner" &&
    kind !== "opening"
  );
}

/** Snap prop center so a near face sticks to outer/partition walls; still draggable away. */
function snapToWalls(
  kind: string,
  x: number,
  z: number,
  rotY = 0,
  scale = 1,
): { x: number; z: number } {
  const box = footprintFor(kind, x, z, rotY, scale);
  if (!box) return { x, z };
  const hx = (box.xMax - box.xMin) / 2;
  const hz = (box.zMax - box.zMin) / 2;
  let nx = x;
  let nz = z;
  const thresh = isRoomKind(kind) ? WALL_SNAP_ROOM : WALL_SNAP_DIST;
  const geo = floorGeo();

  const leftEdge = nx - hx;
  const rightEdge = nx + hx;
  if (Math.abs(leftEdge - geo.xLeft) < thresh) nx = geo.xLeft + hx + WALL_GAP;
  else if (Math.abs(rightEdge - geo.xRight) < thresh) nx = geo.xRight - hx - WALL_GAP;

  for (const wx of geo.partitions) {
    const leftToWall = Math.abs(leftEdge - wx);
    const rightToWall = Math.abs(rightEdge - wx);
    if (leftToWall < thresh && leftToWall <= rightToWall) nx = wx + hx + WALL_GAP;
    else if (rightToWall < thresh) nx = wx - hx - WALL_GAP;
  }

  const backEdge = nz - hz;
  const frontEdge = nz + hz;
  if (Math.abs(backEdge - geo.zBack) < thresh) nz = geo.zBack + hz + WALL_GAP;
  else if (Math.abs(frontEdge - geo.zFront) < thresh) nz = geo.zFront - hz - WALL_GAP;

  return { x: snap(nx), z: snap(nz) };
}

function applyPropTransform(
  mesh: THREE.Object3D,
  p: Pick<OfficeProp, "rotY" | "scale" | "sx" | "sy" | "sz" | "flipX" | "flipZ">,
) {
  mesh.rotation.y = p.rotY;
  const u = p.scale ?? 1;
  const sx = (p.sx ?? u) * (p.flipX ? -1 : 1);
  const sy = p.sy ?? u;
  const sz = (p.sz ?? u) * (p.flipZ ? -1 : 1);
  mesh.scale.set(sx, sy, sz);
}

const WALL_H = 2.4;
const DOOR_H = 2.05;

let themeColors: MeshTheme & { canvas: number } = {
  primary: 0x2a6b5a,
  canvas: 0xd8e3ef,
  surface: 0xe8eef4,
  wood: 0xb8956c,
  accent: 0x4a90c4,
};

const STATUS_COLORS: Record<EmployeeStatus, number> = {
  idle: 0x9aa3ad,
  working: 0x3dba8c,
  meeting: 0x4c6ef5,
  away: 0xd97706,
};

function cssColorToHex(raw: string, fallback: number): number {
  const v = raw.trim();
  if (!v) return fallback;
  try {
    return new THREE.Color(v).getHex();
  } catch {
    return fallback;
  }
}

function sampleThemeColors() {
  const s = getComputedStyle(document.documentElement);
  const primary = cssColorToHex(s.getPropertyValue("--primary"), 0x2a6b5a) || 0x2a6b5a;
  themeColors = {
    primary,
    canvas:
      cssColorToHex(
        s.getPropertyValue("--canvas") || s.getPropertyValue("--bg"),
        0xd8e3ef,
      ) || 0xd8e3ef,
    surface:
      cssColorToHex(
        s.getPropertyValue("--surface-soft") ||
          s.getPropertyValue("--surface-card") ||
          s.getPropertyValue("--surface") ||
          s.getPropertyValue("--card"),
        0xe8eef4,
      ) || 0xe8eef4,
    wood: new THREE.Color(primary).offsetHSL(0.05, -0.15, 0.12).getHex() || 0xb8956c,
    accent: primary,
  };
}

function applySceneTheme() {
  if (!scene) return;
  sampleThemeColors();
  scene.background = new THREE.Color(themeColors.canvas);
  // No distance fog — zooming out used to wash the far half of the floor white
  scene.fog = null;
  if (host.value) {
    host.value.style.background = `#${themeColors.canvas.toString(16).padStart(6, "0")}`;
  }
}

function makeMat(color: number | string | undefined, opts: THREE.MeshStandardMaterialParameters = {}) {
  const safeColor = color ?? 0x888888;
  const { color: optColor, emissive: optEmissive, ...rest } = opts;
  const params: THREE.MeshStandardMaterialParameters = {
    color: optColor ?? safeColor,
    roughness: 0.72,
    metalness: 0.08,
    ...rest,
  };
  if (optEmissive !== undefined && optEmissive !== null) {
    params.emissive = optEmissive as THREE.ColorRepresentation;
  }
  return new THREE.MeshStandardMaterial(params);
}

function addBox(
  parent: THREE.Object3D,
  w: number,
  h: number,
  d: number,
  color: number | string,
  x: number,
  y: number,
  z: number,
  opts?: THREE.MeshStandardMaterialParameters & { wall?: boolean },
) {
  const { wall, ...matOpts } = opts ?? {};
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), makeMat(color, matOpts));
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  if (wall) mesh.userData.wall = true;
  parent.add(mesh);
  return mesh;
}

/** Partition wall along X=wallX spanning zMin..zMax; holes carve door/window openings. */
function addCarvedWallX(
  parent: THREE.Object3D,
  wallX: number,
  zMin: number,
  zMax: number,
  holes: WallHole[],
  color: number,
  thickness = 0.14,
) {
  const spans = mergeIntervals(holes.map((h) => [h.t0, h.t1] as [number, number]));
  let cursor = zMin;
  for (const [a, b] of spans) {
    const lo = Math.max(a, zMin);
    const hi = Math.min(b, zMax);
    if (lo > cursor + 0.02) {
      const len = lo - cursor;
      const mid = (cursor + lo) / 2;
      addBox(parent, thickness, WALL_H, len, color, wallX, WALL_H / 2, mid, { wall: true });
    }
    cursor = Math.max(cursor, hi);
  }
  if (zMax > cursor + 0.02) {
    const len = zMax - cursor;
    const mid = (cursor + zMax) / 2;
    addBox(parent, thickness, WALL_H, len, color, wallX, WALL_H / 2, mid, { wall: true });
  }
  for (const h of holes) {
    const t0 = Math.max(h.t0, zMin);
    const t1 = Math.min(h.t1, zMax);
    if (t1 <= t0 + 0.02) continue;
    const mid = (t0 + t1) / 2;
    const len = t1 - t0;
    if (h.y0 > 0.04) {
      addBox(parent, thickness, h.y0, len, color, wallX, h.y0 / 2, mid, { wall: true });
    }
    if (h.y1 < WALL_H - 0.04) {
      const lh = WALL_H - h.y1;
      addBox(parent, thickness, lh, len, color, wallX, h.y1 + lh / 2, mid, { wall: true });
    }
  }
}

/** Outer wall along Z=wallZ spanning xMin..xMax with carved holes. */
function addCarvedWallZ(
  parent: THREE.Object3D,
  wallZ: number,
  xMin: number,
  xMax: number,
  holes: WallHole[],
  color: number,
  thickness = 0.16,
) {
  const spans = mergeIntervals(holes.map((h) => [h.t0, h.t1] as [number, number]));
  let cursor = xMin;
  for (const [a, b] of spans) {
    const lo = Math.max(a, xMin);
    const hi = Math.min(b, xMax);
    if (lo > cursor + 0.02) {
      const len = lo - cursor;
      const mid = (cursor + lo) / 2;
      addBox(parent, len, WALL_H, thickness, color, mid, WALL_H / 2, wallZ, { wall: true });
    }
    cursor = Math.max(cursor, hi);
  }
  if (xMax > cursor + 0.02) {
    const len = xMax - cursor;
    const mid = (cursor + xMax) / 2;
    addBox(parent, len, WALL_H, thickness, color, mid, WALL_H / 2, wallZ, { wall: true });
  }
  for (const h of holes) {
    const t0 = Math.max(h.t0, xMin);
    const t1 = Math.min(h.t1, xMax);
    if (t1 <= t0 + 0.02) continue;
    const mid = (t0 + t1) / 2;
    const len = t1 - t0;
    if (h.y0 > 0.04) {
      addBox(parent, len, h.y0, thickness, color, mid, h.y0 / 2, wallZ, { wall: true });
    }
    if (h.y1 < WALL_H - 0.04) {
      const lh = WALL_H - h.y1;
      addBox(parent, len, lh, thickness, color, mid, h.y1 + lh / 2, wallZ, { wall: true });
    }
  }
}

function addZoneLabel(parent: THREE.Object3D, x: number, y: number, z: number, text: string) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, 256, 64);
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.beginPath();
  const r = 14;
  ctx.moveTo(16 + r, 12);
  ctx.arcTo(240, 12, 240, 52, r);
  ctx.arcTo(240, 52, 16, 52, r);
  ctx.arcTo(16, 52, 16, 12, r);
  ctx.arcTo(16, 12, 240, 12, r);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#334155";
  ctx.font = "600 22px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 128, 32);
  const tex = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
  sprite.scale.set(2.4, 0.6, 1);
  sprite.position.set(x, y, z);
  parent.add(sprite);
}

function addDoorHeader(
  parent: THREE.Object3D,
  wallX: number,
  doorZ: number,
  label: string,
  faceSign: 1 | -1,
) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#0f172a";
  ctx.fillRect(0, 0, 512, 128);
  ctx.fillStyle = "#f8fafc";
  ctx.fillRect(8, 8, 496, 112);
  ctx.fillStyle = "#0f172a";
  ctx.font = "bold 48px system-ui,sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label.slice(0, 12), 256, 64);
  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide });
  // Partition wall is YZ; plaque in YZ (flush), normal along ±X
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.55, 0.38), mat);
  mesh.position.set(wallX + faceSign * 0.06, 2.15, doorZ);
  mesh.rotation.y = faceSign > 0 ? Math.PI / 2 : -Math.PI / 2;
  parent.add(mesh);
}

function addFrontDoorHeader(parent: THREE.Object3D, x: number, zFront: number, label: string) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#0f172a";
  ctx.fillRect(0, 0, 512, 128);
  ctx.fillStyle = "#f8fafc";
  ctx.fillRect(8, 8, 496, 112);
  ctx.fillStyle = "#0f172a";
  ctx.font = "bold 48px system-ui,sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label.slice(0, 12), 256, 64);
  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide });
  // Front wall is XY; plaque in XY (flush), facing outward (+Z) so readable from street
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 0.4), mat);
  mesh.position.set(x, 2.2, zFront + 0.06);
  mesh.rotation.y = 0;
  parent.add(mesh);
}

function buildStructure() {
  if (!structureGroup) return;
  while (structureGroup.children.length) {
    const c = structureGroup.children[0];
    structureGroup.remove(c);
    c.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        const m = obj.material;
        if (Array.isArray(m)) m.forEach((x) => x.dispose());
        else m.dispose();
      }
    });
  }

  const layout = activeLayout();
  syncZonesFromLayout(layout);
  const geo = floorGeo();
  const wallCol = new THREE.Color(themeColors.surface).offsetHSL(0, -0.05, -0.08).getHex();

  const layoutProps = layout.props;
  const { xLeft, xRight, zBack, zFront, open, mainEntrance } = geo;
  const isOpenShell = geo.layoutMode === "open_hall" || geo.layoutMode === "blank" || geo.ringDepth < 0.5;

  // One continuous floor for open hall / blank — no inner box
  if (isOpenShell) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(xRight - xLeft - 0.08, 0.12, zFront - zBack - 0.08),
      makeMat(themeColors.surface),
    );
    mesh.position.set(0, 0, 0);
    mesh.receiveShadow = true;
    mesh.userData.ground = true;
    structureGroup.add(mesh);
  } else {
    // Open plaza floor
    {
      const o = open;
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(o.xMax - o.xMin, 0.12, o.zMax - o.zMin),
        makeMat(themeColors.surface),
      );
      mesh.position.set((o.xMin + o.xMax) / 2, 0, (o.zMin + o.zMax) / 2);
      mesh.receiveShadow = true;
      mesh.userData.ground = true;
      structureGroup.add(mesh);
    }
    // Perimeter room floors
    for (let i = 0; i < geo.rects.length; i++) {
      const r = geo.rects[i];
      if (r.zone === "open") continue;
      const w = Math.max(0.2, r.xMax - r.xMin);
      const d = Math.max(0.2, r.zMax - r.zMin);
      const tint =
        i % 3 === 0
          ? new THREE.Color(themeColors.surface).offsetHSL(0.05, 0.04, -0.02).getHex()
          : i % 3 === 1
            ? themeColors.surface
            : new THREE.Color(themeColors.primary).offsetHSL(0, -0.45, 0.38).getHex();
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w - 0.04, 0.12, d - 0.04), makeMat(tint));
      mesh.position.set(r.centerX, 0, r.centerZ);
      mesh.receiveShadow = true;
      mesh.userData.ground = true;
      structureGroup.add(mesh);
    }
  }

  // Outer shell — single continuous main entrance hole on front wall
  addCarvedWallZ(structureGroup, zBack, xLeft, xRight, holesOnWallZ(zBack, layoutProps), wallCol);
  {
    const frontHoles: WallHole[] = [
      ...holesOnWallZ(zFront, layoutProps),
      {
        t0: mainEntrance.x - mainEntrance.half,
        t1: mainEntrance.x + mainEntrance.half,
        y0: 0,
        y1: DOOR_H,
      },
    ];
    addCarvedWallZ(structureGroup, zFront, xLeft, xRight, frontHoles, wallCol);
  }
  addCarvedWallX(structureGroup, xLeft, zBack, zFront, holesOnWallX(xLeft, layout.props), wallCol, 0.16);
  addCarvedWallX(structureGroup, xRight, zBack, zFront, holesOnWallX(xRight, layout.props), wallCol, 0.16);

  // Surround only: walls along actual perimeter rooms (no full inner box / 套办公室)
  if (geo.layoutMode === "surround" && geo.ringDepth > 0.5) {
    const peri = geo.rects.filter((r) => r.zone === "perimeter");
    const backRooms = peri.filter((r) => r.doorWall === "z" && Math.abs(r.doorZ - open.zMin) < 0.25);
    const leftRooms = peri.filter((r) => r.doorWall === "x" && Math.abs(r.doorX - open.xMin) < 0.25);
    const rightRooms = peri.filter((r) => r.doorWall === "x" && Math.abs(r.doorX - open.xMax) < 0.25);

    if (backRooms.length) {
      const x0 = Math.min(...backRooms.map((r) => r.xMin));
      const x1 = Math.max(...backRooms.map((r) => r.xMax));
      const holes: WallHole[] = [
        ...holesOnWallZ(open.zMin, layoutProps),
        ...backRooms.map((r) => ({
          t0: r.doorX - FLOOR_DOOR_HALF_LOCAL,
          t1: r.doorX + FLOOR_DOOR_HALF_LOCAL,
          y0: 0,
          y1: DOOR_H,
        })),
      ];
      addCarvedWallZ(structureGroup, open.zMin, x0, x1, holes, 0xc8b8a2);
      for (const r of backRooms) {
        if (r.leftWallX != null) {
          addCarvedWallX(structureGroup, r.leftWallX, zBack + 0.1, open.zMin, [], 0xc8b8a2, 0.12);
        }
        addDoorHeader(structureGroup, r.doorX, r.doorZ, r.name, 1);
      }
    }

    if (leftRooms.length) {
      const z0 = Math.min(...leftRooms.map((r) => r.zMin));
      const z1 = Math.max(...leftRooms.map((r) => r.zMax));
      const holes: WallHole[] = [
        ...holesOnWallX(open.xMin, layoutProps),
        ...leftRooms.map((r) => ({
          t0: r.doorZ - FLOOR_DOOR_HALF_LOCAL,
          t1: r.doorZ + FLOOR_DOOR_HALF_LOCAL,
          y0: 0,
          y1: DOOR_H,
        })),
      ];
      addCarvedWallX(structureGroup, open.xMin, z0, z1, holes, 0xc8b8a2, 0.14);
      for (let i = 1; i < leftRooms.length; i++) {
        const z = leftRooms[i].zMin;
        addCarvedWallZ(structureGroup, z, xLeft + 0.1, open.xMin, [], 0xc8b8a2);
      }
      for (const r of leftRooms) {
        addDoorHeader(structureGroup, r.doorX, r.doorZ, r.name, 1);
      }
    }

    if (rightRooms.length) {
      const z0 = Math.min(...rightRooms.map((r) => r.zMin));
      const z1 = Math.max(...rightRooms.map((r) => r.zMax));
      const holes: WallHole[] = [
        ...holesOnWallX(open.xMax, layoutProps),
        ...rightRooms.map((r) => ({
          t0: r.doorZ - FLOOR_DOOR_HALF_LOCAL,
          t1: r.doorZ + FLOOR_DOOR_HALF_LOCAL,
          y0: 0,
          y1: DOOR_H,
        })),
      ];
      addCarvedWallX(structureGroup, open.xMax, z0, z1, holes, 0xc8b8a2, 0.14);
      for (let i = 1; i < rightRooms.length; i++) {
        const z = rightRooms[i].zMin;
        addCarvedWallZ(structureGroup, z, open.xMax, xRight - 0.1, [], 0xc8b8a2);
      }
      for (const r of rightRooms) {
        addDoorHeader(structureGroup, r.doorX, r.doorZ, r.name, -1);
      }
    }
  }

  // Main entrance header
  addFrontDoorHeader(structureGroup, mainEntrance.x, zFront, "公司正门");
}

const FLOOR_DOOR_HALF_LOCAL = 0.55;

function addStructureBanner(x: number, y: number, z: number, text: string) {
  if (!structureGroup) return;
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 96;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = `#${themeColors.primary.toString(16).padStart(6, "0")}`;
  ctx.fillRect(0, 0, 512, 96);
  ctx.fillStyle = "#fff";
  ctx.font = "600 36px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 256, 48);
  const tex = new THREE.CanvasTexture(canvas);
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(2.6, 0.48),
    new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55 }),
  );
  mesh.position.set(x, y, z);
  mesh.userData.wall = true;
  structureGroup.add(mesh);
}

function disposeGroup(g: THREE.Group | null) {
  if (!g) return;
  while (g.children.length) {
    const c = g.children[0];
    g.remove(c);
    disposeObject(c);
  }
}

function makeCarvedWallPropMesh(p: OfficeProp, list: OfficeProp[]): THREE.Group {
  const g = new THREE.Group();
  const length = p.meta?.length ?? 2.4;
  const height = p.meta?.height ?? WALL_H;
  const thickness = 0.14;
  const col = new THREE.Color(themeColors.surface).offsetHSL(0, -0.05, -0.08).getHex();
  const nx = Math.cos(p.rotY ?? 0);
  const nz = -Math.sin(p.rotY ?? 0);
  const alongX = Math.sin(p.rotY ?? 0);
  const alongZ = Math.cos(p.rotY ?? 0);
  const holes: WallHole[] = [];
  for (const op of list) {
    if (op.id === p.id || !isWallCutKind(op.kind)) continue;
    const dx = op.x - p.x;
    const dz = op.z - p.z;
    const dist = Math.abs(dx * nx + dz * nz);
    if (dist > 0.45) continue;
    const t = dx * alongX + dz * alongZ;
    if (Math.abs(t) > length / 2 + 0.2) continue;
    const rotDiff = Math.abs(
      Math.atan2(Math.sin((op.rotY ?? 0) - (p.rotY ?? 0)), Math.cos((op.rotY ?? 0) - (p.rotY ?? 0))),
    );
    if (rotDiff > 0.55 && rotDiff < Math.PI - 0.55) continue;
    const { half, y0, y1 } = wallCutSpanForProp(op);
    holes.push({ t0: t - half, t1: t + half, y0, y1 });
  }
  const zMin = -length / 2;
  const zMax = length / 2;
  const spans = mergeIntervals(holes.map((h) => [h.t0, h.t1] as [number, number]));
  let cursor = zMin;
  for (const [a, b] of spans) {
    const lo = Math.max(a, zMin);
    const hi = Math.min(b, zMax);
    if (lo > cursor + 0.02) {
      const len = lo - cursor;
      const mid = (cursor + lo) / 2;
      addBox(g, thickness, height, len, col, 0, height / 2, mid, { wall: true });
    }
    cursor = Math.max(cursor, hi);
  }
  if (zMax > cursor + 0.02) {
    const len = zMax - cursor;
    const mid = (cursor + zMax) / 2;
    addBox(g, thickness, height, len, col, 0, height / 2, mid, { wall: true });
  }
  for (const h of holes) {
    const t0 = Math.max(h.t0, zMin);
    const t1 = Math.min(h.t1, zMax);
    if (t1 <= t0 + 0.02) continue;
    const mid = (t0 + t1) / 2;
    const len = t1 - t0;
    if (h.y0 > 0.04) {
      addBox(g, thickness, h.y0, len, col, 0, h.y0 / 2, mid, { wall: true });
    }
    if (h.y1 < height - 0.04) {
      const lh = height - h.y1;
      addBox(g, thickness, lh, len, col, 0, h.y1 + lh / 2, mid, { wall: true });
    }
  }
  g.traverse((o) => {
    if (o instanceof THREE.Mesh) o.userData.wall = true;
  });
  return g;
}

function rebuildProps() {
  if (!propsGroup) return;
  disposeGroup(propsGroup);
  const layout = activeLayout();
  for (const p of layout.props) {
    // Department identity is on door headers — do not draw indoor room posts
    if (isRoomKind(p.kind)) continue;
    const seatsOnProp =
      isDeskKind(p.kind) && p.meta?.deskIndex != null ? seatIndicesOnProp(p) : [];
    const seatEmp =
      seatsOnProp.length > 0
        ? props.employees.find((e) => e.deskIndex != null && seatsOnProp.includes(e.deskIndex))
        : undefined;
    const lit = seatEmp
      ? seatEmp.status === "working" || seatEmp.status === "meeting"
      : Boolean(p.meta?.lit);
    const mesh =
      p.kind === "wall"
        ? makeCarvedWallPropMesh(p, layout.props)
        : createPropMesh(p.kind, themeColors, {
            lit,
            text: p.meta?.text,
            color: p.color,
            height: p.meta?.height,
            length: p.meta?.length,
            seatCount: p.meta?.seatCount,
          });
    mesh.position.set(p.x, p.y, p.z);
    applyPropTransform(mesh, p);
    mesh.userData.propId = p.id;
    mesh.userData.propRoot = true;
    mesh.userData.kind = p.kind;
    if (String(p.kind).startsWith("door")) {
      mesh.userData.hasDoorLeaf = true;
      mesh.userData.doorBaseRotY = p.rotY ?? 0;
    }
    if (props.selectedPropId === p.id) {
      mesh.traverse((obj) => {
        if (obj instanceof THREE.Mesh && obj.material instanceof THREE.MeshStandardMaterial) {
          obj.material.emissive = new THREE.Color(themeColors.primary);
          obj.material.emissiveIntensity = 0.25;
        }
      });
    }
    propsGroup.add(mesh);
  }
  // After props exist — rebuild nav from visible meshes
  rebuildWalkBlockers();
}

function makeNameLabel(
  primaryLine: string,
  secondaryLine: string,
  statusText: string,
  detailText: string,
): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 400;
  canvas.height = 148;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, 400, 148);
  ctx.fillStyle = "rgba(15, 23, 42, 0.88)";
  const r = 12;
  ctx.beginPath();
  ctx.moveTo(12 + r, 8);
  ctx.arcTo(388, 8, 388, 140, r);
  ctx.arcTo(388, 140, 12, 140, r);
  ctx.arcTo(12, 140, 12, 8, r);
  ctx.arcTo(12, 8, 388, 8, r);
  ctx.closePath();
  ctx.fill();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  let y = 28;
  ctx.fillStyle = "#f8fafc";
  ctx.font = "700 24px sans-serif";
  ctx.fillText(primaryLine.slice(0, 20), 200, y);
  if (secondaryLine) {
    y += 26;
    ctx.fillStyle = "#94a3b8";
    ctx.font = "600 17px sans-serif";
    ctx.fillText(secondaryLine.slice(0, 18), 200, y);
  }
  if (statusText) {
    y += 28;
    const working = /工作|会议|写入|工具/.test(statusText);
    const away = /茶|水|点心|离开|交谈/.test(statusText);
    const resting = /休息|空闲/.test(statusText);
    ctx.fillStyle = working ? "#5eead4" : away ? "#fdba74" : resting ? "#94a3b8" : "#86efac";
    ctx.font = "700 18px sans-serif";
    ctx.fillText(statusText.slice(0, 16), 200, y);
  }
  if (detailText) {
    ctx.fillStyle = "#cbd5e1";
    ctx.font = "600 14px sans-serif";
    ctx.fillText(detailText.slice(0, 22), 200, detailText && statusText ? 112 : 84);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }),
  );
  sprite.scale.set(1.55, 0.58, 1);
  sprite.position.y = 1.55;
  sprite.renderOrder = 10;
  sprite.userData.kind = "nameLabel";
  return sprite;
}

function makeNameLabelForEmployee(emp: Employee, statusText: string, detailText: string): THREE.Sprite {
  const primary = formatPrimaryLine(emp, displayPrefs);
  const secondary = formatSecondaryLine(emp, displayPrefs, statusText);
  const status = displayPrefs.showStatusDot ? statusText : "";
  return makeNameLabel(primary, secondary, status, detailText);
}

function makeSpeechBubble(text: string): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 420;
  canvas.height = 96;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, 420, 96);
  ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
  const r = 14;
  ctx.beginPath();
  ctx.moveTo(16 + r, 8);
  ctx.arcTo(404, 8, 404, 72, r);
  ctx.arcTo(404, 72, 16, 72, r);
  ctx.arcTo(16, 72, 16, 8, r);
  ctx.arcTo(16, 8, 404, 8, r);
  ctx.closePath();
  ctx.fill();
  // tail
  ctx.beginPath();
  ctx.moveTo(200, 72);
  ctx.lineTo(212, 88);
  ctx.lineTo(188, 72);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#0f172a";
  ctx.font = "600 20px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text.slice(0, 20), 210, 40);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }),
  );
  sprite.scale.set(1.7, 0.42, 1);
  sprite.position.y = 2.15;
  sprite.renderOrder = 12;
  sprite.userData.kind = "speechBubble";
  return sprite;
}

function statusHeadline(emp: Employee, purpose: FloorAgent["purpose"]): string {
  if (purpose === "tea") return "🥤 去倒茶/喝水";
  if (purpose === "snack") return "🍪 去拿点心";
  if (purpose === "peer") return "💬 同事交谈";

  const live = getLivePatch(emp.id);
  const rosterBusy = emp.status === "working" || emp.status === "meeting";
  // Live「工作中」仅在花名册也忙，或 45s 内新鲜事件时采信（避免干完还挂着 working）
  const liveFresh = Boolean(live && Date.now() - live.at < 45_000);
  const liveBusy =
    Boolean(live) &&
    (live!.state === "working" ||
      live!.state === "running" ||
      live!.state === "meeting" ||
      live!.state === "need_confirm") &&
    (rosterBusy || liveFresh);

  if (emp.status === "meeting" || (liveBusy && (live!.state === "meeting" || live!.state === "need_confirm"))) {
    return "🔵 会议中";
  }
  if (liveBusy && live!.state !== "meeting") {
    if (live!.action === "write_file" || /写入|落地/.test(live!.message || "")) return "🟢 工作中·写文件";
    if (live!.action === "list_dir" || live!.action === "read_file") return "🟢 工作中·查看";
    if (live!.action && live!.action !== "done" && live!.action !== "idle") {
      return `🟢 工作中·${live!.action.slice(0, 8)}`;
    }
    return "🟢 工作中";
  }
  if (emp.status === "working") return "🟢 工作中";
  if (emp.status === "away") return "🟠 离开中";
  return "☕ 休息中";
}

function workLineForEmployee(emp: Employee): string {
  // 未真正工作时不挂职责/旧 live，避免看起来像全员在干活
  if (emp.status !== "working" && emp.status !== "meeting") {
    const live = getLivePatch(emp.id);
    if (!live || live.state === "idle" || live.state === "done" || Date.now() - live.at > 45_000) {
      return "";
    }
    if (live.state !== "working" && live.state !== "meeting" && live.state !== "running") return "";
  }
  const live = getLivePatch(emp.id);
  if (live?.message?.trim() && (live.state === "working" || live.state === "meeting" || live.state === "running")) {
    return live.message.trim().slice(0, 22);
  }
  if (emp.status !== "working" && emp.status !== "meeting") return "";
  const project = readProjectThemeLocal();
  const a = project?.assignments?.find((x) => x.employeeId === emp.id);
  if (a && a.status !== "done") {
    const line = (a.duty || a.checklist?.[0] || "").trim();
    if (line) return line.slice(0, 22);
  }
  return "";
}

function pickBreakZone(): ZoneId {
  const rects = currentRoomRects();
  const hit =
    rects.find((r) => /茶|休息|点心|水|餐|茶水/.test(`${r.id}${r.name}`)) ||
    rects.find((r) => r.id === "tea");
  return hit?.id ?? "tea";
}

function findAgentSprite(mesh: THREE.Group, kind: string): THREE.Sprite | null {
  let found: THREE.Sprite | null = null;
  mesh.traverse((o) => {
    if (found) return;
    if (o instanceof THREE.Sprite && o.userData.kind === kind) found = o;
  });
  return found;
}

function findStatusOrb(mesh: THREE.Group): THREE.Mesh | null {
  let found: THREE.Mesh | null = null;
  mesh.traverse((o) => {
    if (found) return;
    if (o instanceof THREE.Mesh && o.userData.kind === "statusOrb") found = o;
  });
  return found;
}

function refreshAgentLabel(agent: FloorAgent) {
  const pose = agent.pose;
  const old = findAgentSprite(agent.mesh, "nameLabel");
  if (old) {
    agent.mesh.remove(old);
    if (old.material.map) old.material.map.dispose();
    old.material.dispose();
  }
  const label = makeNameLabelForEmployee(
    agent.emp,
    statusHeadline(agent.emp, agent.purpose),
    workLineForEmployee(agent.emp),
  );
  label.position.y = pose === "sit" ? 1.92 : 1.72;
  agent.mesh.add(label);
  const orb = findStatusOrb(agent.mesh);
  if (orb && orb.material instanceof THREE.MeshStandardMaterial) {
    const c = STATUS_COLORS[agent.emp.status] ?? STATUS_COLORS.idle;
    orb.material.color.setHex(c);
    orb.material.emissive.setHex(c);
  }
}

function showSpeechBubble(agent: FloorAgent, text: string, seconds = 6, phase: AgentBubblePhase = "other") {
  const line = text.trim().slice(0, 28);
  if (!line) return;
  const remain = Math.max(0, agent.bubbleUntil - simTime);
  if (!shouldReplaceBubble(agent.bubblePhase, phase, remain)) return;
  agent.bubbleText = line;
  agent.bubblePhase = phase;
  agent.bubbleUntil = simTime + seconds;
  // 3D sprite backup
  const old = findAgentSprite(agent.mesh, "speechBubble");
  if (old) {
    agent.mesh.remove(old);
    if (old.material.map) old.material.map.dispose();
    old.material.dispose();
  }
  const bubble = makeSpeechBubble(line);
  bubble.position.y = 2.35;
  agent.mesh.add(bubble);
}

function clearExpiredBubbles() {
  for (const agent of agents) {
    if (agent.bubbleUntil > 0 && simTime >= agent.bubbleUntil) {
      const old = findAgentSprite(agent.mesh, "speechBubble");
      if (old) {
        agent.mesh.remove(old);
        if (old.material.map) old.material.map.dispose();
        old.material.dispose();
      }
      agent.bubbleUntil = 0;
      agent.bubbleText = null;
      agent.bubblePhase = null;
      if (agent.purpose === "peer" && agent.mode === "sit" && agent.awayUntil <= 0) {
        agent.purpose = "none";
        refreshAgentLabel(agent);
      }
    }
  }
}

function syncDomBubbles() {
  if (!camera || !host.value) {
    domBubbles.value = [];
    return;
  }
  const w = host.value.clientWidth;
  const h = host.value.clientHeight;
  const v = new THREE.Vector3();
  const out: DomBubble[] = [];
  for (const agent of agents) {
    if (!agent.bubbleText || agent.bubbleUntil <= simTime) continue;
    v.set(agent.mesh.position.x, agent.mesh.position.y + 2.2, agent.mesh.position.z);
    v.project(camera);
    if (v.z > 1) continue;
    out.push({
      empId: agent.empId,
      text: agent.bubbleText,
      left: (v.x * 0.5 + 0.5) * w,
      top: (-v.y * 0.5 + 0.5) * h,
    });
  }
  domBubbles.value = out;
}

function walkingCount() {
  return agents.filter((a) => a.mode === "walk").length;
}

function pickAmenityDest(purpose: "tea" | "snack"): { x: number; z: number } {
  const zone = pickBreakZone();
  const layout = activeLayout();
  const prefer =
    purpose === "snack"
      ? ["coffee", "cooler", "water_dispenser", "coffee_table", "coffee_table_round", "sofa"]
      : ["water_dispenser", "cooler", "coffee", "plant"];
  // Only amenities inside the break/tea room — avoid targets behind walls in other bays
  const hits = layout.props.filter(
    (p) => prefer.includes(p.kind) && zoneAt(p.x, p.z) === zone,
  );
  if (hits.length) {
    const p = hits[Math.floor(Math.random() * hits.length)]!;
    const rect = currentRoomRects().find((r) => r.id === zone);
    const cx = rect?.centerX ?? p.x;
    const cz = rect?.centerZ ?? p.z;
    let dx = cx - p.x;
    let dz = cz - p.z;
    const len = Math.hypot(dx, dz) || 1;
    dx /= len;
    dz /= len;
    // Stand on the walkable side toward room center (not into the prop / wall)
    return clampToZone(zone, p.x + dx * 0.9, p.z + dz * 0.9);
  }
  return randomPointInZone(zone);
}

function attachPersonExtras(mesh: THREE.Group, emp: Employee, pose: "sit" | "stand") {
  const orbY = pose === "sit" ? 1.28 : 1.05;
  const statusHex = STATUS_COLORS[emp.status] ?? STATUS_COLORS.idle;
  const orb = new THREE.Mesh(
    new THREE.SphereGeometry(0.07, 10, 10),
    makeMat(statusHex, {
      emissive: statusHex,
      emissiveIntensity: 0.4,
    }),
  );
  orb.position.set(0.22, orbY, 0);
  orb.userData.kind = "statusOrb";
  mesh.add(orb);
  const label = makeNameLabelForEmployee(
    emp,
    statusHeadline(emp, "none"),
    workLineForEmployee(emp),
  );
  label.position.y = pose === "sit" ? 1.92 : 1.72;
  mesh.add(label);
}

function remakeAgentMesh(agent: FloorAgent, pose: "sit" | "stand") {
  if (!peopleGroup) return;
  const prev = agent.mesh;
  const pos = prev.position.clone();
  const rotY = prev.rotation.y;
  peopleGroup.remove(prev);
  disposeObject(prev);
  const scale = agent.isBoss ? 1.08 : 1;
  const mesh = makePerson(
    agent.emp.avatarId,
    agent.emp.gender,
    scale,
    agent.emp.outfit,
    agent.emp.hairStyle,
    pose,
  );
  mesh.position.copy(pos);
  mesh.rotation.y = rotY;
  mesh.userData.empId = agent.emp.id;
  attachPersonExtras(mesh, agent.emp, pose);
  peopleGroup.add(mesh);
  agent.mesh = mesh;
  agent.pose = pose;
  refreshAgentLabel(agent);
  if (agent.bubbleText && agent.bubbleUntil > simTime) {
    const remain = Math.max(1.5, agent.bubbleUntil - simTime);
    showSpeechBubble(agent, agent.bubbleText, remain);
  }
}

function disposeObject(obj: THREE.Object3D) {
  obj.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      if (!o.userData.sharedGeo) o.geometry.dispose();
      const m = o.material;
      if (Array.isArray(m)) {
        m.forEach((x) => {
          if (!o.userData.sharedMat) x.dispose();
        });
      } else if (!o.userData.sharedMat) {
        if (m.map) m.map.dispose();
        m.dispose();
      }
    } else if (o instanceof THREE.Sprite) {
      const m = o.material;
      if (m.map) m.map.dispose();
      m.dispose();
    }
  });
}

function rebuildPeople() {
  if (!peopleGroup) return;
  disposeGroup(peopleGroup);
  agents = [];
  rebuildWalkBlockers();

  const layout = activeLayout();
  const execChair = layout.props.find((p) => p.kind === "chair_exec");

  for (const emp of props.employees ?? []) {
    // No desk → not on the floor (avoids hall crowd of unbound roster)
    if (emp.deskIndex == null && emp.roleKind !== "boss") continue;

    if (emp.roleKind === "boss" && emp.deskIndex == null) {
      const hx = execChair?.x ?? -6.2;
      const hz = execChair?.z ?? 0.55;
      const mesh = makePerson(emp.avatarId, emp.gender, 1.08, emp.outfit, emp.hairStyle, "sit");
      mesh.position.set(hx, 0, hz);
      mesh.rotation.y = FACE_DESK;
      mesh.userData.empId = emp.id;
      attachPersonExtras(mesh, emp, "sit");
      peopleGroup.add(mesh);
      agents.push({
        empId: emp.id,
        emp,
        mesh,
        mode: "sit",
        pose: "sit",
        path: [],
        pathIdx: 0,
        home: { x: hx, z: hz, rotY: FACE_DESK },
        sitUntil: simTime + 60 + Math.random() * 90,
        isBoss: true,
        purpose: "none",
        visitTargetId: null,
        bubbleUntil: 0,
        bubbleText: null,
        bubblePhase: null,
        awayUntil: 0,
        stuckSince: 0,
        lastX: hx,
        lastZ: hz,
      });
      continue;
    }

    const seat =
      emp.deskIndex != null ? findSeatForDeskIndex(layout, emp.deskIndex) : null;

    if (seat) {
      const mesh = makePerson(emp.avatarId, emp.gender, 1, emp.outfit, emp.hairStyle, "sit");
      mesh.position.set(seat.x, 0, seat.z);
      mesh.rotation.y = seat.rotY + FACE_DESK;
      mesh.userData.empId = emp.id;
      attachPersonExtras(mesh, emp, "sit");
      peopleGroup.add(mesh);
      agents.push({
        empId: emp.id,
        emp,
        mesh,
        mode: "sit",
        pose: "sit",
        path: [],
        pathIdx: 0,
        home: { x: seat.x, z: seat.z, rotY: seat.rotY + FACE_DESK },
        sitUntil: simTime + 40 + Math.random() * 80,
        isBoss: emp.roleKind === "boss",
        purpose: "none",
        visitTargetId: null,
        bubbleUntil: 0,
        bubbleText: null,
        bubblePhase: null,
        awayUntil: 0,
        stuckSince: 0,
        lastX: seat.x,
        lastZ: seat.z,
      });
      continue;
    }

    // Orphan deskIndex (layout changed): skip — do not spawn standees
  }
}

function beginWalk(
  agent: FloorAgent,
  dest: { x: number; z: number },
  purpose: FloorAgent["purpose"],
  visitTargetId: string | null,
  allowBoss: boolean,
) {
  if (walkingCount() >= MAX_WALKERS && agent.mode !== "walk") return false;
  const from = { x: agent.mesh.position.x, z: agent.mesh.position.z };
  let path = buildDoorPath(from, dest, { allowBoss });
  if (!path.length) path = [dest];
  // Align corridor waypoints to real door props (floorPlan door ≠ prop door)
  const cleaned: Array<{ x: number; z: number }> = [];
  for (const p of path) {
    let pt = p;
    const door = nearestDoor(p.x, p.z, 2.2);
    if (door && Math.hypot(door.x - p.x, door.z - p.z) < 1.8) {
      // Keep approach on the same side of the door as the waypoint intended
      const sx = Math.sign(p.x - door.x) || (from.x < door.x ? -1 : 1);
      const sz = Math.sign(p.z - door.z) || (from.z < door.z ? -1 : 1);
      const alongX = Math.abs(door.closedBox.xMax - door.closedBox.xMin) >
        Math.abs(door.closedBox.zMax - door.closedBox.zMin);
      pt = alongX
        ? { x: door.x, z: door.z + sz * 0.55 }
        : { x: door.x + sx * 0.55, z: door.z };
    }
    const last = cleaned[cleaned.length - 1];
    if (last && Math.hypot(last.x - pt.x, last.z - pt.z) < 0.12) continue;
    cleaned.push(pt);
  }
  if (!cleaned.length) cleaned.push(dest);
  // Ensure final dest is last
  const last = cleaned[cleaned.length - 1]!;
  if (Math.hypot(last.x - dest.x, last.z - dest.z) > 0.2) cleaned.push(dest);
  agent.path = cleaned;
  agent.pathIdx = 0;
  agent.mode = "walk";
  agent.purpose = purpose;
  agent.visitTargetId = visitTargetId;
  agent.stuckSince = 0;
  agent.lastX = from.x;
  agent.lastZ = from.z;
  agent.mesh.position.y = 0.02;
  openDoorsNear(from.x, from.z, 1.2);
  refreshAgentLabel(agent);
  return true;
}

function startAgentTrip(
  agent: FloorAgent,
  _destZone: ZoneId,
  allowBoss: boolean,
  purpose: FloorAgent["purpose"] = "tea",
) {
  const dest =
    purpose === "snack" || purpose === "tea"
      ? pickAmenityDest(purpose === "snack" ? "snack" : "tea")
      : randomPointInZone(_destZone);
  beginWalk(agent, dest, purpose, null, allowBoss);
}

function startAgentHome(agent: FloorAgent) {
  beginWalk(
    agent,
    { x: agent.home.x, z: agent.home.z },
    "home",
    null,
    agent.isBoss,
  );
  agent.sitUntil = -1;
}

function startPeerVisit(_agent: FloorAgent, _target: FloorAgent) {
  // 禁止随机假串门；真实协作冒泡由 live 事件驱动
}

function playPeerChat(_visitor: FloorAgent, _host: FloorAgent) {
  // 不再使用假台词冒泡
}

function decideSitTrip(agent: FloorAgent) {
  if (walkingCount() >= MAX_WALKERS) {
    agent.sitUntil = simTime + 30 + Math.random() * 40;
    return;
  }
  // 工作中几乎不离开工位
  if (agent.emp.status === "working" || agent.emp.status === "meeting") {
    agent.sitUntil = simTime + 50 + Math.random() * 70;
    return;
  }
  // 空闲：偶尔去茶水（很低概率），绝不随机假聊天
  if (Math.random() > 0.08) {
    agent.sitUntil = simTime + 45 + Math.random() * 60;
    return;
  }
  startAgentTrip(
    agent,
    pickBreakZone(),
    agent.isBoss,
    Math.random() < 0.55 ? "tea" : "snack",
  );
}

function forceAmbientTrip() {
  if (props.editMode) return;
  if (simTime < nextAmbientAt) return;
  nextAmbientAt = simTime + 90 + Math.random() * 120;
  if (walkingCount() >= MAX_WALKERS) return;
  const idle = agents.filter(
    (a) =>
      a.mode === "sit" &&
      a.awayUntil <= simTime &&
      !a.bubbleText &&
      a.emp.status === "idle" &&
      a.purpose === "none",
  );
  if (!idle.length || Math.random() > 0.35) return;
  const pick = idle[Math.floor(Math.random() * idle.length)]!;
  startAgentTrip(pick, pickBreakZone(), pick.isBoss, Math.random() < 0.6 ? "tea" : "snack");
}

function abortWalkHome(agent: FloorAgent) {
  agent.visitTargetId = null;
  agent.awayUntil = 0;
  agent.stuckSince = 0;
  agent.path = [];
  agent.pathIdx = 0;
  // 在墙里才瞬移；否则走回去，避免「消失」
  if (pointInAnyWall(agent.mesh.position.x, agent.mesh.position.z)) {
    agent.mode = "sit";
    agent.purpose = "none";
    agent.mesh.position.set(agent.home.x, 0, agent.home.z);
    agent.mesh.rotation.y = agent.home.rotY;
    agent.sitUntil = simTime + 40 + Math.random() * 50;
    refreshAgentLabel(agent);
    return;
  }
  startAgentHome(agent);
}

function pointInAnyWall(x: number, z: number): boolean {
  const blockers = effectiveWalkBlockers();
  return blockers.some(
    (b) => x >= b.xMin && x <= b.xMax && z >= b.zMin && z <= b.zMax,
  );
}

let lastLabelSweep = 0;

function updateAgents(dt: number) {
  if (props.editMode) return;
  simTime += dt;
  clearExpiredBubbles();
  forceAmbientTrip();

  if (simTime - lastLabelSweep > 2.5) {
    lastLabelSweep = simTime;
    for (const agent of agents) {
      const fresh = props.employees?.find((e) => e.id === agent.empId);
      if (fresh) agent.emp = fresh;
      refreshAgentLabel(agent);
    }
  } else {
    for (const agent of agents) {
      const fresh = props.employees?.find((e) => e.id === agent.empId);
      if (fresh && fresh.status !== agent.emp.status) {
        agent.emp = fresh;
        refreshAgentLabel(agent);
      }
    }
  }

  for (const agent of agents) {
    if (agent.mode === "sit") {
      if (agent.awayUntil > simTime) {
        continue;
      }
      if (agent.awayUntil > 0 && simTime >= agent.awayUntil) {
        agent.awayUntil = 0;
        agent.purpose = "none";
        startAgentHome(agent);
        continue;
      }
      // Only snap to seat when truly idle at desk (not lingering for chat/tea)
      if (agent.purpose === "none" || agent.purpose === "home") {
        agent.mesh.position.set(agent.home.x, 0, agent.home.z);
        agent.mesh.rotation.y = agent.home.rotY;
      }
      if (simTime < agent.sitUntil) continue;
      decideSitTrip(agent);
      continue;
    }

    const target = agent.path[agent.pathIdx];
    if (!target) {
      agent.mode = "sit";
      agent.purpose = "none";
      agent.mesh.position.set(agent.home.x, 0, agent.home.z);
      agent.mesh.rotation.y = agent.home.rotY;
      agent.sitUntil = simTime + 6 + Math.random() * 10;
      refreshAgentLabel(agent);
      continue;
    }

    // Walls block; closed doors open only when close
    const from = { x: agent.mesh.position.x, z: agent.mesh.position.z };

    // Already inside a wall → snap home (fixes clipping pile-ups)
    if (pointInAnyWall(from.x, from.z)) {
      abortWalkHome(agent);
      continue;
    }

    openDoorsNear(from.x, from.z, 1.15);

    const step = stepAlongPath(from, target, 1.55, dt);
    let blockers = effectiveWalkBlockers();
    let resolved = resolveWalk(from, { x: step.x, z: step.z }, blockers);

    if (
      Math.hypot(resolved.x - from.x, resolved.z - from.z) < 0.001 &&
      Math.hypot(step.x - from.x, step.z - from.z) > 0.01
    ) {
      openDoorsNear(from.x, from.z, 1.1);
      blockers = effectiveWalkBlockers();
      resolved = resolveWalk(from, { x: step.x, z: step.z }, blockers);
    }

    if (!zoneCrossingAllowed(from, resolved)) {
      openDoorsNear(from.x, from.z, 0.95);
      if (!zoneCrossingAllowed(from, { x: resolved.x, z: resolved.z })) {
        resolved = { x: from.x, z: from.z };
      }
    }

    if (pointInAnyWall(resolved.x, resolved.z)) {
      resolved = { x: from.x, z: from.z };
    }

    agent.mesh.position.x = resolved.x;
    agent.mesh.position.z = resolved.z;
    agent.mesh.position.y = 0.02 + Math.abs(Math.sin(simTime * 12 + agent.empId.length)) * 0.04;
    // Face actual travel (−Z forward); if blocked, face intended waypoint
    const mdx = resolved.x - from.x;
    const mdz = resolved.z - from.z;
    if (Math.hypot(mdx, mdz) > 0.008) {
      agent.mesh.rotation.y = walkFacingYaw(mdx, mdz);
    } else {
      agent.mesh.rotation.y = walkFacingYaw(target.x - from.x, target.z - from.z);
    }

    const moved = Math.hypot(resolved.x - agent.lastX, resolved.z - agent.lastZ);
    if (moved > 0.04) {
      agent.stuckSince = 0;
      agent.lastX = resolved.x;
      agent.lastZ = resolved.z;
    } else {
      if (agent.stuckSince <= 0) agent.stuckSince = simTime;
      else if (simTime - agent.stuckSince > 1.2) {
        // 卡在门口：先强行推过已开的门，再计时
        if (nudgeThroughNearestDoor(agent)) {
          continue;
        }
      }
      if (agent.stuckSince > 0 && simTime - agent.stuckSince > 3.5) {
        abortWalkHome(agent);
        continue;
      }
    }

    const arrived =
      step.arrived ||
      Math.hypot(resolved.x - target.x, resolved.z - target.z) < 0.22;
    if (!arrived) continue;

    agent.pathIdx += 1;
    if (agent.pathIdx < agent.path.length) continue;

    const atHome =
      Math.hypot(agent.mesh.position.x - agent.home.x, agent.mesh.position.z - agent.home.z) < 0.45;

    if (agent.purpose === "peer") {
      // 无假聊天：到了就回去
      abortWalkHome(agent);
      continue;
    }

    if (atHome || agent.purpose === "home" || agent.sitUntil < 0) {
      agent.mode = "sit";
      agent.purpose = "none";
      agent.visitTargetId = null;
      agent.awayUntil = 0;
      agent.stuckSince = 0;
      agent.mesh.position.set(agent.home.x, 0, agent.home.z);
      agent.mesh.rotation.y = agent.home.rotY;
      agent.sitUntil = simTime + 50 + Math.random() * 70;
      refreshAgentLabel(agent);
    } else {
      // 到茶水间：短暂停留，不冒假气泡
      agent.mode = "sit";
      agent.mesh.position.y = 0;
      agent.awayUntil = simTime + 3 + Math.random() * 2;
      agent.sitUntil = agent.awayUntil + 0.5;
      agent.stuckSince = 0;
      refreshAgentLabel(agent);
    }
    continue;
  }
}

function rebuildAll() {
  applySceneTheme();
  buildStructure();
  // Yield between structure / props / people so opening office does not lock the UI thread
  requestAnimationFrame(() => {
    try {
      rebuildProps();
    } catch (err) {
      console.error("[OfficeScene3D] rebuildProps failed", err);
    }
    requestAnimationFrame(() => {
      try {
        rebuildPeople();
      } catch (err) {
        console.error("[OfficeScene3D] rebuildPeople failed", err);
      }
    });
  });
}

function ndcFromEvent(e: { clientX: number; clientY: number }) {
  if (!host.value) return;
  const rect = host.value.getBoundingClientRect();
  pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
}

function hitGround(e: PointerEvent): THREE.Vector3 | null {
  if (!camera) return null;
  ndcFromEvent(e);
  raycaster.setFromCamera(pointer, camera);
  const target = new THREE.Vector3();
  if (raycaster.ray.intersectPlane(groundPlane, target)) return target;
  return null;
}

function findPropRoot(obj: THREE.Object3D | null): THREE.Object3D | null {
  let cur: THREE.Object3D | null = obj;
  while (cur) {
    if (cur.userData.propRoot && cur.userData.propId) return cur;
    cur = cur.parent;
  }
  return null;
}

function hitWallPoint(e: PointerEvent): { point: THREE.Vector3; normal: THREE.Vector3 } | null {
  if (!camera) return null;
  ndcFromEvent(e);
  raycaster.setFromCamera(pointer, camera);
  const walls: THREE.Object3D[] = [];
  const collect = (root: THREE.Object3D | null) => {
    if (!root) return;
    root.traverse((o) => {
      if (o instanceof THREE.Mesh && o.userData.wall) walls.push(o);
    });
  };
  collect(structureGroup);
  collect(propsGroup);
  const hits = raycaster.intersectObjects(walls, false);
  if (!hits[0]) return null;
  return {
    point: hits[0].point.clone(),
    normal: hits[0].face
      ? hits[0].face.normal.clone().transformDirection(hits[0].object.matrixWorld)
      : new THREE.Vector3(0, 0, 1),
  };
}

/** When ray misses wall mesh, snap to nearest structure/prop wall plane. */
function nearestWallMount(
  x: number,
  z: number,
  y = 1,
): { point: THREE.Vector3; normal: THREE.Vector3 } | null {
  type Cand = { dist: number; point: THREE.Vector3; normal: THREE.Vector3 };
  const cands: Cand[] = [];
  const geo = floorGeo();
  const addX = (wallX: number) => {
    const dist = Math.abs(x - wallX);
    if (dist > WALL_MOUNT_FALLBACK) return;
    const sign = x >= wallX ? 1 : -1;
    cands.push({
      dist,
      point: new THREE.Vector3(wallX, y, z),
      normal: new THREE.Vector3(sign, 0, 0),
    });
  };
  const addZ = (wallZ: number) => {
    const dist = Math.abs(z - wallZ);
    if (dist > WALL_MOUNT_FALLBACK) return;
    const sign = z >= wallZ ? 1 : -1;
    cands.push({
      dist,
      point: new THREE.Vector3(x, y, wallZ),
      normal: new THREE.Vector3(0, 0, sign),
    });
  };
  addX(geo.xLeft);
  addX(geo.xRight);
  for (const wx of geo.partitions) addX(wx);
  addZ(geo.zBack);
  addZ(geo.zFront);

  for (const p of activeLayout().props) {
    if (p.kind !== "wall") continue;
    const nx = Math.cos(p.rotY ?? 0);
    const nz = -Math.sin(p.rotY ?? 0);
    const dx = x - p.x;
    const dz = z - p.z;
    const dist = Math.abs(dx * nx + dz * nz);
    if (dist > WALL_MOUNT_FALLBACK) continue;
    const alongX = Math.sin(p.rotY ?? 0);
    const alongZ = Math.cos(p.rotY ?? 0);
    const t = dx * alongX + dz * alongZ;
    const halfLen = (p.meta?.length ?? 2.4) / 2;
    if (Math.abs(t) > halfLen + 0.25) continue;
    const side = Math.sign(dx * nx + dz * nz) || 1;
    cands.push({
      dist,
      point: new THREE.Vector3(p.x + t * alongX, y, p.z + t * alongZ),
      normal: new THREE.Vector3(nx * side, 0, nz * side),
    });
  }

  cands.sort((a, b) => a.dist - b.dist);
  return cands[0] ?? null;
}

function resolveWallMount(e: PointerEvent): { point: THREE.Vector3; normal: THREE.Vector3 } | null {
  const hit = hitWallPoint(e);
  if (hit) {
    // Prefer outward face toward camera / click side
    if (camera) {
      const toCam = camera.position.clone().sub(hit.point).setY(0);
      if (toCam.lengthSq() > 1e-6 && hit.normal.dot(toCam) < 0) hit.normal.negate();
    }
    return hit;
  }
  const g = hitGround(e);
  if (!g) return null;
  return nearestWallMount(g.x, g.z, 1);
}

function updateGhost(e: PointerEvent) {
  if (!props.placeKind || !propsGroup) return;
  const seats =
    props.placeSeatCount ??
    (props.placeKind === "desk_duo" || props.placeKind === "desk_bench" ? 2 : 1);
  const ghostKey = `${props.placeKind}:${seats}`;
  if (!ghostMesh || ghostMesh.userData.ghostKey !== ghostKey) {
    clearGhost();
    ghostMesh = createPropMesh(props.placeKind, themeColors, {
      text: props.placeKind === "banner" ? "新标语" : undefined,
      seatCount: isDeskKind(props.placeKind) ? seats : undefined,
      color: props.placeColor ?? undefined,
    });
    ghostMesh.userData.kind = props.placeKind;
    ghostMesh.userData.ghostKey = ghostKey;
    ghostMesh.traverse((o) => {
      if (o instanceof THREE.Mesh && o.material instanceof THREE.MeshStandardMaterial) {
        o.material = o.material.clone();
        o.material.transparent = true;
        o.material.opacity = 0.4;
        o.material.depthWrite = false;
      }
    });
    propsGroup.add(ghostMesh);
  }
  if (isWallMountKind(props.placeKind)) {
    const wall = resolveWallMount(e);
    if (wall) {
      const embed = 0.06;
      const px = wall.point.x - wall.normal.x * embed;
      const pz = wall.point.z - wall.normal.z * embed;
      const py =
        props.placeKind.startsWith("window")
          ? Math.max(0.9, Math.min(1.6, wall.point.y - 0.2))
          : 0;
      ghostMesh.position.set(px, py, pz);
      ghostMesh.rotation.y = wallMountRotY(wall.normal);
      return;
    }
  }
  const g = hitGround(e);
  if (g) {
    let gx = snap(g.x);
    let gz = snap(g.z);
    if (props.placeKind && shouldWallSnap(props.placeKind)) {
      const dist = isRoomKind(props.placeKind) ? 0.55 : WALL_SNAP_DIST;
      const s = snapToWalls(props.placeKind, gx, gz, ghostRotY, 1);
      void dist;
      gx = s.x;
      gz = s.z;
    }
    ghostMesh.position.set(gx, 0, gz);
    ghostMesh.rotation.y = ghostRotY;
  }
}

function clearGhost() {
  if (ghostMesh && propsGroup) {
    propsGroup.remove(ghostMesh);
    ghostMesh.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        const m = obj.material;
        if (Array.isArray(m)) m.forEach((x) => x.dispose());
        else m.dispose();
      }
    });
    ghostMesh = null;
  }
}

function patchLayout(mutator: (propsList: OfficeProp[]) => OfficeProp[]) {
  const base = activeLayout();
  emit("update:layout", {
    version: 1,
    rooms: base.rooms ? base.rooms.map((r) => ({ ...r })) : undefined,
    props: mutator(base.props.map((p) => ({ ...p, meta: p.meta ? { ...p.meta } : undefined }))),
  });
}

function clearRotateGizmo() {
  if (rotateGizmo && scene) {
    scene.remove(rotateGizmo);
    disposeObject(rotateGizmo);
    rotateGizmo = null;
  }
}

function worldPerPixelAt(dist: number): number {
  if (!camera || !host.value) return 0.01;
  const h = Math.max(host.value.clientHeight, 1);
  const vFov = (camera.fov * Math.PI) / 180;
  return (2 * Math.tan(vFov / 2) * dist) / h;
}

function syncRotateGizmo() {
  if (!scene || !camera || !propsGroup || !props.editMode || !rotateMode.value || !props.selectedPropId) {
    clearRotateGizmo();
    return;
  }
  const mesh = propsGroup.children.find((c) => c.userData.propId === props.selectedPropId);
  if (!mesh) {
    clearRotateGizmo();
    return;
  }
  const box = new THREE.Box3().setFromObject(mesh);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const radius = Math.max(size.x, size.z, 0.4) * 0.55 + 0.2;
  const dist = camera.position.distanceTo(center);
  const tube = Math.max(worldPerPixelAt(dist) * 3, 0.012); // ~6px ring width
  const key = `${props.selectedPropId}:${radius.toFixed(2)}:${tube.toFixed(3)}`;

  if (!rotateGizmo || rotateGizmo.userData.gizmoKey !== key) {
    clearRotateGizmo();
    rotateGizmo = new THREE.Group();
    rotateGizmo.name = "rotateGizmo";
    rotateGizmo.userData.gizmoKey = key;
    scene.add(rotateGizmo);

    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(radius, tube, 10, 64),
      new THREE.MeshBasicMaterial({ color: 0x2a6b5a, transparent: true, opacity: 0.92, depthTest: false }),
    );
    ring.rotation.x = Math.PI / 2;
    ring.renderOrder = 20;
    rotateGizmo.add(ring);

    const arrow = new THREE.Mesh(
      new THREE.ConeGeometry(tube * 2.2, tube * 5, 10),
      new THREE.MeshBasicMaterial({ color: 0xf0a020, depthTest: false }),
    );
    arrow.position.set(radius, tube * 2, 0);
    arrow.rotation.z = -Math.PI / 2;
    arrow.renderOrder = 21;
    rotateGizmo.add(arrow);

    const tip = new THREE.Mesh(
      new THREE.SphereGeometry(tube * 1.6, 10, 10),
      new THREE.MeshBasicMaterial({ color: 0xf0a020, depthTest: false }),
    );
    tip.position.set(radius, 0, 0);
    tip.renderOrder = 21;
    rotateGizmo.add(tip);
  }

  rotateGizmo.position.copy(center);
  rotateGizmo.position.y = Math.max(center.y, 0.05);
  rotatePivot.copy(center);
  if (!rotateDragging) rotateGizmo.rotation.y = 0;
}

function updateSelectionToolbar() {
  if (!props.editMode || !props.selectedPropId || !camera || !host.value || !propsGroup || !renderer) {
    toolbarStyle.value = null;
    return;
  }
  const mesh = propsGroup.children.find((c) => c.userData.propId === props.selectedPropId);
  if (!mesh) {
    toolbarStyle.value = null;
    return;
  }
  const box = new THREE.Box3().setFromObject(mesh);
  const top = new THREE.Vector3(
    (box.min.x + box.max.x) / 2,
    box.max.y + 0.12,
    (box.min.z + box.max.z) / 2,
  );
  top.project(camera);
  const rect = host.value.getBoundingClientRect();
  const x = (top.x * 0.5 + 0.5) * rect.width;
  const y = (-top.y * 0.5 + 0.5) * rect.height;
  if (top.z > 1 || top.z < -1 || x < -40 || y < -40 || x > rect.width + 40 || y > rect.height + 40) {
    toolbarStyle.value = { left: "0", top: "0", display: "none" };
    return;
  }
  toolbarStyle.value = {
    left: `${Math.round(x)}px`,
    top: `${Math.round(y)}px`,
  };
}

function pointerAngleAroundPivot(e: PointerEvent): number | null {
  const g = hitGround(e);
  if (!g) return null;
  return Math.atan2(g.x - rotatePivot.x, g.z - rotatePivot.z);
}

function copySelected() {
  const id = props.selectedPropId;
  if (!id) return;
  const src = activeLayout().props.find((p) => p.id === id);
  if (!src) return;
  const seat0 = nextDeskSeatIndex(activeLayout().props);
  let meta = src.meta ? { ...src.meta } : undefined;
  if (isDeskKind(src.kind)) {
    const n = Math.max(1, src.meta?.seatCount ?? (src.kind === "desk_duo" || src.kind === "desk_bench" ? 2 : 1));
    meta = {
      ...(meta ?? {}),
      deskIndex: seat0,
      seatCount: n,
      ...(n >= 2 ? { deskIndex2: seat0 + 1 } : {}),
    };
  }
  const np: OfficeProp = {
    ...src,
    id: newPropId(src.kind),
    x: src.x + 0.6,
    z: src.z + 0.6,
    meta,
  };
  patchLayout((list) => [...list, np]);
  emit("update:selectedPropId", np.id);
  rotateMode.value = false;
}

function flipSelectedUi() {
  flipSelected("x");
}

function toggleRotateMode() {
  if (!props.selectedPropId) return;
  rotateMode.value = !rotateMode.value;
  if (!rotateMode.value) {
    rotateDragging = false;
    clearRotateGizmo();
  } else {
    syncRotateGizmo();
  }
  applyEditControls();
}

function onPointerDown(e: PointerEvent) {
  // Click employee to edit look (when not placing / dragging props)
  if (e.button === 0 && !props.placeKind && peopleGroup && camera) {
    ndcFromEvent(e);
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(peopleGroup.children, true);
    for (const h of hits) {
      let o: THREE.Object3D | null = h.object;
      while (o) {
        if (o.userData?.empId) {
          if (!props.editMode || (!draggingId && !rotateMode.value)) {
            e.preventDefault();
            emit("edit-employee", String(o.userData.empId));
            if (!props.editMode) return;
          }
          break;
        }
        o = o.parent;
      }
      if (o?.userData?.empId) break;
    }
  }

  if (!props.editMode || !camera || !propsGroup) return;

  // RMB+Alt = rotate selected prop; plain RMB cancels place via contextmenu
  if (rotateMode.value && e.button === 2 && e.altKey && props.selectedPropId) {
    e.preventDefault();
    const ang = pointerAngleAroundPivot(e);
    if (ang == null) return;
    const p = activeLayout().props.find((x) => x.id === props.selectedPropId);
    if (!p) return;
    rotateDragging = true;
    rotateStartPointerAngle = ang;
    rotateStartRotY = p.rotY ?? 0;
    rotateLiveRotY = rotateStartRotY;
    if (controls) controls.enabled = false;
    return;
  }

  // Space+LMB or non-left → let OrbitControls / contextmenu handle
  if (spaceOrbit || e.button !== 0) return;

  if (props.placeKind) {
    e.preventDefault();
    let x = 0;
    let y = 0;
    let z = 0;
    let rotY = ghostRotY;
    let wall = false;
    if (isWallMountKind(props.placeKind)) {
      const wallHit = resolveWallMount(e);
      if (wallHit) {
        const embed = 0.06;
        x = wallHit.point.x - wallHit.normal.x * embed;
        z = wallHit.point.z - wallHit.normal.z * embed;
        y = props.placeKind.startsWith("window")
          ? Math.max(0.9, Math.min(1.6, wallHit.point.y - 0.2))
          : 0;
        rotY = wallMountRotY(wallHit.normal);
        wall = true;
      } else {
        const g = hitGround(e);
        if (!g) return;
        x = snap(g.x);
        z = snap(g.z);
      }
    } else {
      const g = hitGround(e);
      if (!g) return;
      x = snap(g.x);
      z = snap(g.z);
      if (shouldWallSnap(props.placeKind)) {
        const s = snapToWalls(props.placeKind, x, z, rotY, 1);
        x = s.x;
        z = s.z;
      }
    }
    const kind = props.placeKind;
    const seat0 = nextDeskSeatIndex(activeLayout().props);
    const requestedSeats = Math.max(
      1,
      Math.min(
        12,
        props.placeSeatCount ??
          (kind === "desk_duo" || kind === "desk_bench" || kind === "desk_arc" ? 2 : 1),
      ),
    );

    // 连体多座：一张连体 prop + seatCount（勿再拆成间距过密的独立桌，否则 L/双人会叠穿）
    let meta: OfficeProp["meta"] | undefined;
    if (kind === "banner") {
      meta = { text: `欢迎来到 ${readCompanyName()}`, wall };
    } else if (isDeskKind(kind)) {
      meta = {
        deskIndex: seat0,
        seatCount: requestedSeats,
        lit: false,
        ...(requestedSeats >= 2 ? { deskIndex2: seat0 + 1 } : {}),
      };
    } else if (isRoomKind(kind)) {
      // Adding a department = adding a physical office bay (door header), not an indoor sign
      const name = ROOM_DEFAULT_LABEL[kind] || kind;
      const base = activeLayout();
      const rooms = resolveFloorRooms(base).map((r) => ({ ...r }));
      rooms.push({
        id: newPropId(kind),
        name,
        weight: 1,
        kind,
      });
      emit("update:layout", {
        version: 1,
        rooms,
        props: base.props.map((p) => ({ ...p, meta: p.meta ? { ...p.meta } : undefined })),
      });
      emit("update:placeKind", null);
      ghostRotY = 0;
      clearGhost();
      return;
    } else if (kind === "wall") {
      meta = { height: 2.4, length: 2.4 };
    } else if (wall) {
      meta = { wall: true };
    }
    const np: OfficeProp = {
      id: newPropId(kind),
      kind,
      x,
      y,
      z,
      rotY,
      scale: 1,
      sx: 1,
      sy: 1,
      sz: 1,
      ...(props.placeColor ? { color: props.placeColor } : {}),
      meta,
    };
    patchLayout((list) => [...list, np]);
    emit("update:placeKind", null);
    emit("update:selectedPropId", np.id);
    ghostRotY = 0;
    clearGhost();
    return;
  }

  ndcFromEvent(e);
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(propsGroup.children, true);
  const root = findPropRoot(hits[0]?.object ?? null);
  if (root && typeof root.userData.propId === "string") {
    e.preventDefault();
    draggingId = root.userData.propId;
    emit("update:selectedPropId", draggingId);
    const g = hitGround(e);
    if (g) {
      const p = activeLayout().props.find((x) => x.id === draggingId);
      if (p) {
        dragOffset.set(p.x - g.x, 0, p.z - g.z);
        dragLivePos = { x: p.x, z: p.z };
      }
    }
    if (controls) controls.enabled = false;
  } else {
    emit("update:selectedPropId", null);
    rotateMode.value = false;
    clearRotateGizmo();
  }
}

function onPointerMove(e: PointerEvent) {
  if (!props.editMode) return;
  if (rotateDragging && props.selectedPropId) {
    const ang = pointerAngleAroundPivot(e);
    if (ang == null) return;
    const delta = ang - rotateStartPointerAngle;
    rotateLiveRotY = rotateStartRotY + delta;
    const mesh = propsGroup?.children.find((c) => c.userData.propId === props.selectedPropId);
    if (mesh) {
      const p = activeLayout().props.find((x) => x.id === props.selectedPropId);
      if (p) applyPropTransform(mesh as THREE.Group, { ...p, rotY: rotateLiveRotY });
    }
    if (rotateGizmo) rotateGizmo.rotation.y = rotateLiveRotY - rotateStartRotY;
    return;
  }
  if (props.placeKind) {
    updateGhost(e);
    return;
  }
  if (!draggingId || !propsGroup) return;
  const p = activeLayout().props.find((x) => x.id === draggingId);
  if (p && isWallMountKind(p.kind)) {
    const wall = resolveWallMount(e);
    if (wall) {
      const embed = 0.06;
      const nx = wall.point.x - wall.normal.x * embed;
      const nz = wall.point.z - wall.normal.z * embed;
      const ny = p.kind.startsWith("window")
        ? Math.max(0.9, Math.min(1.6, wall.point.y - 0.2))
        : 0;
      const rotY = wallMountRotY(wall.normal);
      dragLivePos = { x: nx, z: nz, y: ny, rotY };
      const mesh = propsGroup.children.find((c) => c.userData.propId === draggingId);
      if (mesh) {
        mesh.position.set(nx, ny, nz);
        mesh.rotation.y = rotY;
      }
    }
    return;
  }
  const g = hitGround(e);
  if (!g) return;
  let nx = snap(g.x + dragOffset.x);
  let nz = snap(g.z + dragOffset.z);
  if (p && shouldWallSnap(p.kind)) {
    const s = snapToWalls(p.kind, nx, nz, p.rotY ?? 0, p.scale ?? 1);
    nx = s.x;
    nz = s.z;
  }
  dragLivePos = { x: nx, z: nz };
  const mesh = propsGroup.children.find((c) => c.userData.propId === draggingId);
  if (mesh) mesh.position.set(nx, 0, nz);
}

function onPointerUp() {
  if (rotateDragging && props.selectedPropId) {
    const id = props.selectedPropId;
    const rotY = rotateLiveRotY;
    rotateDragging = false;
    patchLayout((list) => list.map((p) => (p.id === id ? { ...p, rotY } : p)));
    if (controls) controls.enabled = true;
    applyEditControls();
    return;
  }
  if (draggingId) {
    const id = draggingId;
    const live = dragLivePos;
    patchLayout((list) =>
      list.map((p) =>
        p.id === id
          ? {
              ...p,
              x: live.x,
              z: live.z,
              ...(live.y != null ? { y: live.y } : {}),
              ...(live.rotY != null ? { rotY: live.rotY } : {}),
            }
          : p,
      ),
    );
  }
  draggingId = null;
  if (controls) controls.enabled = true;
  applyEditControls();
}

function mutateSelected(
  mutator: (p: OfficeProp) => OfficeProp,
) {
  const id = props.selectedPropId;
  if (!id) return;
  patchLayout((list) => list.map((p) => (p.id === id ? mutator(p) : p)));
}

function rotateSelected(delta: number) {
  if (props.placeKind) {
    ghostRotY += delta;
    if (ghostMesh) ghostMesh.rotation.y = ghostRotY;
    return;
  }
  mutateSelected((p) => ({ ...p, rotY: p.rotY + delta }));
}

function flipSelected(axis: "x" | "z") {
  mutateSelected((p) =>
    axis === "x" ? { ...p, flipX: !p.flipX } : { ...p, flipZ: !p.flipZ },
  );
}

function scaleSelected(delta: number) {
  mutateSelected((p) => ({
    ...p,
    scale: clampPropScale((p.scale ?? 1) + delta),
  }));
}

function onKeyDown(e: KeyboardEvent) {
  if (!props.editMode) return;
  const tag = (e.target as HTMLElement | null)?.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

  if (e.code === "Space") {
    e.preventDefault();
    if (!spaceOrbit) {
      spaceOrbit = true;
      if (controls) {
        controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
      }
    }
    return;
  }

  if (e.key === "Escape") {
    emit("update:placeKind", null);
    emit("update:selectedPropId", null);
    rotateMode.value = false;
    clearRotateGizmo();
    ghostRotY = 0;
    clearGhost();
    return;
  }

  if (e.key === "q" || e.key === "Q") {
    e.preventDefault();
    rotateSelected(-Math.PI / 4);
    return;
  }
  if (e.key === "e" || e.key === "E" || e.key === "r" || e.key === "R") {
    e.preventDefault();
    rotateSelected(Math.PI / 4);
    return;
  }
  if (e.key === "f" || e.key === "F") {
    e.preventDefault();
    flipSelected(e.shiftKey ? "z" : "x");
    return;
  }
  if (e.key === "[" || e.key === "-") {
    e.preventDefault();
    scaleSelected(-0.1);
    return;
  }
  if (e.key === "]" || e.key === "=" || e.key === "+") {
    e.preventDefault();
    scaleSelected(0.1);
    return;
  }

  const id = props.selectedPropId;
  if (!id) return;

  const nudgeStep = e.shiftKey ? SNAP : 0.05;
  let dx = 0;
  let dz = 0;
  if (e.key === "ArrowLeft") dx = -nudgeStep;
  else if (e.key === "ArrowRight") dx = nudgeStep;
  else if (e.key === "ArrowUp") dz = -nudgeStep;
  else if (e.key === "ArrowDown") dz = nudgeStep;
  if (dx !== 0 || dz !== 0) {
    e.preventDefault();
    patchLayout((list) =>
      list.map((p) => {
        if (p.id !== id) return p;
        let nx = p.x + dx;
        let nz = p.z + dz;
        if (!e.shiftKey) {
          /* fine nudge keeps sub-grid */
        } else {
          nx = snap(nx);
          nz = snap(nz);
        }
        return { ...p, x: nx, z: nz };
      }),
    );
    return;
  }

  if (e.key === "Delete" || e.key === "Backspace") {
    e.preventDefault();
    deleteSelectedProp();
  }
}

function onKeyUp(e: KeyboardEvent) {
  if (e.code === "Space") {
    spaceOrbit = false;
    applyEditControls();
  }
}

function onWheel(e: WheelEvent) {
  if (!props.editMode || !props.selectedPropId) return;
  if (!e.shiftKey) return;
  e.preventDefault();
  scaleSelected(e.deltaY > 0 ? -0.05 : 0.05);
}

function deleteSelectedProp() {
  const id = props.selectedPropId;
  if (!id) return;
  const victim = activeLayout().props.find((p) => p.id === id);
  const seats = victim && isDeskKind(victim.kind) ? seatIndicesOnProp(victim) : [];
  patchLayout((list) => list.filter((p) => p.id !== id));
  emit("update:selectedPropId", null);
  if (seats.length > 0) emit("desks-removed", seats);
}

function onContextMenu(e: MouseEvent) {
  if (!props.editMode) return;
  e.preventDefault();
  e.stopPropagation();
  // Only cancel ghost placement (not yet confirmed). Placed props: RMB does not delete.
  if (props.placeKind) {
    emit("update:placeKind", null);
    clearGhost();
  }
}

function onResize() {
  if (!host.value || !renderer || !camera) return;
  const w = host.value.clientWidth;
  const h = host.value.clientHeight;
  camera.aspect = w / Math.max(h, 1);
  camera.updateProjectionMatrix();
  renderer.setSize(w, h, false);
}

let lastFrameMs = 0;
let pageHidden = false;
let screenshotPaused = false;

function busyEmployeeCount(): number {
  return (props.employees ?? []).filter(
    (e) => e.status === "working" || e.status === "meeting",
  ).length;
}

/** 大编制 + 多人同时跑 Agent 时降帧/停角色动画，但不停止渲染（避免白屏）。 */
function shouldThrottleAnimation(): boolean {
  if (pageHidden) return true;
  const empN = props.employees?.length ?? 0;
  const busy = busyEmployeeCount();
  const busyThreshold = empN > 24 ? Math.max(12, Math.ceil(empN * 0.75)) : empN > 20 ? 14 : 999;
  return empN > 28 || busy > busyThreshold;
}

function onVisibility() {
  pageHidden = document.hidden;
  if (pageHidden && animId) {
    cancelAnimationFrame(animId);
    animId = 0;
  } else if (!pageHidden && !animId && renderer) {
    animate();
  }
}

function animate(now = performance.now()) {
  animId = requestAnimationFrame(animate);
  if (!renderer || !scene || !camera) return;
  if (pageHidden || screenshotPaused) return;
  const throttled = shouldThrottleAnimation();
  const empN = props.employees?.length ?? 0;
  const minDt = throttled
    ? 2000
    : props.editMode
      ? 22
      : empN > 24
        ? 80
        : empN > 16
          ? 50
          : 33;
  if (now - lastFrameMs < minDt) return;
  lastFrameMs = now;
  if (!throttled) {
    clock.update(now);
    const frameDt = Math.min(Math.max(clock.getDelta(), 0.001), 0.08);
    updateAgents(frameDt);
    updateDoorMeshes(frameDt);
    syncDomBubbles();
  }
  controls?.update();
  if (!throttled && props.editMode && props.selectedPropId) {
    updateSelectionToolbar();
    if (rotateMode.value) {
      if (rotateDragging && rotateGizmo && propsGroup && props.selectedPropId) {
        const mesh = propsGroup.children.find((c) => c.userData.propId === props.selectedPropId);
        if (mesh) {
          const box = new THREE.Box3().setFromObject(mesh);
          const center = box.getCenter(new THREE.Vector3());
          rotateGizmo.position.copy(center);
          rotateGizmo.position.y = Math.max(center.y, 0.05);
          rotatePivot.copy(center);
        }
      } else {
        syncRotateGizmo();
      }
    }
  }
  renderer.render(scene, camera);
}

function applyEditControls() {
  if (!controls || !scene) return;
  if (props.editMode) {
    // Left = place/select/drag (unless Space held). Right = rotate view (or yaw prop in rotateMode).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (controls.mouseButtons as any).LEFT = spaceOrbit ? THREE.MOUSE.ROTATE : null;
    controls.mouseButtons.MIDDLE = THREE.MOUSE.DOLLY;
    // Right-click cancels pending place only — orbit when not placing
    controls.mouseButtons.RIGHT = props.placeKind
      ? (null as unknown as THREE.MOUSE)
      : THREE.MOUSE.ROTATE;
    controls.enableRotate = !rotateMode.value || spaceOrbit;
    controls.enablePan = true;
    if (!gridHelper) {
      gridHelper = new THREE.GridHelper(24, 48, 0x88a0b0, 0xc5d0da);
      gridHelper.position.y = 0.02;
      scene.add(gridHelper);
    }
    gridHelper.visible = true;
  } else {
    spaceOrbit = false;
    rotateMode.value = false;
    clearRotateGizmo();
    controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
    controls.mouseButtons.MIDDLE = THREE.MOUSE.DOLLY;
    controls.mouseButtons.RIGHT = THREE.MOUSE.PAN;
    if (gridHelper) gridHelper.visible = false;
    clearGhost();
  }
}

onMounted(() => {
  if (!host.value) return;
  sampleThemeColors();
  scene = new THREE.Scene();
  applySceneTheme();

  const w = host.value.clientWidth;
  const h = host.value.clientHeight;
  camera = new THREE.PerspectiveCamera(42, w / Math.max(h, 1), 0.1, 200);
  camera.position.set(10.5, 12.5, 12.5);
  camera.lookAt(0.5, 0, 0);

  const empCount = props.employees?.length ?? 0;
  renderer = new THREE.WebGLRenderer({
    antialias: empCount <= 16,
    alpha: false,
    powerPreference: empCount > 16 ? "low-power" : "high-performance",
  });
  const maxDpr = empCount > 24 ? 1.15 : empCount > 16 ? 1.35 : 1.75;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxDpr));
  renderer.setSize(w, h, false);
  renderer.shadowMap.enabled = empCount <= 16;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  host.value.appendChild(renderer.domElement);
  renderer.domElement.style.position = "absolute";
  renderer.domElement.style.inset = "0";
  renderer.domElement.style.zIndex = "1";

  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0.5, 0.4, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI / 2.15;
  controls.minDistance = 6;
  controls.maxDistance = 48;
  controls.update();

  const hemi = new THREE.HemisphereLight(0xf0f5ff, 0xb7a898, 1.05);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff2dd, 1.2);
  sun.position.set(8, 16, 6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1536, 1536);
  sun.shadow.camera.left = -16;
  sun.shadow.camera.right = 16;
  sun.shadow.camera.top = 16;
  sun.shadow.camera.bottom = -16;
  scene.add(sun);

  structureGroup = new THREE.Group();
  propsGroup = new THREE.Group();
  peopleGroup = new THREE.Group();
  scene.add(structureGroup, propsGroup, peopleGroup);
  requestAnimationFrame(() => {
    try {
      rebuildAll();
    } catch (err) {
      console.error("[OfficeScene3D] rebuildAll failed", err);
    }
  });
  // Soft-load GLTF props after first paint — only refresh furniture, not full remount
  void preloadOfficeAssets().then(() => {
    try {
      rebuildProps();
    } catch (err) {
      console.error("[OfficeScene3D] rebuildProps after assets failed", err);
    }
  });
  applyEditControls();

  themeObserver = new MutationObserver(() => {
    if (rebuildTimer != null) window.clearTimeout(rebuildTimer);
    rebuildTimer = window.setTimeout(() => {
      rebuildTimer = null;
      try {
        rebuildAll();
      } catch (err) {
        console.error("[OfficeScene3D] theme rebuild failed", err);
      }
    }, 400);
  });
  // Never watch "style" — Xu theme CSS vars mutate style constantly and rebuild-storm the GPU
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme", "class"],
  });

  const el = renderer.domElement;
  el.addEventListener("pointerdown", onPointerDown);
  el.addEventListener("pointermove", onPointerMove);
  el.addEventListener("pointerup", onPointerUp);
  el.addEventListener("wheel", onWheel, { passive: false });
  el.addEventListener("contextmenu", onContextMenu);
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("xu-office-display", onDisplayPrefsChanged);
  window.addEventListener("resize", onResize);
  if (typeof ResizeObserver !== "undefined" && host.value) {
    resizeObserver = new ResizeObserver(() => onResize());
    resizeObserver.observe(host.value);
  }
  document.addEventListener("visibilitychange", onVisibility);
  pageHidden = document.hidden;
  clock.reset();
  clock.update(performance.now());
  animate();

  void listen<{ active?: boolean }>("xu-screenshot-active", (e) => {
    screenshotPaused = Boolean(e.payload?.active);
    if (screenshotPaused && animId) {
      cancelAnimationFrame(animId);
      animId = 0;
    } else if (!screenshotPaused && !pageHidden && renderer) {
      animate();
    }
  }).then((fn) => {
    unlistenScreenshot = fn;
  });

  unsubLive = subscribeEmployeeLive((ev: EmployeeLiveEvent) => {
    const agent = agents.find((a) => a.empId === ev.employeeId);
    if (!agent) return;
    const fresh = props.employees?.find((e) => e.id === ev.employeeId);
    const st = mapEventState(ev.state);
    if (fresh) {
      agent.emp = st ? { ...fresh, status: st } : { ...fresh };
    } else if (st) {
      agent.emp = { ...agent.emp, status: st };
    }
    refreshAgentLabel(agent);
  });
  unsubAgent = subscribeAgentLive((ev: AgentLiveEvent) => {
    if (!displayPrefs.showSpeechBubbles) return;
    if (!ev.employeeId || !isAgentBubbleWorthy(ev)) return;
    const agent = agents.find((a) => a.empId === ev.employeeId);
    if (!agent) return;
    const phase = agentBubblePhase(ev);
    const seconds = bubbleSecondsForPhase(phase);
    showSpeechBubble(agent, agentBubbleText(ev), seconds, phase);
  });
});

watch(
  () => props.employees?.map((e) => `${e.id}:${e.status}`).join("|") ?? "",
  () => {
    for (const agent of agents) {
      const fresh = props.employees?.find((e) => e.id === agent.empId);
      if (!fresh) continue;
      if (fresh.status !== agent.emp.status) {
        agent.emp = fresh;
        refreshAgentLabel(agent);
      } else {
        agent.emp = fresh;
      }
    }
  },
);

watch(
  () =>
    [
      props.layout?.props
        ?.map((p) => `${p.id}:${p.kind}:${p.x}:${p.z}:${p.meta?.deskIndex ?? ""}:${p.meta?.seatCount ?? ""}`)
        .join("|") ?? "",
      // Seating / identity only — status-only changes must not rebuild WebGL
      props.employees.map((e) => `${e.id}:${e.deskIndex ?? ""}`).join("|"),
    ] as const,
  () => {
    if (rebuildTimer != null) window.clearTimeout(rebuildTimer);
    rebuildTimer = window.setTimeout(() => {
      rebuildTimer = null;
      try {
        buildStructure();
        rebuildProps();
        rebuildPeople();
      } catch (err) {
        console.error("[OfficeScene3D] rebuild failed", err);
      }
    }, 350);
  },
);

watch(
  () => props.selectedPropId,
  () => {
    rotateMode.value = false;
    clearRotateGizmo();
    applyEditControls();
    // Only refresh selection outline — do not rebuild the whole floor
    try {
      rebuildProps();
    } catch (err) {
      console.error("[OfficeScene3D] selection rebuild failed", err);
    }
  },
);

watch(
  () => props.editMode,
  () => applyEditControls(),
);

watch(
  () => props.placeKind,
  (k) => {
    clearGhost();
    ghostRotY = 0;
    applyEditControls();
    if (!k) return;
  },
);

defineExpose({
  rotateSelected,
  flipSelected,
  scaleSelected,
  copySelected,
});

onUnmounted(() => {
  unsubLive?.();
  unsubLive = null;
  unsubAgent?.();
  unsubAgent = null;
  cancelAnimationFrame(animId);
  if (rebuildTimer != null) {
    window.clearTimeout(rebuildTimer);
    rebuildTimer = null;
  }
  unlistenScreenshot?.();
  window.removeEventListener("resize", onResize);
  resizeObserver?.disconnect();
  resizeObserver = null;
  window.removeEventListener("keydown", onKeyDown);
  window.removeEventListener("keyup", onKeyUp);
  window.removeEventListener("xu-office-display", onDisplayPrefsChanged);
  document.removeEventListener("visibilitychange", onVisibility);
  themeObserver?.disconnect();
  clearGhost();
  clearRotateGizmo();
  if (renderer?.domElement) {
    renderer.domElement.removeEventListener("pointerdown", onPointerDown);
    renderer.domElement.removeEventListener("pointermove", onPointerMove);
    renderer.domElement.removeEventListener("pointerup", onPointerUp);
    renderer.domElement.removeEventListener("wheel", onWheel);
    renderer.domElement.removeEventListener("contextmenu", onContextMenu);
  }
  disposeGroup(propsGroup);
  disposeGroup(peopleGroup);
  if (structureGroup) disposeGroup(structureGroup);
  if (scene) {
    while (scene.children.length) {
      const c = scene.children[0]!;
      scene.remove(c);
      disposeObject(c);
    }
  }
  controls?.dispose();
  renderer?.dispose();
  if (renderer?.domElement.parentElement) {
    renderer.domElement.parentElement.removeChild(renderer.domElement);
  }
  agents = [];
  scene = null;
  camera = null;
  renderer = null;
  controls = null;
  propsGroup = null;
  peopleGroup = null;
  structureGroup = null;
});
</script>

<template>
  <div ref="host" class="office-3d-host" :class="{ editing: editMode }">
    <div class="speech-layer" aria-hidden="true">
      <div
        v-for="b in domBubbles"
        :key="b.empId"
        class="speech-dom"
        :style="{ left: `${b.left}px`, top: `${b.top}px` }"
      >
        {{ b.text }}
      </div>
    </div>
    <div
      v-if="editMode && selectedPropId && toolbarStyle && toolbarStyle.display !== 'none'"
      class="prop-float-toolbar"
      :style="toolbarStyle"
      @pointerdown.stop
      @pointerup.stop
      @click.stop
    >
      <FouButton
        icon="file-copy-line"
        size="small"
        native-type="button"
        aria-label="复制"
        @click="copySelected"
      >
        复制
      </FouButton>
      <FouButton
        icon="flip-horizontal-line"
        size="small"
        native-type="button"
        aria-label="翻转"
        @click="flipSelectedUi"
      >
        翻转
      </FouButton>
      <FouButton
        icon="clockwise-2-line"
        size="small"
        native-type="button"
        :type="rotateMode ? 'primary' : 'default'"
        aria-label="旋转"
        @click="toggleRotateMode"
      >
        旋转
      </FouButton>
    </div>
  </div>
</template>

<style scoped>
.office-3d-host {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  min-height: 420px;
  border-radius: 12px;
  overflow: hidden;
  border: 1px solid var(--hairline);
  background: var(--canvas);
}
.office-3d-host.editing {
  outline: 2px solid var(--primary, #2a6b5a);
  outline-offset: -2px;
}
.prop-float-toolbar {
  position: absolute;
  z-index: 8;
  display: flex;
  gap: 6px;
  padding: 4px;
  border-radius: 10px;
  background: color-mix(in srgb, var(--panel, #fff) 92%, transparent);
  border: 1px solid var(--border, rgba(127, 127, 127, 0.28));
  box-shadow: 0 6px 18px rgba(20, 40, 60, 0.14);
  transform: translate(-50%, calc(-100% - 10px));
  pointer-events: auto;
}
.office-3d-host :deep(canvas) {
  display: block;
  width: 100% !important;
  height: 100% !important;
  z-index: 1;
}
.speech-layer {
  position: absolute;
  inset: 0;
  z-index: 6;
  pointer-events: none;
  overflow: hidden;
}
.speech-dom {
  position: absolute;
  transform: translate(-50%, -100%);
  max-width: 220px;
  padding: 8px 12px;
  border-radius: 12px;
  background: #fff;
  color: #0f172a;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.35;
  box-shadow: 0 4px 14px rgba(15, 23, 42, 0.18);
  border: 1px solid rgba(15, 23, 42, 0.08);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.speech-dom::after {
  content: "";
  position: absolute;
  left: 50%;
  bottom: -6px;
  width: 12px;
  height: 12px;
  background: #fff;
  border-right: 1px solid rgba(15, 23, 42, 0.08);
  border-bottom: 1px solid rgba(15, 23, 42, 0.08);
  transform: translateX(-50%) rotate(45deg);
}
</style>
