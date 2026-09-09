/**
 * @file 打包离线语音 ZIP（Kokoro TTS + Zipformer CTC ASR）供 catalog 备选下载
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-31
 * @updated 2026-08-31
 * @version 1.2.0
 * @category Config
 * @algo sha256-exact-manifest-zip
 *
 * 用法:
 *   node scripts/pack-offline-voice.mjs
 *   XU_HF_MIRROR=https://hf-mirror.com node scripts/pack-offline-voice.mjs --out ../server/public/uploads/voice-packs
 *
 * 主安装路径为设置页 voice_native_install；本脚本仅产出 ZIP 备选。
 * 默认国内 hf-mirror，不直连 github.com。
 * 不提交大 ZIP；仅产出到 uploads 目录（已 gitignore）。
 */

import { createHash } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, copyFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DESKTOP_ROOT = resolve(__dirname, "..");
const REPO_ROOT = resolve(DESKTOP_ROOT, "../..");

const PACK_ID = "xu-offline-zh";
const PACK_VERSION = "1.0.0";

const DEFAULT_OUT = resolve(REPO_ROOT, "server/public/uploads/voice-packs");
const CACHE = resolve(homedir(), ".xu", "cache", "sherpa-models");

const HF = (process.env.XU_HF_MIRROR || process.env.HF_ENDPOINT || "https://hf-mirror.com").replace(/\/$/, "");
const GH_PROXY = (process.env.XU_GH_MIRROR || "https://ghfast.top").replace(/\/$/, "");
const ASR_DIR = "sherpa-onnx-streaming-zipformer-ctc-zh-int8-2025-06-30";
const GH_ASR =
  "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-streaming-zipformer-ctc-zh-int8-2025-06-30.tar.bz2";

const ASR_ARCHIVE_URLS = [
  `${GH_PROXY}/${GH_ASR}`,
  `https://gh-proxy.com/${GH_ASR}`,
  `https://ghproxy.net/${GH_ASR}`,
];

const TTS_FILES = [
  {
    urls: [
      `${GH_PROXY}/https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.int8.onnx`,
      "https://gh-proxy.com/https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.int8.onnx",
      `${HF}/xybrid-ai/Kokoro-82M-v1.0-ONNX/resolve/main/kokoro-v1.0.int8.onnx`,
    ],
    name: "kokoro-v1.0.int8.onnx",
  },
  {
    urls: [
      `${GH_PROXY}/https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin`,
      "https://gh-proxy.com/https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin",
      `${HF}/xybrid-ai/Kokoro-82M-v1.0-ONNX/resolve/main/voices.bin`,
    ],
    name: "voices-v1.0.bin",
  },
];

function parseArgs(argv) {
  let out = DEFAULT_OUT;
  let skipDownload = false;
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--out" && argv[i + 1]) {
      out = resolve(argv[++i]);
    } else if (argv[i] === "--skip-download") {
      skipDownload = true;
    }
  }
  return { out, skipDownload };
}

function sha256File(path) {
  const hash = createHash("sha256");
  hash.update(readFileSync(path));
  return hash.digest("hex");
}

function listFilesRecursive(root) {
  const out = [];
  function walk(dir) {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else out.push(p);
    }
  }
  walk(root);
  return out;
}

async function download(url, dest, { minBytes = 1_000_000 } = {}) {
  if (existsSync(dest) && statSync(dest).size > minBytes) {
    console.log(`cache hit ${basename(dest)}`);
    return;
  }
  mkdirSync(dirname(dest), { recursive: true });
  console.log(`download ${url}`);
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok || !res.body) {
    throw new Error(`下载失败 ${res.status}`);
  }
  const tmp = `${dest}.part`;
  await pipeline(Readable.fromWeb(res.body), createWriteStream(tmp));
  rmSync(dest, { force: true });
  const { renameSync } = await import("node:fs");
  renameSync(tmp, dest);
}

async function downloadFirst(urls, dest, opts) {
  let last = "";
  for (const url of urls) {
    try {
      await download(url, dest, opts);
      return;
    } catch (e) {
      last = e instanceof Error ? e.message : String(e);
      console.warn(`mirror fail, try next: ${last}`);
    }
  }
  throw new Error(last || "国内加速源均失败");
}

function extractTarBz2(archive, destDir) {
  mkdirSync(destDir, { recursive: true });
  const r = spawnSync("tar", ["-xjf", archive, "-C", destDir], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`tar 解压失败: ${r.stderr || r.stdout}`);
}

function findExtractedRoot(stage, expectedName) {
  const direct = join(stage, expectedName);
  if (existsSync(direct)) return direct;
  const kids = readdirSync(stage)
    .map((n) => join(stage, n))
    .filter((p) => statSync(p).isDirectory());
  if (kids.length === 1) return kids[0];
  const match = kids.find((p) => basename(p).includes("zipformer"));
  if (match) return match;
  throw new Error(`找不到解压目录 ${expectedName}`);
}

function copyDirContents(src, dest) {
  mkdirSync(dest, { recursive: true });
  for (const name of readdirSync(src)) {
    const from = join(src, name);
    const to = join(dest, name);
    const st = statSync(from);
    if (st.isDirectory()) copyDirContents(from, to);
    else {
      mkdirSync(dirname(to), { recursive: true });
      copyFileSync(from, to);
    }
  }
}

function buildManifest(packRoot) {
  const files = [];
  let total = 0;
  for (const abs of listFilesRecursive(packRoot)) {
    const rel = relative(packRoot, abs).replace(/\\/g, "/");
    if (rel === "manifest.json") continue;
    const size = statSync(abs).size;
    total += size;
    files.push({
      path: rel,
      sha256: sha256File(abs),
      size,
    });
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  return {
    id: PACK_ID,
    version: PACK_VERSION,
    provider: "sherpa-onnx",
    voices: [
      { id: "zf_xiaoxiao", name: "中文女声·御姐", language: "zh-CN", gender: "female", toneIds: ["female-mature", "female-angry"] },
      { id: "zf_xiaoni", name: "中文女声·偏软", language: "zh-CN", gender: "female", toneIds: ["female-loli", "female-cute", "female-joke", "female-happy", "female-sunny"] },
      { id: "zf_xiaobei", name: "中文女声·温柔", language: "zh-CN", gender: "female", toneIds: ["female-gentle", "female-sad", "female-calm"] },
      { id: "zf_xiaoyi", name: "中文女声·较清晰", language: "zh-CN", gender: "female", toneIds: ["female-sunny"] },
      { id: "zm_yunjian", name: "中文男声·云健", language: "zh-CN", gender: "male", toneIds: ["male-calm"] },
      { id: "zm_yunxi", name: "中文男声·云希", language: "zh-CN", gender: "male", toneIds: ["male-sunny"] },
      // id 前缀 zm_，听感为女童声（与 Azure 云夏一致）
      { id: "zm_yunxia", name: "中文女声·云夏（童声）", language: "zh-CN", gender: "female", toneIds: ["female-sunny"] },
      { id: "zm_yunyang", name: "中文男声·云扬", language: "zh-CN", gender: "male", toneIds: ["male-calm"] },
    ],
    files,
    licenseSpdx: "Apache-2.0",
    licenseUrl: "https://www.apache.org/licenses/LICENSE-2.0",
    sourceUrl: "cn-accelerate (Kokoro + Zipformer CTC)",
    size: total,
    approved: true,
    commercialAllowed: true,
    executable: null,
    synthArgs: [],
  };
}

function zipDirectory(packRoot, zipPath) {
  rmSync(zipPath, { force: true });
  // Windows tar can create zip: tar -a -c -f out.zip -C parent folder
  const parent = dirname(packRoot);
  const folder = basename(packRoot);
  const r = spawnSync("tar", ["-a", "-c", "-f", zipPath, "-C", parent, folder], {
    encoding: "utf8",
  });
  if (r.status !== 0) {
    throw new Error(`打 ZIP 失败: ${r.stderr || r.stdout}`);
  }
}

async function main() {
  const { out, skipDownload } = parseArgs(process.argv);
  mkdirSync(CACHE, { recursive: true });
  mkdirSync(out, { recursive: true });

  const work = resolve(CACHE, "pack-work");
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });

  const packRoot = join(work, PACK_ID);
  mkdirSync(join(packRoot, "tts"), { recursive: true });
  mkdirSync(join(packRoot, "asr"), { recursive: true });

  // ASR：国内加速拉 Release tar
  {
    const archivePath = join(CACHE, `${ASR_DIR}.tar.bz2`);
    if (!skipDownload) {
      await downloadFirst(ASR_ARCHIVE_URLS, archivePath, { minBytes: 1_000_000 });
    } else if (!existsSync(archivePath)) {
      throw new Error(`--skip-download 但缺少 ${archivePath}`);
    }
    const stage = join(work, "extract-asr");
    rmSync(stage, { recursive: true, force: true });
    mkdirSync(stage, { recursive: true });
    extractTarBz2(archivePath, stage);
    const extracted = findExtractedRoot(stage, ASR_DIR);
    copyDirContents(extracted, join(packRoot, "asr", ASR_DIR));
  }

  // TTS: int8 onnx + voices.bin
  for (const file of TTS_FILES) {
    const destCache = join(CACHE, file.name);
    if (!skipDownload) {
      await downloadFirst(file.urls, destCache);
    } else if (!existsSync(destCache)) {
      throw new Error(`--skip-download 但缺少 ${destCache}`);
    }
    copyFileSync(destCache, join(packRoot, "tts", file.name));
  }

  const manifest = buildManifest(packRoot);
  writeFileSync(join(packRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  const zipPath = join(out, `${PACK_ID}.zip`);
  // zip contents should be at zip root (manifest + tts + asr), not nested pack id folder
  const flat = join(work, "zip-flat");
  rmSync(flat, { recursive: true, force: true });
  mkdirSync(flat, { recursive: true });
  copyDirContents(packRoot, flat);
  const flatZipParent = work;
  const flatName = "zip-flat";
  const tmpZip = join(work, `${PACK_ID}.zip`);
  const r = spawnSync("tar", ["-a", "-c", "-f", tmpZip, "-C", flatZipParent, flatName], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`打 ZIP 失败: ${r.stderr || r.stdout}`);
  // re-pack so entries are tts/... not zip-flat/tts/...
  rmSync(join(work, "repack"), { recursive: true, force: true });
  mkdirSync(join(work, "repack"), { recursive: true });
  extractZipViaTar(tmpZip, join(work, "repack"));
  const inner = join(work, "repack", flatName);
  const finalTmp = join(work, "final.zip");
  const r2 = spawnSync(
    "tar",
    ["-a", "-c", "-f", finalTmp, "-C", inner, "manifest.json", "tts", "asr"],
    { encoding: "utf8" },
  );
  if (r2.status !== 0) throw new Error(`最终 ZIP 失败: ${r2.stderr || r2.stdout}`);
  copyFileSync(finalTmp, zipPath);

  console.log(`OK ${zipPath} size=${statSync(zipPath).size} files=${manifest.files.length}`);
  console.log(`manifest size field=${manifest.size}`);
}

function extractZipViaTar(zipPath, dest) {
  mkdirSync(dest, { recursive: true });
  const r = spawnSync("tar", ["-xf", zipPath, "-C", dest], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`解压 zip 失败: ${r.stderr || r.stdout}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
