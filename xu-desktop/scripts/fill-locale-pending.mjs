/**
 * @file fill-locale-pending.mjs
 * @author qiuye <yjk150@qq.com>
 * @date 2026-09-05
 * @version 1.0.0
 * @category role-pack
 * @algo Fill （待补） in role-packs-src/{locale}/*.md via fillPendingPlaceholders
 *
 * node scripts/fill-locale-pending.mjs --locale zh-CN --write
 * node scripts/fill-locale-pending.mjs --locale zh-kimi --write
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildFrontmatter, parseFrontmatter, walkMdFiles } from "./lib/virmoor-role-debrand.mjs";
import { fillPendingPlaceholders } from "./lib/virmoor-role-enrich-templates.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  const out = { locale: "zh-CN", write: false, dryRun: true };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--locale") out.locale = argv[++i];
    else if (argv[i] === "--write") {
      out.write = true;
      out.dryRun = false;
    } else if (argv[i] === "--dry-run") out.dryRun = true;
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv);
  const dest = path.join(ROOT, "role-packs-src", args.locale);
  if (!fs.existsSync(dest)) {
    console.error(`[fill-locale-pending] missing ${dest}`);
    process.exit(1);
  }

  const files = walkMdFiles(dest).filter((f) => {
    const base = path.basename(f);
    return !base.startsWith("_") && base !== "manifest.yaml";
  });

  const stats = { scanned: 0, filled: 0, skipped: 0, pendingBefore: 0, pendingAfter: 0 };

  for (const file of files) {
    stats.scanned++;
    const raw = fs.readFileSync(file, "utf8");
    const before = (raw.match(/（待补）/g) || []).length;
    stats.pendingBefore += before;
    if (!before) {
      stats.skipped++;
      continue;
    }

    let meta;
    let bodyMd;
    try {
      ({ meta, bodyMd } = parseFrontmatter(raw));
    } catch {
      stats.skipped++;
      continue;
    }

    const division = meta.division || path.dirname(path.relative(dest, file)).split(path.sep)[0];
    const slug = meta.slug || path.basename(file, ".md");
    const nameZh = meta.nameZh || slug;
    const role = { slug, division, nameZh, meta };
    const filledBody = fillPendingPlaceholders(bodyMd, role);
    const after = (filledBody.match(/（待补）/g) || []).length;
    stats.pendingAfter += after;
    if (filledBody === bodyMd.trim()) {
      stats.skipped++;
      continue;
    }
    stats.filled++;
    if (args.dryRun) continue;

    const fm = buildFrontmatter(meta, slug, division, nameZh, meta.quickPrompts || []);
    let body = filledBody.replace(/^(###### 子场景：[^\n]+\n\n)+/, "");
    const sub = meta.catalogL5 ? `###### 子场景：${meta.catalogL5}\n\n` : "";
    fs.writeFileSync(file, `${fm}${sub}${body}\n`, "utf8");
  }

  console.log("[fill-locale-pending]", JSON.stringify({ locale: args.locale, ...stats, dryRun: args.dryRun }, null, 2));
}

main();
