/**
 * @file Kokoro 包内音色目录（与 Cosy 戏剧语气分离）
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-31
 * @updated 2026-09-02
 * @version 1.5.0
 * @category Config
 * @algo kokoro-voice-id-table
 */

import type { VoiceGender } from "./voiceTimbrePresets";

/** 离线包常用中文音色（voices-v1.0.bin 内真实 zf_/zm_*，禁止臆造 id）。 */
export interface KokoroVoiceOption {
  id: string;
  label: string;
}

/**
 * 与 thewh1teagle kokoro-onnx voices-v1.0.bin 中文条目对齐。
 * 注意：无 zf_yanyan；温柔女声是 zf_xiaobei。
 */
export const KOKORO_VOICE_OPTIONS: KokoroVoiceOption[] = [
  { id: "zf_xiaoxiao", label: "晓晓·女（御姐）" },
  // 训练数据少（官方 D 档），听感偏软/南腔，并非二次元萝莉；真萝莉请用 Cosy
  { id: "zf_xiaoni", label: "晓妮·女（偏软）" },
  { id: "zf_xiaobei", label: "晓北·女（温柔）" },
  { id: "zf_xiaoyi", label: "晓伊·女（较清晰）" },
  // voices.bin 里 id 虽是 zm_，但风格向量贴近女声（≈晓晓）；Azure「云夏」亦为女童声
  { id: "zm_yunxia", label: "云夏·女（童声）" },
  { id: "zm_yunjian", label: "云健·男" },
  { id: "zm_yunxi", label: "云希·男" },
  { id: "zm_yunyang", label: "云扬·男" },
];

/** voices-v1.0.bin 已确认存在的中文 id。 */
const KOKORO_ZH_VOICE_IDS = new Set(KOKORO_VOICE_OPTIONS.map((v) => v.id));

/** 产品语气 id → Kokoro voice_id（仅兼容旧配置）。 */
const TONE_TO_KOKORO: Record<string, string> = {
  "female-jiazi": "zf_xiaoni",
  "female-loli": "zf_xiaoni",
  "female-mature": "zf_xiaoxiao",
  "female-gentle": "zf_xiaobei",
  "female-cute": "zf_xiaoni",
  "female-angry": "zf_xiaoxiao",
  "female-happy": "zf_xiaoni",
  "female-sunny": "zf_xiaoni",
  "female-joke": "zf_xiaoni",
  "female-sad": "zf_xiaobei",
  "female-calm": "zf_xiaobei",
  "male-calm": "zm_yunjian",
  "male-sunny": "zm_yunxi",
  "male-youth": "zm_yunxi",
  "male-gentle": "zm_yunyang",
  "male-steady": "zm_yunyang",
  "male-deep": "zm_yunjian",
  "male-biz": "zm_yunyang",
  "male-teacher": "zm_yunyang",
  "male-announce": "zm_yunjian",
  "male-radio": "zm_yunjian",
  "male-story": "zm_yunyang",
};

/** 旧数字 sid → voice_id。 */
const SID_TO_NAME: Record<string, string> = {
  "3": "zf_xiaoxiao",
  "11": "zf_xiaoni",
  "14": "zf_xiaobei",
  "21": "zf_xiaoyi",
  "58": "zm_yunjian",
  "59": "zm_yunxi",
};

/** 别名 / 历史错误 id → 真 id。 */
const NAME_ALIASES: Record<string, string> = {
  zf_yanyan: "zf_xiaobei",
  zf_001: "zf_xiaoxiao",
  zf_017: "zf_xiaoni",
  zf_021: "zf_xiaobei",
  zf_032: "zf_xiaoyi",
  zm_009: "zm_yunjian",
  zm_010: "zm_yunxi",
};

/** 戏剧向语气（须 CosyVoice）；Kokoro 不展示这些选项。 */
export const KOKORO_DRAMA_TONE_IDS = new Set([
  "female-jiazi",
  "female-angry",
  "female-cute",
  "female-joke",
]);

/**
 * 将语气预设或已选 voice 解析为 Kokoro voice_id（如 zf_xiaoxiao）。
 * 未知中文 id 回退晓晓，避免向引擎传入不存在的名字。
 */
export function resolveKokoroVoiceId(toneOrVoice: string | null | undefined): string {
  const raw = (toneOrVoice || "").trim();
  if (!raw) return "zf_xiaoxiao";
  if (/^\d+$/.test(raw)) return SID_TO_NAME[raw] ?? "zf_xiaoxiao";
  const lower = raw.toLowerCase();
  if (NAME_ALIASES[raw] || NAME_ALIASES[lower]) {
    return NAME_ALIASES[raw] ?? NAME_ALIASES[lower];
  }
  if (TONE_TO_KOKORO[raw]) return TONE_TO_KOKORO[raw];
  if (raw.startsWith("zf_") || raw.startsWith("zm_")) {
    return KOKORO_ZH_VOICE_IDS.has(raw) || KOKORO_ZH_VOICE_IDS.has(lower)
      ? (KOKORO_ZH_VOICE_IDS.has(raw) ? raw : lower)
      : NAME_ALIASES[raw] ?? "zf_xiaoxiao";
  }
  if (raw.startsWith("af_") || raw.startsWith("am_") || raw.startsWith("bf_")) {
    return raw;
  }
  return TONE_TO_KOKORO[raw] ?? "zf_xiaoxiao";
}

/** 是否为 Kokoro 原生 voice id。 */
export function isKokoroVoiceId(id: string | null | undefined): boolean {
  const raw = (id || "").trim().toLowerCase();
  return raw.startsWith("zf_") || raw.startsWith("zm_") || raw.startsWith("af_");
}

/**
 * Kokoro voice 性别：zm_yunxia 听感为女童；其余 zm_ 为男，zf_ 为女。
 */
export function kokoroVoiceGender(id: string | null | undefined): VoiceGender {
  const resolved = resolveKokoroVoiceId(id);
  if (resolved === "zm_yunxia") return "female";
  if (resolved.startsWith("zm_")) return "male";
  return "female";
}

/** 离线设置页音色列表：默认用包内真实中文表；manifest 有声明则求交。 */
export function listKokoroVoicesForUi(
  packVoices?: Array<{ id: string; name?: string }> | null,
): KokoroVoiceOption[] {
  const fromPack = (packVoices || [])
    .map((v) => {
      const id = resolveKokoroVoiceId(v.id);
      if (!KOKORO_ZH_VOICE_IDS.has(id) && !id.startsWith("af_")) return null;
      const known = KOKORO_VOICE_OPTIONS.find((k) => k.id === id);
      return {
        id,
        label: known?.label || v.name || id,
      } satisfies KokoroVoiceOption;
    })
    .filter((x): x is KokoroVoiceOption => !!x);
  if (fromPack.length > 0) {
    const seen = new Set<string>();
    return fromPack.filter((v) => {
      if (seen.has(v.id)) return false;
      seen.add(v.id);
      return true;
    });
  }
  return KOKORO_VOICE_OPTIONS.slice();
}

/** 按性别过滤 Kokoro 表（离线页主选）。 */
export function listKokoroVoicesByGender(
  gender: VoiceGender,
  packVoices?: Array<{ id: string; name?: string }> | null,
): KokoroVoiceOption[] {
  return listKokoroVoicesForUi(packVoices).filter((v) => kokoroVoiceGender(v.id) === gender);
}

/** Kokoro 是否无法忠实表达该戏剧语气（仅能换近似音色）。 */
export function kokoroLacksDramaInstruct(toneId: string | null | undefined): boolean {
  if (!toneId) return false;
  return KOKORO_DRAMA_TONE_IDS.has(toneId);
}

/** 设置页旁注。 */
export const KOKORO_TONE_BLURB =
  "离线 Kokoro 只有近似普通话音色（数据少，可能带软腔/南腔），不是二次元萝莉/夹子音。要萝莉戏请选 CosyVoice。";
