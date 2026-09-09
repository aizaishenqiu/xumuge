/**
 * @file push-gitee-wiki.mjs
 * @description Push opensource/wiki/*.md to Gitee Wiki git (after Wiki is enabled in UI).
 * @author qiuye <yjk150@qq.com>
 * @date 2026-09-09
 * @version 1.0.0
 * @category Scripts
 * @algo wiki-git-push
 *
 * Usage (from opensource/): node scripts/push-gitee-wiki.mjs
 * Prerequisite: open https://gitee.com/jiukakeji/xumuge/wikis once and create/enable Wiki.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const WIKI_SRC = path.join(ROOT, "wiki");
const REMOTE = "https://gitee.com/jiukakeji/xumuge.wiki.git";

function run(cwd, cmd, args) {
  const r = spawnSync(cmd, args, { cwd, stdio: "inherit", shell: true });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

if (!fs.existsSync(WIKI_SRC)) {
  console.error("missing", WIKI_SRC);
  process.exit(1);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "xumuge-wiki-"));
for (const name of fs.readdirSync(WIKI_SRC)) {
  fs.copyFileSync(path.join(WIKI_SRC, name), path.join(tmp, name));
}

run(tmp, "git", ["init", "-b", "master"]);
run(tmp, "git", ["add", "-A"]);
run(tmp, "git", [
  "-c",
  "user.email=yjk150@qq.com",
  "-c",
  "user.name=qiuye",
  "commit",
  "-m",
  "Update developer wiki",
]);
run(tmp, "git", ["remote", "add", "origin", REMOTE]);
run(tmp, "git", ["push", "-u", "origin", "master", "--force"]);
console.log("pushed", REMOTE);
console.log("view:", "https://gitee.com/jiukakeji/xumuge/wikis");
