//! Ripgrep resolution + gitignore-aware fallbacks (ignore crate).

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use ignore::overrides::OverrideBuilder;
use ignore::WalkBuilder;

/// Resolve bundled `rg` next to the app, else rely on PATH (`rg` / `rg.exe`).
pub fn resolve_rg_program() -> PathBuf {
    if let Ok(p) = std::env::var("XU_RG_PATH") {
        let pb = PathBuf::from(&p);
        if pb.is_file() {
            return pb;
        }
    }
    if let Some(manifest) = option_env!("CARGO_MANIFEST_DIR") {
        let dev = PathBuf::from(manifest).join("bin").join("rg.exe");
        if dev.is_file() {
            return dev;
        }
        #[cfg(not(windows))]
        {
            let dev = PathBuf::from(manifest).join("bin").join("rg");
            if dev.is_file() {
                return dev;
            }
        }
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            for rel in [
                "rg.exe",
                "bin/rg.exe",
                "resources/bin/rg.exe",
                "rg",
                "bin/rg",
                "resources/bin/rg",
            ] {
                let p = dir.join(rel);
                if p.is_file() {
                    return p;
                }
            }
        }
    }
    #[cfg(windows)]
    {
        PathBuf::from("rg.exe")
    }
    #[cfg(not(windows))]
    {
        PathBuf::from("rg")
    }
}

pub fn glob_files(root: &Path, pattern: &str, cap: usize) -> Option<Vec<String>> {
    if let Some(hits) = glob_via_rg(root, pattern, cap) {
        if !hits.is_empty() || rg_available() {
            return Some(hits);
        }
    }
    Some(glob_via_ignore(root, pattern, cap))
}

fn rg_available() -> bool {
    let rg = resolve_rg_program();
    Command::new(&rg)
        .arg("--version")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

fn glob_via_rg(root: &Path, pattern: &str, cap: usize) -> Option<Vec<String>> {
    let rg = resolve_rg_program();
    let mut cmd = Command::new(&rg);
    cmd.arg("--files")
        .arg("--color=never")
        .arg("--hidden")
        .arg("-g")
        .arg(pattern)
        .arg(root);
    let out = cmd.output().ok()?;
    if !out.status.success() && out.status.code() != Some(1) {
        return None;
    }
    let root_s = root.to_string_lossy().replace('\\', "/");
    let mut hits = Vec::new();
    for line in String::from_utf8_lossy(&out.stdout).lines() {
        if hits.len() >= cap {
            hits.push("…(已截断)".into());
            break;
        }
        let p = line.trim().replace('\\', "/");
        if p.is_empty() {
            continue;
        }
        let rel = if p.starts_with(&root_s) {
            p.strip_prefix(&root_s)
                .unwrap_or(&p)
                .trim_start_matches('/')
                .to_string()
        } else {
            p
        };
        hits.push(rel);
    }
    Some(hits)
}

fn glob_via_ignore(root: &Path, pattern: &str, cap: usize) -> Vec<String> {
    let mut hits = Vec::new();
    let mut ob = OverrideBuilder::new(root);
    let glob_pat = if pattern.contains('/') {
        pattern.to_string()
    } else {
        format!("**/{pattern}")
    };
    if ob.add(&glob_pat).is_err() {
        return hits;
    }
    let overrides = match ob.build() {
        Ok(o) => o,
        Err(_) => return hits,
    };
    let walker = WalkBuilder::new(root)
        .hidden(false)
        .git_ignore(true)
        .git_global(true)
        .git_exclude(true)
        .ignore(true)
        .overrides(overrides)
        .build();
    for ent in walker.flatten() {
        if hits.len() >= cap {
            hits.push("…(已截断)".into());
            break;
        }
        let path = ent.path();
        if path.is_file() {
            let rel = path
                .strip_prefix(root)
                .unwrap_or(path)
                .to_string_lossy()
                .replace('\\', "/");
            hits.push(rel);
        }
    }
    hits
}

pub struct RgGrepOpts<'a> {
    pub query: &'a str,
    pub root: &'a Path,
    pub workspace: &'a Path,
    pub glob: Option<&'a str>,
    pub fixed_strings: bool,
    pub max_hits: usize,
}

pub fn grep_search(opts: &RgGrepOpts<'_>) -> Option<String> {
    if let Some(out) = grep_via_rg(opts) {
        return Some(out);
    }
    Some(grep_via_ignore(opts))
}

fn grep_via_rg(opts: &RgGrepOpts<'_>) -> Option<String> {
    let rg = resolve_rg_program();
    let mut cmd = Command::new(&rg);
    cmd.arg("--line-number")
        .arg("--no-heading")
        .arg("--color=never")
        .arg("--max-count")
        .arg(opts.max_hits.to_string());
    if opts.fixed_strings {
        cmd.arg("--fixed-strings");
    }
    if let Some(g) = opts.glob {
        cmd.arg("-g").arg(g);
    }
    cmd.arg(opts.query).arg(opts.root);
    let out = cmd.output().ok()?;
    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        if stderr.contains("regex parse error") {
            return Some(format!(
                "正则无效: {}",
                stderr.chars().take(200).collect::<String>()
            ));
        }
        if out.status.code() == Some(1) {
            return Some(format!("无命中：{}", opts.query));
        }
        return None;
    }
    format_grep_lines(&out.stdout, opts.workspace, opts.max_hits)
}

fn grep_via_ignore(opts: &RgGrepOpts<'_>) -> String {
    use regex::Regex;

    let re = if opts.fixed_strings {
        Regex::new(&regex::escape(opts.query)).ok()
    } else {
        Regex::new(opts.query).ok()
    };
    let Some(re) = re else {
        return format!("正则无效: {}", opts.query);
    };

    let mut ob = OverrideBuilder::new(opts.root);
    if let Some(g) = opts.glob {
        let glob_pat = if g.contains('/') {
            g.to_string()
        } else {
            format!("**/{g}")
        };
        let _ = ob.add(&glob_pat);
    }
    let overrides = ob.build().ok();

    let mut walker = WalkBuilder::new(opts.root);
    walker
        .hidden(false)
        .git_ignore(true)
        .git_global(true)
        .git_exclude(true)
        .ignore(true);
    if let Some(o) = overrides {
        walker.overrides(o);
    }

    let mut hits = Vec::new();
    for ent in walker.build().flatten() {
        if hits.len() >= opts.max_hits {
            hits.push("…(已截断)".into());
            break;
        }
        let path = ent.path();
        if !path.is_file() {
            continue;
        }
        if let Ok(meta) = std::fs::metadata(path) {
            if meta.len() > 400_000 {
                continue;
            }
        }
        let Ok(text) = std::fs::read_to_string(path) else {
            continue;
        };
        let rel = path
            .strip_prefix(opts.workspace)
            .unwrap_or(path)
            .to_string_lossy()
            .replace('\\', "/");
        for (i, line) in text.lines().enumerate() {
            if hits.len() >= opts.max_hits {
                hits.push("…(已截断)".into());
                break;
            }
            if re.is_match(line) {
                let clipped: String = line.chars().take(160).collect();
                hits.push(format!("{rel}:{}:{clipped}", i + 1));
            }
        }
    }

    if hits.is_empty() {
        format!("无命中：{}", opts.query)
    } else {
        hits.join("\n")
    }
}

fn format_grep_lines(stdout: &[u8], workspace: &Path, max_hits: usize) -> Option<String> {
    let text = String::from_utf8_lossy(stdout).trim().to_string();
    if text.is_empty() {
        return Some("无命中".into());
    }
    let mut lines = Vec::new();
    for line in text.lines().take(max_hits) {
        let normalized = line.replace('\\', "/");
        if let Some((path_part, rest)) = normalized.split_once(':') {
            if let Ok(abs) = PathBuf::from(path_part).canonicalize() {
                let rel = abs
                    .strip_prefix(workspace)
                    .unwrap_or(&abs)
                    .to_string_lossy()
                    .replace('\\', "/");
                lines.push(format!("{rel}:{rest}"));
                continue;
            }
        }
        lines.push(normalized);
    }
    Some(lines.join("\n"))
}
