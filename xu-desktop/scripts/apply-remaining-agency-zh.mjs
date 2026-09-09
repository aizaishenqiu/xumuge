/**
 * Apply all remaining/*.prose-zh.md into agencyCatalog.generated.json
 * and sync software-company__ mirrors. Updates _progress.json.
 *
 * node scripts/apply-remaining-agency-zh.mjs
 *
 * @author qiuye
 * @email yjk150@qq.com
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const CATALOG = path.join(ROOT, "src/office/agencyCatalog.generated.json");
const WORK = path.join(ROOT, ".cache/agency-zh-work/remaining");
const PROGRESS = path.join(WORK, "_progress.json");

function zhRatio(s) {
  const sample = (s || "").replace(/```[\s\S]*?```/g, "");
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

function buildPrompt(role, bodyZh) {
  const shellParts = (role.prompt || "").split("—— 完整岗位说明 ——")[0].trim();
  const shell =
    shellParts ||
    [
      `你是「${role.nameZh}」（岗位 id：${role.id}）。`,
      `所属部门：${role.divisionZh || role.division}。`,
      `请严格按下列完整岗位说明工作；默认用中文回复（除非用户要求其他语言）。`,
      `交付时说明假设、步骤与验收标准；不确定处先提问再动手。`,
    ].join("\n");
  return `${shell}\n\n—— 完整岗位说明 ——\n${bodyZh.trim()}`;
}

const catalog = JSON.parse(fs.readFileSync(CATALOG, "utf8"));
const files = fs.readdirSync(WORK).filter((f) => f.endsWith(".prose-zh.md"));
let applied = 0;
let skipped = 0;
const done = new Set();

for (const f of files) {
  const id = f.replace(/\.prose-zh\.md$/, "");
  const zh = fs.readFileSync(path.join(WORK, f), "utf8");
  if (zhRatio(zh) < 0.32) {
    skipped++;
    continue;
  }
  const role = catalog.roles.find((r) => r.id === id);
  if (!role) {
    skipped++;
    continue;
  }
  // Always apply if we have a good zh file (overwrite shell-only English body)
  if (zhRatio(extractBody(role.prompt)) >= 0.55 && zhRatio(zh) < zhRatio(extractBody(role.prompt))) {
    done.add(id);
    continue;
  }
  role.prompt = buildPrompt(role, zh);
  const mir = catalog.roles.find((r) => r.id === `software-company__${id}`);
  if (mir) {
    mir.prompt = role.prompt
      .replace(`岗位 id：${id}`, `岗位 id：software-company__${id}`)
      .replace(/所属部门：[^\n]+/, "所属部门：软件公司");
  }
  applied++;
  done.add(id);
}

catalog.localizedAt = new Date().toISOString().slice(0, 10);
catalog.fullZhPass = true;
fs.writeFileSync(CATALOG, JSON.stringify(catalog, null, 2) + "\n", "utf8");

let progress = { done: [], failed: [] };
try {
  progress = JSON.parse(fs.readFileSync(PROGRESS, "utf8"));
} catch {
  /* ignore */
}
progress.done = [...new Set([...(progress.done || []), ...done])];
fs.writeFileSync(PROGRESS, JSON.stringify(progress, null, 2) + "\n", "utf8");

// verify
const base = catalog.roles.filter((r) => !r.id.startsWith("software-company__") && !r.id.startsWith("xu-"));
const still = base.filter((r) => zhRatio(extractBody(r.prompt)) < 0.45);
console.log(
  JSON.stringify(
    {
      applied,
      skipped,
      proseFiles: files.length,
      stillNeed: still.length,
      stillSample: still.slice(0, 20).map((r) => r.id),
    },
    null,
    2,
  ),
);
