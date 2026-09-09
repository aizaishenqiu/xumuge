import fs from "node:fs";
const p = JSON.parse(fs.readFileSync(".cache/agency-zh-work/fence-translate/_progress.json", "utf8"));
const c = JSON.parse(fs.readFileSync("src/office/agencyCatalog.generated.json", "utf8"));
const total = c.roles.filter((r) => !r.id.startsWith("software-company__")).length;
console.log(JSON.stringify({ done: p.done.length, failed: (p.failed || []).length, total, remaining: total - p.done.length }, null, 2));
