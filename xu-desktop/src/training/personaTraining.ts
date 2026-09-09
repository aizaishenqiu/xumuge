/**
 * @file 语气示例训练（与 mcp-training.json 分离，不教工具用法）
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-31
 * @version 1.0.0
 * @category Config
 * @algo tone-scenario-hints
 */

import {
  joinTrainingFile,
  readTrainingRootOrThrow,
  readTrainingText,
  writeTrainingText,
} from "./trainingStore";

export type PersonaScenario = {
  id: string;
  toneId: string;
  title: string;
  userSay: string;
  expectedTone: string;
  promoted?: boolean;
};

export type PersonaTrainingDoc = {
  schemaVersion: 1;
  updatedAt: string;
  scenarios: PersonaScenario[];
};

const FILE_NAME = "persona-training.json";

let cache: PersonaTrainingDoc | null = null;
let loadPromise: Promise<PersonaTrainingDoc> | null = null;

function emptyDoc(): PersonaTrainingDoc {
  return { schemaVersion: 1, updatedAt: new Date().toISOString(), scenarios: [] };
}

export function personaTrainingPath(root: string): string {
  return joinTrainingFile(root, FILE_NAME);
}

/** 读取语气示例库；失败返回空文档，不阻断对话。 */
export async function loadPersonaTraining(force = false): Promise<PersonaTrainingDoc> {
  if (!force && cache) return cache;
  if (!force && loadPromise) return loadPromise;
  loadPromise = (async () => {
    try {
      const root = await readTrainingRootOrThrow();
      const raw = await readTrainingText(personaTrainingPath(root));
      const parsed = JSON.parse(raw) as PersonaTrainingDoc;
      cache = {
        schemaVersion: 1,
        updatedAt: parsed.updatedAt || new Date().toISOString(),
        scenarios: Array.isArray(parsed.scenarios) ? parsed.scenarios : [],
      };
      return cache;
    } catch {
      cache = emptyDoc();
      return cache;
    } finally {
      loadPromise = null;
    }
  })();
  return loadPromise;
}

/** 保存语气示例库到训练数据目录。 */
export async function savePersonaTraining(doc: PersonaTrainingDoc): Promise<void> {
  const root = await readTrainingRootOrThrow();
  const next: PersonaTrainingDoc = {
    ...doc,
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
  };
  await writeTrainingText(
    root,
    personaTrainingPath(root),
    JSON.stringify(next, null, 2),
  );
  cache = next;
}

/**
 * 取当前 toneId 已晋级场景的简要提示（同步，需先 loadPersonaTraining）。
 * 供 buildOralPersonaBlock 追加；无缓存或无匹配时返回空串。
 */
export function personaTrainingHintForTone(toneId: string): string {
  if (!cache?.scenarios.length) return "";
  const rows = cache.scenarios.filter(
    (s) => s.promoted !== false && s.toneId === toneId,
  );
  if (!rows.length) return "";
  const lines = rows
    .slice(0, 3)
    .map((s) => `· 用户「${s.userSay}」→ ${s.expectedTone}`)
    .join("\n");
  return `\n\n【语气示例参考】\n${lines}`;
}

/** 内置默认示例（首次无文件时展示，不写入 MCP）。 */
export function defaultPersonaScenarios(): PersonaScenario[] {
  return [
    {
      id: "demo-loli",
      toneId: "female-loli",
      title: "萝莉问天气",
      userSay: "今天适合出门吗？",
      expectedTone: "短句、软萌、先给结论再补一句理由",
      promoted: true,
    },
    {
      id: "demo-mature",
      toneId: "female-mature",
      title: "御姐报进度",
      userSay: "项目怎么样了？",
      expectedTone: "干脆、自信、先状态后风险",
      promoted: true,
    },
  ];
}
