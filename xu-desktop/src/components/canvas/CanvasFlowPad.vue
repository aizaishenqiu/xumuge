<script setup lang="ts">
/**
 * @file CanvasFlowPad.vue 流程板（多文档 / 形状 / 导出 / 清空）
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-31
 * @updated 2026-09-07
 * @version 1.4.1
 * @category Layout
 * @algo vue-flow-multi-doc-board
 */
import { computed, markRaw, onMounted, onUnmounted, ref, watch } from "vue";
import {
  ConnectionMode,
  VueFlow,
  type Connection,
  type Edge,
  type Node,
} from "@vue-flow/core";
import "@vue-flow/core/dist/style.css";
import "@vue-flow/core/dist/theme-default.css";
import { FouButton, FouDialog, FouInput, FouSelect, fouAlert } from "foucui";
import {
  CANVAS_DIRS,
  createFlowDoc,
  deleteCanvasRel,
  ensureCanvasDirs,
  listFlowDocs,
  readCanvasText,
  writeCanvasText,
  type FlowDocEntry,
} from "../../canvas/canvasIo";
import { exportFlowBoard, type FlowExportKind } from "../../canvas/flowExport";
import {
  DEFAULT_EDGE_COLOR,
  DEFAULT_EDGE_WIDTH,
  DEFAULT_FONT_SIZE,
  DEFAULT_NODE_FILL,
  DEFAULT_NODE_STROKE,
  FLOW_ARROW_OPTIONS,
  FLOW_DEFAULT_DOC,
  FLOW_DEFAULT_SIZE,
  FLOW_PATH_OPTIONS,
  FLOW_SHAPE_OPTIONS,
  arrowKindFromEdge,
  ensureEdgeDefaults,
  ensureNodeDefaults,
  flowDocRel,
  flowDocTitle,
  makeFlowEdge,
  makeFlowNode,
  markersFromArrowKind,
  normalizeFlowShape,
  sanitizeFlowDocBase,
  type FlowArrowKind,
  type FlowEdge,
  type FlowEdgeData,
  type FlowEdgePathType,
  type FlowNode,
  type FlowNodeData,
  type FlowShape,
} from "../../canvas/flowTypes";
import { onCanvasFlowUpdated } from "../../utils/crossWindowBus";
import { readLs, writeLs } from "../../utils/xuStorage";
import { toUserError } from "../../utils/userFacingError";
import FlowShapeNode from "./flow/FlowShapeNode.vue";

const props = defineProps<{ workspace: string }>();

const nodeTypes = {
  process: markRaw(FlowShapeNode),
  terminal: markRaw(FlowShapeNode),
  decision: markRaw(FlowShapeNode),
  arrow: markRaw(FlowShapeNode),
  doubleArrow: markRaw(FlowShapeNode),
  frame: markRaw(FlowShapeNode),
  circle: markRaw(FlowShapeNode),
};

const docs = ref<FlowDocEntry[]>([]);
const activeName = ref(FLOW_DEFAULT_DOC);
const nodes = ref<FlowNode[]>([]);
const edges = ref<FlowEdge[]>([]);
const vfNodes = nodes as unknown as import("vue").Ref<Node[]>;
const vfEdges = edges as unknown as import("vue").Ref<Edge[]>;
const newLabel = ref("新节点");
const status = ref("");
const selectedNodeIds = ref<string[]>([]);
const selectedEdgeIds = ref<string[]>([]);
const boardEl = ref<HTMLElement | null>(null);
const clearOpen = ref(false);
const renameOpen = ref(false);
const renameDraft = ref("");
const deleteDocOpen = ref(false);
const deleteDocTarget = ref<FlowDocEntry | null>(null);
let seq = 3;
let unlistenFlow: (() => void) | undefined;

const SHAPE_TOOLS: { value: FlowShape; label: string; icon: string; defaultLabel: string }[] = [
  { value: "process", label: "流程框", icon: "checkbox-blank-line", defaultLabel: "步骤" },
  { value: "terminal", label: "起止", icon: "stop-circle-line", defaultLabel: "开始" },
  { value: "decision", label: "判断", icon: "vip-diamond-line", defaultLabel: "判断" },
  { value: "arrow", label: "箭头", icon: "arrow-right-line", defaultLabel: "流向" },
  { value: "doubleArrow", label: "双箭头", icon: "arrow-left-right-line", defaultLabel: "双向" },
  { value: "frame", label: "大框", icon: "artboard-2-line", defaultLabel: "分组" },
  { value: "circle", label: "圆形", icon: "checkbox-blank-circle-line", defaultLabel: "章" },
];

const activeRel = computed(() => `${CANVAS_DIRS.flow}/${activeName.value}`);
const hasSelection = computed(() => selectedNodeIds.value.length > 0 || selectedEdgeIds.value.length > 0);
const selectedNode = computed((): FlowNode | undefined => {
  if (selectedNodeIds.value.length !== 1) return undefined;
  return nodes.value.find((n) => n.id === selectedNodeIds.value[0]);
});
const selectedEdge = computed((): FlowEdge | undefined => {
  if (selectedEdgeIds.value.length !== 1) return undefined;
  return edges.value.find((e) => e.id === selectedEdgeIds.value[0]);
});

const nodeLabelEdit = ref("");
const nodeFill = ref(DEFAULT_NODE_FILL);
const nodeStroke = ref(DEFAULT_NODE_STROKE);
const nodeShapeEdit = ref<FlowShape>("process");
const nodeFontSize = ref(DEFAULT_FONT_SIZE);
const nodeRotation = ref(0);

const edgeLabelEdit = ref("");
const edgeColor = ref(DEFAULT_EDGE_COLOR);
const edgeWidth = ref(DEFAULT_EDGE_WIDTH);
const edgeDashed = ref(false);
const edgePath = ref<FlowEdgePathType>("default");
const edgeArrow = ref<FlowArrowKind>("arrowclosed");

const shapeSelectOptions = FLOW_SHAPE_OPTIONS.map((o) => ({ value: o.value, label: o.label }));
const arrowSelectOptions = FLOW_ARROW_OPTIONS.map((o) => ({ value: o.value, label: o.label }));
const pathSelectOptions = FLOW_PATH_OPTIONS.map((o) => ({ value: o.value, label: o.label }));

function activeKey(ws: string) {
  return `xu.canvas.flow.activeRel:${ws.replace(/\\/g, "/").toLowerCase()}`;
}

watch(selectedNode, (n) => {
  if (!n?.data) return;
  nodeLabelEdit.value = n.data.label || "";
  nodeFill.value = n.data.fill || DEFAULT_NODE_FILL;
  nodeStroke.value = n.data.stroke || DEFAULT_NODE_STROKE;
  nodeShapeEdit.value = n.type || "process";
  nodeFontSize.value = n.data.fontSize ?? DEFAULT_FONT_SIZE;
  nodeRotation.value = Number.isFinite(n.data.rotation) ? Number(n.data.rotation) : 0;
});

watch(
  () => selectedNode.value?.data?.rotation,
  (r) => {
    if (!selectedNode.value) return;
    const n = Number(r);
    nodeRotation.value = Number.isFinite(n) ? n : 0;
  },
);

watch(selectedEdge, (e) => {
  if (!e) return;
  edgeLabelEdit.value = typeof e.label === "string" ? e.label : "";
  const st = e.style || {};
  edgeColor.value = String(st.stroke || DEFAULT_EDGE_COLOR);
  edgeWidth.value = Number(st.strokeWidth || DEFAULT_EDGE_WIDTH);
  edgeDashed.value = Boolean(st.strokeDasharray);
  edgePath.value = (e.type as FlowEdgePathType) || "default";
  edgeArrow.value = arrowKindFromEdge(e);
});

function connectEdge(params: Connection): Edge {
  status.value = "已连线";
  return makeFlowEdge(params) as Edge;
}

function onSelectionChange(payload: { nodes: Node[]; edges: Edge[] }) {
  selectedNodeIds.value = payload.nodes.map((n) => n.id);
  selectedEdgeIds.value = payload.edges.map((e) => e.id);
}

function patchNode(
  id: string,
  dataPatch?: Partial<FlowNodeData>,
  rest?: Partial<Pick<FlowNode, "type" | "width" | "height" | "style">>,
) {
  const list = nodes.value.slice();
  const i = list.findIndex((n) => n.id === id);
  if (i < 0) return;
  const n = list[i]!;
  const width = rest?.width ?? n.width;
  const height = rest?.height ?? n.height;
  const style = {
    ...(n.style || {}),
    ...(rest?.style || {}),
  };
  if (width != null) style.width = `${width}px`;
  if (height != null) style.height = `${height}px`;
  list[i] = {
    ...n,
    ...rest,
    type: rest?.type ?? normalizeFlowShape(n.type),
    width,
    height,
    style,
    data: {
      label: dataPatch?.label ?? n.data.label,
      fill: dataPatch?.fill ?? n.data.fill ?? DEFAULT_NODE_FILL,
      stroke: dataPatch?.stroke ?? n.data.stroke ?? DEFAULT_NODE_STROKE,
      fontSize: dataPatch?.fontSize ?? n.data.fontSize ?? DEFAULT_FONT_SIZE,
      rotation:
        dataPatch?.rotation !== undefined
          ? dataPatch.rotation
          : (n.data.rotation ?? 0),
    },
  };
  nodes.value = list;
}

function patchEdge(
  id: string,
  patch: {
    label?: string;
    type?: string;
    markerStart?: FlowEdge["markerStart"];
    markerEnd?: FlowEdge["markerEnd"];
    style?: Record<string, string | number | undefined>;
    data?: FlowEdgeData;
    clearStart?: boolean;
    clearEnd?: boolean;
  },
) {
  const list = edges.value.slice();
  const i = list.findIndex((e) => e.id === id);
  if (i < 0) return;
  const e = list[i]!;
  const style: Record<string, string | number> = { ...(e.style || {}) };
  if (patch.style) {
    for (const [k, v] of Object.entries(patch.style)) {
      if (v === undefined) delete style[k];
      else style[k] = v;
    }
  }
  const next: FlowEdge = {
    ...e,
    label: patch.label !== undefined ? patch.label : e.label,
    type: patch.type !== undefined ? patch.type : e.type,
    style,
    data: { ...(e.data || {}), ...(patch.data || {}) },
  };
  if (patch.clearStart) delete next.markerStart;
  else if (patch.markerStart !== undefined) next.markerStart = patch.markerStart;
  if (patch.clearEnd) delete next.markerEnd;
  else if (patch.markerEnd !== undefined) next.markerEnd = patch.markerEnd;
  list[i] = next;
  edges.value = list;
}

function applyNodeLabel() {
  const n = selectedNode.value;
  if (!n) return;
  patchNode(n.id, { label: nodeLabelEdit.value.trim() || "节点" });
}
function applyNodeFill(v: string) {
  nodeFill.value = v;
  const n = selectedNode.value;
  if (n) patchNode(n.id, { fill: v });
}
function applyNodeStroke(v: string) {
  nodeStroke.value = v;
  const n = selectedNode.value;
  if (n) patchNode(n.id, { stroke: v });
}
function applyNodeShape(v: string) {
  const shape = normalizeFlowShape(v);
  nodeShapeEdit.value = shape;
  const n = selectedNode.value;
  if (!n) return;
  const size = FLOW_DEFAULT_SIZE[shape];
  patchNode(n.id, undefined, { type: shape, width: size.w, height: size.h });
}
function applyNodeFontSize() {
  const n = selectedNode.value;
  if (!n) return;
  const fs = Math.max(10, Math.min(48, Number(nodeFontSize.value) || DEFAULT_FONT_SIZE));
  nodeFontSize.value = fs;
  patchNode(n.id, { fontSize: fs });
}
function applyNodeRotation() {
  const n = selectedNode.value;
  if (!n) return;
  let deg = Number(nodeRotation.value);
  if (!Number.isFinite(deg)) deg = 0;
  deg = ((deg % 360) + 360) % 360;
  if (deg > 180) deg -= 360;
  nodeRotation.value = Math.round(deg * 10) / 10;
  patchNode(n.id, { rotation: nodeRotation.value });
}
function nudgeNodeRotation(delta: number) {
  const n = selectedNode.value;
  if (!n) return;
  const cur = Number.isFinite(n.data.rotation) ? Number(n.data.rotation) : 0;
  let next = cur + delta;
  next = ((next % 360) + 360) % 360;
  if (next > 180) next -= 360;
  nodeRotation.value = Math.round(next * 10) / 10;
  patchNode(n.id, { rotation: nodeRotation.value });
}
function applyEdgeLabel() {
  const e = selectedEdge.value;
  if (e) patchEdge(e.id, { label: edgeLabelEdit.value });
}
function applyEdgeColor(v: string) {
  edgeColor.value = v;
  const e = selectedEdge.value;
  if (e) patchEdge(e.id, { style: { stroke: v } });
}
function applyEdgeWidth() {
  const e = selectedEdge.value;
  if (!e) return;
  const w = Math.max(1, Math.min(12, Number(edgeWidth.value) || DEFAULT_EDGE_WIDTH));
  edgeWidth.value = w;
  patchEdge(e.id, { style: { strokeWidth: w } });
}
function toggleEdgeDash() {
  edgeDashed.value = !edgeDashed.value;
  const e = selectedEdge.value;
  if (e) patchEdge(e.id, { style: { strokeDasharray: edgeDashed.value ? "6 4" : undefined } });
}
function applyEdgePath(v: string) {
  edgePath.value = (v as FlowEdgePathType) || "default";
  const e = selectedEdge.value;
  if (e) patchEdge(e.id, { type: edgePath.value });
}
function applyEdgeArrow(v: string) {
  const kind = (v as FlowArrowKind) || "arrowclosed";
  edgeArrow.value = kind;
  const e = selectedEdge.value;
  if (!e) return;
  const m = markersFromArrowKind(kind);
  patchEdge(e.id, {
    markerStart: m.markerStart,
    markerEnd: m.markerEnd,
    clearStart: m.clearStart,
    clearEnd: m.clearEnd,
    data: m.data,
  });
}

function addNode(shape: FlowShape = "process") {
  const tool = SHAPE_TOOLS.find((t) => t.value === shape);
  const id = `n${seq++}`;
  const label = (newLabel.value.trim() && newLabel.value.trim() !== "新节点"
    ? newLabel.value.trim()
    : tool?.defaultLabel) || "节点";
  nodes.value = [
    ...nodes.value,
    makeFlowNode({
      id,
      label,
      shape,
      position: { x: 60 + nodes.value.length * 24, y: 140 },
    }),
  ];
  status.value = `已加${tool?.label || "节点"}`;
}

function deleteSelected() {
  const nids = new Set(selectedNodeIds.value);
  const eids = new Set(selectedEdgeIds.value);
  if (!nids.size && !eids.size) {
    status.value = "请先点选要删除的节点或连线";
    return;
  }
  nodes.value = nodes.value.filter((n) => !nids.has(n.id));
  edges.value = edges.value.filter(
    (e) => !eids.has(e.id) && !nids.has(e.source) && !nids.has(e.target),
  );
  selectedNodeIds.value = [];
  selectedEdgeIds.value = [];
  status.value = "已删除";
}

function onKey(e: KeyboardEvent) {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
  if (e.key !== "Delete" && e.key !== "Backspace") return;
  if (!hasSelection.value) return;
  e.preventDefault();
  deleteSelected();
}

async function refreshDocs() {
  if (!props.workspace) return;
  docs.value = await listFlowDocs(props.workspace);
  const stored = readLs(activeKey(props.workspace));
  const storedName = stored?.split("/").pop() || "";
  const prefer =
    docs.value.find((d) => d.name === storedName) ||
    docs.value.find((d) => d.name === FLOW_DEFAULT_DOC) ||
    docs.value[0];
  if (prefer) activeName.value = prefer.name;
}

async function loadActive() {
  if (!props.workspace || !activeName.value) return;
  await ensureCanvasDirs(props.workspace);
  try {
    const raw = JSON.parse(await readCanvasText(props.workspace, activeRel.value)) as {
      nodes?: Parameters<typeof ensureNodeDefaults>[0];
      edges?: FlowEdge[];
    };
    nodes.value = ensureNodeDefaults(raw.nodes || []).nodes;
    edges.value = ensureEdgeDefaults(raw.edges || []).edges;
    seq = nodes.value.reduce((m, n) => {
      const num = Number(String(n.id).replace(/\D/g, ""));
      return Number.isFinite(num) ? Math.max(m, num + 1) : m;
    }, 3);
    writeLs(activeKey(props.workspace), activeRel.value);
    status.value = `已载入 ${flowDocTitle(activeName.value)}`;
  } catch {
    nodes.value = [
      makeFlowNode({ id: "n1", label: "开始", shape: "terminal", position: { x: 40, y: 80 } }),
      makeFlowNode({ id: "n2", label: "下一步", shape: "process", position: { x: 240, y: 80 } }),
    ];
    edges.value = [makeFlowEdge({ id: "e1", source: "n1", target: "n2" })];
    seq = 3;
  }
}

async function switchDoc(name: string) {
  if (name === activeName.value) return;
  await save();
  activeName.value = name;
  await loadActive();
}

async function save() {
  if (!props.workspace) {
    status.value = "请先选择工作区";
    void fouAlert("请先选择工作区。", "流程");
    return;
  }
  try {
    await ensureCanvasDirs(props.workspace);
    await writeCanvasText(
      props.workspace,
      activeRel.value,
      JSON.stringify({ nodes: nodes.value, edges: edges.value }, null, 2),
    );
    writeLs(activeKey(props.workspace), activeRel.value);
    status.value = "已保存流程";
  } catch (err) {
    void fouAlert(toUserError(err), "保存失败");
  }
}

async function newDoc() {
  if (!props.workspace) return;
  try {
    await save();
    const name = await createFlowDoc(props.workspace, `流程_${docs.value.length + 1}`);
    await refreshDocs();
    activeName.value = name;
    await loadActive();
    status.value = "已新建流程";
  } catch (e) {
    void fouAlert(toUserError(e), "新建失败");
  }
}

function openRename() {
  renameDraft.value = flowDocTitle(activeName.value);
  renameOpen.value = true;
}

async function confirmRename() {
  if (!props.workspace) return;
  const base = sanitizeFlowDocBase(renameDraft.value);
  const nextName = `${base}.flow.json`;
  if (nextName === activeName.value) {
    renameOpen.value = false;
    return;
  }
  try {
    await save();
    const raw = await readCanvasText(props.workspace, activeRel.value);
    await writeCanvasText(props.workspace, flowDocRel(nextName), raw);
    if (activeName.value !== FLOW_DEFAULT_DOC || docs.value.length > 1) {
      try {
        await deleteCanvasRel(props.workspace, activeRel.value);
      } catch {
        /* keep old */
      }
    }
    activeName.value = nextName;
    renameOpen.value = false;
    await refreshDocs();
    status.value = "已重命名";
  } catch (e) {
    void fouAlert(toUserError(e), "重命名失败");
  }
}

function askDeleteDoc(d: FlowDocEntry) {
  deleteDocTarget.value = d;
  deleteDocOpen.value = true;
}

async function confirmDeleteDoc() {
  const t = deleteDocTarget.value;
  if (!t || !props.workspace) {
    deleteDocOpen.value = false;
    return;
  }
  try {
    if (docs.value.length <= 1) {
      void fouAlert("至少保留一张流程图。", "删除");
      deleteDocOpen.value = false;
      return;
    }
    await deleteCanvasRel(props.workspace, t.rel);
    deleteDocOpen.value = false;
    const wasActive = t.name === activeName.value;
    await refreshDocs();
    if (wasActive) await loadActive();
    status.value = "已删除文档";
  } catch (e) {
    void fouAlert(toUserError(e), "删除失败");
  }
}

async function confirmClear() {
  nodes.value = [];
  edges.value = [];
  clearOpen.value = false;
  await save();
  status.value = "已清空流程图";
}

async function doExport(kind: FlowExportKind) {
  const root = boardEl.value?.querySelector(".vue-flow") as HTMLElement | null;
  if (!root) {
    void fouAlert("找不到画布区域。", "导出");
    return;
  }
  try {
    await save();
    const path = await exportFlowBoard(
      props.workspace,
      root,
      kind,
      flowDocTitle(activeName.value) || "flow",
    );
    if (path) {
      status.value = "已导出";
      void fouAlert("已导出流程图。", "导出成功");
    }
  } catch (e) {
    void fouAlert(toUserError(e), "导出失败");
  }
}

onMounted(async () => {
  await refreshDocs();
  await loadActive();
  window.addEventListener("keydown", onKey);
  unlistenFlow = await onCanvasFlowUpdated(async (p) => {
    if (!props.workspace) return;
    const a = props.workspace.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
    const b = p.workspace.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
    if (a !== b) return;
    await refreshDocs();
    if (p.name) {
      const hit = docs.value.find((d) => d.name === p.name || d.name === `${p.name}.flow.json`);
      if (hit) activeName.value = hit.name;
    }
    await loadActive();
    status.value = "已同步助手写入的流程";
  });
});

onUnmounted(() => {
  window.removeEventListener("keydown", onKey);
  unlistenFlow?.();
});

defineExpose({ refresh: async () => { await refreshDocs(); await loadActive(); } });
</script>

<template>
  <div class="cfl">
    <div class="cfl-layout">
      <aside class="cfl-docs">
        <div class="cfl-docs-bar">
          <span class="ui-font">流程图</span>
          <FouButton icon="add-line" size="small" native-type="button" title="新建" aria-label="新建流程图" @click="newDoc" />
        </div>
        <button
          v-for="d in docs"
          :key="d.name"
          type="button"
          class="cfl-doc ui-font"
          :class="{ active: d.name === activeName }"
          @click="switchDoc(d.name)"
        >
          <span class="cfl-doc-title">{{ d.title }}</span>
          <FouButton
            v-if="docs.length > 1"
            icon="delete-bin-6-line"
            size="small"
            text
            native-type="button"
            title="删除此图"
            aria-label="删除此图"
            @click.stop="askDeleteDoc(d)"
          />
        </button>
      </aside>

      <div class="cfl-main">
        <div class="cfl-bar">
          <span class="cfl-tools-label ui-font">添加</span>
          <FouButton
            v-for="t in SHAPE_TOOLS"
            :key="t.value"
            :icon="t.icon"
            size="small"
            native-type="button"
            :title="`添加${t.label}`"
            :aria-label="`添加${t.label}`"
            @click="addNode(t.value)"
          >
            {{ t.label }}
          </FouButton>
          <span class="cfl-bar-sep" aria-hidden="true" />
          <FouInput v-model="newLabel" size="small" placeholder="默认名称（可选）" title="下一次添加用的名称" />
          <FouButton
            icon="delete-bin-6-line"
            size="small"
            native-type="button"
            :disabled="!hasSelection"
            title="删除选中"
            aria-label="删除选中"
            @click="deleteSelected"
          >
            删除
          </FouButton>
          <FouButton icon="delete-bin-line" size="small" native-type="button" title="清空整图" aria-label="清空整图" @click="clearOpen = true">
            清空
          </FouButton>
          <FouButton icon="edit-line" size="small" native-type="button" title="重命名文档" aria-label="重命名" @click="openRename">
            重命名
          </FouButton>
          <FouButton icon="save-line" type="primary" size="small" native-type="button" title="保存" aria-label="保存" @click="save">
            保存
          </FouButton>
          <FouButton icon="image-line" size="small" native-type="button" title="导出 PNG" aria-label="导出 PNG" @click="doExport('png')">
            PNG
          </FouButton>
          <FouButton icon="file-image-line" size="small" native-type="button" title="导出 JPG" aria-label="导出 JPG" @click="doExport('jpg')">
            JPG
          </FouButton>
          <FouButton icon="file-pdf-line" size="small" native-type="button" title="导出 PDF" aria-label="导出 PDF" @click="doExport('pdf')">
            PDF
          </FouButton>
          <span class="cfl-status ui-font">{{ status || "点顶栏图标添加 · 选中后拖四角缩放 / 顶圆点旋转 · 双击改字" }}</span>
        </div>

        <div v-if="selectedNode" class="cfl-ctx">
          <span class="cfl-ctx-label ui-font">节点</span>
          <FouInput v-model="nodeLabelEdit" size="small" placeholder="名称" @change="applyNodeLabel" @keyup.enter="applyNodeLabel" />
          <FouButton icon="check-line" size="small" native-type="button" title="改名" aria-label="改名" @click="applyNodeLabel">改名</FouButton>
          <label class="cfl-color ui-font">填充<input type="color" :value="nodeFill" @input="applyNodeFill(($event.target as HTMLInputElement).value)" /></label>
          <label class="cfl-color ui-font">边框<input type="color" :value="nodeStroke" @input="applyNodeStroke(($event.target as HTMLInputElement).value)" /></label>
          <FouSelect :model-value="nodeShapeEdit" :options="shapeSelectOptions" style="width: 108px" aria-label="形状" @update:model-value="applyNodeShape" />
          <FouInput v-model.number="nodeFontSize" type="number" size="small" style="width: 64px" aria-label="字号" title="字号" @change="applyNodeFontSize" />
          <FouButton icon="font-size-2" size="small" native-type="button" title="应用字号" aria-label="应用字号" @click="applyNodeFontSize">字号</FouButton>
          <FouInput
            v-model.number="nodeRotation"
            type="number"
            size="small"
            style="width: 72px"
            aria-label="旋转角度"
            title="旋转角度（度）· 回车应用"
            @change="applyNodeRotation"
            @keyup.enter="applyNodeRotation"
          />
          <span class="cfl-ctx-label ui-font">°</span>
          <FouButton icon="check-line" size="small" native-type="button" title="应用角度" aria-label="应用角度" @click="applyNodeRotation">应用</FouButton>
          <FouButton icon="anticlockwise-2-line" size="small" native-type="button" title="左转 90°" aria-label="左转 90°" @click="nudgeNodeRotation(-90)">左转</FouButton>
          <FouButton icon="clockwise-2-line" size="small" native-type="button" title="右转 90°" aria-label="右转 90°" @click="nudgeNodeRotation(90)">右转</FouButton>
        </div>

        <div v-else-if="selectedEdge" class="cfl-ctx">
          <span class="cfl-ctx-label ui-font">连线</span>
          <FouSelect :model-value="edgeArrow" :options="arrowSelectOptions" style="width: 120px" aria-label="箭头" @update:model-value="applyEdgeArrow" />
          <FouSelect :model-value="edgePath" :options="pathSelectOptions" style="width: 110px" aria-label="线型" @update:model-value="applyEdgePath" />
          <label class="cfl-color ui-font">颜色<input type="color" :value="edgeColor" @input="applyEdgeColor(($event.target as HTMLInputElement).value)" /></label>
          <FouInput v-model.number="edgeWidth" type="number" size="small" style="width: 56px" aria-label="线宽" @change="applyEdgeWidth" />
          <FouButton icon="subtract-line" size="small" native-type="button" :type="edgeDashed ? 'primary' : 'default'" title="虚线" aria-label="虚线" @click="toggleEdgeDash">虚线</FouButton>
          <FouInput v-model="edgeLabelEdit" size="small" placeholder="连线文字" @change="applyEdgeLabel" @keyup.enter="applyEdgeLabel" />
          <FouButton icon="text-snippet" size="small" native-type="button" title="应用文字" aria-label="应用文字" @click="applyEdgeLabel">文字</FouButton>
        </div>

        <div ref="boardEl" class="cfl-board">
          <VueFlow
            v-model:nodes="vfNodes"
            v-model:edges="vfEdges"
            :node-types="nodeTypes"
            :auto-connect="connectEdge"
            :connection-mode="ConnectionMode.Loose"
            :delete-key-code="['Backspace', 'Delete']"
            fit-view-on-init
            @selection-change="onSelectionChange"
          />
        </div>
      </div>
    </div>

    <FouDialog v-model="clearOpen" title="清空流程图" width="400px" append-to-body>
      <p class="cfl-del-msg ui-font">确定清空当前流程图「{{ flowDocTitle(activeName) }}」上的全部节点与连线？</p>
      <template #footer>
        <FouButton icon="close-line" size="small" native-type="button" @click="clearOpen = false">取消</FouButton>
        <FouButton icon="delete-bin-line" type="primary" size="small" native-type="button" @click="confirmClear">清空</FouButton>
      </template>
    </FouDialog>

    <FouDialog v-model="renameOpen" title="重命名流程图" width="400px" append-to-body>
      <FouInput v-model="renameDraft" placeholder="名称" aria-label="流程图名称" />
      <template #footer>
        <FouButton icon="close-line" size="small" native-type="button" @click="renameOpen = false">取消</FouButton>
        <FouButton icon="check-line" type="primary" size="small" native-type="button" @click="confirmRename">确定</FouButton>
      </template>
    </FouDialog>

    <FouDialog v-model="deleteDocOpen" title="删除流程图" width="400px" append-to-body>
      <p class="cfl-del-msg ui-font">确定删除「{{ deleteDocTarget?.title }}」？无法恢复。</p>
      <template #footer>
        <FouButton icon="close-line" size="small" native-type="button" @click="deleteDocOpen = false">取消</FouButton>
        <FouButton icon="delete-bin-6-line" type="primary" size="small" native-type="button" @click="confirmDeleteDoc">删除</FouButton>
      </template>
    </FouDialog>
  </div>
</template>

<style scoped>
.cfl {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
.cfl-layout {
  display: flex;
  flex: 1;
  min-height: 0;
}
.cfl-docs {
  width: 160px;
  flex-shrink: 0;
  border-right: 1px solid var(--hairline);
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--surface-soft, #f8fafc);
}
.cfl-docs-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px;
  font-size: 12px;
  font-weight: 600;
  border-bottom: 1px solid var(--hairline);
}
.cfl-doc {
  display: flex;
  align-items: center;
  gap: 4px;
  width: 100%;
  border: 0;
  background: transparent;
  text-align: left;
  padding: 8px 10px;
  cursor: pointer;
  font-size: 12px;
  color: var(--ink, #334155);
}
.cfl-doc:hover {
  background: rgba(13, 148, 136, 0.08);
}
.cfl-doc.active {
  background: rgba(13, 148, 136, 0.16);
  font-weight: 600;
}
.cfl-doc-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cfl-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.cfl-bar,
.cfl-ctx {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
  padding: 8px;
  border-bottom: 1px solid var(--hairline);
}
.cfl-ctx {
  background: var(--surface-soft, #f8fafc);
}
.cfl-ctx-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--muted, #64748b);
}
.cfl-bar :deep(.fou-input),
.cfl-ctx :deep(.fou-input) {
  width: 110px;
}
.cfl-tools-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--muted, #64748b);
}
.cfl-bar-sep {
  width: 1px;
  align-self: stretch;
  min-height: 22px;
  background: var(--hairline, #e2e8f0);
  margin: 0 4px;
}
.cfl-status {
  font-size: 12px;
  color: var(--muted, #888);
}
.cfl-color {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
}
.cfl-color input[type="color"] {
  width: 28px;
  height: 24px;
  padding: 0;
  border: 1px solid var(--hairline);
  border-radius: 4px;
  background: transparent;
  cursor: pointer;
}
.cfl-board {
  position: relative;
  flex: 1;
  min-height: 280px;
}
.cfl-board :deep(.vue-flow) {
  width: 100%;
  height: 100%;
}
.cfl-board :deep(.vue-flow__node) {
  padding: 0;
  border: none;
  background: transparent;
  box-shadow: none;
  overflow: visible;
}
.cfl-board :deep(.vue-flow__resize-control.handle) {
  width: 9px;
  height: 9px;
  border-radius: 2px;
}
.cfl-del-msg {
  margin: 0;
  font-size: 14px;
  line-height: 1.5;
}
</style>
