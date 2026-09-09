/**
 * @file audit-namezh-prefix.mjs
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-31
 * @version 1.0.0
 * @category role-pack
 * @algo 统计 nameZh 是否含「行业 ·」前缀
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { walkMdFiles, parseFrontmatter } from "./lib/virmoor-role-debrand.mjs";
import { NAMEZH_SEP } from "./lib/virmoor-namezh-label.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "role-packs-src", "zh-CN-virmoor");
const SEP = NAMEZH_SEP;

let hasPrefix = 0;
let noPrefix = 0;
const samples = [];

for (const file of walkMdFiles(ROOT)) {
  if (file.includes("_audit") || file.includes("_slug-map") || file.endsWith("manifest.yaml")) continue;
  const raw = fs.readFileSync(file, "utf8");
  const { meta } = parseFrontmatter(raw);
  const n = meta.nameZh || "";
  if (n.includes(SEP)) hasPrefix++;
  else {
    noPrefix++;
    if (samples.length < 30) samples.push(`${path.relative(ROOT, file)}: ${n}`);
  }
}

console.log(JSON.stringify({ hasPrefix, noPrefix, samples }, null, 2));
