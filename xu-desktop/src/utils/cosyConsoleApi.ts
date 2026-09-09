/**
 * @file CosyVoice 原生控制台 Tauri API（替代 manager.py / iframe）
 * @author qiuye <yjk150@qq.com>
 * @date 2026-09-01
 * @version 1.0.0
 * @category Config
 * @algo native-console-invoke
 */

import { invoke } from "@tauri-apps/api/core";
import type { CosySidecarStatus } from "./cosyFastapiSidecarApi";

export interface CosyConsoleEnv {
  scanRoot: string;
  python?: string;
  serverScript?: string;
  modelRoot?: string;
  logFile: string;
  voicesRoot?: string;
  defaultPromptWav?: string;
  defaultPromptText?: string;
  cosyVoice2?: boolean;
}

export interface CosyConsoleProbe {
  ok: boolean;
  latencyMs?: number;
  message: string;
}

export interface CosyConsoleStatus {
  running: boolean;
  healthy: boolean;
  pid?: number;
  port: number;
  model: string;
  models: string[];
  probe: CosyConsoleProbe;
}

/** 打开原生控制台窗口。 */
export function cosyConsoleOpen(): Promise<string> {
  return invoke<string>("xu_cosyvoice_open_console");
}

/** 读取环境路径。 */
export function cosyConsoleEnv(): Promise<CosyConsoleEnv> {
  return invoke<CosyConsoleEnv>("xu_cosyvoice_console_env");
}

/** 综合状态。 */
export function cosyConsoleStatus(baseUrl: string, port?: number): Promise<CosyConsoleStatus> {
  return invoke<CosyConsoleStatus>("xu_cosyvoice_console_status", { baseUrl, port: port ?? null });
}

/** 探测 FastAPI。 */
export function cosyConsoleProbe(baseUrl: string): Promise<CosyConsoleProbe> {
  return invoke<CosyConsoleProbe>("xu_cosyvoice_console_probe", { baseUrl });
}

/** 可选模型列表。 */
export function cosyConsoleModels(): Promise<string[]> {
  return invoke<string[]>("xu_cosyvoice_console_models");
}

/** sidecar 日志尾部。 */
export function cosyConsoleLog(lines?: number): Promise<string[]> {
  return invoke<string[]>("xu_cosyvoice_console_log", { lines: lines ?? null });
}

/** 启动 sidecar。 */
export function cosyConsoleStart(input: {
  python: string;
  serverScript: string;
  model: string;
  port?: number;
  extraArgs?: string;
}): Promise<CosySidecarStatus> {
  return invoke<CosySidecarStatus>("xu_cosyvoice_console_start", {
    python: input.python,
    serverScript: input.serverScript,
    model: input.model,
    port: input.port ?? null,
    extraArgs: input.extraArgs ?? null,
  });
}

/** 停止 sidecar。 */
export function cosyConsoleStop(): Promise<CosySidecarStatus> {
  return invoke<CosySidecarStatus>("xu_cosyvoice_console_stop");
}

/** 重启 sidecar。 */
export function cosyConsoleRestart(input: {
  python: string;
  serverScript: string;
  model: string;
  port?: number;
  extraArgs?: string;
}): Promise<CosySidecarStatus> {
  return invoke<CosySidecarStatus>("xu_cosyvoice_console_restart", {
    python: input.python,
    serverScript: input.serverScript,
    model: input.model,
    port: input.port ?? null,
    extraArgs: input.extraArgs ?? null,
  });
}

/** 保存音色到 voices_root。 */
export function cosyConsoleSaveVoice(input: {
  voicesRoot: string;
  id: string;
  name: string;
  promptText: string;
  instruct: string;
  wavPath: string;
}): Promise<void> {
  return invoke<void>("xu_cosyvoice_console_save_voice", { input });
}

/** 删除音色。 */
export function cosyConsoleDeleteVoice(voicesRoot: string, id: string): Promise<void> {
  return invoke<void>("xu_cosyvoice_console_delete_voice", { voicesRoot, id });
}
