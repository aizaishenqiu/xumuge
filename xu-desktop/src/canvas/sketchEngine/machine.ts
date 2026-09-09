/**
 * @file machine.ts 草图交互状态机（idle→draw→select→transform）
 * @author qiuye <yjk150@qq.com>
 * @date 2026-09-06
 * @version 1.0.0
 * @category Cache
 * @algo sketch-cdr-lite-fsm
 */

import {
  ensureClosedPoints,
  expandSelection,
  isTinyStroke,
  newStrokeId,
  regularPolygonPoints,
  rotateSelection,
  scaleSelection,
  strokeBBox,
  translateSelection,
  unionBBox,
  type Pt,
  type SketchLayer,
  type Stroke,
  type StrokeStyle,
} from "../sketchTypes";
import { applyOrtho } from "./coords";
import { cloneBoard, cloneStroke } from "./history";
import { hitTestStroke, layerHidden, layerLocked } from "./hitTest";
import {
  DRAFT_KEEP_PEAK,
  DRAG_SLOP,
  SHAPE_TOOLS,
  type EngineMode,
  type PointerDownOpts,
  type PointerSession,
  type ScaleHandleId,
  type SketchTool,
} from "./types";

export type EngineHost = {
  getStrokes: () => Stroke[];
  setStrokes: (s: Stroke[]) => void;
  getSelectedIds: () => string[];
  setSelectedIds: (ids: string[]) => void;
  getDraft: () => Stroke | null;
  setDraft: (d: Stroke | null) => void;
  getTool: () => SketchTool;
  getLayers: () => SketchLayer[];
  getActiveLayerId: () => string;
  getStyle: () => StrokeStyle;
  getPolygonSides: () => number;
  getOrtho: () => boolean;
  getPolyPts: () => Pt[];
  setPolyPts: (p: Pt[]) => void;
  getCurvePts: () => Pt[];
  setCurvePts: (p: Pt[]) => void;
  /** 提交板面到历史并标记 dirty */
  commitBoard: (next: Stroke[], status?: string) => void;
  /** 仅脏写（变换中预览） */
  previewBoard: (next: Stroke[]) => void;
  setStatus: (s: string) => void;
  /** 框选矩形预览；null 表示无框选 */
  getMarquee?: () => { x: number; y: number; w: number; h: number } | null;
  setMarquee?: (b: { x: number; y: number; w: number; h: number } | null) => void;
  /** 画笔落点（仅像素橡皮） */
  paintStroke?: (erase: boolean, from: Pt, to: Pt) => void;
  /** 油漆桶 */
  floodAt?: (p: Pt) => void;
  /** 矢量填充 */
  fillHit?: (idx: number) => void;
  /** 打开文字对话框 */
  openText?: (p: Pt) => void;
  /** 贴图 */
  placeImage?: (p: Pt) => void;
  /** 平移增量 */
  onPan?: (x: number, y: number) => void;
  getPan?: () => { x: number; y: number };
  /** 画板屏幕像素 / 纸面单位（含 CSS zoom） */
  getBoardScale?: () => number;
  alertLocked?: () => void;
  alertHidden?: () => void;
  /** 尺寸标注文案 */
  formatDim?: (pxLen: number) => string;
};

function isShapeTool(t: SketchTool): boolean {
  return SHAPE_TOOLS.includes(t);
}

function stamp(s: Stroke, layerId: string): Stroke {
  return { ...s, layerId };
}

/**
 * Duty: 创建 CDR-lite 指针状态机。一次仅一种 session；切工具先收尾，不中途清空 pointerId。
 */
export function createSketchEngine(host: EngineHost) {
  let mode: EngineMode = "idle";
  let session: PointerSession | null = null;
  /** 防止 pointerup + lostcapture + buttons0 重入把半截提交打烂 */
  let ending = false;

  function getMode(): EngineMode {
    return mode;
  }

  function getSession(): PointerSession | null {
    return session;
  }

  function isBusy(): boolean {
    return session !== null || !!host.getDraft() || ending;
  }

  function syncModeFromSelection() {
    if (session || ending) return;
    mode = host.getSelectedIds().length ? "selected" : "idle";
  }

  function beginMove(ids: string[], p: Pt, pointerId: number, clientX: number, clientY: number) {
    const boardScale = Math.max(host.getBoardScale?.() ?? 1, 0.05);
    session = {
      kind: "move",
      pointerId,
      lx: p.x,
      ly: p.y,
      ox: p.x,
      oy: p.y,
      moved: false,
      ids,
      clientX,
      clientY,
      startClientX: clientX,
      startClientY: clientY,
      boardScale,
    };
    mode = "transforming";
  }

  function beginScale(
    handle: ScaleHandleId,
    origin: Pt,
    hx: number,
    hy: number,
    ids: string[],
    pointerId: number,
    clientX: number,
    clientY: number,
    paperP: Pt,
  ) {
    const boardScale = Math.max(host.getBoardScale?.() ?? 1, 0.05);
    session = {
      kind: "scale",
      pointerId,
      handle,
      origin,
      hx,
      hy,
      snapshot: cloneBoard(host.getStrokes()),
      ids,
      moved: false,
      anchorClientX: clientX,
      anchorClientY: clientY,
      anchorPaperX: paperP.x,
      anchorPaperY: paperP.y,
      boardScale,
    };
    mode = "transforming";
  }

  function beginRotate(
    cx: number,
    cy: number,
    p: Pt,
    ids: string[],
    pointerId: number,
    clientX: number,
    clientY: number,
  ) {
    const boardScale = Math.max(host.getBoardScale?.() ?? 1, 0.05);
    session = {
      kind: "rotate",
      pointerId,
      cx,
      cy,
      startAngle: Math.atan2(p.y - cy, p.x - cx),
      snapshot: cloneBoard(host.getStrokes()),
      ids,
      moved: false,
      anchorClientX: clientX,
      anchorClientY: clientY,
      anchorPaperX: p.x,
      anchorPaperY: p.y,
      boardScale,
    };
    mode = "transforming";
  }

  function commitDraftInternal(drawPeak?: number): boolean {
    const draft = host.getDraft();
    if (!draft) return false;
    const peak =
      typeof drawPeak === "number"
        ? drawPeak
        : session?.kind === "draw"
          ? session.draftPeak
          : 0;
    const keepByPeak = peak >= DRAFT_KEEP_PEAK;
    const tiny = isTinyStroke(draft);
    if (!keepByPeak && tiny) {
      host.setDraft(null);
      return false;
    }
    try {
      // 必须脱离 Vue reactive；structuredClone(Proxy) 在 WebView 会抛，cloneStroke 有 JSON 回退
      const added = cloneStroke(draft);
      host.setDraft(null);
      const next = [...host.getStrokes().map((s) => cloneStroke(s)), added];
      host.setSelectedIds([added.id]);
      const label =
        added.kind === "ellipse"
          ? Math.abs(added.rx - added.ry) < 0.5
            ? "正圆"
            : "椭圆"
          : added.kind === "rect"
            ? "矩形"
            : added.kind === "polygon"
              ? "正多边形"
              : added.kind === "line"
                ? "直线"
                : added.kind === "arrow"
                  ? "箭头"
              : added.kind === "dim"
                  ? "尺寸"
                  : added.kind === "curve"
                    ? "笔迹"
                    : "图形";
      host.commitBoard(next, `已添加${label} · 空白处可再画；点图形可拖移缩放`);
      mode = "selected";
      return true;
    } catch (err) {
      return false;
    }
  }

  /** Duty: 结束当前指针会话；commit=true 时落盘历史。 */
  function endSession(commit: boolean) {
    if (ending) return;
    ending = true;
    try {
      const s = session;
      const drawPeak = s?.kind === "draw" ? s.draftPeak : undefined;
      session = null;
      if (!s) {
        if (commit && host.getDraft()) commitDraftInternal();
        syncModeFromSelection();
        return;
      }
      if (s.kind === "draw") {
        if (commit) commitDraftInternal(drawPeak);
        else host.setDraft(null);
        syncModeFromSelection();
        return;
      }
      if (s.kind === "marquee") {
        host.setMarquee?.(null);
        if (commit) {
          const x = Math.min(s.x0, s.x1);
          const y = Math.min(s.y0, s.y1);
          const w = Math.abs(s.x1 - s.x0);
          const h = Math.abs(s.y1 - s.y0);
          const layers = host.getLayers();
          const picked: string[] = [];
          if (w >= 3 || h >= 3) {
            for (const st of host.getStrokes()) {
              if (st.hidden || st.kind === "group" || st.parentId) continue;
              if (layerLocked(layers, st.layerId) || layerHidden(layers, st.layerId)) continue;
              const b = strokeBBox(st);
              const ix = Math.max(x, b.x);
              const iy = Math.max(y, b.y);
              const ax = Math.min(x + w, b.x + b.w);
              const ay = Math.min(y + h, b.y + b.h);
              if (ax >= ix && ay >= iy) picked.push(st.id);
            }
          }
          const next = s.additive ? [...new Set([...host.getSelectedIds(), ...picked])] : picked;
          host.setSelectedIds(next);
          host.setStatus(next.length ? `已框选 ${next.length} 个图形` : "框选未命中图形");
        }
        syncModeFromSelection();
        return;
      }
      if (s.kind === "move" || s.kind === "scale" || s.kind === "rotate") {
        if (commit && s.moved) {
          host.commitBoard(host.getStrokes(), "已变换");
        } else if (!commit && (s.kind === "scale" || s.kind === "rotate")) {
          host.setStrokes(s.snapshot);
        }
        mode = host.getSelectedIds().length ? "selected" : "idle";
        return;
      }
      if (s.kind === "pan" || s.kind === "paint") {
        mode = host.getSelectedIds().length ? "selected" : "idle";
        return;
      }
      syncModeFromSelection();
    } finally {
      ending = false;
    }
  }

  function startDraft(tool: SketchTool, p: Pt, pointerId: number) {
    const st = { ...host.getStyle() };
    const id = newStrokeId();
    const lid = host.getActiveLayerId();
    let draft: Stroke | null = null;
    if (tool === "line") draft = stamp({ id, kind: "line", x1: p.x, y1: p.y, x2: p.x, y2: p.y, style: st }, lid);
    else if (tool === "rect") {
      const rx = Math.max(0, Number(st.cornerRadius) || 0);
      draft = stamp(
        { id, kind: "rect", x: p.x, y: p.y, w: 0, h: 0, ...(rx > 0 ? { rx } : {}), style: st },
        lid,
      );
    }
    else if (tool === "ellipse" || tool === "circle")
      draft = stamp({ id, kind: "ellipse", cx: p.x, cy: p.y, rx: 0, ry: 0, style: st }, lid);
    else if (tool === "polygon") {
      const sides = Math.max(3, Math.min(24, Math.round(host.getPolygonSides()) || 5));
      draft = stamp(
        { id, kind: "polygon", points: regularPolygonPoints(p.x, p.y, 1, sides), style: st },
        lid,
      );
    } else if (tool === "dim")
      draft = stamp({ id, kind: "dim", x1: p.x, y1: p.y, x2: p.x, y2: p.y, label: "0 mm", style: st }, lid);
    else if (tool === "arrow")
      draft = stamp({ id, kind: "arrow", x1: p.x, y1: p.y, x2: p.x, y2: p.y, style: st }, lid);
    if (!draft) return false;
    host.setDraft(draft);
    session = {
      kind: "draw",
      pointerId,
      start: p,
      draftPeak: 0,
      perfectCircle: tool === "circle",
    };
    mode = "drawing";
    return true;
  }

  function updateDraft(p: Pt, ortho: boolean, shiftKey = false) {
    if (!session || session.kind !== "draw") return;
    const draft = host.getDraft();
    if (!draft) return;
    const start = session.start;
    const raw = draft.kind === "line" || draft.kind === "arrow" || draft.kind === "dim" ? applyOrtho(start, p, ortho) : p;
    if (draft.kind === "line" || draft.kind === "arrow" || draft.kind === "dim") {
      const next = { ...draft, x2: raw.x, y2: raw.y };
      if (next.kind === "dim") {
        const len = Math.hypot(raw.x - next.x1, raw.y - next.y1);
        next.label = host.formatDim?.(len) ?? `${len.toFixed(0)}`;
      }
      session.draftPeak = Math.max(session.draftPeak, Math.hypot(next.x2 - next.x1, next.y2 - next.y1));
      host.setDraft(next);
    } else if (draft.kind === "rect") {
      const next = {
        ...draft,
        x: Math.min(start.x, raw.x),
        y: Math.min(start.y, raw.y),
        w: Math.abs(raw.x - start.x),
        h: Math.abs(raw.y - start.y),
      };
      session.draftPeak = Math.max(session.draftPeak, next.w, next.h);
      host.setDraft(next);
    } else if (draft.kind === "ellipse") {
      let rx = Math.abs(raw.x - start.x) / 2;
      let ry = Math.abs(raw.y - start.y) / 2;
      if (session.perfectCircle || shiftKey) {
        const r = Math.max(rx, ry);
        rx = r;
        ry = r;
      }
      const next = {
        ...draft,
        cx: (start.x + raw.x) / 2,
        cy: (start.y + raw.y) / 2,
        rx,
        ry,
      };
      session.draftPeak = Math.max(session.draftPeak, next.rx * 2, next.ry * 2);
      host.setDraft(next);
    } else if (draft.kind === "polygon") {
      const r = Math.hypot(raw.x - start.x, raw.y - start.y);
      const sides = Math.max(3, Math.min(24, Math.round(host.getPolygonSides()) || 5));
      session.draftPeak = Math.max(session.draftPeak, r * 2);
      host.setDraft({ ...draft, points: regularPolygonPoints(start.x, start.y, r, sides) });
    } else if (draft.kind === "curve") {
      // 矢量自由绘：加点
      const last = draft.points[draft.points.length - 1];
      if (last && Math.hypot(raw.x - last.x, raw.y - last.y) < 1.5) return;
      const points = [...draft.points, { x: raw.x, y: raw.y }];
      const b = strokeBBox({ ...draft, points });
      session.draftPeak = Math.max(session.draftPeak, b.w, b.h, Math.hypot(raw.x - start.x, raw.y - start.y));
      host.setDraft({ ...draft, points });
    }
  }

  function closePolyline() {
    const pts = host.getPolyPts();
    if (pts.length < 3) {
      host.setStatus(pts.length ? "折线至少需要 3 个点才能合拢" : "");
      host.setPolyPts([]);
      return;
    }
    const points = ensureClosedPoints(pts);
    const id = newStrokeId();
    const next = [
      ...host.getStrokes(),
      {
        id,
        kind: "polygon" as const,
        points,
        style: { ...host.getStyle() },
        layerId: host.getActiveLayerId(),
      },
    ];
    host.setPolyPts([]);
    host.setSelectedIds([id]);
    host.commitBoard(next, "已合拢折线");
    mode = "selected";
  }

  function closeCurve() {
    const pts = host.getCurvePts();
    if (pts.length < 2) {
      host.setStatus(pts.length ? "曲线至少需要 2 个点" : "");
      host.setCurvePts([]);
      return;
    }
    const id = newStrokeId();
    const next = [
      ...host.getStrokes(),
      {
        id,
        kind: "curve" as const,
        points: pts,
        style: { ...host.getStyle() },
        layerId: host.getActiveLayerId(),
      },
    ];
    host.setCurvePts([]);
    host.setSelectedIds([id]);
    host.commitBoard(next, "已完成曲线");
    mode = "selected";
  }

  /**
   * Duty: 指针按下。返回是否应由宿主 setPointerCapture / 绑定 window 监听。
   */
  function pointerDown(opts: PointerDownOpts): boolean {
    const tool = host.getTool();
    const layers = host.getLayers();
    const active = host.getActiveLayerId();
    const ly = layers.find((l) => l.id === active);

    if (host.getDraft()) {
      commitDraftInternal();
    }

    if (opts.scaleHandle && host.getSelectedIds().length) {
      // 由宿主传入 origin/hx/hy 前，此处用 beginScale 需完整参数——见 beginScaleFromHost
      return false;
    }

    if (tool === "pan") {
      const pan = host.getPan?.() ?? { x: 0, y: 0 };
      session = {
        kind: "pan",
        pointerId: opts.pointerId,
        clientX: opts.clientX,
        clientY: opts.clientY,
        panX: pan.x,
        panY: pan.y,
      };
      mode = "panning";
      return true;
    }

    if (tool === "brush") {
      if (ly?.hidden) {
        host.alertHidden?.();
        return false;
      }
      if (ly?.locked) {
        host.alertLocked?.();
        return false;
      }
      // 画笔 = 矢量自由绘（curve），可选中/删除/改色；像素橡皮仍走 paint
      const st = { ...host.getStyle() };
      const id = newStrokeId();
      const lid = host.getActiveLayerId();
      const draft = stamp({ id, kind: "curve", points: [{ x: opts.p.x, y: opts.p.y }], style: st }, lid);
      host.setDraft(draft);
      session = { kind: "draw", pointerId: opts.pointerId, start: opts.p, draftPeak: 0 };
      mode = "drawing";
      host.setStatus("矢量画笔绘制中 · 松手后可选中拉伸");
      return true;
    }

    if (tool === "pixelErase" || tool === "bucket") {
      // CDR-lite：已去掉像素橡皮/油漆桶入口；保留兼容避免旧快捷键崩
      host.setStatus("请用矢量画笔；旧像素可用顶栏「清像素」清除");
      return false;
    }

    if (tool === "fill") {
      const idx = hitTestStroke(host.getStrokes(), layers, active, opts.p);
      if (idx >= 0) host.fillHit?.(idx);
      return false;
    }

    if (tool === "text") {
      host.openText?.(opts.p);
      return false;
    }

    if (tool === "image") {
      // 贴图：工具栏点选即弹文件框；画布点击不处理
      return false;
    }

    if (tool === "polyline") {
      const hit = hitTestStroke(host.getStrokes(), layers, active, opts.p);
      if (hit >= 0) {
        const id = host.getStrokes()[hit]!.id;
        host.setSelectedIds([id]);
        beginMove([id], opts.p, opts.pointerId, opts.clientX, opts.clientY);
        host.setStatus("已选中 · 拖移图形（折线加点请点空白处）");
        return true;
      }
      const pts = host.getPolyPts();
      if (pts.length >= 3) {
        const first = pts[0]!;
        if (Math.hypot(opts.p.x - first.x, opts.p.y - first.y) <= 12) {
          closePolyline();
          return false;
        }
      }
      host.setPolyPts([...pts, opts.p]);
      host.setStatus(`折线：已 ${pts.length + 1} 点 · 点回起点合拢`);
      return false;
    }

    if (tool === "curve") {
      const hit = hitTestStroke(host.getStrokes(), layers, active, opts.p);
      if (hit >= 0) {
        const id = host.getStrokes()[hit]!.id;
        host.setSelectedIds([id]);
        beginMove([id], opts.p, opts.pointerId, opts.clientX, opts.clientY);
        host.setStatus("已选中 · 拖移图形（曲线加点请点空白处）");
        return true;
      }
      const pts = host.getCurvePts();
      if (pts.length >= 2) {
        const first = pts[0]!;
        if (Math.hypot(opts.p.x - first.x, opts.p.y - first.y) <= 12) {
          closeCurve();
          return false;
        }
      }
      host.setCurvePts([...pts, opts.p]);
      host.setStatus(`曲线：已 ${pts.length + 1} 点`);
      return false;
    }

    // 选择 / 形状工具共用：先命中（选择跨可见图层；绘图工具仅当前层新建）
    if (isShapeTool(tool)) {
      if (ly?.hidden) {
        host.alertHidden?.();
        return false;
      }
      if (ly?.locked) {
        host.alertLocked?.();
        return false;
      }
    }

    const hitAllLayers = tool === "select";
    const hit = hitTestStroke(host.getStrokes(), layers, active, opts.p, 8, hitAllLayers);

    if (tool === "select") {
      if (hit < 0) {
        // 已有选区：点在选框内则拖移（CDR：框内可拖，不必精确点中字形）
        const sel = host.getSelectedIds();
        if (sel.length && !opts.shiftKey) {
          const box = unionBBox(
            expandSelection(host.getStrokes(), sel).filter((s) => s.kind !== "group"),
          );
          if (
            box.w > 0 &&
            box.h > 0 &&
            opts.p.x >= box.x - 4 &&
            opts.p.x <= box.x + box.w + 4 &&
            opts.p.y >= box.y - 4 &&
            opts.p.y <= box.y + box.h + 4
          ) {
            beginMove(sel, opts.p, opts.pointerId, opts.clientX, opts.clientY);
            return true;
          }
        }
        // 空白处开始框选（CDR 习惯）
        if (!opts.shiftKey) host.setSelectedIds([]);
        session = {
          kind: "marquee",
          pointerId: opts.pointerId,
          x0: opts.p.x,
          y0: opts.p.y,
          x1: opts.p.x,
          y1: opts.p.y,
          additive: !!opts.shiftKey,
        };
        mode = "marquee";
        host.setMarquee?.({ x: opts.p.x, y: opts.p.y, w: 0, h: 0 });
        return true;
      }
      const id = host.getStrokes()[hit]!.id;
      if (opts.shiftKey) {
        const cur = host.getSelectedIds();
        host.setSelectedIds(cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]);
      } else {
        host.setSelectedIds([id]);
      }
      beginMove(host.getSelectedIds().includes(id) ? host.getSelectedIds() : [id], opts.p, opts.pointerId, opts.clientX, opts.clientY);
      return true;
    }

    if (isShapeTool(tool)) {
      // 点中已有图元 → 选中并拖移（可连续画：空白处新草稿）
      if (hit >= 0) {
        const id = host.getStrokes()[hit]!.id;
        host.setSelectedIds([id]);
        beginMove([id], opts.p, opts.pointerId, opts.clientX, opts.clientY);
        host.setStatus("拖移图形 · 拖角缩放 · 拖上方圆点旋转");
        return true;
      }
      const started = startDraft(tool, opts.p, opts.pointerId);
      return started;
    }

    return false;
  }

  /** Duty: 宿主在点到缩放手柄时调用（已算好 origin）。 */
  function pointerDownScale(
    handle: ScaleHandleId,
    origin: Pt,
    hx: number,
    hy: number,
    pointerId: number,
    clientX: number,
    clientY: number,
    paperP: Pt,
  ): boolean {
    const ids = host.getSelectedIds();
    if (!ids.length) return false;
    if (host.getDraft()) commitDraftInternal();
    beginScale(handle, origin, hx, hy, ids, pointerId, clientX, clientY, paperP);
    return true;
  }

  /** Duty: 宿主点到旋转手柄。 */
  function pointerDownRotate(
    cx: number,
    cy: number,
    p: Pt,
    pointerId: number,
    clientX: number,
    clientY: number,
  ): boolean {
    const ids = host.getSelectedIds();
    if (!ids.length) return false;
    if (host.getDraft()) commitDraftInternal();
    beginRotate(cx, cy, p, ids, pointerId, clientX, clientY);
    return true;
  }

  function pointerMove(p: Pt, pointerId: number, buttons: number, shiftKey: boolean, clientX?: number, clientY?: number) {
    if (session && session.pointerId !== pointerId) return;
    if (session && buttons === 0 && session.kind !== "pan") {
      endSession(true);
      return;
    }
    if (!session) return;

    if (session.kind === "pan") {
      const dx = (clientX ?? 0) - session.clientX;
      const dy = (clientY ?? 0) - session.clientY;
      host.onPan?.(session.panX + dx, session.panY + dy);
      return;
    }

    if (session.kind === "marquee") {
      session.x1 = p.x;
      session.y1 = p.y;
      const x = Math.min(session.x0, session.x1);
      const y = Math.min(session.y0, session.y1);
      const w = Math.abs(session.x1 - session.x0);
      const h = Math.abs(session.y1 - session.y0);
      host.setMarquee?.({ x, y, w, h });
      return;
    }

    if (session.kind === "paint") {
      host.paintStroke?.(session.erase, session.last, p);
      session.last = p;
      return;
    }

    if (session.kind === "draw") {
      updateDraft(p, host.getOrtho(), shiftKey);
      return;
    }

    if (session.kind === "move") {
      const cx = clientX ?? session.clientX;
      const cy = clientY ?? session.clientY;
      if (!session.moved) {
        if (Math.hypot(cx - session.startClientX, cy - session.startClientY) < DRAG_SLOP) return;
        session.moved = true;
        session.clientX = session.startClientX;
        session.clientY = session.startClientY;
      }
      const sc = session.boardScale;
      const dx = (cx - session.clientX) / sc;
      const dy = (cy - session.clientY) / sc;
      session.clientX = cx;
      session.clientY = cy;
      session.lx += dx;
      session.ly += dy;
      host.previewBoard(translateSelection(host.getStrokes(), session.ids, dx, dy));
      return;
    }

    if (session.kind === "scale") {
      const cx = clientX ?? session.anchorClientX;
      const cy = clientY ?? session.anchorClientY;
      const sc = session.boardScale;
      const pPaper = {
        x: session.anchorPaperX + (cx - session.anchorClientX) / sc,
        y: session.anchorPaperY + (cy - session.anchorClientY) / sc,
      };
      let sx = Math.abs(session.hx - session.origin.x) < 1e-6 ? 1 : (pPaper.x - session.origin.x) / (session.hx - session.origin.x);
      let sy = Math.abs(session.hy - session.origin.y) < 1e-6 ? 1 : (pPaper.y - session.origin.y) / (session.hy - session.origin.y);
      if (session.handle === "n" || session.handle === "s") sx = 1;
      if (session.handle === "e" || session.handle === "w") sy = 1;
      if (shiftKey) {
        const u = Math.max(Math.abs(sx), Math.abs(sy));
        sx = (sx < 0 ? -1 : 1) * u;
        sy = (sy < 0 ? -1 : 1) * u;
      }
      host.previewBoard(scaleSelection(session.snapshot, session.ids, session.origin, sx, sy));
      session.moved = true;
      return;
    }

    if (session.kind === "rotate") {
      const cx = clientX ?? session.anchorClientX;
      const cy = clientY ?? session.anchorClientY;
      const sc = session.boardScale;
      const pPaper = {
        x: session.anchorPaperX + (cx - session.anchorClientX) / sc,
        y: session.anchorPaperY + (cy - session.anchorClientY) / sc,
      };
      const ang = Math.atan2(pPaper.y - session.cy, pPaper.x - session.cx);
      let deg = ((ang - session.startAngle) * 180) / Math.PI;
      if (shiftKey) deg = Math.round(deg / 15) * 15;
      host.previewBoard(rotateSelection(session.snapshot, session.ids, deg));
      session.moved = true;
    }
  }

  function pointerUp(pointerId: number) {
    if (session && session.pointerId !== pointerId) return;
    endSession(true);
  }

  /**
   * Duty: 切换工具。先完整收尾当前会话，宿主保留 pointer capture 管理权。
   */
  function setToolChanging() {
    if (session || host.getDraft()) endSession(true);
    const t = host.getTool();
    if (t !== "polyline" && host.getPolyPts().length) {
      if (host.getPolyPts().length >= 3) closePolyline();
      else host.setPolyPts([]);
    }
    if (t !== "curve" && host.getCurvePts().length) {
      if (host.getCurvePts().length >= 2) closeCurve();
      else host.setCurvePts([]);
    }
    syncModeFromSelection();
  }

  function forceCommitDraft() {
    if (host.getDraft()) commitDraftInternal();
  }

  return {
    getMode,
    getSession,
    isBusy,
    pointerDown,
    pointerDownScale,
    pointerDownRotate,
    pointerMove,
    pointerUp,
    endSession,
    setToolChanging,
    forceCommitDraft,
    closePolyline,
    closeCurve,
    syncModeFromSelection,
  };
}

export type SketchEngine = ReturnType<typeof createSketchEngine>;
