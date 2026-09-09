/**
 * Cloud permission lease: must revalidate with account server at least once every 7 days.
 */
import { invoke } from "@tauri-apps/api/core";
import {
  cachedSession,
  getAccountServerUrl,
  logout,
  readAuthToken,
  readCloudAccessToken,
  syncAuthSettingsToDb,
  type AuthSession,
} from "./auth";

export const CLOUD_AUTH_VERIFIED_AT_KEY = "xu.cloud.auth_verified_at";
/** Max offline period before forced server revalidation (ms). */
export const CLOUD_AUTH_LEASE_MS = 7 * 24 * 60 * 60 * 1000;

export type CloudAuthLeaseResult = "ok" | "logout" | "skipped";

export function readCloudAuthVerifiedAt(): number | null {
  try {
    const raw = localStorage.getItem(CLOUD_AUTH_VERIFIED_AT_KEY);
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

export function markCloudAuthVerified(at = Date.now()): void {
  try {
    localStorage.setItem(CLOUD_AUTH_VERIFIED_AT_KEY, String(at));
  } catch {
    /* ignore */
  }
}

export function clearCloudAuthVerified(): void {
  try {
    localStorage.removeItem(CLOUD_AUTH_VERIFIED_AT_KEY);
  } catch {
    /* ignore */
  }
}

export function cloudAuthLeaseExpired(now = Date.now()): boolean {
  const at = readCloudAuthVerifiedAt();
  if (at == null) return true;
  return now - at >= CLOUD_AUTH_LEASE_MS;
}

/** Sessions that must maintain a server-side permission lease. */
export function requiresCloudAuthLease(session: AuthSession | null | undefined): boolean {
  if (!session) return false;
  if (session.authSource === "cloud") return true;
  try {
    if (localStorage.getItem("xu.cloud.refresh_token")) return true;
  } catch {
    /* ignore */
  }
  if (readCloudAccessToken()) return true;
  // Production builds with configured account server: cloud login is required path.
  if (import.meta.env.PROD && getAccountServerUrl()) return true;
  return false;
}

function readCloudRefreshToken(): string | null {
  try {
    return localStorage.getItem("xu.cloud.refresh_token");
  } catch {
    return null;
  }
}

function persistTokens(access: string, refresh?: string | null) {
  try {
    localStorage.setItem("xu.cloud.access_token", access);
    if (refresh) localStorage.setItem("xu.cloud.refresh_token", refresh);
  } catch {
    /* ignore */
  }
  const session = cachedSession();
  if (session) {
    try {
      localStorage.setItem(
        "xu.auth.session",
        JSON.stringify({
          ...session,
          cloudAccessToken: access,
          cloudRefreshToken: refresh ?? session.cloudRefreshToken ?? null,
        }),
      );
    } catch {
      /* ignore */
    }
  }
  void syncAuthSettingsToDb();
}

/**
 * Pull fresh permission from account server when lease expired.
 * Returns logout when revalidation fails.
 */
export async function ensureCloudAuthLease(): Promise<CloudAuthLeaseResult> {
  const token = readAuthToken();
  if (!token) return "skipped";

  const session = cachedSession();
  if (!requiresCloudAuthLease(session)) return "skipped";

  if (!cloudAuthLeaseExpired()) return "ok";

  const access = readCloudAccessToken();
  const refresh = readCloudRefreshToken();
  if (!access && !refresh) {
    await forceLogoutForLease();
    return "logout";
  }

  try {
    const res = await invoke<{ accessToken: string; refreshToken?: string }>(
      "xu_cloud_auth_revalidate",
      {
        payload: {
          accessToken: access,
          refreshToken: refresh,
          serverUrl: getAccountServerUrl() || null,
        },
      },
    );
    if (res.accessToken) {
      persistTokens(res.accessToken, res.refreshToken ?? refresh);
    }
    markCloudAuthVerified();
    return "ok";
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err ?? "");
    // 鉴权明确失败才踢登录；网络/超时勿因唤醒跳转误登出
    if (/401|403|unauthor|invalid|过期|失效|revoked|forbidden/i.test(msg)) {
      await forceLogoutForLease();
      return "logout";
    }
    return "skipped";
  }
}

export async function forceLogoutForLease(): Promise<void> {
  clearCloudAuthVerified();
  await logout();
}
