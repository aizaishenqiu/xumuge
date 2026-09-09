import { readLs, writeLs } from "../utils/xuStorage";
import { hasEntitlement } from "./entitlements";
import { findPluginForEntitlement } from "./registry";
import { ensureBuiltinCommercePlugins } from "./builtinPlugins";
import { toUserError } from "../utils/userFacingError";

export const TRAINING_OPT_IN_KEY = "xu.training.optIn";

export function isTrainingOptIn(): boolean {
  return readLs(TRAINING_OPT_IN_KEY) === "1";
}

export function setTrainingOptIn(enabled: boolean): void {
  writeLs(TRAINING_OPT_IN_KEY, enabled ? "1" : "0");
}

/**
 * Core stub for `xu_training_enqueue`: no-op unless opt-in + training.ingest + plugin hook.
 * Never loads heavy commercial modules from the open-source shell.
 */
export async function enqueueTrainingSample(row: unknown): Promise<{ ok: boolean; reason?: string }> {
  if (!isTrainingOptIn()) {
    return { ok: true, reason: "opt_out" };
  }
  if (!(await hasEntitlement("training.ingest"))) {
    return { ok: false, reason: "no_entitlement" };
  }
  ensureBuiltinCommercePlugins();
  const plugin = findPluginForEntitlement("training.ingest");
  if (!plugin?.enqueueTrainingSample) {
    return { ok: false, reason: "no_plugin" };
  }
  try {
    await plugin.enqueueTrainingSample(row);
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: toUserError(e).slice(0, 120) };
  }
}

/** Log when sample was expected but skipped (callers after enqueue). */
export function warnTrainingSampleSkipped(r: { ok: boolean; reason?: string }): void {
  if (r.ok || r.reason === "opt_out") return;
  console.warn(`[fou] training sample skipped: ${r.reason || "unknown"}`);
}
