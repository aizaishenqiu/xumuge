/**
 * @file 已晋级训练成果手动同步到云端（不含 raw samples / 用户上传附件）
 * @author qiuye <yjk150@qq.com>
 * @date 2026-09-02
 * @version 1.0.0
 * @category Network
 * @algo promoted-only-ingest
 */
import { fouAlert, fouConfirmPromise } from "foucui";
import { isTrainingOptIn } from "../commerce/training";
import { hasEntitlement } from "../commerce/entitlements";
import {
  loadCurriculum,
  type CurriculumDoc,
  type CurriculumEntry,
} from "../commerce/trainingLocal";
import { loadCaseLibrary, type CaseLibraryDoc } from "./caseLibrary";
import { loadMcpTraining, type McpTrainingDoc } from "./mcpTraining";
import { readCloudAccessToken } from "../utils/auth";
import { cloudPost } from "../utils/request";
import { toUserError } from "../utils/userFacingError";

export type PromotedTrainingPayload = {
  samples: never[];
  curriculum: CurriculumDoc | null;
  case_library: CaseLibraryDoc | null;
  mcp_training: McpTrainingDoc | null;
};

function scopeKey(entry: Pick<CurriculumEntry, "scope" | "roleId" | "employeeId">): string {
  return entry.scope === "employee"
    ? `employee:${entry.employeeId || ""}`
    : `role:${entry.roleId}`;
}

/** 仅 activeVersions 指向的 active 课程条目。 */
export function pickActiveCurriculumEntries(doc: CurriculumDoc): CurriculumEntry[] {
  const out: CurriculumEntry[] = [];
  for (const [key, ver] of Object.entries(doc.activeVersions || {})) {
    const hit = doc.entries.find(
      (e) => scopeKey(e) === key && e.version === ver && e.status === "active",
    );
    if (hit) out.push(hit);
  }
  return out;
}

/** 组装仅含已晋级 / 已激活成果的 ingest 载荷（samples 恒为空）。 */
export async function buildPromotedTrainingPayload(): Promise<PromotedTrainingPayload> {
  const [curriculumRaw, caseLib, mcpRaw] = await Promise.all([
    loadCurriculum().catch(() => null),
    loadCaseLibrary().catch(() => null),
    loadMcpTraining().catch(() => null),
  ]);

  let curriculum: CurriculumDoc | null = null;
  if (curriculumRaw) {
    const entries = pickActiveCurriculumEntries(curriculumRaw);
    if (entries.length) {
      curriculum = {
        ...curriculumRaw,
        entries,
        activeVersions: Object.fromEntries(entries.map((e) => [scopeKey(e), e.version])),
      };
    }
  }

  const promotedCases =
    caseLib?.entries.filter((e) => e.status === "promoted" && !e.golden?.taskInput?.includes("[REDACTED]")) ||
    [];
  const case_library: CaseLibraryDoc | null = promotedCases.length
    ? { version: 1, updatedAt: new Date().toISOString(), entries: promotedCases }
    : null;

  const activeTools = mcpRaw?.tools.filter((t) => t.status === "active") || [];
  const mcp_training: McpTrainingDoc | null = activeTools.length
    ? { version: 3, updatedAt: new Date().toISOString(), tools: activeTools }
    : null;

  return {
    samples: [],
    curriculum,
    case_library,
    mcp_training,
  };
}

export type SyncPromotedResult = {
  ok: boolean;
  message: string;
  counts?: {
    curriculumEntries: number;
    caseLibrary: number;
    mcpTools: number;
  };
};

/** 检查是否具备同步前置条件（不弹窗）。 */
export async function canSyncPromotedTraining(): Promise<{ ok: boolean; reason?: string }> {
  if (!readCloudAccessToken()) {
    return { ok: false, reason: "请先登录云账号" };
  }
  if (!isTrainingOptIn()) {
    return { ok: false, reason: "请先在设置中开启训练采集同意" };
  }
  if (!(await hasEntitlement("training.ingest"))) {
    return { ok: false, reason: "当前账号没有训练上传授权" };
  }
  return { ok: true };
}

/**
 * 手动同步已晋级训练成果到服务器；本机副本全部保留。
 * 不上传 raw JSONL 样本、candidate 案例或用户原始上传附件。
 */
export async function syncPromotedTrainingToCloud(): Promise<SyncPromotedResult> {
  const gate = await canSyncPromotedTraining();
  if (!gate.ok) {
    const msg = gate.reason || "无法同步";
    await fouAlert(msg, "无法同步");
    return { ok: false, message: msg };
  }

  const payload = await buildPromotedTrainingPayload();
  const curriculumN = payload.curriculum?.entries.length || 0;
  const caseN = payload.case_library?.entries.length || 0;
  const mcpN = payload.mcp_training?.tools.length || 0;

  if (!curriculumN && !caseN && !mcpN) {
    const msg = "暂无可同步内容。请先评测并晋级课程，或将成熟案例标记为已晋级。";
    await fouAlert(msg, "无法同步");
    return { ok: false, message: msg };
  }

  const parts: string[] = [];
  if (curriculumN) parts.push(`${curriculumN} 条已晋级课程`);
  if (caseN) parts.push(`${caseN} 条成熟案例`);
  if (mcpN) parts.push(`${mcpN} 条扩展工具用法`);
  const ok = await fouConfirmPromise(
    `将上传：${parts.join("、")}。\n\n仅含已晋级、已脱敏内容；不含原始上传文件与本机 JSONL 样本。本机副本会保留。确认？`,
    "同步到云端",
  );
  if (ok !== "confirm") {
    return { ok: false, message: "已取消" };
  }

  try {
    const json = await cloudPost<{
      message?: string;
    }>("/training/ingest", payload);
    const dataMsg =
      json.data && typeof json.data === "object" && "message" in json.data
        ? String((json.data as { message?: string }).message || "")
        : "";
    const msg =
      dataMsg ||
      (json.msg && json.msg !== "success" ? json.msg : "") ||
      `已同步（课程 ${curriculumN} · 案例 ${caseN} · 工具 ${mcpN}）`;
    await fouAlert(msg, "同步成功");
    return {
      ok: true,
      message: msg,
      counts: { curriculumEntries: curriculumN, caseLibrary: caseN, mcpTools: mcpN },
    };
  } catch (e) {
    const msg = toUserError(e, "同步失败");
    await fouAlert(msg, "同步失败");
    return { ok: false, message: msg };
  }
}
