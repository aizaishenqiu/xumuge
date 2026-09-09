/**
 * Build all commercial SKUs from scripts/role-pack-skus.json
 *
 * node scripts/build-role-pack-skus.mjs
 * node scripts/build-role-pack-skus.mjs --sku full-zh-CN
 * node scripts/build-role-pack-skus.mjs --content-version 2026.09.1
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const MANIFEST = path.join(__dirname, "role-pack-skus.json");

function parseArgs(argv) {
  const out = { sku: null, contentVersion: "" };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--sku") out.sku = argv[++i];
    else if (a === "--content-version") out.contentVersion = argv[++i];
  }
  return out;
}

function buildOne(sku, contentVersionDefault, contentVersionOverride) {
  const buildScript = path.join(__dirname, "build-role-pack.mjs");
  const args = ["node", buildScript, "--locale", sku.locale, "--pack-id", sku.packId, "--out", sku.out];
  const cv = contentVersionOverride || sku.contentVersion || contentVersionDefault;
  if (cv) args.push("--content-version", cv);
  if (sku.demo) args.push("--demo");
  if (sku.skipQualityGate) args.push("--skip-quality-gate");
  if (sku.slugs?.length) args.push("--slugs", sku.slugs.join(","));
  if (sku.divisions?.length) args.push("--divisions", sku.divisions.join(","));
  if (sku.filter === "all") args.push("--all");

  if (!sku.demo && process.env.XU_ALLOW_COMMERCIAL_BUILD !== "1") {
    console.error(
      `\nRefused SKU "${sku.id}": set XU_ALLOW_COMMERCIAL_BUILD=1 for commercial packs.\n` +
        "See .cursor/skills/test-data-packaging/SKILL.md\n",
    );
    process.exit(1);
  }

  const r = spawnSync(args[0], args.slice(1), { stdio: "inherit", cwd: ROOT });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

function main() {
  const args = parseArgs(process.argv);
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
  const list = args.sku ? manifest.skus.filter((s) => s.id === args.sku) : manifest.skus;
  if (list.length === 0) {
    console.error(args.sku ? `Unknown SKU: ${args.sku}` : "No SKUs");
    process.exit(1);
  }
  for (const sku of list) {
    console.log(`\n=== SKU: ${sku.id} ===`);
    buildOne(sku, manifest.contentVersionDefault, args.contentVersion);
  }
  console.log(`\nDone. Built ${list.length} SKU(s).`);
}

main();
