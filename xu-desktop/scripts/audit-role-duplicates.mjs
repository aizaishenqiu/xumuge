/**
 * @file audit-role-duplicates.mjs
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-31
 * @version 1.0.0
 * @category role-pack
 * @algo 扫描 zh-CN-virmoor 重复岗位 → _duplicate-audit.json
 *
 * node scripts/audit-role-duplicates.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { auditPack } from "./lib/virmoor-role-duplicate-audit.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const VIRMoor = path.join(ROOT, "role-packs-src", "zh-CN-virmoor");

function main() {
  const report = auditPack(VIRMoor);
  const outPath = path.join(VIRMoor, "_duplicate-audit.json");
  fs.writeFileSync(
    outPath,
    JSON.stringify({ at: new Date().toISOString(), ...report }, null, 2),
    "utf8",
  );
  console.log(
    "[audit-role-duplicates]",
    JSON.stringify(
      {
        scanned: report.scanned,
        exactNameZhCount: report.exactNameZhCount,
        fuzzyNormGroupCount: report.fuzzyNormGroupCount,
        crossDivisionFuzzyCount: report.crossDivisionFuzzyCount,
        semanticPairCount: report.semanticPairCount,
        misplacedCount: report.misplacedCount,
        genericNameCount: report.genericNameCount,
      },
      null,
      2,
    ),
  );
  console.log(`[audit-role-duplicates] wrote ${outPath}`);
}

main();
