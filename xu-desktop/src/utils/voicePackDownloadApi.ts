/**
 * @file 虚募阁下载中心 API：语音包目录与临时 ticket 换链
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-31
 * @updated 2026-09-02
 * @version 1.4.0
 * @category Network
 * @algo bearer-ticket-resolve
 */

import { getAccountServerUrl, readCloudAccessToken } from "./auth";
import { cloudGet, cloudPost, resolveCloudApiBase } from "./request";
import type { VoicePackCatalogEntry } from "./voicePacks";

interface SoftFile {
  id: string;
  deliveryMode?: string;
  downloadUrl?: string;
}

interface SoftItem {
  id: string;
  slug?: string;
  name: string;
  licenseType?: string;
  homepage?: string;
  latestFiles?: SoftFile[];
}

function apiBase(): string | undefined {
  return resolveCloudApiBase() || getAccountServerUrl()?.replace(/\/+$/, "") || undefined;
}

/** 账号服务站点根（去掉 /api/v1），用于拼不露 API 的下载短链。 */
function accountSiteOrigin(): string | undefined {
  const base = apiBase();
  if (!base) return undefined;
  if (/^https?:\/\//i.test(base)) {
    try {
      return new URL(base).origin;
    } catch {
      /* fall through */
    }
  }
  return base
    .replace(/\/api\/v1\/?$/i, "")
    .replace(/\/v1\/?$/i, "")
    .replace(/\/+$/, "") || undefined;
}

/** 虚募阁官方语音包下载须已登录云账号（Bearer）。 */
export function isVirmoorDownloadAuthorized(): boolean {
  return Boolean(readCloudAccessToken()?.trim());
}

/** 未登录时的用户可见提示（不含 URL / env）。 */
export function virmoorDownloadLoginMessage(): string {
  return "请先登录虚募阁云账号后再下载官方语音包。";
}

/**
 * 虚募阁下载门禁：未登录抛错，供安装链路与 UI 共用。
 * 依赖 readCloudAccessToken；失败由调用方 fouAlert。
 */
export function assertVirmoorDownloadAuthorized(): void {
  if (!isVirmoorDownloadAuthorized()) {
    throw new Error(virmoorDownloadLoginMessage());
  }
}

/** 从 slug 推断离线 TTS provider。 */
export function inferVoicePackProvider(slug: string): VoicePackCatalogEntry["provider"] {
  const s = slug.toLowerCase();
  if (s.includes("sherpa") || s.includes("offline") || s.includes("kokoro")) {
    return "sherpa-onnx";
  }
  if (s.includes("cosyvoice") || s.includes("cosy-voice") || s.includes("cosy_voice")) {
    return "cosyvoice";
  }
  return "unknown";
}

function mapSoftItemsToEntries(items: SoftItem[]): VoicePackCatalogEntry[] {
  const entries: VoicePackCatalogEntry[] = [];
  for (const item of items) {
    const slug = String(item.slug || item.id || "");
    const provider = inferVoicePackProvider(slug);
    const files = item.latestFiles ?? [];
    for (const f of files) {
      const mode = f.deliveryMode === "external" ? "external" : "hosted";
      const baseEntry = {
        id: `${slug}-${f.id}`,
        name: String(item.name || slug),
        provider,
        licenseSpdx: item.licenseType ? String(item.licenseType) : undefined,
        source: "download-api" as const,
      };
      if (mode === "external" && f.downloadUrl) {
        entries.push({
          ...baseEntry,
          downloadUrl: String(f.downloadUrl),
          deliveryMode: "external",
        });
      } else if (f.id) {
        entries.push({
          ...baseEntry,
          downloadUrl: `ticket://${f.id}`,
          fileId: f.id,
          deliveryMode: "hosted",
        });
      }
    }
  }
  return entries;
}

/**
 * 拉取虚募阁下载中心「语音包」分类（管理端发布的软件包）。
 * 公开目录可未登录浏览；真正下载 hosted 包须登录换票。
 * 依赖 GET /public/download/softwares?category=voice-packs + request.ts。
 */
export async function fetchVoicePackCatalogEntries(): Promise<{
  entries: VoicePackCatalogEntry[];
  error?: string;
}> {
  if (!apiBase()) {
    return { entries: [], error: "未配置账号服务，无法拉取虚募阁发布目录" };
  }
  try {
    const json = await cloudGet<{ items?: SoftItem[] }>(
      "/public/download/softwares?category=voice-packs",
      { silent: true, noAuth: true },
    );
    if (json.code !== undefined && json.code !== 0) {
      return { entries: [], error: json.msg || "下载目录失败" };
    }
    let items = json.data?.items ?? [];
    // 兼容旧数据未挂分类：再按 keyword 兜底
    if (!items.length) {
      const fallback = await cloudGet<{ items?: SoftItem[] }>(
        "/public/download/softwares?keyword=voice",
        { silent: true, noAuth: true },
      );
      if (fallback.code === 0) {
        items = fallback.data?.items ?? [];
      }
    }
    return { entries: mapSoftItemsToEntries(items) };
  } catch (e) {
    const msg =
      e && typeof e === "object" && "msg" in e
        ? String((e as { msg: string }).msg)
        : e instanceof Error
          ? e.message
          : "下载目录拉取失败";
    return { entries: [], error: msg };
  }
}

/**
 * 登录用户换取临时下载 URL（hosted 包）。
 * 返回站点根短链 /download/file?ticket=…，不暴露 /api 路径。
 */
export async function resolveVoicePackTicketUrl(fileId: string): Promise<string> {
  assertVirmoorDownloadAuthorized();
  if (!apiBase()) {
    throw new Error("未配置账号服务，无法换取下载链接。");
  }
  const json = await cloudPost<{ shareUrl?: string; url?: string; ticket?: string }>(
    "/public/download/ticket",
    { fileId },
  );
  const ticket = String(json.data?.ticket || "").trim();
  const rel =
    (json.data?.shareUrl && String(json.data.shareUrl).trim()) ||
    (ticket ? `/download/file?ticket=${encodeURIComponent(ticket)}` : "");
  if (!rel) {
    throw new Error("下载凭证无效");
  }
  if (/^https?:\/\//i.test(rel)) return rel;
  const origin = accountSiteOrigin();
  if (!origin) {
    throw new Error("未配置账号服务，无法换取下载链接。");
  }
  const path = rel.startsWith("/") ? rel : `/${rel}`;
  return `${origin}${path}`;
}
