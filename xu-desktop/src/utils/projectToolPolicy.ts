/** Per-project Agent tool permissions — ungranted tools are hard-denied at runtime. */
export interface ProjectToolPolicy {
  readFiles: boolean;
  writeFiles: boolean;
  shell: boolean;
  browser: boolean;
  guiInput: boolean;
  ide: boolean;
  mcp: boolean;
  /** Role MCP allowlist; omit/undefined = no extra filter. [] = deny all MCP names. ["*"] = all. */
  mcpToolsAllowlist?: string[] | null;
}

export type ProjectToolPolicyFlag = Exclude<keyof ProjectToolPolicy, "mcpToolsAllowlist">;

export const TOOL_POLICY_LABELS: Record<ProjectToolPolicyFlag, { label: string; hint: string }> = {
  readFiles: { label: "读文件", hint: "浏览与搜索项目内文件" },
  writeFiles: { label: "写文件", hint: "创建、修改或删除项目文件" },
  shell: { label: "终端命令", hint: "在本机终端执行命令" },
  browser: { label: "浏览器", hint: "自动打开网页并操作" },
  guiInput: { label: "桌面键鼠", hint: "模拟点击与键盘输入" },
  ide: { label: "代码编辑器", hint: "在内嵌或外部 IDE 中打开文件" },
  mcp: { label: "扩展工具", hint: "您配置的第三方扩展服务" },
};

/** Boolean flags only — for invoke payloads typed as Record<string, boolean>. */
export function projectToolPolicyFlags(
  p: ProjectToolPolicy | null | undefined,
): Record<string, boolean> | null {
  if (!p) return null;
  return {
    readFiles: p.readFiles !== false,
    writeFiles: p.writeFiles === true,
    shell: p.shell === true,
    browser: p.browser === true,
    guiInput: p.guiInput === true,
    ide: p.ide === true,
    mcp: p.mcp === true,
  };
}

/** Conservative default for new projects: read-only. */
export function defaultProjectToolPolicy(): ProjectToolPolicy {
  return {
    readFiles: true,
    writeFiles: false,
    shell: false,
    browser: false,
    guiInput: false,
    ide: false,
    mcp: false,
  };
}

export type ToolPolicyPreset = "readonly" | "readwrite" | "full";

export const TOOL_POLICY_PRESET_LABELS: Record<ToolPolicyPreset, string> = {
  readonly: "只读",
  readwrite: "读写",
  full: "全部",
};

/** Map wizard preset to project tool policy. */
export function toolPolicyFromPreset(preset: ToolPolicyPreset): ProjectToolPolicy {
  if (preset === "readonly") {
    return defaultProjectToolPolicy();
  }
  if (preset === "readwrite") {
    return {
      ...defaultProjectToolPolicy(),
      writeFiles: true,
    };
  }
  return {
    readFiles: true,
    writeFiles: true,
    shell: true,
    browser: true,
    guiInput: true,
    ide: true,
    mcp: true,
  };
}

export function normalizeProjectToolPolicy(raw: Partial<ProjectToolPolicy> | null | undefined): ProjectToolPolicy {
  const d = defaultProjectToolPolicy();
  if (!raw) return d;
  const allow =
    raw.mcpToolsAllowlist === undefined
      ? undefined
      : Array.isArray(raw.mcpToolsAllowlist)
        ? raw.mcpToolsAllowlist.map((x) => String(x || "").trim()).filter(Boolean)
        : [];
  return {
    readFiles: raw.readFiles !== false,
    writeFiles: raw.writeFiles === true,
    shell: raw.shell === true,
    browser: raw.browser === true,
    guiInput: raw.guiInput === true,
    ide: raw.ide === true,
    mcp: raw.mcp === true,
    ...(allow !== undefined ? { mcpToolsAllowlist: allow } : {}),
  };
}

export function projectToolPolicyComplete(raw: Partial<ProjectToolPolicy> | null | undefined): boolean {
  return raw != null && typeof raw === "object" && "readFiles" in raw;
}
