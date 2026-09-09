/**
 * @file upload-github-release-asset.mjs
 * @description Re-upload Windows installer to GitHub Release with correct UTF-8 filename.
 * @author qiuye <yjk150@qq.com>
 * @date 2026-09-09
 * @version 1.0.0
 * @category Scripts
 * @algo none
 *
 * Usage:
 *   node scripts/upload-github-release-asset.mjs <path-to-exe>
 * Reads GitHub token from `git credential fill` for github.com.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const OWNER = "aizaishenqiu";
const REPO = "xumuge";
const TAG = "virmoor-desktop-1.0.2";
const ASSET_NAMES = ["Virmoor_1.0.2_x64-setup.exe", "虚募阁_1.0.2_x64-setup.exe"];

function gitCredentialToken() {
  const r = spawnSync("git", ["credential", "fill"], {
    input: "protocol=https\nhost=github.com\n\n",
    encoding: "utf8",
    shell: true,
  });
  if (r.status !== 0) throw new Error("git credential fill failed");
  const line = String(r.stdout || "")
    .split(/\r?\n/)
    .find((l) => l.startsWith("password="));
  if (!line) throw new Error("no github password/token");
  return line.slice("password=".length).trim();
}

async function gh(token, method, url, body, contentType) {
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "xumuge-oss-publish",
  };
  if (contentType) headers["Content-Type"] = contentType;
  const res = await fetch(url, {
    method,
    headers,
    body,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    throw new Error(`${method} ${url} -> ${res.status} ${text.slice(0, 400)}`);
  }
  return json;
}

const exePath = process.argv[2];
if (!exePath || !fs.existsSync(exePath)) {
  console.error("usage: node scripts/upload-github-release-asset.mjs <exe>");
  process.exit(1);
}
const bytes = fs.readFileSync(exePath);
const token = gitCredentialToken();
const rel = await gh(
  token,
  "GET",
  `https://api.github.com/repos/${OWNER}/${REPO}/releases/tags/${TAG}`,
);
console.log("release", rel.id, "assets", (rel.assets || []).length);
for (const a of rel.assets || []) {
  console.log("delete", a.name, a.id);
  await gh(token, "DELETE", `https://api.github.com/repos/${OWNER}/${REPO}/releases/assets/${a.id}`);
}
const uploadBase = String(rel.upload_url).replace(/\{\?name,label\}/, "");
for (const name of ASSET_NAMES) {
  const url = `${uploadBase}?name=${encodeURIComponent(name)}`;
  console.log("upload", name, bytes.length);
  const asset = await gh(token, "POST", url, bytes, "application/octet-stream");
  console.log("ok", asset.browser_download_url);
}
