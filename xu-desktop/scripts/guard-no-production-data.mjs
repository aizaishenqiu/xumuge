/**
 * Pre-commit guard: block production role-packs, licenses, and master keys from git.
 * Skipped when xu.repo-policy.json → dataPolicy === "private-full".
 *
 * node scripts/guard-no-production-data.mjs
 * node scripts/guard-no-production-data.mjs --staged
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isPrivateFullRepo } from "./repo-policy.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const ALLOWED_XUPACK = new Set([
  "resources/role-packs/demo.zh-CN.xupack",
]);

const BLOCKED_XUPACK_NAMES = new Set([
  "dev.full.zh-CN.xupack",
  "hermes-roles-zh-CN.xupack",
]);

function normalize(p) {
  return p.replace(/\\/g, "/");
}

function listStaged() {
  const out = execSync("git diff --cached --name-only --diff-filter=ACMR", {
    cwd: ROOT,
    encoding: "utf8",
  });
  return out
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map(normalize);
}

function scanFile(rel) {
  const issues = [];
  if (rel.endsWith(".xupack") && !ALLOWED_XUPACK.has(rel)) {
    const base = path.basename(rel);
    if (BLOCKED_XUPACK_NAMES.has(base) || rel.includes("dist/role-packs")) {
      issues.push(`禁止提交 xupack: ${rel}（国内全量/商业包不得入库）`);
    } else {
      issues.push(`禁止提交 xupack: ${rel}（仅允许 demo.zh-CN.xupack）`);
    }
  }
  if (rel.startsWith("role-packs-src/") && !rel.endsWith("manifest.yaml")) {
    issues.push(`禁止提交岗位源: ${rel}（role-packs-src 仅本地/Gitee 私有仓）`);
  }
  if (rel.includes("licenses.json") && rel.includes("license-server")) {
    issues.push(`禁止提交许可证数据: ${rel}`);
  }
  if (/master[_-]?key|XU_PACK_MASTER/i.test(rel)) {
    issues.push(`疑似主密钥文件: ${rel}`);
  }
  const abs = path.join(ROOT, rel);
  if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
    const head = fs.readFileSync(abs, "utf8").slice(0, 4000);
    if (/XU_PACK_MASTER_KEY_HEX\s*=\s*[0-9a-f]{32,}/i.test(head)) {
      issues.push(`文件含主密钥赋值: ${rel}`);
    }
  }
  return issues;
}

function main() {
  if (isPrivateFullRepo()) {
    const staged = listStaged();
    console.log(
      `guard-no-production-data: SKIP private-full（${staged.length} staged，见 xu.repo-policy.json）`,
    );
    return;
  }

  const staged = listStaged();
  const issues = staged.flatMap(scanFile);
  if (issues.length) {
    console.error("guard-no-production-data: 拒绝提交生产数据\n");
    for (const i of issues) console.error(`  - ${i}`);
    console.error("\n见 .cursor/skills/test-data-packaging/SKILL.md");
    process.exit(1);
  }
  console.log(`guard-no-production-data: OK (${staged.length} staged files)`);
}

main();
