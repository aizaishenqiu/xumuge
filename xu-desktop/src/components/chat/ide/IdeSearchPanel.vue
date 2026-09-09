<script setup lang="ts">
/**
 * @file IdeSearchPanel.vue IDE 工作区搜索与替换
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-31
 * @updated 2026-09-07
 * @version 1.1.0
 * @category Layout
 * @algo workspace-grep-replace
 */
import { FouButton, FouInput, FouDialog, fouMsg, fouAlert } from "foucui";
import { invoke } from "@tauri-apps/api/core";
import { computed, ref } from "vue";
import { onApiCatch, toUserError } from "../../../utils/userFacingError";
import { readTextFile, writeTextUnderWorkspace } from "../../../utils/fsBridge";

const props = defineProps<{
  workingDir: string | null;
}>();

const emit = defineEmits<{
  "open-file": [path: string, line?: number];
}>();

const query = ref("");
const replaceWith = ref("");
const searching = ref(false);
const replacing = ref(false);
const results = ref<{ path: string; line: number; text: string }[]>([]);
const confirmOpen = ref(false);

const uniqueFiles = computed(() => {
  const set = new Set(results.value.map((r) => r.path.replace(/\\/g, "/").toLowerCase()));
  return set.size;
});

function parseGrepOutput(raw: string, workspace: string): { path: string; line: number; text: string }[] {
  const ws = workspace.replace(/\\/g, "/").replace(/\/$/, "");
  const out: { path: string; line: number; text: string }[] = [];
  for (const row of raw.split(/\r?\n/)) {
    if (!row.trim()) continue;
    const m = row.match(/^(.+?):(\d+):(.*)$/);
    if (!m) continue;
    let p = m[1]!;
    if (!/^[A-Za-z]:/.test(p) && !p.startsWith("/")) {
      p = `${ws}/${p.replace(/^\.\//, "")}`;
    }
    out.push({ path: p.replace(/\//g, "\\"), line: Number(m[2]), text: m[3] ?? "" });
  }
  return out;
}

function toWorkspaceRel(absPath: string, workspace: string): string {
  const abs = absPath.replace(/\\/g, "/");
  const ws = workspace.replace(/\\/g, "/").replace(/\/+$/, "");
  if (abs.toLowerCase().startsWith(ws.toLowerCase() + "/")) {
    return abs.slice(ws.length + 1);
  }
  if (abs.toLowerCase() === ws.toLowerCase()) return "";
  return abs;
}

async function runSearch() {
  const ws = props.workingDir?.trim();
  const q = query.value.trim();
  if (!ws) {
    void fouAlert("请先选择工作目录", "提示");
    return;
  }
  if (!q) {
    void fouAlert("请输入搜索内容", "提示");
    return;
  }
  searching.value = true;
  try {
    const raw = await invoke<string>("grep_workspace", {
      workspace: ws,
      pattern: q,
      maxHits: 80,
    });
    results.value = parseGrepOutput(raw, ws);
    if (!results.value.length) fouMsg.info("未找到匹配");
  } catch (e) {
    void onApiCatch(e);
    results.value = [];
  } finally {
    searching.value = false;
  }
}

function openHit(hit: { path: string; line: number }) {
  emit("open-file", hit.path, hit.line);
}

function askReplaceAll() {
  if (!query.value.trim()) {
    void fouAlert("请先输入要查找的内容。", "替换");
    return;
  }
  if (!results.value.length) {
    void fouAlert("请先搜索出结果，再全部替换。", "替换");
    return;
  }
  confirmOpen.value = true;
}

async function confirmReplaceAll() {
  const ws = props.workingDir?.trim();
  const q = query.value;
  if (!ws || !q) {
    confirmOpen.value = false;
    return;
  }
  replacing.value = true;
  confirmOpen.value = false;
  const files = [...new Set(results.value.map((r) => r.path))];
  let fileOk = 0;
  let totalRepl = 0;
  try {
    for (const abs of files) {
      const rel = toWorkspaceRel(abs, ws);
      if (!rel) continue;
      let text: string;
      try {
        text = await readTextFile(abs);
      } catch (e) {
        void fouAlert(toUserError(e), "读取失败");
        continue;
      }
      if (!text.includes(q)) continue;
      const parts = text.split(q);
      const count = parts.length - 1;
      if (count <= 0) continue;
      const next = parts.join(replaceWith.value);
      await writeTextUnderWorkspace(ws, rel, next);
      fileOk += 1;
      totalRepl += count;
    }
    fouMsg.info(`已在 ${fileOk} 个文件中替换 ${totalRepl} 处`);
    await runSearch();
  } catch (e) {
    void fouAlert(toUserError(e), "替换失败");
  } finally {
    replacing.value = false;
  }
}
</script>

<template>
  <div class="ide-search-panel ui-font">
    <header class="panel-head">
      <span class="panel-title">搜索</span>
    </header>
    <div class="search-row">
      <FouInput
        v-model="query"
        placeholder="在工作区搜索…"
        @keydown.enter="runSearch"
      />
      <FouButton
        icon="search-line"
        size="small"
        native-type="button"
        :loading="searching"
        title="搜索"
        aria-label="搜索"
        @click="runSearch"
      >
        搜索
      </FouButton>
    </div>
    <div class="search-row">
      <FouInput
        v-model="replaceWith"
        placeholder="替换为…"
        @keydown.enter="askReplaceAll"
      />
      <FouButton
        icon="arrow-left-right-line"
        size="small"
        native-type="button"
        :loading="replacing"
        :disabled="!results.length"
        title="全部替换"
        aria-label="全部替换"
        @click="askReplaceAll"
      >
        全部替换
      </FouButton>
    </div>
    <ul v-if="results.length" class="hit-list">
      <li
        v-for="(hit, i) in results"
        :key="`${hit.path}-${hit.line}-${i}`"
        class="hit-row"
        @click="openHit(hit)"
      >
        <span class="hit-path">{{ hit.path.split(/[/\\]/).pop() }}:{{ hit.line }}</span>
        <span class="hit-text">{{ hit.text.trim() }}</span>
      </li>
    </ul>
    <p v-else class="panel-empty muted">输入关键词搜索；可再填替换内容后「全部替换」</p>

    <FouDialog v-model="confirmOpen" title="全部替换" width="420px" append-to-body>
      <p class="repl-msg ui-font">
        将在当前搜索命中的约 {{ uniqueFiles }} 个文件中，把「{{ query }}」全部替换为「{{ replaceWith || "（空）" }}」。此操作会直接改盘，请确认。
      </p>
      <template #footer>
        <FouButton icon="close-line" size="small" native-type="button" @click="confirmOpen = false">取消</FouButton>
        <FouButton
          icon="arrow-left-right-line"
          type="primary"
          size="small"
          native-type="button"
          :loading="replacing"
          @click="confirmReplaceAll"
        >
          替换
        </FouButton>
      </template>
    </FouDialog>
  </div>
</template>

<style scoped>
.ide-search-panel {
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
.search-row {
  display: flex;
  gap: 6px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--hairline);
}
.hit-list {
  list-style: none;
  margin: 0;
  padding: 4px 0;
  overflow: auto;
  flex: 1;
}
.hit-row {
  padding: 6px 12px;
  cursor: pointer;
  border-bottom: 1px solid var(--hairline);
}
.hit-row:hover {
  background: var(--primary-glow);
}
.hit-path {
  display: block;
  font-size: 11px;
  font-family: var(--font-mono);
  color: var(--primary);
}
.hit-text {
  display: block;
  font-size: 12px;
  color: var(--body);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.panel-empty {
  padding: 16px 12px;
  font-size: 12px;
}
.repl-msg {
  margin: 0;
  font-size: 14px;
  line-height: 1.5;
}
</style>
