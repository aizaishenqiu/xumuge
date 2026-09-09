/** Office floor + peer DM session helpers (通讯录旁听). */

export const OFFICE_FLOOR = "office-floor";
export const BOSS_PEER_ID = "__boss__";

export function peerSessionTag(a: string, b: string): string {
  const [x, y] = [a, b].sort();
  return `peer:${x}:${y}`;
}

export function parsePeerTag(tag: string): [string, string] | null {
  if (!tag.startsWith("peer:")) return null;
  const parts = tag.slice(5).split(":");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  return [parts[0], parts[1]];
}

/**
 * 办公室对话框：展示老板发言、系统 ACK、员工终稿/开会/失败；
 * 过滤假闲聊与纯工具噪声行。
 */
export function isOfficeFloorWorthy(content: string, role?: string): boolean {
  const c = (content || "").trim();
  if (!c) return false;
  // 派活内部回显（完整任务堆）不进旁听；保留 Boss 真人发言
  if (role === "boss" && /^【派活】/.test(c)) return false;
  if (role === "boss" || role === "user") return true;
  // 假闲聊 / 旧占位 ACK
  if (/💬|走到\s*.*工位旁/.test(c)) return false;
  if (/^收到 Boss[，,.]?\s*我会跟进/.test(c)) return false;
  if (role === "system" || role === "notify") {
    if (/另有 \d+ 人已收到广播/.test(c)) return false;
    return true;
  }
  // Employee finals / meeting / ack phases — always show receipt & work state
  if (/· (落地|实现|分析|回复|开会|失败|已受理|待老板确认|进度|交付)】/.test(c)) {
    return true;
  }
  return /开会|会议|排期|待确认|请老板|需要老板|请审批|请拍板|阻塞|失败|XU_NEED_CONFIRM|请安排|需要安排|老板安排|评审|对齐会|派活|已受理|生成路径|已排队|开始处理|正在工作|方案|计划|XU_TASKS/.test(
    c,
  );
}

/** 办公室协作条：worthy 条目里隐藏「已受理」回执，保留员工交付正文。 */
export function isOfficeFloorStripVisible(content: string, role?: string): boolean {
  if (!isOfficeFloorWorthy(content, role)) return false;
  const c = (content || "").trim();
  if (/【[^】]+ · 已受理】/.test(c)) return false;
  if (/已收到 Boss 消息，开始处理/.test(c)) return false;
  return true;
}

/** @deprecated 用 isOfficeFloorStripVisible；勿把落地/实现/回复当「已完成」隐藏 */
export function isOfficeFloorIncomplete(content: string, role?: string): boolean {
  return isOfficeFloorStripVisible(content, role);
}
