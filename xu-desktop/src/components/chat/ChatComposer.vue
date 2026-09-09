<script setup lang="ts">
/**
 * @file ChatComposer.vue — chat input, attachments, voice, queue
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-30
 * @updated 2026-08-31
 * @version 1.2.0
 * @category Layout
 * @algo session-generation-guarded-attachment-draft
 */
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { FouButton, fouAlert } from "foucui";
import ChatComposerFooter from "./ChatComposerFooter.vue";
import ChatComposerContextMenu, { type ComposerCtxAction } from "./ChatComposerContextMenu.vue";
import type { ChatAttachment, ContextUsage } from "../../types";
import {
  screenshotFileUrl,
  takePendingChatImage,
  type PendingChatImage,
} from "../../utils/screenshot";
import { startOneShotDictation, speechRecognitionAvailable, type VoicePhase } from "../../utils/voiceCall";
import { stopVoiceWake } from "../../utils/voiceWake";
import type { SessionBillingRound } from "../../utils/billing";
import type { ChatMode, ExecPolicy } from "../../utils/agentPrefs";
import {
  attachmentSessionKey,
  clearAfterAcceptedSend,
  isCurrentAttachmentRequest,
  type AttachmentRequestToken,
} from "../../utils/attachmentLifecycle";
import { sanitizeUserMessage } from "../../utils/userFacingError";

const COMPOSER_H_KEY = "xu.chat.composerH";
const COMPOSER_MIN = 72;
const COMPOSER_MAX = 280;

const model = defineModel<string>({ default: "" });

export type QueuedSendItem = {
  id: string;
  text: string;
  imageDataUrl?: string | null;
  extras?: { attachments?: ChatAttachment[]; imageDataUrls?: string[]; outputFormat?: string };
};

const props = defineProps<{
  streaming: boolean;
  hasSession: boolean;
  sessionId?: string | null;
  voicePhase?: VoicePhase;
  voiceActive?: boolean;
  voiceInterim?: string;
  expertRoleId?: string | null;
  queuedMessages?: QueuedSendItem[];
  modelLabel: string;
  brainOk?: boolean | null;
  contextUsage: ContextUsage | null;
  sessionCostLabel?: string;
  modelShortLabel?: string;
  sessionRounds?: SessionBillingRound[];
  chatMode: ChatMode;
  execPolicy: ExecPolicy;
  planWriteWarning?: boolean;
  hideExpertRole?: boolean;
  sessionError?: string | null;
  /** 父级已提供顶部分隔拉伸条时隐藏内置把手 */
  externalResize?: boolean;
  /** 正在编辑上一条用户提问 */
  editingMessage?: boolean;
  /** Token 套餐硬限已触达，禁止发送 */
  tokenHardHit?: boolean;
}>();

const emit = defineEmits<{
  send: [
    text: string,
    imageDataUrl?: string | null,
    extras?: { attachments?: ChatAttachment[]; imageDataUrls?: string[]; outputFormat?: string },
    confirm?: (accepted: boolean) => void,
  ];
  stop: [];
  toggleVoiceCall: [];
  "remove-queue": [id: string];
  "clear-queue": [];
  "update:chatMode": [ChatMode];
  "update:execPolicy": [ExecPolicy];
  "update:expertRoleId": [string | null];
  brainChanged: [];
  compress: [];
}>();

type AttachedComposerImage = {
  filename: string;
  dataUrl: string;
  path?: string;
};

const attachedImage = ref<AttachedComposerImage | null>(null);
const imagePreviewOpen = ref(false);
const attachmentPreview = ref<{ dataUrl: string; filename: string } | null>(null);
type AttachmentDraft = ChatAttachment & { previewDataUrl?: string };
const attachments = ref<AttachmentDraft[]>([]);
const composerInputRef = ref<HTMLTextAreaElement | null>(null);
const ctxMenuOpen = ref(false);
const ctxMenuPos = ref({ x: 0, y: 0 });
const ctxCanPaste = ref(true);
const outputFormat = ref<string>("");
const isRecording = ref(false);
const attachmentGeneration = ref(0);
const sendAwaitingConfirmation = ref(false);
let stopDictation: (() => void) | null = null;
let attachedImageResolveGen = 0;
const speechOk = speechRecognitionAvailable();

const composerH = ref(
  (() => {
    try {
      const n = Number(localStorage.getItem(COMPOSER_H_KEY));
      return Number.isFinite(n) && n >= COMPOSER_MIN && n <= COMPOSER_MAX ? n : 110;
    } catch {
      return 110;
    }
  })(),
);

const composerMaxH = computed(() => {
  const vh = typeof window !== "undefined" ? window.innerHeight * 0.45 : COMPOSER_MAX;
  return Math.min(COMPOSER_MAX, Math.round(vh));
});

function onComposerResizeStart(e: PointerEvent) {
  e.preventDefault();
  const startY = e.clientY;
  const startH = composerH.value;
  const maxH = composerMaxH.value;
  const onMove = (ev: PointerEvent) => {
    const next = Math.max(COMPOSER_MIN, Math.min(maxH, startH + (startY - ev.clientY)));
    composerH.value = next;
  };
  const onUp = () => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    try {
      localStorage.setItem(COMPOSER_H_KEY, String(composerH.value));
    } catch {
      /* ignore */
    }
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
}

const queueList = computed(() => props.queuedMessages ?? []);

const canSend = computed(
  () =>
    !props.tokenHardHit &&
    !sendAwaitingConfirmation.value &&
    Boolean(model.value.trim() || attachedImage.value || attachments.value.length),
);

function toggleMic() {
  if (props.voiceActive) {
    void fouAlert("语音通话进行中，请使用全屏语音助手说话，或先挂断再使用语音输入。", "提示");
    return;
  }
  if (isRecording.value && stopDictation) {
    stopDictation();
    stopDictation = null;
    isRecording.value = false;
    return;
  }
  isRecording.value = true;
  stopVoiceWake();
  stopDictation = startOneShotDictation({
    onStart: () => {
      isRecording.value = true;
    },
    onEnd: () => {
      isRecording.value = false;
      stopDictation = null;
      window.dispatchEvent(new CustomEvent("xu-voice-wake-refresh"));
    },
    onError: (msg) => {
      isRecording.value = false;
      stopDictation = null;
      window.dispatchEvent(new CustomEvent("xu-voice-wake-refresh"));
      void fouAlert(msg, "提示");
    },
    onText: (text) => {
      model.value = model.value ? `${model.value}${text}` : text;
    },
  });
}

/**
 * Normalize pending screenshot/paste payload into a composer preview.
 * Path-based screenshots rebuild asset URL in this webview (overlay URLs do not work here).
 */
function applyPendingImage(pending: PendingChatImage) {
  const filename = pending.filename || "capture.png";
  if (pending.path) {
    attachedImage.value = {
      path: pending.path,
      filename,
      dataUrl: screenshotFileUrl(pending.path),
    };
    return;
  }
  if (pending.dataUrl) {
    attachedImage.value = {
      dataUrl: pending.dataUrl,
      filename,
    };
  }
}

function loadPending() {
  const pending = takePendingChatImage();
  if (pending) applyPendingImage(pending);
}

function onAttachEvent(e: Event) {
  const detail = (e as CustomEvent<PendingChatImage>).detail;
  if (!detail?.path && !detail?.dataUrl) return;
  attachmentPreview.value = null;
  applyPendingImage(detail);
}

/** Asset preview failed: fall back to IPC data URL once. */
async function onAttachedImageError() {
  const current = attachedImage.value;
  if (!current?.path || current.dataUrl.startsWith("data:")) return;
  const gen = ++attachedImageResolveGen;
  try {
    const dataUrl = await invoke<string>("xu_read_image_data_url", { path: current.path });
    if (gen !== attachedImageResolveGen) return;
    if (attachedImage.value?.path !== current.path) return;
    attachedImage.value = { ...current, dataUrl };
  } catch {
    /* keep broken thumb; send path still recoverable */
  }
}

/**
 * Resolve a real data URL for vision/send; path screenshots read once at send time.
 * Dependency: xu_read_image_data_url for path; paste already has data:.
 * Failure: returns null and caller may still send text/attachments.
 */
async function resolveOutgoingImageDataUrl(): Promise<string | null> {
  const img = attachedImage.value;
  const storedImages = attachments.value
    .filter((item) => item.kind === "image" && item.previewDataUrl)
    .map((item) => item.previewDataUrl!);
  if (!img) return storedImages[0] ?? null;
  if (img.dataUrl.startsWith("data:")) return img.dataUrl;
  if (img.path) {
    try {
      return await invoke<string>("xu_read_image_data_url", { path: img.path });
    } catch {
      return storedImages[0] ?? null;
    }
  }
  return storedImages[0] ?? null;
}

function clearImage() {
  attachedImage.value = null;
  attachmentPreview.value = null;
  imagePreviewOpen.value = false;
}

async function clearAttachment(item: AttachmentDraft) {
  try {
    await invoke("xu_remove_pending_chat_attachment", { id: item.id });
    attachments.value = attachments.value.filter((entry) => entry.id !== item.id);
  } catch (e) {
    await fouAlert(
      sanitizeUserMessage(e, "无法移除附件，请稍后重试"),
      "无法移除附件",
    );
  }
}

async function doSend() {
  if (props.tokenHardHit) {
    void fouAlert("已达 Token 套餐限额，请到设置 → 模型 → Token 套餐调高限额或清零后再试。", "Token 限额");
    return;
  }
  if (sendAwaitingConfirmation.value) return;
  const text = model.value.trim();
  if (!text && !attachedImage.value && !attachments.value.length) return;
  const storedImages = attachments.value
    .filter((item) => item.kind === "image" && item.previewDataUrl)
    .map((item) => item.previewDataUrl!);
  const img = await resolveOutgoingImageDataUrl();
  const body =
    text ||
    (attachedImage.value ? `[图片: ${attachedImage.value.filename}]` : "") ||
    (attachments.value.length ? `[附件: ${attachments.value.map((item) => item.filename).join("、")}]` : "");
  const sentAttachmentIds = new Set(attachments.value.map((item) => item.id));
  const sentImage = attachedImage.value;
  const sentText = model.value;
  sendAwaitingConfirmation.value = true;
  emit("send", body, img, {
    attachments: attachments.value,
    imageDataUrls: img ? Array.from(new Set([img, ...storedImages])) : storedImages,
    outputFormat: outputFormat.value || undefined,
  }, (accepted) => {
    sendAwaitingConfirmation.value = false;
    clearAfterAcceptedSend(accepted, () => {
      if (model.value === sentText) model.value = "";
      if (attachedImage.value === sentImage) attachedImage.value = null;
      attachments.value = attachments.value.filter((item) => !sentAttachmentIds.has(item.id));
      attachmentGeneration.value += 1;
    });
  });
}

/** 将当前输入写入记忆库（走 /记住 协议，不调用 agent） */
function doRemember() {
  const text = model.value.trim();
  if (!text) return;
  emit("send", `/记住 ${text}`);
  model.value = "";
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    doSend();
  }
}

async function onPaste(e: ClipboardEvent) {
  const items = e.clipboardData?.items;
  if (!items) return;
  for (const item of items) {
    if (item.type.startsWith("image/")) {
      e.preventDefault();
      const file = item.getAsFile();
      if (!file) continue;
      const dataUrl = await readBlobAsDataUrl(file);
      attachedImage.value = {
        dataUrl,
        filename: file.name || `paste-${Date.now()}.png`,
      };
      attachmentPreview.value = null;
      return;
    }
  }
}

function readBlobAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function hydratePreviews(items: ChatAttachment[]): Promise<AttachmentDraft[]> {
  return Promise.all(
    items.map(async (item) => {
      if (item.kind !== "image") return item;
      try {
        const previewDataUrl = await invoke<string>("xu_read_chat_attachment_preview", {
          id: item.id,
        });
        return { ...item, previewDataUrl };
      } catch {
        return item;
      }
    }),
  );
}

async function restorePendingAttachments() {
  const token: AttachmentRequestToken = {
    sessionKey: attachmentSessionKey(props.sessionId),
    generation: attachmentGeneration.value,
  };
  try {
    const rows = await invoke<ChatAttachment[]>("xu_list_pending_chat_attachments", {
      sessionId: token.sessionKey === "__draft__" ? null : token.sessionKey,
    });
    const hydrated = await hydratePreviews(rows);
    if (isCurrentAttachmentRequest(token, props.sessionId, attachmentGeneration.value)) {
      attachments.value = hydrated;
    }
  } catch (e) {
    if (isCurrentAttachmentRequest(token, props.sessionId, attachmentGeneration.value)) {
      await fouAlert(
        sanitizeUserMessage(e, "附件恢复失败，请重新选择附件"),
        "附件恢复失败",
      );
    }
  }
}

async function pickAttachment() {
  const token: AttachmentRequestToken = {
    sessionKey: attachmentSessionKey(props.sessionId),
    generation: attachmentGeneration.value,
  };
  try {
    const selected = await openFileDialog({
      multiple: true,
      filters: [
        {
          name: "附件",
          extensions: [
            "doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "odp", "pdf",
            "txt", "md", "markdown", "csv", "json", "jsonl", "yaml", "yml", "xml", "log",
            "html", "htm", "css", "scss", "svg", "webmanifest",
            "js", "mjs", "cjs", "jsx", "ts", "tsx", "vue", "py", "rs", "go", "java",
            "c", "h", "cpp", "hpp", "cs", "php", "rb", "swift", "sh", "ps1", "bat", "sql",
            "toml", "ini", "conf", "cfg", "env", "properties",
            "zip", "png", "jpg", "jpeg", "gif", "webp", "bmp",
            "mp3", "wav", "ogg", "oga", "flac", "m4a", "aac",
          ],
        },
      ],
    });
    const paths = Array.isArray(selected) ? selected : selected ? [selected] : [];
    if (!paths.length) return;
    const rows = await invoke<ChatAttachment[]>("xu_ingest_chat_attachments", {
      paths,
      sessionId: token.sessionKey === "__draft__" ? null : token.sessionKey,
    });
    const hydrated = await hydratePreviews(rows);
    if (!isCurrentAttachmentRequest(token, props.sessionId, attachmentGeneration.value)) return;
    attachments.value = [...attachments.value, ...hydrated];
    const warnings = rows.map((item) => item.warning).filter(Boolean);
    if (warnings.length) await fouAlert(warnings.join("\n\n"), "附件处理说明");
  } catch (e) {
    if (isCurrentAttachmentRequest(token, props.sessionId, attachmentGeneration.value)) {
      await fouAlert(
        sanitizeUserMessage(e, "无法添加附件，请检查文件后重试"),
        "无法添加附件",
      );
    }
  }
}

onMounted(() => {
  loadPending();
  void restorePendingAttachments();
  window.addEventListener("xu-attach-chat-image", onAttachEvent);
});

onUnmounted(() => {
  window.removeEventListener("xu-attach-chat-image", onAttachEvent);
  stopDictation?.();
});

watch(
  () => props.sessionId,
  () => {
    if (sendAwaitingConfirmation.value) return;
    attachmentGeneration.value += 1;
    attachments.value = [];
    void restorePendingAttachments();
  },
);

function ctxFlags() {
  const el = composerInputRef.value;
  if (!el) {
    return { canCopy: false, canPaste: false, canCut: false, canUndo: false, canRedo: false };
  }
  const hasSel = el.selectionStart !== el.selectionEnd;
  const hasText = el.value.length > 0;
  return {
    canCopy: hasSel || hasText,
    canPaste: ctxCanPaste.value,
    canCut: hasSel,
    canUndo: true,
    canRedo: true,
  };
}

async function refreshCtxPaste() {
  try {
    if (navigator.clipboard?.readText) {
      const t = await navigator.clipboard.readText();
      ctxCanPaste.value = Boolean(t?.length);
      return;
    }
  } catch {
    /* ignore */
  }
  ctxCanPaste.value = true;
}

async function onComposerContextMenu(e: MouseEvent) {
  e.preventDefault();
  await refreshCtxPaste();
  ctxMenuPos.value = { x: e.clientX, y: e.clientY };
  ctxMenuOpen.value = true;
}

function runComposerCtx(action: ComposerCtxAction) {
  const el = composerInputRef.value;
  if (!el) return;
  el.focus();
  switch (action) {
    case "copy":
      document.execCommand("copy");
      break;
    case "cut":
      document.execCommand("cut");
      break;
    case "paste":
      void (async () => {
        try {
          if (navigator.clipboard?.readText) {
            const text = await navigator.clipboard.readText();
            if (!text) return;
            const start = el.selectionStart ?? el.value.length;
            const end = el.selectionEnd ?? start;
            const next = el.value.slice(0, start) + text + el.value.slice(end);
            model.value = next;
            window.setTimeout(() => {
              const pos = start + text.length;
              el.setSelectionRange(pos, pos);
            }, 0);
            return;
          }
        } catch {
          /* fallback */
        }
        document.execCommand("paste");
      })();
      break;
    case "undo":
      document.execCommand("undo");
      break;
    case "redo":
      document.execCommand("redo");
      break;
    case "selectAll":
      el.select();
      break;
    default:
      break;
  }
}
</script>

<template>
  <div class="composer qiu-composer-shell" :class="{ 'composer-external': externalResize }">
    <div v-if="editingMessage" class="composer-editing-hint ui-font">
      <FouIcon icon="edit-line" size="14" />
      <span>正在编辑上一条提问，修改后发送将重新提问</span>
    </div>
    <div v-if="attachedImage" class="composer-attach">
      <button
        type="button"
        class="composer-attach-thumb"
        :title="attachedImage.filename"
        aria-label="点击预览图片"
        @click="attachmentPreview = null; imagePreviewOpen = true"
      >
        <FouIcon class="composer-attach-preview-icon" icon="eye-line" size="16" />
        <img
          :src="attachedImage.dataUrl"
          :alt="attachedImage.filename"
          @error="onAttachedImageError"
        />
      </button>
      <FouButton
        class="composer-attach-remove"
        icon="close-line"
        size="small"
        text
        native-type="button"
        aria-label="移除图片"
        @click="clearImage"
      />
    </div>
    <FouDialog
      v-model="imagePreviewOpen"
      title="图片预览"
      width="min(92vw, 1080px)"
      append-to-body
      :z-index="22000"
    >
      <img
        v-if="attachedImage || attachmentPreview"
        class="composer-preview-full"
        :src="(attachmentPreview || attachedImage)!.dataUrl"
        :alt="(attachmentPreview || attachedImage)!.filename"
      />
    </FouDialog>
    <div v-if="attachments.length" class="composer-attachment-list ui-font">
      <div v-for="item in attachments" :key="item.id" class="composer-attach doc">
        <FouIcon
          :icon="item.kind === 'image' ? 'image-line' : item.kind === 'audio' ? 'volume-up-line' : item.kind === 'archive' ? 'file-zip-line' : 'file-text-line'"
          size="16"
        />
        <span class="attachment-name">{{ item.filename }}</span>
        <span class="attachment-tag">{{ item.kind }} · {{ Math.ceil(item.sizeBytes / 1024) }} KB</span>
        <FouButton
          v-if="item.kind === 'image' && item.previewDataUrl"
          icon="eye-line"
          size="small"
          text
          native-type="button"
          aria-label="预览图片"
          @click="attachmentPreview = { dataUrl: item.previewDataUrl!, filename: item.filename }; imagePreviewOpen = true"
        />
      <FouButton
        class="icon-btn"
        icon="close-line"
        size="small"
        text
        native-type="button"
        aria-label="移除"
          @click="clearAttachment(item)"
      />
      </div>
    </div>
    <div
      v-if="!externalResize"
      class="composer-resize-handle"
      title="拖拽调节输入框高度"
      aria-label="拖拽调节输入框高度"
      @pointerdown="onComposerResizeStart"
    >
      <FouIcon icon="drag-move-2-line" size="14" />
    </div>
    <div
      v-else
      class="composer-split-spacer"
      aria-hidden="true"
    />
    <textarea
      ref="composerInputRef"
      v-model="model"
      class="composer-input qiu-composer-input ui-font"
      data-xu-context
      :class="{ 'composer-input-fill': externalResize }"
      :style="externalResize ? undefined : { height: `${composerH}px` }"
      :placeholder="
        editingMessage
          ? '修改问题后 Enter 发送…'
          : streaming
            ? '可输入下一条并排队…'
            : '发给虚募阁…（Enter 发送；可粘贴截图 / 附件）'
      "
      @keydown="onKeydown"
      @paste="onPaste"
      @contextmenu="onComposerContextMenu"
    />
    <ChatComposerContextMenu
      :visible="ctxMenuOpen"
      :x="ctxMenuPos.x"
      :y="ctxMenuPos.y"
      v-bind="ctxFlags()"
      @close="ctxMenuOpen = false"
      @action="runComposerCtx"
    />
    <div v-if="queueList.length" class="queue-list ui-font">
      <div class="queue-list-head">
        <FouIcon icon="time-line" size="14" />
        <span>排队 {{ queueList.length }} 条</span>
        <div class="spacer" />
        <FouButton
          class="icon-btn"
          icon="delete-bin-line"
          size="small"
          text
          native-type="button"
          title="清空排队"
          aria-label="清空排队"
          @click="emit('clear-queue')"
        />
      </div>
      <ul class="queue-items">
        <li v-for="(q, i) in queueList" :key="q.id" class="queue-item">
          <span class="queue-idx">{{ i + 1 }}</span>
          <span class="queue-text">{{ q.text.slice(0, 100) }}{{ q.text.length > 100 ? "…" : "" }}</span>
          <FouButton
            class="icon-btn"
            icon="close-line"
            size="small"
            text
            native-type="button"
            aria-label="移除"
            @click="emit('remove-queue', q.id)"
          />
        </li>
      </ul>
    </div>
    <p v-if="voiceActive" class="voice-hint ui-font">
      语音助手窗口已打开 · 说完自动发送 · 说话可打断回复
    </p>
    <ChatComposerFooter
      :streaming="streaming"
      :model-label="modelLabel"
      :brain-ok="brainOk"
      :context-usage="contextUsage"
      :session-cost-label="sessionCostLabel"
      :model-short-label="modelShortLabel"
      :session-rounds="sessionRounds"
      :chat-mode="chatMode"
      :exec-policy="execPolicy"
      :expert-role-id="expertRoleId ?? null"
      :is-recording="isRecording"
      :speech-ok="speechOk"
      :voice-active="voiceActive"
      :can-send="canSend"
      :plan-write-warning="planWriteWarning"
      :hide-expert-role="hideExpertRole"
      @stop="emit('stop')"
      @send="doSend"
      @remember="doRemember"
      @attach="pickAttachment"
      @toggle-voice-call="emit('toggleVoiceCall')"
      @toggle-mic="toggleMic"
      @update:chat-mode="emit('update:chatMode', $event)"
      @update:exec-policy="emit('update:execPolicy', $event)"
      @update:expert-role-id="emit('update:expertRoleId', $event)"
      @brain-changed="emit('brainChanged')"
      @compress="emit('compress')"
    />
  </div>
</template>

<style scoped>
.composer {
  flex-shrink: 0;
  min-width: 0;
  padding: 12px 16px 0;
  border-top: 1px solid var(--hairline);
  background: var(--surface-card);
  display: flex;
  flex-direction: column;
  gap: 8px;
  box-sizing: border-box;
}
.composer-external {
  border-top: none;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.composer-split-spacer {
  display: none;
}
.composer-editing-hint {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0 0 8px;
  padding: 6px 10px;
  border-radius: 8px;
  font-size: 12px;
  color: var(--primary);
  background: color-mix(in srgb, var(--primary) 8%, transparent);
  border: 1px solid color-mix(in srgb, var(--primary) 22%, var(--hairline));
}
.composer-attach {
  position: relative;
  display: inline-flex;
  align-self: flex-start;
  margin-bottom: 8px;
}
.composer-attach.doc {
  display: flex;
  gap: 10px;
  align-items: center;
  width: 100%;
  padding: 8px;
  border-radius: 10px;
  border: 1px solid var(--hairline);
  background: var(--canvas);
  font-size: 12px;
  color: var(--muted);
  justify-content: space-between;
}
.composer-attachment-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.attachment-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.attachment-tag {
  margin-left: auto;
  color: var(--muted);
  white-space: nowrap;
}
.composer-attach-thumb {
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
.composer-attach-preview-icon {
  position: absolute;
  right: 6px;
  bottom: 6px;
  padding: 3px;
  border-radius: 999px;
  color: #fff;
  background: rgba(15, 23, 42, 0.68);
}
.composer-attach-thumb img {
  display: block;
  width: 96px;
  height: 64px;
  object-fit: cover;
}
.composer-attach-remove {
  position: absolute;
  top: -6px;
  right: -6px;
  border-radius: 999px;
  background: var(--surface-card, #fff) !important;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.12);
}
.composer-preview-full {
  display: block;
  width: 100%;
  max-height: 78vh;
  object-fit: contain;
  border-radius: 8px;
  background: #111;
}
.composer-resize-handle {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 8px;
  margin: -4px 0 2px;
  cursor: ns-resize;
  color: var(--muted);
  border-top: 1px solid var(--hairline);
  user-select: none;
}
.composer-resize-handle:hover {
  background: var(--surface-soft);
  color: var(--primary);
}
.composer-input {
  width: 100%;
  max-width: 100%;
  box-sizing: border-box;
  resize: none;
  min-height: 72px;
  border-radius: 10px;
  border: 1px solid var(--hairline);
  padding: 10px 12px;
  background: var(--canvas);
  color: var(--body);
  font-size: 14px;
  line-height: 1.45;
}
.composer-input-fill {
  flex: 1;
  min-height: 72px;
}
.spacer {
  flex: 1;
}
.icon-btn {
  border: none;
  background: transparent;
  cursor: pointer;
  padding: 2px;
  color: var(--muted);
  display: inline-flex;
}
.voice-hint {
  margin: 0;
  font-size: 12px;
  color: var(--muted);
}
.queue-list {
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px dashed var(--hairline);
  background: var(--surface-soft);
  font-size: 12px;
}
.queue-list-head {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
  font-weight: 600;
}
.queue-items {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.queue-item {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--muted);
}
.queue-idx {
  font-size: 10px;
  font-weight: 700;
  color: var(--primary);
  min-width: 16px;
}
.queue-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
