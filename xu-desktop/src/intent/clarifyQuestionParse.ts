/**
 * @file clarifyQuestionParse.ts 从助手回复抽取澄清题 / 确认清单过滤
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-30
 * @updated 2026-09-08
 * @version 1.1.0
 * @category Intent
 * @algo numbered-list-heuristics
 */

/** Strip fenced code so directory trees / snippets don't look like Q lists. */
function stripCodeFences(text: string): string {
  return text.replace(/```[\s\S]*?```/g, "\n");
}

export function extractClarifyQuestions(text: string, max = 6): string[] {
  const t = stripCodeFences(text || "").trim();
  if (!t) return [];

  const out: string[] = [];
  const seen = new Set<string>();

  const push = (raw: string) => {
    let q = raw.replace(/\*\*/g, "").replace(/^#+\s*/, "").trim();
    q = q.replace(/^[）)\].、.\s]+/, "").trim();
    // Drop pure path / tree noise
    if (/^[|\\/\-─│]+/.test(q) || /\.(vue|js|ts|rs|py|go)\s*$/i.test(q)) return;
    if (q.length < 4 || q.length > 240) return;
    const k = q.toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    out.push(q);
  };

  // Line-oriented numbered items (more reliable than single regex across bold/fullwidth)
  // 1. / 1、 / 1) / 1） / （1） / (1) / **1.**
  const lineNum =
    /^\s*(?:\*\*)?[(（]?\d+[)）]?[.、．:）)]?\s*(?:\*\*)?\s*(.+?)\s*(?:\*\*)?\s*$/;
  for (const line of t.split(/\r?\n/)) {
    if (out.length >= max) break;
    const m = line.match(lineNum);
    if (!m?.[1]) continue;
    // Avoid matching lone "2024." years etc. — need some CJK or question cue when short
    const body = m[1].trim();
    if (body.length < 2) continue;
    push(body);
  }

  // Markdown ### 1. title
  if (out.length < 2) {
    const heads = t.matchAll(/(?:^|\n)#{1,4}\s*\d+[.、．)]\s*(.+?)(?=\n|$)/g);
    for (const h of heads) {
      if (out.length >= max) break;
      push(h[1] || "");
    }
  }

  // Bullet questions ending with ? / ？
  if (out.length < 2) {
    for (const line of t.split(/\r?\n+/)) {
      if (out.length >= max) break;
      const q = line.replace(/^[-*•]\s+/, "").trim();
      if (/[？?]$/.test(q) && q.length >= 6) push(q);
    }
  }

  // Interview-style labeled lines: **支付方式**：… / 平台：…
  if (out.length < 2 && looksLikeClarifyInterviewLoose(t)) {
    for (const line of t.split(/\r?\n+/)) {
      if (out.length >= max) break;
      const m = line.match(
        /^\s*(?:\*\*)?([^\s*:：]{2,24})(?:\*\*)?\s*[:：]\s*(.+?)\s*$/,
      );
      if (!m) continue;
      const label = (m[1] || "").replace(/\*\*/g, "").trim();
      const rest = (m[2] || "").replace(/\*\*/g, "").trim();
      if (!label || /^(http|https|路径|目录)$/i.test(label)) continue;
      push(rest ? `${label}：${rest}` : label);
    }
  }

  return out.slice(0, max);
}

function looksLikeClarifyInterviewLoose(text: string): boolean {
  return /开始前|确认一下|确认几个|先确认|请先确认|还缺|补充.*需求|避免跑偏|答完.*再|请回答|待澄清|缺口|关键点|几个问题|需要确认|方便确认|先问/.test(
    text || "",
  );
}

/**
 * Duty: 助手「确认稿/状态清单/假权限指南」等编号列表，不应当「补充需求」填空题。
 * Fail: 误判为澄清访谈 → 弹窗打断获客等流程。
 */
export function looksLikeStatusOrConfirmList(text: string): boolean {
  const t = text || "";
  if (!t.trim()) return false;
  // 假工具权限引导
  if (
    /工具权限|设置/.test(t) &&
    /(办公|Office|文档|文件系统|勾选|授权开启|权限开启|Canvas本机)/i.test(t)
  ) {
    return true;
  }
  // 获客 / 成稿确认 / 发送准备状态（非向用户要 Brief 缺口）
  if (
    /理想客户画像|客户画像|个性化邮件|邮件草稿|发送状态|获客|请确认是否需要|不适用|已按您的确认|非群发|供后续追踪/.test(
      t,
    )
  ) {
    return true;
  }
  // 「请确认是否需要调整/修改」类确认清单，而非「请回答缺口」
  if (/请确认是否需要/.test(t) && /调整|修改|不适用/.test(t)) return true;
  return false;
}

/** Heuristic: reply looks like a clarify interview (not pure implementation). */
export function looksLikeClarifyInterview(text: string): boolean {
  const t = text || "";
  if (looksLikeStatusOrConfirmList(t)) return false;
  if (extractClarifyQuestions(t).length >= 2) return true;
  return looksLikeClarifyInterviewLoose(t);
}

/** Alternative actions (pick one), not a fill-in interview. */
export function looksLikeChoiceList(questions: string[]): boolean {
  if (questions.length < 2) return false;
  const alt = questions.filter(
    (q) =>
      /[？?]$/.test(q) ||
      /^(想|需要|要不要|是否|还是|或者)/.test(q) ||
      /还是|或者|要不要/.test(q),
  );
  return alt.length >= 2 && alt.length >= questions.length - 1;
}

export function extractChoiceOptions(text: string, max = 6): string[] {
  const qs = extractClarifyQuestions(text, max);
  return looksLikeChoiceList(qs) ? qs : [];
}

const NONE_RE = /都不是|都不要|没有这些|都不选|都不|跳过|不用了|算了/;
const ORDINAL = ["一", "二", "三", "四", "五", "六"];

/** Map a spoken/typed reply to a choice index, or -1 for “none of these”. */
export function matchVoiceChoice(text: string, options: string[]): number | null {
  const t = (text || "").replace(/\s+/g, "").trim();
  if (!t || !options.length) return null;
  if (NONE_RE.test(t)) return -1;
  const digit = t.match(/^[1-9]$/) || t.match(/第\s*([1-9])/) || t.match(/选项\s*([1-9])/);
  if (digit) {
    const n = Number(digit[1] || digit[0]);
    if (n >= 1 && n <= options.length) return n - 1;
  }
  for (let i = 0; i < options.length && i < ORDINAL.length; i++) {
    const o = ORDINAL[i];
    if (t === o || t.includes(`第${o}`) || t.includes(`选项${o}`)) return i;
  }
  for (let i = 0; i < options.length; i++) {
    const opt = options[i].replace(/[？?]/g, "").replace(/\s+/g, "");
    if (opt && (t.includes(opt.slice(0, 8)) || opt.includes(t))) return i;
  }
  return null;
}

export function formatClarifyAnswers(
  questions: string[],
  answers: string[],
): string {
  const lines = ["【需求补充 · 弹窗确认】"];
  for (let i = 0; i < questions.length; i++) {
    const a = (answers[i] || "").trim();
    if (!a) continue;
    lines.push(`${i + 1}. ${questions[i]}`);
    lines.push(`   答：${a}`);
  }
  return lines.join("\n");
}
