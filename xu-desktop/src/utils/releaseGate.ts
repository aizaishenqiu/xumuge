/**
 * @file 软件发布、UAT、安全与逐项需求结项门禁
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-30
 * @version 1.1.0
 * @category ToolPolicy
 * @algo fail-closed-release-gate
 */
import { exists, readTextFile } from "@tauri-apps/plugin-fs";
import type { XuProject } from "./projects";
import { mkdirRecursive, writeTextUnderWorkspace } from "./fsBridge";
import {
  canDispatchDevAfterDesign,
  hasDesignArtifacts,
  isDesignFrozen,
} from "../intent/designArtifacts";
import { checkSecurityGate } from "./securityGate";
import { loadBrief } from "../intent/briefStore";
import {
  evaluateRequirementsCompletion,
  readRequirementsGate,
  syncRequirementsGateToBrief,
} from "./requirementsGate";

export const QA_DIR = ".xu/qa";
export const QA_CHECKLIST = `${QA_DIR}/CHECKLIST.md`;
export const UAT_NOTES = `${QA_DIR}/UAT.md`;
export const RELEASE_DIR = ".xu/release";
export const RELEASE_NOTES = `${RELEASE_DIR}/NOTES.md`;

function joinRoot(root: string, sub: string): string {
  const r = root.replace(/[/\\]+$/, "");
  const s = sub.replace(/^[/\\]+/, "");
  return `${r}/${s}`.replace(/\\/g, "/");
}

export async function hasQaChecklistPassed(project: XuProject): Promise<boolean> {
  const gen = (project.generatePath || "").trim();
  if (!gen) return false;
  const abs = joinRoot(gen, QA_CHECKLIST);
  try {
    if (!(await exists(abs))) return false;
    const text = await readTextFile(abs);
    return /\[x\]/i.test(text);
  } catch {
    return false;
  }
}

export async function hasReleaseNotes(project: XuProject): Promise<boolean> {
  const gen = (project.generatePath || "").trim();
  if (!gen) return false;
  try {
    return await exists(joinRoot(gen, RELEASE_NOTES));
  } catch {
    return false;
  }
}

export async function ensureReleaseNotesDraft(project: XuProject): Promise<void> {
  const gen = (project.generatePath || "").trim();
  if (!gen) return;
  const abs = joinRoot(gen, RELEASE_NOTES);
  if (await exists(abs)) return;
  const brief = await loadBrief(project.id);
  await mkdirRecursive(gen, joinRoot(gen, RELEASE_DIR));
  const md = [
    `# 发布说明 · ${project.name}`,
    "",
    `版本：v${brief.version || 1}`,
    `日期：${new Date().toISOString().slice(0, 10)}`,
    "",
    "## 变更摘要",
    "",
    `- 目标：${brief.goal || "（请补充）"}`,
    `- 验收要点：${(brief.acceptance || []).slice(0, 5).join("；") || "（请补充）"}`,
    "",
    "## 已知限制",
    "",
    "- （请补充）",
    "",
  ].join("\n");
  await writeTextUnderWorkspace(gen, abs, md);
}

export async function ensureUatDraft(project: XuProject): Promise<void> {
  const gen = (project.generatePath || "").trim();
  if (!gen) return;
  const abs = joinRoot(gen, UAT_NOTES);
  if (await exists(abs)) return;
  await mkdirRecursive(gen, joinRoot(gen, QA_DIR));
  const md = [
    `# UAT 用户验收 · ${project.name}`,
    "",
    "- [ ] 核心业务流程可用",
    "- [ ] 与需求 Must 一致",
    "- [ ] 种子用户/产品试用通过",
    "",
  ].join("\n");
  await writeTextUnderWorkspace(gen, UAT_NOTES, md);
}

export async function hasUatPassed(project: XuProject): Promise<boolean> {
  const gen = (project.generatePath || "").trim();
  if (!gen) return false;
  try {
    if (!(await exists(joinRoot(gen, UAT_NOTES)))) return false;
    const text = await readTextFile(joinRoot(gen, UAT_NOTES));
    return /\[x\]/i.test(text);
  } catch {
    return false;
  }
}

export type ReleaseGateFail =
  | "no_design"
  | "not_frozen"
  | "no_review"
  | "no_checklist"
  | "checklist_empty"
  | "no_uat"
  | "no_security_checklist"
  | "security_empty"
  | "security_incomplete"
  | "no_requirements_gate"
  | "requirements_incomplete"
  | "ui_acceptance_blocker"
  | "ok";

export async function checkReleaseGate(project: XuProject): Promise<{
  ok: boolean;
  reason: ReleaseGateFail;
  message: string;
}> {
  if (!(await hasDesignArtifacts(project))) {
    return {
      ok: false,
      reason: "no_design",
      message: "设计尚未确认定稿，无法结项。请先确认设计并冻结。",
    };
  }
  if (!(await isDesignFrozen(project))) {
    return {
      ok: false,
      reason: "not_frozen",
      message: "设计未冻结。确认设计后会自动冻结；若已解冻请重新确认设计。",
    };
  }
  const { readCodeReviewGate } = await import("./codeReviewGate");
  const gen = (project.generatePath || "").trim();
  const review = gen ? await readCodeReviewGate(gen) : null;
  if (!review || review.status !== "pass") {
    return {
      ok: false,
      reason: "no_review",
      message: "代码 Review 尚未通过（.xu/code-review.json 须为 pass），禁止合 main / 结项。",
    };
  }
  const syncedBrief = await syncRequirementsGateToBrief(project);
  const requirementsGate = await readRequirementsGate(gen);
  if (!requirementsGate) {
    return {
      ok: false,
      reason: "no_requirements_gate",
      message:
        "缺少 .xu/requirements-gate.json。Review/QA 必须按 requirement ID 逐项回写后才能结项。",
    };
  }
  const requirements = evaluateRequirementsCompletion(syncedBrief, requirementsGate);
  if (!requirements.ok) {
    return {
      ok: false,
      reason: "requirements_incomplete",
      message: requirements.message,
    };
  }
  const checklistAbs = joinRoot(gen, QA_CHECKLIST);
  try {
    if (!(await exists(checklistAbs))) {
      return {
        ok: false,
        reason: "no_checklist",
        message: "缺少 .xu/qa/CHECKLIST.md。请先完成 QA 波并勾选至少一项。",
      };
    }
    const text = await readTextFile(checklistAbs);
    if (!/\[x\]/i.test(text)) {
      return {
        ok: false,
        reason: "checklist_empty",
        message: "CHECKLIST.md 中尚无已勾选项 [x]。请至少完成一项冒烟检查。",
      };
    }
  } catch {
    return {
      ok: false,
      reason: "no_checklist",
      message: "无法读取 QA 检查清单。",
    };
  }
  await ensureUatDraft(project);
  if (!(await hasUatPassed(project))) {
    return {
      ok: false,
      reason: "no_uat",
      message: "缺少 UAT 勾选。请在 .xu/qa/UAT.md 勾选至少一项后再验收。",
    };
  }
  const security = await checkSecurityGate(project);
  if (!security.ok) {
    return {
      ok: false,
      reason: security.reason as ReleaseGateFail,
      message: security.message,
    };
  }
  const { hasOpenBlockerUiDefects } = await import("./uiAcceptanceReport");
  const uiBlock = gen ? await hasOpenBlockerUiDefects(gen) : { ok: true, count: 0, message: "" };
  if (!uiBlock.ok) {
    return {
      ok: false,
      reason: "ui_acceptance_blocker",
      message: uiBlock.message || "UI 验收仍有 blocker 级缺陷未关闭。",
    };
  }
  await ensureReleaseNotesDraft(project);
  return { ok: true, reason: "ok", message: "" };
}

/** Assert design freeze before allowing code dispatch. */
export async function assertDevDispatchAllowed(project: XuProject): Promise<void> {
  if (!(await canDispatchDevAfterDesign(project))) {
    if (!(await hasDesignArtifacts(project))) {
      throw new Error("设计尚未全部确认，无法开始写码");
    }
    throw new Error("设计未冻结或已解冻。请重新确认设计后再派开发。");
  }
  const { isTechDesignConfirmed } = await import("./techDesignGate");
  if (!(await isTechDesignConfirmed(project))) {
    throw new Error("技术方案尚未确认。请回复「确认技术方案」后再派开发。");
  }
  const { isCrossModuleBlocking } = await import("./crossModuleGate");
  if (await isCrossModuleBlocking(project.generatePath || "")) {
    throw new Error("跨模块尚未对齐。请开会确认或 Boss 回复「确认跨模块」后再派开发。");
  }
  const { assertCodingSurfaceChosen } = await import("./codingSurfacePrefs");
  assertCodingSurfaceChosen(project);
}
