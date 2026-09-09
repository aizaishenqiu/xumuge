import { listLocalModels, probeBrain } from "./opsBrains";
import type { RemoteModelPreset } from "./globalModelProfiles";

export function isProbeSuccess(msg: string): boolean {
  const t = msg.trim();
  if (!t) return false;
  if (t.includes("未找到模型")) return false;
  return t.startsWith("OK");
}

export async function probeModelOk(
  baseUrl: string,
  opts: { model?: string; apiKeyEnv?: string },
): Promise<boolean> {
  try {
    const msg = await probeBrain(baseUrl, {
      model: opts.model || undefined,
      apiKeyEnv: opts.apiKeyEnv || undefined,
    });
    return isProbeSuccess(msg);
  } catch {
    return false;
  }
}

export async function filterVerifiedLocalModels(baseUrl: string): Promise<string[]> {
  let models: string[] = [];
  try {
    models = await listLocalModels(baseUrl);
  } catch {
    return [];
  }
  const checks = await Promise.all(
    models.map(async (m) => ((await probeModelOk(baseUrl, { model: m })) ? m : null)),
  );
  return checks.filter((x): x is string => Boolean(x));
}

export async function filterVerifiedRemotePresets(
  presets: RemoteModelPreset[],
): Promise<RemoteModelPreset[]> {
  const checks = await Promise.all(
    presets.map(async (p) => {
      if (!p.baseUrl.trim() || !p.textModel.trim()) return null;
      if (p.lastProbeOk === true) return p;
      const ok = await probeModelOk(p.baseUrl, {
        model: p.textModel,
        apiKeyEnv: p.apiKeyEnv || undefined,
      });
      return ok ? { ...p, lastProbeOk: true } : null;
    }),
  );
  return checks.filter((x): x is RemoteModelPreset => Boolean(x));
}
