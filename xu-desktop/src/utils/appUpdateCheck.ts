/**
 * @file appUpdateCheck.ts 桌面端软件升级检测与下载安装（整包）
 * @author qiuye <yjk150@qq.com>
 * @date 2026-09-04
 * @updated 2026-09-05
 * @version 1.3.0
 * @category Network
 * @algo semver-compare
 */
import { fouAlert, fouConfirmPromise } from "foucui";
import { loadAppIdentity } from "./appIdentity";
import { cloudGet, resolveCloudApiBase } from "./request";
import { getDesktopUpdateSlug, getDownloadPageUrl } from "./appEnv";
import {
  hideBusinessWindowsForUpdate,
  isMainWindow,
  openUpdaterWindow,
  restoreBusinessWindowsAfterUpdate,
} from "./windowManager";

export type AppUpdateStatus = "latest" | "available" | "unknown" | "offline";

export type AppUpdateResult = {
  status: AppUpdateStatus;
  current: string;
  latest: string;
  name?: string;
  changelog?: string;
  downloadUrl: string;
  installerUrl?: string;
  expectedSha256?: string;
  hasInstaller: boolean;
  message: string;
};

export type PendingAppUpdate = {
  installerUrl: string;
  version: string;
  expectedSha256?: string;
  latest: string;
  current: string;
};

export const PENDING_UPDATE_KEY = "xu.app.update.pending";
export const LAST_CHECK_DAY_KEY = "xu.app.update.last_check_day";
export const UPDATE_START_EVENT = "xu:app-update-start";

function defaultDownloadUrl(): string {
  return getDownloadPageUrl();
}

function desktopSlug(): string {
  return getDesktopUpdateSlug();
}

type SoftFile = {
  deliveryMode?: string;
  downloadUrl?: string;
  sha256?: string;
  fileName?: string;
};

type SoftItem = {
  id?: string;
  slug?: string;
  name?: string;
  homepage?: string;
  supportUrl?: string;
  latestVersion?: string;
  latestChangelog?: string;
  latestFiles?: SoftFile[];
};

function localDayKey(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function readLastUpdateCheckDay(): string | null {
  try {
    return localStorage.getItem(LAST_CHECK_DAY_KEY);
  } catch {
    return null;
  }
}

export function markUpdateCheckedToday(): void {
  try {
    localStorage.setItem(LAST_CHECK_DAY_KEY, localDayKey());
  } catch {
    /* ignore */
  }
}

export function writePendingAppUpdate(job: PendingAppUpdate): void {
  const raw = JSON.stringify(job);
  try {
    localStorage.setItem(PENDING_UPDATE_KEY, raw);
  } catch {
    /* ignore */
  }
  void import("@tauri-apps/api/core")
    .then(({ invoke }) => invoke("xu_set_setting", { key: PENDING_UPDATE_KEY, value: raw }))
    .catch(() => {});
}

export function readPendingAppUpdate(): PendingAppUpdate | null {
  try {
    const raw = localStorage.getItem(PENDING_UPDATE_KEY);
    if (raw) {
      const j = JSON.parse(raw) as PendingAppUpdate;
      if (j?.installerUrl) return j;
    }
  } catch {
    /* ignore */
  }
  return null;
}

/** Duty: 从 xu.db 读取待更新任务（跨 Webview 可靠）。 */
export async function loadPendingAppUpdate(): Promise<PendingAppUpdate | null> {
  const fromLs = readPendingAppUpdate();
  if (fromLs) return fromLs;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const raw = await invoke<string | null>("xu_get_setting", { key: PENDING_UPDATE_KEY });
    if (!raw) return null;
    const j = JSON.parse(raw) as PendingAppUpdate;
    if (!j?.installerUrl) return null;
    try {
      localStorage.setItem(PENDING_UPDATE_KEY, raw);
    } catch {
      /* ignore */
    }
    return j;
  } catch {
    return null;
  }
}

export function clearPendingAppUpdate(): void {
  try {
    localStorage.removeItem(PENDING_UPDATE_KEY);
  } catch {
    /* ignore */
  }
  void import("@tauri-apps/api/core")
    .then(({ invoke }) => invoke("xu_set_setting", { key: PENDING_UPDATE_KEY, value: "" }))
    .catch(() => {});
}

/**
 * Duty: 拉取 desktop 分类最新版本并与本机对比；解析安装包地址。
 * 依赖: cloudGet + loadAppIdentity；失败返回 offline/unknown，不抛错。不下载安装包。
 */
export async function checkAppUpdate(): Promise<AppUpdateResult> {
  const id = await loadAppIdentity();
  const current = normalizeVersion(id.version || "0.0.0");
  const base: AppUpdateResult = {
    status: "unknown",
    current,
    latest: "",
    downloadUrl: defaultDownloadUrl(),
    hasInstaller: false,
    message: "暂时无法检查更新，请稍后重试。",
  };

  if (!resolveCloudApiBase()) {
    return { ...base, status: "offline", message: "未配置账号服务，无法在线检查更新。" };
  }

  try {
    let items = await fetchDesktopItems();
    if (!items.length) {
      items = await fetchBySlug(desktopSlug());
    }
    if (!items.length) {
      return {
        ...base,
        status: "unknown",
        message: "暂未找到桌面端版本信息，请稍后再试。",
      };
    }

    const preferred =
      items.find((it) => String(it.slug || "") === desktopSlug()) || items[0];
    const latest = normalizeVersion(String(preferred.latestVersion || ""));
    const detail = await fetchSoftwareDetail(String(preferred.slug || preferred.id || ""));
    const merged = { ...preferred, ...detail };
    if (!latest && !normalizeVersion(String(merged.latestVersion || ""))) {
      return {
        ...base,
        status: "unknown",
        name: merged.name,
        message: "服务端未登记版本号，请稍后再试。",
        downloadUrl: pickHomepage(merged),
      };
    }
    const latestVer = normalizeVersion(String(merged.latestVersion || latest));
    const slug = String(merged.slug || desktopSlug());
    const files = Array.isArray(merged.latestFiles) ? merged.latestFiles! : [];
    const { installerUrl, expectedSha256, hasInstaller } = resolveInstaller(slug, files);
    const cmp = compareSemver(latestVer, current);
    const changelog = String(merged.latestChangelog || "").trim();
    const downloadUrl = pickHomepage(merged);

    if (cmp > 0) {
      return {
        status: "available",
        current,
        latest: latestVer,
        name: merged.name,
        changelog,
        downloadUrl,
        installerUrl,
        expectedSha256,
        hasInstaller,
        message: changelog
          ? `发现新版本 ${latestVer}（当前 ${current}）。\n\n${changelog}`
          : `发现新版本 ${latestVer}（当前 ${current}）。`,
      };
    }
    return {
      status: "latest",
      current,
      latest: latestVer,
      name: merged.name,
      changelog,
      downloadUrl,
      installerUrl,
      expectedSha256,
      hasInstaller,
      message: `当前已是最新版本（${current}）。`,
    };
  } catch {
    return { ...base, status: "offline", message: "检查更新失败，请检查网络后重试。" };
  }
}

/**
 * Duty: 确认后关闭业务窗、打开更新进度窗，由更新窗下载并静默安装。
 * 依赖: openUpdaterWindow / hideBusinessWindowsForUpdate；失败 fouAlert 并恢复业务窗。
 */
export async function downloadAndInstallAppUpdate(result: AppUpdateResult): Promise<boolean> {
  if (result.status !== "available") {
    await fouAlert(result.message || "当前无需安装更新。", "检查更新");
    return false;
  }
  if (!result.hasInstaller || !result.installerUrl) {
    await fouAlert("暂无可下载的安装包，请稍后再试或联系支持。", "检查更新");
    return false;
  }

  const confirmMsg = result.changelog
    ? `${result.message}\n\n将关闭当前窗口并下载安装包；安装完成后自动重启。是否继续？`
    : `发现新版本 ${result.latest}（当前 ${result.current}）。将关闭当前窗口并下载安装包；安装完成后自动重启。是否继续？`;

  const decision = await fouConfirmPromise(confirmMsg, "下载并安装");
  if (decision !== "confirm") {
    return false;
  }

  const job: PendingAppUpdate = {
    installerUrl: result.installerUrl,
    version: result.latest,
    expectedSha256: result.expectedSha256,
    latest: result.latest,
    current: result.current,
  };
  writePendingAppUpdate(job);

  try {
    await openUpdaterWindow();
    await hideBusinessWindowsForUpdate();
    // 给更新窗挂载监听留一点时间，再推事件（兼作跨窗兜底）
    await new Promise((r) => setTimeout(r, 400));
    const { emit } = await import("@tauri-apps/api/event");
    await emit(UPDATE_START_EVENT, job);
    return true;
  } catch (e) {
    clearPendingAppUpdate();
    await restoreBusinessWindowsAfterUpdate();
    await fouAlert(userFacingUpdateError(e), "检查更新");
    return false;
  }
}

/**
 * Duty: 托盘等入口——先检查；无新版本仅提示；有新版本再确认是否下载完整安装包。
 * 依赖: checkAppUpdate、downloadAndInstallAppUpdate。
 */
export async function runAppUpdateCheck(): Promise<AppUpdateResult> {
  const result = await checkAppUpdate();
  if (result.status !== "available") {
    await fouAlert(result.message, "检查更新");
    return result;
  }
  await downloadAndInstallAppUpdate(result);
  return result;
}

/**
 * Duty: 主窗每日最多自动检查一次；有更新弹确认，无更新安静记日。
 * 依赖: checkAppUpdate；非主窗直接跳过。
 */
export async function maybeDailyAppUpdateCheck(): Promise<void> {
  if (!isMainWindow()) return;
  if (readLastUpdateCheckDay() === localDayKey()) return;
  try {
    const result = await checkAppUpdate();
    markUpdateCheckedToday();
    if (result.status !== "available") return;
    await downloadAndInstallAppUpdate(result);
  } catch (err) {
    markUpdateCheckedToday();
    console.warn("daily-app-update", err);
  }
}

function resolveInstaller(
  slug: string,
  files: SoftFile[],
): { installerUrl?: string; expectedSha256?: string; hasInstaller: boolean } {
  const external = files.find(
    (f) =>
      String(f.deliveryMode || "").toLowerCase() === "external" &&
      /^https?:\/\//i.test(String(f.downloadUrl || "").trim()),
  );
  if (external) {
    return {
      installerUrl: String(external.downloadUrl).trim(),
      expectedSha256: String(external.sha256 || "").trim() || undefined,
      hasInstaller: true,
    };
  }
  const api = resolveCloudApiBase().replace(/\/+$/, "");
  if (!api) {
    return { hasInstaller: false };
  }
  const hosted = files.find((f) => String(f.deliveryMode || "hosted").toLowerCase() !== "external");
  const installerUrl = `${api}/public/download/installer?slug=${encodeURIComponent(slug || desktopSlug())}`;
  return {
    installerUrl,
    expectedSha256: String(hosted?.sha256 || files[0]?.sha256 || "").trim() || undefined,
    hasInstaller: true,
  };
}

async function fetchDesktopItems(): Promise<SoftItem[]> {
  const json = await cloudGet<{ items?: SoftItem[] }>(
    "/public/download/softwares?category=desktop",
    { silent: true, noAuth: true },
  );
  if (json.code !== undefined && json.code !== 0) return [];
  return Array.isArray(json.data?.items) ? json.data!.items! : [];
}

async function fetchBySlug(slug: string): Promise<SoftItem[]> {
  const json = await cloudGet<{ items?: SoftItem[] }>(
    `/public/download/softwares?keyword=${encodeURIComponent(slug)}`,
    { silent: true, noAuth: true },
  );
  if (json.code !== undefined && json.code !== 0) return [];
  const items = Array.isArray(json.data?.items) ? json.data!.items! : [];
  return items.filter((it) => String(it.slug || "") === slug || !slug);
}

async function fetchSoftwareDetail(idOrSlug: string): Promise<SoftItem> {
  const key = String(idOrSlug || "").trim();
  if (!key) return {};
  try {
    const json = await cloudGet<
      SoftItem & {
        versions?: Array<{ version?: string; changelog?: string; files?: SoftFile[] }>;
      }
    >(`/public/download/softwares/${encodeURIComponent(key)}`, {
      silent: true,
      noAuth: true,
    });
    if ((json.code !== undefined && json.code !== 0) || !json.data) return {};
    const d = json.data;
    const versions = Array.isArray(d.versions) ? d.versions : [];
    const top = versions[0];
    const files =
      (Array.isArray(d.latestFiles) && d.latestFiles.length
        ? d.latestFiles
        : top?.files) || [];
    return {
      ...d,
      latestVersion: d.latestVersion || top?.version,
      latestChangelog: d.latestChangelog || top?.changelog,
      latestFiles: files,
    };
  } catch {
    return {};
  }
}

function pickHomepage(item: SoftItem): string {
  const home = String(item.homepage || item.supportUrl || "").trim();
  if (/^https?:\/\//i.test(home)) return home;
  return defaultDownloadUrl();
}

function normalizeVersion(v: string): string {
  return String(v || "")
    .trim()
    .replace(/^v/i, "")
    .split(/[+\-]/)[0]
    .trim();
}

/** Duty: a>b → 1；a<b → -1；相等 → 0 */
export function compareSemver(a: string, b: string): number {
  const pa = normalizeVersion(a)
    .split(".")
    .map((x) => parseInt(x, 10) || 0);
  const pb = normalizeVersion(b)
    .split(".")
    .map((x) => parseInt(x, 10) || 0);
  const n = Math.max(pa.length, pb.length, 3);
  for (let i = 0; i < n; i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

export function userFacingUpdateError(e: unknown): string {
  let s = String(e || "")
    .replace(/^Error:\s*/i, "")
    .replace(/https?:\/\/[^\s)'"`]+/gi, "")
    .replace(/HTTP\s*\d+/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (!s || /invoke|tauri|failed to fetch|econnrefused/i.test(s)) {
    return "下载或安装失败，请稍后重试。若持续失败，请联系支持。";
  }
  if (/尚未上架|不存在|404|gone/i.test(s)) {
    return "安装包尚未上架，请稍后再试或联系支持。";
  }
  return s;
}
