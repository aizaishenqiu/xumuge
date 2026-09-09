import { invoke } from "@tauri-apps/api/core";
import type { XuCommercialEntitlement, XuLicenseEntitlements } from "./types";

let cache: XuLicenseEntitlements | null = null;
let cacheAt = 0;
const CACHE_MS = 5_000;

/** Dev-only override: comma-separated SKUs in localStorage `xu.dev.entitlements`. */
function readDevEntitlements(): string[] {
  if (import.meta.env.PROD) return [];
  try {
    const raw = localStorage.getItem("xu.dev.entitlements");
    if (!raw?.trim()) return [];
    return raw
      .split(/[,;\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

export async function listLicenseEntitlements(force = false): Promise<XuLicenseEntitlements> {
  const now = Date.now();
  if (!force && cache && now - cacheAt < CACHE_MS) return cache;
  try {
    const res = await invoke<XuLicenseEntitlements>("xu_license_entitlements");
    const merged = Array.from(new Set([...res.entitlements, ...readDevEntitlements()]));
    cache = { machineId: res.machineId, entitlements: merged };
  } catch {
    cache = { machineId: "", entitlements: import.meta.env.PROD ? [] : readDevEntitlements() };
  }
  cacheAt = now;
  return cache;
}

export function invalidateEntitlementCache(): void {
  cache = null;
  cacheAt = 0;
}

/** Rust `xu_license_entitlements` is authoritative; this helper only reads that result. */
export async function hasEntitlement(id: XuCommercialEntitlement): Promise<boolean> {
  const { entitlements } = await listLicenseEntitlements();
  return entitlements.includes(id);
}
