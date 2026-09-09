/**
 * @file virmoor-role-duplicate-audit.mjs
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-31
 * @version 1.0.0
 * @category role-pack
 * @algo 岗位库重复审计：精确名、模糊 norm、语义对、误归 division、泛名
 */
import fs from "node:fs";
import path from "node:path";
import { parseFrontmatter, walkMdFiles } from "./virmoor-role-debrand.mjs";

const DIV_PREFIX =
  /^(工程|财务|战略|游戏|营销|销售|专项|市场|医疗|教育|产品|测试|安全|设计|项目管理|人力资源|运营|供应链|采购|风控|知识产权|学术|行政|文旅|零售|制造|房地产|营养|能源|媒体|公益|农业农村|董事会|金融服务|风控内审|安全合规|数据分析|GIS|游戏研发|付费投放|党群工会|地理信息)\s*[·.．]\s*/u;

const GENERIC_NAME_PATTERNS = [
  /^[^·]+ · 工程师$/u,
  /^[^·]+ · 架构师$/u,
  /^[^·]+ · 经理$/u,
  /^[^·]+ · 总监$/u,
  /^[^·]+ · 专家$/u,
];

/** 全角→半角、去 division 前缀、去空格、弱化职业尾缀 */
export function fuzzyNorm(nameZh) {
  let n = String(nameZh || "")
    .replace(/[\uFF01-\uFF5E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
    .replace(DIV_PREFIX, "")
    .replace(/\s+/g, "")
    .replace(/(专家|顾问|工程师|架构师|开发者|开发|专员|经理|总监|师|家|员)$/u, "")
    .trim()
    .toLowerCase();
  return n;
}

export function normName(nameZh) {
  return String(nameZh || "").replace(DIV_PREFIX, "").trim();
}

export function isGenericNameZh(nameZh) {
  const n = String(nameZh || "").trim();
  if (!n || n.length < 6) return true;
  return GENERIC_NAME_PATTERNS.some((re) => re.test(n));
}

export function slugPreferenceScore(slug) {
  let s = 0;
  if (/^engineering-/i.test(slug)) s += 120;
  if (/^(unity-|godot-|fou-|xr-|visionos-)/i.test(slug)) s += 110;
  if (/^specialized-[A-Za-z]/i.test(slug) && !/^specialized-role-/i.test(slug)) s += 40;
  if (/^specialized-role-[a-z0-9]+$/i.test(slug)) s += 5;
  if (slug.startsWith("ex_")) s -= 20;
  return s;
}

export function inferMisplacedDivision(role) {
  const { slug, division, sourceFile } = role;
  const folder = sourceFile ? path.dirname(sourceFile).replace(/\\/g, "/") : division;
  const issues = [];
  if (folder === "engineering" && slug.startsWith("marketing-")) {
    issues.push({ expected: "marketing", reason: "slug marketing-* 应在 marketing 目录" });
  }
  if (folder === "engineering" && slug.startsWith("med-")) {
    issues.push({ expected: "healthcare", reason: "slug med-* 应在 healthcare 目录" });
  }
  if (division !== folder && folder !== "." && !folder.includes("_")) {
    issues.push({ expected: folder, reason: `division=${division} 与路径 ${folder} 不一致` });
  }
  return issues;
}

export function loadPackRoles(packRoot) {
  const files = walkMdFiles(packRoot).filter(
    (f) =>
      !f.endsWith("manifest.yaml") &&
      !f.includes("_slug-map") &&
      !/_duplicate-audit|_content-audit|_dedupe-report|_compliance-scan/.test(f),
  );
  const roles = [];
  for (const file of files) {
    const raw = fs.readFileSync(file, "utf8");
    const { meta, bodyMd } = parseFrontmatter(raw);
    const slug = meta.slug || path.basename(file, ".md");
    const division = meta.division || path.dirname(file).split(path.sep).pop();
    roles.push({
      slug,
      division,
      nameZh: meta.nameZh || meta.roleTitle || slug,
      meta,
      bodyMd,
      sourceFile: path.relative(packRoot, file).replace(/\\/g, "/"),
    });
  }
  return roles;
}

function bucketGroups(roles, keyFn) {
  const map = new Map();
  for (const r of roles) {
    const k = keyFn(r);
    if (!k) continue;
    if (!map.has(k)) map.set(k, []);
    map.get(k).push({ slug: r.slug, nameZh: r.nameZh, division: r.division, sourceFile: r.sourceFile });
  }
  return [...map.entries()]
    .filter(([, arr]) => arr.length >= 2)
    .map(([key, members]) => ({ key, count: members.length, members }))
    .sort((a, b) => b.count - a.count);
}

function findSemanticPairs(roles) {
  const byDiv = new Map();
  for (const r of roles) {
    if (!byDiv.has(r.division)) byDiv.set(r.division, []);
    byDiv.get(r.division).push(r);
  }
  const pairs = [];
  for (const [division, list] of byDiv) {
    const semantic = list.filter((r) => /^specialized-/i.test(r.slug));
    const canonical = list.filter((r) => !/^specialized-role-/i.test(r.slug) && !/^specialized-/i.test(r.slug));
    for (const s of semantic) {
      const fn = fuzzyNorm(s.nameZh);
      if (!fn || fn.length < 4) continue;
      for (const c of canonical) {
        const fc = fuzzyNorm(c.nameZh);
        if (fc === fn || (fc.length > 4 && fn.includes(fc)) || (fn.length > 4 && fc.includes(fn))) {
          pairs.push({
            division,
            anchor: c.slug,
            duplicate: s.slug,
            anchorName: c.nameZh,
            duplicateName: s.nameZh,
            fuzzyKey: fn,
          });
        }
      }
    }
  }
  return pairs.slice(0, 200);
}

export function auditPack(packRoot) {
  const roles = loadPackRoles(packRoot);
  const exactNameZh = bucketGroups(roles, (r) => r.nameZh);
  const fuzzyNormGroups = bucketGroups(roles, (r) => `${r.division}::${fuzzyNorm(r.nameZh)}`);
  const crossDivisionFuzzy = bucketGroups(roles, (r) => fuzzyNorm(r.nameZh));
  const semanticPairs = findSemanticPairs(roles);
  const misplacedDivision = roles
    .flatMap((r) =>
      inferMisplacedDivision(r).map((issue) => ({
        slug: r.slug,
        nameZh: r.nameZh,
        division: r.division,
        sourceFile: r.sourceFile,
        ...issue,
      })),
    );
  const genericNameZh = roles
    .filter((r) => isGenericNameZh(r.nameZh))
    .map((r) => ({ slug: r.slug, nameZh: r.nameZh, division: r.division }));

  return {
    scanned: roles.length,
    exactNameZhCount: exactNameZh.length,
    fuzzyNormGroupCount: fuzzyNormGroups.length,
    crossDivisionFuzzyCount: crossDivisionFuzzy.length,
    semanticPairCount: semanticPairs.length,
    misplacedCount: misplacedDivision.length,
    genericNameCount: genericNameZh.length,
    exactNameZh: exactNameZh.slice(0, 40),
    fuzzyNormGroups: fuzzyNormGroups.slice(0, 40),
    crossDivisionFuzzy: crossDivisionFuzzy.slice(0, 30),
    semanticPairs: semanticPairs.slice(0, 80),
    misplacedDivision,
    genericNameZh: genericNameZh.slice(0, 50),
  };
}
