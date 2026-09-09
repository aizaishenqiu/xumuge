/**
 * Split docs/专家目录_全集_1222条.md (Part 四-A only) → role-packs-src/{locale}/*.md
 *
 * node scripts/split-expert-catalog-to-role-packs.mjs --backup
 * node scripts/split-expert-catalog-to-role-packs.mjs --dry-run
 * node scripts/split-expert-catalog-to-role-packs.mjs --write
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inferTaxonomyFields, slugifyToken } from "./lib/role-taxonomy.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

const DEFAULT_INPUT = path.join(ROOT, "role-packs-src/_archive/专家目录_全集_1222条.md");
const DEFAULT_LOCALE = "zh-virmoon";

/** division / catalogL2 (CN or EN) → folder key under role-packs-src */
const DIVISION_NORMALIZE = {
  engineering: "engineering",
  design: "design",
  product: "product",
  testing: "testing",
  marketing: "marketing",
  sales: "sales",
  finance: "finance",
  support: "support",
  strategy: "strategy",
  specialized: "specialized",
  academic: "academic",
  healthcare: "healthcare",
  education: "education",
  "project-management": "project-management",
  security: "security",
  "software-company": "software-company",
  "supply-chain": "supply-chain",
  tourism: "tourism",
  数据智能: "engineering",
  工程研发: "engineering",
  技术研发: "engineering",
  创意设计: "design",
  产品: "product",
  测试质量: "testing",
  市场运营: "marketing",
  销售: "sales",
  金融: "finance",
  财务: "finance",
  金融投资: "finance",
  支持: "support",
  战略: "strategy",
  咨询: "strategy",
  专业: "specialized",
  医疗: "healthcare",
  医疗健康: "healthcare",
  教育: "education",
  教育培训: "education",
  安全: "security",
  供应链: "supply-chain",
  旅游: "tourism",
};

function parseArgs(argv) {
  const out = {
    input: DEFAULT_INPUT,
    locale: DEFAULT_LOCALE,
    backup: false,
    dryRun: false,
    write: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--input") {
      const v = argv[++i];
      out.input = path.isAbsolute(v) ? v : path.join(ROOT, v);
    } else if (a === "--locale") out.locale = argv[++i];
    else if (a === "--backup") out.backup = true;
    else if (a === "--dry-run") out.dryRun = true;
    else if (a === "--write") out.write = true;
  }
  return out;
}

function yamlQuote(s) {
  const v = String(s ?? "");
  if (!v) return '""';
  if (/[:#\n\r"'\\[\]{}]/.test(v) || v.startsWith(" ") || v.endsWith(" ")) {
    return `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  return `"${v}"`;
}

function slugifyId(id) {
  return slugifyToken(id).slice(0, 80);
}

function parseYamlBlock(text) {
  const meta = {};
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const kv = t.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1];
    let val = kv[2].trim();
    if (val === "true") meta[key] = true;
    else if (val === "false") meta[key] = false;
    else if (val.startsWith("{")) {
      try {
        meta[key] = JSON.parse(val.replace(/'/g, '"'));
      } catch {
        meta[key] = val;
      }
    } else if (val.startsWith("[") && val.endsWith("]")) {
      meta[key] = val
        .slice(1, -1)
        .split(",")
        .map((s) => s.trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean);
    } else if (val.startsWith('"') && val.endsWith('"')) meta[key] = val.slice(1, -1);
    else meta[key] = val;
  }
  return meta;
}

function normalizeDivision(meta) {
  const raw = meta.division || meta.catalogL2 || meta.catalogL3 || "specialized";
  const key = String(raw).trim();
  if (DIVISION_NORMALIZE[key]) return DIVISION_NORMALIZE[key];
  if (/^[a-z][a-z0-9-]*$/i.test(key)) return key.toLowerCase();
  return "specialized";
}

function inferBrainSlot(roleAxis, division) {
  const axis = String(roleAxis || "");
  if (/战略|经营|管理|咨询/.test(axis)) return "command";
  if (/技术|研发|安全|工程|数据|算法/.test(axis) || division === "engineering" || division === "testing") return "code";
  return "work";
}

function inferKickoffWave(division, roleAxis) {
  const axis = String(roleAxis || "");
  if (division === "testing" || /测试|QA|质量/.test(axis)) return "qa";
  if (division === "engineering" || /技术|研发|工程|数据/.test(axis)) return "dev";
  if (division === "design" || division === "product" || /产品|设计/.test(axis)) return "planning";
  return "planning";
}

function normalizeRoleKind(kind) {
  const k = String(kind || "worker").toLowerCase();
  if (k === "expert" || k === "agent") return "worker";
  if (k === "boss" || k === "reviewer" || k === "worker") return k;
  return "worker";
}

function buildFrontmatter(meta, slug, division, originSource) {
  const tax = inferTaxonomyFields(meta, slug, division);
  const divisionZh = meta.catalogL2 || meta.division || division;
  const tags = Array.isArray(meta.tags) ? meta.tags : [];
  const industryTags = tax.industryTags.length ? tax.industryTags : tags;
  const quickPrompts = Array.isArray(meta.quickPrompts) ? meta.quickPrompts : [];
  const description = String(meta.profession || meta.description || "").slice(0, 500);
  const roleKind = normalizeRoleKind(meta.roleKind);
  const brainSlot = inferBrainSlot(meta.roleAxis, division);
  const kickoffWave = inferKickoffWave(division, meta.roleAxis);
  const relSource = `${division}/${slug}.md`;
  const expertType = meta.expertType || "agent";
  const lifecycleStatus = meta.lifecycleStatus || "published";

  const lines = [
    "---",
    `id: ${yamlQuote(meta.id)}`,
    `slug: ${slug}`,
    `nameZh: ${yamlQuote(meta.nameZh || slug)}`,
    `industryId: ${tax.industryId}`,
    `industryZh: ${yamlQuote(tax.industryZh)}`,
    `industryTags: [${industryTags.map((t) => yamlQuote(t)).join(", ")}]`,
    `positionId: ${tax.positionId}`,
    `positionZh: ${yamlQuote(tax.positionZh)}`,
    `positionCategory: ${tax.positionCategory}`,
    `positionCategoryZh: ${yamlQuote(tax.positionCategoryZh)}`,
    ...(tax.positionSubCategory
      ? [`positionSubCategory: ${tax.positionSubCategory}`]
      : []),
    `division: ${division}`,
    `divisionZh: ${yamlQuote(divisionZh)}`,
    `emoji: ${yamlQuote(meta.emoji || "👤")}`,
    `roleKind: ${roleKind}`,
    `brainSlot: ${brainSlot}`,
    `kickoffWave: ${kickoffWave}`,
    `tags: [${tags.map((t) => yamlQuote(t)).join(", ")}]`,
    `description: ${yamlQuote(description)}`,
    `source: ${yamlQuote(relSource)}`,
    `originSource: ${originSource}`,
    `autoGenerated: ${meta.autoGenerated === true ? "true" : "false"}`,
    `expertType: ${yamlQuote(expertType)}`,
    `lifecycleStatus: ${lifecycleStatus}`,
    `catalogL1: ${yamlQuote(meta.catalogL1 || "")}`,
    `catalogL2: ${yamlQuote(meta.catalogL2 || "")}`,
    `catalogL3: ${yamlQuote(meta.catalogL3 || "")}`,
    `catalogL4: ${yamlQuote(meta.catalogL4 || "")}`,
    `catalogL5: ${yamlQuote(meta.catalogL5 || "")}`,
    `roleAxis: ${yamlQuote(meta.roleAxis || "")}`,
    `roleTitle: ${yamlQuote(meta.roleTitle || "")}`,
    `recoRank: ${Number(meta.recoRank) || 0}`,
    `useCount: ${Number(meta.useCount) || 0}`,
    `marketId: ${yamlQuote(meta.marketId || "")}`,
    `version: ${yamlQuote(String(meta.version || "1.0.0"))}`,
    `quickPrompts: [${quickPrompts.map((t) => yamlQuote(t)).join(", ")}]`,
    "---",
    "",
  ];
  return lines.join("\n");
}

function extractPartA(text) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => l.startsWith("## 四-A"));
  const end = lines.findIndex((l) => l.startsWith("## 四-B"));
  if (start < 0 || end < 0) throw new Error("Part 四-A / 四-B markers not found");
  return lines.slice(start, end).join("\n");
}

function parseEntries(partA) {
  const headerRe = /^##### .+ `([^`]+)` 〔(zh-kimi|市场)〕\s*$/gm;
  const matches = [...partA.matchAll(headerRe)];
  const entries = [];

  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const id = m[1].trim();
    const originSource = m[2] === "市场" ? "market" : "zh-kimi";
    const start = m.index + m[0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index : partA.length;
    const block = partA.slice(start, end).trim();

    const yamlM = block.match(/```yaml\r?\n([\s\S]*?)```/);
    if (!yamlM) {
      entries.push({ id, originSource, error: "missing yaml block" });
      continue;
    }
    const meta = parseYamlBlock(yamlM[1]);
    meta.id = meta.id || id;

    let body = block.slice(yamlM.index + yamlM[0].length).trim();
    body = body.replace(/^>\s*定位：[^\n]*\n?/m, "").trim();

    entries.push({ id: meta.id, slug: slugifyId(meta.id) || slugifyId(id), originSource, meta, body });
  }
  return entries;
}

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

function backupLocale(locale) {
  const src = path.join(ROOT, "role-packs-src", locale);
  if (!fs.existsSync(src)) {
    console.error(`Nothing to backup: ${src}`);
    process.exit(1);
  }
  const ts = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 15);
  const dest = path.join(ROOT, "role-packs-src", `${locale}.backup-${ts}`);
  fs.cpSync(src, dest, { recursive: true });
  const count = walkMd(dest).length;
  console.log(`Backed up ${count} md files → ${dest}`);
  return dest;
}

function main() {
  const args = parseArgs(process.argv);
  if (args.backup) {
    backupLocale(args.locale);
    return;
  }

  if (!fs.existsSync(args.input)) {
    console.error(`Input not found: ${args.input}`);
    process.exit(1);
  }

  const text = fs.readFileSync(args.input, "utf8");
  const partA = extractPartA(text);
  const entries = parseEntries(partA);

  const outRoot = path.join(ROOT, "role-packs-src", args.locale);
  const existingFiles = walkMd(outRoot);
  const existingSlugs = new Set(existingFiles.map((f) => path.basename(f, ".md")));

  const bySource = { "zh-kimi": 0, market: 0 };
  const errors = [];
  const slugToId = new Map();
  const conflicts = [];

  for (const e of entries) {
    if (e.error) {
      errors.push(e);
      continue;
    }
    bySource[e.originSource] = (bySource[e.originSource] || 0) + 1;
    if (slugToId.has(e.slug) && slugToId.get(e.slug) !== e.id) {
      conflicts.push({ slug: e.slug, prev: slugToId.get(e.slug), next: e.id });
    }
    slugToId.set(e.slug, e.id);
  }

  const catalogSlugs = new Set(entries.filter((e) => !e.error).map((e) => e.slug));
  const orphans = [...existingSlugs].filter((s) => !catalogSlugs.has(s));

  const report = {
    input: args.input,
    locale: args.locale,
    totalParsed: entries.length,
    bySource,
    errors: errors.length,
    conflicts,
    orphanSlugs: orphans,
    orphanCount: orphans.length,
    timestamp: new Date().toISOString(),
  };

  const reportDir = path.join(ROOT, "reports");
  fs.mkdirSync(reportDir, { recursive: true });
  const reportPath = path.join(reportDir, `split-expert-catalog-${new Date().toISOString().slice(0, 10)}.json`);

  console.log(`Parsed ${entries.length} entries (zh-kimi=${bySource["zh-kimi"]}, market=${bySource.market})`);
  console.log(`Errors=${errors.length}, conflicts=${conflicts.length}, orphanSlugs=${orphans.length}`);

  if (args.dryRun) {
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n", "utf8");
    console.log(`Dry-run report → ${reportPath}`);
    if (entries.length !== 1222) {
      console.warn(`WARN: expected 1222 entries, got ${entries.length}`);
      process.exit(1);
    }
    return;
  }

  if (!args.write) {
    console.log("Use --dry-run or --write");
    process.exit(1);
  }

  if (entries.length !== 1222) {
    console.error(`Abort: expected 1222 entries, got ${entries.length}`);
    process.exit(1);
  }

  let written = 0;
  let overwritten = 0;
  let marketNew = 0;

  for (const e of entries) {
    if (e.error) continue;
    const division = normalizeDivision(e.meta);
    const slug = e.slug;
    if (existingSlugs.has(slug)) overwritten++;
    else if (e.originSource === "market") marketNew++;

    const dir = path.join(outRoot, division);
    fs.mkdirSync(dir, { recursive: true });
    const fm = buildFrontmatter(e.meta, slug, division, e.originSource);
    const body = e.body.endsWith("\n") ? e.body : `${e.body}\n`;
    fs.writeFileSync(path.join(dir, `${slug}.md`), fm + body, "utf8");
    written++;
  }

  const manifest = {
    locale: args.locale,
    version: 2,
    packId: `hermes-roles-${args.locale}`,
    roleCount: written,
    splitAt: new Date().toISOString(),
    source: path.relative(ROOT, args.input),
    composition: bySource,
    orphanSlugsKept: orphans.length,
    notes: "1222 roles from Part 四-A; Part 四-B not split (duplicate index)",
  };
  fs.writeFileSync(path.join(outRoot, "manifest.yaml"), JSON.stringify(manifest, null, 2) + "\n", "utf8");

  report.written = written;
  report.overwritten = overwritten;
  report.marketNew = marketNew;
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n", "utf8");

  console.log(`Wrote ${written} roles → ${outRoot}`);
  console.log(`  overwritten=${overwritten}, marketNew=${marketNew}, orphans kept=${orphans.length}`);
  console.log(`Report → ${reportPath}`);
}

main();
