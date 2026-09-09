/** How the assistant should address the user in replies. */
export const USER_ADDRESS_KEY = "xu.user.addressName";
export const USER_ADDRESS_MAX = 24;
export const DEFAULT_USER_ADDRESS = "您";

export function normalizeUserAddress(raw: string): string {
  const t = raw.trim().replace(/\s+/g, " ");
  if (!t) return DEFAULT_USER_ADDRESS;
  return t.slice(0, USER_ADDRESS_MAX);
}

export function readUserAddress(): string {
  try {
    const raw = localStorage.getItem(USER_ADDRESS_KEY);
    if (raw == null || !raw.trim()) return DEFAULT_USER_ADDRESS;
    return normalizeUserAddress(raw);
  } catch {
    return DEFAULT_USER_ADDRESS;
  }
}

/** Empty string when user left default unset (storage empty). */
export function readUserAddressRaw(): string {
  try {
    return localStorage.getItem(USER_ADDRESS_KEY)?.trim() ?? "";
  } catch {
    return "";
  }
}

export function writeUserAddress(value: string): string {
  const next = normalizeUserAddress(value);
  try {
    if (next === DEFAULT_USER_ADDRESS && !value.trim()) {
      localStorage.removeItem(USER_ADDRESS_KEY);
    } else {
      localStorage.setItem(USER_ADDRESS_KEY, next);
    }
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new CustomEvent("xu-user-address", { detail: { address: next } }));
  return next;
}

/** System-prompt line for chat / dispatch. */
export function buildUserAddressPromptLine(address = readUserAddress()): string {
  const name = normalizeUserAddress(address);
  return `【用户称呼】回复时请称用户为「${name}」，语气自然、尊重。`;
}
