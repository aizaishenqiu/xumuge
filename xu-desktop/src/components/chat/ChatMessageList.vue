<script setup lang="ts">
/**
 * @file 对话消息、附件、工具调用与流式状态展示
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-31
 * @updated 2026-09-05
 * @version 1.1.0
 * @category UI
 * @algo message-block-dispatch
 */
import { onApiCatch } from "../../utils/userFacingError";
import { FouButton, fouMsg, fouAlert} from "foucui";
import { computed, onUnmounted, ref, watch } from "vue";
import { BRAND_NAME_ZH } from "../../utils/brandSettings";
import { HOME_STARTER_PROMPTS } from "../../utils/homeStarterPrompts";
import { invoke } from "@tauri-apps/api/core";
import type { Message, ToolCallBlock } from "../../types";
import { undoAgentWorkspace } from "../../utils/agentPrefs";
import { readIdeCliOverride } from "../../utils/ideCli";
import { isWritePatchTool, parseToolPatch } from "../../utils/patchDiff";
import { toRelativePath } from "../../utils/chatWorkspace";
import { formatToolApprovalLabel } from "../../utils/toolApprovalLabels";
import ChatMarkdown from "./ChatMarkdown.vue";
import ToolPatchCard from "./ToolPatchCard.vue";

const THINK_PHRASES = ["思考中···", "正在努力思考···", "别急，我正努力中"] as const;
const THINK_OPEN = "<" + "think" + ">";
const THINK_CLOSE = "</" + "think" + ">";

const props = defineProps<{
  messages: Message[];
  streaming: boolean;
  showTools: boolean;
  showThink: boolean;
  collapsed: boolean;
  workingDir?: string | null;
  assistantName?: string;
  sessionError?: string | null;
  /** 首页：空状态贴顶，不占满中间大块空白 */
  compactEmpty?: boolean;
}>();

const emit = defineEmits<{
  stop: [];
  edit: [messageId: string];
  delete: [messageId: string];
  copy: [messageId: string];
  copySession: [];
  useExample: [text: string];
}>();

const imagePreviewOpen = ref(false);
const imagePreviewSrc = ref("");
const imagePreviewAlt = ref("image");

function openImagePreview(src: string, alt?: string) {
  imagePreviewSrc.value = src;
  imagePreviewAlt.value = alt || "image";
  imagePreviewOpen.value = true;
}

const visible = computed(() => {
  if (!props.collapsed) return props.messages;
  const out: Message[] = [];
  for (const m of props.messages) {
    if (m.role === "user") out.push(m);
    else if (m === props.messages[props.messages.length - 1]) out.push(m);
  }
  return out;
});

const nowTick = ref(Date.now());
let timer: ReturnType<typeof setInterval> | null = null;

watch(
  () => props.streaming,
  (on) => {
    if (on) {
      if (!timer) {
        timer = setInterval(() => {
          nowTick.value = Date.now();
        }, 250);
      }
    } else if (timer) {
      clearInterval(timer);
      timer = null;
    }
  },
  { immediate: true },
);

onUnmounted(() => {
  if (timer) clearInterval(timer);
});

function stripEmbeddedThink(raw: string): { think: string; text: string } {
  const thinkParts: string[] = [];
  let text = raw;
  const patterns = [
    new RegExp(`${THINK_OPEN}([\\s\\S]*?)${THINK_CLOSE}`, "gi"),
    /<think>([\s\S]*?)<\/redacted_thinking>/gi,
    /《思考》([\s\S]*?)《\/思考》/g,
  ];
  for (const re of patterns) {
    text = text.replace(re, (_m, inner: string) => {
      const t = String(inner || "").trim();
      if (t) thinkParts.push(t);
      return "";
    });
  }
  return { think: thinkParts.join("\n\n"), text: text.trim() };
}

function textOf(m: Message): string {
  return m.blocks
    .filter((b) => b.type === "text")
    .map((b) => (b.type === "text" ? stripEmbeddedThink(b.content).text : ""))
    .join("");
}

function thinkOf(m: Message): string {
  const fromBlocks = m.blocks
    .filter((b) => b.type === "think")
    .map((b) => (b.type === "think" ? b.content : ""))
    .join("\n");
  const fromText = m.blocks
    .filter((b) => b.type === "text")
    .map((b) => (b.type === "text" ? stripEmbeddedThink(b.content).think : ""))
    .filter(Boolean)
    .join("\n\n");
  return [fromBlocks, fromText].filter(Boolean).join("\n\n").trim();
}

function elapsedSec(m: Message): number {
  const start = m.thinkStartedAt;
  if (!start) return 0;
  const end = m.thinkEndedAt ?? (m.status === "streaming" ? nowTick.value : Date.now());
  return Math.max(0, Math.floor((end - start) / 1000));
}

function phraseOf(m: Message): string {
  return m.thinkPhrase || THINK_PHRASES[0];
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    const y = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    const h = String(d.getHours()).padStart(2, "0");
    const mi = String(d.getMinutes()).padStart(2, "0");
    return `${y}-${mo}-${day} ${h}:${mi}`;
  } catch {
    return "";
  }
}

function hasAnswer(m: Message): boolean {
  return Boolean(textOf(m).trim());
}

function needsEmptyAnswerBubble(m: Message): boolean {
  return m.role === "assistant" && m.status !== "streaming" && !hasAnswer(m);
}

function isLongRunning(m: Message): boolean {
  return m.status === "streaming" && !hasAnswer(m) && elapsedSec(m) >= 120;
}

function activeToolName(m: Message): string | null {
  const tools = toolBlocks(m);
  for (let i = tools.length - 1; i >= 0; i--) {
    const t = tools[i];
    if (t && !t.outputDone) return t.name;
  }
  return null;
}

function activeToolLabel(m: Message): string | null {
  const name = activeToolName(m);
  if (!name) return null;
  const tools = toolBlocks(m);
  for (let i = tools.length - 1; i >= 0; i--) {
    const t = tools[i];
    if (t && t.name === name && !t.outputDone) {
      return formatToolApprovalLabel(t.name, t.input || undefined);
    }
  }
  return formatToolApprovalLabel(name);
}

function canEditUser(m: Message): boolean {
  if (m.role !== "user") return false;
  const streamingAssistant = props.messages.some(
    (x) => x.role === "assistant" && x.status === "streaming",
  );
  if (!streamingAssistant) return true;
  const lastUser = [...props.messages].reverse().find((x) => x.role === "user");
  return lastUser?.id === m.id;
}

function assistantLabel(): string {
  return props.assistantName?.trim() || "虚募阁";
}

function assistantAvatarChar(): string {
  const label = assistantLabel();
  return label.slice(0, 1).toUpperCase();
}

function showProgress(m: Message): boolean {
  if (m.role !== "assistant") return false;
  if (m.status === "streaming") return true;
  if (thinkOf(m)) return true;
  // 无正文的结束消息不要再挂「思考中 0s」空壳
  if (!hasAnswer(m)) return false;
  return Boolean(m.thinkStartedAt);
}

function toolBlocks(m: Message): ToolCallBlock[] {
  return m.blocks.filter((b): b is ToolCallBlock => b.type === "tool");
}

function hasWriteTools(m: Message): boolean {
  return toolBlocks(m).some((b) => isWritePatchTool(b.name) && b.outputDone);
}

function changedPaths(m: Message): string[] {
  const paths: string[] = [];
  for (const b of toolBlocks(m)) {
    if (!isWritePatchTool(b.name)) continue;
    for (const ch of parseToolPatch(b.name, b.input)) {
      if (ch.path) paths.push(ch.path);
    }
  }
  return [...new Set(paths)];
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

async function undoWorkspace() {
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
  <div class="message-list">
    <div v-if="!messages.length" class="chat-empty" :class="{ compact: compactEmpty }">
      <h2 class="chat-empty-title ui-font">{{ BRAND_NAME_ZH }}</h2>
      <p class="chat-empty-sub">桌面助手对话 · 选工作区后可读写项目文件</p>
      <div class="chat-empty-starters">
        <FouButton
          v-for="ex in HOME_STARTER_PROMPTS"
          :key="ex.id"
          :icon="ex.icon"
          size="small"
          native-type="button"
          @click="emit('useExample', ex.text)"
        >
          {{ ex.label }}
        </FouButton>
      </div>
    </div>

    <div v-if="messages.length" class="session-actions">
      <FouButton icon="file-copy-line" size="small" native-type="button" @click="emit('copySession')">
        复制本会话
      </FouButton>
    </div>

    <div
      v-for="m in visible"
      :key="m.id"
      class="chat-row"
      :class="{ mine: m.role === 'user', streaming: m.status === 'streaming' }"
    >
      <div v-if="m.role === 'assistant'" class="chat-avatar xu">{{ assistantAvatarChar() }}</div>
      <div class="chat-col">
        <div class="chat-meta ui-font">
          <span>{{ m.role === "user" ? "你" : assistantLabel() }}</span>
          <span>{{ formatTime(m.timestamp) }}</span>
        </div>

        <div
          v-if="m.statusLine && m.role === 'assistant' && m.status === 'streaming'"
          class="chat-status ui-font"
        >
          <FouIcon icon="loader-4-line" size="14" class="spin" />
          {{ m.statusLine }}
        </div>

        <div
          v-if="showProgress(m)"
          class="chat-progress ui-font"
          :class="{ compact: !showThink }"
        >
          <template v-if="m.status === 'streaming' && !hasAnswer(m) && !thinkOf(m)">
            <FouIcon icon="lightbulb-line" size="14" />
            <span>{{ m.statusLine || phraseOf(m) }}</span>
            <span v-if="isLongRunning(m)" class="long-hint">仍在运行，可点停止</span>
            <span class="think-sec">{{ elapsedSec(m) }}s</span>
          </template>
          <template v-else-if="!showThink">
            <FouIcon icon="lightbulb-line" size="14" />
            <span>已思考 {{ elapsedSec(m) }}s</span>
            <span v-if="m.status === 'streaming' && m.statusLine" class="status-hint">{{ m.statusLine }}</span>
          </template>
        </div>

        <details
          v-if="showThink && (thinkOf(m) || (m.status === 'streaming' && !hasAnswer(m)))"
          class="chat-think"
          :open="m.status === 'streaming' || !hasAnswer(m)"
        >
          <summary class="ui-font">
            <FouIcon icon="lightbulb-line" size="14" />
            思考过程 · {{ elapsedSec(m) }}s
          </summary>
          <pre :class="{ pulsing: m.status === 'streaming' && !hasAnswer(m) }">{{
            thinkOf(m) || (m.status === "streaming" ? m.statusLine || phraseOf(m) : "")
          }}</pre>
        </details>

        <div v-if="activeToolLabel(m)" class="tool-progress ui-font">
          <FouIcon icon="loader-4-line" size="14" class="spin" />
          正在执行：{{ activeToolLabel(m) }}
        </div>

        <div
          v-if="m.role === 'user' || hasAnswer(m) || needsEmptyAnswerBubble(m) || (m.status === 'streaming' && !thinkOf(m) && !hasAnswer(m))"
          class="chat-bubble"
          :class="{ assistant: m.role === 'assistant', user: m.role === 'user' }"
        >
          <template v-if="m.role === 'user'">
            <template v-for="(b, i) in m.blocks" :key="i">
              <div v-if="b.type === 'text'" class="chat-plain">{{ b.content }}</div>
              <button
                v-else-if="b.type === 'image'"
                type="button"
                class="chat-image-btn"
                :aria-label="`预览图片 ${b.filename || 'image'}`"
                @click="openImagePreview(b.dataUrl, b.filename)"
              >
                <FouIcon class="chat-image-preview-icon" icon="eye-line" size="16" />
                <img class="chat-image" :src="b.dataUrl" :alt="b.filename || 'image'" />
              </button>
              <div v-else-if="b.type === 'attachment'" class="chat-attachment ui-font">
                <FouIcon
                  :icon="b.attachment.kind === 'image' ? 'image-line' : b.attachment.kind === 'audio' ? 'volume-up-line' : b.attachment.kind === 'archive' ? 'file-zip-line' : 'file-text-line'"
                  size="16"
                />
                <span>{{ b.attachment.filename }}</span>
                <small>{{ b.attachment.kind }} · {{ Math.ceil(b.attachment.sizeBytes / 1024) }} KB</small>
                <FouButton
                  v-if="b.attachment.previewDataUrl"
                  icon="eye-line"
                  size="small"
                  text
                  native-type="button"
                  aria-label="预览附件图片"
                  @click="openImagePreview(b.attachment.previewDataUrl, b.attachment.filename)"
                />
              </div>
            </template>
          </template>
          <template v-else>
            <ChatMarkdown v-if="hasAnswer(m)" :content="textOf(m)" :working-dir="workingDir" />
            <div v-else-if="m.status === 'streaming'" class="chat-wait ui-font">
              {{ m.statusLine || phraseOf(m) }}
              <span v-if="isLongRunning(m)" class="long-hint"> · 仍在运行，可点停止</span>
              <span class="think-sec">{{ elapsedSec(m) }}s</span>
            </div>
            <div v-else-if="needsEmptyAnswerBubble(m)" class="chat-empty-answer ui-font">
              本轮未生成可显示的正文
              <span v-if="sessionError" class="empty-err">（{{ sessionError }}）</span>
            </div>
          </template>
        </div>

        <template v-if="showTools">
          <ToolPatchCard
            v-for="(b, i) in toolBlocks(m)"
            :key="'t' + i"
            :block="b"
            :default-open="m.status === 'streaming' && !b.outputDone"
          />
        </template>

        <div
          v-if="m.role === 'assistant' && m.status !== 'streaming' && hasWriteTools(m) && workingDir"
          class="write-actions ui-font"
        >
          <FouButton
            v-for="p in changedPaths(m).slice(0, 3)"
            :key="p"
            icon="code-box-line"
            size="small"
            text
            native-type="button"
            @click="openInIde(p)"
          >
            IDE · {{ toRelativePath(workingDir!, resolveAbsPath(p)) }}
          </FouButton>
          <FouButton
            icon="arrow-go-back-line"
            size="small"
            text
            native-type="button"
            @click="undoWorkspace"
          >
            撤销本批
          </FouButton>
        </div>

        <div class="chat-actions">
          <FouButton
            v-if="m.status === 'streaming' && m.role === 'assistant'"
            icon="stop-circle-line"
            size="small"
            text
            native-type="button"
            @click="emit('stop')"
          >
            停止
          </FouButton>
          <FouButton
            v-if="canEditUser(m)"
            icon="edit-line"
            size="small"
            text
            native-type="button"
            @click="emit('edit', m.id)"
          >
            编辑
          </FouButton>
          <FouButton
            v-if="m.status !== 'streaming'"
            icon="delete-bin-line"
            size="small"
            text
            native-type="button"
            @click="emit('delete', m.id)"
          >
            删除
          </FouButton>
          <FouButton
            icon="file-copy-line"
            size="small"
            text
            native-type="button"
            @click="emit('copy', m.id)"
          >
            复制
          </FouButton>
        </div>
      </div>
      <div v-if="m.role === 'user'" class="chat-avatar me">你</div>
    </div>
  </div>
  <FouDialog
    v-model="imagePreviewOpen"
    title="图片预览"
    width="min(92vw, 1080px)"
    append-to-body
    :z-index="22000"
  >
    <img
      v-if="imagePreviewSrc"
      class="chat-image-preview-full"
      :src="imagePreviewSrc"
      :alt="imagePreviewAlt"
    />
  </FouDialog>
</template>

<style scoped>
.message-list {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 16px 20px 20px;
  background: var(--canvas);
}
.session-actions {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 12px;
}
.chat-empty {
  height: 100%;
  min-height: 220px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--muted);
}
.chat-empty-title {
  margin: 0;
  font-size: 22px;
  font-weight: 600;
  color: var(--heading);
}
.chat-empty.compact {
  height: auto;
  min-height: 0;
  justify-content: flex-start;
  padding: 20px 0 8px;
}
.chat-empty-starters {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
  max-width: 520px;
  margin-top: 8px;
}
.chat-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  margin-bottom: 16px;
}
.chat-row .chat-actions {
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.12s ease;
}
.chat-row:hover .chat-actions,
.chat-row:focus-within .chat-actions {
  opacity: 1;
  pointer-events: auto;
}
.chat-row.mine {
  flex-direction: row;
  justify-content: flex-end;
}
.chat-avatar {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 700;
  flex-shrink: 0;
  color: #fff;
}
.chat-avatar.xu {
  background: var(--accent, #2563eb);
}
.chat-avatar.me {
  background: var(--muted-strong, #64748b);
}
.chat-col {
  flex: 1;
  min-width: 0;
  max-width: calc(100% - 44px);
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.chat-row.mine .chat-col {
  flex: 0 1 auto;
  max-width: min(88%, 720px);
  align-items: flex-end;
}
.chat-meta {
  display: flex;
  gap: 8px;
  font-size: 11px;
  color: var(--muted);
}
.chat-status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--accent, #2563eb);
  padding: 4px 10px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--accent, #2563eb) 8%, transparent);
  border: 1px solid var(--hairline);
  width: fit-content;
  max-width: 100%;
}
.chat-progress {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--muted);
}
.chat-progress.compact {
  padding: 2px 0;
}
.status-hint {
  color: var(--muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.think-sec {
  font-variant-numeric: tabular-nums;
  color: var(--muted);
}
.long-hint {
  color: var(--primary);
  margin-left: 4px;
}
.tool-progress {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--muted);
  margin: 4px 0 6px;
}
.chat-empty-answer {
  color: var(--muted);
  font-size: 13px;
}
.empty-err {
  color: #b91c1c;
}
.chat-bubble {
  width: 100%;
  box-sizing: border-box;
  border-radius: 12px;
  padding: 12px 14px;
  max-width: 100%;
  border: 1px solid var(--hairline);
  user-select: text;
  -webkit-user-select: text;
}
.chat-bubble.assistant {
  background: var(--surface);
  color: var(--body);
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
}
.chat-bubble.user {
  background: var(--surface-soft);
  color: var(--body);
  border-color: color-mix(in srgb, var(--accent, #2563eb) 25%, var(--hairline));
}
.chat-plain {
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 14px;
  line-height: 1.55;
  user-select: text;
  -webkit-user-select: text;
}
.chat-image-btn {
  position: relative;
  display: block;
  padding: 0;
  border: none;
  background: transparent;
  cursor: zoom-in;
  border-radius: 8px;
  overflow: hidden;
  line-height: 0;
}
.chat-image-preview-icon {
  position: absolute;
  right: 7px;
  bottom: 7px;
  z-index: 1;
  padding: 3px;
  border-radius: 999px;
  color: #fff;
  background: rgba(15, 23, 42, 0.68);
}
.chat-image {
  max-width: 240px;
  border-radius: 8px;
  display: block;
}
.chat-attachment {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
  padding: 7px 9px;
  border: 1px solid var(--hairline);
  border-radius: 8px;
  background: var(--canvas);
}
.chat-attachment small {
  margin-left: auto;
  color: var(--muted);
}
.chat-image-preview-full {
  display: block;
  width: 100%;
  max-height: 78vh;
  object-fit: contain;
  border-radius: 8px;
  background: #111;
}
.chat-think,
.chat-tool {
  width: 100%;
  background: var(--surface-soft);
  border: 1px solid var(--hairline);
  border-radius: 10px;
  padding: 8px 10px;
  font-size: 12px;
  color: var(--muted);
}
.chat-think summary,
.chat-tool summary {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  list-style: none;
}
.chat-think summary::-webkit-details-marker,
.chat-tool summary::-webkit-details-marker {
  display: none;
}
.chat-think pre,
.chat-tool pre {
  margin: 8px 0 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 11px;
  font-family: var(--font-mono);
  max-height: 280px;
  overflow: auto;
  color: var(--body);
}
.chat-think pre.pulsing::after {
  content: "▋";
  animation: blink 1s step-end infinite;
  margin-left: 2px;
  color: var(--accent, #2563eb);
}
.chat-wait {
  color: var(--muted);
}
.chat-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 2px;
}
.write-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 4px 0;
}
.spin {
  animation: spin 1.2s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
@keyframes blink {
  50% {
    opacity: 0;
  }
}
</style>
