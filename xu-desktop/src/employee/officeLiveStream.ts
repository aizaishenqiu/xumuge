/**
 * @file 办公室实时流文案：协作条与大厅冒泡同源
 * @author qiuye <yjk150@qq.com>
 * @date 2026-09-02
 * @version 1.0.0
 * @category Stream
 * @algo session-employee-stream-hub
 */

export type OfficeLiveStreamListener = (employeeId: string) => void;

const textByEmployee = new Map<string, string>();
const sessionToEmployee = new Map<string, string>();
const listeners = new Set<OfficeLiveStreamListener>();

function notify(employeeId: string) {
  for (const h of listeners) {
    try {
      h(employeeId);
    } catch {
      /* ignore */
    }
  }
}

/**
 * 绑定会话 → 员工，供 chunk 尚未带 employeeId 时解析。
 * 依赖：派活/status 事件提供两侧 id；失败静默。
 */
export function bindStreamSession(sessionId: string, employeeId: string): void {
  const sid = sessionId.trim();
  const eid = employeeId.trim();
  if (!sid || !eid) return;
  sessionToEmployee.set(sid, eid);
}

/** 按会话查当前流式员工。 */
export function getEmployeeIdBySession(sessionId: string): string | null {
  const sid = sessionId.trim();
  if (!sid) return null;
  return sessionToEmployee.get(sid) ?? null;
}

/**
 * 写入员工当前实时文案（覆盖）；空串等同 clear。
 * 依赖：调用方已截断过长正文；通知订阅方刷新冒泡。
 */
export function setOfficeLiveStream(employeeId: string, text: string): void {
  const eid = employeeId.trim();
  if (!eid) return;
  const next = text.replace(/\s+/g, " ").trim();
  if (!next) {
    if (!textByEmployee.has(eid)) return;
    textByEmployee.delete(eid);
    notify(eid);
    return;
  }
  if (textByEmployee.get(eid) === next) return;
  textByEmployee.set(eid, next);
  notify(eid);
}

/** 清空某员工流式文案。 */
export function clearOfficeLiveStream(employeeId: string): void {
  setOfficeLiveStream(employeeId, "");
}

/** 按会话清空（结束/错误时）。 */
export function clearOfficeLiveStreamBySession(sessionId: string): void {
  const eid = getEmployeeIdBySession(sessionId);
  if (eid) clearOfficeLiveStream(eid);
}

/** 读取员工当前流式文案（无则空串）。 */
export function getOfficeLiveStream(employeeId: string): string {
  return textByEmployee.get(employeeId.trim()) ?? "";
}

/**
 * 订阅流变化；返回取消函数。
 * 依赖：大厅/条带挂载时订阅；失败不抛。
 */
export function subscribeOfficeLiveStream(handler: OfficeLiveStreamListener): () => void {
  listeners.add(handler);
  return () => {
    listeners.delete(handler);
  };
}
