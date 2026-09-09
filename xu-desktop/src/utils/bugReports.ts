/**
 * @file 问题反馈本机草稿 + 云端上报（图落后端 uploads，不传 COS）
 * @author qiuye <yjk150@qq.com>
 * @date 2026-09-01
 * @updated 2026-09-02
 * @version 1.5.3
 * @category Cache
 * @algo none
 */

import { invoke } from "@tauri-apps/api/core";
import { getAccountServerUrl, readCloudAccessToken } from "./auth";
import type { BugReportStatus, BugSectionId, BugSeverity } from "./bugReportCatalog";
import { bugSectionLabel, bugSeverityLabel, bugStatusLabel } from "./bugReportCatalog";
import { cloudGet, cloudPatch, cloudPost, resolveCloudApiBase } from "./request";

export interface BugReport {
  id: string;
  sectionId: BugSectionId | string;
  title: string;
  severity: BugSeverity | string;
  html: string;
  status: BugReportStatus;
  createdAt: string;
  updatedAt: string;
  cloudId?: string | null;
  syncedAt?: string | null;
}

export interface BugReportInput {
  id?: string | null;
  sectionId: string;
  title: string;
  severity: string;
  html: string;
  status?: BugReportStatus | null;
  cloudId?: string | null;
  syncedAt?: string | null;
}

const ASSET_PREFIX = "xu-bug-asset:";

/** 反馈插图前端压缩上限（字节），须在落盘/上报前处理，不在后端压。 */
export const BUG_IMAGE_MAX_BYTES = 2 * 1024 * 1024;

/** dataURL → 本机文件名（编辑器用 dataURL 显示，存盘用 xu-bug-asset:） */
const dataUrlToAssetName = new Map<string, string>();

/** blob: URL → 本机文件名（编辑器短链显示，避免 convertFileSrc 裂图） */
const blobUrlToAssetName = new Map<string, string>();

type CloudReport = {
  id: string;
  sectionId?: string;
  title?: string;
  severity?: string;
  html?: string;
  status?: string;
  createdAt?: string;
  updatedAt?: string;
};

/** Duty: 是否已登录云账号（可上报）。 */
export function isBugCloudReady(): boolean {
  return Boolean(readCloudAccessToken()?.trim() && resolveCloudApiBase());
}

/** Duty: 静态 /uploads 根（去掉 /api/v1）。 */
export function uploadsOrigin(): string {
  const base = resolveCloudApiBase() || getAccountServerUrl()?.replace(/\/+$/, "") || "";
  return base.replace(/\/api\/v1\/?$/i, "").replace(/\/v1\/?$/i, "") || base;
}

/** Duty: /uploads/... → 可加载绝对地址。 */
export function resolveUploadPublicUrl(pathOrUrl: string): string {
  const s = String(pathOrUrl || "").trim();
  if (!s) return s;
  if (/^https?:\/\//i.test(s)) return s;
  const origin = uploadsOrigin().replace(/\/+$/, "");
  if (s.startsWith("/")) return `${origin}${s}`;
  return `${origin}/uploads/${s.replace(/^uploads\//, "")}`;
}

/**
 * Duty: 合并云端/本机正文时择优：可见文字多的优先；勿用「仅长路径图」盖掉有字的正文。
 * 依赖: 纯字符串；失败不抛。
 */
function preferRicherHtml(remoteHtml: string | undefined, localHtml: string | undefined): string {
  const remote = String(remoteHtml ?? "").trim();
  const local = String(localHtml ?? "").trim();
  if (!remote) return local || "<p></p>";
  if (!local) return remote;
  const rt = bugHtmlPlainLen(remote);
  const lt = bugHtmlPlainLen(local);
  if (lt > rt + 5) return local;
  if (rt > lt + 5) return remote;
  const remoteLocalOnly =
    /asset\.localhost|xu-bug-asset:|asset:/i.test(remote) &&
    !/\/uploads\/bug-reports\//i.test(remote);
  const localHasUpload = /\/uploads\/bug-reports\//i.test(local);
  if (remoteLocalOnly && localHasUpload) return local;
  if (remoteLocalOnly && /xu-bug-asset:|asset\.localhost/i.test(local)) return local;
  return remote;
}

function bugHtmlPlainLen(html: string): number {
  return String(html || "")
    .replace(/<img\b[^>]*>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim().length;
}

/**
 * Duty: 列出本机反馈（按更新时间倒序）。
 * 依赖: Tauri `xu_bug_report_list`；失败抛错给页面 fouAlert。
 */
export async function listLocalBugReports(): Promise<BugReport[]> {
  return invoke<BugReport[]>("xu_bug_report_list");
}

/**
 * Duty: 合并本机草稿与云端「我的」；已同步项以服务端状态为准。
 * 依赖: Tauri + 可选 Bearer GET /bug-reports。
 */
export async function listBugReports(): Promise<BugReport[]> {
  const local = await listLocalBugReports();
  if (!isBugCloudReady()) return local;

  let cloudItems: CloudReport[] = [];
  try {
    const res = await cloudGet<{ items?: CloudReport[] }>("/bug-reports", { silent: true });
    cloudItems = Array.isArray(res.data?.items) ? res.data!.items! : [];
  } catch {
    return local;
  }

  const byCloud = new Map<string, BugReport>();
  const merged: BugReport[] = [];

  for (const row of local) {
    const cid = row.cloudId?.trim();
    if (cid) byCloud.set(cid, row);
  }

  for (const row of local) {
    const cid = row.cloudId?.trim();
    if (!cid) {
      merged.push(row);
      continue;
    }
    const remote = cloudItems.find((c) => c.id === cid);
    if (!remote) {
      merged.push(row);
      continue;
    }
    const next: BugReport = {
      ...row,
      sectionId: remote.sectionId || row.sectionId,
      title: remote.title || row.title,
      severity: remote.severity || row.severity,
      // 云端空正文 / 仅 asset.localhost 时保留本机（避免详情空白）
      html: preferRicherHtml(remote.html, row.html),
      status: (remote.status as BugReportStatus) || row.status,
      updatedAt: remote.updatedAt || row.updatedAt,
      cloudId: cid,
      syncedAt: row.syncedAt || new Date().toISOString(),
    };
    merged.push(next);
    // 静默回写本地缓存状态
    void saveBugReportLocal({
      id: next.id,
      sectionId: String(next.sectionId),
      title: next.title,
      severity: String(next.severity),
      html: next.html,
      status: next.status,
      cloudId: next.cloudId,
      syncedAt: next.syncedAt,
    }).catch(() => undefined);
  }

  for (const remote of cloudItems) {
    if (byCloud.has(remote.id)) continue;
    const cached: BugReport = {
      id: remote.id,
      sectionId: remote.sectionId || "other",
      title: remote.title || "",
      severity: remote.severity || "major",
      html: remote.html || "<p></p>",
      status: (remote.status as BugReportStatus) || "open",
      createdAt: remote.createdAt || "",
      updatedAt: remote.updatedAt || "",
      cloudId: remote.id,
      syncedAt: remote.updatedAt || new Date().toISOString(),
    };
    merged.push(cached);
    void saveBugReportLocal({
      id: cached.id,
      sectionId: String(cached.sectionId),
      title: cached.title,
      severity: String(cached.severity),
      html: cached.html,
      status: cached.status,
      cloudId: cached.cloudId,
      syncedAt: cached.syncedAt,
    }).catch(() => undefined);
  }

  merged.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  return merged;
}

/**
 * Duty: 把正文里 asset.localhost / dataURL 收成 xu-bug-asset: 写回本机（不调云）。
 * 依赖: Tauri assets；失败抛错由调用方忽略。
 */
export async function repairLocalBugHtmlAssets(row: BugReport): Promise<BugReport | null> {
  const withAssets = await persistEditorImages(row.html || "<p></p>");
  const localHtml = normalizeBugHtmlForStorage(withAssets);
  if (localHtml === (row.html || "")) return null;
  return await saveBugReportLocal({
    id: row.id,
    sectionId: String(row.sectionId),
    title: row.title,
    severity: String(row.severity),
    html: localHtml,
    status: row.status,
    cloudId: row.cloudId ?? null,
    syncedAt: row.syncedAt ?? null,
  });
}

/** Duty: 仅写本机 JSON。 */
export async function saveBugReportLocal(input: BugReportInput): Promise<BugReport> {
  return invoke<BugReport>("xu_bug_report_save", { report: input });
}

/**
 * Duty: 保存并在有云会话时上报；返回本地记录（含 cloudId）。
 * 依赖: Tauri + POST/PATCH /bug-reports；图须已为 /uploads/bug-reports/。
 */
export async function saveBugReport(input: BugReportInput): Promise<BugReport> {
  // 编辑器里是 dataURL；先落成 xu-bug-asset: 再上传 /uploads
  const withAssets = await persistEditorImages(input.html);
  const htmlForCloud = await ensureCloudHtmlImages(withAssets);
  const localHtml = normalizeBugHtmlForStorage(htmlForCloud);
  let local = await saveBugReportLocal({
    ...input,
    html: localHtml,
  });

  if (!isBugCloudReady()) {
    return local;
  }

  assertHtmlReadyForCloud(localHtml);

  const cloudId = local.cloudId?.trim();
  let remote: CloudReport;
  if (cloudId) {
    // PATCH 体禁止多余字段：服务端 DisallowUnknownFields，带 clientVersion 会「参数无效」
    const res = await cloudPatch<CloudReport>(`/bug-reports/${cloudId}`, {
      sectionId: input.sectionId,
      title: input.title,
      severity: input.severity,
      html: localHtml,
    });
    remote = (res.data || {}) as CloudReport;
  } else {
    const res = await cloudPost<CloudReport>("/bug-reports", {
      sectionId: input.sectionId,
      title: input.title,
      severity: input.severity,
      html: localHtml,
      clientVersion: String(import.meta.env.VITE_APP_VERSION || "0.1.0"),
      clientOs: navigator.platform || "",
    });
    remote = (res.data || {}) as CloudReport;
  }
  const newCloudId = String(remote.id || cloudId || "").trim();
  if (!newCloudId) return local;

  local = await saveBugReportLocal({
    id: local.id,
    sectionId: String(remote.sectionId || local.sectionId),
    title: remote.title || local.title,
    severity: String(remote.severity || local.severity),
    html: remote.html || local.html,
    status: (remote.status as BugReportStatus) || local.status,
    cloudId: newCloudId,
    syncedAt: new Date().toISOString(),
  });
  return local;
}

/**
 * Duty: 仅更新状态（整理 / 修复）——仅本机未同步草稿。
 * 依赖: Tauri `xu_bug_report_update_status`；已同步项应拒绝。
 */
export async function updateBugReportStatus(
  id: string,
  status: BugReportStatus,
): Promise<BugReport> {
  return invoke<BugReport>("xu_bug_report_update_status", { id, status });
}

/**
 * Duty: 删除一条本地反馈。
 * 依赖: Tauri `xu_bug_report_delete`；失败抛错。
 */
export async function deleteBugReport(id: string): Promise<void> {
  await invoke("xu_bug_report_delete", { id });
}

/**
 * Duty: 将粘贴/上传的图片写入 `{XU_HOME}/bug-reports/assets/`。
 * 依赖: base64（可带 dataURL 头）；返回文件名供 HTML 占位。
 */
export async function saveBugReportAsset(
  dataBase64: string,
  ext: string,
): Promise<string> {
  return invoke<string>("xu_bug_report_save_asset", { dataBase64, ext });
}

/**
 * Duty: 解析资源绝对路径，供 convertFileSrc。
 * 依赖: 已存在的 assets 文件名。
 */
export async function resolveBugReportAssetPath(filename: string): Promise<string> {
  return invoke<string>("xu_bug_report_asset_path", { filename });
}

/**
 * Duty: 本机 assets 是否存在该文件。
 */
export async function bugReportAssetExists(filename: string): Promise<boolean> {
  try {
    return await invoke<boolean>("xu_bug_report_asset_exists", { filename });
  } catch {
    return false;
  }
}

/**
 * Duty: 读本机 asset 为 dataURL（Rust 读盘，不走 convertFileSrc fetch）。
 */
export async function bugReportAssetDataUrl(filename: string): Promise<string> {
  return invoke<string>("xu_bug_report_asset_data_url", { filename });
}

/**
 * Duty: 导出 Markdown 文本到本机路径。
 * 依赖: Tauri `xu_bug_report_export_markdown`；失败抛错。
 */
export async function exportBugReportsMarkdown(
  path: string,
  statusFilter?: BugReportStatus | "all" | null,
): Promise<string> {
  return invoke<string>("xu_bug_report_export_markdown", {
    path,
    statusFilter: statusFilter && statusFilter !== "all" ? statusFilter : null,
  });
}

/**
 * Duty: 将指定条目写成 Markdown 文件（可选导出）。
 * 依赖: `@tauri-apps/plugin-fs` writeTextFile；失败抛错。
 */
export async function writeBugReportsMarkdownFile(
  path: string,
  rows: BugReport[],
): Promise<string> {
  const { writeTextFile } = await import("@tauri-apps/plugin-fs");
  const md = buildBugReportsMarkdown(rows);
  await writeTextFile(path, md);
  return path;
}

/**
 * Duty: 生成 Markdown 字符串（不写盘），便于复制。
 * 依赖: 当前列表数据；无 Tauri 亦可。
 */
export function buildBugReportsMarkdown(rows: BugReport[]): string {
  const bySection = new Map<string, BugReport[]>();
  for (const row of rows) {
    const key = row.sectionId || "other";
    const list = bySection.get(key) ?? [];
    list.push(row);
    bySection.set(key, list);
  }
  const lines: string[] = [
    `# 虚募阁问题反馈待修清单`,
    ``,
    `导出时间：${new Date().toLocaleString("zh-CN")}`,
    `条目：${rows.length}`,
    ``,
  ];
  for (const [sectionId, items] of bySection) {
    lines.push(`## ${bugSectionLabel(sectionId)}`);
    lines.push(``);
    for (const item of items) {
      lines.push(`### ${item.title || "(无标题)"}`);
      lines.push(``);
      lines.push(`- 状态：${bugStatusLabel(item.status)}`);
      lines.push(`- 严重度：${bugSeverityLabel(item.severity)}`);
      lines.push(`- 创建：${item.createdAt}`);
      lines.push(`- 更新：${item.updatedAt}`);
      if (item.cloudId) lines.push(`- 云端：${item.cloudId}`);
      lines.push(``);
      lines.push(htmlToPlain(item.html));
      lines.push(``);
      lines.push(`---`);
      lines.push(``);
    }
  }
  return lines.join("\n");
}

/** HTML → 纯文本摘要（导出用）。 */
export function htmlToPlain(html: string): string {
  const withAssets = html
    .replace(/src=["']xu-bug-asset:([^"']+)["']/gi, (_m, name: string) => `[图片:${name}]`)
    .replace(/src=["'](\/uploads\/bug-reports\/[^"']+)["']/gi, (_m, p: string) => `[图片:${p}]`);
  const tmp = document.createElement("div");
  tmp.innerHTML = withAssets;
  return (tmp.textContent || tmp.innerText || "").trim() || "(无正文)";
}

/**
 * Duty: 存盘用 HTML：asset 路径收成 xu-bug-asset:；保留 /uploads/bug-reports/。
 * dataURL / asset.localhost 需先走 persistEditorImages。
 */
export function normalizeBugHtmlForStorage(html: string): string {
  return html.replace(/src=["']([^"']+)["']/gi, (full, src: string) => {
    if (src.startsWith("/uploads/bug-reports/")) return full;
    if (src.startsWith(ASSET_PREFIX)) return full;
    const uploads = extractUploadsPath(src);
    if (uploads) return `src="${uploads}"`;
    const mapped =
      dataUrlToAssetName.get(src) ||
      blobUrlToAssetName.get(src) ||
      null;
    if (mapped) return `src="${ASSET_PREFIX}${mapped}"`;
    const name = extractAssetFilename(src);
    if (name) return `src="${ASSET_PREFIX}${name}"`;
    return full;
  });
}

/**
 * Duty: 把编辑器里的 dataURL / blob / asset.localhost 写成 xu-bug-asset: 文件名。
 */
export async function persistEditorImages(html: string): Promise<string> {
  let out = html;
  const re = /src=["']([^"']+)["']/gi;
  const srcs = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const src = m[1]!;
    if (src.startsWith("data:image/")) srcs.add(src);
    else if (src.startsWith("blob:")) srcs.add(src);
    else if (/asset\.localhost|asset:/i.test(src)) srcs.add(src);
  }
  for (const src of srcs) {
    if (src.startsWith("blob:")) {
      const mapped = blobUrlToAssetName.get(src);
      if (mapped) {
        out = replaceSrc(out, src, `${ASSET_PREFIX}${mapped}`);
        continue;
      }
      try {
        const blob = await (await fetch(src)).blob();
        const dataUrl = await compressBugImageToDataUrl(blob);
        const ext = extFromDataUrl(dataUrl) || "jpg";
        const name = await saveBugReportAsset(dataUrl, ext);
        dataUrlToAssetName.set(dataUrl, name);
        blobUrlToAssetName.set(src, name);
        out = replaceSrc(out, src, `${ASSET_PREFIX}${name}`);
      } catch {
        /* keep */
      }
      continue;
    }
    if (src.startsWith("data:image/")) {
      let name = dataUrlToAssetName.get(src);
      if (!name) {
        const compressed = await compressBugImageToDataUrl(src);
        const ext = extFromDataUrl(compressed) || "jpg";
        name = await saveBugReportAsset(compressed, ext);
        dataUrlToAssetName.set(src, name);
        dataUrlToAssetName.set(compressed, name);
      }
      out = replaceSrc(out, src, `${ASSET_PREFIX}${name}`);
      continue;
    }
    const name = extractAssetFilename(src);
    if (name) {
      out = replaceSrc(out, src, `${ASSET_PREFIX}${name}`);
    }
  }
  return out;
}

function replaceSrc(html: string, from: string, to: string): string {
  const variants = new Set([from, decodeHtmlAttrUrl(from)]);
  // 同时匹配未解码 / 已写成 &amp; 的属性值
  if (from.includes("&")) {
    variants.add(from.replace(/&/g, "&amp;"));
  }
  let out = html;
  for (const v of variants) {
    if (!v) continue;
    const esc = escapeReg(v);
    out = out.replace(new RegExp(`src=(["'])${esc}\\1`, "gi"), `src="${to}"`);
  }
  return out;
}

/** Duty: 还原属性里常见 HTML 实体（富文本常把 & 写成 &amp;）。 */
export function decodeHtmlAttrUrl(src: string): string {
  return String(src || "")
    .replace(/&amp;/gi, "&")
    .replace(/&#38;/g, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .trim();
}

/**
 * Duty: 详情展示前净化 img：解码 src 实体、去垃圾 alt、加 no-referrer。
 * 依赖: 纯字符串替换；不抛错。
 */
export function sanitizeBugHtmlForView(html: string): string {
  return String(html || "").replace(/<img\b[^>]*>/gi, (tag) => {
    let out = tag.replace(/\ssrc=(["'])([^"']*)\1/i, (_m, q: string, src: string) => {
      const decoded = decodeHtmlAttrUrl(src);
      return ` src=${q}${decoded}${q}`;
    });
    if (/\salt=/i.test(out)) {
      out = out.replace(/\salt=(["'])[^"']*\1/gi, ' alt=""');
    } else {
      out = out.replace(/<img\b/i, '<img alt=""');
    }
    if (!/\sreferrerpolicy=/i.test(out)) {
      out = out.replace(/<img\b/i, '<img referrerpolicy="no-referrer"');
    }
    return out;
  });
}

/**
 * Duty: 编辑器展示：本机 asset → blob: 短链（WangEditor 可显示）；清垃圾 alt。
 * 详情请用 hydrateBugHtmlForView（dataURL，本地优先）。
 */
export async function hydrateBugHtmlForEditor(html: string): Promise<string> {
  let out = String(html || "");
  const re = /src=["']([^"']+)["']/gi;
  const srcs = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(out))) {
    const src = decodeHtmlAttrUrl(m[1] || "");
    if (!src || src.startsWith("data:") || src.startsWith("blob:")) continue;
    srcs.add(src);
  }
  for (const src of srcs) {
    const local = await tryLocalAssetBlobSrc(src);
    if (local) {
      out = replaceSrc(out, src, local);
      continue;
    }
  }
  out = out.replace(
    /src=["'](\/uploads\/bug-reports\/[^"']+)["']/gi,
    (_m, p: string) => `src="${resolveUploadPublicUrl(p)}"`,
  );
  return sanitizeBugHtmlForView(out);
}

/**
 * Duty: 详情只读：本地 asset 优先 dataURL → 再拉 /uploads 与 http(s)。
 */
export async function hydrateBugHtmlForView(html: string): Promise<string> {
  let out = String(html || "");
  const re = /src=["']([^"']+)["']/gi;
  const srcs = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(out))) {
    const src = decodeHtmlAttrUrl(m[1] || "");
    if (!src || src.startsWith("data:")) continue;
    srcs.add(src);
  }
  for (const src of srcs) {
    try {
      const local = await tryLocalAssetDataUrl(src);
      if (local) {
        out = replaceSrc(out, src, local);
        continue;
      }
      if (src.startsWith("/uploads/") || /^https?:\/\//i.test(src)) {
        const abs = src.startsWith("/uploads/") ? resolveUploadPublicUrl(src) : src;
        const dataUrl = await fetchSrcAsDataUrl(abs);
        if (dataUrl) out = replaceSrc(out, src, dataUrl);
      }
    } catch {
      /* keep original src */
    }
  }
  return sanitizeBugHtmlForView(out);
}

/** Duty: 本机 asset → blob: URL（编辑器显示；带文件名映射便于存盘）。 */
async function tryLocalAssetBlobSrc(src: string): Promise<string | null> {
  const name = extractAssetFilename(src);
  if (!name) return null;
  try {
    if (!(await bugReportAssetExists(name))) return null;
    const dataUrl = await assetFileToDataUrl(name);
    const blob = await (await fetch(dataUrl)).blob();
    const blobUrl = URL.createObjectURL(blob);
    blobUrlToAssetName.set(blobUrl, name);
    dataUrlToAssetName.set(dataUrl, name);
    return blobUrl;
  } catch {
    return null;
  }
}

/** Duty: 从任意 src 解析本机 asset 文件名并读成 dataURL；没有则 null。 */
async function tryLocalAssetDataUrl(src: string): Promise<string | null> {
  const name = extractAssetFilename(src);
  if (!name) return null;
  try {
    if (!(await bugReportAssetExists(name))) return null;
    return await assetFileToDataUrl(name);
  } catch {
    return null;
  }
}

/** Duty: 把相对/绝对图址拉成 dataURL（公开 /uploads 或外链；优先 Tauri 绕过 CORS）。 */
async function fetchSrcAsDataUrl(src: string): Promise<string | null> {
  let url = decodeHtmlAttrUrl(src);
  if (url.startsWith("/uploads/")) {
    url = resolveUploadPublicUrl(url);
  }
  if (!/^https?:\/\//i.test(url) && !url.startsWith("data:")) return null;
  if (url.startsWith("data:")) return url;
  // 本机 convertFileSrc 不是公网，交给 tryLocalAssetDataUrl，勿走 HTTP
  if (/asset\.localhost|^asset:/i.test(url)) return null;
  try {
    const viaRust = await invoke<string>("xu_bug_report_fetch_url_data_url", { url });
    if (viaRust?.startsWith("data:image/")) return viaRust;
  } catch {
    /* fall through to browser fetch */
  }
  try {
    const res = await fetch(url, {
      method: "GET",
      credentials: "omit",
      referrerPolicy: "no-referrer",
    });
    if (!res.ok) return null;
    const blob = await res.blob();
    if (!blob.type.startsWith("image/") && blob.size < 32) return null;
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("read failed"));
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

/** 本机 asset 文件 → dataURL（Rust 读盘为主路径）。 */
async function assetFileToDataUrl(filename: string): Promise<string> {
  try {
    const dataUrl = await bugReportAssetDataUrl(filename);
    dataUrlToAssetName.set(dataUrl, filename);
    return dataUrl;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e || "");
    throw new Error(msg.includes("不存在") ? "本机截图不存在" : "读取截图失败");
  }
}

/**
 * Duty: 图传后端 uploads（multipart 文件，避开 BindJSON 1MB 截断），不走 COS。
 * 依赖: 已登录；前端已压 ≤2MB；失败抛错。
 */
async function postBugAssetToServer(opts: {
  dataBase64: string;
  ext: string;
  silent?: boolean;
}): Promise<string> {
  const dataUrl = await compressBugImageToDataUrl(opts.dataBase64);
  const approx = estimateDecodedBytesFromDataUrl(dataUrl);
  if (approx <= 0 || approx > BUG_IMAGE_MAX_BYTES) {
    throw new Error("图片过大，请换一张更小的图");
  }
  const ext = (extFromDataUrl(dataUrl) || opts.ext || "jpg").replace(/^\./, "");
  const blob = await (await fetch(dataUrl)).blob();
  if (blob.size <= 0 || blob.size > BUG_IMAGE_MAX_BYTES) {
    throw new Error("图片过大，请换一张更小的图");
  }
  // JSON base64 会撞上服务端 BindJSON 1MB 读上限；必须走 multipart
  const form = new FormData();
  form.append("file", blob, `img.${ext || "jpg"}`);
  const res = await cloudPost<{ path?: string; url?: string }>(
    "/bug-reports/assets",
    form,
    { silent: opts.silent, timeoutMs: 60_000 },
  );
  const url = String(res.data?.url || "").trim();
  if (url.startsWith("/uploads/bug-reports/")) return url;
  const path = String(res.data?.path || "").trim();
  if (path.startsWith("bug-reports/")) return `/uploads/${path}`;
  if (path.startsWith("/uploads/bug-reports/")) return path;
  throw new Error("截图未能同步，请稍后重试保存");
}

/**
 * Duty: 粘贴/选图：前端压到 ≤2MB 后落本机 asset，编辑器插入 blob: 短链。
 * 不传 COS、粘贴阶段不打云端。
 */
export async function uploadBugImageForEditor(file: File): Promise<string> {
  const dataUrl = await compressBugImageToDataUrl(file);
  const ext = extFromDataUrl(dataUrl) || extFromName(file.name) || "jpg";
  const filename = await saveBugReportAsset(dataUrl, ext);
  dataUrlToAssetName.set(dataUrl, filename);
  const blob = await (await fetch(dataUrl)).blob();
  const blobUrl = URL.createObjectURL(blob);
  blobUrlToAssetName.set(blobUrl, filename);
  return blobUrl;
}

/** Duty: dataURL → 纯 base64（去头、去空白），供上报。 */
export function dataUrlToRawBase64(dataUrl: string): string {
  const s = String(dataUrl || "").trim();
  const i = s.indexOf("base64,");
  const raw = i >= 0 ? s.slice(i + "base64,".length) : s;
  return raw.replace(/\s+/g, "");
}

function estimateDecodedBytesFromDataUrl(dataUrl: string): number {
  const raw = dataUrlToRawBase64(dataUrl);
  if (!raw) return 0;
  return Math.floor((raw.length * 3) / 4);
}

/**
 * Duty: 浏览器端将图片压到 maxBytes 以内（默认 2MB），返回 dataURL。
 * 依赖: Canvas；压不下去抛错。绝不返回超过 maxBytes 的结果。
 */
export async function compressBugImageToDataUrl(
  input: File | Blob | string,
  maxBytes: number = BUG_IMAGE_MAX_BYTES,
): Promise<string> {
  let blob: Blob;
  if (typeof input === "string") {
    const s = input.trim();
    if (!s.startsWith("data:image/")) {
      throw new Error("图片格式无效");
    }
    blob = await (await fetch(s)).blob();
  } else {
    blob = input;
  }
  if (!blob || blob.size <= 0) throw new Error("图片为空");

  if (blob.size <= maxBytes && /^image\/(png|jpe?g|webp|gif)$/i.test(blob.type || "")) {
    return await blobToDataUrl(blob);
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch {
    if (blob.size <= maxBytes) return await blobToDataUrl(blob);
    throw new Error("图片无法压缩，请换一张更小的图");
  }

  let maxEdge = Math.max(bitmap.width, bitmap.height, 1);
  let quality = 0.88;
  let best: Blob | null = null;

  try {
    for (let round = 0; round < 16; round++) {
      const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height, 1));
      const w = Math.max(1, Math.round(bitmap.width * scale));
      const h = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("图片处理失败");
      ctx.drawImage(bitmap, 0, 0, w, h);
      const encoded = await canvasToJpegBlob(canvas, quality);
      if (!best || encoded.size < best.size) best = encoded;
      if (encoded.size <= maxBytes) {
        return await blobToDataUrl(encoded);
      }
      if (quality > 0.45) {
        quality -= 0.08;
      } else {
        maxEdge = Math.max(480, Math.floor(maxEdge * 0.72));
        quality = 0.8;
      }
    }
  } finally {
    bitmap.close();
  }

  if (best && best.size <= maxBytes) return await blobToDataUrl(best);
  throw new Error("图片过大，请换一张更小的图");
}

function canvasToJpegBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => {
        if (!b) reject(new Error("图片编码失败"));
        else resolve(b);
      },
      "image/jpeg",
      quality,
    );
  });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("读取图片失败"));
    reader.readAsDataURL(blob);
  });
}

/**
 * Duty: 云端 Create/PATCH 前确认正文不再含本地/内嵌图（否则 BindJSON 易超限或校验失败）。
 * 失败: 抛出用户可读错误，由页面 fouAlert。
 */
function assertHtmlReadyForCloud(html: string): void {
  const s = String(html || "");
  if (
    /src=["']data:image\//i.test(s) ||
    /src=["']blob:/i.test(s) ||
    /src=["']xu-bug-asset:/i.test(s)
  ) {
    throw new Error("正文图片未能同步到云端，请删图后重新插入再保存");
  }
}

/**
 * Duty: 保存前把正文里本地图与外链图上传到后端 uploads，换成 /uploads/bug-reports/...
 * 无云会话时原样返回。优先用编辑器 dataURL / 内存映射，避免多余读盘。
 */
export async function ensureCloudHtmlImages(html: string): Promise<string> {
  if (!isBugCloudReady()) return html;

  const dataUrlByName = new Map<string, string>();
  const dataRe = /src=["'](data:image\/[^"']+)["']/gi;
  let dm: RegExpExecArray | null;
  while ((dm = dataRe.exec(html))) {
    const dataUrl = dm[1]!;
    const mapped = dataUrlToAssetName.get(dataUrl);
    if (mapped) dataUrlByName.set(mapped, dataUrl);
  }

  let out = await persistEditorImages(html);
  out = normalizeBugHtmlForStorage(out);
  out = sanitizeBugHtmlForView(out);

  const re = /src=["']xu-bug-asset:([^"']+)["']/gi;
  const names = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(out))) {
    names.add(m[1]!);
  }
  for (const name of names) {
    let dataUrl =
      dataUrlByName.get(name) ||
      [...dataUrlToAssetName.entries()].find(([, n]) => n === name)?.[0] ||
      null;
    if (!dataUrl) {
      dataUrl = await assetFileToDataUrl(name);
    }
    // 历史未压缩大图：先压再落新 asset，再上报
    let assetName = name;
    if (estimateDecodedBytesFromDataUrl(dataUrl) > BUG_IMAGE_MAX_BYTES) {
      const compressed = await compressBugImageToDataUrl(dataUrl);
      const ext = extFromDataUrl(compressed) || "jpg";
      assetName = await saveBugReportAsset(compressed, ext);
      dataUrlToAssetName.set(compressed, assetName);
      dataUrl = compressed;
      out = out.replace(
        new RegExp(`src=(["'])${escapeReg(ASSET_PREFIX + name)}\\1`, "gi"),
        `src="${ASSET_PREFIX}${assetName}"`,
      );
    }
    const ext = extFromName(assetName) || extFromDataUrl(dataUrl) || "jpg";
    const url = await postBugAssetToServer({
      dataBase64: dataUrl,
      ext,
      silent: false,
    });
    if (!url.startsWith("/uploads/bug-reports/")) {
      throw new Error("截图未能同步，请稍后重试保存");
    }
    out = out.replace(
      new RegExp(`src=(["'])${escapeReg(ASSET_PREFIX + assetName)}\\1`, "gi"),
      `src="${url}"`,
    );
  }

  // 外链 http(s)（粘贴百度图床等）转存本站，避免详情防盗链裂图
  const remoteRe = /src=["'](https?:\/\/[^"']+)["']/gi;
  const remotes = new Set<string>();
  let rm: RegExpExecArray | null;
  while ((rm = remoteRe.exec(out))) {
    const src = decodeHtmlAttrUrl(rm[1] || "");
    if (!src) continue;
    const uploads = extractUploadsPath(src);
    if (uploads) {
      out = replaceSrc(out, rm[1]!, uploads);
      continue;
    }
    remotes.add(src);
  }
  for (const src of remotes) {
    let dataUrl = await fetchSrcAsDataUrl(src);
    if (!dataUrl?.startsWith("data:image/")) {
      throw new Error("外链截图未能下载，请改用粘贴本机截图后再保存");
    }
    dataUrl = await compressBugImageToDataUrl(dataUrl);
    const ext = extFromDataUrl(dataUrl) || "jpg";
    const url = await postBugAssetToServer({
      dataBase64: dataUrl,
      ext,
      silent: false,
    });
    if (!url.startsWith("/uploads/bug-reports/")) {
      throw new Error("截图未能同步，请稍后重试保存");
    }
    out = replaceSrc(out, src, url);
  }
  return out;
}

function escapeReg(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractUploadsPath(src: string): string | null {
  if (src.startsWith("/uploads/bug-reports/")) return src;
  try {
    const u = new URL(src);
    if (u.pathname.startsWith("/uploads/bug-reports/")) return u.pathname;
  } catch {
    /* ignore */
  }
  const m = src.match(/(\/uploads\/bug-reports\/[^?#]+)/i);
  return m?.[1] || null;
}

function extractAssetFilename(src: string): string | null {
  const raw = decodeHtmlAttrUrl(src);
  if (!raw) return null;
  if (raw.startsWith("blob:")) {
    const mapped = blobUrlToAssetName.get(raw);
    return mapped && isSafeAssetName(mapped) ? mapped : null;
  }
  if (raw.startsWith(ASSET_PREFIX)) {
    const name = raw.slice(ASSET_PREFIX.length).trim();
    return isSafeAssetName(name) ? name : null;
  }

  // convertFileSrc / 编码路径：...bug-reports%5Cassets%5Cimg_xxx.jpg 或 /assets/img_xxx.jpg
  const enc = raw.match(
    /(?:bug-reports(?:[/\\]|%5[Cc])assets(?:[/\\]|%5[Cc])|[/\\]assets[/\\])([^/?#&]+)/i,
  );
  if (enc?.[1]) {
    const name = basenameAsset(decodeURIComponent(enc[1]));
    if (name) return name;
  }

  // 任意位置的本机落盘名 img_*.ext
  const bare = raw.match(/(img_[a-z0-9_]+\.(?:png|jpe?g|webp|gif))/i);
  if (bare?.[1] && isSafeAssetName(bare[1])) return bare[1];

  try {
    const u = new URL(raw);
    const pathDecoded = decodeURIComponent(u.pathname);
    const fromPath = pathDecoded.match(
      /(?:[/\\]bug-reports[/\\]assets[/\\]|[/\\]assets[/\\])([^/?#\\]+)/i,
    );
    if (fromPath?.[1]) {
      const name = basenameAsset(fromPath[1]);
      if (name) return name;
    }
    const last = basenameAsset(pathDecoded.split(/[/\\]/).filter(Boolean).pop() || "");
    if (last && /\.(png|jpe?g|webp|gif)$/i.test(last) && isSafeAssetName(last)) return last;
  } catch {
    /* ignore */
  }
  return null;
}

function basenameAsset(s: string): string | null {
  const t = String(s || "")
    .trim()
    .replace(/\\/g, "/")
    .split("/")
    .filter(Boolean)
    .pop();
  if (!t) return null;
  const name = t.split("?")[0]?.split("#")[0]?.trim() || "";
  return isSafeAssetName(name) ? name : null;
}

function isSafeAssetName(name: string): boolean {
  return Boolean(
    name &&
      name.length <= 120 &&
      !name.includes("..") &&
      !name.includes("/") &&
      !name.includes("\\") &&
      /^[a-zA-Z0-9._-]+$/.test(name),
  );
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("读取图片失败"));
    reader.readAsDataURL(file);
  });
}

function extFromName(name: string): string {
  const i = name.lastIndexOf(".");
  if (i < 0) return "";
  return name.slice(i + 1).toLowerCase().replace(/[^a-z0-9]/g, "") || "";
}

function extFromDataUrl(dataUrl: string): string {
  const m = /^data:image\/([\w+.-]+);/i.exec(dataUrl);
  if (!m?.[1]) return "";
  const t = m[1].toLowerCase().replace("jpeg", "jpg");
  return t === "svg+xml" ? "svg" : t.replace(/[^a-z0-9]/g, "");
}
