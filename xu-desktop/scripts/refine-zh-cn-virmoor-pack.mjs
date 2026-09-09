/**
 * @file refine-zh-cn-virmoor-pack.mjs
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-30
 * @version 1.0.0
 * @category role-pack
 * @algo Phase0–3 治理：正文扫尾、分类归位、slug、拆并、补缺
 *
 * node scripts/refine-zh-cn-virmoor-pack.mjs --dry-run
 * node scripts/refine-zh-cn-virmoor-pack.mjs --write
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildFrontmatter,
  parseFrontmatter,
  walkMdFiles,
} from "./lib/virmoor-role-debrand.mjs";
import {
  DUPLICATE_SLUGS_REMOVE,
  RESTORE_FROM_ZH_CN,
  applyTaxonomyMeta,
  fixMarketRoleBody,
  mergePromptsIntoTarget,
  refineDivision,
  refineNameZh,
  refineSlug,
  restoreRoleFromZhCn,
} from "./lib/virmoor-taxonomy-refine.mjs";
import { ensureIndustryLabelNameZh } from "./lib/virmoor-namezh-label.mjs";
import { getVirmoorGapRoles, gapRoleToRecord } from "./lib/virmoor-new-roles.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const DEST = path.join(ROOT, "role-packs-src", "zh-CN-virmoor");
const SRC_ZH_CN = path.join(ROOT, "role-packs-src", "zh-CN");

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
    (f) => !f.endsWith("manifest.yaml") && !f.includes("_slug-map") && !f.includes("_audit"),
  );
  const roles = [];
  for (const file of files) {
    const rel = path.relative(DEST, file).replace(/\\/g, "/");
    const division = path.dirname(rel).split("/").pop();
    const raw = fs.readFileSync(file, "utf8");
    const { meta, bodyMd } = parseFrontmatter(raw);
    const slug = meta.slug || path.basename(file, ".md");
    roles.push({
      slug,
      division: meta.division || division,
      nameZh: meta.nameZh || meta.roleTitle || slug,
      meta,
      quickPrompts: meta.quickPrompts || [],
      bodyMd,
      sourceFile: rel,
    });
  }
  return roles;
}

function writeRoles(roles, refineMap) {
  const written = new Set();
  for (const role of roles) {
    const dir = path.join(DEST, role.division);
    fs.mkdirSync(dir, { recursive: true });
    const fm = buildFrontmatter(role.meta, role.slug, role.division, role.nameZh, role.quickPrompts);
    let body = fixMarketRoleBody(role.bodyMd, role.nameZh);
    body = body.replace(/^(###### 子场景：[^\n]+\n\n)+/, "");
    const sub = role.meta.catalogL5 ? `###### 子场景：${role.meta.catalogL5}\n\n` : "";
    const filePath = path.join(dir, `${role.slug}.md`);
    fs.writeFileSync(filePath, `${fm}${sub}${body}\n`, "utf8");
    written.add(filePath);
    if (role.slug !== role.sourceSlug) {
      refineMap.push({
        oldSlug: role.sourceSlug || role.slug,
        newSlug: role.slug,
        division: role.division,
        nameZh: role.nameZh,
        restored: role.restoredFrom || null,
        gapRole: role.gapRole || false,
      });
    }
  }
  for (const file of walkMdFiles(DEST)) {
    if (
      file.endsWith("manifest.yaml") ||
      file.includes("_slug-map") ||
      file.includes("_audit") ||
      file.includes("_refine-report")
    ) {
      continue;
    }
    if (!written.has(file)) fs.unlinkSync(file);
  }
}

function main() {
  const args = parseArgs(process.argv);
  let roles = loadRoles();

  roles = mergePromptsIntoTarget(
    roles,
    "specialized-cultural-intelligence-strategist",
    "specialized-role-bpkqngkgiw",
  );
  roles = roles.filter((r) => !DUPLICATE_SLUGS_REMOVE.includes(r.slug));

  const existingSlugs = new Set(roles.map((r) => r.slug));
  for (const restore of RESTORE_FROM_ZH_CN) {
    const restored = restoreRoleFromZhCn(SRC_ZH_CN, restore.path, restore);
    if (!existingSlugs.has(restored.slug)) {
      roles.push({ ...restored, sourceSlug: restored.slug });
      existingSlugs.add(restored.slug);
    }
  }

  for (const def of getVirmoorGapRoles()) {
    const rec = gapRoleToRecord(def);
    if (!existingSlugs.has(rec.slug)) {
      roles.push({ ...rec, sourceSlug: rec.slug });
      existingSlugs.add(rec.slug);
    }
  }

  const stats = {
    techMoved: 0,
    slugRenamed: 0,
    bodyFixed: 0,
    restored: RESTORE_FROM_ZH_CN.length,
    gapAdded: getVirmoorGapRoles().length,
    removedDuplicates: DUPLICATE_SLUGS_REMOVE.length,
  };

  const slugInUse = new Set();
  const refined = [];

  for (let role of roles) {
    role.sourceSlug = role.slug;
    role = refineNameZh(role);
    role = refineDivision(role);
    if (!role) continue;
    if (role.division === "engineering" && role.sourceSlug.startsWith("specialized")) stats.techMoved++;

    role.bodyMd = fixMarketRoleBody(role.bodyMd, role.nameZh);
    if (/知文文|一名扎根中国市场的[^虚]/.test(role.bodyMd)) stats.bodyFixed++;

    role = applyTaxonomyMeta(role);
    role = ensureIndustryLabelNameZh(role);
    role = applyTaxonomyMeta(role);
    role = refineSlug(role, slugInUse);
    if (role.slug !== role.sourceSlug) stats.slugRenamed++;

    if (role.slug.startsWith("security-")) {
      role.division = "security";
      role.meta = { ...role.meta, catalogL2: "security" };
      role = applyTaxonomyMeta(role);
    }

    refined.push(role);
  }

  const divisionCounts = {};
  for (const r of refined) {
    divisionCounts[r.division] = (divisionCounts[r.division] || 0) + 1;
  }

  stats.outputCount = refined.length;
  stats.divisionCounts = divisionCounts;
  stats.specializedCount = divisionCounts.specialized || 0;
  stats.engineeringCount = divisionCounts.engineering || 0;

  console.log("[refine-zh-cn-virmoor]", JSON.stringify(stats, null, 2));

  if (args.dryRun) {
    console.log("[refine-zh-cn-virmoor] dry-run — no files written");
    return;
  }

  const refineMap = [];
  writeRoles(refined, refineMap);

  const manifestPath = path.join(DEST, "manifest.yaml");
  let manifest = {};
  if (fs.existsSync(manifestPath)) {
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    } catch {
      manifest = {};
    }
  }
  manifest.roleCount = refined.length;
  manifest.refinedAt = new Date().toISOString();
  manifest.notes = `Phase0–3 治理 refine-zh-cn-virmoor-pack.mjs；${refined.length} 条岗位。`;
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");

  fs.writeFileSync(
    path.join(DEST, "_refine-report.json"),
    JSON.stringify({ stats, refineMap, at: new Date().toISOString() }, null, 2),
    "utf8",
  );

  console.log(`[refine-zh-cn-virmoor] wrote ${refined.length} roles → ${DEST}`);
}

main();
