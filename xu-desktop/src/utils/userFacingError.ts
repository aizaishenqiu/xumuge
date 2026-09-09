/**
 * @file 面向用户的错误净化与 fouAlert 统一入口
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-31
 * @updated 2026-09-02
 * @version 1.2.1
 * @category UI
 * @algo technical-detail-redaction
 */
import { fouAlert } from "foucui";

const DEV_LEAK_PATTERNS =
  /\{XU_HOME\}|XU_HOME|xu\.db|public\/uploads|\/uploads\/|src-tauri|mcpTools|Bearer\s|pnpm\s|cargo\s|tauri-plugin|\.jsonl\b|SQLSTATE|rusqlite|invoke\s/i;

function looksLikeUrl(s: string): boolean {
  const t = s.trim();
  if (!t) return false;
  if (/^https?:\/\//i.test(t)) return true;
  if (/^[\w.-]+:\d+\//.test(t)) return true;
  return /https?:\/\/[^\s]+/i.test(t);
}

function redactDevTokens(s: string): string {
  return s
    .replace(/\{XU_HOME\}(?:\/[^\s,;，；)]*)?/gi, "应用数据目录")
    .replace(/XU_HOME(?:\/[^\s,;，；)]*)?/gi, "应用数据目录")
    .replace(/\bxu\.db\b/gi, "本机数据库")
    .replace(/public\/uploads[^\s,;，；)]*/gi, "附件目录")
    .replace(/\/uploads\/[^\s,;，；)]*/gi, "附件目录")
    .replace(/https?:\/\/[^\s)'"`]+/gi, "")
    .replace(/(?:^|[\s("'`])(?:[a-z]:[\\/]|\\\\[^\\\s]+\\|\/(?:users|home|var|tmp|private|opt|etc)\/)[^\s,;，；)]*/gi, "本地文件")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** 用户可见路径：系统目录 → 人话；否则尽量只留文件名 */
export function formatPathForUser(absPath: unknown, fallback = "本地文件"): string {
  const raw = String(absPath ?? "").trim();
  if (!raw) return fallback;
  if (/\{XU_HOME\}|XU_HOME|\.fou|AppData|Application Support|\/\.xu\//i.test(raw)) {
    const base = raw.split(/[/\\]/).pop()?.trim();
    return base ? `应用数据目录/${base}` : "应用数据目录";
  }
  const base = raw.split(/[/\\]/).pop()?.trim();
  return base || fallback;
}

/** 非错误类展示文本净化（审计、Monitor、连接状态等） */
export function sanitizeUserDisplayText(raw: unknown, fallback = ""): string {
  let s = redactDevTokens(String(raw ?? "").replace(/^Error:\s*/i, "").trim());
  if (!s) return fallback;
  if (DEV_LEAK_PATTERNS.test(s)) return fallback || "（详情已隐藏）";
  if (looksLikeUrl(s)) return fallback || "（详情已隐藏）";
  return s;
}

/** 把模型/网络类失败转成可操作的人话（保留欠费、鉴权等关键信息，去掉裸 URL） */
export function explainModelFailure(raw: unknown, fallback = "本轮对话失败，请稍后重试"): string {
  let s = String(raw ?? "")
    .replace(/^Error:\s*/i, "")
    .trim();
  if (!s) return fallback;

  // 已是产品侧人话
  if (/欠费|额度不足|余额不足|鉴权失败|网络不通|连不上|限流|测通|未生成可显示/.test(s)) {
    return redactDevTokens(s) || fallback;
  }

  const low = s.toLowerCase();
  if (
    /insufficient|arrears|billing|余额不足|欠费|额度不足|quota.?exceeded|payment.?required/i.test(s) ||
    /\b402\b/.test(s)
  ) {
    return "远程模型疑似 API 欠费或额度不足。请到厂商控制台充值或更换 Key，再到设置 → 模型测通。";
  }
  if (/\b401\b|\b403\b|invalid.?api.?key|unauthorized|authentication/i.test(s)) {
    return "模型鉴权失败（Key 错误、过期或无权限）。请到设置 → 模型检查 API Key 后测通。";
  }
  if (/\b429\b|rate.?limit|too many requests/i.test(s)) {
    return "模型请求过于频繁或触发限流，请稍后再试。";
  }
  if (
    /connection refused|tcp connect|os error 10061|connecterror|timed? ?out|dns|network unreachable|failed to connect|error sending request/i.test(
      low,
    )
  ) {
    if (/11434|ollama|本地/.test(s)) {
      return "本地模型连不上。请确认 Ollama 已启动并已安装所用模型，或改用远程模型。";
    }
    return "模型网络不通（可能断网、代理异常或厂商不可达）。请检查网络后重试，并在设置 → 模型点「测通」。";
  }
  if (/上游网关|upstream gateway/i.test(s)) {
    return "上游网关错误。常见原因：中转不稳定或额度不足。建议换官方直连或切本地模型。";
  }

  return sanitizeUserMessage(s, fallback);
}

export function sanitizeUserMessage(raw: unknown, fallback = "请求失败"): string {
  if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    const nested =
      (typeof o.message === "string" && o.message) ||
      (typeof o.msg === "string" && o.msg) ||
      (typeof o.error === "string" && o.error) ||
      (o.error && typeof o.error === "object" && typeof (o.error as { message?: unknown }).message === "string"
        ? String((o.error as { message: string }).message)
        : "");
    if (nested.trim()) return sanitizeUserMessage(nested, fallback);
    // 禁止 String({}) → "[object Object]"
    return fallback;
  }
  let s = String(raw ?? "")
    .replace(/^Error:\s*/i, "")
    .trim();
  if (!s || s === "[object Object]" || s === "[object Error]") return fallback;
  if (
    /(?:^|[\s("'`])(?:[a-z]:[\\/]|\\\\[^\\\s]+\\|\/(?:users|home|var|tmp|private|opt|etc)\/)/i.test(s) ||
    /\b(?:sqlite|rusqlite|mysql|postgres(?:ql)?|database is locked|no such table|constraint failed|SQLSTATE)\b/i.test(s) ||
    DEV_LEAK_PATTERNS.test(s)
  ) {
    return fallback;
  }
  s = redactDevTokens(s);
  s = s.replace(/error sending request for url \([^)]+\)[:\s]*/gi, "");
  s = s.replace(/Failed to (load|fetch)[^\n]*/gi, "");
  if (!s || looksLikeUrl(s)) return fallback;
  if (/^request failed with status code\s*\d+$/i.test(s)) return fallback;
  if (/^network error$/i.test(s)) return "网络异常，请稍后重试";
  return s;
}

export function isBizErrorHandled(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  return Boolean((err as { presented?: boolean }).presented);
}

export async function showBizError(
  raw: unknown,
  opts?: { fallback?: string; silent?: boolean; title?: string },
): Promise<string> {
  const fallback = opts?.fallback || "请求失败";
  const clean = explainModelFailure(raw, fallback);
  if (!opts?.silent) {
    await fouAlert(clean, opts?.title || "提示");
  }
  return clean;
}

export function captureApiError(err: unknown, setLocal?: (msg: string) => void): boolean {
  if (isBizErrorHandled(err)) {
    const msg = err instanceof Error ? err.message : sanitizeUserMessage(err);
    setLocal?.(msg);
    return true;
  }
  return false;
}

/** 页面 catch：拦截器未处理时弹窗，已处理则仅写本地状态 */
export async function onApiCatch(
  err: unknown,
  setLocal?: (msg: string) => void,
  opts?: { fallback?: string; title?: string },
): Promise<void> {
  if (captureApiError(err, setLocal)) return;
  const msg = explainModelFailure(err instanceof Error ? err.message : err, opts?.fallback);
  setLocal?.(msg);
  await showBizError(msg, { fallback: opts?.fallback, title: opts?.title });
}

/** 统一 catch：弹窗 + 返回净化后的文案（替代 fouAlert(String(e)) / window.alert） */
export async function presentCatch(
  err: unknown,
  opts?: { fallback?: string; title?: string; silent?: boolean; setLocal?: (msg: string) => void },
): Promise<string> {
  const msg = explainModelFailure(err instanceof Error ? err.message : err, opts?.fallback);
  opts?.setLocal?.(msg);
  if (!opts?.silent) {
    await fouAlert(msg, opts?.title || "提示");
  }
  return msg;
}

/** 同步净化（写 ref / 聊天条，不弹窗） */
export function toUserError(err: unknown, fallback = "操作失败"): string {
  return explainModelFailure(err instanceof Error ? err.message : err, fallback);
}

/** 任意用户可见错误（本地校验、操作失败等）— 一律弹窗 */
export const presentError = showBizError;
