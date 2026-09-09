/** Global IDE / input-drive settings (combinable flags). */

export type GlobalDriveMode = "off" | "sdk" | "input_control";

export interface DriveSettings {
  enabled: boolean;
  /** Legacy primary mode — kept for compatibility. */
  mode: GlobalDriveMode;
  consentAccepted: boolean;
  windowWhitelist: string[];
  /** Combinable capabilities. */
  useSdk: boolean;
  useInputControl: boolean;
  useScreenshotToCursor: boolean;
  defaultReviewerId: string | null;
}

const STORAGE_KEY = "xu.driveSettings";

export const DEFAULT_DRIVE_SETTINGS: DriveSettings = {
  enabled: false,
  mode: "off",
  consentAccepted: false,
  windowWhitelist: ["Cursor", "Visual Studio Code", "Code"],
  useSdk: false,
  useInputControl: false,
  useScreenshotToCursor: false,
  defaultReviewerId: null,
};

export function readDriveSettings(): DriveSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { ...DEFAULT_DRIVE_SETTINGS, windowWhitelist: [...DEFAULT_DRIVE_SETTINGS.windowWhitelist] };
    }
    const parsed = JSON.parse(raw) as Partial<DriveSettings>;
    const mode =
      parsed.mode === "sdk" || parsed.mode === "input_control" || parsed.mode === "off"
        ? parsed.mode
        : "off";
    return {
      enabled: parsed.enabled === true,
      mode,
      consentAccepted: parsed.consentAccepted === true,
      windowWhitelist:
        Array.isArray(parsed.windowWhitelist) && parsed.windowWhitelist.length > 0
          ? parsed.windowWhitelist.map(String)
          : [...DEFAULT_DRIVE_SETTINGS.windowWhitelist],
      useSdk: parsed.useSdk === true || mode === "sdk",
      useInputControl: parsed.useInputControl === true || mode === "input_control",
      useScreenshotToCursor: parsed.useScreenshotToCursor === true,
      defaultReviewerId: typeof parsed.defaultReviewerId === "string" ? parsed.defaultReviewerId : null,
    };
  } catch {
    return { ...DEFAULT_DRIVE_SETTINGS, windowWhitelist: [...DEFAULT_DRIVE_SETTINGS.windowWhitelist] };
  }
}

export function writeDriveSettings(next: DriveSettings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new CustomEvent("xu-drive-settings", { detail: next }));
}

export function canUseInputDrive(settings = readDriveSettings()): boolean {
  return (
    settings.enabled &&
    settings.consentAccepted &&
    (settings.useInputControl || settings.mode === "input_control")
  );
}

/** @deprecated 请用 canUseSdkDriveAsync；同步版仅看开关，不保证 CLI 已装。 */
export function canUseSdkDrive(settings = readDriveSettings()): boolean {
  return settings.enabled && (settings.useSdk || settings.mode === "sdk");
}

export function canScreenshotToCursor(settings = readDriveSettings()): boolean {
  return settings.enabled && settings.useScreenshotToCursor;
}
