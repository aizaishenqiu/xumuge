/**
 * @file canvasDefaultWorkspace.ts Canvas 默认画板工作区
 * @author qiuye <yjk150@qq.com>
 * @date 2026-09-06
 * @version 1.0.0
 * @category Cache
 * @algo default-canvas-workspace
 */
import { invoke } from "@tauri-apps/api/core";
import { ensureCanvasDirs } from "../canvas/canvasIo";
import { mkdirRecursive } from "./fsBridge";
import { writeLs } from "./xuStorage";
import { emitWorkingDirChanged } from "./crossWindowBus";

const REL = "canvas-workspace";

function joinHome(home: string, rel: string): string {
  const h = home.replace(/[/\\]+$/, "");
  return `${h}/${rel}`.replace(/\\/g, "/");
}

/** Duty: 确保应用数据目录下默认画板工作区存在，并写为当前 cwd。失败返回 null。 */
export async function ensureDefaultCanvasWorkspace(): Promise<string | null> {
  try {
    const home = (await invoke<string>("xu_get_home")).trim();
    if (!home) return null;
    await mkdirRecursive(home, REL);
    const ws = joinHome(home, REL);
    await ensureCanvasDirs(ws);
    writeLs("xu.chat.workingDir", ws, "hermes_working_dir");
    emitWorkingDirChanged(ws);
    return ws;
  } catch {
    return null;
  }
}
