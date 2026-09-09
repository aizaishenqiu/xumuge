/**
 * @file build-zh-cn-virmoor-pack.mjs
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-30
 * @version 1.0.0
 * @category role-pack
 * @algo 从 zh-CN 只读转换生成 zh-CN-virmoor 去 WorkBuddy 岗位包
 *
 * node scripts/build-zh-cn-virmoor-pack.mjs --dry-run
 * node scripts/build-zh-cn-virmoor-pack.mjs --write
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  deriveNameZh,
  buildSemanticSlug,
  debrandBody,
  debrandQuickPrompts,
  debrandTags,
  debrandDescription,
  buildFrontmatter,
  mergeQuickPrompts,
  parseFrontmatter,
  walkMdFiles,
} from "./lib/virmoor-role-debrand.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const SRC = path.join(ROOT, "role-packs-src", "zh-CN");
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

function emptyDir(dir) {
  if (!fs.existsSync(dir)) return;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) fs.rmSync(p, { recursive: true, force: true });
    else fs.unlinkSync(p);
  }
}

function resolveUniqueSlug(baseSlug, slugInUse, oldSlug) {
  if (!slugInUse.has(baseSlug)) return baseSlug;
  const tail = oldSlug.replace(/^ex_/i, "").slice(0, 8).toLowerCase();
  const alt = `${baseSlug}-${tail}`.slice(0, 64);
  if (!slugInUse.has(alt)) return alt;
  let n = 2;
  while (slugInUse.has(`${baseSlug}-${n}`)) n++;
  return `${baseSlug}-${n}`.slice(0, 64);
}

function similarityKey(nameZh, division, catalogL5, tags, oldSlug) {
  const tagKey = (tags || []).slice(0, 3).join("|");
  const idTail = String(oldSlug || "").replace(/^ex_/i, "").slice(0, 6);
  return `${division}::${nameZh}::${catalogL5 || ""}::${tagKey}::${idTail}`;
}

function pickBetterBody(a, b) {
  const score = (s) => (s?.length || 0) + (s?.includes("🧠") ? 500 : 0);
  return score(a) >= score(b) ? a : b;
}

function main() {
  const args = parseArgs(process.argv);
  const files = walkMdFiles(SRC).filter((f) => !f.endsWith("manifest.yaml"));
  const slugMap = [];
  const slugInUse = new Set();
  const byKey = new Map();
  let merged = 0;
  let renamed = 0;

  for (const file of files) {
    const rel = path.relative(SRC, file).replace(/\\/g, "/");
    const raw = fs.readFileSync(file, "utf8");
    const { meta, bodyMd } = parseFrontmatter(raw);
    const oldSlug = meta.slug || path.basename(file, ".md");
    const oldId = meta.id || oldSlug;
    const division = meta.division || path.dirname(rel).split("/").pop() || "specialized";
    const nameZh = deriveNameZh(meta);
    if (nameZh !== meta.nameZh) renamed++;

    const tags = debrandTags(meta.tags, nameZh);
    const description = debrandDescription(meta.description || meta.profession || "", nameZh);
    const enrichedMeta = { ...meta, tags, description };

    let baseSlug = buildSemanticSlug(division, nameZh, enrichedMeta, oldSlug);
    const simKey = similarityKey(nameZh, division, meta.catalogL5, tags, oldSlug);
    const prompts = debrandQuickPrompts(meta.quickPrompts, nameZh);
    const body = debrandBody(bodyMd, nameZh);

    if (byKey.has(simKey)) {
      const existing = byKey.get(simKey);
      existing.quickPrompts = mergeQuickPrompts(existing.quickPrompts, prompts);
      existing.bodyMd = pickBetterBody(existing.bodyMd, body);
      existing.mergedFrom.push({ oldId, oldSlug, path: rel });
      merged++;
      slugMap.push({
        oldId,
        oldSlug,
        newSlug: existing.slug,
        newNameZh: nameZh,
        merged: true,
        path: rel,
      });
      continue;
    }

    const slug = resolveUniqueSlug(baseSlug, slugInUse, oldSlug);
    slugInUse.add(slug);

    const entry = {
      slug,
      division,
      meta: enrichedMeta,
      nameZh,
      quickPrompts: prompts,
      bodyMd: body,
      mergedFrom: [{ oldId, oldSlug, path: rel }],
    };
    byKey.set(simKey, entry);
    if (slug !== oldSlug) slugMap.push({ oldId, oldSlug, newSlug: slug, newNameZh: nameZh, merged: false, path: rel });
    else slugMap.push({ oldId, oldSlug, newSlug: slug, newNameZh: nameZh, merged: false, path: rel });
  }

  const roles = [...byKey.values()];
  const stats = {
    sourceCount: files.length,
    outputCount: roles.length,
    merged,
    renamed,
    slugCollisionsResolved: slugMap.filter((m) => m.newSlug !== buildSemanticSlug(
      m.path.split("/")[0],
      m.newNameZh,
      {},
      m.oldSlug,
    )).length,
  };

  console.log("[build-zh-cn-virmoor]", JSON.stringify(stats, null, 2));

  if (args.dryRun) {
    console.log("[build-zh-cn-virmoor] dry-run — no files written");
    return;
  }

  emptyDir(DEST);
  fs.mkdirSync(DEST, { recursive: true });

  for (const role of roles) {
    const dir = path.join(DEST, role.division);
    fs.mkdirSync(dir, { recursive: true });
    const fm = buildFrontmatter(role.meta, role.slug, role.division, role.nameZh, role.quickPrompts);
    let body = role.bodyMd.replace(/^(###### 子场景：[^\n]+\n\n)+/, "");
    const sub = role.meta.catalogL5 ? `###### 子场景：${role.meta.catalogL5}\n\n` : "";
    const content = `${fm}${sub}${body}\n`;
    fs.writeFileSync(path.join(dir, `${role.slug}.md`), content, "utf8");
  }

  fs.writeFileSync(path.join(DEST, "_slug-map.json"), JSON.stringify(slugMap, null, 2), "utf8");

  const manifest = {
    locale: "zh-CN-virmoor",
    version: 2,
    packId: "virmoor-roles-zh-CN",
    roleCount: roles.length,
    taxonomyVersion: 1,
    syncedAt: new Date().toISOString(),
    source: "role-packs-src/zh-CN-virmoor（由 zh-CN 去 WorkBuddy 化生成，不改动原 zh-CN/zh-kimi）",
    composition: {
      virmoor: roles.length,
      mergedFromSource: files.length,
    },
    notes: `由 scripts/build-zh-cn-virmoor-pack.mjs 生成；源 ${files.length} 条，合并后 ${roles.length} 条。`,
  };
  fs.writeFileSync(path.join(DEST, "manifest.yaml"), JSON.stringify(manifest, null, 2) + "\n", "utf8");

  console.log(`[build-zh-cn-virmoor] wrote ${roles.length} roles → ${DEST}`);
}

main();
