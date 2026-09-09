/**
 * @file 员工工作包：Brief、需求追踪矩阵、Skills 与验收门禁
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-30
 * @updated 2026-09-05
 * @version 1.2.0
 * @category AgentLoop
 * @algo role-scoped-traceability
 */
import type { Employee } from "../utils/employees";
import type { XuProject } from "../utils/projects";
import {
  formatBriefSummary,
  formatMatchPlanSummary,
  formatTraceabilityMatrix,
  formatArchitectureConstraintLine,
  migrateLegacyRequirements,
  type RequirementBrief,
  type RoleMatchItem,
} from "./briefTypes";
import { loadBrief } from "./briefStore";
import { softwareSkillRelPaths, roleSkillRelGlobHint } from "./softwareSkillScaffold";
import { buildProjectContextPack } from "./projectContextPack";
import {
  buildEnhancedCodeLoopHint,
  isCodeLikeEmployee,
  loadCodeExecPrefs,
} from "../utils/codeExecPrefs";
import { getAgencyRole, buildRoleAgencyPack } from "../office/agencyRoles";

function matchRowForEmp(brief: RequirementBrief, emp: Employee): RoleMatchItem | null {
  const plan = brief.matchPlan || [];
  const rid = (emp.agentRoleId || "").trim();
  if (rid) {
    const hit = plan.find((p) => p.roleId === rid);
    if (hit) return hit;
  }
  const hay = `${emp.role} ${emp.name}`.toLowerCase();
  return (
    plan.find((p) => hay.includes((p.roleNameZh || "").toLowerCase()) && p.roleNameZh) || null
  );
}

/**
 * Build the structured work pack appended to dispatch composedMessage.
 */
export async function buildEmployeeWorkPack(
  project: XuProject | null | undefined,
  emp: Employee,
): Promise<string> {
  if (!project?.id) return "";
  const lines: string[] = [];
  lines.push("【工作包 · 顶级理解投喂 · 必读】");

  const agency = getAgencyRole(emp.agentRoleId);
  const rolePack = buildRoleAgencyPack(agency);
  if (rolePack) lines.push(rolePack);

  let brief: RequirementBrief | null = null;
  try {
    brief = await loadBrief(project.id);
  } catch {
    brief = null;
  }

  if (brief && (brief.goal || brief.status !== "gathering" || brief.version > 0)) {
    if (project.type === "software") {
      lines.push(formatArchitectureConstraintLine(brief));
    }
    lines.push(formatBriefSummary(brief));
    lines.push(formatTraceabilityMatrix(brief));
    const requirements = migrateLegacyRequirements(brief);
    if (requirements.length) {
      lines.push(
        "【逐项验收回写协议】",
        ...requirements.flatMap((requirement) =>
          requirement.acceptanceCriteria.map(
            (criterion) =>
              `- ${requirement.id}/${criterion.id}: [pending|passed|failed|waived] 证据路径或说明`,
          ),
        ),
        "- Review/QA 必须把结果持久化到 `.xu/requirements-gate.json`；保留未负责的需求项。",
        "- 任一 Must、行业必需项、冲突项或验收项未通过，不得声明 completed。",
      );
    }
    const row = matchRowForEmp(brief, emp);
    if (row) {
      lines.push(
        "【本岗任务行】",
        `- 岗位：${row.roleNameZh}`,
        `- 任务：${row.task || "（见 Brief 目标）"}`,
        row.acceptance.length
          ? `- 本岗验收：${row.acceptance.join("；")}`
          : brief.acceptance.length
            ? `- 项目验收（共用）：${brief.acceptance.slice(0, 5).join("；")}`
            : "- 验收：（未写明，交付前向 Boss 确认）",
      );
    } else if ((brief.matchPlan || []).length) {
      lines.push(formatMatchPlanSummary(brief.matchPlan));
      lines.push("（未精确匹配到你的岗位行时，按上表最近职责执行，禁止越权改范围）");
    }
    if (brief.acceptance.length) {
      lines.push(
        "【交活前自检】对照验收逐条打勾；文末输出：",
        "XU_ACCEPTANCE_REPORT:",
        ...brief.acceptance.slice(0, 8).map((a, i) => `${i + 1}. [x| ] ${a}`),
      );
    }
  } else {
    lines.push("（尚无就绪 Brief——只做本任务字面范围，禁止臆造需求）");
  }

  const prefs = await loadCodeExecPrefs();

  if (project.type === "software") {
    lines.push(
      "【项目 Skills · 强制 read_file】",
      ...softwareSkillRelPaths(brief).map((p) => `- ${p}`),
      `- ${roleSkillRelGlobHint()}`,
      "- 以 Skill frontmatter 的 briefVersion 为准，旧版作废",
      "- 代码分析先走 local-context-router，禁止全量上云",
    );
    const gen = (project.generatePath || "").trim();
    if (prefs.projectContextRetrievalOnDispatch && gen && brief && brief.goal) {
      try {
        const ctx = await buildProjectContextPack({
          workspaceRoot: gen,
          brief,
          includeSemantic: prefs.projectSemanticIndexEnabled,
          includeEmbedding: prefs.projectEmbeddingIndexEnabled,
        });
        if (ctx.pack) lines.push("【本地预检索 · Brief 关键词】", ctx.pack);
      } catch {
        /* ignore retrieval failures */
      }
    }
    if (prefs.architectureBriefOnConfirm) {
      lines.push("- 架构草稿：`.xu/ARCHITECTURE_BRIEF.md`（含 XU_ARCHITECTURE_BRIEF）");
    }
  }

  if (prefs.enhancedCodeLoop && isCodeLikeEmployee(emp)) {
    lines.push(buildEnhancedCodeLoopHint(prefs));
    if (prefs.codeRoleRelaxedApproval) {
      lines.push(
        "【代码岗 · 本仓库可安心改】在本项目目录内可连续 apply_patch/write_file；删文件、危险命令、Git 推送仍须审批。禁止改到项目外或外传源码。",
      );
    }
  }

  lines.push(
    "【执行纪律】",
    "1. 先 read_file playbook 与 Skills，再 list_dir，再改文件",
    "2. 小改动优先 apply_patch；新建用 write_file",
    "3. 不得扩大 Brief 未确认范围；不确定则 XU_NEED_CONFIRM",
  );

  return lines.filter(Boolean).join("\n");
}
