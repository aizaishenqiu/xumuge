/** Office employee nameplate display preferences (Settings ↔ Office scene). */

export const OFFICE_DISPLAY_PREFS_KEY = "xu.office.displayPrefs";

export type PrimaryLabelFormat = "name" | "roleAndName" | "titleAndName";
export type SecondaryLineFormat = "none" | "role" | "status" | "employeeNo";
export type NameTruncateLen = 8 | 12 | 16;

export interface OfficeDisplayPrefs {
  primaryFormat: PrimaryLabelFormat;
  secondaryLine: SecondaryLineFormat;
  showStatusDot: boolean;
  showEmployeeNo: boolean;
  nameTruncate: NameTruncateLen;
  showSpeechBubbles: boolean;
}

export const OFFICE_DISPLAY_DEFAULTS: OfficeDisplayPrefs = {
  primaryFormat: "name",
  secondaryLine: "role",
  showStatusDot: true,
  showEmployeeNo: false,
  nameTruncate: 12,
  showSpeechBubbles: true,
};

function clampTruncate(n: number): NameTruncateLen {
  if (n <= 8) return 8;
  if (n >= 16) return 16;
  return 12;
}

export function readOfficeDisplayPrefs(): OfficeDisplayPrefs {
  try {
    const raw = localStorage.getItem(OFFICE_DISPLAY_PREFS_KEY);
    if (!raw) return { ...OFFICE_DISPLAY_DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<OfficeDisplayPrefs>;
    return {
      primaryFormat:
        parsed.primaryFormat === "roleAndName" || parsed.primaryFormat === "titleAndName"
          ? parsed.primaryFormat
          : "name",
      secondaryLine:
        parsed.secondaryLine === "none" ||
        parsed.secondaryLine === "status" ||
        parsed.secondaryLine === "employeeNo"
          ? parsed.secondaryLine
          : "role",
      showStatusDot: parsed.showStatusDot !== false,
      showEmployeeNo: parsed.showEmployeeNo === true,
      nameTruncate: clampTruncate(Number(parsed.nameTruncate)),
      showSpeechBubbles: parsed.showSpeechBubbles !== false,
    };
  } catch {
    return { ...OFFICE_DISPLAY_DEFAULTS };
  }
}

export function writeOfficeDisplayPrefs(prefs: OfficeDisplayPrefs): OfficeDisplayPrefs {
  const next: OfficeDisplayPrefs = {
    primaryFormat: prefs.primaryFormat,
    secondaryLine: prefs.secondaryLine,
    showStatusDot: prefs.showStatusDot,
    showEmployeeNo: prefs.showEmployeeNo,
    nameTruncate: clampTruncate(prefs.nameTruncate),
    showSpeechBubbles: prefs.showSpeechBubbles,
  };
  try {
    localStorage.setItem(OFFICE_DISPLAY_PREFS_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new CustomEvent("xu-office-display", { detail: next }));
  return next;
}

export const PRIMARY_FORMAT_OPTIONS: { value: PrimaryLabelFormat; label: string }[] = [
  { value: "name", label: "仅姓名" },
  { value: "roleAndName", label: "职务 · 姓名" },
  { value: "titleAndName", label: "岗位名 姓名" },
];

export const SECONDARY_LINE_OPTIONS: { value: SecondaryLineFormat; label: string }[] = [
  { value: "none", label: "不显示" },
  { value: "role", label: "职务" },
  { value: "status", label: "状态" },
  { value: "employeeNo", label: "工号" },
];

export const NAME_TRUNCATE_OPTIONS: { value: NameTruncateLen; label: string }[] = [
  { value: 8, label: "8 字" },
  { value: 12, label: "12 字" },
  { value: 16, label: "16 字" },
];
