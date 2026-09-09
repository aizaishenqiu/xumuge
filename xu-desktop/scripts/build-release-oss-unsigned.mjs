/**
 * @file build-release-oss-unsigned.mjs
 * @description Open-source unsigned NSIS build: compile zh-virmoon demo pack, no code signing.
 * @author qiuye <yjk150@qq.com>
 * @date 2026-09-09
 * @version 1.2.0
 * @category Tooling
 * @algo oss-release-unsigned
 *
 * Usage: pnpm build:release:oss-unsigned
 *
 * Builds full.zh-CN.xupack from role-packs-src/zh-virmoon (~461 non-market roles).
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const CONF = path.join(ROOT, "src-tauri", "tauri.windows.conf.json");
const DEMO_SRC = path.join(ROOT, "role-packs-src", "zh-virmoon");
const RG = path.join(ROOT, "src-tauri", "bin", "rg.exe");

function run(cmd, args) {
  console.log(`[oss-unsigned] ${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, {
    cwd: ROOT,
    env: { ...process.env, XU_WIN_CODE_SIGN_DEFER: "1" },
    stdio: "inherit",
    shell: true,
  });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

function ensureRg() {
  if (fs.existsSync(RG)) return;
  console.error(
    `[oss-unsigned] missing ${path.relative(ROOT, RG)} — run setup:rg or re-export from private tree`,
  );
  process.exit(1);
}

function ensureDemoSrc() {
  if (!fs.existsSync(DEMO_SRC)) {
    console.error(
      `[oss-unsigned] missing ${path.relative(ROOT, DEMO_SRC)} — run: node scripts/lib/copy-zh-virmoon-oss-demo.mjs (from monorepo) or re-export`,
    );
    process.exit(1);
  }
}

ensureRg();
ensureDemoSrc();

run("pnpm", ["run", "build:role-pack:full"]);

run("node", ["scripts/guard-release-bundle.mjs"]);

const conf = {
  bundle: {
    publisher: "Virmoor",
    windows: {
      digestAlgorithm: "sha256",
    },
  },
};
fs.writeFileSync(CONF, `${JSON.stringify(conf, null, 2)}\n`, "utf8");
console.log(
  `[oss-unsigned] wrote ${path.relative(ROOT, CONF)} (no certificateThumbprint)`,
);

run("node", ["scripts/prepare-release-clean.mjs"]);
run("pnpm", ["exec", "tauri", "build"]);

const targetDir = process.env.CARGO_TARGET_DIR
  ? path.resolve(process.env.CARGO_TARGET_DIR)
  : path.join(ROOT, "src-tauri", "target");
console.log(
  `[oss-unsigned] done — look under ${path.join(targetDir, "release", "bundle", "nsis", "*-setup.exe")}`,
);
if (!process.env.CARGO_TARGET_DIR) {
  console.log(
    "[oss-unsigned] tip: if cargo reports Access Denied on build-scripts, set CARGO_TARGET_DIR to a writable path and retry",
  );
}
