/**
 * @file screenshotEditor.ts — canvas crop/annotation helpers for region screenshot editor
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-31
 * @version 1.3.0
 * @category Layout
 * @algo cropImageElement O(wh); multiline text bounds + reverse hit-testing O(n)
 */

export type DrawTool =
  | "select"
  | "rect"
  | "ellipse"
  | "arrow"
  | "line"
  | "brush"
  | "mosaic"
  | "text";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface StrokeAnnotation {
  kind: "stroke";
  tool: "brush" | "line" | "arrow" | "rect" | "ellipse";
  color: string;
  width: number;
  points: Point[];
}

export interface MosaicAnnotation {
  kind: "mosaic";
  rect: Rect;
  block: number;
}

export interface TextAnnotation {
  kind: "text";
  x: number;
  y: number;
  text: string;
  color: string;
  fontSize: number;
}

export type Annotation = StrokeAnnotation | MosaicAnnotation | TextAnnotation;

export const TEXT_LINE_HEIGHT_RATIO = 1.2;

export class AnnotationHistory {
  private stack: Annotation[][] = [[]];
  private index = 0;

  get annotations(): Annotation[] {
    return this.stack[this.index] ?? [];
  }

  push(ann: Annotation) {
    const next = [...this.annotations, ann];
    this.stack = this.stack.slice(0, this.index + 1);
    this.stack.push(next);
    this.index = this.stack.length - 1;
  }

  replace(annotationIndex: number, ann: Annotation): boolean {
    if (annotationIndex < 0 || annotationIndex >= this.annotations.length) return false;
    const next = this.annotations.map((current, index) => (index === annotationIndex ? ann : current));
    this.stack = this.stack.slice(0, this.index + 1);
    this.stack.push(next);
    this.index = this.stack.length - 1;
    return true;
  }

  /** Remove one annotation as a new undoable history step; invalid indexes leave history unchanged. */
  remove(annotationIndex: number): boolean {
    if (annotationIndex < 0 || annotationIndex >= this.annotations.length) return false;
    const next = this.annotations.filter((_, index) => index !== annotationIndex);
    this.stack = this.stack.slice(0, this.index + 1);
    this.stack.push(next);
    this.index = this.stack.length - 1;
    return true;
  }

  undo(): boolean {
    if (this.index <= 0) return false;
    this.index -= 1;
    return true;
  }

  redo(): boolean {
    if (this.index >= this.stack.length - 1) return false;
    this.index += 1;
    return true;
  }

  reset() {
    this.stack = [[]];
    this.index = 0;
  }
}

export function cropCanvas(
  source: HTMLCanvasElement,
  rect: Rect,
): HTMLCanvasElement {
  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.round(rect.w));
  out.height = Math.max(1, Math.round(rect.h));
  const ctx = out.getContext("2d");
  if (!ctx) return out;
  ctx.drawImage(
    source,
    rect.x,
    rect.y,
    rect.w,
    rect.h,
    0,
    0,
    rect.w,
    rect.h,
  );
  return out;
}

export function drawAnnotations(
  ctx: CanvasRenderingContext2D,
  annotations: Annotation[],
  baseCanvas: HTMLCanvasElement,
) {
  for (const ann of annotations) {
    if (ann.kind === "stroke") {
      drawStroke(ctx, ann);
    } else if (ann.kind === "mosaic") {
      applyMosaic(ctx, baseCanvas, ann);
    } else if (ann.kind === "text") {
      drawTextAnnotation(ctx, ann);
    }
  }
}

/** Draw multiline text from a top-left anchor so the DOM editor and canvas share coordinates. */
export function drawTextAnnotation(ctx: CanvasRenderingContext2D, ann: TextAnnotation) {
  ctx.fillStyle = ann.color;
  ctx.font = `${ann.fontSize}px sans-serif`;
  ctx.textBaseline = "top";
  const lineHeight = ann.fontSize * TEXT_LINE_HEIGHT_RATIO;
  ann.text.split("\n").forEach((line, index) => {
    ctx.fillText(line || " ", ann.x, ann.y + index * lineHeight);
  });
}

/** Measure the canvas-space box used for hit-testing and positioning existing text. */
export function textAnnotationBounds(
  ctx: Pick<CanvasRenderingContext2D, "font" | "measureText">,
  ann: TextAnnotation,
): Rect {
  ctx.font = `${ann.fontSize}px sans-serif`;
  const lines = ann.text.split("\n");
  const width = Math.max(1, ...lines.map((line) => ctx.measureText(line || " ").width));
  return {
    x: ann.x,
    y: ann.y,
    w: width,
    h: Math.max(ann.fontSize * TEXT_LINE_HEIGHT_RATIO, lines.length * ann.fontSize * TEXT_LINE_HEIGHT_RATIO),
  };
}

/** Return the topmost text annotation at a canvas point, searching newest first. */
export function findTextAnnotationAt(
  ctx: Pick<CanvasRenderingContext2D, "font" | "measureText">,
  annotations: Annotation[],
  point: Point,
  padding = 4,
): { index: number; annotation: TextAnnotation; bounds: Rect } | null {
  for (let index = annotations.length - 1; index >= 0; index -= 1) {
    const annotation = annotations[index];
    if (annotation.kind !== "text") continue;
    const bounds = textAnnotationBounds(ctx, annotation);
    if (
      point.x >= bounds.x - padding &&
      point.x <= bounds.x + bounds.w + padding &&
      point.y >= bounds.y - padding &&
      point.y <= bounds.y + bounds.h + padding
    ) {
      return { index, annotation, bounds };
    }
  }
  return null;
}

/** Resolve text-editor confirmation while preserving a newline gesture in both shortcut modes. */
export function shouldSubmitTextInput(
  event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "shiftKey">,
  shortcut: "enter" | "ctrl-enter",
): boolean {
  if (event.key !== "Enter") return false;
  return shortcut === "ctrl-enter"
    ? event.ctrlKey || event.metaKey
    : !event.shiftKey;
}

function drawStroke(ctx: CanvasRenderingContext2D, ann: StrokeAnnotation) {
  const pts = ann.points;
  if (pts.length < 1) return;
  ctx.strokeStyle = ann.color;
  ctx.fillStyle = ann.color;
  ctx.lineWidth = ann.width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  if (ann.tool === "rect" && pts.length >= 2) {
    const x = Math.min(pts[0].x, pts[1].x);
    const y = Math.min(pts[0].y, pts[1].y);
    const w = Math.abs(pts[1].x - pts[0].x);
    const h = Math.abs(pts[1].y - pts[0].y);
    ctx.strokeRect(x, y, w, h);
    return;
  }
  if (ann.tool === "ellipse" && pts.length >= 2) {
    const x = Math.min(pts[0].x, pts[1].x);
    const y = Math.min(pts[0].y, pts[1].y);
    const w = Math.abs(pts[1].x - pts[0].x);
    const h = Math.abs(pts[1].y - pts[0].y);
    ctx.beginPath();
    ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
    ctx.stroke();
    return;
  }
  if (ann.tool === "arrow" && pts.length >= 2) {
    drawArrow(ctx, pts[0], pts[1], ann.width);
    return;
  }
  if (pts.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) {
    ctx.lineTo(pts[i].x, pts[i].y);
  }
  ctx.stroke();
}

function drawArrow(
  ctx: CanvasRenderingContext2D,
  from: Point,
  to: Point,
  width: number,
) {
  const head = 8 + width;
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(to.x, to.y);
  ctx.lineTo(
    to.x - head * Math.cos(angle - Math.PI / 6),
    to.y - head * Math.sin(angle - Math.PI / 6),
  );
  ctx.lineTo(
    to.x - head * Math.cos(angle + Math.PI / 6),
    to.y - head * Math.sin(angle + Math.PI / 6),
  );
  ctx.closePath();
  ctx.fill();
}

function applyMosaic(
  ctx: CanvasRenderingContext2D,
  base: HTMLCanvasElement,
  ann: MosaicAnnotation,
) {
  const { rect, block } = ann;
  const bx = Math.max(4, block);
  const sw = Math.ceil(rect.w / bx);
  const sh = Math.ceil(rect.h / bx);
  const tmp = document.createElement("canvas");
  tmp.width = sw;
  tmp.height = sh;
  const tctx = tmp.getContext("2d");
  if (!tctx) return;
  tctx.drawImage(base, rect.x, rect.y, rect.w, rect.h, 0, 0, sw, sh);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(tmp, 0, 0, sw, sh, rect.x, rect.y, rect.w, rect.h);
  tmp.width = 0;
  tmp.height = 0;
}

export function canvasToPngDataUrl(canvas: HTMLCanvasElement): string {
  return canvas.toDataURL("image/png");
}

/** Encode canvas asynchronously to PNG bytes; rejects when the browser cannot create a blob. */
export function canvasToPngBytes(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("截图 PNG 编码失败"));
        return;
      }
      void blob
        .arrayBuffer()
        .then((buffer) => resolve(new Uint8Array(buffer)))
        .catch(reject);
    }, "image/png");
  });
}

/** Load an image element (file URL or data URL). */
export function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("加载截图失败"));
    img.src = src;
  });
}

/** Crop a region from a loaded image without allocating a full-monitor canvas. */
export function cropImageElement(img: HTMLImageElement, rect: Rect): HTMLCanvasElement {
  const out = document.createElement("canvas");
  const w = Math.max(1, Math.round(rect.w));
  const h = Math.max(1, Math.round(rect.h));
  out.width = w;
  out.height = h;
  const ctx = out.getContext("2d");
  if (!ctx) return out;
  ctx.drawImage(
    img,
    rect.x,
    rect.y,
    rect.w,
    rect.h,
    0,
    0,
    w,
    h,
  );
  return out;
}

export function loadImageToCanvas(dataUrl: string): Promise<HTMLCanvasElement> {
  return loadImageElement(dataUrl).then((img) => {
    const c = document.createElement("canvas");
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const ctx = c.getContext("2d");
    if (!ctx) throw new Error("Canvas 不可用");
    ctx.drawImage(img, 0, 0);
    return c;
  });
}

export function normalizeDragRect(a: Point, b: Point): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
}
