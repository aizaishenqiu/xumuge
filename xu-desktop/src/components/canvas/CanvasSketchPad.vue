<script setup lang="ts">
/**
 * @file CanvasSketchPad.vue 白图纸草图（像素层 + 自研矢量引擎）
 * @author qiuye <yjk150@qq.com>
 * @date 2026-09-06
 * @updated 2026-09-08
 * @version 2.3.0
 * @category Layout
 * @algo paper-raster-vector-fsm
 */
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { FouButton, FouCheckbox, FouDialog, FouInput, FouSelect, fouAlert, fouMsg } from "foucui";
import { readLs, writeLs } from "../../utils/xuStorage";
import { writeClipboardText } from "../../utils/clipboardText";
import {
  CANVAS_DIRS,
  canvasAbs,
  canvasImageDataUrl,
  ensureAlbumAssetInSketch,
  ensureCanvasDirs,
  listAlbumEntries,
  readCanvasText,
  writeCanvasText,
  type AlbumEntry,
} from "../../canvas/canvasIo";
import { importFileIntoWorkspace, mkdirRecursive } from "../../utils/fsBridge";
import { onCanvasAlbumInsert, onCanvasSketchUpdated } from "../../utils/crossWindowBus";
import { exportSketch, type ExportKind } from "../../canvas/sketchExport";
import {
  canvasPngBytes,
  clearPaint,
  drawDataUrl,
  floodFill,
  hexRgba,
} from "../../canvas/sketchPaint";
import { buildRulerTicks, parseGuides, snapToGuides, type Guides } from "../../canvas/sketchRuler";
import {
  DEFAULT_DESK_BG,
  DEFAULT_PAPER,
  DEFAULT_PAPER_BG,
  PAGE_PRESETS,
  UNITS,
  applyPreset,
  convertPaperUnit,
  paperPixelSize,
  parseDeskBg,
  parsePaper,
  pxToRealMm,
  realMmToPx,
  type LengthUnit,
  type PaperState,
} from "../../canvas/sketchPaper";
import {
  alignStrokes,
  curveToPath,
  defaultLayers,
  distributeStrokes,
  ensureStrokeLayers,
  expandSelection,
  estimateTextSize,
  groupBBox,
  groupStrokes,
  isLinearFill,
  linearGradientEnds,
  dashArrayOf,
  mirrorSelection,
  newLayerId,
  newStrokeId,
  normalizeStrokes,
  parseLayers,
  reorderStroke,
  rotateSelection,
  scaleSelection,
  setStrokePoint,
  solidFillAttr,
  strokeBBox,
  strokeSvgTransform,
  styleOf,
  translateSelection,
  translateStroke,
  ungroupStrokes,
  unionBBox,
  type AlignDir,
  type AlignRelative,
  type LinearFill,
  type SketchLayer,
  type Stroke,
  type StrokeDash,
} from "../../canvas/sketchTypes";
import {
  HANDLE_CURSOR,
  SCALE_HANDLES,
  clientToPaper,
  cloneBoard,
  createSketchEngine,
  snapPaperPt,
  type ScaleHandleId,
  type SketchTool,
} from "../../canvas/sketchEngine";
import SketchColorDialog from "./SketchColorDialog.vue";
import SketchAlignDialog from "./SketchAlignDialog.vue";
import { buildSealStrokes, SEAL_DEFAULT_COLOR } from "../../canvas/sealStamp";

type Tool = SketchTool;

const props = defineProps<{ workspace: string; /** 是否为当前活动页签；隐藏时不抢快捷键 */ active?: boolean }>();
const isActive = computed(() => props.active !== false);

const FILE = `${CANVAS_DIRS.sketch}/board.json`;
const PAINT_REL = `${CANVAS_DIRS.sketch}/paint.png`;
const ASSET_DIR = `${CANVAS_DIRS.sketch}/assets`;
const SNAP_MM = 5;
const COLORS = ["#1e293b", "#64748b", "#dc2626", "#2563eb", "#16a34a"] as const;
const WIDTHS = [1, 2, 4, 8, 16] as const;

const tool = ref<Tool>("select");
const strokes = ref<Stroke[]>([]);
const history = ref<Stroke[][]>([[]]);
const historyIdx = ref(0);
const drawing = ref(false);
const start = ref({ x: 0, y: 0 });
const draft = ref<Stroke | null>(null);
const marqueeRect = ref<{ x: number; y: number; w: number; h: number } | null>(null);
const paperEl = ref<HTMLElement | null>(null);
const boardEl = ref<HTMLElement | null>(null);
const svgEl = ref<SVGSVGElement | null>(null);
const paintEl = ref<HTMLCanvasElement | null>(null);
const deskEl = ref<HTMLElement | null>(null);
const rulerHEl = ref<HTMLElement | null>(null);
const rulerVEl = ref<HTMLElement | null>(null);
const status = ref("");
const color = ref<string>(COLORS[0]);
const width = ref<number>(4);
const fillOn = ref(false);
const fillColor = ref("#16a34a");
const colorWell = ref<"stroke" | "fill" | "paperBg" | "deskBg">("stroke");
const flyout = ref<"shapes" | null>(null);
const alignDialogVisible = ref(false);
const sealDialogVisible = ref(false);
const sealRingText = ref("虚募阁专用章");
const sealCenterText = ref("");
const sealDiameter = ref(180);
const sealColor = ref(SEAL_DEFAULT_COLOR);
const sealCenterStar = ref(true);
const sketchLayers = ref<SketchLayer[]>(defaultLayers());
const activeLayerId = ref(defaultLayers()[0]!.id);
const openLayerId = ref<string | null>(defaultLayers()[0]!.id);
const layerDragLyId = ref<string | null>(null);
const ctxMenu = ref<{ x: number; y: number } | null>(null);
const gridOn = ref(false);
const snapOn = ref(true);
const orthoOn = ref(false);
const pan = ref({ x: 24, y: 24 });
const panStart = ref({ x: 0, y: 0, px: 0, py: 0 });
const zoom = ref(1);
const textFontSize = ref(18);
const textFontBold = ref(false);
const textFontFamily = ref("ui-sans-serif, system-ui, sans-serif");
const cornerRadius = ref(0);
const objectSnapOn = ref(true);
/** 空格临时平移：松开后恢复的工具 */
let toolBeforeSpace: Tool | null = null;
const STROKE_CLIP_PREFIX = "xu.canvas.strokes.v1:";
const FONT_FAMILY_OPTIONS = [
  { label: "系统默认", value: "ui-sans-serif, system-ui, sans-serif" },
  { label: "微软雅黑", value: '"Microsoft YaHei", sans-serif' },
  { label: "宋体", value: "SimSun, serif" },
  { label: "等宽", value: "ui-monospace, Consolas, monospace" },
];
const textEditingId = ref<string | null>(null);
const textInlineOn = ref(false);
const textDraft = ref("");
const textPos = ref({ x: 0, y: 0 });
const textInputEl = ref<HTMLTextAreaElement | null>(null);
const selectedIds = ref<string[]>([]);
const selectedId = computed(() => selectedIds.value[selectedIds.value.length - 1] ?? null);
const polyPts = ref<{ x: number; y: number }[]>([]);
const curvePts = ref<{ x: number; y: number }[]>([]);
const dragMove = ref<{
  id: string;
  lx: number;
  ly: number;
  ox: number;
  oy: number;
  moved: boolean;
} | null>(null);
const scaleDrag = ref<{
  handle: ScaleHandleId;
  origin: { x: number; y: number };
  hx: number;
  hy: number;
  snapshot: Stroke[];
  ids: string[];
  moved: boolean;
} | null>(null);
const rotateDrag = ref<{
  cx: number;
  cy: number;
  startAngle: number;
  snapshot: Stroke[];
  ids: string[];
  moved: boolean;
} | null>(null);
const nodeEditOn = ref(false);
const nodeDrag = ref<{ strokeId: string; index: number; moved: boolean } | null>(null);
const rotateDegInput = ref("0");
const polygonSides = ref(5);
const albumOpen = ref(false);
const albumEntries = ref<Array<AlbumEntry & { src: string }>>([]);
const dirty = ref(false);
const paintDirty = ref(false);
const lastLoaded = ref("");
/** 单调写入代数：重叠 save 仅最新者更新 lastLoaded / 清 dirty */
let saveGen = 0;
let saveChain: Promise<void> = Promise.resolve();
/** 本地编辑代数：load 写回前若已变则丢弃，防冲掉刚画的图 */
let localEditEpoch = 0;
/** 本地编辑后短时禁止外部/轮询 load 覆盖 */
let suppressLoadUntil = 0;
let pendingExternalLoad = false;
/** 并发 load 计数（调试用） */
let loadInFlight = 0;
/** 已 ensure 过 canvas 目录，避免轮询反复 mkdir */
let canvasDirsReady = false;
let rulerRaf = 0;
/** 松手收尾防 lostpointercapture 重入 */
let strokeEnding = false;
/** 拖拽过程最大尺寸，防 tiny 误丢 */
let draftPeak = 0;
const DRAFT_KEEP_PEAK = 4;
const paper = ref<PaperState>({ ...DEFAULT_PAPER });
const deskBg = ref(DEFAULT_DESK_BG);
const opacityPct = ref(100);
const imageUrls = ref<Record<string, string>>({});
const mmX = ref("");
const mmY = ref("");
const mmW = ref("");
const mmH = ref("");
const pageDialogVisible = ref(false);
const colorDialogVisible = ref(false);
const exportDialogVisible = ref(false);
const exportKind = ref<ExportKind>("png");
const exportScope = ref<"page" | "layer">("page");
const reopenPageAfterColor = ref(false);
const gradOn = ref(false);
const gradA = ref("#0d9488");
const gradB = ref("#e2e8f0");
const gradAngle = ref(90);
const gradType = ref<"linear" | "radial">("linear");
const strokeDash = ref<StrokeDash>("solid");
/** 取色对话框目标：色井 / 渐变端 */
const colorPickTarget = ref<"well" | "gradA" | "gradB">("well");
const GRAD_TYPE_OPTIONS = [
  { label: "线性", value: "linear" },
  { label: "径向", value: "radial" },
];
const DASH_OPTIONS: { id: StrokeDash; icon: string; title: string }[] = [
  { id: "solid", icon: "subtract-line", title: "实线" },
  { id: "dash", icon: "more-line", title: "虚线" },
  { id: "dot", icon: "checkbox-blank-circle-line", title: "点线" },
  { id: "dashdot", icon: "menu-line", title: "点划线" },
];
const pageDraft = ref<PaperState>({ ...DEFAULT_PAPER });
const presetId = ref("house");
const layersWidth = ref(Number(readLs("xu.canvas.layersWidth")) || 168);
const layerDragId = ref<string | null>(null);
const guides = ref<Guides>({ v: [], h: [] });
const track = ref<{ x: number; y: number } | null>(null);
const draggingGuide = ref<{ axis: "v" | "h"; pos: number; from: "new" | number } | null>(null);
const rulerLayout = ref({ ox: 0, oy: 0, z: 1, rhW: 200, rvH: 200, minX: -200, maxX: 400, minY: -200, maxY: 400 });
const snapGuideOn = ref(true);
let saveTimer: number | undefined;
let idleTimer: number | undefined;
let paintLast: { x: number; y: number } | null = null;
let splitStart = 0;
let splitW = 0;
const DRAG_SLOP = 3;
let strokePtrId: number | null = null;
let strokeCaptureEl: HTMLElement | null = null;
let strokeUnbind: (() => void) | null = null;

const page = computed(() => paperPixelSize(paper.value));
const snapPx = computed(() => realMmToPx(SNAP_MM, paper.value));
const gridPx = computed(() => realMmToPx(10, { ...paper.value, scale: 1 }));
const paperLabel = computed(
  () => `${paper.value.w}×${paper.value.h} ${paper.value.unit} · ${paper.value.dpi}dpi`,
);
const unitOptions = UNITS.map((u) => ({ label: u.label, value: u.id }));
const presetOptions = PAGE_PRESETS.map((p) => ({ label: p.label, value: p.id }));

const currentStyle = computed(() => {
  const fill: string | LinearFill | null = gradOn.value
    ? {
        type: gradType.value,
        a: gradA.value,
        b: gradB.value,
        angle: Number(gradAngle.value) || 0,
      }
    : fillOn.value
      ? fillColor.value
      : null;
  return {
    color: color.value,
    width: width.value,
    fill,
    dash: strokeDash.value,
    fontSize: Math.max(8, Math.min(200, Math.round(Number(textFontSize.value)) || 18)),
    fontBold: textFontBold.value,
    fontFamily: textFontFamily.value,
    cornerRadius: Math.max(0, Math.min(200, Math.round(Number(cornerRadius.value)) || 0)),
    opacity: (() => {
      const n = Number(opacityPct.value);
      return Number.isFinite(n) && n > 0 ? Math.min(100, n) / 100 : 1;
    })(),
  };
});

function layerOf(id: string | undefined): SketchLayer | undefined {
  return sketchLayers.value.find((l) => l.id === id);
}

function layerHidden(s: Stroke): boolean {
  return !!layerOf(s.layerId)?.hidden;
}

function layerLocked(s: Stroke): boolean {
  return !!layerOf(s.layerId)?.locked;
}

const visibleStrokes = computed(() => {
  const list = strokes.value.filter((s) => !s.hidden && !layerHidden(s) && s.kind !== "group");
  return draft.value ? [...list, draft.value] : list;
});

const drawOrderedStrokes = computed(() => {
  const layerOrder = sketchLayers.value.map((l) => l.id);
  const scored = visibleStrokes.value.map((s, i) => {
    const li = layerOrder.indexOf(s.layerId || "");
    return { s, i, li: li < 0 ? 0 : li };
  });
  scored.sort((a, b) => (a.li !== b.li ? a.li - b.li : a.i - b.i));
  return scored.map((x) => x.s);
});

function strokesInLayer(lid: string): Stroke[] {
  return [...strokes.value]
    .reverse()
    .filter((s) => (s.layerId || "") === lid && !s.parentId && s.kind !== "group");
}

function snapVal(n: number, enable: boolean): number {
  if (!enable) return n;
  const g = snapPx.value;
  if (g <= 0) return n;
  return Math.round(n / g) * g;
}

function applyOrtho(from: { x: number; y: number }, p: { x: number; y: number }) {
  if (!orthoOn.value) return p;
  if (Math.abs(p.x - from.x) >= Math.abs(p.y - from.y)) return { x: p.x, y: from.y };
  return { x: from.x, y: p.y };
}

const PASTE = 1600;

const DRAW_TOOLS: Tool[] = [
  "brush",
  "line",
  "rect",
  "ellipse",
  "circle",
  "polygon",
  "polyline",
  "curve",
  "arrow",
  "dim",
  "fill",
  "image",
];

const isDrawTool = computed(() => DRAW_TOOLS.includes(tool.value));

function collectObjectSnapPts(excludeIds?: Set<string>): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (const s of strokes.value) {
    if (s.hidden || s.parentId || s.kind === "group") continue;
    if (excludeIds?.has(s.id)) continue;
    if (layerHidden(s) || layerOf(s.layerId)?.locked) continue;
    if (s.kind === "rect" || s.kind === "image") {
      out.push(
        { x: s.x, y: s.y },
        { x: s.x + s.w, y: s.y },
        { x: s.x, y: s.y + s.h },
        { x: s.x + s.w, y: s.y + s.h },
        { x: s.x + s.w / 2, y: s.y },
        { x: s.x + s.w / 2, y: s.y + s.h },
        { x: s.x, y: s.y + s.h / 2 },
        { x: s.x + s.w, y: s.y + s.h / 2 },
        { x: s.x + s.w / 2, y: s.y + s.h / 2 },
      );
    } else if (s.kind === "ellipse") {
      out.push(
        { x: s.cx, y: s.cy },
        { x: s.cx - s.rx, y: s.cy },
        { x: s.cx + s.rx, y: s.cy },
        { x: s.cx, y: s.cy - s.ry },
        { x: s.cx, y: s.cy + s.ry },
      );
    } else if (s.kind === "line" || s.kind === "arrow" || s.kind === "dim") {
      out.push(
        { x: s.x1, y: s.y1 },
        { x: s.x2, y: s.y2 },
        { x: (s.x1 + s.x2) / 2, y: (s.y1 + s.y2) / 2 },
      );
    } else if (s.kind === "text") {
      const b = strokeBBox(s);
      out.push({ x: s.x, y: s.y }, { x: b.x + b.w / 2, y: b.y + b.h / 2 });
    } else if (s.kind === "polygon" || s.kind === "curve") {
      for (const q of s.points) out.push({ x: q.x, y: q.y });
    }
  }
  return out;
}

function paperPt(e: PointerEvent, cadSnap: boolean) {
  const raw = clientToPaper(e.clientX, e.clientY, svgEl.value, paperEl.value, page.value.w);
  if (!cadSnap) return raw;
  return snapPaperPt(raw, {
    snapGridOn: snapOn.value,
    snapGuideOn: snapGuideOn.value,
    gridPx: snapPx.value,
    guides: guides.value,
    zoomLike: rulerLayout.value.z,
    objectSnapPts: objectSnapOn.value ? collectObjectSnapPts(new Set(selectedIds.value)) : undefined,
  });
}

function strokeOpacity(s: Stroke): number {
  const o = styleOf(s).opacity;
  const n = typeof o === "number" ? o : Number(o);
  if (!Number.isFinite(n) || n <= 0) return 1;
  return Math.min(1, n);
}

function markLocalEdit() {
  localEditEpoch += 1;
  suppressLoadUntil = Date.now() + 2500;
  // 勿清 pendingExternalLoad：否则排队的外部刷新会丢，且点选不应取消 Agent 写入
}

function pushHistory(next: Stroke[]) {
  const trimmed = history.value.slice(0, historyIdx.value + 1);
  trimmed.push(cloneBoard(next));
  if (trimmed.length > 80) trimmed.shift();
  history.value = trimmed;
  historyIdx.value = trimmed.length - 1;
  strokes.value = next;
  dirty.value = true;
  markLocalEdit();
  scheduleSave();
}

const engine = createSketchEngine({
  getStrokes: () => strokes.value,
  setStrokes: (s) => {
    strokes.value = s;
  },
  getSelectedIds: () => selectedIds.value,
  setSelectedIds: (ids) => {
    selectedIds.value = ids;
  },
  getDraft: () => draft.value,
  setDraft: (d) => {
    draft.value = d;
  },
  getMarquee: () => marqueeRect.value,
  setMarquee: (b) => {
    marqueeRect.value = b;
  },
  getTool: () => tool.value,
  getLayers: () => sketchLayers.value,
  getActiveLayerId: () => activeLayerId.value,
  getStyle: () => ({ ...currentStyle.value }),
  getPolygonSides: () => Math.max(3, Math.min(24, Math.round(Number(polygonSides.value)) || 5)),
  getOrtho: () => orthoOn.value,
  getPolyPts: () => polyPts.value,
  setPolyPts: (p) => {
    polyPts.value = p;
  },
  getCurvePts: () => curvePts.value,
  setCurvePts: (p) => {
    curvePts.value = p;
  },
  commitBoard: (next, msg) => {
    pushHistory(next);
    if (msg) status.value = msg;
    syncMm();
  },
  previewBoard: (next) => {
    strokes.value = next;
    dirty.value = true;
  },
  setStatus: (s) => {
    status.value = s;
  },
  paintStroke: (erase, from, to) => strokePaint(erase, from, to),
  floodAt: (p) => {
    const ctx = paintCtx();
    if (ctx) {
      floodFill(ctx, p.x, p.y, hexRgba(color.value, opacityPct.value / 100));
      paintDirty.value = true;
      scheduleSave();
      status.value = "已填充像素";
    }
  },
  fillHit: (idx) => {
    const next = cloneBoard(strokes.value);
    const cur = next[idx]!;
    const fill: string | LinearFill = gradOn.value
      ? {
          type: gradType.value,
          a: gradA.value,
          b: gradB.value,
          angle: Number(gradAngle.value) || 0,
        }
      : fillColor.value;
    next[idx] = { ...cur, style: { ...styleOf(cur), fill } };
    pushHistory(next);
    status.value = gradOn.value ? "已填充渐变" : "已填充图形";
  },
  openText: (p) => {
    beginInlineTextAt(p);
  },
  placeImage: (p) => {
    void placeImage(p);
  },
  onPan: (x, y) => {
    pan.value = { x, y };
  },
  getPan: () => pan.value,
  getBoardScale: () => {
    const board = boardEl.value;
    if (!board) return Math.max(zoom.value, 0.05);
    const r = board.getBoundingClientRect();
    return Math.max(r.width / Math.max(boardBox.value.w, 1), 0.05);
  },
  alertLocked: () => {
    void fouAlert("当前图层已锁定，无法操作。请先解锁该图层。", "图层");
  },
  alertHidden: () => {
    void fouAlert("当前图层已隐藏，无法在此层绘制。请先显示该图层。", "图层");
  },
  formatDim: (pxLen) => `${pxToRealMm(pxLen, paper.value).toFixed(0)} mm`,
});

function paintCtx(): CanvasRenderingContext2D | null {
  return paintEl.value?.getContext("2d") ?? null;
}

function strokePaint(erase: boolean, from: { x: number; y: number }, to: { x: number; y: number }) {
  const ctx = paintCtx();
  if (!ctx) return;
  ctx.save();
  ctx.globalCompositeOperation = erase ? "destination-out" : "source-over";
  ctx.strokeStyle = color.value;
  ctx.globalAlpha = erase ? 1 : opacityPct.value / 100;
  ctx.lineWidth = width.value;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
  ctx.restore();
  paintDirty.value = true;
  markLocalEdit();
  scheduleSave();
}

function capturePointer(el: HTMLElement | null, pointerId: number) {
  strokeCaptureEl = el;
  strokePtrId = pointerId;
  strokeCaptureEl?.setPointerCapture?.(pointerId);
}

function unbindStrokePointer() {
  strokeUnbind?.();
  strokeUnbind = null;
}

function bindStrokePointer() {
  unbindStrokePointer();
  const onWinMove = (ev: PointerEvent) => onMove(ev);
  const onWinEnd = (ev: PointerEvent) => {
    if (strokePtrId !== null && ev.pointerId !== strokePtrId && ev.type !== "pointercancel") return;
    endStrokeInteraction(true);
  };
  window.addEventListener("pointermove", onWinMove, true);
  window.addEventListener("pointerup", onWinEnd, true);
  window.addEventListener("pointercancel", onWinEnd, true);
  strokeUnbind = () => {
    window.removeEventListener("pointermove", onWinMove, true);
    window.removeEventListener("pointerup", onWinEnd, true);
    window.removeEventListener("pointercancel", onWinEnd, true);
  };
}

function releaseCapture() {
  if (strokeCaptureEl && strokePtrId !== null) {
    try {
      strokeCaptureEl.releasePointerCapture(strokePtrId);
    } catch {
      /* */
    }
  }
  strokeCaptureEl = null;
  strokePtrId = null;
}

function abortStrokeInteraction() {
  if (strokeEnding) return;
  strokeEnding = true;
  try {
    nodeDrag.value = null;
    engine.endSession(false);
    drawing.value = false;
    paintLast = null;
    draft.value = null;
    marqueeRect.value = null;
    unbindStrokePointer();
    releaseCapture();
  } finally {
    strokeEnding = false;
  }
}

function endStrokeInteraction(commit: boolean) {
  if (strokeEnding) return;
  strokeEnding = true;
  try {
    unbindStrokePointer();
    if (nodeDrag.value) {
      if (commit && nodeDrag.value.moved) pushHistory(cloneBoard(strokes.value));
      nodeDrag.value = null;
    }
    engine.endSession(commit);
    drawing.value = false;
    paintLast = null;
    releaseCapture();
    if (commit) syncMm();
  } finally {
    strokeEnding = false;
  }
}

function onLostCapture() {
  if (engine.isBusy() || drawing.value || nodeDrag.value || draft.value) {
    endStrokeInteraction(true);
  }
}

function onDown(e: PointerEvent) {
  closeCtx();
  const board = e.currentTarget as HTMLElement;
  const cad = !["brush"].includes(tool.value);
  const p = paperPt(e, cad);
  warnWhiteStrokeIfNeeded();
  capturePointer(board, e.pointerId);
  const needTrack = engine.pointerDown({
    p,
    pointerId: e.pointerId,
    shiftKey: e.shiftKey,
    clientX: e.clientX,
    clientY: e.clientY,
  });
  drawing.value = engine.isBusy();
  if (needTrack) {
    bindStrokePointer();
    markLocalEdit();
  } else {
    releaseCapture();
    unbindStrokePointer();
  }
  syncMm();
}

function onMove(e: PointerEvent) {
  if (strokePtrId !== null && e.pointerId !== strokePtrId) return;
  if (nodeDrag.value) {
    const np = paperPt(e, true);
    const d = nodeDrag.value;
    strokes.value = strokes.value.map((s) => (s.id === d.strokeId ? setStrokePoint(s, d.index, np) : s));
    nodeDrag.value = { ...d, moved: true };
    dirty.value = true;
    return;
  }
  const cad = !["brush"].includes(tool.value);
  const p = paperPt(e, cad);
  updateTrack(e);
  if (tool.value === "pan" && engine.getSession()?.kind === "pan") {
    engine.pointerMove(p, e.pointerId, e.buttons, e.shiftKey, e.clientX, e.clientY);
    if (!rulerRaf) {
      rulerRaf = requestAnimationFrame(() => {
        rulerRaf = 0;
        measureRuler();
      });
    }
    return;
  }
  engine.pointerMove(p, e.pointerId, e.buttons, e.shiftKey, e.clientX, e.clientY);
}

function warnWhiteStrokeIfNeeded() {
  const paperBg = (paper.value.bg || DEFAULT_PAPER_BG).toLowerCase();
  const stroke = color.value.toLowerCase();
  if (
    (stroke === "#ffffff" || stroke === "#fff" || stroke === "white") &&
    (paperBg === "#ffffff" || paperBg === "#fff" || paperBg === "white" || paperBg === DEFAULT_PAPER_BG.toLowerCase())
  ) {
    status.value = "当前边框是白色，在白纸上可能看不清";
  }
}

function commitDraft() {
  engine.forceCommitDraft();
}

function closePolyline() {
  engine.closePolyline();
}

function closeCurve() {
  engine.closeCurve();
}

function undo() {
  if (historyIdx.value <= 0) return;
  historyIdx.value -= 1;
  strokes.value = cloneBoard(history.value[historyIdx.value]!);
  dirty.value = true;
  scheduleSave();
}

function redo() {
  if (historyIdx.value >= history.value.length - 1) return;
  historyIdx.value += 1;
  strokes.value = cloneBoard(history.value[historyIdx.value]!);
  dirty.value = true;
  scheduleSave();
}

function clearAll() {
  pushHistory([]);
  draft.value = null;
  selectedIds.value = [];
  const ctx = paintCtx();
  if (ctx) {
    clearPaint(ctx);
    paintDirty.value = true;
    scheduleSave();
  }
}

function duplicateSelected() {
  const ids = selectedIds.value;
  if (!ids.length) return;
  const copies: Stroke[] = [];
  for (const id of ids) {
    const src = strokes.value.find((s) => s.id === id);
    if (!src) continue;
    copies.push({ ...translateStroke(structuredClone(src), snapPx.value, snapPx.value), id: newStrokeId() });
  }
  if (!copies.length) return;
  pushHistory([...strokes.value, ...copies]);
  selectedIds.value = copies.map((c) => c.id);
}

function deleteSelected() {
  const kill = new Set<string>();
  for (const id of selectedIds.value) {
    kill.add(id);
    const s = strokes.value.find((x) => x.id === id);
    if (s?.kind === "group") for (const c of s.children) kill.add(c);
  }
  if (!kill.size) {
    status.value = "请先选中要删除的矢量图形";
    return;
  }
  pushHistory(strokes.value.filter((s) => !kill.has(s.id)));
  selectedIds.value = [];
  status.value = "已删除选中图形";
}

function toggleHidden(id: string) {
  pushHistory(strokes.value.map((s) => (s.id === id ? { ...s, hidden: !s.hidden } : s)));
}

function moveLayer(id: string, dir: 1 | -1) {
  const i = strokes.value.findIndex((s) => s.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= strokes.value.length) return;
  const next = cloneBoard(strokes.value);
  const tmp = next[i]!;
  next[i] = next[j]!;
  next[j] = tmp;
  pushHistory(next);
}

function rotateSelected() {
  applyRotateDeg(90);
}

/** Duty: 可存绝对角度的图元（矩形/椭圆/贴图/文字）。 */
function angledSelection(): Stroke[] {
  return expandSelection(strokes.value, selectedIds.value).filter(
    (s) => s.kind === "rect" || s.kind === "ellipse" || s.kind === "image" || s.kind === "text",
  );
}

/** Duty: 顶栏角度框同步为当前选中绝对角（单选）；多选/无线角图元则保持相对增量提示。 */
function syncRotationAbsInput() {
  const items = angledSelection();
  if (items.length === 1) {
    const r = Number(items[0]!.rotation) || 0;
    rotateDegInput.value = String(Math.round((((r % 360) + 360) % 360) * 10) / 10);
  }
}

function applyRotateDeg(deg?: number) {
  const n = deg ?? Number(rotateDegInput.value);
  if (!selectedIds.value.length || !Number.isFinite(n) || n === 0) return;
  pushHistory(rotateSelection(strokes.value, selectedIds.value, n));
  syncMm();
  syncRotationAbsInput();
  status.value = `已旋转 ${n}°`;
}

/** Duty: 单选可转图元时写入绝对角度；否则按相对增量旋转。 */
function applyRotationFromInput() {
  if (!selectedIds.value.length) {
    void fouAlert("选中图形后再设置旋转角度。", "请先选中");
    return;
  }
  const raw = Number(rotateDegInput.value);
  if (!Number.isFinite(raw)) {
    void fouAlert("请输入数字角度（度）。", "角度无效");
    return;
  }
  const items = angledSelection();
  if (items.length === 1) {
    let target = ((raw % 360) + 360) % 360;
    if (target > 180) target -= 360;
    const cur = Number(items[0]!.rotation) || 0;
    let delta = target - cur;
    delta = ((delta % 360) + 360) % 360;
    if (delta > 180) delta -= 360;
    if (Math.abs(delta) < 0.05) {
      rotateDegInput.value = String(Math.round(target * 10) / 10);
      return;
    }
    pushHistory(rotateSelection(strokes.value, selectedIds.value, delta));
    syncMm();
    syncRotationAbsInput();
    status.value = `已设为 ${Math.round(target * 10) / 10}°`;
    return;
  }
  if (Math.abs(raw) < 0.05) return;
  pushHistory(rotateSelection(strokes.value, selectedIds.value, raw));
  syncMm();
  status.value = `已相对旋转 ${Math.round(raw * 10) / 10}°`;
}

function mirrorSelected(axis: "h" | "v") {
  if (!selectedIds.value.length) return;
  pushHistory(mirrorSelection(strokes.value, selectedIds.value, axis));
  syncMm();
  status.value = axis === "h" ? "已水平镜像" : "已垂直镜像";
}

function toggleNodeEdit() {
  const s = selectedStroke();
  if (!s || (s.kind !== "curve" && s.kind !== "polygon")) {
    void fouAlert("请先选中一条曲线或多边形。", "节点编辑");
    return;
  }
  nodeEditOn.value = !nodeEditOn.value;
  if (nodeEditOn.value) tool.value = "select";
  status.value = nodeEditOn.value ? "节点编辑：拖动方块改形，Esc 退出" : "已退出节点编辑";
}

const nodeMarks = computed(() => {
  if (!nodeEditOn.value || selectedIds.value.length !== 1) return [];
  const s = strokes.value.find((x) => x.id === selectedIds.value[0]);
  if (!s || (s.kind !== "curve" && s.kind !== "polygon")) return [];
  const z = Math.max(rulerLayout.value.z, 0.05);
  const size = 9 / z;
  return s.points.map((p, index) => ({
    strokeId: s.id,
    index,
    x: p.x - size / 2,
    y: p.y - size / 2,
    w: size,
    h: size,
  }));
});

function startNodeDrag(strokeId: string, index: number, e: PointerEvent) {
  e.preventDefault();
  e.stopPropagation();
  closeCtx();
  nodeEditOn.value = true;
  tool.value = "select";
  nodeDrag.value = { strokeId, index, moved: false };
  drawing.value = true;
  const board = (e.currentTarget as Element).closest?.(".csk-board") as HTMLElement | null;
  strokeCaptureEl = board ?? (e.currentTarget as unknown as HTMLElement);
  strokePtrId = e.pointerId;
  strokeCaptureEl.setPointerCapture?.(e.pointerId);
  bindStrokePointer();
}

function startRotateHandle(e: PointerEvent) {
  e.preventDefault();
  e.stopPropagation();
  closeCtx();
  if (!selectedIds.value.length) return;
  const box = selectionUnionBox();
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const p = paperPt(e, false);
  const board = (e.currentTarget as Element).closest?.(".csk-board") as HTMLElement | null;
  capturePointer(board ?? (e.currentTarget as unknown as HTMLElement), e.pointerId);
  const ok = engine.pointerDownRotate(cx, cy, p, e.pointerId, e.clientX, e.clientY);
  if (ok) {
    drawing.value = true;
    bindStrokePointer();
    markLocalEdit();
  } else {
    releaseCapture();
  }
}

const rotateHandleMark = computed(() => {
  if (!selectedIds.value.length || nodeEditOn.value) return null;
  const box = selectionUnionBox();
  const z = Math.max(rulerLayout.value.z, 0.05);
  const cx = box.x + box.w / 2;
  const top = box.y;
  const stem = 40 / z;
  const size = 28 / z;
  return { cx, cy: top - stem, stemY: top, size };
});

async function refreshAlbum() {
  if (!props.workspace) {
    albumEntries.value = [];
    return;
  }
  const list = await listAlbumEntries(props.workspace);
  const next: Array<AlbumEntry & { src: string }> = [];
  for (const e of list) {
    try {
      next.push({ ...e, src: await canvasImageDataUrl(props.workspace, e.rel) });
    } catch {
      next.push({ ...e, src: "" });
    }
  }
  albumEntries.value = next;
}

async function insertAlbumRel(rel: string, at?: { x: number; y: number }) {
  if (!props.workspace) return;
  const ly = layerOf(activeLayerId.value);
  if (ly?.hidden || ly?.locked) {
    void fouAlert("当前图层已隐藏或锁定，无法贴图。", "图册");
    return;
  }
  try {
    const assetRel = await ensureAlbumAssetInSketch(props.workspace, rel);
    const url = await invoke<string>("xu_read_image_data_url", { path: canvasAbs(props.workspace, assetRel) });
    imageUrls.value = { ...imageUrls.value, [assetRel]: url };
    const p = at ?? { x: page.value.w / 2 - 120, y: page.value.h / 2 - 90 };
    const id = newStrokeId();
    pushHistory([
      ...strokes.value,
      {
        id,
        kind: "image",
        x: p.x,
        y: p.y,
        w: 240,
        h: 180,
        src: assetRel,
        style: { ...currentStyle.value },
        layerId: activeLayerId.value,
      },
    ]);
    selectedIds.value = [id];
    tool.value = "select";
    status.value = "已从图册插入";
    await refreshAlbum();
  } catch (err) {
    void fouAlert(String(err instanceof Error ? err.message : err), "插入图册失败");
  }
}

function sameWs(a: string, b: string): boolean {
  return a.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase() === b.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

function alignSelected(dir: AlignDir, relative: AlignRelative = "selection") {
  if (!selectedIds.value.length) return;
  pushHistory(alignStrokes(strokes.value, selectedIds.value, dir, page.value, relative));
  syncMm();
}

function distributeSelected(axis: "h" | "v") {
  if (expandSelection(strokes.value, selectedIds.value).filter((s) => s.kind !== "group").length < 3) {
    void fouAlert("分布需要至少选中 3 个图形（按住 Shift 点选）。", "对齐分布");
    return;
  }
  pushHistory(distributeStrokes(strokes.value, selectedIds.value, axis));
  syncMm();
}

function groupSelected() {
  const r = groupStrokes(strokes.value, selectedIds.value, activeLayerId.value);
  if (!r) {
    void fouAlert("请至少选中 2 个未组合图形。", "组合");
    return;
  }
  pushHistory(r.next);
  selectedIds.value = [r.groupId];
}

function ungroupSelected() {
  const next = ungroupStrokes(strokes.value, selectedIds.value);
  if (next === strokes.value) {
    void fouAlert("请先选中组合。", "打散");
    return;
  }
  pushHistory(next);
  selectedIds.value = [];
}

function zOrder(mode: "front" | "back" | "up" | "down") {
  const id = selectedId.value;
  if (!id) return;
  pushHistory(reorderStroke(strokes.value, id, mode));
}

function selectedStroke(): Stroke | undefined {
  return strokes.value.find((s) => s.id === selectedId.value);
}

function selBox(id: string) {
  const s = strokes.value.find((x) => x.id === id);
  if (!s) return { x: 0, y: 0, w: 0, h: 0 };
  if (s.kind === "group") return groupBBox(strokes.value, s);
  return strokeBBox(s);
}

function selectionUnionBox() {
  return unionBBox(expandSelection(strokes.value, selectedIds.value).filter((s) => s.kind !== "group"));
}

function handleOrigin(box: { x: number; y: number; w: number; h: number }, h: ScaleHandleId) {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  switch (h) {
    case "nw":
      return { x: box.x + box.w, y: box.y + box.h };
    case "n":
      return { x: cx, y: box.y + box.h };
    case "ne":
      return { x: box.x, y: box.y + box.h };
    case "e":
      return { x: box.x, y: cy };
    case "se":
      return { x: box.x, y: box.y };
    case "s":
      return { x: cx, y: box.y };
    case "sw":
      return { x: box.x + box.w, y: box.y };
    case "w":
      return { x: box.x + box.w, y: cy };
  }
}

function handlePos(box: { x: number; y: number; w: number; h: number }, h: ScaleHandleId) {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  switch (h) {
    case "nw":
      return { x: box.x, y: box.y };
    case "n":
      return { x: cx, y: box.y };
    case "ne":
      return { x: box.x + box.w, y: box.y };
    case "e":
      return { x: box.x + box.w, y: cy };
    case "se":
      return { x: box.x + box.w, y: box.y + box.h };
    case "s":
      return { x: cx, y: box.y + box.h };
    case "sw":
      return { x: box.x, y: box.y + box.h };
    case "w":
      return { x: box.x, y: cy };
  }
}

const scaleHandleMarks = computed(() => {
  if (!selectedIds.value.length || nodeEditOn.value) return [];
  const box = selectionUnionBox();
  const z = Math.max(rulerLayout.value.z, 0.05);
  const size = 8 / z;
  return SCALE_HANDLES.map((id) => {
    const p = handlePos(box, id);
    return { id, x: p.x - size / 2, y: p.y - size / 2, w: size, h: size, cursor: HANDLE_CURSOR[id] };
  });
});

function startScale(handle: ScaleHandleId, e: PointerEvent) {
  e.preventDefault();
  e.stopPropagation();
  closeCtx();
  const box = selectionUnionBox();
  if (box.w < 0.5 && box.h < 0.5) return;
  const origin = handleOrigin(box, handle);
  const hp = handlePos(box, handle);
  const board = (e.currentTarget as Element).closest?.(".csk-board") as HTMLElement | null;
  capturePointer(board ?? (e.currentTarget as unknown as HTMLElement), e.pointerId);
  const paperP = paperPt(e, false);
  if (!engine.pointerDownScale(handle, origin, hp.x, hp.y, e.pointerId, e.clientX, e.clientY, paperP)) {
    releaseCapture();
    return;
  }
  drawing.value = true;
  bindStrokePointer();
  markLocalEdit();
}

function syncMm() {
  if (!selectedIds.value.length) {
    mmX.value = mmY.value = mmW.value = mmH.value = "";
    return;
  }
  const b = selectionUnionBox();
  const ppr = paper.value;
  mmX.value = pxToRealMm(b.x, ppr).toFixed(0);
  mmY.value = pxToRealMm(b.y, ppr).toFixed(0);
  mmW.value = pxToRealMm(b.w, ppr).toFixed(0);
  mmH.value = pxToRealMm(b.h, ppr).toFixed(0);
  syncRotationAbsInput();
}

function applyMm() {
  if (!selectedIds.value.length) return;
  const ids = selectedIds.value;
  const b = selectionUnionBox();
  const ppr = paper.value;
  const nx = realMmToPx(Number(mmX.value) || 0, ppr);
  const ny = realMmToPx(Number(mmY.value) || 0, ppr);
  const nw = realMmToPx(Number(mmW.value) || 0, ppr);
  const nh = realMmToPx(Number(mmH.value) || 0, ppr);
  let next = translateSelection(strokes.value, ids, nx - b.x, ny - b.y);
  const sx = b.w > 0.1 ? nw / b.w : 1;
  const sy = b.h > 0.1 ? nh / b.h : 1;
  next = scaleSelection(next, ids, { x: nx, y: ny }, sx, sy);
  pushHistory(next);
}

function focusTextInput(selectAll: boolean) {
  void nextTick(() => {
    const el = textInputEl.value;
    if (!el) return;
    el.focus();
    if (selectAll) el.select();
  });
}

/** Duty: 在纸面点下落点开始内联输入（CDR：点画布出文字框）。 */
function beginInlineTextAt(p: { x: number; y: number }) {
  if (textInlineOn.value) commitInlineText();
  const fs = Math.max(8, Math.min(200, Math.round(Number(textFontSize.value)) || 18));
  const id = newStrokeId();
  pushHistory([
    ...strokes.value,
    {
      id,
      kind: "text",
      x: p.x,
      y: p.y,
      text: "文字",
      style: { ...currentStyle.value, fontSize: fs },
      layerId: activeLayerId.value,
    },
  ]);
  textEditingId.value = id;
  textPos.value = { x: p.x, y: p.y };
  textDraft.value = "文字";
  textFontSize.value = fs;
  selectedIds.value = [id];
  textInlineOn.value = true;
  status.value = "输入文字 · Ctrl+Enter 完成 · Esc 取消 · 可多行";
  focusTextInput(true);
}

/** Duty: 双击已有文字进入内联编辑。 */
function openTextEdit(s: Stroke) {
  if (s.kind !== "text") return;
  if (textInlineOn.value) commitInlineText();
  textEditingId.value = s.id;
  textPos.value = { x: s.x, y: s.y };
  textDraft.value = s.text;
  textFontSize.value = styleOf(s).fontSize ?? 18;
  selectedIds.value = [s.id];
  textInlineOn.value = true;
  focusTextInput(true);
}

/** Duty: 提交内联文字；空内容则删除新建字。 */
function commitInlineText() {
  if (!textInlineOn.value) return;
  textInlineOn.value = false;
  const editId = textEditingId.value;
  textEditingId.value = null;
  const t = textDraft.value.trim();
  const fs = Math.max(8, Math.min(200, Math.round(Number(textFontSize.value)) || 18));
  if (!editId) {
    tool.value = "select";
    return;
  }
  if (!t) {
    pushHistory(strokes.value.filter((s) => s.id !== editId));
    selectedIds.value = [];
    tool.value = "select";
    status.value = "已取消空文字";
    return;
  }
  pushHistory(
    strokes.value.map((s) =>
      s.id === editId && s.kind === "text"
        ? { ...s, text: t, x: textPos.value.x, y: textPos.value.y, style: { ...styleOf(s), fontSize: fs, color: color.value, fontBold: textFontBold.value, fontFamily: textFontFamily.value } }
        : s,
    ),
  );
  selectedIds.value = [editId];
  tool.value = "select";
  status.value = "已添加文字 · 可拖移、拉角缩放";
}

/** Duty: Esc 取消内联；若仍是默认「文字」则删掉。 */
function cancelInlineText() {
  if (!textInlineOn.value) return;
  textInlineOn.value = false;
  const editId = textEditingId.value;
  textEditingId.value = null;
  if (editId && (textDraft.value.trim() === "" || textDraft.value.trim() === "文字")) {
    pushHistory(strokes.value.filter((s) => s.id !== editId));
    selectedIds.value = [];
  }
  tool.value = "select";
  status.value = "已取消文字输入";
}

/** Duty: 字号写回选中文字。 */
function applyFontSizeToSelected() {
  const fs = Math.max(8, Math.min(200, Math.round(Number(textFontSize.value)) || 18));
  textFontSize.value = fs;
  const ids = selectedIds.value;
  if (!ids.length) return;
  const idset = new Set(ids);
  pushHistory(
    strokes.value.map((s) =>
      idset.has(s.id) && s.kind === "text" ? { ...s, style: { ...styleOf(s), fontSize: fs } } : s,
    ),
  );
  status.value = `字号 ${fs}`;
}

async function placeImage(p: { x: number; y: number }) {
  const picked = await openFileDialog({
    multiple: false,
    filters: [{ name: "图片", extensions: ["png", "jpg", "jpeg", "webp", "gif"] }],
  });
  const src = typeof picked === "string" ? picked : Array.isArray(picked) ? picked[0] : "";
  if (!src) {
    tool.value = "select";
    return;
  }
  try {
    const name = src.replace(/\\/g, "/").split("/").pop() || "image.png";
    await mkdirRecursive(props.workspace, ASSET_DIR);
    const rel = `${ASSET_DIR}/${name.replace(/[^\w.\u4e00-\u9fff-]+/g, "_")}`;
    await importFileIntoWorkspace(props.workspace, src, rel);
    const url = await invoke<string>("xu_read_image_data_url", { path: canvasAbs(props.workspace, rel) });
    imageUrls.value = { ...imageUrls.value, [rel]: url };
    const id = newStrokeId();
    pushHistory([
      ...strokes.value,
      {
        id,
        kind: "image",
        x: p.x,
        y: p.y,
        w: 240,
        h: 180,
        src: rel,
        style: { ...currentStyle.value },
        layerId: activeLayerId.value,
      },
    ]);
    selectedIds.value = [id];
    tool.value = "select";
    status.value = "已贴图 · 可拖移缩放";
  } catch (err) {
    tool.value = "select";
    void fouAlert(String(err instanceof Error ? err.message : err), "贴图失败");
  }
}

/** Duty: 点工具栏「贴图」立刻选文件（CDR），落在纸心。 */
async function placeImageFromTool() {
  await placeImage({ x: page.value.w / 2 - 120, y: page.value.h / 2 - 90 });
}

/** Duty: 左侧工具点击；贴图立刻选文件；文字仅切工具，点画布落字。 */
function onPickTool(id: Tool) {
  tool.value = id;
  if (id === "text") {
    status.value = "文字工具：在画布上点击放置，直接输入";
  } else if (id === "image") void placeImageFromTool();
}

async function loadImageUrls(list: Stroke[]) {
  const next: Record<string, string> = {};
  for (const s of list) {
    if (s.kind !== "image") continue;
    try {
      next[s.src] = await invoke<string>("xu_read_image_data_url", { path: canvasAbs(props.workspace, s.src) });
    } catch {
      /* missing asset */
    }
  }
  imageUrls.value = next;
}

function onWheel(e: WheelEvent) {
  if (e.ctrlKey || e.metaKey) {
    e.preventDefault();
    const nextZ = zoom.value + (e.deltaY < 0 ? 0.1 : -0.1);
    zoom.value = Math.min(4, Math.max(0.15, nextZ));
  }
}

const TOOL_KEYS: Record<string, Tool> = {
  v: "select",
  b: "brush",
  l: "line",
  r: "rect",
  o: "ellipse",
  p: "polygon",
  y: "polyline",
  c: "curve",
  a: "arrow",
  m: "dim",
  t: "text",
  i: "image",
  h: "pan",
};

function onKey(e: KeyboardEvent) {
  if (!isActive.value) return;
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
  if (e.code === "Space" && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault();
    if (toolBeforeSpace == null && tool.value !== "pan") {
      toolBeforeSpace = tool.value;
      tool.value = "pan";
      status.value = "空格临时平移 · 松开恢复";
    }
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
    e.preventDefault();
    undo();
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
    e.preventDefault();
    redo();
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d") {
    e.preventDefault();
    duplicateSelected();
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c") {
    e.preventDefault();
    void copySelectedStrokes();
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "x") {
    e.preventDefault();
    void cutSelectedStrokes();
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "v") {
    e.preventDefault();
    void pasteClipboardStrokes();
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
    e.preventDefault();
    void save();
  } else if ((e.ctrlKey || e.metaKey) && e.key === "0") {
    e.preventDefault();
    fitPage();
  } else if ((e.ctrlKey || e.metaKey) && e.key === "1") {
    e.preventDefault();
    fitSelection();
  } else if (e.key === "Delete" || e.key === "Backspace") {
    deleteSelected();
  } else if (e.key === "Enter" && tool.value === "polyline") {
    closePolyline();
  } else if (e.key === "Enter" && tool.value === "curve") {
    closeCurve();
  } else if (e.key === "Escape") {
    if (textInlineOn.value) {
      e.preventDefault();
      cancelInlineText();
      return;
    }
    abortStrokeInteraction();
    polyPts.value = [];
    curvePts.value = [];
    nodeEditOn.value = false;
    draggingGuide.value = null;
    closeCtx();
  } else if (e.key === "Enter" && nodeEditOn.value) {
    nodeEditOn.value = false;
    status.value = "已退出节点编辑";
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "g") {
    e.preventDefault();
    if (e.shiftKey) ungroupSelected();
    else groupSelected();
  } else if (e.key === "[" ) {
    const nextW = WIDTHS[Math.max(0, WIDTHS.indexOf(width.value as (typeof WIDTHS)[number]) - 1)] ?? 1;
    setStrokeWidth(nextW);
  } else if (e.key === "]") {
    const i = WIDTHS.indexOf(width.value as (typeof WIDTHS)[number]);
    setStrokeWidth(WIDTHS[Math.min(WIDTHS.length - 1, i + 1)] ?? 16);
  } else if (!e.ctrlKey && !e.metaKey && !e.altKey) {
    const next = TOOL_KEYS[e.key.toLowerCase()];
    if (next) onPickTool(next);
  }
}

function onKeyUp(e: KeyboardEvent) {
  if (!isActive.value) return;
  if (e.code !== "Space") return;
  if (toolBeforeSpace != null) {
    tool.value = toolBeforeSpace;
    toolBeforeSpace = null;
    status.value = "";
  }
}

function scheduleSave() {
  if (saveTimer) window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    saveChain = saveChain.then(() => save()).catch(() => undefined);
  }, 400);
}

function sizePaintCanvas() {
  const el = paintEl.value;
  if (!el) return;
  const { w, h } = page.value;
  if (el.width === w && el.height === h) return;
  const prev = document.createElement("canvas");
  prev.width = el.width;
  prev.height = el.height;
  const pctx = prev.getContext("2d");
  const ctx = el.getContext("2d");
  if (pctx && ctx && el.width && el.height) pctx.drawImage(el, 0, 0);
  el.width = w;
  el.height = h;
  if (ctx && pctx) ctx.drawImage(prev, 0, 0);
}

async function save() {
  if (!props.workspace) {
    status.value = "请先选择工作区";
    return;
  }
  const gen = ++saveGen;
  await ensureCanvasDirs(props.workspace);
  if (gen !== saveGen) return;
  const payload = JSON.stringify(
    {
      version: 5,
      paper: paper.value,
      deskBg: deskBg.value,
      strokes: strokes.value,
      guides: guides.value,
      layers: sketchLayers.value,
    },
    null,
    2,
  );
  const needPaint = !!(paintEl.value && paintDirty.value);
  const paintSnapshot = needPaint && paintEl.value ? paintEl.value : null;
  await writeCanvasText(props.workspace, FILE, payload);
  if (gen !== saveGen) return;
  if (paintSnapshot && needPaint) {
    const bytes = await canvasPngBytes(paintSnapshot);
    if (gen !== saveGen) return;
    await invoke("xu_write_bytes_file", { path: canvasAbs(props.workspace, PAINT_REL), bytes: Array.from(bytes) });
    if (gen !== saveGen) return;
    paintDirty.value = false;
  }
  lastLoaded.value = payload;
  dirty.value = false;
  // 写盘刚完成：短时禁止轮询读到「写前旧快照」再冲内存
  suppressLoadUntil = Date.now() + 2500;
  status.value = "已保存";
}

async function loadPaint() {
  await nextTick();
  sizePaintCanvas();
  const ctx = paintCtx();
  if (!ctx) return;
  // CDR-lite：不再恢复 paint.png。旧像素层看得见却选不中，只会误导用户。
  clearPaint(ctx);
  paintDirty.value = true;
  status.value = "已清除旧像素笔迹 · 请用左侧画笔绘制（可选中拉伸）";
}

/** Duty: 给 Tauri FS invoke 加超时，避免永久占住 load 互斥。 */
function withFsTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = window.setTimeout(() => reject(new Error(`${label} 超时 ${ms}ms`)), ms);
    p.then(
      (v) => {
        window.clearTimeout(t);
        resolve(v);
      },
      (e) => {
        window.clearTimeout(t);
        reject(e);
      },
    );
  });
}

/** Duty: await 之后若 save/本地编辑已推进，则丢弃本轮 load（防旧盘覆盖新图）。 */
function loadStaleAfterIo(
  epochAtStart: number,
  saveGenAtStart: number,
  lastLoadedAtStart: string,
  force: boolean,
): boolean {
  if (
    saveGen !== saveGenAtStart ||
    lastLoaded.value !== lastLoadedAtStart ||
    localEditEpoch !== epochAtStart ||
    Date.now() < suppressLoadUntil ||
    dirty.value ||
    paintDirty.value
  ) {
    if (force) pendingExternalLoad = true;
    return true;
  }
  return false;
}

async function load(force = false) {
  if (!props.workspace) return;
  // 互斥：上一次 load 卡在 FS IPC 时禁止再叠（日志证 inFlight 可飙到 50+ 导致未响应）
  if (loadInFlight > 0) {
    if (force) pendingExternalLoad = true;
    return;
  }
  loadInFlight = 1;
  const epochAtStart = localEditEpoch;
  try {
    const now = Date.now();
    if (now < suppressLoadUntil) {
      if (force) pendingExternalLoad = true;
      return;
    }
    if (pendingExternalLoad && !force) {
      force = true;
      pendingExternalLoad = false;
    }
    const saveGenAtStart = saveGen;
    const lastLoadedAtStart = lastLoaded.value;
    // 仅首次/强制确保目录，避免每 1.5s 叠 4 次 mkdir IPC
    if (!canvasDirsReady || force) {
      await withFsTimeout(ensureCanvasDirs(props.workspace), 8000, "ensureCanvasDirs");
      canvasDirsReady = true;
    }
    const raw = await withFsTimeout(readCanvasText(props.workspace, FILE), 8000, "readCanvasText");
    if (loadStaleAfterIo(epochAtStart, saveGenAtStart, lastLoadedAtStart, force)) {
      return;
    }
    if (!force && raw === lastLoaded.value) {
      return;
    }
    const externalUpdate = raw !== lastLoaded.value;
    if (dirty.value || paintDirty.value) {
      return;
    }
    if (engine.isBusy() || nodeDrag.value || draft.value) {
      return;
    }
    if (polyPts.value.length || curvePts.value.length) {
      return;
    }
    if (strokePtrId !== null) {
      return;
    }
    if (Date.now() < suppressLoadUntil || localEditEpoch !== epochAtStart) {
      if (force) pendingExternalLoad = true;
      return;
    }
    const parsed = JSON.parse(raw) as {
      paper?: unknown;
      deskBg?: unknown;
      guides?: unknown;
      layers?: unknown;
    };
    const nextLayers = parseLayers(parsed.layers);
    const next = ensureStrokeLayers(normalizeStrokes(JSON.parse(raw)), nextLayers);
    if (lastLoaded.value) {
      try {
        const knownN = normalizeStrokes(JSON.parse(lastLoaded.value)).length;
        const staleEmpty = knownN > 0 && next.length === 0;
        const staleIdle = !force && knownN > next.length;
        if (staleEmpty || staleIdle) {
          dirty.value = true;
          scheduleSave();
          return;
        }
      } catch {
        /* lastLoaded 损坏则继续按磁盘 */
      }
    }
    if (loadStaleAfterIo(epochAtStart, saveGenAtStart, lastLoadedAtStart, force)) {
      return;
    }
    paper.value = parsePaper(parsed.paper);
    deskBg.value = parseDeskBg(parsed.deskBg);
    guides.value = parseGuides(parsed.guides);
    sketchLayers.value = nextLayers;
    const prevLayer = activeLayerId.value;
    const keepLayer = sketchLayers.value.some((l) => l.id === prevLayer)
      ? prevLayer
      : (sketchLayers.value[0]?.id ?? defaultLayers()[0]!.id);
    activeLayerId.value = keepLayer;
    if (!sketchLayers.value.some((l) => l.id === openLayerId.value)) {
      openLayerId.value = keepLayer;
    }
    strokes.value = next;
    history.value = [cloneBoard(next)];
    historyIdx.value = 0;
    lastLoaded.value = raw;
    dirty.value = false;
    await loadImageUrls(next);
    await loadPaint();
    status.value = externalUpdate && !force ? "已同步外部草图" : "已载入草图";
    syncMm();
    nextTick(() => measureRuler());
  } catch {
    if (strokes.value.length || dirty.value || paintDirty.value) return;
    if (localEditEpoch !== epochAtStart) return;
    strokes.value = [];
    history.value = [[]];
    historyIdx.value = 0;
    paper.value = { ...DEFAULT_PAPER };
    deskBg.value = DEFAULT_DESK_BG;
    guides.value = { v: [], h: [] };
    sketchLayers.value = defaultLayers();
    activeLayerId.value = sketchLayers.value[0]!.id;
    await loadPaint();
  } finally {
    loadInFlight = 0;
  }
}

async function onExport(kind: ExportKind) {
  exportKind.value = kind;
  exportScope.value = "page";
  exportDialogVisible.value = true;
}

async function confirmExport() {
  const kind = exportKind.value;
  const scope = exportScope.value;
  exportDialogVisible.value = false;
  try {
    await save();
    const layerId = activeLayerId.value;
    const list =
      scope === "layer"
        ? strokes.value.filter((s) => (s.layerId || "") === layerId && s.kind !== "group")
        : strokes.value;
    const path = await exportSketch(props.workspace, list, kind, {
      page: page.value,
      paper: paper.value,
      paint: scope === "page" ? paintEl.value : null,
      scope,
      layerId: scope === "layer" ? layerId : undefined,
      includePaint: scope === "page",
    });
    const where = path || "工作区 .xu/canvas/export/";
    status.value = `已导出 ${kind.toUpperCase()}`;
    void fouAlert(
      scope === "layer"
        ? `已导出当前图层（仅矢量）到：\n${where}`
        : `已导出整页到：\n${where}`,
      "导出成功",
    );
  } catch (e) {
    void fouAlert(String(e instanceof Error ? e.message : e), "导出失败");
  }
}

function openPageDialog() {
  pageDraft.value = { ...paper.value, bg: paper.value.bg ?? DEFAULT_PAPER_BG };
  pageDialogVisible.value = true;
}

function applyPageDialog() {
  const d = pageDraft.value;
  paper.value = {
    w: Number(d.w) || DEFAULT_PAPER.w,
    h: Number(d.h) || DEFAULT_PAPER.h,
    unit: d.unit,
    dpi: Math.max(36, Math.min(600, Number(d.dpi) || 96)),
    scale: Math.max(0.001, Number(d.scale) || 1),
    bg: d.bg || DEFAULT_PAPER_BG,
  };
  pageDialogVisible.value = false;
  dirty.value = true;
  nextTick(() => sizePaintCanvas());
  scheduleSave();
  syncMm();
}

function onPreset(id: string) {
  presetId.value = id;
  pageDraft.value = applyPreset(pageDraft.value, id);
}

function onUnitChange(unit: string) {
  pageDraft.value = convertPaperUnit(pageDraft.value, unit as LengthUnit);
}

function swapOrient() {
  const d = pageDraft.value;
  pageDraft.value = { ...d, w: d.h, h: d.w };
}

function cycleScale() {
  const list = [1, 50, 100];
  const i = list.findIndex((s) => s === paper.value.scale);
  paper.value = { ...paper.value, scale: list[(i + 1) % list.length]! };
  dirty.value = true;
  scheduleSave();
  syncMm();
}

function openColorDialog() {
  colorPickTarget.value = "well";
  colorDialogVisible.value = true;
}

function openGradColor(which: "gradA" | "gradB") {
  colorPickTarget.value = which;
  colorDialogVisible.value = true;
}

function onColorConfirm(hex: string) {
  if (colorPickTarget.value === "gradA") {
    gradA.value = hex;
    colorPickTarget.value = "well";
    pushLiveGradient();
    return;
  }
  if (colorPickTarget.value === "gradB") {
    gradB.value = hex;
    colorPickTarget.value = "well";
    pushLiveGradient();
    return;
  }
  if (colorWell.value === "paperBg") {
    pageDraft.value = { ...pageDraft.value, bg: hex };
    paper.value = { ...paper.value, bg: hex };
    dirty.value = true;
    scheduleSave();
    return;
  }
  if (colorWell.value === "deskBg") {
    deskBg.value = hex;
    dirty.value = true;
    scheduleSave();
    return;
  }
  // CDR：取色确认默认写填充
  applyFillSwatch(hex);
}

/** Duty: 当前渐变对象（工具栏状态）。 */
function currentGradientFill(): LinearFill {
  return {
    type: gradType.value,
    a: gradA.value,
    b: gradB.value,
    angle: Number(gradAngle.value) || 0,
  };
}

/** Duty: 有选中且渐变开启时立刻写回填充。 */
function pushLiveGradient() {
  if (!gradOn.value || !selectedIds.value.length) return;
  const ids = new Set(selectedIds.value);
  const fill = currentGradientFill();
  pushHistory(strokes.value.map((s) => (ids.has(s.id) ? { ...s, style: { ...styleOf(s), fill } } : s)));
  status.value = "已更新渐变";
}

function applyGradientToSelected() {
  const ids = new Set(selectedIds.value);
  if (!ids.size) return;
  if (gradOn.value) {
    pushLiveGradient();
    return;
  }
  const fill = fillOn.value ? fillColor.value : null;
  pushHistory(strokes.value.map((s) => (ids.has(s.id) ? { ...s, style: { ...styleOf(s), fill } } : s)));
}

/** Duty: CDR 左键色板 → 填充。 */
function applyFillSwatch(hex: string) {
  if (colorWell.value === "paperBg" || colorWell.value === "deskBg") {
    onColorConfirm(hex);
    return;
  }
  fillColor.value = hex;
  fillOn.value = true;
  colorWell.value = "fill";
  gradOn.value = false;
  if (selectedIds.value.length) {
    const ids = new Set(selectedIds.value);
    pushHistory(strokes.value.map((s) => (ids.has(s.id) ? { ...s, style: { ...styleOf(s), fill: hex } } : s)));
    status.value = "已改填充色";
  }
}

/** Duty: CDR 右键色板 → 边框色。 */
function applyStrokeSwatch(hex: string, ev?: Event) {
  ev?.preventDefault();
  color.value = hex;
  colorWell.value = "stroke";
  if (selectedIds.value.length) {
    const ids = new Set(selectedIds.value);
    pushHistory(strokes.value.map((s) => (ids.has(s.id) ? { ...s, style: { ...styleOf(s), color: hex } } : s)));
    status.value = "已改边框色";
  }
}

/** @deprecated 兼容旧调用名 */
function applySwatch(hex: string) {
  applyFillSwatch(hex);
}

function clearFillOnSelected() {
  fillOn.value = false;
  gradOn.value = false;
  if (!selectedIds.value.length) return;
  const ids = new Set(selectedIds.value);
  pushHistory(strokes.value.map((s) => (ids.has(s.id) ? { ...s, style: { ...styleOf(s), fill: null } } : s)));
  status.value = "已取消填充";
}

function onFillWellContext(ev: MouseEvent) {
  ev.preventDefault();
  clearFillOnSelected();
}

/** Duty: 设置线宽；有选中则写回选中图元。 */
function setStrokeWidth(w: number) {
  width.value = w;
  if (!selectedIds.value.length) return;
  const ids = new Set(selectedIds.value);
  pushHistory(strokes.value.map((s) => (ids.has(s.id) ? { ...s, style: { ...styleOf(s), width: w } } : s)));
  status.value = `边框线宽 ${w}`;
}

/** Duty: 设置线型。 */
function setStrokeDash(d: StrokeDash) {
  strokeDash.value = d;
  if (!selectedIds.value.length) return;
  const ids = new Set(selectedIds.value);
  pushHistory(strokes.value.map((s) => (ids.has(s.id) ? { ...s, style: { ...styleOf(s), dash: d } } : s)));
  status.value = `线型 ${d}`;
}

function toggleGradOn() {
  gradOn.value = !gradOn.value;
  if (gradOn.value) {
    fillOn.value = true;
    pushLiveGradient();
  }
}

function onGradTypeChange(v: string) {
  gradType.value = v === "radial" ? "radial" : "linear";
  pushLiveGradient();
}

function onGradAngleChange() {
  pushLiveGradient();
}

/** Duty: 不透明度写回选中图元（无选中仅影响后续新建）。 */
function applyOpacityToSelected() {
  const n = Number(opacityPct.value);
  const op = Number.isFinite(n) && n > 0 ? Math.min(100, n) / 100 : 1;
  if (!selectedIds.value.length) return;
  const ids = new Set(selectedIds.value);
  pushHistory(strokes.value.map((s) => (ids.has(s.id) ? { ...s, style: { ...styleOf(s), opacity: op } } : s)));
  status.value = `不透明度 ${Math.round(op * 100)}%`;
}

/** Duty: 从选中图元同步工具栏样式控件。 */
function syncStyleFromSelection() {
  const s = selectedStroke();
  if (!s) return;
  const st = styleOf(s);
  color.value = st.color;
  width.value = st.width;
  strokeDash.value = st.dash || "solid";
  if (typeof st.opacity === "number" && Number.isFinite(st.opacity)) {
    opacityPct.value = Math.max(1, Math.min(100, Math.round(st.opacity * 100)));
  }
  if (s.kind === "text") {
    textFontSize.value = st.fontSize ?? 18;
    textFontBold.value = !!st.fontBold;
    textFontFamily.value = st.fontFamily || "ui-sans-serif, system-ui, sans-serif";
  }
  if (s.kind === "rect" && typeof s.rx === "number") {
    cornerRadius.value = s.rx;
  }
  if (isLinearFill(st.fill)) {
    gradOn.value = true;
    fillOn.value = true;
    gradA.value = st.fill.a;
    gradB.value = st.fill.b;
    gradAngle.value = st.fill.angle;
    gradType.value = st.fill.type === "radial" ? "radial" : "linear";
    fillColor.value = st.fill.a;
  } else if (st.fill && typeof st.fill === "string") {
    fillColor.value = st.fill;
    fillOn.value = true;
    gradOn.value = false;
  } else if (!st.fill) {
    fillOn.value = false;
    gradOn.value = false;
  }
}

/** Duty: 轮廓 dasharray（尺寸线默认虚线）。 */
function strokeDashAttr(s: Stroke): string | undefined {
  if (s.kind === "dim") {
    const d = dashArrayOf(styleOf(s).dash, styleOf(s).width);
    return d ?? "4 3";
  }
  return dashArrayOf(styleOf(s).dash, styleOf(s).width);
}

/** Duty: 清空像素层（画笔痕迹），矢量图元不动。 */
function clearPixelLayer() {
  const ctx = paintCtx();
  if (!ctx) return;
  clearPaint(ctx);
  paintDirty.value = true;
  markLocalEdit();
  scheduleSave();
  status.value = "已清除像素层 · 矢量图形仍在";
}

function svgFill(s: Stroke): string {
  const f = styleOf(s).fill;
  if (isLinearFill(f)) return `url(#g-${s.id})`;
  return solidFillAttr(f) === "none" ? "none" : solidFillAttr(f);
}

/** Duty: 线性渐变两端色（模板用，收窄类型）。 */
function linearFillEnds(s: Stroke): { a: string; b: string } {
  const f = styleOf(s).fill;
  if (isLinearFill(f)) return { a: f.a, b: f.b };
  return { a: "#000", b: "#fff" };
}

/** Duty: 画布预览用线性端点（与导出一致）。 */
function linearGradPct(s: Stroke): { x1: string; y1: string; x2: string; y2: string } {
  const f = styleOf(s).fill;
  if (isLinearFill(f)) return linearGradientEnds(f.angle);
  return { x1: "0%", y1: "0%", x2: "100%", y2: "0%" };
}

function isRadialGrad(s: Stroke): boolean {
  const f = styleOf(s).fill;
  return isLinearFill(f) && f.type === "radial";
}

function onLayerDragStart(id: string) {
  layerDragId.value = id;
}

function onLayerDrop(targetLayerId: string) {
  const from = layerDragId.value;
  layerDragId.value = null;
  const ids = from ? [from] : selectedIds.value;
  if (!ids.length) return;
  const set = new Set(ids);
  pushHistory(strokes.value.map((s) => (set.has(s.id) ? { ...s, layerId: targetLayerId } : s)));
}

function onLayerRowDragStart(lid: string) {
  layerDragLyId.value = lid;
}

function onLayerRowDrop(targetId: string) {
  const from = layerDragLyId.value;
  layerDragLyId.value = null;
  if (!from || from === targetId) return;
  const arr = [...sketchLayers.value];
  const fi = arr.findIndex((l) => l.id === from);
  const ti = arr.findIndex((l) => l.id === targetId);
  if (fi < 0 || ti < 0) return;
  const [item] = arr.splice(fi, 1);
  if (!item) return;
  arr.splice(ti, 0, item);
  sketchLayers.value = arr;
  dirty.value = true;
  scheduleSave();
}

function moveSelectedToLayer(lid: string) {
  if (!selectedIds.value.length) return;
  const ids = new Set(selectedIds.value);
  pushHistory(strokes.value.map((s) => (ids.has(s.id) ? { ...s, layerId: lid } : s)));
}

function addSketchLayer() {
  const ly: SketchLayer = { id: newLayerId(), name: `图层 ${sketchLayers.value.length + 1}` };
  sketchLayers.value = [...sketchLayers.value, ly];
  activeLayerId.value = ly.id;
  openLayerId.value = ly.id;
  dirty.value = true;
  scheduleSave();
}

function deleteSketchLayer(lid: string) {
  if (sketchLayers.value.length <= 1) {
    void fouAlert("至少保留一个图层。", "图层");
    return;
  }
  const idx = sketchLayers.value.findIndex((l) => l.id === lid);
  const fallback = sketchLayers.value[idx === 0 ? 1 : idx - 1]?.id ?? sketchLayers.value[0]!.id;
  sketchLayers.value = sketchLayers.value.filter((l) => l.id !== lid);
  pushHistory(strokes.value.map((s) => (s.layerId === lid ? { ...s, layerId: fallback } : s)));
  if (activeLayerId.value === lid) activeLayerId.value = fallback;
  dirty.value = true;
  scheduleSave();
}

function toggleLayerHidden(lid: string) {
  sketchLayers.value = sketchLayers.value.map((l) => (l.id === lid ? { ...l, hidden: !l.hidden } : l));
  dirty.value = true;
  scheduleSave();
}

function toggleLayerLocked(lid: string) {
  sketchLayers.value = sketchLayers.value.map((l) => (l.id === lid ? { ...l, locked: !l.locked } : l));
  dirty.value = true;
  scheduleSave();
}

function renameLayer(lid: string, name: string) {
  const n = name.trim();
  if (!n) return;
  sketchLayers.value = sketchLayers.value.map((l) => (l.id === lid ? { ...l, name: n } : l));
  dirty.value = true;
  scheduleSave();
}

function onBoardContextMenu(e: MouseEvent) {
  e.preventDefault();
  // CDR：右键合拢折线/曲线
  if (tool.value === "polyline" && polyPts.value.length >= 3) {
    closePolyline();
    return;
  }
  if (tool.value === "curve" && curvePts.value.length >= 2) {
    closeCurve();
    return;
  }
  if (tool.value === "polyline" || tool.value === "curve") {
    status.value = tool.value === "polyline" ? "折线至少 3 个点后右键合拢" : "曲线至少 2 个点后右键完成";
    return;
  }
  ctxMenu.value = { x: e.clientX, y: e.clientY };
}

/** Duty: 双击合拢折线/曲线，或编辑文字。 */
function onBoardDblClick() {
  if (tool.value === "polyline") {
    if (polyPts.value.length >= 4) polyPts.value = polyPts.value.slice(0, -1);
    closePolyline();
    return;
  }
  if (tool.value === "curve") {
    if (curvePts.value.length >= 3) curvePts.value = curvePts.value.slice(0, -1);
    closeCurve();
    return;
  }
  const s = selectedStroke();
  if (s?.kind === "text") openTextEdit(s);
}

function finishPolyOrCurve() {
  if (polyPts.value.length >= 3) {
    closePolyline();
    return;
  }
  if (curvePts.value.length >= 2) {
    closeCurve();
    return;
  }
  void fouAlert("折线至少 3 个点，曲线至少 2 个点后再点完成。", "完成图形");
}

function onLayerPanelDrop(targetId: string) {
  if (layerDragLyId.value) {
    onLayerRowDrop(targetId);
    return;
  }
  onLayerDrop(targetId);
}

function closeCtx() {
  ctxMenu.value = null;
}

function startLayerSplit(e: PointerEvent) {
  splitStart = e.clientX;
  splitW = layersWidth.value;
  const onMove = (ev: PointerEvent) => {
    layersWidth.value = Math.min(360, Math.max(120, splitW - (ev.clientX - splitStart)));
  };
  const onUp = () => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    writeLs("xu.canvas.layersWidth", String(layersWidth.value));
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
}

function measureRuler() {
  const paper = paperEl.value;
  const rh = rulerHEl.value;
  const rv = rulerVEl.value;
  if (!paper || !rh || !rv) return;
  const p = paper.getBoundingClientRect();
  const h = rh.getBoundingClientRect();
  const v = rv.getBoundingClientRect();
  const z = p.width / Math.max(page.value.w, 1);
  rulerLayout.value = {
    ox: p.left - h.left,
    oy: p.top - v.top,
    z,
    rhW: Math.max(1, Math.round(h.width)),
    rvH: Math.max(1, Math.round(v.height)),
    minX: (h.left - p.left) / z,
    maxX: (h.right - p.left) / z,
    minY: (v.top - p.top) / z,
    maxY: (v.bottom - p.top) / z,
  };
}

function paperFromEvent(e: PointerEvent): { x: number; y: number; z: number } {
  const el = paperEl.value;
  if (!el) return { x: 0, y: 0, z: 1 };
  const r = el.getBoundingClientRect();
  const z = r.width / Math.max(page.value.w, 1);
  return { x: (e.clientX - r.left) / z, y: (e.clientY - r.top) / z, z };
}

function onDeskScroll() {
  measureRuler();
}

const rulerHTicks = computed(() =>
  buildRulerTicks(rulerLayout.value.minX, rulerLayout.value.maxX, rulerLayout.value.z, paper.value),
);
const rulerVTicks = computed(() =>
  buildRulerTicks(rulerLayout.value.minY, rulerLayout.value.maxY, rulerLayout.value.z, paper.value),
);

const boardBox = computed(() => ({
  x: -PASTE,
  y: -PASTE,
  w: page.value.w + PASTE * 2,
  h: page.value.h + PASTE * 2,
}));

const liveGuides = computed(() => {
  const d = draggingGuide.value;
  if (!d) return guides.value;
  if (d.from === "new") {
    return d.axis === "v"
      ? { v: [...guides.value.v, d.pos], h: guides.value.h }
      : { v: guides.value.v, h: [...guides.value.h, d.pos] };
  }
  if (d.axis === "v") {
    const v = guides.value.v.slice();
    v[d.from] = d.pos;
    return { v, h: guides.value.h };
  }
  const h = guides.value.h.slice();
  h[d.from] = d.pos;
  return { v: guides.value.v, h };
});

function commitGuide(e: PointerEvent) {
  const d = draggingGuide.value;
  draggingGuide.value = null;
  if (!d) return;
  const rh = rulerHEl.value?.getBoundingClientRect();
  const rv = rulerVEl.value?.getBoundingClientRect();
  const drop =
    d.axis === "v" ? rh && e.clientY < rh.bottom + 4 : rv && e.clientX < rv.right + 4;
  const next = { v: [...guides.value.v], h: [...guides.value.h] };
  if (d.from === "new") {
    if (drop) return;
    if (d.axis === "v") next.v.push(d.pos);
    else next.h.push(d.pos);
  } else if (drop) {
    if (d.axis === "v") next.v.splice(d.from, 1);
    else next.h.splice(d.from, 1);
  } else if (d.axis === "v") next.v[d.from] = d.pos;
  else next.h[d.from] = d.pos;
  guides.value = next;
  dirty.value = true;
  scheduleSave();
}

function onGuideMove(e: PointerEvent) {
  const d = draggingGuide.value;
  if (!d) return;
  const p = paperFromEvent(e);
  draggingGuide.value = { ...d, pos: d.axis === "v" ? p.x : p.y };
}

function startGuide(axis: "v" | "h", e: PointerEvent, from: "new" | number = "new") {
  e.preventDefault();
  e.stopPropagation();
  (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
  const p = paperFromEvent(e);
  draggingGuide.value = { axis, pos: axis === "v" ? p.x : p.y, from };
  const onMove = (ev: PointerEvent) => onGuideMove(ev);
  const onUp = (ev: PointerEvent) => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    commitGuide(ev);
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
}

function clearGuides() {
  guides.value = { v: [], h: [] };
  dirty.value = true;
  scheduleSave();
}

function updateTrack(e: PointerEvent) {
  if (!isDrawTool.value) {
    track.value = null;
    if (draggingGuide.value) onGuideMove(e);
    return;
  }
  const p = paperFromEvent(e);
  track.value = { x: p.x, y: p.y };
  if (draggingGuide.value) onGuideMove(e);
}

function resetView() {
  pan.value = { x: 0, y: 0 };
  zoom.value = 1;
  const m = 64;
  deskEl.value?.scrollTo({ left: Math.max(0, PASTE - m), top: Math.max(0, PASTE - m) });
  nextTick(() => measureRuler());
}

/** Duty: 缩放并滚动使包围盒居中可见。 */
function fitToBox(box: { x: number; y: number; w: number; h: number }) {
  const desk = deskEl.value;
  if (!desk || box.w < 1 || box.h < 1) {
    resetView();
    return;
  }
  const pad = 48;
  const z = Math.min(4, Math.max(0.12, Math.min((desk.clientWidth - pad) / box.w, (desk.clientHeight - pad) / box.h)));
  zoom.value = z;
  pan.value = { x: 0, y: 0 };
  nextTick(() => {
    const cx = (PASTE + box.x + box.w / 2) * z;
    const cy = (PASTE + box.y + box.h / 2) * z;
    desk.scrollTo({
      left: Math.max(0, cx - desk.clientWidth / 2),
      top: Math.max(0, cy - desk.clientHeight / 2),
    });
    measureRuler();
  });
}

function fitPage() {
  fitToBox({ x: 0, y: 0, w: page.value.w, h: page.value.h });
  status.value = "已适应纸面";
}

function fitSelection() {
  if (!selectedIds.value.length) {
    fitPage();
    return;
  }
  const box = selectionUnionBox();
  if (box.w < 1 || box.h < 1) {
    fitPage();
    return;
  }
  fitToBox(box);
  status.value = "已适应选区";
}

async function copySelectedStrokes() {
  const list = expandSelection(strokes.value, selectedIds.value).filter((s) => s.kind !== "group");
  if (!list.length) return;
  await writeClipboardText(STROKE_CLIP_PREFIX + JSON.stringify(list));
  fouMsg.success(`已复制 ${list.length} 个图元`);
}

async function cutSelectedStrokes() {
  await copySelectedStrokes();
  deleteSelected();
}

async function pasteClipboardStrokes() {
  let raw = "";
  try {
    raw = await navigator.clipboard.readText();
  } catch {
    void fouAlert("无法读取剪贴板，请检查浏览器/系统权限。", "粘贴");
    return;
  }
  if (!raw.startsWith(STROKE_CLIP_PREFIX)) {
    void fouAlert("剪贴板里没有可粘贴的草图图元。", "粘贴");
    return;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(STROKE_CLIP_PREFIX.length));
  } catch {
    void fouAlert("剪贴板图元数据无效。", "粘贴");
    return;
  }
  if (!Array.isArray(parsed) || !parsed.length) return;
  const clones: Stroke[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const s = item as Stroke;
    if (!s.kind || s.kind === "group") continue;
    const nid = newStrokeId();
    clones.push(
      translateStroke(
        { ...s, id: nid, parentId: undefined, layerId: activeLayerId.value },
        24,
        24,
      ),
    );
  }
  if (!clones.length) return;
  pushHistory([...strokes.value, ...clones]);
  selectedIds.value = clones.map((c) => c.id);
  tool.value = "select";
  status.value = `已粘贴 ${clones.length} 个图元`;
  syncMm();
}

function applyFontBoldToSelected() {
  textFontBold.value = !textFontBold.value;
  const ids = new Set(selectedIds.value);
  if (!ids.size) return;
  pushHistory(
    strokes.value.map((s) =>
      ids.has(s.id) && s.kind === "text"
        ? { ...s, style: { ...styleOf(s), fontBold: textFontBold.value } }
        : s,
    ),
  );
}

function applyFontFamilyToSelected(fam: string) {
  textFontFamily.value = fam;
  const ids = new Set(selectedIds.value);
  if (!ids.size) return;
  pushHistory(
    strokes.value.map((s) =>
      ids.has(s.id) && s.kind === "text"
        ? { ...s, style: { ...styleOf(s), fontFamily: fam } }
        : s,
    ),
  );
}

function applyCornerRadiusToSelected() {
  const rx = Math.max(0, Math.min(200, Math.round(Number(cornerRadius.value)) || 0));
  cornerRadius.value = rx;
  const ids = new Set(selectedIds.value);
  if (!ids.size) return;
  pushHistory(
    strokes.value.map((s) =>
      ids.has(s.id) && s.kind === "rect" ? { ...s, rx: rx > 0 ? rx : undefined } : s,
    ),
  );
}

function onVis() {
  // 仅在有排队外部刷新时再读盘；可见性变化不要无条件 load（易与挂起 IPC 叠死）
  if (document.visibilityState === "visible" && pendingExternalLoad && loadInFlight === 0) {
    void load(true);
  }
}

watch(
  () => props.workspace,
  () => {
    dirty.value = false;
    paintDirty.value = false;
    void load(true);
  },
);

watch(
  () => page.value.w + page.value.h,
  () => nextTick(() => { sizePaintCanvas(); measureRuler(); }),
);

watch([zoom, () => pan.value.x, () => pan.value.y], () => nextTick(() => measureRuler()));

watch(selectedId, () => {
  syncMm();
  const s = selectedStroke();
  if (!s) return;
  const st = styleOf(s);
  color.value = st.color;
  if (typeof st.fill === "string" && st.fill) {
    fillColor.value = st.fill;
    fillOn.value = true;
  }
});

watch(tool, (next, prev) => {
  // 切工具：完整收尾会话，禁止中途清空 pointerId/capture（旧实现会导致拖移失效）
  if (engine.isBusy() || nodeDrag.value || draft.value || drawing.value) {
    endStrokeInteraction(true);
  }
  engine.setToolChanging();
  if (prev === "polyline" && next !== "polyline") {
    /* setToolChanging 已处理折线收口 */
  }
  if (!isDrawTool.value) track.value = null;
  if (next !== "select") nodeEditOn.value = false;
});

watch(selectedIds, () => {
  const s = selectedStroke();
  if (!s || (s.kind !== "curve" && s.kind !== "polygon")) nodeEditOn.value = false;
  syncStyleFromSelection();
});

watch(colorDialogVisible, (open, was) => {
  if (was && !open) onColorDialogClosed();
});

let resizeObs: ResizeObserver | null = null;
let unlistenSketchUpdated: (() => void) | undefined;
let unlistenAlbumInsert: (() => void) | undefined;
onMounted(() => {
  void load(true);
  void refreshAlbum();
  window.addEventListener("keydown", onKey);
  window.addEventListener("keyup", onKeyUp);
  document.addEventListener("visibilitychange", onVis);
  idleTimer = window.setInterval(() => {
    if (loadInFlight > 0) return;
    if (!(pendingExternalLoad && Date.now() >= suppressLoadUntil)) return;
    void load(true);
  }, 2000);
  void onCanvasSketchUpdated((ws) => {
    if (!props.workspace) return;
    if (sameWs(props.workspace, ws)) {
      if (Date.now() < suppressLoadUntil || dirty.value || paintDirty.value) {
        pendingExternalLoad = true;
        return;
      }
      void load(true);
    }
  }).then((fn) => {
    unlistenSketchUpdated = fn;
  });
  void onCanvasAlbumInsert((p) => {
    if (!props.workspace || !sameWs(props.workspace, p.workspace)) return;
    void insertAlbumRel(p.rel);
  }).then((fn) => {
    unlistenAlbumInsert = fn;
  });
  nextTick(() => {
    resetView();
    if (deskEl.value) {
      resizeObs = new ResizeObserver(() => measureRuler());
      resizeObs.observe(deskEl.value);
    }
  });
});
onUnmounted(() => {
  abortStrokeInteraction();
  window.removeEventListener("keydown", onKey);
  window.removeEventListener("keyup", onKeyUp);
  document.removeEventListener("visibilitychange", onVis);
  if (saveTimer) window.clearTimeout(saveTimer);
  if (idleTimer) window.clearInterval(idleTimer);
  unlistenSketchUpdated?.();
  unlistenAlbumInsert?.();
  resizeObs?.disconnect();
});

const cursorClass = computed(() => {
  if (tool.value === "pan") return "csk-pan";
  if (tool.value === "text") return "csk-text";
  if (tool.value === "select") return "csk-select";
  if (isDrawTool.value) return "csk-draw";
  return "csk-select";
});

const SHAPE_TOOLS: Tool[] = ["line", "rect", "ellipse", "circle", "polygon", "polyline", "curve", "arrow", "dim"];
const isShapeTool = computed(() => SHAPE_TOOLS.includes(tool.value));

const tools: { id: Tool; icon: string; label: string }[] = [
  { id: "select", icon: "cursor-line", label: "选择 V" },
  { id: "brush", icon: "brush-line", label: "画笔 B（矢量）" },
  { id: "fill", icon: "paint-fill", label: "填充（点选）" },
  { id: "text", icon: "text", label: "文字 T" },
  { id: "image", icon: "image-add-line", label: "贴图 I" },
  { id: "pan", icon: "hand", label: "平移 H · 空格临时" },
];

const shapeTools: { id: Tool; icon: string; label: string }[] = [
  { id: "rect", icon: "checkbox-blank-line", label: "矩形 R" },
  { id: "ellipse", icon: "shape-2-line", label: "椭圆 O · Shift 正圆" },
  { id: "circle", icon: "checkbox-blank-circle-line", label: "正圆" },
  { id: "polygon", icon: "hexagon-line", label: "正多边形 P" },
  { id: "polyline", icon: "shape-line", label: "折线 Y" },
  { id: "line", icon: "subtract-line", label: "直线 L" },
  { id: "arrow", icon: "arrow-right-up-line", label: "箭头 A" },
  { id: "curve", icon: "pencil-ruler-2-line", label: "曲线 C" },
  { id: "dim", icon: "ruler-line", label: "尺寸 M" },
];

function pickShape(id: Tool) {
  tool.value = id;
}

function openSealDialog() {
  flyout.value = null;
  sealDialogVisible.value = true;
}

/** Duty: 按对话框参数在纸心生成红章并组合。 */
function confirmSealStamp() {
  const ring = sealRingText.value.trim();
  const center = sealCenterText.value.trim();
  if (!ring && !center && !sealCenterStar.value) {
    void fouAlert({ title: "无法制章", message: "请填写外圈文字、中心文字，或勾选五角星。" });
    return;
  }
  const pieces = buildSealStrokes({
    ringText: ring,
    centerText: center,
    centerStar: sealCenterStar.value,
    diameter: Number(sealDiameter.value) || 180,
    color: sealColor.value || SEAL_DEFAULT_COLOR,
    cx: page.value.w / 2,
    cy: page.value.h / 2,
    layerId: activeLayerId.value,
  });
  if (!pieces.length) {
    void fouAlert({ title: "无法制章", message: "未生成任何图元，请检查参数。" });
    return;
  }
  let next = [...strokes.value, ...pieces];
  const ids = pieces.map((s) => s.id);
  const grouped = groupStrokes(next, ids, activeLayerId.value);
  if (grouped) {
    next = grouped.next;
    selectedIds.value = [grouped.groupId];
  } else {
    selectedIds.value = ids;
  }
  pushHistory(next);
  sealDialogVisible.value = false;
  tool.value = "select";
  status.value = "已添加印章 · 可选中后旋转缩放";
  syncMm();
}

function toggleFly(which: "shapes") {
  flyout.value = flyout.value === which ? null : which;
}

function openAlignDialog() {
  flyout.value = null;
  alignDialogVisible.value = true;
}

const colorDialogHex = computed(() => {
  if (colorPickTarget.value === "gradA") return gradA.value;
  if (colorPickTarget.value === "gradB") return gradB.value;
  if (colorWell.value === "fill") return fillColor.value;
  if (colorWell.value === "paperBg") return pageDraft.value.bg || paper.value.bg || DEFAULT_PAPER_BG;
  if (colorWell.value === "deskBg") return deskBg.value;
  return fillColor.value;
});
const colorDialogTitle = computed(() => {
  if (colorPickTarget.value === "gradA") return "渐变色 A";
  if (colorPickTarget.value === "gradB") return "渐变色 B";
  if (colorWell.value === "paperBg") return "纸面底色";
  if (colorWell.value === "deskBg") return "桌面底色";
  return "填充颜色";
});

function openPaperBgColor(fromPage = false) {
  colorPickTarget.value = "well";
  colorWell.value = "paperBg";
  if (fromPage && pageDialogVisible.value) {
    reopenPageAfterColor.value = true;
    pageDialogVisible.value = false;
  }
  colorDialogVisible.value = true;
}

function openDeskBgColor(fromPage = false) {
  colorPickTarget.value = "well";
  colorWell.value = "deskBg";
  if (fromPage && pageDialogVisible.value) {
    reopenPageAfterColor.value = true;
    pageDialogVisible.value = false;
  }
  colorDialogVisible.value = true;
}

function onColorDialogClosed() {
  if (reopenPageAfterColor.value) {
    reopenPageAfterColor.value = false;
    pageDialogVisible.value = true;
  }
}

function activateLayer(ly: SketchLayer) {
  activeLayerId.value = ly.id;
  openLayerId.value = ly.id;
  tool.value = "select";
  selectedIds.value = strokesInLayer(ly.id).map((s) => s.id);
  syncMm();
}

/** Duty: 图层面板点选图元并切到选择工具。 */
function selectStrokeInList(id: string) {
  tool.value = "select";
  selectedIds.value = [id];
  syncMm();
}
const canDistribute = computed(
  () => expandSelection(strokes.value, selectedIds.value).filter((s) => s.kind !== "group").length >= 3,
);
</script>

<template>
  <div class="csk" :class="{ 'csk-inactive': !isActive }">
    <aside class="csk-rail">
      <FouButton
        v-for="t in tools.filter((x) => ['select', 'brush', 'fill'].includes(x.id))"
        :key="t.id"
        :icon="t.icon"
        size="small"
        :type="tool === t.id ? 'primary' : 'default'"
        native-type="button"
        :aria-label="t.label"
        :title="t.label"
        @click="onPickTool(t.id)"
      />
      <FouButton
        icon="shape-line"
        size="small"
        :type="flyout === 'shapes' || isShapeTool ? 'primary' : 'default'"
        native-type="button"
        aria-label="图形"
        title="图形"
        @click="toggleFly('shapes')"
      />
      <FouButton
        icon="align-justify"
        size="small"
        :type="alignDialogVisible ? 'primary' : 'default'"
        native-type="button"
        aria-label="对齐分布"
        title="对齐分布"
        @click="openAlignDialog"
      />
      <FouButton
        v-for="t in tools.filter((x) => ['text', 'image', 'pan'].includes(x.id))"
        :key="t.id"
        :icon="t.icon"
        size="small"
        :type="tool === t.id ? 'primary' : 'default'"
        native-type="button"
        :aria-label="t.label"
        :title="t.label"
        @click="onPickTool(t.id)"
      />
      <span class="csk-sep-v" />
      <FouButton icon="zoom-in-line" size="small" native-type="button" aria-label="放大" title="放大" @click="zoom = Math.min(3, zoom + 0.1)" />
      <FouButton icon="zoom-out-line" size="small" native-type="button" aria-label="缩小" title="缩小" @click="zoom = Math.max(0.25, zoom - 0.1)" />
    </aside>
    <aside v-if="flyout === 'shapes'" class="csk-fly ui-font">
      <FouButton
        v-for="t in shapeTools"
        :key="t.id"
        :icon="t.icon"
        size="small"
        :type="tool === t.id ? 'primary' : 'default'"
        native-type="button"
        :aria-label="t.label"
        :title="t.label"
        @click="pickShape(t.id)"
      />
      <span class="csk-sep-v" />
      <FouButton
        icon="shield-star-line"
        size="small"
        native-type="button"
        aria-label="印章"
        title="印章（环字 + 中心）"
        @click="openSealDialog"
      />
    </aside>
    <div class="csk-main">
      <div class="csk-bar">
        <button
          type="button"
          class="csk-well"
          :class="{ on: colorWell === 'stroke' }"
          :style="{ boxShadow: `inset 0 0 0 3px ${color}` }"
          title="边框色（色板右键也可设）"
          aria-label="边框色"
          @click="colorWell = 'stroke'"
        />
        <button
          type="button"
          class="csk-well csk-well-fill"
          :class="{ on: colorWell === 'fill' }"
          :style="{ background: fillOn || gradOn ? (gradOn ? `linear-gradient(90deg, ${gradA}, ${gradB})` : fillColor) : 'transparent' }"
          title="填充色（色板左键；右键本井=无填充）"
          aria-label="填充色"
          @click="colorWell = 'fill'; fillOn = true"
          @contextmenu="onFillWellContext"
        />
        <span class="csk-sep-h" title="底色" />
        <button
          type="button"
          class="csk-well"
          :class="{ on: colorWell === 'paperBg' }"
          :style="{ background: paper.bg || DEFAULT_PAPER_BG }"
          title="纸面底色"
          aria-label="纸面底色"
          @click="openPaperBgColor(false)"
        />
        <button
          type="button"
          class="csk-well"
          :class="{ on: colorWell === 'deskBg' }"
          :style="{ background: deskBg }"
          title="桌面底色（粘贴板）"
          aria-label="桌面底色"
          @click="openDeskBgColor(false)"
        />
        <button
          v-for="c in COLORS"
          :key="c"
          type="button"
          class="csk-swatch"
          :class="{ active: fillColor === c || color === c }"
          :style="{ background: c }"
          :aria-label="`颜色 ${c} · 左键填充 · 右键边框`"
          :title="`左键填充 · 右键边框 ${c}`"
          @click="applyFillSwatch(c)"
          @contextmenu="applyStrokeSwatch(c, $event)"
        />
        <FouButton icon="palette-line" size="small" native-type="button" title="取色（写入填充）" aria-label="取色" @click="openColorDialog" />
        <FouButton icon="forbid-line" size="small" native-type="button" title="无填充" aria-label="无填充" @click="clearFillOnSelected" />
        <button
          v-for="w in WIDTHS"
          :key="'w' + w"
          type="button"
          class="csk-width-btn"
          :class="{ on: width === w }"
          :title="`边框线宽 ${w}`"
          :aria-label="`边框线宽 ${w}`"
          @click="setStrokeWidth(w)"
        >
          <span class="csk-width-ico" :style="{ height: `${Math.min(10, Math.max(1, w))}px` }" aria-hidden="true" />
          <span>{{ w }}</span>
        </button>
        <FouButton
          v-for="d in DASH_OPTIONS"
          :key="d.id"
          :icon="d.icon"
          size="small"
          :type="strokeDash === d.id ? 'primary' : 'default'"
          native-type="button"
          :title="d.title"
          :aria-label="d.title"
          @click="setStrokeDash(d.id)"
        />
        <FouInput
          v-model="opacityPct"
          type="number"
          size="small"
          style="width: 64px"
          aria-label="不透明度"
          title="不透明度 %"
          @change="applyOpacityToSelected"
        />
        <FouInput
          v-model="textFontSize"
          type="number"
          size="small"
          style="width: 64px"
          aria-label="文字字号"
          title="文字字号"
          @change="applyFontSizeToSelected"
        />
        <FouButton
          icon="bold"
          size="small"
          :type="textFontBold ? 'primary' : 'default'"
          native-type="button"
          title="粗体"
          aria-label="粗体"
          @click="applyFontBoldToSelected"
        />
        <FouSelect
          :model-value="textFontFamily"
          :options="FONT_FAMILY_OPTIONS"
          style="width: 120px"
          aria-label="字体"
          title="字体"
          @update:model-value="(v: string) => applyFontFamilyToSelected(String(v))"
        />
        <FouInput
          v-model="cornerRadius"
          type="number"
          size="small"
          style="width: 56px"
          aria-label="圆角"
          title="矩形圆角"
          @change="applyCornerRadiusToSelected"
        />
        <FouButton icon="grid-line" size="small" :type="gridOn ? 'primary' : 'default'" native-type="button" title="网格" aria-label="网格" @click="gridOn = !gridOn" />
        <FouButton icon="focus-3-line" size="small" :type="snapOn ? 'primary' : 'default'" native-type="button" title="捕捉网格" aria-label="捕捉网格" @click="snapOn = !snapOn" />
        <FouButton icon="crosshair-2-line" size="small" :type="objectSnapOn ? 'primary' : 'default'" native-type="button" title="对象吸附（角/中点）" aria-label="对象吸附" @click="objectSnapOn = !objectSnapOn" />
        <FouButton icon="layout-grid-line" size="small" native-type="button" :type="snapGuideOn ? 'primary' : 'default'" title="吸附参考线" aria-label="吸附参考线" @click="snapGuideOn = !snapGuideOn" />
        <FouButton icon="close-circle-line" size="small" native-type="button" title="清参考线" aria-label="清参考线" @click="clearGuides" />
        <FouButton icon="expand-width-line" size="small" :type="orthoOn ? 'primary' : 'default'" native-type="button" title="正交" aria-label="正交" @click="orthoOn = !orthoOn" />
        <FouButton
          v-if="polyPts.length >= 3 || curvePts.length >= 2"
          icon="check-double-line"
          type="primary"
          size="small"
          native-type="button"
          title="完成图形"
          aria-label="完成图形"
          @click="finishPolyOrCurve"
        />
        <template v-if="tool === 'polygon'">
          <FouInput v-model="polygonSides" type="number" size="small" style="width: 56px" aria-label="正多边形边数" title="正多边形边数 3–24" />
        </template>
        <FouButton icon="file-paper-2-line" size="small" native-type="button" :title="`页面设置 ${paperLabel}`" :aria-label="`页面设置 ${paperLabel}`" @click="openPageDialog" />
        <FouButton icon="percent-line" size="small" native-type="button" :title="`比例 1:${paper.scale}`" :aria-label="`比例 1:${paper.scale}`" @click="cycleScale" />
        <span class="csk-deg-lab ui-font" title="旋转角度（度）">角度°</span>
        <FouInput
          v-model="rotateDegInput"
          type="number"
          size="small"
          style="width: 64px"
          aria-label="旋转角度"
          title="单选：绝对角度；多选：相对旋转。回车应用"
          :disabled="!selectedIds.length"
          @keyup.enter="applyRotationFromInput"
        />
        <FouButton
          icon="check-line"
          size="small"
          native-type="button"
          :disabled="!selectedIds.length"
          title="应用角度"
          aria-label="应用角度"
          @click="applyRotationFromInput"
        />
        <FouButton icon="anticlockwise-2-line" size="small" native-type="button" :disabled="!selectedIds.length" title="左转 90°" aria-label="左转 90°" @click="applyRotateDeg(-90)" />
        <FouButton icon="clockwise-2-line" size="small" native-type="button" :disabled="!selectedIds.length" title="右转 90°" aria-label="右转 90°" @click="applyRotateDeg(90)" />
        <FouButton icon="flip-horizontal-line" size="small" native-type="button" :disabled="!selectedIds.length" title="水平镜像" aria-label="水平镜像" @click="mirrorSelected('h')" />
        <FouButton icon="flip-vertical-line" size="small" native-type="button" :disabled="!selectedIds.length" title="垂直镜像" aria-label="垂直镜像" @click="mirrorSelected('v')" />
        <FouButton
          icon="shape-line"
          size="small"
          native-type="button"
          :type="nodeEditOn ? 'primary' : 'default'"
          :disabled="!selectedId"
          title="节点编辑"
          aria-label="节点编辑"
          @click="toggleNodeEdit"
        />
        <FouButton icon="gallery-line" size="small" native-type="button" :type="albumOpen ? 'primary' : 'default'" title="图册" aria-label="图册" @click="albumOpen = !albumOpen; albumOpen && refreshAlbum()" />
        <FouButton icon="group-line" size="small" native-type="button" :disabled="selectedIds.length < 2" title="组合" aria-label="组合" @click="groupSelected" />
        <FouButton icon="link-unlink" size="small" native-type="button" :disabled="!selectedIds.length" title="打散" aria-label="打散" @click="ungroupSelected" />
        <FouButton icon="file-copy-line" size="small" native-type="button" :disabled="!selectedIds.length" title="复制" aria-label="复制" @click="duplicateSelected" />
        <FouButton icon="bring-to-front" size="small" native-type="button" :disabled="!selectedId" title="置于顶层" aria-label="置于顶层" @click="zOrder('front')" />
        <FouButton icon="send-to-back" size="small" native-type="button" :disabled="!selectedId" title="置于底层" aria-label="置于底层" @click="zOrder('back')" />
        <FouButton
          icon="delete-bin-6-line"
          size="small"
          native-type="button"
          :disabled="!selectedIds.length"
          title="删除选中"
          aria-label="删除选中"
          @click="deleteSelected"
        />
        <FouButton icon="eraser-line" size="small" native-type="button" title="清除旧像素痕迹" aria-label="清除旧像素痕迹" @click="clearPixelLayer" />
        <FouButton icon="arrow-go-back-line" size="small" native-type="button" :disabled="historyIdx <= 0" title="撤销" aria-label="撤销" @click="undo" />
        <FouButton icon="arrow-go-forward-line" size="small" native-type="button" :disabled="historyIdx >= history.length - 1" title="重做" aria-label="重做" @click="redo" />
        <FouButton icon="delete-bin-line" size="small" native-type="button" title="清空全部" aria-label="清空全部" @click="clearAll" />
        <FouButton icon="save-line" type="primary" size="small" native-type="button" title="保存" aria-label="保存" @click="save" />
        <FouButton icon="fullscreen-line" size="small" native-type="button" title="适应纸面 Ctrl+0" aria-label="适应纸面" @click="fitPage" />
        <FouButton icon="aspect-ratio-line" size="small" native-type="button" :disabled="!selectedIds.length" title="适应选区 Ctrl+1" aria-label="适应选区" @click="fitSelection" />
        <FouButton icon="clipboard-line" size="small" native-type="button" :disabled="!selectedIds.length" title="复制 Ctrl+C" aria-label="复制" @click="copySelectedStrokes" />
        <FouButton icon="scissors-cut-line" size="small" native-type="button" :disabled="!selectedIds.length" title="剪切 Ctrl+X" aria-label="剪切" @click="cutSelectedStrokes" />
        <FouButton icon="clipboard-fill" size="small" native-type="button" title="粘贴 Ctrl+V" aria-label="粘贴" @click="pasteClipboardStrokes" />
        <FouButton icon="image-line" size="small" native-type="button" title="导出 PNG" aria-label="导出 PNG" @click="onExport('png')" />
        <FouButton icon="file-pdf-line" size="small" native-type="button" title="导出 PDF" aria-label="导出 PDF" @click="onExport('pdf')" />
        <FouButton icon="code-s-slash-line" size="small" native-type="button" title="导出 SVG" aria-label="导出 SVG" @click="onExport('svg')" />
        <FouButton icon="compass-3-line" size="small" native-type="button" title="导出 DXF" aria-label="导出 DXF" @click="onExport('dxf')" />
        <span class="csk-status ui-font">{{ status }}</span>
      </div>
      <div v-if="selectedId" class="csk-mm">
        <span class="ui-font" title="毫米尺寸">mm</span>
        <FouInput v-model="mmX" size="small" style="width: 72px" aria-label="X" title="X 毫米" @change="applyMm" />
        <FouInput v-model="mmY" size="small" style="width: 72px" aria-label="Y" title="Y 毫米" @change="applyMm" />
        <FouInput v-model="mmW" size="small" style="width: 72px" aria-label="宽" title="宽 毫米" @change="applyMm" />
        <FouInput v-model="mmH" size="small" style="width: 72px" aria-label="高" title="高 毫米" @change="applyMm" />
        <FouButton icon="check-line" size="small" native-type="button" title="应用尺寸" aria-label="应用尺寸" @click="applyMm" />
        <span class="csk-sep-h" title="渐变" />
        <FouButton
          icon="contrast-2-line"
          size="small"
          native-type="button"
          :type="gradOn ? 'primary' : 'default'"
          title="渐变填充"
          aria-label="渐变填充"
          @click="toggleGradOn"
        />
        <FouSelect
          v-if="gradOn"
          :model-value="gradType"
          :options="GRAD_TYPE_OPTIONS"
          style="width: 88px"
          aria-label="渐变类型"
          title="渐变类型"
          @update:model-value="(v: string) => onGradTypeChange(String(v))"
        />
        <button
          v-if="gradOn"
          type="button"
          class="csk-well"
          :style="{ background: gradA }"
          title="渐变色 A"
          aria-label="渐变色 A"
          @click="openGradColor('gradA')"
        />
        <button
          v-if="gradOn"
          type="button"
          class="csk-well"
          :style="{ background: gradB }"
          title="渐变色 B"
          aria-label="渐变色 B"
          @click="openGradColor('gradB')"
        />
        <FouInput
          v-if="gradOn && gradType === 'linear'"
          v-model="gradAngle"
          type="number"
          size="small"
          style="width: 64px"
          aria-label="渐变角度"
          title="渐变角度 °"
          @change="onGradAngleChange"
        />
        <FouButton
          icon="paint-brush-line"
          size="small"
          native-type="button"
          :disabled="!selectedId"
          title="应用到选中"
          aria-label="应用到选中"
          @click="applyGradientToSelected"
        />
        <span class="csk-status ui-font">{{ Math.round(zoom * 100) }}%</span>
      </div>
      <div class="csk-work">
        <div class="csk-stage">
          <div class="csk-corner ui-font" title="双击回到纸面" @dblclick="resetView">{{ paper.unit }}</div>
          <div
            ref="rulerHEl"
            class="csk-rh"
            title="从上方标尺拖出竖向参考线"
            @pointerdown="startGuide('v', $event)"
          >
            <svg class="csk-rh-svg" :width="rulerLayout.rhW" height="28">
              <g v-for="t in rulerHTicks" :key="'h' + t.pos">
                <line
                  :x1="rulerLayout.ox + t.pos * rulerLayout.z"
                  :x2="rulerLayout.ox + t.pos * rulerLayout.z"
                  :y1="t.major ? 10 : 18"
                  y2="28"
                  stroke="#cbd5e1"
                  :stroke-width="t.major ? 1 : 0.6"
                />
                <text
                  v-if="t.major"
                  :x="rulerLayout.ox + t.pos * rulerLayout.z"
                  y="10"
                  fill="#e2e8f0"
                  font-size="10"
                  text-anchor="middle"
                >
                  {{ t.label }}
                </text>
              </g>
            </svg>
          </div>
          <div
            ref="rulerVEl"
            class="csk-rv"
            title="从左侧标尺拖出横向参考线"
            @pointerdown="startGuide('h', $event)"
          >
            <svg class="csk-rv-svg" width="28" :height="rulerLayout.rvH">
              <g v-for="t in rulerVTicks" :key="'v' + t.pos">
                <line
                  :y1="rulerLayout.oy + t.pos * rulerLayout.z"
                  :y2="rulerLayout.oy + t.pos * rulerLayout.z"
                  :x1="t.major ? 10 : 18"
                  x2="28"
                  stroke="#cbd5e1"
                  :stroke-width="t.major ? 1 : 0.6"
                />
                <text
                  v-if="t.major"
                  x="2"
                  :y="rulerLayout.oy + t.pos * rulerLayout.z"
                  fill="#e2e8f0"
                  font-size="9"
                  text-anchor="start"
                  dominant-baseline="middle"
                >
                  {{ t.label }}
                </text>
              </g>
            </svg>
          </div>
          <div
            ref="deskEl"
            class="csk-desk"
            :class="cursorClass"
            :style="{ background: deskBg }"
            @wheel="onWheel"
            @scroll="onDeskScroll"
            @pointermove="updateTrack"
            @pointerleave="track = null"
          >
            <div class="csk-sheet" :style="{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }">
              <div
                ref="boardEl"
                class="csk-board"
                :class="cursorClass"
                :style="{ width: boardBox.w + 'px', height: boardBox.h + 'px' }"
                @pointerdown="onDown"
                @lostpointercapture="onLostCapture"
                @contextmenu="onBoardContextMenu"
                @dblclick="onBoardDblClick"
              >
                <svg
                  ref="svgEl"
                  class="csk-svg"
                  :viewBox="`${boardBox.x} ${boardBox.y} ${boardBox.w} ${boardBox.h}`"
                  :width="boardBox.w"
                  :height="boardBox.h"
                >
                <rect
                  :x="boardBox.x"
                  :y="boardBox.y"
                  :width="boardBox.w"
                  :height="boardBox.h"
                  fill="rgba(0,0,0,0)"
                  pointer-events="none"
                />
                <defs>
                  <marker
                    v-for="c in COLORS"
                    :id="`csk-arrow-${c.replace('#', '')}`"
                    :key="c"
                    markerWidth="8"
                    markerHeight="8"
                    refX="6"
                    refY="3"
                    orient="auto"
                  >
                    <path d="M0,0 L8,3 L0,6 Z" :fill="c" />
                  </marker>
                  <linearGradient
                    v-for="s in drawOrderedStrokes.filter((x) => isLinearFill(styleOf(x).fill) && !isRadialGrad(x))"
                    :id="`g-${s.id}`"
                    :key="'g-' + s.id"
                    :x1="linearGradPct(s).x1"
                    :y1="linearGradPct(s).y1"
                    :x2="linearGradPct(s).x2"
                    :y2="linearGradPct(s).y2"
                    gradientUnits="objectBoundingBox"
                  >
                    <stop offset="0%" :stop-color="linearFillEnds(s).a" />
                    <stop offset="100%" :stop-color="linearFillEnds(s).b" />
                  </linearGradient>
                  <radialGradient
                    v-for="s in drawOrderedStrokes.filter((x) => isRadialGrad(x))"
                    :id="`g-${s.id}`"
                    :key="'gr-' + s.id"
                    cx="50%"
                    cy="50%"
                    r="70%"
                    fx="50%"
                    fy="50%"
                    gradientUnits="objectBoundingBox"
                  >
                    <stop offset="0%" :stop-color="linearFillEnds(s).a" />
                    <stop offset="100%" :stop-color="linearFillEnds(s).b" />
                  </radialGradient>
                </defs>
                <template v-for="s in drawOrderedStrokes" :key="s.id">
                  <g :transform="strokeSvgTransform(s)">
                  <path
                    v-if="s.kind === 'path'"
                    :d="s.d"
                    fill="none"
                    :stroke="styleOf(s).color"
                    :stroke-width="styleOf(s).width"
                    :stroke-dasharray="strokeDashAttr(s)"
                    :opacity="strokeOpacity(s)"
                  />
                  <path
                    v-else-if="s.kind === 'curve'"
                    :d="curveToPath(s.points)"
                    fill="none"
                    :stroke="styleOf(s).color"
                    :stroke-width="styleOf(s).width"
                    :stroke-dasharray="strokeDashAttr(s)"
                    :opacity="strokeOpacity(s)"
                  />
                  <g v-else-if="s.kind === 'line' || s.kind === 'arrow' || s.kind === 'dim'">
                    <line
                      :x1="s.x1"
                      :y1="s.y1"
                      :x2="s.x2"
                      :y2="s.y2"
                      :stroke="styleOf(s).color"
                      :stroke-width="styleOf(s).width"
                      :opacity="strokeOpacity(s)"
                      :marker-end="s.kind === 'arrow' ? `url(#csk-arrow-${styleOf(s).color.replace('#', '')})` : undefined"
                      :stroke-dasharray="strokeDashAttr(s)"
                    />
                    <text
                      v-if="s.kind === 'dim'"
                      :x="(s.x1 + s.x2) / 2"
                      :y="(s.y1 + s.y2) / 2 - 6"
                      :fill="styleOf(s).color"
                      font-size="12"
                    >
                      {{ s.label }}
                    </text>
                  </g>
                  <rect
                    v-else-if="s.kind === 'rect'"
                    :x="s.x"
                    :y="s.y"
                    :width="s.w"
                    :height="s.h"
                    :rx="s.rx && s.rx > 0 ? Math.min(s.rx, Math.abs(s.w) / 2, Math.abs(s.h) / 2) : 0"
                    :ry="s.rx && s.rx > 0 ? Math.min(s.rx, Math.abs(s.w) / 2, Math.abs(s.h) / 2) : 0"
                    :fill="svgFill(s)"
                    :stroke="styleOf(s).color"
                    :stroke-width="styleOf(s).width"
                    :stroke-dasharray="strokeDashAttr(s)"
                    :opacity="strokeOpacity(s)"
                  />
                  <image
                    v-else-if="s.kind === 'image'"
                    :href="imageUrls[s.src]"
                    :x="s.x"
                    :y="s.y"
                    :width="s.w"
                    :height="s.h"
                    :opacity="strokeOpacity(s)"
                  />
                  <ellipse
                    v-else-if="s.kind === 'ellipse'"
                    :cx="s.cx"
                    :cy="s.cy"
                    :rx="s.rx"
                    :ry="s.ry"
                    :fill="svgFill(s)"
                    :stroke="styleOf(s).color"
                    :stroke-width="styleOf(s).width"
                    :stroke-dasharray="strokeDashAttr(s)"
                    :opacity="strokeOpacity(s)"
                  />
                  <polygon
                    v-else-if="s.kind === 'polygon'"
                    :points="s.points.map((q) => `${q.x},${q.y}`).join(' ')"
                    :fill="svgFill(s)"
                    :stroke="styleOf(s).color"
                    :stroke-width="styleOf(s).width"
                    :stroke-dasharray="strokeDashAttr(s)"
                    :opacity="strokeOpacity(s)"
                  />
                  <text
                    v-else-if="s.kind === 'text'"
                    :x="s.x"
                    :y="s.y"
                    :fill="styleOf(s).color"
                    :font-size="styleOf(s).fontSize ?? 18"
                    :font-weight="styleOf(s).fontBold ? 700 : 400"
                    :font-family="styleOf(s).fontFamily || 'ui-sans-serif, system-ui, sans-serif'"
                    :opacity="textInlineOn && textEditingId === s.id ? 0 : strokeOpacity(s)"
                  >
                    <template v-if="!(s.text || '').includes('\n')">{{ s.text }}</template>
                    <template v-else>
                      <tspan
                        v-for="(line, li) in (s.text || '').split('\n')"
                        :key="li"
                        :x="s.x"
                        :dy="li === 0 ? 0 : (styleOf(s).fontSize ?? 18) * 1.35"
                      >{{ line }}</tspan>
                    </template>
                  </text>
                  </g>
                </template>
                <polyline
                  v-if="polyPts.length"
                  :points="polyPts.map((q) => `${q.x},${q.y}`).join(' ')"
                  fill="none"
                  stroke="#0d9488"
                  stroke-width="3"
                  opacity="0.9"
                  pointer-events="none"
                />
                <circle
                  v-if="polyPts.length"
                  :cx="polyPts[0]!.x"
                  :cy="polyPts[0]!.y"
                  r="8"
                  fill="#ecfeff"
                  stroke="#0d9488"
                  stroke-width="2"
                  pointer-events="none"
                />
                <path
                  v-if="curvePts.length"
                  :d="curveToPath(curvePts)"
                  fill="none"
                  stroke="#0d9488"
                  stroke-width="3"
                  opacity="0.9"
                  pointer-events="none"
                />
                <rect
                  v-if="marqueeRect && (marqueeRect.w > 0 || marqueeRect.h > 0)"
                  class="csk-marquee"
                  :x="marqueeRect.x"
                  :y="marqueeRect.y"
                  :width="Math.max(marqueeRect.w, 1)"
                  :height="Math.max(marqueeRect.h, 1)"
                  fill="rgba(13, 148, 136, 0.12)"
                  stroke="#0d9488"
                  :stroke-width="1 / Math.max(rulerLayout.z, 0.05)"
                  stroke-dasharray="4 3"
                  pointer-events="none"
                />
                <rect
                  v-for="id in selectedIds"
                  :key="'sel-' + id"
                  :x="selBox(id).x"
                  :y="selBox(id).y"
                  :width="Math.max(selBox(id).w, 4)"
                  :height="Math.max(selBox(id).h, 4)"
                  fill="none"
                  stroke="#0d9488"
                  :stroke-width="1 / rulerLayout.z"
                  stroke-dasharray="4 3"
                  pointer-events="none"
                />
                <rect
                  v-for="h in scaleHandleMarks"
                  :key="'h-' + h.id"
                  class="csk-scale-h"
                  :x="h.x"
                  :y="h.y"
                  :width="h.w"
                  :height="h.h"
                  :style="{ cursor: h.cursor }"
                  :stroke-width="1 / Math.max(rulerLayout.z, 0.05)"
                  @pointerdown.stop="startScale(h.id, $event)"
                />
                <g v-if="rotateHandleMark" class="csk-rot-h">
                  <line
                    :x1="rotateHandleMark.cx"
                    :y1="rotateHandleMark.stemY"
                    :x2="rotateHandleMark.cx"
                    :y2="rotateHandleMark.cy"
                    stroke="#0d9488"
                    :stroke-width="2 / Math.max(rulerLayout.z, 0.05)"
                    pointer-events="none"
                  />
                  <circle
                    :cx="rotateHandleMark.cx"
                    :cy="rotateHandleMark.cy"
                    :r="rotateHandleMark.size / 2"
                    fill="#fff"
                    stroke="#0d9488"
                    :stroke-width="2 / Math.max(rulerLayout.z, 0.05)"
                    style="cursor: grab"
                    @pointerdown.stop="startRotateHandle($event)"
                  />
                  <g
                    :transform="`translate(${rotateHandleMark.cx - rotateHandleMark.size / 2}, ${rotateHandleMark.cy - rotateHandleMark.size / 2}) scale(${rotateHandleMark.size / 24})`"
                    pointer-events="none"
                  >
                    <path
                      fill="none"
                      stroke="#0f766e"
                      stroke-width="2.75"
                      stroke-linecap="round"
                      d="M17.2 8.2a6.2 6.2 0 1 0 1.1 5.6"
                    />
                    <path fill="#0f766e" d="M17.2 4.6l3.6 3.2-4.8.9z" />
                  </g>
                </g>
                <rect
                  v-for="n in nodeMarks"
                  :key="'n-' + n.strokeId + '-' + n.index"
                  class="csk-node-h"
                  :x="n.x"
                  :y="n.y"
                  :width="n.w"
                  :height="n.h"
                  fill="#fef3c7"
                  stroke="#d97706"
                  :stroke-width="1 / Math.max(rulerLayout.z, 0.05)"
                  style="cursor: move"
                  @pointerdown.stop="startNodeDrag(n.strokeId, n.index, $event)"
                />
                <g v-for="(gx, gi) in liveGuides.v" :key="'gv' + gi" class="csk-guide csk-guide-v">
                  <line
                    :x1="gx"
                    :x2="gx"
                    :y1="boardBox.y"
                    :y2="boardBox.y + boardBox.h"
                    stroke="transparent"
                    :stroke-width="12 / Math.max(rulerLayout.z, 0.05)"
                    @pointerdown.stop="startGuide('v', $event, gi)"
                  />
                  <line
                    :x1="gx"
                    :x2="gx"
                    :y1="boardBox.y"
                    :y2="boardBox.y + boardBox.h"
                    stroke="#f97316"
                    :stroke-width="1 / rulerLayout.z"
                    stroke-dasharray="6 4"
                    pointer-events="none"
                  />
                </g>
                <g v-for="(gy, gi) in liveGuides.h" :key="'gh' + gi" class="csk-guide csk-guide-h">
                  <line
                    :y1="gy"
                    :y2="gy"
                    :x1="boardBox.x"
                    :x2="boardBox.x + boardBox.w"
                    stroke="transparent"
                    :stroke-width="12 / Math.max(rulerLayout.z, 0.05)"
                    @pointerdown.stop="startGuide('h', $event, gi)"
                  />
                  <line
                    :y1="gy"
                    :y2="gy"
                    :x1="boardBox.x"
                    :x2="boardBox.x + boardBox.w"
                    stroke="#f97316"
                    :stroke-width="1 / rulerLayout.z"
                    stroke-dasharray="6 4"
                    pointer-events="none"
                  />
                </g>
                <template v-if="track && isDrawTool">
                  <line
                    :x1="track.x"
                    :x2="track.x"
                    :y1="boardBox.y"
                    :y2="boardBox.y + boardBox.h"
                    stroke="#38bdf8"
                    :stroke-width="1 / rulerLayout.z"
                    stroke-dasharray="3 3"
                    pointer-events="none"
                  />
                  <line
                    :y1="track.y"
                    :y2="track.y"
                    :x1="boardBox.x"
                    :x2="boardBox.x + boardBox.w"
                    stroke="#38bdf8"
                    :stroke-width="1 / rulerLayout.z"
                    stroke-dasharray="3 3"
                    pointer-events="none"
                  />
                </template>
              </svg>
              <textarea
                v-if="textInlineOn"
                ref="textInputEl"
                v-model="textDraft"
                class="csk-text-inline"
                rows="3"
                :style="{
                  left: textPos.x - boardBox.x + 'px',
                  top: textPos.y - boardBox.y - textFontSize + 'px',
                  fontSize: textFontSize + 'px',
                  color: color,
                  fontWeight: textFontBold ? 700 : 400,
                  fontFamily: textFontFamily,
                  minWidth: Math.max(80, estimateTextSize(textDraft || '文字', textFontSize).w) + 'px',
                }"
                aria-label="输入文字"
                title="Ctrl+Enter 完成 · Esc 取消 · 可多行"
                @keydown.ctrl.enter.prevent="commitInlineText"
                @keydown.meta.enter.prevent="commitInlineText"
                @keydown.escape.prevent="cancelInlineText"
                @blur="commitInlineText"
                @pointerdown.stop
              />
              <div
                ref="paperEl"
                class="csk-paper"
                :style="{
                  width: page.w + 'px',
                  height: page.h + 'px',
                  left: PASTE + 'px',
                  top: PASTE + 'px',
                  backgroundColor: paper.bg || DEFAULT_PAPER_BG,
                  backgroundImage: gridOn
                    ? `linear-gradient(rgba(15,23,42,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(15,23,42,0.08) 1px, transparent 1px)`
                    : 'none',
                  backgroundSize: gridOn ? `${gridPx}px ${gridPx}px` : undefined,
                }"
              >
                <canvas ref="paintEl" class="csk-paint" :width="page.w" :height="page.h" aria-hidden="true" />
              </div>
              </div>
            </div>
          </div>
        </div>
        <div class="csk-layer-split" title="拖动调整图层面板宽度" @pointerdown="startLayerSplit" />
        <aside class="csk-layers ui-font" :style="{ width: layersWidth + 'px' }">
          <div class="csk-layer-head">
            <strong>图层</strong>
            <FouButton icon="add-line" size="small" text native-type="button" title="新建图层" aria-label="新建图层" @click="addSketchLayer" />
          </div>
          <div
            v-for="ly in sketchLayers"
            :key="ly.id"
            class="csk-layer-row"
            :class="{ active: ly.id === activeLayerId }"
            draggable="true"
            @dragstart="onLayerRowDragStart(ly.id)"
            @dragover.prevent
            @drop.prevent="onLayerPanelDrop(ly.id)"
            @click="activateLayer(ly)"
          >
            <FouButton
              :icon="ly.hidden ? 'eye-off-line' : 'eye-line'"
              size="small"
              text
              native-type="button"
              :title="ly.hidden ? '显示' : '隐藏'"
              :aria-label="ly.hidden ? '显示图层' : '隐藏图层'"
              @click.stop="toggleLayerHidden(ly.id)"
            />
            <FouButton
              :icon="ly.locked ? 'lock-line' : 'lock-unlock-line'"
              size="small"
              text
              native-type="button"
              :title="ly.locked ? '解锁' : '锁定'"
              :aria-label="ly.locked ? '解锁图层' : '锁定图层'"
              @click.stop="toggleLayerLocked(ly.id)"
            />
            <FouInput
              :model-value="ly.name"
              size="small"
              class="csk-layer-name"
              aria-label="图层名"
              @click.stop
              @update:model-value="(v: string) => renameLayer(ly.id, String(v))"
            />
            <FouButton
              icon="folder-shared-line"
              size="small"
              text
              native-type="button"
              title="选中移入此层"
              aria-label="选中移入此层"
              :disabled="!selectedIds.length"
              @click.stop="moveSelectedToLayer(ly.id)"
            />
            <FouButton
              icon="delete-bin-line"
              size="small"
              text
              native-type="button"
              title="删除图层"
              aria-label="删除图层"
              @click.stop="deleteSketchLayer(ly.id)"
            />
          </div>
          <div v-if="openLayerId" class="csk-layer-items">
            <button
              v-for="s in strokesInLayer(openLayerId).filter((x) => x.kind !== 'group')"
              :key="s.id"
              type="button"
              class="csk-layer-item"
              :class="{ on: selectedIds.includes(s.id) }"
              @click.stop="selectStrokeInList(s.id)"
            >
              {{ s.kind }}{{ s.kind === 'text' ? `: ${(s.text || '').slice(0, 12)}` : '' }}
            </button>
          </div>
        </aside>
        <aside v-if="albumOpen" class="csk-album ui-font">
          <div class="csk-layer-head">
            <strong>图册</strong>
            <div class="csk-album-acts">
              <FouButton icon="refresh-line" size="small" text native-type="button" aria-label="刷新图册" @click="refreshAlbum" />
              <FouButton icon="close-line" size="small" text native-type="button" aria-label="关闭图册" @click="albumOpen = false" />
            </div>
          </div>
          <p class="csk-empty">单击缩略图插入到草图中心。也可在「图册」页签导入。</p>
          <div v-if="!albumEntries.length" class="csk-empty">暂无素材</div>
          <button
            v-for="f in albumEntries"
            :key="f.rel"
            type="button"
            class="csk-album-item"
            :title="f.name"
            @click="insertAlbumRel(f.rel)"
          >
            <img v-if="f.src" :src="f.src" :alt="f.name" />
            <span v-else class="csk-empty">无法预览</span>
            <span>{{ f.name }}</span>
          </button>
        </aside>
      </div>
    </div>

    <FouDialog v-model="pageDialogVisible" title="页面设置" width="440px" append-to-body>
      <div class="csk-form ui-font">
        <label>快捷填入</label>
        <FouSelect :model-value="presetId" :options="presetOptions" @update:model-value="onPreset" />
        <label>宽度</label>
        <FouInput v-model="pageDraft.w" type="number" />
        <label>高度</label>
        <FouInput v-model="pageDraft.h" type="number" />
        <label>单位</label>
        <FouSelect :model-value="pageDraft.unit" :options="unitOptions" @update:model-value="onUnitChange" />
        <label>DPI</label>
        <FouInput v-model="pageDraft.dpi" type="number" />
        <label>比例 1:</label>
        <FouInput v-model="pageDraft.scale" type="number" />
        <label>纸面底色</label>
        <button
          type="button"
          class="csk-well"
          :style="{ background: pageDraft.bg || DEFAULT_PAPER_BG }"
          title="纸面底色"
          @click="openPaperBgColor(true)"
        />
        <label>桌面底色</label>
        <button type="button" class="csk-well" :style="{ background: deskBg }" title="粘贴板底色" @click="openDeskBgColor(true)" />
        <FouButton icon="repeat-line" size="small" native-type="button" @click="swapOrient">横向/纵向对调</FouButton>
      </div>
      <template #footer>
        <FouButton icon="close-line" size="small" native-type="button" @click="pageDialogVisible = false">取消</FouButton>
        <FouButton icon="check-line" type="primary" size="small" native-type="button" @click="applyPageDialog">确定</FouButton>
      </template>
    </FouDialog>

    <SketchColorDialog
      v-model="colorDialogVisible"
      :color="colorDialogHex"
      :title="colorDialogTitle"
      @confirm="onColorConfirm"
    />

    <FouDialog v-model="exportDialogVisible" title="导出草图" width="400px" append-to-body>
      <div class="csk-form ui-font">
        <label>格式</label>
        <span>{{ exportKind.toUpperCase() }}</span>
        <label>范围</label>
        <div class="csk-export-scope">
          <FouButton
            icon="file-paper-2-line"
            size="small"
            native-type="button"
            :type="exportScope === 'page' ? 'primary' : 'default'"
            @click="exportScope = 'page'"
          >
            整页（矢量为主）
          </FouButton>
          <FouButton
            icon="stack-line"
            size="small"
            native-type="button"
            :type="exportScope === 'layer' ? 'primary' : 'default'"
            @click="exportScope = 'layer'"
          >
            当前图层（仅矢量）
          </FouButton>
        </div>
        <p v-if="exportKind === 'svg'" class="csk-empty">SVG 不含贴图位图；请用 PNG 导出完整画面。</p>
      </div>
      <template #footer>
        <FouButton icon="close-line" size="small" native-type="button" @click="exportDialogVisible = false">取消</FouButton>
        <FouButton icon="download-2-line" type="primary" size="small" native-type="button" @click="confirmExport">导出</FouButton>
      </template>
    </FouDialog>

    <FouDialog v-model="sealDialogVisible" title="制章" width="400px" append-to-body>
      <div class="csk-seal-form ui-font">
        <label class="csk-seal-row">
          <span>外圈文字</span>
          <FouInput v-model="sealRingText" size="small" aria-label="外圈文字" placeholder="环绕一圈的文字" />
        </label>
        <label class="csk-seal-row">
          <span>中心文字</span>
          <FouInput v-model="sealCenterText" size="small" aria-label="中心文字" placeholder="可选；填写则不用星" />
        </label>
        <label class="csk-seal-row">
          <span>直径 (px)</span>
          <FouInput v-model="sealDiameter" type="number" size="small" aria-label="直径" />
        </label>
        <label class="csk-seal-row">
          <span>颜色</span>
          <FouInput v-model="sealColor" size="small" aria-label="章色" placeholder="#c41e3a" />
        </label>
        <label class="csk-seal-check">
          <FouCheckbox v-model="sealCenterStar" />
          <span>无中心文字时画五角星</span>
        </label>
      </div>
      <template #footer>
        <FouButton icon="close-line" size="small" native-type="button" @click="sealDialogVisible = false">取消</FouButton>
        <FouButton icon="shield-star-line" type="primary" size="small" native-type="button" @click="confirmSealStamp">生成印章</FouButton>
      </template>
    </FouDialog>

    <SketchAlignDialog
      v-model="alignDialogVisible"
      :can-align="!!selectedIds.length"
      :can-distribute="canDistribute"
      @align="(dir, rel) => alignSelected(dir, rel)"
      @distribute="distributeSelected"
    />

    <div
      v-if="ctxMenu"
      class="csk-ctx ui-font"
      :style="{ left: ctxMenu.x + 'px', top: ctxMenu.y + 'px' }"
      @pointerdown.stop
    >
      <FouButton icon="align-justify" size="small" native-type="button" @click="openAlignDialog(); closeCtx()">对齐与分布</FouButton>
      <FouButton icon="split-cells-horizontal" size="small" native-type="button" :disabled="!canDistribute" @click="distributeSelected('h'); closeCtx()">水平分布</FouButton>
      <FouButton icon="split-cells-vertical" size="small" native-type="button" :disabled="!canDistribute" @click="distributeSelected('v'); closeCtx()">垂直分布</FouButton>
      <FouButton icon="group-line" size="small" native-type="button" :disabled="selectedIds.length < 2" @click="groupSelected(); closeCtx()">组合</FouButton>
      <FouButton icon="link-unlink" size="small" native-type="button" @click="ungroupSelected(); closeCtx()">打散</FouButton>
      <FouButton icon="bring-to-front" size="small" native-type="button" :disabled="!selectedId" @click="zOrder('front'); closeCtx()">置于顶层</FouButton>
      <FouButton icon="send-to-back" size="small" native-type="button" :disabled="!selectedId" @click="zOrder('back'); closeCtx()">置于底层</FouButton>
      <FouButton icon="arrow-up-s-line" size="small" native-type="button" :disabled="!selectedId" @click="zOrder('up'); closeCtx()">上移一层</FouButton>
      <FouButton icon="arrow-down-s-line" size="small" native-type="button" :disabled="!selectedId" @click="zOrder('down'); closeCtx()">下移一层</FouButton>
      <FouButton icon="anticlockwise-2-line" size="small" native-type="button" :disabled="!selectedIds.length" @click="applyRotateDeg(90); closeCtx()">旋转 90°</FouButton>
      <FouButton icon="flip-horizontal-line" size="small" native-type="button" :disabled="!selectedIds.length" @click="mirrorSelected('h'); closeCtx()">水平镜像</FouButton>
      <FouButton icon="flip-vertical-line" size="small" native-type="button" :disabled="!selectedIds.length" @click="mirrorSelected('v'); closeCtx()">垂直镜像</FouButton>
      <FouButton icon="shape-line" size="small" native-type="button" @click="toggleNodeEdit(); closeCtx()">节点编辑</FouButton>
      <FouButton icon="file-copy-line" size="small" native-type="button" :disabled="!selectedIds.length" @click="duplicateSelected(); closeCtx()">复制</FouButton>
      <FouButton icon="delete-bin-line" size="small" native-type="button" :disabled="!selectedIds.length" @click="deleteSelected(); closeCtx()">删除</FouButton>
      <FouButton icon="close-line" size="small" native-type="button" @click="closeCtx()">关闭</FouButton>
    </div>

  </div>
</template>

<style scoped>
.csk {
  display: flex;
  flex-direction: row;
  height: 100%;
  min-height: 0;
}
.csk-inactive {
  pointer-events: none;
}
.csk-rail {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 6px;
  border-right: 1px solid var(--hairline);
  flex-shrink: 0;
  overflow: auto;
}
.csk-ctx {
  position: fixed;
  z-index: 80;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 6px;
  background: var(--panel, #fff);
  border: 1px solid var(--hairline, #e2e8f0);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.18);
  max-height: 80vh;
  overflow: auto;
}
.csk-fly {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 6px;
  border-right: 1px solid var(--hairline);
  flex-shrink: 0;
  overflow: auto;
}
.csk-seal-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.csk-seal-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 13px;
  color: var(--text-secondary, #64748b);
}
.csk-seal-check {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}
.csk-well {
  width: 22px;
  height: 22px;
  border-radius: 4px;
  border: 2px solid var(--hairline);
  background: #fff;
  cursor: pointer;
  padding: 0;
}
.csk-well.on {
  outline: 2px solid var(--primary, #0d9488);
}
.csk-well-fill {
  background-image: linear-gradient(45deg, #ccc 25%, transparent 25%, transparent 75%, #ccc 75%),
    linear-gradient(45deg, #ccc 25%, transparent 25%, transparent 75%, #ccc 75%);
  background-size: 8px 8px;
  background-position: 0 0, 4px 4px;
}
.csk-layer-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}
.csk-ly {
  border-bottom: 1px solid var(--hairline);
  padding: 4px 0;
}
.csk-ly.on {
  background: var(--primary-glow, #ecfeff);
}
.csk-ly-items {
  padding-left: 8px;
}
.csk-main {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.csk-bar,
.csk-mm {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
  padding: 8px;
  border-bottom: 1px solid var(--hairline);
}
.csk-deg-lab {
  font-size: 12px;
  color: var(--text-secondary, #64748b);
  user-select: none;
  white-space: nowrap;
}
.csk-swatch {
  width: 18px;
  height: 18px;
  border-radius: 4px;
  border: 2px solid transparent;
  cursor: pointer;
  padding: 0;
}
.csk-swatch.active {
  border-color: var(--primary, #0d9488);
}
.csk-width-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-width: 36px;
  height: 28px;
  padding: 0 6px;
  border-radius: 6px;
  border: 1px solid var(--hairline, #cbd5e1);
  background: #fff;
  font-size: 12px;
  cursor: pointer;
  color: #334155;
}
.csk-width-btn.on {
  background: #0d9488;
  border-color: #0d9488;
  color: #fff;
}
.csk-width-ico {
  display: inline-block;
  width: 12px;
  border-radius: 1px;
  background: currentColor;
}
.csk-status {
  font-size: 12px;
  color: var(--muted, #888);
}
.csk-work {
  flex: 1;
  min-height: 0;
  display: flex;
}
.csk-stage {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: grid;
  grid-template-columns: 28px 1fr;
  grid-template-rows: 28px 1fr;
}
.csk-corner {
  grid-column: 1;
  grid-row: 1;
  background: #1e293b;
  color: #e2e8f0;
  font-size: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.csk-rh {
  grid-column: 2;
  grid-row: 1;
  background: #1e293b;
  overflow: hidden;
  cursor: col-resize;
}
.csk-rv {
  grid-column: 1;
  grid-row: 2;
  background: #1e293b;
  overflow: hidden;
  cursor: row-resize;
}
.csk-rh-svg,
.csk-rv-svg {
  display: block;
}
.csk-desk {
  grid-column: 2;
  grid-row: 2;
  min-height: 0;
  overflow: auto;
  background: #64748b;
  position: relative;
}
.csk-desk.csk-select,
.csk-board.csk-select {
  cursor: default !important;
}
.csk-desk.csk-draw,
.csk-board.csk-draw {
  cursor: crosshair !important;
}
.csk-desk.csk-pan,
.csk-board.csk-pan {
  cursor: grab !important;
}
.csk-desk.csk-text,
.csk-board.csk-text {
  cursor: text !important;
}
.csk-split {
  width: 1px;
  flex-shrink: 0;
  position: relative;
  background: var(--hairline);
  align-self: stretch;
}
.csk-split::before {
  content: "";
  position: absolute;
  top: 0;
  bottom: 0;
  left: 50%;
  width: 7px;
  transform: translateX(-50%);
  cursor: col-resize;
}
.csk-form {
  display: grid;
  grid-template-columns: 88px 1fr;
  gap: 8px;
  align-items: center;
}
.csk-preview {
  grid-column: 1 / -1;
  height: 28px;
  border-radius: 4px;
}
.csk-sheet {
  transform-origin: 0 0;
  padding: 0;
  width: max-content;
  height: max-content;
}
.csk-board {
  position: relative;
}
.csk-paper {
  position: absolute;
  z-index: 1;
  background: #fff;
  box-shadow: 0 8px 28px rgba(15, 23, 42, 0.35);
  overflow: hidden;
  pointer-events: none;
}
.csk-paint,
.csk-svg {
  position: absolute;
  left: 0;
  top: 0;
  display: block;
  touch-action: none;
}
.csk-text-inline {
  position: absolute;
  z-index: 20;
  min-width: 4em;
  min-height: 1.4em;
  margin: 0;
  padding: 0 2px;
  border: 1px dashed #0d9488;
  background: rgba(255, 255, 255, 0.95);
  outline: none;
  font-family: ui-sans-serif, system-ui, sans-serif;
  line-height: 1.35;
  box-sizing: content-box;
  resize: both;
}
.csk-paint {
  pointer-events: none;
  /* CDR-lite 矢量为主：像素层不显示，避免幽灵笔迹误导 */
  visibility: hidden;
}
.csk-svg {
  z-index: 2;
  pointer-events: none;
}
.csk-guide {
  pointer-events: stroke;
}
.csk-scale-h,
.csk-rot-h circle,
.csk-node-h {
  pointer-events: all;
}
.csk-scale-h {
  fill: #fff;
  stroke: #0d9488;
}
.csk-guide-v {
  cursor: col-resize;
}
.csk-guide-h {
  cursor: row-resize;
}
.csk-layers {
  flex-shrink: 0;
  border-left: 1px solid var(--hairline);
  padding: 8px;
  overflow: auto;
  font-size: 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.csk-layer-split {
  flex-shrink: 0;
  width: 4px;
  cursor: col-resize;
  background: transparent;
}
.csk-layer-split:hover {
  background: rgba(13, 148, 136, 0.35);
}
.csk-layer-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
}
.csk-layer-row {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 2px;
  border-radius: 6px;
  border: 1px solid transparent;
}
.csk-layer-row.active {
  border-color: #0d9488;
  background: rgba(13, 148, 136, 0.08);
}
.csk-layer-name {
  flex: 1;
  min-width: 0;
}
.csk-layer-items {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 160px;
  overflow: auto;
}
.csk-layer-item {
  text-align: left;
  border: none;
  background: transparent;
  color: inherit;
  padding: 2px 4px;
  border-radius: 4px;
  cursor: pointer;
  font: inherit;
}
.csk-layer-item.on,
.csk-layer-item:hover {
  background: rgba(15, 23, 42, 0.06);
}
.csk-album {
  flex-shrink: 0;
  width: 148px;
  border-left: 1px solid var(--hairline);
  padding: 8px;
  overflow: auto;
  font-size: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.csk-album-acts {
  display: flex;
  gap: 2px;
}
.csk-album-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 0;
  border: 1px solid var(--hairline);
  border-radius: 8px;
  background: var(--panel, #fff);
  cursor: pointer;
  text-align: left;
  color: inherit;
  overflow: hidden;
}
.csk-album-item img {
  width: 100%;
  height: 72px;
  object-fit: cover;
  display: block;
}
.csk-album-item span {
  padding: 0 6px 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.csk-album-item:hover {
  outline: 2px solid var(--primary, #0d9488);
}
.csk-scale-h,
.csk-node-h {
  fill: #ecfeff;
  stroke: #0d9488;
}
.csk-layer {
  display: flex;
  align-items: center;
  gap: 2px;
}
.csk-layer.on {
  background: var(--primary-glow, #ecfeff);
}
.csk-layer-name {
  flex: 1;
  min-width: 0;
  border: 0;
  background: transparent;
  text-align: left;
  cursor: grab;
  color: inherit;
}
.csk-empty {
  color: var(--muted, #888);
  margin: 8px 0;
}
.csk-sep-h {
  display: inline-block;
  width: 1px;
  height: 22px;
  margin: 0 4px;
  background: var(--hairline, #cbd5e1);
  flex-shrink: 0;
}
.csk-export-scope {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  grid-column: 2;
}
.csk-ly-paint {
  margin-top: 8px;
  opacity: 0.92;
  border-top: 1px dashed var(--hairline, #cbd5e1);
  padding-top: 6px;
}
.csk-paint-label {
  font-size: 12px;
  font-weight: 600;
  padding: 4px 6px;
}
.csk-draw {
  cursor: crosshair !important;
}
.csk-pan {
  cursor: grab !important;
}
.csk-text {
  cursor: text !important;
}
.csk-select {
  cursor: default !important;
}
</style>
