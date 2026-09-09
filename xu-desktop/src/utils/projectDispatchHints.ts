/**
 * @file projectDispatchHints.ts 项目 playbook / 目录 / Skills 派活提示
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-30
 * @updated 2026-09-06
 * @version 1.2.1
 * @category AgentLoop
 * @algo role-dir-dispatch-hints
 */
import { mkdirRecursive } from "./fsBridge";
import type { Employee } from "./employees";
import type { XuProject } from "./projects";
import {
  buildAndWritePlaybook,
  playbookSystemHint,
  stackDirMapMarkdown,
  STACK_ENDS,
  type StackProfile,
} from "./projectStack";

const ROLE_DIR_RULES: Array<{ test: RegExp; dir: (s: StackProfile) => string | undefined }> = [
  { test: /产品|pm|需求|product/i, dir: () => "docs" },
  { test: /前端|frontend|fe\b|vue|react/i, dir: (s) => s.frontendDir },
  { test: /后端|backend|api|服务端|server/i, dir: (s) => s.backendDir },
  { test: /ui|设计|ux|视觉/i, dir: (s) => s.uiDir },
  { test: /文案|内容|运营|营销|公关|编辑|copy|content|marketing/i, dir: () => "deliverables/copy" },
  { test: /测试|qa|质量|test/i, dir: () => "docs/qa" },
  { test: /运维|devops|部署/i, dir: (s) => s.backendDir || "ops" },
  { test: /桌面|tauri|electron/i, dir: (s) => s.desktopDir },
  { test: /移动|app|android|ios|flutter/i, dir: (s) => s.appDir },
];

function joinRoot(root: string, sub: string): string {
  const r = root.replace(/[/\\]+$/, "");
  const s = sub.replace(/^[/\\]+/, "");
  return `${r}/${s}`;
}

/** Suggest a relative directory for this employee's deliverables. */
export function suggestRoleOutputDir(
  emp: Employee,
  stack: StackProfile | null | undefined,
  generatePath: string,
): string {
  const stackRef = stack || { enabled: {} };
  const hay = `${emp.role} ${emp.agentRoleId} ${emp.name}`;
  for (const rule of ROLE_DIR_RULES) {
    if (!rule.test.test(hay)) continue;
    const rel = rule.dir(stackRef);
    if (rel?.trim()) return rel.trim();
  }
  const fallback = (emp.agentRoleId || emp.role || "deliverables")
    .replace(/[^\w\u4e00-\u9fa5-]+/g, "-")
    .slice(0, 40);
  return fallback || "deliverables";
}

export function buildProjectDispatchHints(project: XuProject, emp: Employee): string {
  const genPath = (project.generatePath || "").trim();
  const stack = project.stackProfile || null;
  const playbookPath = project.requirements?.playbookPath?.trim() || "";
  const lines: string[] = [];

  const hint = playbookSystemHint(playbookPath || undefined, stack);
  if (hint) lines.push(hint);

  if (stack && genPath) {
    lines.push(stackDirMapMarkdown(stack, genPath));
  }

  const roleDir = suggestRoleOutputDir(emp, stack, genPath);
  const hay = `${emp.role} ${emp.agentRoleId || ""} ${emp.name || ""}`;
  const isQa = /测试|qa|quality|质检/i.test(hay);
  const isUiOrFrontend = /ui|设计|ux|视觉|前端|frontend|fe\b|vue|react/i.test(hay);
  const isCopy =
    /文案|内容|运营|营销|公关|编辑|copy|content|marketing|brand|品牌/i.test(hay);
  lines.push(
    "【你的落盘目录（软约束 · 必须遵守）】",
    `- 生成根：\`${genPath || "(未设)"}\``,
    `- 本岗位建议目录：\`${roleDir}\`（所有新建文件放此目录或其子目录，禁止堆在根目录）`,
    "- 开工前：read_file playbook → list_dir 根目录 → mkdir 缺失子目录 → 输出 XU_TASKS（每项写明目标相对路径）",
    "- 实现阶段：严格按 XU_TASKS 路径落盘；汇报写「相对路径 + 用途」",
  );
  if (isQa) {
    lines.push(
      "- 【QA 铁律】必须先 list_dir 确认 frontend/backend 有 .ts/.vue/.rs 等源码；无源码禁止写测试报告，只输出 XU_PHASE: WAITING_DEV",
    );
  }
  if (isUiOrFrontend) {
    lines.push(
      "- 【界面铁律】做页面代码前先 read_file `.xu/skills/ui-interface-design/SKILL.md`，写 `UI/design-tokens.md` 与首屏构图；禁止直接套组件库默认皮肤",
    );
  }
  if (isCopy) {
    lines.push(
      "- 【文案铁律】先 read_file `.xu/copy-style.md` 与 `.xu/skills/copywriting-delivery/SKILL.md`，再读 `templates/copy/` 对应模板，成稿 write_file 到 `deliverables/copy/`；用户说「记住文案风格」则 write_file 更新 `.xu/copy-style.md`；禁止声称已对外发送；飞书/企微须老板确认（L4）；回复中写路径前必须已真实写入，禁止虚构 `.xu/deliverables/`",
    );
  }

  if (playbookPath) {
    lines.push(`- 必读：\`${playbookPath}\``);
  }
  const skillsHint =
    "必读最新项目 Skills：含 copywriting-delivery；软件项目另含 local-context-router、hybrid-architect、requirements-analyst、task-splitter、ui-interface-design（以 briefVersion 为准）";
  lines.push(`- ${skillsHint}`);
  if (project.docPath?.trim()) {
    lines.push(`- 只读参考文档目录：\`${project.docPath.trim()}\``);
  }

  return lines.filter(Boolean).join("\n");
}

/** Kickoff planning steps appended to boss task text. */
export function kickoffPlanningSteps(playbookPath?: string): string {
  return [
    "【强制流程 · 先架构边界再规划页面】",
    "0. 若存在 `.xu/ARCHITECTURE_BRIEF.md`：先 read_file 核对规模/身份租户与方案 A，再拆页面",
    "1. read_file 必读 playbook" + (playbookPath ? `：${playbookPath}` : "") + " 与 AGENTS.md",
    "2. read_file 最新项目 Skills：`.xu/skills/requirements-analyst/SKILL.md` 与 `.xu/skills/task-splitter/SKILL.md`（按 briefVersion，旧版作废）",
    "2b. 拆任务含界面/前端/页面时：先 read_file `.xu/skills/ui-interface-design/SKILL.md`，再拆页面路径；禁止无令牌直接堆组件",
    "3. list_dir 生成根目录，核实目录地图",
    "4. mkdir 创建本岗位需要的子目录（分析阶段允许 mkdir，禁止写业务文件）",
    "5. 输出 XU_TASKS: 编号清单，每项含「交付物 + 相对路径」",
    "6. 遇不确定：先短会对齐；仍决裂则 XU_NEED_CONFIRM（有经理先报经理，经理可自行裁决或「同意上报」老板）",
    "6b. 需求或实现听不懂、验收口径不清、缺关键信息：必须开会解决；禁止瞎猜硬写。经理仍无法裁决 → 明确问老板（用户 Boss）拍板后再继续",
    "7. 跨模块/跨端接口：先 XU_CROSS_MODULE + XU_NEED_CONFIRM 开会，禁止先写实现；Boss 可「确认跨模块」开写",
    "8. 无 XU_NEED_CONFIRM 后进入实现；禁止在根目录散落 .md/.docx",
  ].join("\n");
}

/** Boss 下令清理旧文档并重新规划时的任务正文。 */
export function resetAndReplanTask(bossText: string, playbookPath?: string): string {
  return [
    "【全员停工重整 · Boss 指令】",
    bossText.trim().slice(0, 1800),
    "",
    "【你必须立刻执行】",
    "1. 宿主已擦除生成根目录全部内容；视一切旧产出为作废",
    "2. 用 list_dir 核对空目录现状，按岗位 playbook 重新规划子目录",
    kickoffPlanningSteps(playbookPath),
    "3. 重新按岗位目录规划后再实现；禁止沿用旧路径乱写",
  ].join("\n");
}

/** Ensure playbook exists and stack end directories are created once per kickoff. */
export async function ensureProjectScaffold(project: XuProject): Promise<string> {
  const genPath = (project.generatePath || "").trim();
  if (!genPath) throw new Error("项目未设置生成路径");

  let playbookPath = project.requirements?.playbookPath?.trim() || "";
  if (!playbookPath) {
    playbookPath = await buildAndWritePlaybook({
      projectName: project.name,
      generatePath: genPath,
      stack: project.stackProfile || { enabled: {} },
      requirements: project.requirements || null,
      customRequirements: project.kickoffPlan?.customRequirements,
    });
  }

  const stack = project.stackProfile;
  if (stack) {
    for (const e of STACK_ENDS) {
      if (!stack.enabled?.[e.key]) continue;
      const dir = String(stack[`${e.key}Dir` as keyof StackProfile] || "").trim();
      if (!dir) continue;
      const abs = joinRoot(genPath, dir);
      try {
        await mkdirRecursive(genPath, abs);
      } catch {
        /* may exist */
      }
    }
    for (const extra of ["docs", "docs/qa", ".xu"]) {
      try {
        await mkdirRecursive(genPath, joinRoot(genPath, extra));
      } catch {
        /* ignore */
      }
    }
  }

  return playbookPath;
}
