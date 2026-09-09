/**
 * Official product identity from Rust. Vue only displays this — do not treat
 * frontend copies of brand strings as the source of truth.
 */
import { invoke } from "@tauri-apps/api/core";

export type AppIdentity = {
  productName: string;
  productNameEn: string;
  version: string;
  copyrightHolder: string;
};

const FALLBACK: AppIdentity = {
  productName: "虚募阁",
  productNameEn: "Virmoor",
  version: "",
  copyrightHolder: "玖咖科技",
};

let cache: AppIdentity | null = null;

export async function loadAppIdentity(force = false): Promise<AppIdentity> {
  if (!force && cache) return cache;
  try {
    cache = await invoke<AppIdentity>("xu_app_identity");
    return cache;
  } catch {
    return FALLBACK;
  }
}

export function readCachedAppIdentity(): AppIdentity {
  return cache ?? FALLBACK;
}
