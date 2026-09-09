import { invoke } from "@tauri-apps/api/core";
import { mkdirRecursive } from "./fsBridge";
import { resolveAbsPath } from "./chatWorkspace";

/** Vision model replied but clearly did not see the image. */
export function isVisionLikelyFailed(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  return /未附|没有.*图|未收到.*图|请提供.*图|attach.*(picture|image)|no image|haven'?t attached|without.*image|未上传|没有收到图片/i.test(
    t,
  );
}

function safeFilename(name: string): string {
  const base = name.trim() || "attachment.png";
  return base.replace(/[^\w.\-()+[\]@]+/g, "_").slice(0, 80);
}

function convertDataUrlToPng(dataUrl: string): Promise<string> {
  if (dataUrl.startsWith("data:image/png")) return Promise.resolve(dataUrl);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth || img.width;
      canvas.height = img.naturalHeight || img.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("无法创建画布"));
        return;
      }
      ctx.drawImage(img, 0, 0);
      resolve(canvas.toDataURL("image/png"));
    };
    img.onerror = () => reject(new Error("图片解码失败"));
    img.src = dataUrl;
  });
}

/** Save chat attachment under workspace/.xu/inbox for view_image fallback. */
export async function saveChatImageToWorkspace(
  workspace: string,
  dataUrl: string,
  filename: string,
): Promise<string> {
  const ws = workspace.trim();
  if (!ws) throw new Error("未选择工作区");
  const rel = `.xu/inbox/${Date.now()}-${safeFilename(filename)}`.replace(/\.[^.]+$/, "") + ".png";
  await mkdirRecursive(ws, ".xu/inbox");
  const abs = resolveAbsPath(ws, rel);
  const pngDataUrl = await convertDataUrlToPng(dataUrl);
  await invoke("xu_write_png_file", { path: abs, pngBase64: pngDataUrl });
  return rel.replace(/\\/g, "/");
}
