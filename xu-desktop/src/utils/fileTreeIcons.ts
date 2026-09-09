/** Map file extension to Remix icon name for IDE-style file tree. */
export function fileTreeIcon(name: string, isDir: boolean, expanded = false): string {
  if (isDir) return expanded ? "folder-open-line" : "folder-line";
  const dot = name.lastIndexOf(".");
  const ext = dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
  const map: Record<string, string> = {
    vue: "vuejs-line",
    ts: "javascript-line",
    tsx: "javascript-line",
    js: "javascript-line",
    mjs: "javascript-line",
    jsx: "javascript-line",
    rs: "rust-line",
    md: "markdown-line",
    json: "braces-line",
    yaml: "file-code-line",
    yml: "file-code-line",
    css: "css3-line",
    scss: "css3-line",
    html: "html5-line",
    go: "go-line",
    py: "python-line",
    sql: "database-2-line",
    toml: "file-settings-line",
    lock: "lock-line",
    png: "image-line",
    jpg: "image-line",
    jpeg: "image-line",
    gif: "image-line",
    svg: "image-line",
    ico: "image-line",
  };
  return map[ext] ?? "file-line";
}
