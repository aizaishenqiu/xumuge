/**
 * @file 本机/云账号会话：token、restoreSession、改密；云 /me 走 request.ts
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-20
 * @updated 2026-09-05
 * @version 1.3.0
 * @category Auth
 * @algo session-persist-cloud-merge
 */
import { invoke } from "@tauri-apps/api/core";
import {
  clearCloudAuthVerified,
  markCloudAuthVerified,
} from "./cloudAuthLease";
import { rememberServerProductExpiresAt } from "./productExpiry";
import {
  getAccountServerUrl as accountUrlFromEnv,
  getShowcaseBaseUrl as showcaseBaseFromEnv,
  getShowcaseRegisterUrl as showcaseRegisterFromEnv,
} from "./appEnv";

export type AuthRole = "admin" | "user" | "trial";

export interface AuthPermissions {
  full: boolean;
  maxEmployees: number;
  tokenHardLimit: number;
  allowDrive: boolean;
  allowDispatch: boolean;
  allowChannelSave: boolean;
  allowMemoryWrite: boolean;
}

export interface AuthUser {
  id: string;
  username: string;
  role: AuthRole | string;
  /** Cloud account attribute: solo | enterprise */
  edition?: "solo" | "enterprise" | string | null;
  /** Cloud xu_users.id */
  cloudUserId?: string | null;
  /** Display id e.g. VM1A2B3C4D5 */
  publicId?: string | null;
  nickname?: string | null;
}

export interface AuthSession {
  token: string;
  user: AuthUser;
  permissions: AuthPermissions;
  isDevBuild: boolean;
  clearedStorage: boolean;
  authSource?: string | null;
  cloudAccessToken?: string | null;
  cloudRefreshToken?: string | null;
  /** Server product hard-deadline (RFC3339) */
  productExpiresAt?: string | null;
}

const TOKEN_KEY = "xu.auth.token";
const SESSION_KEY = "xu.auth.session";
const CLOUD_ACCESS_KEY = "xu.cloud.access_token";
const CLOUD_REFRESH_KEY = "xu.cloud.refresh_token";

function writeCloudTokens(access: string | null | undefined, refresh?: string | null) {
  try {
    if (!access) {
      localStorage.removeItem(CLOUD_ACCESS_KEY);
      localStorage.removeItem(CLOUD_REFRESH_KEY);
    } else {
      localStorage.setItem(CLOUD_ACCESS_KEY, access);
      if (refresh) localStorage.setItem(CLOUD_REFRESH_KEY, refresh);
    }
  } catch {
    /* ignore */
  }
  void syncAuthSettingsToDb();
}

async function setSetting(key: string, value: string): Promise<void> {
  try {
    await invoke("xu_set_setting", { key, value });
  } catch {
    /* ignore */
  }
}

async function getSetting(key: string): Promise<string | null> {
  try {
    const v = await invoke<string | null>("xu_get_setting", { key });
    return v == null || v === "" ? null : v;
  } catch {
    return null;
  }
}

/** Duty: 把当前 localStorage 登录态写入 xu.db，供 IDE 子窗 hydrate。 */
export async function syncAuthSettingsToDb(): Promise<void> {
  try {
    const token = localStorage.getItem(TOKEN_KEY) || "";
    const session = localStorage.getItem(SESSION_KEY) || "";
    const access = localStorage.getItem(CLOUD_ACCESS_KEY) || "";
    const refresh = localStorage.getItem(CLOUD_REFRESH_KEY) || "";
    await setSetting(TOKEN_KEY, token);
    await setSetting(SESSION_KEY, session);
    await setSetting(CLOUD_ACCESS_KEY, access);
    await setSetting(CLOUD_REFRESH_KEY, refresh);
  } catch {
    /* ignore */
  }
}

/** Duty: 若 localStorage 无 token，从 xu.db settings 回填（主窗/IDE 冷启动）。 */
export async function hydrateAuthFromDb(): Promise<void> {
  try {
    if (!localStorage.getItem(TOKEN_KEY)) {
      const token = await getSetting(TOKEN_KEY);
      if (token) localStorage.setItem(TOKEN_KEY, token);
    }
    if (!localStorage.getItem(SESSION_KEY)) {
      const session = await getSetting(SESSION_KEY);
      if (session) localStorage.setItem(SESSION_KEY, session);
    }
    if (!localStorage.getItem(CLOUD_ACCESS_KEY)) {
      const access = await getSetting(CLOUD_ACCESS_KEY);
      if (access) localStorage.setItem(CLOUD_ACCESS_KEY, access);
    }
    if (!localStorage.getItem(CLOUD_REFRESH_KEY)) {
      const refresh = await getSetting(CLOUD_REFRESH_KEY);
      if (refresh) localStorage.setItem(CLOUD_REFRESH_KEY, refresh);
    }
  } catch {
    /* ignore */
  }
}

async function clearAuthSettingsFromDb(): Promise<void> {
  await setSetting(TOKEN_KEY, "");
  await setSetting(SESSION_KEY, "");
  await setSetting(CLOUD_ACCESS_KEY, "");
  await setSetting(CLOUD_REFRESH_KEY, "");
}

export function readCloudAccessToken(): string | null {
  try {
    return localStorage.getItem(CLOUD_ACCESS_KEY);
  } catch {
    return null;
  }
}

function persistSession(s: AuthSession) {
  writeAuthToken(s.token);
  try {
    if (!s.cloudAccessToken) {
      localStorage.removeItem(CLOUD_ACCESS_KEY);
      localStorage.removeItem(CLOUD_REFRESH_KEY);
    } else {
      localStorage.setItem(CLOUD_ACCESS_KEY, s.cloudAccessToken);
      if (s.cloudRefreshToken) localStorage.setItem(CLOUD_REFRESH_KEY, s.cloudRefreshToken);
    }
  } catch {
    /* ignore */
  }
  if (s.productExpiresAt) {
    rememberServerProductExpiresAt(s.productExpiresAt);
  }
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
  if (s.authSource === "cloud" || s.cloudAccessToken || s.cloudRefreshToken) {
    markCloudAuthVerified();
  }
  void syncAuthSettingsToDb();
}

export function readAuthToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function writeAuthToken(token: string | null) {
  try {
    if (!token) {
      localStorage.removeItem(TOKEN_KEY);
      sessionStorage.removeItem(TOKEN_KEY);
    } else {
      localStorage.setItem(TOKEN_KEY, token);
      sessionStorage.removeItem(TOKEN_KEY);
    }
  } catch {
    /* ignore */
  }
}

/** One-time: sessionStorage → localStorage so IDE 子窗口能读到登录态 */
export function migrateAuthStorage() {
  try {
    const legacyToken = sessionStorage.getItem(TOKEN_KEY);
    if (legacyToken && !localStorage.getItem(TOKEN_KEY)) {
      localStorage.setItem(TOKEN_KEY, legacyToken);
    }
    const legacySession = sessionStorage.getItem(SESSION_KEY);
    if (legacySession && !localStorage.getItem(SESSION_KEY)) {
      localStorage.setItem(SESSION_KEY, legacySession);
    }
  } catch {
    /* ignore */
  }
}

/** 登录成功后跳过首次引导，直接进入聊天首页。 */
export function markAppOnboardingComplete() {
  try {
    window.localStorage.setItem("xu.onboarding.complete", "true");
    window.localStorage.removeItem("hermes.onboarding.complete");
  } catch {
    /* ignore */
  }
}

export async function bootstrapAuth(): Promise<{
  isDevBuild: boolean;
  clearedStorage: boolean;
  hint: string;
}> {
  return invoke("xu_auth_bootstrap");
}

/** Account/API base from Vite env (never shown on login UI). */
export function getAccountServerUrl(): string {
  return accountUrlFromEnv();
}

/** Official showcase site (registration is web-only). */
export function getShowcaseBaseUrl(): string {
  return showcaseBaseFromEnv();
}

export function getShowcaseRegisterUrl(): string {
  return showcaseRegisterFromEnv();
}

/** Open showcase register page in the system browser. */
export async function openShowcaseRegister(): Promise<void> {
  const url = getShowcaseRegisterUrl();
  try {
    const { open } = await import("@tauri-apps/plugin-shell");
    await open(url);
  } catch {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

export async function login(username: string, password: string): Promise<AuthSession> {
  const s = await invoke<AuthSession>("xu_auth_login", {
    payload: { username, password },
  });
  persistSession(s);
  return s;
}

/** Cloud account login (AI-server / license-server /auth/login). Bridges into local session. */
export async function cloudLogin(
  email: string,
  password: string,
  serverUrl?: string,
): Promise<AuthSession & { packSessionMessage?: string }> {
  const s = await invoke<AuthSession>("xu_cloud_auth_login", {
    payload: { email, password, serverUrl: serverUrl || null },
  });
  persistSession({ ...s, authSource: s.authSource || "cloud" });
  const pack = await tryBootstrapPackSession(s, email, serverUrl);
  return { ...s, packSessionMessage: pack };
}

export async function cloudRegister(
  email: string,
  password: string,
  serverUrl?: string,
): Promise<AuthSession & { packSessionMessage?: string }> {
  const s = await invoke<AuthSession>("xu_cloud_auth_register", {
    payload: { email, password, serverUrl: serverUrl || null },
  });
  persistSession({ ...s, authSource: s.authSource || "cloud" });
  const pack = await tryBootstrapPackSession(s, email, serverUrl);
  return { ...s, packSessionMessage: pack };
}

async function tryBootstrapPackSession(
  s: AuthSession,
  email: string,
  serverUrl?: string,
): Promise<string | undefined> {
  try {
    const { bootstrapPackSessionAfterCloudLogin } = await import("../license/edition");
    const r = await bootstrapPackSessionAfterCloudLogin({
      accessToken: s.cloudAccessToken,
      serverUrl,
      account: email,
    });
    return r.message;
  } catch {
    return undefined;
  }
}

export async function cloudRefresh(): Promise<boolean> {
  try {
    const refresh = localStorage.getItem(CLOUD_REFRESH_KEY);
    if (!refresh) return false;
    const res = await invoke<{ accessToken: string; refreshToken?: string }>(
      "xu_cloud_auth_refresh",
      { refreshToken: refresh, serverUrl: null },
    );
    writeCloudTokens(res.accessToken, res.refreshToken || refresh);
    markCloudAuthVerified();
    return true;
  } catch {
    return false;
  }
}

/** Debug builds only — one-click admin session. */
export async function devLogin(): Promise<AuthSession> {
  const s = await invoke<AuthSession>("xu_auth_dev_login");
  persistSession(s);
  return s;
}

export async function register(username: string, password: string): Promise<AuthSession> {
  const s = await invoke<AuthSession>("xu_auth_register", {
    payload: { username, password },
  });
  persistSession(s);
  return s;
}

export async function logout(): Promise<void> {
  const token = readAuthToken();
  writeAuthToken(null);
  try {
    localStorage.removeItem(CLOUD_ACCESS_KEY);
    localStorage.removeItem(CLOUD_REFRESH_KEY);
  } catch {
    /* ignore */
  }
  clearCloudAuthVerified();
  try {
    localStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
  await clearAuthSettingsFromDb();
  if (token) {
    try {
      await invoke("xu_auth_logout", { token });
    } catch {
      /* ignore */
    }
  }
  try {
    const { sessionLogout } = await import("../license/edition");
    await sessionLogout();
  } catch {
    /* optional */
  }
}

export function isCloudEnterpriseSession(s: AuthSession | null | undefined): boolean {
  if (!s?.user) return false;
  const fromCloud = String(s.user.edition || "").toLowerCase();
  if (fromCloud === "enterprise") return true;
  const role = String(s.user.role || "").toLowerCase();
  return role === "enterprise" || role === "org" || role === "company";
}

export async function restoreSession(): Promise<AuthSession | null> {
  const token = readAuthToken();
  if (!token) return null;
  const s = await invoke<AuthSession | null>("xu_auth_me", { token });
  if (!s) {
    writeAuthToken(null);
    try {
      localStorage.removeItem(SESSION_KEY);
      sessionStorage.removeItem(SESSION_KEY);
    } catch {
      /* ignore */
    }
    return null;
  }
  // xu_auth_me 只校验本机会话；云 token / 过期字段从 localStorage 合并回去
  const cloudAccess = readCloudAccessToken();
  let cloudRefresh: string | null = null;
  try {
    cloudRefresh = localStorage.getItem(CLOUD_REFRESH_KEY);
  } catch {
    /* ignore */
  }
  const prev = cachedSession();
  if (cloudAccess) {
    s.authSource = "cloud";
    s.cloudAccessToken = cloudAccess;
    s.cloudRefreshToken = cloudRefresh;
    if (prev?.user?.nickname) s.user.nickname = prev.user.nickname;
    if (prev?.user?.publicId) s.user.publicId = prev.user.publicId;
    if (prev?.user?.cloudUserId) s.user.cloudUserId = prev.user.cloudUserId;
    if (prev?.user?.edition) s.user.edition = prev.user.edition;
  }
  const cachedExpiry =
    prev?.productExpiresAt ||
    (() => {
      try {
        return localStorage.getItem("xu.product.expires_at");
      } catch {
        return null;
      }
    })();
  if (cachedExpiry) {
    s.productExpiresAt = cachedExpiry;
    rememberServerProductExpiresAt(cachedExpiry);
  }
  persistSession(s);
  if (cloudAccess) {
    try {
      await fetchCloudMe();
    } catch (e) {
      const code = e && typeof e === "object" && "code" in e ? Number((e as { code: number }).code) : 0;
      if (code === 40310) {
        // 拦截器已 logout；本机 token 一并清掉
        writeAuthToken(null);
        return null;
      }
    }
  }
  return s;
}

export function cachedSession(): AuthSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY) ?? sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as AuthSession;
  } catch {
    return null;
  }
}

/**
 * 拉取云端 /auth/me：刷新昵称与 product_expires_at（个人中心 / 双验）。
 * 依赖: src/utils/request.ts（Bearer + 401 refresh + 40310 登出）。
 * 失败: silent 时返回 null；试用到期由拦截器登出并抛信封。
 */
export async function fetchCloudMe(): Promise<{
  nickname?: string;
  publicId?: string;
  productExpiresAt?: string;
} | null> {
  if (!readCloudAccessToken()) return null;
  if (!getAccountServerUrl()) return null;
  try {
    const { cloudGet } = await import("./request");
    const json = await cloudGet<Record<string, unknown>>("/auth/me", { silent: true });
    if (json.code !== 0 || !json.data) return null;
    const d = json.data;
    const productExpiresAt =
      (d.product_expires_at as string | undefined) ||
      (d.productExpiresAt as string | undefined);
    if (productExpiresAt) rememberServerProductExpiresAt(productExpiresAt);
    const nickname = String(d.nickname || "").trim() || undefined;
    const publicId = String(d.publicId || d.public_id || "").trim() || undefined;
    const s = cachedSession();
    if (s?.user && (nickname || publicId || productExpiresAt)) {
      if (nickname) s.user.nickname = nickname;
      if (publicId) s.user.publicId = publicId;
      if (productExpiresAt) s.productExpiresAt = productExpiresAt;
      persistSession(s);
    }
    return { nickname, publicId, productExpiresAt };
  } catch (e) {
    const code = e && typeof e === "object" && "code" in e ? Number((e as { code: number }).code) : 0;
    if (code === 40310) throw e;
    return null;
  }
}

export async function requireCapability(capability: string): Promise<AuthPermissions> {
  const token = readAuthToken();
  if (!token) throw new Error("未登录");
  return invoke<AuthPermissions>("xu_auth_require", { token, capability });
}

/** Re-verify login password for destructive actions (e.g. 清理重规划). */
export async function verifyLoginPassword(password: string): Promise<void> {
  const token = readAuthToken();
  if (!token) throw new Error("未登录");
  const session = cachedSession();
  const cloudAccess = readCloudAccessToken();
  const isCloud =
    session?.authSource === "cloud" || Boolean(cloudAccess);
  if (isCloud) {
    const email = (session?.user?.username || "").trim();
    if (!email) throw new Error("云端会话已失效，请重新登录后再操作");
    await invoke("xu_cloud_auth_verify_password", {
      payload: {
        email,
        password,
        serverUrl: null,
      },
    });
    return;
  }
  await invoke("xu_auth_verify_password", { token, password });
}

/** Change password — cloud account hits AI-server; local hits xu.db. */
export async function changePassword(
  oldPassword: string,
  newPassword: string,
): Promise<void> {
  const token = readAuthToken();
  if (!token) throw new Error("未登录");
  if (newPassword.trim().length < 8) {
    throw new Error("新密码至少 8 位，且须含大小写与数字");
  }
  const session = cachedSession();
  const cloudAccess = readCloudAccessToken();
  const isCloud =
    session?.authSource === "cloud" || Boolean(cloudAccess);
  if (isCloud) {
    if (!cloudAccess) {
      throw new Error("云端会话已失效，请重新登录后再改密码");
    }
    await invoke("xu_cloud_auth_change_password", {
      payload: {
        oldPassword,
        newPassword,
        accessToken: cloudAccess,
        serverUrl: null,
      },
    });
    return;
  }
  await invoke("xu_auth_change_password", {
    token,
    oldPassword,
    newPassword,
  });
}

/** Clear localStorage keys when packaged fresh install. */
export function clearClientDefaults() {
  const keep = new Set(["xu.auth.token"]);
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k) keys.push(k);
  }
  for (const k of keys) {
    if (k.startsWith("xu.") || k.startsWith("hermes") || k.startsWith("hermes_")) {
      if (!keep.has(k)) localStorage.removeItem(k);
    }
  }
}
