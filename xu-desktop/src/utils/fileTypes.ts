/** Whether a file path is Markdown (preview/edit tabs apply). */
export function isMarkdownPath(path: string | null | undefined): boolean {
  if (!path) return false;
  const lower = path.toLowerCase();
  return lower.endsWith(".md") || lower.endsWith(".markdown");
}

export function defaultEditorTabForPath(path: string | null | undefined): "preview" | "edit" {
  return isMarkdownPath(path) ? "preview" : "edit";
}

/** VS Code–style language label for status bar. */
export function languageLabelForPath(path: string | null | undefined): string {
  if (!path) return "纯文本";
  const name = path.replace(/^.*[/\\]/, "").toLowerCase();
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".")) : "";
  const map: Record<string, string> = {
    ".ts": "TypeScript",
    ".tsx": "TypeScript React",
    ".mts": "TypeScript",
    ".cts": "TypeScript",
    ".js": "JavaScript",
    ".jsx": "JavaScript React",
    ".mjs": "JavaScript",
    ".cjs": "JavaScript",
    ".vue": "Vue",
    ".py": "Python",
    ".rs": "Rust",
    ".json": "JSON",
    ".jsonc": "JSON with Comments",
    ".css": "CSS",
    ".scss": "SCSS",
    ".less": "Less",
    ".html": "HTML",
    ".htm": "HTML",
    ".md": "Markdown",
    ".markdown": "Markdown",
    ".toml": "TOML",
    ".yaml": "YAML",
    ".yml": "YAML",
    ".xml": "XML",
    ".svg": "SVG",
    ".sh": "Shell Script",
    ".ps1": "PowerShell",
    ".bat": "Batch",
    ".cmd": "Batch",
    ".sql": "SQL",
    ".go": "Go",
    ".java": "Java",
    ".kt": "Kotlin",
    ".c": "C",
    ".h": "C",
    ".cpp": "C++",
    ".hpp": "C++",
    ".cs": "C#",
    ".php": "PHP",
    ".rb": "Ruby",
    ".swift": "Swift",
  };
  if (name === "dockerfile" || name.startsWith("dockerfile.")) return "Dockerfile";
  if (name === "makefile" || name === "gnumakefile") return "Makefile";
  return map[ext] || (ext ? ext.slice(1).toUpperCase() : "纯文本");
}

export type EolKind = "LF" | "CRLF" | "CR";

export function detectEol(text: string): EolKind {
  if (text.includes("\r\n")) return "CRLF";
  if (text.includes("\r")) return "CR";
  return "LF";
}
