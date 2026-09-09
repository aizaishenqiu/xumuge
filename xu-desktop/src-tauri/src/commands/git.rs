//! 工作区 Git：状态/提交/推送与多仓发现。
//!
//! @file git.rs
//! @author qiuye <yjk150@qq.com>
//! @date 2026-08-31
//! @updated 2026-09-05
//! @version 1.1.0
//! @category ToolPolicy
//! @algo workspace-git-discover-and-push
//!
//! 职责：IDE 源代码管理面板的本机 Git 操作。依赖本机 `git` 与凭据。
//! 失败：非仓库、main 直推、Review 未通过时返回中文错误。

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use serde::Serialize;

pub(crate) fn configure_git_command(command: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    let _ = command;
}

fn assert_git_repo(workspace: &str) -> Result<(), String> {
    let root = Path::new(workspace);
    if !root.is_dir() {
        return Err(format!("Not a directory: {workspace}"));
    }
    let git_dir = root.join(".git");
    if !git_dir.exists() {
        return Err("当前工作区不是 Git 仓库".into());
    }
    Ok(())
}

pub(crate) fn run_git_raw(workspace: &str, args: &[&str]) -> Result<String, String> {
    let root = Path::new(workspace);
    if !root.is_dir() {
        return Err(format!("Not a directory: {workspace}"));
    }
    let mut command = Command::new("git");
    command.args(args).current_dir(workspace);
    configure_git_command(&mut command);
    let output = command
        .output()
        .map_err(|e| format!("无法执行 git: {e}"))?;
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if output.status.success() {
        Ok(if stdout.is_empty() && !stderr.is_empty() {
            stderr
        } else {
            stdout
        })
    } else {
        Err(if stderr.is_empty() {
            format!("git 失败 (exit {})", output.status)
        } else {
            stderr
        })
    }
}

pub(crate) fn run_git(workspace: &str, args: &[&str]) -> Result<String, String> {
    assert_git_repo(workspace)?;
    run_git_raw(workspace, args)
}

pub(crate) fn current_git_branch(workspace: &str) -> Option<String> {
    run_git(workspace, &["rev-parse", "--abbrev-ref", "HEAD"])
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

pub(crate) fn is_main_branch(name: &str) -> bool {
    matches!(name.trim().to_ascii_lowercase().as_str(), "main" | "master")
}

pub(crate) fn block_direct_main(workspace: &str) -> Result<(), String> {
    if let Some(b) = current_git_branch(workspace) {
        if is_main_branch(&b) && !b.to_ascii_lowercase().starts_with("hotfix/") {
            return Err(
                "main 禁止直接提交或推送，请在 feature/* 开发，Review 通过后合入 dev".into(),
            );
        }
    }
    Ok(())
}

fn review_status_from_json(v: &serde_json::Value) -> String {
    if let Some(arr) = v.get("reviews").and_then(|x| x.as_array()) {
        if !arr.is_empty() {
            let mut any_fail = false;
            let mut any_pending = false;
            for r in arr {
                let s = r
                    .get("status")
                    .and_then(|x| x.as_str())
                    .unwrap_or("pending");
                if s == "fail" {
                    any_fail = true;
                } else if s != "pass" {
                    any_pending = true;
                }
            }
            if any_fail {
                return "fail".into();
            }
            if any_pending {
                return "pending".into();
            }
            return "pass".into();
        }
    }
    v.get("status")
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .to_string()
}

fn code_review_requires_pass(workspace: &str) -> Result<(), String> {
    if let Some(reason) = code_review_blocks_merge(workspace) {
        return Err(reason);
    }
    let p = Path::new(workspace).join(".xu").join("code-review.json");
    let raw =
        std::fs::read_to_string(p).map_err(|_| "尚未代码 Review，禁止合入 main".to_string())?;
    let v: serde_json::Value =
        serde_json::from_str(&raw).map_err(|_| "code-review.json 无效".to_string())?;
    if review_status_from_json(&v) != "pass" {
        return Err("代码 Review 未全员通过，禁止合入 main".into());
    }
    Ok(())
}

fn code_review_blocks_merge(workspace: &str) -> Option<String> {
    let p = Path::new(workspace).join(".xu").join("code-review.json");
    let raw = std::fs::read_to_string(p).ok()?;
    let v: serde_json::Value = serde_json::from_str(&raw).ok()?;
    let status = review_status_from_json(&v);
    let summary = v
        .get("summary")
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .trim();
    match status.as_str() {
        "fail" => Some(format!(
            "代码 Review 未全员通过，禁止合并{}",
            if summary.is_empty() {
                String::new()
            } else {
                format!("：{summary}")
            }
        )),
        "pending" => Some("代码 Review 未全员通过，禁止合入 dev".into()),
        _ => None,
    }
}

/// Workspace git operations: status | diff | add | commit | push | pull | fetch | sync |
/// branches | remotes | log | log_file | checkout | init | remote_set | branch_ensure
#[tauri::command]
pub async fn git_workspace(
    workspace: String,
    action: String,
    path: Option<String>,
    message: Option<String>,
    max_count: Option<u32>,
    remote: Option<String>,
    branch: Option<String>,
) -> Result<String, String> {
    let ws = workspace.trim();
    if ws.is_empty() {
        return Err("工作区路径为空".into());
    }
    let max = max_count.unwrap_or(30).min(200);
    let remote = remote.filter(|s| !s.trim().is_empty());
    let branch = branch.filter(|s| !s.trim().is_empty());
    match action.as_str() {
        "init" => run_git_raw(ws, &["init", "-b", "main"]).or_else(|_| run_git_raw(ws, &["init"])),
        "remote_set" => {
            let name = remote.unwrap_or_else(|| "origin".into());
            let url = path
                .filter(|s| !s.trim().is_empty())
                .ok_or("remote_set 需要 path=远程 URL")?;
            let url = url.trim();
            match run_git(ws, &["remote", "get-url", name.trim()]) {
                Ok(_) => run_git(ws, &["remote", "set-url", name.trim(), url]),
                Err(_) => run_git(ws, &["remote", "add", name.trim(), url]),
            }
        }
        "branch_ensure" => {
            let b = branch.unwrap_or_else(|| "main".into());
            let b = b.trim();
            let _ = run_git(ws, &["checkout", "-B", b]);
            Ok(b.to_string())
        }
        "status" => run_git(ws, &["status", "--porcelain=v1", "-b"]),
        "diff" => {
            if let Some(p) = path.as_deref().filter(|s| !s.trim().is_empty()) {
                run_git(ws, &["diff", "--", p.trim()])
            } else {
                run_git(ws, &["diff"])
            }
        }
        "add" => {
            block_direct_main(ws)?;
            let p = path.filter(|s| !s.trim().is_empty()).ok_or("add 需要 path")?;
            run_git(ws, &["add", "--", p.trim()])
        }
        "add_all" => {
            block_direct_main(ws)?;
            run_git(ws, &["add", "-A"])
        }
        "commit" => {
            block_direct_main(ws)?;
            let msg = message.filter(|s| !s.trim().is_empty()).ok_or("commit 需要 message")?;
            run_git(ws, &["commit", "-m", msg.trim()])
        }
        "push" => {
            block_direct_main(ws)?;
            if branch.as_deref().is_some_and(is_main_branch) {
                return Err("禁止直接推送 main，请合入 dev 后再走发布合并".into());
            }
            match (remote.as_deref(), branch.as_deref()) {
            (Some(r), Some(b)) => run_git(ws, &["push", "-u", r, b]),
            (Some(r), None) => run_git(ws, &["push", r]),
            _ => run_git(ws, &["push"]),
            }
        }
        "release_merge" => {
            code_review_requires_pass(ws)?;
            let _ = run_git(ws, &["checkout", "main"]).or_else(|_| run_git(ws, &["checkout", "master"]));
            run_git(ws, &["merge", "--no-ff", "dev"])
        }
        "pull" | "merge" | "sync" => {
            if let Some(reason) = code_review_blocks_merge(ws) {
                return Err(reason);
            }
            match action.as_str() {
                "merge" => {
                    if current_git_branch(ws).as_deref().is_some_and(is_main_branch) {
                        return Err("禁止在 main 上随意合并；发布请用 release_merge（dev → main）".into());
                    }
                    let b = branch.ok_or("merge 需要 branch")?;
                    run_git(ws, &["merge", "--no-ff", b.trim()])
                }
                "pull" => match (remote.as_deref(), branch.as_deref()) {
                    (Some(r), Some(b)) => run_git(ws, &["pull", r, b]),
                    (Some(r), None) => run_git(ws, &["pull", r]),
                    (None, Some(b)) => run_git(ws, &["pull", "origin", b]),
                    _ => run_git(ws, &["pull"]),
                },
                _ => {
                    run_git(ws, &["fetch", "--all", "--prune"])?;
                    match (remote.as_deref(), branch.as_deref()) {
                        (Some(r), Some(b)) => run_git(ws, &["pull", r, b])?,
                        (Some(r), None) => run_git(ws, &["pull", r])?,
                        (None, Some(b)) => run_git(ws, &["pull", "origin", b])?,
                        _ => run_git(ws, &["pull"])?,
                    };
                    match (remote.as_deref(), branch.as_deref()) {
                        (Some(r), Some(b)) => run_git(ws, &["push", r, b]),
                        (Some(r), None) => run_git(ws, &["push", r]),
                        _ => run_git(ws, &["push"]),
                    }
                }
            }
        }
        "branches" => run_git(ws, &["branch", "-a"]),
        "remotes" => run_git(ws, &["remote", "-v"]),
        "checkout" => {
            let b = branch.ok_or("checkout 需要 branch")?;
            run_git(ws, &["checkout", b.trim()])
        }
        "log" => {
            let n = max.to_string();
            run_git(ws, &["log", "--oneline", "-n", &n])
        }
        "log_file" => {
            let p = path.filter(|s| !s.trim().is_empty()).ok_or("log_file 需要 path")?;
            let n = max.to_string();
            run_git(ws, &["log", "--follow", "--oneline", "-n", &n, "--", p.trim()])
        }
        "fetch" => run_git(ws, &["fetch", "--all", "--prune"]),
        other => Err(format!(
            "未知 git action: {other}（支持 status|diff|add|add_all|commit|push|pull|merge|release_merge|fetch|sync|branches|remotes|checkout|log|log_file|init|remote_set|branch_ensure）"
        )),
    }
}

#[derive(Serialize)]
pub struct GitRemoteInfo {
    name: String,
    url: String,
}

#[derive(Serialize)]
pub struct GitRepoInfo {
    path: String,
    name: String,
    branch: String,
    remotes: Vec<GitRemoteInfo>,
}

fn skip_scan_dir(name: &str) -> bool {
    matches!(
        name,
        "node_modules"
            | "dist"
            | "target"
            | ".git"
            | "vendor"
            | "build"
            | ".next"
            | ".xu"
            | "out"
    )
}

fn parse_fetch_remotes(raw: &str) -> Vec<GitRemoteInfo> {
    let mut map = BTreeMap::<String, String>::new();
    for line in raw.lines() {
        let t = line.trim();
        if !t.ends_with("(fetch)") {
            continue;
        }
        let body = t.trim_end_matches("(fetch)").trim();
        let mut parts = body.split_whitespace();
        let Some(name) = parts.next() else { continue };
        let Some(url) = parts.next() else { continue };
        map.insert(name.to_string(), url.to_string());
    }
    map.into_iter()
        .map(|(name, url)| GitRemoteInfo { name, url })
        .collect()
}

fn describe_repo(path: &Path) -> Option<GitRepoInfo> {
    let path_s = path.to_string_lossy().to_string();
    if !path.join(".git").exists() {
        return None;
    }
    let name = path
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| path_s.clone());
    let branch = current_git_branch(&path_s).unwrap_or_default();
    let remotes = run_git(&path_s, &["remote", "-v"])
        .ok()
        .map(|raw| parse_fetch_remotes(&raw))
        .unwrap_or_default();
    Some(GitRepoInfo {
        path: path_s,
        name,
        branch,
        remotes,
    })
}

fn scan_git_dirs(root: &Path, depth: u32, max_depth: u32, out: &mut Vec<PathBuf>) {
    if root.join(".git").exists() {
        out.push(root.to_path_buf());
    }
    if depth >= max_depth {
        return;
    }
    let Ok(rd) = fs::read_dir(root) else {
        return;
    };
    for entry in rd.flatten() {
        let p = entry.path();
        if !p.is_dir() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if skip_scan_dir(&name) {
            continue;
        }
        scan_git_dirs(&p, depth + 1, max_depth, out);
    }
}

/// 扫描工作区及其浅层子目录中的 Git 仓（含上级 toplevel）。
/// 依赖本机 git；失败返回空列表或中文错误（路径为空、不是文件夹）。
/// 成功：每项含 path、文件夹名、当前分支、fetch 远程名与地址。
#[tauri::command]
pub async fn git_discover_repos(root: String) -> Result<Vec<GitRepoInfo>, String> {
    let root = root.trim();
    if root.is_empty() {
        return Err("工作区路径为空".into());
    }
    let root_path = PathBuf::from(root);
    if !root_path.is_dir() {
        return Err("不是文件夹".into());
    }

    let mut dirs: Vec<PathBuf> = Vec::new();
    if let Ok(top) = run_git_raw(root, &["rev-parse", "--show-toplevel"]) {
        let top = PathBuf::from(top.trim());
        if top.join(".git").exists() {
            dirs.push(top);
        }
    }
    scan_git_dirs(&root_path, 0, 3, &mut dirs);

    let mut seen = BTreeMap::<String, PathBuf>::new();
    for d in dirs {
        let key = d.to_string_lossy().replace('\\', "/").to_lowercase();
        seen.entry(key).or_insert(d);
    }

    let mut repos: Vec<GitRepoInfo> = seen
        .into_values()
        .filter_map(|p| describe_repo(&p))
        .collect();
    repos.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(repos)
}

#[derive(Serialize)]
pub struct GitResolvedPath {
    pub path: String,
    pub name: String,
    pub branch: String,
    pub remotes: Vec<GitRemoteInfo>,
    pub relative: String,
    pub kind: String,
}

fn path_relative_to_repo(repo: &Path, target: &Path) -> String {
    let repo_abs = repo.canonicalize().unwrap_or_else(|_| repo.to_path_buf());
    let target_abs = target.canonicalize().unwrap_or_else(|_| target.to_path_buf());
    target_abs
        .strip_prefix(&repo_abs)
        .map(|p| p.to_string_lossy().replace('\\', "/"))
        .unwrap_or_default()
}

/// 把用户点选的文件夹或文件解析成所属 Git 仓 + 相对路径。
/// 依赖本机 git；失败：路径不存在、不是仓库。
#[tauri::command]
pub async fn git_resolve_path(path: String) -> Result<GitResolvedPath, String> {
    let raw = path.trim();
    if raw.is_empty() {
        return Err("路径为空".into());
    }
    let target = PathBuf::from(raw);
    if !target.exists() {
        return Err("路径不存在".into());
    }
    let is_file = target.is_file();
    let start = if is_file {
        target
            .parent()
            .filter(|p| p.as_os_str().len() > 0)
            .map(Path::to_path_buf)
            .ok_or_else(|| "无法解析文件所在目录".to_string())?
    } else {
        target.clone()
    };
    let start_s = start.to_string_lossy();
    let top = run_git_raw(start_s.as_ref(), &["rev-parse", "--show-toplevel"])?;
    let top = PathBuf::from(top.trim());
    let repo = describe_repo(&top).ok_or_else(|| "所选位置不是 Git 仓库".to_string())?;
    let relative = path_relative_to_repo(&top, &target);
    Ok(GitResolvedPath {
        path: repo.path,
        name: repo.name,
        branch: repo.branch,
        remotes: repo.remotes,
        relative,
        kind: if is_file { "file".into() } else { "dir".into() },
    })
}
