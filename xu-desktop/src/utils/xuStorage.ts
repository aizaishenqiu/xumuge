/** Read localStorage with optional legacy `hermes_*` key fallback. */
export function readLs(key: string, legacyKey?: string): string | null {
  try {
    const v = localStorage.getItem(key);
    if (v !== null) return v;
    if (legacyKey) return localStorage.getItem(legacyKey);
  } catch {
    /* ignore */
  }
  return null;
}

export function writeLs(key: string, value: string, legacyKey?: string) {
  try {
    localStorage.setItem(key, value);
    if (legacyKey) localStorage.removeItem(legacyKey);
  } catch {
    /* ignore */
  }
}
