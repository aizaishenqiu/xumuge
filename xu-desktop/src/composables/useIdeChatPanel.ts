import { ref } from "vue";
import { readLs, writeLs } from "../utils/xuStorage";

const CHAT_HISTORY_KEY = "xu.ide.chatHistoryVisible";

function readHistoryVisible(): boolean {
  try {
    const raw = readLs(CHAT_HISTORY_KEY, "1");
    return raw !== "0";
  } catch {
    return true;
  }
}

/** Shared IDE right chat panel visibility (title bar ↔ IdePage). */
export const ideChatPanelVisible = ref(true);

/** IDE chat session list (history) visibility. */
export const ideChatHistoryVisible = ref(readHistoryVisible());

export function toggleIdeChatPanel() {
  ideChatPanelVisible.value = !ideChatPanelVisible.value;
}

export function setIdeChatPanelVisible(v: boolean) {
  ideChatPanelVisible.value = v;
}

export function toggleIdeChatHistory() {
  ideChatHistoryVisible.value = !ideChatHistoryVisible.value;
  writeLs(CHAT_HISTORY_KEY, ideChatHistoryVisible.value ? "1" : "0");
}

export function setIdeChatHistoryVisible(v: boolean) {
  ideChatHistoryVisible.value = v;
  writeLs(CHAT_HISTORY_KEY, v ? "1" : "0");
}
