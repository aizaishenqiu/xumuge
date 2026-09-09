import { invoke } from "@tauri-apps/api/core";
import { fouConfirmPromise, fouMsg, fouAlert } from "foucui";
import { toUserError, formatPathForUser } from "./userFacingError";
import {
  extractAbsolutePaths,
  extractRelativeFileRefs,
  isPathUnderWorkspace,
  normalizeWinPath,
  toRelativePath,
} from "./chatWorkspace";

const TEXT_FILE_RE = /\.(md|txt|json|yaml|yml|toml|csv|ts|tsx|js|mjs|vue|rs|css|html|go|py|sql)$/i;
const PREFETCH_MAX_CHARS = 12_000;

const CURRENT_FILE_RE =
  /当前(打开)?的文件|当前文件|这个文件|打开的文件|正在编辑的文件|当前编辑的文件|读一下当前|读取当前/i;

const ATTACHMENT_RE = /\[附件:\s*([^\]]+)\]/g;

const sessionGrantedPaths = new Set<string>();

function normPath(p: string): string {
  return normalizeWinPath(p);
}

export function clearSessionReadGrants(): void {
  sessionGrantedPaths.clear();
}

export function grantReadPath(path: string): void {
  sessionGrantedPaths.add(normPath(path).toLowerCase());
}

export function isReadGranted(path: string): boolean {
  return sessionGrantedPaths.has(normPath(path).toLowerCase());
}

export interface ChatReadContext {
  workspace: string | null;
  previewPath: string | null;
  /** 通话等：语音确权替代弹窗 */
  confirmAsk?: (
    message: string,
    title: string,
  ) => Promise<"confirm" | "cancel">;
}

export function resolveChatReadTargets(message: string, ctx: ChatReadContext): string[] {
  const out: string[] = [];
  const ws = ctx.workspace?.trim() ? normPath(ctx.workspace) : "";

  if (CURRENT_FILE_RE.test(message) && ctx.previewPath?.trim()) {
    out.push(normPath(ctx.previewPath));
  }

  for (const abs of extractAbsolutePaths(message)) {
    out.push(normPath(abs));
  }

  if (ws) {
    for (const rel of extractRelativeFileRefs(message)) {
      out.push(normPath(`${ws}\\${rel}`));
    }
  }

  for (const m of message.matchAll(ATTACHMENT_RE)) {
    const raw = (m[1] ?? "").trim();
    if (!raw) continue;
    if (/^[A-Za-z]:[\\/]/.test(raw) || raw.startsWith("/")) {
      out.push(normPath(raw));
    } else if (ws) {
      out.push(normPath(`${ws}\\${raw.replace(/\//g, "\\")}`));
    }
  }

  return [...new Set(out.filter((p) => TEXT_FILE_RE.test(p)))];
}

async function ensureReadPermission(
  path: string,
  workspace: string | null,
  confirmAsk?: ChatReadContext["confirmAsk"],
): Promise<boolean> {
  const normalized = normPath(path);
  if (workspace && isPathUnderWorkspace(workspace, normalized)) return true;
  if (isReadGranted(normalized)) return true;

  const display = formatPathForUser(normalized);
  const prompt = `需要读取工作区外的文件「${display}」。请说确认授权本次读取，或者说取消。`;
  const action = confirmAsk
    ? await confirmAsk(prompt, "读取文件权限")
    : await fouConfirmPromise(
        `需要读取文件「${display}」。\n\n该文件不在当前工作区内。是否授权本次会话读取？`,
        "读取文件权限",
        { confirmButtonText: "授权读取", cancelButtonText: "取消" },
      );
  if (action === "confirm") {
    grantReadPath(normalized);
    return true;
  }
  // 语音确权取消：勿再弹 fouAlert 打断口语流；文字弹窗路径仍提示
  if (!confirmAsk) {
    void fouAlert(`已取消读取：${display}`, "提示");
  }
  return false;
}

export async function prefetchWithPermission(
  message: string,
  ctx: ChatReadContext,
): Promise<string> {
  const paths = resolveChatReadTargets(message, ctx);
  if (!paths.length) return "";

  const blocks: string[] = [];
  for (const abs of paths) {
    const rel =
      ctx.workspace && isPathUnderWorkspace(ctx.workspace, abs)
        ? toRelativePath(ctx.workspace, abs)
        : abs;

    const allowed = await ensureReadPermission(abs, ctx.workspace, ctx.confirmAsk);
    if (!allowed) {
      blocks.push(`—— 文件「${rel}」未授权读取 ——`);
      continue;
    }

    try {
      const content = await invoke<string>("read_text_file", { path: abs });
      const clipped =
        content.length > PREFETCH_MAX_CHARS
          ? `${content.slice(0, PREFETCH_MAX_CHARS)}\n…（已截断，共 ${content.length} 字）`
          : content;
      blocks.push(`—— 用户指定文件「${rel}」（应用已预读）——\n${clipped}`);
    } catch (e) {
      blocks.push(`—— 文件「${rel}」预读失败：${toUserError(e)} ——`);
    }
  }
  return blocks.join("\n\n");
}
