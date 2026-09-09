/**
 * @file 全局助手说话语气（LLM system 注入，与 MCP 工具训练分离）
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-31
 * @updated 2026-09-07
 * @version 1.7.0
 * @category Config
 * @algo global-oral-persona-block
 */

import { loadVoiceSettings, type CosyBackendId } from "../stores/voiceSettings";
import { personaTrainingHintForTone } from "../training/personaTraining";
import { getVoiceMoodPreset, formatMoodCatalogForLlm } from "./voiceMoodPresets";
import { getVoiceTimbrePreset, formatTimbreCatalogForLlm } from "./voiceTimbrePresets";
import { getVoiceTonePreset } from "./voiceTonePresets";

/**
 * 读取当前持久化语气 preset 的 oralStyle 文案。
 * 依赖 localStorage voiceSettings；无浏览器环境时回退默认平静女声。
 */
export function getAssistantOralStyle(toneId?: string | null): string {
  const id = toneId ?? loadVoiceSettings().toneId;
  return getVoiceTonePreset(id).oralStyle;
}

/** @deprecated 使用 getAssistantOralStyle */
export function getVoiceToneOralStyle(): string {
  return getAssistantOralStyle();
}

/**
 * Duty: 文字对话（非语音）样式约束；不注入口语人设/语音衔接。
 */
export function buildTextChatStyleBlock(): string {
  return (
    "\n\n【文字对话·必遵】简洁直接，像专业助手。" +
    "禁止颜文字、表情符号堆砌；禁止括号舞台指示，如 (歪着头看您) (笑) (超兴奋) （拖音） 等。" +
    "口语人设、TTS_INSTRUCT、语音衔接仅用于语音通话，文字对话不要输出。"
  );
}

/**
 * Duty: 剥离文字回复中的舞台括号与常见颜文字（仅非语音展示/落盘用）。
 */
export function stripTextChatStageDirections(text: string): string {
  let s = (text || "").trim();
  if (!s) return s;
  // 半角/全角短表演括号：含中文舞台词
  s = s.replace(
    /[（(][^）)\n]{0,28}(?:歪着头|看您|笑|超兴奋|拖音|小声|眨眼|挥手|点头|鞠躬|叹气|哭泣|脸红|撒娇|哼|嘟嘴|摸摸头)[^）)\n]{0,16}[）)]/g,
    "",
  );
  // 颜文字 / 符号括号：(^ - ^) (*≧ω≦) 等
  s = s.replace(
    /[（(][^）)\n]{0,6}[\^▽≧≦ωﾟ´`·•★☆♪～~_\-<>\/\\|=\*✧✨✿◕●○□■][^）)\n]{0,20}[）)]/g,
    "",
  );
  // 行首孤立短颜文字块
  s = s.replace(/(?:^|\n)\s*[（(][\^_\-~★☆♪✧\s]{1,12}[）)]\s*/g, "\n");
  s = s.replace(/[ \t]{2,}/g, " ");
  s = s.replace(/\n{3,}/g, "\n\n");
  return s.trim();
}

/**
 * 构建可追加到 system prompt 的语气块；空 oralStyle 时返回空串。
 * 仅供语音通话路径使用；文字对话请用 buildTextChatStyleBlock。
 */
export function buildOralPersonaBlock(toneId?: string | null): string {
  const id = toneId ?? loadVoiceSettings().toneId;
  const oral = getAssistantOralStyle(id).trim();
  if (!oral) return "";
  let block = `\n\n【说话语气】${oral}`;
  block +=
    "\n【语音衔接】思考阶段不播垫话；正文直接给答案或先用一句同人设过渡再答；勿长时间沉默式开场。男女语气文案须符合当前性别人设，勿混用。";
  block += personaTrainingHintForTone(id);
  return block;
}

function apiSupportsMood(backend: CosyBackendId, flag?: boolean): boolean {
  if (typeof flag === "boolean") return flag;
  return backend === "dashscope";
}

/**
 * Duty: 仅语音通话注入的强化人设块（性别/音色固定；文字贴合心情；Mode A 要求 TTS_INSTRUCT）。
 * 依赖: loadVoiceSettings；不走 MCP；不把 spk_id 交给模型决定。
 * 失败: 返回空串（调用方可忽略）。
 */
export function buildVoiceCallPersonaBlock(): string {
  const s = loadVoiceSettings();
  const timbre = getVoiceTimbrePreset(s.timbreId || s.toneId);
  const genderLabel = (s.voiceGender || timbre.gender) === "male" ? "男" : "女";
  const timbreLabel = timbre.label || s.timbreId || "默认";
  const packLine = s.packId?.trim() ? s.packId.trim() : "无";
  const oral = getVoiceTonePreset(s.timbreId || s.toneId).oralStyle.trim();
  const moodPreset = getVoiceMoodPreset(s.moodId);
  const moodLabel = moodPreset.label || "平静";

  const isCosyLocal =
    s.provider === "cosyvoice" &&
    (s.cosyBackend === "fastapi" || s.cosyBackend === "local");
  const isApi =
    s.provider === "cosyvoice" &&
    (s.cosyBackend === "dashscope" || s.cosyBackend === "customHttp");

  let moodLine = "无（本引擎固定语调，勿自行加戏）";
  let moodExtra = "";
  let requireTtsInstruct = false;
  if (isCosyLocal) {
    moodLine = `${moodLabel}（必遵；按此情绪组织口语）`;
    // instructSuffix 只给 Cosy 引擎，勿写进口语块（日志：模型把「用俏皮卖萌的语气说话」当正文念）
    moodExtra = "";
    // CosyVoice2/3 参考音克隆不再消费 TTS_INSTRUCT（zero_shot）；要求输出只会诱使模型写进正文
    requireTtsInstruct = !s.cosyVoice2;
  } else if (isApi && apiSupportsMood(s.cosyBackend, s.apiSupportsMood)) {
    moodLine = `${moodLabel}（当前 API 支持心情）`;
    moodExtra = "";
    requireTtsInstruct = true;
  } else if (isApi) {
    moodLine = "无（当前 API 不支持心情）";
  }

  let block = `\n\n【语音通话人设·必遵】`;
  block += `\n- 性别：${genderLabel}（默认；用户要求换声时可改）`;
  block += `\n- 当前音色：${timbreLabel}（id=${timbre.id}）`;
  block += `\n- 语音包：${packLine}`;
  block += `\n- 【语音情绪设定】：${moodLabel}（id=${moodPreset.id}）`;
  block += `\n- 心情：${moodLine}`;
  block += `\n- 措辞要求：${oral || "口语清晰、短句优先"}${moodExtra}`;
  block += `\n- 【一键音色目录】${formatTimbreCatalogForLlm()}`;
  block += `\n- 【一键心情目录】${formatMoodCatalogForLlm(
    (s.voiceGender || timbre.gender) === "male" ? "male" : "female",
  )}`;
  block +=
    "\n- 用户要换预设音色/心情时：先调用工具 voice_set_tone（tone_id=上表 id，如 male-deep、female-jiazi）；自由描述自定义声线时用 voice_set_cosy_instruct；禁止只口头说「无法切换」。";
  block +=
    "\n- 禁止：与当前性别/音色矛盾的自称；复述垫话；长文；工具口吻；勿自造另一套人设（自定义须先写进工具）";
  block +=
    "\n- 禁止在正文写任何表演括号：包括但不限于 (超兴奋)(拖音)【小声】(笑)（卖萌）（嘻嘻）（歪头）（轻笑）等；用户看得见会像笑话。情绪与表演只写在 TTS_INSTRUCT，正文只写听得懂的口语，零舞台标注。";
  block +=
    "\n- 禁止在正文复述合成指令：如「用××语气说话」「用网络流行夹子音说话」「用俏皮卖萌的语气」等；这些只写在 TTS_INSTRUCT，绝不能当回答念出来。";
  if (requireTtsInstruct) {
    block += `\n\n【TTS 情绪指令·必遵】`;
    block += `\n用户只会看到你的回答正文。你必须额外输出一行给语音合成用，用户不可见：`;
    block += `\n规则：`;
    block += `\n1. 回复正文的语言风格、措辞必须贴合【语音情绪设定】：${moodLabel}。`;
    block += `\n2. 尽量在正文前几句之后尽早单独一行输出 TTS_INSTRUCT:…（便于边生成边朗读）。`;
    block += `\n3. TTS_INSTRUCT 只能写简短中文完整句，不要多余标点，不要换行，不要只写「${moodLabel}」两个字。`;
    block += `\n4. 不要把 TTS 提示写进正文；正文零舞台标注、零「用××语气说话」。`;
    block += `\n格式示例（勿照抄进正文）：`;
    block += `\nTTS_INSTRUCT:用开心欢快明亮的语气说话`;
  } else {
    block +=
      "\n- 当前引擎无单独 TTS_INSTRUCT 通道时：仍禁止正文舞台括号；用措辞本身表现语气，勿写 (拖音) 一类标注。禁止写「用××语气说话」「软糯卖萌」等合成口令当回答。";
  }
  block += personaTrainingHintForTone(s.timbreId || s.toneId);
  return block;
}

/**
 * Duty: 语音通话执行策略——交代必做、敏感须确认。
 */
export function buildVoiceCallExecBlock(): string {
  return (
    "\n\n【语音执行】用户交代的可执行事项必须真正去做并回报结果，禁止只口头答应。" +
    "涉及密钥、证书、.env、密码、token、身份证/银行卡等敏感数据，或批量删除、改权限、推送远程、把敏感内容外发时：" +
    "必须先用一两句口语问清并征求确认，明确说「请说确认继续，或说取消」，然后停下等用户下一句；未听到确认不得调用写盘/外发类工具。" +
    "非敏感操作（读普通源码、列目录、已授权改业务文件、打开本机 IDE 等）可直接执行。" +
    "先短答「开始做了」再执行；完成后用一两句口语汇报。" +
    "若缺工作目录，用口语请用户说确认后去选择目录，不要假装已经写入。"
  );
}

/** 试听用短句（过长会导致 Cosy 冷启动体感更差）。 */
export function previewUtteranceForTone(toneId?: string | null): string {
  const preset = getVoiceTonePreset(toneId);
  if (preset.gender === "male") return "你好，虚募阁试听。";
  return "你好，虚募阁试听。";
}
