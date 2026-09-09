import { appendFouMessage } from "../utils/employees";
import { dispatchEmployeeTask } from "../employee/dispatch";
import { ensureEmployeesForRoleIds } from "../utils/employees";
import type { XuProject } from "../utils/projects";
import { OFFICE_FLOOR, peerSessionTag, BOSS_PEER_ID } from "../utils/officeComms";
import { listAgencyRoles } from "../office/agencyRoles";
import type { RequirementBrief } from "./briefTypes";
import { formatArchitectureConstraintLine } from "./briefTypes";
import { ARCHITECTURE_BRIEF_REL } from "./architectureBriefGenerator";
import { loadCodeExecPrefs } from "../utils/codeExecPrefs";

const OFFICE_SESSION = peerSessionTag(BOSS_PEER_ID, OFFICE_FLOOR);

const reviewCooldown = new Map<string, number>();

/** Prefer planning row from match plan, else catalog planning wave. */
export function findPlanningRoleId(brief: RequirementBrief): string | null {
  const fromPlan = (brief.matchPlan || []).find((p) =>
    /规划|产品|pm|需求分析|product|planner/i.test(`${p.roleNameZh} ${p.roleId}`),
  );
  if (fromPlan?.roleId) return fromPlan.roleId;

  const roles = listAgencyRoles();
  const planning = roles.find(
    (r) =>
      r.roleKind !== "boss" &&
      (r.kickoffWave === "planning" ||
        /规划|产品|pm|需求分析/i.test(`${r.nameZh} ${r.id} ${(r.tags || []).join(" ")}`)),
  );
  return planning?.id || null;
}

/**
 * After architecture brief is written: dispatch planning role to review (default on).
 */
export async function dispatchArchitectureBriefReview(opts: {
  project: XuProject;
  brief: RequirementBrief;
}): Promise<{ ok: boolean; message: string }> {
  const prefs = await loadCodeExecPrefs();
  if (!prefs.architectureReviewOnConfirm) {
    return { ok: false, message: "" };
  }

  const gen = (opts.project.generatePath || "").trim();
  if (!gen || opts.project.type !== "software") {
    return { ok: false, message: "" };
  }

  const cdKey = `${opts.project.id}:v${opts.brief.version || 0}`;
  const now = Date.now();
  if ((reviewCooldown.get(cdKey) || 0) + 8 * 60_000 > now) {
    return { ok: false, message: "" };
  }

  const roleId = findPlanningRoleId(opts.brief);
  if (!roleId) {
    return {
      ok: false,
      message: "未找到规划/产品岗，请手动派员工审阅架构草稿。",
    };
  }

  const employees = await ensureEmployeesForRoleIds([roleId]);
  if (!employees.length) {
    return {
      ok: false,
      message: "规划岗未入职，请入职后手动派活审阅 `.xu/ARCHITECTURE_BRIEF.md`。",
    };
  }

  const emp = employees[0]!;
  const task = [
    "【架构草稿审阅 · Brief 确认后自动派活】",
    `Brief v${opts.brief.version || 0} 已确认，系统已生成架构草稿。`,
    formatArchitectureConstraintLine(opts.brief),
    "",
    "你必须：",
    `1. read_file \`${ARCHITECTURE_BRIEF_REL}\` 与 Brief/playbook`,
    "2. read_file `.xu/skills/hybrid-architect/SKILL.md`",
    "3. 核对 Brief 规模档位/身份租户模型与架构方案 A 是否一致；不一致则修订",
    "4. 对照 Brief 验收与 scope，修订 `XU_ARCHITECTURE_BRIEF` 块（可 apply_patch 该文件）",
    "5. 列出风险、待 Boss 确认项（XU_NEED_CONFIRM）与建议派岗顺序",
    "6. **先定边界与身份/租户，再拆页面清单**——禁止未确认规模就过度设计微服务",
    "",
    `目标：${opts.brief.goal || "（见 Brief）"}`,
  ].join("\n");

  await dispatchEmployeeTask(
    { ...emp, workspaceRoot: emp.workspaceRoot || gen },
    {
      task,
      projectId: opts.project.id,
      directImplement: false,
      workspaceRoot: emp.workspaceRoot || gen,
    },
  );

  reviewCooldown.set(cdKey, now);
  const msg = `📐 已派 ${emp.name} 审阅架构草稿（\`${ARCHITECTURE_BRIEF_REL}\`）。`;
  await appendFouMessage({
    sessionTag: OFFICE_SESSION,
    employeeId: emp.id,
    role: "system",
    content: msg,
  });
  return { ok: true, message: msg };
}
