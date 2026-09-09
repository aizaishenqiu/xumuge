/**
 * @file 本机训练样本与岗位课程版本库
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-31
 * @version 2.0.0
 * @category DB
 * @algo role-template-employee-override
 */
import { invoke } from "@tauri-apps/api/core";
import {
  curriculumPath,
  ensureTrainingDirsAt,
  readTrainingRootOrThrow,
  readTrainingText,
  samplesPath,
  touchTrainingManifest,
  writeTrainingText,
} from "../training/trainingStore";
import { resolveTrainingDataRoot } from "../training/trainingDirPrefs";

export type TrainingSampleRow = {
  at: string;
  kind: string;
  industry?: string;
  projectId?: string;
  wave?: string;
  roleId?: string;
  summary?: string;
  meta?: Record<string, unknown>;
  sensitive?: boolean;
};

export function sanitizeTrainingSample(row: unknown): TrainingSampleRow {
  const o = row && typeof row === "object" ? (row as Record<string, unknown>) : {};
  let sensitive = o.sensitive === true;
  const clip = (v: unknown, n = 400) => {
    let s = String(v ?? "").trim();
    for (const pattern of [
      /bearer\s+[a-z0-9._~+/=-]+/gi,
      /(?:api[_-]?key|secret|password|token)["']?\s*[:=]\s*["']?[^,\s"']+/gi,
      /\b(?:sk|ghp|glpat)-[a-z0-9_-]{12,}\b/gi,
    ]) {
      s = s.replace(pattern, () => {
        sensitive = true;
        return "[REDACTED]";
      });
    }
    return s.length > n ? `${s.slice(0, n)}…` : s;
  };
  const clean: TrainingSampleRow = {
    at: typeof o.at === "string" ? o.at : new Date().toISOString(),
    kind: clip(o.kind || "unknown", 64),
    industry: o.industry != null ? clip(o.industry, 32) : undefined,
    projectId: o.projectId != null ? clip(o.projectId, 64) : undefined,
    wave: o.wave != null ? clip(o.wave, 32) : undefined,
    roleId: o.roleId != null ? clip(o.roleId, 80) : undefined,
    summary: o.summary != null ? clip(o.summary, 500) : undefined,
    meta:
      o.meta && typeof o.meta === "object"
        ? Object.fromEntries(
            Object.entries(o.meta as Record<string, unknown>)
              .slice(0, 12)
              .map(([k, v]) => [k, clip(v, 120)]),
          )
        : undefined,
  };
  clean.sensitive = sensitive;
  return clean;
}

export async function appendLocalTrainingSample(row: unknown): Promise<void> {
  const root = await readTrainingRootOrThrow();
  await ensureTrainingDirsAt(root);
  const path = samplesPath(root);
  const line = JSON.stringify(sanitizeTrainingSample(row));
  await invoke("append_text_line", { path, line });
}

export async function listLocalTrainingSamples(limit = 200): Promise<TrainingSampleRow[]> {
  const root = await resolveTrainingDataRoot();
  if (!root) return [];
  try {
    const raw = await readTrainingText(samplesPath(root));
    const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const out: TrainingSampleRow[] = [];
    for (const line of lines.slice(-limit)) {
      try {
        out.push(sanitizeTrainingSample(JSON.parse(line)));
      } catch {
        /* skip */
      }
    }
    return out.reverse();
  } catch {
    return [];
  }
}

export type CurriculumCase = {
  id: string;
  title: string;
  input: string;
  expected: string;
  sensitive?: boolean;
};

export type CurriculumRubricCriterion = {
  id: string;
  title: string;
  weight: number;
  requirement: string;
};

export type CurriculumEntry = {
  id: string;
  scope: "role" | "employee";
  roleId: string;
  employeeId?: string;
  version: number;
  status: "draft" | "active" | "retired";
  title: string;
  wave: string;
  knowledgeDocs: string[];
  cases: CurriculumCase[];
  counterExamples: CurriculumCase[];
  rubricSpec: {
    passScore: number;
    criteria: CurriculumRubricCriterion[];
  };
  createdAt: string;
  taskExample: string;
  rubric: string;
};

export type CurriculumDoc = {
  version: 2;
  industry: string;
  updatedAt: string;
  activeVersions: Record<string, number>;
  entries: CurriculumEntry[];
};

function scopeKey(entry: Pick<CurriculumEntry, "scope" | "roleId" | "employeeId">): string {
  return entry.scope === "employee"
    ? `employee:${entry.employeeId || ""}`
    : `role:${entry.roleId}`;
}

function normalizeCase(raw: Partial<CurriculumCase>, prefix: string, index: number): CurriculumCase {
  return {
    id: String(raw.id || `${prefix}_${index + 1}`),
    title: String(raw.title || `案例 ${index + 1}`).trim(),
    input: String(raw.input || "").trim(),
    expected: String(raw.expected || "").trim(),
    sensitive: raw.sensitive === true,
  };
}

function normalizeEntry(
  raw: Partial<CurriculumEntry> & { roleId?: string },
  index: number,
): CurriculumEntry | null {
  const roleId = String(raw.roleId || "").trim();
  if (!roleId) return null;
  const employeeId = String(raw.employeeId || "").trim() || undefined;
  const scope = raw.scope === "employee" && employeeId ? "employee" : "role";
  const version = Math.max(1, Math.floor(Number(raw.version) || 1));
  const legacyRubric = String(raw.rubric || "对照 Brief 验收").trim();
  const taskExample = String(raw.taskExample || "").trim();
  const cases = Array.isArray(raw.cases)
    ? raw.cases.map((item, i) => normalizeCase(item || {}, `case_${index}`, i))
    : taskExample
      ? [{ id: `legacy_case_${index + 1}`, title: "旧课程案例", input: taskExample, expected: legacyRubric }]
      : [];
  const counterExamples = Array.isArray(raw.counterExamples)
    ? raw.counterExamples.map((item, i) => normalizeCase(item || {}, `counter_${index}`, i))
    : [];
  const criteria = Array.isArray(raw.rubricSpec?.criteria)
    ? raw.rubricSpec.criteria.map((item, i) => ({
        id: String(item?.id || `criterion_${i + 1}`),
        title: String(item?.title || `标准 ${i + 1}`).trim(),
        weight: Math.max(0, Number(item?.weight) || 0),
        requirement: String(item?.requirement || "").trim(),
      }))
    : [{ id: "legacy_acceptance", title: "验收标准", weight: 100, requirement: legacyRubric }];
  return {
    id: String(raw.id || `${scope}_${employeeId || roleId}_v${version}`).trim(),
    scope,
    roleId,
    employeeId,
    version,
    status: raw.status === "draft" || raw.status === "retired" ? raw.status : "active",
    title: String(raw.title || `${employeeId ? "员工覆盖" : "岗位模板"} v${version}`).trim(),
    wave: String(raw.wave || "planning").trim(),
    knowledgeDocs: Array.isArray(raw.knowledgeDocs)
      ? raw.knowledgeDocs.map(String).map((item) => item.trim()).filter(Boolean)
      : [],
    cases,
    counterExamples,
    rubricSpec: {
      passScore: Math.min(100, Math.max(0, Number(raw.rubricSpec?.passScore) || 70)),
      criteria,
    },
    createdAt: String(raw.createdAt || new Date().toISOString()),
    taskExample: taskExample || cases[0]?.input || "",
    rubric: legacyRubric,
  };
}

/** 迁移旧 curriculum v1，并规范化岗位模板/员工覆盖版本；损坏项会被忽略。 */
export function migrateCurriculum(raw: {
  version?: number;
  industry?: string;
  updatedAt?: string;
  activeVersions?: Record<string, number>;
  entries?: Array<Partial<CurriculumEntry>>;
}): CurriculumDoc {
  const entries = Array.isArray(raw.entries)
    ? raw.entries
        .map((entry, index) => normalizeEntry(entry as Partial<CurriculumEntry>, index))
        .filter((entry): entry is CurriculumEntry => Boolean(entry))
    : [];
  const activeVersions =
    raw.activeVersions && typeof raw.activeVersions === "object" ? { ...raw.activeVersions } : {};
  for (const entry of entries) {
    const key = scopeKey(entry);
    if (entry.status === "active" && !activeVersions[key]) activeVersions[key] = entry.version;
  }
  return {
    version: 2,
    industry: typeof raw.industry === "string" ? raw.industry : "software",
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : new Date().toISOString(),
    activeVersions,
    entries,
  };
}

export async function loadCurriculum(): Promise<CurriculumDoc> {
  const empty: CurriculumDoc = {
    version: 2,
    industry: "software",
    updatedAt: new Date().toISOString(),
    activeVersions: {},
    entries: [],
  };
  let root = "";
  try {
    root = await readTrainingRootOrThrow();
  } catch {
    return empty;
  }
  try {
    const raw = await readTrainingText(curriculumPath(root));
    return migrateCurriculum(JSON.parse(raw) as Partial<CurriculumDoc>);
  } catch {
    return empty;
  }
}

export async function saveCurriculum(doc: CurriculumDoc): Promise<void> {
  const root = await readTrainingRootOrThrow();
  const next = migrateCurriculum({ ...doc, version: 2, updatedAt: new Date().toISOString() });
  await writeTrainingText(root, curriculumPath(root), JSON.stringify(next, null, 2));
  await touchTrainingManifest(root);
}

/** 解析生效课程：先岗位模板，再由 employeeId 覆盖同名字段与内容集合。 */
export function resolveCurriculum(
  doc: CurriculumDoc,
  roleId: string,
  employeeId?: string | null,
): CurriculumEntry | null {
  const pick = (scope: "role" | "employee", id: string): CurriculumEntry | undefined => {
    const key = `${scope}:${id}`;
    const active = doc.activeVersions[key];
    const candidates = doc.entries.filter((entry) =>
      scope === "role"
        ? entry.scope === "role" && entry.roleId === roleId
        : entry.scope === "employee" && entry.employeeId === id,
    );
    return candidates.find((entry) => entry.version === active) ||
      candidates.filter((entry) => entry.status === "active").sort((a, b) => b.version - a.version)[0];
  };
  const role = pick("role", roleId);
  const employee = employeeId ? pick("employee", employeeId) : undefined;
  if (!role && !employee) return null;
  if (!role) return employee || null;
  if (!employee) return role;
  return {
    ...role,
    ...employee,
    roleId,
    knowledgeDocs: [...new Set([...role.knowledgeDocs, ...employee.knowledgeDocs])],
    cases: [...role.cases, ...employee.cases],
    counterExamples: [...role.counterExamples, ...employee.counterExamples],
    rubricSpec: employee.rubricSpec.criteria.length ? employee.rubricSpec : role.rubricSpec,
  };
}
