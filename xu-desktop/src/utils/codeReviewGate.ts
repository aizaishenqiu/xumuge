/**
 * @file 软件中途代码评审与需求追踪门禁
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-30
 * @version 1.1.0
 * @category ToolPolicy
 * @algo multi-reviewer-consensus
 */

import { mkdirRecursive, readTextFile, writeTextUnderWorkspace } from "./fsBridge";

export type CodeReviewStatus = "idle" | "pending" | "pass" | "fail";

export interface ReviewerVerdict {
  employeeId: string;
  status: CodeReviewStatus;
  summary: string;
  issues: string[];
}

export interface CodeReviewGate {
  status: CodeReviewStatus;
  summary: string;
  issues: string[];
  updatedAt: number;
  reviews?: ReviewerVerdict[];
}

export const CODE_REVIEW_REL = ".xu/code-review.json";

function parseStatus(raw: unknown): CodeReviewStatus {
  return raw === "pending" || raw === "pass" || raw === "fail" || raw === "idle" ? raw : "idle";
}

export function emptyCodeReviewGate(): CodeReviewGate {
  return { status: "idle", summary: "", issues: [], updatedAt: 0, reviews: [] };
}

export function aggregateReviewStatus(reviews: ReviewerVerdict[]): CodeReviewStatus {
  if (!reviews.length) return "pending";
  if (reviews.some((r) => r.status === "fail")) return "fail";
  if (reviews.some((r) => r.status === "pending" || r.status === "idle")) return "pending";
  if (reviews.every((r) => r.status === "pass")) return "pass";
  return "pending";
}

function parseReviews(raw: unknown): ReviewerVerdict[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      const o = item as Partial<ReviewerVerdict>;
      const employeeId = String(o.employeeId || "").trim();
      if (!employeeId) return null;
      return {
        employeeId,
        status: parseStatus(o.status),
        summary: String(o.summary || "").trim(),
        issues: Array.isArray(o.issues) ? o.issues.map(String).filter(Boolean).slice(0, 40) : [],
      } satisfies ReviewerVerdict;
    })
    .filter((x): x is ReviewerVerdict => Boolean(x))
    .slice(0, 40);
}

export function parseCodeReviewGate(raw: string): CodeReviewGate {
  try {
    const o = JSON.parse(raw) as Partial<CodeReviewGate>;
    const reviews = parseReviews(o.reviews);
    const fallback: CodeReviewStatus = parseStatus(o.status);
    const status = reviews.length ? aggregateReviewStatus(reviews) : fallback;
    const issues = reviews.length
      ? reviews.flatMap((r) => r.issues).slice(0, 40)
      : Array.isArray(o.issues)
        ? o.issues.map(String).filter(Boolean).slice(0, 40)
        : [];
    const summary = reviews.length
      ? reviews
          .map((r) => r.summary)
          .filter(Boolean)
          .join("；")
          .slice(0, 400) || String(o.summary || "").trim()
      : String(o.summary || "").trim();
    return {
      status,
      summary,
      issues,
      updatedAt: typeof o.updatedAt === "number" ? o.updatedAt : Date.now(),
      reviews,
    };
  } catch {
    return emptyCodeReviewGate();
  }
}

export function pendingGateForReviewers(
  employeeIds: string[],
  summary: string,
): CodeReviewGate {
  const reviews = employeeIds
    .map((id) => id.trim())
    .filter(Boolean)
    .map(
      (employeeId): ReviewerVerdict => ({
        employeeId,
        status: "pending",
        summary: "",
        issues: [],
      }),
    );
  return {
    status: reviews.length ? "pending" : "pending",
    summary,
    issues: [],
    updatedAt: Date.now(),
    reviews,
  };
}

export async function readCodeReviewGate(workspace: string): Promise<CodeReviewGate> {
  const ws = workspace.trim();
  if (!ws) return emptyCodeReviewGate();
  try {
    const abs = `${ws.replace(/[\\/]+$/, "")}/.xu/code-review.json`;
    return parseCodeReviewGate(await readTextFile(abs));
  } catch {
    return emptyCodeReviewGate();
  }
}

export async function writeCodeReviewGate(
  workspace: string,
  gate: CodeReviewGate,
): Promise<void> {
  const ws = workspace.trim();
  if (!ws) return;
  await mkdirRecursive(ws, ".xu");
  const reviews = gate.reviews?.length ? gate.reviews : [];
  const next: CodeReviewGate = {
    ...gate,
    reviews,
    status: reviews.length ? aggregateReviewStatus(reviews) : gate.status,
    updatedAt: Date.now(),
  };
  await writeTextUnderWorkspace(ws, CODE_REVIEW_REL, JSON.stringify(next, null, 2));
}

/** Human reason if merge/pull-into-main must be blocked. */
export function mergeBlockReason(
  gate: CodeReviewGate | null | undefined,
  errorCount = 0,
): string | null {
  if (errorCount > 0) {
    return `当前有 ${errorCount} 个代码问题，禁止合入 dev。请先修好再评。`;
  }
  if (!gate) return null;
  const reviews = gate.reviews || [];
  if (reviews.length) {
    const failed = reviews.filter((r) => r.status === "fail");
    const unfinished = reviews.filter((r) => r.status === "pending" || r.status === "idle");
    if (failed.length) {
      return `代码 Review 未全员通过：${failed[0]?.summary || gate.summary || gate.issues[0] || "有阻断问题"}`;
    }
    if (unfinished.length) {
      return `代码 Review 进行中（${unfinished.length}/${reviews.length} 人未完成），未全员通过禁止合入 dev。`;
    }
  }
  if (gate.status === "fail") {
    return `代码 Review 未通过：${gate.summary || gate.issues[0] || "有阻断问题"}`;
  }
  if (gate.status === "pending") {
    return "代码 Review 进行中，禁止合入 dev。";
  }
  return null;
}

export function pickMidDevReviewers<
  T extends { roleKind?: string; role: string; agentRoleId?: string | null },
>(employees: T[]): T[] {
  const hay = (e: T) => `${e.role} ${e.agentRoleId || ""}`;
  const explicit = employees.filter(
    (e) =>
      e.roleKind === "reviewer" ||
      /code-reviewer|审核|评审|review/i.test(hay(e)),
  );
  if (explicit.length) return explicit;
  return employees.filter((e) => /测试|qa|quality|质检/i.test(hay(e)));
}

export function buildMidDevReviewTask(
  projectName: string,
  root: string,
  employeeId?: string,
): string {
  const id = (employeeId || "").trim() || "<你的 employeeId>";
  return [
    "【软件 · 代码 Review】",
    `项目：${projectName}`,
    `工作区：${root}`,
    `你的 employeeId：${id}`,
    "开发切片刚告一段落。请立刻审查当前改动（优先 git diff / read_file / grep），不要写新功能。",
    "重点：Rust/路径校验、异常处理、安全、编码规范。每人只写自己的评审段。",
    "先 read_file `.xu/code-review.json`，保留其他人的 reviews[]，只改你自己那一条。",
    "同时 read_file `.xu/requirements-gate.json`，按工作包追踪矩阵核对本次覆盖的 requirementId/acceptanceId；只回写你验证过的 passed/failed 与 evidence，保留其他项。",
    "用 write_file 写回 `.xu/code-review.json`，格式：",
    `{"status":"pending","reviews":[{"employeeId":"${id}","status":"pass 或 fail","summary":"一句话","issues":["…"]}]}`,
    "有阻断问题必须 status=fail。任一 fail 或仍有 pending 都禁止合入 dev，更禁止合 main。",
    "全部审核员 pass 才允许合 dev。",
    "任一 Must、行业必需项、冲突项或验收未通过，禁止写 completed。",
  ].join("\n");
}
