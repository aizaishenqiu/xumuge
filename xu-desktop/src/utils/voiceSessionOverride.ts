/**
 * @file 会话级 TTS 覆盖（MCP voice_set_tone / voice_set_cosy_instruct）
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-31
 * @updated 2026-09-07
 * @version 1.1.1
 * @category Config
 * @algo session-storage-override
 */

import { loadVoiceSettings } from "../stores/voiceSettings";

const KEY = "xu.voice.session.override.v1";

export interface VoiceSessionOverride {
  toneId?: string;
  /** 临时 Cosy instruct / 角色音色描述（MCP） */
  cosyInstruct?: string;
  /**
   * 本回合 LLM 产出的 TTS_INSTRUCT（Mode A）。
   * 优先级高于 cosyInstruct；传空串表示清除。
   */
  llmTtsInstruct?: string;
  updatedAt?: string;
}

/** 读取会话覆盖；无或损坏返回 null。 */
export function loadVoiceSessionOverride(): VoiceSessionOverride | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as VoiceSessionOverride;
    if (!parsed || typeof parsed !== "object") return null;
    return {
      toneId: typeof parsed.toneId === "string" ? parsed.toneId : undefined,
      cosyInstruct:
        typeof parsed.cosyInstruct === "string" ? parsed.cosyInstruct : undefined,
      llmTtsInstruct:
        typeof parsed.llmTtsInstruct === "string" && parsed.llmTtsInstruct.trim()
          ? parsed.llmTtsInstruct.trim()
          : undefined,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : undefined,
    };
  } catch {
    return null;
  }
}

/** 合并写入会话覆盖。 */
export function saveVoiceSessionOverride(
  patch: Partial<VoiceSessionOverride>,
): VoiceSessionOverride {
  const prev = loadVoiceSessionOverride() ?? {};
  const next: VoiceSessionOverride = {
    ...prev,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  if ("llmTtsInstruct" in patch) {
    const v = patch.llmTtsInstruct?.trim();
    if (v) next.llmTtsInstruct = v;
    else delete next.llmTtsInstruct;
  }
  if (typeof sessionStorage !== "undefined") {
    sessionStorage.setItem(KEY, JSON.stringify(next));
  }
  window.dispatchEvent(new CustomEvent("xu:voice-session-override", { detail: next }));
  return next;
}

/** 清除会话覆盖。 */
export function clearVoiceSessionOverride(): void {
  if (typeof sessionStorage !== "undefined") {
    sessionStorage.removeItem(KEY);
  }
  window.dispatchEvent(new CustomEvent("xu:voice-session-override", { detail: null }));
}

/**
 * Duty: 按引擎决定是否持久化 LLM TTS_INSTRUCT。
 * CosyVoice2/3 zero_shot 不消费 instruct；写入只会诱使后续误用，故清空。
 */
export function persistLlmTtsInstructForEngine(instruct: string | null | undefined): void {
  const vs = loadVoiceSettings();
  const cosyCv2 =
    vs.provider === "cosyvoice" &&
    (vs.cosyBackend === "fastapi" || vs.cosyBackend === "local") &&
    Boolean(vs.cosyVoice2);
  if (cosyCv2) {
    saveVoiceSessionOverride({ llmTtsInstruct: "" });
    return;
  }
  if (instruct?.trim()) {
    saveVoiceSessionOverride({ llmTtsInstruct: instruct.trim() });
  }
}
