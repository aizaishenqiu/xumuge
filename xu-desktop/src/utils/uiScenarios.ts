/**
 * @file 结构化 UI 验收场景（Playwright）schema 与读写
 * @author qiuye <yjk150@qq.com>
 * @date 2026-09-02
 * @version 1.0.0
 * @category Parse
 * @algo ui-scenario-schema-v1
 */
import { exists, readTextFile } from "@tauri-apps/plugin-fs";
import { getShowcaseBaseUrl } from "./appEnv";
import { mkdirRecursive, writeTextUnderWorkspace } from "./fsBridge";

export const UI_SCENARIOS_REL = ".xu/qa/ui-scenarios.json";

export type UiScenarioStepAction = "goto" | "open" | "click" | "type" | "assert" | "screenshot";

export interface UiScenarioStep {
  action: UiScenarioStepAction;
  url?: string;
  selector?: string;
  text?: string;
  /** assert 时期望：visible 或文本子串 */
  expect?: string;
  name?: string;
}

export interface UiScenario {
  id: string;
  title?: string;
  acceptanceId?: string;
  startUrl?: string;
  steps: UiScenarioStep[];
}

export interface UiScenariosFile {
  version: 1;
  baseUrl: string;
  scenarios: UiScenario[];
  updatedAt?: number;
}

export interface UiScenarioStepResult {
  scenarioId: string;
  step: number;
  ok: boolean;
  error?: string;
  screenshotPath?: string;
}

export interface UiScenarioRunResult {
  runId: string;
  passed: boolean;
  results: UiScenarioStepResult[];
  failed: number;
}

function joinRoot(root: string, sub: string): string {
  return `${root.replace(/[/\\]+$/, "")}/${sub.replace(/^[/\\]+/, "")}`.replace(/\\/g, "/");
}

export function emptyUiScenarios(baseUrl = getShowcaseBaseUrl()): UiScenariosFile {
  return { version: 1, baseUrl, scenarios: [], updatedAt: Date.now() };
}

export function parseUiScenarios(raw: string): UiScenariosFile {
  try {
    const o = JSON.parse(raw) as Partial<UiScenariosFile>;
    const scenarios = Array.isArray(o.scenarios)
      ? o.scenarios
          .map((s, i): UiScenario | null => {
            const id = String(s?.id || `scenario_${i + 1}`).trim();
            if (!id) return null;
            const steps = Array.isArray(s?.steps)
              ? s.steps
                  .map((st): UiScenarioStep | null => {
                    const action = String(st?.action || "").trim() as UiScenarioStepAction;
                    if (!["goto", "open", "click", "type", "assert", "screenshot"].includes(action)) {
                      return null;
                    }
                    return {
                      action,
                      url: st?.url != null ? String(st.url) : undefined,
                      selector: st?.selector != null ? String(st.selector) : undefined,
                      text: st?.text != null ? String(st.text) : undefined,
                      expect: st?.expect != null ? String(st.expect) : undefined,
                      name: st?.name != null ? String(st.name) : undefined,
                    };
                  })
                  .filter((x): x is UiScenarioStep => Boolean(x))
              : [];
            return {
              id,
              title: s?.title != null ? String(s.title) : undefined,
              acceptanceId: s?.acceptanceId != null ? String(s.acceptanceId) : undefined,
              startUrl: s?.startUrl != null ? String(s.startUrl) : undefined,
              steps,
            };
          })
          .filter((x): x is UiScenario => Boolean(x))
      : [];
    const fallback = getShowcaseBaseUrl();
    return {
      version: 1,
      baseUrl: String(o.baseUrl || fallback).trim() || fallback,
      scenarios,
      updatedAt: Number(o.updatedAt) || Date.now(),
    };
  } catch {
    return emptyUiScenarios();
  }
}

export async function readUiScenarios(generatePath: string): Promise<UiScenariosFile | null> {
  const gen = generatePath.replace(/[/\\]+$/, "");
  if (!gen) return null;
  const abs = joinRoot(gen, UI_SCENARIOS_REL);
  try {
    if (!(await exists(abs))) return null;
    return parseUiScenarios(await readTextFile(abs));
  } catch {
    return null;
  }
}

export async function writeUiScenarios(generatePath: string, doc: UiScenariosFile): Promise<void> {
  const gen = generatePath.replace(/[/\\]+$/, "");
  const abs = joinRoot(gen, UI_SCENARIOS_REL);
  await mkdirRecursive(gen, abs.replace(/[/\\][^/\\]+$/, ""));
  const payload: UiScenariosFile = { ...doc, version: 1, updatedAt: Date.now() };
  await writeTextUnderWorkspace(gen, abs, JSON.stringify(payload, null, 2));
}
