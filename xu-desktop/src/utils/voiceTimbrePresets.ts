/**
 * @file 朗读音色预设（角色声线，按性别；非心情）
 * @author qiuye <yjk150@qq.com>
 * @date 2026-09-01
 * @updated 2026-09-07
 * @version 1.2.0
 * @category Config
 * @algo preset-table-timbre
 */

export type VoiceGender = "female" | "male";

export interface VoiceTimbrePreset {
  id: string;
  label: string;
  gender: VoiceGender;
  rate: number;
  pitch: number;
  /** 注入通话 system 的口语人设 */
  oralStyle: string;
  /** Cosy instruct 底稿（中文短句） */
  cosyInstruct: string;
  /** 匹配离线包 / 系统声 / 口令关键词 */
  voiceHints: string[];
  /** 戏剧向，路由优先 Cosy */
  requiresCosy?: boolean;
  /** 自动写入 Cosy 音色库 sys-<id> */
  autoSeed?: boolean;
}

/**
 * 产品一键音色表（Cosy 自动入库 sys-*；网络/系统 TTS 用 rate/pitch 近似）。
 * 口令「换成××」与 LLM voice_set_tone 共用同一 id。
 */
export const VOICE_TIMBRE_PRESETS: VoiceTimbrePreset[] = [
  // —— 女声 ——
  {
    id: "female-loli",
    label: "萝莉",
    gender: "female",
    rate: 1.08,
    pitch: 1.35,
    oralStyle: "用偏幼龄、轻快的口吻说话，句子短、语气软。",
    cosyInstruct: "幼龄轻快，语气软",
    voiceHints: ["loli", "萝莉", "child", "girl", "female"],
    requiresCosy: true,
    autoSeed: true,
  },
  {
    id: "female-jiazi",
    label: "夹子音",
    gender: "female",
    rate: 1.12,
    pitch: 1.4,
    oralStyle:
      "夸张鼻音、软糯、句尾上扬；像活泼二次元口吻，句子短，信息仍要清楚。禁止在正文写「夹子音」等音色名称或舞台括号。",
    cosyInstruct: "夹子音，软糯句尾上扬",
    voiceHints: ["jiazi", "夹子", "夹子音", "nasal", "cute", "female"],
    requiresCosy: true,
    autoSeed: true,
  },
  {
    id: "female-girl",
    label: "少女",
    gender: "female",
    rate: 1.06,
    pitch: 1.22,
    oralStyle: "青春少女感、轻快亲切，不幼龄夸张。",
    cosyInstruct: "青春少女，轻快亲切",
    voiceHints: ["girl", "少女", "晓晓", "xiaoxiao", "female"],
    autoSeed: true,
  },
  {
    id: "female-sweet",
    label: "甜美",
    gender: "female",
    rate: 1.04,
    pitch: 1.18,
    oralStyle: "甜美亲切、礼貌热情，像前台接待，不矫揉造作。",
    cosyInstruct: "女声甜美亲切",
    voiceHints: ["sweet", "甜美", "甜美女声", "female"],
    autoSeed: true,
  },
  {
    id: "female-gentle",
    label: "温柔",
    gender: "female",
    rate: 0.98,
    pitch: 1.08,
    oralStyle: "温柔体贴、语气温和，像耐心陪伴的女声助手。",
    cosyInstruct: "温柔体贴，耐心温和",
    voiceHints: ["gentle", "温柔", "软软", "soft", "female", "晓妮", "xiaoni"],
    autoSeed: true,
  },
  {
    id: "female-soft",
    label: "软糯",
    gender: "female",
    rate: 0.96,
    pitch: 1.16,
    oralStyle: "软糯轻声、不急不躁，适合安慰与陪聊；勿夸张鼻音。",
    cosyInstruct: "女声软糯轻声",
    voiceHints: ["soft", "软糯", "轻声", "female"],
    requiresCosy: true,
    autoSeed: true,
  },
  {
    id: "female-mature",
    label: "御姐",
    gender: "female",
    rate: 0.95,
    pitch: 0.92,
    oralStyle: "用成熟、自信、略带压迫感的女声口吻，措辞干脆有力。",
    cosyInstruct: "成熟自信，干脆有力",
    voiceHints: ["mature", "御姐", "姐姐", "woman", "female"],
    autoSeed: true,
  },
  {
    id: "female-crisp",
    label: "干练",
    gender: "female",
    rate: 1.05,
    pitch: 1.02,
    oralStyle: "干练利落、信息优先，少寒暄，适合办公助理。",
    cosyInstruct: "女声干练利落",
    voiceHints: ["crisp", "干练", "利落", "助理", "female"],
    autoSeed: true,
  },
  {
    id: "female-announce",
    label: "女播音",
    gender: "female",
    rate: 1,
    pitch: 1.05,
    oralStyle: "平静清晰的女声播报感，适合信息朗读与通知。",
    cosyInstruct: "女声播报，平静清晰",
    voiceHints: ["calm", "女播音", "播音", "播报", "announce", "female", "慧慧"],
    autoSeed: true,
  },
  {
    id: "female-story",
    label: "讲述",
    gender: "female",
    rate: 0.94,
    pitch: 1.06,
    oralStyle: "讲故事口吻，节奏舒缓、画面感强，适合长文朗读。",
    cosyInstruct: "女声讲述，舒缓有画面",
    voiceHints: ["story", "讲述", "讲故事", "朗读", "female"],
    autoSeed: true,
  },
  {
    id: "female-news",
    label: "新闻",
    gender: "female",
    rate: 1.02,
    pitch: 1.0,
    oralStyle: "新闻主播感，吐字清楚、中性客观，少情绪起伏。",
    cosyInstruct: "女声新闻播报，吐字清楚",
    voiceHints: ["news", "新闻", "主播", "female"],
    autoSeed: true,
  },
  // —— 男声 ——
  {
    id: "male-youth",
    label: "少年",
    gender: "male",
    rate: 1.08,
    pitch: 1.18,
    oralStyle: "偏少年感、轻快男声，亲切不油腻。",
    cosyInstruct: "少年男声，轻快亲切",
    voiceHints: ["youth", "少年", "boy", "male"],
    autoSeed: true,
  },
  {
    id: "male-sunny",
    label: "阳光",
    gender: "male",
    rate: 1.08,
    pitch: 1.1,
    oralStyle: "阳光健谈、语气积极，像靠谱同事。",
    cosyInstruct: "阳光男声，积极",
    voiceHints: ["sunny", "阳光", "bright", "male", "云希"],
    autoSeed: true,
  },
  {
    id: "male-gentle",
    label: "温柔",
    gender: "male",
    rate: 0.98,
    pitch: 1.02,
    oralStyle: "温和男声，耐心解释，避免命令口吻。",
    cosyInstruct: "温和男声，耐心",
    voiceHints: ["gentle", "温柔", "温和", "soft", "male"],
    autoSeed: true,
  },
  {
    id: "male-steady",
    label: "沉稳",
    gender: "male",
    rate: 0.92,
    pitch: 0.88,
    oralStyle: "沉稳可靠的男声，语速偏慢、结论先行。",
    cosyInstruct: "沉稳男声，语速偏慢",
    voiceHints: ["steady", "沉稳", "稳重", "老年", "大叔", "deep", "male", "云扬"],
    autoSeed: true,
  },
  {
    id: "male-deep",
    label: "低沉",
    gender: "male",
    rate: 0.9,
    pitch: 0.82,
    oralStyle: "低沉有磁性的男声，节奏稳。",
    cosyInstruct: "低沉男声，节奏稳健",
    voiceHints: ["deep", "低沉", "低音", "男低音", "bass", "male", "云健"],
    autoSeed: true,
  },
  {
    id: "male-biz",
    label: "商务",
    gender: "male",
    rate: 0.98,
    pitch: 0.94,
    oralStyle: "商务汇报口吻，礼貌克制、条理清楚。",
    cosyInstruct: "男声商务汇报，条理清楚",
    voiceHints: ["biz", "商务", "职场", "汇报", "male"],
    autoSeed: true,
  },
  {
    id: "male-teacher",
    label: "老师",
    gender: "male",
    rate: 0.96,
    pitch: 0.96,
    oralStyle: "讲解老师口吻，分点说明、留停顿，适合教学。",
    cosyInstruct: "男声讲解，分点清楚",
    voiceHints: ["teacher", "老师", "讲解", "教学", "male"],
    autoSeed: true,
  },
  {
    id: "male-announce",
    label: "男播音",
    gender: "male",
    rate: 1,
    pitch: 0.98,
    oralStyle: "平静清晰的男声播报，信息优先。",
    cosyInstruct: "男声播报，平静清晰",
    voiceHints: ["calm", "男播音", "播音", "播报", "announce", "male"],
    autoSeed: true,
  },
  {
    id: "male-radio",
    label: "电台",
    gender: "male",
    rate: 0.97,
    pitch: 0.9,
    oralStyle: "电台主持感，略带磁性、节奏舒服，适合长播。",
    cosyInstruct: "男声电台主持，略带磁性",
    voiceHints: ["radio", "电台", "主持", "male"],
    autoSeed: true,
  },
  {
    id: "male-story",
    label: "说书",
    gender: "male",
    rate: 0.93,
    pitch: 0.92,
    oralStyle: "说书/评书感，抑扬有度，适合诗词与故事。",
    cosyInstruct: "男声说书，抑扬有度",
    voiceHints: ["story", "说书", "评书", "讲述", "male"],
    autoSeed: true,
  },
];

export const DEFAULT_TIMBRE_ID = "female-gentle";

export function getVoiceTimbrePreset(id?: string | null): VoiceTimbrePreset {
  return (
    VOICE_TIMBRE_PRESETS.find((p) => p.id === id) ??
    VOICE_TIMBRE_PRESETS.find((p) => p.id === DEFAULT_TIMBRE_ID)!
  );
}

export function listTimbresByGender(gender: VoiceGender): VoiceTimbrePreset[] {
  return VOICE_TIMBRE_PRESETS.filter((p) => p.gender === gender);
}

export function timbreRequiresCosy(id?: string | null): boolean {
  return Boolean(getVoiceTimbrePreset(id).requiresCosy);
}

export function systemVoiceDirId(timbreId: string): string {
  return `sys-${timbreId}`;
}

/** 注入 LLM / 工具说明用的一键音色目录（短）。 */
export function formatTimbreCatalogForLlm(): string {
  const line = (g: VoiceGender) =>
    VOICE_TIMBRE_PRESETS.filter((t) => t.gender === g)
      .map((t) => `${t.id}（${t.label}）`)
      .join("、");
  return `女声：${line("female")}；男声：${line("male")}`;
}
