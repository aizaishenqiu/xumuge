//! 解析/安装 Kokoro 所需的 espeak-ng（音素，非系统朗读）。
//!
//! @author qiuye <yjk150@qq.com>
//! @date 2026-09-01
//! @updated 2026-09-01
//! @version 1.1.0
//! @category Stream
//! @algo espeak-resolve-bundle

use std::path::{Path, PathBuf};
use std::process::Command;

use tauri::AppHandle;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

const GH_ESPEAK_MSI: &str =
    "https://github.com/espeak-ng/espeak-ng/releases/download/1.52.0/espeak-ng.msi";

/// 真 MSI 约 12MB；镜像返回 HTML 时往往只有几 KB。
const MSI_MIN_BYTES: u64 = 8_000_000;

/// `{XU_HOME}/voice-engines/native/espeak-ng`
pub fn native_espeak_dir() -> Result<PathBuf, String> {
    let d = super::paths::native_engine_root()?.join("espeak-ng");
    std::fs::create_dir_all(&d).map_err(|e| e.to_string())?;
    Ok(d)
}

/// 二进制 + data 目录（`data` = `espeak-ng-data`，内含 `phontab`，传给 `--path`）。
#[derive(Debug, Clone)]
pub struct EspeakPaths {
    pub bin: PathBuf,
    pub data: PathBuf,
}

/// 是否已具备可调用的 espeak-ng（含 Windows DLL）。
pub fn espeak_ready() -> bool {
    resolve_espeak_paths().is_some()
}

/// 按优先级查找：XU 捆绑 → 常见安装路径 → PATH。
pub fn resolve_espeak_paths() -> Option<EspeakPaths> {
    if let Ok(dir) = native_espeak_dir() {
        if let Some(p) = look_in_dir(&dir) {
            return Some(p);
        }
    }
    #[cfg(windows)]
    {
        let program_files = std::env::var_os("ProgramFiles").map(PathBuf::from);
        let program_files_x86 = std::env::var_os("ProgramFiles(x86)").map(PathBuf::from);
        for base in [program_files, program_files_x86].into_iter().flatten() {
            let cand = base.join("eSpeak NG");
            if let Some(p) = look_in_dir(&cand) {
                return Some(p);
            }
        }
    }
    #[cfg(not(windows))]
    {
        for bin in ["/usr/bin/espeak-ng", "/usr/local/bin/espeak-ng"] {
            let bin = PathBuf::from(bin);
            if bin.is_file() {
                let data = bin
                    .parent()
                    .map(|p| p.join("../share/espeak-ng-data"))
                    .unwrap_or_else(|| PathBuf::from("/usr/share/espeak-ng-data"));
                let data = data.canonicalize().unwrap_or(data);
                if data.is_dir() {
                    return Some(EspeakPaths { bin, data });
                }
                return Some(EspeakPaths {
                    bin,
                    data: PathBuf::from("/usr/share/espeak-ng-data"),
                });
            }
        }
    }
    which_on_path()
}

fn look_in_dir(dir: &Path) -> Option<EspeakPaths> {
    let bin_names = if cfg!(windows) {
        ["espeak-ng.exe", "espeak.exe"]
    } else {
        ["espeak-ng", "espeak"]
    };
    let mut bin: Option<PathBuf> = None;
    for name in bin_names {
        let p = dir.join(name);
        if p.is_file() {
            bin = Some(p);
            break;
        }
    }
    if bin.is_none() {
        bin = find_file_named(
            dir,
            if cfg!(windows) {
                "espeak-ng.exe"
            } else {
                "espeak-ng"
            },
            4,
        );
    }
    let bin = bin?;
    // Windows 安装包的 espeak-ng.exe 极小，必须同目录有 libespeak-ng.dll，否则 0xC0000135。
    #[cfg(windows)]
    {
        let dll = bin
            .parent()
            .map(|p| p.join("libespeak-ng.dll"))
            .filter(|p| p.is_file());
        if dll.is_none() {
            return None;
        }
    }
    let data = dir
        .join("espeak-ng-data")
        .canonicalize()
        .ok()
        .map(|p| strip_windows_verbatim_prefix(&p))
        .filter(|p| p.is_dir())
        .or_else(|| {
            bin.parent()
                .map(|p| p.join("espeak-ng-data"))
                .filter(|p| p.is_dir())
        })
        .or_else(|| find_dir_named(dir, "espeak-ng-data", 4))?;
    Some(EspeakPaths { bin, data })
}

/// 去掉 Windows `\\?\`，避免传给 espeak-ng 后找不到 phontab。
fn strip_windows_verbatim_prefix(path: &Path) -> PathBuf {
    #[cfg(windows)]
    {
        let s = path.to_string_lossy();
        if let Some(rest) = s.strip_prefix(r"\\?\UNC\") {
            return PathBuf::from(format!(r"\\{rest}"));
        }
        if let Some(rest) = s.strip_prefix(r"\\?\") {
            return PathBuf::from(rest);
        }
    }
    path.to_path_buf()
}

fn find_file_named(root: &Path, name: &str, max_depth: u32) -> Option<PathBuf> {
    walk_find(root, max_depth, &|p| {
        p.is_file() && p.file_name().is_some_and(|n| n == name)
    })
}

fn find_dir_named(root: &Path, name: &str, max_depth: u32) -> Option<PathBuf> {
    walk_find(root, max_depth, &|p| {
        p.is_dir() && p.file_name().is_some_and(|n| n == name)
    })
}

fn walk_find(root: &Path, max_depth: u32, pred: &dyn Fn(&Path) -> bool) -> Option<PathBuf> {
    if max_depth == 0 || !root.is_dir() {
        return None;
    }
    let rd = std::fs::read_dir(root).ok()?;
    for ent in rd.flatten() {
        let p = ent.path();
        if pred(&p) {
            return Some(p);
        }
        if p.is_dir() {
            if let Some(hit) = walk_find(&p, max_depth - 1, pred) {
                return Some(hit);
            }
        }
    }
    None
}

fn which_on_path() -> Option<EspeakPaths> {
    #[cfg(windows)]
    {
        let mut cmd = Command::new("where");
        cmd.arg("espeak-ng").creation_flags(CREATE_NO_WINDOW);
        let out = cmd.output().ok()?;
        if !out.status.success() {
            return None;
        }
        let line = String::from_utf8_lossy(&out.stdout);
        let first = line.lines().next()?.trim();
        if first.is_empty() {
            return None;
        }
        let bin = PathBuf::from(first);
        let parent = bin.parent()?.to_path_buf();
        look_in_dir(&parent)
    }
    #[cfg(not(windows))]
    {
        let out = Command::new("which").arg("espeak-ng").output().ok()?;
        if !out.status.success() {
            return None;
        }
        let first = String::from_utf8_lossy(&out.stdout);
        let first = first.lines().next()?.trim();
        if first.is_empty() {
            return None;
        }
        let bin = PathBuf::from(first);
        Some(EspeakPaths {
            bin,
            data: PathBuf::from("/usr/share/espeak-ng-data"),
        })
    }
}

fn msi_looks_valid(path: &Path) -> bool {
    let Ok(meta) = std::fs::metadata(path) else {
        return false;
    };
    if meta.len() < MSI_MIN_BYTES {
        return false;
    }
    let Ok(mut f) = std::fs::File::open(path) else {
        return false;
    };
    use std::io::Read;
    let mut magic = [0u8; 4];
    if f.read_exact(&mut magic).is_err() {
        return false;
    }
    // OLE Compound Document（标准 MSI）
    magic == [0xD0, 0xCF, 0x11, 0xE0]
}

/// 若本机尚无可用 espeak，则下载 MSI 并行政安装解压到 XU_HOME（仅 Windows）。
/// 依赖: 可选 AppHandle 用于进度；失败返回可读中文。
pub fn ensure_espeak(app: Option<&AppHandle>) -> Result<EspeakPaths, String> {
    if let Some(p) = resolve_espeak_paths() {
        return Ok(p);
    }
    #[cfg(not(windows))]
    {
        let _ = app;
        return Err(
            "未找到 espeak-ng。请安装：Linux `sudo apt-get install espeak-ng`，macOS `brew install espeak-ng`。"
                .into(),
        );
    }
    #[cfg(windows)]
    {
        install_espeak_windows(app)
    }
}

#[cfg(windows)]
fn install_espeak_windows(app: Option<&AppHandle>) -> Result<EspeakPaths, String> {
    use super::voice_native::{download_first_public, emit_public};

    emit_public(app, "downloading_espeak", 82, "下载音素引擎 espeak-ng…");
    let cache = super::paths::native_engine_root()?.join(".cache");
    std::fs::create_dir_all(&cache).map_err(|e| e.to_string())?;
    let msi = cache.join("espeak-ng.msi");
    if msi.is_file() && !msi_looks_valid(&msi) {
        let _ = std::fs::remove_file(&msi);
    }
    let msi_url = crate::xu_env::env_or("XU_ESPEAK_MSI_URL", GH_ESPEAK_MSI);
    download_first_public(
        app,
        "downloading_espeak",
        82,
        &super::voice_native::gh_release_cands_public(&msi_url),
        &msi,
        MSI_MIN_BYTES,
    )?;
    if !msi_looks_valid(&msi) {
        let _ = std::fs::remove_file(&msi);
        return Err("espeak-ng.msi 下载损坏（非有效 MSI）。请换网络或设置 XU_GH_MIRROR 后重试。".into());
    }

    let extract_root = native_espeak_dir()?.join("_msi_extract");
    let _ = std::fs::remove_dir_all(&extract_root);
    std::fs::create_dir_all(&extract_root).map_err(|e| e.to_string())?;

    emit_public(app, "extracting_espeak", 90, "解压 espeak-ng…");
    // TARGETDIR 必须绝对路径；路径含空格时用引号包整段属性。
    let target = extract_root
        .canonicalize()
        .unwrap_or_else(|_| extract_root.clone());
    let target_arg = format!("TARGETDIR={}", target.display());
    let status = Command::new("msiexec")
        .arg("/a")
        .arg(&msi)
        .arg("/qn")
        .arg(&target_arg)
        .creation_flags(CREATE_NO_WINDOW)
        .status()
        .map_err(|e| format!("无法运行 msiexec: {e}"))?;
    if !status.success() {
        return Err(format!(
            "espeak-ng MSI 解压失败（exit {:?}）。请关闭占用后重试，或手动安装 https://github.com/espeak-ng/espeak-ng/releases",
            status.code()
        ));
    }

    let found = look_in_dir(&extract_root)
        .ok_or_else(|| "MSI 解压后未找到完整 espeak-ng（需 exe+dll+data）".to_string())?;

    let dest = native_espeak_dir()?;
    // 拷贝 exe 同目录全部文件（含 libespeak-ng.dll）
    let src_bin_dir = found
        .bin
        .parent()
        .ok_or_else(|| "espeak-ng.exe 无父目录".to_string())?;
    for ent in std::fs::read_dir(src_bin_dir).map_err(|e| e.to_string())? {
        let ent = ent.map_err(|e| e.to_string())?;
        let from = ent.path();
        if from.is_file() {
            let to = dest.join(ent.file_name());
            std::fs::copy(&from, &to).map_err(|e| format!("复制 {} 失败: {e}", from.display()))?;
        }
    }
    let dest_data = dest.join("espeak-ng-data");
    if dest_data.exists() {
        let _ = std::fs::remove_dir_all(&dest_data);
    }
    copy_dir_recursive(&found.data, &dest_data)?;
    let _ = std::fs::remove_dir_all(&extract_root);

    resolve_espeak_paths().ok_or_else(|| "espeak-ng 安装后仍缺少 libespeak-ng.dll 或 data".into())
}

#[cfg(windows)]
fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<(), String> {
    std::fs::create_dir_all(dst).map_err(|e| e.to_string())?;
    for ent in std::fs::read_dir(src).map_err(|e| e.to_string())? {
        let ent = ent.map_err(|e| e.to_string())?;
        let from = ent.path();
        let to = dst.join(ent.file_name());
        if from.is_dir() {
            copy_dir_recursive(&from, &to)?;
        } else {
            std::fs::copy(&from, &to).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}
