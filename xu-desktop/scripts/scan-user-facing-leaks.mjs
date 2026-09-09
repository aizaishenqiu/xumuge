#!/usr/bin/env node
/**
 * @file 扫描 src 中用户可见字符串里的开发向泄露词
 * @author qiuye <yjk150@qq.com>
 * @date 2026-09-02
 * @version 1.1.0
 * @category QA
 * @algo banned-term-scan
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dirname, "..", "src");
const SKIP = new Set(["userFacingError.ts", "request.ts", "bugReports.ts", "chatWorkspace.ts"]);

const BANNED = [
  /\{XU_HOME\}/,
  /\bxu\.db\b/i,
  /public\/uploads/,
  /\bmcpTools\b/,
  /Bearer\s/,
  /pnpm\s+(add|tauri|build)/,
  /src-tauri/,
  /uploads\/role-packs/,
  /audit\/.*\.jsonl/,
  /String\(e\)/,
  /window\.alert\(String\(/,
];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(vue|ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

function stripComments(code) {
  let s = code.replace(/\/\*[\s\S]*?\*\//g, "");
  s = s.replace(/\/\/.*$/gm, "");
  s = s.replace(/<!--[\s\S]*?-->/g, "");
  return s;
}

function userFacingBlob(code) {
  const stripped = stripComments(code);
  const tpl = stripped.match(/<template[^>]*>([\s\S]*?)<\/template>/i)?.[1] ?? "";
  const literals = [];
  const re = /(`(?:\\.|[^`\\])*`|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/g;
  for (const part of [tpl, stripped]) {
    let m;
    while ((m = re.exec(part))) {
      literals.push(m[0].slice(1, -1));
    }
  }
  return literals.join("\n");
}

const files = walk(ROOT);
let hits = 0;

for (const file of files) {
  if (SKIP.has(file.split(/[/\\]/).pop() || "")) continue;
  const raw = readFileSync(file, "utf8");
  const blob = userFacingBlob(raw);
  if (!blob.trim()) continue;
  const rel = relative(join(import.meta.dirname, ".."), file).replace(/\\/g, "/");
  for (const re of BANNED) {
    if (re.test(blob)) {
      console.log(`${rel}: ${re}`);
      hits++;
    }
  }
}

if (hits) {
  console.error(`\n${hits} leak(s) found`);
  process.exit(1);
}
console.log("OK: no user-facing leaks in src");
