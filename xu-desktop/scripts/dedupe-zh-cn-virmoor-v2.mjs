/**
 * @file dedupe-zh-cn-virmoor-v2.mjs
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-31
 * @version 1.0.0
 * @category role-pack
 * @algo 二轮去重：fuzzyNorm + 语义锚点 + 泛名惩罚
 *
 * node scripts/dedupe-zh-cn-virmoor-v2.mjs --dry-run
 * node scripts/dedupe-zh-cn-virmoor-v2.mjs --write
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildFrontmatter,
  parseFrontmatter,
  walkMdFiles,
} from "./lib/virmoor-role-debrand.mjs";
import { mergeGroupsV2 } from "./lib/virmoor-dedupe-v2.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const DEST = path.join(ROOT, "role-packs-src", "zh-CN-virmoor");

function parseArgs(argv) {
  const out = { dryRun: false, write: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--dry-run") out.dryRun = true;
    else if (argv[i] === "--write") out.write = true;
  }
  if (!out.dryRun && !out.write) out.dryRun = true;
  return out;
}

function loadRoles() {
  const files = walkMdFiles(DEST).filter(
    (f) =>
      !f.endsWith("manifest.yaml") &&
      !f.includes("_slug-map") &&
      !/_audit|_dedupe-report|_duplicate-audit|_compliance-scan/.test(f),
  );
  const roles = [];
  for (const file of files) {
    const raw = fs.readFileSync(file, "utf8");
    const { meta, bodyMd } = parseFrontmatter(raw);
    const slug = meta.slug || path.basename(file, ".md");
    roles.push({
      slug,
      division: meta.division || path.dirname(file).split(path.sep).pop(),
      nameZh: meta.nameZh || meta.roleTitle || slug,
      meta,
      quickPrompts: meta.quickPrompts || [],
      bodyMd,
      sourceFile: path.relative(DEST, file).replace(/\\/g, "/"),
    });
  }
  return roles;
}

function writeRoles(roles) {
  const written = new Set();
  for (const role of roles) {
    const dir = path.join(DEST, role.division);
    fs.mkdirSync(dir, { recursive: true });
    const fm = buildFrontmatter(role.meta, role.slug, role.division, role.nameZh, role.quickPrompts);
    let body = role.bodyMd.replace(/^(###### 子场景：[^\n]+\n\n)+/, "");
    const sub = role.meta.catalogL5 ? `###### 子场景：${role.meta.catalogL5}\n\n` : "";
    const filePath = path.join(dir, `${role.slug}.md`);
    fs.writeFileSync(filePath, `${fm}${sub}${body}\n`, "utf8");
    written.add(filePath);
  }
  for (const file of walkMdFiles(DEST)) {
    if (
      file.endsWith("manifest.yaml") ||
      file.includes("_slug-map") ||
      /_audit|_dedupe-report|_duplicate-audit|_compliance-scan/.test(file)
    ) {
      continue;
    }
    if (!written.has(file)) fs.unlinkSync(file);
  }
}

function main() {
  const args = parseArgs(process.argv);
  const input = loadRoles();
  const { roles, mergeLog } = mergeGroupsV2(input);

  const stats = {
    inputCount: input.length,
    outputCount: roles.length,
    removed: input.length - roles.length,
    mergedGroups: mergeLog.length,
    largestGroup: mergeLog.reduce((m, g) => Math.max(m, g.groupSize), 0),
    topGroups: mergeLog
      .sort((a, b) => b.groupSize - a.groupSize)
      .slice(0, 20)
      .map((g) => ({ size: g.groupSize, kept: g.keptSlug, nameZh: g.keptNameZh })),
  };

  console.log("[dedupe-zh-cn-virmoor-v2]", JSON.stringify(stats, null, 2));

  if (args.dryRun) {
    console.log("[dedupe-zh-cn-virmoor-v2] dry-run — no files written");
    return;
  }

  writeRoles(roles);

  const manifestPath = path.join(DEST, "manifest.yaml");
  let manifest = {};
  if (fs.existsSync(manifestPath)) {
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    } catch {
      manifest = {};
    }
  }
  manifest.roleCount = roles.length;
  manifest.dedupedV2At = new Date().toISOString();
  manifest.notes = `二轮去重 dedupe-v2；${input.length} → ${roles.length} 条。`;
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");

  fs.writeFileSync(
    path.join(DEST, "_dedupe-v2-report.json"),
    JSON.stringify({ stats, mergeLog, at: new Date().toISOString() }, null, 2),
    "utf8",
  );

  console.log(`[dedupe-zh-cn-virmoor-v2] wrote ${roles.length} roles → ${DEST}`);
}

main();
