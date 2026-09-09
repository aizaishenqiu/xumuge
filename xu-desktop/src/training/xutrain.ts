/**
 * @file `.xutrain` ZIP 导入导出、兼容旧 JSON 与敏感样本排除
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-31
 * @version 2.0.0
 * @category Crypto
 * @algo SHA256-manifest
 */
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  loadCurriculum,
  migrateCurriculum,
  saveCurriculum,
  type CurriculumDoc,
  type CurriculumEntry,
} from "../commerce/trainingLocal";
import {
  loadMcpTraining,
  saveMcpTraining,
  type McpTrainingDoc,
  type McpToolTrainingRecord,
} from "./mcpTraining";
import {
  listEvalRuns,
  mergeEvalArtifacts,
  type EvalRun,
  type EvalSuite,
} from "./roleTrainingEval";
import {
  loadTrainingOutcomes,
  mergeTrainingOutcomes,
  type TrainingOutcome,
} from "./outcomes";
import {
  ensureTrainingDirsAt,
  joinTrainingFile,
  readTrainingRootOrThrow,
  readTrainingText,
  touchTrainingManifest,
  evalSuitesPath,
} from "./trainingStore";

export type FoutrainManifest = {
  schemaVersion: 2;
  format: "xutrain";
  id: string;
  version: string;
  exportedAt: string;
  privacy: "desensitized";
  purpose: "prompt_boost";
  /** Only user-authored MCP tips + curriculum — no bundled software data */
  contentScope: "user_training_only";
  stats: {
    mcpTools: number;
    curriculumEntries: number;
    outcomes: number;
    evalRuns: number;
    sensitiveExcluded: number;
  };
};

export type FoutrainPack = {
  manifest: FoutrainManifest;
  mcpTraining: McpTrainingDoc;
  curriculum: CurriculumDoc;
  outcomes?: TrainingOutcome[];
  evalSuites?: EvalSuite[];
  evalRuns?: EvalRun[];
};

function hasMcpContent(t: McpToolTrainingRecord): boolean {
  return Boolean(
    t.whenToUse?.trim() ||
      t.example?.trim() ||
      t.notes?.trim() ||
      t.antiPatterns?.trim() ||
      t.workflowSteps?.length ||
      t.playbookSteps?.length ||
      t.scenarios?.length,
  );
}

function mergeMcpTools(
  base: McpToolTrainingRecord[],
  incoming: McpToolTrainingRecord[],
): McpToolTrainingRecord[] {
  const key = (tool: McpToolTrainingRecord) => `${tool.toolName}:v${tool.version || 1}`;
  const map = new Map(base.map((t) => [key(t), t]));
  for (const t of incoming.filter(hasMcpContent)) {
    const prev = map.get(key(t));
    map.set(
      key(t),
      prev
        ? {
            ...t,
            ...prev,
            playbookSteps: prev.playbookSteps?.length ? prev.playbookSteps : t.playbookSteps,
            scenarios: prev.scenarios?.length ? prev.scenarios : t.scenarios,
          }
        : t,
    );
  }
  return [...map.values()];
}

export function mergeCurriculumEntries(
  base: CurriculumEntry[],
  incoming: CurriculumEntry[],
): CurriculumEntry[] {
  const key = (e: CurriculumEntry) =>
    `${e.scope}:${e.employeeId || e.roleId}:v${e.version}`;
  const map = new Map(base.map((e) => [key(e), e]));
  for (const e of incoming) {
    if (!e.taskExample?.trim()) continue;
    if (!map.has(key(e))) map.set(key(e), e);
  }
  return [...map.values()];
}

/** 构建仅含用户内容的 manifest 视图；依赖本机课程/outcome/eval，敏感结果会排除。 */
export async function buildFoutrainPack(): Promise<FoutrainPack> {
  const mcpTraining = await loadMcpTraining();
  const curriculum = await loadCurriculum();
  const outcomes = await loadTrainingOutcomes();
  const evalRuns = await listEvalRuns();
  const usableMcp = mcpTraining.tools.filter(hasMcpContent);
  const userCurriculum = {
    ...curriculum,
    entries: curriculum.entries.filter((e) => e.taskExample?.trim()),
  };
  const safeOutcomes = outcomes.outcomes.filter((outcome) => !outcome.sensitive);
  return {
    manifest: {
      schemaVersion: 2,
      format: "xutrain",
      id: `xutrain_${Date.now()}`,
      version: "2.0.0",
      exportedAt: new Date().toISOString(),
      privacy: "desensitized",
      purpose: "prompt_boost",
      contentScope: "user_training_only",
      stats: {
        mcpTools: usableMcp.length,
        curriculumEntries: userCurriculum.entries.length,
        outcomes: safeOutcomes.length,
        evalRuns: evalRuns.length,
        sensitiveExcluded: outcomes.outcomes.length - safeOutcomes.length,
      },
    },
    mcpTraining: { ...mcpTraining, tools: usableMcp },
    curriculum: userCurriculum,
  };
}

export function isFoutrainPackEmpty(pack: FoutrainPack): boolean {
  const mcp = pack.mcpTraining?.tools?.length ?? 0;
  const cur = pack.curriculum?.entries?.length ?? 0;
  const outcomes = pack.manifest?.stats?.outcomes ?? 0;
  return mcp === 0 && cur === 0 && outcomes === 0;
}

/** 合并已校验训练包；同 id/同版本本机优先，失败时由调用页 fouAlert。 */
export async function mergeFoutrainPack(pack: FoutrainPack): Promise<{
  mcp: number;
  curriculum: number;
  outcomes: number;
  evalRuns: number;
}> {
  const mcpDoc = await loadMcpTraining();
  const curDoc = await loadCurriculum();
  const beforeMcp = mcpDoc.tools.length;
  const beforeCur = curDoc.entries.length;

  mcpDoc.tools = mergeMcpTools(mcpDoc.tools, pack.mcpTraining?.tools || []);
  const incomingCurriculum = migrateCurriculum(pack.curriculum || {});
  curDoc.entries = mergeCurriculumEntries(curDoc.entries, incomingCurriculum.entries);
  for (const [key, version] of Object.entries(incomingCurriculum.activeVersions)) {
    if (!curDoc.activeVersions[key]) curDoc.activeVersions[key] = version;
  }
  if (incomingCurriculum.industry?.trim() && !curDoc.industry?.trim()) {
    curDoc.industry = incomingCurriculum.industry.trim();
  }

  await saveMcpTraining(mcpDoc);
  await saveCurriculum(curDoc);
  const outcomes = await mergeTrainingOutcomes(pack.outcomes || []);
  const evalMerged = await mergeEvalArtifacts(pack.evalSuites || [], pack.evalRuns || []);
  const root = await readTrainingRootOrThrow();
  await touchTrainingManifest(root);

  return {
    mcp: mcpDoc.tools.length - beforeMcp,
    curriculum: curDoc.entries.length - beforeCur,
    outcomes,
    evalRuns: evalMerged.runs,
  };
}

/** Export directly into configured training directory (same as read path). */
export async function exportFoutrainToFile(opts?: {
  /** When true, allow empty pack (skeleton README only). */
  allowEmpty?: boolean;
}): Promise<string | null> {
  const root = await readTrainingRootOrThrow();
  await ensureTrainingDirsAt(root);
  const pack = await buildFoutrainPack();
  if (!opts?.allowEmpty && isFoutrainPackEmpty(pack)) {
    throw new Error("EMPTY_PACK");
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const filename = `training-${stamp}.xutrain`;
  const path = joinTrainingFile(root, filename);
  const outcomes = await loadTrainingOutcomes();
  const safeOutcomes = outcomes.outcomes.filter((outcome) => !outcome.sensitive);
  const evalRuns = await listEvalRuns();
  let suites: unknown = { version: 1, suites: [] };
  try {
    suites = JSON.parse(await readTrainingText(evalSuitesPath(root)));
  } catch {
    /* no fixed suite yet */
  }
  const empty = isFoutrainPackEmpty(pack);
  const readme = empty
    ? `# 虚募阁训练包（骨架）

本包几乎为空，用于了解目录结构。

## 怎么用

1. 在「本机完整训练」下载**员工训练模板**或**扩展工具训练模板**。
2. 填写后点保存 → 运行评测 → **晋级**（晋级后才会注入派活）。
3. 再点「导出训练包」得到含课程与工具用法的完整训练包。

## 保存位置

训练数据保存在您选择的训练资料目录（默认在应用数据目录下）。升级软件不会覆盖。

## 聪明度

换更强模型请到「设置 → 模型」。训练只教「何时用工具 / 怎么做事」，不替代模型本身。
`
    : `# 虚募阁训练包

本包仅含用户训练内容；敏感轨迹默认排除。导入时本机现有同版本内容优先，不覆盖已有修改。

- 扩展工具用法：须「评测并晋级」后才注入 Agent
- 员工课程：须「晋级」后才注入派活提示
- 更聪明：设置 → 模型（三脑）
`;
  return invoke<string>("xu_training_write_pack", {
    path,
    files: [
      { name: "manifest.json", content: JSON.stringify(pack.manifest, null, 2) },
      { name: "curriculum.json", content: JSON.stringify(pack.curriculum, null, 2) },
      { name: "playbooks.json", content: JSON.stringify(pack.mcpTraining, null, 2) },
      {
        name: "samples/outcomes.json",
        content: JSON.stringify({ version: 1, outcomes: safeOutcomes }, null, 2),
      },
      { name: "eval/suites.json", content: JSON.stringify(suites, null, 2) },
      { name: "eval/runs.json", content: JSON.stringify({ version: 1, runs: evalRuns }, null, 2) },
      { name: "README.md", content: readme },
    ],
  });
}

/** 选择并导入 `.xutrain` 或旧 JSON；ZIP checksum 不通过时拒绝合并。 */
export async function importFoutrainFromFile(): Promise<{
  path: string;
  merged: { mcp: number; curriculum: number; outcomes: number; evalRuns: number };
} | null> {
  const root = await readTrainingRootOrThrow();
  await ensureTrainingDirsAt(root);
  const picked = await openDialog({
    defaultPath: root,
    multiple: false,
    filters: [{ name: "虚募阁训练包", extensions: ["xutrain", "json"] }],
    title: "从训练目录导入并合并（仅用户训练数据）",
  });
  if (!picked || typeof picked !== "string") return null;
  let pack: FoutrainPack;
  if (picked.toLowerCase().endsWith(".xutrain")) {
    const result = await invoke<{
      files: Array<{ name: string; content: string }>;
      verified: boolean;
    }>("xu_training_read_pack", { path: picked });
    if (!result.verified) throw new Error("训练包完整性校验失败");
    const files = new Map(result.files.map((entry) => [entry.name, entry.content]));
    const manifest = JSON.parse(files.get("manifest.json") || "{}") as FoutrainManifest;
    const curriculum = JSON.parse(files.get("curriculum.json") || "{}") as CurriculumDoc;
    const mcpTraining = JSON.parse(files.get("playbooks.json") || "{}") as McpTrainingDoc;
    const outcomeDoc = JSON.parse(files.get("samples/outcomes.json") || "{}") as {
      outcomes?: TrainingOutcome[];
    };
    const suiteDoc = JSON.parse(files.get("eval/suites.json") || "{}") as {
      suites?: EvalSuite[];
    };
    const runDoc = JSON.parse(files.get("eval/runs.json") || "{}") as {
      runs?: EvalRun[];
    };
    pack = {
      manifest,
      curriculum,
      mcpTraining,
      outcomes: outcomeDoc.outcomes || [],
      evalSuites: suiteDoc.suites || [],
      evalRuns: runDoc.runs || [],
    };
  } else {
    const raw = await readTrainingText(picked);
    const legacy = JSON.parse(raw) as FoutrainPack & { manifest?: Partial<FoutrainManifest> };
    pack = {
      ...legacy,
      manifest: {
        schemaVersion: 2,
        format: "xutrain",
        id: `legacy_${Date.now()}`,
        version: "1.0.0",
        exportedAt: legacy.manifest?.exportedAt || new Date().toISOString(),
        privacy: "desensitized",
        purpose: "prompt_boost",
        contentScope: "user_training_only",
        stats: {
          mcpTools: legacy.mcpTraining?.tools?.length || 0,
          curriculumEntries: legacy.curriculum?.entries?.length || 0,
          outcomes: 0,
          evalRuns: 0,
          sensitiveExcluded: 0,
        },
      },
      curriculum: migrateCurriculum(legacy.curriculum || {}),
    };
  }
  if (!pack?.mcpTraining && !pack?.curriculum) {
    throw new Error("不是有效的 .xutrain.json 训练包");
  }
  const merged = await mergeFoutrainPack(pack);
  return { path: picked, merged };
}

export { trainingDataRootLabel } from "./trainingDirPrefs";
