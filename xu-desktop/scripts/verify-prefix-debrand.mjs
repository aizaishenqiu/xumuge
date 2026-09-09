/**
 * @file verify-prefix-debrand.mjs
 * @author qiuye <yjk150@qq.com>
 * @date 2026-09-05
 * @version 1.0.0
 * @category role-pack
 * @algo 校验弱前缀清零与招投标/脱敏样例
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "role-packs-src", "zh-CN-virmoor");
const WEAK = new Set(["专项", "支持", "通用", "专业", ""]);

function walk(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, out);
    else if (ent.name.endsWith(".md")) out.push(p);
  }
  return out;
}

const counts = new Map();
let noName = 0;
let weakN = 0;
const bid = [];
const files = walk(SRC);
for (const f of files) {
  const raw = fs.readFileSync(f, "utf8");
  const m = raw.match(/^nameZh:\s*"?(.*)"?\s*$/m);
  let name = m ? m[1].trim() : "";
  if (name.endsWith('"')) name = name.slice(0, -1);
  if (!name) {
    noName += 1;
    continue;
  }
  const i = name.indexOf(" · ");
  const p = i > 0 ? name.slice(0, i) : "";
  counts.set(p, (counts.get(p) || 0) + 1);
  if (WEAK.has(p)) weakN += 1;
  if (/招标|投标|招投标/.test(name)) bid.push(name);
}

const legal = fs.readFileSync(path.join(SRC, "specialized", "legal-document-review.md"), "utf8");
const samplePath = path.join(SRC, "finance", "finance-role-ceki04yt3e.md");
const sample = fs.existsSync(samplePath) ? fs.readFileSync(samplePath, "utf8") : "";

console.log(
  JSON.stringify(
    {
      files: files.length,
      noName,
      weakN,
      bid,
      top: [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25),
      legalBytes: legal.length,
      legalNameZh: (legal.match(/^nameZh:.*/m) || [])[0],
      sampleTencent: (sample.match(/腾讯/g) || []).length,
      sampleDebrand: (sample.match(/某港股互联网标的/g) || []).length,
    },
    null,
    2,
  ),
);
