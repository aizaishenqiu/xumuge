/**
 * @file prepare-release-clean.mjs 正式打包前清理：禁止本机 .env / 测试垃圾 / tools 冗余进 NSIS
 * @author qiuye <yjk150@qq.com>
 * @date 2026-09-04
 * @updated 2026-09-08
 * @version 1.2.0
 * @category Tooling
 * @algo none
 *
 * 说明：
 * - 用户项目、反馈、模型在 %LOCALAPPDATA%\xu，本来就不会进安装包。
 * - 试用阶段安装包嵌入 full.zh-CN.xupack（产品岗位包，不是用户本机项目/反馈）。
 * - tools 整目录进 NSIS：必须剥掉 .env、测试目录、.github 等，避免「本机依赖垃圾」膨胀。
 *
 * 用法: node scripts/prepare-release-clean.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const ROLE_DIR = path.join(ROOT, "resources", "role-packs");
/** 试用阶段：安装包只允许嵌入全量岗位包 */
const ALLOWED_PACK = "full.zh-CN.xupack";
/** 与 tauri.conf.json bundle.resources 对齐 */
const TOOL_DIRS = [
  "tools/feishu-ws",
  "tools/wecom-kf",
  "tools/design-mcp-bridge",
  "tools/mcp-blender-host",
  "tools/mcp-max-host",
  "tools/cursor-sdk-bridge",
];

const JUNK_NAMES = new Set([
  ".env",
  ".env.local",
  ".env.development",
  ".env.production",
  ".env.development.local",
  ".env.production.local",
  "config.local.json",
  "credentials.json",
  "secrets.json",
  ".DS_Store",
  "Thumbs.db",
]);

/** node_modules 内可删的目录名（测试/文档/CI，运行时不需要） */
const PRUNE_DIR_NAMES = new Set([
  "test",
  "tests",
  "__tests__",
  ".github",
  "docs",
  "doc",
  "example",
  "examples",
  "coverage",
  ".turbo",
  ".cache",
]);

function rmQuiet(p) {
  try {
    if (!fs.existsSync(p)) return false;
    const st = fs.statSync(p);
    if (st.isDirectory()) fs.rmSync(p, { recursive: true, force: true });
    else fs.unlinkSync(p);
    return true;
  } catch {
    return false;
  }
}

function cleanRolePacks() {
  if (!fs.existsSync(ROLE_DIR)) {
    console.warn("[release-clean] resources/role-packs 不存在");
    return;
  }
  for (const name of fs.readdirSync(ROLE_DIR)) {
    const abs = path.join(ROLE_DIR, name);
    if (name === ALLOWED_PACK) {
      const n = fs.statSync(abs).size;
      console.log(`[release-clean] keep ${name} (${n} bytes) — 试用产品岗位包，非用户反馈/本机项目`);
      continue;
    }
    if (rmQuiet(abs)) {
      console.log(`[release-clean] removed resources/role-packs/${name}`);
    }
  }
  const full = path.join(ROLE_DIR, ALLOWED_PACK);
  if (!fs.existsSync(full)) {
    console.error(`[release-clean] 缺少 ${ALLOWED_PACK}，请先 pnpm run build:role-pack:full`);
    process.exit(1);
  }
}

/** 清掉上次构建残留在 target/release 的非允许包，避免误以为「打进安装包」 */
function cleanReleaseTargetLeftovers() {
  const leftovers = [
    path.join(ROOT, "src-tauri", "target", "release", "role-packs"),
  ];
  for (const dir of leftovers) {
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      if (name === ALLOWED_PACK) continue;
      const abs = path.join(dir, name);
      if (rmQuiet(abs)) {
        console.log(`[release-clean] removed leftover ${path.relative(ROOT, abs)}`);
      }
    }
  }
}

function walkClean(dir, relBase) {
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir)) {
    const abs = path.join(dir, name);
    const rel = path.join(relBase, name).replace(/\\/g, "/");
    let st;
    try {
      st = fs.statSync(abs);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      if (name === ".cache" || name === "coverage" || name === ".turbo") {
        if (rmQuiet(abs)) console.log(`[release-clean] removed ${rel}/`);
        continue;
      }
      if (name === "node_modules") {
        pruneNodeModulesTree(abs, rel);
        continue;
      }
      walkClean(abs, rel);
      continue;
    }
    if (JUNK_NAMES.has(name) || /^\.env(\.|$)/i.test(name) || /\.local\.(json|ya?ml|toml)$/i.test(name)) {
      if (rmQuiet(abs)) console.log(`[release-clean] removed ${rel}`);
    }
  }
}

/**
 * 保留运行所需依赖，删除测试/文档/CI 垃圾（仍会保留生产 node_modules）。
 * @param {string} nmRoot
 * @param {string} relBase
 */
function pruneNodeModulesTree(nmRoot, relBase) {
  let removed = 0;
  const stack = [nmRoot];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      const abs = path.join(dir, ent.name);
      const rel = path.join(relBase, path.relative(nmRoot, abs)).replace(/\\/g, "/");
      if (ent.isDirectory()) {
        if (PRUNE_DIR_NAMES.has(ent.name)) {
          if (rmQuiet(abs)) {
            removed += 1;
            console.log(`[release-clean] pruned ${rel}/`);
          }
          continue;
        }
        stack.push(abs);
        continue;
      }
      // 依赖包内说明文档可去；保留 LICENSE*
      if (/\.md$/i.test(ent.name) && !/^license/i.test(ent.name)) {
        if (rmQuiet(abs)) removed += 1;
      }
    }
  }
  console.log(`[release-clean] pruned junk under ${relBase} (dirs/files≈${removed})`);
}

function cleanTools() {
  for (const rel of TOOL_DIRS) {
    walkClean(path.join(ROOT, rel), rel);
  }
}

function assertTauriResources() {
  const confPath = path.join(ROOT, "src-tauri", "tauri.conf.json");
  const raw = fs.readFileSync(confPath, "utf8");
  const conf = JSON.parse(raw);
  const resources = conf?.bundle?.resources || {};
  const keys = Object.keys(resources);
  const bad = keys.filter(
    (k) => k.includes("xupack") && !k.replace(/\\/g, "/").endsWith(`role-packs/${ALLOWED_PACK}`),
  );
  if (bad.length) {
    console.error("[release-clean] tauri.conf.json 不得嵌入非 full 岗位包:", bad);
    process.exit(1);
  }
  const hasFull = keys.some((k) => k.replace(/\\/g, "/").endsWith(`role-packs/${ALLOWED_PACK}`));
  if (!hasFull) {
    console.error("[release-clean] tauri.conf.json 缺少 full.zh-CN.xupack 映射");
    process.exit(1);
  }
  console.log("[release-clean] tauri resources: full role pack OK");
}

function main() {
  console.log("[release-clean] 正式发布清理（试用阶段：全量岗位）…");
  console.log(
    "[release-clean] 提示: 项目/反馈/模型在 %LOCALAPPDATA%\\xu，不进安装包；新用户装包是干净的。",
  );
  cleanRolePacks();
  cleanReleaseTargetLeftovers();
  cleanTools();
  assertTauriResources();
  console.log("[release-clean] done");
}

main();
