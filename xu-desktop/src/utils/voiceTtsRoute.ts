/**
 * @file TTS 引擎自动路由：普通 → 系统/Sherpa；夹子音/戏剧/临时 instruct → Cosy
 * @author qiuye <yjk150@qq.com>
 * @date 2026-09-01
 * @updated 2026-09-05
 * @version 1.4.0
 * @category Config
 * @algo tts-route-priority
 */

import type { VoiceSettings } from "../stores/voiceSettings";
import { loadVoiceSettings } from "../stores/voiceSettings";
import { toneRequiresCosy } from "./voiceTonePresets";
import type { VoiceProviderId } from "./voicePacks";
import {
  clearVoiceSessionOverride,
  loadVoiceSessionOverride,
  type VoiceSessionOverride,
} from "./voiceSessionOverride";

export type TtsRouteProvider = VoiceProviderId;

export interface TtsRouteContext {
  /** 角色绑定：强制 Cosy / Sherpa / 自动 */
  ttsProviderHint?: "auto" | "sherpa-onnx" | "cosyvoice" | null;
  /** 角色默认语气（可覆盖 settings.toneId 的 Cosy 判定） */
  roleToneId?: string | null;
  /** Cosy 任一后端是否可合成 */
  cosyReady?: boolean;
  /** Sherpa/Kokoro 是否可合成 */
  sherpaReady?: boolean;
  /** 会话级 MCP 覆盖（不传则读 sessionStorage） */
  sessionOverride?: VoiceSessionOverride | null;
  /** 语音通话：优先实时（系统语音），避开 Kokoro CPU 起句延迟 */
  forVoiceCall?: boolean;
}

export interface TtsRouteResult {
  provider: TtsRouteProvider;
  toneId: string;
  /** Cosy instruct：临时覆盖优先，否则由语气表解析 */
  cosyInstruct?: string;
  reason: string;
  /** 需要 Cosy 但不可用，且无离线近似可走 */
  blocked?: boolean;
  blockedMessage?: string;
  /** 戏剧语气降级到 Kokoro 时的一次性提示（仍走 sherpa，非系统音） */
  degradeNotice?: string;
}

/**
 * 解析本次朗读应走的引擎。
 * 优先级：通话优先实时 → MCP 临时 instruct → requiresCosy / 角色 hint → 用户 Cosy → Sherpa → 系统。
 */
export function resolveTtsRoute(
  settings: VoiceSettings = loadVoiceSettings(),
  ctx: TtsRouteContext = {},
): TtsRouteResult {
  const override = ctx.sessionOverride ?? loadVoiceSessionOverride();
  const toneId =
    (override?.toneId && override.toneId.trim()) ||
    (ctx.roleToneId && ctx.roleToneId.trim()) ||
    settings.toneId;
  const tempInstruct =
    override?.llmTtsInstruct?.trim() || override?.cosyInstruct?.trim() || "";

  // 通话优先实时：仅把「离线 Kokoro 正文」切系统音；Cosy 正文跟默认引擎。
  if (
    ctx.forVoiceCall &&
    settings.callPreferRealtime !== false &&
    settings.provider === "sherpa-onnx" &&
    !tempInstruct
  ) {
    return {
      provider: "system-webspeech",
      toneId,
      reason: "call-realtime-system",
    };
  }

  if (tempInstruct) {
    if (ctx.cosyReady === false) {
      return {
        provider: "system-webspeech",
        toneId,
        cosyInstruct: tempInstruct,
        reason: "mcp-instruct",
        blocked: true,
        blockedMessage:
          "当前需要 CosyVoice（临时 instruct），但本地/云端/自建均未就绪。请到设置填写 API Key、自建 URL，或完成本地协助安装。",
      };
    }
    return {
      provider: "cosyvoice",
      toneId,
      cosyInstruct: tempInstruct,
      reason: "mcp-instruct",
    };
  }

  const needsCosy =
    toneRequiresCosy(toneId) || ctx.ttsProviderHint === "cosyvoice";

  if (needsCosy) {
    if (ctx.cosyReady !== false) {
      return {
        provider: "cosyvoice",
        toneId,
        reason: toneRequiresCosy(toneId) ? "requires-cosy" : "role-hint-cosy",
      };
    }
    if (ctx.sherpaReady) {
      return {
        provider: "sherpa-onnx",
        toneId,
        reason: "requires-cosy-fallback-kokoro",
        degradeNotice:
          "「夹子音」等戏剧语气需要 CosyVoice 才能做表情戏。当前 Cosy 未就绪，已用离线 Kokoro 近似音色（非夹子音）。",
      };
    }
    return {
      provider: "system-webspeech",
      toneId,
      reason: "requires-cosy",
      blocked: true,
      blockedMessage:
        "「夹子音」等戏剧语气需要 CosyVoice。请到设置选择本地安装、DashScope API Key 或自建 HTTP；或改用普通语气 + 离线语音。",
    };
  }

  // 戏剧 Cosy / 用户选 Cosy 已在上方处理；此处为普通 Sherpa/系统
  if (ctx.ttsProviderHint === "sherpa-onnx") {
    if (ctx.sherpaReady) {
      return { provider: "sherpa-onnx", toneId, reason: "role-hint-sherpa" };
    }
    return { provider: "system-webspeech", toneId, reason: "sherpa-fallback-system" };
  }

  if (settings.provider === "cosyvoice" && ctx.cosyReady !== false) {
    return { provider: "cosyvoice", toneId, reason: "user-provider-cosy" };
  }

  if (
    (settings.provider === "sherpa-onnx" || ctx.sherpaReady) &&
    ctx.sherpaReady !== false &&
    ctx.sherpaReady
  ) {
    return { provider: "sherpa-onnx", toneId, reason: "sherpa-ready" };
  }

  if (settings.provider === "sherpa-onnx" && ctx.sherpaReady === false) {
    return { provider: "system-webspeech", toneId, reason: "sherpa-missing-system" };
  }

  return {
    provider: "system-webspeech",
    toneId,
    reason: "default-system",
  };
}

/** 清除会话覆盖（MCP voice_clear_override）。 */
export function clearTtsSessionOverride(): void {
  clearVoiceSessionOverride();
}
