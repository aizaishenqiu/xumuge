/**
 * @file 整包产品硬过期 + 账号测试资格双验：本地 env + 服务端 product_expires_at，取更早截止
 * @author qiuye <yjk150@qq.com>
 * @date 2026-09-01
 * @updated 2026-09-05
 * @version 1.3.0
 * @category Auth
 * @algo wall-clock-deadline
 */

import { getProductExpiresAtRaw } from "./appEnv";

const STORAGE_KEY = "xu.product.expires_at";

/** 解析 ISO / 日期字符串；无效返回 null。 */
export function parseProductExpiresAt(raw: string | null | undefined): Date | null {
  const s = String(raw || "").trim();
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

/** 打包时嵌入的本地截止（无网兜底）。 */
export function localProductExpiresAt(): Date | null {
  try {
    return parseProductExpiresAt(getProductExpiresAtRaw());
  } catch {
    return null;
  }
}

/** 缓存服务端下发的截止（与本地 env 一起参与 min）。 */
export function rememberServerProductExpiresAt(raw: string | null | undefined): void {
  const d = parseProductExpiresAt(raw);
  try {
    if (!d) {
      localStorage.removeItem(STORAGE_KEY);
      return;
    }
    localStorage.setItem(STORAGE_KEY, d.toISOString());
  } catch {
    /* ignore */
  }
}

/** 读取缓存的服务端截止。 */
export function serverProductExpiresAt(): Date | null {
  try {
    return parseProductExpiresAt(localStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

/**
 * 生效截止：本地 env 与服务端缓存都有时取更早者；仅一方则用该方。
 * 防止「更晚的服务端日期」绕过构建内杀开关。
 */
export function effectiveProductExpiresAt(): Date | null {
  const local = localProductExpiresAt();
  const server = serverProductExpiresAt();
  if (local && server) {
    return local.getTime() <= server.getTime() ? local : server;
  }
  return local ?? server;
}

export function isProductExpired(now = new Date()): boolean {
  const d = effectiveProductExpiresAt();
  if (!d) return false;
  return now.getTime() > d.getTime();
}

/** 距到期剩余整天数；已过期返回负数；未配置返回 null。 */
export function productDaysLeft(now = new Date()): number | null {
  const d = effectiveProductExpiresAt();
  if (!d) return null;
  const ms = d.getTime() - now.getTime();
  return Math.ceil(ms / (24 * 60 * 60 * 1000));
}

export const PRODUCT_EXPIRED_MSG = "虚募阁试用已到期，请联系运营获取新版本";

/** 倒计时短文案（紧凑位；侧栏已不再展示）。 */
export function productExpiryLabel(now = new Date()): string {
  const days = productDaysLeft(now);
  if (days == null) return "";
  if (days < 0) return "已到期";
  if (days === 0) return "今日到期";
  return `剩 ${days} 天`;
}

/**
 * 个人中心测试模式文案：`当前为测试模式：到期时间：YYYY年M月D日`。
 * 无截止配置时返回空串。
 */
export function productTestModeExpiryLine(now = new Date()): string {
  const d = effectiveProductExpiresAt();
  if (!d) return "";
  if (now.getTime() > d.getTime()) {
    return "当前为测试模式：已到期";
  }
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  return `当前为测试模式：到期时间：${y}年${m}月${day}日`;
}
