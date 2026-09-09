<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import { FouButton } from "foucui";
import { useTerminalBg, xtermBackground } from "../composables/useTerminalBg";

const props = defineProps<{
  ptyId: string;
  workspaceRoot?: string | null;
  /** 嵌入底部停靠栏时隐藏自带标题栏 */
  embedded?: boolean;
}>();

const emit = defineEmits<{ close: []; ready: [] }>();

const host = ref<HTMLDivElement | null>(null);
const { terminalBg } = useTerminalBg();
const fontPx = 13;

let term: Terminal | null = null;
let fitAddon: FitAddon | null = null;
let unlisten: UnlistenFn | null = null;
let size: { rows: number; cols: number } | null = null;
let ro: ResizeObserver | null = null;
let disposed = false;

async function doClose() {
  try {
    await invoke("pty_close", { ptyId: props.ptyId });
  } catch {
    /* ignore */
  }
  emit("close");
}

onMounted(() => {
  if (!host.value) return;
  disposed = false;
  term = new Terminal({
    cursorBlink: true,
    allowTransparency: true,
    fontFamily: '"JetBrains Mono", "Fira Code", monospace',
    fontSize: fontPx,
    lineHeight: 1.0,
    theme: {
      background: xtermBackground(terminalBg.value),
      foreground: "#e6edf3",
      cursor: "#58a6ff",
      selectionBackground: "#264f78",
      black: "#0d1117",
      red: "#ff7b72",
      green: "#3fb950",
      yellow: "#d29922",
      blue: "#58a6ff",
      magenta: "#bc8cff",
      cyan: "#39c5cf",
      white: "#e6edf3",
      brightBlack: "#6e7681",
      brightRed: "#ffa198",
      brightGreen: "#56d364",
      brightYellow: "#e3b341",
      brightBlue: "#79c0ff",
      brightMagenta: "#d2a8ff",
      brightCyan: "#56d4dd",
      brightWhite: "#f0f6fc",
    },
  });
  fitAddon = new FitAddon();
  term.loadAddon(fitAddon);
  term.loadAddon(new WebLinksAddon());
  term.open(host.value);

  void listen<string>(`pty:${props.ptyId}`, (event) => {
    term?.write(event.payload);
  }).then((u) => {
    if (disposed) u();
    else unlisten = u;
  });

  term.onData((data) => {
    void invoke("pty_write", { ptyId: props.ptyId, data });
  });

  requestAnimationFrame(() => {
    fitAddon?.fit();
    if (!term) return;
    size = { rows: term.rows, cols: term.cols };
    void invoke("pty_open", {
      ptyId: props.ptyId,
      workspaceRoot: props.workspaceRoot?.trim() || null,
      rows: term.rows,
      cols: term.cols,
    })
      .then(() => emit("ready"))
      .catch((e) => term?.writeln(`\r\n\x1b[31mFailed to open terminal: ${e}\x1b[0m`));
  });

  ro = new ResizeObserver(() => {
    fitAddon?.fit();
    if (!term) return;
    if (size?.rows === term.rows && size?.cols === term.cols) return;
    size = { rows: term.rows, cols: term.cols };
    void invoke("pty_resize", { ptyId: props.ptyId, rows: term.rows, cols: term.cols });
  });
  ro.observe(host.value);
});

onUnmounted(() => {
  disposed = true;
  ro?.disconnect();
  ro = null;
  unlisten?.();
  unlisten = null;
  void invoke("pty_close", { ptyId: props.ptyId });
  term?.dispose();
  term = null;
  fitAddon = null;
});

watch(terminalBg, (bg) => {
  if (!term) return;
  term.options.theme = { ...term.options.theme, background: xtermBackground(bg) };
});
</script>

<template>
  <div class="terminal-panel" :class="{ embedded }" :data-terminal-bg="terminalBg">
    <div v-if="!embedded" class="terminal-panel-header">
      <span class="terminal-panel-title ui-font">终端</span>
      <span class="terminal-panel-hint ui-font">系统 Shell（工作目录内）</span>
      <FouButton icon="close-line" text native-type="button" aria-label="关闭" @click="doClose" />
    </div>
    <div ref="host" class="terminal-panel-body" />
  </div>
</template>
