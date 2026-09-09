/**
 * @file flowTypes.ts 流程板节点/边工厂与迁移
 * @author qiuye <yjk150@qq.com>
 * @date 2026-09-07
 * @updated 2026-09-08
 * @version 1.2.0
 * @category Cache
 * @algo vue-flow-edge-defaults
 */
import { MarkerType, type Connection } from "@vue-flow/core";

/** 流程节点形状 */
export type FlowShape =
  | "process"
  | "terminal"
  | "decision"
  | "arrow"
  | "doubleArrow"
  | "frame"
  | "circle";

export type FlowNodeData = {
  label: string;
  fill?: string;
  stroke?: string;
  fontSize?: number;
  /** 旋转角度（度，顺时针） */
  rotation?: number;
};

/** 朴素节点记录（避免 Vue Flow Node 泛型深层实例化）。 */
export type FlowNode = {
  id: string;
  type: FlowShape;
  position: { x: number; y: number };
  data: FlowNodeData;
  width?: number;
  height?: number;
  style?: Record<string, string | number>;
};

export type FlowEdgeData = { noArrow?: boolean; bothWays?: boolean };

export type FlowEdge = {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  type?: string;
  label?: string;
  markerStart?: string | { type: string };
  markerEnd?: string | { type: string };
  style?: Record<string, string | number>;
  data?: FlowEdgeData;
  labelStyle?: Record<string, string | number>;
  labelBgStyle?: Record<string, string | number>;
  labelBgPadding?: [number, number];
  labelBgBorderRadius?: number;
};

export type FlowArrowKind = "none" | "arrow" | "arrowclosed" | "both";

export type FlowEdgePathType = "default" | "straight" | "smoothstep" | "step";

export const FLOW_SHAPE_OPTIONS: { value: FlowShape; label: string }[] = [
  { value: "process", label: "流程框" },
  { value: "terminal", label: "起止" },
  { value: "decision", label: "判断" },
  { value: "arrow", label: "箭头" },
  { value: "doubleArrow", label: "双箭头" },
  { value: "frame", label: "大框" },
  { value: "circle", label: "圆形" },
];

export const FLOW_ARROW_OPTIONS: { value: FlowArrowKind; label: string }[] = [
  { value: "none", label: "无箭头" },
  { value: "arrow", label: "箭头" },
  { value: "arrowclosed", label: "实心箭头" },
  { value: "both", label: "双向箭头" },
];

export const FLOW_PATH_OPTIONS: { value: FlowEdgePathType; label: string }[] = [
  { value: "default", label: "曲线" },
  { value: "straight", label: "直线" },
  { value: "smoothstep", label: "圆角折线" },
  { value: "step", label: "直角折线" },
];

export const DEFAULT_NODE_FILL = "#ffffff";
export const DEFAULT_NODE_STROKE = "#64748b";
export const DEFAULT_EDGE_COLOR = "#64748b";
export const DEFAULT_EDGE_WIDTH = 2;
export const DEFAULT_FONT_SIZE = 13;

export const FLOW_DEFAULT_SIZE: Record<FlowShape, { w: number; h: number }> = {
  process: { w: 140, h: 48 },
  terminal: { w: 140, h: 48 },
  decision: { w: 108, h: 108 },
  arrow: { w: 160, h: 48 },
  doubleArrow: { w: 180, h: 48 },
  frame: { w: 280, h: 160 },
  circle: { w: 108, h: 108 },
};

export const FLOW_EXT = ".flow.json";
export const FLOW_LEGACY_BOARD = "board.json";
export const FLOW_DEFAULT_DOC = "board.flow.json";

/** Duty: 形状是否合法；旧板 `default` 视为流程框。 */
export function normalizeFlowShape(raw: string | undefined): FlowShape {
  if (
    raw === "terminal" ||
    raw === "decision" ||
    raw === "process" ||
    raw === "arrow" ||
    raw === "doubleArrow" ||
    raw === "frame" ||
    raw === "circle"
  ) {
    return raw;
  }
  return "process";
}

/** Duty: 从边标记读出箭头档。 */
export function arrowKindFromEdge(edge: FlowEdge): FlowArrowKind {
  if (edge.data?.noArrow) return "none";
  if (edge.data?.bothWays || (edge.markerStart && edge.markerEnd)) return "both";
  if (!edge.markerEnd) return "none";
  const t = typeof edge.markerEnd === "string" ? edge.markerEnd : edge.markerEnd.type;
  if (t === MarkerType.Arrow || t === "arrow") return "arrow";
  if (t === MarkerType.ArrowClosed || t === "arrowclosed") return "arrowclosed";
  return "none";
}

/** Duty: 箭头档 → marker 字段补丁。 */
export function markersFromArrowKind(kind: FlowArrowKind): {
  markerStart?: FlowEdge["markerStart"];
  markerEnd?: FlowEdge["markerEnd"];
  clearStart?: boolean;
  clearEnd?: boolean;
  data: FlowEdgeData;
} {
  if (kind === "none") {
    return { clearStart: true, clearEnd: true, data: { noArrow: true, bothWays: false } };
  }
  if (kind === "both") {
    return {
      markerStart: MarkerType.ArrowClosed,
      markerEnd: MarkerType.ArrowClosed,
      data: { noArrow: false, bothWays: true },
    };
  }
  if (kind === "arrow") {
    return {
      clearStart: true,
      markerEnd: MarkerType.Arrow,
      data: { noArrow: false, bothWays: false },
    };
  }
  return {
    clearStart: true,
    markerEnd: MarkerType.ArrowClosed,
    data: { noArrow: false, bothWays: false },
  };
}

let edgeSeq = 1;

/** Duty: 新建带默认箭头与描边的边。 */
export function makeFlowEdge(
  connection: Pick<Connection, "source" | "target" | "sourceHandle" | "targetHandle"> & {
    id?: string;
    label?: string;
  },
): FlowEdge {
  const id =
    connection.id ||
    `e-${connection.source}-${connection.target}-${edgeSeq++}`;
  return {
    id,
    source: String(connection.source),
    target: String(connection.target),
    sourceHandle: connection.sourceHandle ?? undefined,
    targetHandle: connection.targetHandle ?? undefined,
    type: "default",
    markerEnd: MarkerType.ArrowClosed,
    style: {
      stroke: DEFAULT_EDGE_COLOR,
      strokeWidth: DEFAULT_EDGE_WIDTH,
    },
    label: connection.label,
    labelStyle: { fill: "#334155", fontSize: 12 },
    labelBgStyle: { fill: "#ffffff" },
    labelBgPadding: [4, 6],
    labelBgBorderRadius: 4,
  };
}

/** Duty: 新建带默认填色/尺寸的流程节点。 */
export function makeFlowNode(opts: {
  id: string;
  label: string;
  shape?: FlowShape;
  position: { x: number; y: number };
}): FlowNode {
  const shape = opts.shape ?? "process";
  const size = FLOW_DEFAULT_SIZE[shape];
  return {
    id: opts.id,
    type: shape,
    position: opts.position,
    width: size.w,
    height: size.h,
    style: {
      width: `${size.w}px`,
      height: `${size.h}px`,
    },
    data: {
      label: opts.label.trim() || "节点",
      fill: DEFAULT_NODE_FILL,
      stroke: DEFAULT_NODE_STROKE,
      fontSize: DEFAULT_FONT_SIZE,
      rotation: 0,
    },
  };
}

/** Duty: 旧边补默认实心箭头与描边。 */
export function ensureEdgeDefaults(edges: FlowEdge[]): { edges: FlowEdge[]; changed: boolean } {
  let changed = false;
  const next = edges.map((e) => {
    const edge: FlowEdge = { ...e, style: { ...(e.style || {}) } };
    const data = { ...(edge.data || {}) };
    const bare =
      !Object.prototype.hasOwnProperty.call(e, "markerEnd") && !data.noArrow && !data.bothWays;
    if (bare) {
      edge.markerEnd = MarkerType.ArrowClosed;
      changed = true;
    }
    if (edge.style!.stroke == null) {
      edge.style!.stroke = DEFAULT_EDGE_COLOR;
      changed = true;
    }
    if (edge.style!.strokeWidth == null) {
      edge.style!.strokeWidth = DEFAULT_EDGE_WIDTH;
      changed = true;
    }
    if (Object.keys(data).length) edge.data = data;
    return edge;
  });
  return { edges: next, changed };
}

/** Duty: 旧节点补形状/填色/字号/尺寸。 */
export function ensureNodeDefaults(
  nodes: Array<{
    id: string;
    type?: string;
    position: { x: number; y: number };
    data?: FlowNodeData;
    style?: Record<string, string | number>;
    width?: number;
    height?: number;
  }>,
): { nodes: FlowNode[]; changed: boolean } {
  let changed = false;
  const next = nodes.map((n) => {
    const shape = normalizeFlowShape(n.type);
    if (n.type !== shape) changed = true;
    const prev = n.data || { label: n.id };
    const style = n.style || {};
    const fill = prev.fill || String(style.background || style.backgroundColor || DEFAULT_NODE_FILL);
    const stroke = prev.stroke || String(style.borderColor || DEFAULT_NODE_STROKE);
    const fontSize = prev.fontSize ?? DEFAULT_FONT_SIZE;
    const rotation = Number.isFinite(prev.rotation) ? Number(prev.rotation) : 0;
    const def = FLOW_DEFAULT_SIZE[shape];
    const width = (n.width ?? Number(style.width)) || def.w;
    const height = (n.height ?? Number(style.height)) || def.h;
    if (!prev.fill || !prev.stroke || prev.fontSize == null || n.width == null || prev.rotation == null) {
      changed = true;
    }
    return {
      id: n.id,
      type: shape,
      position: { x: n.position.x, y: n.position.y },
      width,
      height,
      style: {
        width: `${width}px`,
        height: `${height}px`,
      },
      data: {
        label: String(prev.label ?? n.id),
        fill,
        stroke,
        fontSize,
        rotation,
      },
    } satisfies FlowNode;
  });
  return { nodes: next, changed };
}

/** Duty: 安全文档基名（无扩展名）。 */
export function sanitizeFlowDocBase(raw: string): string {
  const s = raw
    .trim()
    .replace(/\.flow\.json$/i, "")
    .replace(/\.json$/i, "")
    .replace(/[^\w.\u4e00-\u9fff-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return s || "flow";
}

export function flowDocRel(fileName: string): string {
  const name = fileName.endsWith(FLOW_EXT) || fileName === FLOW_LEGACY_BOARD ? fileName : `${sanitizeFlowDocBase(fileName)}${FLOW_EXT}`;
  return `.xu/canvas/flow/${name}`;
}

export function flowDocTitle(fileName: string): string {
  if (fileName === FLOW_LEGACY_BOARD) return "默认流程";
  return fileName.replace(/\.flow\.json$/i, "") || fileName;
}
