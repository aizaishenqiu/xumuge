/**
 * @file chatWorkspace.ts 对话工作区推断与系统提示
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-28
 * @updated 2026-09-06
 * @version 1.3.5
 * @category Config
 * @algo none
 */
import { fouConfirmPromise, fouMsg } from "foucui";
import { BRAND_ASSISTANT_INTRO } from "./brandSettings";
import { buildUserAddressPromptLine } from "./userAddressPrefs";

function chatAssistantIntroLines(): string[] {
  return [BRAND_ASSISTANT_INTRO, buildUserAddressPromptLine()];
}

const FILE_INTENT_RE =
  /读|读取|打开|查看|浏览|写|写入|创建|修改|保存|编辑|删除|文件|文件夹|目录|\.md\b|\.txt\b|\.json\b|\.yaml\b|\.yml\b/i;
const WIN_ABS_PATH_RE = /[A-Za-z]:[\\/][^\s"'<>|，。；;]+/g;
const REL_FILE_RE =
  /(?:^|[\s「『（(])(?:(?:docs|src|scripts|role-packs-src|resources)[\\/][^\s"'<>|，。；;]+)/gi;
const PROJECT_DIR_MARKERS = new Set([
  "docs",
  "src",
  "scripts",
  "role-packs-src",
  "resources",
  "src-tauri",
  "node_modules",
]);

const TEXT_FILE_RE = /\.(md|txt|json|yaml|yml|toml|csv|ts|tsx|js|mjs|vue|rs|css|html)$/i;

export function wantsFileTools(text: string): boolean {
  return FILE_INTENT_RE.test(text) || WIN_ABS_PATH_RE.test(text) || REL_FILE_RE.test(text);
}

const WRITE_INTENT_RE =
  /写|写入|创建|修改|保存|编辑|删除|加上|追加|末尾|最后一行|补充一行|写入文件|mkdir|patch/i;

const LAST_CHAT_FILE_KEY = "xu:lastChatFilePath";
const APPEND_LINE_RE =
  /(?:加上|追加|补充(?:一行)?|末尾(?:加|写)?|最后一行(?:下|加|写)?|写入)[：:\s「『（(]*([^」』）)\n]{1,200})/;

export function isWriteFileIntent(text: string): boolean {
  return WRITE_INTENT_RE.test(text);
}

export function getLastChatFilePath(): string | null {
  try {
    return localStorage.getItem(LAST_CHAT_FILE_KEY);
  } catch {
    return null;
  }
}

export function setLastChatFilePath(path: string): void {
  try {
    localStorage.setItem(LAST_CHAT_FILE_KEY, path);
  } catch {
    /* ignore */
  }
}

export function rememberPathsFromMessage(workspace: string, message: string): void {
  const paths = resolveReadablePaths(workspace, message).filter((p) => TEXT_FILE_RE.test(p));
  if (paths.length) setLastChatFilePath(paths[paths.length - 1]!);
}

export function resolveTargetFilePath(workspace: string, message: string): string | null {
  const paths = resolveReadablePaths(workspace, message).filter((p) => TEXT_FILE_RE.test(p));
  if (paths.length) return paths[paths.length - 1]!;
  const last = getLastChatFilePath();
  if (last && isPathUnderWorkspace(workspace, last)) return last;
  return null;
}

/** Extract plain text to append when user says「加上 XXX」etc. */
export function parseAppendLineIntent(message: string): string | null {
  const m = message.match(APPEND_LINE_RE);
  if (!m?.[1]) return null;
  return m[1].replace(/[」』）)]+$/g, "").trim() || null;
}

export function isReadOnlyFileIntent(text: string): boolean {
  return wantsFileTools(text) && !isWriteFileIntent(text);
}

export function normalizeWinPath(p: string): string {
  return p.replace(/\//g, "\\").replace(/[，。；;]+$/g, "");
}

export function extractAbsolutePaths(text: string): string[] {
  const found = text.match(WIN_ABS_PATH_RE) ?? [];
  return [...new Set(found.map((p) => normalizeWinPath(p)))];
}

export function extractRelativeFileRefs(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(REL_FILE_RE)) {
    const raw = (m[0] || "").trim().replace(/^[\s「『（(]+/, "");
    if (raw) out.push(normalizeWinPath(raw));
  }
  return [...new Set(out)];
}

export function inferWorkspaceRoot(absPath: string): string | null {
  let p = normalizeWinPath(absPath);
  if (TEXT_FILE_RE.test(p)) {
    const i = p.lastIndexOf("\\");
    if (i > 2) p = p.slice(0, i);
  }
  const parts = p.split("\\").filter(Boolean);
  if (parts.length < 2 || !parts[0].endsWith(":")) return null;

  while (parts.length > 2) {
    const last = parts[parts.length - 1].toLowerCase();
    if (PROJECT_DIR_MARKERS.has(last)) {
      parts.pop();
      break;
    }
    parts.pop();
  }
  return parts.join("\\");
}

export function isPathUnderWorkspace(workspace: string, target: string): boolean {
  const ws = normalizeWinPath(workspace).replace(/\\+$/, "").toLowerCase();
  const t = normalizeWinPath(target).toLowerCase();
  return t === ws || t.startsWith(`${ws}\\`);
}

/** Resolve a workspace-relative or absolute path to an absolute path. */
export function resolveAbsPath(workspace: string | null | undefined, absOrRel: string): string {
  const p = absOrRel.trim();
  if (!p) return p;
  const norm = normalizeWinPath(p);
  if (/^[A-Za-z]:[\\/]/.test(norm) || norm.startsWith("\\\\")) return norm;
  const ws = (workspace ?? "").trim();
  if (!ws) return norm;
  return `${normalizeWinPath(ws).replace(/\\+$/, "")}\\${norm.replace(/^[/\\]+/, "")}`;
}

export function toRelativePath(workspace: string, absOrRel: string): string {
  const ws = normalizeWinPath(workspace).replace(/\\+$/, "");
  const p = normalizeWinPath(absOrRel);
  const lowerWs = ws.toLowerCase();
  const lowerP = p.toLowerCase();
  if (lowerP === lowerWs) return ".";
  if (lowerP.startsWith(`${lowerWs}\\`)) return p.slice(ws.length + 1);
  return p;
}

export function resolveReadablePaths(workspace: string, message: string): string[] {
  const ws = normalizeWinPath(workspace);
  const out: string[] = [];
  for (const abs of extractAbsolutePaths(message)) {
    if (isPathUnderWorkspace(ws, abs)) out.push(abs);
  }
  for (const rel of extractRelativeFileRefs(message)) {
    out.push(`${ws}\\${rel}`);
  }
  return [...new Set(out)];
}

export async function ensureChatWorkspace(opts: {
  getWorkingDir: () => string | null;
  setWorkingDir: (path: string) => void;
  message: string;
  pickWorkingDir: () => Promise<void>;
  /** 首页：不弹目录选择器，优先绑定项目 generatePath 或引导开始项目向导 */
  homeMode?: boolean;
  getProjectGeneratePath?: () => string | null | Promise<string | null>;
  onGuideProjectStart?: () => void | Promise<void>;
  /** 通话等场景：用自定义确权（如语音）替代弹窗 */
  confirmAsk?: (
    message: string,
    title: string,
  ) => Promise<"confirm" | "cancel">;
}): Promise<boolean> {
  if (opts.getWorkingDir()?.trim()) return true;

  const absPaths = extractAbsolutePaths(opts.message);
  if (absPaths.length > 0) {
    const root = inferWorkspaceRoot(absPaths[0]);
    if (root) {
      opts.setWorkingDir(root);
      fouMsg.info(`已从路径推断工作区：${root}`);
      return true;
    }
  }

  if (opts.homeMode) {
    const gp = (await opts.getProjectGeneratePath?.())?.trim();
    if (gp) {
      opts.setWorkingDir(gp);
      return true;
    }
    // 首页无项目：不强制「先建项目」；由调用方决定是否继续纯对话
    return false;
  }

  const prompt =
    "读写文件需要先选择工作目录。请说确认去选择，或者说取消。";
  const action = opts.confirmAsk
    ? await opts.confirmAsk(prompt, "未选择工作目录")
    : await fouConfirmPromise(
        "读写文件需要先选择工作目录（项目根路径）。消息里若含绝对路径，也可自动推断；否则请手动选择。",
        "未选择工作目录",
        { confirmButtonText: "去选择", cancelButtonText: "取消" },
      );
  if (action === "confirm") await opts.pickWorkingDir();
  return Boolean(opts.getWorkingDir()?.trim());
}

export function buildChatPrefetchSystemPrompt(memoryBlock: string): string {
  const lines = [
    ...chatAssistantIntroLines(),
    "用户消息中已附带「应用已预读」的文件全文，请直接根据该内容回答。",
    "不要重复粘贴整份文件，给出摘要或要点即可。",
  ];
  if (memoryBlock.trim()) lines.push("", memoryBlock.trim());
  return lines.join("\n");
}

export function buildChatToolSystemPrompt(workspace: string, memoryBlock: string): string {
  const lines = [
    ...chatAssistantIntroLines(),
    "",
    `当前工作区：${workspace}`,
    "用户已授权工具：read_file / list_dir / glob_file_search / grep_search / apply_patch / patch_file / write_file / mkdir / shell_exec / undo_last_changes（写与 shell 仅工作区内，且须项目已授权）。",
    "项目画板在 .xu/canvas/：canvas_list / canvas_read 查阅；画图优先 canvas_add_strokes / canvas_update_stroke / canvas_delete_strokes / canvas_clear_sketch 小步改图；canvas_write_sketch 仅整板覆盖；交互流程图用 canvas_write_flow（写入 .xu/canvas/flow/{name}.flow.json）；canvas_write_mermaid 仅流程文本/甘特；canvas_clear_flow 清空流程图；canvas_export 导出。",
    "办公文档：office_write_docx/xlsx/pptx 新建；已有表用 office_read_xlsx_range + office_edit_xlsx_cells 改格；已有 Word 用 office_read_docx 再 office_docx_replace；有模板时用 office_apply_template（vars 占位符）套版。勿用 write_file 伪造 OOXML。",
    "三维：若已配置 MCP「Blender 三维宿主」用 mcp__blender-host__blender_*；若已配置「3ds Max 三维宿主」用 mcp__max-host__max_*。未配置时说明需在设置 → MCP 添加对应宿主，禁止编造已操作视口，禁止 GUI 点 DCC 菜单当主路径。",
    "文案：先读 `.xu/copy-style.md`（项目风格记忆）与 `.xu/skills/copywriting-delivery/SKILL.md`、`templates/copy/` 模板，成稿 write_file 到 deliverables/copy/；用户说「记住文案风格：…」则更新 `.xu/copy-style.md`；禁止声称已发公众号/微信/千牛；对外发送须老板确认（L4）。",
    "【路径铁律】回复里写出可点路径（如 `deliverables/copy/xxx.md`）之前，必须先 write_file / apply_patch 真正写入该路径；禁止口头「已存入」却未调用写入工具；成稿用 `deliverables/…`，勿虚构 `.xu/deliverables/` 或 `xu-deliverables/`。",
    "【画图默认本机 Canvas】用户要画图、户型、海报、排版、草图时，若未明确点名酷家乐、AutoCAD、CAD、SketchUp、Photoshop、PS、Figma 等外部软件，必须用上述画板工具写入 .xu/canvas/sketch/board.json，禁止只口头描述，禁止「想象一下」当交付，禁止推荐外部软件。图元 text 只能是短标注（房间名/标题/尺寸），禁止把用户整段原话写入画板，禁止「区块 A/B」当交付。",
    "【流程图必做】软件开发类项目、或用户要流程图/业务流/开发流程时，必须调用 canvas_write_flow 写入交互流程图（nodes+edges，末端箭头），禁止只口头描述或只写 Mermaid 当唯一交付；可用 name 如 software-dev。Canvas「流程」页会显示该图。",
    "【禁止假权限】设置中没有「工具权限 → Canvas本机工具」开关；禁止编造该路径。画板入口是首页或 IDE 的「打开 Canvas」。",
    "修改文件时优先使用 apply_patch（Codex Begin Patch 格式），小范围改动用 patch_file，全新文件用 write_file；误改可用 undo_last_changes。检索用 grep_search / glob_file_search；跑命令用 shell_exec。",
    "禁止回答「无法访问本地文件系统」；需要读文件时请调用 read_file。",
    "用户要求修改文件时，必须调用 apply_patch、patch_file 或 write_file 写回磁盘，禁止只在回复里描述已写入。",
  ];
  if (memoryBlock.trim()) lines.push("", memoryBlock.trim());
  return lines.join("\n");
}

export function buildChatWriteSystemPrompt(
  workspace: string,
  targetFile: string,
  memoryBlock: string,
): string {
  const rel = toRelativePath(workspace, targetFile);
  return [
    buildChatToolSystemPrompt(workspace, memoryBlock),
    "",
    `待修改文件：${rel}`,
    "请先 read_file 该文件，再 apply_patch 或 patch_file 将用户要求的变更写回源文件。",
    "禁止只在回复里写「已追加」而不调用工具。",
  ].join("\n");
}

/** @deprecated Use prefetchWithPermission from chatFileAccess */
export async function prefetchMessageFiles(workspace: string, message: string): Promise<string> {
  const { prefetchWithPermission } = await import("./chatFileAccess");
  return prefetchWithPermission(message, { workspace, previewPath: null });
}
