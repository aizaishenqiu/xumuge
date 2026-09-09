/**
 * @file 从 LLM 回复中剥离 TTS_INSTRUCT 与表演括号，供展示/朗读与 Cosy Mode A
 * @author qiuye <yjk150@qq.com>
 * @date 2026-09-03
 * @updated 2026-09-07
 * @version 1.2.1
 * @category Parse
 * @algo line-tag-tts-instruct-split
 */

export const DEFAULT_TTS_INSTRUCT = "用正常平稳的语气说话";

export interface LlmTtsInstructParse {
  /** 给用户看 / 朗读的正文（已去掉 TTS_INSTRUCT 行与表演括号） */
  answerText: string;
  /** 完整中文语气指令；无有效标签时为 null（调用方 Mode B 兜底） */
  ttsInstruct: string | null;
}

const TAG_RE = /^\s*TTS_INSTRUCT\s*:\s*(.*)$/i;

/**
 * 明确舞台/情绪关键词（兜底）；主规则见 isOralStageDirectionInner 的「短括号默认剥离」。
 */
const STAGE_HINT_RE =
  /兴奋|拖音|拖腔|撒娇|叹气|小声|大声|轻声|停顿|哽咽|喘息|咬牙|升调|降调|上扬|压抑|无奈|得意|害羞|委屈|嗔|娇|戏腔|语气|情绪|哭腔|泣|卖萌|嘻嘻|呵呵|哈哈|嘿嘿|调皮|俏皮|嘟嘴|萌|开心|难过|生气|平静|严肃|温柔|激动|laugh|pause|excited|whisper|sigh|giggle|sob|cute|happy|sad|angry/i;

/** 短括注里像「说明/路径」时保留，不当舞台指示。 */
const FACTUAL_PAREN_RE =
  /见|设置|登录|页|路径|文件|目录|http|www|API|版本|章节|图\d|表\d|注：|备注|例如|比如|云登录|官网|地址/;

/** 流式末行可能是 TTS_INSTRUCT 的前缀，应对用户隐藏。 */
function isPartialTtsInstructPrefix(line: string): boolean {
  const t = line.trim();
  if (!t) return false;
  const upper = "TTS_INSTRUCT:";
  const candidate = t.toUpperCase();
  return upper.startsWith(candidate) || candidate.startsWith("TTS_INSTRUCT");
}

/**
 * 语音通话里模型常塞大量（卖萌）（歪头）（轻笑）等括注。
 * 规则：≤8 字短括号默认当舞台指示（除非像说明/路径）；9–12 字走关键词/拟声。
 */
function isOralStageDirectionInner(inner: string): boolean {
  const t = inner.trim();
  if (!t || t.length > 12) return false;
  if (FACTUAL_PAREN_RE.test(t)) return false;
  // 纯拟声 / 叠字表演
  if (/^(笑|哭|怒|叹|嗯|啊|哦|咳|哼|切|呜|哇|嘻|呵|哈|嘿|咦|欸|哎)+$/.test(t)) return true;
  if (STAGE_HINT_RE.test(t)) return true;
  // 短括号默认剥离：覆盖「很多内容」而不靠穷举词表
  if (t.length <= 8) return true;
  return false;
}

/**
 * Duty: 去掉正文里给合成看的表演括号；短括注默认剥离，说明类保留。
 * @returns text 给人看的正文；stageHints 抽给 TTS 的括号词
 */
export function stripOralStageDirectionsDetailed(text: string): {
  text: string;
  stageHints: string[];
} {
  const raw = String(text ?? "");
  if (!raw) return { text: "", stageHints: [] };

  const stageHints: string[] = [];
  let out = raw.replace(/[（(【]([^）)】]{1,12})[）)】]/g, (full, inner: string) => {
    if (!isOralStageDirectionInner(inner)) return full;
    const tip = String(inner).trim();
    if (tip) stageHints.push(tip);
    return "";
  });

  out = out
    .replace(/[ \t\u3000]{2,}/g, " ")
    .replace(/[ \t\u3000]+([，。！？；：、,.!?;:～~])/g, "$1")
    .replace(/([！？。!?])[ \t\u3000]+/g, "$1")
    .replace(/^[ \t\u3000]+|[ \t\u3000]+$/g, "")
    .trim();
  return { text: out, stageHints };
}

/**
 * Duty: 去掉正文里给合成看的表演括号。
 */
export function stripOralStageDirections(text: string): string {
  return stripOralStageDirectionsDetailed(text).text;
}

/** 误把 Cosy/心情 instruct 当正文朗读的整句（日志：用网络流行夹子音说话） */
const META_SPEAK_INSTRUCT_RE =
  /^(?:好[，,。]?)?(?:已?切到|换成)?(?:CosyVoice|系统语音|离线)?[，,]?(?:用)?(?:网络流行)?[「」]?[^。！？\n]{0,12}(?:夹子音|萝莉音)?[」]?(?:说话|语气说话|的语气说话|的语气说)(?:话)?[。.!！]?$/;

/**
 * Duty: 把「用××语气说话」压成短风格词，避免 Fun-CosyVoice3 instruct2 把整句念出。
 * CV2/3 有参考音时应传空串走 zero_shot（见 CosyFastapiProvider）；需 instruct2 时用 formatCv2Instruct2。
 */
export function compactCosyInstruct(raw: string): string {
  let t = String(raw ?? "").trim();
  if (!t) return "";
  t = t
    .replace(/^用/, "")
    .replace(/网络流行/g, "")
    .replace(/的?语气说话/g, "")
    .replace(/夹子音说话[：:]?/g, "夹子音")
    .replace(/说话(?=[，,、。.!！]|$)/g, "")
    .replace(/[：:]\s*/g, "，")
    .replace(/[。.!！]+$/g, "")
    .replace(/\s+/g, "")
    .replace(/，{2,}/g, "，")
    .replace(/^，|，$/g, "")
    .trim();
  if (!t || /^用.+说话/.test(t)) return "";
  if (t.length > 28) t = t.slice(0, 28);
  return t;
}

/**
 * Duty: CosyVoice2/3 instruct2 官方格式须带 <|endofprompt|>，否则易把 instruct 当正文念出。
 * Failure: 空风格 → 空串（调用方应改走 zero_shot）。
 */
export function formatCv2Instruct2(raw: string): string {
  const compact = compactCosyInstruct(raw);
  if (!compact) return "";
  if (compact.includes("<|endofprompt|>")) return compact;
  return `用${compact}说这句话<|endofprompt|>`;
}

/**
 * Duty: 去掉误念的「用××语气说话」类合成指令句（保留真正回答）。
 */
export function stripMetaSpeakInstructLines(text: string): {
  text: string;
  leakedInstruct: string | null;
} {
  const raw = String(text ?? "").trim();
  if (!raw) return { text: "", leakedInstruct: null };
  const lines = raw.split(/\r?\n/);
  const keptLines: string[] = [];
  let leaked: string | null = null;
  for (const line of lines) {
    const parts = line.split(/(?<=[。！？.!?])/);
    const kept: string[] = [];
    for (const part of parts) {
      const t = part.trim();
      if (!t) {
        if (part) kept.push(part);
        continue;
      }
      const compact = t.replace(/\s+/g, "");
      if (
        META_SPEAK_INSTRUCT_RE.test(compact) ||
        /^用[^。！？]{2,24}(?:语气说话|语气说|夹子音说话)/.test(compact)
      ) {
        leaked = (leaked ? `${leaked}；` : "") + compact.replace(/[。.!！]+$/, "");
        continue;
      }
      kept.push(part);
    }
    const joined = kept.join("").trimEnd();
    if (joined) keptLines.push(joined);
  }
  return { text: keptLines.join("\n").trim(), leakedInstruct: leaked };
}

/**
 * Duty: 分离回答正文与 Cosy 用的情绪 instruct；括号舞台词并入 instruct。
 */
export function parseLlmTtsInstruct(llmFullText: string): LlmTtsInstructParse {
  const raw = String(llmFullText ?? "");
  if (!raw.trim()) {
    return { answerText: "", ttsInstruct: null };
  }

  const lines = raw.split(/\r?\n/);
  const answerLines: string[] = [];
  let ttsInstruct: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const matched = line.match(TAG_RE);
    if (matched) {
      const body = (matched[1] ?? "").trim();
      if (body) {
        ttsInstruct = body;
      }
      continue;
    }
    if (i === lines.length - 1 && isPartialTtsInstructPrefix(line)) {
      continue;
    }
    answerLines.push(line);
  }

  const stripped = stripOralStageDirectionsDetailed(answerLines.join("\n").trim());
  const meta = stripMetaSpeakInstructLines(stripped.text);
  if (stripped.stageHints.length) {
    const hintLine = stripped.stageHints.slice(0, 8).join("、");
    ttsInstruct = ttsInstruct
      ? `${ttsInstruct}（语气：${hintLine}）`
      : `用带有「${hintLine}」感觉的语气说话`;
  }
  if (meta.leakedInstruct) {
    ttsInstruct = ttsInstruct || meta.leakedInstruct;
  }

  return {
    answerText: meta.text,
    ttsInstruct,
  };
}

/**
 * Duty: 仅取展示/朗读正文（丢弃标签与表演括号）。
 */
export function stripLlmTtsInstruct(llmFullText: string): string {
  return parseLlmTtsInstruct(llmFullText).answerText;
}
