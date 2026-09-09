/**
 * @file guard-release-dist.mjs 生产 vite 产物洁净检查（禁本机 API / 开发口令）
 * @author qiuye <yjk150@qq.com>
 * @date 2026-09-08
 * @version 1.0.0
 * @category Tooling
 * @algo scan-dist-assets
 *
 * 由 `pnpm build`（tauri beforeBuildCommand）在 vite 之后调用。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DIST = path.join(ROOT, "dist");

const FORBIDDEN = [
  { re: /127\.0\.0\.1:8080/g, label: "本机账号服 127.0.0.1:8080" },
  { re: /127\.0\.0\.1:5340/g, label: "本机官网 127.0.0.1:5340" },
  { re: /admin@fou\.local/gi, label: "开发账号 admin@fou.local" },
  { re: /VITE_XU_DEV_PASSWORD["']?\s*[:=]\s*["'][^"']+/g, label: "开发口令注入" },
];

function main() {
  if (!fs.existsSync(DIST)) {
    console.error("[guard-release-dist] 缺少 dist/，请先 vite build");
    process.exit(1);
  }
  /** @type {string[]} */
  const issues = [];
  const assets = path.join(DIST, "assets");
  const files = fs.existsSync(assets)
    ? fs.readdirSync(assets).filter((n) => /\.(js|css|html|mjs)$/i.test(n))
    : [];
  const also = ["index.html"].map((n) => path.join(DIST, n)).filter((p) => fs.existsSync(p));
  const targets = [
    ...files.map((n) => path.join(assets, n)),
    ...also,
  ];
  for (const abs of targets) {
    let text;
    try {
      const st = fs.statSync(abs);
      if (st.size > 8_000_000) continue;
      text = fs.readFileSync(abs, "utf8");
    } catch {
      continue;
    }
    const rel = path.relative(ROOT, abs).replace(/\\/g, "/");
    for (const { re, label } of FORBIDDEN) {
      re.lastIndex = 0;
      if (re.test(text)) {
        issues.push(`${rel}: ${label}`);
      }
    }
  }
  if (issues.length) {
    console.error(`[guard-release-dist] FAILED (${issues.length}):`);
    for (const i of issues) console.error(`  - ${i}`);
    process.exit(1);
  }
  console.log("[guard-release-dist] OK（无本机 API / 开发口令残留）");
}

main();
