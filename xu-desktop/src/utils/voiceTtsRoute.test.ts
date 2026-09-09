/**
 * @file resolveTtsRoute 通话实时 / instruct 路由单测
 * @author qiuye <yjk150@qq.com>
 * @date 2026-09-05
 * @version 1.0.0
 * @category Config
 * @algo vitest-tts-route-cases
 */
import { describe, expect, it } from "vitest";
import { resolveTtsRoute } from "./voiceTtsRoute";
import { DEFAULT_VOICE_SETTINGS, type VoiceSettings } from "../stores/voiceSettings";

function settings(patch: Partial<VoiceSettings>): VoiceSettings {
  return { ...DEFAULT_VOICE_SETTINGS, ...patch };
}

describe("resolveTtsRoute", () => {
  it("Kokoro + 通话优先实时：正文走系统音", () => {
    const r = resolveTtsRoute(
      settings({ provider: "sherpa-onnx", callPreferRealtime: true }),
      { forVoiceCall: true, sherpaReady: true, sessionOverride: {} },
    );
    expect(r.provider).toBe("system-webspeech");
    expect(r.reason).toBe("call-realtime-system");
  });

  it("Cosy + 通话优先实时：正文仍走 Cosy", () => {
    const r = resolveTtsRoute(
      settings({ provider: "cosyvoice", callPreferRealtime: true }),
      { forVoiceCall: true, cosyReady: true, sessionOverride: {} },
    );
    expect(r.provider).toBe("cosyvoice");
    expect(r.reason).toBe("user-provider-cosy");
  });

  it("llmTtsInstruct 强制 Cosy 路由", () => {
    const r = resolveTtsRoute(
      settings({ provider: "system-webspeech", callPreferRealtime: true }),
      {
        forVoiceCall: true,
        cosyReady: true,
        sessionOverride: { llmTtsInstruct: "用开心欢快明亮的语气说话" },
      },
    );
    expect(r.provider).toBe("cosyvoice");
    expect(r.reason).toBe("mcp-instruct");
  });
});
