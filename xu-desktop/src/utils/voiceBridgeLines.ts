/**
 * @file 语音通话人设垫话：本地即时开口，覆盖 LLM/Cosy 冷场
 * @author qiuye <yjk150@qq.com>
 * @date 2026-09-01
 * @version 1.0.0
 * @category Stream
 * @algo tone-bridge-line-rotate
 */

import { getVoiceTonePreset, type VoiceToneGender } from "./voiceTonePresets";

/** 男女分库：禁止跨性别复用同一句。 */
const BRIDGE_BY_TONE: Record<string, string[]> = {
  "female-loli": [
    "嗯……你等一下下嘛，人家在想怎么跟你说。",
    "好哦，让我想一小会儿，马上告诉你。",
    "哼，问得这么急，人家还没想完呢，先听我说两句。",
  ],
  "female-mature": [
    "行，先听我说。答案马上给你。",
    "别急。我整理一下重点，你听好。",
    "嗯，这个问题有意思。我先把话说清楚。",
  ],
  "female-gentle": [
    "好的，我先想一下，马上跟你说。",
    "别着急，我慢慢讲给你听。",
    "嗯，我听懂了，稍等我组织一下语言。",
  ],
  "female-jiazi": [
    "哎呀——你等人家一下下嘛，人家在想呢～",
    "哼哼，这么急干嘛啦，先听人家撒个娇再告诉你答案～",
    "好嘛好嘛，人家这就想想，你别催嘛～",
  ],
  "female-cute": [
    "欸嘿嘿，等我一下，我马上告诉你哦。",
    "好呀，让我想一丢丢，你先听我说。",
    "嗯嗯，我在想啦，你别着急嘛。",
  ],
  "female-angry": [
    "我今天有点生气，你还没哄好我，有点不想跟你说话，但是看你诚心的份上，先告诉你答案。",
    "哼，别以为你问一句我就立刻笑脸相迎。先听我说完。",
    "行吧，气还没消呢，但问题我还是会答。你听好。",
  ],
  "female-happy": [
    "好耶！这个问题我喜欢，稍等我蹦出答案。",
    "嘿嘿，等我一下，好消息马上到。",
    "嗯嗯，我开心着呢，先跟你念两句再答。",
  ],
  "female-sunny": [
    "没问题！我先打个招呼，答案马上跟上。",
    "来啦来啦，让我亮堂堂地想一下。",
    "好嘞，先暖个场，重点马上说。",
  ],
  "female-joke": [
    "哈哈，别冷场啊，我先贫一句，正题马上到。",
    "等一下哦，笑话预热完毕，答案加载中。",
    "先笑一口：你问得挺及时。正经回答在后头。",
  ],
  "female-sad": [
    "……好，我慢慢说。你先听着。",
    "嗯，心情有点沉，但我会认真回答你。",
    "别急，我把话说温柔一点再给你答案。",
  ],
  "female-calm": [
    "好的，我先简短说明，随后给出答案。",
    "收到。稍等，我整理要点。",
    "明白了。先开口确认，详细内容马上到。",
  ],
  "male-youth": [
    "行，你等我一下，我马上给你讲。",
    "嗯，我想想啊，先跟你说两句。",
    "别急兄弟，答案马上到，先听我说。",
  ],
  "male-steady": [
    "好。我先把话说稳，再给你结论。",
    "收到。稍等，重点马上报。",
    "别催。先听我把前提说清。",
  ],
  "male-gentle": [
    "好，我慢慢说，你先听着。",
    "嗯，我理解了，先跟你确认一下，再答细节。",
    "别着急，我组织好语言就告诉你。",
  ],
  "male-excited": [
    "来了来了！先别挂，答案马上炸出来。",
    "好！这个问题燃到了，我先喊一声再答。",
    "等我半秒，干货马上到！",
  ],
  "male-angry": [
    "我现在火气不小，你最好听清楚：先听我说完再接答案。",
    "行，气归气，事还是办。你听好了。",
    "别再废话。我先撂两句，正题立刻跟上。",
  ],
  "male-happy": [
    "哈哈好，这问题问得妙，我先乐两句再答。",
    "成！先跟你打个招呼，好消息马上说。",
    "嗯，心情不错，稍等我把答案理顺。",
  ],
  "male-sunny": [
    "没问题兄弟，我先开口暖场，答案马上到。",
    "来！先跟你碰个拳，正题跟上。",
    "好嘞，积极模式启动，重点马上报。",
  ],
  "male-joke": [
    "哈哈别干等啊，我先贫一句：你问得挺会挑时候。正经的来了。",
    "冷场禁止。笑话预热完，干货加载中。",
    "先笑一口，再听答案，体验更好。",
  ],
  "male-sad": [
    "……好。我低声说两句，再给你答案。",
    "嗯，心里有点沉，但我会认真答。你先听着。",
    "别急，我把语气放稳再讲。",
  ],
  "male-calm": [
    "好的。先简短确认，随后给出答案。",
    "收到。稍等，我整理要点。",
    "明白。先开口，详细内容马上到。",
  ],
};

const FALLBACK_BY_GENDER: Record<VoiceToneGender, string[]> = {
  female: ["好的，我先说两句，答案马上到。", "嗯，稍等，我马上告诉你。"],
  male: ["好。我先开口，答案马上到。", "收到，稍等，马上告诉你。"],
};

const lastIndexByTone = new Map<string, number>();

/**
 * 按当前语气轮换取一句垫话；未知语气按性别回退。
 * 男女文案隔离，禁止跨性别复用。
 */
export function pickBridgeLine(toneId?: string | null): string {
  const preset = getVoiceTonePreset(toneId);
  const pool = BRIDGE_BY_TONE[preset.id] ?? FALLBACK_BY_GENDER[preset.gender];
  if (!pool.length) return FALLBACK_BY_GENDER[preset.gender][0]!;
  const prev = lastIndexByTone.get(preset.id) ?? -1;
  const next = (prev + 1) % pool.length;
  lastIndexByTone.set(preset.id, next);
  return pool[next]!;
}

/** 测试/重置轮换游标。 */
export function resetBridgeRotation(): void {
  lastIndexByTone.clear();
}
