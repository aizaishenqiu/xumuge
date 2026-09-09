/**
 * @file tsLanguageService.ts 工作区 TypeScript 语言服务前端封装
 * @author qiuye <yjk150@qq.com>
 * @date 2026-09-07
 * @updated 2026-09-07
 * @version 1.0.0
 * @category Cache
 * @algo tauri-tsserver-client
 */
import { invoke } from "@tauri-apps/api/core";
import type { LintDiagnostic } from "./workspaceLint";

export type TypescriptInfo = {
  installed: boolean;
  version: string | null;
};

export type TsQuickInfo = {
  displayString: string;
  documentation: string;
};

export type TsLocation = {
  file: string;
  line: number;
  column: number;
};

const TS_JS_RE = /\.(tsx?|mts|cts|jsx?|mjs|cjs)$/i;

/** Duty: 是否为内置 tsserver 支持的扩展名。 */
export function isTsJsPath(path: string): boolean {
  return TS_JS_RE.test(path.trim());
}

/** Duty: 检测工作区是否安装 typescript。 */
export async function detectTypescriptInfo(workspace: string): Promise<TypescriptInfo> {
  const ws = workspace.trim();
  if (!ws) return { installed: false, version: null };
  const raw = await invoke<{ installed: boolean; version: string | null }>(
    "detect_typescript_info",
    { workspace: ws },
  );
  return {
    installed: Boolean(raw.installed),
    version: raw.version ?? null,
  };
}

/** Duty: 拉取当前缓冲内容的 TS/JS 诊断。 */
export async function tsGetDiagnostics(
  workspace: string,
  path: string,
  content: string,
): Promise<LintDiagnostic[]> {
  const ws = workspace.trim();
  if (!ws || !path.trim() || !isTsJsPath(path)) return [];
  return invoke<LintDiagnostic[]>("ts_get_diagnostics", {
    workspace: ws,
    path,
    content,
  });
}

/** Duty: 悬停 quickinfo。 */
export async function tsQuickInfo(
  workspace: string,
  path: string,
  content: string,
  line: number,
  column: number,
): Promise<TsQuickInfo | null> {
  const ws = workspace.trim();
  if (!ws || !isTsJsPath(path)) return null;
  return invoke<TsQuickInfo | null>("ts_quick_info", {
    workspace: ws,
    path,
    content,
    line,
    column,
  });
}

/** Duty: 跳转定义。 */
export async function tsDefinition(
  workspace: string,
  path: string,
  content: string,
  line: number,
  column: number,
): Promise<TsLocation | null> {
  const ws = workspace.trim();
  if (!ws || !isTsJsPath(path)) return null;
  return invoke<TsLocation | null>("ts_definition", {
    workspace: ws,
    path,
    content,
    line,
    column,
  });
}

/** Duty: 格式化悬停文案。 */
export function formatQuickInfo(info: TsQuickInfo): string {
  const parts = [info.displayString.trim(), info.documentation.trim()].filter(Boolean);
  return parts.join("\n\n");
}
