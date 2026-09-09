/**
 * @file chatSessionProject.ts 首页任务会话 ↔ 项目 Brief 绑定（本机 map）
 * @author qiuye <yjk150@qq.com>
 * @date 2026-09-06
 * @version 1.0.0
 * @category Cache
 * @algo session-project-map
 */

const STORAGE_KEY = "xu.chat.session_project_map";

type SessionProjectMap = Record<string, string>;

function readMap(): SessionProjectMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: SessionProjectMap = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      const sid = String(k || "").trim();
      const pid = String(v || "").trim();
      if (sid && pid) out[sid] = pid;
    }
    return out;
  } catch {
    return {};
  }
}

function writeMap(map: SessionProjectMap): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

/** Duty: 读取会话绑定的项目 id；无绑定返回 null。 */
export function getSessionProjectId(sessionId: string | null | undefined): string | null {
  const sid = String(sessionId || "").trim();
  if (!sid) return null;
  const pid = readMap()[sid];
  return pid || null;
}

/** Duty: 写入或更新会话→项目绑定。 */
export function setSessionProjectId(
  sessionId: string | null | undefined,
  projectId: string | null | undefined,
): void {
  const sid = String(sessionId || "").trim();
  const pid = String(projectId || "").trim();
  if (!sid || !pid) return;
  const map = readMap();
  if (map[sid] === pid) return;
  map[sid] = pid;
  writeMap(map);
}

/** Duty: 清除某会话的项目绑定。 */
export function clearSessionProjectId(sessionId: string | null | undefined): void {
  const sid = String(sessionId || "").trim();
  if (!sid) return;
  const map = readMap();
  if (!(sid in map)) return;
  delete map[sid];
  writeMap(map);
}
