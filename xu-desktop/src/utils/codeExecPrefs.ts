/**
 * @file 代码环偏好：内建工具闭环，非外挂 CLI 主路径
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-22
 * @updated 2026-09-05
 * @version 1.1.0
 * @category AgentLoop
 * @algo native-code-loop-prefs
 */
import { invoke } from "@tauri-apps/api/core";
import type { Employee } from "./employees";

const SETTING_KEY = "xu.code_exec_prefs";

export type CodeExecBackend = "native" | "native_enhanced";

export interface CodeExecPrefs {
  /** Enable enhanced code-loop hints for code/dev roles */
  enhancedCodeLoop: boolean;
  /** Prefer trusted-style instructions for code roles (still respects global execPolicy) */
  preferApplyPatch: boolean;
  /** After employee done: run lightweight acceptance review */
  acceptanceReviewOnDone: boolean;
  /** When review finds misses: auto dispatch QA rework (cooldown) */
  acceptanceAutoReworkOnMiss: boolean;
  /** Before dispatch: grep Brief keywords into LOCAL_CONTEXT_PACK */
  projectContextRetrievalOnDispatch: boolean;
  /** PoC: TF cosine semantic index at .xu/semantic-index.json (default off) */
  projectSemanticIndexEnabled: boolean;
  /** Embedding index via /embeddings API (Ollama/OpenAI; default off) */
  projectEmbeddingIndexEnabled: boolean;
  /** Override embedding model (empty = auto by baseUrl) */
  embeddingModel: string;
  /** On Brief confirm: write .xu/ARCHITECTURE_BRIEF.md */
  architectureBriefOnConfirm: boolean;
  /** After arch brief: auto dispatch planning role review */
  architectureReviewOnConfirm: boolean;
  /** Hint only: mention external `codex` if user opts in (does not spawn as product main path) */
  hintExternalCodexCli: boolean;
  /** Code roles: dispatch hint for faster patch loop (global execPolicy still applies) */
  codeRoleRelaxedApproval: boolean;
  /** QA 发现 open 缺陷时自动 dispatch 首条 P0（默认关） */
  autoDispatchDefectFix: boolean;
  /** 验收通过后写入 case-library candidate（默认关） */
  harvestCaseOnAcceptance: boolean;
  backend: CodeExecBackend;
}

export function defaultCodeExecPrefs(): CodeExecPrefs {
  return {
    enhancedCodeLoop: true,
    preferApplyPatch: true,
    acceptanceReviewOnDone: true,
    acceptanceAutoReworkOnMiss: false,
    projectContextRetrievalOnDispatch: true,
    projectSemanticIndexEnabled: false,
    projectEmbeddingIndexEnabled: false,
    embeddingModel: "",
    architectureBriefOnConfirm: true,
    architectureReviewOnConfirm: true,
    hintExternalCodexCli: false,
    codeRoleRelaxedApproval: true,
    autoDispatchDefectFix: false,
    harvestCaseOnAcceptance: false,
    backend: "native_enhanced",
  };
}

export async function loadCodeExecPrefs(): Promise<CodeExecPrefs> {
  const d = defaultCodeExecPrefs();
  try {
    const raw = await invoke<string | null>("xu_get_setting", { key: SETTING_KEY });
    if (!raw) return d;
    const p = JSON.parse(raw) as Partial<CodeExecPrefs>;
    return {
      enhancedCodeLoop: p.enhancedCodeLoop !== false,
      preferApplyPatch: p.preferApplyPatch !== false,
      acceptanceReviewOnDone: p.acceptanceReviewOnDone !== false,
      acceptanceAutoReworkOnMiss: p.acceptanceAutoReworkOnMiss === true,
      projectContextRetrievalOnDispatch: p.projectContextRetrievalOnDispatch !== false,
      projectSemanticIndexEnabled: p.projectSemanticIndexEnabled === true,
      projectEmbeddingIndexEnabled: p.projectEmbeddingIndexEnabled === true,
      embeddingModel: String(p.embeddingModel || "").trim(),
      architectureBriefOnConfirm: p.architectureBriefOnConfirm !== false,
      architectureReviewOnConfirm: p.architectureReviewOnConfirm !== false,
      hintExternalCodexCli: p.hintExternalCodexCli === true,
      codeRoleRelaxedApproval: p.codeRoleRelaxedApproval !== false,
      autoDispatchDefectFix: p.autoDispatchDefectFix === true,
      harvestCaseOnAcceptance: p.harvestCaseOnAcceptance === true,
      backend: p.backend === "native" ? "native" : "native_enhanced",
    };
  } catch {
    return d;
  }
}

export async function saveCodeExecPrefs(prefs: CodeExecPrefs): Promise<void> {
  await invoke("xu_set_setting", {
    key: SETTING_KEY,
    value: JSON.stringify(prefs),
  });
}

export function isCodeLikeEmployee(emp: Employee): boolean {
  if (emp.brainSlot === "code") return true;
  const hay = `${emp.role} ${emp.agentRoleId || ""} ${emp.name}`;
  return /前端|后端|fullstack|full.?stack|frontend|backend|开发|engineer|coder|代码|desktop|tauri|vue|react/i.test(
    hay,
  );
}

export function buildEnhancedCodeLoopHint(prefs: CodeExecPrefs): string {
  const lines = [
    "【高级代码环 · Codex 能力对齐 · 虚募阁 Native Agent】",
    "- 本产品已内建 apply_patch / grep / glob / shell_exec / 快照撤销（非外挂 Codex HTTP）",
    prefs.preferApplyPatch
      ? "- 修改已有文件优先 apply_patch（Begin Patch）；禁止大段无 diff 覆写"
      : "",
    "- 闭环：读上下文 → 规划 XU_TASKS → 改文件 → list_dir/自检 → XU_ACCEPTANCE_REPORT",
    "- 若可运行检查（如存在 package.json），可用 shell_exec 跑 typecheck/test",
    "- shell 若返回「失败 · 可恢复」：根据 exit 与 stderr 改命令或代码后重试，禁止声称已成功",
  ];
  if (prefs.hintExternalCodexCli) {
    lines.push(
      "- （可选）若本机 PATH 有 `codex`，可用 shell_exec 辅助；失败必须回退虚募阁 Native Agent 工具，禁止卡住",
    );
  }
  return lines.filter(Boolean).join("\n");
}
