/**
 * @file 3ds Max Batch / MaxScript 探测与短脚本执行（工作区沙箱，Windows）
 * @author qiuye <yjk150@qq.com>
 * @date 2026-09-06
 * @version 0.1.0
 * @category Parse
 * @algo max-batch-maxscript
 */
import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";

const DEFAULT_TIMEOUT_MS = Math.max(
  15_000,
  Number(process.env.XU_MAX_TIMEOUT_MS || 180_000),
);
const MAX_EVAL_CHARS = 8_000;
const MAX_STDOUT_CHARS = 32_000;

function isWindows() {
  return process.platform === "win32";
}

/** Resolve workspace root from tool args / env / cwd. */
export function resolveWorkspace(args = {}) {
  const fromArg = String(args.workspaceRoot || args.workspace || "").trim();
  const fromEnv = (process.env.XU_WORKSPACE_ROOT || "").trim();
  const root = path.resolve(fromArg || fromEnv || process.cwd());
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    throw new Error(`工作区不存在: ${root}`);
  }
  return root;
}

/** Workspace-relative path only; rejects absolute / escape. */
export function resolveWorkspaceRel(workspaceRoot, relativePath, { mustExist = false } = {}) {
  const root = path.resolve(workspaceRoot);
  const rel = String(relativePath || "").trim().replace(/\\/g, "/");
  if (!rel || rel.startsWith("/") || /^[a-zA-Z]:/.test(rel)) {
    throw new Error("路径必须是工作区相对路径");
  }
  if (rel.includes("\0") || rel.split("/").some((p) => p === "..")) {
    throw new Error("非法相对路径");
  }
  const abs = path.resolve(root, rel);
  const relCheck = path.relative(root, abs);
  if (relCheck.startsWith("..") || path.isAbsolute(relCheck)) {
    throw new Error("路径超出工作区");
  }
  if (mustExist && !fs.existsSync(abs)) {
    throw new Error(`文件不存在: ${rel}`);
  }
  return { abs, rel: relCheck.replace(/\\/g, "/") };
}

/** MaxScript verbatim path: @"C:\foo\bar.max" (avoid JS escape of \f \b etc.) */
function mxsPath(abs) {
  const win = String(abs).replace(/\//g, "\\").replace(/"/g, "");
  return '@"' + win + '"';
}

function candidateMaxBatchBins() {
  const out = [];
  const envBatch = (process.env.XU_MAX_BATCH_EXE || "").trim();
  const envMax = (process.env.XU_MAX_EXE || "").trim();
  if (envBatch) out.push(envBatch);
  if (envMax) {
    if (envMax.toLowerCase().endsWith("3dsmax.exe")) {
      out.push(envMax.replace(/3dsmax\.exe$/i, "3dsmaxbatch.exe"));
      out.push(envMax);
    } else {
      // Treat as install dir only when the joined path looks like a directory string;
      // avoid existsSync on Autodesk trees (can hang under AV / network filters).
      const batch = path.join(envMax, "3dsmaxbatch.exe");
      const gui = path.join(envMax, "3dsmax.exe");
      out.push(batch, gui, envMax);
    }
  }
  // Optional explicit list: XU_MAX_CANDIDATES=path1;path2 (no Program Files walk).
  const extra = (process.env.XU_MAX_CANDIDATES || "").trim();
  if (extra) {
    for (const p of extra.split(/[;|]/).map((s) => s.trim()).filter(Boolean)) {
      out.push(p);
    }
  }
  return out;
}

export function findMaxExe() {
  if (!isWindows()) return null;
  const seen = new Set();
  let fallbackGui = null;
  for (const p of candidateMaxBatchBins()) {
    if (!p || seen.has(p)) continue;
    seen.add(p);
    try {
      if (!fs.existsSync(p)) continue;
    } catch {
      continue;
    }
    const base = path.basename(p).toLowerCase();
    if (base === "3dsmaxbatch.exe") {
      return { exe: p, kind: "batch", versionLine: path.basename(path.dirname(p)) };
    }
    if (base === "3dsmax.exe" && !fallbackGui) {
      fallbackGui = { exe: p, kind: "gui", versionLine: path.basename(path.dirname(p)) };
    }
  }
  return fallbackGui;
}

function softDenyEval(code, language) {
  const lower = code.toLowerCase();
  const banned =
    language === "python"
      ? [
          "subprocess",
          "os.system",
          "os.popen",
          "socket.",
          "ctypes.",
          "shutil.rmtree",
        ]
      : [
          "doscommand",
          "hiddendoscommand",
          "shelllaunch",
          "registry.openkey",
        ];
  for (const b of banned) {
    if (lower.includes(b)) {
      throw new Error(`max_eval 拒绝危险片段: ${b}`);
    }
  }
}

function truncate(s, max = MAX_STDOUT_CHARS) {
  const t = String(s || "");
  if (t.length <= max) return t;
  return `${t.slice(0, max)}\n…(truncated)`;
}

function writeTempScript(workspaceRoot, ext, body) {
  const dir = path.join(workspaceRoot, ".xu", "max-tmp");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(
    dir,
    `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`,
  );
  fs.writeFileSync(file, body, "utf8");
  return file;
}

/**
 * Run 3dsmaxbatch (preferred) or GUI Max with a script file.
 * Autodesk batch sometimes returns non-zero quirks; callers may treat file presence as success.
 */
export function runMaxScript({
  workspaceRoot,
  scriptSource,
  language = "mxs",
  sceneRel = null,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}) {
  const found = findMaxExe();
  if (!found) {
    throw new Error(
      "未找到 3ds Max。请安装 Autodesk 3ds Max，或设置 XU_MAX_BATCH_EXE / XU_MAX_EXE。",
    );
  }
  const ext = language === "python" ? "py" : "ms";
  const scriptFile = writeTempScript(workspaceRoot, ext, scriptSource);
  const logFile = path.join(path.dirname(scriptFile), `${path.basename(scriptFile)}.log`);
  const args = [];
  if (found.kind === "batch") {
    args.push(scriptFile);
    if (sceneRel) {
      const sceneAbs = resolveWorkspaceRel(workspaceRoot, sceneRel, { mustExist: true }).abs;
      args.push("-sceneFile", sceneAbs);
    }
    args.push("-listenerLog", logFile);
  } else {
    // GUI fallback: quieter launch; still may flash a window.
    args.push("-q", "-silent");
    if (sceneRel) {
      args.push(resolveWorkspaceRel(workspaceRoot, sceneRel, { mustExist: true }).abs);
    }
    if (language === "python") {
      args.push("-U", "PythonHost", scriptFile);
    } else {
      args.push("-U", "MAXScript", scriptFile);
    }
  }
  const result = spawnSync(found.exe, args, {
    cwd: workspaceRoot,
    encoding: "utf8",
    timeout: Math.min(Math.max(timeoutMs, 10_000), 600_000),
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024,
    env: {
      ...process.env,
      XU_WORKSPACE_ROOT: workspaceRoot,
    },
  });
  let logText = "";
  try {
    if (fs.existsSync(logFile)) {
      logText = fs.readFileSync(logFile, "utf8");
      fs.unlinkSync(logFile);
    }
  } catch {
    /* ignore */
  }
  try {
    fs.unlinkSync(scriptFile);
  } catch {
    /* keep for debug */
  }
  if (result.error) {
    throw new Error(`启动 3ds Max 失败: ${result.error.message}`);
  }
  // Batch often returns -130 / 4294967166 on "success"; treat 0 and known quirks as soft-ok.
  const code = result.status;
  const softOk =
    code === 0 || code === -130 || code === 4294967166 || code === 126 || code === null;
  return {
    ok: softOk,
    code,
    stdout: truncate((result.stdout || "") + (logText ? `\n${logText}` : "")),
    stderr: truncate(result.stderr),
    exe: found.exe,
    kind: found.kind,
  };
}

export function maxPing(args = {}) {
  const workspaceRoot = resolveWorkspace(args);
  if (!isWindows()) {
    return {
      ok: false,
      workspaceRoot,
      max: null,
      hint: "3ds Max 宿主仅支持 Windows。",
      platform: process.platform,
    };
  }
  const found = findMaxExe();
  return {
    ok: Boolean(found),
    workspaceRoot,
    max: found
      ? { exe: found.exe, kind: found.kind, version: found.versionLine }
      : null,
    hint: found
      ? null
      : "未找到 3ds Max。请设置 XU_MAX_BATCH_EXE（推荐 3dsmaxbatch.exe）或 XU_MAX_EXE；勿依赖自动扫 Program Files。",
    platform: process.platform,
    tmp: path.join(workspaceRoot, ".xu", "max-tmp"),
    hostname: os.hostname(),
  };
}

export function maxEval(args = {}) {
  const workspaceRoot = resolveWorkspace(args);
  const code = String(args.code || args.script || "").trim();
  if (!code) throw new Error("max_eval 需要 code");
  if (code.length > MAX_EVAL_CHARS) {
    throw new Error(`code 过长（上限 ${MAX_EVAL_CHARS} 字符）`);
  }
  const language = String(args.language || "mxs").trim().toLowerCase() === "python"
    ? "python"
    : "mxs";
  softDenyEval(code, language);
  const sceneRel = (args.scene || args.max || args.path || "").trim() || null;
  let scriptSource;
  if (language === "python") {
    scriptSource = [
      "from pymxs import runtime as rt",
      "print('XU_MAX_EVAL_BEGIN')",
      "try:",
      ...code.split("\n").map((line) => `    ${line}`),
      "except Exception as e:",
      "    print('XU_MAX_EVAL_ERROR', e)",
      "    raise",
      "print('XU_MAX_EVAL_END')",
      "",
    ].join("\n");
  } else {
    scriptSource = [
      "-- xu max_eval",
      "format \"XU_MAX_EVAL_BEGIN\\n\"",
      "try (",
      code,
      "  format \"XU_MAX_EVAL_END\\n\"",
      ") catch (",
      "  format \"XU_MAX_EVAL_ERROR: %\\n\" (getCurrentException())",
      ")",
      "",
    ].join("\n");
  }
  const run = runMaxScript({
    workspaceRoot,
    scriptSource,
    language,
    sceneRel,
    timeoutMs: Number(args.timeoutMs || DEFAULT_TIMEOUT_MS),
  });
  return {
    ok: run.ok,
    language,
    exitCode: run.code,
    stdout: run.stdout,
    stderr: run.stderr,
    max: run.exe,
    kind: run.kind,
    scene: sceneRel,
  };
}

export function maxOpen(args = {}) {
  const workspaceRoot = resolveWorkspace(args);
  const rel = String(args.path || args.scene || "").trim();
  if (!rel) throw new Error("max_open 需要 path（工作区内 .max）");
  const { abs, rel: safeRel } = resolveWorkspaceRel(workspaceRoot, rel, { mustExist: true });
  if (!safeRel.toLowerCase().endsWith(".max")) {
    throw new Error("仅支持打开 .max");
  }
  const scriptSource = [
    `loadMaxFile ${mxsPath(abs)} useFileUnits:true quiet:true`,
    `format "opened %\\n" (maxFilePath + maxFileName)`,
    `format "objects=%\\n" objects.count`,
    "",
  ].join("\n");
  const run = runMaxScript({ workspaceRoot, scriptSource, language: "mxs" });
  return {
    ok: run.ok,
    path: safeRel,
    exitCode: run.code,
    stdout: run.stdout,
    stderr: run.stderr,
  };
}

export function maxSave(args = {}) {
  const workspaceRoot = resolveWorkspace(args);
  const outRel = String(args.path || args.out || "").trim();
  if (!outRel) throw new Error("max_save 需要 path（工作区相对 .max）");
  const { abs, rel: safeRel } = resolveWorkspaceRel(workspaceRoot, outRel, { mustExist: false });
  if (!safeRel.toLowerCase().endsWith(".max")) {
    throw new Error("保存目标须为 .max");
  }
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const sceneRel = (args.scene || args.from || "").trim() || null;
  const scriptSource = [
    sceneRel
      ? `loadMaxFile ${mxsPath(resolveWorkspaceRel(workspaceRoot, sceneRel, { mustExist: true }).abs)} useFileUnits:true quiet:true`
      : "",
    `saveMaxFile ${mxsPath(abs)} quiet:true`,
    `format "saved %\\n" ${mxsPath(abs)}`,
    "",
  ]
    .filter(Boolean)
    .join("\n");
  const run = runMaxScript({
    workspaceRoot,
    scriptSource,
    language: "mxs",
  });
  return {
    ok: run.ok && fs.existsSync(abs),
    path: safeRel,
    exitCode: run.code,
    stdout: run.stdout,
    stderr: run.stderr,
  };
}

export function maxExportFbx(args = {}) {
  const workspaceRoot = resolveWorkspace(args);
  const outRel = String(args.path || args.out || "").trim();
  if (!outRel) throw new Error("max_export_fbx 需要 path（工作区相对 .fbx）");
  const { abs, rel: safeRel } = resolveWorkspaceRel(workspaceRoot, outRel, { mustExist: false });
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const sceneRel = (args.scene || args.from || "").trim() || null;
  const loadLine = sceneRel
    ? `loadMaxFile ${mxsPath(resolveWorkspaceRel(workspaceRoot, sceneRel, { mustExist: true }).abs)} useFileUnits:true quiet:true`
    : "";
  const scriptSource = [
    loadLine,
    `exportFile ${mxsPath(abs)} #noPrompt selectedOnly:false using:FBXEXP`,
    `format "exported %\\n" ${mxsPath(abs)}`,
    "",
  ]
    .filter(Boolean)
    .join("\n");
  const run = runMaxScript({
    workspaceRoot,
    scriptSource,
    language: "mxs",
    timeoutMs: Number(args.timeoutMs || DEFAULT_TIMEOUT_MS),
  });
  return {
    ok: run.ok && fs.existsSync(abs),
    path: safeRel,
    format: "fbx",
    bytes: fs.existsSync(abs) ? fs.statSync(abs).size : 0,
    exitCode: run.code,
    stdout: run.stdout,
    stderr: run.stderr,
  };
}

export function maxRenderPreview(args = {}) {
  const workspaceRoot = resolveWorkspace(args);
  const outRel = String(args.path || args.out || "deliverables/max_preview.png").trim();
  const { abs, rel: safeRel } = resolveWorkspaceRel(workspaceRoot, outRel, { mustExist: false });
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const sceneRel = (args.scene || args.from || "").trim() || null;
  const w = Math.min(Math.max(Number(args.width || 512), 64), 1920);
  const h = Math.min(Math.max(Number(args.height || 512), 64), 1080);
  const loadLine = sceneRel
    ? `loadMaxFile ${mxsPath(resolveWorkspaceRel(workspaceRoot, sceneRel, { mustExist: true }).abs)} useFileUnits:true quiet:true`
    : "";
  const scriptSource = [
    loadLine,
    `render outputFile:${mxsPath(abs)} outputwidth:${w} outputheight:${h} vfb:false`,
    `format "preview %\\n" ${mxsPath(abs)}`,
    "",
  ]
    .filter(Boolean)
    .join("\n");
  const run = runMaxScript({
    workspaceRoot,
    scriptSource,
    language: "mxs",
    timeoutMs: Number(args.timeoutMs || Math.max(DEFAULT_TIMEOUT_MS, 240_000)),
  });
  return {
    ok: run.ok && fs.existsSync(abs),
    path: safeRel,
    width: w,
    height: h,
    bytes: fs.existsSync(abs) ? fs.statSync(abs).size : 0,
    exitCode: run.code,
    stdout: run.stdout,
    stderr: run.stderr,
  };
}
