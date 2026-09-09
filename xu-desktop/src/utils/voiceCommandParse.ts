/**
 * @file 语音通话口令：换音色 / 换心情 / 换声音（STT 本地解析，不经 LLM）
 * @author qiuye <yjk150@qq.com>
 * @date 2026-09-01
 * @updated 2026-09-07
 * @version 2.3.1
 * @category Parse
 * @algo voice-command-keyword-match
 */

import { invoke } from "@tauri-apps/api/core";
import { loadVoiceSettings, saveVoiceSettings } from "../stores/voiceSettings";
import { VOICE_MOOD_PRESETS, getVoiceMoodPreset } from "./voiceMoodPresets";
import {
  VOICE_TIMBRE_PRESETS,
  getVoiceTimbrePreset,
  systemVoiceDirId,
  timbreRequiresCosy,
} from "./voiceTimbrePresets";
import { resolveProsody } from "./voiceToneEngineMap";
import { KOKORO_VOICE_OPTIONS, kokoroVoiceGender, resolveKokoroVoiceId } from "./kokoroVoiceMap";
import { COSY_FASTAPI_BUILTIN_SPK, defaultCosyBuiltinSpkId } from "./cosyFastapiVoices";
import { fetchVoiceEngineStatus } from "./voiceEngineCapability";
import { saveVoiceSessionOverride } from "./voiceSessionOverride";

export type VoiceCommandResult =
  | { kind: "timbre"; timbreId: string; label: string; confirm: string; needCosy?: boolean }
  | { kind: "mood"; moodId: string; label: string; confirm: string; needCosy?: boolean }
  | { kind: "tone"; toneId: string; label: string; confirm: string; needCosy?: boolean }
  | { kind: "voice"; voiceId: string; label: string; confirm: string }
  | { kind: "provider"; provider: "system-webspeech" | "sherpa-onnx" | "cosyvoice"; label: string; confirm: string }
  | { kind: "cosyStart"; confirm: string }
  | null;

function normalizeCmd(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[，。！？、,.!?;；:：'"“”‘’\s]/g, "")
    .replace(/while/g, "")
    .replace(/coswhy/g, "cosy")
    .replace(/cosy/g, "cosy")
    .replace(/cos(?![a-z])/g, "cosy")
    .replace(/wells/g, "");
}

function looksLikeSwitchTimbre(raw: string): boolean {
  return /换音色|换成|切换音色|切换到|用.{1,8}说话|音色换成|改成|改为/.test(raw);
}

function looksLikeSwitchMood(raw: string): boolean {
  return /换心情|心情|开心点|难过点|生气点|卖萌|玩笑|兴奋点|平静点|悲伤/.test(raw);
}

function looksLikeSwitchVoice(raw: string): boolean {
  return /换声音|声音换成|用.{1,12}(声音|声)/.test(raw);
}

function matchTimbre(normalized: string): { id: string; label: string } | null {
  // 证据 voice-ux17：男声低音/男生低音 被「切换男声」通配抢成 male-youth
  if (/男低音|男生低音|男声低音|低音男|低沉男|男声低沉|男低沉|男声低沉/.test(normalized)) {
    return { id: "male-deep", label: "低沉" };
  }
  if (/老年|老头|大叔|长辈|年长/.test(normalized) && /男|声/.test(normalized)) {
    return { id: "male-steady", label: "沉稳" };
  }
  // 证据 voice-ux14：男播音/男播音员 → 误命中 female-announce
  if (/男播音|男声播音|男生播音|男播音员/.test(normalized)) {
    return { id: "male-announce", label: "男播音" };
  }
  if (/女播音|女声播音|女生播音|女播音员/.test(normalized)) {
    return { id: "female-announce", label: "女播音" };
  }
  const wantMale =
    /男声|男生|男的|用男|换成男|切换男/.test(normalized) ||
    (/男/.test(normalized) && !/女/.test(normalized));
  const wantFemale =
    /女声|女生|女的|用女|换成女|切换女|萝莉|御姐|少女|夹子/.test(normalized) ||
    (/女/.test(normalized) && !/男/.test(normalized));
  const preferMale =
    wantMale ||
    (/不(要|让|用).{0,12}女/.test(normalized) && /男/.test(normalized));
  const preferFemale =
    !preferMale &&
    (wantFemale ||
      (/不(要|让|用).{0,12}男/.test(normalized) && /女/.test(normalized)));
  const pool = preferMale
    ? VOICE_TIMBRE_PRESETS.filter((t) => t.gender === "male")
    : preferFemale
      ? VOICE_TIMBRE_PRESETS.filter((t) => t.gender === "female")
      : VOICE_TIMBRE_PRESETS;
  const sorted = [...pool].sort((a, b) => b.label.length - a.label.length);
  for (const t of sorted) {
    const label = t.label.toLowerCase();
    if (normalized.includes(label) || normalized.includes(t.id.toLowerCase())) {
      return { id: t.id, label: t.label };
    }
    for (const h of t.voiceHints || []) {
      const hint = String(h).toLowerCase();
      if (hint.length >= 2 && normalized.includes(hint)) {
        return { id: t.id, label: t.label };
      }
    }
  }
  for (const t of sorted) {
    const g = t.gender === "female" ? "女" : "男";
    if (normalized.includes(`${g}${t.label}`) || normalized.includes(`${t.label}${g}`)) {
      return { id: t.id, label: t.label };
    }
  }
  return null;
}

/** 复合「用某某音播放…」：先落音色再送 LLM（日志：跳过命令后音色仍 male-youth） */
function applyTimbreSideEffectSync(timbreId: string): void {
  const cur = loadVoiceSettings();
  const timbre = getVoiceTimbrePreset(timbreId);
  const prosody = resolveProsody(timbre.id, cur.moodId || "calm");
  saveVoiceSettings({
    ...cur,
    timbreId: timbre.id,
    toneId: timbre.id,
    voiceGender: timbre.gender,
    rate: prosody.rate,
    pitch: prosody.pitch,
    voice: systemVoiceDirId(timbre.id),
  });
  saveVoiceSessionOverride({ llmTtsInstruct: "" });
}

function matchMood(normalized: string): { id: string; label: string } | null {
  const sorted = [...VOICE_MOOD_PRESETS].sort((a, b) => b.label.length - a.label.length);
  for (const m of sorted) {
    if (normalized.includes(m.label.toLowerCase()) || normalized.includes(m.id.toLowerCase())) {
      return { id: m.id, label: m.label };
    }
  }
  if (/开心点|高兴/.test(normalized)) return { id: "happy", label: "开心" };
  if (/难过点|伤心/.test(normalized)) return { id: "sad", label: "难过" };
  if (/生气点|愤怒/.test(normalized)) return { id: "angry", label: "生气" };
  if (/兴奋点/.test(normalized)) return { id: "excited", label: "兴奋" };
  if (/平静点|冷静/.test(normalized)) return { id: "calm", label: "平静" };
  return null;
}

function matchVoice(normalized: string): { id: string; label: string } | null {
  for (const v of KOKORO_VOICE_OPTIONS) {
    const short = v.label.split("·")[0] || v.label;
    if (
      normalized.includes(v.id.toLowerCase()) ||
      normalized.includes(v.label.toLowerCase().replace(/[·（）()]/g, "")) ||
      normalized.includes(short)
    ) {
      return { id: v.id, label: v.label };
    }
  }
  for (const s of COSY_FASTAPI_BUILTIN_SPK) {
    if (normalized.includes(s.id) || normalized.includes(s.name)) {
      return { id: s.id, label: s.name };
    }
  }
  return null;
}

function cosyMoodAllowed(provider: string, apiSupportsMood: boolean, cosyBackend: string): boolean {
  if (provider === "cosyvoice" && cosyBackend === "fastapi") return true;
  if (provider === "cosyvoice" && apiSupportsMood) return true;
  return false;
}

/**
 * 解析「换音色 / 换心情 / 换声音」口令；未命中返回 null。
 * 命中时调用方应播确认语并 resumeListen，勿送 LLM。
 */
export function parseVoiceCommand(text: string): VoiceCommandResult {
  const raw = text.trim();
  if (!raw || raw.length > 120) return null;
  const n = normalizeCmd(raw);
  if (!n) return null;
  const cur = loadVoiceSettings();
  const moodOk = cosyMoodAllowed(cur.provider, cur.apiSupportsMood !== false, cur.cosyBackend);

  // 复合内容任务：可先落音色，再送 LLM 背/播（勿整句吞成换音色）
  const contentTask =
    /帮我(读|背|讲|写|唱|查|搜|做|念|播放)|请(你)?(读|背|讲|念|播放)|背诵|朗读|讲个笑话|念一?遍|播报.{2,}|播放.{2,}|给我(听|读|背)|听一?听|来(读|背|念|播放)|读完整|读一?遍|背一?遍/.test(
      raw,
    );
  if (contentTask) {
    const sideTimbre = matchTimbre(n);
    if (sideTimbre) {
      applyTimbreSideEffectSync(sideTimbre.id);
    }
    return null;
  }

  // 启动 Cosy（ASR 常听成 while cos / cos y）
  if (
    /启动.*(cosy|cos|科西|fastapi)|打开.*(cosy|科西)|开启.*(cosy|科西)/i.test(raw) ||
    /启动cosy|启动科西/.test(n)
  ) {
    return {
      kind: "cosyStart",
      confirm: "好，正在启动 CosyVoice，稍等模型加载。",
    };
  }

  // 切换朗读引擎（系统 / 离线 / Cosy）
  if (
    /切换(到|成|为)?(系统语音|系统朗读|系统tts)|用系统语音|改成系统语音|语音模式.*(系统)/i.test(
      raw,
    ) ||
    /切换语音模式.*(系统)|语音引擎.*(系统)/.test(raw)
  ) {
    return {
      kind: "provider",
      provider: "system-webspeech",
      label: "系统语音",
      confirm: "好，已切换到系统语音。",
    };
  }
  if (
    /切换(到|成|为)?(离线|kokoro|sherpa)|用离线语音|改成离线|语音模式.*(离线|kokoro)/i.test(
      raw,
    )
  ) {
    return {
      kind: "provider",
      provider: "sherpa-onnx",
      label: "离线语音",
      confirm: "好，已切换到离线语音；若模型未装好，请到设置安装。",
    };
  }
  if (
    /切换(到|成|为)?\s*cos(y|yvoice)?|用\s*cosy|改成\s*cosy|语音模式.*(cosy|cos|科西)|切换语音引擎|科西/i.test(
      raw,
    ) ||
    (/切换语音模式/.test(raw) && /cosy|cos|科西|扩展/.test(n))
  ) {
    const mood = matchMood(n);
    if (mood) {
      return {
        kind: "mood",
        moodId: mood.id,
        label: mood.label,
        needCosy: true,
        confirm: `好，已切到 CosyVoice，心情换成${mood.label}。`,
      };
    }
    return {
      kind: "provider",
      provider: "cosyvoice",
      label: "CosyVoice",
      confirm: "好，已切换到 CosyVoice；未启动服务时正文可能暂用系统音。",
    };
  }
  // 「切换语音模式」单独说：引导到 Cosy（心情/戏剧音色需要）
  if (/^切换语音模式$|切换语音模式$|换语音模式|改语音模式/.test(n) && !/卖萌|开心|难过|生气|萝莉|御姐/.test(n)) {
    return {
      kind: "provider",
      provider: "cosyvoice",
      label: "CosyVoice",
      confirm: "好，已切到 CosyVoice。可以说「切换为卖萌」或「换成御姐」改心情音色。",
    };
  }

  // 具体音色优先于「换成男声」通配；须有切换意图（日志：抱怨「怎么是男低音」勿当口令）
  {
    const specific = matchTimbre(n);
    const switchIntent = /切换|换成|改成|改为|用/.test(n);
    const complaint = /明明|怎么是|不是|为什么|错误|切换不了/.test(n);
    if (specific && complaint) {
    } else if (
      specific &&
      switchIntent &&
      !complaint &&
      /低音|低沉|播音|老年|老头|大叔|电台|商务|说书|老师|沉稳|少年|阳光|萝莉|御姐|夹子|甜美|干练|新闻|讲述|软糯|温柔|成熟/.test(
        n,
      )
    ) {
      const needCosy =
        timbreRequiresCosy(specific.id) && cur.provider !== "cosyvoice";
      return {
        kind: "timbre",
        timbreId: specific.id,
        label: specific.label,
        needCosy: needCosy || undefined,
        confirm: needCosy
          ? `好，换成${specific.label}。需要 CosyVoice，正在切到 Cosy。`
          : `好，换成${specific.label}啦。`,
      };
    }
  }

  // 换成男声 / 女声（仅无更具体后缀时；男声低音已在上方命中）
  if (
    /(?:换成|切换到?|用|改成)男声(?!低音|播音|老年|沉稳|商务|电台|说书|老师|少年|阳光)/.test(
      raw,
    ) ||
    /(?:换成|切换到?|用|改成)男生(?!低音|播音|老年)/.test(raw)
  ) {
    if (cur.provider === "sherpa-onnx") {
      return {
        kind: "voice",
        voiceId: "zm_yunjian",
        label: "云健·男",
        confirm: "好，换成男声云健啦。",
      };
    }
    if (cur.provider === "system-webspeech") {
      return {
        kind: "timbre",
        timbreId: "male-announce",
        label: "男声",
        confirm: "好，试试系统男声；若本机没有男声包，请到设置里改离线或 Cosy。",
        needCosy: false,
      };
    }
    // 默认男声用沉稳，避免与「少年」默认混淆
    return {
      kind: "timbre",
      timbreId: "male-steady",
      label: "沉稳",
      confirm: "好，换成男声（沉稳）啦。",
    };
  }
  if (
    /(?:换成|切换到?|用|改成)女声(?!播音|萝莉|御姐|夹子|甜美|干练|新闻|讲述|软糯)/.test(
      raw,
    ) ||
    /(?:换成|切换到?|用|改成)女生(?!播音)/.test(raw)
  ) {
    if (cur.provider === "sherpa-onnx") {
      return {
        kind: "voice",
        voiceId: "zf_xiaoxiao",
        label: "晓晓·女（御姐）",
        confirm: "好，换成女声晓晓啦。",
      };
    }
    if (cur.provider === "system-webspeech") {
      return {
        kind: "timbre",
        timbreId: "female-announce",
        label: "女声",
        confirm: "好，用系统女声。",
      };
    }
    return {
      kind: "timbre",
      timbreId: "female-gentle",
      label: "温柔",
      confirm: "好，换成女声（温柔）啦。",
    };
  }

  const wantMood = looksLikeSwitchMood(raw) || /心情|语气/.test(raw);
  const wantTimbre =
    looksLikeSwitchTimbre(raw) || /音色|萝莉|御姐|夹子|少女|少年|沉稳|低沉|低音|播音|男低音/.test(raw);
  const wantVoice = looksLikeSwitchVoice(raw) || /声音|晓晓|晓妮|云健|云希|中文女|中文男/.test(raw);

  if (wantMood && !/换成萝莉|换成御姐|换成夹子|换成少女|换成少年/.test(raw)) {
    const mood = matchMood(n);
    if (mood) {
      if (!moodOk) {
        return {
          kind: "mood",
          moodId: mood.id,
          label: mood.label,
          needCosy: true,
          confirm: `好，心情换成${mood.label}，并已切到 CosyVoice。若服务未热，请到设置启动 Cosy。`,
        };
      }
      return {
        kind: "mood",
        moodId: mood.id,
        label: mood.label,
        confirm: `好，心情换成${mood.label}啦。`,
      };
    }
  }

  if (wantTimbre || (!wantVoice && /换成|切换|用/.test(raw))) {
    const timbre = matchTimbre(n);
    if (
      timbre &&
      (wantTimbre || /音色|说话|萝莉|御姐|夹子|少女|少年|沉稳|温柔|低沉|阳光|播音/.test(raw))
    ) {
      const needCosy =
        timbreRequiresCosy(timbre.id) &&
        cur.provider !== "cosyvoice";
      const gender = getVoiceTimbrePreset(timbre.id).gender === "female" ? "女" : "男";
      if (needCosy) {
        return {
          kind: "timbre",
          timbreId: timbre.id,
          label: timbre.label,
          needCosy: true,
          confirm: `好，换成${timbre.label}。需要 CosyVoice，正在切到 Cosy。`,
        };
      }
      if (cur.provider === "sherpa-onnx" && timbreRequiresCosy(timbre.id) === false) {
        // 非戏剧音色：映射到 Kokoro 近似声
        return {
          kind: "timbre",
          timbreId: timbre.id,
          label: timbre.label,
          confirm: `好，换成${gender}声${timbre.label}啦。`,
        };
      }
      return {
        kind: "timbre",
        timbreId: timbre.id,
        label: timbre.label,
        confirm: `好，换成${gender}声${timbre.label}啦。`,
      };
    }
  }

  if (wantVoice) {
    const voice = matchVoice(n);
    if (voice) {
      return {
        kind: "voice",
        voiceId: voice.id,
        label: voice.label,
        confirm: `好，声音换成${voice.label}了。`,
      };
    }
  }

  return null;
}

/**
 * 应用口令到持久设置，并尽量通知 Rust 路由（失败不抛）。
 * needCosy 口令：尽量切到 CosyVoice；未就绪时仍记下偏好并保留提示。
 */
export async function applyVoiceCommand(cmd: Exclude<VoiceCommandResult, null>): Promise<void> {
  const cur = loadVoiceSettings();
  if (cmd.kind === "cosyStart") {
    const { forceStartCosyForVoice } = await import("./cosyAutostart");
    const r = await forceStartCosyForVoice();
    if (!r.running) {
      const { fouAlert } = await import("foucui");
      void fouAlert(r.message || "Cosy 未能启动，请到设置检查路径。", "启动 Cosy");
    }
    return;
  }
  if (cmd.kind === "provider") {
    if (cmd.provider === "cosyvoice") {
      saveVoiceSettings({
        ...cur,
        provider: "cosyvoice",
        cosyWantRunning: true,
      });
      const { forceStartCosyForVoice } = await import("./cosyAutostart");
      const r = await forceStartCosyForVoice();
      if (!r.running) {
        const { fouAlert } = await import("foucui");
        void fouAlert(
          r.message || "Cosy 未能启动。请到设置 → Cosy 检查 Python/模型路径并点启动。",
          "启动 Cosy",
        );
      }
      return;
    }
    if (cmd.provider === "system-webspeech") {
      const prosody = resolveProsody(
        cur.timbreId || "female-gentle",
        cur.moodId || "calm",
      );
      saveVoiceSettings({
        ...cur,
        provider: "system-webspeech",
        packId: "",
        rate: prosody.rate,
        pitch: prosody.pitch,
      });
      return;
    }
    if (cmd.provider === "sherpa-onnx") {
      saveVoiceSettings({
        ...cur,
        provider: "sherpa-onnx",
        packId: cur.packId || "native",
      });
      return;
    }
    return;
  }
  if (cmd.kind === "mood") {
    if (cmd.needCosy) {
      const mood = getVoiceMoodPreset(cmd.moodId);
      const prosody = resolveProsody(cur.timbreId || cur.toneId, mood.id);
      saveVoiceSettings({
        ...cur,
        provider: "cosyvoice",
        moodId: mood.id,
        cosyWantRunning: true,
        rate: prosody.rate,
        pitch: prosody.pitch,
      });
      saveVoiceSessionOverride({ llmTtsInstruct: "" });
      const { forceStartCosyForVoice } = await import("./cosyAutostart");
      const r = await forceStartCosyForVoice();
      if (!r.running) {
        const { fouAlert } = await import("foucui");
        void fouAlert(
          r.message || "心情已保存，但 Cosy 未启动。请到设置启动服务后再听音色变化。",
          "启动 Cosy",
        );
      }
      return;
    }
    const mood = getVoiceMoodPreset(cmd.moodId);
    const prosody = resolveProsody(cur.timbreId || cur.toneId, mood.id);
    saveVoiceSettings({
      ...cur,
      moodId: mood.id,
      rate: prosody.rate,
      pitch: prosody.pitch,
    });
    saveVoiceSessionOverride({ llmTtsInstruct: "" });
    return;
  }
  if (cmd.kind === "timbre" || cmd.kind === "tone") {
    const timbreId = cmd.kind === "timbre" ? cmd.timbreId : cmd.toneId;
    const timbre = getVoiceTimbrePreset(timbreId);
    const prosody = resolveProsody(timbre.id, cur.moodId);
    if (cmd.needCosy) {
      const cosyUrl =
        cur.cosyBackend === "fastapi" ? cur.cosyFastapiBaseUrl : cur.cosyCustomBaseUrl;
      const st = await fetchVoiceEngineStatus("cosyvoice", {
        cosyBackend: cur.cosyBackend,
        cosyCustomBaseUrl: cosyUrl,
      }).catch(() => null);
      saveVoiceSettings({
        ...cur,
        provider: "cosyvoice",
        timbreId: timbre.id,
        toneId: timbre.id,
        voiceGender: timbre.gender,
        voice: systemVoiceDirId(timbre.id),
        cosyFastapiSpkId: defaultCosyBuiltinSpkId(timbre.gender),
        rate: prosody.rate,
        pitch: prosody.pitch,
      });
      saveVoiceSessionOverride({ toneId: timbre.id, llmTtsInstruct: "" });
      if (!st?.synthesisAvailable) {
        // 确认语已说「切到 Cosy」；未就绪时再弹系统提示由通话 onNotice/设置承担
        try {
          await invoke("xu_voice_set_tone", { toneId: timbre.id });
        } catch {
          /* ignore */
        }
      }
      return;
    }
    if (cur.provider === "system-webspeech") {
      saveVoiceSettings({
        ...cur,
        voiceGender: timbre.gender,
        timbreId: timbre.id,
        toneId: timbre.id,
      });
      return;
    }
    if (cur.provider === "sherpa-onnx") {
      saveVoiceSettings({
        ...cur,
        voiceGender: timbre.gender,
        timbreId: timbre.id,
        toneId: timbre.id,
        rate: prosody.rate,
        pitch: prosody.pitch,
      });
      return;
    }
    saveVoiceSettings({
      ...cur,
      voice: systemVoiceDirId(timbre.id),
      timbreId: timbre.id,
      toneId: timbre.id,
      voiceGender: timbre.gender,
      rate: prosody.rate,
      pitch: prosody.pitch,
    });
    try {
      await invoke("xu_voice_set_tone", { toneId: timbre.id });
    } catch {
      /* ignore */
    }
    return;
  }
  const isKokoro = cmd.voiceId.startsWith("zf_") || cmd.voiceId.startsWith("zm_");
  const isBuiltinSpk = COSY_FASTAPI_BUILTIN_SPK.some((s) => s.id === cmd.voiceId);
  if (isKokoro) {
    const id = resolveKokoroVoiceId(cmd.voiceId);
    saveVoiceSettings({
      ...cur,
      voice: id,
      voiceGender: kokoroVoiceGender(id),
      ...(cur.provider === "sherpa-onnx" ? {} : {}),
    });
    return;
  }
  saveVoiceSettings({
    ...cur,
    voice: cmd.voiceId,
    ...(isBuiltinSpk ? { cosyFastapiSpkId: cmd.voiceId } : {}),
  });
}
