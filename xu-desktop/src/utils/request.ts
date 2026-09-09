/**
 * @file 桌面云 API 客户端：Bearer、刷新队列、40310 登出；对照官网 request.ts（fetch 实现，无 axios）
 * @author qiuye <yjk150@qq.com>
 * @date 2026-09-01
 * @version 1.0.0
 * @category Network
 * @algo token-refresh-queue
 */
import { fouAlert } from "foucui";
import {
  cloudRefresh,
  getAccountServerUrl,
  logout,
  readCloudAccessToken,
} from "./auth";
import { PRODUCT_EXPIRED_MSG, rememberServerProductExpiresAt } from "./productExpiry";

export type CloudApiBody<T = unknown> = {
  code?: number;
  msg?: string;
  error?: string;
  data?: T;
};

export type CloudRequestConfig = {
  url: string;
  method?: string;
  data?: unknown;
  headers?: Record<string, string>;
  /** 不弹 fouAlert、不跳登录（如启动 hydrate） */
  silent?: boolean;
  /** 跳过 Authorization（公开目录等） */
  noAuth?: boolean;
  timeoutMs?: number;
};

const SKIP_REFRESH = [
  "/auth/login",
  "/auth/register",
  "/auth/refresh",
  "/auth/logout",
  "/auth/send-code",
  "/auth/send-register-email-code",
  "/auth/send-email-code",
  "/auth/check-identity",
];

const HTTP_HINT: Record<number, string> = {
  400: "请求参数有误",
  401: "登录已过期，请重新登录",
  403: "没有权限",
  404: "访问的内容不存在",
  500: "服务异常，请稍后重试",
  502: "服务异常，请稍后重试",
  503: "服务暂不可用，请稍后重试",
  504: "服务暂不可用，请稍后重试",
};

let refreshToking = false;
let requests: Array<() => void> = [];

function safeMsg(raw: unknown, fallback: string): string {
  let s = String(raw || "")
    .replace(/^Error:\s*/i, "")
    .replace(/https?:\/\/[^\s)'"`]+/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (!s || /cors|axios|econnrefused|1045|access denied|failed to fetch/i.test(s)) {
    return fallback;
  }
  return s;
}

function shouldSkipRefresh(url?: string): boolean {
  const p = String(url || "").split("?")[0];
  return SKIP_REFRESH.some((s) => p.endsWith(s) || p.includes(s));
}

/** 账号 API 根（含 /api/v1），无配置返回空串。 */
export function resolveCloudApiBase(): string {
  return getAccountServerUrl()?.replace(/\/+$/, "") || "";
}

function joinUrl(base: string, path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${base}${p}`;
}

async function forceCloudLogout(msg: string, title: string, silent: boolean): Promise<void> {
  try {
    await logout();
  } catch {
    /* ignore */
  }
  // 动态 import 避免 request ↔ router ↔ auth 环依赖
  try {
    const { resetAuthSessionCheck, router } = await import("../router");
    resetAuthSessionCheck();
    if (!silent) {
      void fouAlert(msg, title);
      await router.push({ path: "/login", query: { reason: "cloud_session" } });
    }
  } catch {
    if (!silent) void fouAlert(msg, title);
  }
}

async function tryRefreshThenRetry<T>(config: CloudRequestConfig): Promise<CloudApiBody<T>> {
  if (refreshToking) {
    return new Promise((resolve, reject) => {
      requests.push(() => {
        cloudRequest<T>(config).then(resolve, reject);
      });
    });
  }
  refreshToking = true;
  try {
    const ok = await cloudRefresh();
    if (ok) {
      const queued = requests.splice(0, requests.length);
      queued.forEach((cb) => cb());
      return cloudRequest<T>(config);
    }
  } catch (e) {
    console.error("cloudRefresh error =>", e);
  } finally {
    refreshToking = false;
  }
  await forceCloudLogout(
    HTTP_HINT[401],
    "提示",
    Boolean(config.silent),
  );
  throw { code: 40101, msg: HTTP_HINT[401] } satisfies CloudApiBody;
}

async function parseJson(res: Response): Promise<CloudApiBody> {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as CloudApiBody;
  } catch {
    return { msg: text.slice(0, 200) };
  }
}

/**
 * 打云端 /api/v1：成功返回信封；业务失败抛出同一信封（拦截器已按需 fouAlert）。
 * 依赖: VITE_XU_ACCOUNT_URL、云 access/refresh；失败见 handle 分支。
 */
export async function cloudRequest<T = unknown>(
  config: CloudRequestConfig,
): Promise<CloudApiBody<T>> {
  const base = resolveCloudApiBase();
  if (!base) {
    const body: CloudApiBody = { code: -1, msg: "未配置账号服务" };
    if (!config.silent) void fouAlert(body.msg!, "提示");
    throw body;
  }

  const method = (config.method || "GET").toUpperCase();
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...(config.headers || {}),
  };
  if (!config.noAuth) {
    const token = readCloudAccessToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  let body: string | undefined;
  if (config.data !== undefined && method !== "GET" && method !== "HEAD") {
    if (typeof FormData !== "undefined" && config.data instanceof FormData) {
      body = undefined;
      // FormData：不设 Content-Type
      const { data } = config;
      return doFetch(base, config, method, headers, data as FormData);
    }
    if (!headers["Content-Type"]) headers["Content-Type"] = "application/json";
    body = typeof config.data === "string" ? config.data : JSON.stringify(config.data);
  }

  return doFetch(base, config, method, headers, body);
}

async function doFetch<T>(
  base: string,
  config: CloudRequestConfig,
  method: string,
  headers: Record<string, string>,
  body: string | FormData | undefined,
): Promise<CloudApiBody<T>> {
  const url = joinUrl(base, config.url);
  const silent = Boolean(config.silent);
  const timeoutMs = config.timeoutMs ?? 30_000;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: body as BodyInit | undefined,
      signal: ctrl.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    const aborted = e instanceof Error && e.name === "AbortError";
    const msg = aborted ? "请求超时，请稍后重试" : "服务暂不可用，请稍后重试";
    if (!silent) void fouAlert(msg, "提示");
    throw { code: -1, msg } satisfies CloudApiBody;
  }
  clearTimeout(timer);

  const data = (await parseJson(res)) as CloudApiBody<T>;
  return handleData(config, res.status, data);
}

async function handleData<T>(
  config: CloudRequestConfig,
  status: number,
  body: CloudApiBody<T>,
): Promise<CloudApiBody<T>> {
  const code = typeof body.code === "number" ? body.code : status;
  const msg = safeMsg(body.msg || body.error, HTTP_HINT[status] || "请求失败");
  const silent = Boolean(config.silent);

  if (status === 503 || code === 50301) {
    if (!silent) void fouAlert(msg, "提示");
    throw { ...body, code, msg };
  }

  if (code === 40310 || (status === 403 && /试用已到期|产品已过期/.test(String(body.msg || "")))) {
    const pe =
      body.data &&
      typeof body.data === "object" &&
      "product_expires_at" in (body.data as object)
        ? String((body.data as { product_expires_at?: string }).product_expires_at || "")
        : "";
    if (pe) rememberServerProductExpiresAt(pe);
    await forceCloudLogout(msg || PRODUCT_EXPIRED_MSG, "试用到期", silent);
    throw { ...body, code: 40310, msg: msg || PRODUCT_EXPIRED_MSG };
  }

  const expired = (status === 401 || code === 40101) && !shouldSkipRefresh(config.url);
  if (expired) {
    try {
      const refresh = localStorage.getItem("xu.cloud.refresh_token");
      if (refresh) return await tryRefreshThenRetry<T>(config);
    } catch {
      /* fall through */
    }
  }

  if (status >= 200 && status < 300 && (code === 0 || body.code === undefined)) {
    return { ...body, code: body.code === undefined ? 0 : code, msg: body.msg };
  }

  if ((status === 401 || code === 40101) && shouldSkipRefresh(config.url)) {
    if (!silent) void fouAlert(msg, "提示");
    throw { ...body, code, msg };
  }

  if (status === 401 || code === 40101) {
    await forceCloudLogout(msg, "提示", silent);
    throw { ...body, code, msg };
  }

  if (!silent) void fouAlert(msg, "提示");
  throw { ...body, code, msg };
}

/** 便捷：GET，path 相对账号 API 根。 */
export function cloudGet<T = unknown>(
  url: string,
  opts?: Omit<CloudRequestConfig, "url" | "method">,
): Promise<CloudApiBody<T>> {
  return cloudRequest<T>({ ...opts, url, method: "GET" });
}

/** 便捷：POST JSON。 */
export function cloudPost<T = unknown>(
  url: string,
  data?: unknown,
  opts?: Omit<CloudRequestConfig, "url" | "method" | "data">,
): Promise<CloudApiBody<T>> {
  return cloudRequest<T>({ ...opts, url, method: "POST", data });
}

/** 便捷：PATCH JSON。 */
export function cloudPatch<T = unknown>(
  url: string,
  data?: unknown,
  opts?: Omit<CloudRequestConfig, "url" | "method" | "data">,
): Promise<CloudApiBody<T>> {
  return cloudRequest<T>({ ...opts, url, method: "PATCH", data });
}

export default cloudRequest;
