/**
 * @file 岗位 MCP 工具白名单解析（server.tool 或 *）
 * @author qiuye <yjk150@qq.com>
 * @date 2026-09-01
 * @version 1.0.0
 * @category ToolPolicy
 * @algo mcp-name-allowlist
 */

/** Parse frontmatter mcpTools: "a.b,c.d" | "*" | "" */
export function parseMcpToolsAllowlist(raw: unknown): string[] {
  if (raw == null) return [];
  if (Array.isArray(raw)) {
    return raw.map((x) => String(x || "").trim()).filter(Boolean);
  }
  const s = String(raw).trim();
  if (!s) return [];
  if (s === "*") return ["*"];
  return s
    .split(/[,，\s]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

/**
 * mcp__server__tool → server.tool for allowlist match.
 */
export function mcpOpenAiNameToAllowKey(toolName: string): string | null {
  const m = String(toolName || "").match(/^mcp__([^_]+)__(.+)$/);
  if (!m) return null;
  return `${m[1]}.${m[2]}`;
}

export function mcpToolAllowed(
  toolName: string,
  allowlist: string[] | null | undefined,
): boolean {
  if (!String(toolName || "").startsWith("mcp__")) return true;
  const list = allowlist ?? [];
  if (list.includes("*")) return true;
  const key = mcpOpenAiNameToAllowKey(toolName);
  if (!key) return false;
  return list.some((a) => a === key || a === toolName);
}
