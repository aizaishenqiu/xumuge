/**
 * @file Sync Tauri Windows signing conf from .env.signing.local
 * @author qiuye <yjk150@qq.com>
 * @date 2026-09-01
 * @version 1.0.0
 * @category Build
 * @algo dotenv-to-tauri-windows-conf
 *
 * Reads XU_WIN_CODE_SIGN_* and writes src-tauri/tauri.windows.conf.json (gitignored).
 * Use after setup:signing, or after swapping a commercial thumbprint in env.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const ENV_PATH = path.join(ROOT, ".env.signing.local");
const CONF_PATH = path.join(ROOT, "src-tauri", "tauri.windows.conf.json");

/**
 * Parse a simple KEY=VALUE dotenv file (no export, no multiline).
 * @param {string} text
 * @returns {Record<string, string>}
 */
function parseDotEnv(text) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i < 1) continue;
    const key = line.slice(0, i).trim();
    let val = line.slice(i + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

if (!fs.existsSync(ENV_PATH)) {
  console.error(
    `[prepare:signing] missing ${path.relative(ROOT, ENV_PATH)}\n` +
      `  Run: pnpm setup:signing\n` +
      `  Or copy .env.signing.example → .env.signing.local and fill thumbprint.`,
  );
  process.exit(1);
}

const env = parseDotEnv(fs.readFileSync(ENV_PATH, "utf8"));
const thumb = (env.XU_WIN_CODE_SIGN_THUMBPRINT || "").trim().toUpperCase();
const publisher = (env.XU_WIN_CODE_SIGN_PUBLISHER || "虚幕阁").trim();
const digest = (env.XU_WIN_CODE_SIGN_DIGEST || "sha256").trim() || "sha256";

if (!/^[0-9A-F]{40}$/.test(thumb)) {
  console.error(
    `[prepare:signing] XU_WIN_CODE_SIGN_THUMBPRINT must be 40 hex chars, got: ${thumb || "(empty)"}`,
  );
  process.exit(1);
}

const conf = {
  bundle: {
    publisher,
    windows: {
      certificateThumbprint: thumb,
      digestAlgorithm: digest,
    },
  },
};

fs.writeFileSync(CONF_PATH, `${JSON.stringify(conf, null, 2)}\n`, "utf8");
console.log(`[prepare:signing] wrote ${path.relative(ROOT, CONF_PATH)}`);
console.log(`[prepare:signing] thumbprint=${thumb} publisher=${publisher}`);
console.log(
  `[prepare:signing] If build hits os error 5: trust src-tauri/target in 360 Safe (see docs/windows-release-signing.md)`,
);
