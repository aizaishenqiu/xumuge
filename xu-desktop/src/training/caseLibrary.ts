/**
 * @file 成熟案例库 case-library.json 读写
 * @author qiuye <yjk150@qq.com>
 * @date 2026-09-02
 * @version 1.0.0
 * @category DB
 * @algo case-library-v1
 */
import type { UiScenario } from "../utils/uiScenarios";
import {
  ensureTrainingDirsAt,
  readTrainingRootOrThrow,
  readTrainingText,
  touchTrainingManifest,
  writeTrainingText,
} from "./trainingStore";

export const CASE_LIBRARY_FILE = "case-library.json";

export type CaseLibraryStatus = "candidate" | "draft" | "promoted" | "retired";

export interface CaseLibraryGolden {
  taskInput: string;
  planOutline: string;
  toolChain: string[];
  artifacts: string[];
}

export interface CaseLibraryRubric {
  mustHit: string[];
  mustNot: string[];
}

export interface CaseLibraryEntry {
  id: string;
  title: string;
  industry?: string;
  roleId: string;
  status: CaseLibraryStatus;
  source: {
    projectId: string;
    briefExcerpt: string;
    acceptanceIds: string[];
  };
  golden: CaseLibraryGolden;
  rubric: CaseLibraryRubric;
  uiScenarios?: UiScenario[];
  createdAt: string;
  updatedAt: string;
}

export interface CaseLibraryDoc {
  version: 1;
  updatedAt: string;
  entries: CaseLibraryEntry[];
}

export function caseLibraryPath(root: string): string {
  return `${root.replace(/[/\\]+$/, "")}/${CASE_LIBRARY_FILE}`;
}

export function emptyCaseLibrary(): CaseLibraryDoc {
  return { version: 1, updatedAt: new Date().toISOString(), entries: [] };
}

export function parseCaseLibrary(raw: string): CaseLibraryDoc {
  try {
    const o = JSON.parse(raw) as Partial<CaseLibraryDoc>;
    const entries = Array.isArray(o.entries)
      ? o.entries
          .map((e, i): CaseLibraryEntry | null => {
            const id = String(e?.id || `case_${i + 1}`).trim();
            const roleId = String(e?.roleId || "").trim();
            if (!id || !roleId) return null;
            return {
              id,
              title: String(e?.title || "成熟案例").trim(),
              industry: e?.industry != null ? String(e.industry) : undefined,
              roleId,
              status:
                e?.status === "draft" || e?.status === "promoted" || e?.status === "retired"
                  ? e.status
                  : "candidate",
              source: {
                projectId: String(e?.source?.projectId || "").trim(),
                briefExcerpt: String(e?.source?.briefExcerpt || "").trim(),
                acceptanceIds: Array.isArray(e?.source?.acceptanceIds)
                  ? e.source!.acceptanceIds!.map(String).filter(Boolean)
                  : [],
              },
              golden: {
                taskInput: String(e?.golden?.taskInput || "").trim(),
                planOutline: String(e?.golden?.planOutline || "").trim(),
                toolChain: Array.isArray(e?.golden?.toolChain)
                  ? e.golden!.toolChain!.map(String).filter(Boolean)
                  : [],
                artifacts: Array.isArray(e?.golden?.artifacts)
                  ? e.golden!.artifacts!.map(String).filter(Boolean)
                  : [],
              },
              rubric: {
                mustHit: Array.isArray(e?.rubric?.mustHit)
                  ? e.rubric!.mustHit!.map(String).filter(Boolean)
                  : [],
                mustNot: Array.isArray(e?.rubric?.mustNot)
                  ? e.rubric!.mustNot!.map(String).filter(Boolean)
                  : [],
              },
              uiScenarios: Array.isArray(e?.uiScenarios) ? (e.uiScenarios as UiScenario[]) : undefined,
              createdAt: String(e?.createdAt || new Date().toISOString()),
              updatedAt: String(e?.updatedAt || new Date().toISOString()),
            };
          })
          .filter((x): x is CaseLibraryEntry => Boolean(x))
      : [];
    return {
      version: 1,
      updatedAt: String(o.updatedAt || new Date().toISOString()),
      entries,
    };
  } catch {
    return emptyCaseLibrary();
  }
}

export async function loadCaseLibrary(): Promise<CaseLibraryDoc> {
  const root = await readTrainingRootOrThrow();
  const path = caseLibraryPath(root);
  try {
    return parseCaseLibrary(await readTrainingText(path));
  } catch {
    return emptyCaseLibrary();
  }
}

export async function saveCaseLibrary(doc: CaseLibraryDoc): Promise<void> {
  const root = await readTrainingRootOrThrow();
  await ensureTrainingDirsAt(root);
  const payload: CaseLibraryDoc = {
    ...doc,
    version: 1,
    updatedAt: new Date().toISOString(),
  };
  await writeTrainingText(root, caseLibraryPath(root), JSON.stringify(payload, null, 2));
  await touchTrainingManifest(root);
}

export async function appendCaseLibraryEntry(entry: CaseLibraryEntry): Promise<void> {
  const doc = await loadCaseLibrary();
  const idx = doc.entries.findIndex((e) => e.id === entry.id);
  if (idx >= 0) {
    doc.entries[idx] = { ...entry, updatedAt: new Date().toISOString() };
  } else {
    doc.entries = [...doc.entries, entry];
  }
  await saveCaseLibrary(doc);
}
