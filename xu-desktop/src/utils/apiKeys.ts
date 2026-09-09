/**
 * @file 模型 API Key 的本地持久化与配置状态查询
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-31
 * @version 1.0.1
 * @category Config
 * @algo validated-secret-reference
 */
import { invoke } from "@tauri-apps/api/core";

/** 将 API Key 持久化到 xu.db；Rust 端校验变量名且不注入进程全局环境。 */
export async function setStoredApiKey(apiKeyEnv: string, apiKey: string): Promise<void> {
  const env = apiKeyEnv.trim();
  if (!env) throw new Error("请先填写 API Key 环境变量名（如 DEEPSEEK_API_KEY）");
  await invoke("xu_set_stored_api_key", { apiKeyEnv: env, apiKey: apiKey.trim() });
}

export async function isApiKeyConfigured(apiKeyEnv: string): Promise<boolean> {
  const env = apiKeyEnv.trim();
  if (!env) return false;
  try {
    return await invoke<boolean>("xu_api_key_configured", { apiKeyEnv: env });
  } catch {
    return false;
  }
}

/**
 * 员工私有 API Key 的环境变量名（仅大写/数字/下划线，满足 xu.db 校验）。
 * 密钥本身写入 xu.db，不进 git。
 */
export function employeePrivateApiKeyEnv(employeeId: string): string {
  const id = (employeeId || "").replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  const tail = (id || "NEW").slice(-24);
  return `XU_EMP_KEY_${tail}`;
}
