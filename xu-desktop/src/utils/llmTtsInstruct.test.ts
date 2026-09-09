/**
 * @file parseLlmTtsInstruct / stripOralStageDirections 单测
 * @author qiuye <yjk150@qq.com>
 * @date 2026-09-03
 * @updated 2026-09-05
 * @version 1.1.1
 * @category Parse
 * @algo vitest-tts-instruct-cases
 */
import { describe, expect, it } from "vitest";
import {
  compactCosyInstruct,
  formatCv2Instruct2,
  parseLlmTtsInstruct,
  stripLlmTtsInstruct,
  stripOralStageDirections,
} from "./llmTtsInstruct";

describe("parseLlmTtsInstruct", () => {
  it("splits answer and TTS_INSTRUCT on last line", () => {
    const r = parseLlmTtsInstruct(
      "可以出去散散步，感受一下美好的风景！\nTTS_INSTRUCT:用开心欢快明亮的语气说话",
    );
    expect(r.answerText).toBe("可以出去散散步，感受一下美好的风景！");
    expect(r.ttsInstruct).toBe("用开心欢快明亮的语气说话");
  });

  it("returns null instruct when tag missing", () => {
    const r = parseLlmTtsInstruct("今天天气不错。");
    expect(r.answerText).toBe("今天天气不错。");
    expect(r.ttsInstruct).toBeNull();
  });

  it("keeps multiline answer and finds tag not only at end", () => {
    const r = parseLlmTtsInstruct(
      "第一句。\n第二句。\nTTS_INSTRUCT:用低沉悲伤缓慢的语气说话\n（不应出现）",
    );
    // 短表演括注默认剥离，并入 instruct
    expect(r.answerText).toBe("第一句。\n第二句。");
    expect(r.ttsInstruct).toContain("用低沉悲伤缓慢的语气说话");
    expect(r.ttsInstruct).toMatch(/不应出现/);
  });

  it("is case-insensitive and trims spaces around tag", () => {
    const r = parseLlmTtsInstruct("你好\n  tts_instruct: 用平稳冷静客观的语气说话  ");
    expect(r.answerText).toBe("你好");
    expect(r.ttsInstruct).toBe("用平稳冷静客观的语气说话");
  });

  it("hides incomplete trailing TTS_INSTRUCT prefix while streaming", () => {
    const r = parseLlmTtsInstruct("正文还在写\nTTS_INSTRU");
    expect(r.answerText).toBe("正文还在写");
    expect(r.ttsInstruct).toBeNull();
  });

  it("hides partial TTS_INSTRUCT mid-token stream (half tag)", () => {
    expect(stripLlmTtsInstruct("你好呀～\nTTS_IN")).toBe("你好呀～");
    expect(stripLlmTtsInstruct("你好呀～\nTTS_INSTRUCT")).toBe("你好呀～");
  });

  it("streaming: stage directions stripped before instruct line completes", () => {
    expect(
      stripLlmTtsInstruct("哎～！(超兴奋) 今天怎样？\nTTS_INSTR"),
    ).toBe("哎～！今天怎样？");
  });

  it("hides empty TTS_INSTRUCT line without setting instruct", () => {
    const r = parseLlmTtsInstruct("已有正文\nTTS_INSTRUCT:");
    expect(r.answerText).toBe("已有正文");
    expect(r.ttsInstruct).toBeNull();
  });

  it("stripLlmTtsInstruct only returns answer", () => {
    expect(
      stripLlmTtsInstruct("答\nTTS_INSTRUCT:用开心欢快明亮的语气说话"),
    ).toBe("答");
  });

  it("persist path: stripped body never contains TTS_INSTRUCT tag", () => {
    const persisted = stripLlmTtsInstruct(
      "可以出去走走。\nTTS_INSTRUCT:用开心欢快明亮的语气说话",
    );
    expect(persisted).not.toMatch(/TTS_INSTRUCT/i);
    expect(persisted).toBe("可以出去走走。");
  });

  it("strips stage directions from answer while keeping TTS_INSTRUCT", () => {
    const r = parseLlmTtsInstruct(
      "哎～！哥哥来啦！(超兴奋) 人家等你好久啦～今天想让人家帮忙做点啥嘛？(拖音)\nTTS_INSTRUCT:用开心欢快明亮的语气说话",
    );
    expect(r.answerText).toBe(
      "哎～！哥哥来啦！人家等你好久啦～今天想让人家帮忙做点啥嘛？",
    );
    expect(r.ttsInstruct).toContain("用开心欢快明亮的语气说话");
    expect(r.ttsInstruct).toMatch(/超兴奋|拖音/);
  });

  it("strips 卖萌/嘻嘻 stage parens and feeds TTS instruct", () => {
    const r = parseLlmTtsInstruct(
      "我能帮你（卖萌）做很多事情哟（嘻嘻）\nTTS_INSTRUCT:用开心欢快明亮的语气说话",
    );
    expect(r.answerText).toBe("我能帮你做很多事情哟");
    expect(r.ttsInstruct).toContain("用开心欢快明亮的语气说话");
    expect(r.ttsInstruct).toMatch(/卖萌|嘻嘻/);
  });

  it("strips leaked Cosy/mood instruct spoken as body", () => {
    const r = parseLlmTtsInstruct("用网络流行夹子音说话。\n今天天气不错。");
    expect(r.answerText).toBe("今天天气不错。");
    expect(r.ttsInstruct).toContain("夹子音");
  });

  it("strips cute mood instruct copy as sole body", () => {
    const r = parseLlmTtsInstruct("用俏皮可爱的语气说。");
    expect(r.answerText).toBe("");
    expect(r.ttsInstruct).toMatch(/俏皮|语气/);
  });
});

describe("compactCosyInstruct", () => {
  it("strips 用…说话 wrappers into short style tags", () => {
    expect(compactCosyInstruct("用俏皮卖萌的语气说话，信息仍要清楚。")).toBe(
      "俏皮卖萌，信息仍要清楚",
    );
    expect(compactCosyInstruct("用网络流行夹子音说话：软糯卖萌、句尾上扬")).toContain(
      "夹子音",
    );
  });

  it("returns empty for blank", () => {
    expect(compactCosyInstruct("")).toBe("");
    expect(compactCosyInstruct("   ")).toBe("");
  });
});

describe("formatCv2Instruct2", () => {
  it("wraps compact style with endofprompt", () => {
    expect(formatCv2Instruct2("低沉男声，节奏稳健")).toBe(
      "用低沉男声，节奏稳健说这句话<|endofprompt|>",
    );
  });

  it("returns empty for blank", () => {
    expect(formatCv2Instruct2("")).toBe("");
  });
});

describe("stripOralStageDirections", () => {
  it("removes screenshot-style performance parens", () => {
    expect(
      stripOralStageDirections(
        "哎～！哥哥来啦！(超兴奋) 人家等你好久啦～今天想让人家帮忙做点啥嘛？(拖音)",
      ),
    ).toBe("哎～！哥哥来啦！人家等你好久啦～今天想让人家帮忙做点啥嘛？");
  });

  it("strips arbitrary short stage parens without keyword list", () => {
    expect(stripOralStageDirections("你好呀（歪着头）今天怎样（轻笑）")).toBe(
      "你好呀今天怎样",
    );
    expect(stripOralStageDirections("详情见设置页（云登录）")).toBe(
      "详情见设置页（云登录）",
    );
  });

  it("removes 【小声】 style brackets", () => {
    expect(stripOralStageDirections("过来一下【小声】别怕")).toBe("过来一下别怕");
  });

  it("keeps ordinary parenthetical notes without stage keywords", () => {
    expect(stripOralStageDirections("详情见设置页（云登录）")).toBe(
      "详情见设置页（云登录）",
    );
  });

  it("keeps long parenthetical explanations", () => {
    const s = "请打开设置页（见左侧边栏里的语音与朗读分组）再试";
    expect(stripOralStageDirections(s)).toBe(s);
  });
});
