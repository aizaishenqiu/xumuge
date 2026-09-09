/**
 * One-time / maintenance: export agencyCatalog.generated.json to role-packs-src/zh-CN markdown tree.
 *
 * node scripts/export-catalog-to-md.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractBodyFromPrompt } from "./lib/role-prompt-shell.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const CATALOG = path.join(ROOT, "src/office/agencyCatalog.generated.json");
const OUT_ROOT = path.join(ROOT, "role-packs-src/zh-CN");

function yamlQuote(s) {
  const v = String(s ?? "");
  if (!v) return '""';
  if (/[:#\n\r"'\\]/.test(v) || v.startsWith(" ") || v.endsWith(" ")) {
    return `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  return `"${v}"`;
}

function slugFromRole(role) {
  if (role.slug) return role.slug;
  const src = role.source || "";
  const base = path.basename(src, ".md");
  if (base) return base;
  return role.id;
}

function isMirrorRole(role) {
  return role.division === "software-company" || String(role.id).startsWith("software-company__");
}

function frontmatter(role, slug) {
  const tags = Array.isArray(role.tags) ? role.tags : [];
  const lines = [
    "---",
    `id: ${yamlQuote(role.id)}`,
    `slug: ${slug}`,
    `nameZh: ${yamlQuote(role.nameZh || role.name)}`,
    `division: ${role.division}`,
    `divisionZh: ${yamlQuote(role.divisionZh || role.division)}`,
    `emoji: ${yamlQuote(role.emoji || "👤")}`,
    `roleKind: ${role.roleKind || "worker"}`,
    `brainSlot: ${role.brainSlot || "work"}`,
    `kickoffWave: ${role.kickoffWave || "planning"}`,
    `tags: [${tags.map((t) => yamlQuote(t)).join(", ")}]`,
    `description: ${yamlQuote(role.description || "")}`,
    `source: ${yamlQuote(role.source || `${role.division}/${slug}.md`)}`,
    "---",
    "",
  ];
  return lines.join("\n");
}

function main() {
  if (!fs.existsSync(CATALOG)) {
    console.error(`Catalog not found: ${CATALOG}`);
    process.exit(1);
  }
  const cat = JSON.parse(fs.readFileSync(CATALOG, "utf8"));
  const roles = (cat.roles || []).filter((r) => !isMirrorRole(r));
  fs.mkdirSync(OUT_ROOT, { recursive: true });

  const seenSlug = new Set();
  let written = 0;
  for (const role of roles) {
    const slug = slugFromRole(role);
    if (seenSlug.has(slug)) continue;
    seenSlug.add(slug);
    const division = role.division || "specialized";
    const dir = path.join(OUT_ROOT, division);
    fs.mkdirSync(dir, { recursive: true });
    const body = extractBodyFromPrompt(role.prompt || "");
    const file = path.join(dir, `${slug}.md`);
    fs.writeFileSync(file, frontmatter(role, slug) + body + (body.endsWith("\n") ? "" : "\n"), "utf8");
    written++;
  }

  const manifest = {
    locale: "zh-CN",
    version: 1,
    packId: "hermes-roles-zh-CN",
    roleCount: written,
    exportedAt: new Date().toISOString().slice(0, 10),
    source: "agencyCatalog.generated.json",
  };
  fs.writeFileSync(path.join(OUT_ROOT, "manifest.yaml"), JSON.stringify(manifest, null, 2) + "\n", "utf8");
  console.log(`Exported ${written} roles → ${OUT_ROOT}`);
}

main();
