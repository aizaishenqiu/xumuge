/**
 * @file sketchPaint.ts 像素层画笔与填充
 * @author qiuye <yjk150@qq.com>
 * @date 2026-09-06
 * @version 1.0.0
 * @category Cache
 * @algo raster-brush-flood
 */

/** Duty: 解析 #rgb / #rrggbb 为 RGBA。 */
export function hexRgba(hex: string, alpha: number): [number, number, number, number] {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h.slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, Math.round(Math.max(0, Math.min(1, alpha)) * 255)];
}

/** Duty: 连通填充像素。 */
export function floodFill(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  fill: [number, number, number, number],
): void {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  const x = Math.floor(x0);
  const y = Math.floor(y0);
  if (x < 0 || y < 0 || x >= w || y >= h) return;
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const i0 = (y * w + x) * 4;
  const tr = d[i0]!;
  const tg = d[i0 + 1]!;
  const tb = d[i0 + 2]!;
  const ta = d[i0 + 3]!;
  if (tr === fill[0] && tg === fill[1] && tb === fill[2] && ta === fill[3]) return;
  const match = (i: number) =>
    d[i] === tr && d[i + 1] === tg && d[i + 2] === tb && d[i + 3] === ta;
  const stack: number[] = [x, y];
  while (stack.length) {
    const cy = stack.pop()!;
    const cx = stack.pop()!;
    let px = cx;
    while (px >= 0 && match((cy * w + px) * 4)) px -= 1;
    px += 1;
    let spanUp = false;
    let spanDown = false;
    while (px < w && match((cy * w + px) * 4)) {
      const i = (cy * w + px) * 4;
      d[i] = fill[0];
      d[i + 1] = fill[1];
      d[i + 2] = fill[2];
      d[i + 3] = fill[3];
      if (!spanUp && cy > 0 && match(((cy - 1) * w + px) * 4)) {
        stack.push(px, cy - 1);
        spanUp = true;
      } else if (spanUp && cy > 0 && !match(((cy - 1) * w + px) * 4)) {
        spanUp = false;
      }
      if (!spanDown && cy < h - 1 && match(((cy + 1) * w + px) * 4)) {
        stack.push(px, cy + 1);
        spanDown = true;
      } else if (spanDown && cy < h - 1 && !match(((cy + 1) * w + px) * 4)) {
        spanDown = false;
      }
      px += 1;
    }
  }
  ctx.putImageData(img, 0, 0);
}

/** Duty: 空白像素层。 */
export function clearPaint(ctx: CanvasRenderingContext2D): void {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
}

/** Duty: 把 PNG data URL 画到像素层。 */
export async function drawDataUrl(ctx: CanvasRenderingContext2D, dataUrl: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      ctx.drawImage(img, 0, 0);
      resolve();
    };
    img.onerror = () => reject(new Error("像素层载入失败"));
    img.src = dataUrl;
  });
}

/** Duty: canvas → PNG 字节。 */
export async function canvasPngBytes(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("PNG 编码失败"))), "image/png");
  });
  return new Uint8Array(await blob.arrayBuffer());
}

/** Duty: canvas → JPEG 字节（嵌入 PDF）。 */
export async function canvasJpegBytes(canvas: HTMLCanvasElement, quality = 0.85): Promise<Uint8Array> {
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("JPEG 编码失败"))), "image/jpeg", quality);
  });
  return new Uint8Array(await blob.arrayBuffer());
}
