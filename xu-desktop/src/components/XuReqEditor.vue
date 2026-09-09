<!--
  @file WangEditor 富文本（需求 / 问题反馈共用）；支持粘贴插图
  @author qiuye <yjk150@qq.com>
  @date 2026-08-22
  @updated 2026-09-02
  @version 1.3.0
  @category UI
  @algo none
-->
<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, shallowRef, watch } from "vue";
import { fouAlert } from "foucui";
import {
  createEditor,
  createToolbar,
  type IDomEditor,
  type IEditorConfig,
} from "@wangeditor/editor";
import "@wangeditor/editor/dist/css/style.css";

const props = withDefaults(
  defineProps<{
    placeholder?: string;
    /** 自定义插图：返回可插入的 src；缺省则 dataURL 内嵌 */
    uploadImage?: (file: File) => Promise<string>;
  }>(),
  { placeholder: "填写功能需求；可用标题区分模块…" },
);

const model = defineModel<string>({ default: "" });

const editorRef = shallowRef<IDomEditor | null>(null);
const editorEl = shallowRef<HTMLDivElement | null>(null);
const toolbarEl = shallowRef<HTMLDivElement | null>(null);

/** 外部 setHtml 时忽略 onChange，避免输入时回写死循环 */
let applyingExternal = false;

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("读取图片失败"));
    reader.readAsDataURL(file);
  });
}

function sameEditorHtml(a: string, b: string): boolean {
  const norm = (s: string) =>
    String(s || "")
      .replace(/\s+/g, " ")
      .replace(/ >/g, ">")
      .trim();
  return norm(a) === norm(b);
}

/** Duty: 统一走 uploadImage（压缩）或内嵌 dataURL。失败上抛（有 uploadImage 时由页面弹窗）。 */
async function resolveImageSrc(file: File): Promise<string> {
  if (props.uploadImage) {
    return await props.uploadImage(file);
  }
  return await readAsDataUrl(file);
}

function dataUrlToFile(dataUrl: string, index: number): File | null {
  const m = /^data:(image\/[\w+.-]+);base64,(.+)$/i.exec(dataUrl.trim());
  if (!m?.[1] || !m[2]) return null;
  const mime = m[1].toLowerCase();
  const bin = atob(m[2].replace(/\s+/g, ""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const ext = mime.includes("png")
    ? "png"
    : mime.includes("webp")
      ? "webp"
      : mime.includes("gif")
        ? "gif"
        : "jpg";
  return new File([bytes], `paste-${index}.${ext}`, { type: mime });
}

function collectClipboardImageFiles(event: ClipboardEvent): File[] {
  const out: File[] = [];
  const items = event.clipboardData?.items;
  if (items) {
    for (let i = 0; i < items.length; i++) {
      const it = items[i]!;
      if (it.kind === "file" && it.type.startsWith("image/")) {
        const f = it.getAsFile();
        if (f) out.push(f);
      }
    }
  }
  const files = event.clipboardData?.files;
  if (files) {
    for (let i = 0; i < files.length; i++) {
      const f = files[i]!;
      if (f.type.startsWith("image/") && !out.some((x) => x.name === f.name && x.size === f.size)) {
        out.push(f);
      }
    }
  }
  return out;
}

onMounted(() => {
  if (!editorEl.value || !toolbarEl.value) return;
  const editorConfig: Partial<IEditorConfig> = {
    placeholder: props.placeholder,
    onChange(editor) {
      if (applyingExternal) return;
      model.value = editor.getHtml();
    },
    customPaste(editor, event) {
      const clipEvent = event as ClipboardEvent;
      const files = collectClipboardImageFiles(clipEvent);
      const html = clipEvent.clipboardData?.getData("text/html") || "";
      const dataUrls = [...html.matchAll(/src=["'](data:image\/[^"']+)["']/gi)].map((x) => x[1]!);

      if (!files.length && !dataUrls.length) {
        return true;
      }

      clipEvent.preventDefault();
      void (async () => {
        try {
          for (const file of files) {
            const url = await resolveImageSrc(file);
            editor.dangerouslyInsertHtml(`<p><img src="${url}" alt="" /></p>`);
          }
          if (dataUrls.length && !files.length) {
            let nextHtml = html;
            for (let i = 0; i < dataUrls.length; i++) {
              const src = dataUrls[i]!;
              const file = dataUrlToFile(src, i);
              if (!file) continue;
              const url = await resolveImageSrc(file);
              nextHtml = nextHtml.split(src).join(url);
            }
            const tmp = document.createElement("div");
            tmp.innerHTML = nextHtml;
            for (const img of [...tmp.querySelectorAll("img")]) {
              const s = img.getAttribute("src") || "";
              if (s.startsWith("data:image/")) img.remove();
            }
            const text = (tmp.textContent || "").trim();
            for (const img of [...tmp.querySelectorAll("img")]) {
              const s = img.getAttribute("src") || "";
              if (s) editor.dangerouslyInsertHtml(`<p><img src="${s}" alt="" /></p>`);
            }
            if (text) editor.insertText(text);
          } else if (dataUrls.length && files.length) {
            const tmp = document.createElement("div");
            tmp.innerHTML = html;
            const text = (tmp.textContent || "").trim();
            if (text) editor.insertText(text);
          }
        } catch (e) {
          console.warn("[XuReqEditor] customPaste", e);
          if (!props.uploadImage) {
            void fouAlert("截图未能加入正文", "提示");
          }
        }
      })();
      return false;
    },
    MENU_CONF: {
      uploadImage: {
        async customUpload(file: File, insertFn: (url: string, alt: string, href: string) => void) {
          try {
            const url = await resolveImageSrc(file);
            insertFn(url, "", "");
          } catch (e) {
            console.warn("[XuReqEditor] uploadImage", e);
            if (!props.uploadImage) {
              void fouAlert("截图未能加入正文", "提示");
            }
            throw e;
          }
        },
      },
    },
  };
  const editor = createEditor({
    selector: editorEl.value,
    html: model.value || "<p></p>",
    config: editorConfig,
    mode: "default",
  });
  createToolbar({
    editor,
    selector: toolbarEl.value,
    mode: "default",
  });
  editorRef.value = editor;
});

watch(model, (html) => {
  const ed = editorRef.value;
  if (!ed || applyingExternal) return;
  const next = html || "<p></p>";
  let cur = "";
  try {
    cur = ed.getHtml();
  } catch {
    return;
  }
  if (sameEditorHtml(cur, next)) return;
  applyingExternal = true;
  try {
    ed.setHtml(next);
  } catch (e) {
    console.warn("[XuReqEditor] setHtml", e);
  } finally {
    void nextTick(() => {
      applyingExternal = false;
    });
  }
});

onBeforeUnmount(() => {
  editorRef.value?.destroy();
  editorRef.value = null;
});
</script>

<template>
  <div class="xu-req-editor">
    <div ref="toolbarEl" class="xu-req-toolbar" />
    <div ref="editorEl" class="xu-req-body" />
  </div>
</template>

<style scoped>
.xu-req-editor {
  border: 1px solid var(--border, #d0d5dd);
  border-radius: 8px;
  overflow: hidden;
  background: #fff;
}
.xu-req-toolbar {
  border-bottom: 1px solid var(--border, #e5e7eb);
}
.xu-req-body {
  min-height: 220px;
  max-height: 360px;
  overflow-y: auto;
}
.xu-req-body :deep(.w-e-text-container) {
  background: #fff !important;
}
.xu-req-body :deep(img) {
  max-width: 100%;
  height: auto;
}
</style>
