/** Reviewer assist: screenshot Cursor → dispatch reviewer with confirm-only policy. */

import {
  canScreenshotToCursor,
  canUseInputDrive,
  readDriveSettings,
} from "./driveSettings";
import {
  loadEmployees,
  type Employee,
} from "./employees";
import { dispatchEmployeeTask } from "../employee";
import { attachImageToChat, captureScreenToDataUrl } from "./screenshot";
import { toUserError } from "./userFacingError";

export type ReviewerAssistPhase =
  | "idle"
  | "capturing"
  | "dispatching"
  | "input_stub"
  | "done"
  | "error";

export interface ReviewerAssistResult {
  phase: ReviewerAssistPhase;
  message: string;
  reviewer?: Employee;
  imageAttached: boolean;
}

const CONFIRM_TASK = [
  "【IDE 代确认 · 仅点击】",
  "用户请求你协助确认 Cursor/IDE 弹窗。",
  "规则：",
  "1. 只允许点击确认类按钮：Confirm / Continue / Accept / 确认 / 继续 / Allow。",
  "2. 禁止点击 Cancel、Reject、删除、关闭以外的危险操作。",
  "3. 若截图中看不到明确确认按钮，说明原因并停止，不要乱点。",
  "4. 键鼠注入若未启用，仅根据截图给出应点哪个按钮的建议。",
].join("\n");

export async function resolveDefaultReviewer(): Promise<Employee | null> {
  const drive = readDriveSettings();
  const list = await loadEmployees();
  if (drive.defaultReviewerId) {
    const hit = list.find((e) => e.id === drive.defaultReviewerId);
    if (hit) return hit;
  }
  return list.find((e) => e.roleKind === "reviewer") ?? null;
}

/** MVP: screenshot → attach chat + queue reviewer; optional input stub. */
export async function runReviewerConfirmAssist(
  onPhase?: (phase: ReviewerAssistPhase, detail: string) => void,
): Promise<ReviewerAssistResult> {
  const notify = (phase: ReviewerAssistPhase, message: string) => {
    onPhase?.(phase, message);
  };

  const drive = readDriveSettings();
  if (!drive.enabled) {
    return { phase: "error", message: "请先在设置中启用编码驾驶", imageAttached: false };
  }

  const reviewer = await resolveDefaultReviewer();
  if (!reviewer) {
    return {
      phase: "error",
      message: "未找到审核员：请添加 role=代码审核员 的员工，或在设置指定默认审核员",
      imageAttached: false,
    };
  }
  if (!reviewer.workspaceRoot?.trim()) {
    return {
      phase: "error",
      message: `审核员「${reviewer.name}」未设置可写工作区，无法派活`,
      reviewer,
      imageAttached: false,
    };
  }

  let imageAttached = false;
  try {
    if (canScreenshotToCursor(drive) || drive.useScreenshotToCursor) {
      notify("capturing", "正在截取 Cursor 窗口…");
      const shot = await captureScreenToDataUrl("cursor-window");
      attachImageToChat(shot.dataUrl, shot.filename);
      imageAttached = true;
    } else {
      notify("capturing", "未启用「截图投 Cursor」，跳过截屏");
    }

    notify("dispatching", `派给审核员 ${reviewer.name}…`);
    await dispatchEmployeeTask(reviewer, { task: CONFIRM_TASK });

    if (canUseInputDrive(drive)) {
      notify("input_stub", "键鼠已同意：主按钮点击仍为 stub（feat-310a）");
      // Stub only — full SendInput is out of scope this sprint.
      console.info("[xu] input_control stub: would click primary Confirm/Continue");
    }

    notify("done", "已派审核员代确认");
    return {
      phase: "done",
      message: imageAttached
        ? `已截图并派给「${reviewer.name}」`
        : `已派给「${reviewer.name}」（未截图）`,
      reviewer,
      imageAttached,
    };
  } catch (e) {
    return {
      phase: "error",
      message: toUserError(e),
      reviewer,
      imageAttached,
    };
  }
}
