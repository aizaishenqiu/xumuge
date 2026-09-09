/**
 * @file Brief 持久化、旧数据迁移与版本控制
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-30
 * @version 1.1.0
 * @category Cache
 * @algo schema-normalization
 */
import { invoke } from "@tauri-apps/api/core";
import { upsertMemory } from "../employee/memory";
import {
  briefContentFingerprint,
  briefSettingKey,
  emptyBrief,
  migrateLegacyRequirements,
  parseIdentityModel,
  parseUsageScaleTier,
  type BriefPage,
  type BriefPageStatus,
  type RequirementBrief,
  type RoleMatchItem,
} from "./briefTypes";
import { invalidateProjectContextCache } from "./projectContextPack";

export function lockWaterfallMust(
  prev: RequirementBrief,
  next: RequirementBrief,
  waterfall: boolean,
): RequirementBrief {
  if (!waterfall) return next;
  if (prev.status !== "ready" && prev.status !== "executing") return next;
  const a = JSON.stringify(prev.must || []);
  const b = JSON.stringify(next.must || []);
  if (a === b) return next;
  return { ...next, must: [...(prev.must || [])] };
}

function normalizeMatchPlan(raw: unknown): RoleMatchItem[] {
  if (!Array.isArray(raw)) return [];
  const out: RoleMatchItem[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const roleId = String(o.roleId || "").trim();
    if (!roleId) continue;
    out.push({
      roleId,
      roleNameZh: String(o.roleNameZh || roleId).trim(),
      task: String(o.task || "").trim(),
      acceptance: Array.isArray(o.acceptance)
        ? o.acceptance.map(String).filter(Boolean)
        : [],
    });
  }
  return out;
}

function normalizePages(raw: unknown): BriefPage[] {
  if (!Array.isArray(raw)) return [];
  const out: BriefPage[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const id = String(o.id || "").trim();
    const name = String(o.name || "").trim();
    if (!id || !name) continue;
    const statusRaw = String(o.status || "draft");
    const status: BriefPageStatus =
      statusRaw === "designed" || statusRaw === "confirmed" ? statusRaw : "draft";
    out.push({
      id,
      name,
      route: String(o.route || "").trim() || undefined,
      purpose: String(o.purpose || "").trim() || undefined,
      status,
      chosenDesignPath: String(o.chosenDesignPath || "").trim() || undefined,
      previewPath: String(o.previewPath || "").trim() || undefined,
      sourceKind:
        o.sourceKind === "upload" ||
        o.sourceKind === "html" ||
        o.sourceKind === "canvas" ||
        o.sourceKind === "svg"
          ? o.sourceKind
          : undefined,
    });
  }
  return out;
}

function normalizeBrief(raw: Partial<RequirementBrief> | null, projectId: string): RequirementBrief {
  const base = emptyBrief(projectId);
  if (!raw) return base;
  const status =
    raw.status === "ready" || raw.status === "executing" || raw.status === "gathering"
      ? raw.status
      : "gathering";
  const matchedRoleIds = Array.isArray(raw.matchedRoleIds)
    ? raw.matchedRoleIds.map(String).filter(Boolean)
    : [];
  let matchPlan = normalizeMatchPlan(raw.matchPlan);
  if (!matchPlan.length && matchedRoleIds.length) {
    matchPlan = matchedRoleIds.map((id) => ({
      roleId: id,
      roleNameZh: id,
      task: "",
      acceptance: [],
    }));
  }
  const normalized: RequirementBrief = {
    projectId,
    status,
    goal: String(raw.goal || "").trim(),
    industry: String(raw.industry || "").trim(),
    constraints: Array.isArray(raw.constraints) ? raw.constraints.map(String).filter(Boolean) : [],
    decisions: Array.isArray(raw.decisions) ? raw.decisions.map(String).filter(Boolean) : [],
    openQuestions: Array.isArray(raw.openQuestions)
      ? raw.openQuestions.map(String).filter(Boolean)
      : [],
    pendingGapQuestions: Array.isArray(raw.pendingGapQuestions)
      ? raw.pendingGapQuestions.map(String).filter(Boolean)
      : [],
    acceptance: Array.isArray(raw.acceptance) ? raw.acceptance.map(String).filter(Boolean) : [],
    scopeIn: Array.isArray(raw.scopeIn) ? raw.scopeIn.map(String).filter(Boolean) : [],
    scopeOut: Array.isArray(raw.scopeOut) ? raw.scopeOut.map(String).filter(Boolean) : [],
    must: Array.isArray(raw.must) ? raw.must.map(String).filter(Boolean) : [],
    should: Array.isArray(raw.should) ? raw.should.map(String).filter(Boolean) : [],
    could: Array.isArray(raw.could) ? raw.could.map(String).filter(Boolean) : [],
    wont: Array.isArray(raw.wont) ? raw.wont.map(String).filter(Boolean) : [],
    uxNotes: String(raw.uxNotes || "").trim(),
    audience: String(raw.audience || "").trim(),
    usageScaleTier: parseUsageScaleTier(raw.usageScaleTier),
    identityModel: parseIdentityModel(raw.identityModel),
    architectureNotes: String(raw.architectureNotes || "").trim(),
    requirements: [],
    requirementsConfirmedAt:
      Number(raw.requirementsConfirmedAt) ||
      (!Array.isArray(raw.requirements) && (status === "ready" || status === "executing")
        ? Number(raw.updatedAt) || Date.now()
        : undefined),
    requirementGapScore: Number.isFinite(raw.requirementGapScore)
      ? Math.min(100, Math.max(0, Math.round(raw.requirementGapScore!)))
      : 0,
    matchedRoleIds: matchPlan.length ? matchPlan.map((m) => m.roleId) : matchedRoleIds,
    matchPlan,
    pages: normalizePages(raw.pages),
    designMode:
      raw.designMode === "upload" || raw.designMode === "html" || raw.designMode === "canvas"
        ? raw.designMode
        : undefined,
    designFrozen: Boolean(raw.designFrozen),
    version: Number.isFinite(raw.version) ? Math.max(0, Math.floor(raw.version!)) : 0,
    clarifyRound: Number.isFinite(raw.clarifyRound) ? Math.max(0, Math.floor(raw.clarifyRound!)) : 0,
    updatedAt: Number(raw.updatedAt) || Date.now(),
  };
  normalized.requirements = migrateLegacyRequirements({
    ...normalized,
    requirements: raw.requirements,
  });
  return normalized;
}

export async function loadBrief(projectId: string): Promise<RequirementBrief> {
  if (!projectId) return emptyBrief("");
  try {
    const raw = await invoke<string | null>("xu_get_setting", {
      key: briefSettingKey(projectId),
    });
    if (!raw) return emptyBrief(projectId);
    return normalizeBrief(JSON.parse(raw) as Partial<RequirementBrief>, projectId);
  } catch {
    return emptyBrief(projectId);
  }
}

export async function saveBrief(
  brief: RequirementBrief,
  opts?: { bumpVersion?: boolean },
): Promise<RequirementBrief> {
  let next = normalizeBrief({ ...brief, updatedAt: Date.now() }, brief.projectId);
  try {
    const prev = await loadBrief(brief.projectId);
    let waterfall = false;
    try {
      const { loadProjects } = await import("../utils/projects");
      const p = (await loadProjects()).find((x) => x.id === next.projectId);
      waterfall = p?.type === "software" && p.kickoffMode === "strict";
    } catch {
      waterfall = false;
    }
    next = lockWaterfallMust(prev, next, waterfall);
    if (opts?.bumpVersion) {
      next = { ...next, version: Math.max(prev.version || 0, next.version || 0) + 1 };
    } else if (
      (prev.status === "ready" || prev.status === "executing") &&
      briefContentFingerprint({ ...prev, version: 0, updatedAt: 0, clarifyRound: 0 }) !==
        briefContentFingerprint({ ...next, version: 0, updatedAt: 0, clarifyRound: 0 })
    ) {
      // Ready Brief 内容变更 → 升版，触发 Skills 重写
      next = { ...next, version: Math.max(prev.version || 0, 0) + 1 };
    } else {
      next = { ...next, version: next.version || prev.version || 0 };
    }
  } catch {
    if (opts?.bumpVersion) {
      next = { ...next, version: (next.version || 0) + 1 };
    }
  }
  await invoke("xu_set_setting", {
    key: briefSettingKey(brief.projectId),
    value: JSON.stringify(next),
  });
  if (opts?.bumpVersion || (next.version || 0) !== (brief.version || 0)) {
    invalidateProjectContextCache(brief.projectId);
  }
  try {
    const body = [
      `v${next.version}`,
      `目标：${next.goal || "（未明确）"}`,
      next.industry ? `行业：${next.industry}` : "",
      next.constraints.length ? `约束：${next.constraints.join("；")}` : "",
      next.decisions.length ? `决策：${next.decisions.join("；")}` : "",
      next.acceptance.length ? `验收：${next.acceptance.join("；")}` : "",
      next.openQuestions.length ? `待澄清：${next.openQuestions.join("；")}` : "",
      next.matchPlan.length
        ? `派岗：${next.matchPlan.map((m) => `${m.roleNameZh}→${m.task}`).join("；")}`
        : "",
    ]
      .filter(Boolean)
      .join("\n");
    await upsertMemory({
      id: `mem_brief_${brief.projectId}`,
      scope: "project",
      scopeId: brief.projectId,
      title: "项目需求 Brief",
      body,
      tags: JSON.stringify(["brief", "decision", "constraint", "structured"]),
      source: "manual",
      pinned: true,
    });
  } catch {
    /* ignore memory mirror failures */
  }
  return next;
}

export async function markBriefReady(projectId: string): Promise<RequirementBrief> {
  const b = await loadBrief(projectId);
  b.status = "ready";
  b.openQuestions = [];
  return saveBrief(b, { bumpVersion: true });
}

export async function markBriefExecuting(projectId: string): Promise<RequirementBrief> {
  const b = await loadBrief(projectId);
  if (b.status === "ready" || b.status === "executing") {
    b.status = "executing";
    return saveBrief(b);
  }
  return b;
}
