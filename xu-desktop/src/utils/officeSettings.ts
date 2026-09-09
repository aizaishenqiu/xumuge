/** Shared office floorplan settings (Settings page ↔ Office scene). */

export const OFFICE_DESK_COUNT_KEY = "xu.office.deskCount";
export const OFFICE_DESK_MIN = 2;
export const OFFICE_DESK_MAX = 16;
export const OFFICE_DESK_DEFAULT = 6;

export function clampDeskCount(value: number): number {
  if (!Number.isFinite(value)) return OFFICE_DESK_DEFAULT;
  return Math.min(OFFICE_DESK_MAX, Math.max(OFFICE_DESK_MIN, Math.round(value)));
}

export function readDeskCount(): number {
  try {
    const raw = localStorage.getItem(OFFICE_DESK_COUNT_KEY);
    if (raw == null) return OFFICE_DESK_DEFAULT;
    return clampDeskCount(Number(raw));
  } catch {
    return OFFICE_DESK_DEFAULT;
  }
}

export function writeDeskCount(value: number): number {
  const next = clampDeskCount(value);
  try {
    localStorage.setItem(OFFICE_DESK_COUNT_KEY, String(next));
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new CustomEvent("xu-office-settings", { detail: { deskCount: next } }));
  return next;
}
