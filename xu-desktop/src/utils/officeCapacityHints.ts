/**
 * Unified office staffing / GPU / kickoff limits for banners and preflight copy.
 */
import { OFFICE_DESK_MAX } from "./officeSettings";
import { readKickoffMaxEmployees } from "./concurrencySlots";

/** Above this roster size, 3D is discouraged (WebGL cost). */
export const OFFICE_GPU_3D_SOFT_LIMIT = 12;

/** Copy aligned with office overview + kickoff preflight. */
export const OFFICE_KICKOFF_SOFT_LIMIT = 15;

export type OfficeCapacitySeverity = "info" | "warn";

export type OfficeCapacityAssessment = {
  severity: OfficeCapacitySeverity;
  suggest2d: boolean;
  autoSwitch2d: boolean;
  lines: string[];
};

export function assessOfficeCapacity(opts: {
  rosterCount: number;
  deskCount: number;
  viewMode: "2d" | "3d";
  kickoffMax?: number;
}): OfficeCapacityAssessment {
  const kickoffMax = opts.kickoffMax ?? readKickoffMaxEmployees();
  const lines: string[] = [];
  let severity: OfficeCapacitySeverity = "info";
  let suggest2d = false;
  let autoSwitch2d = false;

  if (opts.rosterCount > OFFICE_GPU_3D_SOFT_LIMIT && opts.viewMode === "3d") {
    suggest2d = true;
    autoSwitch2d = true;
    severity = "warn";
    lines.push(
      `编制 ${opts.rosterCount} 人超过 3D 建议上限（${OFFICE_GPU_3D_SOFT_LIMIT}），已建议切换 2D 以减轻 GPU 负担。`,
    );
  } else if (opts.rosterCount > OFFICE_GPU_3D_SOFT_LIMIT) {
    lines.push(
      `编制 ${opts.rosterCount} 人：建议保持 2D 视图（3D 上限约 ${OFFICE_GPU_3D_SOFT_LIMIT} 人）。`,
    );
  }

  if (opts.rosterCount > opts.deskCount) {
    lines.push(
      `花名册 ${opts.rosterCount} 人超过工位 ${opts.deskCount} 席，可点「一键补齐工位」或到办公室设置调整。`,
    );
    if (severity === "info") severity = "warn";
  }

  if (opts.deskCount >= OFFICE_DESK_MAX) {
    lines.push(`工位已达设置上限 ${OFFICE_DESK_MAX}，新增员工请先在设置中扩容或释放席位。`);
    if (severity === "info") severity = "warn";
  }

  const kickoffHint =
    kickoffMax > 0 ? kickoffMax : OFFICE_KICKOFF_SOFT_LIMIT;
  if (opts.rosterCount > kickoffHint) {
    const capLabel = kickoffMax > 0 ? `设置上限 ${kickoffMax}` : `建议 ≤${OFFICE_KICKOFF_SOFT_LIMIT}`;
    lines.push(`单次「全体开工」${capLabel} 人；当前花名册 ${opts.rosterCount} 人，请分批或调高「设置 → 并发」。`);
    severity = "warn";
  }

  return { severity, suggest2d, autoSwitch2d, lines };
}

export function officeCapacityBannerText(assessment: OfficeCapacityAssessment): string | null {
  if (!assessment.lines.length) return null;
  return assessment.lines.join(" ");
}
