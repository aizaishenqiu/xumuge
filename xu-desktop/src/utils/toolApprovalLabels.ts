/**
 * @file 工具审批与审计的用户向中文标签
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-20
 * @updated 2026-09-06
 * @version 1.1.3
 * @category UI
 * @algo tool-label-mapping
 */
import { IDE_OPTIONS, readIdeCliOverride } from "./ideCli";

/** Built-in agent tool id → short Chinese label */
const TOOL_LABEL_ZH: Record<string, string> = {
  list_dir: "列出目录",
  read_file: "读取文件",
  glob_file_search: "搜索文件",
  grep_search: "搜索内容",
  write_file: "写入文件",
  mkdir: "创建目录",
  patch_file: "修改文件",
  apply_patch: "应用补丁",
  delete_file: "删除文件",
  undo_last_changes: "撤销改动",
  update_plan: "更新计划",
  view_image: "查看图片",
  canvas_list: "列出画板文件",
  canvas_read: "读取画板文件",
  canvas_write_sketch: "写入草图",
  canvas_clear_sketch: "清空草图",
  canvas_add_strokes: "追加图元",
  canvas_update_stroke: "更新图元",
  canvas_delete_strokes: "删除图元",
  canvas_write_mermaid: "写入流程图",
  canvas_export: "导出画板文件",
  git: "Git 操作",
  shell_exec: "执行 Shell 命令",
  clipboard_get: "读取剪贴板",
  clipboard_set: "写入剪贴板",
  open_program: "启动程序",
  ide_open: "在 IDE 中打开",
  vscode_open: "在 IDE 中打开",
  vscode_save: "IDE 保存",
  vscode_reload_window: "IDE 重载窗口",
  office_open: "打开办公文件",
  office_read_xlsx: "预览表格",
  office_read_xlsx_range: "读表格范围",
  office_read_docx: "预览 Word",
  office_write_docx: "创建 Word",
  office_write_xlsx: "创建 Excel",
  office_edit_xlsx_cells: "改表格单元格",
  office_write_pptx: "创建 PPT",
  office_docx_replace: "替换 Word 文本",
  office_apply_template: "套用办公模板",
  app_launch: "启动桌面应用",
  screenshot_window: "截取屏幕",
  input_click: "屏幕点击",
  input_type: "键盘输入",
  gui_record_start: "开始 GUI 录制",
  gui_record_stop: "停止 GUI 录制",
  gui_replay: "回放 GUI 操作",
  browser_open: "打开浏览器",
  browser_goto: "浏览器跳转",
  browser_click: "浏览器点击",
  browser_type: "浏览器输入",
  browser_assert: "浏览器断言",
  browser_screenshot: "浏览器截图",
  defect_write: "记录缺陷",
  defect_assign_fix: "分配缺陷修复",
  run_ui_acceptance: "批跑 UI 验收",
  dispatch_defect_fix: "派修缺陷",
  bulk_read_warning: "整仓读取警告",
};

function ideLabelFromCli(cli: string): string {
  const c = cli.trim().toLowerCase();
  const hit = IDE_OPTIONS.find((o) => o.cli.toLowerCase() === c || o.id === c);
  if (hit) return hit.label;
  if (c === "code") return "VS Code";
  if (c === "cursor") return "Cursor";
  return cli || "IDE";
}

function parseArgsIde(toolArgs: string): string | null {
  try {
    const v = JSON.parse(toolArgs) as { ide?: string };
    return v?.ide?.trim() || null;
  } catch {
    return null;
  }
}

function parseArgsHint(toolArgs?: string): string | null {
  if (!toolArgs?.trim()) return null;
  try {
    const v = JSON.parse(toolArgs) as {
      path?: string;
      pattern?: string;
      query?: string;
      url?: string;
      command?: string;
      selector?: string;
      action?: string;
    };
    const hint =
      v.path?.trim() ||
      v.url?.trim() ||
      v.pattern?.trim() ||
      v.query?.trim() ||
      v.command?.trim() ||
      v.selector?.trim() ||
      v.action?.trim() ||
      null;
    if (!hint) return null;
    return hint.length > 48 ? `${hint.slice(0, 45)}…` : hint;
  } catch {
    return null;
  }
}

export function resolvedIdeLabel(toolArgs?: string): string {
  const fromArgs = toolArgs ? parseArgsIde(toolArgs) : null;
  if (fromArgs) return ideLabelFromCli(fromArgs);
  const override = readIdeCliOverride();
  if (override) return ideLabelFromCli(override);
  return "Cursor";
}

function mcpFriendlyLabel(toolName: string): string | null {
  const n = toolName.trim();
  if (!n.startsWith("mcp__")) return null;
  const rest = n.slice(5);
  const sep = rest.indexOf("__");
  if (sep <= 0) return "外部工具";
  const srv = rest.slice(0, sep).replace(/_/g, " ");
  const tool = rest.slice(sep + 2).replace(/_/g, " ");
  return `外部工具 · ${srv} · ${tool}`;
}

function baseToolLabel(toolName: string, toolArgs?: string): string {
  const mcp = mcpFriendlyLabel(toolName);
  if (mcp) return mcp;
  const n = toolName.trim();
  const mapped = TOOL_LABEL_ZH[n];
  if (mapped) return mapped;
  if (n === "ide_open" || n === "vscode_open") {
    return `在 ${resolvedIdeLabel(toolArgs)} 中打开文件`;
  }
  if (n === "office_open") return "打开 Office 文档";
  if (n === "write_file" || n === "patch_file" || n === "apply_patch") return "写入/修改文件";
  if (/^[a-z][a-z0-9_]*$/i.test(n)) return "智能体操作";
  return "智能体操作";
}

/** User-facing Chinese label for a tool call (chat cards, approval dialog, live status). */
export function formatToolApprovalLabel(toolName: string, toolArgs?: string): string {
  if (toolName === "bulk_read_warning") {
    try {
      const v = JSON.parse(toolArgs || "{}") as { reason?: string };
      if (v.reason?.trim()) return v.reason.trim();
    } catch {
      /* ignore */
    }
    return "疑似整仓读取到远程模型";
  }
  const base = baseToolLabel(toolName, toolArgs);
  const hint = parseArgsHint(toolArgs);
  if (hint && !base.includes(hint)) return `${base} · ${formatPathHint(hint)}`;
  return base;
}

function formatPathHint(hint: string): string {
  const t = hint.trim();
  if (!t) return t;
  if (t.length <= 48) return t;
  const base = t.split(/[/\\]/).pop();
  return base && base.length <= 48 ? base : `${t.slice(0, 45)}…`;
}

/** 审批/审计用的一行人话参数摘要（不展示原始 JSON） */
export function formatToolArgsSummary(toolName: string, toolArgs?: string | Record<string, unknown>): string {
  const raw =
    typeof toolArgs === "string"
      ? toolArgs
      : toolArgs && typeof toolArgs === "object"
        ? JSON.stringify(toolArgs)
        : "";
  const label = formatToolApprovalLabel(toolName, raw || undefined);
  const hint = parseArgsHint(raw || undefined);
  if (hint) {
    const h = formatPathHint(hint);
    if (!label.includes(h)) return `${label}（${h}）`;
  }
  if (toolName === "shell_exec" && raw) {
    try {
      const v = JSON.parse(raw) as { command?: string };
      const cmd = v.command?.trim();
      if (cmd) return `${label}（${formatPathHint(cmd)}）`;
    } catch {
      /* ignore */
    }
  }
  return label;
}

/** Monitor / 审计事件类型 → 用户向标题 */
export function formatAgentEventKind(kind: string): string {
  const k = kind.trim().toLowerCase();
  if (k.includes("toolcall") || k === "tool") return "工具调用";
  if (k.includes("thinking")) return "思考中";
  if (k.includes("compaction")) return "上下文整理";
  if (k.includes("error")) return "运行异常";
  if (k.includes("message")) return "消息";
  return "运行事件";
}
