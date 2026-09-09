/**
 * @file UI 验收汇总报告：办公室、聊天与落盘
 * @author qiuye <yjk150@qq.com>
 * @date 2026-09-02
 * @version 1.0.0
 * @category AgentLoop
 * @algo qa-report-aggregate
 */
import { exists, readTextFile } from "@tauri-apps/plugin-fs";
import { appendFouMessage } from "./employees";
import { OFFICE_FLOOR, peerSessionTag, BOSS_PEER_ID } from "./officeComms";
import type { XuProject } from "./projects";
import { mkdirRecursive, writeTextUnderWorkspace } from "./fsBridge";
import { readCodeReviewGate } from "./codeReviewGate";
import { readRequirementsGate, evaluateRequirementsCompletion } from "./requirementsGate";
import { loadBrief } from "../intent/briefStore";
import { loadDefects, openDefects } from "./workflowQa";
import type { UiAcceptanceRunSummary } from "./uiAcceptanceRunner";
import { readUiScenarios } from "./uiScenarios";

export const UI_ACCEPTANCE_REPORT_REL = ".xu/qa/UI_ACCEPTANCE_REPORT.md";

const OFFICE_SESSION = peerSessionTag(BOSS_PEER_ID, OFFICE_FLOOR);

function joinRoot(root: string, sub: string): string {
  return `${root.replace(/[/\\]+$/, "")}/${sub.replace(/^[/\\]+/, "")}`.replace(/\\/g, "/");
}

export interface UiAcceptanceReportBundle {
  markdown: string;
  officeSummary: string;
  hasBlockerUiDefect: boolean;
  openUiDefectCount: number;
}

function reviewLine(gen: string): string {
  return readCodeReviewGate(gen).then((gate) => {
    if (!gate) return "代码审查：未找到记录";
    return `代码审查：${gate.status}${gate.summary ? ` — ${gate.summary}` : ""}`;
  });
}

/** 聚合代码审查、需求门禁、UI 跑分与 open 缺陷，写入报告并推送办公室。 */
export async function publishUiAcceptanceReport(
  project: XuProject,
  uiRun?: UiAcceptanceRunSummary | null,
): Promise<UiAcceptanceReportBundle> {
  const gen = (project.generatePath || "").trim();
  const brief = await loadBrief(project.id);
  const gate = gen ? await readRequirementsGate(gen) : null;
  const reqEval =
    gate && brief ? evaluateRequirementsCompletion(brief, gate) : { ok: false, message: "无需求门禁" };
  const reviewText = gen ? await reviewLine(gen) : "代码审查：无工作区";
  const defects = gen ? await loadDefects(gen) : [];
  const open = openDefects(defects);
  const uiOpen = open.filter(
    (d) => d.id.startsWith("ui_") || d.steps.includes("UI 验收"),
  );
  const blockerUi = uiOpen.filter((d) => d.severity === "critical" || d.severity === "major");
  const scenarios = gen ? await readUiScenarios(gen) : null;

  const uiSection = uiRun
    ? [
        `UI 批跑：${uiRun.passed ? "通过" : "未通过"}（场景 ${uiRun.scenarioCount} · 失败步 ${uiRun.failed} · 新缺陷 ${uiRun.defectsWritten}）`,
        uiRun.skipped ? `跳过原因：${uiRun.skipped}` : "",
        uiRun.results
          .filter((r) => !r.ok)
          .slice(0, 8)
          .map((r) => `- ${r.scenarioId} 第 ${r.step} 步：${r.error || "失败"}`)
          .join("\n"),
      ]
        .filter(Boolean)
        .join("\n")
    : scenarios?.scenarios.length
      ? "UI 批跑：尚未执行（可调用 run_ui_acceptance）"
      : "UI 批跑：无 ui-scenarios.json";

  const defectTable =
    open.length === 0
      ? "（无 open 缺陷）"
      : open
          .slice(0, 12)
          .map(
            (d) =>
              `| ${d.id} | ${d.severity} | ${d.title} | ${d.status} | ${d.screenshotPath ? "有截图" : "—"} |`,
          )
          .join("\n");

  const markdown = [
    `# UI 验收汇总 · ${project.name}`,
    "",
    `更新时间：${new Date().toLocaleString()}`,
    "",
    "## 代码审查",
    "",
    reviewText,
    "",
    "## 需求门禁",
    "",
    reqEval.ok ? "逐项需求：已通过" : `逐项需求：未齐 — ${reqEval.message}`,
    "",
    "## UI Playwright",
    "",
    uiSection,
    "",
    "## 开放缺陷",
    "",
    "| ID | 严重度 | 标题 | 状态 | 截图 |",
    "| --- | --- | --- | --- | --- |",
    defectTable,
    "",
    blockerUi.length
      ? `> blocker 级 UI 缺陷 ${blockerUi.length} 条，发布门禁将阻断 UAT。`
      : "> 无 blocker 级 open UI 缺陷。",
    "",
  ].join("\n");

  if (gen) {
    const abs = joinRoot(gen, UI_ACCEPTANCE_REPORT_REL);
    await mkdirRecursive(gen, abs.replace(/[/\\][^/\\]+$/, ""));
    await writeTextUnderWorkspace(gen, abs, markdown);
  }

  const officeSummary = [
    `📊 UI 验收汇总 · ${project.name}`,
    reviewText,
    reqEval.ok ? "需求门禁：已通过" : `需求门禁：${reqEval.message}`,
    uiRun
      ? uiRun.passed
        ? "UI 批跑：通过"
        : `UI 批跑：${uiRun.failed} 步失败，已写入 defects`
      : "UI 批跑：待执行",
    open.length ? `开放缺陷 ${open.length} 条${blockerUi.length ? `（含 ${blockerUi.length} 条需优先修复）` : ""}` : "无 open 缺陷",
  ].join("\n");

  try {
    await appendFouMessage({
      sessionTag: OFFICE_SESSION,
      role: "system",
      content: officeSummary,
    });
  } catch {
    /* ignore */
  }

  return {
    markdown,
    officeSummary,
    hasBlockerUiDefect: blockerUi.length > 0,
    openUiDefectCount: uiOpen.length,
  };
}

/** 读取最新 UI 报告摘要（供 acceptanceReview 合并）。 */
export async function readUiAcceptanceReportExcerpt(generatePath: string): Promise<string> {
  const gen = generatePath.replace(/[/\\]+$/, "");
  if (!gen) return "";
  const abs = joinRoot(gen, UI_ACCEPTANCE_REPORT_REL);
  try {
    if (!(await exists(abs))) return "";
    const text = await readTextFile(abs);
    const lines = text.split("\n").slice(0, 24);
    return lines.join("\n");
  } catch {
    return "";
  }
}

/** 检查是否存在 blocker 级 open UI 缺陷（供 releaseGate）。 */
export async function hasOpenBlockerUiDefects(generatePath: string): Promise<{
  ok: boolean;
  count: number;
  message: string;
}> {
  const gen = generatePath.replace(/[/\\]+$/, "");
  if (!gen) return { ok: true, count: 0, message: "" };
  const defects = openDefects(await loadDefects(gen));
  const blockers = defects.filter(
    (d) =>
      (d.id.startsWith("ui_") || d.steps.includes("UI 验收")) &&
      (d.severity === "critical" || d.severity === "major"),
  );
  if (!blockers.length) return { ok: true, count: 0, message: "" };
  return {
    ok: false,
    count: blockers.length,
    message: `仍有 ${blockers.length} 条 UI 验收 blocker 缺陷未关闭（${blockers.map((d) => d.id).join("、")}）`,
  };
}
