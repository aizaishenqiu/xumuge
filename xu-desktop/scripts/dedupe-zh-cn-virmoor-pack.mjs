/**
 * @file dedupe-zh-cn-virmoor-pack.mjs
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-30
 * @version 1.0.0
 * @category role-pack
 * @algo 激进去重：union-find 多键合并相近岗位（name/desc/tags/l5+首标签）
 *
 * node scripts/dedupe-zh-cn-virmoor-pack.mjs --dry-run
 * node scripts/dedupe-zh-cn-virmoor-pack.mjs --write
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildFrontmatter,
  mergeQuickPrompts,
  parseFrontmatter,
  walkMdFiles,
} from "./lib/virmoor-role-debrand.mjs";
import { fixMarketRoleBody } from "./lib/virmoor-taxonomy-refine.mjs";
import { getVirmoorGapRoles } from "./lib/virmoor-new-roles.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const DEST = path.join(ROOT, "role-packs-src", "zh-CN-virmoor");
const GAP_SLUGS = new Set(getVirmoorGapRoles().map((r) => r.slug));
const WEAK_KEY_MAX = 6;

function parseArgs(argv) {
  const out = { dryRun: false, write: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--dry-run") out.dryRun = true;
    else if (argv[i] === "--write") out.write = true;
  }
  if (!out.dryRun && !out.write) out.dryRun = true;
  return out;
}

function normName(n) {
  return String(n).replace(/^(工程|财务|战略|游戏|营销|销售|专项)\s*[·.]\s*/u, "").trim();
}

class UnionFind {
  parent = new Map();
  find(x) {
    if (!this.parent.has(x)) this.parent.set(x, x);
    if (this.parent.get(x) !== x) this.parent.set(x, this.find(this.parent.get(x)));
    return this.parent.get(x);
  }
  union(a, b) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(rb, ra);
  }
}

function scoreRole(role, groupSize = 1) {
  let s = 0;
  if (groupSize <= 2 && GAP_SLUGS.has(role.slug)) s += 200;
  if (!/^specialized-role-[a-z0-9]+$/i.test(role.slug)) s += 80;
  if (!role.slug.startsWith("ex_")) s += 40;
  s += Math.min(role.bodyMd?.length || 0, 2000) / 20;
  s += (role.quickPrompts?.length || 0) * 5;
  s += role.nameZh?.length || 0;
  return s;
}

function pickBetterBody(a, b) {
  const score = (s) => (s?.length || 0) + (s?.includes("🧠") ? 500 : 0);
  return score(a) >= score(b) ? a : b;
}

function pickCanonical(group) {
  return group.reduce((best, cur) =>
    scoreRole(cur, group.length) > scoreRole(best, group.length) ? cur : best,
  );
}

function loadRoles() {
  const files = walkMdFiles(DEST).filter(
    (f) =>
      !f.endsWith("manifest.yaml") &&
      !f.includes("_slug-map") &&
      !f.includes("_audit") &&
      !f.includes("_refine") &&
      !f.includes("_dedupe"),
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

function buildMergeKeys(role) {
  const { division, meta, nameZh } = role;
  const desc = String(meta.description || "").trim();
  const l5 = String(meta.catalogL5 || "").trim();
  const tags = [...(meta.tags || [])].sort().join("|");
  const firstTag = (meta.tags || [])[0] || "";
  const keys = [
    `${division}::name::${nameZh}`,
    `${division}::norm::${normName(nameZh)}`,
  ];
  if (desc.length >= 4) keys.push(`${division}::desc::${desc}`);
  if (tags) keys.push(`${division}::tags::${tags}`);
  if (l5 && firstTag) keys.push(`${division}::l5ft::${l5}::${firstTag}`);
  return keys;
}

function mergeGroups(roles) {
  const uf = new UnionFind();
  for (const r of roles) uf.find(r.slug);

  const buckets = new Map();
  for (const role of roles) {
    for (const key of buildMergeKeys(role)) {
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(role.slug);
    }
  }
  for (const [key, slugs] of buckets) {
    if (slugs.length < 2) continue;
    const isWeak = key.includes("::l5ft::") || key.includes("::tags::");
    if (isWeak && slugs.length > WEAK_KEY_MAX) continue;
    const root = slugs[0];
    for (let i = 1; i < slugs.length; i++) uf.union(root, slugs[i]);
  }

  const groups = new Map();
  for (const role of roles) {
    const root = uf.find(role.slug);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(role);
  }

  const mergedOut = [];
  const mergeLog = [];

  for (const group of groups.values()) {
    const canonical = pickCanonical(group);
    let bodyMd = canonical.bodyMd;
    let quickPrompts = [...canonical.quickPrompts];
    const mergedSlugs = [];

    for (const other of group) {
      if (other.slug === canonical.slug) continue;
      bodyMd = pickBetterBody(bodyMd, other.bodyMd);
      quickPrompts = mergeQuickPrompts(quickPrompts, other.quickPrompts);
      mergedSlugs.push({
        slug: other.slug,
        nameZh: other.nameZh,
        sourceFile: other.sourceFile,
      });
    }

    if (mergedSlugs.length) {
      mergeLog.push({
        keptSlug: canonical.slug,
        keptNameZh: canonical.nameZh,
        groupSize: group.length,
        merged: mergedSlugs,
      });
    }

    mergedOut.push({
      ...canonical,
      bodyMd: fixMarketRoleBody(bodyMd, canonical.nameZh),
      quickPrompts,
    });
  }

  return { roles: mergedOut, mergeLog };
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
      file.includes("_audit") ||
      file.includes("_refine") ||
      file.includes("_dedupe")
    ) {
      continue;
    }
    if (!written.has(file)) fs.unlinkSync(file);
  }
}

function main() {
  const args = parseArgs(process.argv);
  const input = loadRoles();
  const { roles, mergeLog } = mergeGroups(input);

  const stats = {
    inputCount: input.length,
    outputCount: roles.length,
    removed: input.length - roles.length,
    mergedGroups: mergeLog.length,
    largestGroup: mergeLog.reduce((m, g) => Math.max(m, g.groupSize), 0),
    topGroups: mergeLog
      .sort((a, b) => b.groupSize - a.groupSize)
      .slice(0, 15)
      .map((g) => ({ size: g.groupSize, kept: g.keptSlug, nameZh: g.keptNameZh })),
  };

  console.log("[dedupe-zh-cn-virmoor]", JSON.stringify(stats, null, 2));

  if (args.dryRun) {
    console.log("[dedupe-zh-cn-virmoor] dry-run — no files written");
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
  manifest.dedupedAt = new Date().toISOString();
  manifest.notes = `激进去重 dedupe-zh-cn-virmoor-pack.mjs；${input.length} → ${roles.length} 条。`;
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");

  fs.writeFileSync(
    path.join(DEST, "_dedupe-report.json"),
    JSON.stringify({ stats, mergeLog, at: new Date().toISOString() }, null, 2),
    "utf8",
  );

  console.log(`[dedupe-zh-cn-virmoor] wrote ${roles.length} roles → ${DEST}`);
}

main();
