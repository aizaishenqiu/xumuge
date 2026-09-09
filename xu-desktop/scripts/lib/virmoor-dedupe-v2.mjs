/**
 * @file virmoor-dedupe-v2.mjs
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-31
 * @version 1.0.0
 * @category role-pack
 * @algo 二轮去重：fuzzyNorm + specialized/engineering 语义合并 + 泛名惩罚
 */
import {
  fuzzyNorm,
  isGenericNameZh,
  slugPreferenceScore,
} from "./virmoor-role-duplicate-audit.mjs";
import { mergeQuickPrompts } from "./virmoor-role-debrand.mjs";
import { fixMarketRoleBody } from "./virmoor-taxonomy-refine.mjs";
import { getVirmoorGapRoles } from "./virmoor-new-roles.mjs";

const GAP_SLUGS = new Set(getVirmoorGapRoles().map((r) => r.slug));

/** 高置信：specialized slug → 语义化 canonical slug */
export const SEMANTIC_MERGE_ANCHORS = {
  "specialized-Unity-uj5lgpa1": "unity-editor-tool-developer",
  "specialized-Unity-9yptfki4": "unity-shader-graph-artist",
  "specialized-Unity": "unity-architect",
  "specialized-Godot": "godot-gameplay-scripter",
  "specialized-Godot-uae2twht": "godot-shader-developer",
  "specialized-API-prhek8wy": "engineering-API-jwzlgkj6",
  "specialized-API-p714chav": "engineering-API-jwzlgkj6",
  "specialized-API": "engineering-technical-writer",
  "specialized-Git": "engineering-git-workflow-master",
  "specialized-Git-sz4g9817": "engineering-git-workflow-master",
  "specialized-GitHub": "engineering-code-reviewer",
  "specialized-React": "engineering-frontend-developer",
  "specialized-React-Next-js": "engineering-frontend-developer",
  "specialized-React-Native": "engineering-mobile-app-builder",
  "specialized-SQL": "engineering-database-optimizer",
  "engineering-PPT": "engineering-data-analytics-ppt-specialist",
  "engineering-PPT-sd5r4a4h": "engineering-data-analytics-ppt-specialist",
  "engineering-API": "engineering-api-platform-engineer",
  "engineering-SQL": "engineering-database-optimizer",
  "engineering-SQL-oin6u2c9": "engineering-database-optimizer",
};

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

function pickBetterBody(a, b) {
  const score = (s) => (s?.length || 0) + (s?.includes("🧠") ? 500 : 0);
  return score(a) >= score(b) ? a : b;
}

function pickBetterNameZh(a, b) {
  const score = (n) => {
    let s = String(n || "").length;
    if (isGenericNameZh(n)) s -= 80;
    return s;
  };
  return score(a) >= score(b) ? a : b;
}

export function scoreRoleV2(role, groupSize = 1) {
  let s = slugPreferenceScore(role.slug);
  if (groupSize <= 2 && GAP_SLUGS.has(role.slug)) s += 200;
  s += Math.min(role.bodyMd?.length || 0, 2000) / 20;
  s += (role.quickPrompts?.length || 0) * 5;
  if (!isGenericNameZh(role.nameZh)) s += role.nameZh?.length || 0;
  else s -= 50;
  return s;
}

export function pickCanonicalV2(group) {
  return group.reduce((best, cur) =>
    scoreRoleV2(cur, group.length) > scoreRoleV2(best, group.length) ? cur : best,
  );
}

export function buildMergeKeysV2(role) {
  const { division, meta, nameZh } = role;
  const fn = fuzzyNorm(nameZh);
  const keys = [];
  if (fn.length >= 4) keys.push(`${division}::fuzzy::${fn}`);
  const desc = String(meta.description || "").trim();
  if (desc.length >= 4 && fuzzyNorm(desc) === fn) {
    keys.push(`${division}::descfuzzy::${fn}`);
  }
  return keys;
}

export function mergeGroupsV2(roles) {
  const uf = new UnionFind();
  for (const r of roles) uf.find(r.slug);

  for (const [dup, anchor] of Object.entries(SEMANTIC_MERGE_ANCHORS)) {
    const hasDup = roles.some((r) => r.slug === dup);
    const hasAnchor = roles.some((r) => r.slug === anchor);
    if (hasDup && hasAnchor) uf.union(anchor, dup);
  }

  const buckets = new Map();
  for (const role of roles) {
    for (const key of buildMergeKeysV2(role)) {
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(role.slug);
    }
  }
  for (const [, slugs] of buckets) {
    if (slugs.length < 2) continue;
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
    const canonical = pickCanonicalV2(group);
    let bodyMd = canonical.bodyMd;
    let quickPrompts = [...canonical.quickPrompts];
    let nameZh = canonical.nameZh;
    const mergedSlugs = [];

    for (const other of group) {
      if (other.slug === canonical.slug) continue;
      bodyMd = pickBetterBody(bodyMd, other.bodyMd);
      quickPrompts = mergeQuickPrompts(quickPrompts, other.quickPrompts);
      nameZh = pickBetterNameZh(nameZh, other.nameZh);
      mergedSlugs.push({
        slug: other.slug,
        nameZh: other.nameZh,
        sourceFile: other.sourceFile,
      });
    }

    if (mergedSlugs.length) {
      mergeLog.push({
        keptSlug: canonical.slug,
        keptNameZh: nameZh,
        groupSize: group.length,
        merged: mergedSlugs,
      });
    }

    mergedOut.push({
      ...canonical,
      nameZh,
      meta: { ...canonical.meta, nameZh, roleTitle: nameZh, catalogL4: nameZh },
      bodyMd: fixMarketRoleBody(bodyMd, nameZh),
      quickPrompts,
    });
  }

  return { roles: mergedOut, mergeLog };
}
