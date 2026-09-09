/**
 * @file enrich-zh-cn-virmoor-content.mjs
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-30
 * @version 1.0.0
 * @category role-pack
 * @algo 完善岗位正文：zh-kimi 合并 + 九段式/协同块/验收/quickPrompts
 *
 * node scripts/enrich-zh-cn-virmoor-content.mjs --wave software --dry-run
 * node scripts/enrich-zh-cn-virmoor-content.mjs --wave specialized --write
 * node scripts/enrich-zh-cn-virmoor-content.mjs --wave all --write
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildFrontmatter, parseFrontmatter, walkMdFiles } from "./lib/virmoor-role-debrand.mjs";
import {
  enrichBody,
  ensureQuickPrompts,
  mergeKimiBody,
  waveMatches,
} from "./lib/virmoor-role-enrich-templates.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const DEST = path.join(ROOT, "role-packs-src", "zh-CN-virmoor");
const KIMI = path.join(ROOT, "role-packs-src", "zh-virmoon");

function parseArgs(argv) {
  const out = { dryRun: true, write: false, wave: "all" };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--dry-run") out.dryRun = true;
    else if (argv[i] === "--write") {
      out.write = true;
      out.dryRun = false;
    } else if (argv[i] === "--wave") out.wave = argv[++i];
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv);
  const files = walkMdFiles(DEST).filter((f) => {
    const base = path.basename(f);
    return !base.startsWith("_") && base !== "manifest.yaml";
  });

  const stats = { scanned: 0, enriched: 0, kimiMerged: 0, skipped: 0 };

  for (const file of files) {
    const division = path.dirname(file).split(path.sep).pop();
    if (!waveMatches(division, args.wave)) continue;

    stats.scanned++;
    const raw = fs.readFileSync(file, "utf8");
    let parsed;
    try {
      parsed = parseFrontmatter(raw);
    } catch {
      stats.skipped++;
      continue;
    }
    const { meta, bodyMd } = parsed;
    const slug = meta.slug || path.basename(file, ".md");
    const nameZh = meta.nameZh || slug;

    const role = {
      slug,
      division: meta.division || division,
      nameZh,
      meta,
      bodyMd,
      quickPrompts: meta.quickPrompts || [],
    };

    const kimiPath = path.join(KIMI, role.division, `${slug}.md`);
    const kimiBody = mergeKimiBody(role, kimiPath, fs);
    if (kimiBody) {
      role.bodyMd = kimiBody;
      stats.kimiMerged++;
    }

    const originalBody = role.bodyMd;
    const originalPromptLen = (meta.quickPrompts || []).length;
    role.bodyMd = enrichBody(role);
    role.quickPrompts = ensureQuickPrompts(role);

    if (
      role.bodyMd === originalBody &&
      role.quickPrompts.length === originalPromptLen &&
      !kimiBody
    ) {
      stats.skipped++;
      continue;
    }
    stats.enriched++;

    if (args.dryRun) continue;

    const fm = buildFrontmatter(meta, slug, role.division, nameZh, role.quickPrompts);
    let body = role.bodyMd.replace(/^(###### 子场景：[^\n]+\n\n)+/, "");
    const sub = meta.catalogL5 ? `###### 子场景：${meta.catalogL5}\n\n` : "";
    fs.writeFileSync(file, `${fm}${sub}${body}\n`, "utf8");
  }

  console.log("[enrich-zh-cn-virmoor-content]", JSON.stringify({ wave: args.wave, ...stats, dryRun: args.dryRun }, null, 2));
  if (args.dryRun) console.log("[enrich-zh-cn-virmoor-content] dry-run — no files written");
}

main();
