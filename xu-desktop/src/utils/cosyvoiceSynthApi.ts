/**
 * @file CosyVoice 三后端探测与合成 API
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-31
 * @version 1.0.0
 * @category Config
 * @algo none
 */

import { invoke } from "@tauri-apps/api/core";
import type { CosyBackendId } from "../stores/voiceSettings";

export interface CosyBackendProbe {
  backend: string;
  ready: boolean;
  reason: string;
}

export interface CosySynthRequest {
  text: string;
  instruct?: string;
  emotion?: string;
  voice?: string;
  backend: CosyBackendId | string;
  dashscopeModel?: string;
  dashscopeVoice?: string;
  customBaseUrl?: string;
}

/** 探测 Cosy 后端。 */
export function probeCosyBackend(
  backend: CosyBackendId | string,
  customBaseUrl?: string,
): Promise<CosyBackendProbe> {
  return invoke<CosyBackendProbe>("xu_cosyvoice_backend_probe", {
    backend,
    customBaseUrl: customBaseUrl ?? null,
  });
}

/** Cosy 合成 WAV 路径。 */
export function synthesizeCosyVoice(request: CosySynthRequest): Promise<string> {
  return invoke<string>("xu_cosyvoice_synthesize", { request });
}
