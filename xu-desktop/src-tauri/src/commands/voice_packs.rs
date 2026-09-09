//! 语音包下载、校验、原子安装与本地引擎合成。
//!
//! @author qiuye <yjk150@qq.com>
//! @date 2026-08-30
//! @updated 2026-09-03
//! @version 1.10.0
//! @category Stream
//! @algo SHA256-exact-file-set-atomic-rename

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};

const MAX_PACK_BYTES: u64 = 2 * 1024 * 1024 * 1024;
const MAX_FILE_BYTES: u64 = 1024 * 1024 * 1024;
/// 模型文件最小体积，拒绝占位伪包（此前 7 字节 onnx 会“装完”却不可用）。
const MIN_MODEL_FILE_BYTES: u64 = 64 * 1024;
const MAX_FILES: usize = 512;
const DOWNLOAD_TIMEOUT_SECS: u64 = 30 * 60;
#[derive(Default)]
struct VoicePackInner {
    jobs: Mutex<HashMap<String, Arc<AtomicBool>>>,
    packs: Mutex<HashSet<String>>,
}

#[derive(Default, Clone)]
pub struct VoicePackState(Arc<VoicePackInner>);

struct VoiceJobGuard {
    inner: Arc<VoicePackInner>,
    id: String,
    cancel: Arc<AtomicBool>,
}

impl Drop for VoiceJobGuard {
    fn drop(&mut self) {
        if let Ok(mut jobs) = self.inner.jobs.lock() {
            if jobs
                .get(&self.id)
                .is_some_and(|current| Arc::ptr_eq(current, &self.cancel))
            {
                jobs.remove(&self.id);
            }
        }
    }
}

struct VoicePackGuard {
    inner: Arc<VoicePackInner>,
    id: String,
}

impl Drop for VoicePackGuard {
    fn drop(&mut self) {
        if let Ok(mut packs) = self.inner.packs.lock() {
            packs.remove(&self.id);
        }
    }
}

impl VoicePackState {
    /// 创建语音包任务状态；重复 request ID 被拒绝，guard 析构时精确清理。
    /// 失败: 互斥锁中毒时返回面向用户的任务状态错误。
    fn begin(&self, id: &str) -> Result<VoiceJobGuard, String> {
        let cancel = Arc::new(AtomicBool::new(false));
        let mut jobs = self
            .0
            .jobs
            .lock()
            .map_err(|_| "语音任务状态不可用，请重试".to_string())?;
        if jobs.contains_key(id) {
            return Err("同一语音任务正在运行，请勿重复提交".into());
        }
        jobs.insert(id.to_string(), cancel.clone());
        Ok(VoiceJobGuard {
            inner: Arc::clone(&self.0),
            id: id.to_string(),
            cancel,
        })
    }

    fn acquire_pack(&self, id: &str) -> Result<VoicePackGuard, String> {
        let mut packs = self
            .0
            .packs
            .lock()
            .map_err(|_| "语音包互斥状态不可用，请重试".to_string())?;
        if !packs.insert(id.to_string()) {
            return Err("该语音包已有安装、卸载或合成任务正在运行".into());
        }
        Ok(VoicePackGuard {
            inner: Arc::clone(&self.0),
            id: id.to_string(),
        })
    }

    fn cancel(&self, id: &str) -> bool {
        self.0
            .jobs
            .lock()
            .ok()
            .and_then(|jobs| jobs.get(id).cloned())
            .map(|flag| {
                flag.store(true, Ordering::Relaxed);
                true
            })
            .unwrap_or(false)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VoicePackFile {
    pub path: String,
    pub sha256: String,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VoicePackVoice {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub language: String,
    #[serde(default)]
    pub gender: Option<String>,
    #[serde(default)]
    pub tone_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VoicePackManifest {
    pub id: String,
    pub version: String,
    pub provider: String,
    pub voices: Vec<VoicePackVoice>,
    pub files: Vec<VoicePackFile>,
    pub license_spdx: String,
    pub license_url: String,
    pub source_url: String,
    pub size: u64,
    #[serde(default)]
    pub approved: bool,
    #[serde(default)]
    pub commercial_allowed: bool,
    #[serde(default)]
    pub executable: Option<String>,
    #[serde(default)]
    pub synth_args: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledVoicePack {
    #[serde(flatten)]
    pub manifest: VoicePackManifest,
    pub installed_path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct VoicePackProgress {
    request_id: String,
    stage: String,
    received: u64,
    total: Option<u64>,
    message: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SynthesizeRequest {
    pub request_id: String,
    pub pack_id: String,
    pub text: String,
    pub voice: String,
    pub rate: f32,
    pub pitch: f32,
    pub volume: f32,
    /// 应用语气 id；sidecar 就绪后用于分轨参数（本轮未使用）。
    #[serde(default)]
    pub tone_id: Option<String>,
    /// CosyVoice instruct 预留。
    #[serde(default)]
    pub cosy_instruct: Option<String>,
    /// CosyVoice emotion 预留。
    #[serde(default)]
    pub cosy_emotion: Option<String>,
}

fn packs_root() -> Result<PathBuf, String> {
    let root = crate::xu_paths::xu_home()?.join("voice-packs");
    std::fs::create_dir_all(&root).map_err(|_| "无法创建语音包目录".to_string())?;
    Ok(root)
}

fn safe_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 96
        && value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
        && value != "."
        && value != ".."
}

fn emit_progress(
    app: &AppHandle,
    request_id: &str,
    stage: &str,
    received: u64,
    total: Option<u64>,
    message: &str,
) {
    let _ = app.emit(
        "xu:voice-pack-progress",
        VoicePackProgress {
            request_id: request_id.to_string(),
            stage: stage.to_string(),
            received,
            total,
            message: message.to_string(),
        },
    );
}

#[derive(Clone)]
struct ProgressReporter {
    app: AppHandle,
    request_id: String,
    cancel: Arc<AtomicBool>,
}

impl ProgressReporter {
    fn emit(&self, stage: &str, received: u64, total: Option<u64>, message: &str) {
        emit_progress(&self.app, &self.request_id, stage, received, total, message);
    }

    fn check_cancel(&self) -> Result<(), String> {
        if self.cancel.load(Ordering::Relaxed) {
            Err("安装已取消".into())
        } else {
            Ok(())
        }
    }
}

fn strip_utf8_bom(bytes: &[u8]) -> &[u8] {
    if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        &bytes[3..]
    } else {
        bytes
    }
}

fn read_manifest_json(path: &Path) -> Result<VoicePackManifest, String> {
    let raw = std::fs::read(path).map_err(|_| "语音包缺少 manifest.json".to_string())?;
    let text = strip_utf8_bom(&raw);
    serde_json::from_slice(text).map_err(|_| "语音包 manifest.json 格式错误".to_string())
}

fn is_allowed_pack_extension(extension: &str) -> bool {
    matches!(
        extension,
        "onnx"
            | "bin"
            | "json"
            | "txt"
            | "tokens"
            | "model"
            | "npy"
            | "fst"
            | "far"
            | "dict"
            | "dic"
            | "data"
            | "phontab"
            | "phonindex"
            | "phondata"
            | "intonations"
    )
}

fn validate_manifest(manifest: &VoicePackManifest, risk_accepted: bool) -> Result<(), String> {
    if !safe_id(&manifest.id) {
        return Err("语音包 ID 不合法".into());
    }
    if !matches!(manifest.provider.as_str(), "sherpa-onnx" | "cosyvoice") {
        return Err("语音包 provider 仅支持 sherpa-onnx 或 cosyvoice".into());
    }
    if manifest.files.is_empty() || manifest.files.len() > MAX_FILES {
        return Err("语音包文件数量不合法".into());
    }
    if manifest.size == 0 || manifest.size > MAX_PACK_BYTES {
        return Err("语音包声明大小超出限制".into());
    }
    if manifest.license_spdx.trim().is_empty()
        || manifest.license_url.trim().is_empty()
        || manifest.source_url.trim().is_empty()
    {
        return Err("语音包缺少许可证或来源信息".into());
    }
    if !manifest.commercial_allowed && !risk_accepted {
        return Err("该语音包未标明允许商用；手动安装前必须确认许可风险".into());
    }
    if manifest.executable.is_some() || !manifest.synth_args.is_empty() {
        return Err("语音包只能包含模型数据，不得声明或携带可执行引擎".into());
    }
    let mut declared_paths = HashSet::new();
    let mut has_model = false;
    for file in &manifest.files {
        let path = Path::new(&file.path);
        if path.is_absolute()
            || file.path.contains('\\')
            || path
                .components()
                .any(|part| matches!(part, std::path::Component::ParentDir))
            || file.sha256.len() != 64
            || file.size > MAX_FILE_BYTES
        {
            return Err(format!("语音包文件声明不安全：{}", file.path));
        }
        if !declared_paths.insert(file.path.to_ascii_lowercase()) {
            return Err(format!("语音包重复声明文件：{}", file.path));
        }
        let extension = path
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        if !is_allowed_pack_extension(&extension) {
            return Err(format!("语音包包含非模型数据文件：{}", file.path));
        }
        if extension == "onnx" || extension == "model" {
            has_model = true;
            if file.size < MIN_MODEL_FILE_BYTES {
                return Err(format!(
                    "语音包模型文件过小（{} 字节），不是有效模型；请重新下载官方语音包",
                    file.size
                ));
            }
        }
    }
    if !has_model {
        return Err("语音包缺少 onnx/model 模型文件".into());
    }
    Ok(())
}

fn hash_file(path: &Path) -> Result<(String, u64), String> {
    let mut file = File::open(path).map_err(|_| "无法读取语音包文件".to_string())?;
    let mut hash = Sha256::new();
    let mut size = 0_u64;
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|_| "读取语音包文件失败".to_string())?;
        if read == 0 {
            break;
        }
        size += read as u64;
        hash.update(&buffer[..read]);
    }
    Ok((hex::encode(hash.finalize()), size))
}

fn validate_exact_file_set(
    manifest: &VoicePackManifest,
    actual_files: &HashSet<String>,
) -> Result<(), String> {
    let declared_files: HashSet<String> = manifest
        .files
        .iter()
        .map(|file| file.path.to_ascii_lowercase())
        .collect();
    if actual_files != &declared_files {
        return Err("语音包实际文件集合与 manifest.files 不完全一致".into());
    }
    Ok(())
}

fn collect_installed_files(
    root: &Path,
    dir: &Path,
    files: &mut HashSet<String>,
) -> Result<(), String> {
    for entry in std::fs::read_dir(dir).map_err(|_| "无法读取语音包目录".to_string())? {
        let entry = entry.map_err(|_| "无法读取语音包目录项".to_string())?;
        let metadata = entry
            .file_type()
            .map_err(|_| "无法读取语音包文件类型".to_string())?;
        if metadata.is_symlink() {
            return Err("语音包不得包含符号链接".into());
        }
        if metadata.is_dir() {
            collect_installed_files(root, &entry.path(), files)?;
        } else if metadata.is_file() {
            let relative = entry
                .path()
                .strip_prefix(root)
                .map_err(|_| "语音包文件路径越界".to_string())?
                .to_string_lossy()
                .replace('\\', "/")
                .to_ascii_lowercase();
            if relative != "manifest.json" && !files.insert(relative.clone()) {
                return Err(format!("语音包包含重复文件：{relative}"));
            }
        } else {
            return Err("语音包包含不支持的文件类型".into());
        }
    }
    Ok(())
}

fn verify_installed_pack(root: &Path, manifest: &VoicePackManifest) -> Result<(), String> {
    validate_manifest(manifest, true)?;
    let mut actual = HashSet::new();
    collect_installed_files(root, root, &mut actual)?;
    validate_exact_file_set(manifest, &actual)?;
    for file in &manifest.files {
        let (hash, size) = hash_file(&root.join(&file.path))?;
        if size != file.size || !hash.eq_ignore_ascii_case(&file.sha256) {
            return Err(format!("语音包文件校验失败：{}", file.path));
        }
    }
    Ok(())
}

fn unpack_and_verify(
    archive: &Path,
    staging: &Path,
    risk_accepted: bool,
    reporter: Option<&ProgressReporter>,
) -> Result<VoicePackManifest, String> {
    let file = File::open(archive).map_err(|_| "无法打开下载的语音包".to_string())?;
    let mut zip = zip::ZipArchive::new(file).map_err(|_| "语音包不是有效 ZIP 文件".to_string())?;
    if zip.len() > MAX_FILES + 1 {
        return Err("语音包文件数量超出限制".into());
    }
    std::fs::create_dir_all(staging).map_err(|_| "无法创建语音包临时目录".to_string())?;

    let mut total_uncompressed = 0_u64;
    for index in 0..zip.len() {
        let entry = zip
            .by_index(index)
            .map_err(|_| "读取语音包条目失败".to_string())?;
        if !entry.is_dir() {
            total_uncompressed = total_uncompressed.saturating_add(entry.size());
        }
    }

    let file = File::open(archive).map_err(|_| "无法打开下载的语音包".to_string())?;
    let mut zip = zip::ZipArchive::new(file).map_err(|_| "语音包不是有效 ZIP 文件".to_string())?;
    let mut unpacked = 0_u64;
    let mut archive_files = HashSet::new();
    let extract_total = total_uncompressed.max(1);
    if let Some(reporter) = reporter {
        reporter.emit("extracting", 0, Some(extract_total), "正在解压语音包");
    }
    for index in 0..zip.len() {
        reporter.as_ref().map(|r| r.check_cancel()).transpose()?;
        let mut entry = zip
            .by_index(index)
            .map_err(|_| "读取语音包条目失败".to_string())?;
        let rel = entry
            .enclosed_name()
            .ok_or_else(|| "语音包包含不安全路径".to_string())?
            .to_owned();
        if entry.is_symlink() {
            return Err("语音包不得包含符号链接".into());
        }
        let output = staging.join(&rel);
        if entry.is_dir() {
            std::fs::create_dir_all(&output).map_err(|_| "创建语音包目录失败".to_string())?;
            continue;
        }
        let rel_text = rel.to_string_lossy().replace('\\', "/");
        let rel_key = rel_text.to_ascii_lowercase();
        if !archive_files.insert(rel_key.clone()) {
            return Err(format!("语音包包含重复文件：{rel_text}"));
        }
        if rel_key != "manifest.json" {
            let extension = rel
                .extension()
                .and_then(|value| value.to_str())
                .unwrap_or("")
                .to_ascii_lowercase();
            if !is_allowed_pack_extension(&extension) {
                return Err(format!("语音包包含禁止执行或脚本文件：{rel_text}"));
            }
        }
        let entry_size = entry.size();
        unpacked = unpacked.saturating_add(entry_size);
        if unpacked > MAX_PACK_BYTES {
            return Err("语音包解压大小超出限制".into());
        }
        if let Some(parent) = output.parent() {
            std::fs::create_dir_all(parent).map_err(|_| "创建语音包目录失败".to_string())?;
        }
        let mut target = File::create(&output).map_err(|_| "写入语音包文件失败".to_string())?;
        std::io::copy(&mut entry, &mut target).map_err(|_| "解压语音包失败".to_string())?;
        target
            .flush()
            .map_err(|_| "保存语音包文件失败".to_string())?;
        if let Some(reporter) = reporter {
            reporter.emit(
                "extracting",
                unpacked.min(extract_total),
                Some(extract_total),
                "正在解压语音包",
            );
        }
    }
    let manifest_path = staging.join("manifest.json");
    let manifest = read_manifest_json(&manifest_path)?;
    validate_manifest(&manifest, risk_accepted)?;
    archive_files.remove("manifest.json");
    validate_exact_file_set(&manifest, &archive_files)?;
    let file_count = manifest.files.len() as u64;
    let verify_total = file_count.max(1);
    if let Some(reporter) = reporter {
        reporter.emit("verifying", 0, Some(verify_total), "正在校验文件");
    }
    let mut declared_size = 0_u64;
    for (index, declared) in manifest.files.iter().enumerate() {
        reporter.as_ref().map(|r| r.check_cancel()).transpose()?;
        let path = staging.join(&declared.path);
        let (actual_hash, actual_size) = hash_file(&path)?;
        if !actual_hash.eq_ignore_ascii_case(&declared.sha256) || actual_size != declared.size {
            return Err(format!("语音包文件校验失败：{}", declared.path));
        }
        declared_size = declared_size.saturating_add(actual_size);
        if let Some(reporter) = reporter {
            reporter.emit(
                "verifying",
                (index as u64 + 1).min(verify_total),
                Some(verify_total),
                "正在校验文件",
            );
        }
    }
    if declared_size != manifest.size {
        return Err("语音包总大小与 manifest 声明不一致".into());
    }
    Ok(manifest)
}

fn download_cache_key(source: &str) -> String {
    hex::encode(Sha256::digest(source.as_bytes()))
}

fn download_part_path(temp_root: &Path, source: &str) -> PathBuf {
    temp_root
        .join("downloads")
        .join(format!("{}.zip.part", download_cache_key(source)))
}

fn download_meta_path(temp_root: &Path, source: &str) -> PathBuf {
    temp_root
        .join("downloads")
        .join(format!("{}.json", download_cache_key(source)))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DownloadResumeMeta {
    url: String,
    received: u64,
    total: Option<u64>,
}

fn read_download_resume(temp_root: &Path, source: &str) -> (u64, Option<u64>) {
    let part = download_part_path(temp_root, source);
    let meta_path = download_meta_path(temp_root, source);
    let received = std::fs::metadata(&part).map(|m| m.len()).unwrap_or(0);
    if received == 0 {
        return (0, None);
    }
    if let Ok(file) = File::open(&meta_path) {
        if let Ok(meta) = serde_json::from_reader::<_, DownloadResumeMeta>(file) {
            if meta.url == source {
                return (received.max(meta.received), meta.total);
            }
        }
    }
    (received, None)
}

fn write_download_resume(
    temp_root: &Path,
    source: &str,
    received: u64,
    total: Option<u64>,
) -> Result<(), String> {
    std::fs::create_dir_all(temp_root.join("downloads"))
        .map_err(|_| "无法创建下载缓存目录".to_string())?;
    let meta = DownloadResumeMeta {
        url: source.to_string(),
        received,
        total,
    };
    let data = serde_json::to_vec(&meta).map_err(|_| "无法保存下载进度".to_string())?;
    std::fs::write(download_meta_path(temp_root, source), data)
        .map_err(|_| "无法保存下载进度".to_string())
}

fn clear_download_resume(temp_root: &Path, source: &str) {
    let _ = std::fs::remove_file(download_part_path(temp_root, source));
    let _ = std::fs::remove_file(download_meta_path(temp_root, source));
}

async fn copy_source(
    app: &AppHandle,
    source: &str,
    target: &Path,
    request_id: &str,
    cancel: &AtomicBool,
    temp_root: &Path,
) -> Result<(), String> {
    let parsed = reqwest::Url::parse(source).map_err(|_| "下载地址格式不正确".to_string())?;
    if !matches!(parsed.scheme(), "http" | "https" | "file") {
        return Err("只允许 http、https 或 file 下载地址".into());
    }
    std::fs::create_dir_all(temp_root.join("downloads"))
        .map_err(|_| "无法创建下载缓存目录".to_string())?;
    let (mut received, resume_total) = if target == &download_part_path(temp_root, source) {
        read_download_resume(temp_root, source)
    } else {
        (0, None)
    };
    let resuming = received > 0;
    let mut output = if received > 0 {
        tokio::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(target)
            .await
            .map_err(|_| "无法打开续传临时文件".to_string())?
    } else {
        tokio::fs::File::create(target)
            .await
            .map_err(|_| "无法创建下载临时文件".to_string())?
    };
    if parsed.scheme() == "file" {
        let path = parsed
            .to_file_path()
            .map_err(|_| "本地 file 地址格式不正确".to_string())?;
        let total = tokio::fs::metadata(&path)
            .await
            .map_err(|_| "无法读取本地语音包".to_string())?
            .len();
        if total > MAX_PACK_BYTES {
            return Err("语音包超过 2 GB 限制".into());
        }
        if received >= total {
            write_download_resume(temp_root, source, total, Some(total))?;
            return Ok(());
        }
        let mut input = tokio::fs::File::open(&path)
            .await
            .map_err(|_| "无法打开本地语音包".to_string())?;
        if received > 0 {
            use tokio::io::AsyncSeekExt;
            input
                .seek(std::io::SeekFrom::Start(received))
                .await
                .map_err(|_| "无法续传本地语音包".to_string())?;
        }
        let mut buffer = vec![0_u8; 64 * 1024];
        loop {
            if cancel.load(Ordering::Relaxed) {
                write_download_resume(temp_root, source, received, Some(total))?;
                return Err("安装已取消".into());
            }
            let read = tokio::io::AsyncReadExt::read(&mut input, &mut buffer)
                .await
                .map_err(|_| "读取本地语音包失败".to_string())?;
            if read == 0 {
                break;
            }
            tokio::io::AsyncWriteExt::write_all(&mut output, &buffer[..read])
                .await
                .map_err(|_| "写入下载临时文件失败".to_string())?;
            received += read as u64;
            emit_progress(
                app,
                request_id,
                "downloading",
                received,
                Some(total),
                if resuming {
                    "续传复制语音包"
                } else {
                    "正在复制语音包"
                },
            );
        }
        write_download_resume(temp_root, source, received, Some(total))?;
    } else {
        let client = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(15))
            .timeout(Duration::from_secs(DOWNLOAD_TIMEOUT_SECS))
            .redirect(reqwest::redirect::Policy::limited(5))
            .build()
            .map_err(|_| "无法初始化下载器".to_string())?;
        let mut request = client.get(parsed.clone());
        if received > 0 {
            request = request.header(reqwest::header::RANGE, format!("bytes={received}-"));
        }
        let response = request
            .send()
            .await
            .map_err(|_| "语音包下载失败，请检查网络和地址".to_string())?;
        if response.status() == reqwest::StatusCode::RANGE_NOT_SATISFIABLE {
            received = 0;
            output = tokio::fs::File::create(target)
                .await
                .map_err(|_| "无法重建下载临时文件".to_string())?;
            let response = client
                .get(parsed)
                .send()
                .await
                .map_err(|_| "语音包下载失败，请检查网络和地址".to_string())?;
            if !response.status().is_success() {
                return Err(format!(
                    "语音包下载失败（HTTP {}）",
                    response.status().as_u16()
                ));
            }
            let total = response.content_length();
            if total.is_some_and(|value| value > MAX_PACK_BYTES) {
                return Err("语音包超过 2 GB 限制".into());
            }
            let mut stream = response.bytes_stream();
            while let Some(chunk) = stream.next().await {
                if cancel.load(Ordering::Relaxed) {
                    write_download_resume(temp_root, source, received, total)?;
                    return Err("安装已取消".into());
                }
                let bytes = chunk.map_err(|_| "下载中断，请重试".to_string())?;
                received = received.saturating_add(bytes.len() as u64);
                if received > MAX_PACK_BYTES {
                    return Err("语音包超过 2 GB 限制".into());
                }
                tokio::io::AsyncWriteExt::write_all(&mut output, &bytes)
                    .await
                    .map_err(|_| "保存下载文件失败".to_string())?;
                write_download_resume(temp_root, source, received, total)?;
                emit_progress(
                    app,
                    request_id,
                    "downloading",
                    received,
                    total,
                    "正在下载语音包",
                );
            }
        } else if !response.status().is_success() {
            return Err(format!(
                "语音包下载失败（HTTP {}）",
                response.status().as_u16()
            ));
        } else {
            let status = response.status();
            let chunk_total = response.content_length();
            let total = if status == reqwest::StatusCode::PARTIAL_CONTENT {
                chunk_total
                    .map(|value| value.saturating_add(received))
                    .or(resume_total)
            } else {
                chunk_total.or(resume_total)
            };
            if status == reqwest::StatusCode::OK && received > 0 {
                received = 0;
                output = tokio::fs::File::create(target)
                    .await
                    .map_err(|_| "无法重建下载临时文件".to_string())?;
            }
            if total.is_some_and(|value| value > MAX_PACK_BYTES) {
                return Err("语音包超过 2 GB 限制".into());
            }
            let resuming_http = status == reqwest::StatusCode::PARTIAL_CONTENT;
            let mut stream = response.bytes_stream();
            while let Some(chunk) = stream.next().await {
                if cancel.load(Ordering::Relaxed) {
                    write_download_resume(temp_root, source, received, total)?;
                    return Err("安装已取消".into());
                }
                let bytes = chunk.map_err(|_| "下载中断，请重试".to_string())?;
                received = received.saturating_add(bytes.len() as u64);
                if received > MAX_PACK_BYTES {
                    return Err("语音包超过 2 GB 限制".into());
                }
                tokio::io::AsyncWriteExt::write_all(&mut output, &bytes)
                    .await
                    .map_err(|_| "保存下载文件失败".to_string())?;
                write_download_resume(temp_root, source, received, total)?;
                emit_progress(
                    app,
                    request_id,
                    "downloading",
                    received,
                    total,
                    if resuming_http {
                        "续传下载语音包"
                    } else {
                        "正在下载语音包"
                    },
                );
            }
        }
    }
    tokio::io::AsyncWriteExt::flush(&mut output)
        .await
        .map_err(|_| "保存下载文件失败".to_string())?;
    write_download_resume(temp_root, source, received, None)?;
    Ok(())
}

const MAX_CATALOG_FETCH_BYTES: usize = 2 * 1024 * 1024;

/// 拉取语音包 catalog.json（Rust reqwest，绕过 WebView 跨域限制）。
/// 路由: 前端 invoke；仅允许 http/https；失败返回 HTTP 状态或网络错误文案。
#[tauri::command]
pub async fn xu_voice_pack_fetch_url_text(url: String) -> Result<String, String> {
    let url = url.trim();
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err("目录地址须为 http 或 https".into());
    }
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()
        .map_err(|e| e.to_string())?;
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("目录拉取失败: {e}"))?;
    let status = response.status();
    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("读取目录失败: {e}"))?;
    if bytes.len() > MAX_CATALOG_FETCH_BYTES {
        return Err("目录文件过大".into());
    }
    if !status.is_success() {
        return Err(format!("目录 HTTP {}", status.as_u16()));
    }
    String::from_utf8(bytes.to_vec()).map_err(|_| "目录不是有效 UTF-8".into())
}

/// 将用户选择的 ZIP 复制到 `{XU_HOME}/voice-packs-incoming` 并返回 file:// URL。
/// 依赖: 源路径可读；失败返回面向用户的复制/格式错误。
#[tauri::command]
pub fn xu_voice_pack_stage_local(source_path: String) -> Result<String, String> {
    let src = PathBuf::from(source_path.trim());
    if !src.is_file() {
        return Err("所选文件不存在".into());
    }
    let ext = src
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if ext != "zip" {
        return Err("请选择 ZIP 格式的语音包".into());
    }
    let home = crate::xu_paths::xu_home()?;
    let staging = home.join("voice-packs-incoming");
    std::fs::create_dir_all(&staging).map_err(|_| "无法创建语音包暂存目录".to_string())?;
    let name = src
        .file_name()
        .ok_or_else(|| "无效文件名".to_string())?
        .to_string_lossy()
        .into_owned();
    let dest = staging.join(&name);
    std::fs::copy(&src, &dest).map_err(|_| "无法复制语音包到应用目录".to_string())?;
    let abs = dest
        .canonicalize()
        .map_err(|_| "无法解析暂存路径".to_string())?;
    let path = abs.to_string_lossy().replace('\\', "/");
    Ok(format!("file:///{path}"))
}

/// 列出 `{XU_HOME}/voice-packs` 中已校验安装的语音包。
/// 依赖: 每个包根目录的 manifest.json；损坏目录会被跳过而不阻断设置页。
#[tauri::command]
pub fn xu_voice_pack_list() -> Result<Vec<InstalledVoicePack>, String> {
    let root = packs_root()?;
    let mut result = Vec::new();
    for entry in std::fs::read_dir(root)
        .map_err(|_| "无法读取语音包目录".to_string())?
        .flatten()
    {
        let path = entry.path();
        if !path.is_dir() || entry.file_name().to_string_lossy().starts_with('.') {
            continue;
        }
        let Ok(manifest) = read_manifest_json(&path.join("manifest.json")) else {
            continue;
        };
        if verify_installed_pack(&path, &manifest).is_err() {
            continue;
        }
        result.push(InstalledVoicePack {
            manifest,
            installed_path: path.to_string_lossy().into_owned(),
        });
    }
    result.sort_by(|a, b| a.manifest.id.cmp(&b.manifest.id));
    Ok(result)
}

/// 从用户 URL 安装 ZIP 语音包，并经 SHA256 校验后原子替换目标目录。
/// 依赖: `xu:voice-pack-progress`；失败时清理临时文件，未授权包必须 riskAccepted。
#[tauri::command]
pub async fn xu_voice_pack_install(
    app: AppHandle,
    state: State<'_, VoicePackState>,
    url: String,
    request_id: String,
    risk_accepted: bool,
) -> Result<InstalledVoicePack, String> {
    if !safe_id(&request_id) {
        return Err("语音包任务 ID 不合法".into());
    }
    let job = state.begin(&request_id)?;
    let reporter = ProgressReporter {
        app: app.clone(),
        request_id: request_id.clone(),
        cancel: job.cancel.clone(),
    };
    let root = packs_root()?;
    let temp_root = root.join(".tmp");
    std::fs::create_dir_all(&temp_root).map_err(|_| "无法创建下载临时目录".to_string())?;
    let archive = download_part_path(&temp_root, &url);
    let staging = temp_root.join(format!("{request_id}.install"));
    let url_for_cleanup = url.clone();
    let outcome = async {
        emit_progress(&app, &request_id, "starting", 0, None, "准备下载");
        copy_source(
            &app,
            &url,
            &archive,
            &request_id,
            &job.cancel,
            &temp_root,
        )
        .await?;
        if job.cancel.load(Ordering::Relaxed) {
            return Err("安装已取消".into());
        }
        let archive_size = std::fs::metadata(&archive).map(|meta| meta.len()).unwrap_or(0);
        reporter.emit(
            "downloading",
            archive_size,
            Some(archive_size.max(1)),
            "下载完成",
        );
        let archive_clone = archive.clone();
        let staging_clone = staging.clone();
        let reporter_clone = reporter.clone();
        let manifest = tokio::task::spawn_blocking(move || {
            unpack_and_verify(
                &archive_clone,
                &staging_clone,
                risk_accepted,
                Some(&reporter_clone),
            )
        })
        .await
        .map_err(|_| "语音包校验任务异常".to_string())??;
        if job.cancel.load(Ordering::Relaxed) {
            return Err("安装已取消".into());
        }
        let _pack_guard = state.acquire_pack(&manifest.id)?;
        let target = root.join(&manifest.id);
        let backup = temp_root.join(format!("{}.backup", manifest.id));
        if backup.exists() {
            let _ = std::fs::remove_dir_all(&backup);
        }
        if target.exists() {
            std::fs::rename(&target, &backup).map_err(|_| "无法替换已安装语音包".to_string())?;
        }
        if let Err(error) = std::fs::rename(&staging, &target) {
            if backup.exists() {
                let _ = std::fs::rename(&backup, &target);
            }
            return Err(format!("语音包原子安装失败：{error}"));
        }
        let _ = std::fs::remove_dir_all(&backup);
        emit_progress(
            &app,
            &request_id,
            "done",
            manifest.size,
            Some(manifest.size),
            "安装完成",
        );
        Ok(InstalledVoicePack {
            manifest,
            installed_path: target.to_string_lossy().into_owned(),
        })
    }
    .await;
    let _ = std::fs::remove_dir_all(&staging);
    if outcome.is_ok() {
        clear_download_resume(&temp_root, &url_for_cleanup);
        let _ = std::fs::remove_file(&archive);
    }
    outcome
}

/// 取消下载或本地语音合成任务。
/// 依赖: requestId 对应当前进程内任务；任务已结束时返回 false，不视为错误。
#[tauri::command]
pub fn xu_voice_task_cancel(state: State<'_, VoicePackState>, request_id: String) -> bool {
    state.cancel(&request_id)
}

/// 卸载指定语音包目录，不影响其它包与用户语音设置。
/// 依赖: 安全 packId；失败时保留原目录并返回友好错误。
#[tauri::command]
pub fn xu_voice_pack_uninstall(
    state: State<'_, VoicePackState>,
    pack_id: String,
) -> Result<(), String> {
    if !safe_id(&pack_id) {
        return Err("语音包 ID 不合法".into());
    }
    let _pack_guard = state.acquire_pack(&pack_id)?;
    let target = packs_root()?.join(pack_id);
    if target.exists() {
        std::fs::remove_dir_all(target)
            .map_err(|_| "卸载失败，语音包文件可能正被占用".to_string())?;
    }
    Ok(())
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceEngineStatus {
    pub provider: String,
    pub pack_installed: bool,
    /// Kokoro 模型齐全时为 true（sherpa-onnx 轨道）；Cosy 为当前后端探测成功。
    pub synthesis_available: bool,
    pub reason: String,
}

/// 查询离线引擎能力：是否已装包、是否可合成。
/// 依赖: `{XU_HOME}/voice-packs` 与可选 `{XU_HOME}/voice-engines/native` / Cosy 后端。
#[tauri::command]
pub fn xu_voice_engine_status(
    db: State<'_, crate::desktop_db::FouDb>,
    provider: String,
    cosy_backend: Option<String>,
    cosy_custom_base_url: Option<String>,
) -> Result<VoiceEngineStatus, String> {
    let provider = provider.trim().to_string();
    if !matches!(provider.as_str(), "sherpa-onnx" | "cosyvoice") {
        return Err("仅支持 sherpa-onnx 或 cosyvoice".into());
    }
    let packs = xu_voice_pack_list()?;
    let pack_installed = packs.iter().any(|pack| pack.manifest.provider == provider);
    if provider == "cosyvoice" {
        let backend = cosy_backend.unwrap_or_else(|| "local".into());
        let url = cosy_custom_base_url.unwrap_or_default();
        let ready = crate::voice::any_backend_ready(&db, backend.trim(), url.trim());
        let local_phase = crate::voice::cosyvoice::status().phase;
        let env_present = crate::voice::cosy_discover::cosy_env_present();
        let installed = pack_installed || local_phase == "ready" || env_present || ready;
        let reason = if ready {
            format!("CosyVoice 后端「{backend}」可用。")
        } else if local_phase == "ready" || env_present {
            "本机 CosyVoice 环境已就绪，但当前服务/后端未在跑；请到 CosyVoice 页启动服务或探测。".into()
        } else if pack_installed {
            "已装语音包，请完成协助安装或启动 FastAPI / 配置云端后端。".into()
        } else {
            "尚未安装 CosyVoice 扩展（协助安装或自动检测路径）。".into()
        };
        return Ok(VoiceEngineStatus {
            provider,
            pack_installed: installed,
            synthesis_available: ready,
            reason,
        });
    }
    // sherpa-onnx 轨道：ASR=Sherpa，朗读=Kokoro；中文音素已内置，不强制 espeak。
    let pack_root = packs
        .iter()
        .find(|p| p.manifest.provider == "sherpa-onnx")
        .map(|p| PathBuf::from(&p.installed_path));
    let models_ok = crate::voice::kokoro_models_ready(pack_root.as_deref());
    #[cfg(any(feature = "native-voice", feature = "native-tts"))]
    let ready = models_ok;
    #[cfg(not(any(feature = "native-voice", feature = "native-tts")))]
    let ready = false;
    let reason = if ready {
        "离线 Kokoro TTS 已就绪（中文内置音素；仅包内音色）。".to_string()
    } else if models_ok {
        "已检测到 Kokoro 模型，但当前构建未启用 native-tts（请在 tauri.conf.json build.features 加入 native-tts 后重编）。".to_string()
    } else if pack_installed {
        "已装语音包，但缺少 kokoro-v1.0.int8.onnx / voices-v1.0.bin。请点「一键安装离线语音」。".to_string()
    } else {
        "尚未安装离线 ASR/TTS。请在设置页点「一键安装离线语音」（写入 XU_HOME/voice-engines/native）。"
            .to_string()
    };
    Ok(VoiceEngineStatus {
        provider,
        pack_installed: pack_installed || models_ok,
        synthesis_available: ready,
        reason,
    })
}

/// 使用进程内 Kokoro（sherpa-onnx）合成 WAV；无 Python sidecar。
/// 依赖: 已校验的纯模型数据包；绝不执行包内文件或 manifest 自声明命令。
#[tauri::command]
pub async fn xu_voice_synthesize(
    state: State<'_, VoicePackState>,
    request: SynthesizeRequest,
) -> Result<String, String> {
    if !safe_id(&request.request_id) {
        return Err("语音合成任务 ID 不合法".into());
    }
    if request.text.trim().is_empty() || request.text.chars().count() > 20_000 {
        return Err("试听文本为空或过长".into());
    }
    if !safe_id(&request.pack_id) {
        return Err("语音包 ID 不合法".into());
    }
    let use_native = request.pack_id == "native";
    let pack_root = if use_native {
        None
    } else {
        let pack_root = packs_root()?.join(&request.pack_id);
        let manifest = read_manifest_json(&pack_root.join("manifest.json")).map_err(|e| {
            if e.contains("缺少") {
                "所选离线语音包未安装".to_string()
            } else if e.contains("格式") {
                "所选语音包清单损坏".to_string()
            } else {
                e
            }
        })?;
        validate_manifest(&manifest, true)?;
        if !manifest
            .voices
            .iter()
            .any(|voice| voice.id == request.voice)
            && !request.voice.starts_with("zf_")
            && !request.voice.starts_with("zm_")
            && !request
                .tone_id
                .as_ref()
                .map(|t| !t.is_empty())
                .unwrap_or(false)
        {
            return Err("所选声音不属于该语音包".into());
        }
        if manifest.provider == "cosyvoice" {
            return Err(
                "CosyVoice 合成需协助安装完成且引擎 ready；当前请用离线 Kokoro 或系统语音。"
                    .into(),
            );
        }
        Some(pack_root)
    };
    if use_native && !crate::voice::kokoro_models_ready(None) {
        return Err("尚未一键安装离线 TTS（缺少 Kokoro 模型）".into());
    }
    let _job = state.begin(&request.request_id)?;
    let _pack_guard = if use_native {
        None
    } else {
        Some(state.acquire_pack(&request.pack_id)?)
    };
    let voice_key = if !request.voice.trim().is_empty() {
        request.voice.as_str()
    } else {
        request
            .tone_id
            .as_deref()
            .filter(|s| !s.is_empty())
            .unwrap_or("zf_xiaoxiao")
    };
    let path = tokio::task::spawn_blocking({
        let text = request.text.clone();
        let voice = voice_key.to_string();
        let rate = request.rate;
        let root = pack_root.clone();
        move || crate::voice::synthesize_to_wav_path(root.as_deref(), &text, &voice, rate)
    })
    .await
    .map_err(|e| format!("合成任务中断: {e}"))??;
    Ok(path.to_string_lossy().into_owned())
}

/// 预热 Kokoro（加载 ORT 优化图 + 合成短句），减少首次试听等待。
#[tauri::command]
pub async fn xu_voice_warmup_kokoro(voice: Option<String>) -> Result<(), String> {
    let voice = voice.unwrap_or_else(|| "zf_xiaoxiao".into());
    tokio::task::spawn_blocking(move || crate::voice::warmup_kokoro(None, &voice))
        .await
        .map_err(|e| format!("预热中断: {e}"))?
}

/// 将 `{TEMP}/xu-voice/*.wav` 读成 data URL，供 WebView 播放（绕过 asset 协议限制）。
#[tauri::command]
pub fn xu_voice_temp_wav_data_url(path: String) -> Result<String, String> {
    use base64::Engine;
    let p = PathBuf::from(path.trim());
    if !p.is_file() {
        return Err("音频文件不存在".into());
    }
    let allowed = std::env::temp_dir().join("xu-voice");
    let allowed = allowed
        .canonicalize()
        .unwrap_or(allowed);
    let canon = p.canonicalize().map_err(|e| format!("无法解析音频路径: {e}"))?;
    if !canon.starts_with(&allowed) {
        return Err("仅允许播放本机临时目录中的合成音频".into());
    }
    if canon.extension().and_then(|e| e.to_str()) != Some("wav") {
        return Err("仅支持 wav".into());
    }
    let bytes = std::fs::read(&canon).map_err(|e| format!("读取音频失败: {e}"))?;
    if bytes.len() < 44 {
        return Err("音频文件过小或损坏".into());
    }
    Ok(format!(
        "data:audio/wav;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    ))
}

/// 离线 ASR：识别本机 wav 文件。
#[tauri::command]
pub async fn xu_voice_asr_file(pack_id: String, wav_path: String) -> Result<String, String> {
    if !safe_id(&pack_id) {
        return Err("语音包 ID 不合法".into());
    }
    let wav = PathBuf::from(&wav_path);
    if pack_id == "native" {
        return tokio::task::spawn_blocking(move || crate::voice::recognize_wav_file(None, &wav))
            .await
            .map_err(|e| format!("识别任务中断: {e}"))?;
    }
    let pack_root = packs_root()?.join(&pack_id);
    if !pack_root.is_dir() {
        return Err("所选离线语音包未安装".into());
    }
    tokio::task::spawn_blocking(move || {
        crate::voice::recognize_wav_file(Some(&pack_root), &wav)
    })
    .await
    .map_err(|e| format!("识别任务中断: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_traversal_executables_scripts_and_self_approval() {
        let mut manifest = VoicePackManifest {
            id: "demo".into(),
            version: "1.0.0".into(),
            provider: "sherpa-onnx".into(),
            voices: vec![],
            files: vec![VoicePackFile {
                path: "../engine.exe".into(),
                sha256: "0".repeat(64),
                size: 1,
            }],
            license_spdx: "LicenseRef-Unknown".into(),
            license_url: "https://example.invalid/license".into(),
            source_url: "https://example.invalid/source".into(),
            size: 1,
            approved: false,
            commercial_allowed: false,
            executable: None,
            synth_args: vec![],
        };
        assert!(validate_manifest(&manifest, true).is_err());
        manifest.files[0].path = "engine.exe".into();
        assert!(validate_manifest(&manifest, true).is_err());
        manifest.files[0].path = "install.ps1".into();
        assert!(validate_manifest(&manifest, true).is_err());
        manifest.files[0].path = "model.onnx".into();
        manifest.files[0].size = MIN_MODEL_FILE_BYTES;
        manifest.size = MIN_MODEL_FILE_BYTES;
        manifest.approved = true;
        assert!(validate_manifest(&manifest, false).is_err());
        assert!(validate_manifest(&manifest, true).is_ok());
        manifest.files[0].size = 7;
        manifest.size = 7;
        assert!(
            validate_manifest(&manifest, true).is_err(),
            "placeholder tiny onnx must be rejected"
        );
        manifest.files[0].size = MIN_MODEL_FILE_BYTES;
        manifest.size = MIN_MODEL_FILE_BYTES;
        manifest.executable = Some("model.onnx".into());
        assert!(validate_manifest(&manifest, true).is_err());
    }

    #[test]
    fn exact_manifest_set_rejects_undeclared_files() {
        let manifest = VoicePackManifest {
            id: "demo".into(),
            version: "1".into(),
            provider: "sherpa-onnx".into(),
            voices: vec![],
            files: vec![VoicePackFile {
                path: "model.onnx".into(),
                sha256: "0".repeat(64),
                size: 1,
            }],
            license_spdx: "Apache-2.0".into(),
            license_url: "https://example.invalid/license".into(),
            source_url: "https://example.invalid/source".into(),
            size: 1,
            approved: false,
            commercial_allowed: true,
            executable: None,
            synth_args: vec![],
        };
        let actual = HashSet::from(["model.onnx".into(), "extra.json".into()]);
        assert!(validate_exact_file_set(&manifest, &actual).is_err());
    }

    #[test]
    fn unpack_rejects_archive_with_embedded_executable() {
        use zip::write::SimpleFileOptions;

        let root = std::env::temp_dir().join(format!("xu-voice-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let archive = root.join("malicious.zip");
        let staging = root.join("staging");
        {
            let file = File::create(&archive).unwrap();
            let mut writer = zip::ZipWriter::new(file);
            let options = SimpleFileOptions::default();
            writer.start_file("manifest.json", options).unwrap();
            writer.write_all(b"{}").unwrap();
            writer.start_file("payload.exe", options).unwrap();
            writer.write_all(b"MZ").unwrap();
            writer.finish().unwrap();
        }
        let result = unpack_and_verify(&archive, &staging, true, None);
        let _ = std::fs::remove_dir_all(&root);
        assert!(result.is_err());
    }

    #[test]
    fn download_cache_key_is_stable() {
        let a = download_cache_key("https://example.com/a.zip");
        let b = download_cache_key("https://example.com/a.zip");
        assert_eq!(a, b);
        assert_ne!(a, download_cache_key("https://example.com/b.zip"));
    }

    #[test]
    fn jobs_and_pack_ids_are_mutually_exclusive_and_raii_cleaned() {
        let state = VoicePackState::default();
        let job = state.begin("request").unwrap();
        assert!(state.begin("request").is_err());
        assert!(state.cancel("request"));
        drop(job);
        assert!(state.begin("request").is_ok());

        let pack = state.acquire_pack("pack").unwrap();
        assert!(state.acquire_pack("pack").is_err());
        drop(pack);
        assert!(state.acquire_pack("pack").is_ok());
    }
}
