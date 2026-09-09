/** Map project toolchain IDE → CLI binary on PATH. */

export type IdeKind =
  | "cursor"
  | "vscode"
  | "trae"
  | "qoder"
  | "jetbrains"
  | "windsurf"
  | "zed"
  | "other";

export type IdeOption = {
  id: IdeKind;
  label: string;
  icon: string;
  /** Default CLI when probe path unavailable. */
  cli: string;
  /** PATH binaries to probe; first hit wins. Empty = manual override only. */
  probeClis: string[];
};

export const IDE_OPTIONS: IdeOption[] = [
  { id: "cursor", label: "Cursor", icon: "terminal-window-line", cli: "cursor", probeClis: ["cursor"] },
  { id: "vscode", label: "VS Code", icon: "code-box-line", cli: "code", probeClis: ["code"] },
  { id: "trae", label: "Trae", icon: "code-s-slash-line", cli: "trae", probeClis: ["trae"] },
  { id: "qoder", label: "Qoder", icon: "terminal-box-line", cli: "qoder", probeClis: ["qoder"] },
  {
    id: "jetbrains",
    label: "JetBrains",
    icon: "braces-line",
    cli: "idea",
    probeClis: ["idea", "webstorm", "pycharm", "goland", "rider", "clion", "phpstorm"],
  },
  { id: "windsurf", label: "Windsurf", icon: "windy-line", cli: "windsurf", probeClis: ["windsurf"] },
  { id: "zed", label: "Zed", icon: "layout-column-line", cli: "zed", probeClis: ["zed"] },
  { id: "other", label: "其他", icon: "tools-line", cli: "cursor", probeClis: [] },
];

/** Picker subset without windsurf/zed for compact project forms (optional). */
export const IDE_PICKER_OPTIONS = IDE_OPTIONS;

const STORAGE_KEY = "xu.ide_cli_override";

/** Optional global CLI override (Settings / advanced). */
export function readIdeCliOverride(): string {
  try {
    return (localStorage.getItem(STORAGE_KEY) || "").trim();
  } catch {
    return "";
  }
}

export function writeIdeCliOverride(cli: string) {
  try {
    const t = cli.trim();
    if (!t) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, t);
  } catch {
    /* ignore */
  }
  void import("@tauri-apps/api/core")
    .then(({ invoke }) => invoke("xu_set_ide_cli", { cli: cli.trim() }))
    .catch(() => {
      /* ignore when not in Tauri */
    });
}

export function ideOption(id: IdeKind | string | undefined | null): IdeOption | undefined {
  return IDE_OPTIONS.find((o) => o.id === id);
}

export function cliForIde(ide: IdeKind | string | undefined | null): string {
  const override = readIdeCliOverride();
  if (override) return override;
  const hit = ideOption(ide);
  return hit?.cli || "cursor";
}

export function normalizeIdeKind(raw: unknown): IdeKind {
  const s = String(raw || "cursor");
  if (IDE_OPTIONS.some((o) => o.id === s)) return s as IdeKind;
  return "cursor";
}
