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
const commitEnv = {
  ...process.env,
  GIT_AUTHOR_NAME: "qiuye",
  GIT_AUTHOR_EMAIL: "yjk150@qq.com",
  GIT_COMMITTER_NAME: "qiuye",
  GIT_COMMITTER_EMAIL: "yjk150@qq.com",
};
const commit = spawnSync(
  "git",
  ["commit", "-m", "Update developer wiki"],
  { cwd: tmp, stdio: "inherit", shell: false, env: commitEnv },
);
if (commit.status !== 0) process.exit(commit.status ?? 1);
const remoteAdd = spawnSync("git", ["remote", "add", "origin", REMOTE], {
  cwd: tmp,
  stdio: "inherit",
  shell: false,
});
if (remoteAdd.status !== 0) process.exit(remoteAdd.status ?? 1);
const push = spawnSync(
  "git",
  ["push", "-u", "origin", "master", "--force"],
  { cwd: tmp, stdio: "inherit", shell: false },
);
if (push.status !== 0) {
  console.error(
    "Push failed. Enable Wiki once in Gitee UI: https://gitee.com/jiukakeji/xumuge/wikis",
  );
  process.exit(push.status ?? 1);
}
console.log("pushed", REMOTE);
console.log("view:", "https://gitee.com/jiukakeji/xumuge/wikis");
