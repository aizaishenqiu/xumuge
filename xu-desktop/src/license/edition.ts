/**
 * Edition prefs + session login for temporary xupack unwrap keys.
 */
import { invoke } from "@tauri-apps/api/core";
import type { RolePackActivateResult, RolePackMeta } from "../office/rolePackApi";
import { toUserError } from "../utils/userFacingError";

export type FouEdition = "solo" | "enterprise";
export type EndpointMode = "auto" | "local" | "cloud";

export type EditionPrefs = {
  edition: FouEdition;
  endpointMode: EndpointMode;
  localBaseUrl: string;
  cloudBaseUrl: string;
  activeRoleIds: string[];
};

export type ResolvedEndpoint = {
  baseUrl: string;
  source: string;
  localTried: boolean;
  localOk: boolean;
};

export async function getEditionPrefs(): Promise<EditionPrefs> {
  return invoke<EditionPrefs>("role_pack_get_edition_prefs");
}

export async function setEditionPrefs(prefs: EditionPrefs): Promise<EditionPrefs> {
  return invoke<EditionPrefs>("role_pack_set_edition_prefs", { prefs });
}

export async function resolveLicenseEndpoint(): Promise<ResolvedEndpoint> {
  return invoke<ResolvedEndpoint>("role_pack_resolve_endpoint");
}

/** Cloud account login against AI-server / license stub; then pack session login. */
export async function sessionLogin(opts: {
  license?: string;
  path?: string;
  account?: string;
  password?: string;
  serverUrl?: string;
  accessToken?: string | null;
}): Promise<RolePackActivateResult> {
  let accessToken = opts.accessToken ?? null;
  if (!accessToken) {
    try {
      const { readCloudAccessToken } = await import("../utils/auth");
      accessToken = readCloudAccessToken();
    } catch {
      /* ignore */
    }
  }
  return invoke<RolePackActivateResult>("role_pack_session_login", {
    license: opts.license || "",
    path: opts.path || null,
    serverUrl: opts.serverUrl || null,
    account: opts.account || null,
    password: opts.password || null,
    accessToken,
  });
}

/**
 * After cloud account login: exchange JWT for in-memory xupack unwrap key.
 * Soft-fail: returns message; does not throw if pack server unreachable.
 */
export async function bootstrapPackSessionAfterCloudLogin(opts?: {
  accessToken?: string | null;
  serverUrl?: string;
  account?: string;
}): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await sessionLogin({
      license: "",
      account: opts?.account,
      serverUrl: opts?.serverUrl,
      accessToken: opts?.accessToken,
    });
    if (res.ok) {
      return { ok: true, message: res.message || "岗位临时密钥已就绪" };
    }
    let message = res.message || "解包未完成";
    if (/实名/.test(message)) {
      message += "。请打开官网个人中心 → 身份认证完成后再登录桌面端。";
    } else if (/绑定邮箱/.test(message)) {
      message += "。请打开官网个人中心 → 邮箱绑定完成后再登录桌面端。";
    } else if (/过期/.test(message)) {
      message += "。请重新注册后再使用桌面端。";
    }
    return { ok: false, message };
  } catch (e) {
    return { ok: false, message: toUserError(e) };
  }
}

export async function sessionRenew(packId?: string): Promise<RolePackActivateResult> {
  return invoke<RolePackActivateResult>("role_pack_session_renew", {
    packId: packId || null,
  });
}

export async function sessionLogout(): Promise<void> {
  await invoke("role_pack_session_logout");
}

export async function sessionStatus(): Promise<{
  accountSessionId?: string | null;
  keys: Array<{ packId: string; expiresAt: string; edition: string }>;
}> {
  return invoke("role_pack_session_status");
}

export async function listAllRolesForPicker(): Promise<RolePackMeta[]> {
  return invoke<RolePackMeta[]>("role_pack_list_roles_all");
}

/** Background renew when keys near expiry (call from settings or office mount). */
export async function maybeRenewSessionKeys(): Promise<void> {
  try {
    const st = await sessionStatus();
    for (const k of st.keys || []) {
      const exp = Date.parse(k.expiresAt);
      if (!Number.isFinite(exp)) continue;
      if (exp - Date.now() < 15 * 60 * 1000) {
        await sessionRenew(k.packId);
      }
    }
  } catch {
    /* offline / no session */
  }
}
