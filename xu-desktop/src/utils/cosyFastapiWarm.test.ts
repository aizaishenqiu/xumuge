/**
 * @file Cosy 暖机不得阻塞开口
 * @author qiuye <yjk150@qq.com>
 * @date 2026-09-05
 * @version 1.0.0
 * @category Stream
 * @algo vitest-warm-nonblocking
 */
import { describe, expect, it } from "vitest";
import { prepareCosyWarmForSpeak } from "./cosyFastapiWarm";
import { DEFAULT_VOICE_SETTINGS } from "../stores/voiceSettings";

describe("prepareCosyWarmForSpeak", () => {
  it("returns without waiting on an in-flight warm promise", async () => {
    const started = Date.now();
    await prepareCosyWarmForSpeak(DEFAULT_VOICE_SETTINGS);
    expect(Date.now() - started).toBeLessThan(50);
  });
});
