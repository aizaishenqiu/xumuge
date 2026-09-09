//! `.xutrain` ZIP 读写、路径约束与 SHA-256 完整性校验。
//!
//! @author qiuye <yjk150@qq.com>
//! @date 2026-08-31
//! @version 1.0.0
//! @category Crypto
//! @algo SHA256

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::fs::File;
use std::io::{Read, Write};
use std::path::Path;
use zip::write::SimpleFileOptions;

const MAX_FILE_BYTES: usize = 8 * 1024 * 1024;
const MAX_PACK_BYTES: usize = 32 * 1024 * 1024;
const MAX_FILES: usize = 64;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrainingPackTextFile {
    pub name: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrainingPackReadResult {
    pub files: Vec<TrainingPackTextFile>,
    pub verified: bool,
}

fn safe_name(name: &str) -> bool {
    let n = name.replace('\\', "/");
    !n.is_empty()
        && !n.starts_with('/')
        && !n.contains("../")
        && !n.contains(":/")
        && matches!(
            n.as_str(),
            "manifest.json"
                | "curriculum.json"
                | "playbooks.json"
                | "README.md"
                | "samples/outcomes.json"
                | "eval/suites.json"
                | "eval/runs.json"
        )
}

fn checksum(content: &[u8]) -> String {
    format!("{:x}", Sha256::digest(content))
}

fn write_pack(path: &Path, files: &[TrainingPackTextFile]) -> Result<(), String> {
    if files.len() > MAX_FILES {
        return Err("训练包文件过多".into());
    }
    let mut total = 0usize;
    let mut unique = BTreeMap::<String, String>::new();
    for entry in files {
        if !safe_name(&entry.name) {
            return Err(format!("训练包路径不允许: {}", entry.name));
        }
        total = total.saturating_add(entry.content.len());
        if entry.content.len() > MAX_FILE_BYTES || total > MAX_PACK_BYTES {
            return Err("训练包内容超过本机安全上限".into());
        }
        unique.insert(entry.name.clone(), entry.content.clone());
    }
    let parent = path
        .parent()
        .ok_or_else(|| "训练包导出路径无效".to_string())?;
    std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let output = File::create(path).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipWriter::new(output);
    let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    let mut sums = BTreeMap::<String, String>::new();
    for (name, content) in unique {
        zip.start_file(&name, options).map_err(|e| e.to_string())?;
        zip.write_all(content.as_bytes())
            .map_err(|e| e.to_string())?;
        sums.insert(name, checksum(content.as_bytes()));
    }
    let checksums = serde_json::to_string_pretty(&sums).map_err(|e| e.to_string())?;
    zip.start_file("checksums.json", options)
        .map_err(|e| e.to_string())?;
    zip.write_all(checksums.as_bytes())
        .map_err(|e| e.to_string())?;
    zip.finish().map_err(|e| e.to_string())?;
    Ok(())
}

/// 导出 `.xutrain`；依赖受限文本条目，失败时不会留下未校验的逻辑结果。
#[tauri::command]
pub fn xu_training_write_pack(
    path: String,
    files: Vec<TrainingPackTextFile>,
) -> Result<String, String> {
    let target = Path::new(path.trim());
    if target.extension().and_then(|v| v.to_str()) != Some("xutrain") {
        return Err("导出文件必须使用 .xutrain 扩展名".into());
    }
    write_pack(target, &files)?;
    Ok(target.to_string_lossy().into_owned())
}

fn read_pack(path: &Path) -> Result<TrainingPackReadResult, String> {
    let metadata = std::fs::metadata(path).map_err(|e| e.to_string())?;
    if metadata.len() as usize > MAX_PACK_BYTES {
        return Err("训练包超过本机安全上限".into());
    }
    let input = File::open(path).map_err(|e| e.to_string())?;
    let mut archive =
        zip::ZipArchive::new(input).map_err(|_| "不是有效的 .xutrain 包".to_string())?;
    if archive.len() > MAX_FILES + 1 {
        return Err("训练包文件过多".into());
    }
    let mut contents = BTreeMap::<String, String>::new();
    for index in 0..archive.len() {
        let mut item = archive.by_index(index).map_err(|e| e.to_string())?;
        let name = item.name().replace('\\', "/");
        if name == "checksums.json" {
            let mut raw = String::new();
            item.read_to_string(&mut raw).map_err(|e| e.to_string())?;
            contents.insert(name, raw);
            continue;
        }
        if !safe_name(&name) || item.size() as usize > MAX_FILE_BYTES {
            return Err(format!("训练包包含不允许的条目: {name}"));
        }
        let mut raw = String::new();
        item.read_to_string(&mut raw)
            .map_err(|_| "训练包仅允许 UTF-8 文本".to_string())?;
        contents.insert(name, raw);
    }
    let checksum_raw = contents
        .remove("checksums.json")
        .ok_or_else(|| "训练包缺少 checksums.json".to_string())?;
    let expected: BTreeMap<String, String> =
        serde_json::from_str(&checksum_raw).map_err(|_| "checksums.json 无效".to_string())?;
    for (name, value) in &contents {
        if expected.get(name) != Some(&checksum(value.as_bytes())) {
            return Err(format!("训练包校验失败: {name}"));
        }
    }
    if expected.len() != contents.len() {
        return Err("训练包校验清单与内容不一致".into());
    }
    Ok(TrainingPackReadResult {
        files: contents
            .into_iter()
            .map(|(name, content)| TrainingPackTextFile { name, content })
            .collect(),
        verified: true,
    })
}

/// 导入并验证 `.xutrain`；依赖 checksums.json，校验失败不返回任何可合并内容。
#[tauri::command]
pub fn xu_training_read_pack(path: String) -> Result<TrainingPackReadResult, String> {
    read_pack(Path::new(path.trim()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip_checksums() {
        let path =
            std::env::temp_dir().join(format!("xu-training-{}.xutrain", std::process::id()));
        let files = vec![TrainingPackTextFile {
            name: "manifest.json".into(),
            content: r#"{"schemaVersion":2}"#.into(),
        }];
        write_pack(&path, &files).unwrap();
        let result = read_pack(&path).unwrap();
        assert!(result.verified);
        assert_eq!(result.files[0].content, files[0].content);
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn rejects_traversal() {
        assert!(!safe_name("../secret.txt"));
        assert!(!safe_name("C:/secret.txt"));
    }

    #[test]
    fn rejects_checksum_mismatch() {
        let path =
            std::env::temp_dir().join(format!("xu-training-bad-{}.xutrain", std::process::id()));
        let output = File::create(&path).unwrap();
        let mut zip = zip::ZipWriter::new(output);
        let options = SimpleFileOptions::default();
        zip.start_file("manifest.json", options).unwrap();
        zip.write_all(br#"{"schemaVersion":2}"#).unwrap();
        zip.start_file("checksums.json", options).unwrap();
        zip.write_all(br#"{"manifest.json":"bad"}"#).unwrap();
        zip.finish().unwrap();
        assert!(read_pack(&path).unwrap_err().contains("校验失败"));
        let _ = std::fs::remove_file(path);
    }
}
