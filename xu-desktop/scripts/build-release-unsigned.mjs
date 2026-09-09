/**
 * @file build-release-unsigned.mjs 先打未签名 NSIS，事后再用正式证书签名
 * @author qiuye <yjk150@qq.com>
 * @date 2026-09-08
 * @version 1.0.0
 * @category Tooling
 * @algo release-unsigned-pipeline
 *
 * 用法: pnpm build:release:unsigned
 * 环境: 自动设 XU_WIN_CODE_SIGN_DEFER=1；写入无 certificateThumbprint 的 tauri.windows.conf.json
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const CONF = path.join(ROOT, "src-tauri", "tauri.windows.conf.json");

function run(cmd, args) {
  console.log(`[release:unsigned] ${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, {
    cwd: ROOT,
    env: { ...process.env, XU_WIN_CODE_SIGN_DEFER: "1" },
    stdio: "inherit",
    shell: true,
  });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

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
  `[release:unsigned] wrote ${path.relative(ROOT, CONF)} (no certificateThumbprint)`,
);

run("pnpm", ["run", "build:role-pack:full"]);
run("node", ["scripts/prepare-release-clean.mjs"]);
run("tauri", ["build"]);

console.log(
  "[release:unsigned] done — sign setup.exe later with your OV/EV cert (signtool).",
);
