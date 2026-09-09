/**
 * @file CosyVoice FastAPI sidecar 启停、want-running 与登录 bootstrap API
 * @author qiuye <yjk150@qq.com>
 * @date 2026-09-01
 * @updated 2026-09-01
 * @version 1.2.0
 * @category Config
 * @algo none
 */

import { invoke } from "@tauri-apps/api/core";

export interface CosySidecarStartRequest {
  python: string;
  serverScript: string;
  modelDir: string;
  extraArgs?: string;
  /** 写入 --port；0 表示不追加（由 extraArgs 自带） */
  port?: number;
}

export interface CosySidecarStatus {
  running: boolean;
  pid: number | null;
  lastError: string;
}

export interface CosyWantRunning {
  want: boolean;
  port: number;
  model: string;
  python: string;
  serverScript: string;
  extraArgs: string;
}

export interface CosyBootstrapResult {
  attempted: boolean;
  running: boolean;
  pid: number | null;
  message: string;
}

/** 用用户填写的路径启动 FastAPI（走 console_start：state + free_port）。 */
export function startCosyFastapiSidecar(req: CosySidecarStartRequest): Promise<CosySidecarStatus> {
  return invoke<CosySidecarStatus>("xu_cosyvoice_sidecar_start", {
    python: req.python,
    serverScript: req.serverScript,
    modelDir: req.modelDir,
    extraArgs: req.extraArgs ?? "",
    port: req.port ?? 50000,
  });
}

export function stopCosyFastapiSidecar(): Promise<CosySidecarStatus> {
  return invoke<CosySidecarStatus>("xu_cosyvoice_sidecar_stop");
}

export function cosyFastapiSidecarStatus(): Promise<CosySidecarStatus> {
  return invoke<CosySidecarStatus>("xu_cosyvoice_sidecar_status");
}

/**
 * 同步「下次登录自动启」标记到 `{XU_HOME}/cosyvoice/want-running.json`。
 * want=false 时清标记；want=true 时写入路径。
 */
export function setCosyWantRunning(input: {
  want: boolean;
  python?: string;
  serverScript?: string;
  model?: string;
  port?: number;
  extraArgs?: string;
}): Promise<void> {
  return invoke<void>("xu_cosyvoice_set_want_running", {
    want: input.want,
    python: input.python ?? null,
    serverScript: input.serverScript ?? null,
    model: input.model ?? null,
    port: input.port ?? null,
    extraArgs: input.extraArgs ?? null,
  });
}

/** 读取 want-running 磁盘标记。 */
export function getCosyWantRunning(): Promise<CosyWantRunning | null> {
  return invoke<CosyWantRunning | null>("xu_cosyvoice_get_want_running");
}

/** 登录自检 / 自动启：free_port + 若 want 则自动启动（可带路径覆盖）。 */
export function cosyFastapiBootstrap(input?: {
  want?: boolean;
  python?: string;
  serverScript?: string;
  model?: string;
  port?: number;
  extraArgs?: string;
}): Promise<CosyBootstrapResult> {
  return invoke<CosyBootstrapResult>("xu_cosyvoice_bootstrap", {
    want: input?.want ?? null,
    python: input?.python ?? null,
    serverScript: input?.serverScript ?? null,
    model: input?.model ?? null,
    port: input?.port ?? null,
    extraArgs: input?.extraArgs ?? null,
  });
}
