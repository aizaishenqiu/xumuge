/**
 * @file 离线语音引擎能力探测与 Provider 徽章文案
 * @author qiuye <yjk150@qq.com>
 * @date 2026-09-01
 * @updated 2026-09-03
 * @version 1.1.0
 * @category Config
 * @algo capability-tri-state
 */

import { invoke } from "@tauri-apps/api/core";
import type { InstalledVoicePack, VoiceProviderId } from "./voicePacks";

export type OfflineVoiceCapability = "packMissing" | "packOnly" | "ready";

export interface VoiceEngineStatus {
  provider: string;
  packInstalled: boolean;
  synthesisAvailable: boolean;
  reason: string;
}

/** Cosy 前端侧「环境已存在」提示（安装 phase / 路径），不要求服务在跑。 */
export interface CosyEnvHints {
  installPhaseReady?: boolean;
  /** settings 已有 python + server.py 路径 */
  launchPathsConfigured?: boolean;
  discoverOk?: boolean;
}

/** 查询 Rust 引擎状态；synthesisAvailable 在 native-tts/native-voice+模型齐全或 Cosy 后端就绪时为 true。 */
export function fetchVoiceEngineStatus(
  provider: Exclude<VoiceProviderId, "system-webspeech">,
  opts?: { cosyBackend?: string; cosyCustomBaseUrl?: string },
): Promise<VoiceEngineStatus> {
  return invoke<VoiceEngineStatus>("xu_voice_engine_status", {
    provider,
    cosyBackend: opts?.cosyBackend ?? null,
    cosyCustomBaseUrl: opts?.cosyCustomBaseUrl ?? null,
  });
}

/**
 * 由 pack 列表与引擎状态推导能力三态。
 * synthesisAvailable=true 且已装包 → ready；已装无合成 → packOnly；否则 packMissing。
 */
export function resolveOfflineCapability(
  provider: Exclude<VoiceProviderId, "system-webspeech">,
  packs: InstalledVoicePack[],
  status: VoiceEngineStatus | null | undefined,
): OfflineVoiceCapability {
  const packInstalled =
    status?.packInstalled ?? packs.some((p) => p.provider === provider);
  if (!packInstalled) return "packMissing";
  if (status?.synthesisAvailable) return "ready";
  return "packOnly";
}

/**
 * Cosy 徽章抬升：Rust 仍报未装时，若本机安装 phase / 启动路径 / discover 已就绪，至少显示「已装·不可合成」。
 * 不把 DashScope Key 算作扩展已装。
 */
export function liftCosyOfflineCapability(
  base: OfflineVoiceCapability,
  hints: CosyEnvHints,
): OfflineVoiceCapability {
  if (base === "ready" || base === "packOnly") return base;
  const envReady =
    Boolean(hints.installPhaseReady) ||
    Boolean(hints.launchPathsConfigured) ||
    Boolean(hints.discoverOk);
  return envReady ? "packOnly" : "packMissing";
}

/** Provider 按钮徽章文案（不含品牌名）。 */
export function offlineCapabilityBadge(capability: OfflineVoiceCapability): string {
  switch (capability) {
    case "ready":
      return "可用";
    case "packOnly":
      return "已装·不可合成";
    default:
      return "未装";
  }
}

/** 完整按钮标签：Sherpa ONNX · 未装 */
export function offlineProviderButtonLabel(
  baseLabel: string,
  capability: OfflineVoiceCapability,
): string {
  return `${baseLabel} · ${offlineCapabilityBadge(capability)}`;
}

/** 当前是否允许把该离线 provider 设为「当前朗读方式」。 */
export function canSelectOfflineAsCurrent(capability: OfflineVoiceCapability): boolean {
  return capability === "ready";
}
