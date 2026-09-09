/**
 * @file Blender 后台 CLI 探测与短脚本执行（工作区沙箱）
 * @author qiuye <yjk150@qq.com>
 * @date 2026-09-06
 * @version 0.1.0
 * @category Parse
 * @algo blender-background-python
 */
import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";

const DEFAULT_TIMEOUT_MS = Math.max(
  10_000,
  Number(process.env.XU_BLENDER_TIMEOUT_MS || 90_000),
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

function candidateBlenderBins() {
  const out = [];
  const env = (process.env.XU_BLENDER_EXE || process.env.BLENDER_PATH || "").trim();
  if (env) out.push(env);
  if (isWindows()) {
    const pf = process.env.ProgramFiles || "C:\\Program Files";
    const local = process.env.LOCALAPPDATA || "";
    for (const ver of ["5.0", "4.5", "4.4", "4.3", "4.2", "4.1", "4.0", "3.6"]) {
      out.push(path.join(pf, "Blender Foundation", `Blender ${ver}`, "blender.exe"));
      if (local) {
        out.push(path.join(local, "Programs", "Blender Foundation", `Blender ${ver}`, "blender.exe"));
      }
    }
  } else if (process.platform === "darwin") {
    out.push("/Applications/Blender.app/Contents/MacOS/Blender");
    out.push("/Applications/Blender.app/Contents/MacOS/blender");
  } else {
    out.push("blender");
    out.push("/usr/bin/blender");
    out.push("/usr/local/bin/blender");
    out.push("/snap/bin/blender");
  }
  return out;
}

function probeVersion(exe) {
  try {
    const probe = spawnSync(exe, ["--version"], {
      encoding: "utf8",
      timeout: 2_500,
      killSignal: "SIGKILL",
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (probe.error || probe.status !== 0) return null;
    return (probe.stdout || "").split(/\r?\n/)[0]?.trim() || "ok";
  } catch {
    return null;
  }
}

export function findBlenderExe() {
  const seen = new Set();
  for (const p of candidateBlenderBins()) {
    if (!p || seen.has(p)) continue;
    seen.add(p);
    const isBare = p === "blender" || (!path.isAbsolute(p) && !/[\\/]/.test(p));
    if (isBare) {
      if (isWindows()) continue;
      const versionLine = probeVersion(p);
      if (versionLine) return { exe: p, versionLine };
      continue;
    }
    if (!fs.existsSync(p)) continue;
    // Skip --version on Windows: some installs hang the console; existence is enough for ping.
    if (isWindows()) return { exe: p, versionLine: "found" };
    const versionLine = probeVersion(p);
    return { exe: p, versionLine: versionLine || "found" };
  }
  return null;
}

function softDenyEval(code) {
  const lower = code.toLowerCase();
  const banned = [
    "subprocess",
    "os.system",
    "os.popen",
    "pty.",
    "__import__('subprocess",
    '.__import__("subprocess',
    "socket.",
    "ctypes.",
    "shutil.rmtree",
  ];
  for (const b of banned) {
    if (lower.includes(b)) {
      throw new Error(`blender_eval 拒绝危险片段: ${b}`);
    }
  }
}

function truncate(s, max = MAX_STDOUT_CHARS) {
  const t = String(s || "");
  if (t.length <= max) return t;
  return `${t.slice(0, max)}\n…(truncated)`;
}

function writeTempPy(workspaceRoot, body) {
  const dir = path.join(workspaceRoot, ".xu", "blender-tmp");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.py`);
  fs.writeFileSync(file, body, "utf8");
  return file;
}

/**
 * Run Blender in background with an optional .blend and a Python file.
 * @returns {{ ok: boolean, code: number|null, stdout: string, stderr: string, exe: string }}
 */
export function runBlenderPython({
  workspaceRoot,
  blendRel = null,
  pythonSource,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  extraArgs = [],
}) {
  const found = findBlenderExe();
  if (!found) {
    throw new Error(
      "未找到 Blender。请安装 Blender，或设置环境变量 XU_BLENDER_EXE 指向 blender 可执行文件。",
    );
  }
  let blendAbs = null;
  if (blendRel) {
    blendAbs = resolveWorkspaceRel(workspaceRoot, blendRel, { mustExist: true }).abs;
  }
  const pyFile = writeTempPy(workspaceRoot, pythonSource);
  const args = ["--background"];
  if (blendAbs) args.push(blendAbs);
  args.push("--python", pyFile, ...extraArgs);
  const result = spawnSync(found.exe, args, {
    cwd: workspaceRoot,
    encoding: "utf8",
    timeout: Math.min(Math.max(timeoutMs, 5_000), 300_000),
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024,
    env: {
      ...process.env,
      XU_WORKSPACE_ROOT: workspaceRoot,
    },
  });
  try {
    fs.unlinkSync(pyFile);
  } catch {
    /* keep for debug */
  }
  if (result.error) {
    throw new Error(`启动 Blender 失败: ${result.error.message}`);
  }
  return {
    ok: result.status === 0,
    code: result.status,
    stdout: truncate(result.stdout),
    stderr: truncate(result.stderr),
    exe: found.exe,
  };
}

export function blenderPing(args = {}) {
  const workspaceRoot = resolveWorkspace(args);
  const found = findBlenderExe();
  return {
    ok: Boolean(found),
    workspaceRoot,
    blender: found
      ? { exe: found.exe, version: found.versionLine }
      : null,
    hint: found
      ? null
      : "未找到 Blender；配置 XU_BLENDER_EXE 或安装 Blender Foundation 官方包。",
    platform: process.platform,
    tmp: path.join(workspaceRoot, ".xu", "blender-tmp"),
    hostname: os.hostname(),
  };
}

export function blenderEval(args = {}) {
  const workspaceRoot = resolveWorkspace(args);
  const code = String(args.code || args.python || "").trim();
  if (!code) throw new Error("blender_eval 需要 code");
  if (code.length > MAX_EVAL_CHARS) {
    throw new Error(`code 过长（上限 ${MAX_EVAL_CHARS} 字符）`);
  }
  softDenyEval(code);
  const timeoutMs = Number(args.timeoutMs || DEFAULT_TIMEOUT_MS);
  const blendRel = (args.blend || args.blendPath || "").trim() || null;
  const py = [
    "import bpy",
    "import sys",
    "print('XU_BLENDER_EVAL_BEGIN')",
    "try:",
    ...code.split("\n").map((line) => `    ${line}`),
    "except Exception as e:",
    "    print('XU_BLENDER_EVAL_ERROR:', e)",
    "    sys.exit(1)",
    "print('XU_BLENDER_EVAL_END')",
    "",
  ].join("\n");
  const run = runBlenderPython({
    workspaceRoot,
    blendRel,
    pythonSource: py,
    timeoutMs,
  });
  return {
    ok: run.ok,
    exitCode: run.code,
    stdout: run.stdout,
    stderr: run.stderr,
    blender: run.exe,
    blend: blendRel,
  };
}

export function blenderOpen(args = {}) {
  const workspaceRoot = resolveWorkspace(args);
  const rel = String(args.path || args.blend || "").trim();
  if (!rel) throw new Error("blender_open 需要 path（工作区内 .blend）");
  const { abs, rel: safeRel } = resolveWorkspaceRel(workspaceRoot, rel, { mustExist: true });
  if (!safeRel.toLowerCase().endsWith(".blend")) {
    throw new Error("仅支持打开 .blend");
  }
  const py = [
    "import bpy",
    `print('opened', ${JSON.stringify(abs.replace(/\\/g, "/"))})`,
    "print('objects', len(bpy.data.objects))",
    "print('filepath', bpy.data.filepath)",
    "",
  ].join("\n");
  const run = runBlenderPython({
    workspaceRoot,
    blendRel: safeRel,
    pythonSource: py,
  });
  return {
    ok: run.ok,
    path: safeRel,
    exitCode: run.code,
    stdout: run.stdout,
    stderr: run.stderr,
  };
}

export function blenderSave(args = {}) {
  const workspaceRoot = resolveWorkspace(args);
  const outRel = String(args.path || args.out || "").trim();
  if (!outRel) throw new Error("blender_save 需要 path（工作区相对 .blend）");
  const { abs, rel: safeRel } = resolveWorkspaceRel(workspaceRoot, outRel, { mustExist: false });
  if (!safeRel.toLowerCase().endsWith(".blend")) {
    throw new Error("保存目标须为 .blend");
  }
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const blendRel = (args.blend || args.from || "").trim() || null;
  const py = [
    "import bpy",
    `out = ${JSON.stringify(abs.replace(/\\/g, "/"))}`,
    "bpy.ops.wm.save_as_mainfile(filepath=out)",
    "print('saved', out)",
    "",
  ].join("\n");
  const run = runBlenderPython({
    workspaceRoot,
    blendRel,
    pythonSource: py,
  });
  return {
    ok: run.ok,
    path: safeRel,
    exitCode: run.code,
    stdout: run.stdout,
    stderr: run.stderr,
  };
}

export function blenderExport(args = {}) {
  const workspaceRoot = resolveWorkspace(args);
  const outRel = String(args.path || args.out || "").trim();
  if (!outRel) throw new Error("blender_export 需要 path（工作区相对导出路径）");
  const { abs, rel: safeRel } = resolveWorkspaceRel(workspaceRoot, outRel, { mustExist: false });
  const fmt = String(args.format || "").trim().toLowerCase()
    || (safeRel.toLowerCase().endsWith(".glb") || safeRel.toLowerCase().endsWith(".gltf")
      ? "glb"
      : "fbx");
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const blendRel = (args.blend || args.from || "").trim() || null;
  const outPosix = abs.replace(/\\/g, "/");
  let exportLines;
  if (fmt === "glb" || fmt === "gltf") {
    exportLines = [
      `bpy.ops.export_scene.gltf(filepath=${JSON.stringify(outPosix)}, export_format='GLB')`,
    ];
  } else if (fmt === "fbx") {
    exportLines = [
      `bpy.ops.export_scene.fbx(filepath=${JSON.stringify(outPosix)}, use_selection=False)`,
    ];
  } else if (fmt === "obj") {
    exportLines = [
      `bpy.ops.wm.obj_export(filepath=${JSON.stringify(outPosix)})`,
    ];
  } else {
    throw new Error("format 仅支持 fbx / glb / gltf / obj");
  }
  const py = [
    "import bpy",
    ...exportLines,
    `print('exported', ${JSON.stringify(outPosix)})`,
    "",
  ].join("\n");
  const run = runBlenderPython({
    workspaceRoot,
    blendRel,
    pythonSource: py,
    timeoutMs: Number(args.timeoutMs || DEFAULT_TIMEOUT_MS),
  });
  return {
    ok: run.ok && fs.existsSync(abs),
    path: safeRel,
    format: fmt,
    bytes: fs.existsSync(abs) ? fs.statSync(abs).size : 0,
    exitCode: run.code,
    stdout: run.stdout,
    stderr: run.stderr,
  };
}

export function blenderRenderPreview(args = {}) {
  const workspaceRoot = resolveWorkspace(args);
  const outRel = String(args.path || args.out || "deliverables/blender_preview.png").trim();
  const { abs, rel: safeRel } = resolveWorkspaceRel(workspaceRoot, outRel, { mustExist: false });
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const blendRel = (args.blend || args.from || "").trim() || null;
  const w = Math.min(Math.max(Number(args.width || 512), 64), 1920);
  const h = Math.min(Math.max(Number(args.height || 512), 64), 1080);
  const outPosix = abs.replace(/\\/g, "/");
  const py = [
    "import bpy",
    `bpy.context.scene.render.resolution_x = ${w}`,
    `bpy.context.scene.render.resolution_y = ${h}`,
    "bpy.context.scene.render.resolution_percentage = 100",
    "bpy.context.scene.render.image_settings.file_format = 'PNG'",
    `bpy.context.scene.render.filepath = ${JSON.stringify(outPosix)}`,
    "bpy.ops.render.render(write_still=True)",
    `print('preview', ${JSON.stringify(outPosix)})`,
    "",
  ].join("\n");
  const run = runBlenderPython({
    workspaceRoot,
    blendRel,
    pythonSource: py,
    timeoutMs: Number(args.timeoutMs || Math.max(DEFAULT_TIMEOUT_MS, 120_000)),
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
