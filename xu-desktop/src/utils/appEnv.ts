/**
 * @file 桌面端可改端点：只从此模块读 Vite env（业务文件禁止写死生产 URL）
 * @author qiuye <yjk150@qq.com>
 * @date 2026-09-05
 * @updated 2026-09-09
 * @version 1.0.1
 * @category Config
 * @algo vite-env-single-source
 */

function vite(key: string, fallback: string): string {
  const raw = (import.meta.env as Record<string, string | undefined>)[key];
  const v = String(raw ?? "").trim();
  return v || fallback;
}

/** 账号 / 许可证 API（…/api/v1） */
export function getAccountServerUrl(): string {
  return (
    vite("VITE_XU_ACCOUNT_URL", "") ||
    vite("VITE_XU_LICENSE_URL", "") ||
    (import.meta.env.DEV ? "http://127.0.0.1:8080/api/v1" : "https://api.xumuge.com/api/v1")
  );
}

/** 官网展示站（注册页） */
export function getShowcaseBaseUrl(): string {
  const fromEnv = vite("VITE_XU_SHOWCASE_URL", "").replace(/\/$/, "");
  if (fromEnv) return fromEnv;
  return import.meta.env.PROD ? "https://xumuge.com" : "http://127.0.0.1:5340";
}

export function getShowcaseRegisterUrl(): string {
  return `${getShowcaseBaseUrl()}/register`;
}

/** 岗位包商店 / 下载页 */
export function getStoreUrl(): string {
  return vite("VITE_XU_STORE_URL", "https://xumuge.com/download");
}

/** 检查更新失败时的安装包下载地址（默认同 Gitee 直链） */
export function getDownloadPageUrl(): string {
  return vite(
    "VITE_XU_DOWNLOAD_PAGE_URL",
    "https://gitee.com/jiukakeji/xumuge/releases/download/%E8%99%9A%E5%8B%9F%E9%98%81%E4%B8%80%E4%BA%BAAI%E5%85%AC%E5%8F%B8%E6%A1%8C%E9%9D%A2%E7%AB%AF/%E8%99%9A%E5%8B%9F%E9%98%81_1.0.2_x64-setup.exe",
  );
}

/** 与 server DOWNLOAD_DESKTOP_SLUG 对齐 */
export function getDesktopUpdateSlug(): string {
  return vite("VITE_XU_DESKTOP_UPDATE_SLUG", "virmoor-desktop-windows");
}

export function getVoicePackCatalogUrl(): string {
  return vite("VITE_XU_VOICE_PACK_CATALOG_URL", "");
}

export function getVoicePackSiteUrl(): string {
  return vite("VITE_XU_VOICE_PACK_SITE_URL", getVoicePackCatalogUrl());
}

export function getVoicePackDirectUrlsRaw(): string {
  return vite("VITE_XU_VOICE_PACK_URLS", "");
}

export function getCosyFastapiDefaultUrl(): string {
  return vite("VITE_XU_COSY_FASTAPI_URL", "http://127.0.0.1:50000");
}

export function getLocalBrainDefaultUrl(): string {
  return vite("VITE_XU_LOCAL_BRAIN_URL", "http://127.0.0.1:8787/v1");
}

export function getProductExpiresAtRaw(): string | undefined {
  const v = vite("VITE_PRODUCT_EXPIRES_AT", "");
  return v || undefined;
}

export function getDevLoginUser(): string {
  if (import.meta.env.PROD) return "";
  return vite("VITE_XU_DEV_USER", "");
}

export function getDevLoginPassword(): string {
  if (import.meta.env.PROD) return "";
  return vite("VITE_XU_DEV_PASSWORD", "");
}

export function getShowCommerceUiFlag(): boolean {
  const v = vite("VITE_XU_SHOW_COMMERCE_UI", "").toLowerCase();
  return v === "1" || v === "true";
}
