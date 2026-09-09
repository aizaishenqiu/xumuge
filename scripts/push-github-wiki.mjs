/**
 * @file push-github-wiki.mjs
 * @description Push opensource/wiki/*.md to GitHub Wiki git (after Wiki has a first page).
 * @author qiuye <yjk150@qq.com>
 * @date 2026-09-09
 * @version 1.0.0
 * @category Scripts
 * @algo wiki-git-push
 *
 * Usage (from opensource/): node scripts/push-github-wiki.mjs
 * Prerequisite: create at least one Wiki page in GitHub UI once
 *   (https://github.com/aizaishenqiu/xumuge/wiki) so xumuge.wiki.git exists.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const WIKI_SRC = path.join(ROOT, "wiki");
const REMOTE = "https://github.com/aizaishenqiu/xumuge.wiki.git";

function run(cwd, cmd, args, env = process.env) {
  const r = spawnSync(cmd, args, { cwd, stdio: "inherit", shell: true, env });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

if (!fs.existsSync(WIKI_SRC)) {
  console.error("missing", WIKI_SRC);
  process.exit(1);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "xumuge-gh-wiki-"));
for (const name of fs.readdirSync(WIKI_SRC)) {
  if (!name.endsWith(".md")) continue;
  fs.copyFileSync(path.join(WIKI_SRC, name), path.join(tmp, name));
}

const gitEnv = {
  ...process.env,
  GIT_AUTHOR_NAME: "qiuye",
  GIT_AUTHOR_EMAIL: "yjk150@qq.com",
  GIT_COMMITTER_NAME: "qiuye",
  GIT_COMMITTER_EMAIL: "yjk150@qq.com",
};

run(tmp, "git", ["-c", "http.version=HTTP/1.1", "init", "-b", "master"], gitEnv);
run(tmp, "git", ["add", "-A"], gitEnv);
const commit = spawnSync("git", ["commit", "-m", "Update developer wiki"], {
  cwd: tmp,
  stdio: "inherit",
  shell: false,
  env: gitEnv,
});
if (commit.status !== 0) process.exit(commit.status ?? 1);
run(tmp, "git", ["remote", "add", "origin", REMOTE], gitEnv);
const push = spawnSync(
  "git",
  ["-c", "http.version=HTTP/1.1", "push", "-u", "origin", "master", "--force"],
  { cwd: tmp, stdio: "inherit", shell: false, env: gitEnv },
);
if (push.status !== 0) {
  console.error(
    "Push failed. Open Wiki once and create Home page in GitHub UI:",
    "https://github.com/aizaishenqiu/xumuge/wiki",
  );
  process.exit(push.status ?? 1);
}
console.log("pushed", REMOTE);
console.log("view:", "https://github.com/aizaishenqiu/xumuge/wiki");
