/**
 * @file audit-role-content.mjs
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-30
 * @version 1.0.0
 * @category role-pack
 * @algo 扫描 zh-CN-virmoor 正文质量 → _content-audit.json
 *
 * node scripts/audit-role-content.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { auditPack } from "./lib/virmoor-role-content-audit.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const VIRMoor = path.join(ROOT, "role-packs-src", "zh-CN-virmoor");
const KIMI = path.join(ROOT, "role-packs-src", "zh-virmoon");

function main() {
  const report = auditPack(VIRMoor, KIMI);
  const outPath = path.join(VIRMoor, "_content-audit.json");
  fs.writeFileSync(
    outPath,
    JSON.stringify({ at: new Date().toISOString(), ...report }, null, 2),
    "utf8",
  );
  console.log("[audit-role-content]", JSON.stringify({
    scanned: report.scanned,
    severeCount: report.severeCount,
    byIssueType: report.byIssueType,
  }, null, 2));
  console.log(`[audit-role-content] wrote ${outPath}`);
}

main();
