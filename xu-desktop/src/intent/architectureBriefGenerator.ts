/**
 * Generate `.xu/ARCHITECTURE_BRIEF.md` when Brief is confirmed (software projects).
 */
import { invoke } from "@tauri-apps/api/core";
import { writeTextUnderWorkspace } from "../utils/fsBridge";
import { resolveEndpoint } from "../utils/opsBrains";
import type { XuProject } from "../utils/projects";
import {
  formatBriefSummary,
  formatMatchPlanSummary,
  formatUsageScaleLabel,
  formatIdentityModelLabel,
  isIdentityModelSpecified,
  isUsageScaleSpecified,
  type RequirementBrief,
} from "./briefTypes";
import { formatArchitectureRecommendationBlock } from "./architectureRecommend";

export const ARCHITECTURE_BRIEF_REL = ".xu/ARCHITECTURE_BRIEF.md";

function heuristicArchitectureMarkdown(brief: RequirementBrief, projectName?: string): string {
  const plan = formatMatchPlanSummary(brief.matchPlan || []);
  const scope = brief.scopeIn.length ? brief.scopeIn.join("；") : "（待补充）";
  const nfr = brief.constraints.length ? brief.constraints.join("；") : "（无特别约束）";
  const archBlock = formatArchitectureRecommendationBlock(brief);
  return `# 架构说明草稿 · Brief v${brief.version || 0}

> 由虚募阁在「确认需求」时生成；员工迭代时请保持与 Brief 一致。

## XU_ARCHITECTURE_BRIEF

${archBlock}

### 项目
- 名称：${projectName || brief.projectId}
- 目标：${brief.goal || "（未写明）"}
- 行业：${brief.industry || "（未写明）"}

### 推荐形态
- **形态**：${scope}
- **UI/UX**：${brief.uxNotes?.trim() || "（按 Brief 后续补充）"}
- **受众与规模**：${isUsageScaleSpecified(brief.usageScaleTier) ? formatUsageScaleLabel(brief.usageScaleTier) : brief.audience?.trim() || "（待估）"}
- **身份/租户**：${isIdentityModelSpecified(brief.identityModel) ? formatIdentityModelLabel(brief.identityModel) : brief.architectureNotes?.trim() || "（待明确）"}
- **技术栈建议**：按项目 playbook 与现有仓库栈延续，禁止无 Brief 授权换栈
- **模块划分**：展示层 / 应用层 / 数据层（按 scopeIn 映射目录）
- **数据流**：用户操作 → API/本地命令 → 持久化 → 回显
- **风险**：范围蔓延、未确认租户/会员/计费、验收不可测

### 非功能
- ${nfr}

### 验收对齐
${brief.acceptance.map((a, i) => `${i + 1}. ${a}`).join("\n") || "（Brief 尚无验收条）"}

${plan ? `### 派岗对照\n\n\`\`\`\n${plan}\n\`\`\`\n` : ""}

---
_Brief 摘要_

\`\`\`
${formatBriefSummary(brief)}
\`\`\`
`;
}

function parseJsonObject(raw: string): Record<string, unknown> | null {
  const t = raw.trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(t.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export type ArchitectureBriefResult = {
  relativePath: string;
  absolutePath: string;
  usedLlm: boolean;
};

/**
 * Write architecture brief markdown under generate path.
 */
export async function generateAndWriteArchitectureBrief(opts: {
  project: XuProject;
  brief: RequirementBrief;
}): Promise<ArchitectureBriefResult | null> {
  const gen = (opts.project.generatePath || "").trim();
  if (!gen || opts.project.type !== "software") return null;

  let body = "";
  let usedLlm = false;

  try {
    const ep = await resolveEndpoint({ slot: "command" });
    if (ep.model && ep.baseUrl) {
      const system = `你是软件架构师。根据 Brief 输出架构说明 Markdown。
必须包含一级标题 ## XU_ARCHITECTURE_BRIEF 及其下：
1) 规模档位与身份/租户模型（必须与 Brief.usageScaleTier / identityModel 或 audience / architectureNotes 一致）；
2) 推荐方案 A 与条件性方案 B；
3) 说明为何不默认微服务或多租户（除非 Brief 为 saas/multi_tenant）；
4) 模块划分、数据流、技术栈建议、风险、非功能、验收对齐。
只输出 JSON：{"markdown":"完整 markdown 正文（含 XU_ARCHITECTURE_BRIEF）"}
禁止臆造 Brief 未确认的租户、会员、计费功能。`;

      const user = JSON.stringify({
        projectName: opts.project.name,
        brief: opts.brief,
        matchPlan: opts.brief.matchPlan,
      });

      const answer = await invoke<string>("xu_agent_stream", {
        request: {
          sessionId: `arch_${opts.brief.projectId}_${Date.now()}`,
          endpoint: {
            provider: ep.provider || "custom",
            model: ep.model,
            baseUrl: ep.baseUrl,
            apiKeyEnv: ep.apiKeyEnv || "",
            apiFormat: ep.apiFormat ?? "openai",
            presetId: ep.presetId ?? "",
          },
          messages: [
            { role: "system", content: system, images: null },
            { role: "user", content: user, images: null },
          ],
          workspaceRoot: null,
          enableTools: false,
          toolMode: "readonly",
          requireWrite: false,
          projectId: opts.brief.projectId,
          memoryScope: "project",
          memoryScopeId: opts.brief.projectId,
          memoryTaskHint: "architecture brief",
        },
      });

      const obj = parseJsonObject(answer);
      const md = String(obj?.markdown || "").trim();
      if (md.includes("XU_ARCHITECTURE_BRIEF")) {
        body = md;
        usedLlm = true;
      }
    }
  } catch {
    /* fallback */
  }

  if (!body) {
    body = heuristicArchitectureMarkdown(opts.brief, opts.project.name);
  }

  if (!body.includes("XU_ARCHITECTURE_BRIEF")) {
    body = `## XU_ARCHITECTURE_BRIEF\n\n${body}`;
  }

  const header = `---
briefVersion: ${opts.brief.version || 0}
generatedAt: ${opts.brief.updatedAt}
source: ${usedLlm ? "llm+heuristic" : "heuristic"}
---

`;
  const full = header + body.trim() + "\n";

  await writeTextUnderWorkspace(gen, ARCHITECTURE_BRIEF_REL, full);
  const abs = `${gen.replace(/[/\\]+$/, "")}/${ARCHITECTURE_BRIEF_REL}`.replace(/\\/g, "/");
  return { relativePath: ARCHITECTURE_BRIEF_REL, absolutePath: abs, usedLlm };
}
