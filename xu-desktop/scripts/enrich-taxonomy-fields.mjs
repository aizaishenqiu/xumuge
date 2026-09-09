/**
 * Enrich role-packs-src Markdown frontmatter with industry × position taxonomy fields.
 *
 * node scripts/enrich-taxonomy-fields.mjs --locale zh-virmoon
 * node scripts/enrich-taxonomy-fields.mjs --locale zh-virmoon --force
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inferTaxonomyFields } from "./lib/role-taxonomy.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

function walkMd(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walkMd(p));
    else if (ent.name.endsWith(".md")) out.push(p);
  }
  return out;
}

function parseFm(raw) {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!m) return null;
  const lines = m[1].split(/\r?\n/);
  const body = m[2];
  const meta = {};
  for (const line of lines) {
    const kv = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (!kv) continue;
    meta[kv[1]] = kv[2].trim().replace(/^"|"$/g, "");
  }
  return { meta, body, lines };
}

function upsertLine(lines, key, val) {
  const idx = lines.findIndex((l) => l.startsWith(`${key}:`));
  const row = `${key}: ${val}`;
  if (idx >= 0) lines[idx] = row;
  else lines.push(row);
}

function yamlQuote(s) {
  const v = String(s ?? "");
  if (!v) return '""';
  if (/[:#\n\r"'\\[\]{}]/.test(v) || v.startsWith(" ") || v.endsWith(" ")) {
    return `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  return `"${v}"`;
}

const locale = process.argv.includes("--locale")
  ? process.argv[process.argv.indexOf("--locale") + 1]
  : "zh-virmoon";
const force = process.argv.includes("--force");

const srcRoot = path.join(ROOT, "role-packs-src", locale);
if (!fs.existsSync(srcRoot)) {
  console.error(`Missing ${srcRoot}`);
  process.exit(1);
}

let updated = 0;
let skipped = 0;
for (const file of walkMd(srcRoot)) {
  const raw = fs.readFileSync(file, "utf8");
  const parsed = parseFm(raw);
  if (!parsed) continue;
  const { meta, body, lines } = parsed;
  const slug = meta.slug || path.basename(file, ".md");
  const division = meta.division || "engineering";

  if (!force && meta.industryId && meta.positionId && meta.positionCategory && meta.expertType) {
    skipped += 1;
    continue;
  }

  const tax = inferTaxonomyFields(meta, slug, division);
  const tags = meta.tags || "";

  upsertLine(lines, "industryId", tax.industryId);
  upsertLine(lines, "industryZh", yamlQuote(tax.industryZh));
  upsertLine(lines, "industryTags", `[${tax.industryTags.map((t) => yamlQuote(t)).join(", ")}]`);
  upsertLine(lines, "positionId", tax.positionId);
  upsertLine(lines, "positionZh", yamlQuote(tax.positionZh));
  upsertLine(lines, "positionCategory", tax.positionCategory);
  upsertLine(lines, "positionCategoryZh", yamlQuote(tax.positionCategoryZh));
  if (tax.positionSubCategory) {
    upsertLine(lines, "positionSubCategory", tax.positionSubCategory);
  }
  if (!meta.expertType) upsertLine(lines, "expertType", yamlQuote("agent"));
  if (!meta.lifecycleStatus) upsertLine(lines, "lifecycleStatus", "published");

  const next = `---\n${lines.join("\n")}\n---\n${body}`;
  if (next !== raw) {
    fs.writeFileSync(file, next, "utf8");
    updated += 1;
  } else {
    skipped += 1;
  }
}
console.log(
  `[enrich-taxonomy] ${locale}: updated ${updated} files, skipped ${skipped}${force ? " (force)" : ""}`,
);
