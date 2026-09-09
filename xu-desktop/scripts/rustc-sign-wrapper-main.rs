//! @file Cargo RUSTC_WRAPPER — stub allowlisted no-op build scripts (360 bypass)
//! @author qiuye <yjk150@qq.com>
//! @date 2026-09-01
//! @version 1.2.0
//! @category Build
//! @algo rustc-wrapper-allowlist-stub
//!
//! 360 Safe quarantines some freshly linked cargo build-script binaries (os error 5).
//! Only replace known no-op build.rs crates (e.g. rustls). Real scripts must run;
//! if 360 still blocks them, trust `src-tauri/target` in 360 and rebuild.

use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, exit};

fn flag_value(args: &[String], key: &str) -> Option<String> {
    for i in 0..args.len() {
        if args[i] == key {
            return args.get(i + 1).cloned();
        }
        let pref = format!("{key}=");
        if let Some(rest) = args[i].strip_prefix(&pref) {
            return Some(rest.to_string());
        }
    }
    None
}

fn codegen_value(args: &[String], key: &str) -> Option<String> {
    let needle = format!("{key}=");
    for i in 0..args.len() {
        if args[i] == "-C" {
            if let Some(v) = args.get(i + 1) {
                if let Some(rest) = v.strip_prefix(&needle) {
                    return Some(rest.to_string());
                }
            }
        }
        if let Some(rest) = args[i].strip_prefix(&format!("-C{needle}")) {
            return Some(rest.to_string());
        }
    }
    None
}

fn default_stub() -> PathBuf {
    env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.join("cargo-build-script-stub.exe")))
        .unwrap_or_else(|| PathBuf::from("cargo-build-script-stub.exe"))
}

fn should_stub(args: &[String]) -> bool {
    let src = match args
        .iter()
        .find(|a| a.replace('\\', "/").ends_with("/build.rs"))
    {
        Some(s) => s.replace('\\', "/").to_lowercase(),
        None => return false,
    };
    // Known-empty / nightly-only build scripts on stable Windows MSVC.
    const ALLOW: &[&str] = &[
        "/rustls-", // rustls 0.23 empty on stable
    ];
    ALLOW.iter().any(|p| src.contains(p))
}

fn main() {
    let mut argv = env::args().skip(1);
    let rustc = match argv.next() {
        Some(r) => r,
        None => {
            eprintln!("[rustc-sign-wrapper] missing rustc");
            exit(1);
        }
    };
    let args: Vec<String> = argv.collect();
    let status = Command::new(&rustc).args(&args).status();
    let code = match status {
        Ok(s) => s.code().unwrap_or(1),
        Err(e) => {
            eprintln!("[rustc-sign-wrapper] spawn rustc failed: {e}");
            exit(1);
        }
    };
    if code != 0 {
        exit(code);
    }

    let crate_name = flag_value(&args, "--crate-name").unwrap_or_default();
    if crate_name != "build_script_build" && !crate_name.starts_with("build_script") {
        exit(0);
    }
    if !should_stub(&args) {
        exit(0);
    }

    let stub = env::var_os("XU_BUILD_SCRIPT_STUB")
        .map(PathBuf::from)
        .unwrap_or_else(default_stub);
    if !stub.is_file() {
        exit(0);
    }

    let out_dir = flag_value(&args, "--out-dir");
    let extra = codegen_value(&args, "extra-filename").unwrap_or_default();
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Some(o) = flag_value(&args, "-o") {
        candidates.push(PathBuf::from(&o));
        candidates.push(PathBuf::from(format!("{o}.exe")));
    }
    if let Some(ref od) = out_dir {
        let od = Path::new(od);
        candidates.push(od.join(format!("build_script_build{extra}.exe")));
        candidates.push(od.join(format!("build_script_build{extra}")));
        candidates.push(od.join("build-script-build.exe"));
    }

    for c in &candidates {
        if c.is_file() {
            let _ = fs::copy(&stub, c);
        }
    }
    if let Some(od) = out_dir {
        let planted = Path::new(&od).join("build-script-build.exe");
        let _ = fs::copy(&stub, planted);
    }
    exit(0);
}
