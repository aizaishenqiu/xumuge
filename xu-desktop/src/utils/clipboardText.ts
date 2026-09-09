import { invoke } from "@tauri-apps/api/core";

/** Copy text to system clipboard (Tauri native fallback when navigator.clipboard fails). */
export async function writeClipboardText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    /* fall through */
  }
  await invoke("xu_clipboard_set_text", { text });
}
