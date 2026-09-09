<script setup lang="ts">
import { onApiCatch } from "../../utils/userFacingError";
import { FouButton, fouMsg, fouAlert } from "foucui";
import { invoke } from "@tauri-apps/api/core";
import { undoAgentWorkspace } from "../../utils/agentPrefs";
import { readIdeCliOverride } from "../../utils/ideCli";

import type { PatchFileChange } from "../../utils/patchDiff";

export type ChangedFileKind = "add" | "update" | "delete";

export type ChangedFileEntry = {
  path: string;
  kind: ChangedFileKind;
  changes?: PatchFileChange[];
};

const props = defineProps<{
  files: ChangedFileEntry[];
  workingDir?: string | null;
}>();

const emit = defineEmits<{
  preview: [path: string];
}>();

function basename(p: string): string {
  const parts = p.replace(/\//g, "\\").split("\\");
  return parts[parts.length - 1] || p;
}

function kindIcon(kind: ChangedFileKind): string {
  if (kind === "add") return "file-add-line";
  if (kind === "delete") return "delete-bin-line";
  return "file-edit-line";
}

function resolveAbsPath(relOrAbs: string): string {
  const ws = props.workingDir?.trim() || "";
  if (!ws) return relOrAbs;
  const p = relOrAbs.replace(/\//g, "\\");
  if (/^[A-Za-z]:[\\/]/.test(p)) return p;
  return `${ws.replace(/\\+$/, "")}\\${p}`;
}

async function openInIde(path: string) {
  const abs = resolveAbsPath(path);
  const editor = readIdeCliOverride() || "cursor";
  try {
    await invoke("open_with_editor", { path: abs, editor });
  } catch (e) {
    void onApiCatch(e);
  }
}

async function undoBatch() {
  const ws = props.workingDir?.trim();
  if (!ws) {
    void fouAlert("请先选择工作目录", "提示");
    return;
  }
  try {
    const msg = await undoAgentWorkspace(ws);
    fouMsg.success(msg || "已撤销本批改动");
  } catch (e) {
    void onApiCatch(e);
  }
}
</script>

<template>
  <div v-if="files.length" class="changed-files-strip">
    <div class="strip-head ui-font">
      <FouIcon icon="file-list-3-line" size="14" />
      <span>本回合改动 {{ files.length }} 个文件</span>
      <div class="spacer" />
      <FouButton
        v-if="workingDir"
        icon="arrow-go-back-line"
        size="small"
        text
        native-type="button"
        @click="undoBatch"
      >
        撤销本批
      </FouButton>
    </div>
    <div class="strip-list">
      <div
        v-for="f in files"
        :key="f.path"
        role="button"
        tabindex="0"
        class="file-chip ui-font"
        :title="f.path"
        @click="emit('preview', f.path)"
        @keydown.enter="emit('preview', f.path)"
      >
        <FouIcon :icon="kindIcon(f.kind)" size="12" />
        <span>{{ basename(f.path) }}</span>
        <FouButton
          icon="code-box-line"
          size="small"
          text
          native-type="button"
          title="在 IDE 打开"
          @click.stop="openInIde(f.path)"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.changed-files-strip {
  margin: 0 12px 6px;
  padding: 8px 10px;
  border: 1px solid var(--hairline);
  border-radius: var(--radius);
  background: var(--surface-card);
}
.strip-head {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 600;
  margin-bottom: 6px;
}
.spacer {
  flex: 1;
}
.strip-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.file-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 6px 3px 8px;
  border: 1px solid var(--hairline);
  border-radius: 999px;
  background: var(--canvas);
  font-size: 11px;
  cursor: pointer;
  max-width: 200px;
}
.file-chip span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
