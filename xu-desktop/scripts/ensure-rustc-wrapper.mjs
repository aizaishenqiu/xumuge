/**
 * @file Ensure cargo-build-script-stub.exe + rustc-sign-wrapper.exe exist
 * @author qiuye <yjk150@qq.com>
 * @date 2026-09-01
 * @version 1.0.0
 * @category Build
 * @algo rustc-compile-helper-exes
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STUB = path.join(__dirname, "cargo-build-script-stub.exe");
const WRAPPER = path.join(__dirname, "rustc-sign-wrapper.exe");
const WRAPPER_SRC = path.join(__dirname, "rustc-sign-wrapper-main.rs");
const STUB_SRC = path.join(__dirname, "_stub_main.rs");

function needRebuild(exe, src) {
  if (!fs.existsSync(exe)) return true;
  if (!fs.existsSync(src)) return false;
  return fs.statSync(src).mtimeMs > fs.statSync(exe).mtimeMs;
}

function rustc(src, out) {
  const r = spawnSync("rustc", [src, "-O", "-o", out], {
    stdio: "inherit",
    windowsHide: true,
  });
  if ((r.status ?? 1) !== 0) {
    throw new Error(`rustc failed for ${path.basename(out)}`);
  }
}

if (needRebuild(STUB, STUB_SRC) || !fs.existsSync(STUB)) {
  fs.writeFileSync(STUB_SRC, "fn main() {}\n", "utf8");
  rustc(STUB_SRC, STUB);
  console.log(`[ensure-rustc-wrapper] built ${path.basename(STUB)}`);
}

if (needRebuild(WRAPPER, WRAPPER_SRC)) {
  if (!fs.existsSync(WRAPPER_SRC)) {
    throw new Error(`missing ${WRAPPER_SRC}`);
  }
  rustc(WRAPPER_SRC, WRAPPER);
  console.log(`[ensure-rustc-wrapper] built ${path.basename(WRAPPER)}`);
}

const thumb = (process.env.XU_WIN_CODE_SIGN_THUMBPRINT || "").trim();
const signtool =
  process.env.SIGNTOOL_PATH ||
  "C:\\Program Files (x86)\\Windows Kits\\10\\bin\\10.0.26100.0\\x64\\signtool.exe";
if (thumb && fs.existsSync(signtool)) {
  for (const exe of [STUB, WRAPPER]) {
    spawnSync(signtool, ["sign", "/fd", "sha256", "/sha1", thumb, exe], {
      stdio: "ignore",
      windowsHide: true,
    });
  }
}

console.log("[ensure-rustc-wrapper] ok");
