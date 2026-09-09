/**
 * @file types.ts 自研草图引擎类型（CDR-lite）
 * @author qiuye <yjk150@qq.com>
 * @date 2026-09-06
 * @version 1.0.0
 * @category Cache
 * @algo sketch-engine-fsm
 */

import type { Pt, Stroke, StrokeStyle } from "../sketchTypes";

export type SketchTool =
  | "select"
  | "brush"
  | "pixelErase"
  | "line"
  | "rect"
  | "ellipse"
  | "circle"
  | "polygon"
  | "polyline"
  | "curve"
  | "arrow"
  | "text"
  | "fill"
  | "bucket"
  | "dim"
  | "image"
  | "pan";

export type EngineMode =
  | "idle"
  | "drawing"
  | "selected"
  | "transforming"
  | "panning"
  | "painting"
  | "marquee";

export type ScaleHandleId = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

export const SCALE_HANDLES: ScaleHandleId[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

export const HANDLE_CURSOR: Record<ScaleHandleId, string> = {
  nw: "nwse-resize",
  n: "ns-resize",
  ne: "nesw-resize",
  e: "ew-resize",
  se: "nwse-resize",
  s: "ns-resize",
  sw: "nesw-resize",
  w: "ew-resize",
};

export const SHAPE_TOOLS: SketchTool[] = [
  "line",
  "rect",
  "ellipse",
  "circle",
  "polygon",
  "dim",
  "arrow",
];

export const DRAFT_KEEP_PEAK = 4;
export const DRAG_SLOP = 3;

export type TransformKind = "move" | "scale" | "rotate";

export type PointerSession =
  | {
      kind: "draw";
      pointerId: number;
      start: Pt;
      draftPeak: number;
      /** 正圆工具或拖拽中 Shift：椭圆强制 rx===ry */
      perfectCircle?: boolean;
    }
  | {
      kind: "move";
      pointerId: number;
      lx: number;
      ly: number;
      ox: number;
      oy: number;
      moved: boolean;
      ids: string[];
      /** 用 client 增量换算，避免绝对纸面坐标在拖拽中漂移放大 */
      clientX: number;
      clientY: number;
      startClientX: number;
      startClientY: number;
      boardScale: number;
    }
  | {
      kind: "scale";
      pointerId: number;
      handle: ScaleHandleId;
      origin: Pt;
      hx: number;
      hy: number;
      snapshot: Stroke[];
      ids: string[];
      moved: boolean;
      anchorClientX: number;
      anchorClientY: number;
      anchorPaperX: number;
      anchorPaperY: number;
      boardScale: number;
    }
  | {
      kind: "rotate";
      pointerId: number;
      cx: number;
      cy: number;
      startAngle: number;
      snapshot: Stroke[];
      ids: string[];
      moved: boolean;
      anchorClientX: number;
      anchorClientY: number;
      anchorPaperX: number;
      anchorPaperY: number;
      boardScale: number;
    }
  | {
      kind: "pan";
      pointerId: number;
      clientX: number;
      clientY: number;
      panX: number;
      panY: number;
    }
  | {
      kind: "paint";
      pointerId: number;
      erase: boolean;
      last: Pt;
    }
  | {
      kind: "marquee";
      pointerId: number;
      x0: number;
      y0: number;
      x1: number;
      y1: number;
      additive: boolean;
    };

export type EngineStyle = StrokeStyle & { opacityPct?: number };

export type PointerDownOpts = {
  p: Pt;
  pointerId: number;
  shiftKey: boolean;
  clientX: number;
  clientY: number;
  /** 点在缩放手柄上 */
  scaleHandle?: ScaleHandleId | null;
  /** 点在旋转手柄上 */
  rotateHandle?: boolean;
};
