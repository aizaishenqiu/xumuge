/**
 * @file 语音包厂商/项目官网地址（与虚募阁 showcase 分离，用户可改）
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-31
 * @version 1.0.0
 * @category Config
 * @algo local-vendor-url-override
 */

const STORAGE_KEY = "xu.voice.pack.vendorUrl.v1";

/** 读取用户保存的语音包官网/catalog 地址；空串表示未覆盖 env。 */
export function loadVoicePackVendorUrl(): string {
  try {
    return String(localStorage.getItem(STORAGE_KEY) ?? "").trim();
  } catch {
    return "";
  }
}

/** 保存语音包官网地址（catalog.json 或 ZIP 直链）；返回规范化结果。 */
export function saveVoicePackVendorUrl(url: string): string {
  const next = url.trim();
  try {
    if (next) localStorage.setItem(STORAGE_KEY, next);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
  return next;
}
