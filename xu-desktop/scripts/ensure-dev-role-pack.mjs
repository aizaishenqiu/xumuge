/**
 * Ensure local dev full role pack exists (demo key, gitignored).
 * Source of truth: role-packs-src/zh-CN-virmoor
 * Used by `pnpm tauri dev` before Vite starts.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const LOCALE = "zh-CN-virmoor";
const SRC_ROOT = path.join(ROOT, "role-packs-src", LOCALE);
const OUT = path.join(ROOT, "resources", "role-packs", "dev.full.zh-CN.xupack");
const BUILD = path.join(__dirname, "build-role-pack.mjs");

function walkMdFiles(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walkMdFiles(p));
    else if (ent.name.endsWith(".md")) out.push(p);
  }
  return out;
}

function newestMtime(dir) {
  if (!fs.existsSync(dir)) return 0;
  return walkMdFiles(dir).reduce((max, f) => Math.max(max, fs.statSync(f).mtimeMs), 0);
}

function needsBuild() {
  if (!fs.existsSync(SRC_ROOT)) {
    console.warn(`[dev-role-pack] role-packs-src/${LOCALE} 不存在，跳过全量包构建`);
    return false;
  }
  if (!fs.existsSync(OUT)) return true;
  const srcMtime = newestMtime(SRC_ROOT);
  const outMtime = fs.statSync(OUT).mtimeMs;
  return srcMtime > outMtime;
}

function main() {
  if (!needsBuild()) {
    console.log(`[dev-role-pack] 使用已有全量包 ${path.relative(ROOT, OUT)}`);
    return;
  }
  console.log(
    `[dev-role-pack] 构建开发全量岗位包（${LOCALE}，demo 密钥，仅本地；跳过质量全检）…`,
  );
  const r = spawnSync(
    process.execPath,
    [
      BUILD,
      "--locale",
      LOCALE,
      "--all",
      "--demo",
      "--pack-id",
      "virmoor-roles-zh-CN",
      "--content-version",
      "dev",
      "--skip-quality-gate",
      "--out",
      OUT,
    ],
    { stdio: "inherit", cwd: ROOT },
  );
  if (r.status !== 0) process.exit(r.status ?? 1);
}

main();
