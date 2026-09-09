/**
 * Tag kickoffWave on all agency catalog roles (idempotent).
 * node scripts/tag-kickoff-waves.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inferKickoffWaveForCatalog } from "./infer-kickoff-wave.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CATALOG = path.join(__dirname, "../src/office/agencyCatalog.generated.json");

const raw = JSON.parse(fs.readFileSync(CATALOG, "utf8"));
let changed = 0;
for (const role of raw.roles) {
  const wave = inferKickoffWaveForCatalog(role.division, role.id);
  if (role.kickoffWave !== wave) {
    role.kickoffWave = wave;
    changed++;
  }
}
fs.writeFileSync(CATALOG, JSON.stringify(raw, null, 2) + "\n", "utf8");
console.log(`tagged ${raw.roles.length} roles, updated ${changed}`);
