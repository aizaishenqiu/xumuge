import { normalizeWinPath } from "./chatWorkspace";

/** Format absolute path for chat composer; triggers prefetch in chatFileAccess. */
export function formatFileAttachment(absPath: string): string {
  const p = normalizeWinPath(absPath.trim());
  return `[附件: ${p}]`;
}
