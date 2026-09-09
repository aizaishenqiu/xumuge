/** Cross-webview event bus (Pinia does not sync across Tauri windows). */

import { emit, listen } from "@tauri-apps/api/event";

export type OpenInEditorPayload = { path: string; line?: number };
export type WorkingDirPayload = { dir: string | null };

export function emitOpenInEditor(payload: OpenInEditorPayload): void {
  // 只走 Tauri 事件：同窗 listen 也会收到；再派 CustomEvent 会导致 IdePage 双开
  void emit("xu:open-in-editor", payload);
}

export function emitFocusIde(): void {
  void emit("xu:focus-ide", {});
}

export function emitFocusChat(): void {
  void emit("xu:focus-chat", {});
}

export function emitWorkingDirChanged(dir: string | null): void {
  void emit("xu:working-dir-changed", { dir } satisfies WorkingDirPayload);
}

export type CanvasSketchUpdatedPayload = { workspace: string };

/** Duty: 草图 board.json 已由 Agent/模板写入，通知 Canvas 立即重载。 */
export function emitCanvasSketchUpdated(workspace: string): void {
  const ws = workspace.trim();
  if (!ws) return;
  const payload = { workspace: ws } satisfies CanvasSketchUpdatedPayload;
  void emit("xu:canvas-sketch-updated", payload);
  window.dispatchEvent(new CustomEvent("xu-canvas-sketch-updated", { detail: payload }));
}

export async function onCanvasSketchUpdated(
  handler: (workspace: string) => void,
): Promise<() => void> {
  const fn = (ev: Event) => {
    const d = (ev as CustomEvent<CanvasSketchUpdatedPayload>).detail;
    if (d?.workspace?.trim()) handler(d.workspace.trim());
  };
  window.addEventListener("xu-canvas-sketch-updated", fn);
  const unlisten = await listen<CanvasSketchUpdatedPayload>("xu:canvas-sketch-updated", (e) => {
    const ws = e.payload?.workspace?.trim();
    if (ws) handler(ws);
  });
  return () => {
    window.removeEventListener("xu-canvas-sketch-updated", fn);
    unlisten();
  };
}

export type CanvasAlbumInsertPayload = {
  workspace: string;
  /** 工作区内相对路径，如 `.xu/canvas/ui/foo.png` */
  rel: string;
};

/** Duty: 图册页请求把素材插入当前草图。 */
export function emitCanvasAlbumInsert(payload: CanvasAlbumInsertPayload): void {
  const workspace = payload.workspace.trim();
  const rel = payload.rel.trim().replace(/\\/g, "/");
  if (!workspace || !rel) return;
  const detail = { workspace, rel } satisfies CanvasAlbumInsertPayload;
  void emit("xu:canvas-album-insert", detail);
  window.dispatchEvent(new CustomEvent("xu-canvas-album-insert", { detail }));
}

export async function onCanvasAlbumInsert(
  handler: (payload: CanvasAlbumInsertPayload) => void,
): Promise<() => void> {
  const fn = (ev: Event) => {
    const d = (ev as CustomEvent<CanvasAlbumInsertPayload>).detail;
    if (d?.workspace?.trim() && d?.rel?.trim()) handler({ workspace: d.workspace.trim(), rel: d.rel.trim() });
  };
  window.addEventListener("xu-canvas-album-insert", fn);
  const unlisten = await listen<CanvasAlbumInsertPayload>("xu:canvas-album-insert", (e) => {
    const workspace = e.payload?.workspace?.trim();
    const rel = e.payload?.rel?.trim();
    if (workspace && rel) handler({ workspace, rel });
  });
  return () => {
    window.removeEventListener("xu-canvas-album-insert", fn);
    unlisten();
  };
}

export async function onOpenInEditor(handler: (p: OpenInEditorPayload) => void): Promise<() => void> {
  let lastKey = "";
  let lastAt = 0;
  const wrap = (p: OpenInEditorPayload) => {
    if (!p?.path) return;
    const key = `${p.path.replace(/\\/g, "/").toLowerCase()}|${p.line || 1}`;
    const now = Date.now();
    if (key === lastKey && now - lastAt < 500) return;
    lastKey = key;
    lastAt = now;
    handler(p);
  };
  const unlisten = await listen<OpenInEditorPayload>("xu:open-in-editor", (e) => {
    if (e.payload?.path) wrap(e.payload);
  });
  return () => {
    unlisten();
  };
}

export async function onWorkingDirChanged(
  handler: (dir: string | null) => void,
): Promise<() => void> {
  const unlisten = await listen<WorkingDirPayload>("xu:working-dir-changed", (e) => {
    handler(e.payload?.dir ?? null);
  });
  return unlisten;
}

export type CanvasFlowUpdatedPayload = { workspace: string; name?: string };

/** Duty: 流程 .flow.json 已由 Agent 写入，通知 Canvas 重载。 */
export function emitCanvasFlowUpdated(workspace: string, name?: string): void {
  const ws = workspace.trim();
  if (!ws) return;
  const payload = { workspace: ws, name: name?.trim() || undefined } satisfies CanvasFlowUpdatedPayload;
  void emit("xu:canvas-flow-updated", payload);
  window.dispatchEvent(new CustomEvent("xu-canvas-flow-updated", { detail: payload }));
}

export async function onCanvasFlowUpdated(
  handler: (payload: CanvasFlowUpdatedPayload) => void,
): Promise<() => void> {
  const fn = (ev: Event) => {
    const d = (ev as CustomEvent<CanvasFlowUpdatedPayload>).detail;
    if (d?.workspace?.trim()) handler({ workspace: d.workspace.trim(), name: d.name?.trim() });
  };
  window.addEventListener("xu-canvas-flow-updated", fn);
  const unlisten = await listen<CanvasFlowUpdatedPayload>("xu:canvas-flow-updated", (e) => {
    const workspace = e.payload?.workspace?.trim();
    if (workspace) handler({ workspace, name: e.payload?.name?.trim() });
  });
  return () => {
    window.removeEventListener("xu-canvas-flow-updated", fn);
    unlisten();
  };
}
