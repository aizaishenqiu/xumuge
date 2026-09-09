/**
 * foucui@2.3.x FouTableCellContent 闭包内误用 h()；setup 中 y 已被 ref 遮蔽，须用 m（createVNode）。
 * 修补 dist 并清除 Vite 预构建缓存。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const marker = "/* fou-table-h-patch-v2 */";
const distTarget = path.join(root, "node_modules", "foucui", "dist", "foucui.js");
const viteCacheDir = path.join(root, "node_modules", ".vite");

const CELL_START = 'name: "FouTableCellContent"';
const CELL_END = "}), ji =";

function patchFouTableCellContent(src) {
  const start = src.indexOf(CELL_START);
  if (start === -1) return src;
  const end = src.indexOf(CELL_END, start);
  if (end === -1) return src;
  const endPos = end + CELL_END.length;
  const head = src.slice(0, start);
  const block = src.slice(start, endPos);
  const tail = src.slice(endPos);
  if (!block.includes('class: "xu-table__text"')) return src;
  const nextBlock = block.replace(/\b[hy]\(/g, "m(");
  if (nextBlock === block) return src;
  return head + nextBlock + tail;
}

function patchDist(filePath) {
  if (!fs.existsSync(filePath)) return false;
  let src = fs.readFileSync(filePath, "utf8");
  const stripped = src.replace(/^\/\* fou-table-h-patch(-v2)? \*\/\n/, "");
  const next = patchFouTableCellContent(stripped);
  if (next === stripped) return false;
  const body = `${marker}\n${next}`;
  fs.writeFileSync(filePath, body, "utf8");
  return true;
}

function clearViteCache() {
  if (!fs.existsSync(viteCacheDir)) return false;
  fs.rmSync(viteCacheDir, { recursive: true, force: true });
  return true;
}

if (!fs.existsSync(distTarget)) {
  console.warn("[patch-foucui-h] skip: foucui not installed");
  process.exit(0);
}

if (patchDist(distTarget)) {
  console.log("[patch-foucui-h] patched FouTableCellContent → m() in foucui dist");
  if (clearViteCache()) {
    console.log("[patch-foucui-h] cleared node_modules/.vite (avoid 504 Outdated Optimize Dep)");
  }
} else {
  console.log("[patch-foucui-h] dist/foucui.js already patched");
}
