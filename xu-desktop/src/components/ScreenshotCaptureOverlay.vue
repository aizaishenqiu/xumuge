<script setup lang="ts">
/**
 * @file ScreenshotCaptureOverlay.vue — region screenshot select + annotate overlay
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-31
 * @updated 2026-08-31
 * @version 1.4.2
 * @category Layout
 * @algo four-panel dim mask; pointer-capture drag; source-space inline text editor
 */
import { onApiCatch } from "../utils/userFacingError";
import { FouButton, fouAlert, fouMsg } from "foucui";
import { invoke } from "@tauri-apps/api/core";
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import {
  AnnotationHistory,
  canvasToPngBytes,
  canvasToPngDataUrl,
  cropImageElement,
  drawAnnotations,
  findTextAnnotationAt,
  loadImageElement,
  normalizeDragRect,
  shouldSubmitTextInput,
  textAnnotationBounds,
  type DrawTool,
  type Point,
  type Rect,
  type TextAnnotation,
} from "../utils/screenshotEditor";
import {
  attachScreenshotPathToChat,
  closeScreenshotOverlayWindow,
  exportScreenshotPng,
  listenScreenshotHotkey,
  onScreenshotStart,
  pinImageToScreen,
  savePngBytesToFile,
  screenshotFileUrl,
  SCREENSHOT_BEGIN,
  SCREENSHOT_IMAGE_READY,
  SCREENSHOT_OVERLAY_READY,
  windowRectAtScreenPoint,
  setScreenshotActive,
  type CaptureWindowInfo,
  type MonitorCaptureBounds,
} from "../utils/screenshot";
import { readScreenshotAutoAttachChat } from "../utils/screenshotPrefs";
import { emit, listen } from "@tauri-apps/api/event";

const props = withDefaults(
  defineProps<{
    /** Dedicated overlay window — session from localStorage, closes window on exit */
    standalone?: boolean;
    /** Auto-load session on mount (standalone overlay window) */
    autoStart?: boolean;
    /** Text confirmation shortcut; Ctrl+Enter mode leaves plain Enter for new lines. */
    textSubmitShortcut?: "enter" | "ctrl-enter";
  }>(),
  { standalone: false, autoStart: false, textSubmitShortcut: "enter" },
);

const visible = ref(false);
const loading = ref(false);
const phase = ref<"select" | "edit">("select");
const tool = ref<DrawTool>("rect");
const color = ref("#ff4d4f");
const lineWidth = ref(3);

const overlayRef = ref<HTMLElement | null>(null);
const bgImageEl = ref<HTMLImageElement | null>(null);
const editCanvasEl = ref<HTMLCanvasElement | null>(null);

const screenImageSrc = ref<string | null>(null);
const capturePath = ref<string | null>(null);
const captureOwner = ref<string | null>(null);
const captureToken = ref<string | null>(null);
const monitorBounds = ref<MonitorCaptureBounds | null>(null);
const bgImageNatural = ref<{ w: number; h: number } | null>(null);
const baseImageCanvas = ref<HTMLCanvasElement | null>(null);
const editBaseCanvas = ref<HTMLCanvasElement | null>(null);
let editBaseStale = true;

const selection = ref<Rect | null>(null);
const selectReady = ref(false);
const dragStart = ref<Point | null>(null);
const dragCurrent = ref<Point | null>(null);
const hoverWindowRect = ref<Rect | null>(null);
const movingSelection = ref(false);
const moveOffset = ref<Point>({ x: 0, y: 0 });
const resizing = ref<"nw" | "ne" | "sw" | "se" | "n" | "s" | "e" | "w" | null>(null);
const resizeStartRect = ref<Rect | null>(null);
const drawing = ref(false);
const strokePoints = ref<Point[]>([]);
const textEditorEl = ref<HTMLTextAreaElement | null>(null);
const textEditor = ref<{
  index: number | null;
  x: number;
  y: number;
  value: string;
  color: string;
  fontSize: number;
} | null>(null);
const movingText = ref<{
  index: number;
  original: TextAnnotation;
  annotation: TextAnnotation;
  pointerOffset: Point;
  moved: boolean;
} | null>(null);

const cropRectOverlay = ref<Rect | null>(null);
const history = new AnnotationHistory();
const historyTick = ref(0);

const overlayLayout = ref({ w: 0, h: 0 });

const dimMask = computed(() => {
  const ow = overlayLayout.value.w;
  const oh = overlayLayout.value.h;
  const s = selection.value;
  if (ow <= 0 || oh <= 0 || !s || s.w < 1 || s.h < 1) return null;
  return {
    top: { left: 0, top: 0, width: ow, height: Math.max(0, s.y) },
    left: { left: 0, top: s.y, width: Math.max(0, s.x), height: s.h },
    right: {
      left: s.x + s.w,
      top: s.y,
      width: Math.max(0, ow - s.x - s.w),
      height: s.h,
    },
    bottom: {
      left: 0,
      top: s.y + s.h,
      width: ow,
      height: Math.max(0, oh - s.y - s.h),
    },
  };
});

function markEditBaseDirty() {
  editBaseStale = true;
}

function syncOverlayLayout() {
  const el = overlayRef.value;
  if (!el) return;
  overlayLayout.value = { w: el.clientWidth, h: el.clientHeight };
}

let overlayResizeObs: ResizeObserver | undefined;
let unlistenHotkey: (() => void) | undefined;
let unlistenLocal: (() => void) | undefined;
let opening = false;
let closing = false;
let hoverSeq = 0;
let disposed = false;
let selectPointerId: number | null = null;
let editPointerId: number | null = null;

function overlayImageSize(): { w: number; h: number } {
  if (bgImageNatural.value) return bgImageNatural.value;
  const b = monitorBounds.value;
  if (b) return { w: b.width, h: b.height };
  return { w: 1, h: 1 };
}

function overlayScale(): { sx: number; sy: number } {
  const el = overlayRef.value;
  const { w, h } = overlayImageSize();
  if (!el || el.clientWidth === 0) return { sx: 1, sy: 1 };
  return { sx: w / el.clientWidth, sy: h / el.clientHeight };
}

function overlayPoint(e: Pick<PointerEvent, "clientX" | "clientY">): Point {
  const el = overlayRef.value;
  if (!el) return { x: e.clientX, y: e.clientY };
  const r = el.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

function pointInRect(p: Point, r: Rect): boolean {
  return p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h;
}

function toSourceRect(overlayRect: Rect): Rect {
  const { sx, sy } = overlayScale();
  const { w: iw, h: ih } = overlayImageSize();
  let x = overlayRect.x * sx;
  let y = overlayRect.y * sy;
  let w = overlayRect.w * sx;
  let h = overlayRect.h * sy;
  x = Math.max(0, Math.min(x, iw - 1));
  y = Math.max(0, Math.min(y, ih - 1));
  w = Math.max(1, Math.min(w, iw - x));
  h = Math.max(1, Math.min(h, ih - y));
  return { x, y, w, h };
}

function screenPointFromOverlay(p: Point): { x: number; y: number } {
  const b = monitorBounds.value;
  const el = overlayRef.value;
  if (!b || !el) return { x: p.x, y: p.y };
  const { w: iw, h: ih } = overlayImageSize();
  const ow = el.clientWidth;
  const oh = el.clientHeight;
  const imgX = (p.x / ow) * iw;
  const imgY = (p.y / oh) * ih;
  return {
    x: b.x + Math.round(imgX),
    y: b.y + Math.round(imgY),
  };
}

function windowToOverlayRect(w: CaptureWindowInfo): Rect | null {
  const b = monitorBounds.value;
  const el = overlayRef.value;
  if (!b || !el) return null;
  const { w: iw, h: ih } = overlayImageSize();
  const ow = el.clientWidth;
  const oh = el.clientHeight;
  const x = ((w.x - b.x) / iw) * ow;
  const y = ((w.y - b.y) / ih) * oh;
  const rw = (w.width / iw) * ow;
  const rh = (w.height / ih) * oh;
  if (rw < 8 || rh < 8) return null;
  return { x, y, w: rw, h: rh };
}

async function refreshHoverWindow(p: Point) {
  if (loading.value || !screenImageSrc.value) return;
  if (phase.value !== "select" || dragStart.value || selectReady.value || movingSelection.value || resizing.value) {
    return;
  }
  const seq = ++hoverSeq;
  const sp = screenPointFromOverlay(p);
  try {
    const w = await windowRectAtScreenPoint(sp.x, sp.y);
    if (seq !== hoverSeq) return;
    if (!w) {
      hoverWindowRect.value = null;
      return;
    }
    const rect = windowToOverlayRect(w);
    hoverWindowRect.value = rect;
  } catch {
    /* ignore hover errors */
  }
}

function applyImageFromBounds(bounds: MonitorCaptureBounds) {
  monitorBounds.value = bounds;
  capturePath.value = bounds.path;
  captureOwner.value = bounds.ownerWindow ?? captureOwner.value;
  captureToken.value = bounds.leaseToken ?? captureToken.value;
  if (bounds.path) {
    screenImageSrc.value = screenshotFileUrl(bounds.path);
  }
}

let unlistenImageReady: (() => void) | undefined;
let unlistenBegin: (() => void) | undefined;
let loadWatchdog: number | undefined;
let editRaf: number | undefined;
let pendingEditPoint: Point | null = null;

function clearLoadWatchdog() {
  if (loadWatchdog !== undefined) {
    window.clearTimeout(loadWatchdog);
    loadWatchdog = undefined;
  }
}

function armLoadWatchdog() {
  clearLoadWatchdog();
  loadWatchdog = window.setTimeout(() => {
    loadWatchdog = undefined;
    if (!loading.value) return;
    void fouAlert("截图超时，请再试一次", "提示");
    void closeCapture();
  }, 15000);
}

function releaseCanvas(canvas: HTMLCanvasElement | null) {
  if (!canvas) return;
  canvas.width = 0;
  canvas.height = 0;
}

function disposeCaptureResources() {
  clearLoadWatchdog();
  if (editRaf !== undefined) {
    cancelAnimationFrame(editRaf);
    editRaf = undefined;
  }
  pendingEditPoint = null;
  selectPointerId = null;
  editPointerId = null;
  overlayResizeObs?.disconnect();
  overlayResizeObs = undefined;
  if (bgImageEl.value) {
    bgImageEl.value.removeAttribute("src");
  }
  releaseCanvas(editCanvasEl.value);
  releaseCanvas(baseImageCanvas.value);
  releaseCanvas(editBaseCanvas.value);
  bgImageEl.value = null;
  editCanvasEl.value = null;
  baseImageCanvas.value = null;
  editBaseCanvas.value = null;
  screenImageSrc.value = null;
  capturePath.value = null;
  captureOwner.value = null;
  captureToken.value = null;
  monitorBounds.value = null;
  bgImageNatural.value = null;
  cropRectOverlay.value = null;
  history.reset();
  historyTick.value++;
  strokePoints.value = [];
  textEditor.value = null;
  movingText.value = null;
  dragStart.value = null;
  dragCurrent.value = null;
  drawing.value = false;
  editBaseStale = true;
}

function resetSelectState() {
  disposeCaptureResources();
  visible.value = true;
  loading.value = true;
  phase.value = "select";
  selection.value = null;
  selectReady.value = false;
  dragStart.value = null;
  dragCurrent.value = null;
  hoverWindowRect.value = null;
  cropRectOverlay.value = null;
  markEditBaseDirty();
}

async function openCapture() {
  if (opening || closing) return;
  if (visible.value && !props.standalone) return;
  opening = true;
  closing = false;
  resetSelectState();
  armLoadWatchdog();

  try {
    if (props.standalone) {
      return;
    }
    const { captureMonitorAtCursor } = await import("../utils/screenshot");
    if (!captureOwner.value || !captureToken.value) {
      throw new Error("截图会话缺少有效租约，请重新开始截图");
    }
    const captured = await captureMonitorAtCursor(captureOwner.value, captureToken.value);
    applyImageFromBounds(captured);
  } catch (e) {
    void onApiCatch(e);
    await closeCapture();
  } finally {
    opening = false;
  }
}

async function closeCapture() {
  if (closing) return;
  closing = true;
  const owner = captureOwner.value;
  const token = captureToken.value;
  setScreenshotActive(false);
  visible.value = false;
  phase.value = "select";
  selection.value = null;
  selectReady.value = false;
  disposeCaptureResources();
  hoverSeq++;
  try {
    if (props.standalone) {
      await closeScreenshotOverlayWindow(owner, token);
    }
  } finally {
    closing = false;
  }
}

function onBgImageLoad(e: Event) {
  const img = e.target as HTMLImageElement;
  if (img.naturalWidth > 0 && img.naturalHeight > 0) {
    bgImageNatural.value = { w: img.naturalWidth, h: img.naturalHeight };
  }
  loading.value = false;
  clearLoadWatchdog();
}

async function onBgImageError() {
  if (!capturePath.value || screenImageSrc.value?.startsWith("data:")) return;
  console.warn("[screenshot] asset protocol image load failed; using IPC fallback");
  try {
    screenImageSrc.value = await invoke<string>("xu_read_image_data_url", { path: capturePath.value });
  } catch (e) {
    void onApiCatch(e, undefined, { fallback: "截图加载失败" });
    await closeCapture();
  }
}

function applyResize(p: Point) {
  const start = resizeStartRect.value;
  const handle = resizing.value;
  if (!start || !handle) return;
  let x = start.x;
  let y = start.y;
  let w = start.w;
  let h = start.h;
  if (handle === "nw") {
    w = start.x + start.w - p.x;
    h = start.y + start.h - p.y;
    x = p.x;
    y = p.y;
  } else if (handle === "ne") {
    w = p.x - start.x;
    h = start.y + start.h - p.y;
    y = p.y;
  } else if (handle === "sw") {
    w = start.x + start.w - p.x;
    h = p.y - start.y;
    x = p.x;
  } else if (handle === "se") {
    w = p.x - start.x;
    h = p.y - start.y;
  } else if (handle === "n") {
    h = start.y + start.h - p.y;
    y = p.y;
  } else if (handle === "s") {
    h = p.y - start.y;
  } else if (handle === "w") {
    w = start.x + start.w - p.x;
    x = p.x;
  } else if (handle === "e") {
    w = p.x - start.x;
  }
  if (w < 8 || h < 8) return;
  selection.value = { x, y, w, h };
}

function captureOverlayPointer(e: PointerEvent) {
  selectPointerId = e.pointerId;
  try {
    overlayRef.value?.setPointerCapture(e.pointerId);
  } catch {
    /* the overlay may be closing */
  }
}

function onSelectDown(e: PointerEvent) {
  if (phase.value !== "select" || e.button !== 0 || loading.value) return;
  captureOverlayPointer(e);
  const p = overlayPoint(e);

  if (selectReady.value && selection.value && pointInRect(p, selection.value)) {
    movingSelection.value = true;
    moveOffset.value = { x: p.x - selection.value.x, y: p.y - selection.value.y };
    return;
  }

  selectReady.value = false;
  dragStart.value = p;
  dragCurrent.value = p;
  selection.value = null;
  hoverWindowRect.value = null;
}

function onHandleDown(e: PointerEvent, handle: "nw" | "ne" | "sw" | "se" | "n" | "s" | "e" | "w") {
  e.stopPropagation();
  if (!selection.value) return;
  captureOverlayPointer(e);
  resizing.value = handle;
  resizeStartRect.value = { ...selection.value };
}

function onSelectMove(e: PointerEvent) {
  if (phase.value !== "select" || loading.value) return;
  if (selectPointerId !== null && e.pointerId !== selectPointerId) return;

  if (resizing.value) {
    applyResize(overlayPoint(e));
    return;
  }

  if (movingSelection.value && selection.value) {
    const p = overlayPoint(e);
    selection.value = {
      x: p.x - moveOffset.value.x,
      y: p.y - moveOffset.value.y,
      w: selection.value.w,
      h: selection.value.h,
    };
    return;
  }

  if (dragStart.value) {
    dragCurrent.value = overlayPoint(e);
    selection.value = normalizeDragRect(dragStart.value, dragCurrent.value);
    hoverWindowRect.value = null;
    return;
  }
}

function finishSelectPointer(e: Pick<PointerEvent, "clientX" | "clientY">) {
  if (phase.value !== "select") return;

  if (resizing.value) {
    resizing.value = null;
    resizeStartRect.value = null;
    return;
  }

  if (movingSelection.value) {
    movingSelection.value = false;
    return;
  }

  if (!dragStart.value) return;
  const end = overlayPoint(e);
  dragCurrent.value = end;
  const rect = normalizeDragRect(dragStart.value, dragCurrent.value);
  const start = dragStart.value;
  dragStart.value = null;
  dragCurrent.value = null;
  if (rect.w < 8 || rect.h < 8) {
    void (async () => {
      await refreshHoverWindow(start);
      if (hoverWindowRect.value) {
        selection.value = { ...hoverWindowRect.value };
        selectReady.value = true;
      } else {
        selection.value = null;
      }
    })();
    return;
  }
  selection.value = rect;
  selectReady.value = true;
}

function onSelectUp(e: PointerEvent) {
  if (selectPointerId !== e.pointerId) return;
  selectPointerId = null;
  finishSelectPointer(e);
  try {
    overlayRef.value?.releasePointerCapture(e.pointerId);
  } catch {
    /* capture may already be lost */
  }
}

function onSelectCaptureLost(e: PointerEvent) {
  if (selectPointerId !== e.pointerId) return;
  selectPointerId = null;
  finishSelectPointer(e);
}

function clearSelection() {
  selection.value = null;
  selectReady.value = false;
  hoverWindowRect.value = null;
}

async function onSelectDblClick() {
  if (phase.value === "select" && selectReady.value && selection.value) {
    await confirmSelection();
  } else if (phase.value === "edit") {
    await finish(false);
  }
}

async function confirmSelection() {
  if (!selection.value) return;
  await enterEdit(selection.value);
}

async function enterEdit(overlayRect: Rect) {
  const src = screenImageSrc.value || (capturePath.value ? screenshotFileUrl(capturePath.value) : null);
  if (!src) return;
  let img = bgImageEl.value;
  if (!img || !img.complete || img.naturalWidth === 0) {
    img = await loadImageElement(src);
  }
  const sourceRect = toSourceRect(overlayRect);
  baseImageCanvas.value = cropImageElement(img, sourceRect);
  markEditBaseDirty();
  cropRectOverlay.value = overlayRect;
  selection.value = overlayRect;
  phase.value = "edit";
  requestAnimationFrame(() => redrawEdit());
}

function rebuildEditBase() {
  const base = baseImageCanvas.value;
  if (!base) return;
  if (!editBaseCanvas.value) {
    editBaseCanvas.value = document.createElement("canvas");
  }
  const off = editBaseCanvas.value;
  if (off.width !== base.width || off.height !== base.height) {
    off.width = base.width;
    off.height = base.height;
  }
  const ctx = off.getContext("2d");
  if (!ctx) return;
  ctx.drawImage(base, 0, 0);
  const hiddenTextIndex = textEditor.value?.index ?? movingText.value?.index ?? null;
  const annotations =
    hiddenTextIndex === null
      ? history.annotations
      : history.annotations.filter((_, index) => index !== hiddenTextIndex);
  drawAnnotations(ctx, annotations, base);
  editBaseStale = false;
}

function blitEditToVisible() {
  const off = editBaseCanvas.value;
  const canvas = editCanvasEl.value;
  if (!off || !canvas) return;
  if (canvas.width !== off.width || canvas.height !== off.height) {
    canvas.width = off.width;
    canvas.height = off.height;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.drawImage(off, 0, 0);
}

function redrawEdit() {
  void historyTick.value;
  if (editBaseStale) rebuildEditBase();
  blitEditToVisible();
  const moving = movingText.value;
  const canvas = editCanvasEl.value;
  const base = baseImageCanvas.value;
  const ctx = canvas?.getContext("2d");
  if (moving && ctx && base) {
    drawAnnotations(ctx, [moving.annotation], base);
  }
}

function canvasPoint(e: Pick<PointerEvent, "clientX" | "clientY">): Point | null {
  const canvas = editCanvasEl.value;
  if (!canvas) return null;
  const r = canvas.getBoundingClientRect();
  const sx = canvas.width / r.width;
  const sy = canvas.height / r.height;
  return {
    x: (e.clientX - r.left) * sx,
    y: (e.clientY - r.top) * sy,
  };
}

const textEditorStyle = computed<Record<string, string>>(() => {
  void overlayLayout.value;
  const editor = textEditor.value;
  const canvas = editCanvasEl.value;
  if (!editor || !canvas || canvas.width <= 0 || canvas.height <= 0) {
    return {} as Record<string, string>;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) return {} as Record<string, string>;
  const bounds = textAnnotationBounds(ctx, {
    kind: "text",
    x: editor.x,
    y: editor.y,
    text: editor.value || " ",
    color: editor.color,
    fontSize: editor.fontSize,
  });
  const scaleX = canvas.clientWidth / canvas.width;
  const scaleY = canvas.clientHeight / canvas.height;
  const left = editor.x * scaleX;
  const top = editor.y * scaleY;
  const maxWidth = Math.max(36, canvas.clientWidth - left);
  return {
    left: `${left}px`,
    top: `${top}px`,
    width: `${Math.min(maxWidth, Math.max(36, bounds.w * scaleX + 4))}px`,
    height: `${Math.max(editor.fontSize * 1.2 * scaleY + 4, bounds.h * scaleY + 4)}px`,
    fontSize: `${editor.fontSize * scaleY}px`,
    lineHeight: "1.2",
    color: editor.color,
  };
});

async function beginTextEditor(point: Point, index: number | null = null, annotation?: TextAnnotation) {
  textEditor.value = {
    index,
    x: annotation?.x ?? point.x,
    y: annotation?.y ?? point.y,
    value: annotation?.text ?? "",
    color: annotation?.color ?? color.value,
    fontSize: annotation?.fontSize ?? 16,
  };
  markEditBaseDirty();
  redrawEdit();
  await nextTick();
  textEditorEl.value?.focus();
  const length = textEditorEl.value?.value.length ?? 0;
  textEditorEl.value?.setSelectionRange(length, length);
}

function commitTextEditor() {
  const editor = textEditor.value;
  if (!editor) return;
  const text = editor.value.replace(/\r/g, "").trim();
  textEditor.value = null;
  if (text) {
    const annotation: TextAnnotation = {
      kind: "text",
      x: editor.x,
      y: editor.y,
      text,
      color: editor.color,
      fontSize: editor.fontSize,
    };
    if (editor.index === null) history.push(annotation);
    else history.replace(editor.index, annotation);
    historyTick.value++;
  } else if (editor.index !== null && history.remove(editor.index)) {
    historyTick.value++;
  }
  markEditBaseDirty();
  redrawEdit();
}

function cancelTextEditor() {
  if (!textEditor.value) return;
  textEditor.value = null;
  markEditBaseDirty();
  redrawEdit();
}

function onTextEditorKeydown(e: KeyboardEvent) {
  if (e.key === "Escape") {
    e.preventDefault();
    e.stopPropagation();
    cancelTextEditor();
    return;
  }
  if (e.key !== "Enter") return;
  if (!shouldSubmitTextInput(e, props.textSubmitShortcut)) return;
  e.preventDefault();
  e.stopPropagation();
  commitTextEditor();
}

function onEditDown(e: PointerEvent) {
  if (phase.value !== "edit" || e.button !== 0) return;
  editPointerId = e.pointerId;
  try {
    editCanvasEl.value?.setPointerCapture(e.pointerId);
  } catch {
    /* canvas may be replaced while capture starts */
  }
  if (textEditor.value) commitTextEditor();
  const p = canvasPoint(e);
  if (!p) return;

  if (tool.value === "text") {
    const canvas = editCanvasEl.value;
    const ctx = canvas?.getContext("2d");
    const hit = ctx ? findTextAnnotationAt(ctx, history.annotations, p, 5) : null;
    if (hit) {
      movingText.value = {
        index: hit.index,
        original: { ...hit.annotation },
        annotation: { ...hit.annotation },
        pointerOffset: { x: p.x - hit.annotation.x, y: p.y - hit.annotation.y },
        moved: false,
      };
      markEditBaseDirty();
      redrawEdit();
    } else {
      void beginTextEditor(p);
    }
    return;
  }

  drawing.value = true;
  dragStart.value = p;
  dragCurrent.value = p;
  redrawEdit();
  if (tool.value === "brush") strokePoints.value = [p];
}

function onEditMove(e: PointerEvent) {
  if (phase.value !== "edit") return;
  if (editPointerId !== null && e.pointerId !== editPointerId) return;
  const p = canvasPoint(e);
  if (!p) return;
  const moving = movingText.value;
  if (moving) {
    const x = p.x - moving.pointerOffset.x;
    const y = p.y - moving.pointerOffset.y;
    moving.annotation = { ...moving.annotation, x, y };
    moving.moved =
      moving.moved ||
      Math.abs(x - moving.original.x) > 1 ||
      Math.abs(y - moving.original.y) > 1;
    redrawEdit();
    return;
  }
  if (!drawing.value) return;
  pendingEditPoint = p;
  if (editRaf === undefined) {
    editRaf = requestAnimationFrame(flushEditMove);
  }
}

function paintBrushSegment(from: Point, to: Point) {
  const canvas = editCanvasEl.value;
  const ctx = canvas?.getContext("2d");
  if (!ctx) return;
  ctx.strokeStyle = color.value;
  ctx.lineWidth = lineWidth.value;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
}

function flushEditMove() {
  if (editRaf !== undefined) {
    cancelAnimationFrame(editRaf);
    editRaf = undefined;
  }
  const p = pendingEditPoint;
  pendingEditPoint = null;
  if (!p || !drawing.value || phase.value !== "edit") return;
  if (tool.value === "brush") {
    const previous = strokePoints.value[strokePoints.value.length - 1];
    if (previous) {
      strokePoints.value.push(p);
      paintBrushSegment(previous, p);
    }
    return;
  }
  dragCurrent.value = p;
  paintPreview();
}

function finishEditPointer() {
  const moving = movingText.value;
  if (moving) {
    movingText.value = null;
    if (moving.moved) {
      history.replace(moving.index, moving.annotation);
      historyTick.value++;
      markEditBaseDirty();
      redrawEdit();
    } else {
      void beginTextEditor(
        { x: moving.original.x, y: moving.original.y },
        moving.index,
        moving.original,
      );
    }
    return;
  }
  if (!drawing.value || phase.value !== "edit") return;
  flushEditMove();
  drawing.value = false;

  if (tool.value === "mosaic" && dragStart.value && dragCurrent.value) {
    const rect = normalizeDragRect(dragStart.value, dragCurrent.value);
    if (rect.w > 4 && rect.h > 4) {
      history.push({ kind: "mosaic", rect, block: 12 });
      historyTick.value++;
      markEditBaseDirty();
    }
  } else if (tool.value === "brush" && strokePoints.value.length > 1) {
    history.push({
      kind: "stroke",
      tool: "brush",
      color: color.value,
      width: lineWidth.value,
      points: [...strokePoints.value],
    });
    historyTick.value++;
    markEditBaseDirty();
  } else if (dragStart.value && dragCurrent.value && tool.value !== "text") {
    const map: Record<string, StrokeAnnotationTool> = {
      rect: "rect",
      ellipse: "ellipse",
      arrow: "arrow",
      line: "line",
    };
    const mapped = map[tool.value];
    if (mapped) {
      history.push({
        kind: "stroke",
        tool: mapped,
        color: color.value,
        width: lineWidth.value,
        points: [dragStart.value, dragCurrent.value],
      });
      historyTick.value++;
      markEditBaseDirty();
    }
  }

  dragStart.value = null;
  dragCurrent.value = null;
  strokePoints.value = [];
  redrawEdit();
}

function onEditUp(e: PointerEvent) {
  if (editPointerId !== e.pointerId) return;
  editPointerId = null;
  finishEditPointer();
  try {
    editCanvasEl.value?.releasePointerCapture(e.pointerId);
  } catch {
    /* capture may already be lost */
  }
}

function onEditCaptureLost(e: PointerEvent) {
  if (editPointerId !== e.pointerId) return;
  editPointerId = null;
  finishEditPointer();
}

type StrokeAnnotationTool = "brush" | "line" | "arrow" | "rect" | "ellipse";

function paintPreview() {
  if (editBaseStale) rebuildEditBase();
  blitEditToVisible();
  const canvas = editCanvasEl.value;
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.strokeStyle = color.value;
  ctx.fillStyle = color.value;
  ctx.lineWidth = lineWidth.value;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  if (tool.value === "brush" && strokePoints.value.length > 1) {
    ctx.beginPath();
    ctx.moveTo(strokePoints.value[0].x, strokePoints.value[0].y);
    for (let i = 1; i < strokePoints.value.length; i++) {
      ctx.lineTo(strokePoints.value[i].x, strokePoints.value[i].y);
    }
    ctx.stroke();
  } else if (dragStart.value && dragCurrent.value) {
    const r = normalizeDragRect(dragStart.value, dragCurrent.value);
    if (tool.value === "rect" || tool.value === "mosaic") {
      ctx.strokeRect(r.x, r.y, r.w, r.h);
    } else if (tool.value === "ellipse") {
      ctx.beginPath();
      ctx.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2, 0, 0, Math.PI * 2);
      ctx.stroke();
    } else if (tool.value === "line" || tool.value === "arrow") {
      ctx.beginPath();
      ctx.moveTo(dragStart.value.x, dragStart.value.y);
      ctx.lineTo(dragCurrent.value.x, dragCurrent.value.y);
      ctx.stroke();
    }
  }
}

function undo() {
  if (history.undo()) {
    historyTick.value++;
    markEditBaseDirty();
    redrawEdit();
  }
}

function redo() {
  if (history.redo()) {
    historyTick.value++;
    markEditBaseDirty();
    redrawEdit();
  }
}

async function finish(copyOnly = false) {
  commitTextEditor();
  const canvas = editCanvasEl.value;
  if (!canvas) return;
  redrawEdit();
  const startedAt = performance.now();
  let pngBytes: Uint8Array;
  try {
    pngBytes = await canvasToPngBytes(canvas);
  } catch (e) {
    void onApiCatch(e);
    return;
  }
  // Close overlay before IPC so “完成” feels instant; canvas bytes are already encoded.
  await closeCapture();
  try {
    const attachment = await exportScreenshotPng(pngBytes);
    if (readScreenshotAutoAttachChat()) {
      attachScreenshotPathToChat(attachment.path);
    }
    console.info(
      `[screenshot:perf] export ${Math.round(performance.now() - startedAt)}ms (${pngBytes.byteLength} bytes)`,
    );
    fouMsg.success(
      readScreenshotAutoAttachChat()
        ? copyOnly
          ? "已复制并加入输入框"
          : "已复制并加入输入框"
        : "已复制到剪贴板",
    );
  } catch (e) {
    void onApiCatch(e);
  }
}

async function onSave() {
  commitTextEditor();
  const canvas = editCanvasEl.value;
  if (!canvas) return;
  redrawEdit();
  try {
    await savePngBytesToFile(await canvasToPngBytes(canvas));
    fouMsg.success("已保存");
  } catch (e) {
    void onApiCatch(e);
  }
}

async function onPin() {
  commitTextEditor();
  const canvas = editCanvasEl.value;
  if (!canvas) return;
  redrawEdit();
  try {
    await pinImageToScreen(canvasToPngDataUrl(canvas));
    fouMsg.success("已固定到屏幕");
  } catch (e) {
    void onApiCatch(e);
  }
}

function onKey(e: KeyboardEvent) {
  if (!visible.value) return;
  if (e.key === "Escape") {
    e.preventDefault();
    e.stopPropagation();
    void closeCapture();
  } else if (e.key === "Enter" && phase.value === "select" && selectReady.value && selection.value) {
    e.preventDefault();
    void confirmSelection();
  }
}

const selectStyle = ref<Record<string, string>>({});

watch(selection, (s) => {
  if (!s) {
    selectStyle.value = {};
    return;
  }
  selectStyle.value = {
    left: `${s.x}px`,
    top: `${s.y}px`,
    width: `${s.w}px`,
    height: `${s.h}px`,
  };
});

const TOOLS: [DrawTool, string, string][] = [
  ["rect", "square-line", "矩形"],
  ["ellipse", "checkbox-blank-circle-line", "椭圆"],
  ["arrow", "arrow-right-up-line", "箭头"],
  ["line", "subtract-line", "直线"],
  ["brush", "brush-line", "画笔"],
  ["mosaic", "grid-line", "马赛克"],
  ["text", "text", "文字"],
];

const HANDLES: ["nw" | "ne" | "sw" | "se" | "n" | "s" | "e" | "w", string][] = [
  ["nw", "shot-handle-nw"],
  ["ne", "shot-handle-ne"],
  ["sw", "shot-handle-sw"],
  ["se", "shot-handle-se"],
  ["n", "shot-handle-n"],
  ["s", "shot-handle-s"],
  ["e", "shot-handle-e"],
  ["w", "shot-handle-w"],
];

watch(visible, (v) => {
  if (!v) {
    overlayResizeObs?.disconnect();
    return;
  }
  requestAnimationFrame(() => {
    syncOverlayLayout();
    const el = overlayRef.value;
    if (!el) return;
    if (!overlayResizeObs) {
      overlayResizeObs = new ResizeObserver(() => syncOverlayLayout());
    }
    overlayResizeObs.observe(el);
  });
});

onMounted(() => {
  disposed = false;
  if (props.standalone) {
    visible.value = true;
    loading.value = true;
    void (async () => {
      const stopBegin = await listen<MonitorCaptureBounds>(SCREENSHOT_BEGIN, (e) => {
        if (disposed) return;
        resetSelectState();
        armLoadWatchdog();
        if (e.payload?.path) applyImageFromBounds(e.payload);
      });
      if (disposed) {
        stopBegin();
        return;
      }
      unlistenBegin = stopBegin;
      const stopImageReady = await listen<MonitorCaptureBounds>(SCREENSHOT_IMAGE_READY, (e) => {
        if (disposed) return;
        if (e.payload?.path) applyImageFromBounds(e.payload);
      });
      if (disposed) {
        stopImageReady();
        return;
      }
      unlistenImageReady = stopImageReady;
      await emit(SCREENSHOT_OVERLAY_READY);
    })();
  } else {
    unlistenLocal = onScreenshotStart(() => void openCapture());
    void listenScreenshotHotkey(() => {
      if (!disposed) void openCapture();
    }).then((fn) => {
      if (disposed) fn();
      else unlistenHotkey = fn;
    });
  }
  window.addEventListener("keydown", onKey);
});

onUnmounted(() => {
  disposed = true;
  const owner = captureOwner.value;
  const token = captureToken.value;
  disposeCaptureResources();
  void closeScreenshotOverlayWindow(owner, token);
  unlistenBegin?.();
  unlistenImageReady?.();
  unlistenLocal?.();
  unlistenHotkey?.();
  window.removeEventListener("keydown", onKey);
});
</script>

<template>
  <div
      v-if="visible"
      ref="overlayRef"
      class="shot-overlay ui-font"
      :class="{ 'is-loading': loading }"
      @pointerdown="phase === 'select' ? onSelectDown($event) : undefined"
      @pointermove="phase === 'select' ? onSelectMove($event) : undefined"
      @pointerup="phase === 'select' ? onSelectUp($event) : undefined"
      @lostpointercapture="phase === 'select' ? onSelectCaptureLost($event) : undefined"
      @dblclick="onSelectDblClick"
      @contextmenu.prevent="closeCapture"
    >
      <img
        v-if="phase === 'select' && screenImageSrc"
        ref="bgImageEl"
        class="shot-bg"
        :src="screenImageSrc"
        alt=""
        draggable="false"
        decoding="async"
        @load="onBgImageLoad"
        @error="onBgImageError"
      />

      <template v-if="phase === 'select' && !loading && dimMask">
        <div class="shot-mask" :style="dimMask.top" />
        <div class="shot-mask" :style="dimMask.left" />
        <div class="shot-mask" :style="dimMask.right" />
        <div class="shot-mask" :style="dimMask.bottom" />
      </template>

      <div v-if="loading" class="shot-hint">截屏中…</div>
      <div v-else-if="phase === 'select'" class="shot-hint">
        单击窗口快速选取 · 拖拽框选 · 四边/四角可拉伸 · 双击确认 · Esc 取消
      </div>

      <div
        v-if="phase === 'select' && selection"
        class="shot-select-rect"
        :class="{ 'is-ready': selectReady }"
        :style="selectStyle"
        @dblclick.stop="onSelectDblClick"
      >
        <span class="shot-size">{{ Math.round(selection.w) }} × {{ Math.round(selection.h) }}</span>
        <template v-if="selectReady">
          <div
            v-for="h in HANDLES"
            :key="h[0]"
            :class="['shot-handle', h[1]]"
            @pointerdown.stop="onHandleDown($event, h[0])"
          />
        </template>
      </div>

      <div
        v-if="phase === 'edit' && cropRectOverlay"
        class="shot-edit-wrap"
        :style="{
          left: `${cropRectOverlay.x}px`,
          top: `${cropRectOverlay.y}px`,
        }"
      >
        <canvas
          ref="editCanvasEl"
          class="shot-edit-canvas"
          :style="{ width: `${cropRectOverlay.w}px`, height: `${cropRectOverlay.h}px` }"
          @pointerdown.stop="onEditDown"
          @pointermove.stop="onEditMove"
          @pointerup.stop="onEditUp"
          @lostpointercapture.stop="onEditCaptureLost"
          @dblclick.stop="onSelectDblClick"
        />
        <textarea
          v-if="textEditor"
          ref="textEditorEl"
          v-model="textEditor.value"
          class="shot-text-editor"
          :style="textEditorStyle"
          aria-label="截图文字"
          spellcheck="false"
          @mousedown.stop
          @mouseup.stop
          @click.stop
          @dblclick.stop
          @contextmenu.stop
          @keydown="onTextEditorKeydown"
          @blur="commitTextEditor"
        />
      </div>

      <div
        v-if="phase === 'select' && !loading && selectReady && selection"
        class="shot-toolbar"
        @pointerdown.stop
        @pointerup.stop
        @mousedown.stop
        @click.stop
      >
        <FouButton icon="check-line" size="small" type="primary" native-type="button" @click="confirmSelection">
          确认选区
        </FouButton>
        <FouButton icon="refresh-line" size="small" text native-type="button" @click="clearSelection">
          重新选区
        </FouButton>
        <FouButton icon="close-line" size="small" text native-type="button" @click="closeCapture">
          取消
        </FouButton>
      </div>

      <div
        v-if="phase === 'edit'"
        class="shot-toolbar"
        @pointerdown.stop
        @pointerup.stop
        @mousedown.stop
        @click.stop
      >
        <FouButton
          v-for="t in TOOLS"
          :key="t[0]"
          :icon="t[1]"
          size="small"
          :type="tool === t[0] ? 'primary' : 'default'"
          text
          native-type="button"
          @click="tool = t[0]"
        >
          {{ t[2] }}
        </FouButton>
        <input v-model="color" type="color" class="color-pick" title="颜色" />
        <FouButton icon="arrow-go-back-line" size="small" text native-type="button" @click="undo">
          撤销
        </FouButton>
        <FouButton icon="arrow-go-forward-line" size="small" text native-type="button" @click="redo">
          重做
        </FouButton>
        <FouButton icon="save-line" size="small" text native-type="button" @click="onSave">保存</FouButton>
        <FouButton icon="pushpin-line" size="small" text native-type="button" @click="onPin">
          固定
        </FouButton>
        <FouButton icon="file-copy-line" size="small" text native-type="button" @click="finish(true)">
          复制
        </FouButton>
        <FouButton icon="check-line" size="small" type="primary" native-type="button" @click="finish(false)">
          完成
        </FouButton>
        <FouButton icon="close-line" size="small" text native-type="button" @click="closeCapture">
          取消
        </FouButton>
      </div>
    </div>
</template>

<style scoped>
.shot-overlay {
  position: fixed;
  inset: 0;
  z-index: 90000;
  background: #000;
  cursor: crosshair;
}
.shot-overlay.is-loading {
  background: rgba(0, 0, 0, 0.72);
  cursor: wait;
}
.shot-bg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: fill;
  pointer-events: none;
  user-select: none;
}
.shot-hint {
  position: fixed;
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  padding: 6px 14px;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.65);
  color: #fff;
  font-size: 13px;
  pointer-events: none;
  z-index: 2;
}
.shot-mask {
  position: absolute;
  background: rgba(0, 0, 0, 0.45);
  pointer-events: none;
  z-index: 1;
}
.shot-select-rect {
  position: absolute;
  border: 2px solid var(--primary, #2dd4bf);
  pointer-events: none;
  z-index: 2;
}
.shot-select-rect.is-ready {
  pointer-events: auto;
  cursor: move;
}
.shot-size {
  position: absolute;
  bottom: -24px;
  left: 0;
  font-size: 12px;
  color: #fff;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.8);
  white-space: nowrap;
  pointer-events: none;
}
.shot-handle {
  position: absolute;
  width: 10px;
  height: 10px;
  background: #fff;
  border: 2px solid var(--primary, #2dd4bf);
  border-radius: 2px;
  pointer-events: auto;
}
.shot-handle-nw {
  top: -6px;
  left: -6px;
  cursor: nwse-resize;
}
.shot-handle-ne {
  top: -6px;
  right: -6px;
  cursor: nesw-resize;
}
.shot-handle-sw {
  bottom: -6px;
  left: -6px;
  cursor: nesw-resize;
}
.shot-handle-se {
  bottom: -6px;
  right: -6px;
  cursor: nwse-resize;
}
.shot-handle-n {
  top: -6px;
  left: 50%;
  margin-left: -5px;
  cursor: ns-resize;
}
.shot-handle-s {
  bottom: -6px;
  left: 50%;
  margin-left: -5px;
  cursor: ns-resize;
}
.shot-handle-e {
  top: 50%;
  right: -6px;
  margin-top: -5px;
  cursor: ew-resize;
}
.shot-handle-w {
  top: 50%;
  left: -6px;
  margin-top: -5px;
  cursor: ew-resize;
}
.shot-edit-wrap {
  position: absolute;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.35);
  z-index: 2;
}
.shot-edit-canvas {
  display: block;
  cursor: crosshair;
}
.shot-text-editor {
  position: absolute;
  z-index: 2;
  box-sizing: border-box;
  min-width: 36px;
  min-height: 24px;
  padding: 0;
  overflow: hidden;
  resize: none;
  border: 1px dashed currentColor;
  border-radius: 2px;
  outline: none;
  background: rgba(255, 255, 255, 0.12);
  font-family: sans-serif;
  white-space: pre;
}
.shot-text-editor:focus {
  background: rgba(255, 255, 255, 0.2);
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.7);
}
.shot-toolbar {
  position: fixed;
  bottom: 16px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  padding: 8px 12px;
  border-radius: 12px;
  background: var(--surface-card, #fff);
  border: 1px solid var(--hairline, #e2e8f0);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.15);
  max-width: 96vw;
  z-index: 3;
}
.color-pick {
  width: 28px;
  height: 28px;
  padding: 0;
  border: none;
  background: transparent;
  cursor: pointer;
}
</style>
