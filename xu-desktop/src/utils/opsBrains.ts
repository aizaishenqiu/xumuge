import { invoke } from "@tauri-apps/api/core";
import { findPresetByModel } from "./modelCatalog";
import {
  getRemotePresetById,
  loadGlobalModelProfiles,
  type GlobalModelProfiles,
} from "./globalModelProfiles";

export type BrainSource = "local" | "remote";
export type EmployeeApiSource = "inherit" | "local" | "remote";
export type GlobalEmployeeApiSource = "follow" | "local" | "remote";

export const OLLAMA_DEFAULT_BASE = "http://127.0.0.1:11434/v1";
export const EMPLOYEE_WORK_API_SETTING = "xu.employee_work_api_source";

export interface BrainRemoteSnapshot {
  baseUrl: string;
  model: string;
  apiKeyEnv: string;
  provider: string;
}

export interface BrainSlotConfig {
  baseUrl: string;
  model: string;
  apiKeyEnv: string;
  /** Hermes / OpenAI-compatible provider */
  provider: string;
  source: BrainSource;
  /** Local vision model; empty falls back to model when hasImage */
  visionModel: string;
  remoteSnapshot?: BrainRemoteSnapshot | null;
  /** User-facing alias in chat replies */
  displayName?: string;
  /** Bound remote preset id from global model profiles */
  remotePresetId?: string;
}

export interface OpsBrains {
  command: BrainSlotConfig;
  work: BrainSlotConfig;
  code: BrainSlotConfig;
}

export interface ResolvedEndpoint {
  provider: string;
  model: string;
  baseUrl: string;
  apiKeyEnv: string;
  source: BrainSource;
  brainSlot: "command" | "work" | "code";
  apiFormat?: "openai" | "ollama" | "anthropic";
  /** Display name in chat UI; falls back to model id */
  displayName?: string;
  /** Catalog / remote preset id for billing */
  presetId?: string;
  /** True when remote was requested but invalid and local was used instead */
  fallbackFromRemote?: boolean;
}

export function isLocalProfileUsable(local: GlobalModelProfiles["local"]): boolean {
  return Boolean(local.textModel.trim() && local.baseUrl.trim());
}

export function isRemotePresetUsable(
  preset: NonNullable<ReturnType<typeof getRemotePresetById>>,
): boolean {
  return Boolean(preset.textModel.trim() && preset.baseUrl.trim());
}

export function emptyResolvedEndpoint(
  brainSlot: "command" | "work" | "code",
): ResolvedEndpoint {
  return {
    provider: "custom",
    model: "",
    baseUrl: "",
    apiKeyEnv: "",
    source: "remote",
    brainSlot,
  };
}

const empty = (): BrainSlotConfig => ({
  baseUrl: "",
  model: "",
  apiKeyEnv: "",
  provider: "",
  source: "remote",
  visionModel: "",
  remoteSnapshot: null,
  displayName: "",
  remotePresetId: "",
});

function inferSource(raw: Partial<BrainSlotConfig>): BrainSource {
  if (raw.source === "local" || raw.source === "remote") return raw.source;
  const url = (raw.baseUrl ?? "").toLowerCase();
  if (url.includes("11434") || url.includes("ollama")) return "local";
  return "remote";
}

/** Reject pasted secret values mistaken for env var names. */
export function sanitizeApiKeyEnv(raw: string): string {
  const t = raw.trim();
  if (!t) return "";
  if (/^sk[-_]/i.test(t) || t.length > 64 || /\s/.test(t)) return "";
  return t;
}

function normalizeSlot(raw: Partial<BrainSlotConfig> | undefined): BrainSlotConfig {
  const base = empty();
  if (!raw) return base;
  const model = (raw.model ?? "").trim();
  const provider = (raw.provider ?? "").trim();
  const preset = !provider && model ? findPresetByModel(model) : undefined;
  const snap = raw.remoteSnapshot;
  return {
    baseUrl: raw.baseUrl ?? "",
    model: raw.model ?? "",
    apiKeyEnv: sanitizeApiKeyEnv(raw.apiKeyEnv ?? ""),
    provider: provider || preset?.provider || (model ? "custom" : ""),
    source: inferSource(raw),
    visionModel: (raw.visionModel ?? "").trim(),
    displayName: (raw.displayName ?? "").trim(),
    remotePresetId: (raw.remotePresetId ?? "").trim(),
    remoteSnapshot: snap
      ? {
          baseUrl: snap.baseUrl ?? "",
          model: snap.model ?? "",
          apiKeyEnv: sanitizeApiKeyEnv(snap.apiKeyEnv ?? ""),
          provider: snap.provider ?? "",
        }
      : null,
  };
}

export function defaultOpsBrains(): OpsBrains {
  return { command: empty(), work: empty(), code: empty() };
}

export async function loadOpsBrains(): Promise<OpsBrains> {
  try {
    const raw = await invoke<OpsBrains>("xu_get_ops_brains");
    return {
      command: normalizeSlot(raw?.command),
      work: normalizeSlot(raw?.work),
      code: normalizeSlot(raw?.code),
    };
  } catch {
    return defaultOpsBrains();
  }
}

export async function saveOpsBrains(brains: OpsBrains): Promise<void> {
  await invoke("xu_set_ops_brains", {
    brains: {
      command: normalizeSlot(brains.command),
      work: normalizeSlot(brains.work),
      code: normalizeSlot(brains.code),
    },
  });
}

/** Switch slot source; snapshot remote fields when entering local. */
export function applyBrainSource(
  slot: BrainSlotConfig,
  next: BrainSource,
): BrainSlotConfig {
  if (next === slot.source) return slot;
  if (next === "local") {
    const snap: BrainRemoteSnapshot = {
      baseUrl: slot.baseUrl,
      model: slot.model,
      apiKeyEnv: slot.apiKeyEnv,
      provider: slot.provider,
    };
    return {
      ...slot,
      source: "local",
      remoteSnapshot: snap,
      baseUrl: OLLAMA_DEFAULT_BASE,
      apiKeyEnv: "",
      provider: "custom",
    };
  }
  const snap = slot.remoteSnapshot;
  if (snap && (snap.baseUrl || snap.model)) {
    return {
      ...slot,
      source: "remote",
      baseUrl: snap.baseUrl,
      model: snap.model || slot.model,
      apiKeyEnv: snap.apiKeyEnv,
      provider: snap.provider || slot.provider || "custom",
    };
  }
  return { ...slot, source: "remote" };
}

export async function loadEmployeeWorkApiSource(): Promise<GlobalEmployeeApiSource> {
  try {
    const raw = await invoke<string | null>("xu_get_setting", {
      key: EMPLOYEE_WORK_API_SETTING,
    });
    if (raw === "local" || raw === "remote" || raw === "follow") return raw;
  } catch {
    /* ignore */
  }
  return "follow";
}

export async function saveEmployeeWorkApiSource(
  value: GlobalEmployeeApiSource,
): Promise<void> {
  await invoke("xu_set_setting", {
    key: EMPLOYEE_WORK_API_SETTING,
    value,
  });
}

export async function probeBrain(
  baseUrl: string,
  opts?: { apiKeyEnv?: string; model?: string },
): Promise<string> {
  return invoke<string>("xu_probe_brain", {
    baseUrl,
    apiKeyEnv: opts?.apiKeyEnv ?? null,
    model: opts?.model ?? null,
  });
}

export async function listLocalModels(baseUrl?: string): Promise<string[]> {
  return invoke<string[]>("xu_list_local_models", {
    baseUrl: (baseUrl ?? "").trim() || null,
  });
}

/** @deprecated No-op — 虚募阁 Native Agent does not write external config.yaml */
export async function applyBrainSlot(_slot: "command" | "work" | "code"): Promise<void> {}

/** @deprecated No-op — 虚募阁 Native Agent does not write external config.yaml */
export async function applyEmployeeBrain(_emp: {
  brainSlot: "command" | "work" | "code";
  aiModel?: string;
  aiBaseUrl?: string;
  aiVisionModel?: string;
  apiSource?: EmployeeApiSource | string;
  remotePresetId?: string;
}): Promise<void> {}

export function effectiveApiSource(opts: {
  empApiSource?: EmployeeApiSource | string | null;
  globalDefault: GlobalEmployeeApiSource;
  defaultSource: "local" | "remote";
}): BrainSource {
  const emp = (opts.empApiSource ?? "inherit").trim();
  if (emp === "local" || emp === "remote") return emp;
  if (opts.globalDefault === "local" || opts.globalDefault === "remote") {
    return opts.globalDefault;
  }
  return opts.defaultSource;
}

function pickModel(
  textModel: string,
  visionModel: string,
  hasImage?: boolean,
  legacyOverride?: string,
  legacyVision?: string,
): string {
  const override = (legacyOverride ?? "").trim();
  if (override) return override;
  if (hasImage) {
    const vis = (legacyVision ?? "").trim() || visionModel.trim();
    if (vis) return vis;
  }
  return textModel.trim();
}

function endpointFromLocal(
  local: GlobalModelProfiles["local"],
  opts: {
    hasImage?: boolean;
    legacyModel?: string;
    legacyVision?: string;
  },
  brainSlot: "command" | "work" | "code",
): ResolvedEndpoint {
  const model = pickModel(local.textModel, local.visionModel, opts.hasImage, opts.legacyModel, opts.legacyVision);
  const displayName = (local.displayName ?? "").trim();
  return {
    provider: "custom",
    model,
    baseUrl: local.baseUrl.trim() || OLLAMA_DEFAULT_BASE,
    apiKeyEnv: "",
    source: "local",
    brainSlot,
    apiFormat: "ollama",
    displayName: displayName || undefined,
    presetId: "local",
  };
}

function endpointFromRemote(
  preset: NonNullable<ReturnType<typeof getRemotePresetById>>,
  opts: {
    hasImage?: boolean;
    legacyModel?: string;
    legacyVision?: string;
    legacyBaseUrl?: string;
  },
  brainSlot: "command" | "work" | "code",
): ResolvedEndpoint {
  const model = pickModel(
    preset.textModel,
    preset.visionModel,
    opts.hasImage,
    opts.legacyModel,
    opts.legacyVision,
  );
  const presetHit = model ? findPresetByModel(model) : undefined;
  const displayName = (preset.label ?? "").trim();
  const apiFormat =
    preset.apiFormat ??
    (preset.provider === "anthropic" ? "anthropic" : presetHit?.apiFormat) ??
    "openai";
  return {
    provider: preset.provider.trim() || presetHit?.provider || "custom",
    model,
    baseUrl: (opts.legacyBaseUrl ?? "").trim() || preset.baseUrl || presetHit?.baseUrl || "",
    apiKeyEnv: preset.apiKeyEnv.trim() || presetHit?.apiKeyEnv || "",
    source: "remote",
    brainSlot,
    apiFormat,
    displayName: displayName || undefined,
    presetId: preset.id,
  };
}

export async function resolveEndpoint(opts: {
  slot: "command" | "work" | "code";
  emp?: {
    id?: string;
    brainSlot?: "command" | "work" | "code";
    apiSource?: EmployeeApiSource | string;
    remotePresetId?: string;
    aiModel?: string;
    aiBaseUrl?: string;
    aiVisionModel?: string;
  };
  hasImage?: boolean;
  /** Chat footer picker: honor profiles.defaultSource, not employee-work global override */
  chatContext?: boolean;
  /** Coding employees: prefer a usable remote model over local Ollama when not localOnly. */
  preferRemote?: boolean;
}): Promise<ResolvedEndpoint> {
  const profiles = await loadGlobalModelProfiles();
  const brains = await loadOpsBrains();
  const slotKey = opts.emp?.brainSlot ?? opts.slot;
  const slotCfg = brains[slotKey] || defaultOpsBrains()[slotKey];

  if (profiles.localOnly) {
    if (isLocalProfileUsable(profiles.local) || slotCfg.model.trim()) {
      const legacy = {
        legacyModel: opts.emp?.aiModel || slotCfg.model,
        legacyVision: opts.emp?.aiVisionModel || slotCfg.visionModel,
        legacyBaseUrl: opts.emp?.aiBaseUrl || slotCfg.baseUrl,
        hasImage: opts.hasImage,
      };
      return endpointFromLocal(
        {
          ...profiles.local,
          textModel: profiles.local.textModel || slotCfg.model,
          baseUrl: profiles.local.baseUrl || slotCfg.baseUrl || OLLAMA_DEFAULT_BASE,
        },
        legacy,
        slotKey,
      );
    }
    return emptyResolvedEndpoint(slotKey);
  }

  const globalWorkApi = await loadEmployeeWorkApiSource();
  let source =
    opts.chatContext && !opts.emp
      ? profiles.defaultSource
      : effectiveApiSource({
          empApiSource: opts.emp?.apiSource,
          globalDefault: globalWorkApi,
          // 跟随脑槽：用该槽 source；强制本地/远程已在 globalDefault 覆盖
          defaultSource: slotCfg.source === "local" ? "local" : "remote",
        });
  if (opts.preferRemote && source === "local" && !opts.chatContext) {
    source = "remote";
  }

  const legacy = {
    legacyModel: opts.emp?.aiModel || (source === slotCfg.source ? slotCfg.model : "") || undefined,
    legacyVision:
      opts.emp?.aiVisionModel || (source === slotCfg.source ? slotCfg.visionModel : "") || undefined,
    legacyBaseUrl:
      opts.emp?.aiBaseUrl || (source === slotCfg.source ? slotCfg.baseUrl : "") || undefined,
    hasImage: opts.hasImage,
  };

  if (source === "local") {
    const localProfile = {
      ...profiles.local,
      textModel: (slotCfg.source === "local" && slotCfg.model.trim()) || profiles.local.textModel,
      visionModel:
        (slotCfg.source === "local" && slotCfg.visionModel.trim()) || profiles.local.visionModel,
      baseUrl:
        (slotCfg.source === "local" && slotCfg.baseUrl.trim()) ||
        profiles.local.baseUrl ||
        OLLAMA_DEFAULT_BASE,
      displayName:
        (slotCfg.source === "local" && (slotCfg.displayName || "").trim()) ||
        profiles.local.displayName,
    };
    if (isLocalProfileUsable(localProfile) || localProfile.textModel.trim()) {
      return endpointFromLocal(localProfile, legacy, slotKey);
    }
    return emptyResolvedEndpoint(slotKey);
  }

  // Remote: employee preset → brain slot preset → default remote
  const presetId =
    (opts.emp?.remotePresetId || "").trim() ||
    (slotCfg.remotePresetId || "").trim() ||
    null;
  let preset = presetId
    ? profiles.remotePresets.find((p) => p.id === presetId) || null
    : null;
  if (!preset) {
    preset = getRemotePresetById(profiles, null);
  }

  // Slot may carry custom remote without preset id
  if (
    (!preset || !isRemotePresetUsable(preset)) &&
    slotCfg.source === "remote" &&
    (slotCfg.model.trim() || slotCfg.baseUrl.trim())
  ) {
    const synthetic = {
      id: "brain-slot-custom",
      label: (slotCfg.displayName || "").trim() || "三脑自定义",
      provider: slotCfg.provider || "custom",
      baseUrl: slotCfg.baseUrl,
      textModel: slotCfg.model,
      visionModel: slotCfg.visionModel || "",
      apiKeyEnv: sanitizeApiKeyEnv(slotCfg.apiKeyEnv),
      apiFormat: "openai" as const,
      lastProbeOk: false,
    };
    if (isRemotePresetUsable(synthetic)) {
      return endpointFromRemote(synthetic, legacy, slotKey);
    }
  }

  if (preset && isRemotePresetUsable(preset)) {
    // Prefer slot apiKeyEnv only when same preset / custom
    const mergedLegacy = {
      ...legacy,
      legacyBaseUrl: legacy.legacyBaseUrl || undefined,
    };
    let ep = endpointFromRemote(preset, mergedLegacy, slotKey);
    if (
      slotCfg.remotePresetId === preset.id &&
      sanitizeApiKeyEnv(slotCfg.apiKeyEnv) &&
      !ep.apiKeyEnv
    ) {
      ep = { ...ep, apiKeyEnv: sanitizeApiKeyEnv(slotCfg.apiKeyEnv) };
    }
    // 员工私有 Key：覆盖预设 Key（一人一 Key）
    const empId = opts.emp?.id?.trim();
    if (empId) {
      const { employeePrivateApiKeyEnv, isApiKeyConfigured } = await import("./apiKeys");
      const privEnv = employeePrivateApiKeyEnv(empId);
      if (await isApiKeyConfigured(privEnv)) {
        return { ...ep, apiKeyEnv: privEnv };
      }
    }
    return ep;
  }

  // Remote invalid — fall back to verified local if configured
  if (isLocalProfileUsable(profiles.local)) {
    const ep = endpointFromLocal(profiles.local, legacy, slotKey);
    return { ...ep, fallbackFromRemote: true };
  }

  return emptyResolvedEndpoint(slotKey);
}

export function resolveAssistantDisplayName(ep: {
  displayName?: string;
  model?: string;
} | null): string {
  const alias = ep?.displayName?.trim();
  if (alias) return alias;
  const model = ep?.model?.trim();
  if (model) return model;
  return "虚募阁";
}

export async function getEmployeeSession(employeeId: string): Promise<string | null> {
  try {
    return await invoke<string | null>("xu_get_employee_session", { employeeId });
  } catch {
    return null;
  }
}

export async function setEmployeeSession(employeeId: string, sessionId: string): Promise<void> {
  try {
    await invoke("xu_set_employee_session", { employeeId, sessionId });
  } catch (e) {
    console.warn("setEmployeeSession", e);
  }
}

export async function clearEmployeeSession(employeeId: string): Promise<void> {
  try {
    await invoke("xu_clear_employee_session", { employeeId });
  } catch {
    /* ignore */
  }
}
