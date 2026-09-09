/**
 * @file CodeMirrorEditor.vue CodeMirror 编辑器（高亮 / 诊断 / 悬停 / 跳转）
 * @author qiuye <yjk150@qq.com/>
 * @date 2026-08-31
 * @updated 2026-09-07
 * @version 1.2.0
 * @category Layout
 * @algo codemirror6-ts-hover-goto
 */
<script setup lang="ts">
import { css } from "@codemirror/lang-css";
import { cpp } from "@codemirror/lang-cpp";
import { go } from "@codemirror/lang-go";
import { html } from "@codemirror/lang-html";
import { java } from "@codemirror/lang-java";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { python } from "@codemirror/lang-python";
import { rust } from "@codemirror/lang-rust";
import { sql } from "@codemirror/lang-sql";
import { vue } from "@codemirror/lang-vue";
import { yaml } from "@codemirror/lang-yaml";
import {
  defaultHighlightStyle,
  syntaxHighlighting,
} from "@codemirror/language";
import { linter, type Diagnostic } from "@codemirror/lint";
import { EditorState, Compartment, Prec, type Extension } from "@codemirror/state";
import {
  EditorView,
  lineNumbers,
  highlightActiveLineGutter,
  highlightActiveLine,
  hoverTooltip,
  keymap,
} from "@codemirror/view";
import "../../styles/codemirror-lint.css";
import { onMounted, onUnmounted, ref, shallowRef, watch } from "vue";
import type { LintDiagnostic } from "../../utils/workspaceLint";
import {
  formatQuickInfo,
  isTsJsPath,
  tsDefinition,
  tsQuickInfo,
  type TsLocation,
} from "../../utils/tsLanguageService";

const props = defineProps<{
  modelValue: string;
  filename?: string;
  /** 工作区内绝对路径，用于 tsserver */
  filePath?: string | null;
  workingDir?: string | null;
  diagnostics?: LintDiagnostic[];
  readonly?: boolean;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: string];
  cursor: [line: number, column: number];
  "goto-definition": [loc: TsLocation];
}>();

const hostRef = ref<HTMLDivElement | null>(null);
const viewRef = shallowRef<EditorView | null>(null);
const syncing = ref(false);
const dynamicCompartment = new Compartment();

function languageExt(name: string): Extension {
  const lower = name.toLowerCase();
  if (lower.endsWith(".vue")) return vue();
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) return markdown();
  if (lower.endsWith(".py") || lower.endsWith(".pyw")) return python();
  if (lower.endsWith(".rs")) return rust();
  if (lower.endsWith(".go")) return go();
  if (lower.endsWith(".java")) return java();
  if (
    lower.endsWith(".c") ||
    lower.endsWith(".h") ||
    lower.endsWith(".cc") ||
    lower.endsWith(".cpp") ||
    lower.endsWith(".cxx") ||
    lower.endsWith(".hpp") ||
    lower.endsWith(".hxx")
  ) {
    return cpp();
  }
  if (lower.endsWith(".sql")) return sql();
  if (lower.endsWith(".yml") || lower.endsWith(".yaml")) {
    return yaml();
  }
  if (lower.endsWith(".json") || lower.endsWith(".jsonc")) return json();
  if (lower.endsWith(".css") || lower.endsWith(".scss") || lower.endsWith(".less")) return css();
  if (lower.endsWith(".html") || lower.endsWith(".htm") || lower.endsWith(".xml")) return html();
  const ts = lower.endsWith(".ts") || lower.endsWith(".tsx") || lower.endsWith(".mts") || lower.endsWith(".cts");
  const jsx = lower.endsWith(".jsx") || lower.endsWith(".tsx");
  if (
    lower.endsWith(".js") ||
    lower.endsWith(".mjs") ||
    lower.endsWith(".cjs") ||
    ts ||
    jsx
  ) {
    return javascript({ typescript: ts, jsx });
  }
  return javascript();
}

function toCmDiagnostics(view: EditorView, items: LintDiagnostic[]): Diagnostic[] {
  const doc = view.state.doc;
  return items.map((d) => {
    const line = Math.min(Math.max(1, d.line), doc.lines);
    const endLine = Math.min(Math.max(line, d.endLine), doc.lines);
    const lineStart = doc.line(line).from;
    const endLineStart = doc.line(endLine).from;
    const from = lineStart + Math.max(0, d.column - 1);
    const to = endLineStart + Math.max(0, d.endColumn - 1);
    const src = d.source ? `[${d.source}] ` : "";
    return {
      from: Math.min(from, doc.length),
      to: Math.min(Math.max(to, from + 1), doc.length),
      severity: d.severity === "error" ? "error" : "warning",
      message: d.ruleId ? `${src}${d.message} (${d.ruleId})` : `${src}${d.message}`,
    };
  });
}

function canUseTs(): boolean {
  const ws = props.workingDir?.trim();
  const path = props.filePath?.trim() || props.filename || "";
  return Boolean(ws && path && isTsJsPath(path));
}

function posLineCol(view: EditorView, pos: number): { line: number; column: number } {
  const line = view.state.doc.lineAt(pos);
  return { line: line.number, column: pos - line.from + 1 };
}

async function requestGotoDef(view: EditorView) {
  if (!canUseTs()) return;
  const ws = props.workingDir!.trim();
  const path = (props.filePath || props.filename || "").trim();
  const head = view.state.selection.main.head;
  const { line, column } = posLineCol(view, head);
  try {
    const loc = await tsDefinition(ws, path, view.state.doc.toString(), line, column);
    if (loc) emit("goto-definition", loc);
  } catch {
    /* 无 typescript 时静默 */
  }
}

function buildDynamicExtensions(): Extension[] {
  const diags = props.diagnostics ?? [];
  const exts: Extension[] = [
    languageExt(props.filename ?? props.filePath ?? ""),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    linter((view) => toCmDiagnostics(view, diags)),
    EditorState.readOnly.of(Boolean(props.readonly)),
  ];

  if (canUseTs()) {
    exts.push(
      hoverTooltip(async (view, pos) => {
        const ws = props.workingDir!.trim();
        const path = (props.filePath || props.filename || "").trim();
        const { line, column } = posLineCol(view, pos);
        try {
          const info = await tsQuickInfo(ws, path, view.state.doc.toString(), line, column);
          if (!info) return null;
          const text = formatQuickInfo(info);
          if (!text) return null;
          return {
            pos,
            end: pos,
            above: true,
            create() {
              const dom = document.createElement("div");
              dom.className = "cm-ts-hover ui-font";
              dom.textContent = text;
              return { dom };
            },
          };
        } catch {
          return null;
        }
      }, { hoverTime: 400 }),
      Prec.high(
        keymap.of([
          {
            key: "F12",
            run: (view) => {
              void requestGotoDef(view);
              return true;
            },
          },
          {
            key: "Mod-Click",
            run: () => false,
          },
        ]),
      ),
      EditorView.domEventHandlers({
        click(event, view) {
          if (!(event.ctrlKey || event.metaKey)) return false;
          void requestGotoDef(view);
          return true;
        },
      }),
    );
  }

  return exts;
}

function buildExtensions(): Extension[] {
  return [
    lineNumbers(),
    highlightActiveLineGutter(),
    highlightActiveLine(),
    dynamicCompartment.of(buildDynamicExtensions()),
    EditorView.lineWrapping,
    EditorView.theme({
      "&": {
        height: "100%",
        fontSize: "12px",
        fontFamily: "var(--font-mono, ui-monospace, monospace)",
        backgroundColor: "var(--canvas)",
        color: "var(--body)",
      },
      ".cm-scroller": { overflow: "auto" },
      ".cm-gutters": {
        backgroundColor: "var(--surface-soft)",
        color: "var(--muted)",
        borderRight: "1px solid var(--hairline)",
      },
      ".cm-activeLineGutter": { backgroundColor: "var(--primary-glow)" },
      ".cm-activeLine": { backgroundColor: "color-mix(in srgb, var(--primary) 6%, transparent)" },
      "&.cm-focused": { outline: "none" },
      ".cm-content": { caretColor: "var(--primary)" },
      ".cm-tooltip": {
        backgroundColor: "var(--surface, #fff)",
        border: "1px solid var(--hairline)",
        borderRadius: "6px",
        color: "var(--body)",
        maxWidth: "420px",
      },
      ".cm-ts-hover": {
        padding: "8px 10px",
        fontSize: "12px",
        whiteSpace: "pre-wrap",
        lineHeight: "1.4",
      },
    }),
    EditorView.updateListener.of((update) => {
      if (update.docChanged && !syncing.value) {
        emit("update:modelValue", update.state.doc.toString());
      }
      if (update.selectionSet || update.docChanged) {
        const head = update.state.selection.main.head;
        const line = update.state.doc.lineAt(head);
        emit("cursor", line.number, head - line.from + 1);
      }
    }),
  ];
}

function mountEditor() {
  if (!hostRef.value) return;
  viewRef.value?.destroy();
  const state = EditorState.create({
    doc: props.modelValue,
    extensions: buildExtensions(),
  });
  viewRef.value = new EditorView({ state, parent: hostRef.value });
}

function syncDoc(text: string) {
  const view = viewRef.value;
  if (!view) return;
  if (view.state.doc.toString() === text) return;
  syncing.value = true;
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: text },
  });
  syncing.value = false;
}

function reconfigure() {
  const view = viewRef.value;
  if (!view) return;
  view.dispatch({
    effects: dynamicCompartment.reconfigure(buildDynamicExtensions()),
  });
}

function goToLine(line: number, column = 1) {
  const view = viewRef.value;
  if (!view) return;
  const ln = Math.min(Math.max(1, line), view.state.doc.lines);
  const pos = view.state.doc.line(ln).from + Math.max(0, column - 1);
  view.dispatch({
    selection: { anchor: pos },
    effects: EditorView.scrollIntoView(pos, { y: "center" }),
  });
  view.focus();
}

defineExpose({ goToLine });

watch(
  () => props.modelValue,
  (text) => syncDoc(text),
);

watch(
  () =>
    [props.diagnostics, props.filename, props.filePath, props.workingDir, props.readonly] as const,
  () => reconfigure(),
  { deep: true },
);

onMounted(() => mountEditor());
onUnmounted(() => {
  viewRef.value?.destroy();
  viewRef.value = null;
});
</script>

<template>
  <div ref="hostRef" class="cm-host" />
</template>

<style scoped>
.cm-host {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
.cm-host :deep(.cm-editor) {
  height: 100%;
}
</style>
