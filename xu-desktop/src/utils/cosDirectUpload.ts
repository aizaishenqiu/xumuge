/**
 * @file cosDirectUpload.ts 浏览器直传对象存储（签发 → PUT → 登记）
 * @author qiuye <yjk150@qq.com>
 * @date 2026-09-02
 * @version 1.1.0
 * @category Network
 * @algo presign-put-complete
 */
import { fouAlert } from "foucui";
import { cloudRequest } from "./request";

export type CosUploadPurpose =
  | "avatar_thumb"
  | "avatar_full"
  | "software_file"
  | "software_cover"
  | "software_icon"
  | "software_shot"
  | "release_asset"
  | "bug_report"
  | "realname_id"
  | "realname_face"
  | "attach_thumb"
  | "attach_full";

export type CosCompleteResult = {
  objectKey?: string;
  url?: string;
  thumbUrl?: string;
  fullUrl?: string;
  purpose?: string;
  expiresIn?: number;
  fileId?: string;
  coverUrl?: string;
  assetPath?: string;
  avatarRev?: number;
  attachmentId?: string;
  ready?: boolean;
};

type SessionPayload = {
  sessionId: string;
  uploadUrl: string;
  method?: string;
  headers?: Record<string, string>;
  objectKey: string;
};

/**
 * Duty: 向业务端申请临时上传地址，直传对象存储后完成登记。
 * 依赖: POST /storage/upload-session、PUT COS、POST /storage/complete
 * 失败: fouAlert；抛错由调用方捕获
 */
export async function cosDirectUpload(opts: {
  purpose: CosUploadPurpose | string;
  file: Blob;
  fileName?: string;
  contentType?: string;
  refId?: string;
  meta?: Record<string, unknown>;
  onProgress?: (pct: number) => void;
}): Promise<CosCompleteResult> {
  const fileName =
    opts.fileName || (opts.file instanceof File && opts.file.name) || "file.bin";
  const contentType =
    opts.contentType ||
    (opts.file instanceof File && opts.file.type) ||
    "application/octet-stream";
  const sizeBytes = opts.file.size;
  if (!sizeBytes) {
    void fouAlert("文件为空，请重新选择", "提示");
    throw new Error("empty file");
  }

  const sessRes = await cloudRequest<SessionPayload>({
    url: "/storage/upload-session",
    method: "POST",
    data: {
      purpose: opts.purpose,
      fileName,
      contentType,
      sizeBytes,
      refId: opts.refId || "",
    },
  });
  const sess = sessRes?.data;
  if (!sess?.uploadUrl || !sess.sessionId || !sess.objectKey) {
    void fouAlert("无法开始上传，请稍后重试", "提示");
    throw new Error("no upload session");
  }

  await putBlob(sess.uploadUrl, opts.file, sess.headers || {}, opts.onProgress);

  const doneRes = await cloudRequest<CosCompleteResult>({
    url: "/storage/complete",
    method: "POST",
    data: {
      sessionId: sess.sessionId,
      objectKey: sess.objectKey,
      meta: opts.meta || {},
    },
  });
  return (doneRes?.data || {}) as CosCompleteResult;
}

/**
 * Duty: 创建附件行后双传缩略图+原图。
 * 依赖: POST /storage/attachments、attach_thumb/attach_full
 */
export async function uploadImageAttachment(opts: {
  purpose: string;
  file: File;
  bizRef?: string;
  thumbMax?: number;
  onProgress?: (pct: number) => void;
}): Promise<CosCompleteResult & { attachmentId: string }> {
  const created = await cloudRequest<{ attachmentId?: string }>({
    url: "/storage/attachments",
    method: "POST",
    data: {
      purpose: opts.purpose,
      fileName: opts.file.name || "image.jpg",
      mime: opts.file.type || "image/jpeg",
      bizRef: opts.bizRef || "",
    },
  });
  const attachmentId = String(created?.data?.attachmentId || "");
  if (!attachmentId) {
    void fouAlert("无法创建附件，请稍后重试", "提示");
    throw new Error("no attachment");
  }
  const thumbBlob = await resizeImageBlob(opts.file, opts.thumbMax || 256);
  const thumbFile = new File([thumbBlob], "thumb.jpg", { type: "image/jpeg" });
  await cosDirectUpload({
    purpose: "attach_thumb",
    file: thumbFile,
    fileName: "thumb.jpg",
    contentType: "image/jpeg",
    refId: attachmentId,
    onProgress: opts.onProgress ? (p) => opts.onProgress?.(Math.round(p * 0.4)) : undefined,
  });
  const full = await cosDirectUpload({
    purpose: "attach_full",
    file: opts.file,
    fileName: opts.file.name || "image.jpg",
    contentType: opts.file.type || "image/jpeg",
    refId: attachmentId,
    onProgress: opts.onProgress
      ? (p) => opts.onProgress?.(40 + Math.round(p * 0.6))
      : undefined,
  });
  return { ...full, attachmentId: String(full.attachmentId || attachmentId) };
}

/**
 * Duty: 点开大图时再签发 full URL。
 */
export async function accessAttachmentFull(attachmentId: string): Promise<string> {
  const res = await cloudRequest<{ url?: string }>({
    url: `/storage/attachments/${encodeURIComponent(attachmentId)}/access`,
    method: "POST",
    data: { variant: "full" },
  });
  return String(res?.data?.url || "");
}

function putBlob(
  url: string,
  body: Blob,
  headers: Record<string, string>,
  onProgress?: (pct: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    for (const [k, v] of Object.entries(headers)) {
      if (v != null && String(v) !== "") xhr.setRequestHeader(k, String(v));
    }
    xhr.upload.onprogress = (ev) => {
      if (onProgress && ev.lengthComputable && ev.total > 0) {
        onProgress(Math.round((ev.loaded / ev.total) * 100));
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
        return;
      }
      void fouAlert("文件上传失败，请稍后重试", "提示");
      reject(new Error(`put ${xhr.status}`));
    };
    xhr.onerror = () => {
      void fouAlert("网络异常，上传未完成", "提示");
      reject(new Error("put network"));
    };
    xhr.send(body);
  });
}

function resizeImageBlob(file: Blob, maxEdge: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      let w = img.naturalWidth || img.width;
      let h = img.naturalHeight || img.height;
      if (w <= 0 || h <= 0) {
        reject(new Error("bad image"));
        return;
      }
      if (w > maxEdge || h > maxEdge) {
        if (w >= h) {
          h = Math.max(1, Math.round((h * maxEdge) / w));
          w = maxEdge;
        } else {
          w = Math.max(1, Math.round((w * maxEdge) / h));
          h = maxEdge;
        }
      }
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("no canvas"));
        return;
      }
      ctx.drawImage(img, 0, 0, w, h);
      canvas.toBlob(
        (b) => {
          if (!b) reject(new Error("encode"));
          else resolve(b);
        },
        "image/jpeg",
        0.85,
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("decode"));
    };
    img.src = url;
  });
}
