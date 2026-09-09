/**
 * @file 岗位包 Tauri 桥：安装列表、许可证、商店地址
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-30
 * @updated 2026-09-05
 * @version 1.1.0
 * @category Config
 * @algo invoke-role-pack
 */
import { invoke } from "@tauri-apps/api/core";
import { getStoreUrl } from "../utils/appEnv";

export type RolePackMeta = {
  id: string;
  slug: string;
  name: string;
  nameZh: string;
  emoji: string;
  division: string;
  divisionZh: string;
  description: string;
  roleKind: string;
  brainSlot: string;
  kickoffWave?: string | null;
  mcpTools?: string;
  tags: string[];
  source: string;
  industryId?: string | null;
  industryZh?: string | null;
  positionId?: string | null;
  positionZh?: string | null;
  positionCategory?: string | null;
  positionCategoryZh?: string | null;
};

export type InstalledRolePack = {
  packId: string;
  locale: string;
  roleCount: number;
  path: string;
  demo: boolean;
  builtAt?: string | null;
  contentVersion?: string | null;
  expiresAt?: string | null;
};

export type RolePackActivateResult = {
  ok: boolean;
  message: string;
  packId?: string | null;
  expiresAt?: string | null;
  contentVersion?: string | null;
  downloadUrl?: string | null;
  endpointSource?: string | null;
  sessionId?: string | null;
  revokedOther?: boolean | null;
};

export type LicenseStatus = {
  machineId: string;
  subscriptions: Array<{
    license: string;
    packId: string;
    machineId: string;
    expiresAt?: string | null;
    seats: number;
    contentVersion?: string | null;
    activatedAt: string;
    entitlements?: string[];
  }>;
};

export type RolePackUpdate = {
  packId: string;
  locale: string;
  contentVersion: string;
  downloadUrl?: string | null;
};

export type RolePackCatalogStatus = {
  roleCount: number;
  isDemoCatalog: boolean;
  demoRoleCap: number;
};

export async function getRolePackCatalogStatus(): Promise<RolePackCatalogStatus> {
  return invoke<RolePackCatalogStatus>("role_pack_catalog_status");
}

export async function listRolePackInstalled(): Promise<InstalledRolePack[]> {
  return invoke<InstalledRolePack[]>("role_pack_list_installed");
}

export async function listRolePackRoles(): Promise<RolePackMeta[]> {
  return invoke<RolePackMeta[]>("role_pack_list_roles");
}

export async function getRolePackPrompt(roleId: string): Promise<string | null> {
  return invoke<string | null>("role_pack_get_prompt", { roleId });
}

export async function importRolePack(path: string, keyHex?: string): Promise<InstalledRolePack> {
  return invoke<InstalledRolePack>("role_pack_import", {
    path,
    keyHex: keyHex || null,
  });
}

/**
 * 从临时下载 URL 拉取 .xupack 到本机用户目录，返回本地路径。
 * 依赖 role_pack_download_url；失败抛错由调用方 fouAlert。
 */
export async function downloadRolePackFromUrl(url: string, packId?: string): Promise<string> {
  return invoke<string>("role_pack_download_url", {
    url,
    packId: packId || null,
  });
}

export async function activateRolePack(
  license: string,
  path: string,
  serverUrl?: string,
): Promise<RolePackActivateResult> {
  return invoke<RolePackActivateResult>("role_pack_activate", {
    license,
    path,
    serverUrl: serverUrl || null,
  });
}

export async function reloadRolePacks(): Promise<number> {
  return invoke<number>("role_pack_reload");
}

export async function getRolePackMachineId(): Promise<string> {
  return invoke<string>("role_pack_machine_id");
}

export async function getRolePackLicenseStatus(): Promise<LicenseStatus> {
  return invoke<LicenseStatus>("role_pack_license_status");
}

export async function checkRolePackUpdates(serverUrl?: string): Promise<RolePackUpdate[]> {
  const res = await invoke<{ updates: RolePackUpdate[] }>("role_pack_check_updates", {
    serverUrl: serverUrl || null,
  });
  return res.updates || [];
}

/** 商业数据包购买页（VITE_XU_STORE_URL） */
export const ROLE_PACK_STORE_URL = getStoreUrl();

