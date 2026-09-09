/**
 * @file 系统 Web Speech 中文声线展示名与性别推断
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-31
 * @updated 2026-09-02
 * @version 1.1.0
 * @category Config
 * @algo microsoft-zh-voice-label-map
 */

export type SystemVoiceGender = "female" | "male" | "unknown";

const SYSTEM_VOICE_LABELS: Array<{
  match: RegExp;
  label: string;
  gender: SystemVoiceGender;
}> = [
  { match: /huihui|慧慧/i, label: "慧慧", gender: "female" },
  { match: /yaoyao|瑶瑶/i, label: "瑶瑶", gender: "female" },
  { match: /xiaoxiao|晓晓/i, label: "晓晓", gender: "female" },
  { match: /xiaoyi|晓伊/i, label: "晓伊", gender: "female" },
  { match: /xiaoyan|晓颜/i, label: "晓颜", gender: "female" },
  { match: /xiaochen|晓辰/i, label: "晓辰", gender: "female" },
  { match: /xiaohan|晓涵/i, label: "晓涵", gender: "female" },
  { match: /xiaomo|晓墨/i, label: "晓墨", gender: "female" },
  { match: /xiaoxuan|晓萱/i, label: "晓萱", gender: "female" },
  { match: /xiaorui|晓睿/i, label: "晓睿", gender: "female" },
  { match: /xiaoshuang|晓双/i, label: "晓双", gender: "female" },
  { match: /xiaomeng|晓梦/i, label: "晓梦", gender: "female" },
  { match: /kangkang|康康/i, label: "康康", gender: "male" },
  { match: /yunyang|云扬/i, label: "云扬", gender: "male" },
  { match: /yunjian|云健/i, label: "云健", gender: "male" },
  { match: /yunxi|云希/i, label: "云希", gender: "male" },
  { match: /yunye|云野/i, label: "云野", gender: "male" },
  { match: /yunhao|云皓/i, label: "云皓", gender: "male" },
];

const FEMALE_HINT = /female|woman|girl|女|hui|yao|xiao(?!.*男)/i;
const MALE_HINT = /male|man|boy|男|kang|yun(?!xia)/i;

/** 推断系统声线性别；无法判断时 unknown。 */
export function inferSystemVoiceGender(voice: SpeechSynthesisVoice): SystemVoiceGender {
  const hay = `${voice.name} ${voice.voiceURI}`;
  for (const row of SYSTEM_VOICE_LABELS) {
    if (row.match.test(hay)) return row.gender;
  }
  if (MALE_HINT.test(hay) && !FEMALE_HINT.test(hay)) return "male";
  if (FEMALE_HINT.test(hay) && !MALE_HINT.test(hay)) return "female";
  return "unknown";
}

/** 将系统声线格式化为中文短名；voiceURI 仍作持久 id。 */
export function formatSystemVoiceLabel(voice: SpeechSynthesisVoice): string {
  const hay = `${voice.name} ${voice.voiceURI}`;
  for (const row of SYSTEM_VOICE_LABELS) {
    if (row.match.test(hay)) {
      const g = row.gender === "male" ? "男" : row.gender === "female" ? "女" : "";
      return g ? `${row.label}·${g}` : row.label;
    }
  }
  const short = voice.name.split("-")[0]?.trim() || voice.name;
  const g = inferSystemVoiceGender(voice);
  if (g === "male") return `${short}·男`;
  if (g === "female") return `${short}·女`;
  return short;
}

/** 优先返回 zh 声线；无则返回全部。 */
export function filterZhSystemVoices(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice[] {
  const zh = voices.filter((v) => /zh|cmn|chinese/i.test(v.lang));
  return zh.length ? zh : voices;
}

/** 按性别过滤系统声线；unknown 在选女时一并给出（多数本机中文包为女）。 */
export function filterSystemVoicesByGender(
  voices: SpeechSynthesisVoice[],
  gender: "female" | "male",
): SpeechSynthesisVoice[] {
  const pool = filterZhSystemVoices(voices);
  const matched = pool.filter((v) => {
    const g = inferSystemVoiceGender(v);
    if (gender === "female") return g === "female" || g === "unknown";
    return g === "male";
  });
  return matched;
}

/** 本机中文系统声线是否含该性别。 */
export function systemHasGender(
  voices: SpeechSynthesisVoice[],
  gender: "female" | "male",
): boolean {
  return filterSystemVoicesByGender(voices, gender).length > 0;
}
