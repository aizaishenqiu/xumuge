/**
 * @file QA 缺陷持久化、逐项需求验收与派活
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-30
 * @version 1.1.0
 * @category ToolPolicy
 * @algo requirement-driven-qa
 */
import { exists, readTextFile } from "@tauri-apps/plugin-fs";
import { mkdirRecursive, writeTextUnderWorkspace } from "./fsBridge";
import type { QaDefect } from "./qaDefects";
import { formatDefectFixTask } from "./qaDefects";
import type { XuProject } from "./projects";
import type { Employee } from "./employees";
import { dispatchEmployeeTask } from "../employee";

const DEFECTS_FILE = "defects.jsonl";

export async function defectsPath(generatePath: string): Promise<string> {
  const root = generatePath.replace(/[/\\]$/, "");
  return `${root}/.xu/${DEFECTS_FILE}`;
}

export async function loadDefects(generatePath: string): Promise<QaDefect[]> {
  const path = await defectsPath(generatePath);
  try {
    if (!(await exists(path))) return [];
    const raw = await readTextFile(path);
    return raw
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => JSON.parse(l) as QaDefect);
  } catch {
    return [];
  }
}

export async function appendDefect(generatePath: string, d: QaDefect): Promise<void> {
  const path = await defectsPath(generatePath);
  const genPath = generatePath.replace(/[/\\]$/, "");
  const dir = path.replace(/[/\\][^/\\]+$/, "");
  try {
    await mkdirRecursive(genPath, dir);
  } catch {
    /* exists */
  }
  let prev = "";
  try {
    if (await exists(path)) prev = await readTextFile(path);
  } catch {
    /* ignore */
  }
  const line = `${JSON.stringify(d)}\n`;
  await writeTextUnderWorkspace(genPath, path, prev + line);
}

export function openDefects(defects: QaDefect[]): QaDefect[] {
  return defects.filter((d) => d.status === "open" || d.status === "retest");
}

export async function dispatchDefectFix(
  project: XuProject,
  emp: Employee,
  defect: QaDefect,
): Promise<void> {
  const task = formatDefectFixTask(defect, project.name);
  await dispatchEmployeeTask(emp, {
    task,
    workspaceRoot: emp.workspaceRoot || project.generatePath,
    projectId: project.id,
    directImplement: true,
  });
}

export interface DefectDispatchToolPayload {
  ok?: boolean;
  dispatch?: boolean;
  defectId?: string;
  title?: string;
  task?: string;
  officeHint?: string;
  assigneeRole?: string;
}

/** 解析 dispatch_defect_fix 工具 JSON 并派给开发岗。 */
export async function executeDefectDispatchFromTool(
  project: XuProject,
  toolOutput: string,
): Promise<boolean> {
  let payload: DefectDispatchToolPayload;
  try {
    payload = JSON.parse(toolOutput) as DefectDispatchToolPayload;
  } catch {
    return false;
  }
  if (!payload.ok || !payload.dispatch || !payload.task?.trim()) return false;
  const defects = await loadDefects(project.generatePath);
  const defect =
    defects.find((d) => d.id === payload.defectId) ||
    defects.find((d) => d.status === "fixing" || d.status === "open");
  if (!defect) return false;
  const { readEmployees, appendFouMessage } = await import("./employees");
  const emps = readEmployees();
  const dev =
    emps.find((e) => /工程|开发|前端|后端|全栈|engineer/i.test(`${e.role} ${e.agentRoleId || ""}`)) ||
    emps[0];
  if (!dev) return false;
  await dispatchEmployeeTask(dev, {
    task: payload.task,
    workspaceRoot: dev.workspaceRoot || project.generatePath,
    projectId: project.id,
    directImplement: true,
  });
  if (payload.officeHint) {
    await appendFouMessage({
      sessionTag: "office-floor",
      role: "system",
      content: payload.officeHint,
    });
  }
  return true;
}

export function buildQaTask(project: XuProject, featureTitle: string): string {
  const playbook = project.requirements?.playbookPath || "REQUIREMENTS_PLAYBOOK.md";
  return [
    "【QA 测试任务】",
    `项目：${project.name}`,
    `功能：${featureTitle}`,
    `请先 read_file 阅读 ${playbook} 与相关交付路径。`,
    "使用 browser_open / browser_screenshot 做冒烟；发现问题写入 .xu/defects.jsonl（每行一条 JSON）。",
    "【UI 验收】若存在 `.xu/qa/ui-scenarios.json`，可用 run_ui_acceptance 批跑；失败自动写入 defects 并截图。",
    "格式参考：id/title/severity/type/steps/expected/actual/screenshotPath/targetPath/status",
    "【必须】在 .xu/qa/CHECKLIST.md 按 4 类写出检查清单（通过改为 `- [x]`）：",
    "1）功能：对照需求 Must 逐条",
    "2）安全：越权、路径穿越、注入、授权",
    "3）兼容：Windows 版本 / 浏览器",
    "4）冒烟：核心路径一遍",
    "【需求门禁】读取 `.xu/requirements-gate.json`，按工作包中的 requirementId/acceptanceId 逐项写 passed/failed/waived 与 evidence；禁止删除他人结果。",
    "任一 Must、行业必需项、冲突项或验收项未通过时，必须保持 failed/pending，不得汇报 completed。",
    "并起草 `.xu/qa/UAT.md` 供产品/Boss 勾选。无 CHECKLIST 勾选不可 UAT/结项。",
    "【必须】创建 `.xu/security/RELEASE_CHECKLIST.md` 草稿（若不存在）；详细勾选由安全审查波完成。",
    "无缺陷则汇报「测试通过」并列出已勾选检查项。",
    "发现 P0 缺陷可用 dispatch_defect_fix 派开发岗修复（须审批）。",
  ].join("\n");
}

export async function dispatchQaForFeature(
  project: XuProject,
  qaEmp: Employee,
  featureTitle: string,
): Promise<void> {
  await dispatchEmployeeTask(qaEmp, {
    task: buildQaTask(project, featureTitle),
    workspaceRoot: qaEmp.workspaceRoot || project.generatePath,
    projectId: project.id,
    directImplement: false,
  });
}
