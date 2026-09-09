import { readLs, writeLs } from "./xuStorage";

export type ChatViewMode = "qa" | "code";
export type ChatPanelLayout = "agentLeft" | "agentRight";

export interface ChatLayoutPrefs {
  viewMode: ChatViewMode;
  panelLayout: ChatPanelLayout;
}

const VIEW_MODE_KEY = "xu.chat.viewMode";
const PANEL_LAYOUT_KEY = "xu.chat.panelLayout";

export function defaultChatLayoutPrefs(): ChatLayoutPrefs {
  return { viewMode: "qa", panelLayout: "agentLeft" };
}

function normalizeViewMode(raw: string | null): ChatViewMode {
  return raw === "code" ? "code" : "qa";
}

function normalizePanelLayout(raw: string | null): ChatPanelLayout {
  return raw === "agentRight" ? "agentRight" : "agentLeft";
}

export function loadChatLayoutPrefs(): ChatLayoutPrefs {
  return {
    viewMode: normalizeViewMode(readLs(VIEW_MODE_KEY)),
    panelLayout: normalizePanelLayout(readLs(PANEL_LAYOUT_KEY)),
  };
}

export function saveChatLayoutPrefs(prefs: Partial<ChatLayoutPrefs>): ChatLayoutPrefs {
  const current = loadChatLayoutPrefs();
  const next: ChatLayoutPrefs = {
    viewMode: prefs.viewMode ?? current.viewMode,
    panelLayout: prefs.panelLayout ?? current.panelLayout,
  };
  writeLs(VIEW_MODE_KEY, next.viewMode);
  writeLs(PANEL_LAYOUT_KEY, next.panelLayout);
  return next;
}

export function chatViewModeLabel(mode: ChatViewMode): string {
  return mode === "code" ? "代码" : "问答";
}

export function chatPanelLayoutLabel(layout: ChatPanelLayout): string {
  return layout === "agentRight" ? "智能体在右" : "智能体在左";
}
