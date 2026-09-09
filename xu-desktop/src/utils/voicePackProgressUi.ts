/**
 * @file 语音包安装进度文案与 ETA 格式化
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-31
 * @version 1.0.0
 * @category UI
 * @algo linear-eta-from-bytes
 */

import type { VoicePackProgress } from "./voicePacks";

/** 安装阶段中文标签（下载 / 解压 / 校验等）。 */
export function voicePackStageLabel(stage: VoicePackProgress["stage"] | string | undefined): string {
  switch (stage) {
    case "starting":
      return "准备";
    case "downloading":
      return "下载";
    case "extracting":
      return "解压";
    case "verifying":
      return "校验";
    case "done":
      return "完成";
    default:
      return "处理";
  }
}

/** 进度百分比；无 total 时返回 null。 */
export function voicePackProgressPercent(progress: VoicePackProgress | null | undefined): number | null {
  if (!progress?.total || progress.total <= 0) return null;
  return Math.min(100, Math.round((progress.received / progress.total) * 100));
}

/** 已处理/总量字节或文件数文案。 */
export function voicePackProgressAmount(progress: VoicePackProgress | null | undefined): string {
  if (!progress) return "";
  const { received, total } = progress;
  if (total && total > 0) {
    if (progress.stage === "verifying") {
      return `${received}/${total} 个文件`;
    }
    return `${formatBytes(received)} / ${formatBytes(total)}`;
  }
  if (received > 0) return formatBytes(received);
  return "";
}

/** 根据当前速度与剩余量估算剩余时间；elapsedMs 为自本阶段起计时。 */
export function voicePackEtaLabel(
  progress: VoicePackProgress | null | undefined,
  elapsedMs: number,
): string {
  if (!progress?.total || progress.total <= progress.received || elapsedMs < 400) {
    return "";
  }
  const rate = progress.received / (elapsedMs / 1000);
  if (!Number.isFinite(rate) || rate <= 0) return "";
  const remainingSec = (progress.total - progress.received) / rate;
  return formatEtaSeconds(remainingSec);
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatEtaSeconds(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "";
  if (seconds < 3) return "即将完成";
  if (seconds < 60) return `约 ${Math.ceil(seconds)} 秒`;
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `约 ${minutes} 分钟`;
  return `约 ${Math.ceil(minutes / 60)} 小时`;
}
