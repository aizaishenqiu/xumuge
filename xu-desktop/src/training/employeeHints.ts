/**
 * @file 岗位模板与员工覆盖课程提示注入
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-31
 * @version 2.0.0
 * @category AgentLoop
 * @algo role-template-employee-override
 */
import { loadCurriculum, resolveCurriculum } from "../commerce/trainingLocal";

/** Short block for one employee's role from local curriculum. */
export async function buildEmployeeCurriculumHint(
  roleId: string | null | undefined,
  employeeId?: string | null,
): Promise<string> {
  try {
    const rid = (roleId || "").trim();
    if (!rid) return "";
    const doc = await loadCurriculum();
    const entry = resolveCurriculum(doc, rid, employeeId);
    if (!entry) return "";
    const lines = [
      "【员工完整训练 · 本岗课程】",
      `生效版本 v${entry.version}（${entry.scope === "employee" ? "员工覆盖优先" : "岗位模板"}）。来自本机训练库，按知识、案例、反例与评分 rubric 执行。`,
    ];
    if (entry.knowledgeDocs.length) {
      lines.push(`知识文档：${entry.knowledgeDocs.slice(0, 8).join("；")}`);
    }
    for (const item of entry.cases.slice(0, 6)) {
      lines.push(`- 正例「${item.title}」：${item.input.slice(0, 240)}`);
      if (item.expected) lines.push(`  期望：${item.expected.slice(0, 240)}`);
    }
    for (const item of entry.counterExamples.slice(0, 4)) {
      lines.push(`- 反例「${item.title}」：${item.input.slice(0, 200)}`);
      if (item.expected) lines.push(`  修复：${item.expected.slice(0, 200)}`);
    }
    if (entry.rubricSpec.criteria.length) {
      lines.push(`评分门槛：${entry.rubricSpec.passScore}/100`);
      for (const criterion of entry.rubricSpec.criteria.slice(0, 8)) {
        lines.push(
          `- ${criterion.title}（${criterion.weight}%）：${criterion.requirement.slice(0, 220)}`,
        );
      }
    }
    return lines.join("\n");
  } catch {
    return "";
  }
}
