/**
 * @file 用户问题大纲 → 虚募阁超长记忆（用户大脑）
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-31
 * @version 1.0.0
 * @category AgentLoop
 * @algo rule-outline-extract
 */
import { upsertMemory, type XuMemory } from "../employee/memory";

export const OUTLINE_TAG = "outline";

/** 是否像实质提问（过短寒暄不入库） */
export function isSubstantialUserQuestion(text: string): boolean {
  const t = (text || "").trim();
  if (t.length < 8) return false;
  if (/^(你好|您好|在吗|嗨|hi|hello|谢谢|好的|嗯|哦)[.!！？。…]*$/i.test(t)) return false;
  return true;
}

/**
 * 从用户原文抽 3～8 条中文大纲（规则：按句切 + 去噪；不强依赖远程 LLM）。
 */
export function extractQuestionOutline(text: string): string[] {
  const raw = (text || "").replace(/\s+/g, " ").trim();
  if (!raw) return [];

  const chunks = raw
    .split(/[\n。！？?!；;]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 4);

  const bullets: string[] = [];
  const push = (s: string) => {
    const line = s.replace(/^[\d]+[\.\)、]\s*/, "").trim();
    if (line.length < 4) return;
    if (bullets.some((b) => b === line || b.includes(line) || line.includes(b))) return;
    bullets.push(line.length > 80 ? `${line.slice(0, 78)}…` : line);
  };

  for (const c of chunks) {
    push(c);
    if (bullets.length >= 8) break;
  }

  if (bullets.length === 0 && raw.length >= 8) {
    push(raw.length > 80 ? `${raw.slice(0, 78)}…` : raw);
  }

  // 至少保留目标感：过碎时合并前两条
  if (bullets.length === 1 && raw.length > bullets[0].length + 10) {
    const rest = raw.slice(bullets[0].length).trim();
    if (rest.length >= 8) push(rest);
  }

  return bullets.slice(0, 8);
}

/** 稳定 id：同一会话同一轮问题大纲可覆盖更新 */
export function outlineMemoryId(sessionKey: string, stamp: number): string {
  const safe = (sessionKey || "global").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 48);
  return `outline_${safe}_${stamp}`;
}

/**
 * 将用户问题大纲写入 虚募阁记忆（tags 含 outline）。
 * 本地永久保存，直到用户在记忆页删除或清库。
 */
export async function rememberQuestionOutline(opts: {
  userText: string;
  sessionId?: string | null;
  projectId?: string | null;
  employeeId?: string | null;
}): Promise<XuMemory | null> {
  const text = (opts.userText || "").trim();
  if (!isSubstantialUserQuestion(text)) return null;
  const bullets = extractQuestionOutline(text);
  if (!bullets.length) return null;

  const stamp = Date.now();
  const title = `问题大纲：${bullets[0].slice(0, 28)}${bullets[0].length > 28 ? "…" : ""}`;
  const body = bullets.map((b, i) => `${i + 1}. ${b}`).join("\n");
  const scope = opts.employeeId ? "employee" : opts.projectId ? "project" : "global";
  const scopeId = opts.employeeId || opts.projectId || null;
  const id = outlineMemoryId(opts.sessionId || scopeId || "boss", Math.floor(stamp / 60_000));

  return upsertMemory({
    id,
    scope,
    scopeId,
    title,
    body,
    tags: JSON.stringify([OUTLINE_TAG, "user_brain", "auto_extract", "structured"]),
    source: "outline",
    pinned: false,
  });
}

/** 判断记忆是否为问题大纲 */
export function isOutlineMemory(m: { tags?: string; source?: string }): boolean {
  if ((m.source || "") === "outline") return true;
  const tags = (m.tags || "").toLowerCase();
  return tags.includes(OUTLINE_TAG);
}
