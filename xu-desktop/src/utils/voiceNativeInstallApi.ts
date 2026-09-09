/**
 * @file 离线 ASR/TTS 一键安装（与 MCP xu-voice-native / Tauri 同契约）
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-31
 * @updated 2026-09-01
 * @version 1.0.1
 * @category Config
 * @algo none
 */

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export interface VoiceNativeProbe {
  nativeRoot: string;
  asrReady: boolean;
  ttsReady: boolean;
  asrPath?: string | null;
  ttsPath?: string | null;
  approxBytes: number;
  freeHint: string;
  warnings: string[];
}

export interface VoiceNativeStatus {
  phase: string;
  percent: number;
  message: string;
  lastError: string;
  asrReady: boolean;
  ttsReady: boolean;
}

export interface VoiceNativeProgress {
  stage: string;
  percent: number;
  message: string;
}

/** 探测 XU_HOME 离线引擎目录。 */
export function probeVoiceNative(): Promise<VoiceNativeProbe> {
  return invoke<VoiceNativeProbe>("xu_voice_native_probe");
}

/** 一键下载安装 ASR+TTS。 */
export function installVoiceNative(): Promise<VoiceNativeStatus> {
  return invoke<VoiceNativeStatus>("xu_voice_native_install");
}

/** 仅补装 espeak-ng（非中文音色才需要）；模型已装时用。 */
export function ensureVoiceEspeak(): Promise<string> {
  return invoke<string>("xu_voice_ensure_espeak");
}

/** 预热 Kokoro，减少首次试听等待。 */
export function warmupKokoro(voice?: string): Promise<void> {
  return invoke<void>("xu_voice_warmup_kokoro", { voice: voice || null });
}

/** 安装进度快照。 */
export function voiceNativeStatus(): Promise<VoiceNativeStatus> {
  return invoke<VoiceNativeStatus>("xu_voice_native_status");
}

/** 取消安装。 */
export function cancelVoiceNativeInstall(): Promise<void> {
  return invoke<void>("xu_voice_native_cancel");
}

/** 订阅进度事件；返回取消订阅函数。 */
export async function onVoiceNativeProgress(
  handler: (p: VoiceNativeProgress) => void,
): Promise<UnlistenFn> {
  return listen<VoiceNativeProgress>("xu:voice-native-progress", (event) => {
    handler(event.payload);
  });
}
