/**
 * @file CosyVoice / 协助安装 Tauri API 与披露类型
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-31
 * @updated 2026-09-03
 * @version 1.2.0
 * @category Config
 * @algo cosyvoice-install-client
 */

import { invoke } from "@tauri-apps/api/core";

export interface CosyDiskDrive {
  path: string;
  freeBytes: number;
  totalBytes: number;
}

export interface CosyDepItem {
  id: string;
  label: string;
  present: boolean;
  autoInstall: boolean;
  needsElevation: boolean;
}

export interface CosyProbeReport {
  hasNvidia: boolean;
  vramMb: number | null;
  drives: CosyDiskDrive[];
  recommendedInstallRoot: string;
  hasConda: boolean;
  hasPython310: boolean;
  hasGit: boolean;
  hasMsvc: boolean | null;
  modelScopeReachable: boolean | null;
  hfReachable: boolean | null;
  meetsMinimum: boolean;
  blockers: string[];
  warnings: string[];
  missingDeps: CosyDepItem[];
  presentDeps: CosyDepItem[];
}

export interface CosyDisclosure {
  willInstall: string[];
  willSkip: string[];
  alreadyPresent: string[];
  disk: {
    minicondaBytes: number;
    envPackagesBytes: number;
    repoBytes: number;
    modelBytes: number;
    tempBufferBytes: number;
    totalSuggestedBytes: number;
  };
  time: {
    depsMinutes: string;
    envMinutes: string;
    modelMinutes: string;
    totalMinutes: string;
  };
  notes: string[];
  defaultModel: string;
}

export interface CosyInstallPlan {
  installRoot: string;
  modelSource: string;
  localModelPath?: string | null;
  modeIds: string[];
  ok: boolean;
  errors: string[];
  disclosure: CosyDisclosure;
}

export interface CosyStatus {
  phase: string;
  percent: number;
  message: string;
  lastError: string;
  installRoot: string;
  deps: { id: string; label: string; state: string }[];
}

export interface CosyLaunchHints {
  python?: string | null;
  serverScript?: string | null;
  modelDir?: string | null;
  baseUrl: string;
  installRoot: string;
}

export interface CosyDiscoverReport {
  ok: boolean;
  python?: string | null;
  serverScript?: string | null;
  modelDir?: string | null;
  voicesRoot?: string | null;
  consoleHtml?: string | null;
  defaultPromptWav?: string | null;
  defaultPromptText?: string | null;
  cosyVoice2?: boolean;
  baseUrl: string;
  scanRoot: string;
  missing: string[];
  notes: string[];
  /** CosyVoice2/3 模型目录候选 */
  modelCandidates?: string[];
}

export interface CosyInstallRead {
  installJson: Record<string, unknown>;
  logTail: string[];
  failedStage?: string | null;
  failedReason?: string | null;
  completedStages: string[];
  canResume: boolean;
}

export interface CosyMode {
  id: string;
  label: string;
  builtin: boolean;
  instruct: string;
  emotion?: string | null;
  rate: number;
  pitch: number;
}

/** 探测本机是否达到 CosyVoice 最低安装条件。 */
export function cosyvoiceProbe(): Promise<CosyProbeReport> {
  return invoke("xu_cosyvoice_probe");
}

/** 校验选盘与模型源，返回须向用户展示的 disclosure。 */
export function cosyvoicePlan(input: {
  installRoot: string;
  modelSource: string;
  localModelPath?: string;
  modeIds: string[];
}): Promise<CosyInstallPlan> {
  return invoke("xu_cosyvoice_plan", { input });
}

/** 仅安装缺失依赖；未齐不得进入本体。 */
export function cosyvoiceEnsureDeps(installRoot: string): Promise<void> {
  return invoke("xu_cosyvoice_ensure_deps", { installRoot });
}

/** 依赖齐后继续安装流水线（本构建可能停在 awaiting_agent）。 */
export function cosyvoiceInstall(plan: CosyInstallPlan): Promise<void> {
  return invoke("xu_cosyvoice_install", { plan });
}

export function cosyvoiceStatus(): Promise<CosyStatus> {
  return invoke("xu_cosyvoice_status");
}

export function cosyvoiceCancel(): Promise<void> {
  return invoke("xu_cosyvoice_cancel");
}

export function cosyvoiceModesLoad(): Promise<CosyMode[]> {
  return invoke("xu_cosyvoice_modes_load");
}

export function cosyvoiceModesSave(modes: CosyMode[]): Promise<void> {
  return invoke("xu_cosyvoice_modes_save", { modes });
}

/** 带超时的 invoke，避免 Rust 侧长扫描阻塞 UI。 */
export function invokeWithTimeout<T>(
  cmd: string,
  args: Record<string, unknown>,
  timeoutMs = 45_000,
): Promise<T> {
  return Promise.race([
    invoke<T>(cmd, args),
    new Promise<T>((_, reject) => {
      window.setTimeout(() => reject(new Error("操作超时，请稍后重试或手动选择 Cosy 根目录。")), timeoutMs);
    }),
  ]);
}

/** 自动探测 CosyVoice FastAPI 路径。 */
export function cosyvoiceDiscover(input?: {
  optionalRoot?: string;
  hintPython?: string;
  hintServer?: string;
  preferredModel?: string;
  useCache?: boolean;
}): Promise<CosyDiscoverReport> {
  return invokeWithTimeout<CosyDiscoverReport>("xu_cosyvoice_discover", {
    optionalRoot: input?.optionalRoot ?? null,
    hintPython: input?.hintPython ?? null,
    hintServer: input?.hintServer ?? null,
    preferredModel: input?.preferredModel ?? null,
    useCache: input?.useCache ?? true,
  });
}

/** 根据 install.json 推导 FastAPI 启动项。 */
export function cosyvoiceLaunchHints(): Promise<CosyLaunchHints> {
  return invoke("xu_cosyvoice_launch_hints");
}

/** 读取 install.json 与 install.log 尾部。 */
export function cosyvoiceInstallRead(): Promise<CosyInstallRead> {
  return invoke("xu_cosyvoice_install_read");
}

/** 从断点续装（跳过 completedStages）。 */
export function cosyvoiceInstallResume(installRoot: string): Promise<void> {
  return invoke("xu_cosyvoice_install_resume", { installRoot });
}

/** 打开 CosyVoice 原生控制台（Vue + Rust）。 */
export function cosyvoiceOpenConsole(): Promise<string> {
  return invoke<string>("xu_cosyvoice_open_console");
}

/** 安装阶段中文标签。 */
export function cosyInstallStageLabel(stage: string): string {
  const map: Record<string, string> = {
    deps: "依赖",
    clone_repo: "克隆仓库",
    pip_requirements: "pip 依赖",
    download_model: "下载模型",
    smoke_verify: "冒烟校验",
  };
  return map[stage] ?? stage;
}

/** 将字节格式化为 GiB 文案。 */
export function formatGiB(bytes: number): string {
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
