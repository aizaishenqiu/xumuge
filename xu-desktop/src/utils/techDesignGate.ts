/** Tech design confirm gate: after product design, before code. */

import { exists, readTextFile } from "@tauri-apps/plugin-fs";
import { mkdirRecursive, writeTextUnderWorkspace } from "./fsBridge";
import { loadBrief } from "../intent/briefStore";
import { ARCHITECTURE_BRIEF_REL } from "../intent/architectureBriefGenerator";
import { recommendArchitecture } from "../intent/architectureRecommend";
import {
  formatIdentityModelLabel,
  formatUsageScaleLabel,
  isIdentityModelSpecified,
  isUsageScaleSpecified,
} from "../intent/briefTypes";
import type { XuProject } from "./projects";

export const TECH_DESIGN_REL = ".xu/TECH_DESIGN.md";
export const TECH_CONFIRM_REL = ".xu/TECH_DESIGN.confirmed.json";

function joinRoot(root: string, sub: string): string {
  const r = root.replace(/[/\\]+$/, "");
  const s = sub.replace(/^[/\\]+/, "");
  return `${r}/${s}`.replace(/\\/g, "/");
}

export async function isTechDesignConfirmed(project: XuProject): Promise<boolean> {
  const gen = (project.generatePath || "").trim();
  if (!gen) return false;
  try {
    return await exists(joinRoot(gen, TECH_CONFIRM_REL));
  } catch {
    return false;
  }
}

export async function writeTechDesignDraft(project: XuProject): Promise<void> {
  const gen = (project.generatePath || "").trim();
  if (!gen) return;
  const dest = joinRoot(gen, TECH_DESIGN_REL);
  if (await exists(dest)) return;
  const brief = await loadBrief(project.id);
  let inherited = "";
  try {
    const archAbs = joinRoot(gen, ARCHITECTURE_BRIEF_REL);
    if (await exists(archAbs)) inherited = await readTextFile(archAbs);
  } catch {
    /* ignore */
  }
  const rec = recommendArchitecture(brief);
  const scaleLine = isUsageScaleSpecified(brief.usageScaleTier)
    ? formatUsageScaleLabel(brief.usageScaleTier)
    : brief.audience?.trim() || "（见 Brief 受众）";
  const identityLine = isIdentityModelSpecified(brief.identityModel)
    ? formatIdentityModelLabel(brief.identityModel)
    : brief.architectureNotes?.trim() || "（见 Brief 架构备注）";
  const md =
    inherited.trim() ||
    [
      `# 技术方案 · ${project.name}`,
      "",
      "> 设计确认后、写码前由 Boss 确认。回复「确认技术方案」后才会派开发。",
      "",
      "## 身份与租户",
      `- 规模档位：${scaleLine}`,
      `- 身份/租户模型：${identityLine}`,
      rec.authTenantNotes,
      brief.architectureNotes?.trim() ? `- 边界补充：${brief.architectureNotes.trim()}` : "",
      "",
      "## 容量与性能假设",
      `- 方案 A 假设：${rec.planA.replace(/\*\*/g, "").slice(0, 200)}…`,
      `- 默认不启用：微服务拆分、独立消息队列（除非 performance_sla 已确认）`,
      `- 缓存/队列：按规模后续在 Review 前评估`,
      "",
      "## 整体架构",
      brief.architectureNotes?.trim() || rec.planA.replace(/\*\*/g, "").slice(0, 300),
      "",
      "## 接口与数据",
      "- 表结构 / 本地库要点：（须含 tenant_id/角色表若为多租户）",
      "- 关键 API：（请补充）",
      "",
      "## 风险",
      "- 性能 / 并发 / 租户隔离 / 安全沙箱 / 授权校验 / 模型调用失败降级",
      rec.whyNotOverEngineer,
      "",
      "## 第三方与许可证",
      brief.constraints.length ? brief.constraints.map((c) => `- ${c}`).join("\n") : "- （无特别约束）",
      "",
      "## MoSCoW",
      `- Must：${(brief.must || []).join("；") || brief.scopeIn.join("；") || "（见 Brief）"}`,
      `- Won't：${(brief.wont || []).join("；") || brief.scopeOut.join("；") || "（见 Brief 范围外）"}`,
      "",
    ].join("\n");
  await mkdirRecursive(gen, ".xu");
  await writeTextUnderWorkspace(gen, TECH_DESIGN_REL, md);
}

export async function confirmTechDesign(project: XuProject): Promise<void> {
  const gen = (project.generatePath || "").trim();
  if (!gen) throw new Error("项目未设置生成路径，无法确认技术方案");
  await writeTechDesignDraft(project);
  await mkdirRecursive(gen, ".xu");
  await writeTextUnderWorkspace(
    gen,
    TECH_CONFIRM_REL,
    JSON.stringify({ confirmedAt: Date.now(), projectId: project.id }, null, 2),
  );
}
