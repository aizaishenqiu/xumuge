import { isWorkKickoff, isWorkReset, isWorkStop } from "../utils/bossStopIntent";
import { isProtectedProductAsk } from "../utils/antiDistill";

export type LocalTurnKind = "question" | "requirement" | "passthrough";

const CONFIRM_RE =
  /确认需求|需求确认|就这样|可以开工|开始执行|brief\s*ready|确认并开工|开始设计|保存并开始设计/i;
const FORCE_ALL_RE = /强制全员|全员强制开工|不管匹配全部开工/i;
const REWORK_RE = /验收返工|按验收返工|返工\s*验收/i;

/** User already authorized writing this turn. */
export const IMMEDIATE_WRITE_RE = /直接改|马上做|按这个做|开始改|直接写|马上改/i;

/** Canvas 草图 / 户型 / 海报 / 排版：短句也必须放行写盘，勿判成 question。勿用裸「画」以免「画得/画成」误开 generic。 */
export const CANVAS_DRAW_INTENT_RE =
  /帮我画|请画|来画|画出|画一个|画一张|画个|画张|画一幅|草图|户型|平面图|施工图|canvas_write|画板|布局图|房子布局|装修图|房间(布局|划分)|海报|广告|海鸥|宣传|招贴|排版|版式|双栏|三栏|主视觉|\d\s*室|\d\s*厅|两厅/i;

/** 对已出图的纠错/重画/要过程，不是新开通用骨架。 */
export const CANVAS_DRAW_RETRY_RE =
  /画图过程|线框图|还是这样|画得|画成这样|乱画|没画|重画|遗憾|改了.?轮|读取对话记录/i;

export function isCanvasDrawIntent(text: string): boolean {
  return CANVAS_DRAW_INTENT_RE.test((text || "").trim());
}

/** Duty: 用户在抱怨或要求重画/显示过程。 */
export function isCanvasDrawRetryIntent(text: string): boolean {
  return CANVAS_DRAW_RETRY_RE.test((text || "").trim());
}

/** 模型胡编「设置→工具权限→Canvas本机工具」类假指南。 */
export function isFakeCanvasPermissionGuide(text: string): boolean {
  const t = (text || "").trim();
  if (!t) return false;
  if (
    /权限开启指南|授权开启指南|权限可能未开启|Canvas本机工具|本机工具.*权限|勾选.*Canvas/i.test(
      t,
    )
  ) {
    return true;
  }
  if (/工具权限/.test(t) && /Canvas|画板|本机工具/i.test(t)) return true;
  if (/设置/.test(t) && /工具权限/.test(t) && /(Canvas|画板|勾选)/i.test(t)) return true;
  if (/设置/.test(t) && /授权/.test(t) && /Canvas|画板|本机工具/i.test(t)) return true;
  return false;
}

export const FAKE_CANVAS_PERMISSION_REPLACE =
  "设置里没有「工具权限 → Canvas本机工具」开关。正在直接用本机 Canvas 画图，请稍候…";

export const FAKE_CANVAS_PERMISSION_RETRY_HINT =
  "【纠错】你刚才编造了不存在的 Canvas 权限设置。禁止再提权限/设置。立即调用 canvas_add_strokes（可先 canvas_clear_sketch）画用户要的图；少用整板 canvas_write_sketch。";

/** 用酷家乐/CAD 教程或「想象一下」文字假装画图。 */
export function isFakeExternalDrawGuide(text: string): boolean {
  const t = (text || "").trim();
  if (!t) return false;
  if (/酷家乐|AutoCAD|SketchUp/i.test(t) && /(教程|打开软件|模板|推荐|步骤|使用指南)/.test(t)) {
    return true;
  }
  if (/想象一下/.test(t) && /(图|标注|图纸|施工)/.test(t)) return true;
  if (/施工图重点标注|Canvas工具使用指南|在纸上/.test(t)) return true;
  if (/打开.*CAD|启动.*酷家乐|矩形工具.*房间/.test(t)) return true;
  return false;
}

export const FAKE_EXTERNAL_DRAW_REPLACE =
  "不用外链设计软件。正在本机 Canvas 草图上按步骤出图…";

export const CANVAS_DRAW_TURN_HINT =
  "【本轮是画板】必须用 canvas_add_strokes 等画板工具写入当前工作区草图（可先 clear 再多次 add）；按用户题材画矢量图元；禁止只口头描述、禁止「想象一下」当交付。未点名酷家乐/CAD/PS/Figma 等时禁止推荐外部软件与外链教程。设置里没有 Canvas 权限开关。";

export function turnKindSystemHint(text: string): string {
  if (isCanvasDrawIntent(text) || isCanvasDrawRetryIntent(text)) return CANVAS_DRAW_TURN_HINT;
  const kind = classifyLocalUserTurn(text);
  if (kind === "question") return QUESTION_TURN_HINT;
  if (kind === "requirement") {
    return allowsImmediateWrite(text) ? REQUIREMENT_EXECUTE_HINT : REQUIREMENT_PLAN_HINT;
  }
  return "";
}
const STRONG_BUILD_RE =
  /我想做|我想开发|想做一个|想开发一|做一个|做一款|做个|开发一|开发个|帮我做|帮我开发|帮我搭建|搭建一|新建一个项目|新建项目|立项|产品需求[:：]|需求是做/i;

const STRONG_BUILD_OBJECT_RE =
  /做(一个|一款|个).{0,12}(小程序|App|APP|网站|系统|SaaS|saas|平台|工具)|开发(一个|一款|个).{0,12}(小程序|App|APP|网站|系统|SaaS|saas|平台)/i;

/** 企业财务/税务/出纳交付，避免「税务系统」里的「系统」误判为软件立项。 */
const FINANCE_DELIVERY_RE =
  /出纳|日清月结|报税|增值税|税务筹划|税筹|筹划|汇算清缴|加计扣除|出口退税|个税|社保公积金|内审|年审|土增税|转让定价/;

const LEADS_DELIVERY_RE = /获客|找客户|写外联|外联草稿|冷邮件|线索名单|理想客户/;

const OPERATION_RE =
  /帮我(改|修改|实现|写|把)|请(改|修改|实现)|把.{0,24}改|改成|修改.{0,12}(按钮|页面|代码|功能|样式|文案)|实现.{0,12}(功能|登录|接口)|加上功能|增加功能|修复(?!.{0,6}(什么|怎么|为何))|写一个|生成代码|落到工作区|落到磁盘|写入工作区/i;

const QUESTION_START_RE =
  /^(什么是|怎么用|如何|为什么|能不能|可以吗|告诉我|解释一下|在吗|你好|谢谢|帮我看看|这是什么|在哪|是否|有没有)/i;

const QUESTION_HELP_RE = /怎么(用|开|操作|设置|配置)|应用内帮助|使用说明/i;

export const QUESTION_TURN_HINT =
  "【本轮是提问】直接回答，不要派活、不要写盘、不要先列长规划。";

export const REQUIREMENT_PLAN_HINT =
  "【本轮是需求/操作】先用短规划回复用户（目标、步骤、风险），再给可执行说明；未出现「直接改/马上做/按这个做」时禁止 write/shell。";

export const REQUIREMENT_EXECUTE_HINT =
  "【本轮是需求/操作 · 已授权动手】先用两三句说明步骤，然后可以写盘执行。";

export function allowsImmediateWrite(text: string): boolean {
  const t = (text || "").trim();
  return IMMEDIATE_WRITE_RE.test(t) || isCanvasDrawIntent(t);
}

export function isOpsPassthroughTurn(text: string): boolean {
  const t = (text || "").trim();
  if (!t) return false;
  if (isProtectedProductAsk(t)) return true;
  if (CONFIRM_RE.test(t) || FORCE_ALL_RE.test(t) || REWORK_RE.test(t)) return true;
  if (isWorkKickoff(t) || isWorkStop(t) || isWorkReset(t)) return true;
  return false;
}

/** Strong “make a product” without being a how-to question. */
export function isStrongBuildTurn(text: string): boolean {
  const t = (text || "").trim();
  if (!t) return false;
  if (/^【需求补充/.test(t)) return true;
  return STRONG_BUILD_RE.test(t) || STRONG_BUILD_OBJECT_RE.test(t);
}

export function isQuestionTurn(text: string): boolean {
  const t = (text || "").trim();
  if (!t) return false;
  if (/^【需求补充/.test(t)) return false;
  if (isOpsPassthroughTurn(t)) return false;
  if (isCanvasDrawIntent(t) || isCanvasDrawRetryIntent(t)) return false;
  const qMark = /[？?]\s*$/.test(t) && t.length <= 120;
  const qWord = QUESTION_START_RE.test(t) || QUESTION_HELP_RE.test(t) || /(?:怎么|如何|为什么|什么是)/.test(t);
  if (!qMark && !qWord) return false;
  // Imperative “帮我做/改” wins over a trailing 吗/?
  if (/帮我(做|开发|搭建|改|修改|实现|写|把)|我想(做|开发)/.test(t) && !/怎么(用|设置|配置|操作)/.test(t)) {
    return false;
  }
  if (isStrongBuildTurn(t) && /帮我(做|开发)|我想做|做一个|立项/.test(t) && !/^(怎么|如何|什么是|为什么)/.test(t)) {
    return false;
  }
  return true;
}

export function isRequirementTurn(text: string): boolean {
  const t = (text || "").trim();
  if (!t || /^【需求补充/.test(t)) return /^【需求补充/.test(t);
  if (isOpsPassthroughTurn(t) || isQuestionTurn(t)) return false;
  if (FINANCE_DELIVERY_RE.test(t) || LEADS_DELIVERY_RE.test(t)) return true;
  if (isStrongBuildTurn(t)) return true;
  if (OPERATION_RE.test(t)) return true;
  if (allowsImmediateWrite(t)) return true;
  return false;
}

/**
 * Classify a local user's utterance after existing stop/kickoff/confirm gates.
 * question = answer directly; requirement = plan first (Brief if 立项); passthrough = leave to existing routers.
 */
export function classifyLocalUserTurn(text: string): LocalTurnKind {
  const t = (text || "").trim();
  if (!t) return "passthrough";
  if (isOpsPassthroughTurn(t)) return "passthrough";
  if (isCanvasDrawIntent(t) || isCanvasDrawRetryIntent(t)) return "passthrough";
  if (isQuestionTurn(t)) return "question";
  if (isRequirementTurn(t) || isStrongBuildTurn(t)) return "requirement";
  if (t.length <= 40 && !OPERATION_RE.test(t)) return "question";
  if (t.length >= 80) return "requirement";
  return "question";
}

/** 改代码 / 改文件 / 实现功能等操作句，非软件立项。 */
export function isOperationTurn(text: string): boolean {
  return OPERATION_RE.test((text || "").trim());
}

/** 明确要做软件类产品（小程序/网站/系统等）。 */
export function isStrongBuildObjectTurn(text: string): boolean {
  const t = (text || "").trim();
  if (!t) return false;
  if (
    (FINANCE_DELIVERY_RE.test(t) || LEADS_DELIVERY_RE.test(t)) &&
    !/小程序|App|APP|网站|SaaS|saas/.test(t)
  ) {
    return false;
  }
  return STRONG_BUILD_OBJECT_RE.test(t);
}
