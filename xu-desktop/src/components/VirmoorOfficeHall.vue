<template>
  <div
    ref="hostRef"
    class="hero3d"
    :class="{ 'is-embed': embed, 'is-drag': dragging }"
    title="右键或左键拖动可旋转视角"
  >
    <div v-if="fallback" class="css-hall">
      <div class="css-hall__wall">
        <img class="css-hall__logo" :src="hallLogoSrc" alt="" />
        <span>{{ hallDisplay.mainTitle }}</span>
      </div>
      <div class="css-hall__table" />
      <div v-for="n in 4" :key="'l' + n" class="css-hall__desk is-left" :style="{ top: `${18 + n * 14}%` }">
        <i />
      </div>
      <div v-for="n in 4" :key="'r' + n" class="css-hall__desk is-right" :style="{ top: `${18 + n * 14}%` }">
        <i />
      </div>
    </div>
    <canvas v-show="!fallback" ref="canvasRef" class="hero3d__canvas" />
    <div class="hero3d__hud">
      <span>{{ hallDisplay.hudLabel }}</span>
      <span class="hero3d__pulse">ONLINE</span>
    </div>
    <div v-if="!fallback" class="hero3d__chips">
      <span>{{ hallDisplay.chipAsk }}</span>
      <span>{{ hallDisplay.chipPlan }}</span>
      <span>{{ hallDisplay.chipAgent }}</span>
      <span>{{ hallDisplay.chipApprove }}</span>
    </div>
    <div class="hero3d__bubbles" aria-hidden="true">
      <div
        v-for="row in bubbleRows"
        :key="row.id"
        :ref="(el) => bindBubbleEl(row.id, el)"
        class="hero3d__pop"
        :data-bubble-id="row.id"
      >
        <div class="hero3d__bubble">
          <div class="hero3d__bubble-title">{{ row.title }}</div>
          <div
            class="hero3d__bubble-status"
            :class="row.busy ? 'is-busy' : 'is-idle'"
          >
            {{ row.status }}
          </div>
        </div>
      </div>
    </div>
    <div class="hero3d__zones" aria-hidden="true">
      <div
        v-for="z in zoneLabels"
        :key="z.id"
        :ref="(el) => bindZoneEl(z.id, el)"
        class="hero3d__zone"
        :data-zone-id="z.id"
      >
        {{ z.text }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * @file VirmoorOfficeHall.vue 办公室 3D 大厅（官网 Hero 风格）
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-28
 * @updated 2026-09-02
 * @version 1.2.0
 * @category UI
 * @algo three-orbit
 */
import { computed, markRaw, nextTick, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { drawDeskScreen, drawFoldingScreenBanner, drawHallScreen, drawNightCityWall, loadHallLogoFromConfig, SCREEN_KINDS } from '../office/virmoorHallScreens'
import { hallStrings, employeeBubbleView } from '../office/virmoorHallStrings'
import { HALL_LAYOUT, hallCssToken } from '../office/virmoorHallTheme'
import type { Employee } from '../utils/employees'
import { getLivePatch, subscribeEmployeeLive } from '../employee/events'
import {
  getOfficeLiveStream,
  subscribeOfficeLiveStream,
} from '../employee/officeLiveStream'
import { readOfficeHallDisplay, type OfficeHallDisplay } from '../utils/officeHallDisplay'
import { readOfficeHallLayout } from '../utils/officeHallLayout'
import { deskSlotsForMode, meetingCenterForMode } from '../office/virmoorHallLayouts'
import { clampDeskCount } from '../utils/officeSettings'
import {
  readDeskDecor,
  skinColors,
  type DeskPropId,
} from '../utils/officeDeskDecor'

defineOptions({ name: 'VirmoorOfficeHall' })

const props = withDefaults(defineProps<{ embed?: boolean; employees?: Employee[]; deskCount?: number }>(), { embed: false, employees: () => [], deskCount: 16 })
const embed = computed(() => props.embed)

type BubbleRow = {
  id: number
  title: string
  status: string
  busy: boolean
  x: number
  y: number
  show: boolean
}
type ZoneLabel = { id: string; text: string; wx: number; wy: number; wz: number; x: number; y: number; show: boolean }
type Obs =
  | { kind: 'circle'; x: number; z: number; r: number }
  | { kind: 'box'; cx: number; cz: number; hx: number; hz: number; rotY: number }
type BreakSpot = { x: number; z: number; rotY: number; stance: 'sit' | 'stand' }
type DeskScreen = {
  tex: THREE.CanvasTexture
  kindIdx: number
  nextSwapAt: number
  actorIdx: number
}
type StaffActor = {
  g: THREE.Group
  home: THREE.Vector3
  homeRotY: number
  mode: 'sit' | 'walk' | 'act'
  stance: 'sit' | 'stand'
  nextAt: number
  path: THREE.Vector3[]
  pathI: number
  segFrom: THREE.Vector3
  segTo: THREE.Vector3
  segU: number
  lastLine: string
  prop: THREE.Object3D | null
  walkDist: number
  variant: number
  visit: BreakSpot | null
  /** 走动卡住：上次有效位移时间 */
  lastMoveAt: number
  lastX: number
  lastZ: number
}

const emit = defineEmits<{
  "edit-employee": [Employee]
  "decorate-desk": [number]
}>()
const hostRef = ref<HTMLElement | null>(null)
const canvasRef = ref<HTMLCanvasElement | null>(null)
const fallback = ref(false)
const dragging = ref(false)
const hallDisplay = ref<OfficeHallDisplay>(readOfficeHallDisplay())
const hallLogoSrc = computed(() => hallDisplay.value.logoDataUrl || '/icon.png')
/** 结构变化才触发 Vue；x/y/show 用 DOM 直写，避免每帧响应式 */
const bubbleRows = shallowRef<BubbleRow[]>([])
const zoneLabels = shallowRef<ZoneLabel[]>([])
const bubbleEls = new Map<number, HTMLElement>()
const zoneEls = new Map<string, HTMLElement>()
let cleanup: (() => void) | null = null

let renderer: THREE.WebGLRenderer | null = null
let scene: THREE.Scene | null = null
let camera: THREE.PerspectiveCamera | null = null
let controls: OrbitControls | null = null
let userOrbit = false
let lastInteractAt = 0
let lastFrameMs = 0
const IDLE_SPIN_MS = 5000
/** 完全静止时约 30fps，交互中不跳帧 */
const IDLE_SOFT_MIN_DT = 33
const AUTO_SPIN_SPEED = 0.32
let running = false
let visible = false
let raf = 0
let lastTick = 0
let lastSeatSignature = ''
const staff: THREE.Group[] = []
const actors: StaffActor[] = []
const obstacles: Obs[] = []
const navNodes: THREE.Vector3[] = []
const breakSpots: BreakSpot[] = []
const deskScreens: DeskScreen[] = []
const screens: THREE.MeshStandardMaterial[] = []
let hallBrandTex: THREE.CanvasTexture | null = null
let foldingBannerTex: THREE.CanvasTexture | null = null
let dustPts: THREE.Points | null = null
const trash: THREE.Object3D[] = []
const recentLines: string[] = []
const proj = new THREE.Vector3()
const tmpQ = new THREE.Quaternion()
const tmpE = new THREE.Euler()

function bindBubbleEl(id: number, el: unknown) {
  if (el instanceof HTMLElement) bubbleEls.set(id, el)
  else bubbleEls.delete(id)
}

function bindZoneEl(id: string, el: unknown) {
  if (el instanceof HTMLElement) zoneEls.set(id, el)
  else zoneEls.delete(id)
}

function paintBubbleDom(row: BubbleRow) {
  const el = bubbleEls.get(row.id)
  if (!el) return
  el.style.left = `${row.x}px`
  el.style.top = `${row.y}px`
  el.classList.toggle('is-on', row.show)
  const title = el.querySelector('.hero3d__bubble-title')
  const status = el.querySelector('.hero3d__bubble-status')
  if (title && title.textContent !== row.title) title.textContent = row.title
  if (status) {
    if (status.textContent !== row.status) status.textContent = row.status
    status.classList.toggle('is-busy', row.busy)
    status.classList.toggle('is-idle', !row.busy)
  }
}

function paintZoneDom(z: ZoneLabel) {
  const el = zoneEls.get(z.id)
  if (!el) return
  el.style.left = `${z.x}px`
  el.style.top = `${z.y}px`
  el.classList.toggle('is-on', z.show)
  if (el.textContent !== z.text) el.textContent = z.text
}

function bumpBubbleRows(next: BubbleRow[]) {
  bubbleRows.value = next.map((r) => markRaw(r))
}

function bumpZoneLabels(next: ZoneLabel[]) {
  zoneLabels.value = next.map((z) => markRaw(z))
}

function pushZoneLabel(z: ZoneLabel) {
  zoneLabels.value = [...zoneLabels.value, markRaw(z)]
}


function seatSignature(list: Employee[] | undefined, deskCount: number): string {
  const maxDesk = clampDeskCount(deskCount)
  return (list ?? [])
    .filter((e) => e.deskIndex != null && e.deskIndex >= 0 && e.deskIndex < maxDesk)
    .map((e) => `${e.id}:${e.deskIndex}`)
    .sort()
    .join('|')
}
const WALK_SPEED = 0.85
const BODY_R = 0.36
/** 同时离座走动上限，避免工位空荡 */
const MAX_WALKERS = 0
/** deskIndex → 工位世界坐标（studio 16 工位顺序） */
type DeskSlot = { x: number; z: number; rotY: number; deskIndex: number }
const deskSlots: DeskSlot[] = []
const workstationGroups: THREE.Group[] = []
const actorEmployees = new Map<number, Employee>()
/** 在岗时桌面画面切换间隔 */
const DESK_SCREEN_MS = 10000
/** 圆桌绕行环半径（须大于桌面障碍） */
const TABLE_RING = 4.05

function addBreakSpot(x: number, z: number, rotY: number, stance: 'sit' | 'stand' = 'sit') {
  breakSpots.push({ x, z, rotY, stance })
}

/** 休息区局部坐标 → 世界坐标落点 */
function addBreakSpotLocal(
  lx: number,
  lz: number,
  facing: number,
  stance: 'sit' | 'stand',
  cx: number,
  cz: number,
  rotY: number,
) {
  const c = Math.cos(rotY)
  const s = Math.sin(rotY)
  addBreakSpot(cx + lx * c - lz * s, cz + lx * s + lz * c, facing + rotY, stance)
}

function pickBreakSpot(): BreakSpot | null {
  if (!breakSpots.length) return null
  const occupied = new Set(
    actors
      .filter((a) => a.visit && a.mode !== 'walk')
      .map((a) => `${a.visit!.x.toFixed(2)},${a.visit!.z.toFixed(2)}`),
  )
  const free = breakSpots.filter((s) => !occupied.has(`${s.x.toFixed(2)},${s.z.toFixed(2)}`))
  const pool = free.length ? free : breakSpots
  return pool[Math.floor(Math.random() * pool.length)]
}

function nearestBreak(pos: THREE.Vector3): BreakSpot | null {
  let best: BreakSpot | null = null
  let bestD = 0.85
  breakSpots.forEach((s) => {
    const d = Math.hypot(pos.x - s.x, pos.z - s.z)
    if (d < bestD) {
      bestD = d
      best = s
    }
  })
  return best
}

const PALETTE = [
  { jacket: 0x243044, accent: 0xe0b45a },
  { jacket: 0x1e3a3a, accent: 0x5ee7f0 },
  { jacket: 0x3a2438, accent: 0xf0a0c0 },
  { jacket: 0x2a3420, accent: 0xa8e06a },
  { jacket: 0x2c2a40, accent: 0x9ab6ff },
]

function tableLookAt(): THREE.Vector3 {
  const layout = HALL_LAYOUT
  if (layout === 'studio') return new THREE.Vector3(0, 0.9, 0.2)
  if (layout === 'sheet') return new THREE.Vector3(0, 1, 0.6)
  return new THREE.Vector3(0, 1.05, -1.2)
}

function cssToken(name: string, fallback: string) {
  return hallCssToken(name, fallback)
}

function applyBubbleRow(row: BubbleRow, emp: Employee) {
  const live = getLivePatch(emp.id)
  const view = employeeBubbleView(emp.role, emp.name, emp.status, live?.state)
  row.title = view.title
  const stream =
    getOfficeLiveStream(emp.id).trim() || (live?.message || "").trim()
  if (stream) {
    row.status = stream.length > 40 ? `${stream.slice(0, 37)}…` : stream
    row.busy = true
  } else {
    row.status = view.status
    row.busy = view.busy
  }
  paintBubbleDom(row)
}

function tintActorForEmployee(actor: StaffActor, emp: Employee) {
  const live = getLivePatch(emp.id)
  const busy =
    emp.status === "working" ||
    emp.status === "meeting" ||
    live?.state === "working" ||
    live?.state === "meeting"
  const torso = actor.g.getObjectByName("torso") as THREE.Mesh | undefined
  if (!torso?.material) return
  const mat = torso.material as THREE.MeshStandardMaterial
  if (busy) {
    mat.color.setHex(0x1e4a3a)
    mat.emissive?.setHex(0x14b8a6)
    mat.emissiveIntensity = 0.35
  } else {
    mat.emissiveIntensity = 0
  }
}

function syncEmployeeOverlay() {
  actors.forEach((actor, i) => {
    const emp = actorEmployees.get(i)
    if (!emp) return
    const row = bubbleRows.value[i]
    if (row) applyBubbleRow(row, emp)
    actor.lastLine = row?.title || actor.lastLine
    tintActorForEmployee(actor, emp)
  })
}

function placeEmployeesFromRoster() {
  actorEmployees.clear()
  const maxDesk = clampDeskCount(props.deskCount ?? readOfficeHallLayout().deskCount)
  for (const emp of props.employees ?? []) {
    if (emp.deskIndex == null || emp.deskIndex < 0 || emp.deskIndex >= maxDesk) continue
    const slot = deskSlots.find((s) => s.deskIndex === emp.deskIndex)
    if (!slot) continue
    placeStaffAt(slot.x, slot.z, slot.rotY, emp.deskIndex % PALETTE.length)
    const ai = actors.length - 1
    actorEmployees.set(ai, emp)
    const row = bubbleRows.value[ai]
    if (row) applyBubbleRow(row, emp)
    tintActorForEmployee(actors[ai], emp)
    const dsIdx = deskSlots.findIndex((s) => s.deskIndex === emp.deskIndex)
    if (dsIdx >= 0) deskScreens[dsIdx].actorIdx = ai
  }
}

/** 仅刷新员工落座，不重建场景几何 */
function clearStaffActors() {
  actors.forEach((a) => clearProp(a))
  staff.forEach((g) => {
    scene?.remove(g)
  })
  staff.length = 0
  actors.length = 0
  actorEmployees.clear()
  bubbleEls.clear()
  bumpBubbleRows([])
  deskScreens.forEach((ds) => {
    ds.actorIdx = -1
  })
  placeEmployeesFromRoster()
  if (renderer && scene && camera) renderer.render(scene, camera)
}

function attachDeskProp(group: THREE.Group, propId: DeskPropId) {
  if (propId === 'plant_small') {
    const pot = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.07, 0.08, 8),
      new THREE.MeshStandardMaterial({ color: 0x5a4030, roughness: 0.8 }),
    )
    pot.position.set(-0.75, 0.8, 0.2)
    group.add(pot)
    const leaf = new THREE.Mesh(
      new THREE.SphereGeometry(0.1, 8, 6),
      new THREE.MeshStandardMaterial({ color: 0x3d8f5a, roughness: 0.7 }),
    )
    leaf.position.set(-0.75, 0.95, 0.2)
    group.add(leaf)
    return
  }
  if (propId === 'mug') {
    group.add(makeCup())
    return
  }
  if (propId === 'figurine') {
    const fig = new THREE.Mesh(
      new THREE.CylinderGeometry(0.04, 0.05, 0.14, 8),
      new THREE.MeshStandardMaterial({ color: 0x7c5cff, metalness: 0.3, roughness: 0.4 }),
    )
    fig.position.set(0.55, 0.82, 0.1)
    group.add(fig)
    return
  }
  if (propId === 'lamp_mini') {
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.06, 0.04, 8),
      new THREE.MeshStandardMaterial({ color: 0x2a3140 }),
    )
    base.position.set(-0.55, 0.78, -0.15)
    group.add(base)
    const shade = new THREE.Mesh(
      new THREE.SphereGeometry(0.06, 8, 6),
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(cssToken('--hall-3d-accent', '#e0b45a')),
        emissive: new THREE.Color(cssToken('--hall-3d-accent', '#e0b45a')),
        emissiveIntensity: 0.8,
      }),
    )
    shade.position.set(-0.55, 0.9, -0.15)
    group.add(shade)
  }
}

function pickPhrase(avoid: string[] = []) {
  const roster = props.employees ?? []
  const pool = roster
    .filter((e) => e.deskIndex != null)
    .map((e) => employeeBubbleView(e.role, e.name, e.status, getLivePatch(e.id)?.state).title)
    .filter((p) => p && !avoid.includes(p))
  if (pool.length) return pool[Math.floor(Math.random() * pool.length)]
  return avoid[0] || "虚募阁"
}

function clearProp(actor: StaffActor) {
  if (actor.prop) {
    actor.g.remove(actor.prop)
    actor.prop = null
  }
}

function makeCup(): THREE.Mesh {
  const cup = new THREE.Mesh(
    new THREE.CylinderGeometry(0.045, 0.038, 0.11, 10),
    new THREE.MeshStandardMaterial({ color: 0xf0e6d8, metalness: 0.1, roughness: 0.45 }),
  )
  cup.position.set(0.22, 0.78, 0.16)
  return cup
}

function makeSnack(): THREE.Mesh {
  const snack = new THREE.Mesh(
    new THREE.BoxGeometry(0.12, 0.05, 0.08),
    new THREE.MeshStandardMaterial({ color: 0xd4a574, roughness: 0.7 }),
  )
  snack.position.set(0.24, 0.74, 0.14)
  return snack
}

function addCircleObs(x: number, z: number, r: number) {
  obstacles.push({ kind: 'circle', x, z, r })
}

function addBoxObs(cx: number, cz: number, hx: number, hz: number, rotY: number) {
  obstacles.push({ kind: 'box', cx, cz, hx, hz, rotY })
}

function hitsObstacle(x: number, z: number, radius = BODY_R): boolean {
  if (Math.abs(x) > 15.5 || Math.abs(z) > 11.5) return true
  for (const o of obstacles) {
    if (o.kind === 'circle') {
      const dx = x - o.x
      const dz = z - o.z
      const rr = o.r + radius
      if (dx * dx + dz * dz < rr * rr) return true
    } else {
      const dx = x - o.cx
      const dz = z - o.cz
      const c = Math.cos(-o.rotY)
      const s = Math.sin(-o.rotY)
      const lx = dx * c - dz * s
      const lz = dx * s + dz * c
      if (Math.abs(lx) < o.hx + radius && Math.abs(lz) < o.hz + radius) return true
    }
  }
  return false
}

/** 线段是否切入圆障碍（含身体半径） */
function segmentHitsCircle(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  cx: number,
  cz: number,
  r: number,
): boolean {
  const rr = r + BODY_R
  const abx = bx - ax
  const abz = bz - az
  const acx = cx - ax
  const acz = cz - az
  const ab2 = abx * abx + abz * abz
  let t = ab2 > 1e-8 ? (acx * abx + acz * abz) / ab2 : 0
  t = Math.max(0, Math.min(1, t))
  const px = ax + abx * t
  const pz = az + abz * t
  const dx = px - cx
  const dz = pz - cz
  return dx * dx + dz * dz < rr * rr
}

function segmentHits(ax: number, az: number, bx: number, bz: number): boolean {
  for (const o of obstacles) {
    if (o.kind === 'circle') {
      if (segmentHitsCircle(ax, az, bx, bz, o.x, o.z, o.r)) return true
    }
  }
  const steps = Math.max(6, Math.ceil(Math.hypot(bx - ax, bz - az) / 0.22))
  for (let i = 0; i <= steps; i += 1) {
    const u = i / steps
    if (hitsObstacle(ax + (bx - ax) * u, az + (bz - az) * u)) return true
  }
  return false
}

function pushOut(x: number, z: number): THREE.Vector3 {
  if (!hitsObstacle(x, z)) return new THREE.Vector3(x, 0, z)
  // 优先沿圆桌径向推出
  for (const o of obstacles) {
    if (o.kind !== 'circle') continue
    const dx = x - o.x
    const dz = z - o.z
    const d = Math.hypot(dx, dz) || 0.001
    const need = o.r + BODY_R + 0.12
    if (d < need) {
      return new THREE.Vector3(o.x + (dx / d) * need, 0, o.z + (dz / d) * need)
    }
  }
  for (let r = 0.35; r <= 4.5; r += 0.3) {
    for (let k = 0; k < 16; k += 1) {
      const a = (k / 16) * Math.PI * 2
      const nx = x + Math.cos(a) * r
      const nz = z + Math.sin(a) * r
      if (!hitsObstacle(nx, nz)) return new THREE.Vector3(nx, 0, nz)
    }
  }
  return new THREE.Vector3(x, 0, z)
}

/** 走路时每帧把人挤出障碍，防止穿模 */
function clampWalkPos(x: number, z: number): THREE.Vector3 {
  let px = x
  let pz = z
  for (let n = 0; n < 4; n += 1) {
    if (!hitsObstacle(px, pz)) break
    const out = pushOut(px, pz)
    px = out.x
    pz = out.z
  }
  return new THREE.Vector3(px, 0, pz)
}

function rebuildNav() {
  navNodes.length = 0
  const candidates: Array<[number, number]> = [
    [-5.5, 3.2],
    [5.5, 3.2],
    [-5.5, -4.2],
    [5.5, -4.2],
    [0, 4.4],
    [0, -5],
    [-7.2, 0.2],
    [7.2, 0.2],
    [-3.8, 3.5],
    [3.8, 3.5],
    [-3.8, -3.6],
    [3.8, -3.6],
    [-6.2, 2.2],
    [6.2, 2.2],
    [-2.2, 4.2],
    [2.2, 4.2],
    [-4.8, 1.2],
    [4.8, 1.2],
    [-4.8, -1.6],
    [4.8, -1.6],
  ]
  // 每个圆桌一圈密航点，专供绕行
  for (const o of obstacles) {
    if (o.kind !== 'circle') continue
    for (let i = 0; i < 16; i += 1) {
      const a = (i / 16) * Math.PI * 2
      candidates.push([o.x + Math.sin(a) * TABLE_RING, o.z + Math.cos(a) * TABLE_RING])
    }
  }
  candidates.forEach(([x, z]) => {
    const p = pushOut(x, z)
    if (!hitsObstacle(p.x, p.z, BODY_R + 0.08)) navNodes.push(p)
  })
}

function nearestNavIndex(p: THREE.Vector3): number {
  let best = 0
  let bestD = Infinity
  navNodes.forEach((n, i) => {
    const d = n.distanceToSquared(p)
    if (d < bestD) {
      bestD = d
      best = i
    }
  })
  return best
}

function planPath(from: THREE.Vector3, goal: THREE.Vector3, allowGoalInside = false): THREE.Vector3[] {
  const start = pushOut(from.x, from.z)
  const end = allowGoalInside ? new THREE.Vector3(goal.x, 0, goal.z) : pushOut(goal.x, goal.z)
  if (navNodes.length < 2) {
    return segmentHits(start.x, start.z, end.x, end.z) ? [start, pushOut(end.x, end.z)] : [start, end]
  }

  // 离座先走到桌外环，避免第一步就切进桌面
  const egress: THREE.Vector3[] = []
  for (const o of obstacles) {
    if (o.kind !== 'circle') continue
    const dx = start.x - o.x
    const dz = start.z - o.z
    const d = Math.hypot(dx, dz)
    if (d < o.r + 1.35) {
      const nx = dx / (d || 0.001)
      const nz = dz / (d || 0.001)
      egress.push(new THREE.Vector3(o.x + nx * TABLE_RING, 0, o.z + nz * TABLE_RING))
      break
    }
  }

  const routeStart = egress[0] || start
  if (!segmentHits(routeStart.x, routeStart.z, end.x, end.z)) {
    return egress.length ? [start, ...egress, end] : [start, end]
  }

  const si = nearestNavIndex(routeStart)
  const ei = nearestNavIndex(end)
  const n = navNodes.length
  const adj: number[][] = Array.from({ length: n }, () => [])
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      const a = navNodes[i]
      const b = navNodes[j]
      if (a.distanceToSquared(b) > 55) continue
      if (!segmentHits(a.x, a.z, b.x, b.z)) {
        adj[i].push(j)
        adj[j].push(i)
      }
    }
  }

  const prev = new Int32Array(n).fill(-1)
  const q = [si]
  prev[si] = si
  for (let qi = 0; qi < q.length; qi += 1) {
    const u = q[qi]
    if (u === ei) break
    for (const v of adj[u]) {
      if (prev[v] !== -1) continue
      prev[v] = u
      q.push(v)
    }
  }

  const path: THREE.Vector3[] = [start.clone()]
  egress.forEach((p) => path.push(p.clone()))
  if (prev[ei] === -1) {
    // 无图通：沿桌环绕到终点最近环点
    const ring = nearestNavIndex(end)
    const ringP = navNodes[ring]
    if (!segmentHits(path[path.length - 1].x, path[path.length - 1].z, ringP.x, ringP.z)) {
      path.push(ringP.clone())
    }
    path.push(end.clone())
    return sanitizePath(path, allowGoalInside)
  }

  const chain: number[] = []
  for (let cur = ei; cur !== si; cur = prev[cur]) chain.push(cur)
  chain.push(si)
  chain.reverse()
  chain.forEach((idx) => {
    const p = navNodes[idx]
    const last = path[path.length - 1]
    if (last.distanceToSquared(p) > 0.04) path.push(p.clone())
  })
  const last = path[path.length - 1]
  if (last.distanceToSquared(end) > 0.04) path.push(end.clone())
  return sanitizePath(path, allowGoalInside)
}

function sanitizePath(path: THREE.Vector3[], allowGoalInside: boolean): THREE.Vector3[] {
  const out: THREE.Vector3[] = []
  path.forEach((p, i) => {
    const pt = i === path.length - 1 && allowGoalInside ? p.clone() : pushOut(p.x, p.z)
    if (!out.length || out[out.length - 1].distanceToSquared(pt) > 0.02) out.push(pt)
  })
  // 拆开仍穿障的长边：插入环点
  const fixed: THREE.Vector3[] = [out[0]]
  for (let i = 1; i < out.length; i += 1) {
    const a = fixed[fixed.length - 1]
    const b = out[i]
    if (!segmentHits(a.x, a.z, b.x, b.z)) {
      fixed.push(b)
      continue
    }
    const mid = navNodes[nearestNavIndex(new THREE.Vector3((a.x + b.x) / 2, 0, (a.z + b.z) / 2))]
    if (!segmentHits(a.x, a.z, mid.x, mid.z)) fixed.push(mid.clone())
    if (!segmentHits(fixed[fixed.length - 1].x, fixed[fixed.length - 1].z, b.x, b.z)) {
      fixed.push(b)
    } else {
      fixed.push(pushOut(b.x, b.z))
    }
  }
  return fixed
}

function walkingCount() {
  return actors.reduce((n, a) => n + (a.mode === 'walk' ? 1 : 0), 0)
}

function speak(actor: StaffActor, idx: number) {
  if (actorEmployees.has(idx)) {
    const emp = actorEmployees.get(idx)
    const row = bubbleRows.value[idx]
    if (emp && row) applyBubbleRow(row, emp)
    return
  }
  const line = pickPhrase([actor.lastLine])
  actor.lastLine = line
  const row = bubbleRows.value[idx]
  if (row) {
    row.title = line
    row.status = "休闲中"
    row.busy = false
  }
}

/** 椅面顶高（座垫中心 0.46 + 半厚 0.035） */
const CHAIR_SEAT_TOP = 0.495
/** 坐下时整人上抬，让臀部落在椅面上而不是插进椅垫 */
const SIT_ROOT_Y = 0.06
/** 相对椅心略靠后，贴近靠背 */
const SIT_BACK = 0.11

function applySitPose(g: THREE.Group, sit: boolean) {
  const legL = g.getObjectByName('legL')
  const legR = g.getObjectByName('legR')
  const armL = g.getObjectByName('armL')
  const armR = g.getObjectByName('armR')
  const torso = g.getObjectByName('torso')
  const head = g.getObjectByName('head')
  const hair = g.getObjectByName('hair')
  const visor = g.getObjectByName('visor')
  const collar = g.getObjectByName('collar')
  if (sit) {
    // 髋在椅面上方，大腿近水平朝前，臀部压在椅面上、背贴靠背
    const hipY = CHAIR_SEAT_TOP - SIT_ROOT_Y + 0.02
    if (legL) {
      legL.position.set(-0.09, hipY, 0.04)
      legL.rotation.x = -1.35
    }
    if (legR) {
      legR.position.set(0.09, hipY, 0.04)
      legR.rotation.x = -1.35
    }
    if (armL) {
      armL.position.set(-0.24, hipY + 0.34, 0.06)
      armL.rotation.x = -0.55
    }
    if (armR) {
      armR.position.set(0.24, hipY + 0.34, 0.06)
      armR.rotation.x = -0.5
    }
    if (torso) {
      torso.position.set(0, hipY + 0.22, -0.02)
      torso.rotation.x = -0.08
    }
    if (collar) collar.position.set(0, hipY + 0.42, -0.02)
    if (head) head.position.set(0, hipY + 0.58, -0.02)
    if (hair) hair.position.set(0, hipY + 0.64, -0.04)
    if (visor) visor.position.set(0, hipY + 0.58, 0.1)
    g.position.y = SIT_ROOT_Y
  } else {
    if (legL) {
      legL.position.set(-0.09, 0.38, 0.06)
      legL.rotation.x = 0
    }
    if (legR) {
      legR.position.set(0.09, 0.38, 0.06)
      legR.rotation.x = 0
    }
    if (armL) {
      armL.position.set(-0.24, 0.82, 0.06)
      armL.rotation.x = 0
    }
    if (armR) {
      armR.position.set(0.24, 0.82, 0.06)
      armR.rotation.x = 0
    }
    if (torso) {
      torso.position.set(0, 0.72, 0.06)
      torso.rotation.x = 0
    }
    if (collar) collar.position.set(0, 0.94, 0.06)
    if (head) head.position.set(0, 1.18, 0.06)
    if (hair) hair.position.set(0, 1.24, 0.04)
    if (visor) visor.position.set(0, 1.18, 0.18)
    g.position.y = 0
  }
}

function restPose(actor: StaffActor) {
  const sit = actor.visit ? actor.visit.stance === 'sit' : actor.stance === 'sit'
  applySitPose(actor.g, sit)
}

function applyWalkCycle(g: THREE.Group, phase: number) {
  const legL = g.getObjectByName('legL')
  const legR = g.getObjectByName('legR')
  const armL = g.getObjectByName('armL')
  const armR = g.getObjectByName('armR')
  const swing = Math.sin(phase) * 0.55
  if (legL) legL.rotation.x = swing
  if (legR) legR.rotation.x = -swing
  if (armL) armL.rotation.x = -swing * 0.7
  if (armR) armR.rotation.x = swing * 0.7
}

function startSeg(actor: StaffActor) {
  const a = actor.path[actor.pathI]
  const b = actor.path[actor.pathI + 1]
  if (!a || !b) return false
  let from = a.clone()
  let to = b.clone()
  if (segmentHits(from.x, from.z, to.x, to.z)) {
    const mid = navNodes[nearestNavIndex(new THREE.Vector3((from.x + to.x) / 2, 0, (from.z + to.z) / 2))]
    if (mid && !segmentHits(from.x, from.z, mid.x, mid.z)) {
      actor.path.splice(actor.pathI + 1, 0, mid.clone())
      to = mid.clone()
    } else {
      to = pushOut(to.x, to.z)
      from = pushOut(from.x, from.z)
    }
  }
  actor.segFrom.copy(from)
  actor.segTo.copy(to)
  actor.segU = 0
  return true
}

function forceSitHome(actor: StaffActor, idx: number, now: number) {
  clearProp(actor)
  actor.visit = null
  actor.mode = 'sit'
  actor.path = []
  actor.pathI = 0
  restPose(actor)
  actor.g.position.copy(actor.home)
  actor.g.rotation.y = actor.homeRotY
  actor.nextAt = now + 2800 + Math.random() * 3200
  actor.lastMoveAt = now
  actor.lastX = actor.home.x
  actor.lastZ = actor.home.z
  speak(actor, idx)
}

function beginWalk(actor: StaffActor, idx: number, now: number) {
  clearProp(actor)
  applySitPose(actor.g, false)
  actor.visit = null
  // 多数去圆桌/茶水间/休息区，少数闲逛
  const spot = Math.random() < 0.78 ? pickBreakSpot() : null
  const goal = spot
    ? new THREE.Vector3(spot.x, 0, spot.z)
    : navNodes[Math.floor(Math.random() * Math.max(navNodes.length, 1))] || actor.home.clone()
  if (spot) actor.visit = spot
  actor.path = planPath(actor.g.position, goal)
  if (actor.path.length < 2) {
    forceSitHome(actor, idx, now)
    return
  }
  actor.mode = 'walk'
  actor.pathI = 0
  actor.walkDist = 0
  actor.lastMoveAt = now
  actor.lastX = actor.g.position.x
  actor.lastZ = actor.g.position.z
  if (!startSeg(actor)) {
    forceSitHome(actor, idx, now)
    return
  }
  actor.nextAt = now + 22000
  speak(actor, idx)
}

function lingerAtBreak(actor: StaffActor, idx: number, now: number, spot: BreakSpot) {
  clearProp(actor)
  actor.visit = spot
  actor.mode = 'act'
  actor.g.position.set(spot.x, 0, spot.z)
  actor.g.rotation.y = spot.rotY
  restPose(actor)
  if (Math.random() < 0.55) {
    const cup = makeCup()
    actor.g.add(cup)
    actor.prop = cup
  }
  actor.nextAt = now + 5500 + Math.random() * 4500
  speak(actor, idx)
}

function beginAction(actor: StaffActor, idx: number, now: number) {
  clearProp(actor)
  // 休息区/茶水间/圆桌滞留结束后先回工位，不继续满场闲逛
  if (actor.visit || actor.g.position.distanceTo(actor.home) > 0.55) {
    actor.visit = null
    applySitPose(actor.g, false)
    finishWalkHome(actor, idx, now)
    return
  }
  const roll = Math.random()
  const canWalk = walkingCount() < MAX_WALKERS && navNodes.length > 2
  // 多数留在工位，偶尔离席喝茶/休息
  if (roll < 0.16 && canWalk) {
    beginWalk(actor, idx, now)
  } else if (roll < 0.42) {
    actor.mode = 'act'
    restPose(actor)
    actor.g.position.copy(actor.home)
    actor.g.rotation.y = actor.homeRotY
    const cup = makeCup()
    actor.g.add(cup)
    actor.prop = cup
    actor.nextAt = now + 3200 + Math.random() * 1800
    speak(actor, idx)
  } else if (roll < 0.62) {
    actor.mode = 'act'
    restPose(actor)
    actor.g.position.copy(actor.home)
    actor.g.rotation.y = actor.homeRotY
    const snack = makeSnack()
    actor.g.add(snack)
    actor.prop = snack
    actor.nextAt = now + 3400 + Math.random() * 2000
    speak(actor, idx)
  } else {
    actor.mode = 'sit'
    restPose(actor)
    actor.g.position.copy(actor.home)
    actor.g.rotation.y = actor.homeRotY
    actor.nextAt = now + 4200 + Math.random() * 5200
    speak(actor, idx)
  }
}

function finishWalkHome(actor: StaffActor, idx: number, now: number) {
  actor.path = planPath(actor.g.position, actor.home, true)
  if (actor.path.length < 2) {
    forceSitHome(actor, idx, now)
    return
  }
  actor.mode = 'walk'
  actor.pathI = 0
  actor.walkDist = 0
  actor.lastMoveAt = now
  actor.lastX = actor.g.position.x
  actor.lastZ = actor.g.position.z
  if (!startSeg(actor)) {
    forceSitHome(actor, idx, now)
    return
  }
  actor.nextAt = now + 22000
}

function tickActors(now: number, t0: number, dt: number) {
  actors.forEach((actor, i) => {
    if (now >= actor.nextAt && actor.mode !== 'walk') {
      beginAction(actor, i, now)
    }
    if (actor.mode === 'walk') {
      // 超时或位移停滞 → 回工位，避免卡在桌角
      if (now >= actor.nextAt) {
        forceSitHome(actor, i, now)
        return
      }
      const moved =
        Math.abs(actor.g.position.x - actor.lastX) + Math.abs(actor.g.position.z - actor.lastZ)
      if (moved > 0.04) {
        actor.lastMoveAt = now
        actor.lastX = actor.g.position.x
        actor.lastZ = actor.g.position.z
      } else if (now - actor.lastMoveAt > 2800) {
        forceSitHome(actor, i, now)
        return
      }
      const dist = Math.max(actor.segFrom.distanceTo(actor.segTo), 0.05)
      // 近零长度段：跳过，避免原地踏步
      if (dist < 0.08) {
        actor.pathI += 1
        if (actor.pathI >= actor.path.length - 1) {
          forceSitHome(actor, i, now)
        } else if (!startSeg(actor)) {
          forceSitHome(actor, i, now)
        }
        return
      }
      actor.segU = Math.min(1, actor.segU + (WALK_SPEED * dt) / dist)
      const u = actor.segU
      actor.g.position.lerpVectors(actor.segFrom, actor.segTo, u)
      const clamped = clampWalkPos(actor.g.position.x, actor.g.position.z)
      actor.g.position.x = clamped.x
      actor.g.position.z = clamped.z
      actor.g.position.y = 0
      const dx = actor.segTo.x - actor.segFrom.x
      const dz = actor.segTo.z - actor.segFrom.z
      if (Math.abs(dx) + Math.abs(dz) > 0.02) actor.g.rotation.y = Math.atan2(dx, dz)
      actor.walkDist += WALK_SPEED * dt
      applyWalkCycle(actor.g, actor.walkDist * 5.2)
      if (u >= 1) {
        actor.pathI += 1
        if (actor.pathI >= actor.path.length - 1) {
          const atHome = actor.g.position.distanceTo(actor.home) < 0.45
          const spot = actor.visit || nearestBreak(actor.g.position)
          if (atHome) {
            forceSitHome(actor, i, now)
          } else if (spot && actor.g.position.distanceTo(new THREE.Vector3(spot.x, 0, spot.z)) < 0.55) {
            lingerAtBreak(actor, i, now, spot)
          } else {
            finishWalkHome(actor, i, now)
          }
        } else if (!startSeg(actor)) {
          forceSitHome(actor, i, now)
        }
      }
    } else {
      restPose(actor)
      const head = actor.g.getObjectByName('head')
      if (head) head.rotation.y = Math.sin(t0 * 0.55 + i) * 0.18
      if (actor.prop) {
        actor.prop.rotation.z = Math.sin(t0 * 2 + i) * 0.1
      }
    }
  })
}

function registerActor(person: THREE.Group, stance: 'sit' | 'stand' = 'sit') {
  if (!scene) return
  scene.updateMatrixWorld(true)
  const home = new THREE.Vector3()
  person.getWorldPosition(home)
  home.y = 0
  person.getWorldQuaternion(tmpQ)
  tmpE.setFromQuaternion(tmpQ, 'YXZ')
  const homeRotY = tmpE.y
  if (person.parent && person.parent !== scene) {
    person.removeFromParent()
    scene.add(person)
    trash.push(person)
  }
  person.position.copy(home)
  person.rotation.set(0, homeRotY, 0)
  applySitPose(person, stance === 'sit')
  staff.push(person)
  const idx = actors.length
  const line = pickPhrase()
  actors.push({
    g: person,
    home: home.clone(),
    homeRotY,
    mode: 'sit',
    stance,
    nextAt: performance.now() + 900 + idx * 650,
    path: [],
    pathI: 0,
    segFrom: home.clone(),
    segTo: home.clone(),
    segU: 1,
    lastLine: line,
    prop: null,
    walkDist: 0,
    variant: idx % PALETTE.length,
    visit: null,
    lastMoveAt: performance.now(),
    lastX: home.x,
    lastZ: home.z,
  })
  bubbleRows.value = [
    ...bubbleRows.value,
    markRaw({
      id: 100 + idx,
      title: line,
      status: "休闲中",
      busy: false,
      x: 0,
      y: 0,
      show: false,
    }),
  ]
}

function makeChair(): THREE.Group {
  const g = new THREE.Group()
  const chairMat = new THREE.MeshStandardMaterial({ color: 0x151c28, metalness: 0.35, roughness: 0.55 })
  // 面朝 +Z：椅面略前，靠背在 -Z
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.07, 0.46), chairMat)
  seat.position.set(0, 0.46, 0.02)
  g.add(seat)
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.56, 0.07), chairMat)
  back.position.set(0, 0.76, -0.24)
  g.add(back)
  ;[-0.18, 0.18].forEach((dx) => {
    const legB = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.44, 0.05), chairMat)
    legB.position.set(dx, 0.22, -0.16)
    g.add(legB)
    const legF = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.44, 0.05), chairMat)
    legF.position.set(dx, 0.22, 0.16)
    g.add(legF)
  })
  return g
}

/** 卡通员工：大头、四肢可摆，椅子另放不随人走。 */
function makeStaffBody(variant = 0): THREE.Group {
  const g = new THREE.Group()
  const pal = PALETTE[variant % PALETTE.length]
  const skin = new THREE.MeshStandardMaterial({ color: 0xc9d0dc, metalness: 0.12, roughness: 0.48 })
  const jacket = new THREE.MeshStandardMaterial({ color: pal.jacket, metalness: 0.28, roughness: 0.5 })
  const pant = new THREE.MeshStandardMaterial({ color: 0x121820, metalness: 0.25, roughness: 0.55 })
  const accent = new THREE.MeshStandardMaterial({
    color: pal.accent,
    emissive: pal.accent,
    emissiveIntensity: 0.35,
    metalness: 0.2,
    roughness: 0.45,
  })

  const legL = new THREE.Group()
  legL.name = 'legL'
  legL.position.set(-0.09, 0.38, 0.06)
  const legLMesh = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.36, 0.12), pant)
  legLMesh.position.y = -0.16
  legL.add(legLMesh)
  const shoeL = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.06, 0.18), pant)
  shoeL.position.set(0, -0.36, 0.02)
  legL.add(shoeL)
  g.add(legL)

  const legR = new THREE.Group()
  legR.name = 'legR'
  legR.position.set(0.09, 0.38, 0.06)
  const legRMesh = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.36, 0.12), pant)
  legRMesh.position.y = -0.16
  legR.add(legRMesh)
  const shoeR = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.06, 0.18), pant)
  shoeR.position.set(0, -0.36, 0.02)
  legR.add(shoeR)
  g.add(legR)

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.4, 0.22), jacket)
  torso.position.set(0, 0.72, 0.06)
  torso.name = 'torso'
  g.add(torso)
  const collar = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.05, 0.18), new THREE.MeshStandardMaterial({ color: 0xefe8dc }))
  collar.position.set(0, 0.94, 0.06)
  collar.name = 'collar'
  g.add(collar)
  const badge = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 0.02), accent)
  badge.position.set(0.12, 0.78, 0.18)
  g.add(badge)

  const armL = new THREE.Group()
  armL.name = 'armL'
  armL.position.set(-0.24, 0.82, 0.06)
  const armLMesh = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.32, 0.1), jacket)
  armLMesh.position.y = -0.14
  armL.add(armLMesh)
  const handL = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.09), skin)
  handL.position.y = -0.32
  armL.add(handL)
  g.add(armL)

  const armR = new THREE.Group()
  armR.name = 'armR'
  armR.position.set(0.24, 0.82, 0.06)
  const armRMesh = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.32, 0.1), jacket)
  armRMesh.position.y = -0.14
  armR.add(armRMesh)
  const handR = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.09), skin)
  handR.position.y = -0.32
  armR.add(handR)
  g.add(armR)

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 14, 12), skin)
  head.position.set(0, 1.18, 0.06)
  head.name = 'head'
  g.add(head)
  const hair = new THREE.Mesh(
    new THREE.SphereGeometry(0.17, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.55),
    new THREE.MeshStandardMaterial({ color: 0x1a2030, roughness: 0.7 }),
  )
  hair.position.set(0, 1.24, 0.04)
  hair.name = 'hair'
  g.add(hair)
  const visor = new THREE.Mesh(
    new THREE.BoxGeometry(0.22, 0.05, 0.05),
    new THREE.MeshStandardMaterial({ color: 0x8ef6ff, emissive: 0x1ad6e0, emissiveIntensity: 0.9 }),
  )
  visor.position.set(0, 1.18, 0.18)
  visor.name = 'visor'
  g.add(visor)
  return g
}

function placeStaffAt(x: number, z: number, rotY: number, variant: number) {
  // (x,z) = 椅心；人坐在椅面上并靠后贴靠背
  const chair = makeChair()
  chair.position.set(x, 0, z)
  chair.rotation.y = rotY
  add(chair)
  const person = makeStaffBody(variant)
  // 朝 -Z（身后）挪一点，背靠椅背；坐下后再抬到椅面
  person.position.set(x - Math.sin(rotY) * SIT_BACK, 0, z - Math.cos(rotY) * SIT_BACK)
  person.rotation.y = rotY
  add(person)
  registerActor(person)
}

function addRoundTable(cx: number, cz: number) {
  // 会议区圆桌：桌面 2.35；每座纸笔；空椅可落座
  addCircleObs(cx, cz, 2.55)
  const wood = new THREE.MeshBasicMaterial({ color: 0xc4843a })
  const rim = new THREE.MeshStandardMaterial({
    color: new THREE.Color(cssToken('--hall-3d-accent', '#e0b45a')),
    metalness: 0.45,
    roughness: 0.28,
    emissive: new THREE.Color(cssToken('--hall-3d-accent', '#e0b45a')),
    emissiveIntensity: 1.1,
  })
  const top = new THREE.Mesh(new THREE.CylinderGeometry(2.35, 2.35, 0.12, 40), wood)
  top.position.set(cx, 0.78, cz)
  add(top)
  const ring = new THREE.Mesh(new THREE.TorusGeometry(2.32, 0.07, 12, 48), rim)
  ring.rotation.x = Math.PI / 2
  ring.position.set(cx, 0.86, cz)
  add(ring)
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.58, 0.72, 16), wood)
  base.position.set(cx, 0.36, cz)
  add(base)
  const pad = new THREE.Mesh(
    new THREE.BoxGeometry(0.55, 0.03, 0.4),
    new THREE.MeshStandardMaterial({ color: 0xc9b896, roughness: 0.7 }),
  )
  pad.position.set(cx, 0.86, cz)
  add(pad)
  const paperMat = new THREE.MeshStandardMaterial({ color: 0xf4f0e6, roughness: 0.85 })
  const penMat = new THREE.MeshStandardMaterial({
    color: 0x1a2030,
    metalness: 0.35,
    roughness: 0.4,
  })
  const penTip = new THREE.MeshStandardMaterial({
    color: new THREE.Color(cssToken('--hall-3d-accent', '#e0b45a')),
    metalness: 0.5,
    roughness: 0.35,
  })
  for (let i = 0; i < 6; i += 1) {
    const a = (i / 6) * Math.PI * 2 + 0.2
    const seatR = 2.98
    const sx = cx + Math.sin(a) * seatR
    const sz = cz + Math.cos(a) * seatR
    const faceY = Math.atan2(cx - sx, cz - sz)
    const chair = makeChair()
    chair.position.set(sx, 0, sz)
    chair.rotation.y = faceY
    add(chair)
    addBreakSpot(sx - Math.sin(faceY) * SIT_BACK, sz - Math.cos(faceY) * SIT_BACK, faceY, 'sit')
    // 桌沿靠每位：纸 + 笔（会议区）
    const paperR = 1.72
    const px = cx + Math.sin(a) * paperR
    const pz = cz + Math.cos(a) * paperR
    const paper = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.012, 0.36), paperMat)
    paper.position.set(px, 0.86, pz)
    paper.rotation.y = faceY
    add(paper)
    const pen = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.22, 8), penMat)
    pen.rotation.z = Math.PI / 2
    pen.rotation.y = faceY + 0.35
    pen.position.set(
      px + Math.sin(faceY + Math.PI / 2) * 0.14,
      0.875,
      pz + Math.cos(faceY + Math.PI / 2) * 0.14,
    )
    add(pen)
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.014, 0.04, 6), penTip)
    tip.rotation.z = -Math.PI / 2
    tip.rotation.y = faceY + 0.35
    tip.position.set(
      pen.position.x + Math.sin(faceY + 0.35) * 0.12,
      0.875,
      pen.position.z + Math.cos(faceY + 0.35) * 0.12,
    )
    add(tip)
  }
  pushZoneLabel({
    id: 'meeting',
    text: hallStrings.zoneMeeting,
    wx: cx,
    wy: 2.15,
    wz: cz,
    x: 0,
    y: 0,
    show: false,
  })
}

function addWorkstation(x: number, z: number, rotY: number, kindIndex: number) {
  addBoxObs(x, z, 1.15, 0.62, rotY)
  const decor = readDeskDecor(kindIndex)
  const colors = skinColors(decor.skinId)
  const g = new THREE.Group()
  g.position.set(x, 0, z)
  g.rotation.y = rotY
  g.userData.deskIndex = kindIndex
  const deskMat = new THREE.MeshBasicMaterial({ color: colors.desk })
  const legMat = new THREE.MeshBasicMaterial({ color: colors.leg })
  const desk = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.1, 1.2), deskMat)
  desk.position.set(0, 0.72, 0)
  g.add(desk)
  ;[-0.9, 0.9].forEach((dx) => {
    ;[-0.45, 0.45].forEach((dz) => {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.68, 0.08), legMat)
      leg.position.set(dx, 0.34, dz)
      g.add(leg)
    })
  })
  const kb = new THREE.Mesh(
    new THREE.BoxGeometry(0.72, 0.04, 0.28),
    new THREE.MeshStandardMaterial({ color: 0x2a3140, metalness: 0.3, roughness: 0.5 }),
  )
  kb.position.set(0, 0.8, 0.18)
  g.add(kb)
  const neck = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.28, 0.08), legMat)
  neck.position.set(0, 0.96, -0.36)
  g.add(neck)
  const bezel = new THREE.Mesh(
    new THREE.BoxGeometry(1.62, 1.02, 0.08),
    new THREE.MeshStandardMaterial({ color: 0x0a0c10, metalness: 0.4, roughness: 0.4 }),
  )
  bezel.position.set(0, 1.36, -0.38)
  g.add(bezel)
  const kindIdx = kindIndex % SCREEN_KINDS.length
  const tex = new THREE.CanvasTexture(drawDeskScreen(SCREEN_KINDS[kindIdx]))
  tex.colorSpace = THREE.SRGBColorSpace
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.48, 0.9), new THREE.MeshBasicMaterial({ map: tex }))
  screen.position.set(0, 1.36, -0.336)
  g.add(screen)
  const lamp = new THREE.Mesh(
    new THREE.SphereGeometry(0.07, 10, 8),
    new THREE.MeshStandardMaterial({
      color: new THREE.Color(cssToken('--hall-3d-accent', '#e0b45a')),
      emissive: new THREE.Color(cssToken('--hall-3d-accent', '#e0b45a')),
      emissiveIntensity: 1.6,
    }),
  )
  lamp.position.set(0.82, 1.12, -0.1)
  g.add(lamp)
  decor.props.forEach((p) => attachDeskProp(g, p))
  add(g)
  workstationGroups[kindIndex] = g

  const seatLocal = new THREE.Vector3(0, 0, 0.78)
  seatLocal.applyAxisAngle(new THREE.Vector3(0, 1, 0), rotY)
  deskSlots.push({
    x: x + seatLocal.x,
    z: z + seatLocal.z,
    rotY: rotY + Math.PI,
    deskIndex: kindIndex,
  })
  deskScreens.push({
    tex,
    kindIdx,
    nextSwapAt: performance.now() + 2500 + kindIndex * 550,
    actorIdx: -1,
  })
}

function staffAtDesk(actor: StaffActor) {
  return !actor.visit && actor.mode !== 'walk' && actor.g.position.distanceTo(actor.home) < 0.55
}

/** 在岗换屏；离席冻结当前画面 */
function tickDeskScreens(now: number) {
  deskScreens.forEach((ds) => {
    const actor = actors[ds.actorIdx]
    if (!actor || !staffAtDesk(actor)) return
    if (now < ds.nextSwapAt) return
    let next = (ds.kindIdx + 1 + Math.floor(Math.random() * (SCREEN_KINDS.length - 1))) % SCREEN_KINDS.length
    if (next === ds.kindIdx) next = (ds.kindIdx + 1) % SCREEN_KINDS.length
    ds.kindIdx = next
    const canvas = drawDeskScreen(SCREEN_KINDS[ds.kindIdx])
    ds.tex.image = canvas
    ds.tex.needsUpdate = true
    ds.nextSwapAt = now + DESK_SCREEN_MS
  })
}

/** 侧墙进出门（左墙，不开在落地窗上） */
function addOfficeDoor() {
  const frameMat = new THREE.MeshStandardMaterial({
    color: 0x2a3140,
    metalness: 0.35,
    roughness: 0.45,
  })
  const doorMat = new THREE.MeshStandardMaterial({
    color: 0xc9a66a,
    metalness: 0.2,
    roughness: 0.55,
    emissive: new THREE.Color(cssToken('--hall-3d-accent', '#e0b45a')),
    emissiveIntensity: 0.15,
  })
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x88c8e8,
    metalness: 0.1,
    roughness: 0.15,
    transparent: true,
    opacity: 0.45,
  })
  const doorW = 1.15
  const doorH = 2.55
  // 左墙内侧门口：前台贴门，勿放大厅中央
  // 门内右侧（进门朝 +X 时右为 -Z）约两工位
  const doorZ = -6.5
  const deskX = -14.5
  const g = new THREE.Group()
  g.position.set(-17.15, 0, doorZ)
  g.rotation.y = -Math.PI / 2
  add(g)
  trash.push(g)

  // 障碍：门框两侧（世界坐标）
  addBoxObs(-16.6, doorZ - doorW - 0.2, 0.45, 0.4, 0)
  addBoxObs(-16.6, doorZ + doorW + 0.2, 0.45, 0.4, 0)

  const lintel = new THREE.Mesh(new THREE.BoxGeometry(doorW * 2 + 0.5, 0.18, 0.22), frameMat)
  lintel.position.set(0, doorH + 0.12, 0)
  g.add(lintel)
  ;[-1, 1].forEach((side) => {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.16, doorH + 0.2, 0.22), frameMat)
    post.position.set(side * (doorW + 0.08), doorH / 2, 0)
    g.add(post)
  })

  const open = 0.38
  ;[
    { x: -doorW / 2, rot: open },
    { x: doorW / 2, rot: -open },
  ].forEach((d) => {
    const leaf = new THREE.Group()
    leaf.position.set(d.x, 0, -0.04)
    leaf.rotation.y = d.rot
    const side = Math.sign(d.x || -1)
    const panel = new THREE.Mesh(new THREE.BoxGeometry(doorW - 0.06, doorH, 0.08), doorMat)
    panel.position.set(side * ((doorW - 0.06) / 2), doorH / 2, 0)
    leaf.add(panel)
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(doorW * 0.45, doorH * 0.55), glassMat)
    glass.position.set(side * ((doorW - 0.06) / 2), doorH * 0.58, 0.05)
    leaf.add(glass)
    const knob = new THREE.Mesh(
      new THREE.SphereGeometry(0.05, 10, 8),
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(cssToken('--hall-3d-accent', '#e0b45a')),
        metalness: 0.7,
        roughness: 0.25,
      }),
    )
    knob.position.set(side * 0.18, doorH * 0.48, 0.08)
    leaf.add(knob)
    g.add(leaf)
  })

  // 室内地垫（组局部 -Z → 世界 +X）
  const mat = new THREE.Mesh(
    new THREE.BoxGeometry(2.4, 0.04, 0.9),
    new THREE.MeshStandardMaterial({ color: 0x3a2a1c, roughness: 0.9 }),
  )
  mat.position.set(0, 0.03, -0.7)
  g.add(mat)

  addReceptionDesk(deskX, doorZ)
  addFoldingScreen(deskX, doorZ)
}

/** 门口前台：横过来（长边平行左墙）+ 立牌 */
function addReceptionDesk(cx: number, cz: number) {
  const rotY = Math.PI / 2
  addBoxObs(cx, cz, 0.55, 1.1, rotY)
  const wood = new THREE.MeshStandardMaterial({ color: 0x6e5638, roughness: 0.55 })
  const dark = new THREE.MeshStandardMaterial({ color: 0x2a3140, roughness: 0.5, metalness: 0.25 })
  const g = new THREE.Group()
  g.position.set(cx, 0, cz)
  g.rotation.y = rotY
  add(g)
  trash.push(g)

  const desk = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.12, 0.75), wood)
  desk.position.set(0, 1.05, 0)
  g.add(desk)
  const base = new THREE.Mesh(new THREE.BoxGeometry(2.05, 0.95, 0.65), wood)
  base.position.set(0, 0.48, 0)
  g.add(base)
  // 立牌朝向入口（组局部 -Z → 世界 -X，面向左墙门）
  const panel = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.55, 0.05), dark)
  panel.position.set(0, 1.45, -0.42)
  g.add(panel)
  const logo = new THREE.Mesh(
    new THREE.PlaneGeometry(0.42, 0.42),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(cssToken('--hall-3d-accent', '#e0b45a')) }),
  )
  logo.position.set(0, 1.52, -0.45)
  g.add(logo)
  pushZoneLabel({
    id: 'front',
    text: hallStrings.zoneFront,
    wx: cx,
    wy: 2.15,
    wz: cz,
    x: 0,
    y: 0,
    show: false,
  })
}

/** 前台背后屏风：加宽一倍；标语贴在 ±X 大面（相机所见的宽面） */
function addFoldingScreen(deskX: number, cz: number) {
  const sx = deskX + 1.35
  const halfW = 2.35
  const panelZ = halfW * 2
  addBoxObs(sx, cz, 0.12, halfW + 0.15, 0)
  const frame = new THREE.MeshStandardMaterial({ color: 0x5a4630, roughness: 0.6 })
  const edge = new THREE.MeshStandardMaterial({ color: 0xc4b39a, roughness: 0.85 })
  const g = new THREE.Group()
  g.position.set(sx, 0, cz)
  add(g)
  trash.push(g)

  const bannerTex = new THREE.CanvasTexture(drawFoldingScreenBanner(hallDisplay.value))
  foldingBannerTex = bannerTex
  bannerTex.colorSpace = THREE.SRGBColorSpace
  bannerTex.anisotropy = 8
  bannerTex.needsUpdate = true
  const bannerMat = new THREE.MeshBasicMaterial({
    map: bannerTex,
    toneMapped: false,
    side: THREE.FrontSide,
  })
  // Box 材质序：+X -X +Y -Y +Z -Z；±X 才是宽×高的大面
  const panel = new THREE.Mesh(new THREE.BoxGeometry(0.08, 2.05, panelZ), [
    bannerMat,
    bannerMat,
    frame,
    frame,
    edge,
    edge,
  ])
  panel.position.set(0, 1.05, 0)
  g.add(panel)

  ;[-1, 1].forEach((side) => {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.15, 0.12), frame)
    post.position.set(0, 1.08, side * halfW)
    g.add(post)
  })
  const rail = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.1, panelZ + 0.12), frame)
  rail.position.set(0, 2.12, 0)
  g.add(rail)
}

/** 茶台：吧台 + 咖啡机（不含饮水器，避免与茶台重合） */
function addTeaBar(cx: number, cz: number, rotY = 0) {
  const root = new THREE.Group()
  root.position.set(cx, 0, cz)
  root.rotation.y = rotY
  const put = (obj: THREE.Object3D) => {
    root.add(obj)
  }

  addBoxObs(cx, cz, 1.1, 0.55, rotY)
  const wood = new THREE.MeshStandardMaterial({ color: 0x8a7355, roughness: 0.65 })
  const metal = new THREE.MeshStandardMaterial({ color: 0xb8c0cc, metalness: 0.55, roughness: 0.35 })
  const counter = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.12, 0.85), wood)
  counter.position.set(0, 0.92, 0)
  put(counter)
  const base = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.8, 0.7), wood)
  base.position.set(0, 0.4, 0)
  put(base)
  const machine = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.55, 0.4), metal)
  machine.position.set(0.55, 1.22, 0.05)
  put(machine)
  ;[-0.35, 0.35].forEach((dx, i) => {
    const cup = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.04, 0.1, 8),
      new THREE.MeshStandardMaterial({ color: i === 0 ? 0xf0e6d8 : 0xe8d4b8 }),
    )
    cup.position.set(dx, 1.02, 0.22)
    put(cup)
  })
  const plantStem = new THREE.Mesh(
    new THREE.CylinderGeometry(0.04, 0.05, 0.5, 6),
    new THREE.MeshStandardMaterial({ color: 0x4a3a28 }),
  )
  plantStem.position.set(-0.75, 0.35, 0.55)
  put(plantStem)
  const leaf = new THREE.Mesh(
    new THREE.SphereGeometry(0.22, 10, 8),
    new THREE.MeshStandardMaterial({ color: 0x3d8a55, roughness: 0.7 }),
  )
  leaf.position.set(-0.75, 0.72, 0.55)
  put(leaf)
  add(root)
  pushZoneLabel({
    id: 'tea',
    text: hallStrings.zoneTea,
    wx: cx,
    wy: 2.05,
    wz: cz,
    x: 0,
    y: 0,
    show: false,
  })
}

/** 饮水器：独立摆放，与茶台沿墙间隔开 */
function addWaterCooler(cx: number, cz: number, rotY = 0) {
  const root = new THREE.Group()
  root.position.set(cx, 0, cz)
  root.rotation.y = rotY
  const put = (obj: THREE.Object3D) => {
    root.add(obj)
  }

  addBoxObs(cx, cz, 0.42, 0.42, rotY)
  const metal = new THREE.MeshStandardMaterial({ color: 0xb8c0cc, metalness: 0.55, roughness: 0.35 })
  const cooler = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 1.1, 12), metal)
  cooler.position.set(0, 0.55, 0.22)
  put(cooler)
  const jug = new THREE.Mesh(
    new THREE.SphereGeometry(0.2, 12, 10),
    new THREE.MeshStandardMaterial({ color: 0x7ec8e8, transparent: true, opacity: 0.75 }),
  )
  jug.position.set(0, 1.25, 0.22)
  put(jug)
  const tray = new THREE.Mesh(
    new THREE.BoxGeometry(0.55, 0.06, 0.45),
    new THREE.MeshStandardMaterial({ color: 0x8a7355, roughness: 0.7 }),
  )
  tray.position.set(0, 0.08, 0.28)
  put(tray)
  add(root)
}

/** 左墙休憩带：休息 + 茶台 + 饮水器沿墙成组（远离门口前台） */
function addLeftWallBreakCluster(enable: { tea?: boolean; lounge?: boolean }) {
  const wallX = -15.85
  const faceIn = Math.PI / 2
  const alongZ = { lounge: -2.4, teaBar: 1.2, water: 4.8 }
  if (enable.lounge) addLounge(wallX, alongZ.lounge, faceIn)
  if (enable.tea) {
    addTeaBar(wallX, alongZ.teaBar, faceIn)
    addWaterCooler(wallX, alongZ.water, faceIn)
    addBreakSpotLocal(0, 1.2, Math.PI, 'stand', wallX, alongZ.teaBar, faceIn)
    addBreakSpotLocal(0, 1.1, Math.PI, 'stand', wallX, alongZ.water, faceIn)
  }
}

/** 休息区：沙发 + 茶几；可贴左/右墙旋转摆放 */
function addLounge(cx: number, cz: number, rotY = 0) {
  const root = new THREE.Group()
  root.position.set(cx, 0, cz)
  root.rotation.y = rotY
  const put = (obj: THREE.Object3D) => {
    root.add(obj)
  }

  addBoxObs(cx, cz, 1.7, 1.1, rotY)
  const fabric = new THREE.MeshStandardMaterial({ color: 0x2a3548, roughness: 0.75 })
  const cushion = new THREE.MeshStandardMaterial({ color: 0x3a4a62, roughness: 0.7 })
  const wood = new THREE.MeshStandardMaterial({ color: 0x9a7a52, roughness: 0.6 })

  const sofa = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.35, 0.9), fabric)
  sofa.position.set(0, 0.32, 0)
  put(sofa)
  const back = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.55, 0.18), fabric)
  back.position.set(0, 0.72, -0.38)
  put(back)
  ;[-1.2, 1.2].forEach((dx) => {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.35, 0.9), fabric)
    arm.position.set(dx, 0.48, 0)
    put(arm)
  })
  ;[-0.7, 0, 0.7].forEach((dx) => {
    const pad = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.1, 0.55), cushion)
    pad.position.set(dx, 0.52, 0.05)
    put(pad)
  })

  const table = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.08, 0.6), wood)
  table.position.set(0, 0.38, 1.15)
  put(table)
  ;[-0.35, 0.35].forEach((dx) => {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.32, 0.06), wood)
    leg.position.set(dx, 0.18, 1.15)
    put(leg)
  })
  const mug = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.04, 0.1, 8),
    new THREE.MeshStandardMaterial({ color: 0xe0b45a }),
  )
  mug.position.set(0.2, 0.48, 1.1)
  put(mug)

  const rug = new THREE.Mesh(
    new THREE.BoxGeometry(3.2, 0.02, 2.4),
    new THREE.MeshStandardMaterial({ color: 0x4a3a2a, roughness: 0.9 }),
  )
  rug.position.set(0, 0.02, 0.5)
  put(rug)
  ;[-1.05, 1.05].forEach((dx) => {
    addBreakSpotLocal(dx, 0.12, 0, 'sit', cx, cz, rotY)
  })
  addBreakSpotLocal(0, 2.15, Math.PI, 'sit', cx, cz, rotY)
  add(root)

  pushZoneLabel({
    id: 'lounge',
    text: hallStrings.zoneLounge,
    wx: cx,
    wy: 1.85,
    wz: cz + 0.35,
    x: 0,
    y: 0,
    show: false,
  })
}

/** 开场：2 人已在中间休息/喝茶，工位仍是他们的家 */
function seedBreakVisitors() {
  if (actors.length < 4 || breakSpots.length < 2) return
  const picks = [0, Math.floor(actors.length / 2)]
  picks.forEach((ai, i) => {
    const actor = actors[ai]
    const spot = breakSpots[i % breakSpots.length]
    if (!actor || !spot) return
    lingerAtBreak(actor, ai, performance.now(), spot)
  })
}

function prefersReduce() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function stop() {
  running = false
  if (raf) cancelAnimationFrame(raf)
  raf = 0
}

function noteInteract() {
  lastInteractAt = performance.now()
  if (controls) {
    controls.autoRotate = false
  }
}

function onPointerInteract() {
  noteInteract()
  userOrbit = true
}

function aimCamera(t0: number) {
  if (!camera || userOrbit) return
  const sway = prefersReduce() ? 0 : Math.sin(t0 * 0.07)
  const layout = HALL_LAYOUT
  if (layout === 'studio') {
    camera.position.set(sway * 0.7, 4.5, 9)
  } else if (layout === 'sheet') {
    camera.position.set(0.3 + sway * 0.5, 4.7, 11.2)
  } else {
    camera.position.set(sway * 1.4, 5.2, 10.8)
  }
  camera.lookAt(tableLookAt())
}

function tick(now: number) {
  if (!running || !renderer || !scene || !camera) return
  raf = requestAnimationFrame(tick)

  const interacting = dragging.value || now - lastInteractAt < 2000
  const walking = actors.some((a) => a.path.length > a.pathI)
  const spinning = !!(controls && controls.autoRotate)
  const softIdle = !interacting && !walking && !spinning
  if (softIdle && now - lastFrameMs < IDLE_SOFT_MIN_DT) return
  lastFrameMs = now

  const dt = lastTick ? Math.min(0.05, (now - lastTick) / 1000) : 0.016
  lastTick = now
  const t0 = now / 1000
  if (controls) {
    if (!prefersReduce() && now - lastInteractAt >= IDLE_SPIN_MS) {
      controls.autoRotate = true
      controls.autoRotateSpeed = AUTO_SPIN_SPEED
      userOrbit = true
    }
    controls.update()
  } else if (!userOrbit) {
    aimCamera(t0)
  }
  tickActors(now, t0, dt)
  tickDeskScreens(now)
  screens.forEach((mat, i) => {
    mat.emissiveIntensity = 0.55 + Math.sin(t0 * 2.1 + i) * 0.35
  })
  if (dustPts) dustPts.rotation.y = t0 * 0.03
  syncBubbles()
  renderer.render(scene, camera)
}

function syncBubbles() {
  if (!camera || !hostRef.value) return
  const w = hostRef.value.clientWidth
  const h = hostRef.value.clientHeight
  const rows = bubbleRows.value
  actors.forEach((actor, i) => {
    const head = actor.g.getObjectByName('head')
    if (head) head.getWorldPosition(proj)
    else actor.g.getWorldPosition(proj)
    proj.y += 0.42
    proj.project(camera!)
    const row = rows[i]
    if (!row) return
    row.x = (proj.x * 0.5 + 0.5) * w
    row.y = (-proj.y * 0.5 + 0.5) * h
    row.show = proj.z < 1 && proj.x > -1.05 && proj.x < 1.05 && proj.y > -0.95 && proj.y < 1.05
  })
  // 屏幕上过近的气泡：藏掉较靠后的，避免休息区叠成一团
  const MIN_BUBBLE = 92
  for (let i = 0; i < rows.length; i += 1) {
    const a = rows[i]
    if (!a?.show) continue
    for (let j = i + 1; j < rows.length; j += 1) {
      const b = rows[j]
      if (!b?.show) continue
      const dx = a.x - b.x
      const dy = a.y - b.y
      if (dx * dx + dy * dy >= MIN_BUBBLE * MIN_BUBBLE) continue
      const ai = actors[i]
      const aj = actors[j]
      const za = ai ? ai.g.position.distanceToSquared(camera!.position) : 0
      const zb = aj ? aj.g.position.distanceToSquared(camera!.position) : 0
      if (za >= zb) a.show = false
      else b.show = false
    }
  }
  for (const row of rows) paintBubbleDom(row)

  zoneLabels.value.forEach((z) => {
    proj.set(z.wx, z.wy, z.wz)
    proj.project(camera!)
    z.x = (proj.x * 0.5 + 0.5) * w
    z.y = (-proj.y * 0.5 + 0.5) * h
    z.show = proj.z < 1 && proj.x > -1.15 && proj.x < 1.15 && proj.y > -1.05 && proj.y < 1.05
    z.text =
      z.id === 'tea'
        ? hallStrings.zoneTea
        : z.id === 'lounge'
          ? hallStrings.zoneLounge
          : z.id === 'front'
            ? hallStrings.zoneFront
            : hallStrings.zoneMeeting
    paintZoneDom(z)
  })
}

function start() {
  if (fallback.value || running || !renderer || !scene || !camera) return
  visible = true
  running = true
  lastFrameMs = 0
  lastTick = 0
  raf = requestAnimationFrame(tick)
}

function onResize() {
  if (!renderer || !camera || !hostRef.value) return
  const w = hostRef.value.clientWidth
  const h = hostRef.value.clientHeight
  camera.aspect = w / Math.max(h, 1)
  camera.updateProjectionMatrix()
  renderer.setSize(w, h, false)
}

function add(obj: THREE.Object3D) {
  scene!.add(obj)
  trash.push(obj)
}

function buildScene(hallLogo?: HTMLImageElement | null) {
  const canvas = canvasRef.value
  const host = hostRef.value
  if (!canvas || !host) return
  obstacles.length = 0
  navNodes.length = 0
  breakSpots.length = 0
  deskScreens.length = 0
  deskSlots.length = 0
  actorEmployees.clear()
  bubbleEls.clear()
  zoneEls.clear()
  bumpBubbleRows([])
  bumpZoneLabels([])
  scene = new THREE.Scene()
  const accent = cssToken('--hall-3d-accent', '#e0b45a')
  const glow = cssToken('--hall-3d-glow', '#5ee7f0')
  const bg = cssToken('--hall-bg', '#07080c')
  const layout = HALL_LAYOUT
  const roomBg = '#07080c'
  scene.background = new THREE.Color(roomBg)
  scene.fog = new THREE.Fog(new THREE.Color(roomBg), 28, 55)
  camera = new THREE.PerspectiveCamera(40, host.clientWidth / Math.max(host.clientHeight, 1), 0.1, 80)
  userOrbit = false
  dragging.value = false
  aimCamera(0)
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6))
  renderer.setSize(host.clientWidth, host.clientHeight, false)
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.35

  controls = new OrbitControls(camera, canvas)
  controls.enableDamping = true
  controls.dampingFactor = 0.08
  controls.enablePan = false
  controls.minDistance = 6
  controls.maxDistance = 18
  controls.minPolarAngle = 0.35
  controls.maxPolarAngle = Math.PI / 2.05
  controls.target.copy(tableLookAt())
  controls.autoRotate = false
  controls.autoRotateSpeed = AUTO_SPIN_SPEED
  controls.mouseButtons = {
    LEFT: THREE.MOUSE.ROTATE,
    MIDDLE: THREE.MOUSE.DOLLY,
    RIGHT: THREE.MOUSE.ROTATE,
  }
  controls.touches = {
    ONE: THREE.TOUCH.ROTATE,
    TWO: THREE.TOUCH.DOLLY_PAN,
  }
  controls.addEventListener('start', () => {
    onPointerInteract()
    dragging.value = true
    if (controls && camera) {
      controls.target.copy(tableLookAt())
      controls.update()
    }
  })
  controls.addEventListener('end', () => {
    noteInteract()
    dragging.value = false
  })
  canvas.addEventListener('pointerdown', onPointerInteract)
  canvas.addEventListener('click', onCanvasClick)
  canvas.addEventListener('wheel', onPointerInteract, { passive: true })
  canvas.addEventListener('contextmenu', onContextMenu)
  lastInteractAt = performance.now()
  aimCamera(0)
  controls.update()
  userOrbit = true

  add(new THREE.AmbientLight(0xc8d0dc, 0.95))
  add(new THREE.HemisphereLight(0xdde6f2, 0x2a241c, 0.85))
  const key = new THREE.PointLight(accent, 78, 42, 1.05)
  key.position.set(-3.2, 8.2, 6)
  add(key)
  const fill = new THREE.PointLight(glow, 52, 36, 1.0)
  fill.position.set(4.6, 6.8, 3)
  add(fill)
  const ceilFill = new THREE.PointLight(0xfff6e8, 42, 48, 1.0)
  ceilFill.position.set(0, 9.0, 0)
  add(ceilFill)
  const tableSpot = new THREE.SpotLight(0xfff1d0, 28, 24, 0.75, 0.3, 1)
  tableSpot.position.set(0, 9.2, 2)
  tableSpot.target.position.set(0, 0, -1.2)
  add(tableSpot)
  add(tableSpot.target)
  const sun = new THREE.DirectionalLight(0xfff6e8, 1.15)
  sun.position.set(-6, 12, 10)
  add(sun)

  const floorHex = 0x3d4d62
  const wallHex = 0x2a3548
  const gridA = 0x6a5a3a
  const gridB = 0x3a4252
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(36, 28), new THREE.MeshBasicMaterial({ color: floorHex }))
  floor.rotation.x = -Math.PI / 2
  add(floor)
  const grid = new THREE.GridHelper(36, 36, gridA, gridB)
  grid.position.y = 0.02
  add(grid)

  const wallMat = new THREE.MeshBasicMaterial({ color: wallHex })
  // 品牌墙（远墙 -Z）：logo + 虚募阁AI公司 —— 保持不动
  const back = new THREE.Mesh(new THREE.PlaneGeometry(36, 10), wallMat)
  back.position.set(0, 5, -13)
  add(back)
  const left = new THREE.Mesh(new THREE.PlaneGeometry(28, 10), wallMat)
  left.rotation.y = Math.PI / 2
  left.position.set(-17.5, 5, 0)
  add(left)
  const right = new THREE.Mesh(new THREE.PlaneGeometry(28, 10), wallMat)
  right.rotation.y = -Math.PI / 2
  right.position.set(17.5, 5, 0)
  add(right)

  const hallTex = new THREE.CanvasTexture(drawHallScreen(hallLogo, hallDisplay.value))
  hallBrandTex = hallTex
  hallTex.colorSpace = THREE.SRGBColorSpace
  const hall = new THREE.Mesh(
    new THREE.PlaneGeometry(18, 4.2),
    new THREE.MeshBasicMaterial({ map: hallTex }),
  )
  hall.position.set(0, 5.1, -12.72)
  add(hall)

  // 对面墙（近端 +Z）：夜景落地窗（方案 C）
  try {
    const cityTex = new THREE.CanvasTexture(drawNightCityWall())
    cityTex.colorSpace = THREE.SRGBColorSpace
    const cityWall = new THREE.Mesh(
      new THREE.PlaneGeometry(36, 10),
      new THREE.MeshBasicMaterial({ map: cityTex }),
    )
    cityWall.rotation.y = Math.PI
    cityWall.position.set(0, 5, 12.85)
    add(cityWall)
    const sill = new THREE.Mesh(
      new THREE.BoxGeometry(36.2, 0.18, 0.35),
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(accent),
        metalness: 0.35,
        roughness: 0.4,
        emissive: new THREE.Color(accent),
        emissiveIntensity: 0.35,
      }),
    )
    sill.position.set(0, 0.12, 12.55)
    add(sill)
    const cityGlow = new THREE.PointLight(0x88aaff, 14, 26, 1.2)
    cityGlow.position.set(0, 4.5, 10.5)
    add(cityGlow)
  } catch (wallErr) {
    console.warn('[VirmoorOfficeHall] night city wall failed', wallErr)
    const front = new THREE.Mesh(new THREE.PlaneGeometry(36, 10), wallMat)
    front.rotation.y = Math.PI
    front.position.set(0, 5, 13)
    add(front)
  }
  // 进出门：左墙实体墙上，不在夜景落地窗上
  const layoutCfg = readOfficeHallLayout()
  const activeDeskCount = clampDeskCount(props.deskCount ?? layoutCfg.deskCount)
  const zones = layoutCfg.zones
  if (zones.front) addOfficeDoor()

  const stripMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(accent),
    emissive: new THREE.Color(accent),
    emissiveIntensity: 2.6,
  })
  // 顶灯三排：原一排 + 再加两排
  const lightRows = [-6.5, -2, 4.5]
  lightRows.forEach((zz) => {
    for (let i = -3; i <= 3; i += 1) {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.06, 0.28), stripMat)
      strip.position.set(i * 4.2, 8.4, zz)
      add(strip)
      const lamp = new THREE.PointLight(accent, 11, 15, 1.25)
      lamp.position.set(i * 4.2, 8.15, zz)
      add(lamp)
    }
  })

  // 工位与分区（按布局模式 + deskCount）
  const slots = deskSlotsForMode(layoutCfg.zoneMode, activeDeskCount)
  const mc = meetingCenterForMode(layoutCfg.zoneMode)
  if (zones.meeting) addRoundTable(mc.x, mc.z)
  slots.forEach((s) => addWorkstation(s.x, s.z, s.rotY, s.deskIndex))
  if (zones.tea || zones.lounge) {
    addLeftWallBreakCluster({ tea: zones.tea, lounge: zones.lounge })
  }
  rebuildNav()
  placeEmployeesFromRoster()
  lastSeatSignature = seatSignature(props.employees, props.deskCount ?? 16)

  const n = 480
  const pos = new Float32Array(n * 3)
  for (let i = 0; i < n; i += 1) {
    pos[i * 3] = (Math.random() - 0.5) * 30
    pos[i * 3 + 1] = Math.random() * 8.5
    pos[i * 3 + 2] = (Math.random() - 0.5) * 22
  }
  const pg = new THREE.BufferGeometry()
  pg.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  const pts = new THREE.Points(
    pg,
    new THREE.PointsMaterial({ color: new THREE.Color(accent), size: 0.045, transparent: true, opacity: 0.55 }),
  )
  add(pts)
  dustPts = pts
}

function onCanvasClick(e: MouseEvent) {
  if (dragging.value || !camera || !canvasRef.value) return
  const rect = canvasRef.value.getBoundingClientRect()
  const pointer = new THREE.Vector2(
    ((e.clientX - rect.left) / rect.width) * 2 - 1,
    -((e.clientY - rect.top) / rect.height) * 2 + 1,
  )
  const raycaster = new THREE.Raycaster()
  raycaster.setFromCamera(pointer, camera)
  const staffHits = raycaster.intersectObjects(staff, true)
  if (staffHits.length) {
    let node: THREE.Object3D | null = staffHits[0].object
    while (node && !staff.includes(node as THREE.Group)) {
      node = node.parent
    }
    if (node) {
      const idx = actors.findIndex((a) => a.g === node)
      const emp = actorEmployees.get(idx)
      if (emp) emit('edit-employee', emp)
    }
    return
  }
  const deskHits = raycaster.intersectObjects(workstationGroups.filter(Boolean), true)
  if (!deskHits.length) return
  let dnode: THREE.Object3D | null = deskHits[0].object
  while (dnode && !workstationGroups.includes(dnode as THREE.Group)) {
    dnode = dnode.parent
  }
  if (!dnode) return
  const deskIndex = (dnode as THREE.Group).userData?.deskIndex
  if (typeof deskIndex === 'number') emit('decorate-desk', deskIndex)
}

function onContextMenu(e: Event) {
  e.preventDefault()
}

function dispose() {
  stop()
  staff.length = 0
  actors.forEach((a) => clearProp(a))
  actors.length = 0
  obstacles.length = 0
  navNodes.length = 0
  breakSpots.length = 0
  recentLines.length = 0
  screens.length = 0
  deskScreens.length = 0
  deskSlots.length = 0
  workstationGroups.length = 0
  bubbleEls.clear()
  zoneEls.clear()
  bumpBubbleRows([])
  bumpZoneLabels([])
  dustPts = null
  hallBrandTex = null
  foldingBannerTex = null
  lastTick = 0
  lastFrameMs = 0
  lastInteractAt = 0
  lastSeatSignature = ''
  dragging.value = false
  userOrbit = false
  if (controls) {
    controls.autoRotate = false
    controls.dispose()
    controls = null
  }
  canvasRef.value?.removeEventListener('click', onCanvasClick)
  canvasRef.value?.removeEventListener('contextmenu', onContextMenu)
  canvasRef.value?.removeEventListener('pointerdown', onPointerInteract)
  canvasRef.value?.removeEventListener('wheel', onPointerInteract)
  trash.forEach((o) => {
    o.traverse((c) => {
      const m = c as THREE.Mesh
      if (m.geometry) m.geometry.dispose()
      const mat = m.material
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose())
      else if (mat) (mat as THREE.Material).dispose()
    })
  })
  trash.length = 0
  renderer?.dispose()
  scene?.clear()
  renderer = null
  scene = null
  camera = null
}

async function refreshHallBranding() {
  hallDisplay.value = readOfficeHallDisplay()
  if (!hallBrandTex && !foldingBannerTex) return
  try {
    const logo = await loadHallLogoFromConfig(hallDisplay.value.logoDataUrl)
    if (hallBrandTex) {
      const canvas = drawHallScreen(logo, hallDisplay.value)
      hallBrandTex.image = canvas
      hallBrandTex.needsUpdate = true
    }
    if (foldingBannerTex) {
      const canvas = drawFoldingScreenBanner(hallDisplay.value)
      foldingBannerTex.image = canvas
      foldingBannerTex.needsUpdate = true
    }
    if (renderer && scene && camera) renderer.render(scene, camera)
  } catch (err) {
    console.warn('[VirmoorOfficeHall] refresh branding', err)
  }
}

async function bootScene() {
  fallback.value = false
  hallDisplay.value = readOfficeHallDisplay()
  await nextTick()
  if (!hostRef.value || !canvasRef.value) {
    fallback.value = true
    return
  }
  try {
    dispose()
    const hallLogo = await loadHallLogoFromConfig(hallDisplay.value.logoDataUrl)
    buildScene(hallLogo)
    onResize()
    start()
    if (renderer && scene && camera) renderer.render(scene, camera)
  } catch (err) {
    console.error('[VirmoorOfficeHall]', err)
    fallback.value = true
  }
}

onMounted(() => {
  const host = hostRef.value
  if (!host) {
    fallback.value = true
    return
  }
  const io = new IntersectionObserver(
    ([entry]) => {
      visible = !!entry?.isIntersecting
      if (visible) start()
      else stop()
    },
    { threshold: 0.02 },
  )
  io.observe(host)
  const ro = new ResizeObserver(() => {
    onResize()
    if (!running && renderer) start()
  })
  ro.observe(host)
  const onHide = () => {
    if (document.hidden) stop()
    else start()
  }
  document.addEventListener('visibilitychange', onHide)
  window.addEventListener('resize', onResize)
  const onHallDisplay = () => {
    void refreshHallBranding()
  }
  const onHallLayout = () => {
    void bootScene()
  }
  const onDeskDecor = () => {
    void bootScene()
  }
  window.addEventListener('xu-office-display', onHallDisplay)
  window.addEventListener('xu-office-layout', onHallLayout)
  window.addEventListener('xu-office-settings', onHallLayout)
  window.addEventListener('xu-office-desk-decor', onDeskDecor)
  void bootScene()
  const unsubLive = subscribeEmployeeLive(() => {
    syncEmployeeOverlay()
  })
  /** 流式文案节流：合并 100ms 内同一批员工，只 paintBubbleDom */
  const dirtyStreamIds = new Set<string>()
  let streamFlushTimer: number | null = null
  const flushStreamBubbles = () => {
    streamFlushTimer = null
    const ids = [...dirtyStreamIds]
    dirtyStreamIds.clear()
    if (!ids.length) return
    const want = new Set(ids)
    actors.forEach((_actor, i) => {
      const emp = actorEmployees.get(i)
      if (!emp || !want.has(emp.id)) return
      const row = bubbleRows.value[i]
      if (row) applyBubbleRow(row, emp)
    })
  }
  const unsubStream = subscribeOfficeLiveStream((employeeId) => {
    dirtyStreamIds.add(employeeId)
    if (streamFlushTimer != null) return
    streamFlushTimer = window.setTimeout(flushStreamBubbles, 100)
  })
  cleanup = () => {
    unsubLive()
    unsubStream()
    if (streamFlushTimer != null) {
      window.clearTimeout(streamFlushTimer)
      streamFlushTimer = null
    }
    io.disconnect()
    ro.disconnect()
    document.removeEventListener('visibilitychange', onHide)
    window.removeEventListener('resize', onResize)
    window.removeEventListener('xu-office-display', onHallDisplay)
    window.removeEventListener('xu-office-layout', onHallLayout)
    window.removeEventListener('xu-office-settings', onHallLayout)
    window.removeEventListener('xu-office-desk-decor', onDeskDecor)
    dispose()
  }
})

function refreshActorEmployeeRefs() {
  actors.forEach((_actor, i) => {
    const old = actorEmployees.get(i)
    if (!old) return
    const fresh = (props.employees ?? []).find((e) => e.id === old.id)
    if (fresh) actorEmployees.set(i, fresh)
  })
  syncEmployeeOverlay()
}

watch(
  () => seatSignature(props.employees, props.deskCount ?? 16),
  (sig) => {
    if (!scene || !renderer) return
    if (sig === lastSeatSignature) {
      refreshActorEmployeeRefs()
      return
    }
    lastSeatSignature = sig
    clearStaffActors()
  },
)

watch(() => props.deskCount, () => {
  void bootScene()
})

onUnmounted(() => {
  cleanup?.()
})
</script>

<style scoped>
.hero3d {
  --hall-bg: #07080c;
  --hall-3d-accent: #e0b45a;
  --hall-3d-glow: #5ee7f0;
  --hall-gold: #e0b45a;
  --hall-cyan: #5ee7f0;
  --hall-line: rgba(255, 255, 255, 0.12);
  --hall-glass: rgba(12, 16, 22, 0.72);
  --hall-btn-ghost-bg: rgba(18, 24, 32, 0.85);
  --hall-text: #f0ead2;
  position: absolute;
  inset: 0;
  overflow: hidden;
  background: var(--hall-bg);
  cursor: grab;
  touch-action: none;
}
.hero3d.is-drag {
  cursor: grabbing;
}
.hero3d.is-embed {
  position: relative;
  inset: auto;
  width: 100%;
  height: 100%;
  min-height: 380px;
  border: 1px solid var(--hall-line);
  border-radius: 12px;
}
.hero3d__canvas {
  width: 100%;
  height: 100%;
  display: block;
}
.hero3d__hud {
  position: absolute;
  top: 18px;
  left: 22px;
  display: flex;
  gap: 12px;
  font-size: 11px;
  letter-spacing: 0.2em;
  color: var(--hall-gold);
  text-shadow: 0 0 12px color-mix(in srgb, var(--hall-gold) 70%, transparent);
  pointer-events: none;
}
.hero3d__pulse {
  color: var(--hall-cyan);
}
.hero3d__chips {
  position: absolute;
  right: 24px;
  bottom: 28%;
  display: flex;
  flex-direction: column;
  gap: 8px;
  pointer-events: none;
}
.hero3d__chips.is-cyan {
  right: auto;
  left: 24px;
  bottom: 36%;
}
.hero3d__chips span {
  padding: 6px 12px;
  border: 1px solid var(--hall-line);
  border-radius: 999px;
  background: var(--hall-glass);
  color: var(--hall-text);
  font-size: 12px;
  letter-spacing: 0.06em;
}
.css-hall {
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, #2a3548 0%, #1a2230 38%, #3d4d62 38%, #2a3344 100%);
}
.css-hall__wall {
  position: absolute;
  top: 8%;
  left: 18%;
  right: 18%;
  height: 26%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 18px;
  color: #f6e7b8;
  letter-spacing: 0.28em;
  font-size: 28px;
  background: #121820;
  border: 2px solid var(--hall-gold);
}
.css-hall__logo {
  width: 56px;
  height: 56px;
  object-fit: contain;
  border-radius: 12px;
  background: #0a0a0a;
  flex-shrink: 0;
}
.css-hall__table {
  position: absolute;
  left: 50%;
  top: 58%;
  width: 220px;
  height: 220px;
  margin: -110px 0 0 -110px;
  border-radius: 50%;
  background: #c4843a;
  box-shadow: 0 0 0 10px color-mix(in srgb, var(--hall-gold) 70%, #8a5a2b);
}
.css-hall__desk {
  position: absolute;
  width: 150px;
  height: 78px;
  background: #6a7b90;
  border-radius: 4px;
}
.css-hall__desk i {
  position: absolute;
  left: 18px;
  top: -36px;
  width: 114px;
  height: 64px;
  background: #1d6;
  border: 6px solid #111;
}
.css-hall__desk.is-left {
  left: 8%;
}
.css-hall__desk.is-right {
  right: 8%;
}
.hero3d__bubbles {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 2;
  overflow: hidden;
  user-select: none;
  -webkit-user-select: none;
}
.hero3d__zones {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 2;
  overflow: hidden;
  user-select: none;
  -webkit-user-select: none;
}
.hero3d__zone {
  position: absolute;
  transform: translate(-50%, -100%);
  opacity: 0;
  transition: opacity 0.28s ease;
  padding: 4px 12px;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--hall-gold) 55%, transparent);
  background: color-mix(in srgb, var(--hall-btn-ghost-bg) 78%, transparent);
  backdrop-filter: blur(8px);
  color: var(--hall-gold);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.14em;
  white-space: nowrap;
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.28);
}
.hero3d__zone.is-on {
  opacity: 1;
}
.hero3d__pop {
  position: absolute;
  transform: translate(-50%, -118%);
  opacity: 0;
  transition: opacity 0.28s ease;
  max-width: min(260px, 42vw);
}
.hero3d__pop.is-on {
  opacity: 1;
}
.hero3d__bubble {
  position: relative;
  padding: 10px 14px 11px;
  border: 1px solid color-mix(in srgb, var(--hall-line) 80%, transparent);
  border-radius: 18px 18px 18px 6px;
  background: color-mix(in srgb, var(--hall-btn-ghost-bg) 92%, transparent);
  backdrop-filter: blur(10px);
  color: var(--hall-text);
  line-height: 1.35;
  white-space: normal;
  word-break: break-word;
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.38);
  user-select: none;
  -webkit-user-select: none;
}
.hero3d__bubble-title {
  font-size: 13px;
  font-weight: 650;
  letter-spacing: 0.02em;
  color: var(--hall-text);
}
.hero3d__bubble-status {
  margin-top: 4px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
}
.hero3d__bubble-status.is-busy {
  color: #5ee7b0;
}
.hero3d__bubble-status.is-idle {
  color: color-mix(in srgb, var(--hall-text) 58%, transparent);
}
.hero3d__bubble::after {
  content: '';
  position: absolute;
  left: 18px;
  bottom: -7px;
  width: 12px;
  height: 12px;
  background: inherit;
  border-right: 1px solid color-mix(in srgb, var(--hall-line) 80%, transparent);
  border-bottom: 1px solid color-mix(in srgb, var(--hall-line) 80%, transparent);
  transform: rotate(45deg);
}
</style>
