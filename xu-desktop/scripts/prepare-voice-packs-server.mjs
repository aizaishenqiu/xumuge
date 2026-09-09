/**
 * @file 同步语音包 catalog / 已有 ZIP 到 server/public/uploads/voice-packs（大包不进 git）
 * @author qiuye <yjk150@qq.com>
 * @date 2026-09-01
 * @version 1.0.0
 * @category Build
 * @algo copy-artifacts
 *
 * 用法: node scripts/prepare-voice-packs-server.mjs
 * 产出: server/public/uploads/voice-packs/catalog.json + 已存在的 *.zip
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const SRC = path.join(ROOT, "..", "..", "server", "public", "uploads", "voice-packs");
const DEST = SRC;

const ZIPS = ["xu-offline-zh.zip", "demo-sherpa-zh.zip"];

function main() {
  fs.mkdirSync(DEST, { recursive: true });
  const catalogSrc = path.join(SRC, "catalog.json");
  if (!fs.existsSync(catalogSrc)) {
    console.warn("[prepare-voice-packs] missing catalog.json under server uploads; create one before deploy");
  } else {
    console.log(`[prepare-voice-packs] catalog ok → ${catalogSrc}`);
  }
  for (const name of ZIPS) {
    const p = path.join(DEST, name);
    if (fs.existsSync(p)) {
      const st = fs.statSync(p);
      console.log(`[prepare-voice-packs] found ${name} (${st.size} bytes)`);
    } else {
      console.warn(
        `[prepare-voice-packs] missing ${name} — upload manually to server/public/uploads/voice-packs/ before production seed`,
      );
    }
  }
  console.log(
    "\n[prepare-voice-packs] 语音 ZIP 永不写入 tauri bundle。部署后重启 API 以 EnsureVoicePackDownloadSeed。",
  );
}

main();
