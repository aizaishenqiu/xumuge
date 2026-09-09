/**
 * @file voice-engine-capability.mjs — 与 src/utils/voiceEngineCapability.ts 纯函数契约对齐
 * @author qiuye <yjk150@qq.com>
 * @date 2026-09-03
 * @version 1.0.0
 * @category Config
 * @algo capability-tri-state
 */

/**
 * @param {"sherpa-onnx"|"cosyvoice"} provider
 * @param {{ provider: string }[]} packs
 * @param {{ packInstalled?: boolean, synthesisAvailable?: boolean }|null|undefined} status
 */
export function resolveOfflineCapability(provider, packs, status) {
  const packInstalled =
    status?.packInstalled ?? packs.some((p) => p.provider === provider);
  if (!packInstalled) return "packMissing";
  if (status?.synthesisAvailable) return "ready";
  return "packOnly";
}

/**
 * @param {"packMissing"|"packOnly"|"ready"} base
 * @param {{ installPhaseReady?: boolean, launchPathsConfigured?: boolean, discoverOk?: boolean }} hints
 */
export function liftCosyOfflineCapability(base, hints) {
  if (base === "ready" || base === "packOnly") return base;
  const envReady =
    Boolean(hints.installPhaseReady) ||
    Boolean(hints.launchPathsConfigured) ||
    Boolean(hints.discoverOk);
  return envReady ? "packOnly" : "packMissing";
}

/** @param {"packMissing"|"packOnly"|"ready"} capability */
export function offlineCapabilityBadge(capability) {
  switch (capability) {
    case "ready":
      return "可用";
    case "packOnly":
      return "已装·不可合成";
    default:
      return "未装";
  }
}
