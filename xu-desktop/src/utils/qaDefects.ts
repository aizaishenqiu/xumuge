/**
 * QA defect ticket helpers (browser/desktop pipeline).
 */

export type DefectSeverity = "critical" | "major" | "minor" | "trivial";
export type DefectType = "bug" | "logic";
export type DefectStatus = "open" | "fixing" | "fixed" | "wontfix" | "retest";

export interface QaDefect {
  id: string;
  title: string;
  severity: DefectSeverity;
  type: DefectType;
  steps: string;
  expected: string;
  actual: string;
  screenshotPath?: string;
  targetPath?: string;
  status: DefectStatus;
}

export function formatDefectFixTask(d: QaDefect, projectName?: string): string {
  return [
    projectName ? `【项目】${projectName}` : "",
    `【修缺陷】一次只修这一条：${d.id}`,
    `标题：${d.title}`,
    `类型：${d.type} · 严重度：${d.severity}`,
    `步骤：${d.steps}`,
    `期望：${d.expected}`,
    `实际：${d.actual}`,
    d.screenshotPath ? `截图：${d.screenshotPath}` : "",
    d.targetPath
      ? `请用 ide_open 打开：${d.targetPath}，修复后把缺陷 status 标为 fixed 并简要说明改动。`
      : "请定位相关代码，用 ide_open 打开后修复；修完汇报真实路径。",
    "禁止同时接下一条缺陷。",
  ]
    .filter(Boolean)
    .join("\n");
}
