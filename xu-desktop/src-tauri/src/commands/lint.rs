use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LintDiagnostic {
    pub file: String,
    pub line: u32,
    pub column: u32,
    pub end_line: u32,
    pub end_column: u32,
    pub severity: String,
    pub message: String,
    pub rule_id: Option<String>,
    pub source: Option<String>,
}

#[derive(Debug, Deserialize)]
struct EslintJsonOutput(Vec<EslintFileResult>);

#[derive(Debug, Deserialize)]
struct EslintFileResult {
    #[serde(rename = "filePath")]
    file_path: String,
    messages: Vec<EslintMessage>,
}

#[derive(Debug, Deserialize)]
struct EslintMessage {
    #[serde(rename = "ruleId")]
    rule_id: Option<String>,
    severity: u8,
    message: String,
    line: Option<u32>,
    column: Option<u32>,
    #[serde(rename = "endLine")]
    end_line: Option<u32>,
    #[serde(rename = "endColumn")]
    end_column: Option<u32>,
}

fn assert_under_workspace(workspace: &str, target: &str) -> Result<(), String> {
    let root = Path::new(workspace)
        .canonicalize()
        .map_err(|e| format!("无效工作区: {e}"))?;
    let file = Path::new(target)
        .canonicalize()
        .map_err(|e| format!("无效文件路径: {e}"))?;
    if !file.starts_with(&root) {
        return Err("路径不在工作区内".into());
    }
    Ok(())
}

fn resolve_eslint_bin(workspace: &Path) -> Option<PathBuf> {
    let bin_dir = workspace.join("node_modules").join(".bin");
    #[cfg(windows)]
    {
        let cmd = bin_dir.join("eslint.cmd");
        if cmd.is_file() {
            return Some(cmd);
        }
        let exe = bin_dir.join("eslint.exe");
        if exe.is_file() {
            return Some(exe);
        }
        let bare = bin_dir.join("eslint");
        if bare.is_file() {
            return Some(bare);
        }
    }
    #[cfg(not(windows))]
    {
        let bin = bin_dir.join("eslint");
        if bin.is_file() {
            return Some(bin);
        }
    }
    None
}

fn parse_eslint_stdout(stdout: &[u8]) -> Result<Vec<LintDiagnostic>, String> {
    if stdout.is_empty() {
        return Ok(vec![]);
    }
    let parsed: EslintJsonOutput =
        serde_json::from_slice(stdout).map_err(|e| format!("解析 ESLint 输出失败: {e}"))?;
    let mut out = Vec::new();
    for file in parsed.0 {
        for msg in file.messages {
            let line = msg.line.unwrap_or(1).max(1);
            let column = msg.column.unwrap_or(1).max(1);
            let end_line = msg.end_line.unwrap_or(line).max(line);
            let end_column = msg.end_column.unwrap_or(column).max(1);
            let severity = match msg.severity {
                2 => "error",
                1 => "warning",
                _ => "info",
            }
            .to_string();
            out.push(LintDiagnostic {
                file: file.file_path.clone(),
                line,
                column,
                end_line,
                end_column,
                severity,
                message: msg.message,
                rule_id: msg.rule_id,
                source: Some("eslint".into()),
            });
        }
    }
    Ok(out)
}

#[tauri::command]
pub async fn run_eslint(
    workspace: String,
    paths: Vec<String>,
    fix: Option<bool>,
) -> Result<Vec<LintDiagnostic>, String> {
    let ws = workspace.trim();
    if ws.is_empty() {
        return Err("请先选择工作目录".into());
    }
    let ws_path = Path::new(ws);
    if !ws_path.is_dir() {
        return Err(format!("工作区不是目录: {ws}"));
    }

    let rel_paths: Vec<String> = if paths.is_empty() {
        return Ok(vec![]);
    } else {
        paths
            .iter()
            .map(|p| p.trim())
            .filter(|p| !p.is_empty())
            .map(|p| {
                assert_under_workspace(ws, p)?;
                Ok(p.to_string())
            })
            .collect::<Result<Vec<_>, String>>()?
    };

    if rel_paths.is_empty() {
        return Ok(vec![]);
    }

    let apply_fix = fix.unwrap_or(false);
    let mut args: Vec<String> = vec![
        "--format".into(),
        "json".into(),
        "--no-error-on-unmatched-pattern".into(),
    ];
    if apply_fix {
        args.push("--fix".into());
    }
    args.extend(rel_paths);

    let output = if let Some(eslint_bin) = resolve_eslint_bin(ws_path) {
        Command::new(&eslint_bin)
            .args(&args)
            .current_dir(ws_path)
            .output()
            .map_err(|e| format!("无法运行 ESLint: {e}"))?
    } else {
        let mut npx = Command::new("npx");
        npx.arg("--yes").arg("eslint");
        npx.args(&args).current_dir(ws_path);
        npx.output()
            .map_err(|e| format!("未找到 ESLint。请在工作区安装：pnpm add -D eslint（{e}）"))?
    };

    let stdout = &output.stdout;
    let stderr = String::from_utf8_lossy(&output.stderr);

    // ESLint exits 1 when there are lint errors — still parse stdout.
    if !output.status.success() && stdout.is_empty() {
        let hint = stderr.trim();
        if hint.contains("eslint") && (hint.contains("not found") || hint.contains("无法识别"))
        {
            return Err(
                "工作区未安装 ESLint。请在终端运行：pnpm add -D eslint，并配置 eslint.config.js"
                    .into(),
            );
        }
        return Err(if hint.is_empty() {
            format!("ESLint 执行失败 (exit {:?})", output.status.code())
        } else {
            hint.to_string()
        });
    }

    parse_eslint_stdout(stdout)
}

#[tauri::command]
pub async fn detect_eslint_info(workspace: String) -> Result<serde_json::Value, String> {
    let ws = workspace.trim();
    if ws.is_empty() {
        return Ok(serde_json::json!({ "installed": false }));
    }
    let ws_path = Path::new(ws);
    let installed = resolve_eslint_bin(ws_path).is_some();
    let mut plugins: Vec<String> = Vec::new();

    let pkg_path = ws_path.join("package.json");
    if pkg_path.is_file() {
        if let Ok(text) = std::fs::read_to_string(&pkg_path) {
            if let Ok(val) = serde_json::from_str::<serde_json::Value>(&text) {
                for key in ["devDependencies", "dependencies"] {
                    if let Some(deps) = val.get(key).and_then(|d| d.as_object()) {
                        for name in deps.keys() {
                            if name == "eslint"
                                || name.starts_with("eslint-plugin-")
                                || name.starts_with("@typescript-eslint/")
                            {
                                plugins.push(name.clone());
                            }
                        }
                    }
                }
            }
        }
    }
    plugins.sort();
    plugins.dedup();

    let config_files = [
        "eslint.config.js",
        "eslint.config.mjs",
        "eslint.config.cjs",
        "eslint.config.ts",
        ".eslintrc.cjs",
        ".eslintrc.js",
        ".eslintrc.json",
    ];
    let has_config = config_files.iter().any(|f| ws_path.join(f).is_file());

    Ok(serde_json::json!({
        "installed": installed,
        "hasConfig": has_config,
        "plugins": plugins,
    }))
}
