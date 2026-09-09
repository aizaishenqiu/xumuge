/**
 * @file ChatMarkdown.vue 对话 Markdown（代码块复制 + 工作区路径点开 IDE）
 * @author qiuye <yjk150@qq.com/>
 * @date 2026-08-31
 * @updated 2026-09-08
 * @version 1.2.0
 * @category UI
 * @algo marked-codespan-ws-path
 */
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { marked } from "marked";
import { fouAlert } from "foucui";
import { highlightCode } from "../../utils/codeHighlight";
import { emitOpenInEditor } from "../../utils/crossWindowBus";
import { readTextFile } from "../../utils/fsBridge";
import { focusIdeWindow, isIdeWindow } from "../../utils/windowManager";

const props = defineProps<{ content: string; workingDir?: string | null }>();

const rootEl = ref<HTMLElement | null>(null);

marked.setOptions({
  gfm: true,
  breaks: true,
});

const COPY_ICON = `<svg class="md-copy-icon" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M7 6V3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-3v3c0 .552-.45 1-1.007 1H4.007A1 1 0 0 1 3 21l.003-14c0-.552.45-1 1.007-1H7zm2 0h8v10h2V4H9v2zm-2 5v10h8V11H7z"/></svg>`;
const CHECK_ICON = `<svg class="md-copy-icon" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M9.9997 15.1709l8.4853-8.4852 1.4142 1.4142-9.8995 9.8995-5.6568-5.6568 1.4142-1.4142 4.2426 4.2425z"/></svg>`;

function escapeAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Duty: 行内 code 是否像可打开的工作区/交付物路径。 */
function looksLikeWorkspacePath(raw: string): boolean {
  const t = (raw || "").trim();
  if (t.length < 4 || t.length > 260) return false;
  if (/\s/.test(t)) return false;
  if (/^(https?:|mailto:|data:|#)/i.test(t)) return false;
  if (/^(npm|pnpm|yarn|git|cd|ls|dir)\b/i.test(t)) return false;
  const hasSlash = /[\\/]/.test(t);
  const hasExt =
    /\.(md|markdown|txt|json|jsonl|docx|xlsx|pptx|csv|vue|ts|tsx|js|jsx|mjs|cjs|rs|py|go|java|css|scss|html|yml|yaml|toml|sql|log)$/i.test(
      t,
    );
  if (!hasExt && !hasSlash) return false;
  if (hasExt) return true;
  return /^(?:\.\/|\.?xu\/|deliverables\/|docs\/|src\/|templates\/)/i.test(t);
}

function resolveAbsPath(relOrAbs: string): string {
  const ws = (props.workingDir || "").trim();
  let p = relOrAbs.trim().replace(/^\.\//, "").replace(/\\/g, "/");
  // 模型偶发：.xu/deliverables、xu/deliverables、xu-deliverables → deliverables/
  if (/^\.?xu[-/]deliverables\//i.test(p)) {
    p = p.replace(/^\.?xu[-/]/i, "");
  }
  // 偶发把 .md 写成 .kd
  if (/\.kd$/i.test(p) && /deliverables\//i.test(p)) {
    p = p.replace(/\.kd$/i, ".md");
  }
  const norm = p.replace(/\//g, "\\");
  if (/^[A-Za-z]:[\\/]/.test(norm)) return norm;
  if (!ws) return norm;
  return `${ws.replace(/[\\/]+$/, "")}\\${norm}`;
}

/** Duty: 生成可尝试打开的绝对路径候选（别名 / 常见笔误）。 */
function buildAbsCandidates(relOrAbs: string): string[] {
  const raw = relOrAbs.trim().replace(/\\/g, "/");
  const variants = new Set<string>([raw]);
  const stripDeliv = raw
    .replace(/^\.?xu[-/]deliverables\//i, "deliverables/")
    .replace(/^\.?xu\/deliverables\//i, "deliverables/");
  variants.add(stripDeliv);
  if (/\.kd$/i.test(stripDeliv)) variants.add(stripDeliv.replace(/\.kd$/i, ".md"));
  if (/deliverables\/ceo\//i.test(stripDeliv)) {
    variants.add(stripDeliv.replace(/deliverables\/ceo\//i, "deliverables/copy/"));
  }
  if (/deliverables\/copy\//i.test(stripDeliv)) {
    variants.add(stripDeliv.replace(/deliverables\/copy\//i, "deliverables/ceo/"));
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of variants) {
    const abs = resolveAbsPath(v);
    const key = abs.replace(/\\/g, "/").toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(abs);
  }
  return out;
}

/** Duty: 用 Rust read_text_file 探测存在（绕过 plugin-fs ACL）。 */
async function fileExistsAbs(abs: string): Promise<{ ok: boolean; err?: string }> {
  try {
    await readTextFile(abs);
    return { ok: true };
  } catch (e) {
    return { ok: false, err: String(e instanceof Error ? e.message : e).slice(0, 160) };
  }
}

const html = computed(() => {
  const src = props.content || "";
  try {
    const renderer = new marked.Renderer();
    renderer.code = ({ text, lang }: { text: string; lang?: string }) => {
      const language = (lang || "").trim().split(/\s+/)[0] || "";
      const highlighted = highlightCode(text, language || undefined);
      const cls = language ? `hljs language-${language}` : "hljs";
      const langLabel = language
        ? `<span class="md-code-lang">${escapeAttr(language)}</span>`
        : `<span class="md-code-lang">code</span>`;
      return `<div class="md-code-wrap"><div class="md-code-bar">${langLabel}<button type="button" class="md-code-copy" aria-label="复制代码">${COPY_ICON}<span class="md-copy-label">复制</span></button></div><pre class="md-code"><code class="${cls}">${highlighted}</code></pre></div>`;
    };
    renderer.codespan = (tok: { text?: string } | string) => {
      const text = typeof tok === "string" ? tok : String(tok?.text ?? "");
      if (looksLikeWorkspacePath(text)) {
        return `<a href="#" class="md-ws-path" data-ws-path="${escapeAttr(text)}" title="在 IDE 中打开">${escapeHtml(text)}</a>`;
      }
      return `<code>${escapeHtml(text)}</code>`;
    };
    return marked.parse(src, { renderer }) as string;
  } catch {
    return src
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\n/g, "<br/>");
  }
});

async function openWorkspacePath(rel: string) {
  const candidates = buildAbsCandidates(rel);
  let abs: string | null = null;
  for (const c of candidates) {
    const probe = await fileExistsAbs(c);
    if (probe.ok) {
      abs = c;
      break;
    }
  }
  if (!(props.workingDir || "").trim() && !candidates.some((c) => /^[A-Za-z]:[\\/]/.test(c))) {
    void fouAlert("请先选择工作区，再打开交付物路径。", "打开文件");
    return;
  }
  if (!abs) {
    const hint = candidates[0] || rel;
    void fouAlert(
      `工作区中找不到该文件：\n${hint}\n\n可能助手尚未真正写入磁盘。请让其保存成稿后再打开。`,
      "无法打开",
    );
    return;
  }
  try {
    emitOpenInEditor({ path: abs });
    if (!isIdeWindow()) {
      // 无 path：避免 focusIdeWindow 再次 emit 与本窗监听形成风暴
      await focusIdeWindow();
    }
  } catch (e) {
    void fouAlert(String(e instanceof Error ? e.message : e), "打开文件失败");
  }
}

async function onRootClick(e: MouseEvent) {
  const t = e.target as HTMLElement | null;
  if (!t || !rootEl.value?.contains(t)) return;

  const pathEl = t.closest?.("a.md-ws-path") as HTMLAnchorElement | null;
  if (pathEl && rootEl.value.contains(pathEl)) {
    e.preventDefault();
    e.stopPropagation();
    const rel = pathEl.getAttribute("data-ws-path") || pathEl.textContent || "";
    if (rel.trim()) await openWorkspacePath(rel.trim());
    return;
  }

  const btn = t.closest?.(".md-code-copy") as HTMLButtonElement | null;
  if (!btn || !rootEl.value.contains(btn)) return;
  e.preventDefault();
  e.stopPropagation();
  const wrap = btn.closest(".md-code-wrap");
  const code = wrap?.querySelector("pre.md-code code");
  const text = code?.textContent ?? "";
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    return;
  }
  const label = btn.querySelector(".md-copy-label");
  btn.classList.add("is-copied");
  btn.setAttribute("aria-label", "已复制");
  if (label) label.textContent = "已复制";
  btn.innerHTML = `${CHECK_ICON}<span class="md-copy-label">已复制</span>`;
  window.setTimeout(() => {
    if (!btn.isConnected) return;
    btn.classList.remove("is-copied");
    btn.setAttribute("aria-label", "复制代码");
    btn.innerHTML = `${COPY_ICON}<span class="md-copy-label">复制</span>`;
  }, 1600);
}

onMounted(() => {
  rootEl.value?.addEventListener("click", onRootClick);
});

onBeforeUnmount(() => {
  rootEl.value?.removeEventListener("click", onRootClick);
});
</script>

<template>
  <div ref="rootEl" class="chat-md" v-html="html" />
</template>

<style scoped>
.chat-md {
  font-size: 14px;
  line-height: 1.55;
  word-break: break-word;
}
.chat-md :deep(p) {
  margin: 0 0 0.6em;
}
.chat-md :deep(p:last-child) {
  margin-bottom: 0;
}
.chat-md :deep(ul),
.chat-md :deep(ol) {
  margin: 0.4em 0;
  padding-left: 1.35em;
}
.chat-md :deep(.md-code-wrap) {
  margin: 0.55em 0;
  border-radius: 8px;
  overflow: hidden;
  background: #0f172a;
}
.chat-md :deep(.md-code-bar) {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 10px;
  background: #1e293b;
  border-bottom: 1px solid rgba(148, 163, 184, 0.2);
}
.chat-md :deep(.md-code-lang) {
  font-size: 11px;
  color: #94a3b8;
  font-family: var(--font-mono, ui-monospace, Menlo, Consolas, monospace);
  text-transform: lowercase;
}
.chat-md :deep(.md-code-copy) {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin: 0;
  padding: 3px 8px;
  border: 1px solid rgba(148, 163, 184, 0.35);
  border-radius: 6px;
  background: transparent;
  color: #cbd5e1;
  font-size: 11px;
  line-height: 1;
  cursor: pointer;
}
.chat-md :deep(.md-code-copy:hover) {
  background: rgba(148, 163, 184, 0.15);
  color: #f8fafc;
}
.chat-md :deep(.md-code-copy.is-copied) {
  border-color: #4ade80;
  color: #86efac;
}
.chat-md :deep(.md-copy-icon) {
  display: block;
  flex-shrink: 0;
}
.chat-md {
  user-select: text;
  -webkit-user-select: text;
}
.chat-md :deep(pre.md-code) {
  margin: 0;
  padding: 10px 12px;
  overflow-x: auto;
  background: transparent;
  font-size: 12.5px;
  line-height: 1.45;
}
.chat-md :deep(pre.md-code code) {
  background: transparent;
  color: #e2e8f0;
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
  white-space: pre;
}
.chat-md :deep(:not(pre) > code) {
  padding: 0.1em 0.35em;
  border-radius: 4px;
  background: rgba(15, 23, 42, 0.08);
  font-size: 0.92em;
  font-family: var(--font-mono, ui-monospace, Menlo, Consolas, monospace);
}
.chat-md :deep(a.md-ws-path) {
  color: #2563eb;
  text-decoration: underline;
  text-underline-offset: 2px;
  cursor: pointer;
  font-family: var(--font-mono, ui-monospace, Menlo, Consolas, monospace);
  font-size: 0.92em;
  word-break: break-all;
}
.chat-md :deep(a.md-ws-path:hover) {
  color: #1d4ed8;
}
.chat-md :deep(a) {
  color: #2563eb;
}
.chat-md :deep(blockquote) {
  margin: 0.5em 0;
  padding-left: 0.75em;
  border-left: 3px solid #cbd5e1;
  color: #64748b;
}
</style>
