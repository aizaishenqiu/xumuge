/**
 * Parallel work-only translator: writes prose-zh.md only (no catalog race).
 * Then run: node scripts/apply-remaining-agency-zh.mjs
 *
 * node scripts/translate-remaining-agency-parallel.mjs --workers=4
 *
 * @author qiuye
 * @email yjk150@qq.com
 */
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const CATALOG = path.join(ROOT, "src/office/agencyCatalog.generated.json");
const WORK = path.join(ROOT, ".cache/agency-zh-work/remaining");
const SHARD_DIR = path.join(WORK, "shards");

fs.mkdirSync(SHARD_DIR, { recursive: true });

const workersArg = process.argv.find((a) => a.startsWith("--workers="));
const WORKERS = Math.max(1, Number(workersArg?.split("=")[1] || 4));

function zhRatio(s) {
  const sample = (s || "").replace(/```[\s\S]*?```/g, "").replace(/<<<FENCE_\d+>>>/g, "");
  const zh = (sample.match(/[\u4e00-\u9fff]/g) || []).length;
  const en = (sample.match(/[A-Za-z]/g) || []).length;
  return zh + en ? zh / (zh + en) : 0;
}

function extractBody(prompt) {
  const marker = "—— 完整岗位说明 ——";
  const i = (prompt || "").indexOf(marker);
  if (i >= 0) return prompt.slice(i + marker.length).replace(/^\s*\n/, "");
  return prompt || "";
}

const catalog = JSON.parse(fs.readFileSync(CATALOG, "utf8"));
const roles = catalog.roles.filter(
  (r) => !r.id.startsWith("software-company__") && !r.id.startsWith("xu-"),
);

const need = [];
for (const r of roles) {
  const zhPath = path.join(WORK, `${r.id}.prose-zh.md`);
  if (fs.existsSync(zhPath) && zhRatio(fs.readFileSync(zhPath, "utf8")) >= 0.45) continue;
  if (zhRatio(extractBody(r.prompt)) >= 0.45) continue;
  need.push(r.id);
}

console.log("need", need.length, "workers", WORKERS);

const shards = Array.from({ length: WORKERS }, () => []);
need.forEach((id, i) => shards[i % WORKERS].push(id));

const workerScript = path.join(ROOT, "scripts/_translate-shard-worker.mjs");

const children = [];
for (let i = 0; i < WORKERS; i++) {
  const shardPath = path.join(SHARD_DIR, `shard-${i}.json`);
  fs.writeFileSync(shardPath, JSON.stringify(shards[i], null, 2) + "\n");
  if (!shards[i].length) continue;
  const child = spawn(process.execPath, [workerScript, shardPath], {
    cwd: ROOT,
    stdio: "inherit",
    env: process.env,
  });
  children.push(
    new Promise((resolve) => {
      child.on("exit", (code) => {
        if (code !== 0) console.warn(`shard ${i} exit ${code} (continuing)`);
        resolve();
      });
    }),
  );
}

await Promise.all(children);
console.log("all shards done; run apply-remaining-agency-zh.mjs");
