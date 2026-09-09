/**
 * Parse XU_TASKS block from planner output.
 */
import type { WorkflowTaskItem } from "./projects";

const TASK_MARKERS = ["XU_TASKS:", "XU_TASKS："];

export function parseXuTasks(text: string): WorkflowTaskItem[] {
  const raw = text || "";
  let start = -1;
  for (const m of TASK_MARKERS) {
    const i = raw.indexOf(m);
    if (i >= 0) {
      start = i + m.length;
      break;
    }
  }
  if (start < 0) return [];
  const rest = raw.slice(start);
  const items: WorkflowTaskItem[] = [];
  let idx = 0;
  for (const line of rest.split("\n")) {
    const t = line.trim();
    if (!t) {
      if (items.length) break;
      continue;
    }
    if (/^XU_(PHASE|NEED_CONFIRM)/i.test(t)) break;
    const m = t.match(
      /^(\d+)[.)、\]]\s*(?:\[(.+?)\]|【(.+?)】)?\s*(.+?)(?:\s*[-—–]\s*(.+))?$/,
    );
    if (!m) continue;
    const roleHint = (m[2] || m[3] || "工程").trim();
    const title = (m[4] || t).trim();
    const deliverable = m[5]?.trim();
    if (!title) continue;
    idx += 1;
    items.push({
      taskId: `task_${idx}`,
      title,
      roleHint,
      deliverable,
      dependsOn: idx > 1 ? [`task_${idx - 1}`] : [],
      employeeId: null,
      status: "pending",
    });
  }
  return items;
}

export function buildPlanArtifactMarkdown(
  projectName: string,
  tasks: WorkflowTaskItem[],
  plannerName: string,
): string {
  const lines = [
    `# ${projectName} · 项目计划`,
    "",
    `规划师：${plannerName}`,
    `生成时间：${new Date().toLocaleString("zh-CN")}`,
    "",
    "## 任务清单",
    "",
  ];
  for (const t of tasks) {
    lines.push(
      `${t.taskId.replace("task_", "")}. [${t.roleHint}] ${t.title}${t.deliverable ? ` — 交付：${t.deliverable}` : ""}`,
    );
  }
  lines.push("", "## Boss 确认", "", "请在飞书或办公室回复「同意」后开始开发。");
  return lines.join("\n");
}
