/**
 * @file 工作模式模糊边界：指挥脑单次 JSON 补判（失败静默回退规则）
 * @author qiuye <yjk150@qq.com>
 * @date 2026-09-02
 * @version 1.0.0
 * @category Parse
 * @algo llm-work-mode-disambiguate
 */
import { invoke } from "@tauri-apps/api/core";
import type { RequirementBrief } from "./briefTypes";
import type { XuProject } from "../utils/projects";
import { resolveEndpoint } from "../utils/opsBrains";
import {
  classifyWorkMode,
  isWorkModeAmbiguous,
  type WorkModeClassification,
  type WorkMode,
  type DeliveryComplexity,
} from "./workModeClassifier";

export type ResolveWorkModeOpts = {
  text: string;
  brief?: RequirementBrief | null;
  project?: XuProject | null;
  projectId?: string;
};

function parseJsonObject(raw: string): Record<string, unknown> | null {
  const text = raw.trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

const MODES = new Set<WorkMode>(["software_build", "delivery", "operation", "question"]);
const COMPLEXITIES = new Set<DeliveryComplexity>(["simple", "complex"]);

function normalizeAssistResult(
  parsed: Record<string, unknown>,
  fallback: WorkModeClassification,
): WorkModeClassification {
  const modeRaw = String(parsed.mode || "").trim() as WorkMode;
  const mode = MODES.has(modeRaw) ? modeRaw : fallback.mode;
  if (mode !== "delivery") {
    return { mode, complexity: fallback.complexity };
  }
  const cxRaw = String(parsed.complexity || "").trim() as DeliveryComplexity;
  const complexity = COMPLEXITIES.has(cxRaw) ? cxRaw : fallback.complexity || "simple";
  return { mode, complexity };
}

/**
 * 规则优先；仅模糊边界时调用指挥脑补判 workMode / deliveryComplexity。
 */
export async function resolveWorkModeWithAssist(
  opts: ResolveWorkModeOpts,
): Promise<WorkModeClassification> {
  const ruled = classifyWorkMode(opts.text, opts.brief, opts.project);
  if (!isWorkModeAmbiguous(opts.text, opts.brief, opts.project)) {
    return ruled;
  }

  try {
    const endpoint = await resolveEndpoint({ slot: "command" });
    if (!endpoint.model || !endpoint.baseUrl) return ruled;

    const system = `你是虚募阁意图分流器。根据用户本轮话判断工作模式，只输出一个 JSON（不要 markdown）：
{"mode":"software_build|delivery|operation|question","complexity":"simple|complex"}
规则：
- software_build：要做软件产品（小程序/App/网站/系统等），需要技术栈与开发。
- delivery：交付文档/方案/报告等，不是写代码产品；complexity 表示是否要正式收集目标与验收（复杂交付=complex）。
- operation：改现有代码/页面/功能、实现小改动，不是新立项。
- question：普通问答、用法咨询。
complexity 仅在 mode=delivery 时填写；其它 mode 可省略 complexity。`;

    const user = JSON.stringify({
      userText: opts.text.trim().slice(0, 500),
      previousWorkMode: opts.brief?.workMode || null,
      projectType: opts.project?.type || null,
      ruleGuess: ruled,
    });

    const projectId = opts.projectId || opts.brief?.projectId || opts.project?.id || "chat";
    const answer = await invoke<string>("xu_agent_stream", {
      request: {
        sessionId: `brief_mode_${projectId}_${Date.now()}`,
        endpoint: {
          provider: endpoint.provider || "custom",
          model: endpoint.model,
          baseUrl: endpoint.baseUrl,
          apiKeyEnv: endpoint.apiKeyEnv || "",
          apiFormat: endpoint.apiFormat ?? "openai",
          presetId: endpoint.presetId ?? "",
        },
        messages: [
          { role: "system", content: system, images: null },
          { role: "user", content: user, images: null },
        ],
        workspaceRoot: null,
        enableTools: false,
        toolMode: "readonly",
        requireWrite: false,
        projectId: projectId || null,
        memoryScope: "project",
        memoryScopeId: projectId || null,
        memoryTaskHint: opts.text.trim().slice(0, 80),
      },
    });

    const parsed = parseJsonObject(answer);
    if (!parsed) return ruled;
    return normalizeAssistResult(parsed, ruled);
  } catch {
    return ruled;
  }
}
