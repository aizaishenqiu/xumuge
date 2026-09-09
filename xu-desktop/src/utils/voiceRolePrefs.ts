/**
 * @file 角色 / 员工 TTS 绑定偏好（语气 + 引擎提示）
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-31
 * @updated 2026-09-02
 * @version 1.1.0
 * @category Config
 * @algo local-prefs-map
 */

const KEY = "xu.voice.role.bind.v1";

export type RoleTtsHint = "auto" | "sherpa-onnx" | "cosyvoice";

export interface RoleVoiceBind {
  voiceToneId?: string;
  /** Cosy 心情 id；非 Cosy 可忽略 */
  moodId?: string;
  ttsProviderHint?: RoleTtsHint;
}

type BindMap = Record<string, RoleVoiceBind>;

function readAll(): BindMap {
  if (typeof localStorage === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(KEY) || "{}") as BindMap;
  } catch {
    return {};
  }
}

function writeAll(map: BindMap): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(KEY, JSON.stringify(map));
}

/** 读取员工或岗位的语音绑定。 */
export function loadRoleVoiceBind(roleOrEmployeeId: string): RoleVoiceBind {
  const id = roleOrEmployeeId.trim();
  if (!id) return {};
  return readAll()[id] ?? {};
}

/** 保存绑定。 */
export function saveRoleVoiceBind(roleOrEmployeeId: string, bind: RoleVoiceBind): void {
  const id = roleOrEmployeeId.trim();
  if (!id) return;
  const all = readAll();
  all[id] = {
    voiceToneId: bind.voiceToneId?.trim() || undefined,
    moodId: bind.moodId?.trim() || undefined,
    ttsProviderHint: bind.ttsProviderHint || "auto",
  };
  writeAll(all);
  window.dispatchEvent(
    new CustomEvent("xu:voice-role-bind", { detail: { id, bind: all[id] } }),
  );
}
