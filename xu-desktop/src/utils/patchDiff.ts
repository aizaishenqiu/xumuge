export type DiffLineType = "ctx" | "add" | "del";

export type DiffLine = { type: DiffLineType; text: string };

export type PatchFileChange = {
  path: string;
  kind: "add" | "update" | "delete" | "move";
  lines: DiffLine[];
  moveTo?: string;
};

const PATCH_TOOLS = new Set([
  "apply_patch",
  "patch_file",
  "write_file",
  "delete_file",
]);

export function isPatchTool(name: string): boolean {
  return PATCH_TOOLS.has(name.trim());
}

export function isWritePatchTool(name: string): boolean {
  const n = name.trim();
  return n === "apply_patch" || n === "patch_file" || n === "write_file" || n === "delete_file";
}

function parseJsonArgs(raw: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(raw) as unknown;
    if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  } catch {
    /* ignore */
  }
  return null;
}

function linesFromOldNew(oldText: string, newText: string): DiffLine[] {
  const oldLines = oldText.replace(/\r\n/g, "\n").split("\n");
  const newLines = newText.replace(/\r\n/g, "\n").split("\n");
  const out: DiffLine[] = [];
  const max = Math.max(oldLines.length, newLines.length);
  for (let i = 0; i < max; i++) {
    const o = oldLines[i];
    const n = newLines[i];
    if (o === n) {
      if (o !== undefined) out.push({ type: "ctx", text: o });
    } else {
      if (o !== undefined) out.push({ type: "del", text: o });
      if (n !== undefined) out.push({ type: "add", text: n });
    }
  }
  return out;
}

function linesFromUnifiedDiff(diff: string): DiffLine[] {
  const out: DiffLine[] = [];
  for (const line of diff.replace(/\r\n/g, "\n").split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("@@")) continue;
    if (line.startsWith("+")) out.push({ type: "add", text: line.slice(1) });
    else if (line.startsWith("-")) out.push({ type: "del", text: line.slice(1) });
    else if (line.startsWith(" ")) out.push({ type: "ctx", text: line.slice(1) });
    else if (line.length) out.push({ type: "ctx", text: line });
  }
  return out;
}

function linesFromAddBody(body: string): DiffLine[] {
  const parts = body.replace(/\r\n/g, "\n").split("\n");
  if (parts.length && parts[parts.length - 1] === "") parts.pop();
  return parts.map((text) => ({ type: "add" as const, text }));
}

function parseBeginEndPatch(patch: string): PatchFileChange[] {
  const results: PatchFileChange[] = [];
  const lines = patch.replace(/\r\n/g, "\n").split("\n");
  let i = 0;
  while (i < lines.length) {
    const t = lines[i]!.trim();
    i++;
    if (!t || t.toLowerCase() === "*** begin patch" || t.toLowerCase() === "*** end patch") continue;

    if (t.startsWith("*** Delete File:") || t.startsWith("*** Delete File：")) {
      const path = t.split(/[:：]/).slice(1).join(":").trim();
      results.push({ path, kind: "delete", lines: [] });
      continue;
    }

    if (t.startsWith("*** Move File:") || t.startsWith("*** Move File：")) {
      const rest = t.split(/[:：]/).slice(1).join(":").trim();
      const arrow = rest.includes("->") ? "->" : rest.includes("→") ? "→" : null;
      if (arrow) {
        const [from, to] = rest.split(arrow).map((s) => s.trim());
        results.push({ path: from!, kind: "move", lines: [], moveTo: to });
      } else {
        results.push({ path: rest, kind: "move", lines: [] });
      }
      continue;
    }

    if (t.startsWith("*** Add File:") || t.startsWith("*** Add File：")) {
      const path = t.split(/[:：]/).slice(1).join(":").trim();
      let body = "";
      while (i < lines.length) {
        const peek = lines[i]!.trimStart();
        if (peek.startsWith("*** ")) break;
        const l = lines[i]!;
        i++;
        body += (l.startsWith("+") ? l.slice(1) : l) + "\n";
      }
      results.push({ path, kind: "add", lines: linesFromAddBody(body) });
      continue;
    }

    if (t.startsWith("*** Update File:") || t.startsWith("*** Update File：")) {
      const path = t.split(/[:：]/).slice(1).join(":").trim();
      const diffLines: DiffLine[] = [];
      while (i < lines.length) {
        const peek = lines[i]!.trimStart();
        if (peek.startsWith("*** ")) break;
        const l = lines[i]!;
        i++;
        if (l.startsWith("@@")) continue;
        if (l.startsWith("-")) diffLines.push({ type: "del", text: l.slice(1) });
        else if (l.startsWith("+")) diffLines.push({ type: "add", text: l.slice(1) });
        else if (l.startsWith(" ")) diffLines.push({ type: "ctx", text: l.slice(1) });
      }
      results.push({ path, kind: "update", lines: diffLines });
      continue;
    }
  }
  return results;
}

function parseApplyPatchArgs(args: Record<string, unknown>): PatchFileChange[] {
  const patch =
    (typeof args.patch === "string" && args.patch) ||
    (typeof args.content === "string" && args.content) ||
    "";
  if (!patch.trim()) return [];
  return parseBeginEndPatch(patch);
}

function parsePatchFileArgs(args: Record<string, unknown>): PatchFileChange[] {
  const path = String(args.path || args.file || "").trim();
  if (!path) return [];

  if (typeof args.diff === "string" && args.diff.trim()) {
    return [{ path, kind: "update", lines: linesFromUnifiedDiff(args.diff) }];
  }
  const oldText = typeof args.old_text === "string" ? args.old_text : "";
  const newText =
    typeof args.new_text === "string"
      ? args.new_text
      : typeof args.content === "string"
        ? args.content
        : "";
  if (oldText || newText) {
    return [{ path, kind: "update", lines: linesFromOldNew(oldText, newText) }];
  }
  return [];
}

function parseWriteFileArgs(args: Record<string, unknown>): PatchFileChange[] {
  const path = String(args.path || args.file || "").trim();
  if (!path) return [];
  const content = typeof args.content === "string" ? args.content : "";
  return [{ path, kind: "add", lines: linesFromAddBody(content) }];
}

function parseDeleteFileArgs(args: Record<string, unknown>): PatchFileChange[] {
  const path = String(args.path || args.file || "").trim();
  if (!path) return [];
  return [{ path, kind: "delete", lines: [] }];
}

/** Parse tool name + JSON input into structured file changes for diff UI. */
export function parseToolPatch(toolName: string, toolInput: string): PatchFileChange[] {
  const name = toolName.trim();
  const args = parseJsonArgs(toolInput.trim());
  if (!args) return [];

  switch (name) {
    case "apply_patch":
      return parseApplyPatchArgs(args);
    case "patch_file":
      return parsePatchFileArgs(args);
    case "write_file":
      return parseWriteFileArgs(args);
    case "delete_file":
      return parseDeleteFileArgs(args);
    default:
      return [];
  }
}

export function kindLabel(kind: PatchFileChange["kind"]): string {
  switch (kind) {
    case "add":
      return "新增";
    case "update":
      return "修改";
    case "delete":
      return "删除";
    case "move":
      return "移动";
  }
}
