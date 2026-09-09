//! 离线语音引擎：Sherpa‑ONNX ASR + Kokoro TTS（进程内，无 Python sidecar）。
//!
//! @author qiuye <yjk150@qq.com>
//! @date 2026-08-31
//! @updated 2026-08-31
//! @version 1.1.0
//! @category Stream
//! @algo lazy-onnx-native-voice

pub mod asr;
pub mod duplex_aec;
pub mod cosy_console;
pub mod cosy_discover;
pub mod cosy_fastapi;
pub mod cosy_manager;
pub mod cosy_runner;
pub mod cosy_synth;
pub mod cosyvoice;
pub mod espeak;
pub mod kokoro;
pub mod paths;
pub mod voice_native;
pub mod wake;

pub use asr::recognize_wav_file;
pub use cosyvoice::{
    cancel_install, ensure_deps, install_engine, load_modes, plan_install, probe_host, save_modes,
    status as cosyvoice_status, CosyInstallPlan, CosyProbeReport, CosyStatus,
};
pub use cosy_synth::{
    any_backend_ready, probe_backend as probe_cosy_backend, probe_custom_url,
    synthesize as synthesize_cosy, CosyBackendProbe, CosySynthRequest,
};
pub use kokoro::{kokoro_models_ready, kokoro_synthesis_ready, synthesize_to_wav_path, warmup as warmup_kokoro};
pub use paths::{native_engine_root, pack_tts_dir};
pub use voice_native::{
    cancel as cancel_native_install, install as install_native_voice, probe as probe_native_voice,
    status as native_voice_status, VoiceNativeProbe, VoiceNativeStatus,
};