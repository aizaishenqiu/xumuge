/**
 * @file Playwright UI 验收批跑与缺陷写入
 * @author qiuye <yjk150@qq.com>
 * @date 2026-09-02
 * @version 1.0.0
 * @category AgentLoop
 * @algo ui-scenario-batch-runner
 */
import { invoke } from "@tauri-apps/api/core";
import type { QaDefect } from "./qaDefects";
import { appendDefect } from "./workflowQa";
import { readRequirementsGate } from "./requirementsGate";
import {
  readUiScenarios,
  UI_SCENARIOS_REL,
  type UiScenarioRunResult,
  type UiScenarioStepResult,
} from "./uiScenarios";

export interface UiAcceptanceRunSummary extends UiScenarioRunResult {
  scenarioCount: number;
  defectsWritten: number;
  skipped?: string;
}

function parseRunnerOutput(raw: string): UiScenarioRunResult | null {
  try {
    const o = JSON.parse(raw) as Partial<UiScenarioRunResult & { ok?: boolean; error?: string }>;
    if (o.ok === false) return null;
    const results = Array.isArray(o.results) ? (o.results as UiScenarioStepResult[]) : [];
    return {
      runId: String(o.runId || Date.now()),
      passed: o.passed === true,
      failed: Number(o.failed) || results.filter((r) => !r.ok).length,
      results,
    };
  } catch {
    return null;
  }
}

function defectFromStep(
  step: UiScenarioStepResult,
  acceptanceId?: string,
): QaDefect {
  const id = `ui_${step.scenarioId}_${step.step}_${Date.now()}`;
  return {
    id,
    title: `UI 验收失败 · ${step.scenarioId} 第 ${step.step} 步`,
    severity: "major",
    type: "bug",
    steps: [
      `场景 ${step.scenarioId}`,
      `步骤 ${step.step}`,
      acceptanceId ? `验收项 ${acceptanceId}` : "",
      step.error || "断言或操作失败",
    ]
      .filter(Boolean)
      .join("；"),
    expected: "步骤通过",
    actual: step.error || "失败",
    screenshotPath: step.screenshotPath,
    status: "open",
  };
}

/** 批跑 `.xu/qa/ui-scenarios.json`；失败项写入 `.xu/defects.jsonl`。 */
export async function runUiAcceptance(generatePath: string): Promise<UiAcceptanceRunSummary> {
  const gen = generatePath.replace(/[/\\]+$/, "");
  if (!gen) {
    return {
      runId: "",
      passed: false,
      failed: 0,
      results: [],
      scenarioCount: 0,
      defectsWritten: 0,
      skipped: "无工作区路径",
    };
  }
  const scenariosDoc = await readUiScenarios(gen);
  if (!scenariosDoc?.scenarios.length) {
    return {
      runId: "",
      passed: false,
      failed: 0,
      results: [],
      scenarioCount: 0,
      defectsWritten: 0,
      skipped: `缺少 ${UI_SCENARIOS_REL} 或无场景`,
    };
  }
  const runId = String(Date.now());
  let raw = "";
  try {
    raw = await invoke<string>("xu_run_qa_browser", {
      workspace: gen,
      payload: {
        action: "run-scenario",
        workspace: gen,
        runId,
        scenariosFile: UI_SCENARIOS_REL,
        baseUrl: scenariosDoc.baseUrl,
      },
    });
  } catch (e) {
    return {
      runId,
      passed: false,
      failed: 0,
      results: [],
      scenarioCount: scenariosDoc.scenarios.length,
      defectsWritten: 0,
      skipped: String(e),
    };
  }
  const parsed = parseRunnerOutput(raw);
  if (!parsed) {
    return {
      runId,
      passed: false,
      failed: 0,
      results: [],
      scenarioCount: scenariosDoc.scenarios.length,
      defectsWritten: 0,
      skipped: raw.slice(0, 200) || "批跑无有效结果",
    };
  }
  const acceptanceByScenario = new Map(
    scenariosDoc.scenarios.map((s) => [s.id, s.acceptanceId]),
  );
  let defectsWritten = 0;
  for (const row of parsed.results.filter((r) => !r.ok)) {
    const acceptanceId = acceptanceByScenario.get(row.scenarioId);
    await appendDefect(gen, defectFromStep(row, acceptanceId));
    defectsWritten += 1;
  }
  void readRequirementsGate(gen);
  return {
    ...parsed,
    scenarioCount: scenariosDoc.scenarios.length,
    defectsWritten,
  };
}
