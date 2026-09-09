/**
 * Build encrypted .xupack from role-packs-src/{locale}/ (AES-256-GCM only; never write plaintext JSON).
 *
 * node scripts/build-role-pack.mjs --locale zh-CN --out dist/hermes-roles-zh-CN.v1.xupack
 * node scripts/build-role-pack.mjs --locale zh-CN --demo --slugs xu-vue-foucui-engineer,design-brand-guardian,product-manager,engineering-backend-architect,business-strategist --out resources/role-packs/demo.zh-CN.xupack
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildFullPrompt } from "./lib/role-prompt-shell.mjs";
import {
  DEMO_PACK_KEY,
  deriveCommercialKey,
  encodeXupack,
  XUPACK_FLAG_DEMO,
  XUPACK_MAGIC,
} from "./lib/xupack.mjs";
import { runRolePackQualityGate } from "./guard-role-pack-quality.mjs";

const PROMPT_LEN_SOFT = 12000;

/**
 * Fail hard if the written file is not an AES-GCM xupack (prevents accidental plaintext JSON dumps).
 * @param {string} outPath
 * @param {Buffer} buf
 */
function assertEncryptedXupackOnDisk(outPath, buf) {
  if (!Buffer.isBuffer(buf) || buf.length < XUPACK_MAGIC.length) {
    console.error(`[build-role-pack] refuse plaintext: empty or too small ${outPath}`);
    process.exit(1);
  }
  if (!buf.subarray(0, XUPACK_MAGIC.length).equals(XUPACK_MAGIC)) {
    console.error(`[build-role-pack] refuse plaintext: missing XUPACK magic in ${outPath}`);
    process.exit(1);
  }
  const onDisk = fs.readFileSync(outPath);
  if (!onDisk.subarray(0, XUPACK_MAGIC.length).equals(XUPACK_MAGIC)) {
    console.error(`[build-role-pack] refuse plaintext: disk magic mismatch ${outPath}`);
    process.exit(1);
  }
  // Ciphertext must not contain JSON role field markers as UTF-8 substrings.
  const asLatin1 = onDisk.toString("latin1");
  if (asLatin1.includes('"bodyMd":') || asLatin1.includes('"prompt":')) {
    console.error(
      `[build-role-pack] refuse plaintext: found JSON field markers in ${outPath} (expected ciphertext only)`,
    );
    process.exit(1);
  }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

function parseArgs(argv) {
  const out = {
    locale: "zh-CN",
    demo: false,
    slugs: null,
    divisions: null,
    all: false,
    out: "",
    injectBasicsSnippets: false,
    skipQualityGate: false,
    strictAll: false,
    packId: "",
    keyHex: "",
    licenseId: "",
    contentVersion: "",
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--locale") out.locale = argv[++i];
    else if (a === "--demo") out.demo = true;
    else if (a === "--all") out.all = true;
    else if (a === "--out") out.out = argv[++i];
    else if (a === "--pack-id") out.packId = argv[++i];
    else if (a === "--content-version") out.contentVersion = argv[++i];
    else if (a === "--slugs") out.slugs = new Set(argv[++i].split(",").map((s) => s.trim()).filter(Boolean));
    else if (a === "--divisions") out.divisions = new Set(argv[++i].split(",").map((s) => s.trim()).filter(Boolean));
    else if (a === "--key") out.keyHex = argv[++i];
    else if (a === "--license-id") out.licenseId = argv[++i];
    else if (a === "--inject-basics-snippets") out.injectBasicsSnippets = true;
    else if (a === "--skip-quality-gate") out.skipQualityGate = true;
    else if (a === "--strict-all") out.strictAll = true;
  }
  return out;
}

function parseFrontmatter(raw) {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!m) throw new Error("missing frontmatter");
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1];
    let val = kv[2].trim();
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1).replace(/\\"/g, '"');
    if (key === "tags") {
      meta.tags = val
        .replace(/^\[|\]$/g, "")
        .split(",")
        .map((s) => s.trim().replace(/^"|"$/g, ""))
        .filter(Boolean);
    } else {
      meta[key] = val;
    }
  }
  return { meta, bodyMd: m[2].trim() };
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

function inferTaxonomy(meta, slug) {
  const DIVISION_TO_INDUSTRY = {
    engineering: "software",
    "software-company": "software",
    design: "design",
    product: "product",
    "project-management": "management",
    testing: "software",
    marketing: "marketing",
    finance: "finance",
    education: "education",
    healthcare: "healthcare",
  };
  const division = meta.division || "engineering";
  const industryId = meta.industryId || DIVISION_TO_INDUSTRY[division] || division;
  const industryZh = meta.industryZh || meta.divisionZh || industryId;
  const positionId = meta.positionId || slug;
  const positionZh = meta.positionZh || meta.nameZh || slug;
  const positionCategory = meta.positionCategory || "engineering";
  const positionCategoryZh = meta.positionCategoryZh || "研发工程";
  return { industryId, industryZh, positionId, positionZh, positionCategory, positionCategoryZh };
}

function injectBasicsSnippet(bodyMd, division) {
  const snippetPath = path.join(ROOT, "role-packs-src", "_shared", "virmoor-basics-snippets", `${division}.md`);
  if (!fs.existsSync(snippetPath)) return bodyMd;
  const snippet = fs.readFileSync(snippetPath, "utf8").trim();
  if (!snippet || bodyMd.includes("要点摘要（构建注入")) return bodyMd;
  const marker = "🚨 必须遵守的规则";
  const idx = bodyMd.indexOf(marker);
  if (idx < 0) return `${bodyMd}\n\n## 部门要点摘要（构建注入）\n\n${snippet}`;
  const insertPos = bodyMd.indexOf("\n\n", idx);
  const pos = insertPos > idx ? insertPos : bodyMd.length;
  return `${bodyMd.slice(0, pos)}\n\n## 部门要点摘要（构建注入）\n\n${snippet}\n${bodyMd.slice(pos)}`;
}

function main() {
  const args = parseArgs(process.argv);
  const srcRoot = path.join(ROOT, "role-packs-src", args.locale);
  if (!fs.existsSync(srcRoot)) {
    console.error(`Source not found: ${srcRoot} — run export-catalog-to-md.mjs first`);
    process.exit(1);
  }
  if (!args.skipQualityGate) {
    const { errors, checked } = runRolePackQualityGate({
      locale: args.locale,
      demo: args.demo,
      slugs: args.slugs,
      divisions: args.divisions,
      strictAll: args.strictAll,
      samplePerDivision: 3,
    });
    if (errors.length) {
      console.error(`[build-role-pack] quality gate failed (${errors.length}, checked ${checked})`);
      for (const e of errors) console.error(`  - ${e}`);
      console.error("Use --skip-quality-gate only for local emergency builds.");
      process.exit(1);
    }
    console.log(`[build-role-pack] quality gate OK (checked ${checked})`);
  }
  const packId = args.packId || `hermes-roles-${args.locale}`;
  const autoInject =
    args.injectBasicsSnippets || args.locale === "zh-CN-virmoor";
  const files = walkMdFiles(srcRoot);
  const roles = [];
  /** @type {{ slug: string; len: number }[]} */
  const longPrompts = [];
  for (const file of files) {
    const rel = path.relative(srcRoot, file).replace(/\\/g, "/");
    if (rel === "manifest.yaml") continue;
    const raw = fs.readFileSync(file, "utf8");
    let meta;
    let bodyMd;
    try {
      ({ meta, bodyMd } = parseFrontmatter(raw));
    } catch {
      console.warn(`[build-role-pack] skip ${rel}: missing frontmatter`);
      continue;
    }
    const slug = (meta.slug || path.basename(file, ".md")).trim();
    if (!meta.id?.trim() || !slug) {
      console.warn(`[build-role-pack] skip ${rel}: missing id or slug`);
      continue;
    }
    if (args.slugs && !args.slugs.has(slug)) continue;
    if (args.divisions && !args.divisions.has(meta.division)) continue;
    const tax = inferTaxonomy(meta, slug);
    let bodyForPrompt = bodyMd;
    if (autoInject) bodyForPrompt = injectBasicsSnippet(bodyForPrompt, meta.division);
    const role = {
      id: meta.id,
      slug,
      name: meta.nameZh || slug,
      nameZh: meta.nameZh || slug,
      emoji: meta.emoji || "👤",
      division: meta.division,
      divisionZh: meta.divisionZh || meta.division,
      description: meta.description || "",
      roleKind: meta.roleKind || "worker",
      brainSlot: meta.brainSlot || "work",
      kickoffWave: meta.kickoffWave || "planning",
      mcpTools: (meta.mcpTools || "").trim(),
      tags: meta.tags || [],
      source: meta.source || rel,
      industryId: tax.industryId,
      industryZh: tax.industryZh,
      positionId: tax.positionId,
      positionZh: tax.positionZh,
      positionCategory: tax.positionCategory,
      positionCategoryZh: tax.positionCategoryZh,
      bodyMd,
      prompt: buildFullPrompt({
        nameZh: meta.nameZh || slug,
        division: meta.division,
        divisionZh: meta.divisionZh,
        bodyMd: bodyForPrompt,
      }),
    };
    if (role.prompt.length > PROMPT_LEN_SOFT) {
      longPrompts.push({ slug, len: role.prompt.length });
    }
    roles.push(role);
  }
  if (roles.length === 0) {
    console.error("No roles matched");
    process.exit(1);
  }
  roles.sort((a, b) => a.slug.localeCompare(b.slug));

  let key;
  if (args.demo) key = DEMO_PACK_KEY;
  else if (args.keyHex) key = Buffer.from(args.keyHex.replace(/^0x/, ""), "hex");
  else if (process.env.XU_PACK_KEY) key = Buffer.from(process.env.XU_PACK_KEY.replace(/^0x/, ""), "hex");
  else key = deriveCommercialKey(packId, args.licenseId);

  const payload = {
    header: {
      locale: args.locale,
      version: 1,
      packId,
      contentVersion: args.contentVersion || new Date().toISOString().slice(0, 10),
      builtAt: new Date().toISOString(),
      roleCount: roles.length,
      demo: args.demo,
      taxonomyVersion: 1,
    },
    roles,
  };

  const buf = encodeXupack(payload, { key, demo: args.demo });
  const outPath = args.out
    ? path.isAbsolute(args.out)
      ? args.out
      : path.join(ROOT, args.out)
    : path.join(ROOT, "dist", `${packId}.v1.xupack`);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, buf);
  assertEncryptedXupackOnDisk(outPath, buf);

  // Dev (`--skip-quality-gate`) stays quiet; otherwise one summary line, never per-role spam / never prompt body.
  if (!args.skipQualityGate && longPrompts.length > 0) {
    const max = longPrompts.reduce((m, x) => Math.max(m, x.len), 0);
    console.log(
      `[build-role-pack] prompt length: ${longPrompts.length} roles > ${PROMPT_LEN_SOFT} (max=${max})`,
    );
  }
  console.log(
    `Built ${roles.length} roles → ${outPath} (${buf.length} bytes, demo=${args.demo}, flags=${args.demo ? XUPACK_FLAG_DEMO : 0})`,
  );
}

main();
