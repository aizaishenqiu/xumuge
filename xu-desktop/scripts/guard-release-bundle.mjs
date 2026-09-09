/**
 * @file guard-release-bundle.mjs 正式打包硬门禁：禁 Debug / 敏感 / 本地测试垃圾（不因 private-full 跳过）
 * @author qiuye <yjk150@qq.com>
 * @date 2026-09-08
 * @version 1.0.0
 * @category Tooling
 * @algo release-preflight-scan
 *
 * 用法: node scripts/guard-release-bundle.mjs
 * 由 `pnpm build:release` 最先调用。失败非 0 退出。
 *
 * 自签本机证书默认拒绝；本机试打 release 形状包可设：
 *   XU_WIN_CODE_SIGN_ALLOW_SELF_SIGNED=1
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const ALLOWED_PACK = "full.zh-CN.xupack";
const ALLOWED_PACK_REL = `resources/role-packs/${ALLOWED_PACK}`;

/** 已知本机自签指纹（不得冒充正式 OV/EV 对外安装包） */
const KNOWN_SELF_SIGNED_THUMBS = new Set([
  "F6AF3AAAB9E186746153075C3A9B33401ABE4E70", // Virmoor Desktop Local
  "DBC4F3A60D0A366342FD7858C359853E4805C5EC", // My Hermes Desktop Local
]);

const DEBUG_PATTERNS = [
  { re: /7743\/ingest/i, label: "7743/ingest debug endpoint" },
  { re: /#region\s+agent\s+log/i, label: "#region agent log" },
  { re: /X-Debug-Session-Id/i, label: "X-Debug-Session-Id" },
  { re: /127\.0\.0\.1:7743/i, label: "127.0.0.1:7743" },
];

const MACHINE_ABS_PATH_RE =
  /(?:^|[\s"'`(=])(?:[A-Za-z]:[\\/](?:Users|users|home)|\/Users\/|\/home\/)[^\s"'`)]+/;

const SECRET_NAME_RE =
  /^(?:\.env|\.env\..*|credentials\.json|secrets\.json|.*\.pfx|.*\.p12)$/i;

const TEXT_EXT = new Set([
  ".ts",
  ".tsx",
  ".vue",
  ".js",
  ".mjs",
  ".cjs",
  ".json",
  ".rs",
  ".toml",
  ".md",
  ".yml",
  ".yaml",
  ".css",
  ".html",
  ".txt",
  ".ps1",
  ".sh",
]);

const SKIP_DIR = new Set([
  "node_modules",
  "target",
  "dist",
  ".git",
  ".vite",
  "vendor",
  "gen",
]);

/** @type {string[]} */
const issues = [];

function norm(p) {
  return p.replace(/\\/g, "/");
}

function relOf(abs) {
  return norm(path.relative(ROOT, abs));
}

function push(msg) {
  issues.push(msg);
}

function walkFiles(dir, filterFn, onFile) {
  if (!fs.existsSync(dir)) return;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    if (SKIP_DIR.has(ent.name)) continue;
    const abs = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      walkFiles(abs, filterFn, onFile);
      continue;
    }
    if (!ent.isFile()) continue;
    if (filterFn && !filterFn(abs, ent.name)) continue;
    onFile(abs, ent.name);
  }
}

function scanTextFile(abs, patterns) {
  let text;
  try {
    const st = fs.statSync(abs);
    if (st.size > 2_000_000) return;
    text = fs.readFileSync(abs, "utf8");
  } catch {
    return;
  }
  const rel = relOf(abs);
  for (const { re, label } of patterns) {
    if (re.test(text)) {
      push(`Debug 残留: ${rel} 命中 ${label}`);
    }
  }
}

function scanDebugInSource() {
  const roots = [path.join(ROOT, "src"), path.join(ROOT, "src-tauri")];
  for (const root of roots) {
    walkFiles(
      root,
      (abs) => TEXT_EXT.has(path.extname(abs).toLowerCase()),
      (abs) => scanTextFile(abs, DEBUG_PATTERNS),
    );
  }
}

/** 实际会进 NSIS 的 tools 子目录（与 tauri.conf.json bundle.resources 对齐） */
const BUNDLED_TOOL_DIRS = [
  "tools/feishu-ws",
  "tools/wecom-kf",
  "tools/design-mcp-bridge",
  "tools/mcp-blender-host",
  "tools/mcp-max-host",
  "tools/cursor-sdk-bridge",
];

function scanBundleSensitive() {
  const roots = [
    path.join(ROOT, "resources"),
    ...BUNDLED_TOOL_DIRS.map((r) => path.join(ROOT, r)),
  ];
  for (const root of roots) {
    walkFiles(
      root,
      null,
      (abs, name) => {
        const rel = relOf(abs);
        // .env.example 可留源码树；真正 .env / 密钥不得进包
        if (SECRET_NAME_RE.test(name) && !/\.example$/i.test(name)) {
          push(`敏感文件将可能进包扫描区: ${rel}`);
        }
        const ext = path.extname(name).toLowerCase();
        if (!TEXT_EXT.has(ext) && ext !== ".env") return;
        let text;
        try {
          const st = fs.statSync(abs);
          if (st.size > 1_000_000) return;
          text = fs.readFileSync(abs, "utf8");
        } catch {
          return;
        }
        if (MACHINE_ABS_PATH_RE.test(text)) {
          push(`机器绝对路径: ${rel}`);
        }
        if (/XU_PACK_MASTER_KEY_HEX\s*=\s*[0-9a-f]{32,}/i.test(text)) {
          push(`主密钥字面量: ${rel}`);
        }
        for (const { re, label } of DEBUG_PATTERNS) {
          if (re.test(text)) push(`Debug 残留(bundle 区): ${rel} 命中 ${label}`);
        }
      },
    );
  }
}

function scanTestDataInBundleConfig() {
  const confPath = path.join(ROOT, "src-tauri", "tauri.conf.json");
  if (!fs.existsSync(confPath)) {
    push("缺少 src-tauri/tauri.conf.json");
    return;
  }
  const conf = JSON.parse(fs.readFileSync(confPath, "utf8"));
  const resources = conf?.bundle?.resources || {};
  const keys = Object.keys(resources).map((k) => norm(k));
  for (const k of keys) {
    if (k.includes("dev.full") || k.includes("dev.full.zh-CN.xupack")) {
      push(`禁止把开发包嵌入 tauri resources: ${k}`);
    }
    if (k.includes("xupack") && !k.endsWith(`role-packs/${ALLOWED_PACK}`)) {
      push(`tauri.conf resources 仅允许 ${ALLOWED_PACK}，发现: ${k}`);
    }
    if (/deliverables|\.cache|commercial-plugins-src/i.test(k)) {
      push(`禁止嵌入本地测试/缓存路径: ${k}`);
    }
  }
  const hasFull = keys.some((k) => k.endsWith(`role-packs/${ALLOWED_PACK}`));
  if (!hasFull) {
    push(`tauri.conf.json 缺少 ${ALLOWED_PACK} 映射`);
  }

  const features = conf?.build?.features || [];
  if (features.includes("devtools")) {
    push("tauri.conf.json build.features 含 devtools（正式包禁止）");
  }

  // 磁盘上若仍有将进包的危险 xupack 名，提前提示（prepare-release-clean 会删，但配置不得引用）
  const roleDir = path.join(ROOT, "resources", "role-packs");
  if (fs.existsSync(roleDir)) {
    for (const name of fs.readdirSync(roleDir)) {
      if (name === "dev.full.zh-CN.xupack") {
        // 允许本机存在，但不得出现在 tauri.conf（已查）；仅警告到 issues 若被引用
        // no-op
      }
    }
  }
}

function assertNoDevtoolsDefault() {
  const cargoPath = path.join(ROOT, "src-tauri", "Cargo.toml");
  const text = fs.readFileSync(cargoPath, "utf8");
  // default features must not include devtools
  const m = text.match(/\[features\][\s\S]*?default\s*=\s*\[([^\]]*)\]/);
  if (m && /devtools/.test(m[1])) {
    push("Cargo.toml default features 含 devtools");
  }
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  const release = pkg?.scripts?.["build:release"] || "";
  if (/devtools/.test(release)) {
    push("build:release 脚本不得启用 devtools");
  }
}

function parseDotEnv(text) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i < 1) continue;
    const key = line.slice(0, i).trim();
    let val = line.slice(i + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

function assertSigning() {
  const defer =
    process.env.XU_WIN_CODE_SIGN_DEFER === "1";
  if (defer) {
    console.log(
      "[guard-release-bundle] XU_WIN_CODE_SIGN_DEFER=1 → 跳过指纹校验（先打未签名包，事后再签）",
    );
    return;
  }
  const envPath = path.join(ROOT, ".env.signing.local");
  if (!fs.existsSync(envPath)) {
    push("缺少 .env.signing.local（先配置正式代码签名指纹后再 pnpm prepare:signing；或设 XU_WIN_CODE_SIGN_DEFER=1 先打未签名包）");
    return;
  }
  const env = parseDotEnv(fs.readFileSync(envPath, "utf8"));
  const thumb = (env.XU_WIN_CODE_SIGN_THUMBPRINT || "").trim().toUpperCase();
  if (!/^[0-9A-F]{40}$/.test(thumb)) {
    push(`XU_WIN_CODE_SIGN_THUMBPRINT 无效: ${thumb || "(empty)"}`);
    return;
  }
  const allowSelf =
    process.env.XU_WIN_CODE_SIGN_ALLOW_SELF_SIGNED === "1" ||
    env.XU_WIN_CODE_SIGN_ALLOW_SELF_SIGNED === "1";
  if (KNOWN_SELF_SIGNED_THUMBS.has(thumb) && !allowSelf) {
    push(
      `当前指纹为已知本机自签（${thumb}）。正式对外包须 OV/EV 代码签名证书；` +
        `仅本机试打可设 XU_WIN_CODE_SIGN_ALLOW_SELF_SIGNED=1（不得冒充正式签）`,
    );
  }
  const subject = (env.XU_WIN_CODE_SIGN_SUBJECT || "").toLowerCase();
  if (/local|self.?sign|test/.test(subject) && !allowSelf) {
    push(
      `XU_WIN_CODE_SIGN_SUBJECT 像本机/测试证书: ${env.XU_WIN_CODE_SIGN_SUBJECT}` +
        `（正式包请换商业代码签名主体，或显式 ALLOW_SELF_SIGNED=1）`,
    );
  }

  // 明文 PFX 密码不得进 git 跟踪文件
  try {
    const tracked = execSync("git ls-files -z", { cwd: ROOT, encoding: "buffer" })
      .toString("utf8")
      .split("\0")
      .filter(Boolean)
      .map(norm);
    const dangerous = tracked.filter(
      (f) =>
        /(^|\/)\.env\.signing\.local$/.test(f) ||
        /\.pfx$/i.test(f) ||
        /\.p12$/i.test(f),
    );
    for (const f of dangerous) {
      push(`禁止把签名私钥/本机签名 env 提交进 git: ${f}`);
    }
    for (const f of tracked) {
      if (!/\.(md|example|mjs|ts|vue|rs|json|yml|yaml|toml)$/i.test(f)) continue;
      if (f.includes("node_modules")) continue;
      const abs = path.join(ROOT, f);
      if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) continue;
      let head;
      try {
        head = fs.readFileSync(abs, "utf8").slice(0, 8000);
      } catch {
        continue;
      }
      if (/XU_WIN_CODE_SIGN_PFX_PASSWORD\s*=\s*(?!REPLACE_ME\b)(?!your_)(?!\s*$)\S+/i.test(head)) {
        if (!/\.example$/i.test(f) && !f.endsWith(".signing.example")) {
          push(`疑似明文 PFX 密码出现在已跟踪文件: ${f}`);
        }
      }
    }
  } catch (e) {
    push(`无法检查 git 跟踪的签名敏感文件: ${e instanceof Error ? e.message : String(e)}`);
  }
}

function scrubToolsSecretsEarly() {
  // tools/* 会进 NSIS；guard 在 prepare-release-clean 之前跑，先剥掉明显敏感文件
  const junk = new Set([
    ".env",
    ".env.local",
    ".env.development",
    ".env.production",
    "config.local.json",
    "credentials.json",
    "secrets.json",
  ]);
  for (const rel of BUNDLED_TOOL_DIRS) {
    const dir = path.join(ROOT, rel);
    if (!fs.existsSync(dir)) continue;
    walkFiles(dir, null, (abs, name) => {
      if (!junk.has(name) && !SECRET_NAME_RE.test(name) && !/^\.env/i.test(name)) {
        return;
      }
      try {
        fs.unlinkSync(abs);
        console.warn(`[guard-release-bundle] scrubbed ${relOf(abs)}`);
      } catch (e) {
        push(
          `无法删除将进包的敏感文件 ${relOf(abs)}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    });
  }
}

function main() {
  console.log("[guard-release-bundle] 正式打包预检（不跳过 private-full）…");
  scanDebugInSource();
  scrubToolsSecretsEarly();
  scanBundleSensitive();
  scanTestDataInBundleConfig();
  assertNoDevtoolsDefault();
  assertSigning();

  if (issues.length) {
    console.error(`[guard-release-bundle] FAILED (${issues.length} issue(s)):`);
    for (const msg of issues) console.error(`  - ${msg}`);
    process.exit(1);
  }
  console.log(`[guard-release-bundle] OK (allowed pack=${ALLOWED_PACK_REL})`);
}

main();
