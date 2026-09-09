/** Probe PATH for installed IDE CLIs. */

import { invoke } from "@tauri-apps/api/core";
import {
  IDE_OPTIONS,
  readIdeCliOverride,
  type IdeKind,
  type IdeOption,
} from "./ideCli";

export type IdeProbeResult = {
  cursor: boolean;
  vscode: boolean;
  trae: boolean;
  qoder: boolean;
  jetbrains: boolean;
  windsurf: boolean;
  zed: boolean;
  paths: Record<string, string>;
};

export function emptyIdeProbe(): IdeProbeResult {
  return {
    cursor: false,
    vscode: false,
    trae: false,
    qoder: false,
    jetbrains: false,
    windsurf: false,
    zed: false,
    paths: {},
  };
}

function normalizeProbe(raw: Partial<IdeProbeResult> | null | undefined): IdeProbeResult {
  const paths = raw?.paths && typeof raw.paths === "object" ? raw.paths : {};
  return {
    cursor: raw?.cursor === true || Boolean(paths.cursor),
    vscode: raw?.vscode === true || Boolean(paths.vscode),
    trae: raw?.trae === true || Boolean(paths.trae),
    qoder: raw?.qoder === true || Boolean(paths.qoder),
    jetbrains: raw?.jetbrains === true || Boolean(paths.jetbrains),
    windsurf: raw?.windsurf === true || Boolean(paths.windsurf),
    zed: raw?.zed === true || Boolean(paths.zed),
    paths,
  };
}

export async function probeInstalledIdes(): Promise<IdeProbeResult> {
  try {
    const raw = await invoke<IdeProbeResult>("xu_probe_ide_clis");
    return normalizeProbe(raw);
  } catch {
    return emptyIdeProbe();
  }
}

function probeFlagFor(id: IdeKind, probe: IdeProbeResult): boolean {
  switch (id) {
    case "cursor":
      return probe.cursor;
    case "vscode":
      return probe.vscode;
    case "trae":
      return probe.trae;
    case "qoder":
      return probe.qoder;
    case "jetbrains":
      return probe.jetbrains;
    case "windsurf":
      return probe.windsurf;
    case "zed":
      return probe.zed;
    case "other":
      return readIdeCliOverride().length > 0;
    default:
      return false;
  }
}

export function isIdeCliInstalled(id: IdeKind, probe: IdeProbeResult): boolean {
  return probeFlagFor(id, probe);
}

export function firstInstalledIde(probe: IdeProbeResult): IdeKind | null {
  for (const o of IDE_OPTIONS) {
    if (isIdeCliInstalled(o.id, probe)) return o.id;
  }
  return null;
}

/** Resolved CLI executable (absolute path preferred) for opening workspace. */
export function resolvedCliForIde(
  id: IdeKind,
  probe: IdeProbeResult,
  option?: IdeOption,
): string {
  const override = readIdeCliOverride();
  if (id === "other" && override) return override;
  const fromProbe = probe.paths[id];
  if (fromProbe) return fromProbe;
  if (override) return override;
  const opt = option ?? IDE_OPTIONS.find((o) => o.id === id);
  return opt?.cli || "cursor";
}

export function idePickerOptions(probe: IdeProbeResult): Array<{
  value: IdeKind;
  label: string;
  disabled: boolean;
}> {
  return IDE_OPTIONS.map((o) => {
    const ok = isIdeCliInstalled(o.id, probe);
    return {
      value: o.id,
      label: ok ? o.label : `${o.label}（未检测到 CLI，见帮助安装）`,
      disabled: !ok,
    };
  });
}

export function probeSummary(probe: IdeProbeResult): string {
  const names = IDE_OPTIONS.filter((o) => isIdeCliInstalled(o.id, probe)).map((o) => o.label);
  if (!names.length) return "未检测到任何本机 IDE CLI，请安装命令行工具或填写 IDE CLI 覆盖。";
  return `已检测到：${names.join("、")}`;
}

export async function openWorkspaceInExternalIde(
  workspace: string,
  ide: IdeKind | string | undefined,
  probe?: IdeProbeResult,
): Promise<string> {
  const ws = workspace.trim();
  if (!ws) throw new Error("未设置工作区");
  const kind = (ide || "cursor") as IdeKind;
  let p = probe;
  if (!p) {
    try {
      p = await probeInstalledIdes();
    } catch {
      p = emptyIdeProbe();
    }
  }
  const cli = resolvedCliForIde(kind, p);
  return invoke<string>("xu_open_ide_workspace", { workspace: ws, cli });
}
