/** Virtual paths for IDE editor tabs that are not filesystem files. */

export const IDE_SETTINGS_TAB = "xu://settings";

export function isIdeSettingsTab(path: string | null | undefined): boolean {
  return (path ?? "").replace(/\\/g, "/").toLowerCase() === IDE_SETTINGS_TAB;
}

export const IDE_OPEN_SETTINGS_EVENT = "xu-open-ide-settings";

export type IdeOpenSettingsDetail = {
  group?: string;
};

export function openIdeSettingsTab(group?: string): void {
  window.dispatchEvent(
    new CustomEvent(IDE_OPEN_SETTINGS_EVENT, {
      detail: { group } satisfies IdeOpenSettingsDetail,
    }),
  );
}
