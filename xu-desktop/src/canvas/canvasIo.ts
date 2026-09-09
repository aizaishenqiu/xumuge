/**
 * @file canvasIo.ts 画板工作区文件读写
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-31
 * @updated 2026-09-07
 * @version 1.3.0
 * @category Cache
 * @algo canvas-workspace-io
 */
/** Project canvas files under `{workspace}/.xu/canvas/`. */

import { invoke } from "@tauri-apps/api/core";
import {
  copyUnderWorkspace,
  importFileIntoWorkspace,
  listDir,
  mkdirRecursive,
  readTextFile,
  writeTextUnderWorkspace,
} from "../utils/fsBridge";
import {
  FLOW_DEFAULT_DOC,
  FLOW_EXT,
  FLOW_LEGACY_BOARD,
  flowDocRel,
  sanitizeFlowDocBase,
} from "./flowTypes";

export type CanvasKind = "sketch" | "flow" | "gantt" | "ui";

export const CANVAS_DIRS: Record<CanvasKind, string> = {
  sketch: ".xu/canvas/sketch",
  flow: ".xu/canvas/flow",
  gantt: ".xu/canvas/gantt",
  ui: ".xu/canvas/ui",
};

export async function ensureCanvasDirs(workspace: string): Promise<void> {
  for (const rel of Object.values(CANVAS_DIRS)) {
    await mkdirRecursive(workspace, rel);
  }
}

export function canvasAbs(workspace: string, rel: string): string {
  const ws = workspace.replace(/[\\/]+$/, "");
  const r = rel.replace(/^[\\/]+/, "");
  return `${ws}/${r}`.replace(/\\/g, "/");
}

/**
 * Duty: 读工作区内图片为 data URL（绕过 assetProtocol 未放行工作区导致的裂图）。
 */
export async function canvasImageDataUrl(workspace: string, rel: string): Promise<string> {
  return invoke<string>("xu_read_image_data_url", { path: canvasAbs(workspace, rel) });
}

/** Duty: 删除工作区内图册/贴图文件（路径须在工作区下）。 */
export async function deleteCanvasRel(workspace: string, rel: string): Promise<void> {
  const ws = workspace.trim();
  const r = rel.trim();
  if (!ws || !r) throw new Error("工作区或路径为空");
  await invoke("remove_path", { workspace: ws, path: canvasAbs(ws, r) });
}

export async function writeCanvasText(
  workspace: string,
  rel: string,
  content: string,
): Promise<void> {
  await writeTextUnderWorkspace(workspace, rel, content);
}

export async function readCanvasText(workspace: string, rel: string): Promise<string> {
  return readTextFile(canvasAbs(workspace, rel));
}

export async function listCanvasFiles(workspace: string, kind: CanvasKind): Promise<string[]> {
  const dir = canvasAbs(workspace, CANVAS_DIRS[kind]);
  try {
    const entries = await listDir(dir, false);
    return entries
      .filter((e) => !e.is_dir)
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

export async function importCanvasImage(
  workspace: string,
  srcPath: string,
  filename: string,
): Promise<string> {
  const safe = filename.replace(/[^\w.\u4e00-\u9fff-]+/g, "_") || "image.png";
  const dest = `${CANVAS_DIRS.ui}/${safe}`;
  await mkdirRecursive(workspace, CANVAS_DIRS.ui);
  return importFileIntoWorkspace(workspace, srcPath, dest);
}

const IMAGE_EXT = /\.(png|jpe?g|webp|gif)$/i;

export type AlbumEntry = { name: string; rel: string; bucket: "ui" | "assets" };

/** Duty: 列出图册（ui）与草图贴图目录中的图片。 */
export async function listAlbumEntries(workspace: string): Promise<AlbumEntry[]> {
  await ensureCanvasDirs(workspace);
  const assetDir = `${CANVAS_DIRS.sketch}/assets`;
  await mkdirRecursive(workspace, assetDir);
  const out: AlbumEntry[] = [];
  for (const name of await listCanvasFiles(workspace, "ui")) {
    if (!IMAGE_EXT.test(name)) continue;
    out.push({ name, rel: `${CANVAS_DIRS.ui}/${name}`, bucket: "ui" });
  }
  try {
    const entries = await listDir(canvasAbs(workspace, assetDir), false);
    for (const e of entries) {
      if (e.is_dir || !IMAGE_EXT.test(e.name)) continue;
      out.push({ name: e.name, rel: `${assetDir}/${e.name}`, bucket: "assets" });
    }
  } catch {
    /* empty */
  }
  return out;
}

/**
 * Duty: 确保素材在 sketch/assets 下可供贴图；ui 目录文件会复制过去。
 * @returns 工作区相对路径（正斜杠）
 */
export async function ensureAlbumAssetInSketch(
  workspace: string,
  rel: string,
): Promise<string> {
  const norm = rel.replace(/\\/g, "/").replace(/^\//, "");
  const assetDir = `${CANVAS_DIRS.sketch}/assets`;
  if (norm.startsWith(`${assetDir}/`)) return norm;
  const name = norm.split("/").pop() || "image.png";
  const safe = name.replace(/[^\w.\u4e00-\u9fff-]+/g, "_") || "image.png";
  const destRel = `${assetDir}/${safe}`;
  await mkdirRecursive(workspace, assetDir);
  await copyUnderWorkspace(workspace, canvasAbs(workspace, norm), canvasAbs(workspace, destRel));
  return destRel;
}

export type FlowDocEntry = { name: string; rel: string; title: string };

/**
 * Duty: 列出流程 JSON；若仅有旧 board.json 则迁移为 board.flow.json。
 */
export async function listFlowDocs(workspace: string): Promise<FlowDocEntry[]> {
  await ensureCanvasDirs(workspace);
  const names = await listCanvasFiles(workspace, "flow");
  const hasLegacy = names.includes(FLOW_LEGACY_BOARD);
  const hasDefault = names.includes(FLOW_DEFAULT_DOC);
  if (hasLegacy && !hasDefault) {
    try {
      const raw = await readCanvasText(workspace, flowDocRel(FLOW_LEGACY_BOARD));
      await writeCanvasText(workspace, flowDocRel(FLOW_DEFAULT_DOC), raw);
    } catch {
      /* keep listing legacy */
    }
  }
  const refreshed = await listCanvasFiles(workspace, "flow");
  const hasMigrated = refreshed.includes(FLOW_DEFAULT_DOC);
  const out: FlowDocEntry[] = [];
  for (const name of refreshed) {
    if (name === FLOW_LEGACY_BOARD && hasMigrated) continue;
    if (name.endsWith(FLOW_EXT) || name === FLOW_LEGACY_BOARD) {
      out.push({
        name,
        rel: `${CANVAS_DIRS.flow}/${name}`,
        title: name === FLOW_LEGACY_BOARD ? "默认流程" : name.replace(/\.flow\.json$/i, ""),
      });
    }
  }
  if (!out.length) {
    const seed = JSON.stringify(
      {
        nodes: [
          {
            id: "n1",
            type: "terminal",
            position: { x: 40, y: 80 },
            width: 140,
            height: 48,
            data: { label: "开始", fill: "#ffffff", stroke: "#64748b", fontSize: 13 },
          },
          {
            id: "n2",
            type: "process",
            position: { x: 240, y: 80 },
            width: 140,
            height: 48,
            data: { label: "下一步", fill: "#ffffff", stroke: "#64748b", fontSize: 13 },
          },
        ],
        edges: [
          {
            id: "e1",
            source: "n1",
            target: "n2",
            type: "default",
            markerEnd: "arrowclosed",
            style: { stroke: "#64748b", strokeWidth: 2 },
          },
        ],
      },
      null,
      2,
    );
    await writeCanvasText(workspace, flowDocRel(FLOW_DEFAULT_DOC), seed);
    out.push({
      name: FLOW_DEFAULT_DOC,
      rel: `${CANVAS_DIRS.flow}/${FLOW_DEFAULT_DOC}`,
      title: "board",
    });
  }
  return out;
}

/** Duty: 新建空流程文档，返回文件名。 */
export async function createFlowDoc(workspace: string, title: string): Promise<string> {
  await ensureCanvasDirs(workspace);
  let base = sanitizeFlowDocBase(title);
  const existing = new Set(await listCanvasFiles(workspace, "flow"));
  let name = `${base}${FLOW_EXT}`;
  let i = 2;
  while (existing.has(name)) {
    name = `${base}_${i}${FLOW_EXT}`;
    i += 1;
  }
  await writeCanvasText(
    workspace,
    flowDocRel(name),
    JSON.stringify({ nodes: [], edges: [] }, null, 2),
  );
  return name;
}

