/**

 * Backup role-packs-src/zh-CN and replace with zh-kimi content (1222 + 双维 taxonomy).

 * Keeps packId/locale as zh-CN for build-role-pack.mjs / dev.full.zh-CN.xupack.

 *

 * node scripts/sync-role-pack-zh-cn-from-kimi.mjs

 */

import fs from "node:fs";

import path from "node:path";

import { fileURLToPath } from "node:url";

import { spawnSync } from "node:child_process";



const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ROOT = path.join(__dirname, "..");

const SRC = path.join(ROOT, "role-packs-src", "zh-virmoon");

const DEST = path.join(ROOT, "role-packs-src", "zh-CN");



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



function copyDir(src, dest) {

  fs.mkdirSync(dest, { recursive: true });

  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {

    const from = path.join(src, ent.name);

    const to = path.join(dest, ent.name);

    if (ent.isDirectory()) copyDir(from, to);

    else fs.copyFileSync(from, to);

  }

}



function stamp() {

  const d = new Date();

  const pad = (n) => String(n).padStart(2, "0");

  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;

}



function readKimiManifest() {

  const p = path.join(SRC, "manifest.yaml");

  if (!fs.existsSync(p)) return null;

  try {

    return JSON.parse(fs.readFileSync(p, "utf8"));

  } catch {

    return null;

  }

}



function writeZhCnManifest(roleCount, kimiManifest) {

  const manifest = {

    locale: "zh-CN",

    version: 2,

    packId: "hermes-roles-zh-CN",

    roleCount,

    taxonomyVersion: 1,

    syncedAt: new Date().toISOString(),

    source: "role-packs-src/zh-kimi（1222 专家目录 + 双维 taxonomy，同步至 zh-CN）",

    composition: kimiManifest?.composition ?? null,

    splitAt: kimiManifest?.splitAt ?? null,

    notes:

      "由 scripts/sync-role-pack-zh-cn-from-kimi.mjs 同步。开发全量包见 resources/role-packs/dev.full.zh-CN.xupack（gitignore）。",

  };

  fs.writeFileSync(

    path.join(DEST, "manifest.yaml"),

    JSON.stringify(manifest, null, 2) + "\n",

    "utf8",

  );

}



function main() {

  if (!fs.existsSync(SRC)) {

    console.error(`[sync-zh-cn] 源目录不存在: ${SRC}`);

    process.exit(1);

  }



  const srcCount = walkMdFiles(SRC).length;

  if (srcCount === 0) {

    console.error("[sync-zh-cn] zh-kimi 无 Markdown 角色文件");

    process.exit(1);

  }



  const backup = path.join(ROOT, "role-packs-src", `zh-CN.backup-${stamp()}`);

  if (fs.existsSync(DEST)) {

    console.log(`[sync-zh-cn] 备份 ${path.relative(ROOT, DEST)} → ${path.relative(ROOT, backup)}`);

    fs.renameSync(DEST, backup);

  }



  console.log(`[sync-zh-cn] 复制 ${path.relative(ROOT, SRC)} → ${path.relative(ROOT, DEST)} (${srcCount} md)`);

  copyDir(SRC, DEST);



  const roleCount = walkMdFiles(DEST).length;

  const kimiManifest = readKimiManifest();

  writeZhCnManifest(roleCount, kimiManifest);

  console.log(`[sync-zh-cn] manifest 已写为 zh-CN，roleCount=${roleCount}`);



  console.log("[sync-zh-cn] enrich taxonomy（zh-CN --force）…");

  const enrich = spawnSync(

    process.execPath,

    [path.join(__dirname, "enrich-taxonomy-fields.mjs"), "--locale", "zh-CN", "--force"],

    { stdio: "inherit", cwd: ROOT },

  );

  if (enrich.status !== 0) process.exit(enrich.status ?? 1);



  console.log("[sync-zh-cn] 完成");

}



main();


