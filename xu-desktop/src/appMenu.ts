import type { PlatformKind } from "./utils/platform";
import { shouldShowWindowMenu } from "./utils/platform";
import { BRAND_NAME_ZH } from "./utils/brandSettings";

export type AppMenuAction =
  | "new-session"
  | "open-chat"
  | "open-office"
  | "open-team"
  | "open-memory"
  | "open-files"
  | "open-connections"
  | "open-dashboard"
  | "open-settings"
  | "open-office-menu"
  | "toggle-terminal"
  | "toggle-snapshot"
  | "show-shortcuts"
  | "stop-agent"
  | "hide-window"
  | "quit"
  /** IDE File menu (Cursor / VS Code parity) */
  | "ide-new-window"
  | "ide-new-file"
  | "ide-new-folder"
  | "ide-open-file"
  | "ide-open-folder"
  | "ide-save"
  | "ide-save-as"
  | "ide-save-all"
  | "ide-close-editor"
  | "ide-close-others"
  | "ide-close-saved"
  | "ide-close-all"
  | "ide-reveal-explorer"
  | "ide-reveal-in-os"
  | "ide-toggle-file-tree"
  | "ide-toggle-terminal"
  | "ide-toggle-chat"
  | "ide-revert-file"
  | "open-software-docs";

export interface AppMenuItem {
  label: string;
  action?: AppMenuAction;
  shortcut?: string;
  /** Visual separator (no action) */
  separator?: boolean;
}

export interface AppMenuSection {
  label: string;
  /** Remix icon for title-bar menu root (must differ per section). */
  icon: string;
  items: AppMenuItem[];
}

export const APP_MENU: AppMenuSection[] = [
  {
    label: "文件",
    icon: "file-line",
    items: [
      { label: "新建会话", action: "new-session", shortcut: "Ctrl+N" },
      { label: "截图", action: "toggle-snapshot" },
      { label: "退出", action: "quit" },
    ],
  },
  {
    label: "编辑",
    icon: "edit-line",
    items: [
      { label: "停止运行", action: "stop-agent" },
      { label: "快捷键", action: "show-shortcuts", shortcut: "Ctrl+/" },
    ],
  },
  {
    label: "查看",
    icon: "eye-line",
    items: [
      { label: "办公室", action: "open-office" },
      { label: "对话", action: "open-chat" },
      { label: "AI 团队", action: "open-team" },
      { label: "记忆", action: "open-memory" },
      { label: "文件树", action: "open-files" },
      { label: "多端连接", action: "open-connections" },
      { label: "设置", action: "open-settings" },
      { label: "终端", action: "toggle-terminal" },
    ],
  },
  {
    label: "Agent",
    icon: "robot-line",
    items: [
      { label: "压缩上下文", action: "show-shortcuts" },
      { label: "后台任务", action: "toggle-snapshot" },
    ],
  },
  {
    label: "窗口",
    icon: "layout-line",
    items: [
      { label: "隐藏到托盘", action: "hide-window" },
      { label: "截图", action: "toggle-snapshot" },
    ],
  },
  {
    label: "帮助",
    icon: "question-line",
    items: [
      { label: "软件文档", action: "open-software-docs" },
      { label: "快捷键", action: "show-shortcuts", shortcut: "Ctrl+/" },
      { label: `关于 ${BRAND_NAME_ZH}`, action: "open-settings" },
    ],
  },
];

/** IDE window menu — File menu mirrors Cursor / VS Code essentials. */
export const IDE_APP_MENU: AppMenuSection[] = [
  {
    label: "文件",
    icon: "file-line",
    items: [
      { label: "新建窗口", action: "ide-new-window", shortcut: "Ctrl+Shift+N" },
      { separator: true, label: "" },
      { label: "新建文件", action: "ide-new-file", shortcut: "Ctrl+N" },
      { label: "新建文件夹", action: "ide-new-folder" },
      { separator: true, label: "" },
      { label: "打开文件…", action: "ide-open-file", shortcut: "Ctrl+O" },
      { label: "打开文件夹…", action: "ide-open-folder", shortcut: "Ctrl+K Ctrl+O" },
      { separator: true, label: "" },
      { label: "保存", action: "ide-save", shortcut: "Ctrl+S" },
      { label: "另存为…", action: "ide-save-as" },
      { label: "全部保存", action: "ide-save-all", shortcut: "Ctrl+K S" },
      { label: "还原文件", action: "ide-revert-file" },
      { separator: true, label: "" },
      { label: "关闭编辑器", action: "ide-close-editor", shortcut: "Ctrl+W" },
      { label: "关闭其他", action: "ide-close-others" },
      { label: "关闭已保存", action: "ide-close-saved" },
      { label: "关闭全部", action: "ide-close-all" },
      { separator: true, label: "" },
      { label: "在文件树中显示", action: "ide-reveal-explorer" },
      { label: "在资源管理器中显示", action: "ide-reveal-in-os" },
      { separator: true, label: "" },
      { label: "退出", action: "quit" },
    ],
  },
  {
    label: "查看",
    icon: "eye-line",
    items: [
      { label: "切换侧栏文件树", action: "ide-toggle-file-tree", shortcut: "Ctrl+B" },
      { label: "切换右侧对话", action: "ide-toggle-chat" },
      { label: "切换终端", action: "ide-toggle-terminal", shortcut: "Ctrl+`" },
      { label: "快捷键", action: "show-shortcuts", shortcut: "Ctrl+/" },
    ],
  },
  {
    label: "终端",
    icon: "terminal-box-line",
    items: [{ label: "新建终端", action: "ide-toggle-terminal" }],
  },
  {
    label: "帮助",
    icon: "question-line",
    items: [
      { label: "软件文档", action: "open-software-docs" },
      { label: `关于 ${BRAND_NAME_ZH}`, action: "open-settings" },
    ],
  },
];

export function getWindowMenu(
  platform: PlatformKind,
  opts?: { ide?: boolean },
): AppMenuSection[] {
  if (!shouldShowWindowMenu(platform)) return [];
  return opts?.ide ? IDE_APP_MENU : APP_MENU;
}

export function isIdeMenuAction(action: AppMenuAction): boolean {
  return action.startsWith("ide-");
}
