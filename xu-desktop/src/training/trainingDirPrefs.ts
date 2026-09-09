/**
 * @file 用户可配置训练数据目录及全量训练库迁移
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-31
 * @version 2.0.0
 * @category Config
 * @algo copy-if-absent
 */
import { invoke } from "@tauri-apps/api/core";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";

async function xuHome(): Promise<string> {
  try {
    return (await invoke<string>("xu_get_home")).trim();
  } catch {
    return "";
  }
}

export const TRAINING_DATA_DIR_KEY = "xu.training.dataDir";

function normalizeDir(raw: string): string {
  return raw.trim().replace(/[/\\]+$/, "");
}

export function readCustomTrainingDataDir(): string | null {
  try {
    const raw = localStorage.getItem(TRAINING_DATA_DIR_KEY)?.trim();
    return raw ? normalizeDir(raw) : null;
  } catch {
    return null;
  }
}

export async function defaultTrainingDataRoot(): Promise<string> {
  const home = await xuHome();
  if (!home) return "";
  return `${normalizeDir(home)}/training`;
}

/** Active training library root (custom or default under XU_HOME). */
export async function resolveTrainingDataRoot(): Promise<string> {
  const custom = readCustomTrainingDataDir();
  if (custom) return custom;
  return defaultTrainingDataRoot();
}

async function ensureDir(root: string): Promise<void> {
  const dir = normalizeDir(root);
  if (!dir) return;
  await invoke("create_workspace_path", { workspace: dir, path: dir, isDir: true });
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await invoke<string>("read_text_file", { path });
    return true;
  } catch {
    return false;
  }
}

async function copyTrainingFile(from: string, to: string, workspace: string): Promise<void> {
  const raw = await invoke<string>("read_text_file", { path: from });
  await invoke("write_text_file", { workspace, path: to, content: raw });
}

async function migrateLegacyInto(root: string): Promise<void> {
  const legacy = await defaultTrainingDataRoot();
  if (!legacy || normalizeDir(legacy) === normalizeDir(root)) return;
  const pairs = [
    "mcp-training.json",
    "persona-training.json",
    "mcp-tips.json",
    "curriculum.json",
    "manifest.json",
    "samples.jsonl",
    "outcomes.json",
    "eval-suites.json",
    "eval-runs.json",
  ];
  for (const name of pairs) {
    const dest = `${normalizeDir(root)}/${name}`;
    if (await fileExists(dest)) continue;
    const src = `${legacy}/${name}`;
    if (!(await fileExists(src))) continue;
    try {
      await copyTrainingFile(src, dest, root);
    } catch {
      /* ignore */
    }
  }
}

export async function setTrainingDataDir(dir: string): Promise<string> {
  const next = normalizeDir(dir);
  if (!next) throw new Error("目录无效");
  await ensureDir(next);
  await migrateLegacyInto(next);
  localStorage.setItem(TRAINING_DATA_DIR_KEY, next);
  window.dispatchEvent(new CustomEvent("xu-training-dir-changed", { detail: { path: next } }));
  return next;
}

export async function clearTrainingDataDir(): Promise<void> {
  localStorage.removeItem(TRAINING_DATA_DIR_KEY);
  window.dispatchEvent(new CustomEvent("xu-training-dir-changed"));
}

export async function pickTrainingDataDir(): Promise<string | null> {
  const picked = await openFileDialog({
    directory: true,
    multiple: false,
    title: "选择训练数据目录（非软件安装目录）",
  });
  if (!picked || typeof picked !== "string") return null;
  return setTrainingDataDir(picked);
}

export async function trainingDataRootLabel(): Promise<string> {
  const root = await resolveTrainingDataRoot();
  return root ? `${normalizeDir(root)}/` : "{未配置}/";
}

/** 用户向目录说明（不暴露完整系统路径） */
export async function trainingDataRootUserLabel(): Promise<string> {
  const custom = readCustomTrainingDataDir();
  if (custom) {
    const base = custom.split(/[/\\]/).pop();
    return base ? `自定义目录「${base}」` : "自定义训练目录";
  }
  return "应用数据目录下的训练资料";
}
