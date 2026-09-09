/**
 * @file 岗位包官网目录与登录换票临时下载
 * @author qiuye <yjk150@qq.com>
 * @date 2026-09-01
 * @updated 2026-09-01
 * @version 1.1.0
 * @category Network
 * @algo bearer-ticket-resolve
 */
import { readCloudAccessToken } from "./auth";
import { cloudGet, resolveCloudApiBase } from "./request";
import {
  isVirmoorDownloadAuthorized,
  virmoorDownloadLoginMessage,
  assertVirmoorDownloadAuthorized,
  resolveVoicePackTicketUrl,
} from "./voicePackDownloadApi";

export { isVirmoorDownloadAuthorized, virmoorDownloadLoginMessage, assertVirmoorDownloadAuthorized };

export type RolePackDownloadEntry = {
  id: string;
  slug: string;
  name: string;
  fileId: string;
  shortDesc?: string;
};

interface SoftFile {
  id: string;
  deliveryMode?: string;
}

interface SoftItem {
  id: string;
  slug?: string;
  name: string;
  shortDesc?: string;
  latestFiles?: SoftFile[];
}

/**
 * 拉取下载中心「岗位数据包」分类条目（托管包，需登录换票）。
 * 依赖 GET /public/download/softwares?category=role-packs + request.ts；失败返回空列表与 error。
 */
export async function fetchRolePackDownloadEntries(): Promise<{
  entries: RolePackDownloadEntry[];
  error?: string;
}> {
  if (!resolveCloudApiBase()) return { entries: [], error: "未配置账号服务" };
  try {
    const json = await cloudGet<{ items?: SoftItem[] }>(
      "/public/download/softwares?category=role-packs",
      { silent: true, noAuth: true },
    );
    if (json.code !== undefined && json.code !== 0) {
      return { entries: [], error: json.msg || "目录失败" };
    }
    const entries: RolePackDownloadEntry[] = [];
    for (const item of json.data?.items ?? []) {
      const slug = String(item.slug || item.id || "");
      for (const f of item.latestFiles ?? []) {
        if (!f.id || f.deliveryMode === "external") continue;
        entries.push({
          id: `${slug}-${f.id}`,
          slug,
          name: String(item.name || slug),
          fileId: f.id,
          shortDesc: item.shortDesc ? String(item.shortDesc) : undefined,
        });
      }
    }
    return { entries };
  } catch (e) {
    return {
      entries: [],
      error:
        e && typeof e === "object" && "msg" in e
          ? String((e as { msg: string }).msg)
          : e instanceof Error
            ? e.message
            : "岗位包目录拉取失败",
    };
  }
}

/** 登录用户换取岗位包临时下载 URL（5 分钟票）。 */
export async function resolveRolePackTicketUrl(fileId: string): Promise<string> {
  return resolveVoicePackTicketUrl(fileId);
}

export function requireCloudLoginForRolePackDownload(): void {
  if (!readCloudAccessToken()?.trim()) {
    throw new Error(virmoorDownloadLoginMessage().replace("语音包", "岗位数据包"));
  }
  assertVirmoorDownloadAuthorized();
}
