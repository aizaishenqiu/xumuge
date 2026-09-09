/**
 * @file fill-archive-pending.mjs
 * @author qiuye <yjk150@qq.com>
 * @date 2026-09-05
 * @version 1.0.0
 * @category role-pack
 * @algo Replace archive catalog （待补） with nine-section templates
 *
 * node scripts/fill-archive-pending.mjs --write
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fillPendingPlaceholders } from "./lib/virmoor-role-enrich-templates.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const ARCHIVE = path.join(ROOT, "role-packs-src", "_archive", "专家目录_全集_1222条.md");
const HEADER_RE = /^##### .+ `([^`]+)` 〔(zh-kimi|市场)〕\s*$/gm;

function parseYamlLite(text) {
  const meta = {};
  for (const line of String(text || "").split(/\r?\n/)) {
    const kv = line.trim().match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (!kv) continue;
    let val = kv[2].trim();
    if (val.startsWith("[") && val.endsWith("]")) {
      meta[kv[1]] = val
        .slice(1, -1)
        .split(",")
        .map((s) => s.trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean);
    } else if (val.startsWith('"') && val.endsWith('"')) meta[kv[1]] = val.slice(1, -1);
    else meta[kv[1]] = val;
  }
  return meta;
}

function roleFromBlock(block) {
  const yamlM = block.match(/```yaml\r?\n([\s\S]*?)```/);
  const meta = yamlM ? parseYamlLite(yamlM[1]) : {};
  const heading = block.match(/^#####\s+(.+?)\s+`/);
  const nameZh = meta.nameZh || meta.roleTitle || meta.catalogL4 || (heading ? heading[1].trim() : "专业顾问");
  const division = String(meta.division || meta.catalogL2 || "specialized");
  return {
    slug: meta.id || meta.slug || "archive-role",
    division,
    nameZh,
    meta: {
      catalogL5: meta.catalogL5 || meta.catalogL3 || "本职场景",
      catalogL3: meta.catalogL3,
      tags: Array.isArray(meta.tags) ? meta.tags : [],
    },
  };
}

function fillChunk(block) {
  const role = roleFromBlock(block);
  const filled = fillPendingPlaceholders(block, role);
  return `${filled}\n\n`;
}

function main() {
  const write = process.argv.includes("--write");
  const raw = fs.readFileSync(ARCHIVE, "utf8");
  const before = (raw.match(/（待补）/g) || []).length;
  const matches = [...raw.matchAll(HEADER_RE)];
  if (!matches.length) {
    const filled = fillPendingPlaceholders(raw, {
      slug: "archive",
      division: "specialized",
      nameZh: "专业顾问",
      meta: { catalogL5: "本职场景", tags: [] },
    });
    console.log(JSON.stringify({ before, after: (filled.match(/（待补）/g) || []).length, entries: 0 }));
    if (write) fs.writeFileSync(ARCHIVE, filled.endsWith("\n") ? filled : `${filled}\n`, "utf8");
    return;
  }

  let out = raw.slice(0, matches[0].index);
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index;
    const end = i + 1 < matches.length ? matches[i + 1].index : raw.length;
    out += fillChunk(raw.slice(start, end));
  }
  const after = (out.match(/（待补）/g) || []).length;
  console.log(JSON.stringify({ before, after, entries: matches.length, write }, null, 2));
  if (write) fs.writeFileSync(ARCHIVE, out.endsWith("\n") ? out : `${out}\n`, "utf8");
}

main();
