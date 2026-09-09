/**
 * @file Cargo RUSTC_WRAPPER — replace build-script exes with trusted stub (360 bypass)
 * @author qiuye <yjk150@qq.com>
 * @date 2026-09-01
 * @version 1.0.2
 * @category Build
 * @algo rustc-wrapper-stub-replace
 *
 * Cargo passes --out-dir (not -o) for build scripts. 360 Safe blocks many freshly
 * linked build-script binaries; overwrite with scripts/cargo-build-script-stub.exe.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STUB = path.join(__dirname, "cargo-build-script-stub.exe");
const logPath = process.env.XU_RUSTC_WRAPPER_LOG || "";

function log(msg) {
  if (!logPath) return;
  try {
    fs.appendFileSync(logPath, `${new Date().toISOString()} ${msg}\n`);
  } catch {
    /* ignore */
  }
}

/**
 * @param {string[]} args
 * @param {string} key
 */
function flagValue(args, key) {
  const i = args.indexOf(key);
  if (i >= 0 && args[i + 1]) return args[i + 1];
  const pref = `${key}=`;
  const hit = args.find((a) => a.startsWith(pref));
  return hit ? hit.slice(pref.length) : null;
}

/**
 * @param {string[]} args
 * @param {string} key  e.g. extra-filename
 */
function codegenValue(args, key) {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "-C" && args[i + 1]) {
      const v = args[i + 1];
      if (v.startsWith(`${key}=`)) return v.slice(key.length + 1);
    }
    if (args[i].startsWith(`-C${key}=`)) return args[i].slice(3 + key.length + 1);
  }
  return null;
}

const rustc = process.argv[2];
const args = process.argv.slice(3);
if (!rustc) {
  console.error("[rustc-sign-wrapper] missing rustc path");
  process.exit(1);
}

const run = spawnSync(rustc, args, { stdio: "inherit", windowsHide: true });
const code = run.status ?? 1;
if (code !== 0) process.exit(code);

const crateName = flagValue(args, "--crate-name") || "";
const isBuildScript =
  crateName === "build_script_build" || crateName.startsWith("build_script");
if (!isBuildScript) process.exit(0);

if (!fs.existsSync(STUB)) {
  log(`missing-stub ${STUB}`);
  process.exit(0);
}

const outDir = flagValue(args, "--out-dir");
const extra = codegenValue(args, "extra-filename") || "";
/** @type {string[]} */
const candidates = [];

const dashO = flagValue(args, "-o");
if (dashO) {
  candidates.push(dashO);
  candidates.push(`${dashO}.exe`);
}

if (outDir) {
  candidates.push(path.join(outDir, `build_script_build${extra}.exe`));
  candidates.push(path.join(outDir, `build_script_build${extra}`));
  candidates.push(path.join(outDir, "build-script-build.exe"));
  candidates.push(path.join(outDir, "build_script_build.exe"));
}

let replaced = 0;
for (const c of candidates) {
  if (!c || !fs.existsSync(c)) continue;
  try {
    fs.copyFileSync(STUB, c);
    replaced += 1;
    log(`stubbed ${c}`);
  } catch (e) {
    log(`stub-fail ${c} ${e}`);
  }
}

if (outDir) {
  try {
    const planted = path.join(outDir, "build-script-build.exe");
    fs.copyFileSync(STUB, planted);
    replaced += 1;
    log(`planted ${planted}`);
  } catch (e) {
    log(`plant-fail ${e}`);
  }
}

log(`done crate=${crateName} replaced=${replaced} outDir=${outDir}`);
process.exit(0);
