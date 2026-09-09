/**
 * Scan agency catalog against 员工角色优化文档 criteria.
 * node scripts/scan-agency-status.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const CATALOG = path.join(ROOT, "src/office/agencyCatalog.generated.json");
const OUT = path.join(ROOT, ".cache/_remaining-zh.md");
const MARKER = "—— 完整岗位说明 ——";

const j = JSON.parse(fs.readFileSync(CATALOG, "utf8"));
const roles = j.roles || [];

function bodyOf(p) {
  const i = (p || "").indexOf(MARKER);
  return i >= 0 ? p.slice(i + MARKER.length) : p || "";
}

function zhRatio(s) {
  const t = (s || "").replace(/```[\s\S]*?```/g, "");
  const zh = (t.match(/[\u4e00-\u9fff]/g) || []).length;
  const en = (t.match(/[A-Za-z]/g) || []).length;
  return zh + en ? zh / (zh + en) : 1;
}

const indep = roles.filter((r) => !(r.id || "").startsWith("software-company"));
const mirrors = roles.filter((r) => (r.id || "").startsWith("software-company"));

let ok = 0;
const rem = [];
const byKind = { worker: 0, reviewer: 0, boss: 0 };
const byBrain = { work: 0, code: 0, command: 0 };
const byDivRem = {};

for (const r of indep) {
  byKind[r.roleKind] = (byKind[r.roleKind] || 0) + 1;
  byBrain[r.brainSlot] = (byBrain[r.brainSlot] || 0) + 1;
  const z = zhRatio(bodyOf(r.prompt));
  if (z >= 0.45) ok++;
  else {
    rem.push({ id: r.id, div: r.division, z, nameZh: r.nameZh });
    byDivRem[r.division] = (byDivRem[r.division] || 0) + 1;
  }
}

const fakeBossHint = indep.filter(
  (r) =>
    r.roleKind === "boss" &&
    !/chief|ceo|cfo|coo|boss|chief-of-staff|fou-boss/i.test(r.id),
);

const fou = indep.filter((r) => (r.id || "").startsWith("xu-"));

fs.mkdirSync(path.dirname(OUT), { recursive: true });
const lines = [
  `# 未译岗位正文（zhRatio < 0.45）`,
  ``,
  `扫描时间：${new Date().toISOString()}`,
  `独立岗：${indep.length} · 已中译：${ok} · 未中译：${rem.length} · 镜像：${mirrors.length}`,
  `roleKind：${JSON.stringify(byKind)}`,
  `brainSlot：${JSON.stringify(byBrain)}`,
  `Fou 专属：${fou.map((r) => r.id).join(", ") || "无"}`,
  `可疑假 boss：${fakeBossHint.map((r) => r.id).join(", ") || "无"}`,
  ``,
  `## 按部门`,
  ...Object.entries(byDivRem)
    .sort((a, b) => b[1] - a[1])
    .map(([d, n]) => `- ${d}: ${n}`),
  ``,
  `## ID 列表`,
  ...rem.map((r) => `- \`${r.id}\` (${r.div}) ${r.nameZh} z=${r.z.toFixed(2)}`),
  ``,
];
fs.writeFileSync(OUT, lines.join("\n"), "utf8");

console.log(
  JSON.stringify(
    {
      indep: indep.length,
      ok,
      rem: rem.length,
      mirrors: mirrors.length,
      byKind,
      byBrain,
      xu: fou.length,
      fakeBoss: fakeBossHint.map((r) => r.id),
      byDivRem,
    },
    null,
    2,
  ),
);
