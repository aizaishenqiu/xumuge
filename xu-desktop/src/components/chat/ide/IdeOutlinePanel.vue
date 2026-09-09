<script setup lang="ts">
import { computed } from "vue";

export type OutlineSymbol = {
  name: string;
  kind: string;
  line: number;
};

const props = defineProps<{
  content: string;
  filename: string;
}>();

const emit = defineEmits<{
  "goto-line": [line: number];
}>();

function parseSymbols(text: string, filename: string): OutlineSymbol[] {
  const lower = filename.toLowerCase();
  const supported =
    lower.endsWith(".ts") ||
    lower.endsWith(".tsx") ||
    lower.endsWith(".js") ||
    lower.endsWith(".jsx") ||
    lower.endsWith(".vue") ||
    lower.endsWith(".mjs") ||
    lower.endsWith(".cjs");
  if (!supported) return [];

  const lines = text.split(/\r?\n/);
  const out: OutlineSymbol[] = [];
  const patterns: { re: RegExp; kind: string }[] = [
    { re: /^\s*(?:export\s+)?(?:async\s+)?function\s+(\w+)/, kind: "function" },
    { re: /^\s*(?:export\s+)?class\s+(\w+)/, kind: "class" },
    { re: /^\s*(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\(/, kind: "function" },
    { re: /^\s*(?:export\s+)?interface\s+(\w+)/, kind: "interface" },
    { re: /^\s*(?:export\s+)?type\s+(\w+)/, kind: "type" },
  ];
  lines.forEach((line, idx) => {
    for (const { re, kind } of patterns) {
      const m = line.match(re);
      if (m?.[1]) {
        out.push({ name: m[1], kind, line: idx + 1 });
        break;
      }
    }
  });
  return out;
}

const symbols = computed(() => parseSymbols(props.content, props.filename));

function kindIcon(kind: string): string {
  if (kind === "class") return "code-s-slash-line";
  if (kind === "interface" || kind === "type") return "braces-line";
  return "function-line";
}
</script>

<template>
  <div class="ide-outline-panel ui-font">
    <header class="panel-head">
      <span class="panel-title">大纲</span>
    </header>
    <ul v-if="symbols.length" class="symbol-list">
      <li
        v-for="sym in symbols"
        :key="`${sym.kind}-${sym.name}-${sym.line}`"
        class="symbol-row"
        @click="emit('goto-line', sym.line)"
      >
        <FouIcon :icon="kindIcon(sym.kind)" size="14" />
        <span class="sym-name">{{ sym.name }}</span>
        <span class="sym-line">:{{ sym.line }}</span>
      </li>
    </ul>
    <p v-else class="panel-empty muted">当前文件暂无符号大纲（仅支持 TS/JS/Vue）</p>
  </div>
</template>

<style scoped>
.ide-outline-panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
}
.panel-head {
  padding: 10px 12px 6px;
  border-bottom: 1px solid var(--hairline);
}
.panel-title {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--muted);
}
.symbol-list {
  list-style: none;
  margin: 0;
  padding: 4px 0;
  overflow: auto;
  flex: 1;
}
.symbol-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 12px;
  cursor: pointer;
  font-size: 12px;
}
.symbol-row:hover {
  background: var(--primary-glow);
}
.sym-name {
  flex: 1;
  font-family: var(--font-mono);
}
.sym-line {
  color: var(--muted);
  font-size: 11px;
}
.panel-empty {
  padding: 16px 12px;
  font-size: 12px;
}
.muted {
  color: var(--muted);
}
</style>
