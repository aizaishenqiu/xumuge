/**
 * @file 构建岗位包并拷到 server/public/uploads/role-packs（不进安装包）
 * @author qiuye <yjk150@qq.com>
 * @date 2026-09-01
 * @version 1.0.0
 * @category Build
 * @algo copy-artifacts
 *
 * 用法: node scripts/prepare-role-packs-server.mjs
 * 产出:
 *   - resources/role-packs/full.zh-CN.xupack（试用阶段进 Tauri bundle）
 *   - resources/role-packs/demo.zh-CN.xupack（可选小包）
 *   - server/public/uploads/role-packs/virmoor-roles-zh-CN.xupack
 *   - server/public/uploads/role-packs/legacy-roles-zh-CN.xupack（若 zh-CN 源存在）
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const SERVER_UPLOAD = path.join(ROOT, "..", "..", "server", "public", "uploads", "role-packs");
const BUILD_SKUS = path.join(__dirname, "build-role-pack-skus.mjs");

function runSku(id) {
  const r = spawnSync(process.execPath, [BUILD_SKUS, "--sku", id], {
    stdio: "inherit",
    cwd: ROOT,
  });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

function copyIfExists(srcRel, destName) {
  const src = path.join(ROOT, srcRel);
  if (!fs.existsSync(src)) {
    console.warn(`[prepare-role-packs] skip missing ${srcRel}`);
    return false;
  }
  fs.mkdirSync(SERVER_UPLOAD, { recursive: true });
  const dest = path.join(SERVER_UPLOAD, destName);
  fs.copyFileSync(src, dest);
  console.log(`[prepare-role-packs] → ${path.relative(ROOT, dest)}`);
  return true;
}

function main() {
  runSku("demo-zh-CN");
  runSku("full-zh-CN-virmoor");
  copyIfExists(
    "resources/role-packs/full.zh-CN.xupack",
    "virmoor-roles-zh-CN.xupack",
  );

  const legacySrc = path.join(ROOT, "role-packs-src", "zh-CN");
  if (fs.existsSync(legacySrc)) {
    runSku("legacy-full-zh-CN");
    copyIfExists(
      "dist/role-packs/legacy-roles-zh-CN.xupack",
      "legacy-roles-zh-CN.xupack",
    );
  } else {
    console.warn("[prepare-role-packs] role-packs-src/zh-CN 不存在，跳过旧包");
  }

  console.log(
    "\n[prepare-role-packs] 完成。试用安装包嵌入 full；服务端 uploads 同步全量包供更新。",
  );
  console.log("[prepare-role-packs] 语音包 ZIP 永不写入 tauri bundle resources。");
}

main();
