/**
 * @file 前端 invoke 与 Tauri command 注册静态契约测试
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-31
 * @version 1.0.0
 * @category Parse
 * @algo recursive-source-scan
 */

import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const sourceRoot = path.join(desktopRoot, "src");
const tauriLibPath = path.join(desktopRoot, "src-tauri/src/lib.rs");

// 动态 command 必须以“表达式 => 原因”登记；仅允许已审过的包装器。
const DYNAMIC_COMMAND_ALLOWLIST = new Map([
  ["cmd", "src/utils/cosyvoiceInstallApi.ts invokeWithTimeout — 调用方传入字面量 command"],
]);

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) return sourceFiles(absolute);
      return /\.(?:ts|vue)$/.test(entry.name) && !/\.test\.ts$/.test(entry.name)
        ? [absolute]
        : [];
    }),
  );
  return nested.flat();
}

function registeredCommands(rustSource) {
  const match = rustSource.match(/generate_handler!\s*\[([\s\S]*?)\]\)/);
  assert.ok(match, "src-tauri/src/lib.rs 中未找到 generate_handler! 注册表");
  return new Set(
    match[1]
      .replace(/\/\/.*$/gm, "")
      .split(",")
      .map((entry) => entry.trim().split("::").at(-1))
      .filter(Boolean),
  );
}

function invokedCommands(source, relativePath) {
  const literals = [];
  const dynamic = [];
  const callPattern = /\binvoke(?:\s*<[^>]*>)?\s*\(\s*/g;
  for (const match of source.matchAll(callPattern)) {
    const argument = source.slice(match.index + match[0].length);
    const quote = argument[0];
    if (quote === '"' || quote === "'") {
      const end = argument.indexOf(quote, 1);
      assert.notEqual(end, -1, `${relativePath} 存在未闭合的 invoke command 字符串`);
      literals.push(argument.slice(1, end));
      continue;
    }
    if (quote === "`") {
      const end = argument.indexOf("`", 1);
      assert.notEqual(end, -1, `${relativePath} 存在未闭合的 invoke command 模板`);
      const command = argument.slice(1, end);
      if (!command.includes("${")) literals.push(command);
      else dynamic.push(command);
      continue;
    }
    dynamic.push(argument.split(/[,)\r\n]/, 1)[0].trim());
  }
  return { literals, dynamic };
}

test("所有前端 invoke command 均已注册到 Tauri", async () => {
  const registered = registeredCommands(await readFile(tauriLibPath, "utf8"));
  const missing = [];
  const unapprovedDynamic = [];

  for (const file of await sourceFiles(sourceRoot)) {
    const relative = path.relative(desktopRoot, file).replaceAll("\\", "/");
    const { literals, dynamic } = invokedCommands(await readFile(file, "utf8"), relative);
    for (const command of literals) {
      if (!registered.has(command)) missing.push(`${relative}: ${command}`);
    }
    for (const expression of dynamic) {
      if (!DYNAMIC_COMMAND_ALLOWLIST.has(expression)) {
        unapprovedDynamic.push(`${relative}: ${expression || "<empty>"}`);
      }
    }
  }

  assert.deepEqual(
    unapprovedDynamic,
    [],
    `发现未登记的动态 invoke command：\n${unapprovedDynamic.join("\n")}`,
  );
  assert.deepEqual(missing, [], `发现未注册的 invoke command：\n${missing.join("\n")}`);
});
