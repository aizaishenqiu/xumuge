/**
 * @file Windows 设计脚本执行器（Photoshop ExtendScript / Corel VBA）
 * @author qiuye <yjk150@qq.com>
 * @date 2026-09-02
 * @version 1.0.0
 * @category Parse
 * @algo com-or-cli-fallback
 */
import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_TIMEOUT_MS = Math.max(
  10000,
  Number(process.env.XU_DESIGN_SCRIPT_TIMEOUT_MS || 120000),
);

function isWindows() {
  return process.platform === "win32";
}

function auditLog(workspaceRoot, line) {
  try {
    const dir = path.join(workspaceRoot, "qa");
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, "design-script-audit.log");
    const ts = new Date().toISOString();
    fs.appendFileSync(file, `${ts}\t${line}\n`, "utf8");
  } catch {
    /* ignore */
  }
}

/** Resolves a workspace-relative path; rejects escapes outside root. */
export function resolveWorkspaceScript(workspaceRoot, relativePath) {
  const root = path.resolve(workspaceRoot);
  const rel = String(relativePath || "").trim().replace(/\\/g, "/");
  if (!rel || rel.startsWith("/") || /^[a-zA-Z]:/.test(rel)) {
    throw new Error("脚本路径必须是工作区相对路径");
  }
  const abs = path.resolve(root, rel);
  const relCheck = path.relative(root, abs);
  if (relCheck.startsWith("..") || path.isAbsolute(relCheck)) {
    throw new Error("脚本路径超出工作区");
  }
  if (!fs.existsSync(abs)) {
    throw new Error(`脚本不存在: ${rel}`);
  }
  return { abs, rel };
}

function readTemplate(name) {
  const p = path.join(__dirname, "templates", name);
  if (!fs.existsSync(p)) throw new Error(`模板不存在: ${name}`);
  return fs.readFileSync(p, "utf8");
}

export function renderTemplate(templateName, vars) {
  let body = readTemplate(templateName);
  for (const [key, val] of Object.entries(vars)) {
    body = body.split(`{{${key}}}`).join(val);
  }
  return body;
}

function commonPsPaths() {
  const out = [];
  const env = (process.env.XU_PS_EXE || "").trim();
  if (env) out.push(env);
  const pf = process.env["ProgramFiles"] || "C:\\Program Files";
  const pfx = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
  for (const base of [pf, pfx]) {
    for (const ver of [
      "Adobe Photoshop 2025",
      "Adobe Photoshop 2024",
      "Adobe Photoshop 2023",
      "Adobe Photoshop CC 2019",
    ]) {
      out.push(path.join(base, "Adobe", ver, "Photoshop.exe"));
    }
  }
  return out.filter((p) => fs.existsSync(p));
}

function runPowerShell(script, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const r = spawnSync(
    "powershell",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
    { encoding: "utf8", timeout: timeoutMs, windowsHide: true },
  );
  return {
    ok: r.status === 0,
    status: r.status ?? -1,
    stdout: (r.stdout || "").trim(),
    stderr: (r.stderr || "").trim(),
    error: r.error ? String(r.error.message || r.error) : "",
  };
}

function psComVersion() {
  const probe = runPowerShell(
    `try { $a = New-Object -ComObject Photoshop.Application; $v = $a.Version; $a.Quit(); "ok:$v" } catch { "err:" + $_.Exception.Message }`,
    30000,
  );
  if (probe.stdout.startsWith("ok:")) return probe.stdout.replace(/^ok:/, "");
  return null;
}

/** Probes Photoshop / CorelDRAW availability on Windows. */
export function probeDesignApps() {
  if (!isWindows()) {
    return {
      platform: process.platform,
      photoshop: { available: false, reason: "仅支持 Windows" },
      corel: { available: false, reason: "仅支持 Windows" },
    };
  }
  const psPaths = commonPsPaths();
  const psVersion = psComVersion();
  const psCom = Boolean(psVersion);
  const corelProgId = (process.env.XU_COREL_PROG_ID || "CorelDRAW.Application").trim();
  const corelProbe = runPowerShell(
    `try { $a = New-Object -ComObject '${corelProgId.replace(/'/g, "''")}'; "ok:" + $a.Name } catch { "err:" + $_.Exception.Message }`,
    30000,
  );
  const corelOk = corelProbe.stdout.startsWith("ok:");
  return {
    platform: "win32",
    photoshop: {
      available: psCom || psPaths.length > 0,
      com: psCom,
      exeCandidates: psPaths.slice(0, 3),
      version: psVersion,
      reason: psCom || psPaths.length ? undefined : "未找到 Photoshop 安装",
    },
    corel: {
      available: corelOk,
      progId: corelProgId,
      name: corelOk ? corelProbe.stdout.replace(/^ok:/, "") : null,
      reason: corelOk ? undefined : corelProbe.stdout.replace(/^err:/, "") || corelProbe.stderr,
    },
  };
}

function escapePsString(s) {
  return String(s).replace(/'/g, "''");
}

/** Runs a .jsx script via COM DoJavaScript or Photoshop.exe -script fallback. */
export function runPsScript(workspaceRoot, relativePath) {
  if (!isWindows()) throw new Error("run_ps_script 仅支持 Windows");
  const { abs, rel } = resolveWorkspaceScript(workspaceRoot, relativePath);
  if (!/\.jsx$/i.test(rel)) throw new Error("Photoshop 脚本须为 .jsx");
  auditLog(workspaceRoot, `run_ps_script\t${rel}`);

  const jsx = fs.readFileSync(abs, "utf8");
  const comScript = `
$ErrorActionPreference = 'Stop'
try {
  $app = New-Object -ComObject Photoshop.Application
  $app.DisplayDialogs = 3
  $code = @'
${jsx.replace(/'/g, "''")}
'@
  $app.DoJavaScript($code)
  "exit:0"
} catch {
  "exit:1 " + $_.Exception.Message
}
`;
  let result = runPowerShell(comScript);
  if (result.ok && result.stdout.includes("exit:0")) {
    auditLog(workspaceRoot, `run_ps_script\t${rel}\texit=0\tvia=com`);
    return { ok: true, method: "com", relativePath: rel, stdout: result.stdout };
  }

  const exe = commonPsPaths()[0] || process.env.XU_PS_EXE;
  if (!exe || !fs.existsSync(exe)) {
    const msg = result.stderr || result.stdout || result.error || "未找到 Photoshop";
    auditLog(workspaceRoot, `run_ps_script\t${rel}\texit=1\t${msg.slice(0, 200)}`);
    throw new Error(`Photoshop 执行失败: ${msg}`);
  }
  const cli = spawnSync(exe, ["-script", abs], {
    encoding: "utf8",
    timeout: DEFAULT_TIMEOUT_MS,
    windowsHide: true,
  });
  const ok = cli.status === 0;
  auditLog(workspaceRoot, `run_ps_script\t${rel}\texit=${cli.status ?? -1}\tvia=cli`);
  if (!ok) {
    throw new Error(
      `Photoshop CLI 失败: ${(cli.stderr || cli.stdout || cli.error?.message || "").slice(0, 400)}`,
    );
  }
  return { ok: true, method: "cli", relativePath: rel, stdout: (cli.stdout || "").trim() };
}

/** Runs Corel macro from .bas file or macro name via COM. */
export function runCorelMacro(workspaceRoot, relativePath, macroName) {
  if (!isWindows()) throw new Error("run_corel_macro 仅支持 Windows");
  const progId = (process.env.XU_COREL_PROG_ID || "CorelDRAW.Application").trim();
  auditLog(workspaceRoot, `run_corel_macro\t${relativePath || macroName || ""}`);

  let script;
  if (relativePath) {
    const { abs, rel } = resolveWorkspaceScript(workspaceRoot, relativePath);
    if (!/\.bas$/i.test(rel)) throw new Error("Corel 宏文件须为 .bas");
    const bas = fs.readFileSync(abs, "utf8");
    const subMatch = bas.match(/Sub\s+(\w+)\s*\(/i);
    const sub = macroName || (subMatch ? subMatch[1] : "ExportUiBatch");
    script = `
$ErrorActionPreference = 'Stop'
$app = New-Object -ComObject '${escapePsString(progId)}'
$code = @'
${bas.replace(/'/g, "''")}
'@
$module = $app.VBE.ActiveVBProject.VBComponents.Add(1)
$module.CodeModule.AddFromString($code)
$app.Run "${sub.replace(/"/g, '`"')}"
"exit:0"
`;
  } else if (macroName) {
    script = `
$ErrorActionPreference = 'Stop'
$app = New-Object -ComObject '${escapePsString(progId)}'
$app.Run "${String(macroName).replace(/"/g, '`"')}"
"exit:0"
`;
  } else {
    throw new Error("run_corel_macro 需要 relativePath 或 macroName");
  }

  const result = runPowerShell(script);
  if (!result.ok || !result.stdout.includes("exit:0")) {
    const msg = result.stderr || result.stdout || result.error || "Corel 宏执行失败";
    auditLog(workspaceRoot, `run_corel_macro\tfail\t${msg.slice(0, 200)}`);
    throw new Error(msg.slice(0, 500));
  }
  auditLog(workspaceRoot, `run_corel_macro\texit=0`);
  return { ok: true, relativePath: relativePath || null, macroName: macroName || null };
}

export function generateFromTemplate(workspaceRoot, templateName, outRel, assetList) {
  const root = path.resolve(workspaceRoot).replace(/\\/g, "/");
  const assets = JSON.stringify(
    (assetList || []).map((a) => String(a).replace(/^UI\//, "")),
    null,
    2,
  );
  const body = renderTemplate(templateName, {
    XU_WORKSPACE_ROOT: root.replace(/\\/g, "/"),
    XU_ASSET_LIST: assets,
  });
  const outPath = path.join(workspaceRoot, outRel);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, body, "utf8");
  return { written: outRel, template: templateName };
}

export function generateAndRunPsExport(workspaceRoot, relativePath) {
  const assets = [];
  const uiDir = path.join(workspaceRoot, "UI");
  if (fs.existsSync(uiDir)) {
    const walk = (dir, rel = "") => {
      for (const name of fs.readdirSync(dir)) {
        const abs = path.join(dir, name);
        const relPath = rel ? `${rel}/${name}` : name;
        const st = fs.statSync(abs);
        if (st.isDirectory()) walk(abs, relPath);
        else if (/\.(psd|png|svg|jpg|jpeg|webp|pdf|md|cdr|ai)$/i.test(name)) {
          assets.push(`UI/${relPath}`);
        }
      }
    };
    walk(uiDir);
  }
  const outRel = relativePath || "UI/scripts/export_batch.jsx";
  const gen = generateFromTemplate(workspaceRoot, "export_png_batch.jsx", outRel, assets);
  const run = runPsScript(workspaceRoot, outRel);
  return { ...gen, run };
}
