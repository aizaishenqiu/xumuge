/**
 * @file flowExport.ts 流程板导出 PNG / JPG / PDF
 * @author qiuye <yjk150@qq.com>
 * @date 2026-09-07
 * @version 1.0.0
 * @category Cache
 * @algo html-to-image-flow-export
 */
import { invoke } from "@tauri-apps/api/core";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { toJpeg, toPng } from "html-to-image";
import { mkdirRecursive } from "../utils/fsBridge";
import { CANVAS_EXPORT_DIR } from "./sketchExport";
import { canvasAbs } from "./canvasIo";

export type FlowExportKind = "png" | "jpg" | "pdf";

async function writeUserPath(path: string, bytes: Uint8Array): Promise<void> {
  await invoke("xu_write_bytes_file", { path, bytes: Array.from(bytes) });
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const i = dataUrl.indexOf(",");
  const b64 = i >= 0 ? dataUrl.slice(i + 1) : dataUrl;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let n = 0; n < bin.length; n++) out[n] = bin.charCodeAt(n);
  return out;
}

/** Duty: JPEG 字节包装为单页 PDF（与草图导出同构）。 */
function jpegPdf(w: number, h: number, jpeg: Uint8Array): Uint8Array {
  const encoder = new TextEncoder();
  const objects = [
    "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj",
    "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj",
    `3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Contents 4 0 R /Resources << /XObject << /Im0 5 0 R >> >> >> endobj`,
    (() => {
      const content = `${w} 0 0 ${h} 0 0 cm /Im0 Do\n`;
      return `4 0 obj << /Length ${content.length} >> stream\n${content}endstream endobj`;
    })(),
  ];
  const imgDict = `5 0 obj << /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >> stream\n`;
  const out: Uint8Array[] = [];
  let len = 0;
  const append = (u: Uint8Array) => {
    out.push(u);
    len += u.length;
  };
  const appendStr = (s: string) => append(encoder.encode(s));
  appendStr("%PDF-1.4\n");
  const locs: number[] = [0];
  for (const obj of objects) {
    locs.push(len);
    appendStr(obj + "\n");
  }
  locs.push(len);
  appendStr(imgDict);
  append(jpeg);
  appendStr("\nendstream endobj\n");
  const xrefAt = len;
  let xrefS = `xref\n0 6\n0000000000 65535 f \n`;
  for (let i = 1; i <= 5; i++) {
    xrefS += `${String(locs[i]).padStart(10, "0")} 00000 n \n`;
  }
  appendStr(xrefS);
  appendStr(`trailer << /Size 6 /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF`);
  const bin = new Uint8Array(len);
  let o = 0;
  for (const c of out) {
    bin.set(c, o);
    o += c.length;
  }
  return bin;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("无法解码导出图"));
    img.src = url;
  });
}

/**
 * Duty: 将流程视口导出为 PNG/JPG/PDF；弹出另存为并镜像到 .xu/canvas/export/。
 * @returns 用户选择的保存路径，取消则为 null
 */
export async function exportFlowBoard(
  workspace: string,
  el: HTMLElement,
  kind: FlowExportKind,
  baseName = "flow",
): Promise<string | null> {
  const pixelRatio = 2;
  const filter = (node: HTMLElement) => {
    const cls = typeof node.className === "string" ? node.className : "";
    return !cls.includes("vue-flow__minimap") && !cls.includes("vue-flow__controls");
  };
  let bytes: Uint8Array;
  let ext: string;
  if (kind === "png") {
    const url = await toPng(el, { pixelRatio, cacheBust: true, filter });
    bytes = dataUrlToBytes(url);
    ext = "png";
  } else if (kind === "jpg") {
    const url = await toJpeg(el, { pixelRatio, quality: 0.92, cacheBust: true, filter, backgroundColor: "#ffffff" });
    bytes = dataUrlToBytes(url);
    ext = "jpg";
  } else {
    const url = await toJpeg(el, { pixelRatio, quality: 0.92, cacheBust: true, filter, backgroundColor: "#ffffff" });
    const img = await loadImage(url);
    const jpeg = dataUrlToBytes(url);
    bytes = jpegPdf(img.naturalWidth || img.width, img.naturalHeight || img.height, jpeg);
    ext = "pdf";
  }

  const filters =
    kind === "png"
      ? [{ name: "PNG", extensions: ["png"] }]
      : kind === "jpg"
        ? [{ name: "JPEG", extensions: ["jpg", "jpeg"] }]
        : [{ name: "PDF", extensions: ["pdf"] }];
  const path = await saveDialog({
    defaultPath: `${baseName}.${ext}`,
    filters,
  });
  if (typeof path !== "string" || !path.trim()) return null;
  await writeUserPath(path.trim(), bytes);
  if (workspace.trim()) {
    await mkdirRecursive(workspace, CANVAS_EXPORT_DIR);
    const mirror = canvasAbs(workspace, `${CANVAS_EXPORT_DIR}/${baseName}.${ext}`);
    await writeUserPath(mirror, bytes);
  }
  return path.trim();
}
