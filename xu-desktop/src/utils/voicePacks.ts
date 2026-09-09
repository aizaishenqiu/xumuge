/**
 * @file Tauri 语音包管理、目录解析与离线合成前端桥接
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-30
 * @updated 2026-09-05
 * @version 1.13.1
 * @category Stream
 * @algo request-id-event-routing
 */

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getShowcaseBaseUrl } from "./auth";
import {
  getDownloadPageUrl,
  getVoicePackCatalogUrl,
  getVoicePackDirectUrlsRaw,
  getVoicePackSiteUrl,
} from "./appEnv";
import {
  assertVirmoorDownloadAuthorized,
  fetchVoicePackCatalogEntries,
  resolveVoicePackTicketUrl,
} from "./voicePackDownloadApi";
import { loadVoicePackVendorUrl } from "./voicePackVendorPrefs";

export type VoiceProviderId = "system-webspeech" | "sherpa-onnx" | "cosyvoice";

export interface VoicePackVoice {
  id: string;
  name: string;
  language: string;
  gender?: "female" | "male" | string;
  /** 与 voiceTonePresets.id 对齐，用于按语气匹配音色 */
  toneIds?: string[];
}

export interface VoicePackFile {
  path: string;
  sha256: string;
  size: number;
}

export interface VoicePackManifest {
  id: string;
  version: string;
  provider: Exclude<VoiceProviderId, "system-webspeech">;
  voices: VoicePackVoice[];
  files: VoicePackFile[];
  licenseSpdx: string;
  licenseUrl: string;
  sourceUrl: string;
  size: number;
  approved: boolean;
  commercialAllowed: boolean;
}

export interface InstalledVoicePack extends VoicePackManifest {
  installedPath: string;
}

export interface VoicePackProgress {
  requestId: string;
  stage: "starting" | "downloading" | "extracting" | "verifying" | "done";
  received: number;
  total?: number;
  message: string;
}

export interface VoiceSynthesizeRequest {
  requestId: string;
  packId: string;
  text: string;
  voice: string;
  rate: number;
  pitch: number;
  volume: number;
  /** 应用语气 id；sidecar 就绪后用于分轨参数 */
  toneId?: string;
  /** CosyVoice instruct（预留） */
  cosyInstruct?: string;
  /** CosyVoice emotion（预留） */
  cosyEmotion?: string;
}

/** env / 远程目录中的可安装条目（安装仍走 installVoicePack）。 */
export interface VoicePackCatalogEntry {
  id: string;
  name: string;
  provider: Exclude<VoiceProviderId, "system-webspeech"> | "unknown";
  downloadUrl: string;
  licenseSpdx?: string;
  gender?: string;
  tones?: string[];
  /** 与 provider 对齐的引擎标记（catalog 可选） */
  engine?: "sherpa-onnx" | "cosyvoice";
  /** CosyVoice 等本地合成通常需 GPU */
  needsGpu?: boolean;
  source: "catalog" | "env-url" | "download-api";
  fileId?: string;
  deliveryMode?: "hosted" | "external";
}

export interface VoicePackCatalogResult {
  entries: VoicePackCatalogEntry[];
  /** 语音包厂商/项目官网；未配 env 为空 */
  siteUrl: string;
  /** 虚募阁官网下载页 */
  virmoorDownloadUrl: string;
  /** 是否至少配置了 catalog / urls / site / API 之一 */
  configured: boolean;
  /** 是否从虚募阁下载 API 拉到条目 */
  fromDownloadApi: boolean;
  catalogError?: string;
}

function stripQuotes(s: string): string {
  return s.trim().replace(/^['"]|['"]$/g, "");
}

/** 语音包厂商/项目官网（catalog.json 或 ZIP）；优先用户设置，再 env；与虚募阁 showcase 无关。 */
export function resolveVoicePackSiteUrl(raw?: string): string {
  const fromUser = loadVoicePackVendorUrl();
  const fromEnv = stripQuotes(getVoicePackSiteUrl());
  const fallback = fromUser || fromEnv;
  const explicit = stripQuotes(String(raw ?? fallback));
  return /^https?:\/\//i.test(explicit) ? explicit.replace(/\/+$/, "") : "";
}

/** 静态 vendor 目录 JSON 地址：用户官网 → env CATALOG → env SITE（.json）。 */
export function resolveVoicePackCatalogJsonUrl(): string {
  const site = resolveVoicePackSiteUrl();
  if (/\.json(\?|$)/i.test(site)) return site;
  const catalogEnv = stripQuotes(getVoicePackCatalogUrl());
  return catalogEnv;
}

/** 虚募阁官网下载页（托管包 ticket 下载）。 */
export function resolveVirmoorDownloadUrl(): string {
  return getDownloadPageUrl().replace(/\/+$/, "") || `${getShowcaseBaseUrl()}/download`;
}

/** 解析 VITE_XU_VOICE_PACK_URLS 逗号分隔直链为目录条目。 */
export function parseEnvVoicePackUrls(raw?: string): VoicePackCatalogEntry[] {
  const text = stripQuotes(String(raw ?? getVoicePackDirectUrlsRaw()));
  if (!text) return [];
  return text
    .split(/[,;\n]/)
    .map((u) => stripQuotes(u))
    .filter((u) => /^(https?|file):\/\//i.test(u))
    .map((downloadUrl, i) => {
      const leaf = downloadUrl.split("/").pop()?.replace(/\.zip$/i, "") || `pack-${i + 1}`;
      return {
        id: leaf,
        name: leaf,
        provider: "unknown" as const,
        downloadUrl,
        source: "env-url" as const,
      };
    });
}

function dedupeCatalog(entries: VoicePackCatalogEntry[]): VoicePackCatalogEntry[] {
  const seen = new Set<string>();
  const out: VoicePackCatalogEntry[] = [];
  for (const e of entries) {
    const key = (e.fileId || e.downloadUrl).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}

/** 按 provider 过滤目录条目；unknown 视为通用包也展示。 */
export function catalogEntriesForProvider(
  entries: VoicePackCatalogEntry[],
  provider: Exclude<VoiceProviderId, "system-webspeech">,
): VoicePackCatalogEntry[] {
  return entries.filter((e) => e.provider === provider || e.provider === "unknown");
}

function envConfigured(
  catalogUrl: string,
  fromUrls: VoicePackCatalogEntry[],
  siteUrl: string,
  apiEntries: VoicePackCatalogEntry[],
): boolean {
  return Boolean(catalogUrl || fromUrls.length || siteUrl || apiEntries.length);
}

function resolveCatalogDownloadUrl(catalogUrl: string, downloadUrl: string): string {
  const raw = downloadUrl.trim();
  if (/^(https?|file):\/\//i.test(raw)) return raw;
  try {
    return new URL(raw, catalogUrl).href;
  } catch {
    return raw;
  }
}

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** 拉取 catalog 文本；Tauri 走 Rust reqwest 避免 WebView CORS。 */
async function fetchCatalogResponse(catalogUrl: string): Promise<Response> {
  if (isTauriRuntime()) {
    const text = await invoke<string>("xu_voice_pack_fetch_url_text", { url: catalogUrl });
    return new Response(text, {
      status: 200,
      headers: { "Content-Type": "application/json;charset=utf-8" },
    });
  }
  return fetch(catalogUrl);
}

async function loadStaticCatalogJson(
  catalogUrl: string,
): Promise<{ entries: VoicePackCatalogEntry[]; error?: string }> {
  try {
    const res = await fetchCatalogResponse(catalogUrl);
    if (!res.ok) {
      return { entries: [], error: `目录 HTTP ${res.status}` };
    }
    const json = (await res.json()) as {
      packs?: Array<{
        id?: string;
        name?: string;
        provider?: string;
        downloadUrl?: string;
        licenseSpdx?: string;
        gender?: string;
        tones?: string[];
        engine?: string;
        needsGpu?: boolean;
      }>;
    };
    const fromCatalog = (json.packs ?? [])
      .filter((p) => p.downloadUrl && String(p.downloadUrl).trim())
      .map((p): VoicePackCatalogEntry | null => {
        const providerRaw = String(p.provider ?? p.engine ?? "unknown");
        const provider =
          providerRaw === "sherpa-onnx" || providerRaw === "cosyvoice"
            ? providerRaw
            : ("unknown" as const);
        const downloadUrl = resolveCatalogDownloadUrl(
          catalogUrl,
          String(p.downloadUrl),
        );
        if (!/^(https?|file):\/\//i.test(downloadUrl)) {
          return null;
        }
        const engine =
          p.engine === "sherpa-onnx" || p.engine === "cosyvoice"
            ? p.engine
            : provider === "unknown"
              ? undefined
              : provider;
        return {
          id: String(p.id || p.name || p.downloadUrl),
          name: String(p.name || p.id || "语音包"),
          provider,
          downloadUrl,
          licenseSpdx: p.licenseSpdx ? String(p.licenseSpdx) : undefined,
          gender: p.gender ? String(p.gender) : undefined,
          tones: Array.isArray(p.tones) ? p.tones.map(String) : undefined,
          engine,
          needsGpu: Boolean(p.needsGpu) || engine === "cosyvoice",
          source: "catalog" as const,
        };
      })
      .filter((e): e is VoicePackCatalogEntry => e !== null);
    return { entries: fromCatalog };
  } catch (e) {
    return {
      entries: [],
      error: e instanceof Error ? e.message : "目录拉取失败",
    };
  }
}

/**
 * 拉取语音包目录：优先虚募阁下载 API，合并静态 JSON 与 env 直链。
 * 失败: 返回已解析条目与 siteUrl（由调用方展开兜底 UI）。
 */
export async function loadVoicePackCatalog(): Promise<VoicePackCatalogResult> {
  const fromUrls = parseEnvVoicePackUrls();
  const catalogUrl = resolveVoicePackCatalogJsonUrl();
  const siteUrl = resolveVoicePackSiteUrl();
  const virmoorDownloadUrl = resolveVirmoorDownloadUrl();

  const staticCatalogPromise: Promise<{
    entries: VoicePackCatalogEntry[];
    error?: string;
  }> = catalogUrl
    ? loadStaticCatalogJson(catalogUrl)
    : Promise.resolve({ entries: [] });
  const [apiResult, jsonResult] = await Promise.all([
    fetchVoicePackCatalogEntries(),
    staticCatalogPromise,
  ]);

  const merged = dedupeCatalog([
    ...apiResult.entries,
    ...jsonResult.entries,
    ...fromUrls,
  ]);
  const configured = envConfigured(catalogUrl, fromUrls, siteUrl, apiResult.entries)
    || Boolean(virmoorDownloadUrl);
  const catalogError = apiResult.error || jsonResult.error;

  return {
    entries: merged,
    siteUrl,
    virmoorDownloadUrl,
    configured,
    fromDownloadApi: apiResult.entries.length > 0,
    catalogError,
  };
}

/**
 * 解析目录条目的实际安装 URL（hosted 包换 ticket）。
 * 依赖 readCloudAccessToken；失败由调用方 fouAlert。
 */
export async function resolveCatalogInstallUrl(entry: VoicePackCatalogEntry): Promise<string> {
  if (entry.source === "download-api") {
    assertVirmoorDownloadAuthorized();
  }
  if (entry.fileId && entry.deliveryMode !== "external") {
    return resolveVoicePackTicketUrl(entry.fileId);
  }
  if (entry.downloadUrl && !entry.downloadUrl.startsWith("ticket://")) {
    return entry.downloadUrl;
  }
  throw new Error("无法解析该语音包的安装地址。");
}

/** 是否存在 vendor 来源配置（用户官网 / env）；不表示目录非空。 */
export function hasVendorVoicePackDownloadConfig(): boolean {
  if (loadVoicePackVendorUrl()) return true;
  if (resolveVoicePackSiteUrl()) return true;
  const catalogUrl = stripQuotes(getVoicePackCatalogUrl());
  if (catalogUrl) return true;
  return parseEnvVoicePackUrls().length > 0;
}

/** vendor 目录条目（非虚募阁 download-api）。 */
export function vendorCatalogEntries(
  entries: VoicePackCatalogEntry[],
): VoicePackCatalogEntry[] {
  return entries.filter((e) => e.source === "catalog" || e.source === "env-url");
}

/**
 * 安装流程要求 ZIP 内根目录含 manifest.json。
 */
export function isVoicePackZipUrl(url: string): boolean {
  return /^(https?|file):\/\/.+\.zip(\?.*)?$/i.test(url.trim());
}

/** 从静态目录 JSON 解析可安装 ZIP 直链。 */
async function catalogZipFromJsonUrl(jsonUrl: string): Promise<string | null> {
  try {
    const res = await fetch(jsonUrl);
    if (!res.ok) return null;
    const json = (await res.json()) as {
      packs?: Array<{ downloadUrl?: string; provider?: string }>;
    };
    const hit = (json.packs ?? []).find((p) => p.downloadUrl);
    if (!hit?.downloadUrl) return null;
    const resolved = resolveCatalogDownloadUrl(jsonUrl, String(hit.downloadUrl));
    return /^(https?|file):\/\/.+\.zip(\?.*)?$/i.test(resolved) ? resolved : null;
  } catch {
    return null;
  }
}

/**
 * 解析厂商官网 / env 为可静默安装的 ZIP 直链。
 * siteUrl 可为 .zip 直链或 .json 目录；否则回退 CATALOG_URL / VOICE_PACK_URLS。
 */
export async function resolveVoicePackSiteDownloadTarget(
  siteUrl: string,
  provider?: Exclude<VoiceProviderId, "system-webspeech">,
): Promise<string | null> {
  const site = siteUrl.trim();
  if (isVoicePackZipUrl(site)) return site;
  if (/\.json(\?|$)/i.test(site)) {
    const fromSite = await catalogZipFromJsonUrl(site);
    if (fromSite) return fromSite;
  }
  const catalogUrl = resolveVoicePackCatalogJsonUrl();
  if (catalogUrl) {
    const { entries } = await loadStaticCatalogJson(catalogUrl);
    const list = provider ? catalogEntriesForProvider(entries, provider) : entries;
    const hit = list.find((e) => e.downloadUrl && /^(https?|file):\/\//i.test(e.downloadUrl));
    if (hit?.downloadUrl) return hit.downloadUrl;
  }
  const envList = provider
    ? catalogEntriesForProvider(parseEnvVoicePackUrls(), provider)
    : parseEnvVoicePackUrls();
  if (envList[0]?.downloadUrl) return envList[0].downloadUrl;
  return null;
}

/** 生成仅含安全路径字符的前端任务 ID；供 Rust 取消和进度路由使用。 */
export function createVoiceRequestId(prefix: string): string {
  return `${prefix}-${Date.now()}-${crypto.randomUUID()}`;
}

/** 列出本机语音包。依赖 Tauri command；损坏包由 Rust 跳过，调用失败由页面 fouAlert。 */
export function listVoicePacks(): Promise<InstalledVoicePack[]> {
  return invoke<InstalledVoicePack[]>("xu_voice_pack_list");
}

/**
 * 将本机 ZIP 复制到 {XU_HOME}/voice-packs-incoming 并返回 file:// URL。
 * 依赖 Tauri xu_voice_pack_stage_local；失败由页面 fouAlert。
 */
export function stageLocalVoicePack(sourcePath: string): Promise<string> {
  return invoke<string>("xu_voice_pack_stage_local", { sourcePath });
}

/**
 * 从用户 URL 安装语音包。依赖风险确认参数与进度 requestId；
 * 下载、许可、校验失败均由调用页面通过 fouAlert 展示。
 */
export function installVoicePack(
  url: string,
  requestId: string,
  riskAccepted: boolean,
): Promise<InstalledVoicePack> {
  return invoke<InstalledVoicePack>("xu_voice_pack_install", {
    url,
    requestId,
    riskAccepted,
  });
}

/** 取消安装或合成任务。任务已结束返回 false，不视为错误。 */
export function cancelVoiceTask(requestId: string): Promise<boolean> {
  return invoke<boolean>("xu_voice_task_cancel", { requestId });
}

/** 卸载本机语音包。依赖合法 packId；占用或权限失败交由页面 fouAlert。 */
export function uninstallVoicePack(packId: string): Promise<void> {
  return invoke<void>("xu_voice_pack_uninstall", { packId });
}

/** 调用应用捆绑的可信 sidecar；未内置 provider 时明确失败，绝不执行包内程序。 */
export function synthesizeVoice(request: VoiceSynthesizeRequest): Promise<string> {
  return invoke<string>("xu_voice_synthesize", { request });
}

/** 订阅语音包安装进度；组件卸载时必须调用返回的 unlisten。 */
export function onVoicePackProgress(
  handler: (progress: VoicePackProgress) => void,
): Promise<UnlistenFn> {
  return listen<VoicePackProgress>("xu:voice-pack-progress", (event) => {
    handler(event.payload);
  });
}
