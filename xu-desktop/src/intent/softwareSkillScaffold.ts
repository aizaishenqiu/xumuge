/**
 * @file softwareSkillScaffold.ts 软件项目 .xu/skills 脚手架
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-30
 * @updated 2026-09-06
 * @version 1.1.0
 * @category AgentLoop
 * @algo brief-synced-skills
 */
import { mkdirRecursive, writeTextUnderWorkspace } from "../utils/fsBridge";
import type { RequirementBrief } from "./briefTypes";
import { formatBriefSummary, formatMatchPlanSummary } from "./briefTypes";

function skillRequirementsAnalyst(brief: RequirementBrief): string {
  return `---
name: requirements-analyst
description: 软件项目需求分析——读 Brief/playbook，补用例与验收，禁止臆造范围
briefVersion: ${brief.version || 0}
updatedAt: ${brief.updatedAt}
---

# 需求分析师 Skill（Brief v${brief.version || 0}）

## 何时使用

- 项目开工前澄清与补全需求
- 更新 REQUIREMENTS_PLAYBOOK 的「对话确认区」

## 必须阅读

1. 项目 \`REQUIREMENTS_PLAYBOOK.md\`（若存在）
2. 下列 Brief 摘要（**以最新 v${brief.version || 0} 为准**；旧版作废）

\`\`\`
${formatBriefSummary(brief)}
\`\`\`

## 规则

- 不得臆造用户未确认的范围；未知点写入待澄清
- 交付用中文摘要；验收标准可测
- 输出：用户故事 / 用例要点 / 非功能约束 / 风险
`;
}

function skillTaskSplitter(brief: RequirementBrief): string {
  const plan = formatMatchPlanSummary(brief.matchPlan || []);
  return `---
name: task-splitter
description: 按「任务→岗位→验收」拆分 XU_TASKS，绑定依赖
briefVersion: ${brief.version || 0}
updatedAt: ${brief.updatedAt}
---

# 任务拆分 Skill（Brief v${brief.version || 0}）

## 何时使用

- 规划师 / PM 输出 \`XU_TASKS\` 之前
- 严格流水线「确认计划」之前

## Brief

\`\`\`
${formatBriefSummary(brief)}
\`\`\`

${plan ? `## 派岗表\n\n\`\`\`\n${plan}\n\`\`\`\n` : ""}

## 拆分规则

1. 按行业波次：planning → dev → qa → ops
2. 每条任务含：角色、产出物路径、完成标准、依赖——优先对齐上方派岗表
3. 禁止把未确认范围拆进开发任务
4. 输出格式遵循系统 \`XU_TASKS:\` 约定
`;
}

function skillLocalContextRouter(brief: RequirementBrief): string {
  return `---
name: local-context-router
description: 本地预处理与上下文裁剪——禁止全量代码上云，只投喂问题摘要+片段+路径
briefVersion: ${brief.version || 0}
updatedAt: ${brief.updatedAt}
---

# 本地上下文路由 Skill（Brief v${brief.version || 0}）

## 核心原则（混合架构）

1. **禁止**将全量仓库或未裁剪的原始文件直接交给远程推理。
2. **本地先做**：list_dir、read_file 目标文件、typecheck/lint（若项目有脚本）、grep 关键符号。
3. **只打包高信噪比上下文**：错误日志、潜在 Bug、性能瓶颈、需重构片段 + **绝对/相对路径**。
4. 远程 Agent 只基于摘要做深度分析与 patch 方案，**改文件仍在本地 PathSandbox**。

## 本地扫描清单

- 编译/类型错误（如 \`pnpm typecheck\` 输出摘要）
- Linter 告警（路径 + 行号 + 规则）
- 重复逻辑、过长函数、循环依赖（注明文件路径）
- 与 Brief 验收相关的缺口文件

## 输出格式（投喂工作包）

\`\`\`
LOCAL_CONTEXT_PACK:
- issue: （一句话）
  paths: path/to/a.ts, path/to/b.vue
  snippet: （≤40 行关键片段或错误摘录）
  severity: high|medium|low
\`\`\`

## Brief 约束

\`\`\`
${formatBriefSummary(brief)}
\`\`\`
`;
}

function skillHybridArchitect(brief: RequirementBrief): string {
  return `---
name: hybrid-architect
description: 软件架构师——结构化澄清、混合本地/云端分析、输出架构建议
briefVersion: ${brief.version || 0}
updatedAt: ${brief.updatedAt}
---

# 混合架构师 Skill（Brief v${brief.version || 0}）

## 角色

你是专业的软件工程架构师与需求分析专家，通过 **本地预处理 + 云端精准分析** 协助全生命周期开发。

## 工作流

### 1. 本地预处理（必读 local-context-router）

- 先读 \`.xu/skills/local-context-router/SKILL.md\`
- 本地静态分析、裁剪上下文，再请求深度建议

### 2. 意图结构化（对齐 Brief）

已收集维度（缺则写入待澄清，禁止臆造）：

| 维度 | Brief 字段 |
|------|------------|
| 核心目标 | goal |
| 行业场景 | industry |
| 验收标准 | acceptance |
| 范围 | scopeIn / scopeOut |
| MoSCoW | must / should / could / wont |
| UI/UX | uxNotes |
| 受众与规模 | audience |
| 系统边界/架构倾向 | architectureNotes |
| 约束 | constraints |

### 3. 架构建议输出

- **必读**：\`.xu/ARCHITECTURE_BRIEF.md\`（确认需求时生成，含 \`XU_ARCHITECTURE_BRIEF\`）
- 迭代架构时更新该文件，并保持与 Brief v${brief.version || 0} 一致

当 Brief 就绪或 Boss 明确要求时，输出或修订 **结构化架构说明**：

\`\`\`
XU_ARCHITECTURE_BRIEF:
## 推荐方案（1～2 套对比）
- 技术栈：…
- 模块划分：…
- 数据流：…
- 风险与权衡：…
## 数据库/存储建议（若适用）
## 非功能（性能、安全、合规）
\`\`\`

## 当前 Brief

\`\`\`
${formatBriefSummary(brief)}
\`\`\`

## 纪律

- 未确认范围不得写入开发任务
- 小步验证；大改前先 XU_NEED_CONFIRM
`;
}

function skillUiInterfaceDesign(brief: RequirementBrief): string {
  const ux = String(brief.uxNotes || "").trim();
  return `---
name: 界面设计
description: 软件项目界面——色调、布局、UI 框架；禁止跳过视觉决策直接堆组件
id: ui-interface-design
briefVersion: ${brief.version || 0}
updatedAt: ${brief.updatedAt}
---

# 界面设计 Skill（Brief v${brief.version || 0}）

先定气质与令牌，再选框架写页面。没有品牌一句、没有首屏构图，禁止写界面代码。

## 当前 Brief（以 v${brief.version || 0} 为准，旧版作废）

\`\`\`
${formatBriefSummary(brief)}
\`\`\`

${ux ? `## Brief 交互与视觉\n\n${ux}\n` : ""}
## 开工顺序（禁止跳步）

1. 产品类型（只选一类）：营销落地 / B 端后台 / 工具编辑器 / 电商 / 内容阅读
2. 品牌一句：产品名 + 气质词。没有气质禁止开写
3. 首屏一构图：品牌或产品名 + 一句标题 + 一句说明 + 一组 CTA + 一块真实主视觉。禁止首屏仪表盘、卡片墙
4. 设计令牌写入 \`UI/design-tokens.md\`（主色/中性/语义/字号/8pt 间距）
5. 框架选定后再生成页面代码

## 反「AI 丑站」硬禁令

- 禁止：紫白/紫靛渐变、奶油底+衬线+陶土色、无端深色、Inter/Roboto/Arial 当展示标题
- 禁止：圆角胶囊堆、多层阴影、emoji 当图标、首屏卡片墙/统计条
- 强制：真实视觉锚点；每段一个目的一个标题
- 交活自问：去掉产品名后是否像任意 AI 模板站？是则重做色与字

## 色调与布局

| 类型 | 色调默认 | 布局 |
|------|----------|------|
| B 端后台 | 中性灰底 + 单一品牌主色 | 顶栏工具+搜索；左分类右表格 |
| 营销落地 | 品牌主色主导，少用渐变 | 全出血英雄区；一构图；下滚分节 |
| 工具/编辑器 | 低饱和；工作区对比高 | 活动栏+侧栏+主区 |
| 政企/公文感 | 克制蓝或红点缀 | 大留白、正文高对比 |

## UI 框架选型

| 条件 | 推荐 | 禁止 |
|------|------|------|
| 虚募阁桌面/本仓 Vue | foucui（按钮必须带图标） | Element/Ant/Naive 当主库 |
| 用户项目 Vue3 管理端 | Naive UI 或 Element Plus + 令牌覆盖主题 | 多库混用 |
| 用户项目 React | shadcn/ui + Radix + Tailwind 令牌 | 无令牌堆默认蓝 |
| 营销站 | 轻量自研布局 | 整站套 Admin 皮 |
| 栈未定 | 先 \`UI/\` 线框与令牌再装库 | 先装三套组件库 |

用户已指定框架时以用户为准，仍必须套本项目令牌。

## 交付

- \`UI/README.md\`：气质一句、类型、框架理由
- \`UI/design-tokens.md\`：色、字、间距
- 关键页线框要点（登录、首页/工作台、列表、空态）
`;
}

/**
 * Write / rewrite project-scoped skills under generatePath/.xu/skills/
 * Always overwrites so Skills stay in sync with Brief version.
 */
export async function scaffoldSoftwareSkills(
  generatePath: string,
  brief: RequirementBrief,
): Promise<string[]> {
  const root = generatePath.replace(/[/\\]+$/, "");
  if (!root) return [];

  await mkdirRecursive(root, ".xu/skills/requirements-analyst");
  await mkdirRecursive(root, ".xu/skills/task-splitter");
  await mkdirRecursive(root, ".xu/skills/local-context-router");
  await mkdirRecursive(root, ".xu/skills/hybrid-architect");
  await mkdirRecursive(root, ".xu/skills/ui-interface-design");

  const rels = [
    ".xu/skills/requirements-analyst/SKILL.md",
    ".xu/skills/task-splitter/SKILL.md",
    ".xu/skills/local-context-router/SKILL.md",
    ".xu/skills/hybrid-architect/SKILL.md",
    ".xu/skills/ui-interface-design/SKILL.md",
  ];
  await writeTextUnderWorkspace(root, rels[0], skillRequirementsAnalyst(brief));
  await writeTextUnderWorkspace(root, rels[1], skillTaskSplitter(brief));
  await writeTextUnderWorkspace(root, rels[2], skillLocalContextRouter(brief));
  await writeTextUnderWorkspace(root, rels[3], skillHybridArchitect(brief));
  await writeTextUnderWorkspace(root, rels[4], skillUiInterfaceDesign(brief));
  return rels.map((r) => `${root}/${r}`.replace(/\\/g, "/"));
}

/** Relative skill paths for dispatch hints (version-aware wording). */
export function softwareSkillRelPaths(brief?: RequirementBrief | null): string[] {
  const v = brief?.version ? ` v${brief.version}` : "";
  const tag = v ? `（Brief${v}）` : "";
  return [
    `.xu/skills/local-context-router/SKILL.md${tag}`,
    `.xu/skills/hybrid-architect/SKILL.md${tag}`,
    `.xu/skills/requirements-analyst/SKILL.md${tag}`,
    `.xu/skills/task-splitter/SKILL.md${tag}`,
    `.xu/skills/ui-interface-design/SKILL.md${tag}`,
  ];
}

/** Matched custom role skills under .xu/skills/roles/ */
export function roleSkillRelGlobHint(): string {
  return ".xu/skills/roles/*/SKILL.md（确认需求后按匹配岗位落盘）";
}
