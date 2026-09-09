//! CosyVoice 协助安装：探测、披露、依赖先行、状态机（MCP/向导共用）。
//!
//! @author qiuye <yjk150@qq.com>
//! @date 2026-08-31
//! @updated 2026-09-03
//! @version 1.0.1
//! @category Config
//! @algo cosyvoice-install-phases

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use once_cell::sync::Lazy;

use super::cosy_runner;

const MIN_VRAM_MB: u64 = 8 * 1024;
const MIN_DISK_BYTES: u64 = 30 * 1024 * 1024 * 1024;
const EST_TOTAL_BYTES: u64 = 25 * 1024 * 1024 * 1024;

static CANCEL: AtomicBool = AtomicBool::new(false);
static STATUS: Lazy<Mutex<CosyStatus>> = Lazy::new(|| Mutex::new(CosyStatus::default()));
static INSTALL_META: Lazy<Mutex<InstallMeta>> = Lazy::new(|| Mutex::new(InstallMeta::default()));

const INSTALL_STAGES: &[&str] = &[
    "deps",
    "clone_repo",
    "pip_requirements",
    "download_model",
    "smoke_verify",
];

#[derive(Debug, Clone, Default)]
struct InstallMeta {
    completed_stages: Vec<String>,
    failed_stage: Option<String>,
    failed_reason: Option<String>,
    mirror_last_used: Option<String>,
    plan_snapshot: Option<CosyInstallPlan>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CosyLaunchHints {
    pub python: Option<String>,
    pub server_script: Option<String>,
    pub model_dir: Option<String>,
    pub base_url: String,
    pub install_root: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CosyInstallRead {
    pub install_json: serde_json::Value,
    pub log_tail: Vec<String>,
    pub failed_stage: Option<String>,
    pub failed_reason: Option<String>,
    pub completed_stages: Vec<String>,
    pub can_resume: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DiskDriveInfo {
    pub path: String,
    pub free_bytes: u64,
    pub total_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DepItem {
    pub id: String,
    pub label: String,
    pub present: bool,
    pub auto_install: bool,
    pub needs_elevation: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CosyProbeReport {
    pub has_nvidia: bool,
    pub vram_mb: Option<u64>,
    pub drives: Vec<DiskDriveInfo>,
    pub recommended_install_root: String,
    pub has_conda: bool,
    pub has_python310: bool,
    pub has_git: bool,
    pub has_msvc: Option<bool>,
    pub model_scope_reachable: Option<bool>,
    pub hf_reachable: Option<bool>,
    pub meets_minimum: bool,
    pub blockers: Vec<String>,
    pub warnings: Vec<String>,
    pub missing_deps: Vec<DepItem>,
    pub present_deps: Vec<DepItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiskBreakdown {
    pub miniconda_bytes: u64,
    pub env_packages_bytes: u64,
    pub repo_bytes: u64,
    pub model_bytes: u64,
    pub temp_buffer_bytes: u64,
    pub total_suggested_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimeEstimate {
    pub deps_minutes: String,
    pub env_minutes: String,
    pub model_minutes: String,
    pub total_minutes: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CosyDisclosure {
    pub will_install: Vec<String>,
    pub will_skip: Vec<String>,
    pub already_present: Vec<String>,
    pub disk: DiskBreakdown,
    pub time: TimeEstimate,
    pub notes: Vec<String>,
    pub default_model: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CosyInstallPlan {
    pub install_root: String,
    pub model_source: String,
    pub local_model_path: Option<String>,
    pub mode_ids: Vec<String>,
    pub ok: bool,
    pub errors: Vec<String>,
    pub disclosure: CosyDisclosure,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CosyStatus {
    pub phase: String,
    pub percent: u32,
    pub message: String,
    pub last_error: String,
    pub install_root: String,
    pub deps: Vec<DepProgress>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DepProgress {
    pub id: String,
    pub label: String,
    pub state: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CosyMode {
    pub id: String,
    pub label: String,
    pub builtin: bool,
    pub instruct: String,
    #[serde(default)]
    pub emotion: Option<String>,
    #[serde(default = "default_rate")]
    pub rate: f32,
    #[serde(default = "default_pitch")]
    pub pitch: f32,
}

fn default_rate() -> f32 {
    1.0
}
fn default_pitch() -> f32 {
    1.0
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ModesFile {
    schema_version: u32,
    modes: Vec<CosyMode>,
}

fn cosy_home() -> Result<PathBuf, String> {
    let p = crate::xu_paths::xu_home()?.join("cosyvoice");
    std::fs::create_dir_all(&p).map_err(|e| format!("无法创建 cosyvoice 目录: {e}"))?;
    Ok(p)
}

fn install_json_path() -> Result<PathBuf, String> {
    Ok(cosy_home()?.join("install.json"))
}

fn install_log_path() -> Result<PathBuf, String> {
    Ok(cosy_home()?.join("install.log"))
}

fn read_log_tail(log_path: &Path, max_lines: usize) -> Vec<String> {
    let Ok(text) = std::fs::read_to_string(log_path) else {
        return Vec::new();
    };
    let lines: Vec<&str> = text.lines().collect();
    if lines.len() <= max_lines {
        return lines.into_iter().map(str::to_string).collect();
    }
    lines[lines.len() - max_lines..]
        .iter()
        .map(|s| (*s).to_string())
        .collect()
}

fn read_install_json_value() -> serde_json::Value {
    let Ok(path) = install_json_path() else {
        return serde_json::json!({});
    };
    if !path.is_file() {
        return serde_json::json!({});
    }
    std::fs::read_to_string(&path)
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_else(|| serde_json::json!({}))
}

fn hydrate_from_disk() {
    let v = read_install_json_value();
    if v.is_null() || !v.is_object() {
        return;
    }
    if let Ok(mut s) = STATUS.lock() {
        if let Some(p) = v.get("phase").and_then(|x| x.as_str()) {
            if !p.is_empty() {
                s.phase = p.into();
            }
        }
        if let Some(n) = v.get("percent").and_then(|x| x.as_u64()) {
            s.percent = n as u32;
        }
        if let Some(m) = v.get("message").and_then(|x| x.as_str()) {
            s.message = m.into();
        }
        if let Some(e) = v.get("lastError").and_then(|x| x.as_str()) {
            s.last_error = e.into();
        }
        if let Some(r) = v.get("installRoot").and_then(|x| x.as_str()) {
            s.install_root = r.into();
        }
    }
    if let Ok(mut meta) = INSTALL_META.lock() {
        meta.completed_stages = v
            .get("completedStages")
            .and_then(|x| x.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|x| x.as_str().map(str::to_string))
                    .collect()
            })
            .unwrap_or_default();
        meta.failed_stage = v
            .get("failedStage")
            .and_then(|x| x.as_str())
            .map(str::to_string);
        meta.failed_reason = v
            .get("failedReason")
            .and_then(|x| x.as_str())
            .map(str::to_string);
        meta.mirror_last_used = v
            .get("mirrorLastUsed")
            .and_then(|x| x.as_str())
            .map(str::to_string);
        if let Some(plan) = v.get("planSnapshot") {
            meta.plan_snapshot = serde_json::from_value(plan.clone()).ok();
        }
    }
}

fn stage_completed(stage: &str) -> bool {
    INSTALL_META
        .lock()
        .map(|m| m.completed_stages.iter().any(|s| s == stage))
        .unwrap_or(false)
}

fn mark_stage_done(stage: &str) {
    if let Ok(mut meta) = INSTALL_META.lock() {
        if !meta.completed_stages.iter().any(|s| s == stage) {
            meta.completed_stages.push(stage.into());
        }
        meta.failed_stage = None;
        meta.failed_reason = None;
    }
    let _ = persist_status();
}

fn mark_stage_failed(stage: &str, reason: &str) {
    if let Ok(mut meta) = INSTALL_META.lock() {
        meta.failed_stage = Some(stage.into());
        meta.failed_reason = Some(reason.into());
    }
    set_status("failed", 0, &format!("阶段 {stage} 失败"), reason);
}

fn set_mirror_last(label: &str) {
    if let Ok(mut meta) = INSTALL_META.lock() {
        meta.mirror_last_used = Some(label.into());
    }
}

fn modes_json_path() -> Result<PathBuf, String> {
    Ok(cosy_home()?.join("modes.json"))
}

/// 探测本机门槛与依赖齐全度（只读）。
pub fn probe_host() -> Result<CosyProbeReport, String> {
    let drives = list_drives();
    let recommended = recommend_root(&drives);
    let has_git = command_exists("git");
    let has_conda = command_exists("conda") || command_exists("micromamba");
    let has_python310 = false; // 精确版本需 conda env；此处仅作提示
    let has_msvc = detect_msvc();
    let (has_nvidia, vram_mb) = detect_nvidia();
    let mut blockers = Vec::new();
    let mut warnings = Vec::new();
    if !drives.iter().any(|d| d.free_bytes >= MIN_DISK_BYTES) {
        blockers.push("没有任何盘剩余空间 ≥ 30GB，无法安装 CosyVoice。".into());
    }
    if !has_nvidia {
        warnings.push("未检测到 NVIDIA GPU；可继续但合成可能极慢或失败。".into());
    } else if vram_mb.map(|v| v < MIN_VRAM_MB).unwrap_or(true) {
        warnings.push("显存可能不足 8GB；建议换卡或改用离线 Kokoro 语音。".into());
    }
    if has_msvc == Some(false) {
        warnings.push("未检测到 VS Build Tools / MSVC；安装依赖阶段可能需要提权安装。".into());
    }
    let mut missing = Vec::new();
    let mut present = Vec::new();
    push_dep(
        &mut missing,
        &mut present,
        "git",
        "Git",
        has_git,
        true,
        false,
    );
    push_dep(
        &mut missing,
        &mut present,
        "conda",
        "Miniconda / conda",
        has_conda,
        true,
        false,
    );
    push_dep(
        &mut missing,
        &mut present,
        "python310",
        "Python 3.10（conda 环境）",
        has_python310,
        true,
        false,
    );
    push_dep(
        &mut missing,
        &mut present,
        "msvc",
        "VS Build Tools / MSVC",
        has_msvc.unwrap_or(false),
        true,
        true,
    );
    push_dep(
        &mut missing,
        &mut present,
        "pynini",
        "pynini（conda-forge，wetext 依赖）",
        false,
        true,
        false,
    );

    let meets = blockers.is_empty();
    Ok(CosyProbeReport {
        has_nvidia,
        vram_mb,
        drives,
        recommended_install_root: recommended,
        has_conda,
        has_python310,
        has_git,
        has_msvc,
        model_scope_reachable: None,
        hf_reachable: None,
        meets_minimum: meets,
        blockers,
        warnings,
        missing_deps: missing,
        present_deps: present,
    })
}

fn push_dep(
    missing: &mut Vec<DepItem>,
    present: &mut Vec<DepItem>,
    id: &str,
    label: &str,
    is_present: bool,
    auto_install: bool,
    needs_elevation: bool,
) {
    let item = DepItem {
        id: id.into(),
        label: label.into(),
        present: is_present,
        auto_install,
        needs_elevation,
    };
    if is_present {
        present.push(item);
    } else {
        missing.push(item);
    }
}

fn list_drives() -> Vec<DiskDriveInfo> {
    #[cfg(windows)]
    {
        let mut out = Vec::new();
        for letter in b'C'..=b'Z' {
            let root = format!("{}:\\", letter as char);
            let path = Path::new(&root);
            if !path.exists() {
                continue;
            }
            if let Ok((free, total)) = disk_space(path) {
                out.push(DiskDriveInfo {
                    path: root,
                    free_bytes: free,
                    total_bytes: total,
                });
            }
        }
        out
    }
    #[cfg(not(windows))]
    {
        let mut out = Vec::new();
        if let Ok((free, total)) = disk_space(Path::new("/")) {
            out.push(DiskDriveInfo {
                path: "/".into(),
                free_bytes: free,
                total_bytes: total,
            });
        }
        out
    }
}

fn disk_space(path: &Path) -> Result<(u64, u64), String> {
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        use std::ffi::OsStr;
        #[link(name = "kernel32")]
        extern "system" {
            fn GetDiskFreeSpaceExW(
                lpDirectoryName: *const u16,
                lpFreeBytesAvailableToCaller: *mut u64,
                lpTotalNumberOfBytes: *mut u64,
                lpTotalNumberOfFreeBytes: *mut u64,
            ) -> i32;
        }
        let wide: Vec<u16> = OsStr::new(path)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();
        let mut free = 0u64;
        let mut total = 0u64;
        let mut total_free = 0u64;
        let ok = unsafe {
            GetDiskFreeSpaceExW(wide.as_ptr(), &mut free, &mut total, &mut total_free)
        };
        if ok == 0 {
            return Err("GetDiskFreeSpaceExW failed".into());
        }
        Ok((free, total))
    }
    #[cfg(not(windows))]
    {
        let _ = path;
        Err("disk_space unsupported".into())
    }
}

fn recommend_root(drives: &[DiskDriveInfo]) -> String {
    let mut best: Option<&DiskDriveInfo> = None;
    for d in drives {
        if d.free_bytes < MIN_DISK_BYTES {
            continue;
        }
        if best.map(|b| d.free_bytes > b.free_bytes).unwrap_or(true) {
            best = Some(d);
        }
    }
    if let Some(d) = best {
        let letter = d.path.chars().next().unwrap_or('C');
        return format!("{}:/xu-engines/cosyvoice", letter);
    }
    if let Some(d) = drives.first() {
        let letter = d.path.chars().next().unwrap_or('C');
        return format!("{}:/xu-engines/cosyvoice", letter);
    }
    "C:/xu-engines/cosyvoice".into()
}

fn command_exists(name: &str) -> bool {
    #[cfg(windows)]
    let mut cmd = {
        let mut c = std::process::Command::new("cmd");
        c.args(["/C", "where", name]);
        #[allow(unused_imports)]
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        c.creation_flags(CREATE_NO_WINDOW);
        c
    };
    #[cfg(not(windows))]
    let mut cmd = {
        let mut c = std::process::Command::new("sh");
        c.args(["-c", &format!("command -v {name}")]);
        c
    };
    cmd.stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

fn detect_msvc() -> Option<bool> {
    #[cfg(windows)]
    {
        let vswhere = Path::new(r"C:\Program Files (x86)\Microsoft Visual Studio\Installer\vswhere.exe");
        if vswhere.is_file() {
            return Some(true);
        }
        Some(command_exists("cl"))
    }
    #[cfg(not(windows))]
    {
        None
    }
}

fn detect_nvidia() -> (bool, Option<u64>) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        let output = std::process::Command::new("nvidia-smi")
            .args([
                "--query-gpu=memory.total",
                "--format=csv,noheader,nounits",
            ])
            .creation_flags(CREATE_NO_WINDOW)
            .output();
        if let Ok(out) = output {
            if out.status.success() {
                let text = String::from_utf8_lossy(&out.stdout);
                let mb = text
                    .lines()
                    .filter_map(|l| l.trim().parse::<u64>().ok())
                    .max();
                return (true, mb);
            }
        }
        (false, None)
    }
    #[cfg(not(windows))]
    {
        (false, None)
    }
}

fn default_disclosure(probe: &CosyProbeReport) -> CosyDisclosure {
    let mut will_install: Vec<String> = probe
        .missing_deps
        .iter()
        .map(|d| d.label.clone())
        .collect();
    will_install.push("Python 环境包（PyTorch CUDA、CosyVoice requirements、wetext、pynini）".into());
    will_install.push("CosyVoice 仓库".into());
    will_install.push("默认模型 CosyVoice2-0.5B".into());
    let already: Vec<String> = probe.present_deps.iter().map(|d| d.label.clone()).collect();
    CosyDisclosure {
        will_install,
        will_skip: vec![
            "ttsfrd（仅 Linux wheel）".into(),
            "deepspeed / onnxruntime-gpu / tensorrt（Windows 跳过）".into(),
        ],
        already_present: already,
        disk: DiskBreakdown {
            miniconda_bytes: 500 * 1024 * 1024,
            env_packages_bytes: 10 * 1024 * 1024 * 1024,
            repo_bytes: 200 * 1024 * 1024,
            model_bytes: 3 * 1024 * 1024 * 1024,
            temp_buffer_bytes: 4 * 1024 * 1024 * 1024,
            total_suggested_bytes: EST_TOTAL_BYTES,
        },
        time: TimeEstimate {
            deps_minutes: "约 10–40 分钟".into(),
            env_minutes: "约 15–45 分钟".into(),
            model_minutes: "约 5–30 分钟".into(),
            total_minutes: "约 30–90 分钟".into(),
        },
        notes: vec![
            "安装期间请保持联网与电源接通，勿让系统休眠。".into(),
            "可能弹出管理员权限（UAC）用于安装编译工具。".into(),
            "Windows 文本前端使用 wetext（非 ttsfrd），正则化略弱。".into(),
            "戏剧情绪 instruct 仅 CosyVoice 支持；日常朗读请用离线 Kokoro。".into(),
        ],
        default_model: "CosyVoice2-0.5B".into(),
    }
}

/// 校验用户选择并生成披露清单。
pub fn plan_install(
    install_root: &str,
    model_source: &str,
    local_model_path: Option<&str>,
    mode_ids: Vec<String>,
) -> Result<CosyInstallPlan, String> {
    let probe = probe_host()?;
    let mut errors = Vec::new();
    let root = install_root.trim();
    if root.is_empty() {
        errors.push("请选择安装目录".into());
    }
    let root_path = PathBuf::from(root);
    if let Some(drive) = root_path.components().next() {
        let drive_str = drive.as_os_str().to_string_lossy().to_string();
        // Match free space on that drive letter when possible
        let free_ok = probe.drives.iter().any(|d| {
            d.path
                .chars()
                .next()
                .map(|c| drive_str.starts_with(c) || d.path.starts_with(&drive_str))
                .unwrap_or(false)
                && d.free_bytes >= MIN_DISK_BYTES
        }) || probe.drives.iter().any(|d| d.free_bytes >= MIN_DISK_BYTES);
        if !free_ok {
            errors.push("所选盘可用空间不足 30GB".into());
        }
    }
    let src = model_source.trim();
    if !matches!(src, "modelscope" | "huggingface" | "local") {
        errors.push("模型来源无效".into());
    }
    if src == "local" && local_model_path.map(|s| s.trim().is_empty()).unwrap_or(true) {
        errors.push("本机模型路径不能为空".into());
    }
    let disclosure = default_disclosure(&probe);
    Ok(CosyInstallPlan {
        install_root: root.into(),
        model_source: src.into(),
        local_model_path: local_model_path.map(|s| s.to_string()),
        mode_ids,
        ok: errors.is_empty() && probe.blockers.is_empty(),
        errors: {
            let mut e = probe.blockers.clone();
            e.extend(errors);
            e
        },
        disclosure,
    })
}

fn set_status(phase: &str, percent: u32, message: &str, last_error: &str) {
    if let Ok(mut s) = STATUS.lock() {
        s.phase = phase.into();
        s.percent = percent;
        s.message = message.into();
        s.last_error = last_error.into();
    }
    let _ = persist_status();
}

fn persist_status() -> Result<(), String> {
    let s = STATUS.lock().map_err(|_| "status lock")?.clone();
    let meta = INSTALL_META.lock().map_err(|_| "meta lock")?.clone();
    let path = install_json_path()?;
    let mut value = read_install_json_value();
    if !value.is_object() {
        value = serde_json::json!({});
    }
    let obj = value.as_object_mut().unwrap();
    obj.insert("schemaVersion".into(), serde_json::json!(2));
    obj.insert("phase".into(), serde_json::json!(s.phase));
    obj.insert("percent".into(), serde_json::json!(s.percent));
    obj.insert("message".into(), serde_json::json!(s.message));
    obj.insert("lastError".into(), serde_json::json!(s.last_error));
    obj.insert("installRoot".into(), serde_json::json!(s.install_root));
    obj.insert("deps".into(), serde_json::json!(s.deps));
    obj.insert(
        "completedStages".into(),
        serde_json::json!(meta.completed_stages),
    );
    if let Some(fs) = &meta.failed_stage {
        obj.insert("failedStage".into(), serde_json::json!(fs));
    }
    if let Some(fr) = &meta.failed_reason {
        obj.insert("failedReason".into(), serde_json::json!(fr));
    }
    if let Some(ml) = &meta.mirror_last_used {
        obj.insert("mirrorLastUsed".into(), serde_json::json!(ml));
    }
    if let Some(plan) = &meta.plan_snapshot {
        if let Ok(v) = serde_json::to_value(plan) {
            obj.insert("planSnapshot".into(), v);
        }
    }
    obj.insert(
        "updatedAt".into(),
        serde_json::json!(chrono::Utc::now().to_rfc3339()),
    );
    std::fs::write(&path, serde_json::to_vec_pretty(&value).unwrap_or_default())
        .map_err(|e| format!("写 install.json 失败: {e}"))
}

/// 当前安装状态。
pub fn status() -> CosyStatus {
    hydrate_from_disk();
    STATUS.lock().map(|s| s.clone()).unwrap_or_default()
}

pub fn cancel_install() {
    CANCEL.store(true, Ordering::Relaxed);
    set_status("cancelled", 0, "用户取消", "");
}

/// 先装缺失依赖（本轮实现：记录进度并尝试 winget/静默可自动化项；MSVC 仅检测）。
pub fn ensure_deps(install_root: &str) -> Result<(), String> {
    CANCEL.store(false, Ordering::Relaxed);
    let probe = probe_host()?;
    {
        let mut s = STATUS.lock().map_err(|_| "status lock")?;
        s.install_root = install_root.into();
        s.deps = probe
            .missing_deps
            .iter()
            .map(|d| DepProgress {
                id: d.id.clone(),
                label: d.label.clone(),
                state: "pending".into(),
            })
            .collect();
        s.phase = "ensuring_deps".into();
        s.percent = 5;
        s.message = "正在安装缺失依赖…".into();
        s.last_error.clear();
    }
    let _ = persist_status();
    std::fs::create_dir_all(install_root).map_err(|e| format!("无法创建安装目录: {e}"))?;

    let missing: Vec<DepItem> = probe.missing_deps.clone();
    let total = missing.len().max(1);
    for (i, dep) in missing.iter().enumerate() {
        if CANCEL.load(Ordering::Relaxed) {
            return Err("已取消".into());
        }
        mark_dep(&dep.id, "running");
        set_status(
            "ensuring_deps",
            (10 + (i * 40 / total)) as u32,
            &format!("安装依赖：{}", dep.label),
            "",
        );
        let result = install_one_dep(dep, install_root);
        if let Err(e) = result {
            mark_dep(&dep.id, "failed");
            mark_stage_failed("deps", &e);
            return Err(e);
        }
        mark_dep(&dep.id, "done");
    }
    set_status("ensuring_deps", 50, "依赖已就绪", "");
    mark_stage_done("deps");
    Ok(())
}

fn mark_dep(id: &str, state: &str) {
    if let Ok(mut s) = STATUS.lock() {
        if let Some(d) = s.deps.iter_mut().find(|d| d.id == id) {
            d.state = state.into();
        }
    }
}

fn install_one_dep(dep: &DepItem, install_root: &str) -> Result<(), String> {
    let root = PathBuf::from(install_root);
    let log = cosy_home()?.join("install.log");
    match dep.id.as_str() {
        "git" => {
            if command_exists("git") {
                return Ok(());
            }
            Err("未检测到 Git。请先安装 Git for Windows 后重试（不会静默覆盖系统 Git）。".into())
        }
        "conda" => {
            if cosy_runner::conda_exe(&root).is_file() {
                return Ok(());
            }
            cosy_runner::install_miniconda(&root, &CANCEL, &log)
        }
        "python310" => {
            if !cosy_runner::conda_exe(&root).is_file() {
                cosy_runner::install_miniconda(&root, &CANCEL, &log)?;
            }
            cosy_runner::ensure_python310_env(&root, &CANCEL, &log)
        }
        "msvc" => {
            if detect_msvc().unwrap_or(false) {
                return Ok(());
            }
            Err("未检测到 VS Build Tools。请安装「使用 C++ 的桌面开发」工作负载后重试。".into())
        }
        "pynini" => {
            if !cosy_runner::conda_exe(&root).is_file() {
                cosy_runner::install_miniconda(&root, &CANCEL, &log)?;
            }
            if !cosy_runner::python_exe(&root).is_file() {
                cosy_runner::ensure_python310_env(&root, &CANCEL, &log)?;
            }
            cosy_runner::install_pynini(&root, &CANCEL, &log)
        }
        _ => Ok(()),
    }
}

/// 依赖齐后安装引擎：env 包 → clone → 模型 → 冒烟 → ready。
pub fn install_engine(plan: &CosyInstallPlan) -> Result<(), String> {
    run_install_pipeline(plan, false)
}

/// 从 install.json 断点续装（跳过 completedStages）。
pub fn resume_install(install_root: &str) -> Result<(), String> {
    hydrate_from_disk();
    let root = install_root.trim();
    if root.is_empty() {
        return Err("installRoot 为空".into());
    }
    let plan = {
        let meta = INSTALL_META.lock().map_err(|_| "meta lock")?;
        meta.plan_snapshot.clone().ok_or_else(|| {
            "install.json 缺少 planSnapshot，请重新运行协助安装向导".to_string()
        })?
    };
    if plan.install_root != root {
        return Err("installRoot 与 planSnapshot 不一致".into());
    }
    CANCEL.store(false, Ordering::Relaxed);
    run_install_pipeline(&plan, true)
}

fn run_install_pipeline(plan: &CosyInstallPlan, resume: bool) -> Result<(), String> {
    if !plan.ok {
        return Err(plan
            .errors
            .first()
            .cloned()
            .unwrap_or_else(|| "计划无效".into()));
    }
    CANCEL.store(false, Ordering::Relaxed);
    {
        let mut meta = INSTALL_META.lock().map_err(|_| "meta lock")?;
        if !resume {
            meta.completed_stages.clear();
            meta.failed_stage = None;
            meta.failed_reason = None;
        }
        meta.plan_snapshot = Some(plan.clone());
    }
    {
        let mut s = STATUS.lock().map_err(|_| "status lock")?;
        s.install_root = plan.install_root.clone();
    }
    let _ = persist_status();

    if !stage_completed("deps") {
        ensure_deps(&plan.install_root)?;
        if CANCEL.load(Ordering::Relaxed) {
            return Err("已取消".into());
        }
        mark_stage_done("deps");
    }

    let root = PathBuf::from(&plan.install_root);
    let log = install_log_path()?;

    set_status("ensuring_deps", 52, "安装 pynini（conda-forge）…", "");
    if cosy_runner::conda_exe(&root).is_file() {
        let _ = cosy_runner::install_pynini(&root, &CANCEL, &log);
    }
    seed_modes_if_needed(&plan.mode_ids)?;
    let playbook = cosy_home()?.join("playbook.win.md");
    let mut body = String::from("# CosyVoice Windows playbook\n");
    let playbook_src = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("resources")
        .join("cosyvoice-install-playbook.win.md");
    if let Ok(text) = std::fs::read_to_string(&playbook_src) {
        body = text;
    }
    let _ = std::fs::write(&playbook, body);

    if !stage_completed("clone_repo") {
        set_status("installing_engine", 65, "克隆 CosyVoice 仓库…", "");
        let (repo, mirror) = cosy_runner::clone_cosyvoice(&root, &CANCEL, &log).map_err(|e| {
            mark_stage_failed("clone_repo", &e);
            e
        })?;
        set_mirror_last(&mirror);
        mark_stage_done("clone_repo");

        if !stage_completed("pip_requirements") {
            set_status("installing_env", 72, "pip 安装依赖（可能较久）…", "");
            cosy_runner::pip_install_requirements(&root, &repo, &CANCEL, &log).map_err(|e| {
                mark_stage_failed("pip_requirements", &e);
                e
            })?;
            mark_stage_done("pip_requirements");
        }
    } else {
        let repo = root.join("repo");
        if !stage_completed("pip_requirements") {
            set_status("installing_env", 72, "pip 安装依赖（可能较久）…", "");
            cosy_runner::pip_install_requirements(&root, &repo, &CANCEL, &log).map_err(|e| {
                mark_stage_failed("pip_requirements", &e);
                e
            })?;
            mark_stage_done("pip_requirements");
        }
    }

    if !stage_completed("download_model") {
        set_status("installing_models", 85, "下载 CosyVoice2-0.5B…", "");
        cosy_runner::download_default_model(
            &root,
            &plan.model_source,
            plan.local_model_path.as_deref(),
            &CANCEL,
            &log,
        )
        .map_err(|e| {
            mark_stage_failed("download_model", &e);
            e
        })?;
        mark_stage_done("download_model");
    }

    if !stage_completed("smoke_verify") {
        set_status("verifying", 95, "冒烟校验…", "");
        cosy_runner::smoke_verify(&root, &CANCEL, &log).map_err(|e| {
            mark_stage_failed("smoke_verify", &e);
            e
        })?;
        mark_stage_done("smoke_verify");
    }

    set_status("ready", 100, "CosyVoice 扩展已就绪", "");
    let path = install_json_path()?;
    let mut value = read_install_json_value();
    if !value.is_object() {
        value = serde_json::json!({});
    }
    let obj = value.as_object_mut().unwrap();
    obj.insert("schemaVersion".into(), serde_json::json!(2));
    obj.insert("phase".into(), serde_json::json!("ready"));
    obj.insert("percent".into(), serde_json::json!(100));
    obj.insert("message".into(), serde_json::json!("CosyVoice 扩展已就绪"));
    obj.insert("lastError".into(), serde_json::json!(""));
    obj.insert("installRoot".into(), serde_json::json!(plan.install_root));
    obj.insert("modelSource".into(), serde_json::json!(plan.model_source));
    obj.insert("textFrontend".into(), serde_json::json!("wetext"));
    obj.insert("defaultModel".into(), serde_json::json!("CosyVoice2-0.5B"));
    obj.insert("endpoint".into(), serde_json::Value::Null);
    obj.insert(
        "updatedAt".into(),
        serde_json::json!(chrono::Utc::now().to_rfc3339()),
    );
    let _ = std::fs::write(path, serde_json::to_vec_pretty(&value).unwrap_or_default());
    Ok(())
}

fn seed_modes_if_needed(selected: &[String]) -> Result<(), String> {
    let path = modes_json_path()?;
    if path.is_file() {
        return Ok(());
    }
    let all = builtin_modes();
    let modes: Vec<CosyMode> = if selected.is_empty() {
        all
    } else {
        all.into_iter()
            .filter(|m| selected.iter().any(|id| id == &m.id))
            .collect()
    };
    let file = ModesFile {
        schema_version: 1,
        modes,
    };
    std::fs::write(
        &path,
        serde_json::to_vec_pretty(&file).map_err(|e| e.to_string())?,
    )
    .map_err(|e| format!("写 modes.json 失败: {e}"))
}

fn builtin_modes() -> Vec<CosyMode> {
    vec![
        CosyMode {
            id: "female-jiazi".into(),
            label: "夹子音".into(),
            builtin: true,
            instruct: "用网络流行「夹子音」说话：夸张鼻音、软糯卖萌、句尾拖音与上扬，可适度叠词，信息仍要清楚。".into(),
            emotion: Some("cute".into()),
            rate: 1.12,
            pitch: 1.4,
        },
        CosyMode {
            id: "female-loli".into(),
            label: "萝莉".into(),
            builtin: true,
            instruct: "Speak in a cute youthful girl voice, short soft sentences.".into(),
            emotion: Some("cute".into()),
            rate: 1.05,
            pitch: 1.1,
        },
        CosyMode {
            id: "female-mature".into(),
            label: "御姐".into(),
            builtin: true,
            instruct: "Speak as a mature confident woman, clear and firm.".into(),
            emotion: Some("serious".into()),
            rate: 0.95,
            pitch: 0.95,
        },
        CosyMode {
            id: "female-cute".into(),
            label: "卖萌".into(),
            builtin: true,
            instruct: "Speak playfully and slightly coquettish, keep information clear.".into(),
            emotion: Some("happy".into()),
            rate: 1.1,
            pitch: 1.2,
        },
        CosyMode {
            id: "female-angry".into(),
            label: "生气".into(),
            builtin: true,
            instruct: "Speak with mild irritation and urgency, remain polite.".into(),
            emotion: Some("angry".into()),
            rate: 1.1,
            pitch: 1.1,
        },
        CosyMode {
            id: "female-joke".into(),
            label: "玩笑".into(),
            builtin: true,
            instruct: "Speak lightly humorous, playful without mocking the user.".into(),
            emotion: Some("happy".into()),
            rate: 1.05,
            pitch: 1.1,
        },
    ]
}

pub fn load_modes() -> Result<Vec<CosyMode>, String> {
    let path = modes_json_path()?;
    if !path.is_file() {
        let modes = builtin_modes();
        seed_modes_if_needed(&[])?;
        return Ok(modes);
    }
    let text = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let file: ModesFile = serde_json::from_str(&text).map_err(|e| format!("modes.json 损坏: {e}"))?;
    Ok(file.modes)
}

pub fn save_modes(modes: Vec<CosyMode>) -> Result<(), String> {
    let file = ModesFile {
        schema_version: 1,
        modes,
    };
    std::fs::write(
        modes_json_path()?,
        serde_json::to_vec_pretty(&file).map_err(|e| e.to_string())?,
    )
    .map_err(|e| format!("保存 modes 失败: {e}"))
}

/// 根据 install.json 推导 FastAPI 启动项（内部走 discover）。
pub fn launch_hints() -> Result<CosyLaunchHints, String> {
    let report = super::cosy_discover::discover(None, None, None, None, true);
    if report.python.is_none() && report.server_script.is_none() {
        return Err(
            report
                .notes
                .first()
                .cloned()
                .unwrap_or_else(|| "未能自动识别 CosyVoice 路径".into()),
        );
    }
    Ok(CosyLaunchHints {
        python: report.python,
        server_script: report.server_script,
        model_dir: report.model_dir,
        base_url: report.base_url,
        install_root: report.scan_root,
    })
}

/// 读取 install.json 全量与 install.log 尾部（供 UI 展示中断原因）。
pub fn install_read() -> Result<CosyInstallRead, String> {
    hydrate_from_disk();
    let install_json = read_install_json_value();
    let log_path = install_log_path()?;
    let log_tail = read_log_tail(&log_path, 80);
    let completed_stages: Vec<String> = install_json
        .get("completedStages")
        .and_then(|x| x.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|x| x.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default();
    let failed_stage = install_json
        .get("failedStage")
        .and_then(|x| x.as_str())
        .map(str::to_string);
    let failed_reason = install_json
        .get("failedReason")
        .and_then(|x| x.as_str())
        .or_else(|| install_json.get("lastError").and_then(|x| x.as_str()))
        .map(str::to_string);
    let phase = install_json
        .get("phase")
        .and_then(|x| x.as_str())
        .unwrap_or("");
    let has_plan = install_json.get("planSnapshot").is_some();
    let can_resume = has_plan
        && (phase == "failed" || phase == "cancelled")
        && !completed_stages.is_empty()
        && completed_stages.len() < INSTALL_STAGES.len();
    Ok(CosyInstallRead {
        install_json,
        log_tail,
        failed_stage,
        failed_reason,
        completed_stages,
        can_resume,
    })
}
