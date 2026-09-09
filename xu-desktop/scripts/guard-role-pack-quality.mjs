/**
 * @file xupack 岗位 skill 质量门禁：frontmatter、九段式核心段、开会义务
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-31
 * @version 1.0.0
 * @category Config
 * @algo role-md-quality-gate
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

const REQUIRED_META = ["id", "slug", "nameZh"];

const CORE_SECTIONS = [
  { label: "核心使命", re: /核心使命/ },
  { label: "必须遵守的规则", re: /必须遵守的规则/ },
  { label: "成功标准", re: /成功标准/ },
];

/** XU_NEED_CONFIRM or Chinese equivalents of meeting / clarify-before-act duty */
const MEETING_DUTY_RE =
  /XU_NEED_CONFIRM|先追问|需求不清|阻塞必报|先开会|开会请示|请示老板|上报老板|禁止瞎猜|禁止假设硬写/i;

/**
 * @param {string} raw
 * @returns {{ meta: Record<string, string>; bodyMd: string } | null}
 */
export function parseFrontmatterLoose(raw) {
  const m = String(raw || "").match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!m) return null;
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (!kv) continue;
    let val = kv[2].trim();
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1).replace(/\\"/g, '"');
    meta[kv[1]] = val;
  }
  return { meta, bodyMd: m[2].trim() };
}

/**
 * @param {string} filePath
 * @param {string} raw
 * @returns {string[]}
 */
export function validateRoleMarkdown(filePath, raw) {
  const errors = [];
  const parsed = parseFrontmatterLoose(raw);
  if (!parsed) {
    errors.push(`${filePath}: missing YAML frontmatter`);
    return errors;
  }
  const { meta, bodyMd } = parsed;
  for (const key of REQUIRED_META) {
    if (!(meta[key] || "").trim()) errors.push(`${filePath}: missing frontmatter.${key}`);
  }
  for (const sec of CORE_SECTIONS) {
    if (!sec.re.test(bodyMd)) errors.push(`${filePath}: missing section 「${sec.label}」`);
  }
  if (!MEETING_DUTY_RE.test(bodyMd)) {
    errors.push(
      `${filePath}: missing meeting duty (XU_NEED_CONFIRM or 先追问/开会/阻塞上报等)`,
    );
  }
  return errors;
}

function walkMdFiles(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walkMdFiles(p));
    else if (ent.name.endsWith(".md")) out.push(p);
  }
  return out;
}

/**
 * @param {{
 *   locale?: string;
 *   slugs?: Set<string> | string[] | null;
 *   divisions?: Set<string> | string[] | null;
 *   samplePerDivision?: number;
 *   demo?: boolean;
 *   strictAll?: boolean;
 * }} opts
 * @returns {{ errors: string[]; checked: number }}
 *
 * Full check only when `--slugs` or `--strict-all`. Otherwise sample per division
 * (default 3), including bare `--demo` / `--all` local packs.
 */
export function runRolePackQualityGate(opts = {}) {
  const locale = opts.locale || "zh-CN";
  const srcRoot = path.join(ROOT, "role-packs-src", locale);
  const errors = [];
  if (!fs.existsSync(srcRoot)) {
    return { errors: [`Source not found: ${srcRoot}`], checked: 0 };
  }

  const slugSet = opts.slugs
    ? opts.slugs instanceof Set
      ? opts.slugs
      : new Set(opts.slugs)
    : null;
  const divSet = opts.divisions
    ? opts.divisions instanceof Set
      ? opts.divisions
      : new Set(opts.divisions)
    : null;

  /** @type {Map<string, string[]>} */
  const byDivision = new Map();
  for (const file of walkMdFiles(srcRoot)) {
    const rel = path.relative(srcRoot, file).replace(/\\/g, "/");
    if (rel === "manifest.yaml") continue;
    const raw = fs.readFileSync(file, "utf8");
    const parsed = parseFrontmatterLoose(raw);
    if (!parsed) continue;
    const slug = (parsed.meta.slug || path.basename(file, ".md")).trim();
    const division = (parsed.meta.division || "unknown").trim();
    if (slugSet && !slugSet.has(slug)) continue;
    if (divSet && !divSet.has(division)) continue;
    if (!byDivision.has(division)) byDivision.set(division, []);
    byDivision.get(division).push(file);
  }

  /** @type {string[]} */
  let filesToCheck = [];
  const fullCheck = Boolean(opts.strictAll) || Boolean(slugSet);
  if (fullCheck) {
    for (const list of byDivision.values()) filesToCheck.push(...list);
  } else {
    const n = Math.max(1, Math.floor(opts.samplePerDivision ?? 3));
    for (const list of byDivision.values()) {
      const sorted = [...list].sort();
      filesToCheck.push(...sorted.slice(0, n));
    }
  }

  filesToCheck = [...new Set(filesToCheck)].sort();
  for (const file of filesToCheck) {
    const rel = path.relative(ROOT, file).replace(/\\/g, "/");
    errors.push(...validateRoleMarkdown(rel, fs.readFileSync(file, "utf8")));
  }
  return { errors, checked: filesToCheck.length };
}

function parseCli(argv) {
  const out = {
    locale: "zh-CN",
    demo: false,
    slugs: null,
    divisions: null,
    samplePerDivision: 3,
    strictAll: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--locale") out.locale = argv[++i];
    else if (a === "--demo") out.demo = true;
    else if (a === "--strict-all") out.strictAll = true;
    else if (a === "--slugs") out.slugs = argv[++i].split(",").map((s) => s.trim()).filter(Boolean);
    else if (a === "--divisions")
      out.divisions = argv[++i].split(",").map((s) => s.trim()).filter(Boolean);
    else if (a === "--sample-per-division") out.samplePerDivision = Number(argv[++i]) || 3;
  }
  return out;
}

function main() {
  const args = parseCli(process.argv);
  const { errors, checked } = runRolePackQualityGate(args);
  if (errors.length) {
    console.error(`[guard-role-pack-quality] FAIL (${errors.length} issues, checked ${checked})`);
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  console.log(`[guard-role-pack-quality] OK (checked ${checked} roles)`);
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) main();
