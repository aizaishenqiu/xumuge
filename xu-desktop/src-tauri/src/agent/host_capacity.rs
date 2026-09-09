//! Probe host CPU/RAM/GPU and recommend employee concurrency + local LLM QPS.

use serde::Serialize;
use tauri::State;

use crate::agent::stream::AgentRuntime;
use std::sync::atomic::Ordering;
use std::sync::Arc;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostCapacity {
    pub cpu_logical: u32,
    pub ram_gb: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gpu_vram_gb: Option<f64>,
    pub recommended_global_slots: u32,
    pub recommended_per_project: u32,
    /// Parallel HTTP calls to local Ollama (VRAM/RAM bound).
    pub recommended_local_llm_slots: u32,
    /// Estimated safe requests/sec for local model (display + throttle hint).
    pub recommended_local_qps: u32,
    /// Simultaneous remote-API employee streams (UI/network bound).
    pub recommended_remote_slots: u32,
    pub recommended_kickoff_parallel: u32,
    pub recommended_kickoff_max: u32,
    pub probed_at_ms: i64,
    pub rationale: String,
    /// Probe never enables unlimited remote by default.
    pub remote_unlimited: bool,
}

fn probe_gpu_vram_gb() -> Option<f64> {
    let mut cmd = std::process::Command::new("nvidia-smi");
    crate::xu_paths::hide_command_window(&mut cmd);
    let out = cmd
        .args(["--query-gpu=memory.total", "--format=csv,noheader,nounits"])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let s = String::from_utf8_lossy(&out.stdout);
    let mb: f64 = s.lines().find_map(|line| line.trim().parse::<f64>().ok())?;
    if mb <= 0.0 {
        return None;
    }
    Some(((mb / 1024.0) * 10.0).round() / 10.0)
}

#[cfg(windows)]
fn total_ram_bytes() -> u64 {
    #[repr(C)]
    struct MemoryStatusEx {
        length: u32,
        memory_load: u32,
        total_phys: u64,
        avail_phys: u64,
        total_page_file: u64,
        avail_page_file: u64,
        total_virtual: u64,
        avail_virtual: u64,
        avail_extended_virtual: u64,
    }
    #[link(name = "kernel32")]
    extern "system" {
        fn GlobalMemoryStatusEx(lp_buffer: *mut MemoryStatusEx) -> i32;
    }
    unsafe {
        let mut st = MemoryStatusEx {
            length: std::mem::size_of::<MemoryStatusEx>() as u32,
            memory_load: 0,
            total_phys: 0,
            avail_phys: 0,
            total_page_file: 0,
            avail_page_file: 0,
            total_virtual: 0,
            avail_virtual: 0,
            avail_extended_virtual: 0,
        };
        if GlobalMemoryStatusEx(&mut st) != 0 {
            st.total_phys
        } else {
            0
        }
    }
}

#[cfg(not(windows))]
fn total_ram_bytes() -> u64 {
    // Best-effort: /proc/meminfo MemTotal
    if let Ok(s) = std::fs::read_to_string("/proc/meminfo") {
        for line in s.lines() {
            if let Some(rest) = line.strip_prefix("MemTotal:") {
                let kb: u64 = rest
                    .split_whitespace()
                    .next()
                    .and_then(|x| x.parse().ok())
                    .unwrap_or(0);
                return kb.saturating_mul(1024);
            }
        }
    }
    0
}

fn cpu_logical() -> u32 {
    std::thread::available_parallelism()
        .map(|n| n.get() as u32)
        .unwrap_or(4)
}

/// Infer model weight class from name (local Ollama tags etc.).
fn model_weight_class(model: &str) -> u8 {
    let m = model.to_lowercase();
    // larger first
    if m.contains("70b") || m.contains("72b") || m.contains("405b") || m.contains("671b") {
        return 3;
    }
    if m.contains("32b")
        || m.contains("34b")
        || m.contains("27b")
        || m.contains("22b")
        || m.contains("20b")
    {
        return 2;
    }
    if m.contains("14b")
        || m.contains("13b")
        || m.contains("12b")
        || m.contains("9b")
        || m.contains("8b")
        || m.contains("7b")
    {
        return 1;
    }
    if m.contains("3b") || m.contains("4b") || m.contains("1b") || m.contains("0.5b") {
        return 0;
    }
    1 // default mid-small
}

pub fn compute_host_capacity(model_hint: Option<&str>) -> HostCapacity {
    let cpu = cpu_logical().max(1);
    let ram_bytes = total_ram_bytes();
    let ram_gb = if ram_bytes > 0 {
        (ram_bytes as f64) / (1024.0 * 1024.0 * 1024.0)
    } else {
        16.0 // unknown → assume mid
    };
    let ram_gb = (ram_gb * 10.0).round() / 10.0;
    let gpu_vram_gb = probe_gpu_vram_gb();
    let weight = model_hint.map(model_weight_class).unwrap_or(1);

    // Base from hardware
    let mut global: u32 = if ram_gb < 8.0 || cpu <= 2 {
        1
    } else if ram_gb < 16.0 || cpu <= 4 {
        2
    } else if ram_gb < 32.0 || cpu <= 8 {
        3
    } else {
        4
    };

    if let Some(vram) = gpu_vram_gb {
        if vram >= 24.0 && weight <= 1 {
            global = global.max(3);
        } else if vram >= 12.0 && weight == 0 {
            global = global.max(2);
        }
    }

    // Heavy local models: clamp hard (VRAM/RAM contention)
    match weight {
        3 => global = 1,
        2 => global = global.min(2),
        1 => global = global.min(3),
        _ => {}
    }

    let per_project = global.min(2).max(1);

    let (local_llm, local_qps) = match (gpu_vram_gb, weight) {
        (Some(vram), 0) if vram >= 16.0 => (2, 6),
        (Some(vram), 0) if vram >= 8.0 => (1, 4),
        (Some(vram), 1) if vram >= 24.0 => (2, 3),
        (Some(vram), 1) if vram >= 12.0 => (1, 2),
        (Some(vram), 2) if vram >= 24.0 => (1, 1),
        (Some(_), 3) => (1, 1),
        (Some(vram), _) if vram >= 8.0 => (1, 2),
        (None, 0) if ram_gb >= 32.0 && cpu >= 8 => (1, 2),
        (None, 0) if ram_gb >= 16.0 => (1, 1),
        _ => (1, 1),
    };

    let kickoff_parallel = local_llm.clamp(1, 2);
    let kickoff_max: u32 = if ram_gb < 8.0 {
        4
    } else if ram_gb < 16.0 {
        8
    } else if ram_gb < 32.0 {
        8
    } else {
        12
    };
    let remote_slots: u32 = if ram_gb >= 16.0 && cpu >= 8 { 4 } else { 2 };

    let gpu_note = gpu_vram_gb
        .map(|v| format!(" · GPU≈{v:.1}GB"))
        .unwrap_or_else(|| " · 无独显/未探测到 NVIDIA".into());

    let rationale = format!(
        "CPU={cpu} 逻辑核 · RAM≈{ram_gb:.1}GB{gpu_note} · 模型档={weight}（0小/1中/2大/3超大）→ 本地员工槽 {global}，每项目 {per_project}，本地模型并发 {local_llm}，远程流式槽 {remote_slots}，开工每批 {kickoff_parallel}、单次最多 {kickoff_max} 人。远程不占显存，但仍限同时流式以免界面卡顿。"
    );

    HostCapacity {
        cpu_logical: cpu,
        ram_gb,
        gpu_vram_gb,
        recommended_global_slots: global.clamp(1, 4),
        recommended_per_project: per_project.clamp(1, 4),
        recommended_local_llm_slots: local_llm.clamp(1, 2),
        recommended_local_qps: local_qps.clamp(1, 8),
        recommended_remote_slots: remote_slots.clamp(1, 4),
        recommended_kickoff_parallel: kickoff_parallel,
        recommended_kickoff_max: kickoff_max,
        probed_at_ms: chrono::Utc::now().timestamp_millis(),
        rationale,
        remote_unlimited: false,
    }
}

fn apply_capacity_to_runtime(runtime: &AgentRuntime, cap: &HostCapacity) -> Result<(), String> {
    {
        let mut g = runtime.employee_slots.lock().map_err(|e| e.to_string())?;
        *g = Arc::new(tokio::sync::Semaphore::new(
            cap.recommended_global_slots as usize,
        ));
    }
    runtime
        .per_project_limit
        .store(cap.recommended_per_project as usize, Ordering::Relaxed);
    {
        let mut g = runtime.local_llm_slots.lock().map_err(|e| e.to_string())?;
        *g = Arc::new(tokio::sync::Semaphore::new(
            cap.recommended_local_llm_slots as usize,
        ));
    }
    {
        let mut g = runtime.remote_slots.lock().map_err(|e| e.to_string())?;
        *g = Arc::new(tokio::sync::Semaphore::new(
            cap.recommended_remote_slots as usize,
        ));
    }
    Ok(())
}

#[tauri::command]
pub fn xu_probe_host_capacity(model_hint: Option<String>) -> Result<HostCapacity, String> {
    Ok(compute_host_capacity(model_hint.as_deref()))
}

/// Apply recommended local slots to AgentRuntime (does not enable remote unlimited).
#[tauri::command]
pub fn xu_apply_auto_employee_slots(
    runtime: State<'_, AgentRuntime>,
    model_hint: Option<String>,
) -> Result<HostCapacity, String> {
    let cap = compute_host_capacity(model_hint.as_deref());
    apply_capacity_to_runtime(&runtime, &cap)?;
    Ok(cap)
}

/// Apply previously saved slots without re-running nvidia-smi.
#[tauri::command]
pub fn xu_apply_cached_employee_slots(
    runtime: State<'_, AgentRuntime>,
    global_slots: u32,
    per_project: u32,
    local_llm_slots: u32,
    remote_slots: u32,
) -> Result<(), String> {
    let cap = HostCapacity {
        cpu_logical: 0,
        ram_gb: 0.0,
        gpu_vram_gb: None,
        recommended_global_slots: global_slots.clamp(1, 4),
        recommended_per_project: per_project.clamp(1, 4),
        recommended_local_llm_slots: local_llm_slots.clamp(1, 2),
        recommended_local_qps: 1,
        recommended_remote_slots: remote_slots.clamp(1, 4),
        recommended_kickoff_parallel: 1,
        recommended_kickoff_max: 8,
        probed_at_ms: 0,
        rationale: String::new(),
        remote_unlimited: false,
    };
    apply_capacity_to_runtime(&runtime, &cap)
}

#[tauri::command]
pub fn xu_set_remote_unlimited(
    runtime: State<'_, AgentRuntime>,
    unlimited: bool,
) -> Result<(), String> {
    runtime.remote_unlimited.store(unlimited, Ordering::Relaxed);
    Ok(())
}
