//! CosyVoice FastAPI 本机路径自动探测：Python / server.py / model / voices。
//!
//! @author qiuye <yjk150@qq.com>
//! @date 2026-09-01
//! @updated 2026-09-03
//! @updated 2026-09-03
//! @version 1.3.3
//! @category Config
//! @algo bounded-fs-walk-path-discovery

use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Mutex;

use once_cell::sync::Lazy;
use super::cosy_runner;

static DISCOVER_LOCK: Lazy<Mutex<()>> = Lazy::new(|| Mutex::new(()));

const MAX_WALK_DEPTH: u32 = 5;
const DEFAULT_BASE_URL: &str = "http://127.0.0.1:50000";
/// 协助安装默认目录名（discover 另认 CosyVoice2* / CosyVoice3*）。
const MODEL_DIR_NAME: &str = "CosyVoice2-0.5B";

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CosyDiscoverReport {
    pub ok: bool,
    pub python: Option<String>,
    pub server_script: Option<String>,
    pub model_dir: Option<String>,
    pub voices_root: Option<String>,
    /// 本地 Web 控制台 `tools/console/index.html`
    pub console_html: Option<String>,
    pub default_prompt_wav: Option<String>,
    pub default_prompt_text: Option<String>,
    /// model_dir 含 CosyVoice2/3 时为 true（无「中文女」等 SFT spk）
    pub cosy_voice2: bool,
    pub base_url: String,
    pub scan_root: String,
    pub missing: Vec<String>,
    pub notes: Vec<String>,
    /// 扫描到的全部 CosyVoice2/3 模型目录（供 UI 下拉）
    #[serde(default)]
    pub model_candidates: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DiscoveredCache {
    schema_version: u32,
    updated_at: String,
    scan_root: String,
    python: Option<String>,
    server_script: Option<String>,
    model_dir: Option<String>,
    voices_root: Option<String>,
    console_html: Option<String>,
    default_prompt_wav: Option<String>,
    default_prompt_text: Option<String>,
    cosy_voice2: bool,
    #[serde(default)]
    model_candidates: Vec<String>,
}

fn cosy_home() -> Result<PathBuf, String> {
    let p = crate::xu_paths::xu_home()?.join("cosyvoice");
    std::fs::create_dir_all(&p).map_err(|e| format!("无法创建 cosyvoice 目录: {e}"))?;
    Ok(p)
}

fn discovered_json_path() -> Result<PathBuf, String> {
    Ok(cosy_home()?.join("discovered.json"))
}

fn install_json_install_root() -> Option<String> {
    let path = cosy_home().ok()?.join("install.json");
    let text = std::fs::read_to_string(&path).ok()?;
    let v: serde_json::Value = serde_json::from_str(&text).ok()?;
    v.get("installRoot")
        .and_then(|x| x.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

fn apply_no_window(cmd: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
}

fn path_exists_file(p: &str) -> bool {
    !p.is_empty() && Path::new(p).is_file()
}

fn path_exists_dir(p: &str) -> bool {
    !p.is_empty() && Path::new(p).is_dir()
}

fn where_python_cosyvoice() -> Vec<PathBuf> {
    #[cfg(windows)]
    let mut cmd = {
        let mut c = Command::new("cmd");
        c.args(["/C", "where", "python"]);
        apply_no_window(&mut c);
        c
    };
    #[cfg(not(windows))]
    let mut cmd = {
        let mut c = Command::new("sh");
        c.args(["-c", "command -v python; command -v python3"]);
        c
    };
    cmd.stdout(Stdio::piped()).stderr(Stdio::null());
    let Ok(out) = cmd.output() else {
        return Vec::new();
    };
    if !out.status.success() {
        return Vec::new();
    }
    String::from_utf8_lossy(&out.stdout)
        .lines()
        .map(|l| l.trim())
        .filter(|l| !l.is_empty() && l.to_ascii_lowercase().contains("cosyvoice"))
        .map(PathBuf::from)
        .collect()
}

fn conda_python() -> Option<PathBuf> {
    #[cfg(windows)]
    let mut cmd = {
        let mut c = Command::new("cmd");
        c.args([
            "/C",
            "conda run -n cosyvoice python -c \"import sys; print(sys.executable)\"",
        ]);
        apply_no_window(&mut c);
        c
    };
    #[cfg(not(windows))]
    let mut cmd = {
        let mut c = Command::new("sh");
        c.args([
            "-c",
            "conda run -n cosyvoice python -c \"import sys; print(sys.executable)\"",
        ]);
        c
    };
    cmd.stdout(Stdio::piped()).stderr(Stdio::null());
    let Ok(out) = cmd.output() else {
        return None;
    };
    if !out.status.success() {
        return None;
    }
    let line = String::from_utf8_lossy(&out.stdout)
        .lines()
        .find(|l| !l.trim().is_empty())
        .map(|l| l.trim().to_string())?;
    let p = PathBuf::from(line);
    if p.is_file() {
        Some(p)
    } else {
        None
    }
}

fn fixed_python_candidates(root: &Path) -> Vec<PathBuf> {
    vec![
        cosy_runner::python_exe(root),
        root.join("env")
            .join("conda")
            .join("envs")
            .join("cosyvoice")
            .join("python.exe"),
        root.join("miniconda3")
            .join("envs")
            .join("cosyvoice")
            .join("python.exe"),
    ]
}

fn is_server_script(path: &Path) -> bool {
    path.file_name()
        .and_then(|s| s.to_str())
        .map(|s| s == "server.py")
        .unwrap_or(false)
        && path
            .parent()
            .and_then(|p| p.file_name())
            .and_then(|s| s.to_str())
            .map(|s| s == "fastapi")
            .unwrap_or(false)
}

fn model_dir_name_ok(name: &str) -> bool {
    let n = name.to_ascii_lowercase();
    n.starts_with("cosyvoice2")
        || n.starts_with("cosyvoice3")
        || n.starts_with("fun-cosyvoice")
        || n.contains("--cosyvoice2")
        || n.contains("--cosyvoice3")
        || n.contains("--fun-cosyvoice")
}

fn model_family_from_path(path: &Path) -> u8 {
    let joined = path
        .components()
        .map(|part| part.as_os_str().to_string_lossy())
        .collect::<Vec<_>>()
        .join("/")
        .to_ascii_lowercase();
    if joined.contains("cosyvoice3") || joined.contains("fun-cosyvoice3") {
        3
    } else if joined.contains("cosyvoice2") || joined.contains("fun-cosyvoice") {
        2
    } else {
        0
    }
}

fn model_dir_valid(dir: &Path) -> bool {
    if !dir.is_dir() {
        return false;
    }
    let leaf = dir
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("");
    let parent_name = dir
        .parent()
        .and_then(|p| p.file_name())
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();

    // Accept only packs under models/pretrained_models, or HF snapshot leaves.
    // Never treat nested junk (._temp / conf / asset / cosyvoice3 submodule) as a pack.
    let under_pack_root = parent_name == "pretrained_models" || parent_name == "models";
    let under_snapshot = parent_name == "snapshots"
        && dir.components().any(|c| {
            c.as_os_str()
                .to_str()
                .map(model_dir_name_ok)
                .unwrap_or(false)
        });
    if under_pack_root {
        if !model_dir_name_ok(leaf) {
            return false;
        }
    } else if !under_snapshot {
        return false;
    }

    for cfg in [
        "configuration.json",
        "cosyvoice.yaml",
        "cosyvoice3.yaml",
        "config.yaml",
    ] {
        if dir.join(cfg).is_file() {
            return true;
        }
    }
    false
}

fn model_dir_rank(path: &Path) -> u8 {
    match model_family_from_path(path) {
        3 => 0,
        2 => 1,
        _ => 2,
    }
}

fn same_path(a: &Path, b: &Path) -> bool {
    let ca = a.canonicalize().unwrap_or_else(|_| a.to_path_buf());
    let cb = b.canonicalize().unwrap_or_else(|_| b.to_path_buf());
    if cfg!(windows) {
        ca.to_string_lossy()
            .eq_ignore_ascii_case(&cb.to_string_lossy())
    } else {
        ca == cb
    }
}

fn prefer_model(mut report: CosyDiscoverReport, preferred: Option<&str>) -> CosyDiscoverReport {
    let Some(wanted) = preferred.map(str::trim).filter(|s| !s.is_empty()) else {
        return report;
    };
    let wanted_path = Path::new(wanted);
    if model_dir_valid(wanted_path)
        && report
            .model_candidates
            .iter()
            .any(|candidate| same_path(Path::new(candidate), wanted_path))
    {
        report.model_dir = Some(wanted.to_string());
        report.cosy_voice2 = model_family_from_path(wanted_path) >= 2;
    }
    report
}

/// 收集 root 下全部合法 CosyVoice2/3 模型目录（去重后按版本排序）。
fn collect_model_dirs(root: &Path) -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = Vec::new();
    let mut seen = HashSet::new();
    let mut push = |p: PathBuf| {
        if !model_dir_valid(&p) {
            return;
        }
        let key = p
            .canonicalize()
            .unwrap_or_else(|_| p.clone())
            .to_string_lossy()
            .to_ascii_lowercase();
        if seen.insert(key) {
            out.push(p);
        }
    };

    // Common layouts: models / pretrained_models (incl. nested CosyVoice/)
    let fixed_parents = [
        root.join("models"),
        root.join("pretrained_models"),
        root.join("CosyVoice").join("models"),
        root.join("CosyVoice").join("pretrained_models"),
        root.join("CosyVoice")
            .join("CosyVoice")
            .join("pretrained_models"),
    ];
    for parent in &fixed_parents {
        if parent.is_dir() {
            if let Ok(rd) = parent.read_dir() {
                for ent in rd.flatten() {
                    push(ent.path());
                }
            }
        }
    }
    push(root.join("models").join(MODEL_DIR_NAME));
    push(root.join("pretrained_models").join(MODEL_DIR_NAME));
    push(
        root.join("CosyVoice")
            .join("pretrained_models")
            .join(MODEL_DIR_NAME),
    );
    push(
        root.join("CosyVoice")
            .join("pretrained_models")
            .join("Fun-CosyVoice3-0.5B"),
    );
    push(
        root.join("CosyVoice")
            .join("CosyVoice")
            .join("pretrained_models")
            .join("Fun-CosyVoice3-0.5B"),
    );

    fn walk_models(dir: &Path, depth: u32, max: u32, push: &mut dyn FnMut(PathBuf)) {
        if depth > max {
            return;
        }
        let Ok(rd) = dir.read_dir() else {
            return;
        };
        for ent in rd.flatten() {
            let p = ent.path();
            if p.is_dir() {
                if model_dir_valid(&p) {
                    push(p.clone());
                    // Do not walk into a recognized model dir (avoids ._temp/conf/asset noise)
                } else {
                    walk_models(&p, depth + 1, max, push);
                }
            }
        }
    }
    walk_models(root, 0, MAX_WALK_DEPTH, &mut push);

    out.sort_by(|a, b| {
        model_dir_rank(a)
            .cmp(&model_dir_rank(b))
            .then_with(|| a.to_string_lossy().cmp(&b.to_string_lossy()))
    });
    out
}

fn voices_root_valid(dir: &Path) -> bool {
    if !dir.is_dir() {
        return false;
    }
    let Ok(rd) = dir.read_dir() else {
        return false;
    };
    for ent in rd.flatten() {
        let p = ent.path();
        if !p.is_dir() {
            continue;
        }
        let has_wav = ["sample.wav", "ref.wav", "prompt.wav"]
            .iter()
            .any(|n| p.join(n).is_file());
        if has_wav {
            return true;
        }
    }
    false
}

pub fn walk_find<F>(root: &Path, max_depth: u32, mut pred: F) -> Option<PathBuf>
where
    F: FnMut(&Path) -> bool,
{
    fn inner<F>(dir: &Path, depth: u32, max: u32, pred: &mut F) -> Option<PathBuf>
    where
        F: FnMut(&Path) -> bool,
    {
        if depth > max {
            return None;
        }
        if pred(dir) {
            return Some(dir.to_path_buf());
        }
        let Ok(rd) = dir.read_dir() else {
            return None;
        };
        for ent in rd.flatten() {
            let p = ent.path();
            if p.is_dir() {
                if let Some(hit) = inner(&p, depth + 1, max, pred) {
                    return Some(hit);
                }
            } else if pred(&p) {
                return Some(p);
            }
        }
        None
    }
    if !root.is_dir() {
        return None;
    }
    inner(root, 0, max_depth, &mut pred)
}

fn find_server_script(root: &Path) -> Option<PathBuf> {
    let fixed = [
        root.join("repo")
            .join("runtime")
            .join("python")
            .join("fastapi")
            .join("server.py"),
        root.join("CosyVoice")
            .join("runtime")
            .join("python")
            .join("fastapi")
            .join("server.py"),
        root.join("CosyVoice")
            .join("CosyVoice")
            .join("runtime")
            .join("python")
            .join("fastapi")
            .join("server.py"),
    ];
    for p in fixed {
        if p.is_file() {
            return Some(p);
        }
    }
    walk_find(root, MAX_WALK_DEPTH, is_server_script)
}

const DEFAULT_PROMPT_TEXT: &str = "希望你以后能够做的比我还好呦。";
const DEFAULT_PROMPT_TEXT_CV2: &str =
    "You are a helpful assistant.<|endofprompt|>希望你以后能够做的比我还好呦。";

pub fn is_cosyvoice2_model(model_dir: Option<&str>) -> bool {
    model_dir
        .map(|s| model_family_from_path(Path::new(s)) >= 2)
        .unwrap_or(false)
}

pub fn default_prompt_text_cv2() -> &'static str {
    DEFAULT_PROMPT_TEXT_CV2
}

pub fn default_prompt_text_v1() -> &'static str {
    DEFAULT_PROMPT_TEXT
}

fn find_default_prompt_wav(root: &Path) -> Option<PathBuf> {
    let fixed = [
        root.join("asset").join("zero_shot_prompt.wav"),
        root.join("CosyVoice").join("asset").join("zero_shot_prompt.wav"),
    ];
    for p in fixed {
        if p.is_file() {
            return Some(p);
        }
    }
    if let Some(srv) = find_server_script(root) {
        if let Some(repo) = srv
            .parent()
            .and_then(|p| p.parent())
            .and_then(|p| p.parent())
            .and_then(|p| p.parent())
        {
            let p = repo.join("asset").join("zero_shot_prompt.wav");
            if p.is_file() {
                return Some(p);
            }
        }
    }
    walk_find(root, MAX_WALK_DEPTH, |p| {
        p.is_file()
            && p.file_name()
                .and_then(|s| s.to_str())
                .map(|s| s == "zero_shot_prompt.wav")
                .unwrap_or(false)
    })
}

pub fn find_manager_script(root: &Path) -> Option<PathBuf> {
    let fixed = root.join("tools").join("console").join("manager.py");
    if fixed.is_file() {
        return Some(fixed);
    }
    walk_find(root, MAX_WALK_DEPTH, |p| {
        p.is_file()
            && p.file_name()
                .and_then(|s| s.to_str())
                .map(|s| s == "manager.py")
                .unwrap_or(false)
            && p.parent()
                .and_then(|d| d.file_name())
                .and_then(|s| s.to_str())
                == Some("console")
    })
}

fn default_prompt_text_for(cv2: bool) -> String {
    if cv2 {
        DEFAULT_PROMPT_TEXT_CV2.into()
    } else {
        DEFAULT_PROMPT_TEXT.into()
    }
}

fn is_console_index(path: &Path) -> bool {
    path.is_file()
        && path.file_name().and_then(|s| s.to_str()) == Some("index.html")
        && path
            .parent()
            .and_then(|p| p.file_name())
            .and_then(|s| s.to_str())
            == Some("console")
}

/// 查找 CosyVoice Web 控制台静态页。
pub fn find_console_html(root: &Path) -> Option<PathBuf> {
    let fixed = [
        root.join("tools").join("console").join("index.html"),
        root.join("CosyVoice")
            .join("tools")
            .join("console")
            .join("index.html"),
        root.join("CosyVoice")
            .join("CosyVoice")
            .join("tools")
            .join("console")
            .join("index.html"),
    ];
    for p in fixed {
        if p.is_file() {
            return Some(p);
        }
    }
    walk_find(root, MAX_WALK_DEPTH, is_console_index)
}

fn find_voices_root(root: &Path) -> Option<PathBuf> {
    for rel in ["voices", "voice", "assets/voices"] {
        let p = root.join(rel);
        if voices_root_valid(&p) {
            return Some(p);
        }
    }
    if let Some(repo) = find_server_script(root) {
        if let Some(repo_root) = repo
            .parent()
            .and_then(|p| p.parent())
            .and_then(|p| p.parent())
            .and_then(|p| p.parent())
        {
            let p = repo_root.join("voices");
            if voices_root_valid(&p) {
                return Some(p);
            }
        }
    }
    walk_find(root, MAX_WALK_DEPTH, |p| p.is_dir() && voices_root_valid(p))
}

fn find_python(root: &Path, server: Option<&Path>, allow_slow: bool) -> Option<PathBuf> {
    for p in fixed_python_candidates(root) {
        if p.is_file() {
            return Some(p);
        }
    }
    if let Some(hit) = walk_find(root, MAX_WALK_DEPTH, |p| {
        p.is_file()
            && p.file_name().and_then(|s| s.to_str()) == Some("python.exe")
            && p.to_string_lossy().to_ascii_lowercase().contains("cosyvoice")
    }) {
        return Some(hit);
    }
    if allow_slow {
        for p in where_python_cosyvoice() {
            if p.is_file() {
                return Some(p);
            }
        }
        if let Some(py) = conda_python() {
            return Some(py);
        }
    }
    if let Some(srv) = server {
        if let Some(repo_root) = srv.parent().and_then(|p| p.parent()).and_then(|p| p.parent()) {
            for p in fixed_python_candidates(repo_root) {
                if p.is_file() {
                    return Some(p);
                }
            }
        }
    }
    None
}

/// 仅读 discovered.json 缓存，不做磁盘扫描（供控制台等快速路径）。
pub fn discover_from_cache() -> Option<CosyDiscoverReport> {
    read_discovered_cache()
        .ok()
        .and_then(|cache| validate_cached(&cache))
}

/// 本机 Cosy 环境是否已存在（不要求服务正在跑）。
/// 依赖: `{XU_HOME}/cosyvoice/install.json` 的 installRoot，或 `discovered.json` 可用缓存。
/// 失败: 无安装痕迹时返回 false（供 engine_status「已装」判定）。
pub fn cosy_env_present() -> bool {
    if let Some(root) = install_json_install_root() {
        if Path::new(&root).is_dir() {
            return true;
        }
    }
    discover_from_cache()
        .map(|r| r.ok && r.python.is_some() && r.server_script.is_some())
        .unwrap_or(false)
}

/// 在已知 scan_root 上快速找 Python（固定路径，不 conda / 不深扫）。
pub fn find_python_quick(root: &Path) -> Option<PathBuf> {
    find_python(root, None, false)
}

fn collect_scan_roots(
    optional_root: Option<&str>,
    hint_python: Option<&str>,
    hint_server: Option<&str>,
) -> Vec<PathBuf> {
    let mut roots: Vec<PathBuf> = Vec::new();
    let mut seen = HashSet::new();

    let mut push = |p: PathBuf| {
        if !p.is_dir() {
            return;
        }
        let key = p.to_string_lossy().to_ascii_lowercase();
        if seen.insert(key) {
            roots.push(p);
        }
    };

    if let Some(r) = optional_root.map(str::trim).filter(|s| !s.is_empty()) {
        push(PathBuf::from(r));
    }
    if let Ok(env) = std::env::var("XU_COSY_ROOT") {
        let t = env.trim();
        if !t.is_empty() {
            push(PathBuf::from(t));
        }
    }
    if let Some(r) = install_json_install_root() {
        push(PathBuf::from(r));
    }
    for hint in [hint_python, hint_server] {
        if let Some(h) = hint.map(str::trim).filter(|s| !s.is_empty()) {
            let pb = PathBuf::from(h);
            if pb.is_file() {
                if let Some(parent) = pb.parent() {
                    push(parent.to_path_buf());
                    if let Some(g) = parent.parent() {
                        push(g.to_path_buf());
                    }
                }
            } else if pb.is_dir() {
                push(pb);
            }
        }
    }
    if let Ok(cache) = read_discovered_cache() {
        if !cache.scan_root.is_empty() {
            push(PathBuf::from(&cache.scan_root));
        }
    }
    roots
}

fn read_discovered_cache() -> Result<DiscoveredCache, String> {
    let path = discovered_json_path()?;
    if !path.is_file() {
        return Err("无缓存".into());
    }
    let text = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&text).map_err(|e| format!("discovered.json 损坏: {e}"))
}

fn write_discovered_cache(report: &CosyDiscoverReport) -> Result<(), String> {
    let cache = DiscoveredCache {
        schema_version: 2,
        updated_at: chrono::Utc::now().to_rfc3339(),
        scan_root: report.scan_root.clone(),
        python: report.python.clone(),
        server_script: report.server_script.clone(),
        model_dir: report.model_dir.clone(),
        voices_root: report.voices_root.clone(),
        console_html: report.console_html.clone(),
        default_prompt_wav: report.default_prompt_wav.clone(),
        default_prompt_text: report.default_prompt_text.clone(),
        cosy_voice2: report.cosy_voice2,
        model_candidates: report.model_candidates.clone(),
    };
    std::fs::write(
        discovered_json_path()?,
        serde_json::to_vec_pretty(&cache).map_err(|e| e.to_string())?,
    )
    .map_err(|e| format!("写 discovered.json 失败: {e}"))
}

fn validate_cached(cache: &DiscoveredCache) -> Option<CosyDiscoverReport> {
    let python = cache.python.as_ref().filter(|p| path_exists_file(p))?;
    let server = cache
        .server_script
        .as_ref()
        .filter(|p| path_exists_file(p))?;
    let model_dir = cache.model_dir.clone().filter(|p| path_exists_dir(p));
    let voices_root = cache.voices_root.clone().filter(|p| path_exists_dir(p));
    let console_html = cache
        .console_html
        .clone()
        .filter(|p| path_exists_file(p));
    let cv2 = is_cosyvoice2_model(model_dir.as_deref());
    let default_prompt_wav = cache
        .default_prompt_wav
        .clone()
        .filter(|p| path_exists_file(p));
    let default_prompt_text = cache.default_prompt_text.clone();
    let missing = missing_fields(
        python,
        server,
        model_dir.as_deref(),
        voices_root.as_deref(),
    );
    let ok = missing.is_empty() || (!python.is_empty() && !server.is_empty());
    let model_candidates = {
        let scanned = if !cache.scan_root.is_empty() {
            collect_model_dirs(Path::new(&cache.scan_root))
                .into_iter()
                .map(|p| p.to_string_lossy().into_owned())
                .collect::<Vec<_>>()
        } else {
            Vec::new()
        };
        if !scanned.is_empty() {
            scanned
        } else {
            let mut from_cache: Vec<String> = cache
                .model_candidates
                .iter()
                .filter(|p| path_exists_dir(p))
                .cloned()
                .collect();
            if from_cache.is_empty() {
                if let Some(d) = model_dir.as_ref() {
                    from_cache.push(d.clone());
                }
            }
            from_cache
        }
    };
    Some(CosyDiscoverReport {
        ok,
        python: Some(python.clone()),
        server_script: Some(server.clone()),
        model_dir,
        voices_root,
        console_html: console_html.clone(),
        default_prompt_wav,
        default_prompt_text,
        cosy_voice2: cv2,
        base_url: DEFAULT_BASE_URL.into(),
        scan_root: cache.scan_root.clone(),
        missing,
        notes: build_notes(
            Some(python),
            Some(server),
            cache.model_dir.as_deref(),
            cache.voices_root.as_deref(),
            console_html.as_deref(),
            true,
        ),
        model_candidates,
    })
}

fn missing_fields(
    python: &str,
    server: &str,
    model: Option<&str>,
    voices: Option<&str>,
) -> Vec<String> {
    let mut m = Vec::new();
    if python.is_empty() {
        m.push("python".into());
    }
    if server.is_empty() {
        m.push("server_script".into());
    }
    if model.is_none() {
        m.push("model_dir".into());
    }
    if voices.is_none() {
        m.push("voices_root".into());
    }
    m
}

fn build_notes(
    python: Option<&str>,
    server: Option<&str>,
    model: Option<&str>,
    voices: Option<&str>,
    console: Option<&str>,
    from_cache: bool,
) -> Vec<String> {
    let mut notes = Vec::new();
    if from_cache {
        notes.push("已从本机缓存加载路径（文件存在性已校验）。".into());
    } else {
        notes.push("已完成本机路径扫描。".into());
    }
    if python.is_some() {
        notes.push("Python：已识别".into());
    }
    if server.is_some() {
        notes.push("FastAPI 服务脚本：已识别".into());
    }
    if model.is_some() {
        notes.push("模型目录：已识别".into());
    } else {
        notes.push("模型目录：未找到（启动时可尝试相对路径 CosyVoice2-0.5B）。".into());
    }
    if voices.is_some() {
        notes.push("音色库：已识别".into());
    } else {
        notes.push("音色库：未找到（仍可用内置 spk 试听）。".into());
    }
    if console.is_some() {
        notes.push("Web 控制台：已识别（可单独打开窗口）。".into());
    }
    notes
}

fn enrich_scan_report(mut report: CosyDiscoverReport, root: &Path) -> CosyDiscoverReport {
    let cv2 = is_cosyvoice2_model(report.model_dir.as_deref());
    report.cosy_voice2 = cv2;
    if let Some(wav) = find_default_prompt_wav(root) {
        report.default_prompt_wav = Some(wav.to_string_lossy().into_owned());
        report.default_prompt_text = Some(default_prompt_text_for(cv2));
    }
    if cv2 {
        report.notes.push(
            "CosyVoice2/3：无「中文女」SFT，试听将用 zero_shot / instruct2 + 默认参考音。".into(),
        );
    }
    if report.model_candidates.len() > 1 {
        report.notes.push(format!(
            "发现 {} 个模型目录，可在「运行版本」中切换。",
            report.model_candidates.len()
        ));
    }
    report
}

fn scan_root(root: &Path, allow_slow: bool) -> CosyDiscoverReport {
    let server = find_server_script(root);
    let python = find_python(root, server.as_deref(), allow_slow);
    let candidates = collect_model_dirs(root);
    let model_candidates: Vec<String> = candidates
        .iter()
        .map(|p| p.to_string_lossy().into_owned())
        .collect();
    let model_dir = candidates.into_iter().next();
    let voices_root = find_voices_root(root);
    let console_html = find_console_html(root);
    let cv2 = is_cosyvoice2_model(model_dir.as_deref().and_then(|p| p.to_str()));

    let missing = {
        let mut m = Vec::new();
        if python.is_none() {
            m.push("python".into());
        }
        if server.is_none() {
            m.push("server_script".into());
        }
        if model_dir.is_none() {
            m.push("model_dir".into());
        }
        if voices_root.is_none() {
            m.push("voices_root".into());
        }
        m
    };
    let ok = python.is_some() && server.is_some();
    enrich_scan_report(
        CosyDiscoverReport {
            ok,
            python: python
                .as_ref()
                .map(|p| p.to_string_lossy().into_owned()),
            server_script: server
                .as_ref()
                .map(|p| p.to_string_lossy().into_owned()),
            model_dir: model_dir
                .as_ref()
                .map(|p| p.to_string_lossy().into_owned()),
            voices_root: voices_root
                .as_ref()
                .map(|p| p.to_string_lossy().into_owned()),
            console_html: console_html
                .as_ref()
                .map(|p| p.to_string_lossy().into_owned()),
            default_prompt_wav: None,
            default_prompt_text: None,
            cosy_voice2: cv2,
            base_url: DEFAULT_BASE_URL.into(),
            scan_root: root.to_string_lossy().into_owned(),
            missing,
            notes: build_notes(
                python.as_deref().and_then(|p| p.to_str()),
                server.as_deref().and_then(|p| p.to_str()),
                model_dir.as_deref().and_then(|p| p.to_str()),
                voices_root.as_deref().and_then(|p| p.to_str()),
                console_html.as_deref().and_then(|p| p.to_str()),
                false,
            ),
            model_candidates,
        },
        root,
    )
}

/// 自动探测 CosyVoice FastAPI 所需路径；可选指定扫描根目录。
pub fn discover(
    optional_root: Option<&str>,
    hint_python: Option<&str>,
    hint_server: Option<&str>,
    preferred_model: Option<&str>,
    use_cache: bool,
) -> CosyDiscoverReport {
    let _guard = DISCOVER_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    if use_cache {
        if let Ok(cache) = read_discovered_cache() {
            if optional_root.is_none()
                || optional_root.map(str::trim).filter(|s| !s.is_empty()) == Some(cache.scan_root.as_str())
            {
                if let Some(report) = validate_cached(&cache) {
                    if report.ok || report.python.is_some() {
                        return prefer_model(report, preferred_model);
                    }
                }
            }
        }
    }

    let roots = collect_scan_roots(optional_root, hint_python, hint_server);
    let allow_slow = optional_root.is_some() || hint_python.is_some() || hint_server.is_some();
    let mut best: Option<CosyDiscoverReport> = None;
    for root in roots {
        let report = scan_root(&root, allow_slow);
        if report.ok {
            let report = prefer_model(report, preferred_model);
            let _ = write_discovered_cache(&report);
            return report;
        }
        let replace = best.as_ref().map(|b| score(b) < score(&report)).unwrap_or(true);
        if replace {
            best = Some(report);
        }
    }

    let mut report = best.unwrap_or_else(|| CosyDiscoverReport {
        base_url: DEFAULT_BASE_URL.into(),
        notes: vec!["未找到 CosyVoice 安装目录。可选「Cosy 根目录」后重试。".into()],
        ..Default::default()
    });
    if report.scan_root.is_empty() {
        report.scan_root = optional_root.unwrap_or("").to_string();
    }
    if report.python.is_some() || report.server_script.is_some() {
        let _ = write_discovered_cache(&report);
    }
    prefer_model(report, preferred_model)
}

fn score(r: &CosyDiscoverReport) -> u32 {
    let mut s = 0u32;
    if r.python.is_some() {
        s += 4;
    }
    if r.server_script.is_some() {
        s += 4;
    }
    if r.model_dir.is_some() {
        s += 2;
    }
    if r.voices_root.is_some() {
        s += 1;
    }
    s
}

#[cfg(test)]
mod tests {
    use super::{collect_model_dirs, is_cosyvoice2_model, model_dir_rank, model_family_from_path};
    use std::path::Path;

    #[test]
    fn prefers_cosyvoice3_over_cosyvoice2() {
        assert!(
            model_dir_rank(Path::new("Fun-CosyVoice3-0.5B"))
                < model_dir_rank(Path::new("CosyVoice2-0.5B"))
        );
    }

    #[test]
    fn recognizes_snapshot_parent_and_case_insensitively() {
        let snapshot = Path::new("models--iic--Fun-CosyVoice3-0.5B/snapshots/abcdef");
        assert_eq!(model_family_from_path(snapshot), 3);
        assert!(is_cosyvoice2_model(Some(
            "m:/voice/pretrained_models/cosyvoice2-0.5b"
        )));
    }

    #[test]
    fn collects_fun_and_cv2_under_m_voice_when_present() {
        let root = Path::new(r"M:\voice\CosyVoice");
        if !root.is_dir() {
            return;
        }
        let dirs = collect_model_dirs(root);
        let joined = dirs
            .iter()
            .map(|p| p.to_string_lossy().to_ascii_lowercase())
            .collect::<Vec<_>>()
            .join("|");
        assert!(
            joined.contains("fun-cosyvoice3"),
            "expected Fun-CosyVoice3 in {joined}"
        );
        assert!(
            joined.contains("cosyvoice2-0.5b"),
            "expected CosyVoice2 in {joined}"
        );
        assert!(
            !joined.contains("._temp")
                && !joined.contains("/conf")
                && !joined.contains("/asset")
                && !joined.contains("audio_tokenizer")
                && !joined.contains("blanken"),
            "must not list nested junk: {joined}"
        );
        assert_eq!(
            dirs.len(),
            2,
            "expected only CosyVoice2 + Fun-CosyVoice3, got {joined}"
        );
    }
}
