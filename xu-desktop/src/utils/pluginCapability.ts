import { invoke } from "@tauri-apps/api/core";
import { fouAlert, fouConfirmPromise } from "foucui";
import { toUserError } from "./userFacingError";

/** Prompts to pick a working directory when missing. Caller should re-check path after onPick. */
export async function requireWorkingDir(
  path: string | null | undefined,
  feature: string,
  onPick?: () => void | Promise<void>,
): Promise<boolean> {
  if (path?.trim()) return true;

  const action = await fouConfirmPromise(
    `「${feature}」需要先选择工作目录。可在对话页顶部「工作目录」栏选择，或点击下方按钮立即选择。`,
    "未选择工作目录",
    { confirmButtonText: "去选择", cancelButtonText: "取消" },
  );
  if (action === "confirm" && onPick) await onPick();
  return Boolean(path?.trim());
}

let screenshotProbeOk: boolean | null = null;

/** Probes tauri-plugin-screenshots-api; caches success for the session. */
export async function probeScreenshotApi(): Promise<boolean> {
  if (screenshotProbeOk === true) return true;
  try {
    const api = await import("tauri-plugin-screenshots-api");
    const monitors = await api.getScreenshotableMonitors();
    if (!monitors?.length) throw new Error("未找到可截取的显示器");
    screenshotProbeOk = true;
    return true;
  } catch (e) {
    screenshotProbeOk = false;
    await fouAlert(
      `截屏功能不可用：${toUserError(e)}。请确认系统已授予屏幕录制权限后重试。`,
      "截屏插件不可用",
    );
    return false;
  }
}
