/**
 * @file 成熟项目案例收割 → 课程/MCP 草稿
 * @author qiuye <yjk150@qq.com>
 * @date 2026-09-02
 * @version 1.0.0
 * @category AgentLoop
 * @algo case-harvest-from-done-project
 */
import { loadBrief } from "../intent/briefStore";
import { migrateLegacyRequirements } from "../intent/briefTypes";
import type { XuProject } from "../utils/projects";
import { loadProjects } from "../utils/projects";
import { readRequirementsGate } from "../utils/requirementsGate";
import { readUiScenarios } from "../utils/uiScenarios";
import {
  createCurriculumVersion,
  type PromotionDecision,
} from "./roleTraining";
import {
  loadCurriculum,
  type CurriculumDoc,
  type CurriculumEntry,
} from "../commerce/trainingLocal";
import { loadTrainingOutcomes } from "./outcomes";
import {
  appendCaseLibraryEntry,
  type CaseLibraryEntry,
  loadCaseLibrary,
} from "./caseLibrary";
import {
  loadMcpTraining,
  saveMcpTraining,
  upsertMcpTrainingRecord,
  type McpTrainingDoc,
} from "./mcpTraining";

export interface CaseHarvestDraft {
  caseEntry: CaseLibraryEntry;
  curriculumEntry?: CurriculumEntry;
  mcpHint?: string;
}

function clip(s: string, n = 400): string {
  const t = s.trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

function passedAcceptanceIds(project: XuProject, briefAcceptance: string[]): string[] {
  return briefAcceptance.slice(0, 12);
}

/** 从已验收/ done 项目采集 candidate 行（不自动晋级）。 */
export async function appendCaseLibraryCandidate(project: XuProject): Promise<CaseLibraryEntry | null> {
  const brief = await loadBrief(project.id);
  const gen = (project.generatePath || "").trim();
  const gate = gen ? await readRequirementsGate(gen) : null;
  const ui = gen ? await readUiScenarios(gen) : null;
  const outcomes = await loadTrainingOutcomes();
  const passed = outcomes.outcomes.filter(
    (o) => o.projectId === project.id && o.status === "passed",
  );
  const toolChain = [
    ...new Set(passed.flatMap((o) => o.tools.map((t) => t.name)).filter(Boolean)),
  ].slice(0, 24);
  const roleId = passed[0]?.roleId || project.type || "software-general";
  const entry: CaseLibraryEntry = {
    id: `case_${project.id}_${Date.now()}`,
    title: `${project.name} · 验收通过案例`,
    industry: project.type,
    roleId,
    status: "candidate",
    source: {
      projectId: project.id,
      briefExcerpt: clip(brief.goal || brief.acceptance.join("；") || project.name),
      acceptanceIds: passedAcceptanceIds(
        project,
        migrateLegacyRequirements(brief).flatMap((r) =>
          r.acceptanceCriteria.filter((c) => c.status === "passed").map((c) => c.id),
        ),
      ),
    },
    golden: {
      taskInput: clip(passed[0]?.taskInput || brief.goal || ""),
      planOutline: clip(passed[0]?.plan || ""),
      toolChain,
      artifacts: brief.acceptance.slice(0, 8),
    },
    rubric: {
      mustHit: brief.acceptance.slice(0, 8),
      mustNot: ["跳过 Review/QA", "未勾选 UAT 即结项"],
    },
    uiScenarios: ui?.scenarios,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  if (gate && !entry.source.acceptanceIds.length) {
    entry.source.acceptanceIds = gate.requirements
      .flatMap((r) => r.acceptance.filter((a) => a.status === "passed").map((a) => a.id))
      .slice(0, 12);
  }
  await appendCaseLibraryEntry(entry);
  return entry;
}

/** 列出可收割的 done / 验收通过项目。 */
export async function listHarvestableProjects(): Promise<XuProject[]> {
  const all = await loadProjects();
  return all.filter(
    (p) =>
      p.type === "software" &&
      (p.workflow?.state === "done" ||
        p.workflow?.state === "acceptance" ||
        p.workflow?.state === "requirements"),
  );
}

/** 从 candidate 生成岗位课程 draft + 可选 MCP 场景草稿。 */
export async function harvestCaseToDrafts(caseId: string): Promise<CaseHarvestDraft | null> {
  const lib = await loadCaseLibrary();
  const entry = lib.entries.find((e) => e.id === caseId);
  if (!entry) return null;
  const curriculumDoc = await loadCurriculum();
  const curriculumEntry = await createCurriculumVersion(curriculumDoc, {
    scope: "role",
    roleId: entry.roleId,
    title: entry.title,
    wave: "成熟案例",
    knowledgeDocs: [],
    cases: [
      {
        id: `${entry.id}_case`,
        title: entry.title,
        input: entry.golden.taskInput || entry.source.briefExcerpt,
        expected: entry.rubric.mustHit.join("；") || "对照 Brief 验收",
      },
    ],
    counterExamples: entry.rubric.mustNot.map((n, i) => ({
      id: `${entry.id}_counter_${i + 1}`,
      title: n,
      input: entry.golden.taskInput,
      expected: `禁止：${n}`,
    })),
    rubricSpec: {
      passScore: 80,
      criteria: entry.rubric.mustHit.map((h, i) => ({
        id: `hit_${i + 1}`,
        title: h,
        weight: Math.floor(100 / Math.max(1, entry.rubric.mustHit.length)),
        requirement: h,
      })),
    },
    taskExample: entry.golden.taskInput,
    rubric: entry.rubric.mustHit.join("；"),
  });
  entry.status = "draft";
  entry.updatedAt = new Date().toISOString();
  await appendCaseLibraryEntry(entry);

  let mcpHint = "";
  if (entry.golden.toolChain.length) {
    let mcpDoc: McpTrainingDoc = await loadMcpTraining();
    for (const tool of entry.golden.toolChain.slice(0, 6)) {
      mcpDoc = upsertMcpTrainingRecord(mcpDoc, {
        toolName: tool,
        serverId: tool.startsWith("mcp__") ? tool.replace(/^mcp__/, "").split("__")[0] || "mcp" : "builtin",
        tool: tool.startsWith("mcp__") ? tool.replace(/^mcp__/, "").split("__").slice(1).join("__") || tool : tool,
        priority: 3,
        roleIds: [],
        whenToUse: `成熟案例「${entry.title}」中曾成功调用`,
        example: entry.golden.taskInput.slice(0, 200),
        status: "draft",
        version: 0,
        playbookSteps: [],
      });
    }
    await saveMcpTraining(mcpDoc);
    mcpHint = `已写入 ${Math.min(6, entry.golden.toolChain.length)} 条 MCP playbook 草稿`;
  }

  return { caseEntry: entry, curriculumEntry, mcpHint };
}

export async function listCaseCandidates(): Promise<CaseLibraryEntry[]> {
  const doc = await loadCaseLibrary();
  return doc.entries.filter((e) => e.status === "candidate" || e.status === "draft");
}

export type { PromotionDecision };
