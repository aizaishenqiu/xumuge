/**
 * @file audit-workbuddy-roles.mjs
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-30
 * @version 1.0.0
 * @category role-pack
 * @algo 扫描 zh-CN 岗位源，输出去品牌化审计报告
 *
 * node scripts/audit-workbuddy-roles.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  auditIssues,
  deriveNameZh,
  buildSemanticSlug,
  parseFrontmatter,
  walkMdFiles,
} from "./lib/virmoor-role-debrand.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const SRC = path.join(ROOT, "role-packs-src", "zh-CN");
const OUT_DIR = path.join(ROOT, "role-packs-src", "zh-CN-virmoor");
const REPORT = path.join(OUT_DIR, "_audit-report.json");

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const files = walkMdFiles(SRC).filter((f) => !f.endsWith("manifest.yaml"));
  const perIssue = {};
  const entries = [];

  for (const file of files) {
    const rel = path.relative(SRC, file).replace(/\\/g, "/");
    const raw = fs.readFileSync(file, "utf8");
    const { meta, bodyMd } = parseFrontmatter(raw);
    const oldSlug = meta.slug || path.basename(file, ".md");
    const division = meta.division || path.dirname(rel).split("/").pop() || "specialized";
    const nameZh = deriveNameZh(meta);
    const newSlug = buildSemanticSlug(division, nameZh, meta, oldSlug);
    const issues = auditIssues(meta, oldSlug, bodyMd);
    for (const i of issues) perIssue[i] = (perIssue[i] || 0) + 1;
    entries.push({
      path: rel,
      oldId: meta.id,
      oldSlug,
      oldNameZh: meta.nameZh,
      originSource: meta.originSource || "",
      suggestedNameZh: nameZh,
      suggestedSlug: newSlug,
      issues,
    });
  }

  const report = {
    scannedAt: new Date().toISOString(),
    source: "role-packs-src/zh-CN",
    total: entries.length,
    perIssueLabelCounts: perIssue,
    entries,
  };

  fs.writeFileSync(REPORT, JSON.stringify(report, null, 2), "utf8");
  console.log(`[audit-workbuddy] scanned ${entries.length} roles → ${REPORT}`);
  console.log("[audit-workbuddy] issue counts:", perIssue);
}

main();
