/**
 * @file 本机岗位训练库路径与持久化清单
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-31
 * @version 2.0.0
 * @category DB
 * @algo append-safe-local-store
 */
import { invoke } from "@tauri-apps/api/core";
import { resolveTrainingDataRoot } from "./trainingDirPrefs";

export const TRAINING_SCHEMA_VERSION = 3;

export async function xuHome(): Promise<string> {
  try {
    return (await invoke<string>("xu_get_home")).trim();
  } catch {
    return "";
  }
}

export function joinTrainingFile(root: string, name: string): string {
  return `${root.replace(/[/\\]+$/, "")}/${name}`;
}

export function mcpTrainingPath(root: string): string {
  return joinTrainingFile(root, "mcp-training.json");
}

export function legacyMcpTipsPath(root: string): string {
  return joinTrainingFile(root, "mcp-tips.json");
}

export function curriculumPath(root: string): string {
  return joinTrainingFile(root, "curriculum.json");
}

export function samplesPath(root: string): string {
  return joinTrainingFile(root, "samples.jsonl");
}

export function outcomesPath(root: string): string {
  return joinTrainingFile(root, "outcomes.json");
}

export function caseLibraryPath(root: string): string {
  return joinTrainingFile(root, "case-library.json");
}

export function evalSuitesPath(root: string): string {
  return joinTrainingFile(root, "eval-suites.json");
}

export function evalRunsPath(root: string): string {
  return joinTrainingFile(root, "eval-runs.json");
}

export function trainingManifestPath(root: string): string {
  return joinTrainingFile(root, "manifest.json");
}

export type TrainingManifest = {
  schemaVersion: number;
  updatedAt: string;
  dataPolicy: "user_permanent";
  note: string;
  dataRoot?: string;
};

export async function ensureTrainingDirsAt(root: string): Promise<void> {
  const dir = root.replace(/[/\\]+$/, "");
  if (!dir) return;
  await invoke("create_workspace_path", { workspace: dir, path: dir, isDir: true });
}

export async function readTrainingRootOrThrow(): Promise<string> {
  const root = await resolveTrainingDataRoot();
  if (!root) throw new Error("无法解析训练数据目录");
  return root;
}

export async function readTrainingText(absPath: string): Promise<string> {
  return invoke<string>("read_text_file", { path: absPath });
}

export async function writeTrainingText(
  root: string,
  absPath: string,
  content: string,
): Promise<void> {
  await ensureTrainingDirsAt(root);
  await invoke("write_text_file", { workspace: root, path: absPath, content });
}

export async function touchTrainingManifest(root: string): Promise<void> {
  await ensureTrainingDirsAt(root);
  const manifest: TrainingManifest = {
    schemaVersion: TRAINING_SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    dataPolicy: "user_permanent",
    note: "用户训练库；课程、任务结果、评测与 playbook 均留在本机，升级软件不会覆盖。",
    dataRoot: root,
  };
  await writeTrainingText(root, trainingManifestPath(root), JSON.stringify(manifest, null, 2));
}

export async function readTrainingHomeOrThrow(): Promise<string> {
  return readTrainingRootOrThrow();
}

export async function ensureTrainingDirs(home: string): Promise<void> {
  await ensureTrainingDirsAt(home);
}

export function trainingRoot(home: string): string {
  return home.replace(/[/\\]+$/, "");
}
