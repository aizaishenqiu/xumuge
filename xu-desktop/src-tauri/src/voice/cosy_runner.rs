//! CosyVoice 安装 runner：下载、conda、clone、pip、ModelScope（Windows CREATE_NO_WINDOW）。
//!
//! @author qiuye <yjk150@qq.com>
//! @date 2026-08-31
//! @version 1.0.0
//! @category Stream
//! @algo cosyvoice-phase-runner

use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

/// 清华镜像 Miniconda（Windows x86_64）。
fn miniconda_url() -> String {
    crate::xu_env::env_or(
        "XU_MINICONDA_URL",
        "https://mirrors.tuna.tsinghua.edu.cn/anaconda/miniconda/Miniconda3-latest-Windows-x86_64.exe",
    )
}

fn cosyvoice_git() -> String {
    crate::xu_env::env_or("XU_COSY_GIT_URL", "https://github.com/FunAudioLLM/CosyVoice.git")
}

fn pip_index() -> String {
    crate::xu_env::env_or("XU_PIP_INDEX", "https://mirrors.aliyun.com/pypi/simple/")
}

fn pip_trusted_host(index: &str) -> String {
    index
        .trim()
        .trim_start_matches("https://")
        .trim_start_matches("http://")
        .split('/')
        .next()
        .unwrap_or("mirrors.aliyun.com")
        .to_string()
}

pub const MODEL_SCOPE_ID: &str = "iic/CosyVoice2-0.5B";

fn apply_no_window(cmd: &mut Command) {
    #[cfg(windows)]
    {
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
}

/// 追加安装日志。
pub fn append_log(log_path: &Path, line: &str) {
    if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(log_path) {
        let _ = writeln!(f, "{}", line);
    }
}

/// 运行命令，合并 stdout/stderr；cancel 时尽力结束。
pub fn run_cmd(
    program: &str,
    args: &[&str],
    cwd: Option<&Path>,
    cancel: &AtomicBool,
    log_path: &Path,
) -> Result<String, String> {
    if cancel.load(Ordering::Relaxed) {
        return Err("已取消".into());
    }
    append_log(
        log_path,
        &format!("$ {} {}", program, args.join(" ")),
    );
    let mut cmd = Command::new(program);
    cmd.args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(dir) = cwd {
        cmd.current_dir(dir);
    }
    apply_no_window(&mut cmd);
    let output = cmd
        .output()
        .map_err(|e| format!("无法启动 {program}: {e}"))?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    let combined = format!("{stdout}{stderr}");
    if !combined.trim().is_empty() {
        append_log(log_path, combined.trim());
    }
    if cancel.load(Ordering::Relaxed) {
        return Err("已取消".into());
    }
    if !output.status.success() {
        let msg = combined
            .lines()
            .rev()
            .take(8)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect::<Vec<_>>()
            .join("\n");
        return Err(if msg.is_empty() {
            format!("{program} 失败 (code {:?})", output.status.code())
        } else {
            msg
        });
    }
    Ok(combined)
}

/// 下载文件到 dest（覆盖）。
pub fn download_file(url: &str, dest: &Path, cancel: &AtomicBool, log_path: &Path) -> Result<(), String> {
    if cancel.load(Ordering::Relaxed) {
        return Err("已取消".into());
    }
    append_log(log_path, &format!("download {url} -> {}", dest.display()));
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    // 用 reqwest blocking via curl-like: PowerShell Invoke-WebRequest 易弹窗；用现有 reqwest in async context is harder.
    // Prefer curl.exe if present, else bitsadmin-less: use std + ureq isn't available.
    // Project has reqwest — use blocking client.
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(60 * 30))
        .build()
        .map_err(|e| e.to_string())?;
    let mut resp = client
        .get(url)
        .send()
        .map_err(|e| format!("下载失败: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("下载 HTTP {}", resp.status()));
    }
    let tmp = dest.with_extension("part");
    let mut file = File::create(&tmp).map_err(|e| e.to_string())?;
    std::io::copy(&mut resp, &mut file).map_err(|e| format!("写文件失败: {e}"))?;
    drop(file);
    std::fs::rename(&tmp, dest).map_err(|e| e.to_string())?;
    Ok(())
}

/// Miniconda 路径（装在 installRoot/miniconda）。
pub fn conda_exe(install_root: &Path) -> PathBuf {
    install_root.join("miniconda").join("Scripts").join("conda.exe")
}

pub fn python_exe(install_root: &Path) -> PathBuf {
    install_root
        .join("miniconda")
        .join("envs")
        .join("cosyvoice")
        .join("python.exe")
}

/// 静默安装 Miniconda 到 installRoot/miniconda。
pub fn install_miniconda(
    install_root: &Path,
    cancel: &AtomicBool,
    log_path: &Path,
) -> Result<(), String> {
    let prefix = install_root.join("miniconda");
    if conda_exe(install_root).is_file() {
        append_log(log_path, "miniconda already present");
        return Ok(());
    }
    let installer = install_root.join("_cache").join("Miniconda3-latest-Windows-x86_64.exe");
    download_file(&miniconda_url(), &installer, cancel, log_path)?;
    let prefix_str = prefix.to_string_lossy().replace('/', "\\");
    // Official: start /wait "" Miniconda3.exe /S /D=C:\path
    run_cmd(
        &installer.to_string_lossy(),
        &["/S", &format!("/D={prefix_str}")],
        None,
        cancel,
        log_path,
    )?;
    if !conda_exe(install_root).is_file() {
        return Err("Miniconda 静默安装后未找到 conda.exe".into());
    }
    Ok(())
}

pub fn ensure_python310_env(
    install_root: &Path,
    cancel: &AtomicBool,
    log_path: &Path,
) -> Result<(), String> {
    let conda = conda_exe(install_root);
    if !conda.is_file() {
        return Err("conda 不可用".into());
    }
    if python_exe(install_root).is_file() {
        append_log(log_path, "cosyvoice env exists");
        return Ok(());
    }
    run_cmd(
        &conda.to_string_lossy(),
        &["create", "-y", "-n", "cosyvoice", "python=3.10"],
        None,
        cancel,
        log_path,
    )?;
    Ok(())
}

pub fn install_pynini(
    install_root: &Path,
    cancel: &AtomicBool,
    log_path: &Path,
) -> Result<(), String> {
    let conda = conda_exe(install_root);
    run_cmd(
        &conda.to_string_lossy(),
        &[
            "install",
            "-y",
            "-n",
            "cosyvoice",
            "-c",
            "conda-forge",
            "pynini",
        ],
        None,
        cancel,
        log_path,
    )?;
    Ok(())
}

fn intern(s: String) -> &'static str {
    Box::leak(s.into_boxed_str())
}

fn gh_clone_urls() -> Vec<(&'static str, String)> {
    let git = cosyvoice_git();
    let mut urls = Vec::new();
    if let Ok(m) = std::env::var("XU_GH_MIRROR").or_else(|_| std::env::var("XU_SHERPA_MIRROR")) {
        let base = m.trim().trim_end_matches('/');
        if !base.is_empty() {
            let u = if base.contains("github.com") {
                base.to_string()
            } else {
                format!("{base}/FunAudioLLM/CosyVoice.git")
            };
            urls.push(("自定义GH", u));
        }
    }
    let github_form = if git.contains("github.com") {
        git.clone()
    } else {
        "https://github.com/FunAudioLLM/CosyVoice.git".into()
    };
    let prefixes: Vec<String> = crate::xu_env::nonempty("XU_GH_PROXY_PREFIXES")
        .map(|raw| {
            raw.split(',')
                .map(|s| s.trim())
                .filter(|s| !s.is_empty())
                .map(|p| {
                    if p.ends_with('/') {
                        p.to_string()
                    } else {
                        format!("{p}/")
                    }
                })
                .collect()
        })
        .filter(|v: &Vec<String>| !v.is_empty())
        .unwrap_or_else(|| {
            vec![
                "https://ghfast.top/".into(),
                "https://gh-proxy.com/".into(),
                "https://ghproxy.net/".into(),
            ]
        });
    for (i, prefix) in prefixes.into_iter().enumerate() {
        urls.push((
            intern(format!("加速源·{}", i + 1)),
            format!("{prefix}{github_form}"),
        ));
    }
    urls.push(("直连", git));
    urls
}

/// 克隆 CosyVoice 仓库；多镜像候选，失败自动换源。
pub fn clone_cosyvoice(
    install_root: &Path,
    cancel: &AtomicBool,
    log_path: &Path,
) -> Result<(PathBuf, String), String> {
    let repo = install_root.join("repo");
    if repo.join(".git").is_dir() {
        append_log(log_path, "repo already cloned");
        return Ok((repo, "cached".into()));
    }
    if repo.exists() {
        std::fs::remove_dir_all(&repo).map_err(|e| e.to_string())?;
    }
    let mut last_err = String::new();
    for (label, url) in gh_clone_urls() {
        if cancel.load(Ordering::Relaxed) {
            return Err("已取消".into());
        }
        append_log(log_path, &format!("git clone via {label}: {url}"));
        match run_cmd(
            "git",
            &[
                "clone",
                "--recursive",
                "--depth",
                "1",
                &url,
                &repo.to_string_lossy(),
            ],
            None,
            cancel,
            log_path,
        ) {
            Ok(_) if repo.join(".git").is_dir() => return Ok((repo, label.into())),
            Ok(_) => last_err = format!("{label} 克隆后未找到 .git"),
            Err(e) => last_err = format!("{label}: {e}"),
        }
        let _ = std::fs::remove_dir_all(&repo);
    }
    Err(if last_err.is_empty() {
        "克隆 CosyVoice 仓库失败".into()
    } else {
        last_err
    })
}

pub fn pip_install_requirements(
    install_root: &Path,
    repo: &Path,
    cancel: &AtomicBool,
    log_path: &Path,
) -> Result<(), String> {
    let py = python_exe(install_root);
    let py_s = py.to_string_lossy().to_string();
    let req = repo.join("requirements.txt");
    if !req.is_file() {
        return Err("仓库缺少 requirements.txt".into());
    }
    let index = pip_index();
    let host = pip_trusted_host(&index);
    run_cmd(
        &py_s,
        &[
            "-m",
            "pip",
            "install",
            "-U",
            "pip",
            "setuptools",
            "wheel",
            "-i",
            &index,
            "--trusted-host",
            &host,
        ],
        Some(repo),
        cancel,
        log_path,
    )?;
    // Install requirements; platform markers skip linux-only packages on Windows.
    run_cmd(
        &py_s,
        &[
            "-m",
            "pip",
            "install",
            "-r",
            "requirements.txt",
            "-i",
            &index,
            "--trusted-host",
            &host,
        ],
        Some(repo),
        cancel,
        log_path,
    )?;
    run_cmd(
        &py_s,
        &[
            "-m",
            "pip",
            "install",
            "modelscope",
            "wetext",
            "-i",
            &index,
            "--trusted-host",
            &host,
        ],
        Some(repo),
        cancel,
        log_path,
    )?;
    Ok(())
}

pub fn download_default_model(
    install_root: &Path,
    model_source: &str,
    local_path: Option<&str>,
    cancel: &AtomicBool,
    log_path: &Path,
) -> Result<PathBuf, String> {
    let models = install_root.join("models").join("CosyVoice2-0.5B");
    if models.is_dir() && models.read_dir().map(|mut d| d.next().is_some()).unwrap_or(false) {
        append_log(log_path, "model dir already populated");
        return Ok(models);
    }
    std::fs::create_dir_all(install_root.join("models")).map_err(|e| e.to_string())?;
    match model_source {
        "local" => {
            let src = local_path.ok_or_else(|| "本机模型路径为空".to_string())?;
            let src_path = PathBuf::from(src);
            if !src_path.exists() {
                return Err("本机模型路径不存在".into());
            }
            // copy or junction — simple recursive copy via PowerShell is heavy; use xcopy/robocopy
            // robocopy: exit codes 0-7 are success
            let mut cmd = Command::new("robocopy");
            cmd.args([
                src_path.to_string_lossy().as_ref(),
                models.to_string_lossy().as_ref(),
                "/E",
                "/NFL",
                "/NDL",
                "/NJH",
                "/NJS",
            ]);
            apply_no_window(&mut cmd);
            let status = cmd.status().map_err(|e| e.to_string())?;
            let code = status.code().unwrap_or(16);
            if code > 7 {
                return Err(format!("复制本机模型失败 (robocopy {code})"));
            }
            Ok(models)
        }
        "huggingface" => {
            let py = python_exe(install_root);
            let hf_endpoint = std::env::var("XU_HF_MIRROR")
                .or_else(|_| std::env::var("HF_ENDPOINT"))
                .unwrap_or_else(|_| "https://hf-mirror.com".into());
            let script = format!(
                "import os; os.environ.setdefault('HF_ENDPOINT','{hf_endpoint}'); \
                 from huggingface_hub import snapshot_download; \
                 snapshot_download(repo_id='FunAudioLLM/CosyVoice2-0.5B', local_dir=r'{}')",
                models.to_string_lossy()
            );
            append_log(log_path, &format!("hf download endpoint={hf_endpoint}"));
            run_cmd(
                &py.to_string_lossy(),
                &["-c", &script],
                None,
                cancel,
                log_path,
            )
            .map_err(|e| format!("HuggingFace 下载失败（可设 XU_HF_MIRROR）: {e}"))?;
            Ok(models)
        }
        _ => {
            // modelscope default；失败提示换 HF 或本机路径
            let py = python_exe(install_root);
            let script = format!(
                "from modelscope import snapshot_download; snapshot_download('{MODEL_SCOPE_ID}', local_dir=r'{}')",
                models.to_string_lossy()
            );
            run_cmd(
                &py.to_string_lossy(),
                &["-c", &script],
                None,
                cancel,
                log_path,
            )
            .map_err(|e| {
                format!(
                    "ModelScope 下载失败（可改「本机模型路径」或 HuggingFace+XU_HF_MIRROR）: {e}"
                )
            })?;
            Ok(models)
        }
    }
}

pub fn smoke_verify(
    install_root: &Path,
    cancel: &AtomicBool,
    log_path: &Path,
) -> Result<(), String> {
    let py = python_exe(install_root);
    let script = "import sys; print('cosyvoice-env-ok', sys.version)";
    run_cmd(&py.to_string_lossy(), &["-c", script], None, cancel, log_path)?;
    let models = install_root.join("models").join("CosyVoice2-0.5B");
    if !models.is_dir() {
        return Err("模型目录不存在，冒烟失败".into());
    }
    Ok(())
}
