/**
 * @file 预下载 sherpa-onnx Windows 静态库，供 Cargo feature native-voice
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-31
 * @version 1.0.0
 * @category Config
 * @algo none
 *
 * 用法:
 *   node scripts/fetch-sherpa-native-libs.mjs
 *   XU_SHERPA_MIRROR=... node scripts/fetch-sherpa-native-libs.mjs
 *
 * 成功后设置（PowerShell）:
 *   $env:SHERPA_ONNX_ARCHIVE_DIR = "<repo>/web/xu-desktop/src-tauri/third_party/sherpa-onnx"
 *   cargo build --features native-voice
 */

import { createWriteStream, existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { renameSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, "../src-tauri/third_party/sherpa-onnx");
const VER = "1.13.6";
const ARCHIVE = `sherpa-onnx-v${VER}-win-x64-static-MT-Release-lib.tar.bz2`;
const MIRROR = (process.env.XU_SHERPA_MIRROR || "https://github.com/k2-fsa/sherpa-onnx/releases/download").replace(
  /\/$/,
  "",
);
const URL = `${MIRROR}/v${VER}/${ARCHIVE}`;

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const dest = join(OUT_DIR, ARCHIVE);
  if (existsSync(dest) && statSync(dest).size > 1_000_000) {
    console.log(`already have ${dest}`);
    printEnv(OUT_DIR);
    return;
  }
  console.log(`download ${URL}`);
  const res = await fetch(URL, { redirect: "follow" });
  if (!res.ok || !res.body) {
    throw new Error(
      `下载失败 ${res.status}。请手动下载 ${ARCHIVE} 放到 ${OUT_DIR}，或设置 XU_SHERPA_MIRROR。`,
    );
  }
  const tmp = `${dest}.part`;
  await pipeline(Readable.fromWeb(res.body), createWriteStream(tmp));
  rmSync(dest, { force: true });
  renameSync(tmp, dest);
  console.log(`OK ${dest} (${statSync(dest).size} bytes)`);
  printEnv(OUT_DIR);
}

function printEnv(dir) {
  console.log("");
  console.log("PowerShell:");
  console.log(`  $env:SHERPA_ONNX_ARCHIVE_DIR = "${dir.replace(/\\/g, "/")}"`);
  console.log("  cd web/xu-desktop/src-tauri");
  console.log("  cargo build --features native-voice");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
