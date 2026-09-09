/**
 * File I/O via Tauri Rust commands (bypasses plugin-fs ACL for user project paths).
 */
import { invoke } from "@tauri-apps/api/core";

export interface FsDirEntry {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
}

/** Create directory (and parents) under workspace root. */
export async function mkdirRecursive(workspace: string, path: string): Promise<void> {
  const ws = workspace.trim();
  const p = path.trim();
  if (!ws || !p) return;
  await invoke("create_workspace_path", { workspace: ws, path: p, isDir: true });
}

/** Overwrite a text file; path must be under workspace. */
export async function writeTextUnderWorkspace(
  workspace: string,
  path: string,
  content: string,
): Promise<void> {
  const ws = workspace.trim();
  const p = path.trim();
  if (!ws || !p) throw new Error("工作区或路径为空");
  await invoke("write_text_file", { workspace: ws, path: p, content });
}

/** List directory entries via Rust (no plugin-fs). */
export async function listDir(path: string, includeHidden = false): Promise<FsDirEntry[]> {
  const p = path.trim();
  if (!p) return [];
  return invoke<FsDirEntry[]>("list_dir", { path: p, includeHidden });
}

/** Read text file via Rust command. */
export async function readTextFile(path: string): Promise<string> {
  return invoke<string>("read_text_file", { path });
}

/** Copy a local file into the workspace (overwrite). destPath may be absolute or relative to workspace. */
export async function importFileIntoWorkspace(
  workspace: string,
  srcPath: string,
  destPath: string,
): Promise<string> {
  const ws = workspace.trim();
  const src = srcPath.trim();
  const dest = destPath.trim();
  if (!ws || !src || !dest) throw new Error("导入路径为空");
  return invoke<string>("import_file_into_workspace", {
    workspace: ws,
    srcPath: src,
    destPath: dest,
  });
}

/** Binary-safe copy within workspace. Overwrites by remove+copy. */
export async function copyUnderWorkspace(
  workspace: string,
  fromAbs: string,
  toAbs: string,
): Promise<void> {
  const ws = workspace.trim();
  if (!ws) throw new Error("工作区为空");
  try {
    await invoke("remove_path", { workspace: ws, path: toAbs });
  } catch {
    /* dest may not exist */
  }
  await invoke("copy_path", { workspace: ws, from: fromAbs, to: toAbs });
}
