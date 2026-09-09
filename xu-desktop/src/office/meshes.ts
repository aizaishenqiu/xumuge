import * as THREE from "three";
import type { PropKind } from "./catalog";
import { isDeskKind } from "./catalog";
import { DEFAULT_COMPANY_NAME } from "../utils/brandSettings";
import { tryClonePropAssetSync } from "./assets/loadGltf";

export interface MeshTheme {
  primary: number;
  surface: number;
  wood: number;
  accent: number;
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
  opts?: THREE.MeshStandardMaterialParameters,
) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), makeMat(color, opts));
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function addCylinder(
  parent: THREE.Object3D,
  rTop: number,
  rBot: number,
  h: number,
  color: number | string,
  x: number,
  y: number,
  z: number,
) {
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(rTop, rBot, h, 20),
    makeMat(color),
  );
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

/** Unified workstation palette (independent of theme so all desks match). */
const WS = {
  wood: 0xd6c6a8,
  woodEdge: 0xc4b090,
  panel: 0xe2e8f0,
  panelEdge: 0xcbd5e1,
  frame: 0x94a3b8,
  chair: 0x475569,
  chairBack: 0x334155,
  screen: 0x1e293b,
  keyboard: 0x334155,
} as const;

/** Desk surface y; person sit torso ~0.72, head ~1.08 — partitions stay below head. */
const DESK_Y = 0.72;

/** Shared geo for crowd desks — 19 seats must not allocate thousands of BoxGeometries. */
let liteTopGeo: THREE.BoxGeometry | null = null;
let liteLegGeo: THREE.BoxGeometry | null = null;
let liteWoodMat: THREE.MeshBasicMaterial | null = null;
let litePanelMat: THREE.MeshBasicMaterial | null = null;

function makeLiteDeskUnit(width = 1.15): THREE.Group {
  if (!liteTopGeo) liteTopGeo = new THREE.BoxGeometry(1, 0.05, 0.65);
  if (!liteLegGeo) liteLegGeo = new THREE.BoxGeometry(0.06, 0.7, 0.06);
  if (!liteWoodMat) liteWoodMat = new THREE.MeshBasicMaterial({ color: WS.wood });
  if (!litePanelMat) litePanelMat = new THREE.MeshBasicMaterial({ color: WS.panel });
  const g = new THREE.Group();
  const top = new THREE.Mesh(liteTopGeo, liteWoodMat);
  top.position.y = DESK_Y;
  top.scale.x = width;
  top.userData.sharedGeo = true;
  top.userData.sharedMat = true;
  g.add(top);
  for (const sx of [-0.4 * width, 0.4 * width] as const) {
    const leg = new THREE.Mesh(liteLegGeo, litePanelMat);
    leg.position.set(sx, 0.35, 0.2);
    leg.userData.sharedGeo = true;
    leg.userData.sharedMat = true;
    g.add(leg);
  }
  return g;
}

/** Crowd mode: one simple unit per visual seat (cap 4), no monitors/chairs. */
function makeLiteDeskBank(seats: number): THREE.Group {
  const n = Math.max(1, Math.min(4, Math.round(seats)));
  if (n === 1) return makeLiteDeskUnit(1.15);
  const g = new THREE.Group();
  const pitch = BANK_PITCH;
  for (let i = 0; i < n; i++) {
    const u = makeLiteDeskUnit(0.95);
    u.position.x = -((n - 1) * pitch) / 2 + i * pitch;
    g.add(u);
  }
  return g;
}

const PANEL_TOP = 1.08;

function addWorkstationMonitor(
  g: THREE.Group,
  theme: MeshTheme,
  lit: boolean,
  mx: number,
  mz: number,
) {
  const bezel = addBox(g, 0.36, 0.24, 0.03, WS.screen, mx, DESK_Y + 0.22, mz);
  if (lit) {
    (bezel.material as THREE.MeshStandardMaterial).emissive = new THREE.Color(theme.primary);
    (bezel.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.45;
  }
  addBox(g, 0.04, 0.1, 0.04, 0x475569, mx, DESK_Y + 0.08, mz);
  addBox(g, 0.12, 0.02, 0.08, 0x64748b, mx, DESK_Y + 0.02, mz + 0.02);
}

function addWorkstationChair(g: THREE.Group, x: number, z: number) {
  addBox(g, 0.36, 0.06, 0.36, WS.chair, x, 0.4, z);
  addBox(g, 0.36, 0.32, 0.05, WS.chairBack, x, 0.58, z + 0.16);
  addCylinder(g, 0.035, 0.035, 0.34, WS.frame, x, 0.2, z);
}

/** Single-person cubicle: low partitions, no privacy board blocking monitors. */
function makeDesk(theme: MeshTheme, lit: boolean) {
  const g = new THREE.Group();
  // Desktop
  addBox(g, 1.15, 0.04, 0.68, WS.wood, 0, DESK_Y, 0);
  addBox(g, 1.12, 0.03, 0.64, WS.woodEdge, 0, DESK_Y - 0.035, 0);
  // Pedestal + open leg
  addBox(g, 0.36, 0.64, 0.5, WS.panel, 0.36, 0.32, 0.02);
  addBox(g, 0.3, 0.02, 0.02, WS.frame, 0.36, 0.4, 0.28);
  addBox(g, 0.05, 0.64, 0.05, WS.frame, -0.48, 0.32, -0.24);
  addBox(g, 0.05, 0.64, 0.05, WS.frame, -0.48, 0.32, 0.24);

  // Low back / side panels (below seated head)
  const ph = PANEL_TOP - DESK_Y;
  addBox(g, 1.18, ph, 0.04, WS.panel, 0, DESK_Y + ph / 2, -0.34);
  addBox(g, 1.2, 0.03, 0.05, WS.panelEdge, 0, PANEL_TOP, -0.34);
  for (const sx of [-0.58, 0.58] as const) {
    addBox(g, 0.04, ph, 0.58, WS.panel, sx, DESK_Y + ph / 2, -0.02);
  }

  addWorkstationMonitor(g, theme, lit, 0, -0.18);
  addBox(g, 0.34, 0.015, 0.12, WS.keyboard, 0, DESK_Y + 0.02, 0.06);
  addWorkstationChair(g, 0, 0.5);
  return g;
}

/** Seat-to-seat spacing along linked banks (must clear chairs + pedestals). */
const BANK_PITCH = 1.4;
/** L / corner units are ~1.57 wide — keep a clear gap between crooks. */
const L_BANK_PITCH = 2.1;

/** N linked straight workstations sharing one continuous top + back rail. */
function makeDeskBank(theme: MeshTheme, lit: boolean, seats: number) {
  // Cap visual seats — keep banks readable without exploding mesh count
  const n = Math.max(1, Math.min(8, Math.round(seats)));
  if (n === 1) return makeDesk(theme, lit);

  const g = new THREE.Group();
  const pitch = BANK_PITCH;
  const width = pitch * n - 0.08;
  const depth = 0.7;
  addBox(g, width, 0.04, depth, WS.wood, 0, DESK_Y, 0);
  addBox(g, width - 0.04, 0.03, depth - 0.04, WS.woodEdge, 0, DESK_Y - 0.035, 0);

  const ph = PANEL_TOP - DESK_Y;
  addBox(g, width + 0.04, ph, 0.04, WS.panel, 0, DESK_Y + ph / 2, -depth / 2 - 0.01);
  addBox(g, width + 0.06, 0.03, 0.05, WS.panelEdge, 0, PANEL_TOP, -depth / 2 - 0.01);
  // End caps
  for (const sx of [-(width / 2 + 0.01), width / 2 + 0.01] as const) {
    addBox(g, 0.04, ph, depth - 0.08, WS.panel, sx, DESK_Y + ph / 2, -0.02);
  }

  for (let i = 0; i < n; i++) {
    const x = -((n - 1) * pitch) / 2 + i * pitch;
    addBox(g, 0.34, 0.64, 0.48, WS.panel, x + 0.28, 0.32, 0.02);
    addBox(g, 0.05, 0.64, 0.05, WS.frame, x - 0.42, 0.32, -0.22);
    if (i > 0) {
      addBox(g, 0.03, ph * 0.55, 0.42, WS.panelEdge, x - pitch / 2, DESK_Y + (ph * 0.55) / 2, -0.04);
    }
    addWorkstationMonitor(g, theme, lit, x, -0.18);
    addBox(g, 0.3, 0.015, 0.12, WS.keyboard, x, DESK_Y + 0.02, 0.06);
    addWorkstationChair(g, x, 0.5);
  }
  return g;
}

/** Side-by-side linked workstation (2+ seats). */
function makeDeskDuo(theme: MeshTheme, lit: boolean, seats = 2) {
  return makeDeskBank(theme, lit, Math.max(2, seats));
}

/**
 * Continuous L cubicle: one extruded L top, return on the left,
 * seat in the crook, monitor on the main wing.
 */
function makeDeskLUnit(theme: MeshTheme, lit: boolean) {
  const g = new THREE.Group();

  // L footprint: main wing facing +Z (chair), return along −Z on the left
  const shape = new THREE.Shape();
  shape.moveTo(-0.72, -1.05);
  shape.lineTo(-0.72, 0.4);
  shape.lineTo(0.85, 0.4);
  shape.lineTo(0.85, -0.28);
  shape.lineTo(-0.15, -0.28);
  shape.lineTo(-0.15, -1.05);
  shape.lineTo(-0.72, -1.05);

  const topGeo = new THREE.ExtrudeGeometry(shape, {
    depth: 0.045,
    bevelEnabled: false,
  });
  const top = new THREE.Mesh(topGeo, makeMat(WS.wood));
  top.rotation.x = -Math.PI / 2;
  top.position.set(0, DESK_Y - 0.02, 0);
  top.castShadow = true;
  top.receiveShadow = true;
  g.add(top);

  // Underside lip
  addBox(g, 1.52, 0.03, 0.64, WS.woodEdge, 0.065, DESK_Y - 0.04, 0.06);
  addBox(g, 0.52, 0.03, 0.72, WS.woodEdge, -0.435, DESK_Y - 0.04, -0.665);

  // Pedestal under main wing; thin legs under return
  addBox(g, 0.38, 0.64, 0.5, WS.panel, 0.5, 0.32, 0.05);
  addBox(g, 0.05, 0.64, 0.05, WS.frame, -0.58, 0.32, -0.9);
  addBox(g, 0.05, 0.64, 0.05, WS.frame, -0.58, 0.32, -0.05);
  addBox(g, 0.05, 0.64, 0.05, WS.frame, -0.25, 0.32, -0.9);

  const ph = PANEL_TOP - DESK_Y;
  // Outer panels — open toward crook
  addBox(g, 1.55, ph, 0.035, WS.panel, 0.065, DESK_Y + ph / 2, -0.28);
  addBox(g, 0.035, ph, 1.1, WS.panel, -0.72, DESK_Y + ph / 2, -0.45);
  addBox(g, 1.57, 0.025, 0.04, WS.panelEdge, 0.065, PANEL_TOP, -0.28);

  addWorkstationMonitor(g, theme, lit, 0.25, -0.08);
  addBox(g, 0.3, 0.015, 0.11, WS.keyboard, 0.25, DESK_Y + 0.02, 0.14);
  addBox(g, 0.06, 0.02, 0.09, WS.keyboard, 0.45, DESK_Y + 0.02, 0.18);
  addWorkstationChair(g, 0.1, 0.55);
  return g;
}

function makeDeskL(theme: MeshTheme, lit: boolean, seats = 1) {
  const n = Math.max(1, Math.min(6, Math.round(seats)));
  if (n === 1) return makeDeskLUnit(theme, lit);
  const g = new THREE.Group();
  const pitch = L_BANK_PITCH;
  for (let i = 0; i < n; i++) {
    const unit = makeDeskLUnit(theme, lit);
    unit.position.x = -((n - 1) * pitch) / 2 + i * pitch;
    g.add(unit);
  }
  return g;
}

/** Opposite facing bench — scales seat count in pairs along X. */
function makeDeskBench(theme: MeshTheme, lit: boolean, seats = 2) {
  const n = Math.max(2, Math.min(8, Math.round(seats)));
  const pairs = Math.ceil(n / 2);
  const g = new THREE.Group();
  const pitch = BANK_PITCH;
  const width = pitch * pairs - 0.05;
  addBox(g, width, 0.04, 1.15, WS.wood, 0, DESK_Y, 0);
  const ph = PANEL_TOP - DESK_Y;
  addBox(g, width + 0.04, ph + 0.1, 0.05, WS.panel, 0, DESK_Y + (ph + 0.1) / 2, 0);

  let placed = 0;
  for (let i = 0; i < pairs && placed < n; i++) {
    const x = -((pairs - 1) * pitch) / 2 + i * pitch;
    addWorkstationMonitor(g, theme, lit, x, -0.35);
    addBox(g, 0.3, 0.015, 0.12, WS.keyboard, x, DESK_Y + 0.02, -0.1);
    addWorkstationChair(g, x, -0.55);
    placed++;
    if (placed >= n) break;
    addWorkstationMonitor(g, theme, lit, x, 0.35);
    addBox(g, 0.3, 0.015, 0.12, WS.keyboard, x, DESK_Y + 0.02, 0.1);
    addWorkstationChair(g, x, 0.55);
    placed++;
  }
  return g;
}

/** Corner desk with short return — single seat, not a linked bank. */
function makeDeskCorner(theme: MeshTheme, lit: boolean) {
  const g = new THREE.Group();
  addBox(g, 1.05, 0.04, 0.6, WS.wood, 0, DESK_Y, 0.05);
  addBox(g, 0.5, 0.04, 0.85, WS.wood, 0.48, DESK_Y, -0.4);
  addBox(g, 0.36, 0.64, 0.48, WS.panel, -0.32, 0.32, 0.08);
  const ph = PANEL_TOP - DESK_Y;
  addBox(g, 1.08, ph, 0.04, WS.panel, 0, DESK_Y + ph / 2, -0.26);
  addBox(g, 0.04, ph, 0.7, WS.panel, 0.74, DESK_Y + ph / 2, -0.35);
  addWorkstationMonitor(g, theme, lit, 0.08, -0.12);
  addBox(g, 0.3, 0.015, 0.11, WS.keyboard, 0, DESK_Y + 0.02, 0.14);
  addWorkstationChair(g, 0, 0.5);
  return g;
}

/** Standing-height desk. */
function makeDeskStanding(theme: MeshTheme, lit: boolean) {
  const g = new THREE.Group();
  const y = 1.05;
  addBox(g, 1.1, 0.05, 0.55, WS.wood, 0, y, 0);
  addBox(g, 0.06, 1.0, 0.06, WS.frame, -0.45, 0.5, -0.2);
  addBox(g, 0.06, 1.0, 0.06, WS.frame, 0.45, 0.5, -0.2);
  addBox(g, 0.06, 1.0, 0.06, WS.frame, -0.45, 0.5, 0.2);
  addBox(g, 0.06, 1.0, 0.06, WS.frame, 0.45, 0.5, 0.2);
  const bezel = addBox(g, 0.4, 0.26, 0.03, WS.screen, 0, y + 0.28, -0.18);
  if (lit) {
    (bezel.material as THREE.MeshStandardMaterial).emissive = new THREE.Color(theme.primary);
    (bezel.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.45;
  }
  addBox(g, 0.34, 0.015, 0.12, WS.keyboard, 0, y + 0.02, 0.05);
  return g;
}

/** Compact single desk. */
function makeDeskCompact(theme: MeshTheme, lit: boolean) {
  const g = new THREE.Group();
  addBox(g, 0.9, 0.04, 0.55, WS.wood, 0, DESK_Y, 0);
  addBox(g, 0.05, 0.68, 0.05, WS.frame, -0.38, 0.34, -0.2);
  addBox(g, 0.05, 0.68, 0.05, WS.frame, 0.38, 0.34, -0.2);
  addBox(g, 0.05, 0.68, 0.05, WS.frame, -0.38, 0.34, 0.2);
  addBox(g, 0.05, 0.68, 0.05, WS.frame, 0.38, 0.34, 0.2);
  addWorkstationMonitor(g, theme, lit, 0, -0.15);
  addBox(g, 0.28, 0.015, 0.1, WS.keyboard, 0, DESK_Y + 0.02, 0.06);
  addWorkstationChair(g, 0, 0.42);
  return g;
}

function makeDeskExecL(theme: MeshTheme, lit: boolean) {
  const g = new THREE.Group();
  const wood = theme.wood;
  // Main + short return — single executive L, not a double desk bank
  addBox(g, 1.7, 0.08, 0.85, wood, -0.05, 0.76, 0.05);
  addBox(g, 0.55, 0.08, 1.05, wood, 0.75, 0.76, -0.4);
  addBox(g, 0.45, 0.62, 0.75, new THREE.Color(wood).offsetHSL(0, 0, -0.05).getHex(), -0.7, 0.31, 0.05);
  const bezel = addBox(g, 0.55, 0.34, 0.05, 0x1a1f26, 0, 1.1, -0.28);
  if (lit) {
    (bezel.material as THREE.MeshStandardMaterial).emissive = new THREE.Color(theme.primary);
    (bezel.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.4;
  }
  return g;
}

function makeRoomShell(label: string, accent: number, subtitle?: string, _height = 2.2) {
  const g = new THREE.Group();
  const floor = new THREE.Color(accent).offsetHSL(0, -0.3, 0.45).getHex();
  // Zone marker only — no nested walls (avoids「房间套房间」)
  addBox(g, 2.2, 0.03, 1.8, floor, 0, 0.02, 0);
  addBox(g, 2.15, 0.02, 1.75, 0xf8fafc, 0, 0.04, 0);
  addBox(g, 0.12, 1.35, 0.12, accent, -0.85, 0.68, -0.7);
  addBox(g, 1.35, 0.42, 0.06, 0xf8fafc, -0.1, 1.15, -0.7);
  addBox(g, 1.3, 0.05, 0.05, accent, -0.1, 0.95, -0.68);
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 160;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#f8fafc";
  ctx.fillRect(0, 0, 512, 160);
  ctx.fillStyle = "#0f172a";
  ctx.font = "bold 44px system-ui,sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label.slice(0, 10), 256, subtitle ? 52 : 80);
  if (subtitle) {
    ctx.fillStyle = "#334155";
    ctx.font = "26px system-ui,sans-serif";
    ctx.fillText(subtitle.slice(0, 18), 256, 112);
  }
  const tex = new THREE.CanvasTexture(canvas);
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(1.25, 0.38),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true }),
  );
  sign.position.set(-0.1, 1.15, -0.66);
  g.add(sign);
  return g;
}

function makeChairExec() {
  const g = new THREE.Group();
  const leather = 0x2c333a;
  addCylinder(g, 0.22, 0.28, 0.08, leather, 0, 0.42, 0);
  addBox(g, 0.48, 0.55, 0.08, leather, 0, 0.75, -0.18);
  addBox(g, 0.08, 0.28, 0.08, 0x444444, -0.28, 0.58, 0);
  addBox(g, 0.08, 0.28, 0.08, 0x444444, 0.28, 0.58, 0);
  addCylinder(g, 0.04, 0.04, 0.4, 0x555555, 0, 0.2, 0);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    addBox(g, 0.28, 0.04, 0.06, 0x444444, Math.cos(a) * 0.18, 0.04, Math.sin(a) * 0.18);
  }
  return g;
}

function makeCabinet() {
  const g = new THREE.Group();
  addBox(g, 0.85, 1.5, 0.4, 0x8b98a6, 0, 0.75, 0);
  addBox(g, 0.78, 0.02, 0.02, 0xcfd6de, 0, 1.0, 0.21);
  addBox(g, 0.78, 0.02, 0.02, 0xcfd6de, 0, 0.55, 0.21);
  addBox(g, 0.06, 0.06, 0.04, 0x555555, 0.28, 1.15, 0.22);
  addBox(g, 0.06, 0.06, 0.04, 0x555555, 0.28, 0.7, 0.22);
  return g;
}

function makePrinter(theme: MeshTheme) {
  const g = new THREE.Group();
  addBox(g, 0.55, 0.28, 0.45, 0xd0d5dc, 0, 0.55, 0);
  addBox(g, 0.5, 0.08, 0.4, 0xb8c0ca, 0, 0.72, 0);
  addBox(g, 0.35, 0.02, 0.28, 0xf5f5f0, 0, 0.78, 0.02);
  addBox(g, 0.12, 0.04, 0.08, theme.primary, 0.18, 0.74, 0.18);
  return g;
}

function makeDeskArc(theme: MeshTheme, lit: boolean, seats = 2) {
  const g = new THREE.Group();
  const n = Math.max(1, Math.min(8, seats));
  const wood = makeMat(theme.wood);
  const top = new THREE.Mesh(
    new THREE.TorusGeometry(0.9 + n * 0.12, 0.28, 8, 24, Math.PI * 0.85),
    wood,
  );
  top.rotation.x = Math.PI / 2;
  top.position.y = 0.72;
  top.castShadow = true;
  g.add(top);
  const panel = new THREE.Mesh(
    new THREE.BoxGeometry(1.6 + n * 0.15, 0.55, 0.08),
    makeMat(0x3a4550),
  );
  panel.position.set(0, 0.35, 0.35);
  g.add(panel);
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const ang = -Math.PI * 0.35 + t * Math.PI * 0.7;
    const chair = new THREE.Mesh(
      new THREE.BoxGeometry(0.32, 0.08, 0.32),
      makeMat(0x4a5560),
    );
    chair.position.set(Math.sin(ang) * 0.55, 0.42, Math.cos(ang) * 0.55 + 0.15);
    g.add(chair);
  }
  if (lit) {
    const glow = new THREE.PointLight(theme.accent, 0.35, 2.5);
    glow.position.set(0, 1.1, 0);
    g.add(glow);
  }
  return g;
}

function makeDeskExecArc(theme: MeshTheme, lit: boolean) {
  const g = makeDeskArc(theme, lit, 1);
  g.scale.set(1.25, 1.1, 1.25);
  return g;
}

function makeDeskExec(theme: MeshTheme, lit: boolean) {
  const g = new THREE.Group();
  const wood = theme.wood;
  // Wide executive top
  addBox(g, 2.4, 0.08, 1.15, wood, 0, 0.76, 0);
  addBox(g, 2.3, 0.12, 1.05, new THREE.Color(wood).offsetHSL(0, 0, -0.08).getHex(), 0, 0.66, 0);
  // Pedestal drawers left / right
  addBox(g, 0.55, 0.62, 0.95, new THREE.Color(wood).offsetHSL(0, 0, -0.05).getHex(), -0.85, 0.31, 0);
  addBox(g, 0.55, 0.62, 0.95, new THREE.Color(wood).offsetHSL(0, 0, -0.05).getHex(), 0.85, 0.31, 0);
  for (const x of [-0.85, 0.85] as const) {
    addBox(g, 0.48, 0.02, 0.02, 0xcfd6de, x, 0.48, 0.48);
    addBox(g, 0.48, 0.02, 0.02, 0xcfd6de, x, 0.28, 0.48);
  }
  // Single large monitor
  const bezel = addBox(g, 0.72, 0.42, 0.05, 0x1a1f26, 0, 1.15, -0.35);
  if (lit) {
    (bezel.material as THREE.MeshStandardMaterial).emissive = new THREE.Color(theme.primary);
    (bezel.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.45;
  }
  addBox(g, 0.08, 0.22, 0.08, 0x333333, 0, 0.92, -0.35);
  addBox(g, 0.5, 0.02, 0.18, 0x2a2e34, 0, 0.82, 0.15);
  return g;
}

function makePlant() {
  const g = new THREE.Group();
  addCylinder(g, 0.12, 0.14, 0.2, 0x8b6914, 0, 0.1, 0);
  addCylinder(g, 0.16, 0.2, 0.7, 0x4f8f45, 0, 0.55, 0);
  return g;
}

function makePlantLarge() {
  const g = new THREE.Group();
  addCylinder(g, 0.22, 0.28, 0.32, 0x7a5a28, 0, 0.16, 0);
  addCylinder(g, 0.18, 0.22, 0.18, 0x5c4320, 0, 0.38, 0);
  // Trunk
  addCylinder(g, 0.05, 0.07, 0.7, 0x6b4a2a, 0, 0.75, 0);
  // Foliage clusters
  for (const [x, y, z, r] of [
    [0, 1.35, 0, 0.42],
    [-0.28, 1.2, 0.1, 0.28],
    [0.26, 1.25, -0.12, 0.3],
    [0.05, 1.55, 0.08, 0.26],
  ] as const) {
    addCylinder(g, r * 0.85, r, r * 1.1, 0x3f8f4a, x, y, z);
  }
  return g;
}

function makeCooler() {
  const g = new THREE.Group();
  addBox(g, 0.55, 0.85, 0.45, 0xe8eef4, 0, 0.5, 0);
  const tank = addCylinder(g, 0.28, 0.28, 0.45, 0x8ec4e8, 0, 1.15, 0);
  (tank.material as THREE.MeshStandardMaterial).transparent = true;
  (tank.material as THREE.MeshStandardMaterial).opacity = 0.85;
  return g;
}

function makeCoffee() {
  const g = new THREE.Group();
  addBox(g, 0.45, 0.55, 0.4, 0x2a2a2a, 0, 0.85, 0);
  addBox(g, 0.18, 0.14, 0.18, 0xc45c4a, -0.05, 0.7, 0.15);
  return g;
}

function makeSofaLoveseat(theme: MeshTheme) {
  const g = new THREE.Group();
  const fabric = new THREE.Color(theme.primary).offsetHSL(0.02, -0.18, 0.2).getHex();
  addBox(g, 1.35, 0.28, 0.7, fabric, 0, 0.28, 0);
  addBox(g, 1.35, 0.42, 0.12, fabric, 0, 0.52, -0.28);
  addBox(g, 0.12, 0.38, 0.7, fabric, -0.62, 0.48, 0);
  addBox(g, 0.12, 0.38, 0.7, fabric, 0.62, 0.48, 0);
  return g;
}

function makeSofaCorner(theme: MeshTheme) {
  const g = new THREE.Group();
  const fabric = new THREE.Color(theme.primary).offsetHSL(0.04, -0.12, 0.16).getHex();
  addBox(g, 2.0, 0.28, 0.75, fabric, -0.2, 0.28, 0.4);
  addBox(g, 0.75, 0.28, 1.6, fabric, 0.7, 0.28, -0.3);
  addBox(g, 2.0, 0.45, 0.12, fabric, -0.2, 0.55, 0.05);
  addBox(g, 0.12, 0.45, 1.6, fabric, 1.05, 0.55, -0.3);
  return g;
}

function makeCoffeeTableRound(theme: MeshTheme) {
  const g = new THREE.Group();
  addCylinder(g, 0.48, 0.48, 0.06, theme.wood, 0, 0.38, 0);
  addCylinder(g, 0.08, 0.12, 0.34, 0x4a3a28, 0, 0.18, 0);
  return g;
}

function makeCoffeeTableGlass(theme: MeshTheme) {
  const g = new THREE.Group();
  addBox(g, 1.1, 0.04, 0.6, 0xa8d4e8, 0, 0.4, 0, {
    transparent: true,
    opacity: 0.35,
    roughness: 0.1,
    metalness: 0.2,
    depthWrite: false,
  });
  addBox(g, 0.06, 0.38, 0.06, 0x555555, -0.45, 0.19, -0.22);
  addBox(g, 0.06, 0.38, 0.06, 0x555555, 0.45, 0.19, -0.22);
  addBox(g, 0.06, 0.38, 0.06, 0x555555, -0.45, 0.19, 0.22);
  addBox(g, 0.06, 0.38, 0.06, 0x555555, 0.45, 0.19, 0.22);
  void theme;
  return g;
}

function makeSofa(theme: MeshTheme) {
  const g = new THREE.Group();
  const fabric = new THREE.Color(theme.primary).offsetHSL(0.02, -0.2, 0.15).getHex();
  addBox(g, 1.8, 0.26, 0.65, fabric, 0, 0.26, 0);
  addBox(g, 1.8, 0.4, 0.12, fabric, 0, 0.5, -0.26);
  addBox(g, 0.12, 0.36, 0.65, fabric, -0.84, 0.46, 0);
  addBox(g, 0.12, 0.36, 0.65, fabric, 0.84, 0.46, 0);
  return g;
}

function makeSofaLarge(theme: MeshTheme) {
  const g = new THREE.Group();
  const fabric = new THREE.Color(theme.primary).offsetHSL(0.03, -0.15, 0.18).getHex();
  const cushion = new THREE.Color(fabric).offsetHSL(0, 0, 0.08).getHex();
  // Deep wide sofa
  addBox(g, 2.9, 0.32, 0.95, fabric, 0, 0.3, 0);
  addBox(g, 2.9, 0.55, 0.16, fabric, 0, 0.62, -0.4);
  addBox(g, 0.16, 0.5, 0.95, fabric, -1.37, 0.58, 0);
  addBox(g, 0.16, 0.5, 0.95, fabric, 1.37, 0.58, 0);
  // Seat cushions
  addBox(g, 0.85, 0.1, 0.75, cushion, -0.9, 0.48, 0.05);
  addBox(g, 0.85, 0.1, 0.75, cushion, 0, 0.48, 0.05);
  addBox(g, 0.85, 0.1, 0.75, cushion, 0.9, 0.48, 0.05);
  return g;
}

function makeCoffeeTable(theme: MeshTheme) {
  const g = new THREE.Group();
  addBox(g, 1.15, 0.06, 0.65, theme.wood, 0, 0.36, 0);
  addBox(g, 1.05, 0.04, 0.55, new THREE.Color(theme.wood).offsetHSL(0, 0, -0.1).getHex(), 0, 0.3, 0);
  // Cross legs
  addBox(g, 0.08, 0.3, 0.08, 0x4a3a28, -0.4, 0.15, -0.2);
  addBox(g, 0.08, 0.3, 0.08, 0x4a3a28, 0.4, 0.15, -0.2);
  addBox(g, 0.08, 0.3, 0.08, 0x4a3a28, -0.4, 0.15, 0.2);
  addBox(g, 0.08, 0.3, 0.08, 0x4a3a28, 0.4, 0.15, 0.2);
  addBox(g, 0.9, 0.04, 0.08, 0x4a3a28, 0, 0.06, 0);
  return g;
}

function makeRug(theme: MeshTheme) {
  const g = new THREE.Group();
  addBox(g, 1.8, 0.03, 1.2, new THREE.Color(theme.primary).offsetHSL(0, -0.3, 0.25).getHex(), 0, 0.02, 0, {
    roughness: 0.95,
  });
  return g;
}

function makeDoor(theme: MeshTheme) {
  const g = new THREE.Group();
  // 门框：仅左右边框+上门楣，开口留空（不再用整块板冒充关闭的门）
  const frame = 0x5c4a3a;
  addBox(g, 0.1, 2.1, 0.08, frame, 0, 1.05, -0.5); // left jamb
  addBox(g, 0.1, 2.1, 0.08, frame, 0, 1.05, 0.5); // right jamb
  addBox(g, 0.1, 0.12, 1.08, frame, 0, 2.04, 0); // lintel
  // 门扇：绕左侧铰链开合
  const leaf = new THREE.Group();
  leaf.name = "doorLeaf";
  leaf.userData.doorLeaf = true;
  leaf.position.set(0.04, 0, -0.46);
  addBox(leaf, 0.05, 1.92, 0.9, theme.wood, 0, 0.98, 0.45);
  addBox(leaf, 0.03, 0.05, 0.05, 0xc9a227, 0.04, 1.0, 0.7);
  g.add(leaf);
  g.userData.hasDoorLeaf = true;
  return g;
}

function makeDoorGlass(theme: MeshTheme) {
  const g = new THREE.Group();
  const frame = 0x4a5560;
  addBox(g, 0.08, 2.1, 0.08, frame, 0, 1.05, -0.5);
  addBox(g, 0.08, 2.1, 0.08, frame, 0, 1.05, 0.5);
  addBox(g, 0.08, 0.1, 1.08, frame, 0, 2.05, 0);
  const leaf = new THREE.Group();
  leaf.name = "doorLeaf";
  leaf.userData.doorLeaf = true;
  leaf.position.set(0.04, 0, -0.46);
  addBox(leaf, 0.04, 1.75, 0.88, 0xa8d4e8, 0, 1.05, 0.44, {
    transparent: true,
    opacity: 0.32,
    roughness: 0.08,
    metalness: 0.15,
    depthWrite: false,
  });
  addBox(leaf, 0.03, 0.05, 0.05, 0x888888, 0.03, 1.0, 0.7);
  g.add(leaf);
  g.userData.hasDoorLeaf = true;
  void theme;
  return g;
}

function makeDoorDouble(theme: MeshTheme) {
  const g = new THREE.Group();
  const frame = 0x5c4a3a;
  addBox(g, 0.1, 2.1, 0.08, frame, 0, 1.05, -0.95);
  addBox(g, 0.1, 2.1, 0.08, frame, 0, 1.05, 0.95);
  addBox(g, 0.1, 0.12, 1.98, frame, 0, 2.04, 0);
  const left = new THREE.Group();
  left.name = "doorLeafL";
  left.userData.doorLeaf = true;
  left.userData.doorLeafDir = 1;
  left.position.set(0.04, 0, -0.9);
  addBox(left, 0.05, 1.92, 0.88, theme.wood, 0, 0.98, 0.44);
  addBox(left, 0.03, 0.05, 0.05, 0xc9a227, 0.04, 1.0, 0.68);
  g.add(left);
  const right = new THREE.Group();
  right.name = "doorLeafR";
  right.userData.doorLeaf = true;
  right.userData.doorLeafDir = -1;
  right.position.set(0.04, 0, 0.9);
  addBox(right, 0.05, 1.92, 0.88, theme.wood, 0, 0.98, -0.44);
  addBox(right, 0.03, 0.05, 0.05, 0xc9a227, 0.04, 1.0, -0.68);
  g.add(right);
  g.userData.hasDoorLeaf = true;
  return g;
}

function makeDoorDoubleGlass(_theme: MeshTheme) {
  const g = new THREE.Group();
  const frame = 0x5a6570;
  addBox(g, 0.1, 2.15, 0.08, frame, 0, 1.075, -0.95);
  addBox(g, 0.1, 2.15, 0.08, frame, 0, 1.075, 0.95);
  addBox(g, 0.1, 0.12, 1.98, frame, 0, 2.08, 0);
  const glassOpts: THREE.MeshStandardMaterialParameters = {
    transparent: true,
    opacity: 0.32,
    roughness: 0.08,
    metalness: 0.15,
    depthWrite: false,
  };
  const left = new THREE.Group();
  left.name = "doorLeafL";
  left.userData.doorLeaf = true;
  left.userData.doorLeafDir = 1;
  left.position.set(0.04, 0, -0.9);
  addBox(left, 0.04, 1.95, 0.88, 0xa8d4e8, 0, 1.05, 0.44, glassOpts);
  g.add(left);
  const right = new THREE.Group();
  right.name = "doorLeafR";
  right.userData.doorLeaf = true;
  right.userData.doorLeafDir = -1;
  right.position.set(0.04, 0, 0.9);
  addBox(right, 0.04, 1.95, 0.88, 0xa8d4e8, 0, 1.05, -0.44, glassOpts);
  g.add(right);
  g.userData.hasDoorLeaf = true;
  return g;
}

function makeReceptionDesk(theme: MeshTheme) {
  const g = new THREE.Group();
  addBox(g, 2.4, 1.05, 0.55, theme.wood, 0, 0.525, 0);
  addBox(g, 0.45, 1.05, 1.1, theme.wood, -1.1, 0.525, -0.35);
  addBox(g, 0.45, 1.05, 1.1, theme.wood, 1.1, 0.525, -0.35);
  addBox(g, 2.5, 0.06, 0.65, 0xe8e4dc, 0, 1.08, 0.05);
  addBox(g, 1.2, 0.45, 0.08, theme.primary, 0, 1.55, -0.2);
  return g;
}

/** 烟玻抬层前台 */
function makeReceptionGlass(_theme: MeshTheme) {
  const g = new THREE.Group();
  addBox(g, 2.6, 0.95, 0.7, 0x2a2e33, 0, 0.48, 0, {
    transparent: true,
    opacity: 0.55,
    roughness: 0.12,
    metalness: 0.35,
  });
  addBox(g, 2.4, 0.06, 0.45, 0x1a1d22, 0, 1.12, 0.05);
  addBox(g, 0.04, 0.35, 0.04, 0x111111, -0.7, 0.95, 0.05);
  addBox(g, 0.04, 0.35, 0.04, 0x111111, 0.7, 0.95, 0.05);
  return g;
}

/** 黑白分体前台 */
function makeReceptionSplit(theme: MeshTheme) {
  const g = new THREE.Group();
  addBox(g, 1.1, 1.15, 0.75, 0x1a1a1a, -0.95, 0.575, 0);
  addBox(g, 2.0, 0.95, 0.65, 0xf5f5f5, 0.55, 0.475, 0);
  addBox(g, 0.7, 0.7, 0.04, 0xffffff, -0.95, 0.7, 0.38);
  addBox(g, 0.35, 0.08, 0.5, theme.primary, 1.2, 0.98, 0);
  return g;
}

/** 拱底蓝条前台 */
function makeReceptionArch(theme: MeshTheme) {
  const g = new THREE.Group();
  addBox(g, 2.8, 1.0, 0.7, 0xf8fafc, 0, 0.55, 0);
  addBox(g, 0.55, 1.0, 0.72, theme.primary, 0.95, 0.55, 0);
  // arched cut suggestion: darker inset at base
  addBox(g, 1.6, 0.28, 0.72, 0xe2e8f0, -0.35, 0.14, 0);
  return g;
}

/** 极简白灰前台 */
function makeReceptionMinimal(_theme: MeshTheme) {
  const g = new THREE.Group();
  addBox(g, 2.7, 1.0, 0.65, 0xffffff, 0, 0.5, 0);
  addBox(g, 0.45, 1.0, 0.66, 0x333333, 0.85, 0.5, 0);
  addBox(g, 2.5, 0.03, 0.02, 0x222222, -0.1, 0.32, 0.33);
  return g;
}

/** 大理石木饰前台 */
function makeReceptionMarble(theme: MeshTheme) {
  const g = new THREE.Group();
  addBox(g, 2.9, 1.05, 0.7, 0xeceff3, 0, 0.525, 0);
  addBox(g, 1.4, 0.12, 0.72, theme.wood, -0.7, 0.08, 0);
  addBox(g, 0.9, 0.35, 0.05, 0x222222, -0.85, 0.75, 0.36);
  return g;
}

function makeWindow(_theme: MeshTheme) {
  const g = new THREE.Group();
  addBox(g, 0.08, 1.2, 1.4, 0x5a6570, 0, 1.4, 0);
  addBox(g, 0.03, 1.0, 1.2, 0xb8daf0, 0.03, 1.4, 0, {
    transparent: true,
    opacity: 0.22,
    roughness: 0.05,
    metalness: 0.1,
    depthWrite: false,
  });
  addBox(g, 0.025, 1.0, 0.03, 0xeeeeee, 0.05, 1.4, 0);
  addBox(g, 0.025, 0.03, 1.2, 0xeeeeee, 0.05, 1.4, 0);
  addBox(g, 0.1, 0.06, 1.45, 0x6a7380, 0, 0.78, 0);
  return g;
}

function makeWindowWide(_theme: MeshTheme) {
  const g = new THREE.Group();
  addBox(g, 0.1, 1.85, 2.5, 0x4a5560, 0, 1.25, 0);
  addBox(g, 0.03, 1.6, 2.25, 0xb8daf0, 0.04, 1.25, 0, {
    transparent: true,
    opacity: 0.2,
    roughness: 0.05,
    metalness: 0.12,
    depthWrite: false,
  });
  addBox(g, 0.025, 1.6, 0.03, 0xf5f5f5, 0.06, 1.25, -0.55);
  addBox(g, 0.025, 1.6, 0.03, 0xf5f5f5, 0.06, 1.25, 0.55);
  addBox(g, 0.025, 0.03, 2.25, 0xf5f5f5, 0.06, 1.25, 0);
  return g;
}

function makeWall(theme: MeshTheme, height = 2.4, length = 2.4) {
  const g = new THREE.Group();
  const col = new THREE.Color(theme.surface).offsetHSL(0, -0.05, -0.08).getHex();
  addBox(g, 0.14, height, length, col, 0, height / 2, 0);
  return g;
}

function makeOpening() {
  const g = new THREE.Group();
  // Doorway frame only (hole in wall)
  addBox(g, 0.16, 2.1, 0.08, 0x6e5840, 0, 1.05, -0.52);
  addBox(g, 0.16, 2.1, 0.08, 0x6e5840, 0, 1.05, 0.52);
  addBox(g, 0.16, 0.12, 1.12, 0x6e5840, 0, 2.1, 0);
  return g;
}

function makeBanner(theme: MeshTheme, text: string) {
  const g = new THREE.Group();
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = `#${theme.primary.toString(16).padStart(6, "0")}`;
  ctx.fillRect(0, 0, 512, 128);
  ctx.fillStyle = "#ffffff";
  ctx.font = "600 42px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text.slice(0, 16) || "虚募阁", 256, 64);
  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6, side: THREE.DoubleSide });
  // Face local +X so wallMountRotY (local +X = wall normal) keeps plaque flush to wall
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.6), mat);
  mesh.position.set(0.02, 1.6, 0);
  mesh.rotation.y = Math.PI / 2;
  g.add(mesh);
  addBox(g, 0.04, 0.65, 2.45, 0x333333, -0.02, 1.6, 0);
  return g;
}

function makeWhiteboard() {
  const g = new THREE.Group();
  addBox(g, 1.6, 1.0, 0.06, 0xf5f7fa, 0, 1.3, 0);
  addBox(g, 1.68, 1.08, 0.04, 0x555555, 0, 1.3, -0.04);
  addBox(g, 0.4, 0.04, 0.04, 0x222222, 0, 0.75, 0.02);
  return g;
}

function makeShelf(theme: MeshTheme) {
  const g = new THREE.Group();
  addBox(g, 1.0, 1.6, 0.35, theme.wood, 0, 0.8, 0);
  for (const y of [0.4, 0.8, 1.2]) {
    addBox(g, 0.92, 0.03, 0.3, new THREE.Color(theme.wood).offsetHSL(0, 0, -0.1).getHex(), 0, y, 0.02);
  }
  return g;
}

function makeWaterDispenser() {
  const g = new THREE.Group();
  addBox(g, 0.4, 1.1, 0.4, 0xffffff, 0, 0.55, 0);
  addBox(g, 0.38, 0.2, 0.38, 0x2a6b9a, 0, 1.0, 0);
  addCylinder(g, 0.06, 0.06, 0.12, 0x888888, 0, 0.7, 0.2);
  return g;
}

function makeTree() {
  const g = new THREE.Group();
  addCylinder(g, 0.28, 0.34, 0.28, 0x6b5438, 0, 0.14, 0);
  addCylinder(g, 0.07, 0.1, 1.1, 0x5a4028, 0, 0.85, 0);
  addCylinder(g, 0.55, 0.7, 0.9, 0x2f7a3e, 0, 1.7, 0);
  addCylinder(g, 0.4, 0.5, 0.7, 0x3a8f4a, 0, 2.2, 0);
  return g;
}

function makeBush() {
  const g = new THREE.Group();
  addCylinder(g, 0.35, 0.4, 0.45, 0x3f8a48, 0, 0.25, 0);
  addCylinder(g, 0.28, 0.32, 0.35, 0x4f9a55, -0.22, 0.35, 0.1);
  addCylinder(g, 0.26, 0.3, 0.32, 0x368040, 0.2, 0.32, -0.08);
  return g;
}

function makeFlower() {
  const g = new THREE.Group();
  addCylinder(g, 0.2, 0.24, 0.12, 0x6b5438, 0, 0.06, 0);
  for (const [x, z, c] of [
    [-0.12, 0.05, 0xe879a8],
    [0.1, -0.08, 0xf0a0c0],
    [0.05, 0.12, 0xd94f8a],
    [-0.02, -0.12, 0xffc0d8],
  ] as const) {
    addCylinder(g, 0.08, 0.1, 0.08, c, x, 0.28, z);
    addCylinder(g, 0.015, 0.015, 0.22, 0x3a7a40, x, 0.18, z);
  }
  return g;
}

function makeFlowerPot() {
  const g = new THREE.Group();
  addCylinder(g, 0.14, 0.18, 0.28, 0xc45c48, 0, 0.14, 0);
  addCylinder(g, 0.12, 0.12, 0.06, 0x5a4030, 0, 0.3, 0);
  addCylinder(g, 0.2, 0.22, 0.35, 0x4a9a55, 0, 0.52, 0);
  addCylinder(g, 0.06, 0.08, 0.06, 0xf2a0c0, 0.08, 0.62, 0.06);
  addCylinder(g, 0.05, 0.07, 0.05, 0xe878a8, -0.06, 0.58, -0.04);
  return g;
}

function makeFloorLamp(theme: MeshTheme) {
  const g = new THREE.Group();
  addCylinder(g, 0.18, 0.22, 0.06, 0x444444, 0, 0.03, 0);
  addCylinder(g, 0.03, 0.03, 1.4, 0x888888, 0, 0.75, 0);
  addCylinder(g, 0.22, 0.28, 0.28, theme.primary, 0, 1.55, 0);
  return g;
}

function makePartition(theme: MeshTheme) {
  const g = new THREE.Group();
  addBox(g, 1.6, 1.35, 0.08, new THREE.Color(theme.surface).offsetHSL(0, 0, -0.05).getHex(), 0, 0.68, 0);
  addBox(g, 1.6, 0.06, 0.1, 0x666666, 0, 1.38, 0);
  addBox(g, 1.6, 0.06, 0.1, 0x666666, 0, 0.04, 0);
  return g;
}

function tintGroup(g: THREE.Object3D, hex: string) {
  const color = new THREE.Color(hex);
  g.traverse((o) => {
    if (o instanceof THREE.Mesh && o.material instanceof THREE.MeshStandardMaterial) {
      o.material = o.material.clone();
      o.material.color.copy(color);
    }
  });
}

export function createPropMesh(
  kind: PropKind,
  theme: MeshTheme,
  meta?: {
    lit?: boolean;
    text?: string;
    color?: string;
    subtitle?: string;
    height?: number;
    length?: number;
    seatCount?: number;
    /** Crowd offices (≈12+ staff): skip monitors/chairs/detail */
    lite?: boolean;
  },
): THREE.Group {
  // Prefer Poly Haven GLTF for non-desk props when templates are cached
  if (!isDeskKind(kind)) {
    const asset = tryClonePropAssetSync(kind);
    if (asset) {
      if (meta?.color) tintGroup(asset, meta.color);
      asset.userData.kind = kind;
      asset.userData.propRoot = true;
      return asset;
    }
  }
  if (meta?.lite && isDeskKind(kind)) {
    const g = makeLiteDeskBank(meta.seatCount ?? 1);
    g.userData.kind = kind;
    g.userData.propRoot = true;
    return g;
  }
  let g: THREE.Group;
  const roomH = meta?.height ?? 2.2;
  switch (kind) {
    case "desk":
      g = makeDeskBank(theme, meta?.lit === true, meta?.seatCount ?? 1);
      break;
    case "desk_duo":
      g = makeDeskDuo(theme, meta?.lit === true, meta?.seatCount ?? 2);
      break;
    case "desk_l":
      g = makeDeskL(theme, meta?.lit === true, meta?.seatCount ?? 1);
      break;
    case "desk_bench":
      g = makeDeskBench(theme, meta?.lit === true, meta?.seatCount ?? 2);
      break;
    case "desk_corner":
      g = makeDeskCorner(theme, meta?.lit === true);
      if ((meta?.seatCount ?? 1) > 1) {
        const bank = new THREE.Group();
        const n = Math.min(6, meta!.seatCount!);
        const pitch = L_BANK_PITCH;
        for (let i = 0; i < n; i++) {
          const u = makeDeskCorner(theme, meta?.lit === true);
          u.position.x = -((n - 1) * pitch) / 2 + i * pitch;
          bank.add(u);
        }
        g = bank;
      }
      break;
    case "desk_standing":
      g = makeDeskStanding(theme, meta?.lit === true);
      if ((meta?.seatCount ?? 1) > 1) {
        g = makeDeskBank(theme, meta?.lit === true, meta!.seatCount!);
      }
      break;
    case "desk_compact":
      g = makeDeskCompact(theme, meta?.lit === true);
      if ((meta?.seatCount ?? 1) > 1) {
        g = makeDeskBank(theme, meta?.lit === true, meta!.seatCount!);
      }
      break;
    case "desk_arc":
      g = makeDeskArc(theme, meta?.lit === true, meta?.seatCount ?? 2);
      break;
    case "desk_exec":
      g = makeDeskExec(theme, meta?.lit === true);
      break;
    case "desk_exec_l":
      g = makeDeskExecL(theme, meta?.lit === true);
      break;
    case "desk_exec_arc":
      g = makeDeskExecArc(theme, meta?.lit === true);
      break;
    case "wall":
      g = makeWall(theme, meta?.height ?? 2.4, meta?.length ?? 2.4);
      break;
    case "opening":
      g = makeOpening();
      break;
    case "room_finance":
      g = makeRoomShell(meta?.text ?? "财务室", 0x0f766e, meta?.subtitle, roomH);
      break;
    case "room_sales":
      g = makeRoomShell(meta?.text ?? "销售部", 0x1d4ed8, meta?.subtitle, roomH);
      break;
    case "room_tech":
      g = makeRoomShell(meta?.text ?? "技术部", 0x7c3aed, meta?.subtitle, roomH);
      break;
    case "room_procure":
      g = makeRoomShell(meta?.text ?? "采购部", 0xb45309, meta?.subtitle, roomH);
      break;
    case "room_code":
      g = makeRoomShell(meta?.text ?? "代码部门", 0x334155, meta?.subtitle, roomH);
      break;
    case "chair_exec":
      g = makeChairExec();
      break;
    case "cabinet":
      g = makeCabinet();
      break;
    case "printer":
      g = makePrinter(theme);
      break;
    case "plant":
      g = makePlant();
      break;
    case "plant_large":
      g = makePlantLarge();
      break;
    case "tree":
      g = makeTree();
      break;
    case "bush":
      g = makeBush();
      break;
    case "flower":
      g = makeFlower();
      break;
    case "flower_pot":
      g = makeFlowerPot();
      break;
    case "cooler":
      g = makeCooler();
      break;
    case "coffee":
      g = makeCoffee();
      break;
    case "sofa":
      g = makeSofa(theme);
      break;
    case "sofa_large":
      g = makeSofaLarge(theme);
      break;
    case "sofa_loveseat":
      g = makeSofaLoveseat(theme);
      break;
    case "sofa_corner":
      g = makeSofaCorner(theme);
      break;
    case "coffee_table":
      g = makeCoffeeTable(theme);
      break;
    case "coffee_table_round":
      g = makeCoffeeTableRound(theme);
      break;
    case "coffee_table_glass":
      g = makeCoffeeTableGlass(theme);
      break;
    case "rug":
      g = makeRug(theme);
      break;
    case "door":
      g = makeDoor(theme);
      break;
    case "door_glass":
      g = makeDoorGlass(theme);
      break;
    case "door_double":
      g = makeDoorDouble(theme);
      break;
    case "door_double_glass":
      g = makeDoorDoubleGlass(theme);
      break;
    case "reception_desk":
      g = makeReceptionDesk(theme);
      break;
    case "reception_glass":
      g = makeReceptionGlass(theme);
      break;
    case "reception_split":
      g = makeReceptionSplit(theme);
      break;
    case "reception_arch":
      g = makeReceptionArch(theme);
      break;
    case "reception_minimal":
      g = makeReceptionMinimal(theme);
      break;
    case "reception_marble":
      g = makeReceptionMarble(theme);
      break;
    case "window":
      g = makeWindow(theme);
      break;
    case "window_wide":
      g = makeWindowWide(theme);
      break;
    case "banner":
      g = makeBanner(theme, meta?.text ?? `欢迎来到 ${DEFAULT_COMPANY_NAME}`);
      break;
    case "whiteboard":
      g = makeWhiteboard();
      break;
    case "shelf":
      g = makeShelf(theme);
      break;
    case "water_dispenser":
      g = makeWaterDispenser();
      break;
    case "floor_lamp":
      g = makeFloorLamp(theme);
      break;
    case "partition":
      g = makePartition(theme);
      break;
    default:
      g = new THREE.Group();
      addBox(g, 0.4, 0.4, 0.4, 0xff00ff, 0, 0.2, 0);
  }
  if (meta?.color) tintGroup(g, meta.color);
  g.userData.kind = kind;
  g.userData.propRoot = true;
  return g;
}
