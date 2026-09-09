/**
 * @file workspaceLint.ts ESLint / 诊断合并工具
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-31
 * @updated 2026-09-07
 * @version 1.1.0
 * @category Cache
 * @algo eslint-and-source-merge
 */
import { invoke } from "@tauri-apps/api/core";

export type LintSeverity = "error" | "warning" | "info";

export type LintDiagnostic = {
  file: string;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  severity: LintSeverity;
  message: string;
  ruleId: string | null;
  source: string | null;
};

export type EslintInfo = {
  installed: boolean;
  hasConfig: boolean;
  plugins: string[];
};

function normPath(p: string): string {
  return p.replace(/\\/g, "/").toLowerCase();
}

export async function lintFiles(
  workspace: string,
  paths: string[],
  fix = false,
): Promise<LintDiagnostic[]> {
  const ws = workspace.trim();
  if (!ws || !paths.length) return [];
  return invoke<LintDiagnostic[]>("run_eslint", {
    workspace: ws,
    paths,
    fix,
  });
}

export async function detectEslintInfo(workspace: string): Promise<EslintInfo> {
  const ws = workspace.trim();
  if (!ws) return { installed: false, hasConfig: false, plugins: [] };
  const raw = await invoke<{ installed: boolean; hasConfig: boolean; plugins: string[] }>(
    "detect_eslint_info",
    { workspace: ws },
  );
  return {
    installed: Boolean(raw.installed),
    hasConfig: Boolean(raw.hasConfig),
    plugins: raw.plugins ?? [],
  };
}

export function filterDiagnosticsForFile(
  diagnostics: LintDiagnostic[],
  filePath: string,
): LintDiagnostic[] {
  const norm = normPath(filePath);
  return diagnostics.filter((d) => normPath(d.file) === norm);
}

/** Duty: 整文件替换诊断（旧行为，会清掉该文件全部来源）。 */
export function mergeDiagnosticsForFiles(
  existing: LintDiagnostic[],
  filePath: string,
  next: LintDiagnostic[],
): LintDiagnostic[] {
  const norm = normPath(filePath);
  const rest = existing.filter((d) => normPath(d.file) !== norm);
  return [...rest, ...next];
}

/**
 * Duty: 按 source 合并同一文件的诊断，避免 ESLint 与 typescript 互相覆盖。
 * sources 列出本次要替换的来源；其余来源保留。
 */
export function mergeDiagnosticsBySource(
  existing: LintDiagnostic[],
  filePath: string,
  next: LintDiagnostic[],
  sources: string[],
): LintDiagnostic[] {
  const norm = normPath(filePath);
  const sourceSet = new Set(sources.map((s) => s.toLowerCase()));
  const rest = existing.filter((d) => {
    if (normPath(d.file) !== norm) return true;
    const src = (d.source || "").toLowerCase();
    return !sourceSet.has(src);
  });
  return [...rest, ...next];
}

export function lintSeverityLabel(sev: LintSeverity): string {
  if (sev === "error") return "错误";
  if (sev === "warning") return "警告";
  return "信息";
}

export function lintSummary(diagnostics: LintDiagnostic[]): string {
  const errors = diagnostics.filter((d) => d.severity === "error").length;
  const warnings = diagnostics.filter((d) => d.severity === "warning").length;
  if (!errors && !warnings) return "无问题";
  const parts: string[] = [];
  if (errors) parts.push(`${errors} 错误`);
  if (warnings) parts.push(`${warnings} 警告`);
  return parts.join("，");
}

let lintTimer: ReturnType<typeof setTimeout> | null = null;

export function debouncedLint(
  fn: () => void | Promise<void>,
  ms = 500,
): void {
  if (lintTimer) clearTimeout(lintTimer);
  lintTimer = setTimeout(() => {
    lintTimer = null;
    void fn();
  }, ms);
}
