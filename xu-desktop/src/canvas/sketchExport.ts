/**
 * @file sketchExport.ts 草图导出 SVG / PNG / PDF / DXF
 * @author qiuye <yjk150@qq.com>
 * @updated 2026-09-07
 * @version 1.5.0
 * @category Cache
 * @algo svg-png-pdf-dxf
 */
import { invoke } from "@tauri-apps/api/core";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { mkdirRecursive, writeTextUnderWorkspace } from "../utils/fsBridge";
import { canvasAbs } from "./canvasIo";
import { canvasJpegBytes, canvasPngBytes } from "./sketchPaint";
import { pxToRealMm, DEFAULT_PAPER_BG, type PaperState } from "./sketchPaper";
import {
  curveToPath,
  dashArrayOf,
  gradientDefXml,
  isLinearFill,
  solidFillAttr,
  styleOf,
  type Stroke,
} from "./sketchTypes";

export const CANVAS_EXPORT_DIR = ".xu/canvas/export";

export type PageSize = { w: number; h: number };

function xmlEsc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
}

function fillAttr(s: Stroke, st: ReturnType<typeof styleOf>): string {
  if (s.kind === "text") return st.color;
  if (isLinearFill(st.fill)) return `url(#g-${xmlEsc(s.id)})`;
  return solidFillAttr(st.fill);
}

function gradientDef(s: Stroke): string {
  const st = styleOf(s);
  if (!isLinearFill(st.fill)) return "";
  return gradientDefXml(s.id, st.fill);
}

function dashAttr(st: ReturnType<typeof styleOf>): string {
  const d = dashArrayOf(st.dash, st.width);
  return d ? ` stroke-dasharray="${d}"` : "";
}

function strokeSvg(s: Stroke): string {
  if (s.hidden) return "";
  const st = styleOf(s);
  const fill = fillAttr(s, st);
  const sw = st.width;
  const c = st.color;
  const op = st.opacity ?? 1;
  const opa = op < 1 ? ` opacity="${op}"` : "";
  const dash = dashAttr(st);
  switch (s.kind) {
    case "path":
      return `<path d="${xmlEsc(s.d)}" fill="none" stroke="${c}" stroke-width="${sw}"${dash}${opa}/>`;
    case "curve":
      return `<path d="${xmlEsc(curveToPath(s.points))}" fill="none" stroke="${c}" stroke-width="${sw}"${dash}${opa}/>`;
    case "line":
      return `<line x1="${s.x1}" y1="${s.y1}" x2="${s.x2}" y2="${s.y2}" stroke="${c}" stroke-width="${sw}"${dash}${opa}/>`;
    case "arrow":
    case "dim": {
      const label =
        s.kind === "dim"
          ? `<text x="${(s.x1 + s.x2) / 2}" y="${(s.y1 + s.y2) / 2 - 6}" fill="${c}" font-size="12"${opa}>${xmlEsc(s.label)}</text>`
          : "";
      const dimDash = s.kind === "dim" && !dash ? ` stroke-dasharray="4 3"` : dash;
      return `<line x1="${s.x1}" y1="${s.y1}" x2="${s.x2}" y2="${s.y2}" stroke="${c}" stroke-width="${sw}"${dimDash}${opa}/>${label}`;
    }
    case "rect": {
      const rx = typeof s.rx === "number" && s.rx > 0 ? Math.min(s.rx, Math.abs(s.w) / 2, Math.abs(s.h) / 2) : 0;
      const rr = rx > 0 ? ` rx="${rx}" ry="${rx}"` : "";
      return `<rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}"${rr} fill="${fill}" stroke="${c}" stroke-width="${sw}"${dash}${opa}/>`;
    }
    case "ellipse":
      return `<ellipse cx="${s.cx}" cy="${s.cy}" rx="${s.rx}" ry="${s.ry}" fill="${fill}" stroke="${c}" stroke-width="${sw}"${dash}${opa}/>`;
    case "text": {
      const fs = st.fontSize ?? 18;
      const ff = xmlEsc(st.fontFamily || "ui-sans-serif, system-ui, sans-serif");
      const fw = st.fontBold ? ` font-weight="700"` : "";
      const lines = (s.text || "").split("\n");
      if (lines.length <= 1) {
        return `<text x="${s.x}" y="${s.y}" fill="${c}" font-size="${fs}" font-family="${ff}"${fw}${opa}>${xmlEsc(s.text)}</text>`;
      }
      const tspans = lines
        .map((line, i) =>
          i === 0
            ? `<tspan x="${s.x}" y="${s.y}">${xmlEsc(line)}</tspan>`
            : `<tspan x="${s.x}" dy="${(fs * 1.35).toFixed(1)}">${xmlEsc(line)}</tspan>`,
        )
        .join("");
      return `<text fill="${c}" font-size="${fs}" font-family="${ff}"${fw}${opa}>${tspans}</text>`;
    }
    case "polygon": {
      const pts = s.points.map((p) => `${p.x},${p.y}`).join(" ");
      return `<polygon points="${pts}" fill="${fill}" stroke="${c}" stroke-width="${sw}"${dash}${opa}/>`;
    }
    case "image":
      // SVG 导出不含贴图位图（请用 PNG）；占位注释
      return `<!-- image omitted: ${xmlEsc(s.id)} -->`;
    default:
      return "";
  }
}

/** Duty: 生成整页 SVG 字符串。 */
export function strokesToSvg(strokes: Stroke[], page: PageSize): string {
  const defs = strokes.map(gradientDef).join("");
  const body = strokes.map(strokeSvg).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${page.w}" height="${page.h}" viewBox="0 0 ${page.w} ${page.h}"><defs>${defs}</defs>${body}</svg>`;
}

/** Duty: 把 SVG 栅格到已有画布（白色底已由调用方处理）。 */
export async function drawSvgOnto(ctx: CanvasRenderingContext2D, svg: string): Promise<void> {
  const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("SVG 转图失败"));
      el.src = url;
    });
    ctx.drawImage(img, 0, 0);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Duty: 纸面底色 + 像素层 + 矢量合成 PNG。 */
export async function compositePng(
  page: PageSize,
  paint: HTMLCanvasElement | null,
  strokes: Stroke[],
  bg = DEFAULT_PAPER_BG,
): Promise<Uint8Array> {
  const canvas = document.createElement("canvas");
  canvas.width = page.w;
  canvas.height = page.h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("无法创建画布");
  ctx.fillStyle = bg || DEFAULT_PAPER_BG;
  ctx.fillRect(0, 0, page.w, page.h);
  if (paint) ctx.drawImage(paint, 0, 0);
  await drawSvgOnto(ctx, strokesToSvg(strokes, page));
  return canvasPngBytes(canvas);
}

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

/** Duty: 合成页转 JPEG 单页 PDF。 */
export async function compositePdf(
  page: PageSize,
  paint: HTMLCanvasElement | null,
  strokes: Stroke[],
  bg = DEFAULT_PAPER_BG,
): Promise<Uint8Array> {
  const canvas = document.createElement("canvas");
  canvas.width = page.w;
  canvas.height = page.h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("无法创建画布");
  ctx.fillStyle = bg || DEFAULT_PAPER_BG;
  ctx.fillRect(0, 0, page.w, page.h);
  if (paint) ctx.drawImage(paint, 0, 0);
  await drawSvgOnto(ctx, strokesToSvg(strokes, page));
  const jpeg = await canvasJpegBytes(canvas);
  return jpegPdf(page.w, page.h, jpeg);
}

function dxfPair(code: number, val: string | number): string {
  return `${code}\n${val}\n`;
}

function toMm(px: number, paper: PaperState): number {
  return pxToRealMm(px, paper);
}

/** Duty: 生成 R12 ASCII DXF（毫米）。 */
export function strokesToDxf(strokes: Stroke[], paper: PaperState): string {
  const ents: string[] = [];
  const pushLine = (x1: number, y1: number, x2: number, y2: number) => {
    ents.push(
      dxfPair(0, "LINE") +
        dxfPair(8, "0") +
        dxfPair(10, toMm(x1, paper)) +
        dxfPair(20, -toMm(y1, paper)) +
        dxfPair(11, toMm(x2, paper)) +
        dxfPair(21, -toMm(y2, paper)),
    );
  };
  for (const s of strokes) {
    if (s.hidden) continue;
    switch (s.kind) {
      case "line":
      case "arrow":
      case "dim":
        pushLine(s.x1, s.y1, s.x2, s.y2);
        if (s.kind === "dim") {
          ents.push(
            dxfPair(0, "TEXT") +
              dxfPair(8, "0") +
              dxfPair(10, toMm((s.x1 + s.x2) / 2, paper)) +
              dxfPair(20, -toMm((s.y1 + s.y2) / 2, paper)) +
              dxfPair(40, 12) +
              dxfPair(1, s.label),
          );
        }
        break;
      case "rect":
        pushLine(s.x, s.y, s.x + s.w, s.y);
        pushLine(s.x + s.w, s.y, s.x + s.w, s.y + s.h);
        pushLine(s.x + s.w, s.y + s.h, s.x, s.y + s.h);
        pushLine(s.x, s.y + s.h, s.x, s.y);
        break;
      case "ellipse":
        ents.push(
          dxfPair(0, "CIRCLE") +
            dxfPair(8, "0") +
            dxfPair(10, toMm(s.cx, paper)) +
            dxfPair(20, -toMm(s.cy, paper)) +
            dxfPair(40, toMm(Math.max(s.rx, s.ry), paper)),
        );
        break;
      case "polygon":
      case "curve": {
        const pts = s.points;
        for (let i = 0; i < pts.length; i++) {
          const a = pts[i]!;
          const b = pts[(i + 1) % pts.length]!;
          if (s.kind === "curve" && i === pts.length - 1) break;
          pushLine(a.x, a.y, b.x, b.y);
        }
        break;
      }
      case "text":
        ents.push(
          dxfPair(0, "TEXT") +
            dxfPair(8, "0") +
            dxfPair(10, toMm(s.x, paper)) +
            dxfPair(20, -toMm(s.y, paper)) +
            dxfPair(40, 12) +
            dxfPair(1, s.text),
        );
        break;
      case "path": {
        const nums = s.d.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
        for (let i = 0; i + 3 < nums.length; i += 2) {
          pushLine(nums[i]!, nums[i + 1]!, nums[i + 2]!, nums[i + 3]!);
        }
        break;
      }
      default:
        break;
    }
  }
  return (
    dxfPair(0, "SECTION") +
    dxfPair(2, "ENTITIES") +
    ents.join("") +
    dxfPair(0, "ENDSEC") +
    dxfPair(0, "EOF")
  );
}

async function writeUserPath(path: string, bytes: Uint8Array): Promise<void> {
  await invoke("xu_write_bytes_file", { path, bytes: Array.from(bytes) });
}

export type ExportKind = "png" | "pdf" | "dxf" | "svg";

export type ExportOpts = {
  page: PageSize;
  paper: PaperState;
  paint: HTMLCanvasElement | null;
  scope?: "page" | "layer";
  layerId?: string;
  includePaint?: boolean;
};

/** Duty: 弹出另存为，并同步写入工作区 export 目录。 */
export async function exportSketch(
  workspace: string,
  strokes: Stroke[],
  kind: ExportKind,
  opts: ExportOpts,
): Promise<string | null> {
  const filters =
    kind === "png"
      ? [{ name: "PNG", extensions: ["png"] }]
      : kind === "pdf"
        ? [{ name: "PDF", extensions: ["pdf"] }]
        : kind === "svg"
          ? [{ name: "SVG", extensions: ["svg"] }]
          : [{ name: "DXF", extensions: ["dxf"] }];
  const defaultName =
    opts.scope === "layer" && opts.layerId
      ? `sketch-layer.${kind}`
      : `sketch.${kind}`;
  const picked = await saveDialog({ defaultPath: defaultName, filters });
  const includePaint = opts.includePaint !== false && opts.scope !== "layer";
  const paint = includePaint ? opts.paint : null;
  let bytes: Uint8Array;
  let text: string | null = null;
  if (kind === "png") bytes = await compositePng(opts.page, paint, strokes, opts.paper.bg);
  else if (kind === "pdf") bytes = await compositePdf(opts.page, paint, strokes, opts.paper.bg);
  else if (kind === "svg") {
    text = strokesToSvg(strokes, opts.page);
    bytes = new TextEncoder().encode(text);
  } else {
    text = strokesToDxf(strokes, opts.paper);
    bytes = new TextEncoder().encode(text);
  }
  await mkdirRecursive(workspace, CANVAS_EXPORT_DIR);
  const rel =
    opts.scope === "layer"
      ? `${CANVAS_EXPORT_DIR}/layer.${kind}`
      : `${CANVAS_EXPORT_DIR}/board.${kind}`;
  if (text != null) {
    await writeTextUnderWorkspace(workspace, rel, text);
  } else {
    await writeUserPath(canvasAbs(workspace, rel), bytes);
  }
  if (typeof picked === "string" && picked.trim()) {
    await writeUserPath(picked.trim(), bytes);
    return picked.trim();
  }
  return canvasAbs(workspace, rel);
}
